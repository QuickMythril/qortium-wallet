import { useState } from 'react';
import { useAtomValue } from 'jotai';
import { useXmrWallet } from '../../hooks/useXmrWallet';
import { useCoinImageUrl } from '../../hooks/useCoinImageUrl';
import { CoinImage } from './CoinImage';
import { XmrSyncProgress } from './XmrSyncProgress';
import { XmrSendPanel } from './XmrSendPanel';
import { Box, Button, IconButton, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import { useNavigate } from 'react-router-dom';
import _QRCode from 'react-qr-code';
import type { ChainConfig } from '../../config/chains';
import {
  formatXmr,
  supportsXmr,
  XMR_STOP_CONTRACT,
} from '../../common/xmrWallet';
import { copyToClipboard } from '../../common/functions';
import { uiStyleAtom } from '../../state/global/system';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import xmrImage from '../../assets/xmr.png';
const QRCode =
  (_QRCode as unknown as { default?: typeof _QRCode }).default ?? _QRCode;

/** Dedicated XMR lifecycle, with the same coin detail chrome and theme as the other wallets. */
export function XmrWalletPanel({ chain }: { chain: ChainConfig }) {
  const navigate = useNavigate();
  const c = useColors();
  const isClassic = useAtomValue(uiStyleAtom) === 'classic';
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
  const border = `${isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${isClassic ? c.border : c.borderLight}`;
  const radius = `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`;
  const panel = {
    border,
    borderRadius: radius,
    bgcolor: c.surface,
    boxShadow: c.shadowCard,
  };
  const copied = !!wallet && copiedAddress === wallet.address;
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: isClassic ? c.frameBg : c.bg,
        color: c.textPrimary,
      }}
    >
      <Box
        sx={{
          position: 'sticky',
          top: `var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px)`,
          zIndex: 90,
          bgcolor: c.surface,
          borderBottom: border,
          boxShadow: isClassic ? c.topBarShadow : 'none',
          display: 'flex',
          alignItems: 'center',
          px: { xs: isClassic ? 1.5 : 3, sm: 3 },
          py: isClassic ? 1 : 0,
          minHeight: tokens.spacing.topBarHeight,
          gap: { xs: 1, sm: 2 },
          flexWrap: { xs: 'wrap', sm: 'nowrap' },
        }}
      >
        <IconButton
          aria-label="Back to wallets"
          onClick={() => navigate('/')}
          size="small"
          sx={{ borderRadius: 0, color: c.textPrimary }}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <CoinImage
          url={coinImageUrl}
          ticker={chain.ticker}
          size={24}
          placeholderSx={{ fontSize: '0.7rem' }}
        />
        <Typography
          component="h1"
          sx={{
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: '0.85rem',
          }}
        >
          {chain.name}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {enabled && canStop && (
          <Button
            startIcon={<StopCircleOutlinedIcon />}
            disabled={stopping}
            onClick={stop}
          >
            {stopping ? 'Stopping…' : 'Stop wallet'}
          </Button>
        )}
      </Box>
      <Box
        sx={{
          width: '100%',
          maxWidth: isClassic ? c.layoutWideMaxWidth : c.layoutMaxWidth,
          mx: 'auto',
          px: { xs: isClassic ? 1.5 : 2, md: isClassic ? 3 : 4 },
          py: isClassic ? 3 : 4,
        }}
      >
        {!enabled ? (
          <Box sx={{ ...panel, p: 4 }}>
            XMR requires desktop Home and an enabled, supported local Core
            wallet.
          </Box>
        ) : (
          <>
            <Box
              sx={{
                ...panel,
                borderRadius: wallet ? `${radius} ${radius} 0 0` : radius,
                p: { xs: 3, md: 5 },
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: 'center',
                gap: { xs: 3, sm: 4 },
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                  textAlign: 'center',
                }}
              >
                <CoinImage
                  url={coinImageUrl}
                  ticker={chain.ticker}
                  size={56}
                  sx={{ mb: 2, mx: 'auto' }}
                />
                <Typography
                  sx={{
                    fontSize: { xs: '1.6rem', md: '2.5rem' },
                    fontWeight: tokens.typography.weightBlack,
                    lineHeight: 1.2,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {wallet?.balanceAtomic != null
                    ? `${formatXmr(wallet.balanceAtomic)} XMR`
                    : 'Balance not yet available'}
                </Typography>
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
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                    mt: 2,
                  }}
                >
                  <Button
                    disabled={current?.busy || stopping}
                    onClick={() => refresh()}
                  >
                    Refresh status
                  </Button>
                  {(!value || inactive) && !current?.locked && (
                    <Button
                      disabled={!current || current.busy}
                      variant="contained"
                      onClick={() => refresh('ACTIVATE_XMR_WALLET')}
                    >
                      {value?.state === 'STOPPED'
                        ? 'Resume wallet'
                        : 'Activate this wallet'}
                    </Button>
                  )}
                </Box>
                {stopping ? (
                  <Typography role="status" sx={{ my: 2 }}>
                    Stopping wallet… Automatic page updates are paused.
                  </Typography>
                ) : value?.state === 'STOPPED' ? (
                  <Typography role="status" sx={{ my: 2 }}>
                    Stop accepted. Any current wallet operation finishes before
                    closing. Saved progress is kept; resume the wallet to
                    continue.
                  </Typography>
                ) : value &&
                  ['SCANNING', 'STALE', 'UNAVAILABLE', 'READY'].includes(
                    value.state
                  ) &&
                  !current?.error &&
                  !paused ? (
                  <XmrSyncProgress
                    value={value}
                    progress={progress}
                    now={now}
                  />
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
                {chain.homeWallet?.stopContract !== XMR_STOP_CONTRACT && (
                  <Typography variant="body2" sx={{ color: c.textSecondary }}>
                    Stopping from Wallet requires an updated desktop Home.
                  </Typography>
                )}
                {chain.homeWallet?.send === true &&
                  chain.homeWallet.sendContract ===
                    'qortium-home-xmr-send-v1' && (
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
                {wallet &&
                  (current?.error ||
                    (value?.state !== 'READY' &&
                      value?.state !== 'SCANNING')) && (
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
              </Box>
              {wallet && (
                <Box sx={{ flexShrink: 0, textAlign: 'center' }}>
                  <Typography
                    variant="body2"
                    sx={{ mb: 1, color: c.textSecondary }}
                  >
                    Receive XMR
                  </Typography>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: '#fff',
                      borderRadius: `${tokens.shape.radius / 2}px`,
                      display: 'flex',
                    }}
                  >
                    <QRCode
                      value={wallet.address}
                      size={120}
                      bgColor="#ffffff"
                      fgColor="#111111"
                    />
                  </Box>
                </Box>
              )}
            </Box>
            {wallet && (
              <Box
                component="button"
                type="button"
                aria-label="Copy XMR address"
                onClick={async () => {
                  await copyToClipboard(wallet.address);
                  setCopiedAddress(wallet.address);
                }}
                sx={{
                  border,
                  borderTop: 'none',
                  borderRadius: `0 0 ${radius} ${radius}`,
                  background: copied ? c.accent : c.surface,
                  cursor: 'pointer',
                  font: 'inherit',
                  '&:focus-visible': {
                    outline: `2px solid ${c.accent}`,
                    outlineOffset: 2,
                  },
                  color: copied ? c.accentText : c.textSecondary,
                  display: 'flex',
                  width: '100%',
                  textTransform: 'none',
                  px: 2.5,
                  py: 1.5,
                  gap: 1.5,
                  mb: 4,
                }}
              >
                <Typography
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: c.monoFontFamily,
                    fontSize: '0.8rem',
                    overflowWrap: 'anywhere',
                    textAlign: 'left',
                  }}
                >
                  {wallet.address}
                </Typography>
                {copied ? (
                  <CheckIcon sx={{ fontSize: 16 }} />
                ) : (
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                )}
                <Box
                  component="span"
                  sx={{ fontSize: '0.65rem', flexShrink: 0 }}
                >
                  {copied ? 'Copied' : 'Copy address'}
                </Box>
              </Box>
            )}
            <Typography
              sx={{
                fontWeight: tokens.typography.weightBold,
                fontSize: '0.65rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: c.textSecondary,
                mb: 1.5,
                mt: wallet ? 0 : 4,
              }}
            >
              Transactions
            </Typography>
            <Box sx={{ ...panel, overflow: 'hidden' }}>
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
            </Box>
            {wallet && (
              <Typography
                variant="body2"
                sx={{ mt: 2, color: c.textSecondary }}
              >
                Up to 100 recent transactions.
              </Typography>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
