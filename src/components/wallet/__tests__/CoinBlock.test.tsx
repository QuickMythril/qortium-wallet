import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import { CoinBlock } from '../CoinGrid';
import type { ChainConfig } from '../../../config/chains';

const IMAGE_URL =
  'https://node.example/render/THUMBNAIL/Wallet/wallet-coin-btc';

vi.mock('../../../hooks/useCoinImageUrl', () => ({
  useCoinImageUrl: () => IMAGE_URL,
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
};

function renderBlock(
  overrides: Partial<React.ComponentProps<typeof CoinBlock>> = {}
) {
  return render(
    <MemoryRouter>
      <ThemeProviderWrapper>
        <CoinBlock
          chain={btcChain}
          balance="1.25"
          canReceive
          canSend
          loading={false}
          tileSize={3}
          onRetryBalance={() => {}}
          {...overrides}
        />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

describe('CoinBlock (CoinGrid tile view) coin image retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries the coin image on onError and renders the img again on success, without changing the tile markup', () => {
    renderBlock();

    const img = screen.getByRole('img', { name: 'BTC' }) as HTMLImageElement;
    expect(img.src).toBe(IMAGE_URL);

    fireEvent.error(img);
    // While waiting for the retry, the tile's own placeholder (letter
    // circle) shows instead of a broken-image icon, and the tile's
    // absolute-positioned image wrapper layout is untouched.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    const retried = screen.getByRole('img', {
      name: 'BTC',
    }) as HTMLImageElement;
    expect(retried.src).toBe(`${IMAGE_URL}?retry=1`);
    // No further error fires - the retry "ends with the image" and the
    // placeholder is gone.
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });
});

// Codex round 5 review finding 1: a provisional ARRR total (verified
// balance unknown) must render with an explicit "verifying" qualifier on
// the grid tile too, and must never be confused for the null spendable
// `balance`.
describe('CoinBlock provisionalTotal (round 5 review finding 1)', () => {
  it('renders a provisional total with a "verifying" qualifier when balance is null', () => {
    renderBlock({ balance: null, provisionalTotal: '1.50000000' });
    expect(screen.getByText('1.50000000')).toBeInTheDocument();
    expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument();
  });

  it('prefers the real spendable balance over a leftover provisionalTotal once it is known', () => {
    renderBlock({ balance: '1.40000000', provisionalTotal: '1.50000000' });
    expect(screen.getByText('1.40000000')).toBeInTheDocument();
    expect(screen.queryByText(/verifying/i)).not.toBeInTheDocument();
  });
});

it.each([null, 'zs-cached-own-address'])(
  'uses passive receive metadata without a native read on hover (%s)',
  (cachedAddress) => {
    const request = vi.fn();
    (globalThis as any).qdnRequest = request;
    renderBlock({ cachedAddress });
    fireEvent.mouseOver(screen.getByRole('img', { name: 'BTC' }));
    expect(request).not.toHaveBeenCalled();
  }
);
