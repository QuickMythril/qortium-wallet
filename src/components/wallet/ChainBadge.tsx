import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useColors } from '../../theme/ColorTokensContext';
import { tokens } from '../../theme/tokens';
import type { AssetNetwork } from '../../utils/Types';

interface ChainBadgeProps {
  network: AssetNetwork;
  /** Shown in the tooltip alongside the resolved (or unknown) issuer. */
  assetId?: number;
  /** The issuer's resolved QDN name, if known - untrusted display text. */
  issuerName?: string | null;
  size?: 'small' | 'medium';
  sx?: Record<string, unknown>;
}

// A small chain-of-origin pill, distinct from (and always rendered
// regardless of) the asset's avatar image, so Qortium and Qortal assets stay
// distinguishable even when both are showing the letter-circle placeholder.
// Qortium keeps the app's existing accent color; Qortal uses the separate
// `info` token so the two are never the same hue in any theme variant.
export function ChainBadge({
  network,
  assetId,
  issuerName,
  size = 'small',
  sx,
}: ChainBadgeProps) {
  const { t } = useTranslation('core');
  const c = useColors();
  const label = t(
    network === 'qortium' ? 'asset.chain_qortium' : 'asset.chain_qortal'
  );
  const color = network === 'qortium' ? c.accent : c.info;
  const tooltipTitle = t(
    issuerName ? 'asset.issuer_line_known' : 'asset.issuer_line_unknown',
    { id: assetId ?? '', issuer: issuerName ?? '' }
  );

  return (
    <Tooltip title={tooltipTitle}>
      <Box
        component="span"
        data-testid={`chain-badge-${network}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${color}`,
          borderRadius: '50px',
          bgcolor: alpha(color, 0.14),
          color,
          fontWeight: tokens.typography.weightBold,
          fontSize: size === 'small' ? '0.6rem' : '0.7rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          lineHeight: 1,
          px: size === 'small' ? 0.75 : 1,
          py: size === 'small' ? 0.4 : 0.5,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          ...sx,
        }}
      >
        {label}
      </Box>
    </Tooltip>
  );
}
