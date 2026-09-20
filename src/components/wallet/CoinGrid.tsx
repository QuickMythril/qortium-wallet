import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Box, IconButton, Skeleton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSupportedChains } from '../../hooks/useSupportedChains';
import { useMarketPrices } from '../../hooks/useMarketPrices';
import { useCoinImageUrl } from '../../hooks/useCoinImageUrl';
import { useRetryingImageSrc } from '../../hooks/useRetryingImageSrc';
import { useAssetHoldings } from '../../hooks/useAssetHoldings';
import { CoinListRow } from './CoinListRow';
import { AssetBlock } from './AssetBlock';
import { AssetListRow } from './AssetListRow';
import { AddAssetTile, AddAssetRow, AddAssetDialog } from './AddAssetDialog';
import { requestWithTimeout, formatFiat } from '../../common/functions';
import { formatAssetBalance } from '../../utils/assetAmount';
import { tokens } from '../../theme/tokens';
import { useColors } from '../../theme/ColorTokensContext';
import type { ChainConfig } from '../../config/chains';
import type { AssetHolding } from '../../utils/Types';
import type { AssetNetwork } from '../../utils/Types';
import {
  sortModeAtom,
  customOrderAtom,
  migrateLegacyCustomOrder,
  tileSizeAtom,
  uiStyleAtom,
  currencyAtom,
  portfolioFiatAtom,
  hideZeroAtom,
  walletReadyAtom,
  viewModeAtom,
} from '../../state/global/system';
import {
  qortSendActionForActions,
  requestQortActions,
  requestQortBalance,
  requestWalletForChain,
} from '../../common/walletBridge';
import { requestAssetActions } from '../../common/assetBridge';
import { foreignWalletAvailability } from '../../common/homeWalletCapabilities';
import { describeBridgeError } from '../../common/bridgeErrors';

type WalletItem =
  | { kind: 'chain'; key: string; chain: ChainConfig }
  | { kind: 'asset'; key: string; asset: AssetHolding };

function itemName(item: WalletItem): string {
  return item.kind === 'chain'
    ? item.chain.name
    : item.asset.name || `Asset #${item.asset.assetId}`;
}

// Min tile width in px per zoom level — CSS auto-fill guarantees each level is visually distinct
const TILE_MIN_PX: Record<number, number> = {
  1: 320,
  2: 260,
  3: 220,
  4: 170,
  5: 130,
  6: 95,
  7: 65,
  8: 50,
  9: 38,
};

interface BlockProps {
  chain: ChainConfig;
  balance: string | null;
  balanceError?: string;
  onRetryBalance: (chain: ChainConfig) => void;
  canReceive: boolean;
  canSend: boolean;
  loading: boolean;
  tileSize: number;
  fiatDisplay?: string;
  dragListeners?: Record<string, unknown>;
  isDragging?: boolean;
}

// Exported (in addition to being used internally by CoinGrid) so it can be
// tested in isolation, e.g. the image onError/retry behavior.
export function CoinBlock({
  chain,
  balance,
  balanceError,
  onRetryBalance,
  canReceive,
  canSend,
  loading,
  tileSize,
  fiatDisplay,
  dragListeners,
  isDragging,
}: BlockProps) {
  const c = useColors();
  const uiStyle = useAtomValue(uiStyleAtom);
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fetchedRef = useRef(false);
  const receiveRevision = useRef(0);
  const coinImageUrl = useCoinImageUrl(chain.ticker);
  const { src: coinImageSrc, onError: onCoinImageError } = useRetryingImageSrc(
    coinImageUrl,
    chain.ticker
  );
  const isClassic = uiStyle === 'classic';

  useEffect(() => {
    if (!canReceive) {
      receiveRevision.current++;
      setAddress(null);
      fetchedRef.current = false;
    }
  }, [canReceive]);

  const handleMouseEnter = () => {
    setHovered(true);
    if (canReceive && !fetchedRef.current) {
      fetchedRef.current = true;
      const revision = receiveRevision.current;
      requestWalletForChain(chain)
        .then((res: any) => {
          if (revision === receiveRevision.current && res?.address)
            setAddress(res.address);
        })
        .catch(() => {});
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    const finish = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    navigator.clipboard
      .writeText(address)
      .then(finish)
      .catch(() => {
        const el = document.createElement('textarea');
        el.value = address;
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
  };

  const handleSend = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/${chain.route}?send=true`);
  };

  return (
    <Box
      {...(dragListeners as any)}
      onClick={() => !isDragging && navigate(`/${chain.route}`)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
      sx={{
        aspectRatio: '1 / 1',
        border: `${
          isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth
        } solid ${isClassic ? c.border : c.borderLight}`,
        borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
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
      {/* Testnet badge */}
      {chain.activeNetwork !== 'MAIN' && (
        <Box
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            fontSize: '0.5rem',
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            px: 0.75,
            py: 0.25,
            borderRadius: '3px',
            bgcolor: hovered ? 'rgba(255,255,255,0.2)' : c.error,
            color: hovered ? c.accentText : '#fff',
            lineHeight: 1.4,
          }}
        >
          {chain.activeNetwork.toLowerCase()}
        </Box>
      )}

      {/* Logo / action zone */}
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
        {coinImageSrc ? (
          <Box
            component="img"
            src={coinImageSrc}
            alt={chain.ticker}
            onError={onCoinImageError}
            sx={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: hovered ? 0 : 1,
              transition: 'opacity 0.15s ease',
            }}
          />
        ) : (
          <Box
            sx={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: hovered ? 0 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            <Box
              sx={{
                width: '60%',
                aspectRatio: '1/1',
                borderRadius: '50%',
                bgcolor: 'rgba(128,128,128,0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: tokens.typography.weightBold,
                color: 'rgba(128,128,128,0.55)',
              }}
            >
              {chain.ticker[0]}
            </Box>
          </Box>
        )}
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
              disabled={!canReceive}
              disableRipple={!address || !canReceive}
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

      {/* Ticker + balance + address */}
      <Box sx={{ textAlign: 'center', width: '100%', overflow: 'hidden' }}>
        <Box
          sx={{
            fontSize: '0.65rem',
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: hovered ? c.accentText : c.textSecondary,
            transition: 'color 0.15s ease',
          }}
        >
          {hovered ? chain.name : chain.ticker}
        </Box>
        <Box
          sx={{
            fontSize: '0.9rem',
            fontWeight: tokens.typography.weightBold,
            color: hovered ? c.accentText : c.textPrimary,
            transition: 'color 0.15s ease',
            mt: 0.25,
          }}
        >
          {loading ? (
            <Skeleton
              width={60}
              sx={{
                mx: 'auto',
                bgcolor: hovered ? 'rgba(255,255,255,0.2)' : undefined,
              }}
            />
          ) : balance !== null ? (
            balance
          ) : balanceError ? (
            <Tooltip title={balanceError} placement="top">
              <Box
                component="span"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryBalance(chain);
                }}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  color: hovered ? c.accentText : c.error,
                }}
              >
                unavailable
                <RefreshIcon sx={{ fontSize: 12 }} />
              </Box>
            </Tooltip>
          ) : (
            '—'
          )}
        </Box>
        {fiatDisplay && (
          <Box
            sx={{
              fontSize: '0.6rem',
              color: c.textSecondary,
              mt: 0.25,
              opacity: 0.7,
            }}
          >
            {fiatDisplay}
          </Box>
        )}
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
              : ' '}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function SortableCoinItem({
  chain,
  balance,
  balanceError,
  onRetryBalance,
  canReceive,
  canSend,
  loading,
  tileSize,
  fiatDisplay,
  isCustomMode,
  viewMode,
}: {
  chain: ChainConfig;
  balance: string | null;
  balanceError?: string;
  onRetryBalance: (chain: ChainConfig) => void;
  canReceive: boolean;
  canSend: boolean;
  loading: boolean;
  tileSize: number;
  fiatDisplay?: string;
  isCustomMode: boolean;
  viewMode: 'grid' | 'list';
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chain.key });

  return (
    <Box
      ref={setNodeRef}
      {...(viewMode === 'grid' && isCustomMode ? (attributes as any) : {})}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : (transition ?? undefined),
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      {viewMode === 'list' ? (
        <CoinListRow
          chain={chain}
          balance={balance}
          balanceError={balanceError}
          onRetryBalance={onRetryBalance}
          canReceive={canReceive}
          canSend={canSend}
          loading={loading}
          fiatDisplay={fiatDisplay}
          dragHandleProps={
            isCustomMode
              ? ({ ...attributes, ...listeners } as Record<string, unknown>)
              : undefined
          }
          isDragging={isDragging}
        />
      ) : (
        <CoinBlock
          chain={chain}
          balance={balance}
          balanceError={balanceError}
          onRetryBalance={onRetryBalance}
          canReceive={canReceive}
          canSend={canSend}
          loading={loading}
          tileSize={tileSize}
          fiatDisplay={fiatDisplay}
          dragListeners={
            isCustomMode ? (listeners as Record<string, unknown>) : undefined
          }
          isDragging={isDragging}
        />
      )}
    </Box>
  );
}

function SortableAssetItem({
  asset,
  canSend,
  tileSize,
  isCustomMode,
  viewMode,
}: {
  asset: AssetHolding;
  canSend: boolean;
  tileSize: number;
  isCustomMode: boolean;
  viewMode: 'grid' | 'list';
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `asset:${asset.network}:${asset.assetId}` });

  return (
    <Box
      ref={setNodeRef}
      {...(viewMode === 'grid' && isCustomMode ? (attributes as any) : {})}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : (transition ?? undefined),
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      {viewMode === 'list' ? (
        <AssetListRow
          asset={asset}
          canSend={canSend}
          dragHandleProps={
            isCustomMode
              ? ({ ...attributes, ...listeners } as Record<string, unknown>)
              : undefined
          }
          isDragging={isDragging}
        />
      ) : (
        <AssetBlock
          asset={asset}
          canSend={canSend}
          tileSize={tileSize}
          dragListeners={
            isCustomMode ? (listeners as Record<string, unknown>) : undefined
          }
          isDragging={isDragging}
        />
      )}
    </Box>
  );
}

export function CoinGrid() {
  const { chains } = useSupportedChains();
  const c = useColors();
  const uiStyle = useAtomValue(uiStyleAtom);
  const currency = useAtomValue(currencyAtom);
  const hideZero = useAtomValue(hideZeroAtom);
  const prices = useMarketPrices();
  const [balances, setBalances] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [balanceErrors, setBalanceErrors] = useState<Record<string, string>>(
    {}
  );
  const [canSendNative, setCanSendNative] = useState(false);
  const [foreignActions, setForeignActions] = useState<string[]>([]);
  const foreignActionRevision = useRef(0);
  const [canSendAssets, setCanSendAssets] = useState<
    Record<AssetNetwork, boolean>
  >({ qortium: false, qortal: false });
  const walletReady = useAtomValue(walletReadyAtom);
  const {
    assets,
    loading: assetsLoading,
    networks: assetNetworks,
    pinAsset,
  } = useAssetHoldings();
  const [addAssetOpen, setAddAssetOpen] = useState(false);

  useEffect(() => {
    requestQortActions()
      .then(({ actions }) => {
        setCanSendNative(qortSendActionForActions(actions) !== null);
      })
      .catch(() => setCanSendNative(false));

    let removeForeignListener = () => {};
    if (typeof qdnRequest === 'function') {
      const refreshForeignActions = () => {
        const revision = ++foreignActionRevision.current;
        return qdnRequest({ action: 'SHOW_ACTIONS' })
          .then((actions: unknown) => {
            if (revision !== foreignActionRevision.current) return;
            setForeignActions(Array.isArray(actions) ? actions : []);
          })
          .catch(() => {
            if (revision !== foreignActionRevision.current) return;
            setForeignActions([]);
          });
      };
      const handleBridgeChange = () => {
        setForeignActions([]);
        void refreshForeignActions();
      };
      refreshForeignActions();
      window.addEventListener('qortiumBridgeStateChanged', handleBridgeChange);
      removeForeignListener = () => {
        foreignActionRevision.current++;
        window.removeEventListener(
          'qortiumBridgeStateChanged',
          handleBridgeChange
        );
      };
    }

    assetNetworks.forEach((network) => {
      requestAssetActions(network)
        .then((actions) => {
          setCanSendAssets((previous) => ({
            ...previous,
            [network]: actions.includes('TRANSFER_ASSET'),
          }));
        })
        .catch(() => {
          setCanSendAssets((previous) => ({ ...previous, [network]: false }));
        });
    });
    return removeForeignListener;
    // Asset bridge globals are fixed for the lifetime of the page. Foreign
    // wallet actions are refreshed above when Home's bridge state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPortfolioFiat = useSetAtom(portfolioFiatAtom);

  const [sortMode] = useAtom(sortModeAtom);
  const [customOrder, setCustomOrder] = useAtom(customOrderAtom);
  const [tileSize] = useAtom(tileSizeAtom);
  const [viewMode] = useAtom(viewModeAtom);

  const items = useMemo<WalletItem[]>(
    () => [
      ...chains.map((chain) => ({
        kind: 'chain' as const,
        key: chain.key,
        chain,
      })),
      ...assets.map((asset) => ({
        kind: 'asset' as const,
        key: `asset:${asset.network}:${asset.assetId}`,
        asset,
      })),
    ],
    [chains, assets]
  );

  const itemBalanceStr = (item: WalletItem): string | null => {
    if (item.kind === 'chain') return balances[item.key] ?? null;
    return formatAssetBalance(item.asset.balance, item.asset.isDivisible);
  };
  const itemIsLoading = (item: WalletItem): boolean =>
    item.kind === 'chain' ? (loading[item.key] ?? true) : assetsLoading;

  // Merge newly discovered chains/assets into the persisted order; remove any that no longer exist
  useEffect(() => {
    const itemKeys = items.map((item) => item.key);
    setCustomOrder((prev: string[]) => {
      const migrated = migrateLegacyCustomOrder(prev);
      const filtered = migrated.filter((k: string) => itemKeys.includes(k));
      const added = itemKeys.filter((k: string) => !migrated.includes(k));
      const merged = [...filtered, ...added];
      if (merged.join(',') === prev.join(',')) return prev;
      return merged;
    });
  }, [items]);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    if (sortMode === 'name-asc')
      return arr.sort((a, b) => itemName(a).localeCompare(itemName(b)));
    if (sortMode === 'name-desc')
      return arr.sort((a, b) => itemName(b).localeCompare(itemName(a)));
    if (sortMode === 'balance-asc' || sortMode === 'balance-desc') {
      const dir = sortMode === 'balance-asc' ? 1 : -1;
      return arr.sort((a, b) => {
        const aLoading = itemIsLoading(a);
        const bLoading = itemIsLoading(b);
        if (aLoading && bLoading) return 0;
        if (aLoading) return 1;
        if (bLoading) return -1;
        const ba = itemBalanceStr(a);
        const bb = itemBalanceStr(b);
        if (ba === null && bb === null) return 0;
        if (ba === null) return 1;
        if (bb === null) return -1;
        // Assets have no market price feed, so they sort as 0 fiat value here.
        const priceA = a.kind === 'chain' ? (prices[a.chain.coinEnum] ?? 0) : 0;
        const priceB = b.kind === 'chain' ? (prices[b.chain.coinEnum] ?? 0) : 0;
        const fiatA = parseFloat(ba) * priceA;
        const fiatB = parseFloat(bb) * priceB;
        return dir * (fiatA - fiatB);
      });
    }
    // custom: respect persisted order
    return arr.sort((a, b) => {
      const ai = customOrder.indexOf(a.key);
      const bi = customOrder.indexOf(b.key);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [sortMode, customOrder, items, balances, loading, prices, assetsLoading]);

  const visibleItems = useMemo(() => {
    if (!hideZero) return sortedItems;
    return sortedItems.filter((item) => {
      // Pinned assets stay visible even at a zero balance - that's the point of pinning.
      if (item.kind === 'asset' && item.asset.pinned) return true;
      if (itemIsLoading(item)) return false;
      const bal = itemBalanceStr(item);
      if (bal === null) return false;
      return parseFloat(bal) > 0;
    });
  }, [hideZero, sortedItems, loading, balances, assetsLoading]);

  const { fiatDisplays, portfolioTotal } = useMemo(() => {
    const displays: Record<string, string | undefined> = {};
    let total = 0;
    let hasAny = false;
    for (const chain of chains) {
      if (chain.isNative) {
        displays[chain.key] = '-';
        continue;
      }
      const price = prices[chain.coinEnum];
      if (price == null) {
        displays[chain.key] = '-';
        continue;
      }
      const bal = balances[chain.key];
      if (bal == null) continue;
      const value = parseFloat(bal) * price;
      displays[chain.key] = formatFiat(value, currency);
      if (value > 0) {
        total += value;
        hasAny = true;
      }
    }
    return { fiatDisplays: displays, portfolioTotal: hasAny ? total : null };
  }, [chains, prices, balances, currency]);

  useEffect(() => {
    setPortfolioFiat(portfolioTotal);
  }, [portfolioTotal, setPortfolioFiat]);

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleItems.findIndex((item) => item.key === active.id);
    const newIndex = visibleItems.findIndex((item) => item.key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setCustomOrder(
      arrayMove(
        visibleItems.map((item) => item.key),
        oldIndex,
        newIndex
      )
    );
  };

  // Fetch a single chain's balance, retrying once (not the previous blind
  // 3x) and only when the decoded error says the failure is retryable.
  // Shared by the initial concurrency-limited load below and the manual
  // per-coin retry affordance.
  const fetchChainBalance = useCallback(
    async (chain: ChainConfig, isCancelled: () => boolean) => {
      if (
        !chain.isNative &&
        !foreignWalletAvailability(chain, foreignActions).canReadBalance
      ) {
        if (!isCancelled()) {
          setBalances((prev) => ({ ...prev, [chain.key]: null }));
          setBalanceErrors((prev) => {
            const next = { ...prev };
            delete next[chain.key];
            return next;
          });
          setLoading((prev) => ({ ...prev, [chain.key]: false }));
        }
        return;
      }

      const MAX_ATTEMPTS = 2; // one retry, and only if the error is retryable
      const RETRY_DELAY = 1200;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY));
        if (isCancelled()) return;
        try {
          let balance: string;
          if (chain.isNative) {
            const res = await requestQortBalance();
            balance = String(parseFloat(String(res ?? 0)));
          } else {
            const res = await requestWithTimeout(
              { action: 'GET_WALLET_BALANCE', coin: chain.coinEnum },
              45000
            );
            if (res?.error) throw new Error(res.error);
            // GET_WALLET_BALANCE returns satoshis; convert to coin units
            const divisor = Math.pow(10, chain.decimalPlaces);
            balance = res != null ? String(Number(res) / divisor) : '0';
          }
          if (isCancelled()) return;
          setBalances((prev) => ({ ...prev, [chain.key]: balance }));
          setBalanceErrors((prev) => {
            const next = { ...prev };
            delete next[chain.key];
            return next;
          });
          setLoading((prev) => ({ ...prev, [chain.key]: false }));
          return;
        } catch (err) {
          lastError = err;
          const decoded = describeBridgeError(err);
          if (!decoded.retryable) break;
        }
      }

      if (!isCancelled()) {
        const decoded = describeBridgeError(lastError);
        console.warn('[wallet] balance', chain.ticker, decoded.message);
        setBalances((prev) => ({ ...prev, [chain.key]: null }));
        setBalanceErrors((prev) => ({ ...prev, [chain.key]: decoded.message }));
        setLoading((prev) => ({ ...prev, [chain.key]: false }));
      }
    },
    [foreignActions]
  );

  const retryChainBalanceRef = useRef(fetchChainBalance);
  retryChainBalanceRef.current = fetchChainBalance;

  const retryBalance = useCallback((chain: ChainConfig) => {
    setLoading((prev) => ({ ...prev, [chain.key]: true }));
    void retryChainBalanceRef.current(chain, () => false);
  }, []);

  // Balance loading with concurrency limit
  useEffect(() => {
    if (!walletReady) return;

    let cancelled = false;

    const init: Record<string, boolean> = {};
    chains.forEach((c) => {
      init[c.key] = true;
    });
    setLoading(init);

    let slots = 2;
    const waiting: Array<() => void> = [];
    const acquire = () =>
      new Promise<void>((res) => {
        if (slots > 0) {
          slots--;
          res();
        } else waiting.push(res);
      });
    const release = () => {
      const next = waiting.shift();
      if (next) next();
      else slots++;
    };

    chains.forEach(async (chain) => {
      await acquire();
      try {
        if (cancelled) return;
        await fetchChainBalance(chain, () => cancelled);
      } finally {
        release();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chains, fetchChainBalance, walletReady]);

  const isCustom = sortMode === 'custom';
  const isClassic = uiStyle === 'classic';

  return (
    <Box
      sx={{
        bgcolor: isClassic ? c.frameBg : c.bg,
        minHeight: `calc(100vh - var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px))`,
        p: { xs: isClassic ? 1.5 : 2, md: isClassic ? 3 : 4 },
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleItems.map((item) => item.key)}
          strategy={
            viewMode === 'list'
              ? verticalListSortingStrategy
              : rectSortingStrategy
          }
        >
          <Box
            sx={{
              display: viewMode === 'list' ? 'flex' : 'grid',
              flexDirection: viewMode === 'list' ? 'column' : undefined,
              gridTemplateColumns:
                viewMode === 'grid'
                  ? `repeat(auto-fill, minmax(${TILE_MIN_PX[tileSize] ?? 130}px, 1fr))`
                  : undefined,
              gap: viewMode === 'list' ? 1 : 1.5,
            }}
          >
            {visibleItems.map((item) =>
              item.kind === 'chain' ? (
                (() => {
                  const foreign = foreignWalletAvailability(
                    item.chain,
                    foreignActions
                  );
                  return (
                    <SortableCoinItem
                      key={item.key}
                      chain={item.chain}
                      balance={balances[item.key] ?? null}
                      balanceError={balanceErrors[item.key]}
                      onRetryBalance={retryBalance}
                      canReceive={item.chain.isNative || foreign.canReceive}
                      canSend={
                        item.chain.isNative ? canSendNative : foreign.canSend
                      }
                      loading={loading[item.key] ?? true}
                      tileSize={tileSize}
                      fiatDisplay={fiatDisplays[item.key]}
                      isCustomMode={isCustom}
                      viewMode={viewMode}
                    />
                  );
                })()
              ) : (
                <SortableAssetItem
                  key={item.key}
                  asset={item.asset}
                  canSend={canSendAssets[item.asset.network]}
                  tileSize={tileSize}
                  isCustomMode={isCustom}
                  viewMode={viewMode}
                />
              )
            )}
            {viewMode === 'list' ? (
              <AddAssetRow onClick={() => setAddAssetOpen(true)} />
            ) : (
              <AddAssetTile onClick={() => setAddAssetOpen(true)} />
            )}
          </Box>
        </SortableContext>
      </DndContext>

      <AddAssetDialog
        open={addAssetOpen}
        onClose={() => setAddAssetOpen(false)}
        networks={assetNetworks}
        onSubmit={pinAsset}
      />
    </Box>
  );
}
