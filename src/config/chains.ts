export type HomeWalletMode =
  | 'HOME_LOCAL'
  | 'PUBLIC_NODE'
  | 'HOME_SIGNED_PUBLIC_NODE'
  | 'TRUSTED_CORE'
  // ARRR-only (round 5): a desktop, admin-trusted Core holds the wallet's
  // spending key and keeps a synced copy on the user's behalf. Distinct
  // from TRUSTED_CORE (which still signs from Home) - never valid for any
  // other coin, and never valid with send:true. See
  // homeWalletCapabilities.ts's coin-aware gate.
  | 'TRUSTED_CORE_CUSTODY'
  | 'NONE';

export interface HomeWalletCapability {
  contract?: string;
  implemented: boolean;
  protocol?: 'qdnRequest' | 'qortalRequest';
  read: boolean;
  receive: boolean;
  requiresUnlockedAccount: boolean;
  send: boolean;
  serverManagement: boolean;
  readMode: HomeWalletMode;
  receiveMode: HomeWalletMode;
  sendMode: HomeWalletMode;
  serverManagementMode: HomeWalletMode;
  // ARRR custody extension (round 5) - see the ARRR row of
  // HOME_V2_BRIDGE_COMPATIBILITY.md. `custodyContract` names the exact
  // custody wire contract; `syncStatus` advertises GET_ARRR_SYNC_STATUS
  // support; `unavailableReason` explains a false read/receive for ARRR
  // (locked account, Android, non-trusted route, old Home).
  custodyContract?: string;
  syncStatus?: boolean;
  syncControlContract?: string;
  walletSessionContract?: string;
  unavailableReason?: string;
}

export interface ChainConfig {
  key: string;
  name: string;
  ticker: string;
  coinEnum: string;
  route: string;
  defaultFee: number;
  isNative: boolean;
  decimalPlaces: number;
  activeNetwork: 'MAIN' | 'TEST3' | 'TEST4' | 'REGTEST';
  supportsHtlc: boolean;
  supportsLocalChainTrades: boolean;
  homeWallet?: HomeWalletCapability;
}

export const QORT_CHAIN: ChainConfig = {
  key: 'QORT',
  name: 'Qortal',
  ticker: 'QORT',
  coinEnum: 'QORT',
  route: 'qortal',
  defaultFee: 0.001,
  isNative: true,
  decimalPlaces: 8,
  activeNetwork: 'MAIN',
  supportsHtlc: false,
  supportsLocalChainTrades: false,
};

// Shown when /crosschain/blockchains is unavailable (fallback for non-Qortium nodes)
// defaultFee: display/native-send fallback in whole coin units. Foreign sends
// only pass fee-per-byte values returned by GET_FOREIGN_FEE.
export const DEFAULT_CHAINS: ChainConfig[] = [
  {
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
  },
  {
    key: 'LTC',
    name: 'Litecoin',
    ticker: 'LTC',
    coinEnum: 'LTC',
    route: 'litecoin',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'DOGE',
    name: 'Dogecoin',
    ticker: 'DOGE',
    coinEnum: 'DOGE',
    route: 'dogecoin',
    defaultFee: 1.0,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'DGB',
    name: 'DigiByte',
    ticker: 'DGB',
    coinEnum: 'DGB',
    route: 'digibyte',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'RVN',
    name: 'Ravencoin',
    ticker: 'RVN',
    coinEnum: 'RVN',
    route: 'ravencoin',
    defaultFee: 0.01,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'DASH',
    name: 'Dash',
    ticker: 'DASH',
    coinEnum: 'DASH',
    route: 'dash',
    defaultFee: 0.0001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'NMC',
    name: 'Namecoin',
    ticker: 'NMC',
    coinEnum: 'NMC',
    route: 'namecoin',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'FIRO',
    name: 'Firo',
    ticker: 'FIRO',
    coinEnum: 'FIRO',
    route: 'firo',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
];

// Full registry of chains the wallet can handle, including ones excluded from
// the fallback (e.g. ARRR requires a sync phase that makes no sense offline).
export const KNOWN_CHAINS: ChainConfig[] = [
  ...DEFAULT_CHAINS,
  {
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
  },
  // Not yet supported by Qortium nodes (no GET_CROSSCHAIN_BLOCKCHAINS entry).
  // Listed here so the wallet recognizes them the moment node support lands,
  // without needing another app release. Non-key fields are placeholders that
  // get overwritten by live node data once the node reports them.
  {
    key: 'IDNA',
    name: 'Idena',
    ticker: 'IDNA',
    coinEnum: 'IDNA',
    route: 'idena',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'LYNX',
    name: 'Lynx',
    ticker: 'LYNX',
    coinEnum: 'LYNX',
    route: 'lynx',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
  {
    key: 'ZANO',
    name: 'Zano',
    ticker: 'ZANO',
    coinEnum: 'ZANO',
    route: 'zano',
    defaultFee: 0.001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: true,
    supportsLocalChainTrades: true,
  },
];

export const DEFAULT_CHAIN_KEYS = new Set(DEFAULT_CHAINS.map((c) => c.key));
export const KNOWN_CHAIN_MAP = new Map(KNOWN_CHAINS.map((c) => [c.key, c]));
