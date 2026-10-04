import { requestWalletAction } from '../common/walletRequest';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const pausedAccount = useRef<{ account: unknown } | null>(null);
  const isPaused = useCallback(
    () =>
      pausedAccount.current !== null &&
      pausedAccount.current.account === account,
    [account]
  );
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
      if (
        inFlight ||
        stopped ||
        (document.hidden && action !== 'STOP_XMR_WALLET') ||
        (isPaused() && action !== 'STOP_XMR_WALLET')
      )
        return;
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
          const response = await requestWalletAction({
            action,
            coin: 'XMR',
            ...(action === 'GET_XMR_WALLET' ? { passive } : {}),
          });
          if (id !== generation.current) return;
          const next = parseXmrSnapshot(response);
          // Only financial display may be retained, never readiness. Scope is checked again below.
          const value = next;
          if (action === 'STOP_XMR_WALLET') {
            stopped = true;
            clearXmrProgress();
          }
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
            action !== 'STOP_XMR_WALLET' &&
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
            (action === 'STOP_XMR_WALLET' ||
              code === 'XMR_READ_APPROVAL_REQUIRED') &&
            old.account === account &&
            old.revision === revision
              ? old.value
              : null,
          error:
            action === 'STOP_XMR_WALLET'
              ? 'Stop was not confirmed. Automatic page updates are paused, but Core may still be scanning. Retry Stop wallet or refresh status.'
              : code === 'XMR_READ_APPROVAL_REQUIRED'
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
    if (isPaused() && !(freshRequest && request.action === 'STOP_XMR_WALLET')) {
      // Keep controls usable after host invalidation, without resuming reads or retaining old financial data.
      setState((old) => ({
        account,
        revision,
        value:
          old.account === account && old.revision === revision
            ? old.value
            : null,
        error:
          'Automatic page updates are paused. Refresh status or activate the wallet to continue; retry Stop wallet if stopping was not confirmed.',
        locked: false,
        busy: false,
      }));
      return;
    }
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
  }, [account, revision, request, enabled, isPaused]);
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
  const refresh = (action = 'GET_XMR_WALLET') => {
    if (action !== 'STOP_XMR_WALLET') pausedAccount.current = null;
    else {
      if (isPaused() && request.action === action && current?.busy) return;
      pausedAccount.current = { account };
    }
    // Fence a late read before React runs the replacement effect. Never replay controls on visibility events.
    generation.current++;
    setRequest((r) => ({
      action,
      passive: false,
      account,
      revision: r.revision + 1,
    }));
  };
  const unlock = async () => {
    const unlockAccount = account;
    try {
      await requestWalletAction({ action: 'UNLOCK_SELECTED_ACCOUNT' });
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
    stop: () => refresh('STOP_XMR_WALLET'),
    paused: isPaused(),
    stopping:
      isPaused() &&
      request.action === 'STOP_XMR_WALLET' &&
      current?.busy === true,
    progress,
    now,
  };
}
export type XmrWalletStatus = ReturnType<typeof useXmrWallet>;
