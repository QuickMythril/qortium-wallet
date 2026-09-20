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
