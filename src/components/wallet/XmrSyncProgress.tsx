import { Box, LinearProgress, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { XmrSnapshot } from '../../common/xmrWallet';
import type { ScanProgress } from '../../common/scanProgress';

export function XmrSyncProgress({
  value,
  progress,
  now,
  compact = false,
}: {
  value: XmrSnapshot;
  progress: ScanProgress;
  now: number;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.resolvedLanguage);
  const { percent, remainingSeconds, stalled } = progress;
  const syncing = ['SCANNING', 'STALE'].includes(value.state);
  const ready =
    value.state === 'READY' &&
    value.wallet?.synced &&
    (value.updatedAt === null ||
      (now >= value.updatedAt && now - value.updatedAt < 30000));
  const label = ready
    ? t('arrr.progress_ready')
    : syncing
      ? percent === null
        ? t('arrr.progress_syncing')
        : t('arrr.progress_percent', { percent: number(percent) })
      : value.state === 'UNAVAILABLE'
        ? 'Waiting for the XMR wallet. Retrying automatically…'
        : value.state === 'READY'
          ? t('arrr.progress_outdated')
          : `Wallet status: ${value.state.toLowerCase().replace(/_/g, ' ')}`;
  let eta = t(
    compact ? 'arrr.progress_estimating_short' : 'arrr.progress_estimating'
  );
  if (stalled) eta = t('arrr.progress_waiting');
  else if (remainingSeconds !== null) {
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
  const p = value.progress;
  return (
    <Box
      role="status"
      sx={{
        my: compact ? 0 : 2,
        width: compact ? '100%' : 'min(100%, 420px)',
        fontSize: compact ? '0.75rem' : undefined,
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        {compact && syncing && (
          <CircularProgress size={12} aria-label={t('arrr.progress_syncing')} />
        )}
        {label}
      </Box>
      {syncing && (
        <>
          {!compact && (
            <LinearProgress
              aria-label={t('arrr.progress_syncing')}
              variant={percent === null ? 'indeterminate' : 'determinate'}
              value={percent ?? 0}
              sx={{ my: 1.5 }}
            />
          )}
          <Box sx={{ fontSize: compact ? '0.65rem' : '0.85rem' }}>{eta}</Box>
          {!compact && p && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('arrr.progress_scanned', {
                scanned: number(p.height - p.startHeight),
                total: number(p.targetHeight - p.startHeight),
              })}
            </Box>
          )}
          {!compact && !p && value.wallet && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('arrr.progress_scanned', {
                scanned: number(value.wallet.height),
                total: number(value.wallet.targetHeight),
              })}
            </Box>
          )}
          {!compact && value.state === 'STALE' && (
            <Box sx={{ mt: 1 }}>
              Updating balances and history. The scan continues automatically.
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
