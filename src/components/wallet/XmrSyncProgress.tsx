import { Box } from '@mui/material';
import { WalletSyncProgress } from './WalletSyncProgress';
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
  const { percent } = progress;
  const syncing = ['SCANNING', 'STALE'].includes(value.state);
  const ready =
    value.state === 'READY' &&
    value.wallet?.synced &&
    (value.updatedAt === null ||
      (now >= value.updatedAt && now - value.updatedAt < 30000));
  const label = ready
    ? t('wallet_progress.ready')
    : syncing
      ? percent === null
        ? t('wallet_progress.syncing')
        : t('wallet_progress.percent', { percent: number(percent) })
      : value.state === 'UNAVAILABLE'
        ? 'Waiting for the XMR wallet. Retrying automatically…'
        : value.state === 'READY'
          ? t('wallet_progress.outdated')
          : `Wallet status: ${value.state.toLowerCase().replace(/_/g, ' ')}`;
  const p = value.progress;
  return (
    <WalletSyncProgress
      label={label}
      active={syncing}
      syncing={syncing}
      progress={progress}
      compact={compact}
      scanned={p ? p.height - p.startHeight : value.wallet?.height}
      total={p ? p.targetHeight - p.startHeight : value.wallet?.targetHeight}
    >
      {value.state === 'STALE' && (
        <Box sx={{ mt: 1 }}>
          Updating balances and history. The scan continues automatically.
        </Box>
      )}
    </WalletSyncProgress>
  );
}
