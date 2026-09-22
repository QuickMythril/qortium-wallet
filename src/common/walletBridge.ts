import type { ChainConfig } from '../config/chains';

export type QortSendAction = 'SEND_QORT' | 'SEND_COIN';

type BridgeProtocol = 'qortalRequest' | 'qdnRequest';
type BridgeRequest = (options: QdnRequestOptions) => Promise<any>;

// qortalRequest is preferred over qdnRequest whenever both are injected
// (e.g. a Qortium Home build loaded against a Qortal-native chain). Exported
// so callers that need to know which bridge a native-chain call will
// actually use - without making the call - can ask, rather than assuming
// qdnRequest.
export function qortBridgeProtocol(): BridgeProtocol | null {
  if (typeof qortalRequest === 'function') return 'qortalRequest';
  if (typeof qdnRequest === 'function') return 'qdnRequest';
  return null;
}

function qortBridge(): {
  protocol: BridgeProtocol;
  request: BridgeRequest;
} {
  const protocol = qortBridgeProtocol();
  if (protocol === 'qortalRequest') {
    return { protocol, request: qortalRequest };
  }
  if (protocol === 'qdnRequest') {
    return { protocol, request: qdnRequest };
  }
  throw new Error('No Qortal wallet bridge is available.');
}

export function requestQortWallet(): Promise<any> {
  const bridge = qortBridge();
  return bridge.request(
    bridge.protocol === 'qortalRequest'
      ? { action: 'GET_USER_ACCOUNT' }
      : { action: 'GET_USER_WALLET', assetId: 0 }
  );
}

export function requestWalletForCoin(coin: string): Promise<any> {
  return coin === 'QORT'
    ? requestQortWallet()
    : qdnRequest({ action: 'GET_USER_WALLET', coin });
}

export function requestWalletForChain(chain: ChainConfig): Promise<any> {
  return requestWalletForCoin(chain.coinEnum);
}

export async function requestQortBalance(): Promise<any> {
  const bridge = qortBridge();
  if (bridge.protocol === 'qdnRequest') {
    return bridge.request({ action: 'GET_QORT_BALANCE' });
  }

  const wallet = (await bridge.request({ action: 'GET_USER_ACCOUNT' })) as {
    address?: unknown;
  } | null;
  const address =
    typeof wallet?.address === 'string' ? wallet.address.trim() : '';
  if (!address) throw new Error('No QORT wallet address is available.');

  return bridge.request({ action: 'GET_BALANCE', address });
}

export function requestQortTransactions(
  address: string,
  options: Omit<QdnRequestOptions, 'action' | 'address'> = {}
): Promise<any> {
  const bridge = qortBridge();
  return bridge.request({
    ...options,
    action:
      bridge.protocol === 'qortalRequest'
        ? 'SEARCH_TRANSACTIONS'
        : 'SEARCH_QORTAL_TRANSACTIONS',
    address,
  });
}

export async function requestQortActions(): Promise<{
  actions: string[];
  protocol: BridgeProtocol;
}> {
  const bridge = qortBridge();
  let actions: unknown;
  try {
    actions = await bridge.request({ action: 'SHOW_ACTIONS' });
  } catch (error) {
    // Qortal Core injects qortalRequest but does not expose Home's
    // SHOW_ACTIONS extension. Its documented QORT send action is SEND_COIN.
    if (bridge.protocol === 'qortalRequest') {
      return { actions: ['SEND_COIN'], protocol: bridge.protocol };
    }
    throw error;
  }
  if (!Array.isArray(actions) && bridge.protocol === 'qortalRequest') {
    return { actions: ['SEND_COIN'], protocol: bridge.protocol };
  }
  return {
    actions: Array.isArray(actions)
      ? actions.filter((action): action is string => typeof action === 'string')
      : [],
    protocol: bridge.protocol,
  };
}

export function qortSendActionForActions(
  actions: readonly string[]
): QortSendAction | null {
  if (actions.includes('SEND_QORT')) return 'SEND_QORT';
  if (actions.includes('SEND_COIN')) return 'SEND_COIN';
  return null;
}

export function requestQortUnlock(): Promise<any> {
  return qortBridge().request({ action: 'UNLOCK_SELECTED_ACCOUNT' });
}

// Qortium Home always supports UNLOCK_SELECTED_ACCOUNT even when a particular
// build's SHOW_ACTIONS response omits it; a bridge that isn't Home (native
// Qortal, or a Qortal asset network) only supports the unlock action when it
// explicitly advertises it.
export function shouldAttemptAccountUnlock(
  usesQdnRequest: boolean,
  actions: readonly string[]
): boolean {
  return usesQdnRequest || actions.includes('UNLOCK_SELECTED_ACCOUNT');
}

export function isUnlockedResult(result: unknown): boolean {
  return (result as { isUnlocked?: boolean } | null)?.isUnlocked === true;
}

export function requestQortSend(
  action: QortSendAction,
  recipient: string,
  amount: number
): Promise<any> {
  const bridge = qortBridge();
  return bridge.request({
    action,
    ...(action === 'SEND_COIN' ? { coin: 'QORT' } : {}),
    ...(action === 'SEND_COIN'
      ? { destinationAddress: recipient }
      : { recipient }),
    amount,
  });
}

export function requestQortNameData(name: string): Promise<any> {
  const bridge = qortBridge();
  return bridge.request({
    action:
      bridge.protocol === 'qortalRequest'
        ? 'GET_NAME_DATA'
        : 'GET_QORTAL_NAME_DATA',
    name,
  });
}
