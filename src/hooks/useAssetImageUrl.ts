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
// Round 3b: a Qortal asset's image is fetched via its OWN node
// (`qortalRequest`), which - unlike Home's own QDN, `qdnRequest` - is a
// different origin from the app's page: `GET_QDN_RESOURCE_URL` handed back
// an http(s) URL on that origin, which an `<img src>` then loaded directly.
// That URL is cross-origin from the app view (CSP-limited in Home) and
// Core answers a freshly-requested, never-rendered IMAGE resource with a
// temporary HTTP 503 while it builds it - both of which made Qortal asset
// images simply never appear. Q-Assets' own asset *list* page has no image
// code at all (so it shows none there either); its *detail* page instead
// fetches the bytes through the bridge itself
// (`src/utils/fetchAssetAvatar.ts`): `FETCH_QDN_RESOURCE` with
// `encoding: 'base64'`, sniff the MIME from the decoded header, and render
// a `data:` URL. That request goes through the SAME bridge (`qdnRequest` /
// `qortalRequest`) as every other asset read here, so it's never
// cross-origin and never subject to the app's CSP - only an actual `<img
// src="data:...">` is ever cross-origin-free by construction. This hook now
// does the same for both networks.
//
// Issuer metadata is untrusted: `owner` and any resolved name are only ever
// passed through as resource coordinates (an address or a `name`/`identifier`
// pair) to the bridge - never rendered as HTML or trusted text. A fetched
// image's bytes are only ever handed to the browser as a `data:` URL for an
// `<img src>` (an SVG payload included - it is never parsed or inlined as
// markup), and only after sniffing its header as one of a small allow-list
// of real image formats.

const QASSETS_OWNER_NAME = 'Q-Assets';
const QASSETS_DEFAULT_IDENTIFIER = 'assetAvatar_default';

// Generous but bounded - an avatar is a small icon, not an arbitrary file.
const MAX_IMAGE_BYTES = 2_000_000;

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
  /** A resolved `data:<mime>;base64,...` URL, or null while unresolved. */
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
const imageInFlight = new Map<string, Promise<AssetImageResult>>();

// Bounded, LRU-evicted cache of resolved `data:` URLs. Each entry can be up
// to a couple of MB of base64 text (round 3b's `MAX_IMAGE_BYTES`), so unlike
// the small string caches above this one is capped on BOTH entry count and
// total size, to keep a long-lived session's memory use bounded no matter
// how many distinct assets get viewed. `Map` iteration order is insertion
// order, so re-inserting a key (on either a read-through touch or a write)
// moves it to the most-recently-used end; eviction always removes from the
// other end first (round 3b review finding 3).
const MAX_IMAGE_CACHE_ENTRIES = 40;
const MAX_IMAGE_CACHE_BYTES = 24 * 1024 * 1024; // 24 MB of cached base64 text
const imageResultCache = new Map<string, AssetImageResult>();
const imageCacheEntryBytes = new Map<string, number>();
let imageCacheByteTotal = 0;

function imageResultByteCost(result: AssetImageResult): number {
  // The `data:` URL's own length is a cheap, accurate-enough proxy for the
  // memory this entry holds - it's almost entirely the base64 payload.
  return result.url ? result.url.length : 0;
}

function evictOldestImageCacheEntry(): boolean {
  const oldestKey = imageResultCache.keys().next().value;
  if (oldestKey === undefined) return false;
  imageCacheByteTotal -= imageCacheEntryBytes.get(oldestKey) ?? 0;
  imageResultCache.delete(oldestKey);
  imageCacheEntryBytes.delete(oldestKey);
  return true;
}

/** Read-through cache lookup that also marks the entry most-recently-used. */
function getCachedImageResult(key: string): AssetImageResult | undefined {
  const cached = imageResultCache.get(key);
  if (cached === undefined) return undefined;
  imageResultCache.delete(key);
  imageResultCache.set(key, cached);
  return cached;
}

function setCachedImageResult(key: string, result: AssetImageResult): void {
  if (imageResultCache.has(key)) {
    imageCacheByteTotal -= imageCacheEntryBytes.get(key) ?? 0;
    imageResultCache.delete(key);
    imageCacheEntryBytes.delete(key);
  }

  const cost = imageResultByteCost(result);
  imageResultCache.set(key, result);
  imageCacheEntryBytes.set(key, cost);
  imageCacheByteTotal += cost;

  while (
    imageResultCache.size > MAX_IMAGE_CACHE_ENTRIES ||
    imageCacheByteTotal > MAX_IMAGE_CACHE_BYTES
  ) {
    if (!evictOldestImageCacheEntry()) break;
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

// ---------------- base64 payload + MIME sniff ----------------

function extractBase64Payload(res: unknown): string | null {
  if (typeof res === 'string' && res) return res;
  if (
    res &&
    typeof res === 'object' &&
    typeof (res as any).data64 === 'string' &&
    (res as any).data64
  ) {
    return (res as any).data64;
  }
  return null;
}

// A real base64 alphabet (A-Z a-z 0-9 + /), a length that's a multiple of
// 4, and at most 2 trailing '=' padding characters. `atob` is lenient about
// some malformed input (e.g. it silently ignores whitespace in some
// engines) and this hook previously only ever decoded the first ~64
// characters to sniff a MIME type - a payload that looked fine there but
// had trailing garbage would still be handed to the browser whole, as a
// `data:` URL built from the FULL untrusted string (round 3b review). Every
// payload is validated against this strict grammar, in full, before any of
// it is used to build a URL.
const STRICT_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

function isStrictBase64(value: string): boolean {
  return (
    value.length > 0 && value.length % 4 === 0 && STRICT_BASE64_RE.test(value)
  );
}

// The decoded byte count is derivable from the (already length-validated)
// base64 string's length and its padding alone - no need to actually
// decode the whole thing just to reject an oversized payload up front.
function base64DecodedByteLength(base64: string): number {
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return (base64.length / 4) * 3 - padding;
}

// Only the first slice is ever decoded for MIME sniffing - large enough to
// comfortably fit an SVG's leading BOM/XML declaration/comments before its
// root element, but still a small, bounded amount of work regardless of the
// payload's total size.
const SNIFF_SAMPLE_BASE64_CHARS = 1024;

// A conservative "is this really an SVG document" check: after stripping an
// optional BOM, and repeatedly skipping whitespace, an XML declaration
// (`<?xml ... ?>`), comments (`<!-- ... -->`), and a DOCTYPE, the remaining
// text must begin with the literal `<svg` immediately followed by
// whitespace, `>`, or `/` - i.e. a real element open tag, not merely a
// string starting with those four characters (`<svgx...>` is a `<svgx>`
// element, not `<svg>`, and must be rejected). If the sample is truncated
// before that boundary can be confirmed, this fails closed (false).
function looksLikeSvgRoot(sample: string): boolean {
  let s = sample;
  if (
    s.charCodeAt(0) === 0xef &&
    s.charCodeAt(1) === 0xbb &&
    s.charCodeAt(2) === 0xbf
  ) {
    s = s.slice(3); // UTF-8 BOM, as the three literal bytes atob decodes it to
  } else if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
  }

  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    if (s.startsWith('<?xml')) {
      const end = s.indexOf('?>');
      if (end === -1) return false;
      s = s.slice(end + 2);
      continue;
    }
    if (s.startsWith('<!--')) {
      const end = s.indexOf('-->');
      if (end === -1) return false;
      s = s.slice(end + 3);
      continue;
    }
    if (/^<!DOCTYPE/i.test(s)) {
      const end = s.indexOf('>');
      if (end === -1) return false;
      s = s.slice(end + 1);
      continue;
    }
    if (s === before) break;
  }

  if (!s.startsWith('<svg')) return false;
  const next = s.charAt(4);
  return next !== '' && (/\s/.test(next) || next === '>' || next === '/');
}

// Sniffs the decoded header against a small allow-list of real image
// formats (same signatures Q-Assets' own `guessImageMimeFromBase64` checks,
// minus BMP - not one of the formats this hook is asked to accept). Any
// other payload - including one that fails to base64-decode at all, or that
// decodes but doesn't match a known signature - is rejected outright: it is
// never handed to the browser as a `data:` URL, and is treated exactly like
// a failed fetch by the caller (never retried differently, never cached).
function sniffImageMime(base64: string): string | null {
  let sample: string;
  try {
    sample = atob(base64.slice(0, SNIFF_SAMPLE_BASE64_CHARS));
  } catch {
    return null;
  }
  const b: number[] = [];
  for (let i = 0; i < sample.length; i++) b.push(sample.charCodeAt(i));

  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  // SVG is only ever rendered through an <img src="data:image/svg+xml;...">
  // below - it is never parsed or inlined as markup.
  if (looksLikeSvgRoot(sample)) return 'image/svg+xml';

  return null;
}

function buildDataUrl(res: unknown): string | null {
  const base64 = extractBase64Payload(res);
  if (!base64) return null;
  // Whole-payload validation and the client-side size cap both happen
  // before any decoding of the (potentially large) full string - a
  // malformed or oversized payload is rejected outright, exactly like a
  // failed fetch (round 3b review).
  if (!isStrictBase64(base64)) return null;
  if (base64DecodedByteLength(base64) > MAX_IMAGE_BYTES) return null;
  const mime = sniffImageMime(base64);
  if (!mime) return null;
  return `data:${mime};base64,${base64}`;
}

// One attempt: fetch the resource's bytes over the bridge and turn them
// into a data: URL, or null on any failure (bridge error/rejection, empty
// payload, or a payload that doesn't sniff as a real image).
async function fetchImageDataUrlOnce(
  network: AssetNetwork,
  name: string,
  identifier: string
): Promise<string | null> {
  try {
    const res = await bridgeRequest(network, {
      action: 'FETCH_QDN_RESOURCE',
      service: 'IMAGE',
      name,
      identifier,
      encoding: 'base64',
      maxBytes: MAX_IMAGE_BYTES,
    });
    return buildDataUrl(res);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Core/Home can answer a freshly-requested IMAGE resource with an empty
// payload (or a rejected request) while it's still building it in the
// background, the same "not ready yet" gap coin icons hit via a THUMBNAIL
// URL's HTTP 503. A `data:` URL that's already in hand never 503s (there's
// no further network fetch once one is built), so unlike coin icons there
// is nothing for an `<img onError>` to retry against - the retry has to
// happen here, before a URL is ever handed back. Two extra attempts after
// the first, then give up (never cached, per the miss policy above).
const IMAGE_FETCH_RETRY_DELAYS_MS = [1500, 4000, 10000];

async function fetchImageDataUrlWithRetry(
  network: AssetNetwork,
  name: string,
  identifier: string
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const dataUrl = await fetchImageDataUrlOnce(network, name, identifier);
    if (dataUrl) return dataUrl;
    if (attempt >= IMAGE_FETCH_RETRY_DELAYS_MS.length) return null;
    await delay(IMAGE_FETCH_RETRY_DELAYS_MS[attempt]);
  }
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
          url = await fetchImageDataUrlWithRetry(
            network,
            issuerName,
            identifier
          );
        }
      }

      // The Q-Assets shared default avatar is a Qortal-only convention -
      // there is no `Q-Assets` name published on Qortium.
      if (!url && network === 'qortal') {
        url = await fetchImageDataUrlWithRetry(
          network,
          QASSETS_OWNER_NAME,
          QASSETS_DEFAULT_IDENTIFIER
        );
      }

      const result: AssetImageResult = { url, issuerName };
      // Only a resolved image URL is cached permanently. A miss (no issuer,
      // no published avatar, no default) is never cached, so a later
      // publish is picked up on the next mount or bridge-state change.
      if (url) setCachedImageResult(key, result);
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
 * convention) as a `data:` URL, fetched entirely through the asset's own
 * bridge (never a cross-origin `<img src>` to the other node), and the
 * issuer's QDN name for display alongside it (e.g. a chain badge tooltip).
 * The retry-while-Core-is-still-building behavior coin icons get from
 * `useRetryingImageSrc`'s `<img onError>` loop already happened inside this
 * hook by the time it returns a non-null `url` - a data: URL never needs a
 * caller-side retry. Pair the null case with `CoinImage`'s placeholder as
 * usual. `issuerName` updates as soon as it's resolved, independently of
 * `url` - it does not wait for the (possibly retried) image fetch to finish.
 */
export function useAssetImageUrl(
  network: AssetNetwork,
  asset: AssetImageAsset
): AssetImageResult {
  const key = `${network}:${asset.assetId}`;
  const [result, setResult] = useState<AssetImageResult>(
    () => getCachedImageResult(key) ?? EMPTY_RESULT
  );

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      const cached = getCachedImageResult(key);
      if (cached) {
        setResult(cached);
        return;
      }
      // The owner address isn't known yet (e.g. AssetDetail renders before
      // its GET_ASSET_INFO call resolves) - nothing to resolve against yet.
      if (!asset.owner) return;

      // The issuer name is surfaced as soon as it's known, independently of
      // the (possibly retried, up to ~15s) image fetch below - a chain
      // badge's tooltip, or AssetDetail's issuer line, shouldn't sit on
      // "unknown issuer" for that long just because an avatar is still
      // being built. `resolveIssuerName` is cheap to call again here: it's
      // deduped against the exact same in-flight/cached promise
      // `fetchAssetImage` below awaits internally.
      resolveIssuerName(network, asset.owner).then((issuerName) => {
        if (cancelled) return;
        setResult((prev) => ({ url: prev.url, issuerName }));
      });

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
  imageCacheEntryBytes.clear();
  imageCacheByteTotal = 0;
  imageInFlight.clear();
}

/**
 * Test-only: the image result cache's current entry count and total tracked
 * byte size, plus its caps - used to assert eviction keeps both bounded
 * (round 3b review finding 3).
 */
export function __getImageCacheStatsForTests(): {
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
} {
  return {
    entries: imageResultCache.size,
    bytes: imageCacheByteTotal,
    maxEntries: MAX_IMAGE_CACHE_ENTRIES,
    maxBytes: MAX_IMAGE_CACHE_BYTES,
  };
}

/** Test-only: the cache keys currently held, oldest (least-recently-used)
 * first - used to assert which entries an eviction removed. */
export function __getImageCacheKeysForTests(): string[] {
  return Array.from(imageResultCache.keys());
}

/**
 * Test-only: exercises the real bounded-cache insert/eviction path directly
 * (the exact function production code calls), without needing to drive a
 * full async hook resolution for every entry a cache-capacity test wants to
 * insert (round 3b review finding 3).
 */
export function __setCachedImageResultForTests(
  key: string,
  result: AssetImageResult
): void {
  setCachedImageResult(key, result);
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
