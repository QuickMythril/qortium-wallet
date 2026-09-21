import { useState } from 'react';
import { Box, CircularProgress, IconButton, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import SendIcon from '@mui/icons-material/Send';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { uiStyleAtom } from '../../state/global/system';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import { formatAssetBalance } from '../../utils/assetAmount';
import type { AssetHolding } from '../../utils/Types';
import { requestAssetWallet } from '../../common/assetBridge';
import { useAssetImageUrl } from '../../hooks/useAssetImageUrl';
import { CoinImage } from './CoinImage';
import { ChainBadge } from './ChainBadge';

interface AssetListRowProps {
  asset: AssetHolding;
  canSend: boolean;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

export function AssetListRow({
  asset,
  canSend,
  dragHandleProps,
  isDragging,
}: AssetListRowProps) {
  const c = useColors();
  const isClassic = useAtomValue(uiStyleAtom) === 'classic';
  const navigate = useNavigate();
  const [address, setAddress] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'loading' | 'done'>(
    'idle'
  );

  const balance = formatAssetBalance(asset.balance, asset.isDivisible);
  const label = asset.name || `Asset #${asset.assetId}`;
  const { url: imageUrl, issuerName } = useAssetImageUrl(asset.network, {
    assetId: asset.assetId,
    name: asset.name,
    owner: asset.owner,
  });

  const openAsset = () => {
    if (!isDragging) navigate(`/asset/${asset.network}/${asset.assetId}`);
  };

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (copyState === 'loading') return;

    setCopyState('loading');
    try {
      let walletAddress = address;
      if (!walletAddress) {
        const response = await requestAssetWallet(asset.network);
        walletAddress = response?.address ?? null;
        if (walletAddress) setAddress(walletAddress);
      }
      if (!walletAddress) {
        setCopyState('idle');
        return;
      }
      await navigator.clipboard.writeText(walletAddress);
      setCopyState('done');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('idle');
    }
  };

  const handleSend = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigate(`/asset/${asset.network}/${asset.assetId}?send=true`);
  };

  const actionButtonSx = {
    color: c.textSecondary,
    borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
    minWidth: 36,
    minHeight: 36,
    '&:hover': { color: c.accent, bgcolor: c.controlHover },
  };

  return (
    <Box
      data-testid={`asset-list-row-${asset.network}-${asset.assetId}`}
      onClick={openAsset}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0.75, sm: 1.5 },
        minHeight: 72,
        px: { xs: 1, sm: 1.5 },
        py: 1,
        border: `${
          isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth
        } solid ${isClassic ? c.border : c.borderLight}`,
        borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
        bgcolor: c.surface,
        boxShadow: isDragging ? c.shadowCardHover : c.shadowCard,
        opacity: isDragging ? 0.85 : 1,
        cursor: 'pointer',
        transition: isDragging
          ? 'none'
          : 'background-color 0.15s ease, box-shadow 0.15s ease',
        '&:hover': { bgcolor: c.surfaceAlt, boxShadow: c.shadowCardHover },
      }}
    >
      {dragHandleProps ? (
        <Tooltip title="Drag to reorder" placement="top">
          <IconButton
            {...dragHandleProps}
            size="small"
            onClick={(event) => event.stopPropagation()}
            aria-label={`reorder ${label}`}
            sx={{
              ...actionButtonSx,
              cursor: isDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Box sx={{ width: 36, flexShrink: 0 }} />
      )}

      <CoinImage
        url={imageUrl}
        ticker={label}
        size={36}
        alt=""
        placeholderSx={{
          bgcolor: c.accentSoft,
          boxShadow: `0 0 0 2px ${c.accent}`,
          color: c.accent,
        }}
      />

      <Box sx={{ minWidth: 0, flex: '1 1 180px' }}>
        <Box
          sx={{
            color: c.textPrimary,
            fontWeight: tokens.typography.weightBold,
            fontSize: '0.9rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mt: 0.4,
          }}
        >
          <ChainBadge
            network={asset.network}
            assetId={asset.assetId}
            issuerName={issuerName}
          />
          <Box
            sx={{
              color: c.textSecondary,
              fontSize: '0.65rem',
              fontWeight: tokens.typography.weightBold,
              letterSpacing: '0.12em',
            }}
          >
            ASSET #{asset.assetId}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          width: { xs: 72, sm: 180 },
          minWidth: 0,
          flexShrink: 1,
          textAlign: 'end',
        }}
      >
        <Box
          title={balance}
          sx={{
            color: c.accent,
            fontWeight: tokens.typography.weightBold,
            fontSize: '0.9rem',
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {balance}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Tooltip title={copyState === 'done' ? 'Copied!' : 'Copy address'}>
          <IconButton
            size="small"
            onClick={(event) => void handleCopy(event)}
            disabled={copyState === 'loading'}
            aria-label={`copy address for ${label}`}
            sx={actionButtonSx}
          >
            {copyState === 'loading' ? (
              <CircularProgress size={16} sx={{ color: c.textSecondary }} />
            ) : copyState === 'done' ? (
              <CheckIcon fontSize="small" />
            ) : (
              <ContentCopyIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title={canSend ? 'Send' : 'Requires a local node'}>
          <span>
            <IconButton
              size="small"
              onClick={handleSend}
              disabled={!canSend}
              aria-label={`send ${label}`}
              sx={actionButtonSx}
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Open asset">
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              openAsset();
            }}
            aria-label={`open ${label}`}
            sx={actionButtonSx}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
