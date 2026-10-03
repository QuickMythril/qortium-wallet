import type { XmrSnapshot } from './xmrWallet';
import {
  advanceScanProgress,
  calculateScanProgress,
  type ScanProgressHistory,
  type ScanObservation,
} from './scanProgress';
let cached: { account: unknown; history: ScanProgressHistory | null } | null =
  null;
export function clearXmrProgress() {
  cached = null;
}
export function hasXmrProgress(account: unknown) {
  return cached?.account === account;
}
function observation(value: XmrSnapshot, now: number): ScanObservation {
  const p = value.progress;
  const fresh = !!p && now >= p.updatedAt && now - p.updatedAt < 60000;
  return {
    identity: p?.scanId ?? null,
    active: ['SCANNING', 'STALE'].includes(value.state),
    ready:
      value.state === 'READY' &&
      value.wallet?.synced === true &&
      (value.updatedAt === null ||
        (now >= value.updatedAt && now - value.updatedAt < 30000)),
    stale: !fresh && value.state !== 'READY',
    restartRequired: value.state === 'RESTART_REQUIRED',
    blocks: p ? p.height - p.startHeight : null,
    total: p ? p.targetHeight - p.startHeight : null,
  };
}
export function recordXmrProgress(account: unknown, value: XmrSnapshot) {
  const history = cached && cached.account === account ? cached.history : null;
  // Core timestamps change only when native counts change; duplicate polls add no samples.
  const at = value.progress?.updatedAt ?? 0;
  cached = {
    account,
    history: advanceScanProgress(history, observation(value, Date.now()), at),
  };
}
export function xmrProgress(
  account: unknown,
  value: XmrSnapshot | null,
  now: number
) {
  const o = value && observation(value, now);
  const history = cached && cached.account === account ? cached.history : null;
  const p = calculateScanProgress(
    o,
    history,
    now,
    o?.ready ? now : (value?.progress?.updatedAt ?? 0)
  );
  return {
    ...p,
    stalled: p.stalled || !!(o?.active && (o.stale || p.percent === null)),
  };
}
