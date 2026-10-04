import type { ChainConfig } from '../config/chains';
export const XMR_STOP_CONTRACT = 'qortium-home-xmr-stop-v1';
export const XMR_CONTRACT = 'qortium-home-xmr-custody-v1';
export type XmrTx = {
  txid: string;
  timestamp: number | null;
  confirmed: boolean;
  incomingAtomic: string | null;
  outgoingAtomic: string | null;
  feeAtomic: string | null;
};
export type XmrScanProgress = {
  scanId: string;
  startHeight: number;
  height: number;
  targetHeight: number;
  updatedAt: number;
};
export type XmrSnapshot = {
  contract: typeof XMR_CONTRACT;
  state: string;
  updatedAt: number | null;
  progress: XmrScanProgress | null;
  preparation?: XmrScanProgress;
  scanStart?: { mode: string; height: number };
  scanStartError?: string;
  wallet: null | {
    address: string;
    height: number;
    targetHeight: number;
    synced: boolean;
    balanceAtomic: string | null;
    unlockedAtomic: string | null;
    transactions: XmrTx[];
  };
};
export function supportsXmr(chain: ChainConfig) {
  const c = chain.homeWallet;
  return (
    chain.coinEnum === 'XMR' &&
    chain.decimalPlaces === 12 &&
    chain.activeNetwork === 'MAIN' &&
    c?.contract === 'qortium-home-wallet-v1' &&
    c.custodyContract === XMR_CONTRACT &&
    c.implemented === true &&
    c.protocol === 'qdnRequest' &&
    ((c.send === false && c.sendMode === 'NONE') ||
      (c.send === true &&
        c.sendMode === 'TRUSTED_CORE_CUSTODY' &&
        c.sendContract === 'qortium-home-xmr-send-v1')) &&
    c.serverManagement === false &&
    c.requiresUnlockedAccount === true &&
    ((c.read === true &&
      c.receive === true &&
      c.readMode === 'TRUSTED_CORE_CUSTODY' &&
      c.receiveMode === 'TRUSTED_CORE_CUSTODY') ||
      (c.read === false &&
        c.receive === false &&
        c.readMode === 'NONE' &&
        c.receiveMode === 'NONE'))
  );
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max = 500000000): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
function atomic(v: unknown): string | null {
  if (v === null) return null;
  if (
    typeof v !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(v) ||
    BigInt(v) > 18446744073709551615n
  )
    throw Error('Invalid XMR amount');
  return v;
}
export function formatXmr(v: string | null) {
  if (v === null) return 'Not yet available';
  atomic(v);
  const n = BigInt(v);
  return `${n / 1000000000000n}.${(n % 1000000000000n).toString().padStart(12, '0')}`;
}
const states = new Set([
  'INACTIVE',
  'SWITCHING',
  'CLEANUP_REQUIRED',
  'IDLE',
  'OPENING',
  'CLOSING',
  'ACTIVATION_REJECTED',
  'SCANNING',
  'READY',
  'UNAVAILABLE',
  'STALE',
  'RESTART_REQUIRED',
  'STOPPED',
]);
export function parseXmrSnapshot(v: unknown): XmrSnapshot {
  if (
    !record(v) ||
    v.contract !== XMR_CONTRACT ||
    v.send !== false ||
    !states.has(String(v.state))
  )
    throw Error('Invalid XMR contract');
  if (v.updatedAt != null && !integer(v.updatedAt, 8640000000000000))
    throw Error('Invalid XMR observation time');
  let progress: XmrScanProgress | null = null;
  if (v.progress != null) {
    const p = v.progress;
    if (
      !record(p) ||
      typeof p.scanId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        p.scanId
      ) ||
      !integer(p.startHeight) ||
      !integer(p.height) ||
      !integer(p.targetHeight) ||
      p.targetHeight <= 0 ||
      p.startHeight > p.height ||
      p.height > p.targetHeight ||
      !integer(p.updatedAt, 8640000000000000)
    )
      throw Error('Invalid XMR scan progress');
    progress = {
      scanId: p.scanId,
      startHeight: p.startHeight,
      height: p.height,
      targetHeight: p.targetHeight,
      updatedAt: p.updatedAt,
    };
  }
  const extra: Pick<
    XmrSnapshot,
    'scanStart' | 'preparation' | 'scanStartError'
  > = {};
  if (v.scanStart != null) {
    const start = v.scanStart;
    if (
      !record(start) ||
      !integer(start.height) ||
      !['RESUME', 'RESTORE_FROM_HEIGHT', 'NEW_AT_CURRENT_TIP'].includes(
        String(start.mode)
      )
    )
      throw Error('Invalid scan start');
    extra.scanStart = { mode: String(start.mode), height: start.height };
  }
  if (v.scanStartError != null) {
    if (
      ![
        'XMR_EXISTING_WALLET',
        'XMR_RESTORE_HEIGHT_MISMATCH',
        'XMR_RESTORE_HEIGHT_ABOVE_TIP',
        'XMR_DAEMON_UNAVAILABLE',
      ].includes(String(v.scanStartError))
    )
      throw Error('Invalid scan error');
    extra.scanStartError = String(v.scanStartError);
  }
  if (v.preparation != null) {
    const p = v.preparation;
    if (
      !record(p) ||
      typeof p.scanId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(p.scanId) ||
      !integer(p.startHeight) ||
      !integer(p.height) ||
      !integer(p.targetHeight) ||
      p.startHeight > p.height ||
      p.height >= p.targetHeight ||
      !integer(p.updatedAt, 8640000000000000)
    )
      throw Error('Invalid preparation progress');
    extra.preparation = {
      scanId: p.scanId,
      startHeight: p.startHeight,
      height: p.height,
      targetHeight: p.targetHeight,
      updatedAt: p.updatedAt,
    };
  }
  const base = {
    ...extra,
    contract: XMR_CONTRACT as typeof XMR_CONTRACT,
    state: String(v.state),
    updatedAt: (v.updatedAt ?? null) as number | null,
    progress,
  };
  if (v.wallet === null) return { ...base, wallet: null };
  const w = v.wallet;
  if (
    !record(w) ||
    typeof w.address !== 'string' ||
    !/^4[1-9A-HJ-NP-Za-km-z]{94}$/.test(w.address) ||
    !integer(w.height) ||
    !integer(w.targetHeight) ||
    typeof w.synced !== 'boolean' ||
    !Array.isArray(w.transactions) ||
    w.transactions.length > 100
  )
    throw Error('Invalid XMR wallet');
  const transactions = w.transactions
    .map((t): XmrTx => {
      if (
        !record(t) ||
        typeof t.txid !== 'string' ||
        !/^[a-f0-9]{64}$/.test(t.txid) ||
        typeof t.confirmed !== 'boolean' ||
        !(t.timestamp === null || integer(t.timestamp, 8640000000000))
      )
        throw Error('Invalid XMR history');
      return {
        txid: t.txid,
        timestamp: t.timestamp as number | null,
        confirmed: t.confirmed,
        incomingAtomic: atomic(t.incomingAtomic),
        outgoingAtomic: atomic(t.outgoingAtomic),
        feeAtomic: atomic(t.feeAtomic),
      };
    })
    .sort(
      (a, b) =>
        (b.timestamp ?? -1) - (a.timestamp ?? -1) ||
        a.txid.localeCompare(b.txid)
    );
  if (new Set(transactions.map((t) => t.txid)).size !== transactions.length)
    throw Error('Duplicate XMR history');
  return {
    ...base,
    wallet: {
      address: w.address,
      height: w.height,
      targetHeight: w.targetHeight,
      synced: w.synced,
      balanceAtomic: atomic(w.balanceAtomic),
      unlockedAtomic: atomic(w.unlockedAtomic),
      transactions,
    },
  };
}
