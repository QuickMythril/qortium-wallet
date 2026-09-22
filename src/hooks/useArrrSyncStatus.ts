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
  arrrPollDelayMs,
  parseArrrSyncSnapshot,
  requestWithArrrBusyRetry,
  type ArrrSyncSnapshot,
} from '../common/arrrSync';
import {
  ARRR_READ_CANCELLED_CODE,
  describeBridgeError,
  isArrrCustodyConsentDeniedError,
  type DecodedBridgeError,
} from '../common/bridgeErrors';

export interface UseArrrSyncStatusResult {
  snapshot: ArrrSyncSnapshot | null;
  progress: ArrrProgress;
  loading: boolean;
  error: DecodedBridgeError | null;
  /** True once a GET_ARRR_SYNC_STATUS read was rejected because the user denied the distinct `account.arrr-custody.read` consent prompt. */
  consentDenied: boolean;
  /** Manual retry - also used after the busy auto-retry budget (6 x 10s) is exhausted. */
  refresh: () => void;
}

/**
 * Polls GET_ARRR_SYNC_STATUS per the round-5 host contract cadence:
 * immediately once `enabled`, then every 15s while LOADING/SYNCHRONIZING/
 * DEGRADED, every 3 min once READY/DISABLED - paused entirely while the
 * document is hidden (a hidden-tab visibilitychange resumes it with an
 * immediate poll), and reset (fresh snapshot, fresh revision) whenever
 * `enabled` or `resetKey` changes, which cancels anything in flight for the
 * previous account/route/consent state.
 */
export function useArrrSyncStatus(
  enabled: boolean,
  resetKey: unknown,
  observeOnly = false
): UseArrrSyncStatusResult {
  const [snapshot, setSnapshot] = useState<ArrrSyncSnapshot | null>(null);
  const [snapshotKey, setSnapshotKey] = useState<unknown>(resetKey);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<DecodedBridgeError | null>(null);
  const [consentDenied, setConsentDenied] = useState(false);

  const historyRef = useRef<ArrrProgressHistory | null>(null);
  const receivedAtRef = useRef(0);
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const observeOnlyRef = useRef(observeOnly);
  observeOnlyRef.current = observeOnly;
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
        // this exact revision with an immediate poll once visible again.
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
      try {
        const raw = await requestWithArrrBusyRetry(
          () => qdnRequest({ action: 'GET_ARRR_SYNC_STATUS', coin: 'ARRR' }),
          { shouldAbort }
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
      const revision = ++revisionRef.current;
      clearTimer();
      void pollRef.current(revision);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [clearTimer]);

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
    refresh,
  };
}
