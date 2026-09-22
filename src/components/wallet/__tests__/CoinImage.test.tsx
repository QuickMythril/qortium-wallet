import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoinImage } from '../CoinImage';

// Core's THUMBNAIL route can answer a first view with a temporary HTTP 503
// while it builds the image in the background - the <img> fires onError
// once for that, then the real image is servable moments later. CoinImage
// retries the same URL (cache-busted) a few times before giving up to the
// placeholder.
describe('CoinImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the letter-circle placeholder when the url is null', () => {
    render(<CoinImage url={null} ticker="BTC" size={32} />);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('retries with a cache-busting param after onError and ends up showing the image', () => {
    render(
      <CoinImage url="https://node.example/thumb.png" ticker="BTC" size={32} />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://node.example/thumb.png');

    fireEvent.error(img);
    // While waiting for the retry, the placeholder covers the broken-image icon.
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    const retried = screen.getByRole('img') as HTMLImageElement;
    expect(retried.src).toBe('https://node.example/thumb.png?retry=1');
    // No further error fires this time - the retry "ends with the image".
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('falls back to the placeholder for good once every retry has also failed', () => {
    render(
      <CoinImage url="https://node.example/thumb.png" ticker="ETH" size={32} />
    );

    // Exhaust all 4 backoff retries (1.5s/4s/10s/25s).
    for (let i = 0; i < 4; i++) {
      const img = screen.getByRole('img');
      fireEvent.error(img);
      act(() => {
        vi.advanceTimersByTime(30000);
      });
    }

    // A 5th failure, with no retries left, gives up permanently.
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('resets its retry state when the url prop changes', () => {
    const { rerender } = render(
      <CoinImage url="https://node.example/a.png" ticker="AAA" size={32} />
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(
      <CoinImage url="https://node.example/b.png" ticker="BBB" size={32} />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://node.example/b.png');
  });
});
