// ARRR structured sync-status contract (round 5) - see design section 2/3 in
// projects/wallet-review and the `GET_ARRR_SYNC_STATUS` row of qortium-home's
// HOME_V2_BRIDGE_COMPATIBILITY.md. This module is the single source of
// truth for parsing that snapshot, deciding how often to poll it per state,
// and retrying a read that's rejected because another account's ARRR
// wallet is currently active on the trusted Core.

import { TIME_MINUTES_3, TIME_SECONDS_10, TIME_SECONDS_15 } from './constants';
import {
  ARRR_READ_CANCELLED_CODE,
  describeBridgeError,
  isArrrWalletBusyError,
} from './bridgeErrors';
import { formatAtomicAmount } from '../utils/walletSend';

// ARRR always has 8 decimal places (see config/chains.ts's KNOWN_CHAINS
// entry) - fixed here rather than threaded through as a parameter, since
// every ARRR-specific formatter in this module only ever needs this one
// value.
const ARRR_DECIMAL_PLACES = 8;

export type ArrrSyncState =
  | 'DISABLED'
  | 'LOADING'
  | 'SYNCHRONIZING'
  | 'DEGRADED'
  | 'READY';

export interface ArrrLastError {
  code: string;
  message: string;
}

export interface ArrrSyncSnapshot {
  contract: string;
  coin: 'ARRR';
  state: ArrrSyncState;
  // Home's own verdict (state === READY && !stale && !restartRequired) -
  // gate balances/history on THIS, never on `state` alone (host contract).
  ready: boolean;
  message: string | null;
  syncedBlocks: number | null;
  totalBlocks: number | null;
  restartRequired: boolean;
  recoveryState: string | null;
  scannedHeight: number | null;
  tipHeight: number | null;
  totalBalanceAtomic: string | null;
  verifiedBalanceAtomic: string | null;
  observedAt: number;
  stale: boolean;
  backendMode: string | null;
  walletIdentityHash: string | null;
  lastError: ArrrLastError | null;
}

const VALID_STATES = new Set<ArrrSyncState>([
  'DISABLED',
  'LOADING',
  'SYNCHRONIZING',
  'DEGRADED',
  'READY',
]);

function nonNegIntOrNull(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function decimalStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
    ? value
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Defensively parses Core's `GET_ARRR_SYNC_STATUS` response into a typed
 * snapshot. Returns null for a response the UI cannot trust at all (unknown
 * state, a negative/non-integer counter, a non-decimal balance string, or a
 * malformed `lastError`) - callers should treat that exactly like a thrown
 * bridge error (Core's own validation calls this ARRR_SYNC_STATUS_MALFORMED)
 * and never render partial/guessed data.
 */
export function parseArrrSyncSnapshot(raw: unknown): ArrrSyncSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const state = r.state;
  if (typeof state !== 'string' || !VALID_STATES.has(state as ArrrSyncState))
    return null;
  if (typeof r.ready !== 'boolean') return null;
  if (typeof r.observedAt !== 'number' || !Number.isFinite(r.observedAt))
    return null;
  if (typeof r.stale !== 'boolean') return null;
  if (typeof r.restartRequired !== 'boolean') return null;

  let lastError: ArrrLastError | null = null;
  if (r.lastError != null) {
    const le = r.lastError as Record<string, unknown>;
    if (
      typeof r.lastError !== 'object' ||
      typeof le.code !== 'string' ||
      typeof le.message !== 'string'
    ) {
      return null;
    }
    lastError = { code: le.code, message: le.message };
  }

  const syncedBlocks = nonNegIntOrNull(r.syncedBlocks);
  if (r.syncedBlocks != null && syncedBlocks == null) return null;
  const totalBlocks = nonNegIntOrNull(r.totalBlocks);
  if (r.totalBlocks != null && totalBlocks == null) return null;
  const scannedHeight = nonNegIntOrNull(r.scannedHeight);
  if (r.scannedHeight != null && scannedHeight == null) return null;
  const tipHeight = nonNegIntOrNull(r.tipHeight);
  if (r.tipHeight != null && tipHeight == null) return null;

  const totalBalanceAtomic =
    r.totalBalanceAtomic == null
      ? null
      : decimalStringOrNull(r.totalBalanceAtomic);
  if (r.totalBalanceAtomic != null && totalBalanceAtomic == null) return null;
  const verifiedBalanceAtomic =
    r.verifiedBalanceAtomic == null
      ? null
      : decimalStringOrNull(r.verifiedBalanceAtomic);
  if (r.verifiedBalanceAtomic != null && verifiedBalanceAtomic == null)
    return null;

  return {
    contract: stringOrNull(r.contract) ?? '',
    coin: 'ARRR',
    state: state as ArrrSyncState,
    ready: r.ready === true,
    message: stringOrNull(r.message),
    syncedBlocks,
    totalBlocks,
    restartRequired: r.restartRequired === true,
    recoveryState: stringOrNull(r.recoveryState),
    scannedHeight,
    tipHeight,
    totalBalanceAtomic,
    verifiedBalanceAtomic,
    observedAt: r.observedAt,
    stale: r.stale === true,
    backendMode: stringOrNull(r.backendMode),
    walletIdentityHash: stringOrNull(r.walletIdentityHash),
    lastError,
  };
}

// Host contract polling cadence: every 15s while the state is actively
// progressing or recovering, every 3 min once READY (or DISABLED, which
// needs operator action to ever change).
export const ARRR_POLL_ACTIVE_MS = TIME_SECONDS_15;
export const ARRR_POLL_SETTLED_MS = TIME_MINUTES_3;

export function arrrPollDelayMs(state: ArrrSyncState): number {
  return state === 'READY' || state === 'DISABLED'
    ? ARRR_POLL_SETTLED_MS
    : ARRR_POLL_ACTIVE_MS;
}

export const ARRR_BUSY_MAX_ATTEMPTS = 6;
export const ARRR_BUSY_RETRY_DELAY_MS = TIME_SECONDS_10;

/** Thrown by requestWithArrrBusyRetry when `shouldAbort` fires - a cancelled ARRR read, never a real Core rejection. */
export interface ArrrReadCancelledError {
  code: typeof ARRR_READ_CANCELLED_CODE;
  message: string;
  retryable: false;
}

function arrrReadCancelledError(): ArrrReadCancelledError {
  return {
    code: ARRR_READ_CANCELLED_CODE,
    message: 'ARRR read cancelled.',
    retryable: false,
  };
}

/**
 * Retries `request` while it keeps failing with ARRR_WALLET_BUSY (another
 * account's ARRR wallet is active on the trusted Core), waiting `delayMs`
 * between attempts, up to `maxAttempts` total tries - then rethrows the
 * last error so the caller falls back to a manual retry (host contract:
 * "automatic retry after 10s (max 6) then a manual retry"). Any other
 * error, or a non-busy rejection, rethrows immediately without waiting.
 *
 * `shouldAbort`, when given, is checked before the first attempt and again
 * immediately after every busy-retry delay - a delay is otherwise
 * uncancellable (a bare setTimeout keeps counting down and would still
 * fire another bridge call after the caller stopped caring: unmount,
 * account/route switch, or the tab going hidden - Codex round 5 review
 * finding 4). When it returns true, the pending delay's bridge call is
 * skipped entirely and this rejects with `ArrrReadCancelledError` instead.
 */
export async function requestWithArrrBusyRetry<T>(
  request: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    onBusyAttempt?: (attempt: number) => void;
    shouldAbort?: () => boolean;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? ARRR_BUSY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? ARRR_BUSY_RETRY_DELAY_MS;
  const shouldAbort = options.shouldAbort;
  let attempt = 0;
  for (;;) {
    if (shouldAbort?.()) throw arrrReadCancelledError();
    try {
      return await request();
    } catch (err) {
      attempt++;
      const decoded = describeBridgeError(err);
      if (!isArrrWalletBusyError(decoded) || attempt >= maxAttempts) {
        throw err;
      }
      options.onBusyAttempt?.(attempt);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      if (shouldAbort?.()) throw arrrReadCancelledError();
    }
  }
}

/**
 * Formats a raw ARRR ATOMIC decimal-integer string (exactly what
 * GET_WALLET_BALANCE returns - satoshi-equivalent units, 8 decimal places)
 * into an exact whole-unit display string, e.g. "140000000" -> "1.40000000".
 *
 * Pure string decimal-point insertion (delegated to the existing
 * `formatAtomicAmount` in walletSend.ts) - never `Number()`/`parseFloat()`,
 * which silently loses precision for atomic values above 2^53 (Codex round
 * 5 review finding 2: a real ARRR balance can exceed that well before it
 * exceeds any sane coin-unit amount, since 8 decimal places multiplies the
 * threshold down to about 90 million whole ARRR). Never coerces null or a
 * malformed value into "0" - callers must keep those as null.
 */
export function formatArrrAmount(atomic: string | null): string | null {
  if (atomic == null) return null;
  const trimmed = atomic.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const formatted = formatAtomicAmount(trimmed, ARRR_DECIMAL_PLACES);
  return formatted === '—' ? null : formatted;
}
