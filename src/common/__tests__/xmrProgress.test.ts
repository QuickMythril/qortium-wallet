import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearXmrProgress,
  recordXmrProgress,
  xmrProgress,
} from '../xmrProgress';
import { parseXmrSnapshot, XMR_CONTRACT, type XmrSnapshot } from '../xmrWallet';
const id = '11111111-1111-4111-8111-111111111111';
const snap = (height: number, at: number, scanId = id): XmrSnapshot => ({
  contract: XMR_CONTRACT,
  state: 'SCANNING',
  updatedAt: null,
  wallet: null,
  progress: {
    scanId,
    startHeight: 1000,
    height,
    targetHeight: 2000,
    updatedAt: at,
  },
});
beforeEach(() => {
  clearXmrProgress();
  vi.useFakeTimers();
  vi.setSystemTime(100000);
});
afterEach(() => vi.useRealTimers());
describe('XMR native progress observations', () => {
  it('waits for real samples and does not count repeated UI polls as progress', () => {
    for (const [height, at] of [
      [1100, 100000],
      [1200, 120000],
      [1300, 140000],
      [1400, 160000],
    ]) {
      vi.setSystemTime(at);
      recordXmrProgress('A', snap(height, at));
    }
    const s = snap(1400, 160000);
    expect(xmrProgress('A', s, 160000)).toMatchObject({
      percent: 40,
      remainingSeconds: 120,
      stalled: false,
    });
    for (let at = 165000; at <= 215000; at += 5000) {
      vi.setSystemTime(at);
      recordXmrProgress('A', s);
    }
    expect(xmrProgress('A', s, 220000).remainingSeconds).toBe(120);
    expect(xmrProgress('A', s, 220000).stalled).toBe(true);
    expect(xmrProgress('B', s, 160000).remainingSeconds).toBeNull();
  });
  it('uses callback time for ETA even when balances are stale and resets on scan change, rewind and gaps', () => {
    for (const [height, at] of [
      [1100, 100000],
      [1200, 120000],
      [1300, 140000],
      [1400, 160000],
    ]) {
      vi.setSystemTime(at);
      recordXmrProgress('A', snap(height, at));
    }
    expect(
      xmrProgress('A', { ...snap(1400, 160000), state: 'STALE' }, 160000)
        .remainingSeconds
    ).toBe(120);
    for (const s of [
      snap(1100, 135000),
      snap(1400, 200000),
      snap(1500, 215000, '22222222-2222-4222-8222-222222222222'),
    ]) {
      vi.setSystemTime(s.progress!.updatedAt);
      recordXmrProgress('A', s);
      if (s.progress!.updatedAt === 200000)
        expect(
          xmrProgress('A', s, Date.now()).remainingSeconds
        ).toBeGreaterThan(0);
      else expect(xmrProgress('A', s, Date.now()).remainingSeconds).toBeNull();
    }
    clearXmrProgress();
    expect(
      xmrProgress('A', snap(1500, 215000), 215000).remainingSeconds
    ).toBeNull();
    expect(xmrProgress('A', snap(2000, 215000), 215000).percent).toBe(99.9);
  });
  it('validates progress without exposing authority and accepts older responses', () => {
    const input = { ...snap(1100, 100000), send: false };
    expect(parseXmrSnapshot(input).progress?.height).toBe(1100);
    expect(
      parseXmrSnapshot({ ...input, progress: undefined, updatedAt: undefined })
        .progress
    ).toBeNull();
    for (const patch of [
      { scanId: 'bad' },
      { height: 999 },
      { height: 2001 },
      { targetHeight: 500000001 },
      { updatedAt: -1 },
    ]) {
      expect(() =>
        parseXmrSnapshot({
          ...input,
          progress: { ...input.progress, ...patch },
        })
      ).toThrow();
    }
    expect(
      xmrProgress('A', snap(1100, 200000), 100000).remainingSeconds
    ).toBeNull();
  });
});

it('rehydrates a bounded backend history after hard reload without granting readiness', () => {
  const value = {
    ...snap(1400, 160000),
    state: 'STALE',
    scanHistory: {
      identity: id,
      samples: [
        { at: 100000, blocks: 100, total: 1000 },
        { at: 120000, blocks: 200, total: 1000 },
        { at: 140000, blocks: 300, total: 1000 },
        { at: 160000, blocks: 400, total: 1000 },
      ],
    },
  };
  clearXmrProgress();
  recordXmrProgress('A', value);
  expect(xmrProgress('A', value, 200000).remainingSeconds).toBe(120);
  expect(value.wallet).toBeNull();
  expect(xmrProgress('B', value, 200000).remainingSeconds).toBeNull();
  recordXmrProgress('A', { ...value, state: 'STOPPED' });
  expect(
    xmrProgress('A', { ...value, state: 'STOPPED' }, 200000).remainingSeconds
  ).toBeNull();
});
