import { useEffect, useRef } from 'react';

/**
 * Tracks document visibility for polling loops that must pause while the
 * tab/window is hidden (round 2, item C) and re-run a freshness pass when it
 * becomes visible again after being hidden for longer than `staleAfterMs`
 * (round 2, item B's "visible again after >2 min hidden" trigger).
 *
 * Returns a ref (not state) so polling intervals can cheaply check
 * `visibleRef.current` on each tick without re-subscribing, and registers
 * `onVisibleAfterStale` to run once per hidden→visible transition that
 * exceeds `staleAfterMs`.
 */
export function useDocumentVisible(
  onVisibleAfterStale?: (hiddenForMs: number) => void,
  staleAfterMs = 0
): React.RefObject<boolean> {
  const visibleRef = useRef(
    typeof document === 'undefined' ? true : !document.hidden
  );
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      visibleRef.current = !hidden;
      if (hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenSince = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenSince == null) return;
      const hiddenForMs = Date.now() - hiddenSince;
      if (hiddenForMs > staleAfterMs) onVisibleAfterStale?.(hiddenForMs);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [onVisibleAfterStale, staleAfterMs]);

  return visibleRef;
}
