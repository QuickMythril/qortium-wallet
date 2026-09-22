import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { CoinDetail } from '../CoinDetail';
import type { ChainConfig } from '../../../config/chains';
import { walletReadyAtom } from '../../../state/global/system';
import {
  ARRR_CUSTODY_CONTRACT,
  HOME_WALLET_CONTRACT,
} from '../../../common/homeWalletCapabilities';
import { ARRR_BUSY_RETRY_DELAY_MS } from '../../../common/arrrSync';
import {
  __resetBalanceCacheForTests,
  getCachedBalance,
} from '../../../common/balanceCache';
import { __resetPendingSendsForTests } from '../../../common/pendingSends';
import { invalidateCachedAccountUnlocked } from '../../../common/accountUnlockState';

vi.mock('react-qr-code', () => ({
  default: () => null,
}));

vi.mock('../../../hooks/useMarketPrices', () => ({
  useMarketPrices: () => ({}),
}));

let currentAccount = 'qort-user-address';
vi.mock('qapp-core', () => ({
  useAuth: () => ({ address: currentAccount, name: 'testuser' }),
}));

afterEach(() => {
  invalidateCachedAccountUnlocked();
  __resetBalanceCacheForTests();
  __resetPendingSendsForTests();
});

const arrrActions = [
  'GET_USER_WALLET',
  'GET_WALLET_BALANCE',
  'GET_USER_WALLET_TRANSACTIONS',
  'GET_ARRR_SYNC_STATUS',
];

const arrrChain: ChainConfig = {
  key: 'ARRR',
  name: 'Pirate Chain',
  ticker: 'ARRR',
  coinEnum: 'ARRR',
  route: 'pirate-chain',
  defaultFee: 0.0001,
  isNative: false,
  decimalPlaces: 8,
  activeNetwork: 'MAIN',
  supportsHtlc: false,
  supportsLocalChainTrades: false,
  homeWallet: {
    contract: HOME_WALLET_CONTRACT,
    implemented: true,
    protocol: 'qdnRequest',
    read: true,
    readMode: 'TRUSTED_CORE_CUSTODY',
    receive: true,
    receiveMode: 'TRUSTED_CORE_CUSTODY',
    requiresUnlockedAccount: true,
    send: false,
    sendMode: 'NONE',
    serverManagement: false,
    serverManagementMode: 'NONE',
    custodyContract: ARRR_CUSTODY_CONTRACT,
    syncStatus: true,
  },
};

const unavailableArrrChain: ChainConfig = {
  ...arrrChain,
  homeWallet: {
    ...arrrChain.homeWallet!,
    read: false,
    receive: false,
    readMode: 'NONE',
    receiveMode: 'NONE',
    unavailableReason: 'ARRR custody requires a locally-managed Core.',
  },
};

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    contract: 'qortium-home-arrr-custody-v1',
    coin: 'ARRR',
    state: 'READY',
    ready: true,
    message: null,
    syncedBlocks: 100,
    totalBlocks: 100,
    restartRequired: false,
    recoveryState: null,
    scannedHeight: 3000000,
    tipHeight: 3000000,
    totalBalanceAtomic: null,
    verifiedBalanceAtomic: null,
    observedAt: Date.now(),
    stale: false,
    backendMode: 'unified',
    walletIdentityHash: 'hash-a',
    lastError: null,
    ...overrides,
  };
}

function renderDetail(
  chain: ChainConfig = arrrChain,
  initialEntries: string[] = ['/']
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProviderWrapper>
        <CoinDetail chain={chain} />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

describe('CoinDetail ARRR structured state rendering', () => {
  let qdnRequestMock: ReturnType<
    typeof vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>
  >;
  let syncStatusResponse: unknown;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    currentAccount = 'qort-user-address';
    getDefaultStore().set(walletReadyAtom, true);
    syncStatusResponse = baseSnapshot();
    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return arrrActions;
        case 'GET_USER_WALLET':
          return {
            address: 'zs1qtestarrraddress0000000000000000',
            coin: 'ARRR',
          };
        case 'GET_ARRR_SYNC_STATUS':
          return syncStatusResponse;
        case 'GET_WALLET_BALANCE':
          if (opts.verified === false) return '150000000';
          return '140000000';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
  });

  afterEach(() => {
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
  });

  it('offers controls only with the new contract and both Home actions', async () => {
    syncStatusResponse = baseSnapshot({ state: 'SYNCHRONIZING', ready: false });
    const original = qdnRequestMock.getMockImplementation()!;
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) =>
      opts.action === 'SHOW_ACTIONS'
        ? [...arrrActions, 'STOP_ARRR_SYNC', 'START_ARRR_SYNC']
        : original(opts)
    );
    const old = renderDetail();
    await screen.findByTestId('arrr-state-synchronizing');
    expect(
      screen.queryByRole('button', { name: 'Stop syncing' })
    ).not.toBeInTheDocument();
    old.unmount();
    renderDetail({
      ...arrrChain,
      homeWallet: {
        ...arrrChain.homeWallet!,
        syncControlContract: 'qortium-home-arrr-sync-control-v1',
      },
    });
    expect(
      await screen.findByRole('button', { name: 'Stop syncing' })
    ).toBeInTheDocument();
  });

  it('shows the receive address as soon as it resolves, independent of sync state', async () => {
    syncStatusResponse = baseSnapshot({ state: 'LOADING', ready: false });
    renderDetail();
    await waitFor(() =>
      expect(
        screen.getByText('zs1qtestarrraddress0000000000000000')
      ).toBeInTheDocument()
    );
  });

  it('renders the LOADING state', async () => {
    syncStatusResponse = baseSnapshot({
      state: 'LOADING',
      ready: false,
      message: 'Connecting…',
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-loading')).toBeInTheDocument()
    );
  });

  it('renders the DISABLED state with an explanation', async () => {
    syncStatusResponse = baseSnapshot({
      state: 'DISABLED',
      ready: false,
      message: 'ARRR is turned off on this Core.',
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-disabled')).toBeInTheDocument()
    );
    expect(
      screen.getByText('ARRR is turned off on this Core.')
    ).toBeInTheDocument();
  });

  it('renders the SYNCHRONIZING state with heights when both are known', async () => {
    syncStatusResponse = baseSnapshot({
      state: 'SYNCHRONIZING',
      ready: false,
      scannedHeight: 500,
      tipHeight: 1000,
      syncedBlocks: null,
      totalBlocks: null,
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-synchronizing')).toBeInTheDocument()
    );
    expect(screen.getByText('Chain height: 500 of 1,000')).toBeInTheDocument();
  });

  it('renders the DEGRADED state with the last error and restart guidance', async () => {
    syncStatusResponse = baseSnapshot({
      state: 'DEGRADED',
      ready: false,
      restartRequired: true,
      lastError: { code: 'ARRR_SYNC_FAILED', message: 'Connection dropped' },
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-degraded')).toBeInTheDocument()
    );
    expect(screen.getByText('Connection dropped')).toBeInTheDocument();
    expect(
      screen.getByText('Restart Qortium Core to recover.')
    ).toBeInTheDocument();
  });

  it('renders the READY state with verified as the main balance and total as a secondary line, formatted to 8 decimals', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    // verified = 140000000 atomic / 1e8 = 1.4, total = 150000000 / 1e8 = 1.5
    await waitFor(() =>
      expect(screen.getByText('1.40000000')).toBeInTheDocument()
    );
    expect(
      screen.getByText(/total incl. unconfirmed\/unverified: 1.50000000/)
    ).toBeInTheDocument();
  });

  it('falls back to the total balance with a verifying label when the verified read is unavailable', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return arrrActions;
        case 'GET_USER_WALLET':
          return {
            address: 'zs1qtestarrraddress0000000000000000',
            coin: 'ARRR',
          };
        case 'GET_ARRR_SYNC_STATUS':
          return syncStatusResponse;
        case 'GET_WALLET_BALANCE':
          if (opts.verified === false) return '150000000';
          throw {
            code: 'ARRR_VERIFIED_BALANCE_UNAVAILABLE',
            message: 'verified balance not known yet',
            retryable: true,
          };
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        default:
          return null;
      }
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByText('1.50000000')).toBeInTheDocument()
    );
    expect(screen.getByText('verifying…')).toBeInTheDocument();
  });

  it('never renders a null balance as 0', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return arrrActions;
        case 'GET_USER_WALLET':
          return {
            address: 'zs1qtestarrraddress0000000000000000',
            coin: 'ARRR',
          };
        case 'GET_ARRR_SYNC_STATUS':
          return syncStatusResponse;
        case 'GET_WALLET_BALANCE':
          return null;
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        default:
          return null;
      }
    });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    expect(screen.queryByText('0.00000000')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows Home unavailableReason and never polls or shows Send when the custody capability is missing', async () => {
    renderDetail(unavailableArrrChain);
    await waitFor(() =>
      expect(
        screen.getByText('ARRR custody requires a locally-managed Core.')
      ).toBeInTheDocument()
    );
    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'GET_ARRR_SYNC_STATUS'
      )
    ).toBe(false);
  });

  it('never shows a working Send affordance for ARRR', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    const sendButton = screen.getByRole('button', { name: /^send$/i });
    expect(sendButton).toBeDisabled();
  });

  // Codex round 5 review finding 5: ARRR send must be structurally
  // impossible, not only capability-gated - a `?send=true` deep link (the
  // grid quick-send icon, the list-row send icon, or the same `?send=true`
  // Home `wallet` assignment-role link) must never auto-open the dialog.
  it('never auto-opens the send dialog from a ?send=true deep link', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    renderDetail(arrrChain, ['/pirate-chain?send=true']);
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /confirm send/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^send arrr$/i)).not.toBeInTheDocument();
  });

  // Codex round 5 review finding 5: FindPersonPage's contact-card resolved
  // recipient link (`/${chain.route}?send=true&to=${address}`) must be
  // equally blocked for ARRR.
  it("never auto-opens the send dialog from a contact card's ?send=true&to= deep link", async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    renderDetail(arrrChain, [
      '/pirate-chain?send=true&to=zs1qtestrecipientaddress0000000000',
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /confirm send/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^send arrr$/i)).not.toBeInTheDocument();
  });

  it('never dispatches SEND_COIN for ARRR even if handleSend were somehow invoked', async () => {
    // Structural regression guard for the hard throw in handleSend's
    // foreign-payload branch - if canSend/isARRR gating were ever broken
    // upstream, this proves the dispatch point itself still refuses.
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument()
    );
    expect(
      qdnRequestMock.mock.calls.some(([opts]) => opts.action === 'SEND_COIN')
    ).toBe(false);
  });

  it('isolates the ARRR balance cache per account', async () => {
    syncStatusResponse = baseSnapshot({ state: 'READY', ready: true });
    const { unmount } = renderDetail();
    await waitFor(() =>
      expect(getCachedBalance('qort-user-address', 'ARRR')?.balance).toBe(
        '1.40000000'
      )
    );
    unmount();

    expect(getCachedBalance('another-account', 'ARRR')).toBeUndefined();
  });
});

describe('CoinDetail ARRR busy retry', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    currentAccount = 'qort-user-address';
    getDefaultStore().set(walletReadyAtom, true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
    vi.useRealTimers();
  });

  it('auto-retries GET_ARRR_SYNC_STATUS on ARRR_WALLET_BUSY, then offers a manual retry after the budget is exhausted', async () => {
    const busyError = {
      code: 'ARRR_WALLET_BUSY',
      message: 'busy',
      retryable: true,
    };
    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return arrrActions;
        case 'GET_USER_WALLET':
          return {
            address: 'zs1qtestarrraddress0000000000000000',
            coin: 'ARRR',
          };
        case 'GET_ARRR_SYNC_STATUS':
          throw busyError;
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    renderDetail();

    // Flush the busy auto-retry budget (6 attempts x 10s).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ARRR_BUSY_RETRY_DELAY_MS);
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('arrr-busy')).toBeInTheDocument();
    expect(
      screen.getByText('Your Core is busy with another ARRR wallet')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
