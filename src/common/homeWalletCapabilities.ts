import type {
  ChainConfig,
  HomeWalletCapability,
  HomeWalletMode,
} from '../config/chains';

export const HOME_WALLET_CONTRACT = 'qortium-home-wallet-v1';
export const HOME_1_WALLET_READ_CONTRACT = 'qortium-home-1.x-wallet-read-v1';
// ARRR-only custody wire contract (round 5) - see the ARRR row of
// qortium-home's HOME_V2_BRIDGE_COMPATIBILITY.md. A capability advertising
// TRUSTED_CORE_CUSTODY for any other coin, or with a different/missing
// `custodyContract`, is rejected by arrrCustodyWalletAvailability below.
export const ARRR_CUSTODY_CONTRACT = 'qortium-home-arrr-custody-v1';

// The legacy marker is Wallet-local provenance, not a wire contract. Only the
// exact object created after GET_HOST_INFO verification is trusted.
const verifiedLegacyHome1Capabilities = new WeakSet<object>();

export interface ForeignWalletAvailability {
  canManageServer: boolean;
  canReadBalance: boolean;
  canReadTransactions: boolean;
  canReceive: boolean;
  canSend: boolean;
}

const unavailable: ForeignWalletAvailability = Object.freeze({
  canManageServer: false,
  canReadBalance: false,
  canReadTransactions: false,
  canReceive: false,
  canSend: false,
});

const READ_MODES = new Set<HomeWalletMode>([
  'HOME_LOCAL',
  'PUBLIC_NODE',
  'TRUSTED_CORE',
]);
const RECEIVE_MODES = new Set<HomeWalletMode>(['HOME_LOCAL']);
const SEND_MODES = new Set<HomeWalletMode>([
  'HOME_LOCAL',
  'HOME_SIGNED_PUBLIC_NODE',
]);
const SERVER_MODES = new Set<HomeWalletMode>(['HOME_LOCAL', 'TRUSTED_CORE']);

function modeMatches(
  enabled: unknown,
  mode: unknown,
  enabledModes: ReadonlySet<HomeWalletMode>
): boolean {
  return enabled === true
    ? typeof mode === 'string' && enabledModes.has(mode as HomeWalletMode)
    : enabled === false && mode === 'NONE';
}

function hasConsistentModes(capability: HomeWalletCapability): boolean {
  return (
    modeMatches(capability.read, capability.readMode, READ_MODES) &&
    modeMatches(capability.receive, capability.receiveMode, RECEIVE_MODES) &&
    modeMatches(capability.send, capability.sendMode, SEND_MODES) &&
    modeMatches(
      capability.serverManagement,
      capability.serverManagementMode,
      SERVER_MODES
    )
  );
}

export function legacyHome1WalletCapability(
  hostInfo: unknown
): HomeWalletCapability | undefined {
  if (!hostInfo || typeof hostInfo !== 'object' || Array.isArray(hostInfo)) {
    return undefined;
  }

  const info = hostInfo as Record<string, unknown>;
  if (
    info.hostName !== 'qortium-home' ||
    typeof info.hostVersion !== 'string' ||
    !/^1\.[0-9]+\.[0-9]+(?:[-+].*)?$/.test(info.hostVersion)
  ) {
    return undefined;
  }

  const capability: HomeWalletCapability = Object.freeze({
    contract: HOME_1_WALLET_READ_CONTRACT,
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
  });
  verifiedLegacyHome1Capabilities.add(capability);
  return capability;
}

// ARRR-only gate (round 5): a coin-aware branch of the capability check
// above. TRUSTED_CORE_CUSTODY is deliberately absent from READ_MODES /
// RECEIVE_MODES / SEND_MODES, so the generic bitcoiny gate above already
// refuses it for every other coin via hasConsistentModes() - this function
// is the ONLY path that can ever grant it, and only for ARRR, and only
// alongside the exact custody contract, structured-sync support, and a
// hard send:false/sendMode:NONE requirement.
function arrrCustodyWalletAvailability(
  capability: HomeWalletCapability | undefined,
  advertisedActions: readonly string[]
): ForeignWalletAvailability {
  if (
    !capability ||
    capability.contract !== HOME_WALLET_CONTRACT ||
    capability.implemented !== true ||
    capability.protocol !== 'qdnRequest' ||
    typeof capability.requiresUnlockedAccount !== 'boolean' ||
    capability.custodyContract !== ARRR_CUSTODY_CONTRACT ||
    capability.syncStatus !== true ||
    capability.readMode !== 'TRUSTED_CORE_CUSTODY' ||
    capability.receiveMode !== 'TRUSTED_CORE_CUSTODY' ||
    capability.read !== true ||
    capability.receive !== true ||
    // ARRR send is never granted in this tranche - reject custody outright
    // if the host ever advertises send:true alongside it (host contract:
    // "custody with send true" must be rejected).
    capability.send !== false ||
    capability.sendMode !== 'NONE'
  ) {
    return unavailable;
  }

  // The four ARRR reads share one custody grant; GET_ARRR_SYNC_STATUS is
  // the tell that the route is actually admin-trusted (Home only advertises
  // it there), so require it before trusting read/receive at all.
  const actions = new Set(advertisedActions);
  if (!actions.has('GET_ARRR_SYNC_STATUS')) return unavailable;

  return Object.freeze({
    canManageServer: false,
    canReadBalance: actions.has('GET_WALLET_BALANCE'),
    canReadTransactions: actions.has('GET_USER_WALLET_TRANSACTIONS'),
    canReceive: actions.has('GET_USER_WALLET'),
    canSend: false,
  });
}

export function foreignWalletAvailability(
  chain: Pick<ChainConfig, 'homeWallet' | 'isNative' | 'coinEnum'>,
  advertisedActions: readonly string[]
): ForeignWalletAvailability {
  if (!chain.isNative && chain.coinEnum === 'ARRR') {
    return arrrCustodyWalletAvailability(chain.homeWallet, advertisedActions);
  }

  const capability = chain.homeWallet;
  const isCurrentContract = capability?.contract === HOME_WALLET_CONTRACT;
  const isVerifiedLegacyContract =
    capability?.contract === HOME_1_WALLET_READ_CONTRACT &&
    verifiedLegacyHome1Capabilities.has(capability);
  if (
    chain.isNative ||
    (!isCurrentContract && !isVerifiedLegacyContract) ||
    capability.implemented !== true ||
    capability.protocol !== 'qdnRequest' ||
    typeof capability.requiresUnlockedAccount !== 'boolean' ||
    !hasConsistentModes(capability)
  ) {
    return unavailable;
  }

  const actions = new Set(advertisedActions);
  const canReadBalance =
    capability.read === true && actions.has('GET_WALLET_BALANCE');
  const canReadTransactions =
    capability.read === true && actions.has('GET_USER_WALLET_TRANSACTIONS');
  const canReceive =
    capability.receive === true && actions.has('GET_USER_WALLET');
  const canManageServer =
    capability.serverManagement === true &&
    actions.has('GET_CROSSCHAIN_SERVER_INFO') &&
    actions.has('SET_CURRENT_FOREIGN_SERVER');
  const canSend =
    !isVerifiedLegacyContract &&
    capability.send === true &&
    actions.has('SEND_COIN') &&
    (!capability.requiresUnlockedAccount ||
      actions.has('UNLOCK_SELECTED_ACCOUNT'));

  return Object.freeze({
    canManageServer,
    canReadBalance,
    canReadTransactions,
    canReceive,
    canSend,
  });
}
