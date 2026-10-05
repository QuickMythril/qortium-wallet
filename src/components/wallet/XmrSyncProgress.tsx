import { Box } from '@mui/material';
import { WalletSyncProgress } from './WalletSyncProgress';
import { useTranslation } from 'react-i18next';
import type { XmrSnapshot } from '../../common/xmrWallet';
import type { ScanProgress } from '../../common/scanProgress';
import { walletReadMessage } from '../../common/walletReadStatus';

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
  const { percent } = progress;
  const message = walletReadMessage(value.read);
  const syncing = ['SCANNING', 'STALE', 'UNAVAILABLE'].includes(value.state);
  const ready =
    value.state === 'READY' &&
    value.wallet?.synced &&
    (value.updatedAt === null ||
      (now >= value.updatedAt && now - value.updatedAt < 30000));
  const preparing =
    syncing &&
    !!value.preparation &&
    now >= value.preparation.updatedAt &&
    now - value.preparation.updatedAt < 60000;
  const label = preparing
    ? 'Preparing chain history…'
    : ready
      ? t('wallet_progress.ready')
      : syncing
        ? percent === null
          ? t('wallet_progress.syncing')
          : t('wallet_progress.percent', { percent: number(percent) })
        : value.state === 'READY'
          ? t('wallet_progress.outdated')
          : `Wallet status: ${value.state.toLowerCase().replace(/_/g, ' ')}`;
  const p = value.progress;
  return (
    <WalletSyncProgress
      label={label}
      active={syncing}
      syncing={syncing}
      progress={
        preparing
          ? { percent: null, remainingSeconds: null, stalled: false }
          : progress
      }
      compact={compact}
      showEta={!preparing}
      observedAt={p?.updatedAt}
      scanned={
        preparing
          ? undefined
          : p
            ? p.height - p.startHeight
            : value.wallet?.height
      }
      total={
        preparing
          ? undefined
          : p
            ? p.targetHeight - p.startHeight
            : value.wallet?.targetHeight
      }
    >
      {preparing && (
        <Box sx={{ mt: 1 }}>
          Preparing chain hashes up to block{' '}
          {number(value.preparation!.targetHeight)}. Transaction scanning begins
          at the saved restore height.
        </Box>
      )}
      {!compact && message && (
        <Box sx={{ mt: 0.5, fontSize: '0.75rem', opacity: 0.8 }}>{message}</Box>
      )}
    </WalletSyncProgress>
  );
}
