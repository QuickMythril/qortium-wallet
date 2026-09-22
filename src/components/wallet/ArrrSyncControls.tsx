import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
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
      const result = await qdnRequest({ action, coin: 'ARRR' });
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
    <Box sx={{ mt: 2, maxWidth: 460, mx: 'auto' }}>
      <Button
        variant="outlined"
        disabled={disabled}
        onClick={() => void control()}
        startIcon={busy ? <CircularProgress size={14} /> : undefined}
      >
        {busy
          ? t('arrr.control_waiting')
          : t(
              stopUnconfirmed
                ? 'arrr.control_check_stop'
                : start
                  ? 'arrr.control_start'
                  : 'arrr.control_stop'
            )}
      </Button>
      <Box sx={{ mt: 0.75, fontSize: '0.75rem', opacity: 0.8 }}>
        {t('arrr.control_scope')}
      </Box>
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
    </Box>
  );
}
