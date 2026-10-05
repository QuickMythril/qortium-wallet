import type { WalletScanHistory } from './walletScanHistory';
/** Coin-neutral progress arithmetic. Times describe backend work, never UI polls. */
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
const WINDOW_MS = 30 * 60_000;
const MAX_GAP_MS = 15 * 60_000;
const MIN_SAMPLE_MS = 60_000;
const RATE_INTERVAL_MS = 20_000;
type Sample = { at: number; blocks: number; total: number };
type Estimate = { at: number; blocks: number; remainingSeconds: number };
export interface ScanProgressHistory {
  identity: string | null;
  samples: Sample[];
  estimate?: Estimate;
}
export interface ScanProgress {
  percent: number | null;
  remainingSeconds: number | null;
  stalled: boolean;
  estimatedAt?: number;
  reason?: 'MEASURING' | 'ESTIMATE' | 'RETAINED' | 'EXPIRED';
}
function estimate(samples: Sample[]): Estimate | undefined {
  const first = samples[0];
  if (!first) return;
  let anchor = first;
  for (const sample of samples.slice(1)) {
    if (sample.at - anchor.at >= RATE_INTERVAL_MS) anchor = sample;
  }
  if (anchor.at - first.at < MIN_SAMPLE_MS || anchor.blocks <= first.blocks)
    return;
  // Whole elapsed intervals include ordinary pauses between native batches.
  // The incomplete tail never changes the forecast or erases a usable estimate.
  const rate = (anchor.blocks - first.blocks) / ((anchor.at - first.at) / 1000);
  return {
    at: anchor.at,
    blocks: anchor.blocks,
    remainingSeconds: Math.ceil((anchor.total - anchor.blocks) / rate),
  };
}
export function advanceScanProgress(
  history: ScanProgressHistory | null,
  snapshot: ScanObservation,
  at: number
): ScanProgressHistory {
  const { identity, blocks, total } = snapshot;
  if (
    !snapshot.active ||
    snapshot.restartRequired ||
    identity === null ||
    blocks == null ||
    total == null ||
    total <= 0 ||
    blocks < 0 ||
    blocks > total ||
    !Number.isFinite(at) ||
    at < 0
  )
    return { identity, samples: [] };
  const same = history?.identity === identity;
  let samples = same ? history.samples : [];
  let saved = same ? history.estimate : undefined;
  const last = samples[samples.length - 1];
  if (
    last &&
    (at - last.at > MAX_GAP_MS ||
      at < last.at ||
      blocks < last.blocks ||
      total < last.total)
  ) {
    samples = [];
    saved = undefined;
  } else if (last && at === last.at) return history!;
  samples = samples.filter((sample) => at - sample.at <= WINDOW_MS);
  samples = [...samples, { at, blocks, total }];
  // Keep anchors plus one changing tail, bounding per-block native callbacks.
  const bounded: Sample[] = [];
  for (const sample of samples)
    if (
      !bounded.length ||
      sample.at - bounded[bounded.length - 1].at >= RATE_INTERVAL_MS
    )
      bounded.push(sample);
  const tail = samples[samples.length - 1];
  if (bounded[bounded.length - 1] !== tail) bounded.push(tail);
  const computed = estimate(bounded);
  const next =
    saved && computed && computed.blocks <= saved.blocks ? saved : computed;
  return {
    identity,
    samples: bounded,
    ...(next || saved ? { estimate: next ?? saved } : {}),
  };
}
/** Rebuild from an owner-verified Core history after reload; no browser disk storage. */
export function restoreScanProgress(
  value: WalletScanHistory | undefined,
  snapshot: ScanObservation
): ScanProgressHistory | null {
  if (
    !value ||
    value.identity !== snapshot.identity ||
    !snapshot.active ||
    snapshot.restartRequired
  )
    return null;
  let history: ScanProgressHistory | null = null;
  for (const sample of value.samples)
    history = advanceScanProgress(
      history,
      { ...snapshot, blocks: sample.blocks, total: sample.total },
      sample.at
    );
  return history;
}
export function calculateScanProgress(
  snapshot: ScanObservation | null,
  history: ScanProgressHistory | null,
  now: number,
  receivedAt: number
): ScanProgress {
  const empty = { percent: null, remainingSeconds: null, stalled: false };
  if (!snapshot || snapshot.restartRequired || now < receivedAt) return empty;
  if (snapshot.ready) return { ...empty, percent: 100 };
  const { blocks, total } = snapshot;
  if (
    blocks == null ||
    total == null ||
    blocks < 0 ||
    total <= 0 ||
    blocks > total
  )
    return empty;
  const percent = Math.min(99.9, Math.floor((blocks / total) * 1000) / 10);
  if (!snapshot.active)
    return { percent, remainingSeconds: null, stalled: false };
  const matching = history?.identity === snapshot.identity ? history : null;
  const last = matching?.samples[matching.samples.length - 1];
  const saved = matching?.estimate ?? estimate(matching?.samples ?? []);
  const stalled = !!last && now - last.at >= SCAN_PROGRESS_STALE_MS;
  if (!last || now < last.at || (saved && now < saved.at))
    return { percent, remainingSeconds: null, stalled, reason: 'MEASURING' };
  if (now - last.at >= MAX_GAP_MS || (saved && now - saved.at >= MAX_GAP_MS))
    return { percent, remainingSeconds: null, stalled, reason: 'EXPIRED' };
  if (!saved)
    return { percent, remainingSeconds: null, stalled, reason: 'MEASURING' };
  // A retained forecast is not a countdown while no backend progress arrives.
  return {
    percent,
    remainingSeconds: saved.remainingSeconds,
    stalled,
    estimatedAt: saved.at,
    reason: stalled || last.at !== saved.at ? 'RETAINED' : 'ESTIMATE',
  };
}
