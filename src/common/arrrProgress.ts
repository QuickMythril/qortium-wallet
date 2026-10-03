import type { ArrrSyncSnapshot } from './arrrSync';
import {
  advanceScanProgress,
  calculateScanProgress,
  type ScanObservation,
  type ScanProgressHistory,
  SCAN_PROGRESS_STALE_MS,
} from './scanProgress';
export type {
  ScanProgressHistory as ArrrProgressHistory,
  ScanProgress as ArrrProgress,
} from './scanProgress';
type ArrrProgressHistory = ScanProgressHistory;
export const ARRR_PROGRESS_STALE_MS = SCAN_PROGRESS_STALE_MS;
const observation = (s: ArrrSyncSnapshot): ScanObservation => ({
  identity: s.walletIdentityHash,
  active: s.state === 'SYNCHRONIZING',
  ready: s.ready,
  stale: s.stale,
  restartRequired: s.restartRequired,
  blocks: s.syncedBlocks,
  total: s.totalBlocks,
});
export function advanceArrrProgress(
  history: ArrrProgressHistory | null,
  snapshot: ArrrSyncSnapshot,
  now: number
) {
  return advanceScanProgress(history, observation(snapshot), now);
}
export function calculateArrrProgress(
  snapshot: ArrrSyncSnapshot | null,
  history: ArrrProgressHistory | null,
  now: number,
  receivedAt: number
) {
  return calculateScanProgress(
    snapshot && observation(snapshot),
    history,
    now,
    receivedAt
  );
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
