import { useState, useEffect, useCallback } from 'react';
import type { ChainConfig } from '../config/chains';
import type { TxRow } from '../components/wallet/TransactionRow';
import { requestWithTimeout } from '../common/functions';
import { TIME_MINUTES_5 } from '../common/constants';
import {
  requestQortTransactions,
  requestQortWallet,
} from '../common/walletBridge';
import { foreignWalletAvailability } from '../common/homeWalletCapabilities';
import { describeBridgeError } from '../common/bridgeErrors';

export interface UnifiedTxRow extends TxRow {
  chain: ChainConfig;
}

export interface UseUnifiedHistoryResult {
  rows: UnifiedTxRow[];
  loadingChains: string[];
  errorChains: string[];
  /** Decoded failure message per ticker in errorChains - never swallowed. */
  errorMessages: Record<string, string>;
}

async function fetchChainTxs(chain: ChainConfig): Promise<TxRow[]> {
  if (chain.isNative) {
    const wallet = await requestQortWallet();
    const addr = wallet?.address;
    if (!addr) return [];

    const res = await requestQortTransactions(addr, {
      txType: ['PAYMENT'],
      confirmationStatus: 'CONFIRMED',
      limit: 20,
      reverse: true,
    } as any);
    const data: any[] = Array.isArray(res) ? res : [];

    return data.map((tx) => {
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
  } else {
    const res = await requestWithTimeout(
      { action: 'GET_USER_WALLET_TRANSACTIONS', coin: chain.coinEnum } as any,
      TIME_MINUTES_5
    );
    return Array.isArray(res) ? res : [];
  }
}

export function useUnifiedHistory(
  chains: ChainConfig[]
): UseUnifiedHistoryResult {
  const [rows, setRows] = useState<UnifiedTxRow[]>([]);
  const [loadingChains, setLoadingChains] = useState<string[]>([]);
  const [errorChains, setErrorChains] = useState<string[]>([]);
  const [errorMessages, setErrorMessages] = useState<Record<string, string>>(
    {}
  );
  const [foreignActions, setForeignActions] = useState<string[]>([]);

  const addRows = useCallback((newRows: UnifiedTxRow[]) => {
    setRows((prev) =>
      [...prev, ...newRows].sort((a, b) => {
        const at = a.timestamp ?? Infinity;
        const bt = b.timestamp ?? Infinity;
        return bt - at;
      })
    );
  }, []);

  const chainKeys = chains
    .map((chain) => `${chain.key}:${JSON.stringify(chain.homeWallet ?? null)}`)
    .join(',');

  useEffect(() => {
    if (typeof qdnRequest !== 'function') {
      setForeignActions([]);
      return;
    }

    let cancelled = false;
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      qdnRequest({ action: 'SHOW_ACTIONS' })
        .then((actions: unknown) => {
          if (!cancelled && requestRevision === revision)
            setForeignActions(Array.isArray(actions) ? actions : []);
        })
        .catch(() => {
          if (!cancelled && requestRevision === revision) setForeignActions([]);
        });
    };
    const handleBridgeChange = () => {
      setForeignActions([]);
      refresh();
    };

    refresh();
    window.addEventListener('qortiumBridgeStateChanged', handleBridgeChange);
    return () => {
      cancelled = true;
      revision++;
      window.removeEventListener(
        'qortiumBridgeStateChanged',
        handleBridgeChange
      );
    };
  }, []);

  useEffect(() => {
    const readableChains = chains.filter(
      (chain) =>
        chain.coinEnum !== 'ARRR' &&
        (chain.isNative ||
          foreignWalletAvailability(chain, foreignActions).canReadTransactions)
    );
    setLoadingChains(readableChains.map((chain) => chain.ticker));
    setRows([]);
    setErrorChains([]);
    setErrorMessages({});

    let cancelled = false;

    readableChains.forEach(async (chain) => {
      try {
        const txs = await fetchChainTxs(chain);
        if (!cancelled) addRows(txs.map((row) => ({ ...row, chain })));
      } catch (err) {
        if (!cancelled) {
          const decoded = describeBridgeError(err);
          console.warn('[wallet] history', chain.ticker, decoded.message);
          setErrorChains((prev) => [...prev, chain.ticker]);
          setErrorMessages((prev) => ({
            ...prev,
            [chain.ticker]: decoded.message,
          }));
        }
      } finally {
        if (!cancelled)
          setLoadingChains((prev) => prev.filter((t) => t !== chain.ticker));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [addRows, chainKeys, foreignActions]);

  return { rows, loadingChains, errorChains, errorMessages };
}
