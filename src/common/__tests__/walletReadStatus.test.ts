import { expect, it } from 'vitest';
import {
  projectWalletReadStatus,
  walletReadMessage,
} from '../walletReadStatus';
import { parseXmrSnapshot, XMR_CONTRACT } from '../xmrWallet';
it('keeps generic read diagnostics bounded and optional for older bridges', () => {
  const base = {
    contract: XMR_CONTRACT,
    state: 'UNAVAILABLE',
    send: false,
    wallet: null,
  };
  expect(parseXmrSnapshot(base).read).toBeUndefined();
  const read = { state: 'OVERDUE', phase: 'SYNC', retryAt: null } as const;
  expect(
    parseXmrSnapshot({
      ...base,
      read: { ...read, sessionId: 'private', error: 'native text' },
    }).read
  ).toEqual(read);
  expect(walletReadMessage(read)).toBe(
    'Waiting for the current scan operation to finish…'
  );
  expect(
    walletReadMessage({ state: 'RETRY_SCHEDULED', phase: null, retryAt: 1234 })
  ).toMatch(/retry/);
  for (const bad of [
    { ...read, state: 'BAD' },
    { ...read, phase: 'secret' },
    { ...read, retryAt: 1 },
    { state: 'IDLE', phase: 'SYNC', retryAt: null },
    { state: 'RETRY_SCHEDULED', phase: null, retryAt: -1 },
    { state: ['IDLE'], phase: null, retryAt: null },
    { state: 'OVERDUE', phase: ['SYNC'], retryAt: null },
    { state: null, phase: null, retryAt: null },
  ])
    expect(() => projectWalletReadStatus(bad)).toThrow();
});
