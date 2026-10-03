import i18n from '../../../i18n/i18n';
import { clearXmrProgress } from '../../../common/xmrProgress';
import { StrictMode } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { XmrWalletPanel } from '../XmrWalletPanel';
import { KNOWN_CHAIN_MAP, type ChainConfig } from '../../../config/chains';
import {
  XMR_CONTRACT,
  formatXmr,
  parseXmrSnapshot,
} from '../../../common/xmrWallet';
import { foreignWalletAvailability } from '../../../common/homeWalletCapabilities';
let account = 'account-A';
vi.mock('qapp-core', () => ({ useAuth: () => ({ address: account }) }));
vi.mock('react-qr-code', () => ({
  default: () => <div data-testid="receive-qr" />,
}));
const address =
  '45v3kdD45enUKsTFnoodawHbDeHmcRj51GFp2SLkSVMsfe9meRVru8iUmH4ycSzd9vJaaLNcCPMqLbYvLQRdNaBvJn4hXF1';
const tx = (id: string, timestamp: number) => ({
  txid: id.repeat(64),
  timestamp,
  confirmed: true,
  incomingAtomic: '1',
  outgoingAtomic: '0',
  feeAtomic: '0',
});
const snapshot = () => ({
  contract: XMR_CONTRACT,
  state: 'READY',
  send: false,
  wallet: {
    address,
    height: 100,
    targetHeight: 100,
    synced: true,
    balanceAtomic: '9007199254740993',
    unlockedAtomic: '1',
    transactions: [tx('a', 1), tx('b', 2)],
  },
});
const chain: ChainConfig = {
  ...KNOWN_CHAIN_MAP.get('XMR')!,
  homeWallet: {
    contract: 'qortium-home-wallet-v1',
    custodyContract: XMR_CONTRACT,
    implemented: true,
    protocol: 'qdnRequest',
    read: true,
    receive: true,
    requiresUnlockedAccount: true,
    send: false,
    serverManagement: false,
    readMode: 'TRUSTED_CORE_CUSTODY',
    receiveMode: 'TRUSTED_CORE_CUSTODY',
    sendMode: 'NONE',
    serverManagementMode: 'NONE',
  },
};
const view = () => (
  <MemoryRouter>
    <XmrWalletPanel chain={chain} />
  </MemoryRouter>
);
const bridge = vi.fn();
beforeEach(() => {
  clearXmrProgress();
  void i18n.changeLanguage('en');
  account = 'account-A';
  vi.stubGlobal('qdnRequest', bridge);
  bridge.mockReset();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('XMR receive and history', () => {
  it('preserves atomic precision, sorts newest first, and excludes generic wallet actions', async () => {
    expect(formatXmr('9007199254740993')).toBe('9007.199254740993');
    expect(formatXmr('1')).toBe('0.000000000001');
    expect(() =>
      parseXmrSnapshot({
        ...snapshot(),
        wallet: { ...snapshot().wallet, balanceAtomic: 2 },
      })
    ).toThrow();
    expect(
      foreignWalletAvailability(chain, ['GET_USER_WALLET', 'SEND_COIN']).canSend
    ).toBe(false);
    bridge.mockResolvedValue(snapshot());
    render(view());
    await screen.findByText('Balance: 9007.199254740993 XMR');
    expect(
      screen
        .getByText('b'.repeat(64))
        .compareDocumentPosition(screen.getByText('a'.repeat(64))) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(bridge).toHaveBeenCalledWith({
      action: 'GET_XMR_WALLET',
      coin: 'XMR',
      passive: false,
    });
    expect(
      screen.queryByRole('button', { name: /send/i })
    ).not.toBeInTheDocument();
  });
  it('opens inactive without activation; activation is explicit', async () => {
    bridge.mockResolvedValue({
      contract: XMR_CONTRACT,
      state: 'INACTIVE',
      send: false,
      wallet: null,
    });
    render(view());
    const button = await screen.findByRole('button', {
      name: 'Activate this wallet',
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(bridge).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    await waitFor(() =>
      expect(bridge).toHaveBeenCalledWith({
        action: 'ACTIVATE_XMR_WALLET',
        coin: 'XMR',
      })
    );
  });
  it('unlocks then refreshes without manual reload', async () => {
    bridge
      .mockRejectedValueOnce({ code: 'ACCOUNT_LOCKED', message: 'Locked' })
      .mockResolvedValueOnce({ isUnlocked: true })
      .mockResolvedValue(snapshot());
    render(view());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Unlock account' })
    );
    await screen.findByText(address);
    expect(bridge).toHaveBeenCalledWith({ action: 'UNLOCK_SELECTED_ACCOUNT' });
  });
  it('discards an old reply across account changes and never overlaps bridge reads', async () => {
    let resolveOld!: (value: unknown) => void;
    bridge
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue({
        ...snapshot(),
        wallet: { ...snapshot().wallet, address: '4' + 'B'.repeat(94) },
      });
    const ui = render(view());
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(1));
    account = 'account-B';
    ui.rerender(view());
    await act(async () => {
      resolveOld(snapshot());
    });
    await screen.findByText('4' + 'B'.repeat(94));
    expect(screen.queryByText(address)).not.toBeInTheDocument();
    expect(screen.getAllByText('Receive XMR')).toHaveLength(1);
  });
  it('preserves the displayed wallet on tab return and makes only passive refreshes', async () => {
    bridge.mockResolvedValue(snapshot());
    render(view());
    await screen.findByText(address);
    for (let n = 0; n < 4; n++) {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      fireEvent(document, new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
      fireEvent(document, new Event('visibilitychange'));
      expect(screen.getByText(address)).toBeInTheDocument();
      await waitFor(() => expect(bridge).toHaveBeenCalledTimes(n + 2));
    }
    expect(screen.getAllByTestId('receive-qr')).toHaveLength(1);
    expect(
      bridge.mock.calls
        .slice(1)
        .every(([r]) => r.action === 'GET_XMR_WALLET' && r.passive === true)
    ).toBe(true);
  });
  it('stops polling after denial and clears displayed authority on account notification', async () => {
    bridge
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValue({ code: 'XMR_ACCESS_UNAVAILABLE' });
    render(view());
    await screen.findByText(address);
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByRole('alert');
    expect(screen.queryByText(address)).not.toBeInTheDocument();
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {});
    expect(bridge).toHaveBeenCalledTimes(2);
    bridge.mockResolvedValue({
      contract: XMR_CONTRACT,
      state: 'INACTIVE',
      send: false,
      wallet: null,
    });
    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: { action: 'SELECTED_ACCOUNT_CHANGED' },
      })
    );
    await screen.findByRole('button', { name: 'Activate this wallet' });
  });
  it('automatic account and bridge events remain passive after denial', async () => {
    bridge.mockRejectedValue({ code: 'XMR_READ_APPROVAL_REQUIRED' });
    render(view());
    await screen.findByRole('alert');
    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: { action: 'SELECTED_ACCOUNT_CHANGED' },
      })
    );
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(2));
    fireEvent(window, new Event('qortiumBridgeStateChanged'));
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(3));
    expect(bridge.mock.calls.slice(1).every(([r]) => r.passive === true)).toBe(
      true
    );
  });
  it('retains accepted activation status when a one-shot read approval expires', async () => {
    bridge
      .mockResolvedValueOnce({
        contract: XMR_CONTRACT,
        state: 'INACTIVE',
        send: false,
        wallet: null,
      })
      .mockResolvedValueOnce({
        contract: XMR_CONTRACT,
        state: 'OPENING',
        send: false,
        wallet: null,
      })
      .mockRejectedValue({ code: 'XMR_READ_APPROVAL_REQUIRED' });
    render(view());
    const activate = await screen.findByRole('button', {
      name: 'Activate this wallet',
    });
    await waitFor(() => expect(activate).toBeEnabled());
    fireEvent.click(activate);
    await screen.findByText('Wallet status: opening');
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText(
      'Automatic updates are paused. Refresh status to approve wallet reads.'
    );
    expect(screen.getByText('Wallet status: opening')).toBeInTheDocument();
    expect(bridge.mock.calls[2][0].passive).toBe(true);
  });
  it('never replays an activation after an account prop change', async () => {
    bridge.mockResolvedValue({
      contract: XMR_CONTRACT,
      state: 'INACTIVE',
      send: false,
      wallet: null,
    });
    const ui = render(view());
    const activate = await screen.findByRole('button', {
      name: 'Activate this wallet',
    });
    await waitFor(() => expect(activate).toBeEnabled());
    fireEvent.click(activate);
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(2));
    account = 'account-B';
    ui.rerender(view());
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(3));
    expect(bridge.mock.calls[2][0]).toEqual({
      action: 'GET_XMR_WALLET',
      coin: 'XMR',
      passive: true,
    });
  });
  it('survives StrictMode and rapid account notifications without replaying activation', async () => {
    bridge.mockResolvedValue({
      contract: XMR_CONTRACT,
      state: 'INACTIVE',
      send: false,
      wallet: null,
    });
    render(<StrictMode>{view()}</StrictMode>);
    const button = await screen.findByRole('button', {
      name: 'Activate this wallet',
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        bridge.mock.calls.filter(([r]) => r.action === 'ACTIVATE_XMR_WALLET')
      ).toHaveLength(1)
    );
    act(() => {
      for (let i = 0; i < 4; i++)
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: { action: 'SELECTED_ACCOUNT_CHANGED' },
          })
        );
    });
    await waitFor(() =>
      expect(bridge.mock.calls[bridge.mock.calls.length - 1]?.[0]).toEqual({
        action: 'GET_XMR_WALLET',
        coin: 'XMR',
        passive: true,
      })
    );
    expect(
      bridge.mock.calls.filter(([r]) => r.action === 'ACTIVATE_XMR_WALLET')
    ).toHaveLength(1);
  });
  it('labels an old synced snapshot stale when Core no longer considers it current', async () => {
    bridge.mockResolvedValue({ ...snapshot(), state: 'STALE' });
    render(view());
    await screen.findByText(
      'Updating balances and history. The scan continues automatically.'
    );
    expect(
      screen.queryByText('Synced', { exact: true })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/last recorded wallet snapshot/)
    ).toBeInTheDocument();
  });
});

describe('XMR passive scan recovery', () => {
  it('recovers SCANNING → STALE → UNAVAILABLE → SCANNING without reload, retaining only scoped display', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const scanning = {
      ...snapshot(),
      state: 'SCANNING',
      updatedAt: at,
      wallet: { ...snapshot().wallet, synced: false },
      progress: {
        scanId: '11111111-1111-4111-8111-111111111111',
        startHeight: 0,
        height: 30,
        targetHeight: 100,
        updatedAt: at,
      },
    };
    bridge
      .mockResolvedValueOnce(scanning)
      .mockResolvedValueOnce({ ...scanning, state: 'STALE', wallet: null })
      .mockResolvedValueOnce({
        ...scanning,
        state: 'UNAVAILABLE',
        wallet: null,
        progress: null,
      })
      .mockResolvedValue({
        ...scanning,
        progress: { ...scanning.progress, height: 60, updatedAt: at + 25000 },
      });
    render(view());
    await act(async () => {});
    expect(screen.getByText(/Syncing.*30/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      screen.getByText(/last recorded wallet snapshot/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('Balance: 9007.199254740993 XMR')
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText(/Retrying automatically/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByText(/Syncing.*60/)).toBeInTheDocument();
    expect(
      screen.queryByText(/last recorded wallet snapshot/)
    ).not.toBeInTheDocument();
    expect(bridge).toHaveBeenCalledTimes(4);
    expect(
      bridge.mock.calls
        .slice(1)
        .every(([r]) => r.passive === true && r.action === 'GET_XMR_WALLET')
    ).toBe(true);
  });
  it('stops passive recovery when custody approval expires and never refreshes stale ETA by polling', async () => {
    vi.useFakeTimers();
    bridge
      .mockResolvedValueOnce({ ...snapshot(), state: 'STALE', wallet: null })
      .mockRejectedValue({ code: 'XMR_READ_APPROVAL_REQUIRED' });
    render(view());
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      screen.getByText(/Automatic updates are paused/)
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});

it('keeps a pending send preparation alive across a queued wallet poll and stale balances', async () => {
  vi.useFakeTimers();
  let prepared!: (v: unknown) => void;
  let walletRead!: (v: unknown) => void;
  let reads = 0;
  let sendView: unknown;
  const sendContract = 'qortium-home-xmr-send-v1';
  const none = {
    contract: sendContract,
    handle: null,
    state: 'NONE',
    walletHeld: false,
  };
  sendView = none;
  bridge.mockImplementation(({ action }) =>
    action === 'GET_XMR_WALLET'
      ? ++reads === 1
        ? Promise.resolve({ ...snapshot(), updatedAt: Date.now() })
        : new Promise((resolve) => {
            walletRead = resolve;
          })
      : action === 'PREPARE_XMR_SEND'
        ? new Promise((resolve) => {
            prepared = resolve;
          })
        : Promise.resolve(sendView)
  );
  render(
    <MemoryRouter>
      <XmrWalletPanel
        chain={{
          ...chain,
          homeWallet: {
            ...chain.homeWallet!,
            send: true,
            sendMode: 'TRUSTED_CORE_CUSTODY',
            sendContract,
          },
        }}
      />
    </MemoryRouter>
  );
  await act(async () => {});
  fireEvent.click(screen.getByText('Send XMR'));
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Recipient XMR address'), {
    target: { value: address },
  });
  fireEvent.change(screen.getByLabelText('Amount (XMR)'), {
    target: { value: '0.01' },
  });
  fireEvent.click(screen.getByText('Review network fee'));
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(35000);
  });
  expect(
    bridge.mock.calls.filter(([r]) => r.action === 'GET_XMR_WALLET')
  ).toHaveLength(2);
  await act(async () => {
    sendView = {
      contract: sendContract,
      handle: '11111111-1111-1111-1111-111111111111',
      state: 'PREPARED',
      recipient: address,
      amountAtomic: '10000000000',
      feeAtomic: '10000000',
      expiresAt: Date.now() + 120000,
      walletHeld: true,
      canCancelPreparation: true,
    };
    prepared(sendView);
  });
  expect(
    screen.getByText('Network fee: 0.000010000000 XMR')
  ).toBeInTheDocument();
  expect(screen.getByText('Approve and send')).toBeDisabled();
  expect(screen.getByText('Refresh send status')).toBeEnabled();
  await act(async () => {
    walletRead({ ...snapshot(), updatedAt: Date.now() });
  });
  expect(screen.getByText('Approve and send')).toBeEnabled();
});
