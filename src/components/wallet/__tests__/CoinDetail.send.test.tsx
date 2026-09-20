import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore } from 'jotai';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { CoinDetail } from '../CoinDetail';
import type { ChainConfig } from '../../../config/chains';
import { decimalToAtomic } from '../../../utils/walletSend';
import * as resolveContactModule from '../../../utils/resolveContact';
import { walletReadyAtom } from '../../../state/global/system';
import { HOME_WALLET_CONTRACT } from '../../../common/homeWalletCapabilities';
import {
  invalidateCachedAccountUnlocked,
  setCachedAccountUnlocked,
} from '../../../common/accountUnlockState';

vi.mock('../../../utils/resolveContact');

vi.mock('react-qr-code', () => ({
  default: () => null,
}));

// The unlock-state cache is a module-level singleton shared across every
// test in this file (and beyond) - reset it so one test's cached "unlocked"
// result never leaks into the next.
afterEach(() => {
  invalidateCachedAccountUnlocked();
});

vi.mock('qapp-core', () => ({
  useAuth: () => ({ address: 'qort-user-address', name: 'testuser' }),
}));

vi.mock('../../../hooks/useMarketPrices', () => ({
  useMarketPrices: () => ({}),
}));

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
    contract: HOME_WALLET_CONTRACT,
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

function preparedResult(opts: Record<string, unknown>) {
  const amount = opts.sendMax
    ? '123456789'
    : String(decimalToAtomic(String(opts.amount), 8));

  return {
    action: 'SEND_COIN',
    amount,
    prepared: {
      activeNetwork: 'MAIN',
      amount,
      fee: '10000',
      // The Home bridge returns prepared fee rates as atomic integer strings.
      feePerByte: '20000',
      inputAmount: String(BigInt(amount) + 10000n),
      inputCount: 2,
      outputAmount: amount,
      outputCount: opts.sendMax ? 1 : 2,
      receivingAddress: opts.recipient,
      transactionSize: 225,
      txHash: 'prepared-hash',
      sendMax: Boolean(opts.sendMax),
      blockchain: 'BTC',
      currencyCode: 'BTC',
    },
    recipient: opts.recipient,
    txHash: 'prepared-hash',
    sendMax: Boolean(opts.sendMax),
  };
}

function renderDetail(chain = btcChain, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProviderWrapper>
        <CoinDetail chain={chain} />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

function sendCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls
    .map(([opts]) => opts as Record<string, unknown>)
    .filter((opts) => opts.action === 'SEND_COIN');
}

async function openSendDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^send$/i }));
  await screen.findByLabelText(/amount \(BTC\)/i);
  await waitFor(() =>
    expect(screen.getByLabelText(/optional fee per byte/i)).toHaveValue(0.0002)
  );
}

describe('CoinDetail QORT qortalRequest flow', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;
  let qortalRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    getDefaultStore().set(walletReadyAtom, true);
    qdnRequestMock = vi.fn(async () => null);
    qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_QORT'];
        case 'GET_USER_ACCOUNT':
          return { address: 'qort-wallet-address' };
        case 'GET_BALANCE':
          return '12.5';
        case 'SEARCH_TRANSACTIONS':
          return [];
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_QORT':
          return { accepted: true };
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
    (globalThis as any).qortalRequest = qortalRequestMock;
  });

  afterEach(() => {
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
    delete (globalThis as any).qortalRequest;
  });

  it('loads QORT data and makes exactly one advertised SEND_QORT request', async () => {
    const user = userEvent.setup();
    renderDetail(qortChain);

    await waitFor(() =>
      expect(qortalRequestMock).toHaveBeenCalledWith({
        action: 'GET_BALANCE',
        address: 'qort-wallet-address',
      })
    );
    expect(qortalRequestMock).toHaveBeenCalledWith({
      action: 'SEARCH_TRANSACTIONS',
      txType: ['PAYMENT'],
      address: 'qort-wallet-address',
      confirmationStatus: 'CONFIRMED',
      limit: 20,
      reverse: true,
    });

    await user.click(await screen.findByRole('button', { name: /^send$/i }));
    await user.type(screen.getByLabelText(/amount \(QORT\)/i), '1.25');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'qort-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() =>
      expect(
        qortalRequestMock.mock.calls.filter(
          ([request]) => request.action === 'SEND_QORT'
        )
      ).toHaveLength(1)
    );
    expect(qortalRequestMock).toHaveBeenCalledWith({
      action: 'SEND_QORT',
      recipient: 'qort-recipient-address',
      amount: 1.25,
    });
    expect(qortalRequestMock).not.toHaveBeenCalledWith({
      action: 'UNLOCK_SELECTED_ACCOUNT',
    });
    expect(
      qdnRequestMock.mock.calls.some(
        ([request]) =>
          request.action === 'SEND_QORT' || request.action === 'SEND_COIN'
      )
    ).toBe(false);
  });

  it('treats a null/undefined SEND_QORT result as an error, never success', async () => {
    qortalRequestMock.mockImplementation(
      async (opts: Record<string, unknown>) => {
        switch (opts.action) {
          case 'SHOW_ACTIONS':
            return ['SEND_QORT'];
          case 'GET_USER_ACCOUNT':
            return { address: 'qort-wallet-address' };
          case 'GET_BALANCE':
            return '12.5';
          case 'SEARCH_TRANSACTIONS':
            return [];
          case 'SEND_QORT':
            return undefined;
          default:
            return null;
        }
      }
    );
    const user = userEvent.setup();
    renderDetail(qortChain);

    await user.click(await screen.findByRole('button', { name: /^send$/i }));
    await user.type(screen.getByLabelText(/amount \(QORT\)/i), '1.25');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'qort-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    expect(
      await screen.findByText(/home returned no send result/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/transaction sent/i)).not.toBeInTheDocument();
  });

  it('does not trust the qdnRequest-populated unlock cache for a native send whose unlock actually goes through qortalRequest', async () => {
    // Simulate the cache having been populated true by Home's qdnRequest
    // GET_SELECTED_ACCOUNT (e.g. from AppLayout's mount check) - it must be
    // ignored for this chain, since qortBridge() prefers qortalRequest here.
    setCachedAccountUnlocked(true);

    qortalRequestMock.mockImplementation(
      async (opts: Record<string, unknown>) => {
        switch (opts.action) {
          case 'SHOW_ACTIONS':
            return ['SEND_QORT', 'UNLOCK_SELECTED_ACCOUNT'];
          case 'GET_USER_ACCOUNT':
            return { address: 'qort-wallet-address' };
          case 'GET_BALANCE':
            return '12.5';
          case 'SEARCH_TRANSACTIONS':
            return [];
          case 'UNLOCK_SELECTED_ACCOUNT':
            return { isUnlocked: true };
          case 'SEND_QORT':
            return { accepted: true };
          default:
            return null;
        }
      }
    );
    const user = userEvent.setup();
    renderDetail(qortChain);

    await user.click(await screen.findByRole('button', { name: /^send$/i }));
    await user.type(screen.getByLabelText(/amount \(QORT\)/i), '1.25');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'qort-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() =>
      expect(
        qortalRequestMock.mock.calls.filter(
          ([request]) => request.action === 'UNLOCK_SELECTED_ACCOUNT'
        )
      ).toHaveLength(1)
    );
    // The qdnRequest side must never have been consulted for this unlock.
    expect(
      qdnRequestMock.mock.calls.some(
        ([request]) => request.action === 'GET_SELECTED_ACCOUNT'
      )
    ).toBe(false);
  });
});

describe('CoinDetail foreign send flow', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return '123456789';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        case 'GET_FOREIGN_FEE':
          return { fee: '0.0002' };
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_COIN':
          return preparedResult(opts);
        default:
          return null;
      }
    });

    (globalThis as any).qdnRequest = qdnRequestMock;
  });

  afterEach(() => {
    delete (globalThis as any).qdnRequest;
  });

  it('sends fixed foreign amounts with feePerByte and renders the prepared preview', async () => {
    const user = userEvent.setup();
    renderDetail();

    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1.25');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() => expect(sendCalls(qdnRequestMock)).toHaveLength(1));
    const payload = sendCalls(qdnRequestMock)[0];

    expect(payload).toMatchObject({
      action: 'SEND_COIN',
      coin: 'BTC',
      recipient: 'btc-recipient-address',
      amount: '1.25',
      feePerByte: '0.0002',
    });
    expect(payload).not.toHaveProperty('fee');
    expect(payload).not.toHaveProperty('sendMax');

    expect(
      await screen.findByTestId('prepared-transaction-preview')
    ).toBeInTheDocument();
    expect(screen.getByText(/fixed amount/i)).toBeInTheDocument();
    expect(screen.getAllByText('1.25000000 BTC').length).toBeGreaterThan(0);
    expect(screen.getByText('prepared-hash')).toBeInTheDocument();
  });

  it('sends max foreign amounts without an amount field', async () => {
    const user = userEvent.setup();
    renderDetail();

    await openSendDialog(user);
    await user.click(screen.getByLabelText(/send max/i));
    expect(screen.getByLabelText(/amount \(BTC\)/i)).toBeDisabled();
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() => expect(sendCalls(qdnRequestMock)).toHaveLength(1));
    const payload = sendCalls(qdnRequestMock)[0];

    expect(payload).toMatchObject({
      action: 'SEND_COIN',
      coin: 'BTC',
      recipient: 'btc-recipient-address',
      sendMax: true,
      feePerByte: '0.0002',
    });
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('fee');

    expect(await screen.findByText(/send max/i)).toBeInTheDocument();
    expect(screen.getAllByText('1.23456789 BTC').length).toBeGreaterThan(0);
  });

  it('blocks invalid amount, fee, and recipient values', async () => {
    const user = userEvent.setup();
    renderDetail();

    await openSendDialog(user);
    const amountInput = screen.getByLabelText(/amount \(BTC\)/i);
    const recipientInput = screen.getByLabelText(/recipient address/i);
    const feeInput = screen.getByLabelText(/optional fee per byte/i);
    const confirm = screen.getByRole('button', { name: /confirm send/i });

    await user.type(amountInput, '0');
    await user.type(recipientInput, 'btc-recipient-address');
    expect(confirm).toBeDisabled();

    await user.clear(amountInput);
    await user.type(amountInput, '1');
    await user.clear(feeInput);
    await user.type(feeInput, '0');
    expect(confirm).toBeDisabled();

    await user.clear(feeInput);
    await user.type(feeInput, '0.0002');
    fireEvent.change(recipientInput, { target: { value: 'a'.repeat(257) } });
    expect(confirm).toBeDisabled();
    expect(sendCalls(qdnRequestMock)).toHaveLength(0);
  });

  it('revokes an open send dialog immediately on a bridge-state change', async () => {
    const user = userEvent.setup();
    renderDetail();

    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    const confirm = screen.getByRole('button', { name: /confirm send/i });
    expect(confirm).toBeEnabled();

    qdnRequestMock.mockImplementation((opts: Record<string, unknown>) =>
      opts.action === 'SHOW_ACTIONS'
        ? new Promise(() => {})
        : Promise.resolve(null)
    );
    window.dispatchEvent(new Event('qortiumBridgeStateChanged'));

    await waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.click(confirm);
    expect(sendCalls(qdnRequestMock)).toHaveLength(0);
  });

  it('treats a null/undefined SEND_COIN result as an error, never success', async () => {
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return '123456789';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        case 'GET_FOREIGN_FEE':
          return { fee: '0.0002' };
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_COIN':
          return null;
        default:
          return null;
      }
    });
    const user = userEvent.setup();
    renderDetail();

    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    expect(
      await screen.findByText(/home returned no send result/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/transaction sent/i)).not.toBeInTheDocument();
  });

  it('drops the post-send balance/transaction refresh if the component unmounts first', async () => {
    getDefaultStore().set(walletReadyAtom, true);
    try {
      const user = userEvent.setup();
      const { unmount } = renderDetail();

      await openSendDialog(user);
      await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
      await user.type(
        screen.getByLabelText(/recipient address/i),
        'btc-recipient-address'
      );
      await user.click(screen.getByRole('button', { name: /confirm send/i }));
      await screen.findByText(/transaction sent/i);

      const countByAction = (action: string) =>
        qdnRequestMock.mock.calls.filter(([o]) => o.action === action).length;
      const balanceCallsAtSend = countByAction('GET_WALLET_BALANCE');
      const txCallsAtSend = countByAction('GET_USER_WALLET_TRANSACTIONS');

      unmount();

      // Let the 3s post-send refresh timer's window pass for real - it must
      // have been cleared on unmount rather than firing into a dead
      // component.
      await new Promise((resolve) => setTimeout(resolve, 3200));

      expect(countByAction('GET_WALLET_BALANCE')).toBe(balanceCallsAtSend);
      expect(countByAction('GET_USER_WALLET_TRANSACTIONS')).toBe(txCallsAtSend);
    } finally {
      getDefaultStore().set(walletReadyAtom, false);
    }
  }, 10000);

  it('retries a balance fetch exactly once when the error is retryable, then succeeds', async () => {
    getDefaultStore().set(walletReadyAtom, true);
    try {
      let balanceCalls = 0;
      qdnRequestMock.mockImplementation(
        async (opts: Record<string, unknown>) => {
          switch (opts.action) {
            case 'SHOW_ACTIONS':
              return [
                'SEND_COIN',
                'GET_WALLET_BALANCE',
                'UNLOCK_SELECTED_ACCOUNT',
              ];
            case 'GET_USER_WALLET':
              return { address: 'btc-wallet-address' };
            case 'GET_WALLET_BALANCE':
              balanceCalls++;
              if (balanceCalls === 1) {
                return Promise.reject({
                  message: 'temporary hiccup',
                  retryable: true,
                });
              }
              return '250000000';
            case 'GET_USER_WALLET_TRANSACTIONS':
              return [];
            default:
              return null;
          }
        }
      );
      renderDetail();

      await waitFor(() => expect(balanceCalls).toBe(2), { timeout: 3000 });
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: /retry balance/i })
        ).not.toBeInTheDocument()
      );
      expect(
        screen.queryByText(/balance unavailable/i)
      ).not.toBeInTheDocument();
    } finally {
      getDefaultStore().set(walletReadyAtom, false);
    }
  });
});

describe('CoinDetail foreign capability refusal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    getDefaultStore().set(walletReadyAtom, true);
  });

  afterEach(() => {
    getDefaultStore().set(walletReadyAtom, false);
    delete (globalThis as any).qdnRequest;
  });

  it('does not infer foreign wallet operations from generic actions without the versioned chain contract', async () => {
    const request = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'SHOW_ACTIONS') {
        return ['SEND_COIN', 'GET_WALLET_BALANCE'];
      }
      return null;
    });
    (globalThis as any).qdnRequest = request;

    renderDetail({ ...btcChain, homeWallet: undefined });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
    );
    expect(
      request.mock.calls.some(
        ([options]) =>
          options.action === 'GET_USER_WALLET' ||
          options.action === 'GET_WALLET_BALANCE' ||
          options.action === 'GET_USER_WALLET_TRANSACTIONS' ||
          options.action === 'SEND_COIN'
      )
    ).toBe(false);
  });

  it('keeps a deep-linked send dialog inert without the versioned chain contract', async () => {
    const request = vi.fn(async (opts: Record<string, unknown>) => {
      if (opts.action === 'SHOW_ACTIONS') {
        return ['SEND_COIN', 'GET_WALLET_BALANCE'];
      }
      return null;
    });
    (globalThis as any).qdnRequest = request;

    renderDetail({ ...btcChain, homeWallet: undefined }, [
      '/bitcoin?send=true',
    ]);

    await userEvent.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await userEvent.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    const confirm = screen.getByRole('button', { name: /confirm send/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(sendCalls(request)).toHaveLength(0);
  });
});

describe('CoinDetail recipient-by-name flow', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return '123456789';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        case 'GET_FOREIGN_FEE':
          return { fee: '0.0002' };
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_COIN':
          return preparedResult(opts);
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
  });

  afterEach(() => {
    delete (globalThis as any).qdnRequest;
  });

  it('defaults to Address mode with the plain recipient field', async () => {
    const user = userEvent.setup();
    renderDetail();
    await openSendDialog(user);

    expect(screen.getByLabelText(/recipient address/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/recipient's qortium name/i)
    ).not.toBeInTheDocument();
  });

  it('switching to Name mode resolves and displays the address, and Confirm Send uses it', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact).mockResolvedValue({
      status: 'resolved',
      address: 'btc-resolved-address',
      coin: 'BTC',
      name: 'Alice',
    });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );

    expect(
      await screen.findByText(
        /sending to Alice's BTC address: btc-resolved-address/i
      )
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1.25');
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() => expect(sendCalls(qdnRequestMock)).toHaveLength(1));
    expect(sendCalls(qdnRequestMock)[0]).toMatchObject({
      recipient: 'btc-resolved-address',
    });
  });

  it('shows the coin-not-published message and disables Confirm Send', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact).mockResolvedValue({
      status: 'coin-not-published',
      name: 'Alice',
      coin: 'BTC',
    });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1.25');

    expect(
      await screen.findByText(
        /alice hasn't published an address for this coin/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm send/i })
    ).toBeDisabled();
  });

  it('re-resolves right before sending and blocks if the address changed since the field was filled', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact)
      .mockResolvedValueOnce({
        status: 'resolved',
        address: 'btc-old-address',
        coin: 'BTC',
        name: 'Alice',
      })
      .mockResolvedValueOnce({
        status: 'resolved',
        address: 'btc-new-address',
        coin: 'BTC',
        name: 'Alice',
      });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );
    await screen.findByText(/btc-old-address/i);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1.25');

    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() =>
      expect(screen.getByText(/btc-new-address/i)).toBeInTheDocument()
    );
    expect(sendCalls(qdnRequestMock)).toHaveLength(0);
    expect(
      await screen.findByText(
        /the resolved address changed - please review and confirm again/i
      )
    ).toBeInTheDocument();
  });

  it('shows the name-not-found message and disables Confirm Send', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact).mockResolvedValue({
      status: 'name-not-found',
      name: 'Ghost',
    });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Ghost'
    );

    expect(
      await screen.findByText(/no Qortium name found matching "Ghost"/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm send/i })
    ).toBeDisabled();
  });

  it('shows the no-card message and disables Confirm Send', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact).mockResolvedValue({
      status: 'no-card',
      name: 'Alice',
    });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );

    expect(
      await screen.findByText(/alice doesn't have a contact card yet/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm send/i })
    ).toBeDisabled();
  });

  it('shows the fetch-failed message and disables Confirm Send', async () => {
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact).mockResolvedValue({
      status: 'fetch-failed',
      name: 'Alice',
    });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );

    expect(
      await screen.findByText(/couldn't check right now - try again/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm send/i })
    ).toBeDisabled();
  });

  it('blocks Confirm Send while a new debounce is pending after the recipient name changes again', async () => {
    // Uses real timers throughout. `resolvingRecipient` flips to true
    // synchronously inside the debounce effect (before its setTimeout is
    // even scheduled), so the button disables well within the 800ms window
    // without needing to fake/advance any clock - avoiding the flakiness
    // that comes from mixing userEvent's own timing with fake timers.
    const user = userEvent.setup();
    vi.mocked(resolveContactModule.resolveContact)
      .mockResolvedValueOnce({
        status: 'resolved',
        address: 'btc-alice-address',
        coin: 'BTC',
        name: 'Alice',
      })
      .mockResolvedValueOnce({
        status: 'resolved',
        address: 'btc-bob-address',
        coin: 'BTC',
        name: 'Bob',
      });

    renderDetail();
    await openSendDialog(user);
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await user.type(
      screen.getByLabelText(/recipient's qortium name/i),
      'Alice'
    );

    // Let the real 800ms debounce fire and resolve "Alice" before moving on.
    expect(
      await screen.findByText(/sending to Alice's BTC address/i)
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1.25');

    // Edit the recipient name IN PLACE (append a character) rather than
    // clearing it first. Clearing would trip the debounce effect's
    // empty-name branch, which resets `recipient` to '' itself - that would
    // make `recipientIsValid` alone disable the button, proving nothing
    // about the resolution-status gate this test exists to cover. Keeping
    // the field non-empty the whole time means `recipient` stays at the
    // stale-but-syntactically-valid "Alice" address while a fresh,
    // not-yet-fired debounce starts - the only thing that can disable the
    // button in that window is `resolvingRecipient`/`resolution.status`.
    await user.type(screen.getByLabelText(/recipient's qortium name/i), 'x');

    const confirm = screen.getByRole('button', { name: /confirm send/i });
    // Bounded well under the 800ms debounce: proves the button disables
    // promptly once `recipientName` changes, not merely "eventually".
    await waitFor(() => expect(confirm).toBeDisabled(), { timeout: 300 });

    // Click anyway (fireEvent bypasses the disabled attribute a real click
    // would respect) - proves handleSend is never reached even if a click
    // somehow slips through, not just that the button looks disabled.
    fireEvent.click(confirm);

    expect(sendCalls(qdnRequestMock)).toHaveLength(0);

    // Let the pending "Bob" resolution land so no timers/state updates leak
    // into later tests.
    await screen.findByText(/sending to Bob's BTC address/i);
    expect(sendCalls(qdnRequestMock)).toHaveLength(0);
  });
});

describe('CoinDetail structured send errors (W1)', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;
  let sendCoinResult: Record<string, unknown>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    getDefaultStore().set(walletReadyAtom, true);

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return '123456789';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        case 'GET_FOREIGN_FEE':
          return { fee: '0.0002' };
        case 'GET_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_COIN':
          return sendCoinResult;
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

  it('shows a pending state - never success - when a foreign send resolves with an ambiguous outcome', async () => {
    sendCoinResult = {
      accepted: false,
      foreignOutcome: 'unknown',
      error: 'broadcast outcome could not be confirmed',
      retryable: false,
    };
    const user = userEvent.setup();
    renderDetail();
    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    expect(
      await screen.findByText(/transaction status unknown/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/broadcast outcome could not be confirmed/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/transaction sent/i)).not.toBeInTheDocument();
  });

  it('shows the decoded rejection message - never success - when a foreign send is rejected outright', async () => {
    sendCoinResult = {
      accepted: false,
      error: 'insufficient funds for fee',
    };
    const user = userEvent.setup();
    renderDetail();
    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    expect(
      await screen.findByText(/insufficient funds for fee/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/transaction sent/i)).not.toBeInTheDocument();
  });

  it('shows a decoded balance error with a manual retry affordance when the balance fetch fails', async () => {
    qdnRequestMock.mockImplementation(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return Promise.reject({
            message: 'backend unavailable',
            code: 'FOREIGN_WALLET_BACKEND_UNAVAILABLE',
          });
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        default:
          return null;
      }
    });
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByText(/balance unavailable/i)).toBeInTheDocument();

    const balanceCallsBefore = qdnRequestMock.mock.calls.filter(
      ([o]) => o.action === 'GET_WALLET_BALANCE'
    ).length;
    // Not marked retryable - fetchBalance should not have retried on its own.
    expect(balanceCallsBefore).toBe(1);

    await user.click(screen.getByRole('button', { name: /retry balance/i }));
    await waitFor(() =>
      expect(
        qdnRequestMock.mock.calls.filter(
          ([o]) => o.action === 'GET_WALLET_BALANCE'
        ).length
      ).toBeGreaterThan(balanceCallsBefore)
    );
  });
});

describe('CoinDetail redundant-unlock avoidance (W2)', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;
  let selectedAccountUnlocked: boolean;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    selectedAccountUnlocked = true;

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'SHOW_ACTIONS':
          return ['SEND_COIN', 'GET_WALLET_BALANCE', 'UNLOCK_SELECTED_ACCOUNT'];
        case 'GET_USER_WALLET':
          return { address: 'btc-wallet-address' };
        case 'GET_WALLET_BALANCE':
          return '123456789';
        case 'GET_USER_WALLET_TRANSACTIONS':
          return [];
        case 'GET_FOREIGN_FEE':
          return { fee: '0.0002' };
        case 'GET_SELECTED_ACCOUNT':
          return { isUnlocked: selectedAccountUnlocked };
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'SEND_COIN':
          return { accepted: true };
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;
  });

  afterEach(() => {
    delete (globalThis as any).qdnRequest;
  });

  it('skips UNLOCK_SELECTED_ACCOUNT when GET_SELECTED_ACCOUNT reports the account is already unlocked', async () => {
    selectedAccountUnlocked = true;
    const user = userEvent.setup();
    renderDetail();
    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() => expect(sendCalls(qdnRequestMock)).toHaveLength(1));
    expect(
      qdnRequestMock.mock.calls.filter(
        ([o]) => o.action === 'UNLOCK_SELECTED_ACCOUNT'
      )
    ).toHaveLength(0);
  });

  it('calls UNLOCK_SELECTED_ACCOUNT exactly once when the account is locked', async () => {
    selectedAccountUnlocked = false;
    const user = userEvent.setup();
    renderDetail();
    await openSendDialog(user);
    await user.type(screen.getByLabelText(/amount \(BTC\)/i), '1');
    await user.type(
      screen.getByLabelText(/recipient address/i),
      'btc-recipient-address'
    );
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() => expect(sendCalls(qdnRequestMock)).toHaveLength(1));
    expect(
      qdnRequestMock.mock.calls.filter(
        ([o]) => o.action === 'UNLOCK_SELECTED_ACCOUNT'
      )
    ).toHaveLength(1);
  });
});
