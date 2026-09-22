import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ARRR_BUSY_MAX_ATTEMPTS,
  ARRR_BUSY_RETRY_DELAY_MS,
  ARRR_POLL_ACTIVE_MS,
  ARRR_POLL_SETTLED_MS,
  arrrPollDelayMs,
  formatArrrAmount,
  parseArrrSyncSnapshot,
  requestWithArrrBusyRetry,
} from '../arrrSync';

const validSnapshot = {
  contract: 'qortium-home-arrr-custody-v1',
  coin: 'ARRR',
  state: 'READY',
  ready: true,
  message: 'Synchronized',
  syncedBlocks: 100,
  totalBlocks: 100,
  restartRequired: false,
  recoveryState: null,
  scannedHeight: 3000000,
  tipHeight: 3000000,
  totalBalanceAtomic: '150000000',
  verifiedBalanceAtomic: '140000000',
  observedAt: 1700000000000,
  stale: false,
  backendMode: 'unified',
  walletIdentityHash: 'abc123',
  lastError: null,
};

describe('parseArrrSyncSnapshot', () => {
  it('parses a fully-populated valid snapshot', () => {
    const parsed = parseArrrSyncSnapshot(validSnapshot);
    expect(parsed).toEqual(validSnapshot);
  });

  it('parses a minimal snapshot with every optional field null', () => {
    const minimal = {
      contract: 'qortium-home-arrr-custody-v1',
      coin: 'ARRR',
      state: 'LOADING',
      ready: false,
      message: null,
      syncedBlocks: null,
      totalBlocks: null,
      restartRequired: false,
      recoveryState: null,
      scannedHeight: null,
      tipHeight: null,
      totalBalanceAtomic: null,
      verifiedBalanceAtomic: null,
      observedAt: 1700000000000,
      stale: false,
      backendMode: null,
      walletIdentityHash: null,
      lastError: null,
    };
    expect(parseArrrSyncSnapshot(minimal)).toEqual(minimal);
  });

  it('parses a snapshot carrying a structured lastError', () => {
    const withError = {
      ...validSnapshot,
      state: 'DEGRADED',
      ready: false,
      lastError: { code: 'ARRR_SYNC_FAILED', message: 'connection lost' },
    };
    expect(parseArrrSyncSnapshot(withError)?.lastError).toEqual({
      code: 'ARRR_SYNC_FAILED',
      message: 'connection lost',
    });
  });

  it.each([
    ['not an object', 'raw string'],
    ['null', null],
    ['unknown state', { ...validSnapshot, state: 'SOMETHING_ELSE' }],
    ['missing ready', { ...validSnapshot, ready: undefined }],
    ['non-boolean ready', { ...validSnapshot, ready: 'yes' }],
    ['missing observedAt', { ...validSnapshot, observedAt: undefined }],
    ['missing stale', { ...validSnapshot, stale: undefined }],
    [
      'missing restartRequired',
      { ...validSnapshot, restartRequired: undefined },
    ],
    [
      'negative syncedBlocks',
      { ...validSnapshot, syncedBlocks: -1, totalBlocks: 100 },
    ],
    [
      'non-integer totalBlocks',
      { ...validSnapshot, syncedBlocks: 1, totalBlocks: 1.5 },
    ],
    ['negative scannedHeight', { ...validSnapshot, scannedHeight: -5 }],
    [
      'non-decimal totalBalanceAtomic',
      { ...validSnapshot, totalBalanceAtomic: 'not-a-number' },
    ],
    [
      'non-decimal verifiedBalanceAtomic',
      { ...validSnapshot, verifiedBalanceAtomic: '12.34.56' },
    ],
    [
      'malformed lastError (missing message)',
      { ...validSnapshot, lastError: { code: 'X' } },
    ],
    ['lastError not an object', { ...validSnapshot, lastError: 'oops' }],
  ])('returns null for %s', (_label, raw) => {
    expect(parseArrrSyncSnapshot(raw)).toBeNull();
  });
});

describe('arrrPollDelayMs', () => {
  it('uses the settled (3 min) cadence for READY and DISABLED', () => {
    expect(arrrPollDelayMs('READY')).toBe(ARRR_POLL_SETTLED_MS);
    expect(arrrPollDelayMs('DISABLED')).toBe(ARRR_POLL_SETTLED_MS);
  });

  it('uses the active (15s) cadence for LOADING, SYNCHRONIZING, and DEGRADED', () => {
    expect(arrrPollDelayMs('LOADING')).toBe(ARRR_POLL_ACTIVE_MS);
    expect(arrrPollDelayMs('SYNCHRONIZING')).toBe(ARRR_POLL_ACTIVE_MS);
    expect(arrrPollDelayMs('DEGRADED')).toBe(ARRR_POLL_ACTIVE_MS);
  });
});

describe('formatArrrAmount (round 5 review finding 2 - atomic, string-only precision)', () => {
  it('never renders null as 0', () => {
    expect(formatArrrAmount(null)).toBeNull();
  });

  it('converts a raw ATOMIC decimal-integer string to an exact 8-decimal display string', () => {
    expect(formatArrrAmount('100000000')).toBe('1.00000000');
    expect(formatArrrAmount('10000000')).toBe('0.10000000');
    expect(formatArrrAmount('1')).toBe('0.00000001');
    expect(formatArrrAmount('0')).toBe('0.00000000');
  });

  it('returns null for a non-integer (already-decimal, e.g. double-formatted) or non-numeric string rather than throwing', () => {
    expect(formatArrrAmount('not-a-number')).toBeNull();
    expect(formatArrrAmount('1.40000000')).toBeNull();
    expect(formatArrrAmount('')).toBeNull();
  });

  it('is exact for atomic values well above Number.MAX_SAFE_INTEGER (2^53), never routing through Number()', () => {
    // 2^53 = 9007199254740992. Use an atomic value with a non-trivial
    // fractional remainder far beyond that, so any float round-trip
    // (Number(x)/1e8, or Number(x).toFixed(8)) would visibly corrupt it.
    const hugeAtomic = '123456789012345678'; // ~1.23e9 ARRR
    expect(formatArrrAmount(hugeAtomic)).toBe('1234567890.12345678');

    // A value chosen so double-precision division would round the last
    // few digits (2^53 + 1 has no exact float representation).
    const boundaryAtomic = '9007199254740993'; // 2^53 + 1
    expect(formatArrrAmount(boundaryAtomic)).toBe('90071992.54740993');
  });

  it('formats a rounding-boundary fractional atomic amount exactly, with no half-up/half-even drift', () => {
    expect(formatArrrAmount('99999999')).toBe('0.99999999');
    expect(formatArrrAmount('100000001')).toBe('1.00000001');
  });
});

describe('requestWithArrrBusyRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when the request succeeds on the first try', async () => {
    const request = vi.fn().mockResolvedValue('ok');
    await expect(requestWithArrrBusyRetry(request)).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries on ARRR_WALLET_BUSY every 10s and succeeds once the wallet frees up', async () => {
    const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };
    const request = vi
      .fn()
      .mockRejectedValueOnce(busyError)
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce('ok');
    const onBusyAttempt = vi.fn();

    const promise = requestWithArrrBusyRetry(request, { onBusyAttempt });
    await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
    await expect(promise).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(3);
    expect(onBusyAttempt).toHaveBeenCalledTimes(2);
  });

  it('gives up after the busy attempt budget and rethrows the busy error', async () => {
    const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };
    const request = vi.fn().mockRejectedValue(busyError);

    const promise = requestWithArrrBusyRetry(request);
    const assertion = expect(promise).rejects.toEqual(busyError);
    for (let i = 0; i < ARRR_BUSY_MAX_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
    }
    await assertion;
    expect(request).toHaveBeenCalledTimes(ARRR_BUSY_MAX_ATTEMPTS);
  });

  it('rethrows a non-busy error immediately without waiting or retrying', async () => {
    const otherError = {
      code: 'ARRR_SYNC_CONTRACT_UNSUPPORTED',
      message: 'old core',
    };
    const request = vi.fn().mockRejectedValue(otherError);
    await expect(requestWithArrrBusyRetry(request)).rejects.toEqual(otherError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  // Codex round 5 review finding 4: a busy-retry delay is otherwise
  // uncancellable and would still fire another bridge call after the
  // caller stopped caring (unmount, account/route switch, hidden tab).
  describe('shouldAbort (finding 4 - cancellable busy retry)', () => {
    it('rejects with ARRR_READ_CANCELLED_CODE and never calls request when shouldAbort is already true', async () => {
      const request = vi.fn().mockResolvedValue('ok');
      await expect(
        requestWithArrrBusyRetry(request, { shouldAbort: () => true })
      ).rejects.toMatchObject({ code: 'ARRR_READ_CANCELLED' });
      expect(request).not.toHaveBeenCalled();
    });

    it('aborts after a busy delay instead of making the next bridge call once shouldAbort flips true mid-retry', async () => {
      const busyError = { code: 'ARRR_WALLET_BUSY', message: 'busy' };
      const request = vi.fn().mockRejectedValue(busyError);
      let aborted = false;

      const promise = requestWithArrrBusyRetry(request, {
        shouldAbort: () => aborted,
      });
      const assertion = expect(promise).rejects.toMatchObject({
        code: 'ARRR_READ_CANCELLED',
      });
      // Flip abort while the first busy delay is in flight (before the
      // second bridge call would otherwise fire).
      aborted = true;
      await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
      await assertion;
      // Exactly one call - the second attempt was skipped entirely.
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not abort a normal (non-busy) call when shouldAbort stays false', async () => {
      const request = vi.fn().mockResolvedValue('ok');
      await expect(
        requestWithArrrBusyRetry(request, { shouldAbort: () => false })
      ).resolves.toBe('ok');
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
