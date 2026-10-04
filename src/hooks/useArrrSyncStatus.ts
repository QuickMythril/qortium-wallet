import { requestWalletAction } from '../common/walletRequest';
import {
  advanceArrrProgress,
  calculateArrrProgress,
  readArrrProgressHistory,
  writeArrrProgressHistory,
  clearArrrProgressHistory,
  type ArrrProgressHistory,
  type ArrrProgress,
} from '../common/arrrProgress';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ARRR_SESSION_SETTLE_MS,
  arrrPollDelayMs,
  parseArrrSyncSnapshot,
  requestWithArrrBusyRetry,
  type ArrrSyncSnapshot,
} from '../common/arrrSync';
import {
  ARRR_READ_CANCELLED_CODE,
  ARRR_READ_BACKLOG_CODE,
  ARRR_WALLET_NOT_ACTIVE_CODE,
  describeBridgeError,
  isArrrCustodyConsentDeniedError,
  isArrrWalletBusyError,
  type DecodedBridgeError,
} from '../common/bridgeErrors';

export interface UseArrrSyncStatusResult {
  snapshot: ArrrSyncSnapshot | null;
  progress: ArrrProgress;
  loading: boolean;
  error: DecodedBridgeError | null;
  /** True once a GET_ARRR_SYNC_STATUS read was rejected because the user denied the distinct `account.arrr-custody.read` consent prompt. */
  consentDenied: boolean;
  /**
   * True while an owner-confirmed read (session relation SELF) is being
   * answered with ARRR_WALLET_BUSY - Core is still starting/re-binding this
   * account's wallet after a switch. A neutral "switching" condition, never
   * surfaced as `error`.
   */
  switching: boolean;
  /**
   * True once an owner-confirmed busy loop passed ARRR_OWNER_BUSY_CEILING_MS
   * without a single non-busy status - the UI shows a neutral "still
   * starting" note with a manual retry (`refresh`), never the cross-wallet
   * busy wording.
   */
  switchingStalled: boolean;
  /** Manual retry - also used after the busy auto-retry budget (6 x 10s) is exhausted. */
  refresh: () => void;
}

/**
 * Polls GET_ARRR_SYNC_STATUS per the round-5 host contract cadence:
 * immediately once `enabled`, then every 15s while LOADING/SYNCHRONIZING/
 * DEGRADED, every 3 min once READY/DISABLED - paused entirely while the
 * document is hidden (tab return resumes READY at its original deadline
 * and refreshes other states immediately), and reset (fresh snapshot, fresh revision) whenever
 * `enabled` or `resetKey` changes, which cancels anything in flight for the
 * previous account/route/consent state.
 *
 * `ownerConfirmed` is true when the session contract reports this account
 * as the wallet's owner (relation === 'SELF'). It turns ARRR_WALLET_BUSY
 * from a cross-wallet conflict into a neutral `switching` condition (Core
 * is still re-binding the wallet to its new owner right after a switch)
 * and treats ARRR_WALLET_NOT_ACTIVE as proof that the session view is
 * stale - the session is re-read instead of the error being shown.
 */
export function useArrrSyncStatus(
  enabled: boolean,
  resetKey: unknown,
  observeOnly = false,
  ownerConfirmed = false
): UseArrrSyncStatusResult {
  const [snapshot, setSnapshot] = useState<ArrrSyncSnapshot | null>(null);
  const [snapshotKey, setSnapshotKey] = useState<unknown>(resetKey);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<DecodedBridgeError | null>(null);
  const [consentDenied, setConsentDenied] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchingStalled, setSwitchingStalled] = useState(false);

  const visibleStateRef = useRef({
    snapshot,
    snapshotKey,
    error,
    consentDenied,
  });
  visibleStateRef.current = { snapshot, snapshotKey, error, consentDenied };
  const historyRef = useRef<ArrrProgressHistory | null>(null);
  const receivedAtRef = useRef(0);
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const observeOnlyRef = useRef(observeOnly);
  observeOnlyRef.current = observeOnly;
  const ownerConfirmedRef = useRef(ownerConfirmed);
  ownerConfirmedRef.current = ownerConfirmed;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled || snapshot?.state !== 'SYNCHRONIZING') return;
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, snapshot?.state]);
  const revisionRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const clearTimer = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // pollRef breaks the poll <-> scheduleNext mutual reference without a
  // textual forward-reference (and without either identity ever going
  // stale across renders, since both callbacks have empty/static deps).
  const pollRef = useRef<(revision: number) => Promise<void>>(async () => {});

  const scheduleNext = useCallback(
    (revision: number, delayMs: number) => {
      clearTimer();
      timeoutRef.current = setTimeout(() => {
        void pollRef.current(revision);
      }, delayMs);
    },
    [clearTimer]
  );

  const poll = useCallback(
    async (revision: number) => {
      if (revision !== revisionRef.current || !isMountedRef.current) return;
      const requestKey = keyRef.current;
      if (!enabledRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) {
        // Paused while hidden - the visibilitychange listener below resumes
        // the normal cadence, or polls immediately when freshness requires it.
        return;
      }
      // Checked before the first attempt and again after every busy-retry
      // delay, so a busy loop already in flight can't fire another bridge
      // call after unmount, an account/route switch (revision bump), or
      // the tab going hidden (Codex round 5 review finding 4).
      const shouldAbort = () =>
        revision !== revisionRef.current ||
        requestKey !== keyRef.current ||
        !enabledRef.current ||
        !isMountedRef.current ||
        (typeof document !== 'undefined' && document.hidden);
      const owner = ownerConfirmedRef.current;
      try {
        const raw = await requestWithArrrBusyRetry(
          () =>
            requestWalletAction({
              action: 'GET_ARRR_SYNC_STATUS',
              coin: 'ARRR',
            }),
          {
            shouldAbort,
            ownerConfirmed: owner,
            // Owner-confirmed busy: keep the panel neutral ("switching")
            // for as long as Core keeps answering busy - never an error.
            onBusyAttempt: owner
              ? () => {
                  if (!shouldAbort()) setSwitching(true);
                }
              : undefined,
          }
        );
        if (shouldAbort()) return;
        const parsed = parseArrrSyncSnapshot(raw);
        if (!parsed) {
          setError({ message: 'Malformed ARRR sync status response.' });
          setLoading(false);
          scheduleNext(revision, arrrPollDelayMs('LOADING'));
          return;
        }
        const receivedAt = Date.now();
        historyRef.current = advanceArrrProgress(
          historyRef.current,
          parsed,
          receivedAt
        );
        writeArrrProgressHistory(keyRef.current, historyRef.current);
        receivedAtRef.current = receivedAt;
        setNow(receivedAt);
        setSnapshotKey(requestKey);
        setSnapshot(parsed);
        setError(null);
        setConsentDenied(false);
        setSwitching(false);
        setSwitchingStalled(false);
        setLoading(false);
        scheduleNext(revision, arrrPollDelayMs(parsed.state));
      } catch (err) {
        if (shouldAbort()) return;
        const decoded = describeBridgeError(err);
        if (decoded.code === ARRR_READ_CANCELLED_CODE) {
          // Aborted mid busy-retry-delay because the tab went hidden (the
          // revision/isMounted cases already returned above) - not a real
          // error, and not surfaced; the visibilitychange listener below
          // resumes with a fresh poll once visible again.
          return;
        }
        if (decoded.code === ARRR_READ_BACKLOG_CODE) {
          setError(null);
          setLoading(true);
          scheduleNext(revision, arrrPollDelayMs('LOADING'));
          return;
        }
        if (owner && isArrrWalletBusyError(decoded)) {
          // The owner-confirmed busy loop ran past its ceiling without a
          // single non-busy status. Still not a cross-wallet conflict
          // (relation === SELF proves no other wallet is involved) - show
          // the neutral "still starting" state and wait for a manual retry.
          setSwitching(false);
          setSwitchingStalled(true);
          setLoading(false);
          return;
        }
        if (owner && decoded.code === ARRR_WALLET_NOT_ACTIVE_CODE) {
          // Core says this account no longer owns the wallet while the
          // session hook still reports SELF - the session view is stale
          // (another instance switched accounts and its broadcast hasn't
          // landed here yet). Never show the stale-owner error: re-read the
          // session (the same-window event every session hook listens to)
          // and stay neutral until it settles.
          setSwitching(false);
          setSwitchingStalled(false);
          setLoading(true);
          window.dispatchEvent(new Event('arrrWalletSessionChanged'));
          return;
        }
        setLoading(false);
        setError(decoded);
        if (isArrrCustodyConsentDeniedError(decoded)) {
          setConsentDenied(true);
          return; // no auto-retry - the user must explicitly retry
        }
        scheduleNext(revision, arrrPollDelayMs('LOADING'));
      }
    },
    [scheduleNext]
  );
  pollRef.current = poll;

  const refresh = useCallback(() => {
    const revision = ++revisionRef.current;
    clearTimer();
    setLoading(true);
    setError(null);
    setConsentDenied(false);
    setSwitching(false);
    setSwitchingStalled(false);
    void pollRef.current(revision);
  }, [clearTimer]);

  useEffect(() => {
    isMountedRef.current = true;
    const revision = ++revisionRef.current;
    clearTimer();
    historyRef.current = readArrrProgressHistory(resetKey);
    receivedAtRef.current = 0;
    setSnapshotKey(resetKey);
    setSnapshot(null);
    setError(null);
    setConsentDenied(false);
    setSwitching(false);
    setSwitchingStalled(false);

    if (!enabled) {
      setLoading(false);
      return () => {
        isMountedRef.current = false;
        clearTimer();
      };
    }

    setLoading(true);
    void pollRef.current(revision);
    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, resetKey]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.hidden || !enabledRef.current) return;
      const current = visibleStateRef.current;
      if (current.consentDenied) return;
      const revision = ++revisionRef.current;
      clearTimer();
      // Keep READY's normal cadence across short tab visits. The session
      // hook separately checks ownership on every return; a changed session
      // resets this hook through resetKey/enabled. Resuming a fresh READY
      // snapshot must not trigger expensive balance/history reads again.
      const remaining =
        receivedAtRef.current + arrrPollDelayMs('READY') - Date.now();
      if (
        current.snapshotKey === keyRef.current &&
        current.snapshot?.ready &&
        !current.error &&
        remaining > 0
      ) {
        scheduleNext(revision, remaining);
      } else {
        void pollRef.current(revision);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [clearTimer, scheduleNext]);

  useEffect(() => {
    const handleBridgeChange = () => {
      // A new node route or custody state invalidates samples and in-flight reads.
      const revision = ++revisionRef.current;
      clearTimer();
      clearArrrProgressHistory();
      historyRef.current = null;
      setSnapshot(null);
      setError(null);
      setConsentDenied(false);
      setSwitching(false);
      setSwitchingStalled(false);
      setLoading(enabledRef.current);
      if (enabledRef.current && !observeOnlyRef.current)
        void pollRef.current(revision);
    };
    window.addEventListener('qortiumBridgeStateChanged', handleBridgeChange);
    return () =>
      window.removeEventListener(
        'qortiumBridgeStateChanged',
        handleBridgeChange
      );
  }, [clearTimer]);

  useEffect(() => {
    // An ARRR account switch (ACTIVATE/STOP from this or another visible
    // Wallet instance) invalidates whatever this instance last learned:
    // a stale ARRR_WALLET_NOT_ACTIVE / generic read error from before the
    // switch must not keep showing as red text until the next poll. Drop
    // it immediately and go neutral; the session hook re-reads on the same
    // broadcast and flips `enabled`/`resetKey` (which restarts polling), and
    // the short re-poll below covers the case where this instance's session
    // is unchanged. Consent state is untouched - a declined prompt is never
    // reopened by a broadcast.
    const handleSessionChange = () => {
      const revision = ++revisionRef.current;
      clearTimer();
      setError(null);
      setSwitching(false);
      setSwitchingStalled(false);
      setLoading(enabledRef.current && !visibleStateRef.current.consentDenied);
      if (enabledRef.current && !visibleStateRef.current.consentDenied) {
        timeoutRef.current = setTimeout(() => {
          void pollRef.current(revision);
        }, ARRR_SESSION_SETTLE_MS);
      }
    };
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('arrr-wallet-session')
        : null;
    if (channel) channel.onmessage = handleSessionChange;
    window.addEventListener('arrrWalletSessionChanged', handleSessionChange);
    return () => {
      channel?.close();
      window.removeEventListener(
        'arrrWalletSessionChanged',
        handleSessionChange
      );
    };
  }, [clearTimer]);

  const currentSnapshot = enabled && snapshotKey === resetKey ? snapshot : null;
  const progress = calculateArrrProgress(
    !error ? currentSnapshot : null,
    historyRef.current,
    now,
    receivedAtRef.current
  );
  return {
    snapshot: currentSnapshot,
    progress,
    loading,
    error: snapshotKey === resetKey ? error : null,
    consentDenied: snapshotKey === resetKey && consentDenied,
    switching: enabled && switching,
    switchingStalled: enabled && switchingStalled,
    refresh,
  };
}
