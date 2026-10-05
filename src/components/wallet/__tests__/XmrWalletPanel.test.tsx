import { clearWalletDisplay } from '../../../common/walletDisplay';
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
vi.mock('../../../hooks/useCoinImageUrl', () => ({
  useCoinImageUrl: () => null,
}));
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
    stopContract: 'qortium-home-xmr-stop-v1',
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
  clearWalletDisplay('XMR');
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
    const exactAmount = await screen.findByText('9007.199254740993');
    expect(exactAmount.parentElement).toHaveTextContent('XMR');
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
      name: 'Start syncing',
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
    await screen.findByRole('button', { name: 'Start syncing' });
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
      name: 'Start syncing',
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
      name: 'Start syncing',
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
      name: 'Start syncing',
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
      'Balances and history will refresh after a complete wallet update.'
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
    expect(screen.getByText('9007.199254740993')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      screen.getAllByText(/wallet_progress.syncing|Wallet is syncing|Syncing/i)
        .length
    ).toBeGreaterThan(0);
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

describe('explicit XMR stop and resume', () => {
  const stopped = {
    contract: XMR_CONTRACT,
    state: 'STOPPED',
    send: false,
    wallet: null,
  };
  it('stops UNAVAILABLE retries, visibility refreshes and sending until explicit resume', async () => {
    vi.useFakeTimers();
    bridge.mockImplementation(({ action }) =>
      Promise.resolve(
        action === 'STOP_XMR_WALLET'
          ? stopped
          : { ...snapshot(), state: 'UNAVAILABLE' }
      )
    );
    render(view());
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    await act(async () => {});
    expect(screen.getByText(/Stop accepted/)).toBeInTheDocument();
    expect(bridge).toHaveBeenCalledWith({
      action: 'STOP_XMR_WALLET',
      coin: 'XMR',
    });
    const count = bridge.mock.calls.length;
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(bridge).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByRole('button', { name: 'Start syncing' }));
    await act(async () => {});
    expect(bridge).toHaveBeenLastCalledWith({
      action: 'ACTIVATE_XMR_WALLET',
      coin: 'XMR',
    });
  });
  it('queues a stop behind an in-flight read and discards its late ready reply', async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    let reads = 0;
    bridge.mockImplementation(({ action }) =>
      action === 'STOP_XMR_WALLET'
        ? Promise.resolve(stopped)
        : ++reads === 1
          ? Promise.resolve({ ...snapshot(), state: 'SCANNING' })
          : new Promise((resolve) => {
              finish = resolve;
            })
    );
    render(view());
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole('button', { name: 'Stop syncing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    await act(async () => {});
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Stopping wallet/)).toBeInTheDocument();
    await act(async () => {
      finish(snapshot());
    });
    expect(screen.getByText(/Stop accepted/)).toBeInTheDocument();
    expect(
      screen.queryByText('Synced', { exact: true })
    ).not.toBeInTheDocument();
    expect(bridge).toHaveBeenCalledTimes(3);
  });
  it('keeps retries paused after an unconfirmed stop and allows an explicit stop retry', async () => {
    vi.useFakeTimers();
    bridge.mockImplementation(({ action }) =>
      action === 'STOP_XMR_WALLET'
        ? Promise.reject({ code: 'XMR_ACCESS_UNAVAILABLE' })
        : Promise.resolve({ ...snapshot(), state: 'SCANNING' })
    );
    render(view());
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    await act(async () => {});
    expect(screen.getByText(/Stop was not confirmed/)).toBeInTheDocument();
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(bridge).toHaveBeenCalledTimes(2);
    bridge.mockResolvedValue(stopped);
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    await act(async () => {});
    expect(screen.getByText(/Stop accepted/)).toBeInTheDocument();
  });
  it('a remount reads inactive status without activating or restarting a stopped scan', async () => {
    bridge.mockResolvedValue({
      contract: XMR_CONTRACT,
      state: 'INACTIVE',
      send: false,
      wallet: null,
    });
    const ui = render(view());
    await screen.findByRole('button', { name: 'Start syncing' });
    ui.unmount();
    render(view());
    await screen.findByRole('button', { name: 'Start syncing' });
    expect(
      bridge.mock.calls.every(([r]) => r.action === 'GET_XMR_WALLET')
    ).toBe(true);
  });
  it('does not offer an unsupported stop action on older Home', async () => {
    bridge.mockResolvedValue(snapshot());
    render(
      <MemoryRouter>
        <XmrWalletPanel
          chain={{
            ...chain,
            homeWallet: { ...chain.homeWallet!, stopContract: undefined },
          }}
        />
      </MemoryRouter>
    );
    await screen.findByText(address);
    expect(
      screen.queryByRole('button', { name: 'Stop syncing' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/requires an updated desktop Home/)
    ).toBeInTheDocument();
  });
  it('uses coin-page chrome, bundled Monero images and the receive/history surfaces', async () => {
    bridge.mockResolvedValue(snapshot());
    render(view());
    await screen.findByText(address);
    expect(screen.getByRole('heading', { name: 'Monero' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to wallets' })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'XMR' })).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Copy XMR address' })
    ).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
  });
});

it('keeps paused controls usable across bridge changes without replaying a stop', async () => {
  bridge.mockImplementation(({ action }) =>
    Promise.resolve(
      action === 'STOP_XMR_WALLET'
        ? {
            contract: XMR_CONTRACT,
            state: 'STOPPED',
            send: false,
            wallet: null,
          }
        : snapshot()
    )
  );
  render(view());
  await screen.findByText(address);
  fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
  await screen.findByText(/Stop accepted/);
  const before = bridge.mock.calls.length;
  fireEvent(window, new Event('qortiumBridgeStateChanged'));
  await screen.findByText(
    /Automatic page updates are paused. Refresh status or activate/
  );
  expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Stop syncing' })).toBeEnabled();
  expect(bridge).toHaveBeenCalledTimes(before);
  expect(screen.queryByText(address)).not.toBeInTheDocument();
});
it('account changes cannot dispatch a queued stop for the old account', async () => {
  let finish!: (v: unknown) => void;
  let reads = 0;
  bridge.mockImplementation(({ action }) =>
    action === 'GET_XMR_WALLET' && ++reads === 2
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(snapshot())
  );
  const ui = render(view());
  await screen.findByText(address);
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(bridge).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
  account = 'account-B';
  ui.rerender(view());
  await act(async () => {
    finish(snapshot());
  });
  await waitFor(() => expect(bridge).toHaveBeenCalledTimes(3));
  expect(bridge.mock.calls.some(([r]) => r.action === 'STOP_XMR_WALLET')).toBe(
    false
  );
  expect(bridge.mock.calls[2][0]).toEqual({
    action: 'GET_XMR_WALLET',
    coin: 'XMR',
    passive: true,
  });
});

it('a late send preparation cannot re-enable sending after a stop', async () => {
  let prepared!: (v: unknown) => void;
  const sendContract = 'qortium-home-xmr-send-v1';
  bridge.mockImplementation(({ action }) =>
    action === 'GET_XMR_WALLET'
      ? Promise.resolve({ ...snapshot(), updatedAt: Date.now() })
      : action === 'STOP_XMR_WALLET'
        ? Promise.resolve({
            contract: XMR_CONTRACT,
            state: 'STOPPED',
            send: false,
            wallet: null,
          })
        : action === 'PREPARE_XMR_SEND'
          ? new Promise((resolve) => {
              prepared = resolve;
            })
          : Promise.resolve({
              contract: sendContract,
              handle: null,
              state: 'NONE',
              walletHeld: false,
            })
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
  await screen.findByText(address);
  fireEvent.click(screen.getByText('Send XMR'));
  await waitFor(() =>
    expect(screen.getByLabelText('Recipient XMR address')).toBeEnabled()
  );
  fireEvent.change(screen.getByLabelText('Recipient XMR address'), {
    target: { value: address },
  });
  fireEvent.change(screen.getByLabelText('Amount (XMR)'), {
    target: { value: '0.01' },
  });
  fireEvent.click(screen.getByText('Review network fee'));
  await waitFor(() =>
    expect(
      bridge.mock.calls.some(([r]) => r.action === 'PREPARE_XMR_SEND')
    ).toBe(true)
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
  await screen.findByText(/Stop accepted/);
  await act(async () => {
    prepared({
      contract: sendContract,
      handle: '11111111-1111-1111-1111-111111111111',
      state: 'PREPARED',
      recipient: address,
      amountAtomic: '10000000000',
      feeAtomic: '10000000',
      expiresAt: Date.now() + 120000,
      walletHeld: true,
      canCancelPreparation: true,
    });
  });
  expect(screen.getByText('Approve and send')).toBeDisabled();
  expect(screen.getByText('Send XMR')).toBeDisabled();
  expect(bridge.mock.calls.some(([r]) => r.action === 'COMMIT_XMR_SEND')).toBe(
    false
  );
});

it('read approval expiry does not hide the stop control for an already active Core wallet', async () => {
  bridge
    .mockResolvedValueOnce(snapshot())
    .mockRejectedValue({ code: 'XMR_READ_APPROVAL_REQUIRED' });
  render(view());
  await screen.findByText(address);
  fireEvent(document, new Event('visibilitychange'));
  await screen.findByText(/Automatic updates are paused/);
  expect(screen.getByRole('button', { name: 'Stop syncing' })).toBeEnabled();
});

it('requires unused-address affirmation and resets scan choice across account change', async () => {
  bridge.mockResolvedValue({
    contract: XMR_CONTRACT,
    state: 'INACTIVE',
    send: false,
    wallet: null,
  });
  const scanChain = {
    ...chain,
    homeWallet: {
      ...chain.homeWallet!,
      scanStartContract: 'qortium-home-wallet-scan-start-v1',
    },
  };
  const content = () => (
    <MemoryRouter>
      <XmrWalletPanel chain={scanChain} />
    </MemoryRouter>
  );
  const rendered = render(content());
  await screen.findByRole('combobox', { name: 'Wallet scan' });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Wallet scan' }));
  fireEvent.click(
    screen.getByRole('option', { name: 'New wallet — start at current tip' })
  );
  expect(screen.getByRole('button', { name: 'Start syncing' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'This address has never received funds',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start syncing' }));
  await waitFor(() =>
    expect(bridge).toHaveBeenCalledWith({
      action: 'ACTIVATE_XMR_WALLET',
      coin: 'XMR',
      scanMode: 'NEW_AT_CURRENT_TIP',
    })
  );
  account = 'account-B';
  rendered.rerender(content());
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Wallet scan' })
    ).toHaveTextContent('Resume saved progress')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start syncing' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start syncing' }));
  await waitFor(() =>
    expect(bridge).toHaveBeenLastCalledWith({
      action: 'ACTIVATE_XMR_WALLET',
      coin: 'XMR',
      scanMode: 'RESUME',
    })
  );
});

it('shows chain preparation without a wallet-scan percentage or ETA', async () => {
  bridge.mockResolvedValue({
    contract: XMR_CONTRACT,
    state: 'SCANNING',
    send: false,
    wallet: null,
    updatedAt: Date.now(),
    scanStart: { mode: 'NEW_AT_CURRENT_TIP', height: 100000 },
    preparation: {
      scanId: '11111111-1111-4111-8111-111111111111',
      startHeight: 0,
      height: 50000,
      targetHeight: 100000,
      updatedAt: Date.now(),
    },
  });
  render(view());
  await screen.findByText('Preparing chain history…');
  expect(
    screen.queryByText(/Estimated time remaining/)
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Preparing chain hashes up to block/)
  ).toBeInTheDocument();
});

it('reloads stale owner data from an explicit display snapshot without live readiness', async () => {
  bridge.mockResolvedValue({
    ...snapshot(),
    state: 'UNAVAILABLE',
    wallet: null,
    display: { data: snapshot().wallet, updatedAt: Date.now() },
    read: { state: 'OVERDUE', phase: 'SYNC', retryAt: null },
  });
  render(view());
  await screen.findByText(address);
  expect(screen.getByText(/Last observed/)).toBeInTheDocument();
  expect(screen.getByText('9007.199254740993')).toBeInTheDocument();
  expect(screen.queryByText('Synced', { exact: true })).toBeNull();
});
it('keeps approved last data after Stop but discards it on an unmounted host change', async () => {
  bridge.mockImplementation(async (request) =>
    request.action === 'STOP_XMR_WALLET'
      ? { ...snapshot(), state: 'STOPPED', wallet: null }
      : snapshot()
  );
  const mounted = render(
    <MemoryRouter>
      <XmrWalletPanel
        chain={{
          ...chain,
          homeWallet: {
            ...chain.homeWallet!,
            stopContract: 'qortium-home-xmr-stop-v1',
          },
        }}
      />
    </MemoryRouter>
  );
  await screen.findByText(address);
  fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
  await screen.findByText(/Stop accepted/);
  expect(screen.getByText(address)).toBeInTheDocument();
  mounted.unmount();
  window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
  bridge.mockRejectedValue({ code: 'ACCOUNT_LOCKED' });
  render(view());
  expect(screen.queryByText(address)).toBeNull();
  await screen.findByRole('button', { name: 'Unlock account' });
  expect(screen.queryByText(address)).toBeNull();
});
