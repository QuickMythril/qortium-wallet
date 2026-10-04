/** Shared app-side transport. Capability selection happens before one dispatch; never retry a mutation. */
export const WALLET_REQUEST_CONTRACT = 'qortium-home-wallet-request-v1';
let genericCoins = new Set<string>();

export function configureWalletRequests(
  rows: readonly {
    currencyCode?: string;
    homeWallet?: { requestContract?: string };
  }[]
) {
  genericCoins = new Set(
    rows
      .filter(
        (row) => row.homeWallet?.requestContract === WALLET_REQUEST_CONTRACT
      )
      .map((row) => row.currencyCode ?? '')
  );
}

const operations: Readonly<Record<string, string>> = {
  GET_USER_WALLET: 'address',
  GET_WALLET_BALANCE: 'balance',
  GET_USER_WALLET_TRANSACTIONS: 'transactions',
  GET_ARRR_SYNC_STATUS: 'status',
  GET_ARRR_WALLET_SESSION: 'session',
  ACTIVATE_ARRR_WALLET: 'activate',
  STOP_ARRR_SYNC: 'stop',
  START_ARRR_SYNC: 'start',
  GET_ARRR_SEND_READINESS: 'send-readiness',
  GET_ARRR_SEND_OPERATION: 'send-status',
  GET_XMR_WALLET: 'status',
  ACTIVATE_XMR_WALLET: 'activate',
  STOP_XMR_WALLET: 'stop',
  PREPARE_XMR_SEND: 'send-prepare',
  COMMIT_XMR_SEND: 'send-commit',
  CANCEL_XMR_SEND: 'send-cancel',
  GET_XMR_SEND_STATUS: 'send-status',
  SEND_COIN: 'send',
  GET_CROSSCHAIN_SERVER_INFO: 'servers',
  SET_CURRENT_FOREIGN_SERVER: 'set-server',
};

export function walletRequestValue(
  request: Record<string, unknown> & { action: string }
) {
  const { action, coin, ...parameters } = request;
  const operation = Object.prototype.hasOwnProperty.call(operations, action)
    ? operations[action]
    : undefined;
  if (typeof coin !== 'string' || !genericCoins.has(coin) || !operation)
    return request;
  return {
    action: 'WALLET_REQUEST',
    coin,
    operation,
    ...(Object.keys(parameters).length ? { parameters } : {}),
  };
}

export function requestWalletAction(
  request: Record<string, unknown> & { action: string }
): Promise<any> {
  return qdnRequest(walletRequestValue(request) as QdnRequestOptions);
}
