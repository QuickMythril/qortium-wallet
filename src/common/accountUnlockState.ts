// Shared, module-level cache of whether the selected Home account is
// currently unlocked. AppLayout already resolves this once on mount (via
// GET_SELECTED_ACCOUNT / UNLOCK_SELECTED_ACCOUNT); send flows read the cache
// here instead of unconditionally re-requesting an unlock on every send.
//
// `null` means "unknown" - callers should re-check with GET_SELECTED_ACCOUNT
// rather than assume either state.

export type CachedUnlockState = boolean | null;

let cached: CachedUnlockState = null;
const listeners = new Set<() => void>();

export function getCachedAccountUnlocked(): CachedUnlockState {
  return cached;
}

export function setCachedAccountUnlocked(value: CachedUnlockState): void {
  cached = value;
  listeners.forEach((listener) => listener());
}

/** Force the next unlock check to re-verify rather than trust a stale cache. */
export function invalidateCachedAccountUnlocked(): void {
  setCachedAccountUnlocked(null);
}

export function subscribeCachedAccountUnlocked(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
