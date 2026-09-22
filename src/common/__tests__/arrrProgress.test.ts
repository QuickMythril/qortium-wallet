import { describe, it, expect } from 'vitest';
import {
  advanceArrrProgress,
  calculateArrrProgress,
  type ArrrProgressHistory,
} from '../arrrProgress';
import type { ArrrSyncSnapshot } from '../arrrSync';

const snapshot: ArrrSyncSnapshot = {
  contract: 'qortium-home-arrr-custody-v1',
  coin: 'ARRR',
  state: 'SYNCHRONIZING',
  ready: false,
  message: null,
  syncedBlocks: 200235,
  totalBlocks: 2144393,
  scannedHeight: 2200234,
  tipHeight: 4144392,
  stale: false,
  restartRequired: false,
  recoveryState: null,
  totalBalanceAtomic: null,
  verifiedBalanceAtomic: null,
  observedAt: 0,
  backendMode: 'unified',
  walletIdentityHash: 'wallet-a',
  lastError: null,
};
const at = (blocks: number) => ({ ...snapshot, syncedBlocks: blocks });

describe('ARRR progress estimates', () => {
  it('uses the scan range instead of absolute chain height and waits for rate samples', () => {
    expect(calculateArrrProgress(snapshot, null, 0, 0)).toEqual({
      percent: 9.3,
      remainingSeconds: null,
      stalled: false,
    });
    expect(
      calculateArrrProgress({ ...snapshot, syncedBlocks: null }, null, 0, 0)
        .percent
    ).toBeNull();
  });
  it('estimates remaining time over a rolling observation window', () => {
    let history: ArrrProgressHistory | null = null;
    for (const [time, blocks] of [
      [0, 200000],
      [15000, 201500],
      [30000, 203000],
    ]) {
      history = advanceArrrProgress(history, at(blocks), time);
    }
    expect(
      calculateArrrProgress(at(203000), history, 30000, 30000).remainingSeconds
    ).toBe(19414);
    const restarted = advanceArrrProgress(history, at(100), 45000);
    expect(
      calculateArrrProgress(at(100), restarted, 45000, 45000).remainingSeconds
    ).toBeNull();
    expect(
      advanceArrrProgress(
        history,
        { ...at(204500), walletIdentityHash: 'wallet-b' },
        45000
      ).samples
    ).toHaveLength(1);
    expect(
      advanceArrrProgress(history, at(204500), 120000).samples
    ).toHaveLength(1);
  });
  it('drops the estimate when progress stops or status becomes stale', () => {
    let history: ArrrProgressHistory | null = null;
    for (const [time, blocks] of [
      [0, 200000],
      [15000, 201500],
      [30000, 203000],
      [45000, 203000],
      [60000, 203000],
      [75000, 203000],
      [90000, 203000],
    ]) {
      history = advanceArrrProgress(history, at(blocks), time);
    }
    expect(
      calculateArrrProgress(at(203000), history, 90000, 90000)
    ).toMatchObject({ stalled: true, remainingSeconds: null });
    expect(
      calculateArrrProgress(at(203000), history, 150000, 90000).percent
    ).toBeNull();
    expect(
      calculateArrrProgress({ ...snapshot, stale: true }, history, 90000, 90000)
        .remainingSeconds
    ).toBeNull();
  });
  it('never reports 100% before backend readiness, including missing/zero/invalid ranges', () => {
    expect(
      calculateArrrProgress({ ...snapshot, syncedBlocks: 2144393 }, null, 0, 0)
        .percent
    ).toBe(99.9);
    expect(
      calculateArrrProgress(
        { ...snapshot, ready: true, state: 'READY' },
        null,
        0,
        0
      ).percent
    ).toBe(100);
    for (const changes of [
      { totalBlocks: 0 },
      { syncedBlocks: 3000000 },
      { restartRequired: true },
    ]) {
      expect(
        calculateArrrProgress({ ...snapshot, ...changes }, null, 0, 0).percent
      ).toBeNull();
    }
  });
});
