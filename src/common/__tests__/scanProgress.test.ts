import { describe, expect, it } from 'vitest';
import {
  advanceScanProgress,
  calculateScanProgress,
  type ScanObservation,
  type ScanProgressHistory,
} from '../scanProgress';
const observation = (blocks: number): ScanObservation => ({
  identity: 'synthetic-scan',
  active: true,
  ready: false,
  stale: false,
  restartRequired: false,
  blocks,
  total: 10000,
});
function replay(points: number[][]) {
  let history: ScanProgressHistory | null = null;
  for (const [at, blocks] of points)
    history = advanceScanProgress(history, observation(blocks), at);
  const [at, blocks] = points[points.length - 1];
  return {
    history,
    result: calculateScanProgress(observation(blocks), history, at, at),
  };
}
describe('shared ETA confidence', () => {
  it('waits for sustained progress rather than predicting from an early fast burst', () => {
    expect(
      replay([
        [0, 0],
        [15000, 1000],
        [30000, 2000],
      ]).result.remainingSeconds
    ).toBeNull();
    expect(
      replay([
        [0, 0],
        [20000, 100],
        [40000, 200],
        [60000, 300],
      ]).result.remainingSeconds
    ).toBe(1940);
  });
  it('suppresses bursty rates and target-only pauses without hiding the scan percentage', () => {
    for (const points of [
      [
        [0, 0],
        [20000, 100],
        [40000, 110],
        [60000, 1000],
      ],
      [
        [0, 0],
        [20000, 100],
        [40000, 100],
        [60000, 200],
      ],
    ])
      expect(replay(points).result).toMatchObject({
        remainingSeconds: null,
        stalled: false,
      });
  });
  it('accepts dense native callbacks after stable independent spans', () => {
    const points = Array.from({ length: 61 }, (_, i) => [i * 1000, i * 5]);
    expect(replay(points).result.remainingSeconds).toBe(1940);
  });
  it('does not let an unchecked tail burst manufacture a fast forecast', () => {
    const stable = [
      [0, 0],
      [20000, 100],
      [40000, 200],
      [60000, 300],
    ];
    expect(
      replay([...stable, [61000, 9000]]).result.remainingSeconds
    ).toBeNull();
    expect(replay([...stable, [61000, 305]]).result.remainingSeconds).toBe(
      1939
    );
    // A short incomplete pause cannot distort the rate from validated spans.
    expect(replay([...stable, [79000, 300]]).result.remainingSeconds).toBe(
      1940
    );
  });
  it('does not carry rates through the captured long gaps or unavailable recovery', () => {
    const points = [
      [0, 2349975],
      [60000, 2350107],
      [100000, 2350678],
      [180000, 2350695],
    ];
    let history: ScanProgressHistory | null = null;
    const obs = (height: number) => ({
      ...observation(height),
      total: 3777070,
    });
    for (const [at, height] of points)
      history = advanceScanProgress(history, obs(height), at);
    expect(
      calculateScanProgress(obs(2350695), history, 180000, 180000)
        .remainingSeconds
    ).toBeNull();
    history = advanceScanProgress(
      history,
      { ...obs(2350695), active: false },
      200000
    );
    history = advanceScanProgress(history, obs(2350712), 220000);
    expect(history.samples).toHaveLength(1);
    expect(
      calculateScanProgress(obs(2350712), history, 220000, 220000)
        .remainingSeconds
    ).toBeNull();
    expect(
      calculateScanProgress(
        { ...obs(2350712), identity: 'new-owner' },
        history,
        220000,
        220000
      ).remainingSeconds
    ).toBeNull();
  });
});
