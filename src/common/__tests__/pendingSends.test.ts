import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { ChainConfig } from '../../config/chains';
import { __resetBalanceCacheForTests, getCachedBalance } from '../balanceCache';

vi.mock('../walletBridge', () => ({
  requestWalletForChain: vi.fn(),
  requestQortTransactions: vi.fn(),
  requestQortBalance: vi.fn(),
}));

import {
  requestQortBalance,
  requestQortTransactions,
  requestWalletForChain,
} from '../walletBridge';
import {
  PENDING_SEND_POLL_MS,
  PENDING_SEND_TIMEOUT_MS,
  accountKey,
  addPendingSend,
  clearPendingSends,
  getPendingSendsForChain,
  registerPendingSendsSubscriber,
  subscribePendingSendConfirmed,
  subscribePendingSends,
  __resetPendingSendsForTests,
  __tickPendingSendsForTests,
} from '../pendingSends';

const qortChain: ChainConfig = {
  key: 'QORT',
  name: 'Qortal',
  ticker: 'QORT',
  coinEnum: 'QORT',
  route: 'qort',
  defaultFee: 0.001,
  isNative: true,
  decimalPlaces: 8,
  activeNetwork: 'MAIN',
  supportsHtlc: false,
  supportsLocalChainTrades: false,
};

const requestWalletForChainMock = vi.mocked(requestWalletForChain);
const requestQortTransactionsMock = vi.mocked(requestQortTransactions);
const requestQortBalanceMock = vi.mocked(requestQortBalance);

beforeEach(() => {
  __resetPendingSendsForTests();
  __resetBalanceCacheForTests();
  requestWalletForChainMock.mockReset();
  requestQortTransactionsMock.mockReset();
  requestQortBalanceMock.mockReset();
  requestWalletForChainMock.mockResolvedValue({ address: 'qort-address' });
  requestQortTransactionsMock.mockResolvedValue([]);
  requestQortBalanceMock.mockResolvedValue('0');
});

afterEach(() => {
  vi.useRealTimers();
  __resetPendingSendsForTests();
  __resetBalanceCacheForTests();
});

describe('pendingSends', () => {
  it('tracks an entry and returns it from getPendingSendsForChain', () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    const rows = getPendingSendsForChain('acct-a', 'QORT');
    expect(rows).toHaveLength(1);
    expect(rows[0].txHash).toBe('sig-1');
    expect(rows[0].timedOut).toBe(false);
  });

  it('isolates entries per account - the same chain under a different account is empty', () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    expect(getPendingSendsForChain('acct-b', 'QORT')).toHaveLength(0);
    expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(1);
  });

  it('accountKey normalizes null/empty accounts to the same bucket', () => {
    expect(accountKey(null)).toBe(accountKey(undefined));
    expect(accountKey('')).toBe(accountKey(null));
    expect(accountKey('acct-a')).not.toBe(accountKey(null));
  });

  it('notifies subscribePendingSends listeners on add and on clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingSends(listener);
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    expect(listener).toHaveBeenCalledTimes(1);
    clearPendingSends();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(0);
    unsubscribe();
  });

  it('clearPendingSends on an already-empty tracker is a no-op (no notification)', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingSends(listener);
    clearPendingSends();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('a tick that finds a matching confirmed transaction (blockHeight present) removes the entry, refreshes the cached balance once, and fires the confirm listener', async () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    requestQortTransactionsMock.mockResolvedValue([
      { signature: 'sig-1', blockHeight: 500 },
    ]);
    requestQortBalanceMock.mockResolvedValue('42.5');

    const confirmListener = vi.fn();
    const unsubscribe = subscribePendingSendConfirmed(confirmListener);

    await __tickPendingSendsForTests();

    expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(0);
    expect(confirmListener).toHaveBeenCalledWith('acct-a', 'QORT', 'sig-1');
    expect(getCachedBalance('acct-a', 'QORT')?.balance).toBe('42.5');
    unsubscribe();
  });

  it('a tick that finds no matching confirmed transaction leaves the entry pending', async () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    requestQortTransactionsMock.mockResolvedValue([
      { signature: 'sig-1' /* no blockHeight yet */ },
    ]);

    await __tickPendingSendsForTests();

    const rows = getPendingSendsForChain('acct-a', 'QORT');
    expect(rows).toHaveLength(1);
    expect(rows[0].timedOut).toBe(false);
  });

  it('a transient lookup failure during a tick does not drop the entry', async () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    requestQortTransactionsMock.mockRejectedValue(new Error('network blip'));

    await __tickPendingSendsForTests();

    expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(1);
  });

  it('flags an entry timed-out once its absolute (wall-clock) expiry has passed, without needing 120 active poll attempts', async () => {
    vi.useFakeTimers();
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    vi.advanceTimersByTime(PENDING_SEND_TIMEOUT_MS + 1);

    await __tickPendingSendsForTests();

    const rows = getPendingSendsForChain('acct-a', 'QORT');
    expect(rows).toHaveLength(1);
    expect(rows[0].timedOut).toBe(true);
    // Never looked up a confirmation for an already-expired entry.
    expect(requestWalletForChainMock).not.toHaveBeenCalled();
  });

  it('a document-hidden tick is a complete no-op (no bridge calls)', async () => {
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    const originalHidden = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'hidden'
    );
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    try {
      await __tickPendingSendsForTests();
      expect(requestWalletForChainMock).not.toHaveBeenCalled();
      expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(1);
    } finally {
      if (originalHidden) {
        Object.defineProperty(document, 'hidden', originalHidden);
      }
    }
  });

  it('the shared poller runs automatically every 15s while a subscriber is registered, and stops once unregistered', async () => {
    vi.useFakeTimers();
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    requestQortTransactionsMock.mockResolvedValue([
      { signature: 'sig-1', blockHeight: 500 },
    ]);

    const unregister = registerPendingSendsSubscriber();
    await vi.advanceTimersByTimeAsync(PENDING_SEND_POLL_MS);
    expect(getPendingSendsForChain('acct-a', 'QORT')).toHaveLength(0);

    unregister();
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-2',
      totalAmount: -50,
      recipient: 'recipient-2',
    });
    requestQortTransactionsMock.mockClear();
    await vi.advanceTimersByTimeAsync(PENDING_SEND_POLL_MS * 2);
    // No subscriber left mounted - the poller must not still be running.
    expect(requestQortTransactionsMock).not.toHaveBeenCalled();
  });

  it('two subscribers keep the poller alive until both unregister', async () => {
    vi.useFakeTimers();
    addPendingSend({
      account: 'acct-a',
      chain: qortChain,
      txHash: 'sig-1',
      totalAmount: -100,
      recipient: 'recipient-1',
    });
    requestQortTransactionsMock.mockResolvedValue([]);

    const unregisterA = registerPendingSendsSubscriber();
    const unregisterB = registerPendingSendsSubscriber();
    unregisterA();

    requestQortTransactionsMock.mockClear();
    await vi.advanceTimersByTimeAsync(PENDING_SEND_POLL_MS);
    expect(requestQortTransactionsMock).toHaveBeenCalled();

    unregisterB();
    requestQortTransactionsMock.mockClear();
    await vi.advanceTimersByTimeAsync(PENDING_SEND_POLL_MS * 2);
    expect(requestQortTransactionsMock).not.toHaveBeenCalled();
  });
});
