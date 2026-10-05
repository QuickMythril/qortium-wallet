import { describe, it, expect } from 'vitest';
import {
  readWalletDisplay,
  writeWalletDisplay,
  clearWalletDisplay,
  retainWalletDisplay,
  walletDisplayEpoch,
} from '../walletDisplay';
describe('shared display retention', () => {
  it('preserves missing observations, accepts real zeros and empty history, and fences accounts', () => {
    expect(retainWalletDisplay(10, null)).toBe(10);
    expect(retainWalletDisplay(10, 0)).toBe(0);
    expect(retainWalletDisplay(['old'], [])).toEqual([]);
    for (const coin of ['ARRR', 'XMR']) {
      writeWalletDisplay(coin, 'owner-A', { balance: 0, transactions: [] });
      expect(readWalletDisplay(coin, 'owner-A')).toEqual({
        balance: 0,
        transactions: [],
      });
      expect(readWalletDisplay(coin, 'owner-B')).toBeNull();
      clearWalletDisplay(coin);
      expect(readWalletDisplay(coin, 'owner-A')).toBeNull();
    }
  });
});

it('drops cache on a host change even with no mounted wallet hook', () => {
  writeWalletDisplay('XMR', 'A', 'private');
  window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
  expect(readWalletDisplay('XMR', 'A')).toBeNull();
});

it('rejects a late observation captured before host invalidation', () => {
  const before = walletDisplayEpoch();
  window.dispatchEvent(new Event('qortiumBridgeStateChanged'));
  writeWalletDisplay('ARRR', 'A', 'old', before);
  expect(readWalletDisplay('ARRR', 'A')).toBeNull();
});
