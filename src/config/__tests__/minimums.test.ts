import { describe, it, expect } from 'vitest';
import { MIN_NON_DUST_OUTPUT, minNonDustOutput } from '../minimums';

// Round 4, item C: values sourced from Core's
// org.qortium.crosschain.BitcoinyChainSpecs.java minNonDustOutput() calls -
// see the comments in minimums.ts for the exact provenance of each.

describe('minNonDustOutput', () => {
  it('matches Core-declared minimums for each foreign chain', () => {
    expect(minNonDustOutput('BTC')).toBe(546);
    expect(minNonDustOutput('LTC')).toBe(100_000);
    expect(minNonDustOutput('DOGE')).toBe(100_000_000);
    expect(minNonDustOutput('DGB')).toBe(546);
    expect(minNonDustOutput('RVN')).toBe(2_730);
    expect(minNonDustOutput('NMC')).toBe(546);
    expect(minNonDustOutput('FIRO')).toBe(1_000);
    // Dash: bitcoinj's un-overridden default (dashParams() never calls
    // minNonDustOutput()).
    expect(minNonDustOutput('DASH')).toBe(546);
  });

  it('returns null for a coin with no declared minimum (QORT, ARRR)', () => {
    expect(minNonDustOutput('QORT')).toBeNull();
    expect(minNonDustOutput('ARRR')).toBeNull();
  });

  it('returns null for an unknown coin', () => {
    expect(minNonDustOutput('NOT_A_COIN')).toBeNull();
  });

  it('exposes the raw map with exactly the documented chains', () => {
    expect(Object.keys(MIN_NON_DUST_OUTPUT).sort()).toEqual(
      ['BTC', 'DASH', 'DGB', 'DOGE', 'FIRO', 'LTC', 'NMC', 'RVN'].sort()
    );
  });
});
