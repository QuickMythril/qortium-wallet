import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate, useSearchParams } from 'react-router-dom';
import _QRCodeDefault from 'react-qr-code';
const QRCode = ((_QRCodeDefault as any).default ??
  _QRCodeDefault) as typeof _QRCodeDefault;
import { useAtom, useAtomValue } from 'jotai';
import { tokens } from '../../theme/tokens';
import { useColors } from '../../theme/ColorTokensContext';
import {
  uiStyleAtom,
  walletReadyAtom,
  pinnedAssetIdsAtom,
  pinnedQortalAssetIdsAtom,
} from '../../state/global/system';
import {
  formatAssetBalance,
  formatAssetQuantity,
} from '../../utils/assetAmount';
import { isPositiveDecimal, isValidRecipient } from '../../utils/walletSend';
import {
  resolveContact,
  type ContactResolution,
} from '../../utils/resolveContact';
import { copyToClipboard } from '../../common/functions';
import {
  EMPTY_STRING,
  TIME_MINUTES_3,
  TIME_SECONDS_3,
} from '../../common/constants';
import { TransactionRow, type TxRow } from './TransactionRow';
import type { AssetData, AssetNetwork } from '../../utils/Types';
import type { ChainConfig } from '../../config/chains';
import {
  requestAssetActions,
  requestAssetInfo,
  requestAssetRead,
  requestAssetTransfer,
  requestAssetUnlock,
  requestAssetWallet,
} from '../../common/assetBridge';
import {
  isUnlockedResult,
  shouldAttemptAccountUnlock,
} from '../../common/walletBridge';
import { useAssetImageUrl } from '../../hooks/useAssetImageUrl';
import { useTranslation } from 'react-i18next';
import { ChainBadge } from './ChainBadge';

interface Props {
  assetId: number;
  network?: AssetNetwork;
}

const RECIPIENT_NAME_LOOKUP_DEBOUNCE_MS = 800;

async function ensureAccountUnlocked(network: AssetNetwork): Promise<boolean> {
  const result = await requestAssetUnlock(network);
  return isUnlockedResult(result);
}

export function AssetDetail({ assetId, network = 'qortium' }: Props) {
  const c = useColors();
  const isClassic = useAtomValue(uiStyleAtom) === 'classic';
  const walletReady = useAtomValue(walletReadyAtom);
  const [pinnedIds, setPinnedIds] = useAtom(pinnedAssetIdsAtom);
  const [pinnedQortalIds, setPinnedQortalIds] = useAtom(
    pinnedQortalAssetIdsAtom
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [assetInfo, setAssetInfo] = useState<AssetData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [address, setAddress] = useState<string>(EMPTY_STRING);
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [expandedTx, setExpandedTx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedHash, setCopiedHash] = useState<number | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [canUnlock, setCanUnlock] = useState(false);

  const [sendOpen, setSendOpen] = useState(
    () => searchParams.get('send') === 'true'
  );
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(
    () => searchParams.get('to') ?? EMPTY_STRING
  );
  const [recipientMode, setRecipientMode] = useState<'address' | 'name'>(
    'address'
  );
  const [recipientName, setRecipientName] = useState(EMPTY_STRING);
  const [resolution, setResolution] = useState<ContactResolution | null>(null);
  const [resolvingRecipient, setResolvingRecipient] = useState(false);
  const [staleAddressWarning, setStaleAddressWarning] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<'success' | 'error' | null>(
    null
  );

  const { t } = useTranslation('core');
  const selectedPinnedIds = network === 'qortal' ? pinnedQortalIds : pinnedIds;
  const isPinned = selectedPinnedIds.includes(assetId);
  const isDivisible = assetInfo?.isDivisible ?? true;
  const decimalPlaces = isDivisible ? 8 : 0;
  const label = assetInfo?.name || `Asset #${assetId}`;
  const { issuerName } = useAssetImageUrl(network, {
    assetId,
    name: assetInfo?.name ?? '',
    owner: assetInfo?.owner ?? '',
  });
  const issuerLine = issuerName
    ? t('asset.issuer_line_known', { id: assetId, issuer: issuerName })
    : t('asset.issuer_line_unknown', { id: assetId });

  const fetchAddress = useCallback(async () => {
    try {
      const res = await requestAssetWallet(network);
      if (res?.address) setAddress(res.address);
    } catch {
      /* silent */
    }
  }, [network]);

  const fetchAssetInfo = useCallback(async () => {
    try {
      const res = await requestAssetInfo(network, { assetId });
      setAssetInfo(res as AssetData);
    } catch {
      setNotFound(true);
    }
  }, [assetId, network]);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    setLoadingBalance(true);
    try {
      const res = await requestAssetRead(network, {
        action: 'GET_ASSET_BALANCES',
        address,
        assetId,
        limit: 0,
      });
      const rows = Array.isArray(res) ? res : [];
      setBalance(rows[0]?.balance ?? '0');
    } catch {
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [address, assetId, network]);

  const fetchTransactions = useCallback(async () => {
    if (!address) return;
    setLoadingTx(true);
    try {
      const res = await requestAssetRead(network, {
        action: 'GET_ASSET_TRANSFERS',
        assetId,
        address,
        limit: 20,
        reverse: true,
      });
      const data: any[] = Array.isArray(res) ? res : [];
      const rows: TxRow[] = data.map((tx) => {
        const incoming = tx.recipient === address;
        const raw = Math.round(parseFloat(tx.amount ?? '0') * 1e8);
        const feeRaw = Math.round(parseFloat(tx.fee ?? '0') * 1e8);
        return {
          txHash: tx.signature,
          totalAmount: incoming ? raw : -raw,
          feeAmount: feeRaw,
          timestamp: tx.timestamp,
          sender: incoming ? (tx.creatorAddress ?? undefined) : address,
          recipient: tx.recipient,
        };
      });
      setTransactions(rows);
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTx(false);
    }
  }, [address, assetId, network]);

  useEffect(() => {
    setNotFound(false);
    fetchAssetInfo();
  }, [fetchAssetInfo]);

  useEffect(() => {
    if (!walletReady) return;
    fetchAddress();
  }, [walletReady, fetchAddress]);

  useEffect(() => {
    if (!walletReady || !address) return;
    fetchBalance();
    fetchTransactions();
    const id = setInterval(() => {
      fetchBalance();
      fetchTransactions();
    }, TIME_MINUTES_3);
    return () => clearInterval(id);
  }, [walletReady, address, fetchBalance, fetchTransactions]);

  useEffect(() => {
    setCanSend(false);
    setCanUnlock(false);
    requestAssetActions(network)
      .then((actions: unknown) => {
        if (Array.isArray(actions)) {
          setCanSend(actions.includes('TRANSFER_ASSET'));
          // The 'qortium' asset network always resolves through qdnRequest
          // (Home), which supports UNLOCK_SELECTED_ACCOUNT even when a
          // particular build's SHOW_ACTIONS response omits it.
          setCanUnlock(
            shouldAttemptAccountUnlock(network === 'qortium', actions)
          );
        }
      })
      .catch(() => {
        setCanSend(false);
        setCanUnlock(false);
      });
  }, [network]);

  useEffect(() => {
    if (recipientMode !== 'name') return;
    const trimmed = recipientName.trim();
    if (!trimmed) {
      setResolution(null);
      setRecipient(EMPTY_STRING);
      return;
    }
    let cancelled = false;
    setResolvingRecipient(true);
    const timeout = setTimeout(async () => {
      // Assets share the account's native QORT address - resolve against the
      // QORT slot of a published contact card, same as a native QORT send.
      const result = await resolveContact(trimmed, 'QORT', network);
      if (cancelled) return;
      setResolution(result);
      setRecipient(
        result.status === 'resolved' ? result.address : EMPTY_STRING
      );
      setResolvingRecipient(false);
    }, RECIPIENT_NAME_LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [recipientName, recipientMode, network]);

  const togglePin = () => {
    const setter = network === 'qortal' ? setPinnedQortalIds : setPinnedIds;
    setter((previous) =>
      isPinned
        ? previous.filter((id) => id !== assetId)
        : [...previous, assetId]
    );
  };

  const handleCopy = () => {
    if (!address) return;
    copyToClipboard(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openSend = () => {
    setAmount('');
    setRecipient(EMPTY_STRING);
    setRecipientMode('address');
    setRecipientName(EMPTY_STRING);
    setResolution(null);
    setResolvingRecipient(false);
    setStaleAddressWarning(false);
    setSendResult(null);
    setSendOpen(true);
  };

  const closeSend = () => {
    setSendOpen(false);
    setSendResult(null);
    setAmount('');
    setRecipient(EMPTY_STRING);
    setRecipientMode('address');
    setRecipientName(EMPTY_STRING);
    setResolution(null);
    setResolvingRecipient(false);
    setStaleAddressWarning(false);
    setSearchParams({});
  };

  const amountIsValid = isPositiveDecimal(amount, decimalPlaces);
  const recipientIsValid = isValidRecipient(recipient);
  const canConfirmSend =
    !sending &&
    amountIsValid &&
    recipientIsValid &&
    (recipientMode !== 'name' ||
      (!resolvingRecipient && resolution?.status === 'resolved'));
  const showAmountError = amount !== '' && !amountIsValid;
  const showRecipientError = recipient !== '' && !recipientIsValid;

  const handleSend = async () => {
    if (!canConfirmSend) return;
    setSending(true);
    try {
      if (canUnlock && !(await ensureAccountUnlocked(network))) return;

      let effectiveRecipient = recipient;
      if (recipientMode === 'name') {
        const fresh = await resolveContact(
          recipientName.trim(),
          'QORT',
          network
        );
        setResolution(fresh);
        if (fresh.status !== 'resolved') return;
        if (fresh.address !== recipient) {
          setRecipient(fresh.address);
          setStaleAddressWarning(true);
          return;
        }
        effectiveRecipient = fresh.address;
      }

      const res = await requestAssetTransfer(
        network,
        assetId,
        effectiveRecipient,
        amount
      );
      if (res?.accepted === false)
        throw new Error(res.error ?? 'TRANSFER_ASSET failed');
      setSendResult('success');
      setStaleAddressWarning(false);

      window.setTimeout(() => {
        fetchBalance();
        fetchTransactions();
      }, TIME_SECONDS_3);
    } catch {
      setSendResult('error');
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    if (!balance) return;
    setAmount(formatAssetBalance(balance, isDivisible));
  };

  const handleCopyHash = (i: number, hash: string) => {
    navigator.clipboard
      .writeText(hash)
      .then(() => {
        setCopiedHash(i);
        setTimeout(() => setCopiedHash(null), 2000);
      })
      .catch(() => {});
  };

  // Adapter satisfying TransactionRow's ChainConfig prop - only ticker and
  // decimalPlaces are actually read for asset rows.
  const chainAdapter: ChainConfig = {
    key: `asset:${network}:${assetId}`,
    name: label,
    ticker: assetInfo?.name || `#${assetId}`,
    coinEnum: `ASSET_${assetId}`,
    route: `asset/${network}/${assetId}`,
    defaultFee: 0,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: false,
    supportsLocalChainTrades: false,
  };

  if (notFound) {
    return (
      <Box
        sx={{ minHeight: '100vh', bgcolor: isClassic ? c.frameBg : c.bg, p: 4 }}
      >
        <IconButton onClick={() => navigate('/')} size="small" sx={{ mb: 2 }}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box sx={{ textAlign: 'center', color: c.textSecondary, py: 6 }}>
          {network === 'qortal' ? 'Qortal' : 'Qortium'} asset #{assetId} was not
          found on this node.
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: isClassic ? c.frameBg : c.bg }}>
      {/* ── sticky sub-header ── */}
      <Box
        sx={{
          position: 'sticky',
          top: `var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px)`,
          zIndex: 90,
          bgcolor: c.surface,
          borderBottom: `${
            isClassic
              ? tokens.shape.classicBorderWidth
              : tokens.shape.borderWidth
          } solid ${isClassic ? c.border : c.borderLight}`,
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
          onClick={() => navigate('/')}
          size="small"
          sx={{ borderRadius: 0, color: c.textPrimary }}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box
          aria-hidden="true"
          sx={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            bgcolor: c.accentSoft,
            boxShadow: `0 0 0 2px ${c.accent}`,
            color: c.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.7rem',
            fontWeight: tokens.typography.weightBold,
            flexShrink: 0,
          }}
        >
          {label[0]?.toUpperCase() ?? '#'}
        </Box>
        <Box
          sx={{
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: '0.85rem',
          }}
        >
          {label}
        </Box>
        <ChainBadge
          network={network}
          assetId={assetId}
          issuerName={issuerName}
        />
        <Tooltip
          title={isPinned ? 'Stop tracking this asset' : 'Track this asset'}
        >
          <IconButton size="small" onClick={togglePin} sx={{ color: c.accent }}>
            {isPinned ? (
              <BookmarkIcon fontSize="small" />
            ) : (
              <BookmarkBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip
          title={!canSend ? 'Sending requires a local node' : ''}
          disableHoverListener={canSend}
        >
          <span>
            <Button
              variant="contained"
              size="small"
              endIcon={<SendIcon sx={{ fontSize: '1rem !important' }} />}
              onClick={openSend}
              disableElevation
              disabled={!canSend}
              sx={{
                bgcolor: c.accent,
                color: c.accentText,
                '&:hover': { bgcolor: c.accentHover },
                '&.Mui-disabled': { opacity: 0.4 },
                borderRadius: isClassic ? `${tokens.shape.radiusMd}px` : '50px',
                px: 2.5,
                letterSpacing: isClassic ? 0 : '0.06em',
                fontWeight: tokens.typography.weightBold,
                fontSize: '0.75rem',
              }}
            >
              Send
            </Button>
          </span>
        </Tooltip>
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
        {/* ── issuer / asset id line ── */}
        <Box
          data-testid="asset-issuer-line"
          sx={{
            color: c.textSecondary,
            fontSize: '0.7rem',
            letterSpacing: '0.04em',
            mb: 1.5,
          }}
        >
          {issuerLine}
        </Box>

        {/* ── balance hero ── */}
        <Box
          sx={{
            border: `${
              isClassic
                ? tokens.shape.classicBorderWidth
                : tokens.shape.borderWidth
            } solid ${isClassic ? c.border : c.borderLight}`,
            borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px ${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px 0 0`,
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
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              width: '100%',
            }}
          >
            {loadingBalance ? (
              <Skeleton width={220} height={64} sx={{ mx: 'auto' }} />
            ) : (
              <Typography
                sx={{
                  fontSize: { xs: '2rem', md: '3rem' },
                  fontWeight: tokens.typography.weightBlack,
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                  color: c.accent,
                  wordBreak: 'break-all',
                }}
              >
                {balance != null
                  ? formatAssetBalance(balance, isDivisible)
                  : '—'}
                <Box
                  component="span"
                  sx={{
                    fontSize: '1.1rem',
                    fontWeight: tokens.typography.weightBold,
                    ml: 1.5,
                    color: c.textSecondary,
                  }}
                >
                  {label}
                </Box>
              </Typography>
            )}
          </Box>

          {address && (
            <Box
              sx={{
                flexShrink: 0,
                p: 1.5,
                bgcolor: '#fff',
                borderRadius: `${tokens.shape.radius / 2}px`,
                display: 'flex',
              }}
            >
              <QRCode
                value={address}
                size={120}
                bgColor="#ffffff"
                fgColor="#111111"
              />
            </Box>
          )}
        </Box>

        {/* ── address bar ── */}
        <Box
          onClick={handleCopy}
          sx={{
            border: `${
              isClassic
                ? tokens.shape.classicBorderWidth
                : tokens.shape.borderWidth
            } solid ${isClassic ? c.border : c.borderLight}`,
            borderTop: 'none',
            borderRadius: `0 0 ${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px ${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
            bgcolor: copied ? c.accent : c.surface,
            display: 'flex',
            alignItems: 'center',
            px: 2.5,
            py: 1.5,
            gap: 1.5,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            mb: 3,
          }}
        >
          <Box
            sx={{
              flex: 1,
              fontFamily: c.monoFontFamily,
              fontSize: '0.8rem',
              letterSpacing: '0.04em',
              color: copied ? c.accentText : c.textSecondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {address || '—'}
          </Box>
          {copied ? (
            <CheckIcon sx={{ fontSize: 16, color: c.accentText }} />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16, color: c.textSecondary }} />
          )}
          <Box
            sx={{
              fontSize: '0.65rem',
              fontWeight: tokens.typography.weightBold,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: copied ? c.accentText : c.textSecondary,
              whiteSpace: 'nowrap',
            }}
          >
            {copied ? 'Copied' : 'Click to copy'}
          </Box>
        </Box>

        {/* ── asset info panel ── */}
        <Box
          sx={{
            fontWeight: tokens.typography.weightBold,
            fontSize: '0.65rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: c.textSecondary,
            mb: 1.5,
          }}
        >
          Asset Info
        </Box>
        <Box
          sx={{
            border: `${
              isClassic
                ? tokens.shape.classicBorderWidth
                : tokens.shape.borderWidth
            } solid ${isClassic ? c.border : c.borderLight}`,
            borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
            bgcolor: c.surface,
            boxShadow: c.shadowCard,
            p: 3,
            mb: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          {!assetInfo ? (
            <Skeleton height={100} />
          ) : (
            [
              { label: 'Asset ID', value: String(assetInfo.assetId) },
              {
                label: 'Description',
                value: assetInfo.description || undefined,
                // Issuer-supplied text - rendered as a plain text node only
                // (React escapes it; never dangerouslySetInnerHTML), and
                // clamped so a long description can't push the rest of the
                // panel down indefinitely.
                clamp: true,
              },
              { label: 'Owner', value: assetInfo.owner, mono: true },
              {
                label: 'Total Supply',
                value: formatAssetQuantity(
                  assetInfo.quantity,
                  assetInfo.isDivisible
                ),
              },
              {
                label: 'Divisible',
                value: assetInfo.isDivisible ? 'Yes' : 'No',
              },
              { label: 'Data', value: assetInfo.data || undefined, mono: true },
              {
                label: 'Ownership',
                value: assetInfo.isOwnerForSale
                  ? `For sale${assetInfo.ownerSalePrice ? ` at ${assetInfo.ownerSalePrice} QORT` : ''}`
                  : undefined,
              },
            ]
              .filter((row) => row.value !== undefined)
              .map((row) => (
                <Box
                  key={row.label}
                  sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}
                >
                  <Box
                    sx={{
                      fontSize: '0.65rem',
                      fontWeight: tokens.typography.weightBold,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: c.textSecondary,
                      minWidth: 110,
                      flexShrink: 0,
                      pt: '2px',
                    }}
                  >
                    {row.label}
                  </Box>
                  <Box
                    sx={{
                      fontFamily: row.mono ? c.monoFontFamily : undefined,
                      fontSize: '0.8rem',
                      color: c.textPrimary,
                      wordBreak: 'break-all',
                      flex: 1,
                      ...(row.clamp
                        ? {
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }
                        : {}),
                    }}
                  >
                    {row.value}
                  </Box>
                </Box>
              ))
          )}
        </Box>

        {/* ── transaction history ── */}
        <Box
          sx={{
            fontWeight: tokens.typography.weightBold,
            fontSize: '0.65rem',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: c.textSecondary,
            mb: 1.5,
          }}
        >
          Transfers
        </Box>
        <Box
          sx={{
            border: `${
              isClassic
                ? tokens.shape.classicBorderWidth
                : tokens.shape.borderWidth
            } solid ${isClassic ? c.border : c.borderLight}`,
            borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
            overflow: 'hidden',
            boxShadow: c.shadowCard,
          }}
        >
          {loadingTx ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} sx={{ color: c.accent }} />
            </Box>
          ) : transactions.length === 0 ? (
            <Box
              sx={{
                py: 6,
                textAlign: 'center',
                color: c.textSecondary,
                fontSize: '0.85rem',
                letterSpacing: '0.06em',
              }}
            >
              No transfers yet
            </Box>
          ) : (
            transactions.map((row, i) => (
              <TransactionRow
                key={i}
                row={row}
                index={i}
                isLastRow={i === transactions.length - 1}
                chain={chainAdapter}
                userAddress={address}
                expanded={expandedTx === i}
                onToggleExpand={() =>
                  setExpandedTx((prev) => (prev === i ? null : i))
                }
                copiedHash={copiedHash}
                onCopyHash={handleCopyHash}
              />
            ))
          )}
        </Box>
      </Box>

      {/* ── send dialog ── */}
      <Dialog
        open={sendOpen}
        onClose={closeSend}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            maxWidth: isClassic ? c.layoutMaxWidth : undefined,
            border: `${
              isClassic
                ? tokens.shape.classicBorderWidth
                : tokens.shape.borderWidth
            } solid ${isClassic ? c.border : c.borderLight}`,
            borderRadius: isClassic ? `${tokens.shape.radiusMd}px` : 0,
            bgcolor: c.surface,
            boxShadow: isClassic ? c.shadowModal : undefined,
          },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              px: 3,
              py: 2,
              borderBottom: `${
                isClassic
                  ? tokens.shape.classicBorderWidth
                  : tokens.shape.borderWidth
              } solid ${isClassic ? c.border : c.borderLight}`,
            }}
          >
            <Box
              sx={{
                fontWeight: tokens.typography.weightBold,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontSize: '0.85rem',
                flexGrow: 1,
              }}
            >
              Send {label}
            </Box>
            <IconButton
              size="small"
              onClick={closeSend}
              sx={{ borderRadius: 0 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box
            sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}
          >
            {sendResult === 'success' ? (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <CheckIcon sx={{ fontSize: 48, color: c.success, mb: 1 }} />
                <Typography sx={{ fontWeight: tokens.typography.weightBold }}>
                  Transaction sent
                </Typography>
              </Box>
            ) : sendResult === 'error' ? (
              <Box sx={{ textAlign: 'center', py: 3, color: c.error }}>
                <Typography sx={{ fontWeight: tokens.typography.weightBold }}>
                  Send failed
                </Typography>
              </Box>
            ) : (
              <>
                <Box
                  sx={{
                    color: c.textSecondary,
                    fontSize: '0.8rem',
                    letterSpacing: '0.06em',
                  }}
                >
                  balance:{' '}
                  <Box
                    component="span"
                    sx={{
                      color: c.textPrimary,
                      fontWeight: tokens.typography.weightBold,
                    }}
                  >
                    {balance != null
                      ? formatAssetBalance(balance, isDivisible)
                      : '—'}{' '}
                    {label}
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField
                    label={`Amount (${label})`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.trim())}
                    fullWidth
                    disabled={sending}
                    error={showAmountError}
                    helperText={
                      showAmountError
                        ? `Enter a valid amount with up to ${decimalPlaces} decimal places.`
                        : undefined
                    }
                    inputProps={{ inputMode: 'decimal' }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={sending || !balance}
                    onClick={handleMax}
                    sx={{
                      mt: '8px',
                      flexShrink: 0,
                      borderRadius: isClassic
                        ? `${tokens.shape.radiusMd}px`
                        : '50px',
                      borderColor: c.accent,
                      color: c.accent,
                      fontSize: '0.7rem',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        borderColor: c.accentHover,
                        color: c.accentHover,
                      },
                    }}
                  >
                    Max
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant={
                      recipientMode === 'address' ? 'contained' : 'outlined'
                    }
                    onClick={() => {
                      setRecipientMode('address');
                      setStaleAddressWarning(false);
                    }}
                    disabled={sending}
                  >
                    Address
                  </Button>
                  <Button
                    size="small"
                    variant={
                      recipientMode === 'name' ? 'contained' : 'outlined'
                    }
                    onClick={() => {
                      setRecipientMode('name');
                      setStaleAddressWarning(false);
                    }}
                    disabled={sending}
                  >
                    Name
                  </Button>
                </Box>

                {recipientMode === 'address' ? (
                  <TextField
                    label="Recipient address"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value.trim())}
                    fullWidth
                    disabled={sending}
                    error={showRecipientError}
                    helperText={
                      showRecipientError ? 'Enter a valid recipient' : undefined
                    }
                  />
                ) : (
                  <>
                    <TextField
                      label="Recipient name"
                      value={recipientName}
                      onChange={(e) => {
                        setRecipientName(e.target.value);
                        setStaleAddressWarning(false);
                      }}
                      fullWidth
                      disabled={sending}
                    />
                    {resolvingRecipient && (
                      <Typography variant="caption">Resolving…</Typography>
                    )}
                    {!resolvingRecipient &&
                      resolution?.status === 'resolved' && (
                        <Typography variant="caption" sx={{ color: c.success }}>
                          Resolved to {resolution.address}
                        </Typography>
                      )}
                    {!resolvingRecipient &&
                      resolution &&
                      resolution.status !== 'resolved' && (
                        <Typography variant="caption" sx={{ color: c.error }}>
                          {resolution.status === 'name-not-found' &&
                            'Name not found'}
                          {resolution.status === 'no-card' &&
                            'No contact card published for this name'}
                          {resolution.status === 'coin-not-published' &&
                            'This name has not published a QORT address'}
                          {resolution.status === 'fetch-failed' &&
                            'Could not resolve name'}
                        </Typography>
                      )}
                    {staleAddressWarning && (
                      <Typography variant="caption" sx={{ color: c.warning }}>
                        The resolved address changed - please confirm and send
                        again.
                      </Typography>
                    )}
                  </>
                )}

                <Button
                  variant="contained"
                  fullWidth
                  size="large"
                  onClick={handleSend}
                  disabled={!canConfirmSend}
                  disableElevation
                  sx={{
                    bgcolor: c.accent,
                    color: c.accentText,
                    '&:hover': { bgcolor: c.accentHover },
                    '&.Mui-disabled': { bgcolor: c.borderLight },
                    borderRadius: isClassic ? `${tokens.shape.radiusMd}px` : 0,
                    py: 1.5,
                  }}
                >
                  {sending ? (
                    <CircularProgress size={20} sx={{ color: 'white' }} />
                  ) : (
                    'Confirm Send'
                  )}
                </Button>
              </>
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
