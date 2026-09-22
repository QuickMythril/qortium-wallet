import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCoinImageUrl,
  __resetCoinImageUrlCacheForTests,
} from '../useCoinImageUrl';

beforeEach(() => {
  __resetCoinImageUrlCacheForTests();
});

afterEach(() => {
  delete (globalThis as any).qdnRequest;
  __resetCoinImageUrlCacheForTests();
});

describe('useCoinImageUrl', () => {
  it('does not cache a rejection - a later mount retries and can resolve', async () => {
    const qdnRequestMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('THUMBNAIL not built yet'))
      .mockResolvedValueOnce(
        'https://node.example/render/THUMBNAIL/Wallet/wallet-coin-btc'
      );
    (globalThis as any).qdnRequest = qdnRequestMock;

    const first = renderHook(() => useCoinImageUrl('BTC'));
    await waitFor(() => expect(qdnRequestMock).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBeNull();
    first.unmount();

    const second = renderHook(() => useCoinImageUrl('BTC'));
    await waitFor(() =>
      expect(second.result.current).toBe(
        'https://node.example/render/THUMBNAIL/Wallet/wallet-coin-btc'
      )
    );
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });

  it('caches a resolved URL and normalizes a relative value against the page origin', async () => {
    const qdnRequestMock = vi
      .fn()
      .mockResolvedValue('/render/THUMBNAIL/Wallet/wallet-coin-ltc');
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() => useCoinImageUrl('LTC'));
    await waitFor(() =>
      expect(result.current).toBe(
        `${window.location.origin}/render/THUMBNAIL/Wallet/wallet-coin-ltc`
      )
    );

    // A second mount for the same ticker reads the cache - no extra request.
    const again = renderHook(() => useCoinImageUrl('ltc'));
    expect(again.result.current).toBe(
      `${window.location.origin}/render/THUMBNAIL/Wallet/wallet-coin-ltc`
    );
    expect(qdnRequestMock).toHaveBeenCalledTimes(1);
  });

  it('retries after a qortiumBridgeStateChanged event following a rejection', async () => {
    const qdnRequestMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(
        'https://node.example/render/THUMBNAIL/Wallet/wallet-coin-doge'
      );
    (globalThis as any).qdnRequest = qdnRequestMock;

    const { result } = renderHook(() => useCoinImageUrl('DOGE'));
    await waitFor(() => expect(qdnRequestMock).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();

    window.dispatchEvent(new Event('qortiumBridgeStateChanged'));

    await waitFor(() =>
      expect(result.current).toBe(
        'https://node.example/render/THUMBNAIL/Wallet/wallet-coin-doge'
      )
    );
  });
});
