import trace from './scan-batch-trace.json';
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
  it('includes bursty batches and ordinary pauses in the elapsed rate', () => {
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
      expect(replay(points).result.remainingSeconds).toBeGreaterThan(0);
  });
  it('accepts dense native callbacks after stable independent spans', () => {
    const points = Array.from({ length: 61 }, (_, i) => [i * 1000, i * 5]);
    expect(replay(points).result.remainingSeconds).toBe(1940);
  });
  it('retains a timestamped estimate through an incomplete tail burst', () => {
    const stable = [
      [0, 0],
      [20000, 100],
      [40000, 200],
      [60000, 300],
    ];
    expect(replay([...stable, [61000, 9000]]).result.remainingSeconds).toBe(
      1940
    );
    expect(replay([...stable, [61000, 305]]).result.remainingSeconds).toBe(
      1940
    );
    // A short incomplete pause cannot distort the rate from validated spans.
    expect(replay([...stable, [79000, 300]]).result.remainingSeconds).toBe(
      1940
    );
  });
  it('retains sparse batch rates but resets on deliberate inactivity and owner change', () => {
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
    ).toBeGreaterThan(0);
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

it('produces a rough ETA for sparse advancing batches and preserves counts while delayed', () => {
  const { history, result } = replay([
    [0, 0],
    [120000, 1000],
    [240000, 2000],
    [360000, 3000],
  ]);
  expect(result.remainingSeconds).toBe(840);
  const delayed = calculateScanProgress(
    { ...observation(3000), stale: true },
    history,
    500000,
    360000
  );
  expect(delayed).toMatchObject({
    percent: 30,
    remainingSeconds: 840,
    stalled: true,
  });
  expect(
    calculateScanProgress(observation(3000), history, 1300000, 360000)
      .remainingSeconds
  ).toBeNull();
});

it('shows an estimate within two minutes on the captured variable-batch trace and keeps it during waits', () => {
  let history: ScanProgressHistory | null = null;
  let firstAt: number | null = null;
  for (const row of trace) {
    const o = { ...observation(row.blocks), total: row.total };
    history = advanceScanProgress(history, o, row.at);
    const result = calculateScanProgress(o, history, row.pollAt, row.at);
    if (result.remainingSeconds !== null) firstAt ??= row.pollAt;
    if (firstAt !== null) expect(result.remainingSeconds).toBeGreaterThan(0);
  }
  expect(firstAt).not.toBeNull();
  expect(firstAt).toBeLessThan(120000);
  const tail = trace[trace.length - 1];
  const o = { ...observation(tail.blocks), total: tail.total };
  const estimated = calculateScanProgress(o, history, tail.pollAt, tail.at);
  expect(
    calculateScanProgress(o, history, tail.at + 180000, tail.at)
  ).toMatchObject({
    remainingSeconds: estimated.remainingSeconds,
    reason: 'RETAINED',
  });
  expect(
    calculateScanProgress(o, history, tail.at + 900000, tail.at)
  ).toMatchObject({ remainingSeconds: null, reason: 'EXPIRED' });
});
it('bounds dense history and resets on future time, range rewind and scan change', () => {
  const { history } = replay(
    Array.from({ length: 4000 }, (_, i) => [i * 1000, i])
  );
  expect(history!.samples.length).toBeLessThanOrEqual(92);
  expect(
    calculateScanProgress(observation(3999), history, 1, 3999000)
      .remainingSeconds
  ).toBeNull();
  for (const o of [
    { ...observation(3999), identity: 'B' },
    observation(5),
    { ...observation(3999), active: false },
    { ...observation(3999), restartRequired: true },
  ]) {
    const reset = advanceScanProgress(history, o, 4000000);
    expect(
      calculateScanProgress(o, reset, 4000000, 4000000).remainingSeconds
    ).toBeNull();
  }
});
