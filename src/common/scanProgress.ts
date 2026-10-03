/** Coin-neutral progress arithmetic. Observation times must describe backend work, not UI polls. */
export interface ScanObservation {
  identity: string | null;
  active: boolean;
  ready: boolean;
  stale: boolean;
  restartRequired: boolean;
  blocks: number | null;
  total: number | null;
}
export const SCAN_PROGRESS_STALE_MS = 60_000;
const WINDOW_MS = 180_000;
const MIN_SAMPLE_MS = 30_000;

type Sample = { at: number; blocks: number; total: number };
export interface ScanProgressHistory {
  identity: string | null;
  samples: Sample[];
}
export interface ScanProgress {
  percent: number | null;
  remainingSeconds: number | null;
  stalled: boolean;
}

export function advanceScanProgress(
  history: ScanProgressHistory | null,
  snapshot: ScanObservation,
  now: number
): ScanProgressHistory {
  const { blocks, total } = snapshot;
  const identity = snapshot.identity;
  if (
    !snapshot.active ||
    snapshot.stale ||
    snapshot.restartRequired ||
    blocks == null ||
    total == null ||
    total <= 0 ||
    blocks > total
  )
    return { identity, samples: [] };
  let samples = history?.identity === identity ? history.samples : [];
  const last = samples[samples.length - 1];
  // A restart, rescan, changed work range, or long observation gap invalidates
  // the old rate. Absolute chain height is deliberately not a denominator.
  if (
    last &&
    (now - last.at > SCAN_PROGRESS_STALE_MS ||
      now < last.at ||
      blocks < last.blocks ||
      total < last.total)
  )
    samples = [];
  if (last && now === last.at && blocks === last.blocks && total === last.total)
    return { identity, samples };
  samples = samples.filter((sample) => now - sample.at <= WINDOW_MS);
  return { identity, samples: [...samples, { at: now, blocks, total }] };
}

export function calculateScanProgress(
  snapshot: ScanObservation | null,
  history: ScanProgressHistory | null,
  now: number,
  receivedAt: number
): ScanProgress {
  const empty = { percent: null, remainingSeconds: null, stalled: false };
  if (
    !snapshot ||
    snapshot.stale ||
    snapshot.restartRequired ||
    now - receivedAt >= SCAN_PROGRESS_STALE_MS
  )
    return empty;
  if (snapshot.ready) return { ...empty, percent: 100 };
  const { blocks, total } = snapshot;
  if (
    !snapshot.active ||
    blocks == null ||
    total == null ||
    total <= 0 ||
    blocks > total
  )
    return empty;
  // Never round an unfinished scan to 100%, even at 99.99%.
  const percent = Math.min(99.9, Math.floor((blocks / total) * 1000) / 10);
  const samples = history?.samples ?? [];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const lastDifferent = [...samples].reverse().find((s) => s.blocks < blocks);
  const unchangedSince = lastDifferent
    ? (samples[samples.indexOf(lastDifferent) + 1]?.at ?? now)
    : (first?.at ?? now);
  const stalled = now - unchangedSince >= SCAN_PROGRESS_STALE_MS;
  if (
    stalled ||
    !first ||
    !last ||
    samples.length < 3 ||
    last.at - first.at < MIN_SAMPLE_MS ||
    last.blocks <= first.blocks ||
    now - last.at >= SCAN_PROGRESS_STALE_MS
  ) {
    return { percent, remainingSeconds: null, stalled };
  }
  const rate = (last.blocks - first.blocks) / ((last.at - first.at) / 1000);
  return {
    percent,
    remainingSeconds: Math.ceil((total - blocks) / rate),
    stalled,
  };
}
