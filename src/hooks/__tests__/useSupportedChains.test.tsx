import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSupportedChains } from '../useSupportedChains';
import { HOME_WALLET_CONTRACT } from '../../common/homeWalletCapabilities';

describe('useSupportedChains bridge availability', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete (globalThis as any).qdnRequest;
  });

  afterEach(() => {
    sessionStorage.clear();
    delete (globalThis as any).qdnRequest;
    vi.restoreAllMocks();
  });

  it('shows only QORT when hosted without qdnRequest', async () => {
    const { result } = renderHook(() => useSupportedChains());

    await waitFor(() => expect(result.current.status).toBe('fallback'));
    expect(result.current.walletAuthorityReady).toBe(false);
    expect(result.current.chains.map((chain) => chain.key)).toEqual(['QORT']);
  });

  it('preserves versioned Home capabilities and refreshes them on bridge changes', async () => {
    let send = true;
    const request = vi.fn(async () => [
      {
        currencyCode: 'BTC',
        walletEnabled: true,
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
          send,
          serverManagement: true,
          sendMode: send ? 'HOME_SIGNED_PUBLIC_NODE' : 'NONE',
          serverManagementMode: 'HOME_LOCAL',
        },
      },
    ]);
    (globalThis as any).qdnRequest = request;

    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.walletAuthorityReady).toBe(true);
    expect(result.current.chains[1].homeWallet?.send).toBe(true);
    expect(sessionStorage.getItem('qortium_supported_chains_v2')).toContain(
      HOME_WALLET_CONTRACT
    );

    send = false;
    window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
    await waitFor(() =>
      expect(result.current.chains[1].homeWallet?.send).toBe(false)
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps stopped ARRR discoverable across refresh and a fresh mount', async () => {
    let enabled = true;
    const capability = {
      contract: HOME_WALLET_CONTRACT,
      syncControlContract: 'qortium-home-arrr-sync-control-v1',
    };
    const request = vi.fn(async () => [
      {
        currencyCode: 'ARRR',
        walletEnabled: enabled,
        decimalPlaces: 8,
        homeWallet: capability,
      },
      { currencyCode: 'BTC', walletEnabled: false, homeWallet: capability },
    ]);
    (globalThis as any).qdnRequest = request;
    const first = renderHook(() => useSupportedChains());
    await waitFor(() => expect(first.result.current.status).toBe('live'));
    enabled = false;
    window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(first.result.current.status).toBe('live'));
    expect(first.result.current.chains.map((c) => c.key)).toEqual([
      'QORT',
      'ARRR',
    ]);
    first.unmount();
    sessionStorage.clear();
    const fresh = renderHook(() => useSupportedChains());
    await waitFor(() => expect(fresh.result.current.status).toBe('live'));
    expect(
      fresh.result.current.chains.find((c) => c.route === 'pirate-chain')
        ?.homeWallet
    ).toEqual(capability);
    expect(fresh.result.current.chains.map((c) => c.key)).toEqual([
      'QORT',
      'ARRR',
    ]);
  });

  it('does not expose a disabled ARRR wallet without the current Home control contract', async () => {
    (globalThis as any).qdnRequest = vi.fn(async () => [
      {
        currencyCode: 'ARRR',
        walletEnabled: false,
        homeWallet: { contract: HOME_WALLET_CONTRACT },
      },
    ]);
    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.chains.map((c) => c.key)).toEqual(['QORT']);
  });

  it('does not trust a cached wallet capability before live discovery', async () => {
    sessionStorage.setItem(
      'qortium_supported_chains_v2',
      JSON.stringify([
        {
          ...{
            key: 'BTC',
            decimalPlaces: 8,
            activeNetwork: 'MAIN',
            supportsHtlc: true,
            supportsLocalChainTrades: true,
          },
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
            sendMode: 'HOME_SIGNED_PUBLIC_NODE',
            serverManagement: false,
            serverManagementMode: 'NONE',
          },
        },
      ])
    );
    let resolveDiscovery!: (value: unknown) => void;
    (globalThis as any).qdnRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDiscovery = resolve;
        })
    );

    const { result } = renderHook(() => useSupportedChains());
    expect(result.current.status).toBe('pending');
    expect(result.current.chains[1].homeWallet).toBeUndefined();

    resolveDiscovery([]);
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.walletAuthorityReady).toBe(true);
  });

  it('adds read-only compatibility only for an exact maintained Home 1.x host', async () => {
    (globalThis as any).qdnRequest = vi.fn(async (request: any) => {
      if (request.action === 'GET_HOST_INFO') {
        return {
          hostName: 'qortium-home',
          hostVersion: '1.8.0',
          platform: 'desktop',
        };
      }
      return [
        {
          currencyCode: 'BTC',
          walletEnabled: true,
          decimalPlaces: 8,
          activeNetwork: 'MAIN',
          supportsHtlc: true,
          supportsLocalChainTrades: true,
        },
      ];
    });

    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.walletAuthorityReady).toBe(true);
    expect(result.current.chains[1].homeWallet).toMatchObject({
      contract: 'qortium-home-1.x-wallet-read-v1',
      read: true,
      receive: true,
      send: false,
      sendMode: 'NONE',
      serverManagement: true,
    });
    expect(globalThis.qdnRequest).toHaveBeenCalledWith({
      action: 'GET_HOST_INFO',
    });
  });

  it('does not trust a discovery row that self-asserts the local Home 1.x marker', async () => {
    (globalThis as any).qdnRequest = vi.fn(async (request: any) => {
      if (request.action === 'GET_HOST_INFO') {
        return { hostName: 'another-host', hostVersion: '9.0.0' };
      }
      return [
        {
          currencyCode: 'BTC',
          walletEnabled: true,
          decimalPlaces: 8,
          activeNetwork: 'MAIN',
          supportsHtlc: true,
          supportsLocalChainTrades: true,
          homeWallet: {
            contract: 'qortium-home-1.x-wallet-read-v1',
            implemented: true,
            protocol: 'qdnRequest',
            read: true,
            readMode: 'HOME_LOCAL',
            receive: true,
            receiveMode: 'HOME_LOCAL',
            requiresUnlockedAccount: true,
            send: false,
            sendMode: 'NONE',
            serverManagement: true,
            serverManagementMode: 'HOME_LOCAL',
          },
        },
      ];
    });

    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.walletAuthorityReady).toBe(true);
    expect(result.current.chains[1].homeWallet).toBeUndefined();
  });

  it('keeps wallet authority uncertain when required host identity lookup fails', async () => {
    (globalThis as any).qdnRequest = vi.fn(async (request: any) => {
      if (request.action === 'GET_HOST_INFO') {
        throw new Error('bridge changed');
      }
      return [
        {
          currencyCode: 'BTC',
          walletEnabled: true,
          decimalPlaces: 8,
          activeNetwork: 'MAIN',
          supportsHtlc: true,
          supportsLocalChainTrades: true,
        },
      ];
    });

    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(result.current.status).toBe('live'));
    expect(result.current.walletAuthorityReady).toBe(false);
    expect(result.current.chains[1].homeWallet).toBeUndefined();
  });

  it('ignores an older discovery response after a bridge refresh', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    (globalThis as any).qdnRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );

    const { result } = renderHook(() => useSupportedChains());
    await waitFor(() => expect(resolvers).toHaveLength(1));
    window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    resolvers[1]([]);
    await waitFor(() => expect(result.current.status).toBe('live'));
    resolvers[0]([
      {
        currencyCode: 'BTC',
        walletEnabled: true,
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
          sendMode: 'HOME_SIGNED_PUBLIC_NODE',
          serverManagement: false,
          serverManagementMode: 'NONE',
        },
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.chains.map((chain) => chain.key)).toEqual(['QORT']);
  });
});
