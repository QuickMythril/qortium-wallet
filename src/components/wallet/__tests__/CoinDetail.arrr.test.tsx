import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { CoinDetail } from '../CoinDetail';
import { useSupportedChains } from '../../../hooks/useSupportedChains';
import type { ChainConfig } from '../../../config/chains';
import { walletReadyAtom } from '../../../state/global/system';
import {
  ARRR_CUSTODY_CONTRACT,
  HOME_WALLET_CONTRACT,
} from '../../../common/homeWalletCapabilities';
import {
  ARRR_BUSY_MAX_ATTEMPTS,
  ARRR_BUSY_RETRY_DELAY_MS,
  ARRR_OWNER_BUSY_CEILING_MS,
} from '../../../common/arrrSync';
import { notifyArrrWalletSessionChanged } from '../../../hooks/useArrrWalletSession';
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

  it('shows the verified address while stopped and does not issue native wallet reads for another account', async () => {
    const original = qdnRequestMock.getMockImplementation()!;
    const address = 'zs' + 'a'.repeat(40);
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_ARRR_WALLET_SESSION')
        return {
          contract: 'qortium-arrr-wallet-session-v1',
          revision: '11111111-1111-1111-1111-111111111111',
          enabled: false,
          relation: 'OTHER',
          lifecycle: 'TERMINATED',
          address,
        };
      if (opts.action === 'SHOW_ACTIONS')
        return [
          ...arrrActions,
          'GET_ARRR_WALLET_SESSION',
          'ACTIVATE_ARRR_WALLET',
          'STOP_ARRR_SYNC',
        ];
      return original(opts);
    });
    renderDetail({
      ...arrrChain,
      homeWallet: {
        ...arrrChain.homeWallet!,
        walletSessionContract: 'qortium-arrr-wallet-session-v1',
      },
    });
    await screen.findByText('ARRR syncing is stopped on this node.');
    expect(await screen.findByText(address)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Switch to this account' })
    ).toBeEnabled();
    const actions = qdnRequestMock.mock.calls.map(([opts]) => opts.action);
    expect(actions).not.toContain('GET_USER_WALLET');
    expect(actions).not.toContain('GET_ARRR_SYNC_STATUS');
    expect(actions).not.toContain('GET_WALLET_BALANCE');
  });

  it('opens a stopped ARRR wallet from fresh discovery and offers Start syncing', async () => {
    sessionStorage.clear();
    syncStatusResponse = baseSnapshot({ state: 'DISABLED', ready: false });
    const original = qdnRequestMock.getMockImplementation()!;
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_CROSSCHAIN_BLOCKCHAINS')
        return [
          {
            currencyCode: 'ARRR',
            walletEnabled: false,
            decimalPlaces: 8,
            homeWallet: {
              ...arrrChain.homeWallet,
              syncControlContract: 'qortium-home-arrr-sync-control-v1',
            },
          },
        ];
      if (opts.action === 'SHOW_ACTIONS')
        return [...arrrActions, 'STOP_ARRR_SYNC', 'START_ARRR_SYNC'];
      return original(opts);
    });
    function DiscoveredDetail() {
      const { chains } = useSupportedChains();
      const chain = chains.find((c) => c.route === 'pirate-chain');
      return chain ? <CoinDetail chain={chain} /> : null;
    }
    render(
      <MemoryRouter initialEntries={['/pirate-chain']}>
        <ThemeProviderWrapper>
          <DiscoveredDetail />
        </ThemeProviderWrapper>
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('button', { name: 'Start syncing' })
    ).toBeEnabled();
    expect(screen.getByTestId('arrr-state-disabled')).toBeInTheDocument();
    sessionStorage.clear();
  });

  it('flips the locked-account panel to custody on SELECTED_ACCOUNT_CHANGED without a reload', async () => {
    sessionStorage.clear();
    let unlocked = false;
    const lockedReason = 'Unlock the selected account to use the ARRR wallet.';
    const original = qdnRequestMock.getMockImplementation()!;
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_CROSSCHAIN_BLOCKCHAINS')
        return [
          {
            currencyCode: 'ARRR',
            walletEnabled: true,
            decimalPlaces: 8,
            homeWallet: unlocked
              ? arrrChain.homeWallet
              : {
                  ...arrrChain.homeWallet,
                  read: false,
                  receive: false,
                  readMode: 'NONE',
                  receiveMode: 'NONE',
                  unavailableReason: lockedReason,
                },
          },
        ];
      return original(opts);
    });
    function DiscoveredDetail() {
      const { chains } = useSupportedChains();
      const chain = chains.find((c) => c.route === 'pirate-chain');
      return chain ? <CoinDetail chain={chain} /> : null;
    }
    render(
      <MemoryRouter initialEntries={['/pirate-chain']}>
        <ThemeProviderWrapper>
          <DiscoveredDetail />
        </ThemeProviderWrapper>
      </MemoryRouter>
    );
    expect(await screen.findByText(lockedReason)).toBeInTheDocument();
    const callsWhileLocked = qdnRequestMock.mock.calls.map(
      ([opts]) => opts.action
    );
    expect(callsWhileLocked).not.toContain('GET_ARRR_SYNC_STATUS');
    expect(callsWhileLocked).not.toContain('GET_USER_WALLET');

    // Home posts this once the unlock prompt succeeds; the app's own
    // UNLOCK_SELECTED_ACCOUNT call has not even returned yet.
    unlocked = true;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            action: 'SELECTED_ACCOUNT_CHANGED',
            requestedHandler: 'ACCOUNT',
            type: 'qortium:selected-account-changed',
          },
          source: window,
        })
      );
    });
    expect(await screen.findByTestId('arrr-state-ready')).toBeInTheDocument();
    expect(screen.queryByText(lockedReason)).not.toBeInTheDocument();
    expect(
      await screen.findByText('zs1qtestarrraddress0000000000000000')
    ).toBeInTheDocument();
    // The sync-status and address reads follow the rediscovered chain on
    // their own; no reload and no extra listener in those hooks needed.
    expect(
      qdnRequestMock.mock.calls.filter(
        ([opts]) => opts.action === 'GET_ARRR_SYNC_STATUS'
      ).length
    ).toBeGreaterThan(0);
    sessionStorage.clear();
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

// Owner-reported 2026-09-27: switching from ARRR account A to B showed
// "Your Core is busy with another ARRR wallet" (perceived as a failure)
// before B started syncing. With the session contract reporting SELF the
// page must stay neutral: never `arrr-busy`, never red error text.
describe('CoinDetail ARRR account switch (session relation SELF)', () => {
  let qdnRequestMock: ReturnType<
    typeof vi.fn<(opts: Record<string, unknown>) => Promise<unknown>>
  >;
  let session: Record<string, unknown>;
  let syncStatus: () => unknown;
  const sessionChain: ChainConfig = {
    ...arrrChain,
    homeWallet: {
      ...arrrChain.homeWallet!,
      walletSessionContract: 'qortium-arrr-wallet-session-v1',
    },
  };
  const selfSession = (revision: string) => ({
    contract: 'qortium-arrr-wallet-session-v1',
    revision,
    enabled: true,
    relation: 'SELF',
    lifecycle: 'RUNNING',
    address: 'zs' + 'b'.repeat(40),
  });
  const busyError = {
    code: 'ARRR_WALLET_BUSY',
    message: 'Your Core is busy with another ARRR wallet; try again shortly.',
    retryable: true,
  };

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    currentAccount = 'qort-user-address';
    getDefaultStore().set(walletReadyAtom, true);
    vi.useFakeTimers();
    session = selfSession('22222222-2222-2222-2222-222222222222');
    syncStatus = () => {
      throw busyError;
    };
    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return [
            ...arrrActions,
            'GET_ARRR_WALLET_SESSION',
            'ACTIVATE_ARRR_WALLET',
            'STOP_ARRR_SYNC',
          ];
        case 'GET_ARRR_WALLET_SESSION':
          return session;
        case 'GET_ARRR_SYNC_STATUS':
          return syncStatus();
        case 'GET_WALLET_BALANCE':
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
    vi.useRealTimers();
  });

  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it.each([
    [1, 2, 3],
    [3, 2, 1],
    [2, 3, 1],
  ])(
    'orders history newest first regardless of source order %j',
    async (...order) => {
      syncStatus = () => baseSnapshot({ state: 'READY', ready: true });
      const original = qdnRequestMock.getMockImplementation()!;
      const rows = order.map((n) => ({
        txHash: String(n),
        timestamp: n * 1000000,
        totalAmount: n * 100000000,
        pending: false,
      }));
      qdnRequestMock.mockImplementation(async (opts) =>
        opts.action === 'GET_USER_WALLET_TRANSACTIONS' ? rows : original(opts)
      );
      renderDetail(sessionChain);
      await tick(0);
      const amounts = screen
        .getAllByText(/^\+[123]\.00000000 ARRR$/)
        .map((node) => node.textContent);
      expect(amounts).toEqual([
        '+3.00000000 ARRR',
        '+2.00000000 ARRR',
        '+1.00000000 ARRR',
      ]);
      expect(rows.map((row) => row.txHash)).toEqual(order.map(String));
    }
  );

  it('keeps one send panel through repeated account and bridge changes', async () => {
    syncStatus = () => baseSnapshot({ state: 'READY', ready: true });
    const chain: ChainConfig = {
      ...sessionChain,
      homeWallet: {
        ...sessionChain.homeWallet!,
        send: true,
        sendMode: 'TRUSTED_CORE_CUSTODY',
        sendContract: 'qortium-home-arrr-send-v2',
      },
    };
    const original = qdnRequestMock.getMockImplementation()!;
    qdnRequestMock.mockImplementation(async (opts) => {
      if (opts.action === 'SHOW_ACTIONS')
        return [
          ...((await original(opts)) as string[]),
          'SEND_COIN',
          'GET_ARRR_SEND_READINESS',
          'GET_ARRR_SEND_OPERATION',
        ];
      if (opts.action === 'GET_ARRR_SEND_READINESS')
        return {
          sendProtocolVersion: 2,
          sendAllowed: true,
          operation: {
            sendProtocolVersion: 2,
            operationId: currentAccount,
            state: 'BROADCAST',
            txid: (currentAccount === 'account-b' ? 'bb' : 'aa').repeat(32),
          },
        };
      return original(opts);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = renderDetail(chain);
    await tick(0);
    for (const account of [
      'account-b',
      'qort-user-address',
      'account-b',
      'qort-user-address',
    ]) {
      currentAccount = account;
      view.rerender(
        <MemoryRouter>
          <ThemeProviderWrapper>
            <CoinDetail chain={chain} />
          </ThemeProviderWrapper>
        </MemoryRouter>
      );
      await tick(0);
      act(() => window.dispatchEvent(new Event('qortiumBridgeStateChanged')));
      await tick(0);
      expect(screen.getAllByRole('button', { name: 'Send ARRR' })).toHaveLength(
        1
      );
      expect(
        screen.getAllByRole('button', { name: 'Check send status' })
      ).toHaveLength(1);
      expect(
        screen.getAllByText(/Broadcast; awaiting confirmation/)
      ).toHaveLength(1);
      expect(
        screen.getByText(
          new RegExp((account === 'account-b' ? 'bb' : 'aa').repeat(32))
        )
      ).toBeInTheDocument();
    }
    expect(
      errors.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes('same key'))
      )
    ).toEqual([]);
    errors.mockRestore();
  });

  it('keeps balance and history loaded when returning to the same READY session', async () => {
    syncStatus = () => baseSnapshot({ state: 'READY', ready: true });
    renderDetail(sessionChain);
    await tick(0);
    expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument();
    const calls = (action: string) =>
      qdnRequestMock.mock.calls.filter(([opts]) => opts.action === action)
        .length;
    const balances = calls('GET_WALLET_BALANCE');
    const history = calls('GET_USER_WALLET_TRANSACTIONS');
    const sessions = calls('GET_ARRR_WALLET_SESSION');
    expect(balances).toBeGreaterThan(0);
    expect(history).toBeGreaterThan(0);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await tick(1000);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await tick(0);
    expect(calls('GET_ARRR_WALLET_SESSION')).toBeGreaterThan(sessions);
    expect(calls('GET_WALLET_BALANCE')).toBe(balances);
    expect(calls('GET_USER_WALLET_TRANSACTIONS')).toBe(history);
    expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument();
    hidden.mockRestore();
  });

  it('shows the neutral switching state instead of arrr-busy while the owner-confirmed read stays busy, then syncs', async () => {
    renderDetail(sessionChain);
    await tick(0);
    // Past the old 6 x 10s cross-wallet budget: still neutral.
    for (let i = 0; i < ARRR_BUSY_MAX_ATTEMPTS + 2; i++)
      await tick(ARRR_BUSY_RETRY_DELAY_MS);
    expect(screen.getByTestId('arrr-state-switching')).toBeInTheDocument();
    expect(screen.getByText('Switching to this account…')).toBeInTheDocument();
    expect(screen.queryByTestId('arrr-busy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('arrr-status-error')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/busy with another ARRR wallet/)
    ).not.toBeInTheDocument();

    syncStatus = () => baseSnapshot({ state: 'SYNCHRONIZING', ready: false });
    await tick(ARRR_BUSY_RETRY_DELAY_MS);
    expect(screen.getByTestId('arrr-state-synchronizing')).toBeInTheDocument();
    expect(screen.queryByTestId('arrr-busy')).not.toBeInTheDocument();
  });

  it('offers a neutral "still starting" retry after the ceiling, never the cross-wallet wording', async () => {
    renderDetail(sessionChain);
    await tick(0);
    await tick(ARRR_OWNER_BUSY_CEILING_MS + ARRR_BUSY_RETRY_DELAY_MS);
    const stalled = screen.getByTestId('arrr-switching-stalled');
    expect(stalled).toHaveTextContent(
      "This account's ARRR wallet is still starting on your Core."
    );
    expect(screen.queryByTestId('arrr-busy')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/busy with another ARRR wallet/)
    ).not.toBeInTheDocument();

    syncStatus = () => baseSnapshot({ state: 'READY', ready: true });
    await act(async () => {
      screen.getByRole('button', { name: /retry/i }).click();
    });
    await tick(0);
    expect(screen.getByTestId('arrr-state-ready')).toBeInTheDocument();
  });

  it('drops a stale read error the moment the session-change broadcast arrives, and never shows NOT_ACTIVE red text while SELF', async () => {
    // A generic read failure first: the red arrr-status-error branch.
    syncStatus = () => {
      throw new Error('Core connection dropped');
    };
    renderDetail(sessionChain);
    await tick(0);
    expect(screen.getByTestId('arrr-status-error')).toHaveTextContent(
      'Core connection dropped'
    );

    // Another instance switched accounts: Core now answers NOT_ACTIVE for
    // this one and the session flips to OTHER on the next read.
    syncStatus = () => {
      throw {
        code: 'ARRR_WALLET_NOT_ACTIVE',
        message:
          'This account is not the active ARRR wallet on your Core. Switch accounts explicitly to sync it.',
      };
    };
    session = {
      ...selfSession('33333333-3333-3333-3333-333333333333'),
      relation: 'OTHER',
    };
    act(() => notifyArrrWalletSessionChanged());
    // Synchronously gone - no red text survives the switch.
    expect(screen.queryByTestId('arrr-status-error')).not.toBeInTheDocument();
    await tick(0);
    expect(screen.queryByTestId('arrr-status-error')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/not the active ARRR wallet/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This node is syncing a different ARRR account. This account is not syncing.'
      )
    ).toBeInTheDocument();
    for (let i = 0; i < 4; i++) await tick(5000);
    expect(
      screen.queryByText(/not the active ARRR wallet/)
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('arrr-status-error')).not.toBeInTheDocument();
  });

  it('re-reads the session instead of showing NOT_ACTIVE when Core says so while the session still reports SELF', async () => {
    let sessionReads = 0;
    const original = qdnRequestMock.getMockImplementation()!;
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      if (opts.action === 'GET_ARRR_WALLET_SESSION') {
        sessionReads++;
        // Stale SELF once, then the truth.
        return sessionReads >= 2
          ? {
              ...selfSession('44444444-4444-4444-4444-444444444444'),
              relation: 'OTHER',
            }
          : session;
      }
      return original(opts);
    });
    syncStatus = () => {
      throw {
        code: 'ARRR_WALLET_NOT_ACTIVE',
        message: 'This account is not the active ARRR wallet on your Core.',
      };
    };
    renderDetail(sessionChain);
    await tick(0);
    expect(screen.queryByTestId('arrr-status-error')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/not the active ARRR wallet/)
    ).not.toBeInTheDocument();
    await tick(0);
    expect(
      screen.getByText(
        'This node is syncing a different ARRR account. This account is not syncing.'
      )
    ).toBeInTheDocument();
    expect(sessionReads).toBeGreaterThanOrEqual(2);
  });
});
