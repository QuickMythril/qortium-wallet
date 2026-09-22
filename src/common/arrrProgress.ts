import type { ArrrSyncSnapshot } from './arrrSync';

export const ARRR_PROGRESS_STALE_MS = 60_000;
const WINDOW_MS = 180_000;
const MIN_SAMPLE_MS = 30_000;

type Sample = { at: number; blocks: number; total: number };
export interface ArrrProgressHistory {
  identity: string | null;
  samples: Sample[];
}
export interface ArrrProgress {
  percent: number | null;
  remainingSeconds: number | null;
  stalled: boolean;
}

export function advanceArrrProgress(
  history: ArrrProgressHistory | null,
  snapshot: ArrrSyncSnapshot,
  now: number
): ArrrProgressHistory {
  const { syncedBlocks: blocks, totalBlocks: total } = snapshot;
  const identity = snapshot.walletIdentityHash;
  if (
    snapshot.state !== 'SYNCHRONIZING' ||
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
    (now - last.at > ARRR_PROGRESS_STALE_MS ||
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

export function calculateArrrProgress(
  snapshot: ArrrSyncSnapshot | null,
  history: ArrrProgressHistory | null,
  now: number,
  receivedAt: number
): ArrrProgress {
  const empty = { percent: null, remainingSeconds: null, stalled: false };
  if (
    !snapshot ||
    snapshot.stale ||
    snapshot.restartRequired ||
    now - receivedAt >= ARRR_PROGRESS_STALE_MS
  )
    return empty;
  if (snapshot.ready) return { ...empty, percent: 100 };
  const { syncedBlocks: blocks, totalBlocks: total } = snapshot;
  if (
    snapshot.state !== 'SYNCHRONIZING' ||
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
  const stalled = now - unchangedSince >= ARRR_PROGRESS_STALE_MS;
  if (
    stalled ||
    !first ||
    !last ||
    samples.length < 3 ||
    last.at - first.at < MIN_SAMPLE_MS ||
    last.blocks <= first.blocks ||
    now - last.at >= ARRR_PROGRESS_STALE_MS
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

// One in-memory wallet at a time. Route changes keep the recent rate; account
// changes discard it. No wallet identifiers or progress are persisted to disk.
let cached: { key: unknown; history: ArrrProgressHistory } | null = null;
export function readArrrProgressHistory(key: unknown) {
  if (cached?.key !== key) cached = null;
  return cached?.history ?? null;
}
export function writeArrrProgressHistory(
  key: unknown,
  history: ArrrProgressHistory
) {
  cached = { key, history };
}
export function clearArrrProgressHistory() {
  cached = null;
}

export function hasArrrProgressHistory(key: unknown): boolean {
  return cached?.key === key;
}
