import { WalletSyncProgress } from './WalletSyncProgress';
import { useTranslation } from 'react-i18next';
import type { UseArrrSyncStatusResult } from '../../hooks/useArrrSyncStatus';

export function ArrrSyncProgress({
  status,
  compact = false,
  paused = false,
}: {
  status: UseArrrSyncStatusResult;
  compact?: boolean;
  paused?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const {
    snapshot,
    progress,
    error,
    consentDenied,
    switching,
    switchingStalled,
  } = status;
  const number = (value: number) => value.toLocaleString(i18n.resolvedLanguage);
  const { percent } = progress;
  const syncing = !paused && snapshot?.state === 'SYNCHRONIZING';
  const ready =
    snapshot?.ready === true && !snapshot.stale && !snapshot.restartRequired;
  let label =
    !snapshot && !status.loading
      ? t('wallet_progress.open_wallet')
      : t('arrr.state_loading');
  if (consentDenied) label = t('arrr.custody_consent_denied');
  else if (switchingStalled) label = t('arrr.state_switching_stalled');
  else if (switching) label = t('arrr.state_switching');
  else if (error) label = error.message;
  else if (snapshot?.restartRequired) label = t('arrr.restart_required');
  else if (ready) label = t('wallet_progress.ready');
  else if (syncing)
    label =
      percent == null
        ? t('wallet_progress.syncing')
        : t('wallet_progress.percent', { percent: number(percent) });
  else if (snapshot?.stale) label = t('wallet_progress.outdated');
  else if (snapshot?.state === 'DEGRADED') label = t('arrr.state_degraded');
  else if (snapshot?.state === 'DISABLED') label = t('arrr.state_disabled');
  else if (snapshot?.state === 'READY') label = t('wallet_progress.outdated');

  if (paused)
    label =
      percent == null
        ? 'Saved scan progress'
        : `Saved scan · ${number(percent)}%`;
  const active =
    !paused &&
    !error &&
    !switchingStalled &&
    !snapshot?.restartRequired &&
    (switching ||
      syncing ||
      (!snapshot && status.loading) ||
      snapshot?.state === 'LOADING');
  return (
    <WalletSyncProgress
      label={label}
      active={active}
      syncing={syncing}
      progress={progress}
      compact={compact}
      scanned={
        snapshot?.syncedBlocks ??
        snapshot?.scanHistory?.samples[snapshot.scanHistory.samples.length - 1]
          ?.blocks
      }
      total={
        snapshot?.totalBlocks ??
        snapshot?.scanHistory?.samples[snapshot.scanHistory.samples.length - 1]
          ?.total
      }
      observedAt={
        snapshot?.scanHistory?.samples[snapshot.scanHistory.samples.length - 1]
          ?.at ?? snapshot?.observedAt
      }
      height={
        snapshot?.syncedBlocks == null ? snapshot?.scannedHeight : undefined
      }
      tip={snapshot?.syncedBlocks == null ? snapshot?.tipHeight : undefined}
    />
  );
}
