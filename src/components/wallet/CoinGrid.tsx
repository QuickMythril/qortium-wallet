import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Box, IconButton, Skeleton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SendIcon from '@mui/icons-material/Send';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useAuth } from 'qapp-core';
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
import {
  BALANCE_CACHE_TTL_MS,
  getCachedBalance,
  isBalanceCacheFresh,
  setCachedBalance,
  subscribeBalanceCache,
} from '../../common/balanceCache';
import { registerPendingSendsSubscriber } from '../../common/pendingSends';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';

// While the grid is mounted, QORT's balance is polled every 60 s (a single
// cheap GET_BALANCE) so an incoming payment is noticed without opening the
// coin page (round 2, item C). Foreign coins are not polled here - their
// balance reads go through Electrum via Core and keep the existing
// cache-freshness cadence below.
const NATIVE_BALANCE_POLL_MS = 60000;

type WalletItem =
  | { kind: 'chain'; key: string; chain: ChainConfig }
  | { kind: 'asset'; key: string; asset: AssetHolding };

function itemName(item: WalletItem): string {
  return item.kind === 'chain'
    ? item.chain.name
    : item.asset.name || `Asset #${item.asset.assetId}`;
}

// Round 3: when the unified list mixes asset networks, Qortium assets group
// before Qortal ones regardless of the active sort mode (name/balance/
// custom), and each network's existing relative order - including any pin
// ordering - is preserved within its group.
//
// This has to be a genuine total order, not a pairwise "assets on different
// networks win, otherwise fall through" rule: a pairwise-only rule is only
// defined for asset-vs-asset pairs, so a chain sorting (by name/balance)
// between a Qortal asset and a Qortium asset produces a comparator that says
// qortal < chain < qortium by one rule and qortium < qortal by the other - a
// cycle Array.prototype.sort has no defined behavior for (round 3 review
// finding 1). Fixing that means giving every item, chains included, a fixed
// primary rank (chains, then Qortium assets, then Qortal assets) and only
// using the active sort mode as the *secondary* key within a rank tier. A
// lexicographic (rank, then a valid comparator) order is always transitive,
// so this holds for every sort mode without a special case per mode.
function itemGroupRank(item: WalletItem): number {
  if (item.kind === 'chain') return 0;
  return item.asset.network === 'qortium' ? 1 : 2;
}

function compareWithAssetGrouping(
  a: WalletItem,
  b: WalletItem,
  compare: (a: WalletItem, b: WalletItem) => number
): number {
  const rankDiff = itemGroupRank(a) - itemGroupRank(b);
  if (rankDiff !== 0) return rankDiff;
  return compare(a, b);
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
  // ARRR-only (round 5 review finding 1): a provisional TOTAL balance,
  // present only while `balance` (the verified/spendable figure) is null
  // because Core rejected the verified read as not-yet-known. Rendered
  // with an explicit "total · verifying" qualifier, never as `balance`.
  provisionalTotal?: string | null;
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
  provisionalTotal,
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
            title={
              chain.coinEnum === 'ARRR'
                ? 'Sending ARRR is not available yet'
                : canSend
                  ? 'Send'
                  : 'Requires a local node'
            }
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
          ) : provisionalTotal != null ? (
            <Tooltip
              title="Total incl. unconfirmed/unverified - not yet spendable"
              placement="top"
            >
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  lineHeight: 1.1,
                }}
              >
                <Box component="span">{provisionalTotal}</Box>
                <Box
                  component="span"
                  sx={{
                    fontSize: '0.55rem',
                    fontWeight: tokens.typography.weightBold,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: hovered ? c.accentText : c.textSecondary,
                    opacity: 0.85,
                  }}
                >
                  total · verifying
                </Box>
              </Box>
            </Tooltip>
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
  provisionalTotal,
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
  provisionalTotal?: string | null;
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
          provisionalTotal={provisionalTotal}
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
          provisionalTotal={provisionalTotal}
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
  // Home's selected-account identity - keys the shared balance cache so an
  // account switch can never render a stale account's balances under the
  // newly-selected one (round 2 review finding 1).
  const { address: account } = useAuth();
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
  // ARRR-only (round 5 review finding 1): a provisional TOTAL balance shown
  // only while the verified (spendable) figure is unknown - kept in its own
  // map, never merged into `balances`, so it can only ever render with the
  // "total · verifying" qualifier below and never be mistaken for a
  // confirmed spendable amount.
  const [provisionalTotals, setProvisionalTotals] = useState<
    Record<string, string | null>
  >({});
  const [canSendNative, setCanSendNative] = useState(false);
  // null = "not fetched yet this session" (distinct from a fetched-but-empty
  // array) - the balance pass below must not treat the pre-first-fetch gap
  // as a real capability change (round 2, item B).
  const [foreignActions, setForeignActions] = useState<string[] | null>(null);
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
      // Deliberately does not clear foreignActions to [] before refreshing:
      // that transient empty-capability state briefly made every foreign
      // coin's computed availability look "changed" to the balance-cache
      // pass below, defeating the "unchanged capability set -> no refetch"
      // rule (round 2, item B) on every bridge-state event, not just real
      // host swaps. A failed refresh still falls through to [] below.
      const handleBridgeChange = () => {
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
      return arr.sort((a, b) =>
        compareWithAssetGrouping(a, b, (x, y) =>
          itemName(x).localeCompare(itemName(y))
        )
      );
    if (sortMode === 'name-desc')
      return arr.sort((a, b) =>
        compareWithAssetGrouping(a, b, (x, y) =>
          itemName(y).localeCompare(itemName(x))
        )
      );
    if (sortMode === 'balance-asc' || sortMode === 'balance-desc') {
      const dir = sortMode === 'balance-asc' ? 1 : -1;
      return arr.sort((a, b) =>
        compareWithAssetGrouping(a, b, (x, y) => {
          const aLoading = itemIsLoading(x);
          const bLoading = itemIsLoading(y);
          if (aLoading && bLoading) return 0;
          if (aLoading) return 1;
          if (bLoading) return -1;
          const ba = itemBalanceStr(x);
          const bb = itemBalanceStr(y);
          if (ba === null && bb === null) return 0;
          if (ba === null) return 1;
          if (bb === null) return -1;
          // Assets have no market price feed, so they sort as 0 fiat value here.
          const priceA =
            x.kind === 'chain' ? (prices[x.chain.coinEnum] ?? 0) : 0;
          const priceB =
            y.kind === 'chain' ? (prices[y.chain.coinEnum] ?? 0) : 0;
          const fiatA = parseFloat(ba) * priceA;
          const fiatB = parseFloat(bb) * priceB;
          return dir * (fiatA - fiatB);
        })
      );
    }
    // custom: respect persisted order
    return arr.sort((a, b) =>
      compareWithAssetGrouping(a, b, (x, y) => {
        const ai = customOrder.indexOf(x.key);
        const bi = customOrder.indexOf(y.key);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    );
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
  // per-coin retry affordance. Every outcome (success, unavailable, or
  // failure) is written into the shared balance cache (round 2, item B) so
  // a remounted grid can render instantly instead of re-fetching everything.
  const fetchChainBalance = useCallback(
    async (chain: ChainConfig, isCancelled: () => boolean) => {
      if (
        !chain.isNative &&
        !foreignWalletAvailability(chain, foreignActions ?? []).canReadBalance
      ) {
        if (!isCancelled()) {
          setBalances((prev) => ({ ...prev, [chain.key]: null }));
          setBalanceErrors((prev) => {
            const next = { ...prev };
            delete next[chain.key];
            return next;
          });
          setProvisionalTotals((prev) => ({ ...prev, [chain.key]: null }));
          setLoading((prev) => ({ ...prev, [chain.key]: false }));
          setCachedBalance(account, chain.key, { balance: null });
        }
        return;
      }

      // Round 5: once custody is available, the grid tile never
      // independently polls ARRR - it only reflects whatever the ARRR
      // page's own sync-status-driven balance fetch last wrote to the
      // shared cache (design doc: "the grid row consumes cached
      // progress/balance without a background ARRR timer"). runBalancePass
      // has already seeded `balances`/`balanceErrors` from that cache
      // above; there's nothing further to fetch here.
      if (chain.coinEnum === 'ARRR') {
        if (!isCancelled()) {
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
          setCachedBalance(account, chain.key, { balance });
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
        setCachedBalance(account, chain.key, {
          balance: null,
          error: decoded.message,
        });
      }
    },
    [foreignActions, account]
  );

  const retryChainBalanceRef = useRef(fetchChainBalance);
  retryChainBalanceRef.current = fetchChainBalance;

  const retryBalance = useCallback((chain: ChainConfig) => {
    setLoading((prev) => ({ ...prev, [chain.key]: true }));
    void retryChainBalanceRef.current(chain, () => false);
  }, []);

  // Per-chain foreign-capability fingerprint from the last completed pass,
  // used below to tell "the SHOW_ACTIONS array changed identity" apart from
  // "this coin's actual send/receive/read capabilities changed" - only the
  // latter should force a re-fetch (round 2, item B).
  const lastAvailabilityKeyRef = useRef<Record<string, string>>({});
  // The account the currently-rendered `balances`/`balanceErrors` state was
  // last built for - lets a real account switch (the same grid instance
  // re-rendering with a new `account`, e.g. once Home's SELECTED_ACCOUNT_
  // CHANGED re-authenticates) clear the previous account's values instead
  // of merely not overwriting them (round 2 review finding 1: seeding only
  // *adds* cache hits, so without this, a value that has no cache entry
  // under the new account - most of them, right after a switch - would
  // keep showing the old account's last-rendered balance indefinitely).
  const lastAccountRef = useRef<string | null | undefined>(undefined);

  // Seeds every chain's render from the shared cache (instant on a remount
  // within the freshness window), then fetches only the chains that are
  // missing, stale, or whose foreign capability set actually changed -
  // never the whole grid just because a component remounted or a
  // qortiumBridgeStateChanged event fired with an unchanged capability set.
  const runBalancePass = useCallback((): (() => void) => {
    if (!walletReady) return () => {};

    let cancelled = false;

    const accountChanged = lastAccountRef.current !== account;
    lastAccountRef.current = account;
    if (accountChanged) lastAvailabilityKeyRef.current = {};

    setBalances((prev) => {
      const next = accountChanged ? {} : { ...prev };
      chains.forEach((chain) => {
        const cached = getCachedBalance(account, chain.key);
        if (cached) next[chain.key] = cached.balance;
      });
      return next;
    });
    setBalanceErrors((prev) => {
      const next = accountChanged ? {} : { ...prev };
      chains.forEach((chain) => {
        const cached = getCachedBalance(account, chain.key);
        if (cached?.error) next[chain.key] = cached.error;
        else if (cached) delete next[chain.key];
      });
      return next;
    });
    setProvisionalTotals((prev) => {
      const next = accountChanged ? {} : { ...prev };
      chains.forEach((chain) => {
        const cached = getCachedBalance(account, chain.key);
        if (cached) next[chain.key] = cached.provisionalTotal ?? null;
      });
      return next;
    });

    const toFetch: ChainConfig[] = [];
    const loadingPatch: Record<string, boolean> = {};
    chains.forEach((chain) => {
      // Foreign capabilities aren't known yet this session (the initial
      // SHOW_ACTIONS call hasn't resolved) - defer the decision entirely
      // rather than recording a key computed from an empty placeholder,
      // which would look like a real capability change the moment the
      // real SHOW_ACTIONS result arrives and force a spurious re-fetch.
      if (!chain.isNative && foreignActions === null) return;

      const availabilityKey = chain.isNative
        ? 'native'
        : JSON.stringify(
            foreignWalletAvailability(chain, foreignActions ?? [])
          );
      const previousKey = lastAvailabilityKeyRef.current[chain.key];
      const availabilityChanged =
        previousKey !== undefined && previousKey !== availabilityKey;
      lastAvailabilityKeyRef.current[chain.key] = availabilityKey;

      if (availabilityChanged || !isBalanceCacheFresh(account, chain.key)) {
        toFetch.push(chain);
        loadingPatch[chain.key] = true;
      } else {
        loadingPatch[chain.key] = false;
      }
    });
    setLoading((prev) => ({ ...prev, ...loadingPatch }));

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

    toFetch.forEach(async (chain) => {
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
  }, [chains, fetchChainBalance, foreignActions, walletReady, account]);

  useEffect(() => {
    const cancel = runBalancePass();
    return cancel;
  }, [runBalancePass]);

  // "Page becomes visible again after being hidden for > 2 minutes" also
  // re-runs the freshness pass (round 2, item B) - the cache-TTL check
  // above already covers the "hidden for less than the freshness window"
  // case, since the same 2-minute window applies to both.
  useDocumentVisible(() => {
    runBalancePass();
  }, BALANCE_CACHE_TTL_MS);

  // QORT-only fast balance poll while the grid is mounted (round 2, item
  // C). Kept separate from the cache-freshness pass above, which is tuned
  // for "don't hammer every coin on every remount", not "notice an
  // incoming payment within a minute".
  useEffect(() => {
    if (!walletReady) return;
    const qortChain = chains.find((chain) => chain.isNative);
    if (!qortChain) return;

    let cancelled = false;
    let lastBalance = getCachedBalance(account, qortChain.key)?.balance ?? null;
    const id = setInterval(async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await requestQortBalance();
        const next = String(parseFloat(String(res ?? 0)));
        if (cancelled || next === lastBalance) return;
        lastBalance = next;
        setBalances((prev) => ({ ...prev, [qortChain.key]: next }));
        setBalanceErrors((prev) => {
          const nextErrors = { ...prev };
          delete nextErrors[qortChain.key];
          return nextErrors;
        });
        setLoading((prev) => ({ ...prev, [qortChain.key]: false }));
        setCachedBalance(account, qortChain.key, { balance: next });
      } catch {
        /* a transient poll failure isn't worth surfacing - the next tick retries */
      }
    }, NATIVE_BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chains, walletReady, account]);

  // Mirror any balance-cache write into local render state while the grid
  // is mounted - not just the writes this component made itself. The
  // pendingSends module refreshes a coin's cached balance the moment a
  // confirmation lands (round 2, item A), which can happen while the user
  // is looking at the grid rather than the coin page; without this
  // subscription that fresh value would sit in the cache unseen until the
  // next freshness pass (round 2 review finding 2).
  useEffect(() => {
    return subscribeBalanceCache(() => {
      setBalances((prev) => {
        let changed = false;
        const next = { ...prev };
        chains.forEach((chain) => {
          const cached = getCachedBalance(account, chain.key);
          if (cached && next[chain.key] !== cached.balance) {
            next[chain.key] = cached.balance;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setBalanceErrors((prev) => {
        let changed = false;
        const next = { ...prev };
        chains.forEach((chain) => {
          const cached = getCachedBalance(account, chain.key);
          if (cached?.error && next[chain.key] !== cached.error) {
            next[chain.key] = cached.error;
            changed = true;
          } else if (cached && !cached.error && chain.key in next) {
            delete next[chain.key];
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setProvisionalTotals((prev) => {
        let changed = false;
        const next = { ...prev };
        chains.forEach((chain) => {
          const cached = getCachedBalance(account, chain.key);
          const provisional = cached?.provisionalTotal ?? null;
          if (cached && next[chain.key] !== provisional) {
            next[chain.key] = provisional;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    });
  }, [chains, account]);

  // Keep the shared pendingSends poller running for as long as the grid is
  // mounted, even with no pending row of its own to show - navigating from
  // the coin page to the grid (or starting on the grid) must not pause
  // confirmation tracking (round 2 review finding 2).
  useEffect(() => registerPendingSendsSubscriber(), []);

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
                    foreignActions ?? []
                  );
                  return (
                    <SortableCoinItem
                      key={item.key}
                      chain={item.chain}
                      balance={balances[item.key] ?? null}
                      balanceError={balanceErrors[item.key]}
                      provisionalTotal={provisionalTotals[item.key] ?? null}
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
