import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import type { ChainConfig } from '../../../config/chains';
import { CoinListRow } from '../CoinListRow';

vi.mock('../../../hooks/useCoinImageUrl', () => ({
  useCoinImageUrl: () => null,
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
  activeNetwork: 'TEST3',
  supportsHtlc: true,
  supportsLocalChainTrades: true,
};

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

const writeTextMock = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderRow(
  overrides: Partial<React.ComponentProps<typeof CoinListRow>> = {}
) {
  return render(
    <MemoryRouter>
      <ThemeProviderWrapper>
        <CoinListRow
          chain={btcChain}
          balance="1.25"
          canReceive
          canSend
          loading={false}
          fiatDisplay="$75,000.00"
          dragHandleProps={{ tabIndex: 0 }}
          {...overrides}
        />
        <LocationProbe />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

describe('CoinListRow', () => {
  beforeEach(() => {
    (globalThis as any).qdnRequest = vi.fn(async () => ({
      address: 'btc-wallet-address',
    }));
    (globalThis as any).qortalRequest = vi.fn(async () => ({
      address: 'qort-wallet-address',
    }));
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
  });

  it('copies a stopped ARRR account cached address without a native read', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });
    renderRow({ chain: arrrChain, cachedAddress: 'zs-cached-own-address' });
    await user.click(screen.getByRole('button', { name: 'copy ARRR address' }));
    expect(writeTextMock).toHaveBeenCalledWith('zs-cached-own-address');
    expect(qdnRequest).not.toHaveBeenCalled();
  });

  it('shows wallet identity, balances, network, and accessible actions', () => {
    renderRow();

    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('test3')).toBeInTheDocument();
    expect(screen.getByText('1.25')).toBeInTheDocument();
    expect(screen.getByText('$75,000.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'reorder BTC' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'copy BTC address' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'send BTC' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'open BTC wallet' })
    ).toBeVisible();
  });

  it('fetches and copies the address without requiring hover', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    renderRow();

    await user.click(screen.getByRole('button', { name: 'copy BTC address' }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith('btc-wallet-address')
    );
    expect(globalThis.qdnRequest).toHaveBeenCalledWith({
      action: 'GET_USER_WALLET',
      coin: 'BTC',
    });
  });

  it('fetches QORT addresses through qortalRequest', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    renderRow({ chain: qortChain, fiatDisplay: undefined });

    await user.click(screen.getByRole('button', { name: 'copy QORT address' }));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith('qort-wallet-address')
    );
    expect(globalThis.qortalRequest).toHaveBeenCalledWith({
      action: 'GET_USER_ACCOUNT',
    });
    expect(globalThis.qdnRequest).not.toHaveBeenCalled();
  });

  it('opens the detail and send routes from always-visible actions', async () => {
    const user = userEvent.setup();
    const { rerender } = renderRow();

    await user.click(screen.getByRole('button', { name: 'open BTC wallet' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/bitcoin');

    rerender(
      <MemoryRouter>
        <ThemeProviderWrapper>
          <CoinListRow
            chain={btcChain}
            balance="1.25"
            canReceive
            canSend
            loading={false}
          />
          <LocationProbe />
        </ThemeProviderWrapper>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'send BTC' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/bitcoin?send=true'
    );
  });

  it('removes the reorder control outside custom sorting', () => {
    renderRow({ dragHandleProps: undefined });
    expect(
      screen.queryByRole('button', { name: 'reorder BTC' })
    ).not.toBeInTheDocument();
  });

  // Codex round 5 review finding 1: a provisional ARRR total (verified
  // balance unknown) must render with an explicit "verifying" qualifier,
  // and must never be confused for the null spendable `balance`.
  it('renders a provisional total with a "verifying" qualifier, never as the spendable balance, when balance is null', () => {
    renderRow({
      chain: arrrChain,
      balance: null,
      provisionalTotal: '1.50000000',
      fiatDisplay: undefined,
    });
    expect(screen.getByText('1.50000000')).toBeInTheDocument();
    expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    // The generic "unavailable" retry affordance (for a real balance
    // error) must not appear alongside a provisional total.
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument();
  });

  it('prefers the real spendable balance over a leftover provisionalTotal once it is known', () => {
    renderRow({
      chain: arrrChain,
      balance: '1.40000000',
      provisionalTotal: '1.50000000',
      fiatDisplay: undefined,
    });
    expect(screen.getByText('1.40000000')).toBeInTheDocument();
    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument();
  });
});
