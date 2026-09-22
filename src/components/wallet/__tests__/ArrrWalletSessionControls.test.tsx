import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/i18n';
import { ArrrWalletSessionControls } from '../ArrrWalletSessionControls';
import {
  ARRR_WALLET_SESSION_CONTRACT,
  type ArrrWalletSession,
} from '../../../common/arrrWalletSession';
const value: ArrrWalletSession = {
  contract: ARRR_WALLET_SESSION_CONTRACT,
  revision: '11111111-1111-1111-1111-111111111111',
  enabled: true,
  relation: 'OTHER',
  lifecycle: 'RUNNING',
  address: null,
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  delete (globalThis as any).qdnRequest;
});
describe('explicit ARRR account activation', () => {
  it('requires a click, binds the observed revision and never auto-retries a conflict', async () => {
    const request = vi.fn(async () => {
      throw new Error('ARRR session changed');
    });
    (globalThis as any).qdnRequest = request;
    render(
      <ArrrWalletSessionControls
        session={{ value, active: false, error: null, refresh: vi.fn() }}
      />
    );
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Switch to this account' })
    );
    await screen.findByText('ARRR session changed');
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: 'ACTIVATE_ARRR_WALLET',
      coin: 'ARRR',
      expectedRevision: value.revision,
    });
  });
  it('retains an actionable refresh and recovery explanation for degraded Core', () => {
    const refresh = vi.fn();
    render(
      <ArrrWalletSessionControls
        session={{
          value: { ...value, lifecycle: 'DEGRADED' },
          active: false,
          error: null,
          refresh,
        }}
      />
    );
    expect(
      screen.getByText(/Restart Qortium Core in Home/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Stop syncing' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('waits for confirmation before allowing duplicate activation', async () => {
    let resolve!: (v: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    (globalThis as any).qdnRequest = request;
    render(
      <ArrrWalletSessionControls
        session={{ value, active: false, error: null, refresh: vi.fn() }}
      />
    );
    const button = screen.getByRole('button', {
      name: 'Switch to this account',
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(request).toHaveBeenCalledOnce();
    resolve({ ...value, relation: 'SELF' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Switch to this account' })
      ).toBeEnabled()
    );
  });
});
