import { useRef, useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import CheckIcon from '@mui/icons-material/Check';
import { useNavigate } from 'react-router-dom';
import { tokens } from '../../theme/tokens';
import { useColors } from '../../theme/ColorTokensContext';
import { formatAssetBalance } from '../../utils/assetAmount';
import type { AssetHolding } from '../../utils/Types';
import { requestAssetWallet } from '../../common/assetBridge';
import { useAssetImageUrl } from '../../hooks/useAssetImageUrl';
import { useRetryingImageSrc } from '../../hooks/useRetryingImageSrc';
import { ChainBadge } from './ChainBadge';

interface AssetBlockProps {
  asset: AssetHolding;
  canSend: boolean;
  tileSize: number;
  dragListeners?: Record<string, unknown>;
  isDragging?: boolean;
}

export function AssetBlock({
  asset,
  canSend,
  tileSize,
  dragListeners,
  isDragging,
}: AssetBlockProps) {
  const c = useColors();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fetchedRef = useRef(false);

  const balance = formatAssetBalance(asset.balance, asset.isDivisible);
  const label = asset.name || `Asset #${asset.assetId}`;
  const { url: assetImageUrl, issuerName } = useAssetImageUrl(asset.network, {
    assetId: asset.assetId,
    name: asset.name,
    owner: asset.owner,
  });
  const { src: assetImageSrc, onError: onAssetImageError } =
    useRetryingImageSrc(assetImageUrl, label);

  const handleMouseEnter = () => {
    setHovered(true);
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      requestAssetWallet(asset.network)
        .then((res: any) => {
          if (res?.address) setAddress(res.address);
        })
        .catch(() => {});
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  const handleSend = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/asset/${asset.network}/${asset.assetId}?send=true`);
  };

  return (
    <Box
      {...(dragListeners as any)}
      onClick={() =>
        !isDragging && navigate(`/asset/${asset.network}/${asset.assetId}`)
      }
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      sx={{
        aspectRatio: '1 / 1',
        border: `${tokens.shape.borderWidth} solid ${c.borderLight}`,
        // Round (not the rounded-square coin tiles) - the shape itself is
        // the at-a-glance cue that this is a Qortium asset, not a coin.
        borderRadius: '50%',
        overflow: 'hidden',
        bgcolor: hovered ? c.accent : c.surface,
        cursor: dragListeners ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 2,
        position: 'relative',
        transition: isDragging
          ? 'none'
          : 'background-color 0.15s ease, box-shadow 0.15s ease',
        userSelect: 'none',
        boxShadow: isDragging
          ? c.shadowCardHover
          : hovered
            ? c.shadowCardHover
            : c.shadowCard,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      {/* Chain-of-origin badge - always rendered, independent of hover/image
          state, so Qortium and Qortal tiles stay distinguishable even with
          the letter-circle placeholder alone. */}
      <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}>
        <ChainBadge
          network={asset.network}
          assetId={asset.assetId}
          issuerName={issuerName}
        />
      </Box>

      <Box
        sx={{
          position: 'relative',
          width: '44%',
          aspectRatio: '1/1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {assetImageSrc && (
          <Box
            component="img"
            src={assetImageSrc}
            alt=""
            onError={onAssetImageError}
            sx={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              objectFit: 'cover',
              opacity: hovered ? 0 : 1,
              transition: 'opacity 0.15s ease',
            }}
          />
        )}
        <Box
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            bgcolor: hovered
              ? 'rgba(255,255,255,0.15)'
              : assetImageSrc
                ? 'transparent'
                : c.accentSoft,
            boxShadow: assetImageSrc
              ? 'none'
              : `0 0 0 2px ${hovered ? 'rgba(255,255,255,0.5)' : c.accent}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: tokens.typography.weightBold,
            color: hovered ? c.accentText : c.accent,
            opacity: hovered ? 0 : assetImageSrc ? 0 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {label[0]?.toUpperCase() ?? '#'}
        </Box>
        <Box
          sx={{
            position: 'absolute',
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          }}
        >
          <Tooltip title={copied ? 'Copied!' : 'Copy address'} placement="top">
            <IconButton
              size="small"
              onClick={handleCopy}
              disableRipple={!address}
              sx={{
                color: c.accentText,
                bgcolor: 'rgba(255,255,255,0.15)',
                borderRadius: `${tokens.shape.radius / 2}px`,
                p: 0.75,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' },
              }}
            >
              {copied ? (
                <CheckIcon sx={{ fontSize: 16 }} />
              ) : (
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip
            title={canSend ? 'Send' : 'Requires a local node'}
            placement="top"
          >
            <span>
              <IconButton
                size="small"
                onClick={handleSend}
                disabled={!canSend}
                sx={{
                  color: c.accentText,
                  bgcolor: 'rgba(255,255,255,0.15)',
                  borderRadius: `${tokens.shape.radius / 2}px`,
                  p: 0.75,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' },
                  '&.Mui-disabled': { opacity: 0.4, color: c.accentText },
                }}
              >
                <SendIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box
        sx={{
          textAlign: 'center',
          width: '82%',
          mx: 'auto',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            fontSize: '0.65rem',
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: hovered ? c.accentText : c.textSecondary,
            transition: 'color 0.15s ease',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Box>
        <Box
          sx={{
            fontSize: '0.5rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: hovered ? c.accentText : c.textSecondary,
          }}
        >
          {asset.network}
        </Box>
        <Box
          sx={{
            fontSize: '0.9rem',
            fontWeight: tokens.typography.weightBold,
            color: hovered ? c.accentText : c.accent,
            transition: 'color 0.15s ease',
            mt: 0.25,
          }}
        >
          {balance}
        </Box>
        {tileSize <= 6 && (
          <Box
            sx={{
              fontFamily: c.monoFontFamily,
              fontSize: tileSize <= 4 ? '0.55rem' : '0.6rem',
              color: 'rgba(255,255,255,0.75)',
              mt: 0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              px: 0.5,
              opacity: hovered && address ? 1 : 0,
              transition: 'opacity 0.15s ease',
            }}
          >
            {address
              ? address.length > 14
                ? `${address.slice(0, 6)}…${address.slice(-5)}`
                : address
              : ' '}
          </Box>
        )}
      </Box>
    </Box>
  );
}
