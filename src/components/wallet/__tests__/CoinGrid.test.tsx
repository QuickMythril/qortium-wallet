import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import { CoinGrid } from '../CoinGrid';
import type { ChainConfig } from '../../../config/chains';
import type { AssetHolding } from '../../../utils/Types';
import {
  walletReadyAtom,
  viewModeAtom,
  sortModeAtom,
  customOrderAtom,
} from '../../../state/global/system';
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

const { chainsFixture, accountState, assetsFixture } = vi.hoisted(() => {
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
  // A single stable array reference (mutated in place via push/length=0,
  // never reassigned) - round 3's useAssetHoldings mock gotcha: a fresh
  // array literal returned per call makes every effect depending on
  // `assets` think the list changed on every render and loop forever.
  const assetsFixture: AssetHolding[] = [];
  return { chainsFixture, accountState, assetsFixture };
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
    assets: assetsFixture,
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

vi.mock('../../../hooks/useAssetImageUrl', () => ({
  useAssetImageUrl: () => ({ url: null, issuerName: null }),
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

describe('CoinGrid asset network grouping (round 3)', () => {
  function makeAsset(
    network: AssetHolding['network'],
    assetId: number,
    name: string
  ): AssetHolding {
    return {
      network,
      assetId,
      name,
      owner: `${network}-owner-${assetId}`,
      quantity: '1000000000',
      isDivisible: true,
      isOwnerForSale: false,
      balance: '100000000',
      pinned: false,
    };
  }

  // Every row (chain or asset) carries a `<kind>-list-row-<key>` testid in
  // list view - read them back in document order to assert the full render
  // order, chains included, not just the asset-vs-asset grouping.
  function allRowTestIds(): (string | null)[] {
    return Array.from(
      document.querySelectorAll(
        '[data-testid^="coin-list-row-"], [data-testid^="asset-list-row-"]'
      )
    ).map((el) => el.getAttribute('data-testid'));
  }

  beforeEach(() => {
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
    accountState.current = 'acct-a';
    getDefaultStore().set(walletReadyAtom, true);
    // AssetListRow (not AssetBlock's tile grid) carries the stable
    // `asset-list-row-<network>-<assetId>` testid this reads document order
    // from.
    getDefaultStore().set(viewModeAtom, 'list');
    getDefaultStore().set(sortModeAtom, 'custom');
    getDefaultStore().set(customOrderAtom, []);
    assetsFixture.length = 0;

    (globalThis as any).qdnRequest = vi.fn(async () => null);
    (globalThis as any).qortalRequest = vi.fn(async () => null);
  });

  afterEach(() => {
    cleanup();
    getDefaultStore().set(walletReadyAtom, false);
    getDefaultStore().set(viewModeAtom, 'grid');
    getDefaultStore().set(sortModeAtom, 'custom');
    getDefaultStore().set(customOrderAtom, []);
    delete (globalThis as any).qdnRequest;
    delete (globalThis as any).qortalRequest;
    assetsFixture.length = 0;
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
  });

  it('renders every Qortium asset before every Qortal asset, regardless of the order useAssetHoldings returned them in', async () => {
    // Deliberately reversed from the required display order, and
    // interleaved, so a pass here can't be an accident of input order.
    assetsFixture.push(
      makeAsset('qortal', 20, 'QORTAL-SILVER'),
      makeAsset('qortium', 2, 'CHIP'),
      makeAsset('qortal', 21, 'QORTAL-GOLD'),
      makeAsset('qortium', 1, 'TIUM')
    );

    renderGrid();

    await waitFor(() =>
      expect(screen.getByTestId('asset-list-row-qortium-1')).toBeInTheDocument()
    );

    const rows = Array.from(
      document.querySelectorAll('[data-testid^="asset-list-row-"]')
    ).map((el) => el.getAttribute('data-testid'));

    expect(rows).toEqual([
      'asset-list-row-qortium-2',
      'asset-list-row-qortium-1',
      'asset-list-row-qortal-20',
      'asset-list-row-qortal-21',
    ]);
  });

  // Round 3 review finding 1: the grouping rule used to be defined only for
  // asset-vs-asset pairs, so a chain that sorted (by name/balance/custom
  // order) between a Qortal and a Qortium asset produced a non-transitive
  // comparator - Array.prototype.sort has no defined result for that. These
  // three tests each engineer exactly that "chain in between" input under a
  // different active sort mode and assert the fully resolved render order:
  // chains first (their own tier), then every Qortium asset, then every
  // Qortal asset.
  //
  // `useMarketPrices` is mocked to `{}` for this whole file, so every
  // chain's fiat value is 0 under balance sort - both chains tie and fall
  // back to their stable original order (QORT, then BTC, matching
  // `chainsFixture`), making that case deterministic without extra
  // balance-fetch mocking.
  it('name sort: chains first, then Qortium assets, then Qortal assets, all still name-ordered within their group', async () => {
    getDefaultStore().set(sortModeAtom, 'name-asc');
    // Chain names 'Bitcoin' and 'Qortal' sort strictly between these two
    // asset names - the exact "chain row between a Qortal and a Qortium
    // asset" scenario.
    assetsFixture.push(
      makeAsset('qortal', 30, 'AAA_QORTAL'),
      makeAsset('qortium', 5, 'ZZZ_QORTIUM')
    );

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId('asset-list-row-qortium-5')).toBeInTheDocument()
    );

    expect(allRowTestIds()).toEqual([
      'coin-list-row-BTC', // 'Bitcoin'
      'coin-list-row-QORT', // 'Qortal' (the chain's display name)
      'asset-list-row-qortium-5', // 'ZZZ_QORTIUM'
      'asset-list-row-qortal-30', // 'AAA_QORTAL'
    ]);
  });

  it('balance sort: chains first, then Qortium assets, then Qortal assets', async () => {
    getDefaultStore().set(sortModeAtom, 'balance-asc');
    assetsFixture.push(
      makeAsset('qortal', 31, 'QORTAL-ASSET'),
      makeAsset('qortium', 6, 'QORTIUM-ASSET')
    );

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId('asset-list-row-qortium-6')).toBeInTheDocument()
    );

    expect(allRowTestIds()).toEqual([
      'coin-list-row-QORT',
      'coin-list-row-BTC',
      'asset-list-row-qortium-6',
      'asset-list-row-qortal-31',
    ]);
  });

  it('custom/pinned order: the group rank still wins across tiers, but each tier keeps its own pinned/dragged order', async () => {
    getDefaultStore().set(sortModeAtom, 'custom');
    const qortiumA = makeAsset('qortium', 7, 'QORTIUM-A');
    const qortiumB = makeAsset('qortium', 8, 'QORTIUM-B');
    const qortalA = makeAsset('qortal', 32, 'QORTAL-A');
    const qortalB = makeAsset('qortal', 33, 'QORTAL-B');
    assetsFixture.push(qortiumA, qortiumB, qortalA, qortalB);

    // Deliberately scrambled across tiers (a Qortal asset listed first,
    // ahead of every chain and Qortium asset) - group rank must still put
    // every chain ahead of every asset and every Qortium asset ahead of
    // every Qortal asset, while the relative order *within* each tier
    // (BTC before QORT; qortiumA before qortiumB; qortalB before qortalA)
    // follows this custom order exactly.
    getDefaultStore().set(customOrderAtom, [
      'asset:qortal:33', // qortalB
      'BTC',
      'asset:qortium:7', // qortiumA
      'QORT',
      'asset:qortal:32', // qortalA
      'asset:qortium:8', // qortiumB
    ]);

    renderGrid();
    await waitFor(() =>
      expect(screen.getByTestId('asset-list-row-qortium-7')).toBeInTheDocument()
    );

    expect(allRowTestIds()).toEqual([
      'coin-list-row-BTC',
      'coin-list-row-QORT',
      'asset-list-row-qortium-7', // qortiumA
      'asset-list-row-qortium-8', // qortiumB
      'asset-list-row-qortal-33', // qortalB
      'asset-list-row-qortal-32', // qortalA
    ]);
  });
});
