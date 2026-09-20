import { useCallback, useEffect, useRef, useState } from 'react';

// Core's /render/THUMBNAIL/... route can be asynchronous: if the resource
// hasn't been built yet (first view, or the built copy was purged after 7
// days), the node answers with an HTTP 503 "loading" page and builds the
// real image in the background, usually within seconds to a minute. A plain
// <img> that hits that 503 fails once and never retries, which is exactly
// the "icon missing until I refresh" symptom. Retry the same URL a few
// times with a cache-busting query param before giving up to the caller's
// placeholder.
const RETRY_DELAYS_MS = [1500, 4000, 10000, 25000];

function withRetryParam(url: string, attempt: number): string {
  if (attempt === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
}

export interface RetryingImageSrc {
  /** The URL to render in an <img src>, or null while a caller should show
   * its own placeholder (no url, waiting on a retry, or retries exhausted). */
  src: string | null;
  /** True once every retry has also failed - src stays null permanently
   * until the `url` argument itself changes. */
  failed: boolean;
  /** Attach to the <img onError> that renders `src`. */
  onError: () => void;
}

/**
 * Shared retry-with-backoff state machine for coin/thumbnail images. Used by
 * `CoinImage` and any caller (e.g. CoinGrid's tile view) that needs to keep
 * its own wrapper/placeholder markup instead of CoinImage's.
 */
export function useRetryingImageSrc(
  url: string | null,
  ticker: string
): RetryingImageSrc {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new/updated URL (different coin, or a fresh resolve after the URL
  // was previously null) always deserves a clean set of retry attempts.
  useEffect(() => {
    setAttempt(0);
    setWaiting(false);
    setFailed(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onError = useCallback(() => {
    if (attempt >= RETRY_DELAYS_MS.length) {
      setFailed(true);
      console.warn(
        '[wallet] coin image',
        ticker,
        `gave up after ${RETRY_DELAYS_MS.length} retries`
      );
      return;
    }
    console.warn(
      '[wallet] coin image',
      ticker,
      `load failed, retrying in ${RETRY_DELAYS_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`
    );
    setWaiting(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setAttempt((a) => a + 1);
      setWaiting(false);
    }, RETRY_DELAYS_MS[attempt]);
  }, [attempt, ticker]);

  const src = !url || failed || waiting ? null : withRetryParam(url, attempt);

  return { src, failed, onError };
}
