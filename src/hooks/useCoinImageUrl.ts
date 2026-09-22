import { useState, useEffect } from 'react';

// Only resolved URLs are cached. A rejection (or a bridge that isn't ready
// yet) is never cached - the next mount, or the next
// `qortiumBridgeStateChanged` event, gets a fresh attempt instead of being
// stuck with a permanent null forever.
const urlCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function normalizeUrl(value: string): string | null {
  try {
    // Home can return a relative path; resolve it against this page's
    // origin so it still works when the app is loaded from another host.
    return new URL(value, window.location.href).toString();
  } catch {
    return null;
  }
}

function fetchUrl(key: string): Promise<string | null> {
  if (inFlight.has(key)) return inFlight.get(key)!;

  if (typeof qdnRequest !== 'function') {
    return Promise.resolve(null);
  }

  const p = qdnRequest({
    action: 'GET_QDN_RESOURCE_URL',
    service: 'THUMBNAIL',
    name: 'Wallet',
    identifier: `wallet-coin-${key}`,
  })
    .then((url: unknown) => {
      inFlight.delete(key);
      const resolved =
        typeof url === 'string' && url ? normalizeUrl(url) : null;
      if (resolved) {
        urlCache.set(key, resolved);
        return resolved;
      }
      console.warn('[wallet] coin image', key, 'no thumbnail URL was returned');
      return null;
    })
    .catch((err: unknown) => {
      inFlight.delete(key);
      console.warn(
        '[wallet] coin image',
        key,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    });
  inFlight.set(key, p);
  return p;
}

export function useCoinImageUrl(ticker: string): string | null {
  const key = ticker.toLowerCase();
  const [url, setUrl] = useState<string | null>(
    () => urlCache.get(key) ?? null
  );

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      const cached = urlCache.get(key);
      if (cached) {
        setUrl(cached);
        return;
      }
      fetchUrl(key).then((resolved) => {
        if (!cancelled) setUrl(resolved);
      });
    };

    load();

    // A resource that wasn't published yet (or was published after this
    // bridge session started) can become available once Home's bridge
    // state changes - retry rather than staying blank for the page's
    // lifetime.
    window.addEventListener('qortiumBridgeStateChanged', load);
    return () => {
      cancelled = true;
      window.removeEventListener('qortiumBridgeStateChanged', load);
    };
  }, [key]);

  return url;
}

/** Test-only: clear the module-level URL cache between test cases. */
export function __resetCoinImageUrlCacheForTests(): void {
  urlCache.clear();
  inFlight.clear();
}
