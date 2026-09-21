import { useCallback, useRef, useState } from 'react';
import type { ChainConfig } from '../config/chains';

export interface UseSuggestedFeeResult {
  /** Current fee value shown/used in the send form (string, coin- or chain-specific units). */
  fee: string;
  /** True while a live GET_FOREIGN_FEE lookup is in flight. Always false for native/ARRR chains. */
  loading: boolean;
  /** True when the last lookup attempt failed or returned nothing usable. */
  failed: boolean;
  setFee: (value: string) => void;
  /** Synchronously resets to the chain's default (native) or empty (foreign), clearing loading/failed. */
  reset: () => void;
  /** Fetches a live suggested fee for foreign, non-ARRR chains. No-op (but still resolves) otherwise. */
  load: () => Promise<void>;
}

/**
 * Suggested-fee lookup shared by every "open a send form" entry point -
 * CoinDetail's own Send button and any deep link that lands directly on an
 * open send dialog (?send=true, the Home `wallet` assignment-role deep
 * link, and the grid's quick-send navigation). Round 1 only loaded a live
 * fee from CoinDetail's button-click handler, so a form opened by any other
 * path rendered with no suggested fee at all.
 */
export function useSuggestedFee(chain: ChainConfig): UseSuggestedFeeResult {
  const [fee, setFee] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const revisionRef = useRef(0);

  const defaultFee = chain.isNative ? String(chain.defaultFee) : '';
  const needsLookup = !chain.isNative && chain.coinEnum !== 'ARRR';

  const reset = useCallback(() => {
    revisionRef.current++;
    setFee(defaultFee);
    setLoading(false);
    setFailed(false);
  }, [defaultFee]);

  const load = useCallback(async () => {
    if (!needsLookup) {
      setFee(defaultFee);
      setLoading(false);
      setFailed(false);
      return;
    }
    const revision = ++revisionRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await qdnRequest({
        action: 'GET_FOREIGN_FEE',
        coin: chain.coinEnum,
        type: 'TRADE',
      } as any);
      if (revision !== revisionRef.current) return;
      const live =
        res?.fee ??
        (typeof res === 'number' || typeof res === 'string' ? res : null);
      if (live != null) {
        setFee(String(live));
      } else {
        setFailed(true);
      }
    } catch {
      if (revision !== revisionRef.current) return;
      setFailed(true);
    } finally {
      if (revision === revisionRef.current) setLoading(false);
    }
  }, [chain.coinEnum, needsLookup, defaultFee]);

  return { fee, loading, failed, setFee, reset, load };
}
