import { formatXmr } from './xmrWallet';
export const XMR_SEND_CONTRACT = 'qortium-home-xmr-send-v1';
export type XmrSendView = {
  contract: typeof XMR_SEND_CONTRACT;
  handle: string | null;
  state: string;
  canCancelPreparation?: boolean;
  recipient?: string | null;
  amountAtomic?: string | null;
  feeAtomic?: string | null;
  txid?: string | null;
  walletHeld: boolean;
  expiresAt?: number | null;
  confirmations?: number;
};
export const terminalXmrSend = (state: string) =>
  ['NONE', 'CANCELLED', 'EXPIRED', 'PREPARE_FAILED', 'CONFIRMED'].includes(
    state
  );
export function parseXmrSend(v: unknown): XmrSendView {
  const p = v as XmrSendView | null;
  if (
    !p ||
    p.contract !== XMR_SEND_CONTRACT ||
    ![
      'NONE',
      'STATUS_REQUIRED',
      'PREPARING',
      'PREPARED',
      'CANCELLED',
      'EXPIRED',
      'PREPARE_FAILED',
      'RELAYING',
      'BROADCAST',
      'UNKNOWN',
      'CONFIRMED_WAIT',
      'CONFIRMED',
    ].includes(p.state) ||
    typeof p.walletHeld !== 'boolean' ||
    (p.state === 'NONE'
      ? p.handle !== null
      : typeof p.handle !== 'string' ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.handle))
  )
    throw Error('Invalid XMR operation. Check status before sending again.');
  for (const value of [p.amountAtomic, p.feeAtomic])
    if (value !== null && value !== undefined) {
      if (typeof value !== 'string') throw Error('Invalid XMR amount');
      formatXmr(value);
    }
  if (
    p.txid != null &&
    (typeof p.txid !== 'string' || !/^[a-f0-9]{64}$/.test(p.txid))
  )
    throw Error('Invalid XMR transaction');
  if (
    p.state === 'PREPARED' &&
    (!p.recipient ||
      !p.amountAtomic ||
      !p.feeAtomic ||
      !Number.isSafeInteger(p.expiresAt))
  )
    throw Error('Incomplete XMR quote');
  return p;
}
