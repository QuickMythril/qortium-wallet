import { useXmrWallet } from '../../hooks/useXmrWallet';
import { XmrSyncProgress } from './XmrSyncProgress';
import { XmrSendPanel } from './XmrSendPanel';
import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import _QRCode from 'react-qr-code';
import type { ChainConfig } from '../../config/chains';
import { formatXmr, supportsXmr } from '../../common/xmrWallet';
import { copyToClipboard } from '../../common/functions';
const QRCode =
  (_QRCode as unknown as { default?: typeof _QRCode }).default ?? _QRCode;

/** No keys or persisted wallet data. Requests are serialized, and old account replies are discarded. */
export function XmrWalletPanel({ chain }: { chain: ChainConfig }) {
  const navigate = useNavigate();
  const enabled = supportsXmr(chain);
  const {
    account,
    revision,
    current,
    value,
    wallet,
    refresh,
    unlock,
    progress,
    now,
  } = useXmrWallet(enabled);
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Button onClick={() => navigate('/')}>Back to wallets</Button>
      <Typography variant="h4" component="h1" sx={{ my: 2 }}>
        Monero (XMR)
      </Typography>
      {!enabled ? (
        <Typography>
          XMR requires desktop Home and an enabled, supported local Core wallet.
        </Typography>
      ) : (
        <>
          <Typography sx={{ mb: 2 }}>
            {chain.homeWallet?.send
              ? 'Receive, view and send XMR with approval in Home.'
              : 'Receive and view XMR. Sending is not available yet.'}
          </Typography>
          {current?.error && (
            <Typography role="alert" sx={{ mb: 2 }}>
              {current.error}
            </Typography>
          )}
          {current?.locked && (
            <Button onClick={() => void unlock()}>Unlock account</Button>
          )}
          <Button disabled={current?.busy} onClick={() => refresh()}>
            Refresh status
          </Button>
          {(!value ||
            ['INACTIVE', 'IDLE', 'STOPPED', 'ACTIVATION_REJECTED'].includes(
              value.state
            )) &&
            !current?.locked && (
              <Button
                disabled={!current || current.busy}
                variant="contained"
                onClick={() => refresh('ACTIVATE_XMR_WALLET')}
              >
                Activate this wallet
              </Button>
            )}
          {value &&
          ['SCANNING', 'STALE', 'UNAVAILABLE', 'READY'].includes(value.state) &&
          !current?.error ? (
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
                      ? 'Activate this wallet to begin scanning. The first scan starts at block zero.'
                      : value?.state === 'ACTIVATION_REJECTED'
                        ? 'Activation did not complete. Check the local Core and retry.'
                        : wallet?.synced && value?.state === 'READY'
                          ? current?.error
                            ? 'Last known status: synced (updates paused)'
                            : 'Synced'
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
                  !current?.error
                }
              />
            )}
          {wallet && (
            <>
              {(current?.error ||
                (value?.state !== 'READY' && value?.state !== 'SCANNING')) && (
                <Typography role="alert">
                  This is the last recorded wallet snapshot. Balances and
                  history may be out of date.
                </Typography>
              )}
              <Typography variant="h6">Receive XMR</Typography>
              <Box
                sx={{
                  background: '#fff',
                  p: 2,
                  display: 'inline-block',
                  my: 2,
                }}
              >
                <QRCode value={wallet.address} size={192} />
              </Box>
              <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>
                {wallet.address}
              </Typography>
              <Button onClick={() => void copyToClipboard(wallet.address)}>
                Copy address
              </Button>
              <Typography sx={{ mt: 3 }}>
                Balance: {formatXmr(wallet.balanceAtomic)}
                {wallet.balanceAtomic === null ? '' : ' XMR'}
              </Typography>
              <Typography>
                Unlocked: {formatXmr(wallet.unlockedAtomic)}
                {wallet.unlockedAtomic === null ? '' : ' XMR'}
              </Typography>
              {!wallet.synced && (
                <Typography sx={{ my: 2 }}>
                  Balances may be incomplete while syncing.
                </Typography>
              )}
              <Typography variant="h6">Recent transactions</Typography>
              {!wallet.transactions.length && (
                <Typography>
                  No transactions found in the scanned history.
                </Typography>
              )}
              {wallet.transactions.map((tx) => (
                <Box
                  key={tx.txid}
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
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
                  <Typography>
                    Received: {formatXmr(tx.incomingAtomic)} · Sent:{' '}
                    {formatXmr(tx.outgoingAtomic)}
                  </Typography>
                  <Typography variant="body2">{tx.txid}</Typography>
                </Box>
              ))}
              <Typography variant="body2" sx={{ mt: 2 }}>
                Up to 100 recent transactions.
              </Typography>
            </>
          )}
        </>
      )}
    </Box>
  );
}
