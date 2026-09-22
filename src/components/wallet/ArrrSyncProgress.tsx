import { Box, CircularProgress, LinearProgress, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { UseArrrSyncStatusResult } from '../../hooks/useArrrSyncStatus';

export function ArrrSyncProgress({
  status,
  compact = false,
}: {
  status: UseArrrSyncStatusResult;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { snapshot, progress, error, consentDenied } = status;
  const number = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const { percent, remainingSeconds, stalled } = progress;
  const syncing = snapshot?.state === 'SYNCHRONIZING';
  const ready =
    snapshot?.ready === true && !snapshot.stale && !snapshot.restartRequired;
  let label =
    !snapshot && !status.loading
      ? t('arrr.progress_open_wallet')
      : t('arrr.state_loading');
  if (consentDenied) label = t('arrr.custody_consent_denied');
  else if (error) label = error.message;
  else if (snapshot?.stale) label = t('arrr.progress_outdated');
  else if (snapshot?.restartRequired) label = t('arrr.restart_required');
  else if (ready) label = t('arrr.progress_ready');
  else if (syncing)
    label =
      percent == null
        ? t('arrr.progress_syncing')
        : t('arrr.progress_percent', { percent: number(percent) });
  else if (snapshot?.state === 'DEGRADED') label = t('arrr.state_degraded');
  else if (snapshot?.state === 'DISABLED') label = t('arrr.state_disabled');
  else if (snapshot?.state === 'READY') label = t('arrr.progress_outdated');

  let eta = t(
    compact ? 'arrr.progress_estimating_short' : 'arrr.progress_estimating'
  );
  if (stalled) eta = t('arrr.progress_waiting');
  else if (remainingSeconds != null) {
    const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
    const duration =
      minutes < 60
        ? t('arrr.progress_minutes', { count: minutes })
        : t('arrr.progress_hours_minutes', {
            hours: Math.floor(minutes / 60),
            minutes: minutes % 60,
          });
    eta = t(compact ? 'arrr.progress_eta_short' : 'arrr.progress_eta', {
      duration,
    });
  }
  const active =
    !error &&
    !snapshot?.stale &&
    !snapshot?.restartRequired &&
    (syncing || (!snapshot && status.loading) || snapshot?.state === 'LOADING');
  return (
    <Box
      sx={{
        width: compact ? '100%' : 'min(100%, 420px)',
        whiteSpace: 'normal',
        fontSize: compact ? '0.75rem' : undefined,
      }}
    >
      <Tooltip title={active && syncing ? `${label} · ${eta}` : label}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 0.75,
          }}
        >
          {compact && active && (
            <CircularProgress
              size={12}
              aria-label={t('arrr.progress_syncing')}
            />
          )}
          <Box>{label}</Box>
        </Box>
      </Tooltip>
      {compact && active && syncing && (
        <Box sx={{ fontSize: '0.65rem', mt: 0.25 }}>{eta}</Box>
      )}
      {!compact && syncing && (
        <>
          <LinearProgress
            aria-label={t('arrr.progress_syncing')}
            variant={
              active && percent == null ? 'indeterminate' : 'determinate'
            }
            value={percent ?? 0}
            sx={{ my: 1.5, borderRadius: 1 }}
          />
          {active && <Box sx={{ fontSize: '0.85rem' }}>{eta}</Box>}
          {snapshot.syncedBlocks != null && snapshot.totalBlocks != null && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('arrr.progress_scanned', {
                scanned: number(snapshot.syncedBlocks),
                total: number(snapshot.totalBlocks),
              })}
            </Box>
          )}
          {snapshot.scannedHeight != null && snapshot.tipHeight != null && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('arrr.progress_chain_height', {
                scanned: number(snapshot.scannedHeight),
                tip: number(snapshot.tipHeight),
              })}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
