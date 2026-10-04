import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import _QRCode from 'react-qr-code';
import { uiStyleAtom } from '../../state/global/system';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import { CoinImage } from './CoinImage';

const QRCode =
  (_QRCode as unknown as { default?: typeof _QRCode }).default ?? _QRCode;

function useWalletStyle() {
  const c = useColors();
  const classic = useAtomValue(uiStyleAtom) === 'classic';
  const radius = `${classic ? tokens.shape.radiusMd : tokens.shape.radius}px`;
  const border = `${classic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${classic ? c.border : c.borderLight}`;
  return { c, classic, radius, border };
}

/** Shared page chrome. Coin adapters supply content and supported actions. */
export function WalletPage({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  const { c, classic } = useWalletStyle();
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: classic ? c.frameBg : c.bg,
        color: c.textPrimary,
      }}
    >
      {header}
      <Box
        sx={{
          width: '100%',
          maxWidth: classic ? c.layoutWideMaxWidth : c.layoutMaxWidth,
          mx: 'auto',
          px: { xs: classic ? 1.5 : 2, md: classic ? 3 : 4 },
          py: classic ? 3 : 4,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function WalletHeader({
  name,
  ticker,
  imageUrl,
  network = 'MAIN',
  actions,
}: {
  name: string;
  ticker: string;
  imageUrl?: string | null;
  network?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { c, classic, border } = useWalletStyle();
  return (
    <Box
      data-wallet-section="header"
      sx={{
        position: 'sticky',
        top: `var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px)`,
        zIndex: 90,
        bgcolor: c.surface,
        borderBottom: border,
        boxShadow: classic ? c.topBarShadow : 'none',
        display: 'flex',
        alignItems: 'center',
        px: { xs: classic ? 1.5 : 3, sm: 3 },
        py: classic ? 1 : 0,
        minHeight: tokens.spacing.topBarHeight,
        gap: { xs: 1, sm: 2 },
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
      }}
    >
      <IconButton
        aria-label={t('wallet_controls.back')}
        onClick={() => navigate('/')}
        size="small"
        sx={{ borderRadius: 0, color: c.textPrimary }}
      >
        <ArrowBackIcon fontSize="small" />
      </IconButton>
      <CoinImage
        url={imageUrl ?? null}
        ticker={ticker}
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
        {name}
      </Typography>
      {network !== 'MAIN' && (
        <Box
          sx={{
            fontSize: '0.5rem',
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            px: 0.75,
            py: 0.25,
            borderRadius: '3px',
            bgcolor: c.error,
            color: '#fff',
            lineHeight: 1.4,
          }}
        >
          {network.toLowerCase()}
        </Box>
      )}
      <Box sx={{ flexGrow: 1 }} />
      {actions}
    </Box>
  );
}

export function WalletBalanceCard({
  ticker,
  imageUrl,
  address,
  children,
}: {
  ticker: string;
  imageUrl?: string | null;
  address?: string | null;
  children: ReactNode;
}) {
  const { c, radius, border } = useWalletStyle();
  const { t } = useTranslation();
  return (
    <Box
      data-wallet-section="balance"
      sx={{
        border,
        borderRadius: `${radius} ${radius} 0 0`,
        bgcolor: c.surface,
        boxShadow: c.shadowCard,
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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          width: '100%',
        }}
      >
        <CoinImage
          url={imageUrl ?? null}
          ticker={ticker}
          size={56}
          sx={{ mb: 2 }}
          placeholderSx={{
            bgcolor: 'rgba(128,128,128,0.15)',
            fontSize: '1.2rem',
            color: 'rgba(128,128,128,0.5)',
          }}
        />
        {children}
      </Box>
      {address && (
        <Box
          aria-label={t('wallet_controls.receive', { ticker })}
          sx={{
            flexShrink: 0,
            p: 1.5,
            bgcolor: '#fff',
            borderRadius: `${tokens.shape.radius / 2}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <QRCode
            value={address}
            size={120}
            bgColor="#ffffff"
            fgColor="#111111"
          />
          <Typography variant="caption" sx={{ color: '#111111' }}>
            {t('wallet_controls.receive', { ticker })}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export function WalletUnavailable({ children }: { children: ReactNode }) {
  const { c, radius, border } = useWalletStyle();
  return (
    <Box
      sx={{
        border,
        borderRadius: radius,
        bgcolor: c.surface,
        boxShadow: c.shadowCard,
        p: { xs: 4, md: 6 },
        textAlign: 'center',
        color: c.textSecondary,
        fontSize: '0.875rem',
        lineHeight: 1.6,
      }}
    >
      {children}
    </Box>
  );
}

/** Amounts are already formatted by the adapter; never convert atomic strings to Number here. */
export function WalletAmount({
  amount,
  ticker,
}: {
  amount: string | null;
  ticker: string;
}) {
  const { c } = useWalletStyle();
  return (
    <Typography
      sx={{
        fontSize: { xs: '2rem', md: '3rem' },
        fontWeight: tokens.typography.weightBlack,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        color: c.textPrimary,
        wordBreak: 'break-all',
      }}
    >
      {amount ?? '—'}{' '}
      <Box
        component="span"
        sx={{
          fontSize: '1.1rem',
          fontWeight: tokens.typography.weightBold,
          ml: 1.5,
          color: c.textSecondary,
        }}
      >
        {ticker}
      </Box>
    </Typography>
  );
}

export function WalletAddressBar({
  address,
  ticker,
  copied,
  onCopy,
}: {
  address: string;
  ticker: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { c, border, radius } = useWalletStyle();
  return (
    <Box
      data-wallet-section="address"
      component="button"
      type="button"
      aria-label={`Copy ${ticker} address`}
      disabled={!address}
      onClick={onCopy}
      sx={{
        border,
        borderTop: 'none',
        borderRadius: `0 0 ${radius} ${radius}`,
        background: copied ? c.accent : c.surface,
        color: copied ? c.accentText : c.textSecondary,
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        px: 2.5,
        py: 1.5,
        gap: 1.5,
        cursor: address ? 'pointer' : 'default',
        font: 'inherit',
        textTransform: 'none',
        transition: 'background-color 0.15s ease',
        mb: 4,
        '&:focus-visible': {
          outline: `2px solid ${c.accent}`,
          outlineOffset: 2,
        },
      }}
    >
      <Box
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          fontFamily: c.monoFontFamily,
          fontSize: '0.8rem',
          letterSpacing: '0.04em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {address || '—'}
      </Box>
      {copied ? (
        <CheckIcon sx={{ fontSize: 16 }} />
      ) : (
        <ContentCopyIcon sx={{ fontSize: 16 }} />
      )}
      <Box
        component="span"
        sx={{
          fontSize: '0.65rem',
          fontWeight: tokens.typography.weightBold,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {copied ? 'Copied' : 'Click to copy'}
      </Box>
    </Box>
  );
}

export interface WalletAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}

/** All coin adapters use the same send trigger; they retain their own approval flows. */
export function WalletSendButton({ label, onClick, disabled }: WalletAction) {
  const { c, classic } = useWalletStyle();
  return (
    <Button
      data-wallet-action="send"
      variant="contained"
      size="small"
      disableElevation
      endIcon={<SendIcon sx={{ fontSize: '1rem !important' }} />}
      disabled={disabled}
      onClick={onClick}
      sx={{
        bgcolor: c.accent,
        color: c.accentText,
        '&:hover': { bgcolor: c.accentHover },
        '&.Mui-disabled': { opacity: 0.4 },
        borderRadius: classic ? `${tokens.shape.radiusMd}px` : '50px',
        px: 2.5,
        letterSpacing: classic ? 0 : '0.06em',
        fontWeight: tokens.typography.weightBold,
        fontSize: '0.75rem',
      }}
    >
      {label}
    </Button>
  );
}
/** Stateless controls: ownership, consent and whether stop is confirmed belong to the adapter. */
export function WalletControls({
  primary,
  refresh,
  note,
  children,
}: {
  primary?: WalletAction;
  refresh?: WalletAction;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box
      data-wallet-section="controls"
      sx={{ mt: 2, maxWidth: 460, width: '100%', mx: 'auto' }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 1,
        }}
      >
        {primary && (
          <Button
            variant="outlined"
            disabled={primary.disabled}
            onClick={primary.onClick}
            startIcon={
              primary.busy ? <CircularProgress size={14} /> : undefined
            }
          >
            {primary.label}
          </Button>
        )}
        {refresh && (
          <Button disabled={refresh.disabled} onClick={refresh.onClick}>
            {refresh.label}
          </Button>
        )}
      </Box>
      {note && (
        <Box sx={{ mt: 1, fontSize: '0.75rem', opacity: 0.8 }}>{note}</Box>
      )}
      {children}
    </Box>
  );
}

export function WalletTransactions({
  children,
  note,
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  const { c, border, radius } = useWalletStyle();
  return (
    <Box data-wallet-section="transactions">
      <Typography
        component="h2"
        sx={{
          fontWeight: tokens.typography.weightBold,
          fontSize: '0.65rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: c.textSecondary,
          mb: 1.5,
        }}
      >
        Transactions
      </Typography>
      <Box
        sx={{
          border,
          borderRadius: radius,
          overflow: 'hidden',
          bgcolor: c.surface,
          boxShadow: c.shadowCard,
        }}
      >
        {children}
      </Box>
      {note && (
        <Typography variant="body2" sx={{ mt: 2, color: c.textSecondary }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}
