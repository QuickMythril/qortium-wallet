import { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { uiStyleAtom } from '../../state/global/system';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import { useSupportedChains } from '../../hooks/useSupportedChains';
import { useUnifiedHistory } from '../../hooks/useUnifiedHistory';
import { TransactionRow } from './TransactionRow';

type Filter = 'all' | 'received' | 'sent';

export function UnifiedHistory() {
  const c = useColors();
  const uiStyle = useAtomValue(uiStyleAtom);
  const isClassic = uiStyle === 'classic';
  const navigate = useNavigate();
  const { chains } = useSupportedChains();
  const { rows, loadingChains, errorChains, errorMessages } =
    useUnifiedHistory(chains);

  const [filter, setFilter] = useState<Filter>('all');
  const [expandedTxKey, setExpandedTxKey] = useState<string | null>(null);
  const [copiedHashKey, setCopiedHashKey] = useState<string | null>(null);

  const hasArrr = chains.some((ch) => ch.coinEnum === 'ARRR');
  const totalNonArrr = chains.filter((ch) => ch.coinEnum !== 'ARRR').length;
  const loadedCount = totalNonArrr - loadingChains.length;
  const stillLoading = loadingChains.length > 0;

  const filteredRows = rows.filter((row) => {
    if (filter === 'received') return (row.totalAmount ?? 0) > 0;
    if (filter === 'sent') return (row.totalAmount ?? 0) <= 0;
    return true;
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: isClassic ? c.frameBg : c.bg }}>
      <Box
        sx={{
          position: 'sticky',
          top: `var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px)`,
          zIndex: 90,
          bgcolor: c.surface,
          borderBottom: `${isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${isClassic ? c.border : c.borderLight}`,
          boxShadow: isClassic ? c.topBarShadow : 'none',
          display: 'flex',
          alignItems: 'center',
          px: { xs: isClassic ? 1.5 : 3, sm: 3 },
          py: isClassic ? 1 : 0,
          minHeight: tokens.spacing.topBarHeight,
          gap: 2,
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
          sx={{
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: '0.85rem',
          }}
        >
          All Transactions
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {stillLoading && (
          <Box sx={{ fontSize: '0.72rem', color: c.textSecondary }}>
            Loaded {loadedCount} of {totalNonArrr}
          </Box>
        )}
        {stillLoading && (
          <CircularProgress size={14} sx={{ color: c.accent }} />
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
        {errorChains.length > 0 && (
          <Box
            sx={{
              mb: 2,
              fontSize: '0.75rem',
              color: c.textSecondary,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            <Box component="span">Failed to load:</Box>
            {errorChains.map((ticker, i) => (
              <Tooltip
                key={ticker}
                title={errorMessages[ticker] ?? ''}
                placement="top"
              >
                <Box component="span">
                  {ticker}
                  {i < errorChains.length - 1 ? ',' : ''}
                </Box>
              </Tooltip>
            ))}
          </Box>
        )}

        {hasArrr && (
          <Box
            sx={{
              mb: 2,
              px: 2.5,
              py: 1.5,
              fontSize: '0.78rem',
              color: c.textSecondary,
              border: `${isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${isClassic ? c.border : c.borderLight}`,
              borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
              bgcolor: c.surface,
            }}
          >
            ARRR requires initialization - visit the ARRR page to sync first.
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {(['all', 'received', 'sent'] as Filter[]).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setFilter(f)}
              disableElevation
              sx={{
                borderRadius: isClassic ? `${tokens.shape.radiusMd}px` : '50px',
                fontSize: '0.72rem',
                textTransform: 'capitalize',
                ...(filter === f
                  ? {
                      bgcolor: c.accent,
                      color: c.accentText,
                      '&:hover': { bgcolor: c.accentHover },
                    }
                  : { borderColor: c.borderLight, color: c.textSecondary }),
              }}
            >
              {f}
            </Button>
          ))}
        </Box>

        <Box
          sx={{
            border: `${isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${isClassic ? c.border : c.borderLight}`,
            borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
            overflow: 'hidden',
            boxShadow: c.shadowCard,
          }}
        >
          {filteredRows.length === 0 && !stillLoading ? (
            <Box
              sx={{
                py: 6,
                textAlign: 'center',
                color: c.textSecondary,
                fontSize: '0.85rem',
              }}
            >
              No transactions found
            </Box>
          ) : (
            filteredRows.map((row, i) => {
              const rowKey = `${row.chain.ticker}-${row.txHash ?? i}`;
              return (
                <TransactionRow
                  key={rowKey}
                  row={row}
                  index={i}
                  isLastRow={i === filteredRows.length - 1}
                  chain={row.chain}
                  userAddress={
                    (row.totalAmount ?? 0) > 0
                      ? (row.recipient ?? '')
                      : (row.sender ?? '')
                  }
                  expanded={expandedTxKey === rowKey}
                  onToggleExpand={() =>
                    setExpandedTxKey(expandedTxKey === rowKey ? null : rowKey)
                  }
                  copiedHash={copiedHashKey === rowKey ? i : null}
                  onCopyHash={(_i: number, hash: string) => {
                    const finish = () => {
                      setCopiedHashKey(rowKey);
                      setTimeout(() => setCopiedHashKey(null), 2000);
                    };
                    navigator.clipboard
                      .writeText(hash)
                      .then(finish)
                      .catch(() => {
                        const el = document.createElement('textarea');
                        el.value = hash;
                        el.style.cssText = 'position:fixed;top:-9999px';
                        document.body.appendChild(el);
                        el.focus();
                        el.select();
                        try {
                          document.execCommand('copy');
                        } catch {
                          /* */
                        }
                        document.body.removeChild(el);
                        finish();
                      });
                  }}
                  showCoinBadge
                />
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}
