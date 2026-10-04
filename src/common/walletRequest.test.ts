import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureWalletRequests,
  requestWalletAction,
  walletRequestValue,
  WALLET_REQUEST_CONTRACT,
} from './walletRequest';
import { requestWithTimeout } from './functions';

afterEach(() => {
  configureWalletRequests([]);
  vi.unstubAllGlobals();
});
const advertise = (coin = 'XMR') =>
  configureWalletRequests([
    {
      currencyCode: coin,
      homeWallet: { requestContract: WALLET_REQUEST_CONTRACT },
    },
  ]);

describe('versioned wallet transport', () => {
  it('uses legacy requests unless the current host advertises the exact contract', () => {
    const request = { action: 'STOP_XMR_WALLET', coin: 'XMR' };
    expect(walletRequestValue(request)).toBe(request);
    configureWalletRequests([
      {
        currencyCode: 'XMR',
        homeWallet: { requestContract: 'future-contract' },
      },
    ]);
    expect(walletRequestValue(request)).toBe(request);
    advertise();
    expect(walletRequestValue(request)).toEqual({
      action: 'WALLET_REQUEST',
      coin: 'XMR',
      operation: 'stop',
    });
    configureWalletRequests([]);
    expect(walletRequestValue(request)).toBe(request);
  });
  it('maps money strings exactly and does not grant other coins a generic capability', () => {
    advertise('ARRR');
    const request = {
      action: 'SEND_COIN',
      coin: 'ARRR',
      recipient: 'synthetic-address',
      amount: '9007199254740993',
      memo: 'hello',
    };
    expect(walletRequestValue(request)).toEqual({
      action: 'WALLET_REQUEST',
      coin: 'ARRR',
      operation: 'send',
      parameters: {
        recipient: 'synthetic-address',
        amount: '9007199254740993',
        memo: 'hello',
      },
    });
    const xmr = { action: 'GET_XMR_WALLET', coin: 'XMR', passive: true };
    expect(walletRequestValue(xmr)).toBe(xmr);
  });
  it('dispatches once and preserves an unknown send failure without fallback or replay', async () => {
    advertise();
    const failure = Object.assign(new Error('Outcome unknown'), {
      code: 'XMR_SEND_UNKNOWN',
    });
    const dispatch = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal('qdnRequest', dispatch);
    await expect(
      requestWalletAction({
        action: 'COMMIT_XMR_SEND',
        coin: 'XMR',
        handle: 'synthetic-handle',
      })
    ).rejects.toBe(failure);
    expect(dispatch.mock.calls).toEqual([
      [
        {
          action: 'WALLET_REQUEST',
          coin: 'XMR',
          operation: 'send-commit',
          parameters: { handle: 'synthetic-handle' },
        },
      ],
    ]);
  });
  it('uses the same selected contract for timeout-wrapped reads and leaves unrelated requests alone', async () => {
    advertise('BTC');
    const dispatch = vi.fn().mockResolvedValue('9007199254740993');
    vi.stubGlobal('qdnRequest', dispatch);
    expect(
      await requestWithTimeout(
        {
          action: 'GET_WALLET_BALANCE',
          coin: 'BTC',
          verified: true,
        } as QdnRequestOptions,
        20
      )
    ).toBe('9007199254740993');
    expect(dispatch).toHaveBeenCalledWith({
      action: 'WALLET_REQUEST',
      coin: 'BTC',
      operation: 'balance',
      parameters: { verified: true },
    });
    const unrelated = { action: 'GET_ACCOUNT_DATA', address: 'public-account' };
    expect(walletRequestValue(unrelated)).toBe(unrelated);
  });
});
