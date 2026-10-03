import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'qapp-core';
import { isSelectedAccountChangedMessage } from '../common/accountChangedMessage';
import { describeBridgeError } from '../common/bridgeErrors';
import { parseXmrSnapshot, type XmrSnapshot } from '../common/xmrWallet';
import {
  clearXmrProgress,
  recordXmrProgress,
  xmrProgress,
} from '../common/xmrProgress';

/** Serialized reads, passive recovery and account/bridge-scoped display. Listing never prompts. */
export function useXmrWallet(enabled: boolean, passiveOnly = false) {
  const { address: account } = useAuth();
  const [revision, setRevision] = useState(0);
  const [request, setRequest] = useState({
    action: 'GET_XMR_WALLET',
    passive: passiveOnly,
    account,
    revision: 0,
  });
  const [state, setState] = useState<{
    account: unknown;
    revision: number;
    value: XmrSnapshot | null;
    error: string | null;
    locked: boolean;
    busy: boolean;
  }>({
    account,
    revision,
    value: null,
    error: null,
    locked: false,
    busy: true,
  });
  const previousAccount = useRef(account);
  useEffect(() => {
    if (previousAccount.current !== account) clearXmrProgress();
    previousAccount.current = account;
  }, [account]);
  const generation = useRef(0);
  const consumedRequest = useRef<unknown>(null);
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const lane = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const invalidate = () => {
      clearXmrProgress();
      generation.current++;
      setRevision((n) => n + 1);
      setRequest((r) => ({
        action: 'GET_XMR_WALLET',
        passive: true,
        account: null,
        revision: r.revision + 1,
      }));
    };
    const message = (event: MessageEvent) => {
      if (isSelectedAccountChangedMessage(event)) invalidate();
    };
    window.addEventListener('message', message);
    window.addEventListener('qortiumBridgeStateChanged', invalidate);
    return () => {
      window.removeEventListener('message', message);
      window.removeEventListener('qortiumBridgeStateChanged', invalidate);
    };
  }, []);
  useEffect(() => {
    const id = ++generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    if (!enabled) return;
    const poll = async (action = 'GET_XMR_WALLET', passive = true) => {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      clearTimeout(timer);
      const work = lane.current
        .catch(() => {})
        .then(async () => {
          if (id !== generation.current) return;
          setState((old) => ({
            account,
            revision,
            value:
              old.account === account && old.revision === revision
                ? old.value
                : null,
            error: null,
            locked: false,
            busy: true,
          }));
          const response = await qdnRequest({
            action,
            coin: 'XMR',
            ...(action === 'GET_XMR_WALLET' ? { passive } : {}),
          });
          if (id !== generation.current) return;
          const next = parseXmrSnapshot(response);
          // Only financial display may be retained, never readiness. Scope is checked again below.
          const value = next;
          recordXmrProgress(account, next);
          setNow(Date.now());

          setState((old) => ({
            account,
            revision,
            value:
              next.wallet === null &&
              ['STALE', 'UNAVAILABLE'].includes(next.state) &&
              old.account === account &&
              old.revision === revision
                ? { ...next, wallet: old.value?.wallet ?? null }
                : value,
            error: null,
            locked: false,
            busy: false,
          }));
          if (
            [
              'OPENING',
              'SCANNING',
              'READY',
              'SWITCHING',
              'CLOSING',
              'STALE',
              'UNAVAILABLE',
            ].includes(next.state)
          )
            timer = setTimeout(
              () => void poll(),
              next.state === 'UNAVAILABLE' ? 15000 : 5000
            );
        });
      lane.current = work;
      try {
        await work;
      } catch (error) {
        if (id !== generation.current) return;
        clearXmrProgress();
        stopped = true; // Polls never reopen a declined or expired approval.
        const code = describeBridgeError(error).code;
        const locked = code === 'ACCOUNT_LOCKED';
        setState((old) => ({
          account,
          revision,
          value:
            code === 'XMR_READ_APPROVAL_REQUIRED' &&
            old.account === account &&
            old.revision === revision
              ? old.value
              : null,
          error:
            code === 'XMR_READ_APPROVAL_REQUIRED'
              ? 'Automatic updates are paused. Refresh status to approve wallet reads.'
              : locked
                ? 'Unlock the selected account to use its XMR wallet.'
                : 'XMR access paused. Check the local Core and wallet approval, then refresh.',
          locked,
          busy: false,
        }));
      } finally {
        inFlight = false;
      }
    };
    const freshRequest =
      consumedRequest.current !== request && request.account === account;
    consumedRequest.current = request;
    void poll(
      freshRequest ? request.action : 'GET_XMR_WALLET',
      freshRequest ? request.passive : true
    );
    const visible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [account, revision, request, enabled]);
  const current =
    enabled && state.account === account && state.revision === revision
      ? state
      : null;
  const value = current?.value;
  const wallet = value?.wallet;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const progress = xmrProgress(account, value ?? null, now);
  const refresh = (action = 'GET_XMR_WALLET') =>
    setRequest((r) => ({
      action,
      passive: false,
      account,
      revision: r.revision + 1,
    }));
  const unlock = async () => {
    const unlockAccount = account;
    try {
      await qdnRequest({ action: 'UNLOCK_SELECTED_ACCOUNT' });
      if (currentAccount.current === unlockAccount) refresh();
    } catch {
      /* Explicit retry remains available. */
    }
  };
  return {
    account,
    revision,
    current,
    value,
    wallet,
    refresh,
    unlock,
    progress,
    now,
  };
}
export type XmrWalletStatus = ReturnType<typeof useXmrWallet>;
