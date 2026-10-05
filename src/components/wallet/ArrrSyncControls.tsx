import { WalletScanDetails } from './WalletObservationNotice';
import { requestWalletAction } from '../../common/walletRequest';
import { WalletControls } from './WalletPage';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { UseArrrSyncStatusResult } from '../../hooks/useArrrSyncStatus';
import { describeBridgeError } from '../../common/bridgeErrors';

export const ARRR_SYNC_CONTROL_CONTRACT = 'qortium-home-arrr-sync-control-v1';

export function ArrrSyncControls({
  status,
  onChanged,
}: {
  status: UseArrrSyncStatusResult;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stopUnconfirmed, setStopUnconfirmed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const start = !stopUnconfirmed && status.snapshot?.state === 'DISABLED';
  const disabled =
    busy ||
    status.loading ||
    !status.snapshot ||
    status.snapshot.stale ||
    status.snapshot.restartRequired;
  const control = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    const action = start ? 'START_ARRR_SYNC' : 'STOP_ARRR_SYNC';
    try {
      const result = await requestWalletAction({ action, coin: 'ARRR' });
      if (!mounted.current) return;
      if (
        !result ||
        result.contract !== ARRR_SYNC_CONTROL_CONTRACT ||
        result.coin !== 'ARRR' ||
        result.scope !== 'node' ||
        result.completed !== true ||
        result.enabled !== start ||
        result.operation !== (start ? 'start' : 'stop')
      ) {
        if (!start) setStopUnconfirmed(true);
        throw new Error(t('arrr.control_unconfirmed'));
      }
      setStopUnconfirmed(false);
      setMessage(t(start ? 'arrr.control_started' : 'arrr.control_stopped'));
    } catch (cause) {
      if (!mounted.current) return;
      const decoded = describeBridgeError(cause);
      if (
        !start &&
        (decoded.code === 'ARRR_SYNC_CONTROL_FAILED' ||
          decoded.code === 'ARRR_SYNC_CONTROL_UNCERTAIN')
      )
        setStopUnconfirmed(true);
      setError(decoded.message);
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        onChanged();
      }
    }
  };
  return (
    <WalletControls
      primary={{
        disabled,
        onClick: () => void control(),
        busy,
        label: busy
          ? t('wallet_controls.waiting')
          : t(
              stopUnconfirmed
                ? 'arrr.control_check_stop'
                : start
                  ? 'wallet_controls.start'
                  : 'wallet_controls.stop'
            ),
      }}
      note={<WalletScanDetails>{t('arrr.control_scope')}</WalletScanDetails>}
    >
      {message && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </WalletControls>
  );
}
