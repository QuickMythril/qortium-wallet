// Shared, module-level cache of per-account, per-chain wallet balances
// (round 2, item B).
//
// CoinGrid previously re-fetched every coin's balance on every mount and on
// every `qortiumBridgeStateChanged` event, even when nothing about that
// specific coin had changed. This module gives CoinGrid (and anything else
// that cares) a single source of truth for "how fresh is this coin's
// balance", so a remount within the freshness window can render instantly
// from cache instead of re-hitting the bridge for every chain.
//
// Entries are keyed by (account, chain.key) - not chain.key alone. Home's
// selected account can change without CoinGrid remounting (SELECTED_ACCOUNT_
// CHANGED), and a chain-only key would otherwise render account A's cached
// balance under account B for up to the freshness window. AppLayout's
// SELECTED_ACCOUNT_CHANGED handler calls `clearBalanceCache()` so a stale
// account's entries can never be read at all, even before the TTL would
// have expired them.
//
// This is intentionally a plain module (not a React context) so it can be
// read and written from outside the component tree that renders the grid -
// e.g. CoinDetail invalidates a chain's entry the moment a send is accepted,
// so the grid fetches fresh data the next time it's shown, without either
// component needing to know about the other's lifecycle.

import { TIME_MINUTES_2 } from './constants';

export interface CachedBalance {
  balance: string | null;
  error?: string;
  fetchedAt: number;
}

export const BALANCE_CACHE_TTL_MS = TIME_MINUTES_2;

const store = new Map<string, CachedBalance>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

// Home reports no selected account (public node, or not yet authenticated)
// as null/empty - bucket those under one fixed key rather than one per
// falsy value, so they still share a cache the way a real account would.
function accountKey(account: string | null | undefined): string {
  return account && account.trim() !== '' ? account : '(no-account)';
}

function makeKey(account: string | null | undefined, chainKey: string): string {
  return `${accountKey(account)}::${chainKey}`;
}

/** The cached entry for (account, chain.key), or undefined if never fetched / invalidated / cleared. */
export function getCachedBalance(
  account: string | null | undefined,
  chainKey: string
): CachedBalance | undefined {
  return store.get(makeKey(account, chainKey));
}

/** Record a fresh fetch result. Overwrites any prior entry and stamps `fetchedAt` = now. */
export function setCachedBalance(
  account: string | null | undefined,
  chainKey: string,
  entry: { balance: string | null; error?: string }
): void {
  store.set(makeKey(account, chainKey), { ...entry, fetchedAt: Date.now() });
  notify();
}

/**
 * Drop one (account, chain) entry so the next freshness check reports
 * "stale" and the grid re-fetches it. Used when a coin is sent from
 * (optimistically) and again once a send is confirmed (see CoinDetail /
 * pendingSends).
 */
export function invalidateCachedBalance(
  account: string | null | undefined,
  chainKey: string
): void {
  const key = makeKey(account, chainKey);
  if (!store.has(key)) return;
  store.delete(key);
  notify();
}

/** True when (account, chain.key) has a cached entry fetched within `ttl` ms of now. */
export function isBalanceCacheFresh(
  account: string | null | undefined,
  chainKey: string,
  ttl: number = BALANCE_CACHE_TTL_MS
): boolean {
  const entry = store.get(makeKey(account, chainKey));
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < ttl;
}

/** Subscribe to any cache write/invalidation/clear. Returns an unsubscribe function. */
export function subscribeBalanceCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop every cached entry, for every account and chain. Call this whenever
 * Home's selected account changes (SELECTED_ACCOUNT_CHANGED) - entries are
 * already isolated per account by key, but clearing on the switch itself
 * (rather than only relying on a fresh account's own empty cache) means a
 * grid that's already mounted and subscribed re-fetches immediately instead
 * of rendering whatever the previous account's balances happened to be
 * until the freshness pass next runs.
 */
export function clearBalanceCache(): void {
  if (store.size === 0) return;
  store.clear();
  notify();
}

/** Test-only: clear all cached entries and listeners between test cases. */
export function __resetBalanceCacheForTests(): void {
  store.clear();
  listeners.clear();
}
