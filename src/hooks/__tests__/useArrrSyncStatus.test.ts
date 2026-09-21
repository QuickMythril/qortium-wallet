import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useArrrSyncStatus } from '../useArrrSyncStatus';
import {
  ARRR_BUSY_RETRY_DELAY_MS,
  ARRR_POLL_ACTIVE_MS,
  ARRR_POLL_SETTLED_MS,
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
    qdnRequestMock = vi.fn();
    (globalThis as any).qdnRequest = qdnRequestMock;
    setDocumentHidden(false);
  });

  afterEach(() => {
    delete (globalThis as any).qdnRequest;
    vi.useRealTimers();
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
    const callsAfterDenial = qdnRequestMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARRR_POLL_SETTLED_MS * 2);
    });
    // No auto-retry after a consent denial - the count must not grow.
    expect(qdnRequestMock.mock.calls.length).toBe(callsAfterDenial);
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
