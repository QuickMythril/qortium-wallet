import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { CoinDetail } from '../CoinDetail';
import { CoinGrid } from '../CoinGrid';
import type { ChainConfig } from '../../../config/chains';
import { walletReadyAtom } from '../../../state/global/system';
import {
  __resetBalanceCacheForTests,
  getCachedBalance,
} from '../../../common/balanceCache';
import {
  __resetPendingSendsForTests,
  getPendingSendsForChain,
} from '../../../common/pendingSends';

// Round 2 review finding 2: the pending row + its confirmation poll used to
// live only in CoinDetail's local state/effects, so navigating from the
// coin page to the grid (Routes.tsx swaps one for the other) stopped
// tracking entirely. This exercises the fix end to end: send while on the
// coin page, navigate to the grid (the coin page unmounts for real), let
// the shared poller (now living in src/common/pendingSends.ts) confirm
// while only the grid is mounted, then reopen the coin page and also cover
// the "still pending when reopened" path.

const { qortChain, chainsFixture } = vi.hoisted(() => {
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
  // A single stable array reference, reused across every useSupportedChains
  // call - a fresh literal on each render would make CoinGrid's effects
  // think the chain list changed every time and loop forever (the same
  // bug fixed in CoinGrid.test.tsx).
  const chainsFixture: ChainConfig[] = [qortChain];
  return { qortChain, chainsFixture };
});

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
  useAuth: () => ({ address: 'qort-user-address', name: 'testuser' }),
}));

vi.mock('react-qr-code', () => ({ default: () => null }));

vi.mock('../../../hooks/useSupportedChains', () => ({
  useSupportedChains: () => ({
    chains: chainsFixture,
    status: 'live',
    walletAuthorityReady: true,
  }),
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

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/qort']}>
      <ThemeProviderWrapper>
        <CoinDetail chain={qortChain} />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

function renderGrid() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProviderWrapper>
        <CoinGrid />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

const flushMicrotasks = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe('pending QORT send survives navigating from the coin page to the grid', () => {
  let qortalRequestMock: ReturnType<typeof vi.fn>;
  let confirmed: boolean;
  let balanceValue: string;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
    __resetBalanceCacheForTests();
    __resetPendingSendsForTests();
    getDefaultStore().set(walletReadyAtom, true);

    confirmed = false;
    balanceValue = '12.5';
    qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_QORT'];
        case 'GET_USER_ACCOUNT':
          return { address: 'qort-wallet-address' };
        case 'GET_BALANCE':
          return balanceValue;
        case 'SEARCH_TRANSACTIONS':
          if (opts.confirmationStatus === 'BOTH' && confirmed) {
            return [
              {
                signature: 'sig-abc',
                recipient: 'qort-recipient-address',
                amount: '1.25',
                fee: '0.001',
                timestamp: Date.now(),
                blockHeight: 500,
              },
            ];
          }
          return [];
        case 'SEND_QORT':
          return {
            accepted: true,
            amount: '1.25',
            recipient: 'qort-recipient-address',
            transactionSignature: 'sig-abc',
          };
        default:
          return null;
      }
    });
    (globalThis as any).qortalRequest = qortalRequestMock;
    (globalThis as any).qdnRequest = vi.fn(async () => null);
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

  async function sendFromCoinPage() {
    const view = renderDetail();
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await flushMicrotasks();
    fireEvent.change(screen.getByLabelText(/amount \(QORT\)/i), {
      target: { value: '1.25' },
    });
    fireEvent.change(screen.getByLabelText(/recipient address/i), {
      target: { value: 'qort-recipient-address' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm send/i }));
    await flushMicrotasks();
    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
    expect(getPendingSendsForChain('qort-user-address', 'QORT')).toHaveLength(
      1
    );
    return view;
  }

  it('keeps polling and confirms while only the grid is mounted, refreshing the cache and clearing the pending entry', async () => {
    const { unmount: unmountDetail } = await sendFromCoinPage();

    // Navigate away: the coin page unmounts for real, as Routes.tsx does
    // when swapping CoinDetail for CoinGrid.
    unmountDetail();
    expect(getPendingSendsForChain('qort-user-address', 'QORT')).toHaveLength(
      1
    );

    renderGrid();
    await flushMicrotasks();

    // Now let the send confirm while only the grid is mounted.
    confirmed = true;
    balanceValue = '11.25';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(getPendingSendsForChain('qort-user-address', 'QORT')).toHaveLength(
      0
    );
    expect(getCachedBalance('qort-user-address', 'QORT')?.balance).toBe(
      '11.25'
    );
  });

  it('shows the pending row again if the coin page is reopened before confirmation', async () => {
    const { unmount: unmountDetail } = await sendFromCoinPage();
    unmountDetail();

    renderGrid();
    await flushMicrotasks();
    // Still unconfirmed - `confirmed` was never flipped to true.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(getPendingSendsForChain('qort-user-address', 'QORT')).toHaveLength(
      1
    );

    cleanup(); // unmount the grid, as leaving it for the coin page would
    renderDetail();
    await flushMicrotasks();

    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
  });
});
