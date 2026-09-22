import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useArrrWalletSession,
  notifyArrrWalletSessionChanged,
} from '../useArrrWalletSession';
const snapshot = (relation: string, enabled = true) => ({
  contract: 'qortium-arrr-wallet-session-v1',
  revision: '11111111-1111-1111-1111-111111111111',
  enabled,
  relation,
  lifecycle: 'RUNNING',
  address: null,
});
afterEach(() => {
  delete (globalThis as any).qdnRequest;
  vi.restoreAllMocks();
});
describe('passive ARRR session observation', () => {
  it('never activates another account and refreshes both mounted instances after stop', async () => {
    let enabled = true;
    const request = vi.fn(async () => snapshot('OTHER', enabled));
    (globalThis as any).qdnRequest = request;
    const a = renderHook(() => useArrrWalletSession(true, 'a'));
    const b = renderHook(() => useArrrWalletSession(true, 'b'));
    await waitFor(() => expect(a.result.current.value?.relation).toBe('OTHER'));
    await waitFor(() => expect(b.result.current.value?.relation).toBe('OTHER'));
    expect(a.result.current.active).toBe(false);
    enabled = false;
    act(() => notifyArrrWalletSessionChanged());
    await waitFor(() => expect(a.result.current.value?.enabled).toBe(false));
    await waitFor(() => expect(b.result.current.value?.enabled).toBe(false));
    expect(
      request.mock.calls.every(
        (args) => (args as any)[0].action === 'GET_ARRR_WALLET_SESSION'
      )
    ).toBe(true);
  });
  it('does not display an old account response after an account switch', async () => {
    const resolve: Array<(value: unknown) => void> = [];
    (globalThis as any).qdnRequest = vi.fn(
      () => new Promise((r) => resolve.push(r))
    );
    const { result, rerender } = renderHook(
      ({ account }) => useArrrWalletSession(true, account),
      { initialProps: { account: 'a' } }
    );
    rerender({ account: 'b' });
    await act(async () => {
      resolve[0]({ ...snapshot('SELF'), address: 'zs' + 'a'.repeat(30) });
    });
    expect(result.current.value).toBeNull();
    await act(async () => {
      resolve[1](snapshot('OTHER'));
    });
    expect(result.current.value?.relation).toBe('OTHER');
    expect(result.current.value?.address).toBeNull();
  });
});
