import type { ReactNode } from 'react';
import { Box, CircularProgress, LinearProgress, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ScanProgress } from '../../common/scanProgress';

/** Coin-neutral presentation; adapters decide what is active, stale or ready. */
export function WalletSyncProgress({
  label,
  active,
  syncing,
  progress,
  compact = false,
  showEta = true,
  scanned,
  total,
  height,
  tip,
  observedAt,
  children,
}: {
  label: string;
  active: boolean;
  syncing: boolean;
  progress: ScanProgress;
  compact?: boolean;
  showEta?: boolean;
  scanned?: number | null;
  total?: number | null;
  height?: number | null;
  tip?: number | null;
  observedAt?: number | null;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const { percent, remainingSeconds, stalled } = progress;
  let eta = t(
    compact ? 'wallet_progress.estimating_short' : 'wallet_progress.estimating'
  );
  if (remainingSeconds === null)
    eta =
      progress.reason === 'EXPIRED'
        ? 'Estimate paused; waiting for an update.'
        : 'Measuring scan speed…';
  else if (remainingSeconds !== null) {
    const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
    const duration =
      minutes < 60
        ? t('wallet_progress.minutes', { count: minutes })
        : t('wallet_progress.hours_minutes', {
            hours: Math.floor(minutes / 60),
            minutes: minutes % 60,
          });
    eta = t('wallet_progress.eta_short', {
      duration,
    });
  }
  if (remainingSeconds !== null)
    eta =
      (progress.reason === 'RETAINED' || stalled
        ? 'Last rough estimate: '
        : 'Rough estimate: ') + eta;
  return (
    <Box
      role="status"
      sx={{
        width: compact ? '100%' : 'min(100%, 420px)',
        whiteSpace: 'normal',
        fontSize: compact ? '0.75rem' : undefined,
      }}
    >
      <Tooltip
        title={
          active && syncing && showEta
            ? `${label} · ${eta}${progress.estimatedAt != null ? ` · Estimate updated ${new Date(progress.estimatedAt).toLocaleTimeString()}` : ''}`
            : label
        }
      >
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
              aria-label={t('wallet_progress.syncing')}
            />
          )}
          <Box>{label}</Box>
        </Box>
      </Tooltip>
      {compact && active && syncing && showEta && (
        <Box sx={{ fontSize: '0.65rem', mt: 0.25 }}>{eta}</Box>
      )}
      {!compact && (syncing || scanned != null || height != null) && (
        <>
          <LinearProgress
            aria-label={t('wallet_progress.syncing')}
            variant={
              active && percent === null ? 'indeterminate' : 'determinate'
            }
            value={percent ?? 0}
            sx={{ my: 1.5, borderRadius: 1 }}
          />
          {active && showEta && <Box sx={{ fontSize: '0.85rem' }}>{eta}</Box>}
          {scanned != null && total != null && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('wallet_progress.scanned', {
                scanned: number(scanned),
                total: number(total),
              })}
            </Box>
          )}
          {height != null && tip != null && (
            <Box sx={{ mt: 0.5, fontSize: '0.78rem' }}>
              {t('wallet_progress.chain_height', {
                scanned: number(height),
                tip: number(tip),
              })}
            </Box>
          )}
          {observedAt != null && (
            <Box
              data-wallet-observation="progress"
              sx={{ mt: 0.5, fontSize: '0.75rem', opacity: 0.8 }}
            >
              Updated {new Date(observedAt).toLocaleTimeString()}.
            </Box>
          )}
          {children}
        </>
      )}
    </Box>
  );
}
