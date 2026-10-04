import { useTranslation } from 'react-i18next';
import {
  WalletPage,
  WalletHeader,
  WalletBalanceCard,
  WalletAmount,
  WalletAddressBar,
  WalletControls,
  WalletTransactions,
  WalletUnavailable,
} from './WalletPage';
import { useState } from 'react';
import { useXmrWallet } from '../../hooks/useXmrWallet';
import { useCoinImageUrl } from '../../hooks/useCoinImageUrl';
import { XmrSyncProgress } from './XmrSyncProgress';
import { XmrSendPanel } from './XmrSendPanel';
import { Box, Button, Typography } from '@mui/material';
import type { ChainConfig } from '../../config/chains';
import {
  formatXmr,
  supportsXmr,
  XMR_STOP_CONTRACT,
} from '../../common/xmrWallet';
import { copyToClipboard } from '../../common/functions';
import { useColors } from '../../theme/ColorTokensContext';
import xmrImage from '../../assets/xmr.png';
/** Dedicated XMR lifecycle, with the same coin detail chrome and theme as the other wallets. */
export function XmrWalletPanel({ chain }: { chain: ChainConfig }) {
  const c = useColors();
  const { t } = useTranslation();
  const coinImageUrl = useCoinImageUrl(chain.ticker) ?? xmrImage;
  const enabled = supportsXmr(chain);
  const {
    account,
    revision,
    current,
    value,
    wallet,
    refresh,
    unlock,
    stop,
    paused,
    stopping,
    progress,
    now,
  } = useXmrWallet(enabled);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const inactive =
    value &&
    ['INACTIVE', 'IDLE', 'STOPPED', 'ACTIVATION_REJECTED'].includes(
      value.state
    );
  const canStop =
    chain.homeWallet?.stopContract === XMR_STOP_CONTRACT &&
    !inactive &&
    !current?.locked;
  const copied = !!wallet && copiedAddress === wallet.address;
  return (
    <WalletPage
      header={
        <WalletHeader
          name={chain.name}
          ticker={chain.ticker}
          imageUrl={coinImageUrl}
          network={chain.activeNetwork}
        />
      }
    >
      {!enabled ? (
        <WalletUnavailable>
          XMR requires desktop Home and an enabled, supported local Core wallet.
        </WalletUnavailable>
      ) : (
        <>
          <WalletBalanceCard
            ticker={chain.ticker}
            imageUrl={coinImageUrl}
            address={wallet?.address}
          >
            <WalletAmount
              amount={
                wallet?.balanceAtomic != null
                  ? formatXmr(wallet.balanceAtomic)
                  : null
              }
              ticker={chain.ticker}
            />
            {wallet && (
              <Typography sx={{ color: c.textSecondary, mt: 1 }}>
                Unlocked: {formatXmr(wallet.unlockedAtomic)}
                {wallet.unlockedAtomic === null ? '' : ' XMR'}
              </Typography>
            )}
            <Typography sx={{ color: c.textSecondary, mt: 2 }}>
              {chain.homeWallet?.send
                ? 'Receive, view and send XMR with approval in Home.'
                : 'Receive and view XMR. Sending is not available yet.'}
            </Typography>
            {current?.error && (
              <Typography role="alert" sx={{ my: 2, color: c.error }}>
                {current.error}
              </Typography>
            )}
            {current?.locked && (
              <Button onClick={() => void unlock()}>Unlock account</Button>
            )}
            {stopping ? (
              <Typography role="status" sx={{ my: 2 }}>
                Stopping wallet… Automatic page updates are paused.
              </Typography>
            ) : value?.state === 'STOPPED' ? (
              <Typography role="status" sx={{ my: 2 }}>
                Stop accepted. Any current wallet operation finishes before
                closing. Saved progress is kept; resume the wallet to continue.
              </Typography>
            ) : value &&
              ['SCANNING', 'STALE', 'UNAVAILABLE', 'READY'].includes(
                value.state
              ) &&
              !current?.error &&
              !paused ? (
              <XmrSyncProgress value={value} progress={progress} now={now} />
            ) : (
              <Typography role="status" sx={{ my: 2 }}>
                {current?.busy && !value
                  ? 'Loading XMR wallet…'
                  : value?.state === 'CLEANUP_REQUIRED'
                    ? 'A previous wallet session still needs cleanup. Check the local Core, then refresh. Activation is paused.'
                    : value?.state === 'RESTART_REQUIRED'
                      ? 'The XMR wallet worker needs a Core restart.'
                      : value?.state === 'INACTIVE'
                        ? 'Activate this wallet to scan. Saved progress is reused; a new wallet starts at block zero.'
                        : value?.state === 'ACTIVATION_REJECTED'
                          ? 'Activation did not complete. Check the local Core and retry.'
                          : value
                            ? 'Wallet status: ' +
                              value.state.toLowerCase().replace(/_/g, ' ')
                            : ''}
              </Typography>
            )}
            {chain.homeWallet?.send === true &&
              chain.homeWallet.sendContract === 'qortium-home-xmr-send-v1' && (
                <XmrSendPanel
                  key={`${String(account)}:${revision}`}
                  account={String(account)}
                  ready={
                    value?.state === 'READY' &&
                    (value.updatedAt === null ||
                      (now >= value.updatedAt &&
                        now - value.updatedAt < 30000)) &&
                    !current?.locked &&
                    !current?.error &&
                    !paused
                  }
                />
              )}
            <WalletControls
              primary={
                canStop
                  ? {
                      label: stopping
                        ? t('wallet_controls.waiting')
                        : t('wallet_controls.stop'),
                      disabled: stopping,
                      busy: stopping,
                      onClick: stop,
                    }
                  : (!value || inactive) && !current?.locked
                    ? {
                        label: t('wallet_controls.start'),
                        disabled: !current || current.busy || stopping,
                        onClick: () => refresh('ACTIVATE_XMR_WALLET'),
                      }
                    : undefined
              }
              refresh={{
                label: t('wallet_controls.refresh'),
                disabled: current?.busy || stopping,
                onClick: () => refresh(),
              }}
              note={
                chain.homeWallet?.stopContract !== XMR_STOP_CONTRACT
                  ? 'Stopping from Wallet requires an updated desktop Home.'
                  : 'Controls affect this account’s wallet. Saved scan progress is kept.'
              }
            />
            {wallet &&
              (current?.error ||
                (value?.state !== 'READY' && value?.state !== 'SCANNING')) && (
                <Typography role="alert">
                  This is the last recorded wallet snapshot. Balances and
                  history may be out of date.
                </Typography>
              )}
            {wallet && !wallet.synced && (
              <Typography sx={{ mt: 2, color: c.textSecondary }}>
                Balances may be incomplete while syncing.
              </Typography>
            )}
          </WalletBalanceCard>
          <WalletAddressBar
            address={wallet?.address ?? ''}
            ticker={chain.ticker}
            copied={copied}
            onCopy={() => {
              if (!wallet) return;
              void copyToClipboard(wallet.address).then(() =>
                setCopiedAddress(wallet.address)
              );
            }}
          />
          <WalletTransactions
            note={wallet ? 'Up to 100 recent transactions.' : undefined}
          >
            {!wallet?.transactions.length ? (
              <Typography
                sx={{
                  py: 6,
                  px: 2,
                  textAlign: 'center',
                  color: c.textSecondary,
                }}
              >
                {wallet
                  ? 'No transactions found in the scanned history.'
                  : 'Activate and sync this wallet to view transactions.'}
              </Typography>
            ) : (
              wallet.transactions.map((tx) => (
                <Box
                  key={tx.txid}
                  sx={{
                    borderBottom: `1px solid ${c.borderLight}`,
                    px: { xs: 2, sm: 3 },
                    py: 2,
                    overflowWrap: 'anywhere',
                  }}
                >
                  <Typography>
                    {tx.confirmed ? 'Confirmed' : 'Pending'} ·{' '}
                    {tx.timestamp === null
                      ? 'Time unavailable'
                      : new Date(tx.timestamp * 1000).toLocaleString()}
                  </Typography>
                  <Typography sx={{ color: c.textSecondary }}>
                    Received: {formatXmr(tx.incomingAtomic)} · Sent:{' '}
                    {formatXmr(tx.outgoingAtomic)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: c.monoFontFamily,
                      color: c.textSecondary,
                    }}
                  >
                    {tx.txid}
                  </Typography>
                </Box>
              ))
            )}
          </WalletTransactions>
        </>
      )}
    </WalletPage>
  );
}
