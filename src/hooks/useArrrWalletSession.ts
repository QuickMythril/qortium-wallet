import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseArrrWalletSession,
  type ArrrWalletSession,
} from '../common/arrrWalletSession';
import {
  describeBridgeError,
  isArrrCustodyConsentDeniedError,
} from '../common/bridgeErrors';

const observed = new Set<unknown>();
export const hasArrrWalletSession = (account: unknown) => observed.has(account);
// Invalidation carries no account, address, or node data. Each recipient reads
// its own selected account through Home again; no broadcast is treated as state.
export function notifyArrrWalletSessionChanged() {
  window.dispatchEvent(new Event('arrrWalletSessionChanged'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('arrr-wallet-session');
    channel.postMessage('refresh');
    channel.close();
  }
}
export function useArrrWalletSession(enabled: boolean, account: unknown) {
  const [state, setState] = useState<{
    account: unknown;
    value: ArrrWalletSession | null;
    error: string | null;
  }>({ account, value: null, error: null });
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const current = ++generation.current;
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blocked = false;
    const poll = async () => {
      if (document.hidden || blocked) return;
      try {
        const value = parseArrrWalletSession(
          await qdnRequest({ action: 'GET_ARRR_WALLET_SESSION', coin: 'ARRR' })
        );
        if (current !== generation.current) return;
        observed.add(account);
        setState({ account, value, error: null });
      } catch (error) {
        if (current !== generation.current) return;
        const decoded = describeBridgeError(error);
        setState((previous) => ({
          account,
          value: previous.account === account ? previous.value : null,
          error: decoded.message,
        }));
        // A declined custody prompt must never be reopened by a timer.
        if (isArrrCustodyConsentDeniedError(decoded)) blocked = true;
      }
      if (current === generation.current && !blocked)
        timer = setTimeout(poll, 5000);
    };
    const invalidate = () => {
      clearTimeout(timer);
      setState({ account, value: null, error: null });
      refresh();
    };
    const visibility = () => {
      if (!document.hidden) invalidate();
    };
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('arrr-wallet-session')
        : null;
    if (channel) channel.onmessage = invalidate;
    window.addEventListener('arrrWalletSessionChanged', invalidate);
    window.addEventListener('qortiumBridgeStateChanged', invalidate);
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => {
      generation.current = current + 1;
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('arrrWalletSessionChanged', invalidate);
      window.removeEventListener('qortiumBridgeStateChanged', invalidate);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, account, revision, refresh]);
  const value = enabled && state.account === account ? state.value : null;
  const error = enabled && state.account === account ? state.error : null;
  const active =
    !!value &&
    !error &&
    value.enabled &&
    value.relation === 'SELF' &&
    value.lifecycle === 'RUNNING';
  return { value, error, active, refresh };
}
