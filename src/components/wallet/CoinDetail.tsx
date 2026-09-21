import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControlLabel,
  IconButton,
  Skeleton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DnsIcon from '@mui/icons-material/Dns';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import _QRCodeDefault from 'react-qr-code';
// CJS interop guard: Vite/Rollup may resolve the default import to the module
// namespace object rather than exports.default when __esModule is set via
// Object.defineProperty. Extracting .default handles both cases safely.
const QRCode = ((_QRCodeDefault as any).default ??
  _QRCodeDefault) as typeof _QRCodeDefault;
import { useAtomValue } from 'jotai';
import { useAuth } from 'qapp-core';
import { NumericFormat as _NumericFormat } from 'react-number-format';
import { useMarketPrices } from '../../hooks/useMarketPrices';
import { copyToClipboard, formatFiat } from '../../common/functions';
const NumericFormat = _NumericFormat as React.FC<
  React.ComponentProps<typeof _NumericFormat> & Record<string, unknown>
>;
import { tokens } from '../../theme/tokens';
import { useColors } from '../../theme/ColorTokensContext';
import {
  uiStyleAtom,
  currencyAtom,
  walletReadyAtom,
} from '../../state/global/system';
import { useCoinImageUrl } from '../../hooks/useCoinImageUrl';
import { CoinImage } from './CoinImage';
import type { ChainConfig } from '../../config/chains';
import {
  PreparedTransactionPreview,
  type PreparedTransaction,
} from './PreparedTransactionPreview';
import {
  decimalToAtomic,
  formatAtomicAmount,
  isOptionalPositiveDecimal,
  isPositiveDecimal,
  isValidRecipient,
} from '../../utils/walletSend';
import { validateAddress } from '../../utils/addressValidation';
import { minNonDustOutput } from '../../config/minimums';
import {
  resolveContact,
  type ContactResolution,
} from '../../utils/resolveContact';
import { requestWithTimeout } from '../../common/functions';
import { foreignWalletAvailability } from '../../common/homeWalletCapabilities';
import {
  describeBridgeError,
  isCoreSpendContextBugError,
  isUnlockRequiredError,
} from '../../common/bridgeErrors';
import {
  getCachedAccountUnlocked,
  invalidateCachedAccountUnlocked,
  setCachedAccountUnlocked,
} from '../../common/accountUnlockState';
import { invalidateCachedBalance } from '../../common/balanceCache';
import {
  accountKey as pendingSendsAccountKey,
  addPendingSend,
  getPendingSendsForChain,
  registerPendingSendsSubscriber,
  subscribePendingSendConfirmed,
  subscribePendingSends,
} from '../../common/pendingSends';
import { useSuggestedFee } from '../../hooks/useSuggestedFee';
import {
  EMPTY_STRING,
  TIME_MINUTES_3,
  TIME_MINUTES_5,
  TIME_SECONDS_3,
} from '../../common/constants';
import { TransactionRow, type TxRow } from './TransactionRow';
import {
  isUnlockedResult,
  qortBridgeProtocol,
  qortSendActionForActions,
  requestQortActions,
  requestQortBalance,
  requestQortSend,
  requestQortTransactions,
  requestQortUnlock,
  requestWalletForChain,
  shouldAttemptAccountUnlock,
  type QortSendAction,
} from '../../common/walletBridge';

interface Props {
  chain: ChainConfig;
}

interface SendCoinResult {
  prepared?: PreparedTransaction;
  /** A plain Qortal host's SEND_COIN returns the Qortal transaction object, which carries this. */
  signature?: string;
  /** Home 2's native QORT send (SEND_QORT/PAYMENT via qortalRequest routed through Home) uses this field name instead. */
  transactionSignature?: string;
  amount?: string | number;
  recipient?: string;
}

// ARRR sync loop limits: 36 × 5 s = 3 min for "not initialized", 60 × 5 s = 5 min for "initializing"
const ARRR_OUTER_MAX = 36;
const ARRR_INNER_MAX = 60;
const ARRR_POLL_MS = 5000;
const RECIPIENT_NAME_LOOKUP_DEBOUNCE_MS = 800;

// While the QORT coin page is open, its balance is polled every 60 s (a
// single cheap GET_BALANCE) so an incoming payment is noticed without the
// user leaving and re-entering the page (round 2, item C). Foreign coins
// keep the existing 3-minute combined balance+tx poll below.
const NATIVE_BALANCE_POLL_MS = 60000;

async function ensureAccountUnlocked(
  chain: ChainConfig,
  qortCanUnlock: boolean
): Promise<boolean> {
  if (chain.isNative && !qortCanUnlock) return true;
  if (!chain.isNative && chain.homeWallet?.requiresUnlockedAccount === false)
    return true;

  // The unlock-state cache is only ever populated from Home's qdnRequest
  // GET_SELECTED_ACCOUNT/UNLOCK_SELECTED_ACCOUNT. A native (QORT) send
  // whose unlock call actually goes through qortalRequest (Qortal Core, or
  // any host where qortalRequest is preferred - see qortBridge()) must not
  // trust or populate that cache, since it says nothing about the
  // qortalRequest-selected account's lock state. Foreign-coin unlocks
  // always go through qdnRequest directly, so they're unaffected.
  const usesQdnRequestForUnlock =
    !chain.isNative || qortBridgeProtocol() === 'qdnRequest';

  if (usesQdnRequestForUnlock) {
    // Skip the redundant UNLOCK_SELECTED_ACCOUNT round-trip when we already
    // know the account is unlocked (from AppLayout's mount check, a
    // previous send, or GET_SELECTED_ACCOUNT below).
    if (getCachedAccountUnlocked() === true) return true;

    try {
      const account = (await qdnRequest({
        action: 'GET_SELECTED_ACCOUNT',
      })) as { isUnlocked?: boolean } | null;
      if (account?.isUnlocked === true) {
        setCachedAccountUnlocked(true);
        return true;
      }
    } catch {
      /* GET_SELECTED_ACCOUNT isn't supported everywhere - fall through and
         attempt the unlock directly, as before. */
    }
  }

  const result = await (chain.isNative
    ? requestQortUnlock()
    : qdnRequest({ action: 'UNLOCK_SELECTED_ACCOUNT' }));
  const unlocked = isUnlockedResult(result);
  if (usesQdnRequestForUnlock) setCachedAccountUnlocked(unlocked);
  return unlocked;
}

export function CoinDetail({ chain }: Props) {
  const c = useColors();
  const { t } = useTranslation('core');
  const uiStyle = useAtomValue(uiStyleAtom);
  const currency = useAtomValue(currencyAtom);
  const walletReady = useAtomValue(walletReadyAtom);
  // Home's selected-account identity (distinct from `address` below, which
  // is this chain's own wallet address) - used to key the shared balance
  // cache and pending-send tracker so an account switch can never show
  // one account's data under another (round 2 review finding 1).
  const { address: homeAccount } = useAuth();
  const prices = useMarketPrices();
  const pricePerUnit = prices[chain.coinEnum];
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const coinImageUrl = useCoinImageUrl(chain.ticker);
  const isARRR = chain.coinEnum === 'ARRR';
  const isClassic = uiStyle === 'classic';

  const [address, setAddress] = useState<string>(EMPTY_STRING);
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [expandedTx, setExpandedTx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedHash, setCopiedHash] = useState<number | null>(null);

  const [sendOpen, setSendOpen] = useState(
    () => searchParams.get('send') === 'true'
  );
  const [amount, setAmount] = useState<string>('');
  const [sendMax, setSendMax] = useState(false);
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
  const suggestedFee = useSuggestedFee(chain);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<
    'success' | 'error' | 'pending' | null
  >(null);
  const [sendResponse, setSendResponse] = useState<SendCoinResult | null>(null);
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);
  const [sendErrorIsCoreBug, setSendErrorIsCoreBug] = useState(false);
  // Bumped whenever the shared pendingSends module notifies a change for
  // this account+chain, so `pendingSendRows` (below) re-reads it. The
  // module - not local state - is the source of truth (round 2 review
  // finding 2), since it keeps tracking/polling across CoinDetail
  // unmounting when the user navigates to the grid and back.
  const [pendingSendsVersion, setPendingSendsVersion] = useState(0);

  // SHOW_ACTIONS capability flags (updated on mount)
  const [canSend, setCanSend] = useState(false);
  const canSendRef = useRef(false);
  const [qortSendAction, setQortSendAction] = useState<QortSendAction | null>(
    null
  );
  const [qortCanUnlock, setQortCanUnlock] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(true);
  const [canReceive, setCanReceive] = useState(chain.isNative);
  const [canReadBalance, setCanReadBalance] = useState(chain.isNative);
  const canReadBalanceRef = useRef(chain.isNative);
  const [canReadTransactions, setCanReadTransactions] = useState(
    chain.isNative
  );
  const [canManageForeignServer, setCanManageForeignServer] = useState(false);
  const canManageForeignServerRef = useRef(false);
  const addressReadRevision = useRef(0);
  const balanceReadRevision = useRef(0);
  const transactionReadRevision = useRef(0);
  // Seeded whenever fetchBalance resolves - the native 60 s poll compares
  // against this, never the `balance` state value captured when that
  // effect happened to (re)run (round 2 review finding 3).
  const lastKnownBalanceRef = useRef<string | null>(null);
  const postSendRefreshTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // ARRR initialization state
  const cancelSyncRef = useRef(false);
  const isMountedRef = useRef(true);
  const [arrrSynced, setArrrSynced] = useState(!isARRR);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cancel the post-send refresh timer below so it can't fire (and
      // trigger a balance/transaction read) after unmount.
      if (postSendRefreshTimeoutRef.current) {
        clearTimeout(postSendRefreshTimeoutRef.current);
        postSendRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  // A send dialog opened via a deep link (?send=true, or the Home `wallet`
  // assignment-role link) sets sendOpen=true directly from the lazy
  // initializer above, bypassing openSend()'s fee lookup entirely - that
  // was round 2 item D's root cause. Load the suggested fee here too,
  // without touching the recipient/amount openSend() would otherwise reset
  // (those are deliberately pre-filled from the URL for this path).
  useEffect(() => {
    if (sendOpen) {
      suggestedFee.reset();
      void suggestedFee.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [arrrSyncing, setArrrSyncing] = useState(isARRR);
  const [arrrSyncStatus, setArrrSyncStatus] = useState(
    'Connecting to Pirate Chain…'
  );
  const [arrrSyncFailed, setArrrSyncFailed] = useState(false);
  const [arrrServers, setArrrServers] = useState<any[]>([]);
  const [arrrServerOpen, setArrrServerOpen] = useState(false);

  // ElectrumX server management for non-ARRR foreign coins
  const [foreignServers, setForeignServers] = useState<any[]>([]);
  const [foreignServerOpen, setForeignServerOpen] = useState(false);
  const [foreignServerLoading, setForeignServerLoading] = useState(false);

  const syncArrr = useCallback(async () => {
    cancelSyncRef.current = false;
    setArrrSyncing(true);
    setArrrSyncFailed(false);
    setArrrSynced(false);
    setArrrSyncStatus('Connecting to Pirate Chain…');

    let outerCount = 0;
    let innerCount = 0;
    let lastSyncError: unknown = null;

    try {
      while (!cancelSyncRef.current) {
        let status: string;
        try {
          status = await qdnRequest({
            action: 'GET_ARRR_SYNC_STATUS',
          } as any);
        } catch (err) {
          lastSyncError = err;
          break;
        }
        if (cancelSyncRef.current) return;

        if (status === 'Synchronized') {
          setArrrSynced(true);
          setArrrSyncing(false);
          return;
        }

        // Server returned an XML/HTML error string
        if (typeof status === 'string' && status.includes('<')) break;

        if (status === 'Not initialized yet') {
          outerCount++;
          setArrrSyncStatus('Initializing Pirate Chain wallet…');
          if (outerCount >= ARRR_OUTER_MAX) break;
        } else if (status === 'Initializing wallet...') {
          innerCount++;
          const pct = Math.round((innerCount / ARRR_INNER_MAX) * 100);
          setArrrSyncStatus(`Syncing shielded blockchain… ${pct}%`);
          if (innerCount >= ARRR_INNER_MAX) break;
        } else {
          setArrrSyncStatus(typeof status === 'string' ? status : 'Syncing…');
        }

        await new Promise<void>((r) => setTimeout(r, ARRR_POLL_MS));
      }
    } catch (err) {
      lastSyncError = err;
    }

    if (cancelSyncRef.current) return;
    setArrrSyncFailed(true);
    setArrrSyncing(false);
    if (lastSyncError != null) {
      const decoded = describeBridgeError(lastSyncError);
      console.warn('[wallet] arrr sync', decoded.message);
      setArrrSyncStatus(
        `Sync failed: ${decoded.message} — try a different server.`
      );
    } else {
      setArrrSyncStatus('Sync failed — try a different server.');
    }
    try {
      const servers = await qdnRequest({
        action: 'GET_CROSSCHAIN_SERVER_INFO',
        coin: 'ARRR',
      } as any);
      if (Array.isArray(servers)) setArrrServers(servers);
    } catch (err) {
      console.warn(
        '[wallet] arrr server list',
        describeBridgeError(err).message
      );
    }
  }, []);

  const handleServerChange = useCallback(
    async (server: any) => {
      setArrrServerOpen(false);
      try {
        await qdnRequest({
          action: 'SET_CURRENT_FOREIGN_SERVER',
          coin: 'ARRR',
          server,
        } as any);
      } catch {
        /* */
      }
      syncArrr();
    },
    [syncArrr]
  );

  // Kick off ARRR sync once on mount; cancel on unmount
  useEffect(() => {
    if (!isARRR) return;
    syncArrr();
    return () => {
      cancelSyncRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAddress = useCallback(async () => {
    if (!chain.isNative && !canReceive) {
      setAddress(EMPTY_STRING);
      return;
    }
    const revision = addressReadRevision.current;
    try {
      const res = await requestWalletForChain(chain);
      if (revision === addressReadRevision.current && res?.address)
        setAddress(res.address);
    } catch {
      /* silent */
    }
  }, [canReceive, chain]);

  const fetchBalance = useCallback(async () => {
    if (!chain.isNative && !canReadBalanceRef.current) {
      setBalance(null);
      setBalanceError(null);
      setLoadingBalance(false);
      return;
    }
    const revision = balanceReadRevision.current;
    setLoadingBalance(true);
    setBalanceError(null);
    const MAX_ATTEMPTS = 2; // one retry, and only if the error is retryable
    const RETRY_DELAY = 1500;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY));
      if (!isMountedRef.current || revision !== balanceReadRevision.current)
        return;
      try {
        let result: string;
        if (chain.isNative) {
          const res = await requestQortBalance();
          result = String(parseFloat(String(res ?? 0)));
        } else {
          const res = await requestWithTimeout(
            { action: 'GET_WALLET_BALANCE', coin: chain.coinEnum },
            TIME_MINUTES_5
          );
          if (res?.error) throw new Error(res.error);
          // GET_WALLET_BALANCE returns satoshis; convert to coin units
          const divisor = Math.pow(10, chain.decimalPlaces);
          result = res != null ? String(Number(res) / divisor) : '0';
        }
        if (!isMountedRef.current || revision !== balanceReadRevision.current)
          return;
        setBalance(result);
        // Seeds the native 60 s poll's change comparison (below) - a ref
        // updated only when a real fetch resolves, never the value the
        // component happened to render with when that effect was set up
        // (round 2 review finding 3).
        lastKnownBalanceRef.current = result;
        setLoadingBalance(false);
        return;
      } catch (err) {
        lastError = err;
        const decoded = describeBridgeError(err);
        if (!decoded.retryable) break;
      }
    }
    if (isMountedRef.current && revision === balanceReadRevision.current) {
      const decoded = describeBridgeError(lastError);
      console.warn('[wallet] balance', chain.ticker, decoded.message);
      setBalance(null);
      setBalanceError(decoded.message);
      setLoadingBalance(false);
    }
  }, [canReadBalance, chain]);

  // Check which actions are available on the current node
  useEffect(() => {
    if (chain.isNative) {
      requestQortActions()
        .then(({ actions, protocol }) => {
          const action = qortSendActionForActions(actions);
          setQortSendAction(action);
          setQortCanUnlock(
            shouldAttemptAccountUnlock(protocol === 'qdnRequest', actions)
          );
          setCanSend(action !== null);
          canSendRef.current = action !== null;
          setCanReceive(true);
          setCanReadBalance(true);
          canReadBalanceRef.current = true;
          setCanReadTransactions(true);
          setWalletAvailable(true);
        })
        .catch(() => {
          setQortSendAction(null);
          setQortCanUnlock(false);
          setCanSend(false);
          canSendRef.current = false;
          setCanReceive(false);
          setCanReadBalance(false);
          canReadBalanceRef.current = false;
          setCanReadTransactions(false);
          setWalletAvailable(false);
          setCanManageForeignServer(false);
        });
      return;
    }

    const resetForeignAvailability = () => {
      setCanReceive(false);
      setCanReadBalance(false);
      canReadBalanceRef.current = false;
      setCanReadTransactions(false);
      setCanSend(false);
      canSendRef.current = false;
      setWalletAvailable(false);
      setCanManageForeignServer(false);
      canManageForeignServerRef.current = false;
      addressReadRevision.current++;
      balanceReadRevision.current++;
      transactionReadRevision.current++;
      setAddress(EMPTY_STRING);
      setBalance(null);
      setLoadingBalance(false);
      setTransactions([]);
      setLoadingTx(false);
    };
    let revision = 0;
    const refreshForeignAvailability = () => {
      const requestRevision = ++revision;
      if (typeof qdnRequest !== 'function') {
        resetForeignAvailability();
        return;
      }
      qdnRequest({ action: 'SHOW_ACTIONS' })
        .then((actions: unknown) => {
          if (requestRevision !== revision) return;
          const availability = foreignWalletAvailability(
            chain,
            Array.isArray(actions) ? actions : []
          );
          setCanReceive(availability.canReceive);
          setCanReadBalance(availability.canReadBalance);
          canReadBalanceRef.current = availability.canReadBalance;
          setCanReadTransactions(availability.canReadTransactions);
          setCanSend(availability.canSend);
          canSendRef.current = availability.canSend;
          setWalletAvailable(
            availability.canReceive ||
              availability.canReadBalance ||
              availability.canReadTransactions
          );
          setCanManageForeignServer(availability.canManageServer);
          canManageForeignServerRef.current = availability.canManageServer;
        })
        .catch(() => {
          if (requestRevision === revision) resetForeignAvailability();
        });
    };
    const handleBridgeChange = () => {
      resetForeignAvailability();
      refreshForeignAvailability();
    };
    resetForeignAvailability();
    refreshForeignAvailability();
    window.addEventListener('qortiumBridgeStateChanged', handleBridgeChange);
    return () => {
      revision++;
      window.removeEventListener(
        'qortiumBridgeStateChanged',
        handleBridgeChange
      );
    };
  }, [chain]);

  const openForeignServerDialog = useCallback(async () => {
    if (!canManageForeignServerRef.current) return;
    setForeignServers([]);
    setForeignServerOpen(true);
    setForeignServerLoading(true);
    try {
      const servers = await qdnRequest({
        action: 'GET_CROSSCHAIN_SERVER_INFO',
        coin: chain.coinEnum,
      });
      if (canManageForeignServerRef.current && Array.isArray(servers))
        setForeignServers(servers);
    } catch {
      /* */
    }
    setForeignServerLoading(false);
  }, [chain.coinEnum]);

  const handleForeignServerChange = useCallback(
    async (server: any) => {
      setForeignServerOpen(false);
      if (!canManageForeignServerRef.current) return;
      try {
        await qdnRequest({
          action: 'SET_CURRENT_FOREIGN_SERVER',
          coin: chain.coinEnum,
          server,
        } as any);
      } catch {
        /* */
      }
      if (!canManageForeignServerRef.current || !canReadBalanceRef.current)
        return;
      fetchBalance();
    },
    [chain.coinEnum, fetchBalance]
  );

  const fetchTransactions = useCallback(async () => {
    if (!chain.isNative && !canReadTransactions) {
      setTransactions([]);
      setLoadingTx(false);
      return;
    }
    const revision = transactionReadRevision.current;
    setLoadingTx(true);
    setTxError(null);
    try {
      if (chain.isNative) {
        const wallet = await requestWalletForChain(chain);
        const addr = wallet?.address;
        if (!addr) {
          setTransactions([]);
          return;
        }
        const res = await requestQortTransactions(addr, {
          txType: ['PAYMENT'],
          confirmationStatus: 'CONFIRMED',
          limit: 20,
          reverse: true,
        });
        const data: any[] = Array.isArray(res) ? res : [];
        const rows: TxRow[] = data.map((tx) => {
          const incoming = tx.recipient === addr;
          const raw = Math.round(parseFloat(tx.amount ?? '0') * 1e8);
          return {
            txHash: tx.signature,
            totalAmount: incoming ? raw : -raw,
            feeAmount: Math.round(parseFloat(tx.fee ?? '0') * 1e8),
            timestamp: tx.timestamp,
            sender: incoming ? (tx.creatorAddress ?? undefined) : addr,
            recipient: tx.recipient,
          };
        });
        if (
          isMountedRef.current &&
          revision === transactionReadRevision.current
        )
          setTransactions(rows);
      } else {
        const res = await requestWithTimeout(
          { action: 'GET_USER_WALLET_TRANSACTIONS', coin: chain.coinEnum },
          TIME_MINUTES_5
        );
        const txs = Array.isArray(res) ? res : [];
        if (
          isMountedRef.current &&
          revision === transactionReadRevision.current
        )
          setTransactions(chain.coinEnum === 'ARRR' ? [...txs].reverse() : txs);
      }
    } catch (err) {
      if (
        isMountedRef.current &&
        revision === transactionReadRevision.current
      ) {
        const decoded = describeBridgeError(err);
        console.warn('[wallet] transactions', chain.ticker, decoded.message);
        setTransactions([]);
        setTxError(decoded.message);
      }
    } finally {
      if (isMountedRef.current && revision === transactionReadRevision.current)
        setLoadingTx(false);
    }
  }, [canReadTransactions, chain]);

  useEffect(() => {
    fetchAddress();
  }, [fetchAddress]);

  // Fetch balance + tx only after lock check resolves and ARRR has synced (for other chains arrrSynced starts true)
  useEffect(() => {
    if (!walletReady || !arrrSynced) return;
    fetchBalance();
    fetchTransactions();

    // Native QORT: poll just the balance every 60 s (cheap - one GET_BALANCE)
    // so an incoming payment is noticed while this page is open, and only
    // re-fetch the (more expensive) transaction history when the balance
    // actually changed. Foreign coins keep the existing combined 3-minute
    // poll below (their balance reads go through Electrum via Core).
    if (chain.isNative) {
      const id = setInterval(async () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!isMountedRef.current) return;
        try {
          const res = await requestQortBalance();
          const next = String(parseFloat(String(res ?? 0)));
          if (!isMountedRef.current) return;
          // Compare against the ref seeded by fetchBalance's own last
          // resolution, not a value captured when this effect was set up -
          // otherwise the very first tick always "changes" from null.
          if (next !== lastKnownBalanceRef.current) {
            lastKnownBalanceRef.current = next;
            setBalance(next);
            setBalanceError(null);
            fetchTransactions();
          }
        } catch {
          /* a transient poll failure isn't worth surfacing - the next tick retries */
        }
      }, NATIVE_BALANCE_POLL_MS);
      return () => clearInterval(id);
    }

    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchBalance();
      fetchTransactions();
    }, TIME_MINUTES_3);
    return () => clearInterval(id);
  }, [fetchBalance, fetchTransactions, arrrSynced, walletReady, chain]);

  const openSend = useCallback(async () => {
    setAmount('');
    setSendMax(false);
    setRecipient(EMPTY_STRING);
    setRecipientMode('address');
    setRecipientName(EMPTY_STRING);
    setResolution(null);
    setResolvingRecipient(false);
    setStaleAddressWarning(false);
    setSendResult(null);
    setSendResponse(null);
    setSendErrorMessage(null);
    setSendErrorIsCoreBug(false);
    suggestedFee.reset();
    setSendOpen(true);
    await suggestedFee.load();
  }, [suggestedFee]);

  // Register as a pendingSends subscriber for as long as this page is
  // mounted, so the shared poller (module-level; see pendingSends.ts) keeps
  // running for this send even if it was actually accepted while a
  // *different* CoinDetail instance (or none) was mounted, and keeps
  // running after this page is left for the grid (round 2 review finding
  // 2). Also react to entries changing (added/confirmed/timed-out) and to
  // a confirmation specifically, which is the module's signal to refetch
  // history here rather than waiting for the next periodic poll.
  useEffect(() => {
    const unregister = registerPendingSendsSubscriber();
    const unsubscribeEntries = subscribePendingSends(() => {
      setPendingSendsVersion((v) => v + 1);
    });
    const unsubscribeConfirmed = subscribePendingSendConfirmed(
      (confirmedAccount, confirmedChainKey) => {
        if (confirmedAccount !== pendingSendsAccountKey(homeAccount)) return;
        if (confirmedChainKey !== chain.key) return;
        if (!isMountedRef.current) return;
        fetchTransactions();
      }
    );
    return () => {
      unregister();
      unsubscribeEntries();
      unsubscribeConfirmed();
    };
  }, [homeAccount, chain.key, fetchTransactions]);

  // Every currently-tracked pending send for this account+chain, from the
  // shared module - not local state, so it survives a navigate-away-and-
  // back and reflects a confirmation/timeout the module made while this
  // page wasn't mounted at all.
  const pendingSendRows = useMemo(
    () => getPendingSendsForChain(homeAccount, chain.key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [homeAccount, chain.key, pendingSendsVersion]
  );

  // Merge the optimistic pending row(s) on top of the fetched transaction
  // list, without waiting for the next periodic history refresh to show
  // them and without mutating `transactions` itself. Deduped by signature -
  // once the real confirmed row appears in `transactions`, the synthetic
  // pending row for the same signature is dropped so it's never shown
  // twice.
  const displayedTransactions = useMemo(() => {
    if (pendingSendRows.length === 0) return transactions;
    const confirmedHashes = new Set(
      transactions.map((row) => row.txHash).filter(Boolean)
    );
    const stillPending = pendingSendRows.filter(
      (entry) => !confirmedHashes.has(entry.txHash)
    );
    if (stillPending.length === 0) return transactions;
    const pendingRows: TxRow[] = stillPending.map((entry) => ({
      txHash: entry.txHash,
      totalAmount: entry.totalAmount,
      recipient: entry.recipient,
      sender: entry.sender,
      pending: true,
      pendingTimedOut: entry.timedOut,
    }));
    return [...pendingRows, ...transactions];
  }, [transactions, pendingSendRows]);

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
      const result = await resolveContact(
        trimmed,
        chain.coinEnum,
        chain.isNative ? 'qortal' : 'qortium'
      );
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
  }, [recipientName, recipientMode, chain.coinEnum, chain.isNative]);

  const handleCopy = () => {
    if (!address) return;
    copyToClipboard(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSend = async () => {
    if (!canSendRef.current || !canConfirmSend) return;

    setSending(true);
    setSendErrorMessage(null);
    setSendErrorIsCoreBug(false);
    try {
      if (!(await ensureAccountUnlocked(chain, qortCanUnlock))) {
        throw new Error('Unable to unlock the account. Please try again.');
      }

      let effectiveRecipient = recipient;
      if (recipientMode === 'name') {
        const fresh = await resolveContact(
          recipientName.trim(),
          chain.coinEnum,
          chain.isNative ? 'qortal' : 'qortium'
        );
        setResolution(fresh);
        if (fresh.status !== 'resolved') return;
        if (fresh.address !== recipient) {
          setRecipient(fresh.address);
          setStaleAddressWarning(true);
          return; // address changed since the field was filled - force re-confirmation
        }
        effectiveRecipient = fresh.address;
      }

      // A bridge-state change can revoke foreign send authority while account
      // unlock or name resolution is in progress.
      if (!canSendRef.current) return;

      let result: SendCoinResult | null = null;
      let nativeSignature: string | undefined;
      if (chain.isNative) {
        if (!qortSendAction) return;
        const res = (await requestQortSend(
          qortSendAction,
          effectiveRecipient,
          parseFloat(amount)
        )) as
          | (SendCoinResult & {
              accepted?: boolean;
              // Home 2's ambiguous-broadcast result uses `outcome`, not
              // `foreignOutcome` (that field name is the foreign-send
              // shape below) - see broadcastHomeV2Payment.
              outcome?: 'unknown' | 'mismatch';
              errorType?: string;
              error?: string;
            })
          | null;
        if (res == null || typeof res !== 'object') {
          throw new Error('Home returned no send result');
        }
        if (res.accepted === false) {
          // Mirrors the foreign SEND_COIN handling below: Home resolves
          // (rather than throws) with accepted:false when it can't confirm
          // the broadcast outcome - never treat that as success, and never
          // as a hard error either when the outcome is merely unknown.
          const decoded = describeBridgeError(
            res.error ?? `${qortSendAction} failed`
          );
          if (isUnlockRequiredError(decoded)) invalidateCachedAccountUnlocked();
          console.warn('[wallet] send failed', chain.ticker, decoded);
          setSendResponse(null);
          setSendErrorMessage(decoded.message);
          setSendErrorIsCoreBug(isCoreSpendContextBugError(decoded));
          setSendResult(
            res.outcome === 'unknown' || res.outcome === 'mismatch'
              ? 'pending'
              : 'error'
          );
          return;
        }
        result = res;
        nativeSignature =
          typeof res.transactionSignature === 'string'
            ? res.transactionSignature
            : typeof res.signature === 'string'
              ? res.signature
              : undefined;
      } else {
        const payload: Record<string, unknown> = {
          action: 'SEND_COIN',
          recipient: effectiveRecipient,
          coin: chain.coinEnum,
        };
        if (canUseForeignSendMax && sendMax) {
          payload.sendMax = true;
        } else {
          payload.amount = amount;
        }
        if (chain.coinEnum !== 'ARRR' && suggestedFee.fee !== '') {
          payload.feePerByte = suggestedFee.fee.trim();
        }
        const foreignResult = (await qdnRequest(payload as any)) as
          | (SendCoinResult & {
              accepted?: boolean;
              foreignOutcome?: 'unknown' | 'mismatch';
              error?: string;
            })
          | null;

        if (foreignResult == null || typeof foreignResult !== 'object') {
          throw new Error('Home returned no send result');
        }

        // Foreign SEND_COIN resolves (rather than throws) with
        // accepted:false when Home can't confirm the broadcast outcome -
        // never treat that as success.
        if (foreignResult.accepted === false) {
          const decoded = describeBridgeError(
            foreignResult.error ?? foreignResult
          );
          if (isUnlockRequiredError(decoded)) invalidateCachedAccountUnlocked();
          console.warn('[wallet] send failed', chain.ticker, decoded);
          setSendResponse(null);
          setSendErrorMessage(decoded.message);
          setSendErrorIsCoreBug(isCoreSpendContextBugError(decoded));
          setSendResult(
            foreignResult.foreignOutcome === 'unknown' ||
              foreignResult.foreignOutcome === 'mismatch'
              ? 'pending'
              : 'error'
          );
          return;
        }
        result = foreignResult;
      }
      setSendResponse(result);
      setSendResult('success');
      setStaleAddressWarning(false);

      // The grid's cached balance for this coin is now stale - drop it so
      // the next time it's shown it re-fetches instead of rendering a
      // pre-send amount (round 2, item B's "just sent from" trigger).
      invalidateCachedBalance(homeAccount, chain.key);

      if (chain.isNative && nativeSignature) {
        // Show the sent transaction immediately as a pending row and poll
        // for its confirmation (round 2, item A) instead of the blind
        // fixed-delay refresh below, which has no truth source. Prefer the
        // amount/recipient Home actually echoes back in the result over
        // the local form state, since that's what was actually broadcast.
        // Tracked in the shared pendingSends module (not local state) so
        // it keeps polling/rendering correctly across navigating away from
        // this page and back (round 2 review finding 2).
        const resultAmount = result?.amount;
        const resultRecipient = result?.recipient;
        addPendingSend({
          account: homeAccount,
          chain,
          txHash: nativeSignature,
          totalAmount:
            resultAmount != null
              ? -Math.round(parseFloat(String(resultAmount)) * 1e8)
              : -Math.round(parseFloat(amount) * 1e8),
          recipient:
            typeof resultRecipient === 'string'
              ? resultRecipient
              : effectiveRecipient,
          sender: address || undefined,
        });
      } else {
        if (postSendRefreshTimeoutRef.current) {
          clearTimeout(postSendRefreshTimeoutRef.current);
        }
        postSendRefreshTimeoutRef.current = setTimeout(() => {
          postSendRefreshTimeoutRef.current = null;
          if (!isMountedRef.current) return;
          fetchBalance();
          fetchTransactions();
        }, TIME_SECONDS_3);
      }
    } catch (err) {
      const decoded = describeBridgeError(err);
      if (isUnlockRequiredError(decoded)) invalidateCachedAccountUnlocked();
      console.warn('[wallet] send failed', chain.ticker, decoded);
      setSendResponse(null);
      setSendErrorMessage(decoded.message);
      setSendErrorIsCoreBug(isCoreSpendContextBugError(decoded));
      setSendResult('error');
    } finally {
      setSending(false);
    }
  };

  const closeSend = () => {
    setSendOpen(false);
    setSendResult(null);
    setSendResponse(null);
    setSendErrorMessage(null);
    setSendErrorIsCoreBug(false);
    setAmount('');
    setSendMax(false);
    setRecipient(EMPTY_STRING);
    setRecipientMode('address');
    setRecipientName(EMPTY_STRING);
    setResolution(null);
    setResolvingRecipient(false);
    setStaleAddressWarning(false);
    suggestedFee.reset();
    setSearchParams({});
  };

  const sendFeeInputValue = suggestedFee.fee;
  const sendFeeLabel = chain.isNative
    ? t('send_dialog.optional_custom_fee', { coin: chain.ticker })
    : t('send_dialog.optional_fee_per_byte', { coin: chain.ticker });
  const setSendFeeInputValue = suggestedFee.setFee;
  const canUseForeignSendMax = !chain.isNative && chain.coinEnum !== 'ARRR';
  const amountIsValid =
    canUseForeignSendMax && sendMax
      ? true
      : isPositiveDecimal(amount, chain.decimalPlaces);

  // Item C (round 4): Core's own declared minimum non-dust output per
  // chain (see src/config/minimums.ts) - warn and block before Core
  // rejects it at broadcast time. Never applies to send-max (no fixed
  // amount to compare) or to QORT/ARRR (no declared minimum).
  const minDust = minNonDustOutput(chain.coinEnum);
  const belowMinimum =
    minDust != null &&
    amount !== '' &&
    isPositiveDecimal(amount, chain.decimalPlaces) &&
    decimalToAtomic(amount, chain.decimalPlaces) < BigInt(minDust);

  // Item B (round 4): per-coin address format validation - checksum +
  // version byte, not just "non-empty and short enough". This applies in
  // BOTH modes: in 'address' mode it's the raw typed text; in 'name' mode
  // `recipient` holds the resolved address (set by the resolution effect
  // below), and that address is exactly as untrusted as a typed one - a
  // Qortal name's crosschain address or a contact card's published
  // address (resolveContact.ts) is supplied verbatim by whoever
  // owns/wrote it, never validated at the source. A malformed or
  // wrong-chain resolved address must block Send exactly like a
  // malformed typed one (round 4 review item 2).
  const genericRecipientOk = isValidRecipient(recipient);
  const recipientFormatOk = validateAddress(chain.coinEnum, recipient);
  const recipientIsValid = genericRecipientOk && recipientFormatOk;
  // Name mode only: the name/contact resolved successfully, but what it
  // resolved to isn't a valid address for this coin - distinct from
  // "resolution failed" (no card, name not found, etc.) and shown instead
  // of the green "resolved to" line.
  const resolvedAddressInvalid =
    recipientMode === 'name' &&
    resolution?.status === 'resolved' &&
    !recipientFormatOk;
  // Round 4 review item 3: DOGE and DGB share Core's P2PKH version byte
  // (30), so a valid address for one coin is indistinguishable from a
  // valid address for the other by format alone (see the NOTE on
  // validateDogeAddress() in addressValidation.ts) - a soft reminder,
  // never blocking, since there is no way to actually tell them apart.
  const showDogeDgbLookAlikeNote =
    recipientMode === 'address' &&
    (chain.coinEnum === 'DOGE' || chain.coinEnum === 'DGB');

  const foreignFeeIsValid =
    chain.isNative ||
    chain.coinEnum === 'ARRR' ||
    isOptionalPositiveDecimal(suggestedFee.fee, 8);
  const canConfirmSend =
    canSend &&
    !sending &&
    !suggestedFee.loading &&
    amountIsValid &&
    !belowMinimum &&
    recipientIsValid &&
    foreignFeeIsValid &&
    (recipientMode !== 'name' ||
      (!resolvingRecipient && resolution?.status === 'resolved'));
  const showAmountError = amount !== '' && (!amountIsValid || belowMinimum);
  const showRecipientError = recipient !== '' && !recipientIsValid;
  const recipientErrorIsCoinFormat =
    showRecipientError && genericRecipientOk && !recipientFormatOk;
  const showFeeError =
    !chain.isNative &&
    chain.coinEnum !== 'ARRR' &&
    suggestedFee.fee !== '' &&
    !foreignFeeIsValid;

  // Item C (round 4): non-blocking balance-vs-(amount+fee) warning, shown
  // once the balance is known. Never shown for send-max - by definition
  // that already spends everything sendable, so there's nothing useful to
  // warn about.
  const feeEstimate = suggestedFee.fee
    ? chain.isNative
      ? parseFloat(suggestedFee.fee) || 0
      : (parseFloat(suggestedFee.fee) || 0) * 250
    : 0;
  const balanceExceeded =
    balance != null &&
    !(canUseForeignSendMax && sendMax) &&
    amount !== '' &&
    isPositiveDecimal(amount, chain.decimalPlaces) &&
    parseFloat(amount) + feeEstimate > parseFloat(balance);

  const handleCopyHash = (i: number, hash: string) => {
    const finish = () => {
      setCopiedHash(i);
      setTimeout(() => setCopiedHash(null), 2000);
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
  };

  const handleToggleExpand = useCallback((i: number) => {
    setExpandedTx((prev) => (prev === i ? null : i));
  }, []);

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
        <CoinImage
          url={coinImageUrl}
          ticker={chain.ticker}
          size={24}
          placeholderSx={{ fontSize: '0.7rem' }}
        />
        <Box
          sx={{
            fontWeight: tokens.typography.weightBold,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: '0.85rem',
          }}
        >
          {chain.name}
        </Box>
        {chain.activeNetwork !== 'MAIN' && (
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
            {chain.activeNetwork.toLowerCase()}
          </Box>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {!chain.isNative && !isARRR && canManageForeignServer && (
          <Tooltip title="ElectrumX servers">
            <IconButton
              size="small"
              onClick={openForeignServerDialog}
              sx={{ borderRadius: 0, color: c.textSecondary }}
            >
              <DnsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
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
              disabled={(isARRR && !arrrSynced) || !canSend}
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
        {!walletAvailable ? (
          <Box
            sx={{
              border: `${isClassic ? tokens.shape.classicBorderWidth : tokens.shape.borderWidth} solid ${isClassic ? c.border : c.borderLight}`,
              borderRadius: `${isClassic ? tokens.shape.radiusMd : tokens.shape.radius}px`,
              bgcolor: c.surface,
              boxShadow: c.shadowCard,
              p: { xs: 4, md: 6 },
              textAlign: 'center',
              color: c.textSecondary,
              fontSize: '0.875rem',
              lineHeight: 1.6,
            }}
          >
            Wallet features are not available on a public node.
            <br />
            Connect to a local Qortium node to view balances and transactions.
          </Box>
        ) : isARRR && !arrrSynced ? (
          /* ── ARRR initialization overlay ── */
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
              p: { xs: 4, md: 6 },
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 3,
            }}
          >
            <CoinImage
              url={coinImageUrl}
              ticker="ARRR"
              size={56}
              imgSx={{ opacity: arrrSyncFailed ? 0.35 : 0.75 }}
              placeholderSx={{
                bgcolor: 'rgba(128,128,128,0.15)',
                fontSize: '1.2rem',
                color: 'rgba(128,128,128,0.5)',
                opacity: arrrSyncFailed ? 0.35 : 0.75,
              }}
            />
            {arrrSyncing && (
              <CircularProgress size={36} sx={{ color: c.accent }} />
            )}
            <Box>
              <Box
                sx={{
                  fontSize: '0.95rem',
                  fontWeight: tokens.typography.weightBold,
                  color: arrrSyncFailed ? c.error : c.textPrimary,
                  mb: 0.75,
                }}
              >
                {arrrSyncStatus}
              </Box>
              {!arrrSyncFailed && (
                <Box
                  sx={{
                    fontSize: '0.78rem',
                    color: c.textSecondary,
                    maxWidth: 380,
                    lineHeight: 1.6,
                  }}
                >
                  Pirate Chain uses a shielded blockchain that must sync before
                  balances or transactions are available.
                </Box>
              )}
            </Box>
            {arrrSyncFailed && (
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <Button
                  variant="contained"
                  onClick={syncArrr}
                  disableElevation
                  sx={{
                    bgcolor: c.accent,
                    color: c.accentText,
                    '&:hover': { bgcolor: c.accentHover },
                    borderRadius: isClassic
                      ? `${tokens.shape.radiusMd}px`
                      : '50px',
                    px: 3,
                  }}
                >
                  Retry
                </Button>
                {arrrServers.length > 0 && (
                  <Button
                    variant="outlined"
                    onClick={() => setArrrServerOpen(true)}
                    sx={{
                      borderColor: c.accent,
                      color: c.accent,
                      '&:hover': {
                        borderColor: c.accentHover,
                        color: c.accentHover,
                      },
                      borderRadius: isClassic
                        ? `${tokens.shape.radiusMd}px`
                        : '50px',
                      px: 3,
                    }}
                  >
                    Change Server
                  </Button>
                )}
              </Box>
            )}
          </Box>
        ) : (
          <>
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
                mb: 0,
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
                <CoinImage
                  url={coinImageUrl}
                  ticker={chain.ticker}
                  size={56}
                  sx={{ mb: 2 }}
                  placeholderSx={{
                    bgcolor: 'rgba(128,128,128,0.15)',
                    fontSize: '1.2rem',
                    color: 'rgba(128,128,128,0.5)',
                  }}
                />
                {loadingBalance ? (
                  <Skeleton width={220} height={64} sx={{ mx: 'auto' }} />
                ) : (
                  <>
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
                      {balance ?? '—'}
                      <Box
                        component="span"
                        sx={{
                          fontSize: '1.1rem',
                          fontWeight: tokens.typography.weightBold,
                          ml: 1.5,
                          color: c.textSecondary,
                        }}
                      >
                        {chain.ticker}
                      </Box>
                    </Typography>
                    <Box
                      sx={{
                        mt: 1.5,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                      }}
                    >
                      {pricePerUnit != null && balance != null && (
                        <Box
                          sx={{
                            fontSize: '1.1rem',
                            fontWeight: tokens.typography.weightBold,
                            color: c.textPrimary,
                          }}
                        >
                          {formatFiat(
                            parseFloat(balance) * pricePerUnit,
                            currency
                          )}
                        </Box>
                      )}
                      <Box
                        sx={{
                          fontSize: '0.78rem',
                          color: c.textSecondary,
                          letterSpacing: '0.02em',
                        }}
                      >
                        1 {chain.ticker} ={' '}
                        {pricePerUnit != null
                          ? formatFiat(pricePerUnit, currency)
                          : '-'}
                      </Box>
                      {balanceError && (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            mt: 0.5,
                          }}
                        >
                          <Tooltip title={balanceError} placement="top">
                            <Box
                              sx={{
                                fontSize: '0.75rem',
                                color: c.error,
                                maxWidth: 220,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {t('balance_unavailable')}
                            </Box>
                          </Tooltip>
                          <IconButton
                            size="small"
                            onClick={fetchBalance}
                            aria-label="retry balance"
                            sx={{ color: c.error }}
                          >
                            <RefreshIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>
                      )}
                    </Box>
                  </>
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
                mb: 4,
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
                  transition: 'color 0.15s ease',
                }}
              >
                {address || '—'}
              </Box>
              {copied ? (
                <CheckIcon sx={{ fontSize: 16, color: c.accentText }} />
              ) : (
                <ContentCopyIcon
                  sx={{ fontSize: 16, color: c.textSecondary }}
                />
              )}
              <Box
                sx={{
                  fontSize: '0.65rem',
                  fontWeight: tokens.typography.weightBold,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: copied ? c.accentText : c.textSecondary,
                  transition: 'color 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? 'Copied' : 'Click to copy'}
              </Box>
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
              Transactions
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
              ) : displayedTransactions.length === 0 && txError ? (
                <Box
                  sx={{
                    py: 6,
                    textAlign: 'center',
                    color: c.error,
                    fontSize: '0.85rem',
                  }}
                >
                  <Tooltip title={txError} placement="top">
                    <Box component="span">{t('transactions_unavailable')}</Box>
                  </Tooltip>
                  <IconButton
                    size="small"
                    onClick={fetchTransactions}
                    aria-label="retry transactions"
                    sx={{ color: c.error, ml: 0.5 }}
                  >
                    <RefreshIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ) : displayedTransactions.length === 0 ? (
                <Box
                  sx={{
                    py: 6,
                    textAlign: 'center',
                    color: c.textSecondary,
                    fontSize: '0.85rem',
                    letterSpacing: '0.06em',
                  }}
                >
                  No transactions yet
                </Box>
              ) : (
                displayedTransactions.map((row, i) => (
                  <TransactionRow
                    key={i}
                    row={row}
                    index={i}
                    isLastRow={i === displayedTransactions.length - 1}
                    chain={chain}
                    userAddress={address}
                    expanded={expandedTx === i}
                    onToggleExpand={() => handleToggleExpand(i)}
                    copiedHash={copiedHash}
                    onCopyHash={handleCopyHash}
                  />
                ))
              )}
            </Box>
          </>
        )}
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
              Send {chain.ticker}
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
                <Typography
                  sx={{
                    fontWeight: tokens.typography.weightBold,
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('send_dialog.transaction_sent')}
                </Typography>
                {sendResponse?.prepared && (
                  <PreparedTransactionPreview
                    chain={chain}
                    prepared={sendResponse.prepared}
                  />
                )}
              </Box>
            ) : sendResult === 'pending' ? (
              <Box sx={{ textAlign: 'center', py: 3, color: c.warning }}>
                <WarningAmberIcon sx={{ fontSize: 40, mb: 1 }} />
                <Typography sx={{ fontWeight: tokens.typography.weightBold }}>
                  {t('send_dialog.send_pending_title')}
                </Typography>
                <Typography sx={{ fontSize: '0.8rem', mt: 0.5 }}>
                  {t('send_dialog.send_pending_hint')}
                </Typography>
                {sendErrorMessage && (
                  <Typography
                    sx={{ fontSize: '0.75rem', mt: 1, color: c.textSecondary }}
                  >
                    {sendErrorMessage}
                  </Typography>
                )}
                {sendErrorIsCoreBug && (
                  <Typography
                    sx={{ fontSize: '0.75rem', mt: 1, color: c.warning }}
                  >
                    {t('send_dialog.core_spend_context_bug_hint')}
                  </Typography>
                )}
              </Box>
            ) : sendResult === 'error' ? (
              <Box sx={{ textAlign: 'center', py: 3, color: c.error }}>
                <Typography sx={{ fontWeight: tokens.typography.weightBold }}>
                  {t('send_dialog.send_failed')}
                </Typography>
                {sendErrorMessage && (
                  <Typography sx={{ fontSize: '0.8rem', mt: 1 }}>
                    {sendErrorMessage}
                  </Typography>
                )}
                {sendErrorIsCoreBug && (
                  <Typography sx={{ fontSize: '0.75rem', mt: 1 }}>
                    {t('send_dialog.core_spend_context_bug_hint')}
                  </Typography>
                )}
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
                  {t('send_dialog.balance')}{' '}
                  <Box
                    component="span"
                    sx={{
                      color: c.textPrimary,
                      fontWeight: tokens.typography.weightBold,
                    }}
                  >
                    {balance ?? '—'} {chain.ticker}
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <NumericFormat
                    decimalScale={chain.decimalPlaces}
                    value={amount}
                    allowNegative={false}
                    customInput={TextField as React.ComponentType<any>}
                    valueIsNumericString
                    label={t('send_dialog.amount_label', {
                      coin: chain.ticker,
                    })}
                    fullWidth
                    onValueChange={(v) => setAmount(v.value)}
                    disabled={sending || (canUseForeignSendMax && sendMax)}
                    error={showAmountError}
                    helperText={
                      belowMinimum
                        ? t('send_dialog.amount_below_minimum', {
                            min:
                              minDust != null
                                ? formatAtomicAmount(
                                    minDust,
                                    chain.decimalPlaces
                                  )
                                : '',
                            coin: chain.ticker,
                          })
                        : showAmountError
                          ? t('send_dialog.amount_invalid', {
                              decimals: chain.decimalPlaces,
                            })
                          : undefined
                    }
                  />
                  {chain.isNative && (
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={sending || !balance}
                      onClick={() => {
                        const bal = parseFloat(balance ?? '0');
                        const feeVal = parseFloat(suggestedFee.fee || '0');
                        const factor = Math.pow(10, chain.decimalPlaces);
                        setAmount(
                          String(
                            Math.max(
                              0,
                              Math.floor((bal - feeVal) * factor) / factor
                            )
                          )
                        );
                      }}
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
                  )}
                </Box>

                {balanceExceeded && (
                  <Typography variant="caption" sx={{ color: c.warning }}>
                    {t('send_dialog.amount_exceeds_balance_with_fee')}
                  </Typography>
                )}

                {canUseForeignSendMax && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={sendMax}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSendMax(checked);
                          if (checked) setAmount('');
                        }}
                        disabled={sending}
                      />
                    }
                    label={
                      <Box>
                        <Box
                          sx={{
                            fontSize: '0.85rem',
                            fontWeight: tokens.typography.weightBold,
                            color: c.textPrimary,
                          }}
                        >
                          {t('action.send_max')}
                        </Box>
                        <Box
                          sx={{
                            fontSize: '0.72rem',
                            color: c.textSecondary,
                          }}
                        >
                          {t('max_sendable')} {balance ?? '—'} {chain.ticker}
                        </Box>
                      </Box>
                    }
                    sx={{ alignItems: 'center', m: 0 }}
                  />
                )}

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
                    {t('send_dialog.recipient_mode_address')}
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
                    {t('send_dialog.recipient_mode_name')}
                  </Button>
                </Box>

                {recipientMode === 'address' ? (
                  <>
                    <TextField
                      label={t('send_dialog.recipient_address')}
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value.trim())}
                      fullWidth
                      disabled={sending}
                      error={showRecipientError}
                      helperText={
                        recipientErrorIsCoinFormat
                          ? t('send_dialog.recipient_invalid_coin', {
                              ticker: chain.ticker,
                            })
                          : showRecipientError
                            ? t('send_dialog.recipient_invalid')
                            : undefined
                      }
                    />
                    {showDogeDgbLookAlikeNote && (
                      <Typography
                        variant="caption"
                        sx={{ color: c.textSecondary }}
                      >
                        {t('send_dialog.doge_dgb_look_alike')}
                      </Typography>
                    )}
                  </>
                ) : (
                  <>
                    <TextField
                      label={t(
                        chain.isNative
                          ? 'send_dialog.recipient_qortal_name'
                          : 'send_dialog.recipient_name'
                      )}
                      value={recipientName}
                      onChange={(e) => {
                        setRecipientName(e.target.value);
                        setStaleAddressWarning(false);
                      }}
                      fullWidth
                      disabled={sending}
                    />
                    {resolvingRecipient && (
                      <Typography variant="caption">
                        {t('send_dialog.resolving_recipient')}
                      </Typography>
                    )}
                    {!resolvingRecipient &&
                      resolution?.status === 'resolved' &&
                      !resolvedAddressInvalid && (
                        <Typography variant="caption" sx={{ color: c.success }}>
                          {t('send_dialog.resolved_to', {
                            name: resolution.name,
                            ticker: chain.ticker,
                            address: resolution.address,
                          })}
                        </Typography>
                      )}
                    {!resolvingRecipient && resolvedAddressInvalid && (
                      <Typography variant="caption" sx={{ color: c.error }}>
                        {t('send_dialog.resolution_invalid_coin_address', {
                          ticker: chain.ticker,
                        })}
                      </Typography>
                    )}
                    {!resolvingRecipient &&
                      resolution &&
                      resolution.status !== 'resolved' && (
                        <Typography variant="caption" sx={{ color: c.error }}>
                          {t(
                            chain.isNative &&
                              resolution.status === 'name-not-found'
                              ? 'send_dialog.resolution_qortal_name_not_found'
                              : `send_dialog.resolution_${resolution.status.replace(/-/g, '_')}`,
                            { name: resolution.name }
                          )}
                        </Typography>
                      )}
                    {staleAddressWarning && (
                      <Typography variant="caption" sx={{ color: c.warning }}>
                        {t('send_dialog.resolution_changed_reconfirm')}
                      </Typography>
                    )}
                  </>
                )}

                {!chain.isNative && (
                  <TextField
                    label={sendFeeLabel}
                    value={
                      suggestedFee.loading
                        ? t('send_dialog.fee_loading')
                        : sendFeeInputValue
                    }
                    onChange={(e) => setSendFeeInputValue(e.target.value)}
                    fullWidth
                    disabled={sending || suggestedFee.loading}
                    type={suggestedFee.loading ? 'text' : 'number'}
                    inputProps={{ step: 'any', min: 0 }}
                    error={showFeeError}
                    helperText={
                      showFeeError
                        ? t('send_dialog.fee_per_byte_invalid')
                        : chain.coinEnum === 'ARRR'
                          ? t('send_dialog.arrr_fixed_fee')
                          : !suggestedFee.loading && suggestedFee.failed
                            ? t('send_dialog.fee_lookup_unavailable')
                            : undefined
                    }
                  />
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
                    t('send_dialog.confirm_send')
                  )}
                </Button>
              </>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── ARRR server selection dialog ── */}
      {isARRR && arrrServers.length > 0 && (
        <Dialog
          open={arrrServerOpen}
          onClose={() => setArrrServerOpen(false)}
          maxWidth="sm"
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
                Select Lightwallet Server
              </Box>
              <IconButton
                size="small"
                onClick={() => setArrrServerOpen(false)}
                sx={{ borderRadius: 0 }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            {arrrServers.map((server, i) => (
              <Box
                key={i}
                onClick={() => handleServerChange(server)}
                sx={{
                  px: 3,
                  py: 1.75,
                  borderBottom:
                    i < arrrServers.length - 1
                      ? `1px solid ${isClassic ? c.border : c.borderLight}`
                      : 'none',
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: isClassic ? c.controlHover : c.borderLight,
                  },
                  transition: 'background-color 0.12s ease',
                }}
              >
                <Box
                  sx={{
                    fontFamily: c.monoFontFamily,
                    fontSize: '0.8rem',
                    color: c.textPrimary,
                  }}
                >
                  {server.hostName ??
                    server.hostname ??
                    server.host ??
                    JSON.stringify(server)}
                  {server.port ? `:${server.port}` : ''}
                </Box>
                {server.connectionType && (
                  <Box
                    sx={{
                      fontSize: '0.65rem',
                      color: c.textSecondary,
                      mt: 0.25,
                      letterSpacing: '0.06em',
                    }}
                  >
                    {String(server.connectionType)}
                  </Box>
                )}
              </Box>
            ))}
          </DialogContent>
        </Dialog>
      )}

      {/* ── ElectrumX server selection dialog (non-ARRR foreign coins) ── */}
      {!chain.isNative && !isARRR && (
        <Dialog
          open={foreignServerOpen}
          onClose={() => setForeignServerOpen(false)}
          maxWidth="sm"
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
                {chain.ticker} ElectrumX Servers
              </Box>
              <IconButton
                size="small"
                onClick={() => setForeignServerOpen(false)}
                sx={{ borderRadius: 0 }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            {foreignServerLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} sx={{ color: c.accent }} />
              </Box>
            ) : foreignServers.length === 0 ? (
              <Box
                sx={{
                  py: 4,
                  textAlign: 'center',
                  color: c.textSecondary,
                  fontSize: '0.85rem',
                }}
              >
                No servers available
              </Box>
            ) : (
              foreignServers.map((server, i) => (
                <Box
                  key={i}
                  onClick={() => handleForeignServerChange(server)}
                  sx={{
                    px: 3,
                    py: 1.75,
                    borderBottom:
                      i < foreignServers.length - 1
                        ? `1px solid ${isClassic ? c.border : c.borderLight}`
                        : 'none',
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: isClassic ? c.controlHover : c.borderLight,
                    },
                    transition: 'background-color 0.12s ease',
                  }}
                >
                  <Box
                    sx={{
                      fontFamily: c.monoFontFamily,
                      fontSize: '0.8rem',
                      color: c.textPrimary,
                    }}
                  >
                    {server.hostName ??
                      server.hostname ??
                      server.host ??
                      JSON.stringify(server)}
                    {server.port ? `:${server.port}` : ''}
                  </Box>
                  {server.connectionType && (
                    <Box
                      sx={{
                        fontSize: '0.65rem',
                        color: c.textSecondary,
                        mt: 0.25,
                        letterSpacing: '0.06em',
                      }}
                    >
                      {String(server.connectionType)}
                    </Box>
                  )}
                </Box>
              ))
            )}
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
}
