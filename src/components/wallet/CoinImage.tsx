import { Box } from '@mui/material';
import { tokens } from '../../theme/tokens';
import { useRetryingImageSrc } from '../../hooks/useRetryingImageSrc';

interface CoinImageProps {
  url: string | null;
  ticker: string;
  size: number | string;
  alt?: string;
  /** Applied to both the <img> and the placeholder (e.g. sizing, margin). */
  sx?: Record<string, unknown>;
  /** Applied only when rendering the <img> (e.g. opacity while syncing). */
  imgSx?: Record<string, unknown>;
  /** Applied only when rendering the letter-circle placeholder. */
  placeholderSx?: Record<string, unknown>;
}

export function CoinImage({
  url,
  ticker,
  size,
  alt,
  sx,
  imgSx,
  placeholderSx,
}: CoinImageProps) {
  // Retry-with-backoff state machine (cache-busted retries, placeholder
  // while waiting or once exhausted) lives in this shared hook so CoinGrid's
  // tile view can reuse it with its own wrapper/hover markup.
  const { src, onError } = useRetryingImageSrc(url, ticker);

  if (!src) {
    return (
      <Box
        aria-hidden="true"
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          bgcolor: 'rgba(128,128,128,0.18)',
          color: 'rgba(128,128,128,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: tokens.typography.weightBold,
          flexShrink: 0,
          ...sx,
          ...placeholderSx,
        }}
      >
        {ticker[0]}
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src={src}
      alt={alt ?? ticker}
      onError={onError}
      sx={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        ...sx,
        ...imgSx,
      }}
    />
  );
}
