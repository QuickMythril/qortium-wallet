import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import { CoinGrid } from '../CoinGrid';
import type { ChainConfig } from '../../../config/chains';
import { walletReadyAtom } from '../../../state/global/system';
import {
  __resetBalanceCacheForTests,
  clearBalanceCache,
  getCachedBalance,
  setCachedBalance,
} from '../../../common/balanceCache';
import { __resetPendingSendsForTests } from '../../../common/pendingSends';

// Round 2 items B (shared balance cache) and C (QORT-only fast poll) live
// in CoinGrid's balance-loading effects. CoinGrid has no per-component test
// file yet, so this covers only those two behaviors, not the pre-existing
// drag/sort/asset rendering (unit-tested well enough by inspection and by
// CoinBlock/CoinListRow's own tests).

const { chainsFixture, accountState } = vi.hoisted(() => {
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
  const btcChain: ChainConfig = {
    key: 'BTC',
    name: 'Bitcoin',
    ticker: 'BTC',
    coinEnum: 'BTC',
    route: 'bitcoin',
    defaultFee: 0.00001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
    homeWallet: {
      contract: 'qortium-home-wallet-v1',
      implemented: true,
      protocol: 'qdnRequest',
      read: true,
      readMode: 'PUBLIC_NODE',
      receive: true,
      receiveMode: 'HOME_LOCAL',
      requiresUnlockedAccount: true,
      send: true,
      serverManagement: true,
      sendMode: 'HOME_SIGNED_PUBLIC_NODE',
      serverManagementMode: 'HOME_LOCAL',
    },
  };
  // A single stable array reference, reused across every call - a fresh
  // literal on each render would make every effect depending on `chains`
  // think the chain list changed every time and loop forever.
  const chainsFixture: ChainConfig[] = [qortChain, btcChain];
  // Mutable holder so a test can simulate an account switch (change this,
  // then rerender) without needing a real qapp-core auth flow.
  const accountState = { current: 'acct-a' as string | null };
  return { chainsFixture, accountState };
});

vi.mock('../../../hooks/useSupportedChains', () => ({
  useSupportedChains: () => ({
    chains: chainsFixture,
    status: 'live',
    walletAuthorityReady: true,
  }),
}));

// Overrides src/test/setup.ts's partial qapp-core mock (that one has no
// useAuth) - CoinGrid now reads the selected account from it to key the
// shared balance cache (round 2 review finding 1).
vi.mock('qapp-core', () => ({
  Coin: {
    BTC: 'BTC',
    DOGE: 'DOGE',
    LTC: 'LTC',
    RVN: 'RVN',
    DGB: 'DGB',
    QORT: 'QORT',
    ARRR: 'ARRR',
  },
  useGlobal: vi.fn(() => [null, vi.fn()]),
  RequestQueueWithPromise: vi.fn(),
  useAuth: () => ({ address: accountState.current }),
}));

vi.mock('../../../hooks/useMarketPrices', () => ({
  useMarketPrices: () => ({}),
}));

vi.mock('../../../hooks/useAssetHoldings', () => ({
  useAssetHoldings: () => ({
    assets: [],
    loading: false,
    networks: [],
    refresh: () => {},
    pinAsset: async () => ({ ok: true }) as const,
    unpinAsset: () => {},
  }),
}));

vi.mock('../../../hooks/useCoinImageUrl', () => ({
  useCoinImageUrl: () => null,
}));

function renderGrid() {
  return render(
    <MemoryRouter>
      <ThemeProviderWrapper>
        <CoinGrid />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

function balanceCalls(mock: ReturnType<typeof vi.fn>, action: string) {
  return mock.mock.calls.filter(([opts]) => opts?.action === action);
}

describe('CoinGrid shared balance cache (round 2, item B)', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;
  let qortalRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
    accountState.current = 'acct-a';
    getDefaultStore().set(walletReadyAtom, true);

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['GET_WALLET_BALANCE', 'RECEIVE_COIN', 'SEND_COIN'];
        case 'GET_WALLET_BALANCE':
          return 100000000; // 1 BTC in satoshis
        default:
          return null;
      }
    });
    qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_USER_ACCOUNT':
          return { address: 'qort-wallet-address' };
        case 'GET_BALANCE':
          return '10';
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    (globalThis as any).qortalRequest = qortalRequestMock;
  });

  afterEach(() => {
    cleanup();
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
    delete (globalThis as any).qortalRequest;
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
  });

  it('fetches every coin once on first mount', async () => {
    renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(1)
    );
  });

  it('renders instantly from cache and makes zero balance calls on a remount within the freshness window', async () => {
    const { unmount } = renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(1)
    );
    unmount();

    qdnRequestMock.mockClear();
    qortalRequestMock.mockClear();

    renderGrid();
    // Give any (unwanted) fetch a chance to fire before asserting none did.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(0);
    expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(0);
    // The cached value still rendered even though nothing was re-fetched.
    expect(await screen.findAllByText('10')).not.toHaveLength(0);
  });

  it('re-fetches only the one coin whose cache entry is stale, not the whole grid', async () => {
    vi.useFakeTimers();
    try {
      // Cache both, then let time pass so both entries are 3 minutes old...
      setCachedBalance('acct-a', 'QORT', { balance: '10' });
      setCachedBalance('acct-a', 'BTC', { balance: '1' });
      vi.advanceTimersByTime(3 * 60 * 1000); // > 2-minute TTL
      // ...then refresh only QORT's entry, so it alone is fresh again.
      setCachedBalance('acct-a', 'QORT', { balance: '10' });

      renderGrid();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(0);
      expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(
        1
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refetch when a qortiumBridgeStateChanged event fires with an unchanged capability set', async () => {
    renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );

    qdnRequestMock.mockClear();
    qortalRequestMock.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(0);
    expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(0);
  });

  it('does refetch the affected coin when a qortiumBridgeStateChanged event actually changes its capability set', async () => {
    renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(1)
    );

    qdnRequestMock.mockClear();
    qortalRequestMock.mockClear();
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          // BTC's read capability is now gone.
          return ['SEND_COIN'];
        case 'GET_WALLET_BALANCE':
          return 100000000;
        default:
          return null;
      }
    });

    await act(async () => {
      window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
      await new Promise((r) => setTimeout(r, 50));
    });

    // canReadBalance flipped to false - CoinGrid renders that as null, not
    // an extra GET_WALLET_BALANCE call.
    expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE')).toHaveLength(0);
  });

  it("never renders account A's cached balance for account B, and fetches fresh on B's first render (round 2 review finding 1)", async () => {
    const { rerender } = renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(screen.getAllByText('10').length).toBeGreaterThan(0)
    );

    // Account A's QORT balance is now cached at '10'. Switch accounts -
    // account B has never been cached, so its balance must render as
    // "not yet known" (never A's stale '10'), and must trigger a fresh
    // fetch rather than reusing A's cache entry.
    accountState.current = 'acct-b';
    qdnRequestMock.mockClear();
    qortalRequestMock.mockClear();
    qortalRequestMock.mockImplementation(
      async (opts: Record<string, unknown>) => {
        switch (opts.action) {
          case 'GET_USER_ACCOUNT':
            return { address: 'qort-wallet-address-b' };
          case 'GET_BALANCE':
            return '77';
          default:
            return null;
        }
      }
    );

    // Rerenders the SAME mounted CoinGrid instance with the new account,
    // matching how a real account switch plays out (authenticateUser()
    // updates useAuth()'s return value and the already-mounted tree
    // re-renders) - not an unmount/remount.
    rerender(
      <MemoryRouter>
        <ThemeProviderWrapper>
          <CoinGrid />
        </ThemeProviderWrapper>
      </MemoryRouter>
    );

    // Account A's '10' must never appear for B - only B's own fetch result.
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(screen.getAllByText('77').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText('10')).not.toBeInTheDocument();
  });

  it("clearBalanceCache makes the next render fetch fresh instead of reusing a stale account's values (AppLayout wiring)", async () => {
    const { rerender } = renderGrid();
    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );

    qdnRequestMock.mockClear();
    qortalRequestMock.mockClear();
    clearBalanceCache();
    expect(getCachedBalance('acct-a', 'QORT')).toBeUndefined();

    accountState.current = 'acct-b';
    rerender(
      <MemoryRouter>
        <ThemeProviderWrapper>
          <CoinGrid />
        </ThemeProviderWrapper>
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(balanceCalls(qortalRequestMock, 'GET_BALANCE')).toHaveLength(1)
    );
  });
});

describe('CoinGrid QORT fast balance poll (round 2, item C)', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;
  let qortalRequestMock: ReturnType<typeof vi.fn>;
  let qortBalance: string;

  beforeEach(() => {
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
    accountState.current = 'acct-a';
    getDefaultStore().set(walletReadyAtom, true);
    vi.useFakeTimers();

    qortBalance = '10';
    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['GET_WALLET_BALANCE'];
        case 'GET_WALLET_BALANCE':
          return 100000000;
        default:
          return null;
      }
    });
    qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_USER_ACCOUNT':
          return { address: 'qort-wallet-address' };
        case 'GET_BALANCE':
          return qortBalance;
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    (globalThis as any).qortalRequest = qortalRequestMock;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
    delete (globalThis as any).qortalRequest;
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
  });

  it('polls QORT balance every 60s and updates the displayed value on change, without polling BTC on this interval', async () => {
    // findBy*/waitFor poll via real setTimeout internally and hang under
    // fake timers - advance the fake clock explicitly and read with the
    // synchronous getBy*/queryBy* queries instead.
    renderGrid();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);

    const btcCallsBefore = balanceCalls(
      qdnRequestMock,
      'GET_WALLET_BALANCE'
    ).length;
    qortBalance = '25';

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(screen.getAllByText('25').length).toBeGreaterThan(0);
    expect(balanceCalls(qdnRequestMock, 'GET_WALLET_BALANCE').length).toBe(
      btcCallsBefore
    );
  });

  it('pauses the QORT poll while the document is hidden', async () => {
    renderGrid();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const callsBefore = balanceCalls(qortalRequestMock, 'GET_BALANCE').length;

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    qortBalance = '99';

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(balanceCalls(qortalRequestMock, 'GET_BALANCE').length).toBe(
      callsBefore
    );

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
  });
});
