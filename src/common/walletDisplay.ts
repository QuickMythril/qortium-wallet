import { isSelectedAccountChangedMessage } from './accountChangedMessage';
/** Display retention is scoped to an already approved account/bridge. No disk storage or authority. */
export function retainWalletDisplay<T>(
  previous: T | null,
  observed: T | null
): T | null {
  return observed ?? previous;
}
// One current account per coin; account/bridge/lock invalidation drops the cache.
let epoch = 0;
export function walletDisplayEpoch() {
  return epoch;
}
const cache = new Map<string, { account: unknown; value: unknown }>();
export function readWalletDisplay<T>(coin: string, account: unknown): T | null {
  const entry = cache.get(coin);
  return entry && entry.account === account ? (entry.value as T) : null;
}
export function writeWalletDisplay<T>(
  coin: string,
  account: unknown,
  value: T,
  expectedEpoch = epoch
) {
  if (expectedEpoch !== epoch) return;
  cache.set(coin, { account, value });
}
export function clearWalletDisplay(coin: string) {
  cache.delete(coin);
}

// Listen for host invalidation for the lifetime of the app, including while coin pages are unmounted.
if (typeof window !== 'undefined') {
  window.addEventListener('qortiumBridgeStateChanged', () => {
    epoch++;
    cache.clear();
  });
  window.addEventListener('message', (event) => {
    if (isSelectedAccountChangedMessage(event)) {
      epoch++;
      cache.clear();
    }
  });
}
