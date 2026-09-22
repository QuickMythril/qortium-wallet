// Shared tracker + single poller for just-accepted native QORT sends that
// haven't confirmed yet (round 2, item A; moved out of CoinDetail per
// review finding 2).
//
// CoinDetail previously owned both the pending row and its confirmation
// poll as local component state/effects. Since Routes.tsx swaps CoinDetail
// out for CoinGrid on navigation, leaving the coin page stopped tracking
// entirely - the poll never fired, and reopening the page later showed no
// pending row even though the send was still unconfirmed. Tracking now
// lives here, in a plain module, with one poller that runs as long as
// *any* subscriber (CoinGrid or CoinDetail) is mounted, so navigating
// between them never interrupts confirmation tracking.
//
// Entries are keyed by (account, chain.key, txHash) so switching Home
// accounts can never show one account's pending send under another (see
// clearPendingSends(), called from AppLayout's SELECTED_ACCOUNT_CHANGED
// handler alongside balanceCache's clearBalanceCache()).

import type { ChainConfig } from '../config/chains';
import {
  requestQortBalance,
  requestQortTransactions,
  requestWalletForChain,
} from './walletBridge';
import { invalidateCachedBalance, setCachedBalance } from './balanceCache';
import { TIME_MINUTES_30, TIME_SECONDS_15 } from './constants';

export const PENDING_SEND_POLL_MS = TIME_SECONDS_15;
export const PENDING_SEND_TIMEOUT_MS = TIME_MINUTES_30;

export interface PendingSendEntry {
  account: string;
  chain: ChainConfig;
  txHash: string;
  totalAmount: number;
  recipient: string;
  sender?: string;
  createdAt: number;
  /** Absolute wall-clock deadline (createdAt + 30 min) - checked every tick and on visibility resume, never an active-poll counter. */
  expiresAt: number;
  timedOut: boolean;
}

type EntriesListener = () => void;
type ConfirmListener = (
  account: string,
  chainKey: string,
  txHash: string
) => void;

const entries = new Map<string, PendingSendEntry>();
const entryListeners = new Set<EntriesListener>();
const confirmListeners = new Set<ConfirmListener>();

/** Normalizes a possibly-null Home account address to a stable cache-key component - exported so callers can match it exactly (e.g. comparing a confirm-listener's account against their own). */
export function accountKey(account: string | null | undefined): string {
  return account && account.trim() !== '' ? account : '(no-account)';
}

function entryKey(
  account: string | null | undefined,
  chainKey: string,
  txHash: string
): string {
  return `${accountKey(account)}::${chainKey}::${txHash}`;
}

function notifyEntries(): void {
  entryListeners.forEach((listener) => listener());
}

export function addPendingSend(input: {
  account: string | null | undefined;
  chain: ChainConfig;
  txHash: string;
  totalAmount: number;
  recipient: string;
  sender?: string;
}): void {
  const createdAt = Date.now();
  const entry: PendingSendEntry = {
    account: accountKey(input.account),
    chain: input.chain,
    txHash: input.txHash,
    totalAmount: input.totalAmount,
    recipient: input.recipient,
    sender: input.sender,
    createdAt,
    expiresAt: createdAt + PENDING_SEND_TIMEOUT_MS,
    timedOut: false,
  };
  entries.set(entryKey(input.account, input.chain.key, input.txHash), entry);
  notifyEntries();
}

/** All pending entries (confirmed ones already removed; timed-out ones stay, flagged) for one account+chain, oldest first. */
export function getPendingSendsForChain(
  account: string | null | undefined,
  chainKey: string
): PendingSendEntry[] {
  const prefix = `${accountKey(account)}::${chainKey}::`;
  return Array.from(entries.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Fires whenever any entry is added, removed (confirmed), or flagged timed-out. */
export function subscribePendingSends(listener: EntriesListener): () => void {
  entryListeners.add(listener);
  return () => entryListeners.delete(listener);
}

/** Fires exactly once per entry, the moment it's confirmed (so a mounted CoinDetail can refetch its history). */
export function subscribePendingSendConfirmed(
  listener: ConfirmListener
): () => void {
  confirmListeners.add(listener);
  return () => confirmListeners.delete(listener);
}

/**
 * Drop every tracked pending send, for every account/chain. Called from
 * AppLayout's SELECTED_ACCOUNT_CHANGED handler - a pending send tracked
 * under the previous account should not keep polling or rendering under
 * the newly-selected one.
 */
export function clearPendingSends(): void {
  if (entries.size === 0) return;
  entries.clear();
  notifyEntries();
}

// ---- shared poller ----------------------------------------------------

let pollerId: ReturnType<typeof setInterval> | null = null;
let mountedSubscribers = 0;
let visibilityListenerAttached = false;

function attachVisibilityListenerOnce(): void {
  if (visibilityListenerAttached || typeof document === 'undefined') return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void tick();
  });
}

function startPoller(): void {
  attachVisibilityListenerOnce();
  if (pollerId != null) return;
  pollerId = setInterval(() => void tick(), PENDING_SEND_POLL_MS);
}

function stopPoller(): void {
  if (pollerId != null) {
    clearInterval(pollerId);
    pollerId = null;
  }
}

/**
 * Called from a mount effect in CoinGrid and CoinDetail. The shared poller
 * runs as long as at least one of them is mounted - navigating from the
 * coin page to the grid (or back) never stops confirmation tracking.
 */
export function registerPendingSendsSubscriber(): () => void {
  mountedSubscribers++;
  startPoller();
  return () => {
    mountedSubscribers = Math.max(0, mountedSubscribers - 1);
    if (mountedSubscribers === 0) stopPoller();
  };
}

async function tick(): Promise<void> {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (entries.size === 0) return;

  const now = Date.now();
  const snapshot = Array.from(entries.values());

  for (const entry of snapshot) {
    if (entry.timedOut) continue;
    const key = entryKey(entry.account, entry.chain.key, entry.txHash);
    const current = entries.get(key);
    if (!current) continue; // removed (confirmed elsewhere) since the snapshot was taken

    if (now >= entry.expiresAt) {
      entries.set(key, { ...current, timedOut: true });
      notifyEntries();
      continue;
    }

    try {
      const wallet = await requestWalletForChain(entry.chain);
      const addr = wallet?.address;
      if (!addr) continue;
      const res = await requestQortTransactions(addr, {
        txType: ['PAYMENT'],
        confirmationStatus: 'BOTH',
        limit: 20,
        reverse: true,
      } as any);
      const data: any[] = Array.isArray(res) ? res : [];
      const match = data.find((tx) => tx && tx.signature === entry.txHash);
      if (match && match.blockHeight != null) {
        if (!entries.has(key)) continue; // already handled by a concurrent tick
        entries.delete(key);
        notifyEntries();

        // Refresh the balance once through the shared cache (item B) -
        // never leave a stale pre-confirmation value cached.
        if (entry.chain.isNative) {
          try {
            const balRes = await requestQortBalance();
            setCachedBalance(entry.account, entry.chain.key, {
              balance: String(parseFloat(String(balRes ?? 0))),
            });
          } catch {
            invalidateCachedBalance(entry.account, entry.chain.key);
          }
        }

        confirmListeners.forEach((listener) =>
          listener(entry.account, entry.chain.key, entry.txHash)
        );
      }
    } catch {
      /* a transient lookup failure shouldn't cancel confirmation tracking - retry next tick */
    }
  }
}

/** Test-only: run one poll pass synchronously without waiting for the interval. */
export async function __tickPendingSendsForTests(): Promise<void> {
  await tick();
}

/** Test-only: full reset between test cases. */
export function __resetPendingSendsForTests(): void {
  entries.clear();
  entryListeners.clear();
  confirmListeners.clear();
  stopPoller();
  mountedSubscribers = 0;
}
