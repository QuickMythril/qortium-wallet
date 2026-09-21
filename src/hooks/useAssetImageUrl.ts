import { useEffect, useState } from 'react';
import type { AssetNetwork } from '../utils/Types';

// Round 3: an issuer-published asset avatar, following the Q-Assets
// convention (crowetic/Q-Assets): service IMAGE, name = the issuer's QDN
// name (resolved from the asset owner address), identifier
// `asset<assetId>_<assetName>_aavatar`. If nothing is published there, a
// Qortal asset falls back to the shared `Q-Assets` app's default avatar -
// there is no equivalent published name on Qortium yet, so a Qortium miss
// falls straight through to the caller's letter-circle placeholder.
//
// Issuer metadata is untrusted: `owner` and any resolved name are only ever
// passed through as resource coordinates (an address or a `name`/`identifier`
// pair) to the bridge - never rendered as HTML or trusted text.

const QASSETS_OWNER_NAME = 'Q-Assets';
const QASSETS_DEFAULT_IDENTIFIER = 'assetAvatar_default';

// A conservative, local QDN identifier check performed before any bridge
// call. An asset's name is issuer-controlled (round 3 review finding 2) -
// it's never trusted enough to build a wire identifier from unchecked. Real
// QDN identifiers cap at 64 bytes; this also rejects whitespace, control
// characters, and '/' (which some hosts would otherwise treat as a path
// separator).
const MAX_QDN_IDENTIFIER_LENGTH = 64;
// eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL
const INVALID_QDN_IDENTIFIER_CHARS = /[\s/\x00-\x1f\x7f]/;

function isValidQdnIdentifier(identifier: string): boolean {
  return (
    identifier.length > 0 &&
    identifier.length <= MAX_QDN_IDENTIFIER_LENGTH &&
    !INVALID_QDN_IDENTIFIER_CHARS.test(identifier)
  );
}

export interface AssetImageAsset {
  assetId: number;
  name: string;
  owner: string;
}

export interface AssetImageResult {
  /** Resolved, retry-ready IMAGE URL, or null while unresolved. */
  url: string | null;
  /** The issuer's QDN name, once resolved - null while unknown. */
  issuerName: string | null;
}

const EMPTY_RESULT: AssetImageResult = { url: null, issuerName: null };

// Only a successful resolution is cached (round 1's useCoinImageUrl
// pattern): a rejection, an unresolved issuer, or a bridge that isn't ready
// yet is never cached permanently - the next mount, or the next
// `qortiumBridgeStateChanged` event, gets a fresh attempt.
const issuerNameCache = new Map<string, string>();
const issuerNameInFlight = new Map<string, Promise<string | null>>();
const imageResultCache = new Map<string, AssetImageResult>();
const imageInFlight = new Map<string, Promise<AssetImageResult>>();

function normalizeUrl(value: string): string | null {
  try {
    // Home can return a relative path; resolve it against this page's
    // origin so it still works when the app is loaded from another host.
    return new URL(value, window.location.href).toString();
  } catch {
    return null;
  }
}

function bridgeRequest(
  network: AssetNetwork,
  options: QdnRequestOptions
): Promise<unknown> {
  // Deferred through an already-resolved promise so a bridge implementation
  // that throws synchronously (some hosts do, instead of returning a
  // rejected promise) always surfaces as an ordinary rejection here - never
  // a synchronous exception that would skip every `.then()`/`.catch()`
  // downstream and leave a promise permanently stuck in an in-flight map
  // (round 3 review finding 2).
  return Promise.resolve().then(() => {
    if (network === 'qortium') {
      if (typeof qdnRequest !== 'function') {
        throw new Error('The Qortium bridge is not available in this host.');
      }
      return qdnRequest(options);
    }
    if (typeof qortalRequest !== 'function') {
      throw new Error('The Qortal bridge is not available in this host.');
    }
    return qortalRequest(options);
  });
}

function extractPrimaryName(res: unknown): string | null {
  if (typeof res === 'string' && res) return res;
  if (res && typeof res === 'object' && typeof (res as any).name === 'string') {
    return (res as any).name || null;
  }
  return null;
}

function extractFirstAccountName(res: unknown): string | null {
  const arr = Array.isArray(res)
    ? res
    : res && typeof res === 'object' && Array.isArray((res as any).names)
      ? (res as any).names
      : [];
  for (const entry of arr) {
    if (typeof entry === 'string' && entry) return entry;
    if (
      entry &&
      typeof entry === 'object' &&
      typeof entry.name === 'string' &&
      entry.name
    ) {
      return entry.name;
    }
  }
  return null;
}

function fetchAccountNamesFallback(
  network: AssetNetwork,
  owner: string
): Promise<string | null> {
  return bridgeRequest(network, { action: 'GET_ACCOUNT_NAMES', address: owner })
    .then((res) => extractFirstAccountName(res))
    .catch(() => null);
}

// GET_PRIMARY_NAME first, then GET_ACCOUNT_NAMES if the account has no
// primary name (or the lookup itself fails). `async` so any synchronous
// throw anywhere in this body - including from a bridge implementation
// `bridgeRequest` didn't already defer - is caught by the function's own
// implicit promise wrapping instead of escaping as an exception.
async function resolveIssuerNameUncached(
  network: AssetNetwork,
  owner: string
): Promise<string | null> {
  try {
    const primary = extractPrimaryName(
      await bridgeRequest(network, {
        action: 'GET_PRIMARY_NAME',
        address: owner,
      })
    );
    if (primary) return primary;
  } catch {
    // fall through to GET_ACCOUNT_NAMES below
  }
  return fetchAccountNamesFallback(network, owner);
}

// Resolved once per (network, owner).
function resolveIssuerName(
  network: AssetNetwork,
  owner: string
): Promise<string | null> {
  const key = `${network}:${owner}`;
  const cached = issuerNameCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inFlight = issuerNameInFlight.get(key);
  if (inFlight) return inFlight;

  const p = resolveIssuerNameUncached(network, owner)
    .then((name) => {
      if (name) issuerNameCache.set(key, name);
      return name;
    })
    // Always clears the in-flight entry, success or failure - a rejection
    // reaching here without this would leave the key stuck forever, since a
    // plain `.then(onFulfilled)` (no `onRejected`) never runs on rejection
    // (round 3 review finding 2).
    .finally(() => {
      issuerNameInFlight.delete(key);
    });

  issuerNameInFlight.set(key, p);
  return p;
}

function fetchImageUrlFor(
  network: AssetNetwork,
  name: string,
  identifier: string
): Promise<string | null> {
  return bridgeRequest(network, {
    action: 'GET_QDN_RESOURCE_URL',
    service: 'IMAGE',
    name,
    identifier,
  })
    .then((url: unknown) =>
      typeof url === 'string' && url ? normalizeUrl(url) : null
    )
    .catch(() => null);
}

function fetchAssetImage(
  network: AssetNetwork,
  asset: AssetImageAsset
): Promise<AssetImageResult> {
  const key = `${network}:${asset.assetId}`;
  const inFlight = imageInFlight.get(key);
  if (inFlight) return inFlight;

  const p = (async (): Promise<AssetImageResult> => {
    try {
      const issuerName = await resolveIssuerName(network, asset.owner);

      let url: string | null = null;
      if (issuerName) {
        const identifier = `asset${asset.assetId}_${asset.name}_aavatar`;
        // An issuer-controlled asset name that doesn't form a valid QDN
        // identifier (whitespace, a '/', control characters, or over the
        // 64-byte limit) never reaches the bridge - it's routed straight
        // into the same fallback path as a failed lookup (round 3 review
        // finding 2).
        if (isValidQdnIdentifier(identifier)) {
          url = await fetchImageUrlFor(network, issuerName, identifier);
        }
      }

      // The Q-Assets shared default avatar is a Qortal-only convention -
      // there is no `Q-Assets` name published on Qortium.
      if (!url && network === 'qortal') {
        url = await fetchImageUrlFor(
          network,
          QASSETS_OWNER_NAME,
          QASSETS_DEFAULT_IDENTIFIER
        );
      }

      const result: AssetImageResult = { url, issuerName };
      // Only a resolved image URL is cached permanently. A miss (no issuer,
      // no published avatar, no default) is never cached, so a later
      // publish is picked up on the next mount or bridge-state change.
      if (url) imageResultCache.set(key, result);
      return result;
    } catch {
      // Never let a caller's `.then()` see an unhandled rejection - an
      // unexpected failure anywhere above resolves to the same "nothing
      // resolved" result a caller already renders as a placeholder.
      return EMPTY_RESULT;
    } finally {
      // Always runs, success or failure - the earlier version only deleted
      // this on the successful-completion path, so a rejection left the key
      // stuck in `imageInFlight` forever, with every later mount and bridge-
      // state retry returning that same dead promise (round 3 review
      // finding 2).
      imageInFlight.delete(key);
    }
  })();

  imageInFlight.set(key, p);
  return p;
}

/**
 * Resolves an issuer-published avatar for a Qortium or Qortal asset (Q-Assets
 * convention), and the issuer's QDN name for display alongside it (e.g. a
 * chain badge tooltip). Pair the returned `url` with `useRetryingImageSrc` /
 * `CoinImage` - Core can answer 503 while it builds a freshly-requested
 * IMAGE resource, the same as coin icons.
 */
export function useAssetImageUrl(
  network: AssetNetwork,
  asset: AssetImageAsset
): AssetImageResult {
  const key = `${network}:${asset.assetId}`;
  const [result, setResult] = useState<AssetImageResult>(
    () => imageResultCache.get(key) ?? EMPTY_RESULT
  );

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      const cached = imageResultCache.get(key);
      if (cached) {
        setResult(cached);
        return;
      }
      // The owner address isn't known yet (e.g. AssetDetail renders before
      // its GET_ASSET_INFO call resolves) - nothing to resolve against yet.
      if (!asset.owner) return;
      fetchAssetImage(network, asset)
        .then((resolved) => {
          if (!cancelled) setResult(resolved);
        })
        // fetchAssetImage is written to never reject, but this is a cheap
        // backstop against an unhandled rejection warning if that ever
        // regresses (round 3 review finding 2) - fall back to the
        // placeholder rather than leaving the effect's promise unhandled.
        .catch(() => {
          if (!cancelled) setResult(EMPTY_RESULT);
        });
    };

    load();

    // A resource that wasn't published yet (or an issuer name that wasn't
    // registered yet) can become available once Home's bridge state changes
    // - retry rather than staying blank for the page's lifetime.
    window.addEventListener('qortiumBridgeStateChanged', load);
    return () => {
      cancelled = true;
      window.removeEventListener('qortiumBridgeStateChanged', load);
    };
    // `asset.owner` is included so a caller that renders before an asset's
    // info has loaded (owner starts as an empty string) retries once the
    // real owner address arrives, instead of being stuck with whatever an
    // empty-address lookup returned. `asset.name` doesn't affect the cache
    // key but does change the identifier fetched, so it's included too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, key, asset.owner, asset.name]);

  return result;
}

/** Test-only: clear the module-level caches between test cases. */
export function __resetAssetImageUrlCacheForTests(): void {
  issuerNameCache.clear();
  issuerNameInFlight.clear();
  imageResultCache.clear();
  imageInFlight.clear();
}

/**
 * Test-only: the number of entries left in the in-flight maps. Used to
 * assert a resolved (or failed) lookup always cleans up after itself -
 * round 3 review finding 2 was exactly a leak here (an in-flight entry
 * stuck forever because cleanup wasn't in a `finally`).
 */
export function __getInFlightCountsForTests(): {
  issuerName: number;
  image: number;
} {
  return { issuerName: issuerNameInFlight.size, image: imageInFlight.size };
}
