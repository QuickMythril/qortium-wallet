import { Box, IconButton } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { uiStyleAtom } from '../../state/global/system';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import { useCoinImageUrl } from '../../hooks/useCoinImageUrl';
import type { ChainConfig } from '../../config/chains';
import { epochToAgo } from '../../common/functions';
import { CoinImage } from './CoinImage';

export interface TxRow {
  txHash?: string;
  totalAmount?: number;
  feeAmount?: number;
  timestamp?: number;
  sender?: string;
  recipient?: string;
  inputs?: { address: string; amount: number; addressInWallet?: boolean }[];
  outputs?: { address: string; amount: number; addressInWallet?: boolean }[];
  /** A just-sent row shown before the poll has confirmed it (round 2, item A). */
  pending?: boolean;
  /** The 30-minute confirmation poll gave up without ever seeing a block height. */
  pendingTimedOut?: boolean;
}

interface TransactionRowProps {
  row: TxRow;
  index: number;
  isLastRow: boolean;
  chain: ChainConfig;
  userAddress: string;
  expanded: boolean;
  onToggleExpand: () => void;
  copiedHash: number | null;
  onCopyHash: (index: number, hash: string) => void;
  /** When true, renders a coin icon + ticker badge before the dot (used in UnifiedHistory) */
  showCoinBadge?: boolean;
}

export function TransactionRow({
  row,
  index,
  isLastRow,
  chain,
  userAddress,
  expanded,
  onToggleExpand,
  copiedHash,
  onCopyHash,
  showCoinBadge,
}: TransactionRowProps) {
  const c = useColors();
  const { t } = useTranslation('core');
  const uiStyle = useAtomValue(uiStyleAtom);
  const isClassic = uiStyle === 'classic';
  const coinImageUrl = useCoinImageUrl(chain.ticker);
  const divisor = Math.pow(10, chain.decimalPlaces);
  const isPositive = (row.totalAmount ?? 0) > 0;

  const txAmount = () =>
    (Number(row.totalAmount ?? 0) / divisor).toFixed(chain.decimalPlaces);

  const txFee = () =>
    (Number(row.feeAmount ?? 0) / divisor).toFixed(chain.decimalPlaces);

  const fmtAddr = (addr?: string) => {
    if (!addr) return '—';
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  };

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v ? v : undefined;

  const counterparty = (): string | undefined => {
    if (isPositive) {
      if (str(row.sender)) return str(row.sender);
      return str(row.inputs?.find((i) => !i.addressInWallet)?.address);
    } else {
      if (str(row.recipient)) return str(row.recipient);
      return str(row.outputs?.find((o) => !o.addressInWallet)?.address);
    }
  };

  const cp = counterparty();

  return (
    <Box
      sx={{
        borderBottom: !isLastRow
          ? `1px solid ${isClassic ? c.border : c.borderLight}`
          : 'none',
      }}
    >
      {/* Row header */}
      <Box
        onClick={onToggleExpand}
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 2.5,
          py: 1.75,
          gap: 2,
          cursor: 'pointer',
          bgcolor: expanded
            ? isClassic
              ? c.controlSelected
              : c.borderLight
            : 'transparent',
          '&:hover': { bgcolor: isClassic ? c.controlHover : c.borderLight },
          transition: 'background-color 0.12s ease',
        }}
      >
        {showCoinBadge && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
            }}
          >
            <CoinImage
              url={coinImageUrl}
              ticker={chain.ticker}
              size={16}
              placeholderSx={{ fontSize: '0.5rem' }}
            />
            <Box
              sx={{
                fontSize: '0.6rem',
                fontWeight: tokens.typography.weightBold,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: c.textSecondary,
                minWidth: 28,
              }}
            >
              {chain.ticker}
            </Box>
          </Box>
        )}

        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: isPositive ? c.success : c.error,
          }}
        />

        <Box
          sx={{
            fontWeight: tokens.typography.weightBold,
            fontSize: '0.9rem',
            color: isPositive ? c.success : c.error,
            minWidth: { xs: 90, sm: 140 },
            flexShrink: 0,
          }}
        >
          {isPositive ? '+' : ''}
          {txAmount()} {chain.ticker}
        </Box>

        <Box
          sx={{
            flex: 1,
            fontFamily: c.monoFontFamily,
            fontSize: '0.72rem',
            color: c.textSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cp
            ? isPositive
              ? `from ${fmtAddr(cp)}`
              : `to ${fmtAddr(cp)}`
            : '—'}
        </Box>

        <Box
          sx={{
            fontSize: '0.7rem',
            color: row.pending ? c.warning : c.textSecondary,
            whiteSpace: 'nowrap',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {row.pendingTimedOut
            ? t('transaction_status.pending_timeout')
            : row.pending
              ? t('transaction_status.pending_confirmation')
              : row.timestamp
                ? epochToAgo(row.timestamp)
                : 'Unconfirmed'}
        </Box>
      </Box>

      {/* Expanded detail */}
      {expanded && (
        <Box
          sx={{
            px: 3,
            py: 2,
            bgcolor: isClassic ? c.surfaceAlt : c.bg,
            borderTop: `1px solid ${isClassic ? c.border : c.borderLight}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          {/* Standard detail rows */}
          {[
            {
              label: 'Hash',
              value: str(row.txHash),
              mono: true,
              copyIdx: index,
            },
            { label: isPositive ? 'From' : 'To', value: cp, mono: true },
            {
              label: isPositive ? 'To' : 'From',
              value: isPositive
                ? userAddress
                : (str(row.sender) ?? userAddress),
              mono: true,
            },
            {
              label: 'Fee',
              value:
                row.feeAmount != null
                  ? `${txFee()} ${chain.ticker}`
                  : undefined,
            },
            {
              label: 'Date',
              value: row.timestamp
                ? new Date(row.timestamp).toLocaleString()
                : undefined,
            },
          ].map(({ label, value, mono, copyIdx }) =>
            value ? (
              <Box
                key={label}
                sx={{ display: 'flex', gap: 2, alignItems: 'center' }}
              >
                <Box
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: tokens.typography.weightBold,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: c.textSecondary,
                    minWidth: 44,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </Box>
                <Box
                  sx={{
                    fontFamily: mono ? c.monoFontFamily : undefined,
                    fontSize: '0.75rem',
                    color: c.textPrimary,
                    wordBreak: 'break-all',
                    flex: 1,
                  }}
                >
                  {String(value)}
                </Box>
                {copyIdx != null && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyHash(copyIdx, value!);
                    }}
                    sx={{ flexShrink: 0, p: 0.5 }}
                  >
                    {copiedHash === copyIdx ? (
                      <CheckIcon sx={{ fontSize: 14, color: c.success }} />
                    ) : (
                      <ContentCopyIcon
                        sx={{ fontSize: 14, color: c.textSecondary }}
                      />
                    )}
                  </IconButton>
                )}
              </Box>
            ) : null
          )}

          {/* Inputs / outputs */}
          {row.inputs?.length || row.outputs?.length ? (
            <Box sx={{ mt: 0.5, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {row.inputs?.length ? (
                <Box>
                  <Box
                    sx={{
                      fontSize: '0.65rem',
                      fontWeight: tokens.typography.weightBold,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: c.textSecondary,
                      mb: 0.5,
                    }}
                  >
                    Inputs
                  </Box>
                  {row.inputs.map((inp, j) => (
                    <Box
                      key={j}
                      sx={{
                        fontFamily: c.monoFontFamily,
                        fontSize: '0.7rem',
                        color: inp.addressInWallet ? c.accent : c.textSecondary,
                      }}
                    >
                      {fmtAddr(inp.address)} ·{' '}
                      {(inp.amount / divisor).toFixed(chain.decimalPlaces)}
                    </Box>
                  ))}
                </Box>
              ) : null}
              {row.outputs?.length ? (
                <Box>
                  <Box
                    sx={{
                      fontSize: '0.65rem',
                      fontWeight: tokens.typography.weightBold,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: c.textSecondary,
                      mb: 0.5,
                    }}
                  >
                    Outputs
                  </Box>
                  {row.outputs.map((out, j) => (
                    <Box
                      key={j}
                      sx={{
                        fontFamily: c.monoFontFamily,
                        fontSize: '0.7rem',
                        color: out.addressInWallet ? c.accent : c.textSecondary,
                      }}
                    >
                      {fmtAddr(out.address)} ·{' '}
                      {(out.amount / divisor).toFixed(chain.decimalPlaces)}
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
