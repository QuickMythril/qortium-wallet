import { clearArrrProgressHistory } from '../../common/arrrProgress';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useArrrSyncStatus } from '../useArrrSyncStatus';
import { notifyArrrWalletSessionChanged } from '../useArrrWalletSession';
import {
  ARRR_BUSY_MAX_ATTEMPTS,
  ARRR_BUSY_RETRY_DELAY_MS,
  ARRR_OWNER_BUSY_CEILING_MS,
  ARRR_POLL_ACTIVE_MS,
  ARRR_POLL_SETTLED_MS,
  ARRR_SESSION_SETTLE_MS,
} from '../../common/arrrSync';

// @testing-library/react's `waitFor` polls with real setTimeout internally,
// which deadlocks under vi.useFakeTimers() unless timers are advanced
// concurrently - simpler and more deterministic here to just flush
// microtasks/zero-delay timers with advanceTimersByTimeAsync(0) after each
// awaited request settles, then assert directly.
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    value: hidden,
    configurable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

const readySnapshot = {
  contract: 'qortium-home-arrr-custody-v1',
  coin: 'ARRR',
  state: 'READY',
  ready: true,
  message: null,
  syncedBlocks: 100,
  totalBlocks: 100,
  restartRequired: false,
  recoveryState: null,
  scannedHeight: 100,
  tipHeight: 100,
  totalBalanceAtomic: '100',
  verifiedBalanceAtomic: '90',
  observedAt: Date.now(),
  stale: false,
  backendMode: 'unified',
  walletIdentityHash: 'hash',
  lastError: null,
};

const syncingSnapshot = {
  ...readySnapshot,
  state: 'SYNCHRONIZING',
  ready: false,
};

describe('useArrrSyncStatus', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clearArrrProgressHistory();
    qdnRequestMock = vi.fn();
    (globalThis as any).qdnRequest = qdnRequestMock;
    setDocumentHidden(false);
  });

  afterEach(() => {
    delete (globalThis as any).qdnRequest;
    vi.useRealTimers();
  });

  it('preserves the rate across detail/list remounts but not account changes', async () => {
    let blocks = 100;
    qdnRequestMock.mockImplementation(async () => ({
      ...syncingSnapshot,
      syncedBlocks: blocks,
      totalBlocks: 1000,
    }));
    const first = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    blocks = 200;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    blocks = 300;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(first.result.current.progress.remainingSeconds).toBe(105);
    first.unmount();
    const second = renderHook(
      ({ account }) => useArrrSyncStatus(true, account),
      { initialProps: { account: 'acct-a' } }
    );
    await flush();
    expect(second.result.current.progress.remainingSeconds).toBe(105);
    second.rerender({ account: 'acct-b' });
    await flush();
    expect(second.result.current.progress.remainingSeconds).toBeNull();
  });

  it('clears rate samples on route/custody changes and suppresses estimates on request errors', async () => {
    let blocks = 100;
    qdnRequestMock.mockImplementation(async () => ({
      ...syncingSnapshot,
      syncedBlocks: blocks,
      totalBlocks: 1000,
    }));
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    blocks = 200;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    blocks = 300;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(result.current.progress.remainingSeconds).not.toBeNull();
    act(() => window.dispatchEvent(new Event('qortiumBridgeStateChanged')));
    await flush();
    expect(result.current.progress.remainingSeconds).toBeNull();
    qdnRequestMock.mockRejectedValue(new Error('Offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(result.current.progress.percent).toBeNull();
  });

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() => useArrrSyncStatus(false, 'acct-a'));
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(qdnRequestMock).not.toHaveBeenCalled();
  });

  it('polls immediately once enabled and stores the parsed snapshot', async () => {
    qdnRequestMock.mockResolvedValue(readySnapshot);
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();

    expect(qdnRequestMock).toHaveBeenCalledWith({
      action: 'GET_ARRR_SYNC_STATUS',
      coin: 'ARRR',
    });
    expect(result.current.snapshot?.state).toBe('READY');
    expect(result.current.loading).toBe(false);
  });

  it('polls every 15s while SYNCHRONIZING and every 3 min once READY', async () => {
    qdnRequestMock.mockResolvedValueOnce(syncingSnapshot);
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    expect(result.current.snapshot?.state).toBe('SYNCHRONIZING');
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);

    qdnRequestMock.mockResolvedValueOnce(syncingSnapshot);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_ACTIVE_MS);
    });
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);

    // Now flip to READY - subsequent cadence should switch to 3 minutes.
    qdnRequestMock.mockResolvedValueOnce(readySnapshot);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_ACTIVE_MS);
    });
    expect(result.current.snapshot?.state).toBe('READY');
    expect(qdnRequestMock).toHaveBeenCalledTimes(3);

    // A short wait (less than 3 min) must NOT trigger another poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_ACTIVE_MS);
    });
    expect(qdnRequestMock).toHaveBeenCalledTimes(3);

    qdnRequestMock.mockResolvedValueOnce(readySnapshot);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS);
    });
    expect(qdnRequestMock).toHaveBeenCalledTimes(4);
  });

  it('pauses polling while the document is hidden and resumes immediately when visible again', async () => {
    qdnRequestMock.mockResolvedValueOnce(syncingSnapshot);
    renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);

    setDocumentHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_ACTIVE_MS * 5);
    });
    // Still hidden - no additional polls, no matter how much time passes.
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);

    qdnRequestMock.mockResolvedValueOnce(readySnapshot);
    setDocumentHidden(false);
    await flush();
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });

  it('preserves fresh READY data on short tab returns without delaying the normal refresh', async () => {
    qdnRequestMock.mockResolvedValue(readySnapshot);
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    setDocumentHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    setDocumentHidden(false);
    await flush();
    expect(result.current.snapshot?.ready).toBe(true);
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS - 1000);
    });
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes expired READY data on returning from a long hidden period', async () => {
    qdnRequestMock.mockResolvedValue(readySnapshot);
    renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    setDocumentHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS + 1000);
    });
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);
    setDocumentHidden(false);
    await flush();
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });

  it('retries GET_ARRR_SYNC_STATUS on ARRR_WALLET_BUSY before giving up to the surfaced error', async () => {
    const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };
    qdnRequestMock
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce(readySnapshot);
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
    });
    expect(result.current.snapshot?.state).toBe('READY');
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });

  // Codex round 5 review finding 3: Home's actual rejection for a denied
  // `account.arrr-custody.read` prompt is the exact generic string
  // "Account access was denied." (home-v2-app-bridge.ts) - it never
  // mentions "custody" or "ARRR". The matcher must key off that real
  // string (or a PERMISSION_DENIED code), not a "custody"+"denied"
  // keyword combo that real message would never satisfy.
  it('sets consentDenied and stops auto-retrying on Home\'s real denial message ("Account access was denied.")', async () => {
    qdnRequestMock.mockRejectedValue({
      message: 'Account access was denied.',
    });
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();

    expect(result.current.consentDenied).toBe(true);
    act(() => notifyArrrWalletSessionChanged());
    setDocumentHidden(true);
    setDocumentHidden(false);
    const callsAfterDenial = qdnRequestMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS * 2);
    });
    // No auto-retry after a consent denial - the count must not grow.
    expect(qdnRequestMock.mock.calls.length).toBe(callsAfterDenial);
    expect(result.current.loading).toBe(false);
  });

  it('also treats a PERMISSION_DENIED code as denial', async () => {
    qdnRequestMock.mockRejectedValue({
      code: 'PERMISSION_DENIED',
      message: 'denied',
    });
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    expect(result.current.consentDenied).toBe(true);
  });

  it('treats an unrelated transient error mentioning "custody"/"rejected" as a normal retryable failure, NOT a denial', async () => {
    qdnRequestMock.mockRejectedValue({
      code: 'SOME_TRANSIENT_ERROR',
      message: 'custody read temporarily rejected - Core is still starting up',
    });
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();

    // Not treated as a denial - it keeps auto-retrying like any other
    // transient error, and never freezes.
    expect(result.current.consentDenied).toBe(false);
    expect(result.current.error?.message).toContain('custody read');
    const callsSoFar = qdnRequestMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_ACTIVE_MS);
    });
    expect(qdnRequestMock.mock.calls.length).toBeGreaterThan(callsSoFar);
  });

  it('refresh() re-polls immediately, e.g. after a consent denial', async () => {
    qdnRequestMock.mockRejectedValueOnce({
      message: 'Account access was denied.',
    });
    const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
    await flush();
    expect(result.current.consentDenied).toBe(true);

    qdnRequestMock.mockResolvedValueOnce(readySnapshot);
    act(() => {
      result.current.refresh();
    });
    await flush();
    expect(result.current.snapshot?.state).toBe('READY');
    expect(result.current.consentDenied).toBe(false);
  });

  it('resets to a fresh snapshot/revision when resetKey (the selected account) changes', async () => {
    qdnRequestMock.mockResolvedValue(readySnapshot);
    const { result, rerender } = renderHook(
      ({ resetKey }) => useArrrSyncStatus(true, resetKey),
      { initialProps: { resetKey: 'acct-a' } }
    );
    await flush();
    expect(result.current.snapshot).not.toBeNull();

    rerender({ resetKey: 'acct-b' });
    // Snapshot is cleared synchronously on the account switch, before the
    // fresh poll for the new account resolves.
    expect(result.current.snapshot).toBeNull();
    await flush();
    expect(result.current.snapshot).not.toBeNull();
  });

  // Owner-reported 2026-09-27: switching ARRR account A -> B flashed "Your
  // Core is busy with another ARRR wallet" although the switch succeeded.
  // With the session contract already reporting relation SELF, a busy
  // read is Core still starting this account's wallet - a neutral
  // "switching" condition, never an error and never the cross-wallet cap.
  describe('owner-confirmed busy (account switch)', () => {
    const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };

    it('reports switching (no error) past the 6-attempt cap and settles on the first non-busy status', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      const { result } = renderHook(() =>
        useArrrSyncStatus(true, 'acct-b:rev-2', false, true)
      );
      await flush();
      // The very first busy reply already flags the neutral condition.
      expect(result.current.switching).toBe(true);
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();

      for (let i = 0; i < ARRR_BUSY_MAX_ATTEMPTS + 2; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
        });
      }
      expect(qdnRequestMock.mock.calls.length).toBeGreaterThan(
        ARRR_BUSY_MAX_ATTEMPTS
      );
      expect(result.current.switching).toBe(true);
      expect(result.current.switchingStalled).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.consentDenied).toBe(false);

      qdnRequestMock.mockResolvedValue(syncingSnapshot);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
      });
      expect(result.current.snapshot?.state).toBe('SYNCHRONIZING');
      expect(result.current.switching).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('goes to a neutral stalled state (no error, no auto-poll) after the ceiling, and refresh() re-polls', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      const { result } = renderHook(() =>
        useArrrSyncStatus(true, 'acct-b:rev-2', false, true)
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          ARRR_OWNER_BUSY_CEILING_MS + ARRR_BUSY_RETRY_DELAY_MS
        );
      });
      expect(result.current.switchingStalled).toBe(true);
      expect(result.current.switching).toBe(false);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();

      const callsAtStall = qdnRequestMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS);
      });
      expect(qdnRequestMock.mock.calls.length).toBe(callsAtStall);

      qdnRequestMock.mockResolvedValue(readySnapshot);
      act(() => {
        result.current.refresh();
      });
      await flush();
      expect(result.current.switchingStalled).toBe(false);
      expect(result.current.snapshot?.state).toBe('READY');
    });

    it('keeps the cross-wallet busy error (attempt cap) when the owner is NOT confirmed', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      const { result } = renderHook(() =>
        useArrrSyncStatus(true, 'acct-a', false, false)
      );
      for (let i = 0; i < ARRR_BUSY_MAX_ATTEMPTS; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
        });
      }
      await flush();
      expect(result.current.error?.code).toBe('ARRR_WALLET_BUSY');
      expect(result.current.switching).toBe(false);
      expect(result.current.switchingStalled).toBe(false);
    });

    it('never surfaces ARRR_WALLET_NOT_ACTIVE while owner-confirmed - it re-reads the session instead', async () => {
      const notActive = {
        code: 'ARRR_WALLET_NOT_ACTIVE',
        message: 'This account is not the active ARRR wallet on your Core.',
      };
      qdnRequestMock.mockRejectedValue(notActive);
      const sessionChanged = vi.fn();
      window.addEventListener('arrrWalletSessionChanged', sessionChanged);
      const { result } = renderHook(() =>
        useArrrSyncStatus(true, 'acct-a:rev-1', false, true)
      );
      await flush();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
      expect(sessionChanged).toHaveBeenCalledTimes(1);
      window.removeEventListener('arrrWalletSessionChanged', sessionChanged);
    });
  });

  // A previous owner's instance (another visible Wallet tab, or the grid)
  // may have a stale read error from before the switch; the switch
  // broadcast must clear it immediately rather than leave red text until
  // that instance's next poll.
  describe('stale error after an ARRR session change', () => {
    it('clears a read error on the broadcast in every mounted instance, then re-polls after the settle delay', async () => {
      qdnRequestMock.mockRejectedValue({
        code: 'ARRR_WALLET_NOT_ACTIVE',
        message: 'This account is not the active ARRR wallet on your Core.',
      });
      // Instance A = the old owner's page, not owner-confirmed any more
      // (its session already flipped) but still holding the stale error;
      // instance B = a second view of the same account (the list row).
      const a = renderHook(() => useArrrSyncStatus(true, 'acct-a:rev-1'));
      const b = renderHook(() => useArrrSyncStatus(true, 'acct-a:rev-1', true));
      await flush();
      expect(a.result.current.error?.code).toBe('ARRR_WALLET_NOT_ACTIVE');
      expect(b.result.current.error?.code).toBe('ARRR_WALLET_NOT_ACTIVE');
      const callsBefore = qdnRequestMock.mock.calls.length;

      act(() => notifyArrrWalletSessionChanged());
      expect(a.result.current.error).toBeNull();
      expect(b.result.current.error).toBeNull();
      expect(a.result.current.loading).toBe(true);
      expect(b.result.current.loading).toBe(true);
      // No immediate re-read of the stale key - the session hook settles
      // first; the fallback re-poll fires after one session interval.
      await flush();
      expect(qdnRequestMock.mock.calls.length).toBe(callsBefore);
      qdnRequestMock.mockResolvedValue(readySnapshot);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_SESSION_SETTLE_MS);
      });
      expect(qdnRequestMock.mock.calls.length).toBe(callsBefore + 2);
      expect(a.result.current.snapshot?.state).toBe('READY');
      expect(b.result.current.snapshot?.state).toBe('READY');
      a.unmount();
      b.unmount();
    });

    it('does not reopen a declined custody prompt on the broadcast', async () => {
      qdnRequestMock.mockRejectedValue({
        message: 'Account access was denied.',
      });
      const { result } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
      await flush();
      expect(result.current.consentDenied).toBe(true);
      act(() => notifyArrrWalletSessionChanged());
      expect(result.current.consentDenied).toBe(true);
    });
  });

  // Codex round 5 review finding 4: a busy-retry loop already in flight
  // must not fire another bridge call once nobody cares anymore.
  describe('cancellable busy retry (finding 4)', () => {
    const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };

    it('makes no further bridge call after unmount, mid busy-retry delay', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      const { unmount } = renderHook(() => useArrrSyncStatus(true, 'acct-a'));
      await flush();
      const callsBeforeUnmount = qdnRequestMock.mock.calls.length;
      expect(callsBeforeUnmount).toBeGreaterThan(0);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS * 3);
      });
      expect(qdnRequestMock.mock.calls.length).toBe(callsBeforeUnmount);
    });

    it('makes no further bridge call after an account switch, mid busy-retry delay', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      const { rerender } = renderHook(
        ({ resetKey }) => useArrrSyncStatus(true, resetKey),
        { initialProps: { resetKey: 'acct-a' } }
      );
      await flush();
      const callsBeforeSwitch = qdnRequestMock.mock.calls.length;
      expect(callsBeforeSwitch).toBeGreaterThan(0);

      // Switching resets the hook's own revision, which already prevents
      // the OLD closure's retry loop from acting on a stale result - the
      // assertion here is that no additional bridge call attributable to
      // the old loop happens once the delay elapses.
      rerender({ resetKey: 'acct-b' });
      const callsRightAfterSwitch = qdnRequestMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
      });
      // Any new calls must be the NEW account's own fresh poll (also
      // rejecting with the same busy error here), not a second call from
      // the old loop still trying the old account.
      expect(qdnRequestMock.mock.calls.length).toBeGreaterThanOrEqual(
        callsRightAfterSwitch
      );
      // The old loop's own busy-retry timer (10s) must never fire a call
      // beyond the fresh poll the switch itself triggers.
      const callsAfterOneNewCycle = qdnRequestMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(qdnRequestMock.mock.calls.length).toBe(callsAfterOneNewCycle);
    });

    it('makes no further bridge call while hidden, mid busy-retry delay, and resumes once visible', async () => {
      qdnRequestMock.mockRejectedValue(busyError);
      renderHook(() => useArrrSyncStatus(true, 'acct-a'));
      await flush();
      const callsBeforeHidden = qdnRequestMock.mock.calls.length;
      expect(callsBeforeHidden).toBeGreaterThan(0);

      setDocumentHidden(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS * 3);
      });
      expect(qdnRequestMock.mock.calls.length).toBe(callsBeforeHidden);

      qdnRequestMock.mockResolvedValueOnce(readySnapshot);
      setDocumentHidden(false);
      await flush();
      expect(qdnRequestMock.mock.calls.length).toBeGreaterThan(
        callsBeforeHidden
      );
    });
  });
});
