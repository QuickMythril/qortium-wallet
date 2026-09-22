import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { parseArrrWalletSession } from '../../common/arrrWalletSession';
import {
  notifyArrrWalletSessionChanged,
  type useArrrWalletSession,
} from '../../hooks/useArrrWalletSession';
import { describeBridgeError } from '../../common/bridgeErrors';

export function ArrrWalletSessionControls({
  session,
}: {
  session: ReturnType<typeof useArrrWalletSession>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (!value || busy || inFlight.current || degraded || session.error) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (stop) {
        const result = await qdnRequest({
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
          await qdnRequest({
            action: 'ACTIVATE_ARRR_WALLET',
            coin: 'ARRR',
            expectedRevision: value.revision,
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
      if (mounted.current) setError(describeBridgeError(cause).message);
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
    <Box sx={{ mt: 2, maxWidth: 460, mx: 'auto' }}>
      {label && (
        <Alert severity={degraded ? 'warning' : 'info'} sx={{ mb: 1 }}>
          {t(label)}
        </Alert>
      )}
      {!degraded && (
        <Button
          variant="outlined"
          disabled={
            busy || !value || !!session.error || value.lifecycle === 'STOPPING'
          }
          onClick={() => void change()}
        >
          {t(
            busy
              ? 'arrr.control_waiting'
              : stop
                ? 'arrr.control_stop'
                : value?.relation === 'OTHER'
                  ? 'arrr.session_switch'
                  : 'arrr.control_start'
          )}
        </Button>
      )}
      <Button disabled={busy} onClick={session.refresh}>
        {t('arrr.session_refresh')}
      </Button>
      <Box sx={{ mt: 1, fontSize: '0.75rem' }}>{t('arrr.session_scope')}</Box>
      {(session.error || error) && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {session.error || error}
        </Alert>
      )}
    </Box>
  );
}
