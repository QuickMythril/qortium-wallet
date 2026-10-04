import { WalletScanSetup } from './WalletScanSetup';
import {
  WALLET_SCAN_START_CONTRACT,
  type WalletScanStart,
} from '../../common/walletScanStart';
import { requestWalletAction } from '../../common/walletRequest';
import { WalletControls } from './WalletPage';
import { useEffect, useRef, useState } from 'react';
import { Alert, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { parseArrrWalletSession } from '../../common/arrrWalletSession';
import {
  notifyArrrWalletSessionChanged,
  type useArrrWalletSession,
} from '../../hooks/useArrrWalletSession';
import {
  describeBridgeError,
  isArrrWalletBusyError,
} from '../../common/bridgeErrors';

export function ArrrWalletSessionControls({
  session,
  scanStartContract,
}: {
  session: ReturnType<typeof useArrrWalletSession>;
  scanStartContract?: string;
}) {
  const { t } = useTranslation();
  const [scanStart, setScanStart] = useState<WalletScanStart | null>({
    scanMode: 'RESUME',
  });
  const choices = scanStartContract === WALLET_SCAN_START_CONTRACT;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Activation answered ARRR_WALLET_BUSY: Core has not finished stopping
  // the other account's scan yet. A neutral note (not the cross-wallet
  // busy wording) - the user refreshes status; nothing auto-retries.
  const [activationBusy, setActivationBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const value = session.value;
  const degraded = value?.lifecycle === 'DEGRADED';
  const stop = session.active;
  const change = async () => {
    if (
      !value ||
      (!stop && choices && !scanStart) ||
      busy ||
      inFlight.current ||
      degraded ||
      session.error
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setActivationBusy(false);
    try {
      if (stop) {
        const result = await requestWalletAction({
          action: 'STOP_ARRR_SYNC',
          coin: 'ARRR',
        });
        if (
          result?.contract !== 'qortium-home-arrr-sync-control-v1' ||
          result.operation !== 'stop' ||
          result.completed !== true ||
          result.enabled !== false ||
          result.scope !== 'node' ||
          result.coin !== 'ARRR'
        )
          throw new Error(t('arrr.control_unconfirmed'));
      } else {
        const result = parseArrrWalletSession(
          await requestWalletAction({
            action: 'ACTIVATE_ARRR_WALLET',
            coin: 'ARRR',
            expectedRevision: value.revision,
            ...(choices ? scanStart : {}),
          } as any)
        );
        if (
          !result.enabled ||
          result.relation !== 'SELF' ||
          result.lifecycle !== 'RUNNING'
        )
          throw new Error(t('arrr.control_unconfirmed'));
      }
    } catch (cause) {
      if (mounted.current) {
        const decoded = describeBridgeError(cause);
        if (!stop && isArrrWalletBusyError(decoded)) {
          setActivationBusy(true);
          setError(t('arrr.session_switch_busy'));
        } else {
          setError(decoded.message);
        }
      }
    } finally {
      inFlight.current = false;
      notifyArrrWalletSessionChanged();
      if (mounted.current) {
        setBusy(false);
        session.refresh();
      }
    }
  };
  const label = degraded
    ? 'arrr.session_restart'
    : !value
      ? 'arrr.state_loading'
      : !value.enabled
        ? 'arrr.session_stopped'
        : value.relation === 'OTHER'
          ? 'arrr.session_other'
          : value.relation === 'NONE'
            ? 'arrr.session_none'
            : null;
  return (
    <WalletControls
      primary={
        !degraded
          ? {
              disabled:
                busy ||
                (!stop && choices && !scanStart) ||
                !value ||
                !!session.error ||
                value.lifecycle === 'STOPPING',
              onClick: () => void change(),
              busy,
              label: t(
                busy
                  ? 'wallet_controls.waiting'
                  : stop
                    ? 'wallet_controls.stop'
                    : value?.relation === 'OTHER'
                      ? 'arrr.session_switch'
                      : 'wallet_controls.start'
              ),
            }
          : undefined
      }
      refresh={{
        disabled: busy,
        onClick: session.refresh,
        label: t('wallet_controls.refresh'),
      }}
      note={t('arrr.session_scope')}
    >
      {!stop && choices && (
        <WalletScanSetup
          minimumHeight={1}
          disabled={busy}
          onChange={setScanStart}
        />
      )}
      {value?.scanStart && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          Saved scan start: block {value.scanStart.height.toLocaleString()}.
        </Typography>
      )}
      {label && (
        <Alert severity={degraded ? 'warning' : 'info'} sx={{ mt: 1 }}>
          {t(label)}
        </Alert>
      )}
      {(session.error || error) && (
        <Alert
          severity={!session.error && activationBusy ? 'info' : 'warning'}
          data-testid={
            !session.error && activationBusy
              ? 'arrr-activation-busy'
              : undefined
          }
          sx={{ mt: 1 }}
        >
          {session.error || error}
        </Alert>
      )}
    </WalletControls>
  );
}
