/**
 * Minimum non-dust output per foreign (non-native, non-ARRR) chain, in
 * ATOMIC units (satoshis / koinu / duffs / etc - decimalPlaces is 8 for
 * every one of these, so divide by 1e8 for the whole-coin amount). Core
 * rejects a send below this at broadcast time (round 4, item C - Core's
 * error message is now surfaced, but the send form should warn before
 * submit rather than only after Core rejects it).
 *
 * Values are Core's own minNonDustOutput() from
 * org.qortium.crosschain.BitcoinyChainSpecs.java - THAT FILE IS THE
 * SOURCE OF TRUTH; keep this map in sync with it, not the other way
 * around.
 */
export const MIN_NON_DUST_OUTPUT: Record<string, number> = {
  BTC: 546,
  LTC: 100_000,
  DOGE: 100_000_000,
  DGB: 546,
  RVN: 2_730,
  NMC: 546,
  FIRO: 1_000,
  // dashParams() in BitcoinyChainSpecs.java never calls minNonDustOutput(),
  // so Dash falls back to bitcoinj's un-overridden default of 546.
  DASH: 546,
};

/** The minimum non-dust output (atomic units) for `coinEnum`, or null for a coin with no declared minimum (QORT, ARRR). */
export function minNonDustOutput(coinEnum: string): number | null {
  return MIN_NON_DUST_OUTPUT[coinEnum] ?? null;
}
