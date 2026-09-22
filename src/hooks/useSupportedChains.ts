import { useState, useEffect, useRef } from 'react';
import {
  DEFAULT_CHAINS,
  KNOWN_CHAIN_MAP,
  QORT_CHAIN,
  type ChainConfig,
  type HomeWalletCapability,
} from '../config/chains';
import {
  HOME_WALLET_CONTRACT,
  legacyHome1WalletCapability,
} from '../common/homeWalletCapabilities';

const SESSION_KEY = 'qortium_supported_chains_v2';
const SESSION_STATUS_KEY = 'qortium_chain_status_v2';

export type ChainDiscoveryStatus = 'pending' | 'live' | 'fallback';

interface SupportedBlockchainInfo {
  currencyCode: string;
  walletEnabled: boolean;
  decimalPlaces: number;
  activeNetwork: string;
  supportsHtlc: boolean;
  supportsLocalChainTrades: boolean;
  homeWallet?: HomeWalletCapability;
}

export function useSupportedChains(): {
  chains: ChainConfig[];
  status: ChainDiscoveryStatus;
  walletAuthorityReady: boolean;
} {
  const [chains, setChains] = useState<ChainConfig[]>(() => {
    // Seed from session cache so there's no flash on reload; otherwise start
    // empty so we never show unverified chains during the discovery phase.
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as ChainConfig[];
        const supported = parsed
          .map((chain): ChainConfig | undefined => {
            const known = KNOWN_CHAIN_MAP.get(chain.key);
            if (!known) return undefined;
            return {
              ...known,
              decimalPlaces: chain.decimalPlaces,
              activeNetwork: chain.activeNetwork,
              supportsHtlc: chain.supportsHtlc,
              supportsLocalChainTrades:
                chain.supportsLocalChainTrades ??
                known.supportsLocalChainTrades,
              // Cached discovery data is display-only. Wallet authority must
              // be re-established by the current Home instance.
              homeWallet: undefined,
            };
          })
          .filter((chain): chain is ChainConfig => chain !== undefined);
        if (supported.length > 0) return [QORT_CHAIN, ...supported];
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_STATUS_KEY);
      }
    }
    return [QORT_CHAIN];
  });
  const [status, setStatus] = useState<ChainDiscoveryStatus>('pending');
  const [walletAuthorityReady, setWalletAuthorityReady] = useState(false);
  const discoveryRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function discover() {
      const revision = ++discoveryRevision.current;
      if (typeof qdnRequest !== 'function') {
        if (cancelled || revision !== discoveryRevision.current) return;
        setChains([QORT_CHAIN]);
        setStatus('fallback');
        setWalletAuthorityReady(false);
        return;
      }
      try {
        const data: SupportedBlockchainInfo[] = await qdnRequest({
          action: 'GET_CROSSCHAIN_BLOCKCHAINS',
        });

        if (!Array.isArray(data)) throw new Error('Unexpected response shape');

        const requiresLegacyIdentity = data.some(
          (info) => info?.homeWallet?.contract !== HOME_WALLET_CONTRACT
        );
        let legacyHome1Capability: HomeWalletCapability | undefined;
        let authorityReady = true;
        if (requiresLegacyIdentity) {
          try {
            legacyHome1Capability = legacyHome1WalletCapability(
              await qdnRequest({ action: 'GET_HOST_INFO' })
            );
          } catch {
            // A failed identity lookup is uncertain, not proof that legacy
            // wallet authority is absent. Preserve durable notification rules.
            authorityReady = false;
          }
        }

        const merged: ChainConfig[] = data
          .filter(
            (info) =>
              info.currencyCode?.toUpperCase() !== 'QORT' &&
              (info.walletEnabled ||
                // Stopping ARRR flips Core's runtime walletEnabled flag.
                // Keep Home's restart-capable wallet discoverable so its
                // listing and detail route still expose Start syncing.
                (info.currencyCode?.toUpperCase() === 'ARRR' &&
                  info.homeWallet?.contract === HOME_WALLET_CONTRACT &&
                  info.homeWallet.syncControlContract ===
                    'qortium-home-arrr-sync-control-v1'))
          )
          .map((info): ChainConfig | undefined => {
            const code = info.currencyCode?.toUpperCase();
            const known = KNOWN_CHAIN_MAP.get(code);
            if (!known) {
              console.warn(
                `[Walletium] Unknown chain from node: "${info.currencyCode}" — add it to KNOWN_CHAINS in chains.ts`
              );
              return undefined;
            }
            return {
              ...known,
              decimalPlaces: info.decimalPlaces,
              activeNetwork:
                (info.activeNetwork as ChainConfig['activeNetwork']) ?? 'MAIN',
              supportsHtlc: info.supportsHtlc,
              supportsLocalChainTrades: info.supportsLocalChainTrades,
              // A discovery row cannot self-assert Wallet's local Home 1.x
              // compatibility marker. Only the current wire contract passes
              // through; legacy capability comes from verified host identity.
              homeWallet:
                info.homeWallet?.contract === HOME_WALLET_CONTRACT
                  ? info.homeWallet
                  : legacyHome1Capability,
            };
          })
          .filter((c): c is ChainConfig => c !== undefined);
        if (cancelled || revision !== discoveryRevision.current) return;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(merged));
        sessionStorage.setItem(SESSION_STATUS_KEY, 'live');
        setChains([QORT_CHAIN, ...merged]);
        setStatus('live');
        setWalletAuthorityReady(authorityReady);
      } catch (err) {
        if (cancelled || revision !== discoveryRevision.current) return;
        console.warn(
          '[Walletium] GET_CROSSCHAIN_BLOCKCHAINS unavailable:',
          err
        );
        setChains([QORT_CHAIN, ...DEFAULT_CHAINS]);
        setStatus('fallback');
        setWalletAuthorityReady(false);
      }
    }

    discover();
    const refresh = () => {
      // Revoke cached live authority immediately while the current Home
      // instance is rediscovered.
      setChains((current) =>
        current.map((chain) =>
          chain.isNative ? chain : { ...chain, homeWallet: undefined }
        )
      );
      setStatus('pending');
      setWalletAuthorityReady(false);
      discover();
    };
    window.addEventListener('qortiumBridgeStateChanged', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('qortiumBridgeStateChanged', refresh);
    };
  }, []);

  return { chains, status, walletAuthorityReady };
}
