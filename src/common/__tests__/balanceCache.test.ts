import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  BALANCE_CACHE_TTL_MS,
  clearBalanceCache,
  getCachedBalance,
  invalidateCachedBalance,
  isBalanceCacheFresh,
  setCachedBalance,
  subscribeBalanceCache,
  __resetBalanceCacheForTests,
} from '../balanceCache';

beforeEach(() => {
  __resetBalanceCacheForTests();
  vi.useRealTimers();
});

describe('balanceCache', () => {
  it('has no entry and is never fresh before anything is cached', () => {
    expect(getCachedBalance('acct-a', 'QORT')).toBeUndefined();
    expect(isBalanceCacheFresh('acct-a', 'QORT')).toBe(false);
  });

  it('records a fetch result with a fresh timestamp', () => {
    setCachedBalance('acct-a', 'QORT', { balance: '12.5' });
    const entry = getCachedBalance('acct-a', 'QORT');
    expect(entry?.balance).toBe('12.5');
    expect(entry?.error).toBeUndefined();
    expect(isBalanceCacheFresh('acct-a', 'QORT')).toBe(true);
  });

  it('records an error alongside a null balance', () => {
    setCachedBalance('acct-a', 'BTC', { balance: null, error: 'timed out' });
    const entry = getCachedBalance('acct-a', 'BTC');
    expect(entry?.balance).toBeNull();
    expect(entry?.error).toBe('timed out');
  });

  it('reports stale once the TTL has elapsed', () => {
    vi.useFakeTimers();
    setCachedBalance('acct-a', 'QORT', { balance: '1' });
    expect(isBalanceCacheFresh('acct-a', 'QORT')).toBe(true);
    vi.advanceTimersByTime(BALANCE_CACHE_TTL_MS + 1);
    expect(isBalanceCacheFresh('acct-a', 'QORT')).toBe(false);
    vi.useRealTimers();
  });

  it('invalidate drops the entry so it is neither present nor fresh', () => {
    setCachedBalance('acct-a', 'QORT', { balance: '1' });
    invalidateCachedBalance('acct-a', 'QORT');
    expect(getCachedBalance('acct-a', 'QORT')).toBeUndefined();
    expect(isBalanceCacheFresh('acct-a', 'QORT')).toBe(false);
  });

  it('invalidating a key with no entry is a harmless no-op (no listener notification)', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceCache(listener);
    invalidateCachedBalance('acct-a', 'never-cached');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies subscribers on set and on invalidate, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceCache(listener);
    setCachedBalance('acct-a', 'QORT', { balance: '1' });
    expect(listener).toHaveBeenCalledTimes(1);
    invalidateCachedBalance('acct-a', 'QORT');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setCachedBalance('acct-a', 'QORT', { balance: '2' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('isolates entries per account - the same chain key under a different account is a separate entry', () => {
    setCachedBalance('acct-a', 'QORT', { balance: '10' });
    expect(getCachedBalance('acct-b', 'QORT')).toBeUndefined();
    expect(isBalanceCacheFresh('acct-b', 'QORT')).toBe(false);

    setCachedBalance('acct-b', 'QORT', { balance: '999' });
    expect(getCachedBalance('acct-a', 'QORT')?.balance).toBe('10');
    expect(getCachedBalance('acct-b', 'QORT')?.balance).toBe('999');
  });

  it('treats a null/empty account as one shared bucket, distinct from any named account', () => {
    setCachedBalance(null, 'QORT', { balance: '5' });
    expect(getCachedBalance(undefined, 'QORT')?.balance).toBe('5');
    expect(getCachedBalance('', 'QORT')?.balance).toBe('5');
    expect(getCachedBalance('acct-a', 'QORT')).toBeUndefined();
  });

  it('clearBalanceCache drops every entry for every account and notifies once', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceCache(listener);
    setCachedBalance('acct-a', 'QORT', { balance: '10' });
    setCachedBalance('acct-b', 'BTC', { balance: '1' });
    listener.mockClear();

    clearBalanceCache();

    expect(getCachedBalance('acct-a', 'QORT')).toBeUndefined();
    expect(getCachedBalance('acct-b', 'BTC')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('clearBalanceCache on an already-empty cache is a no-op (no listener notification)', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceCache(listener);
    clearBalanceCache();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
