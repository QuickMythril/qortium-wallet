import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import i18n from '../../../i18n/i18n';
import {
  ArrrSyncControls,
  ARRR_SYNC_CONTROL_CONTRACT,
} from '../ArrrSyncControls';
import type { UseArrrSyncStatusResult } from '../../../hooks/useArrrSyncStatus';
import { parseArrrSyncSnapshot } from '../../../common/arrrSync';

function status(state = 'SYNCHRONIZING'): UseArrrSyncStatusResult {
  return {
    snapshot: parseArrrSyncSnapshot({
      state,
      ready: state === 'READY',
      stale: false,
      restartRequired: false,
      observedAt: Date.now(),
    }),
    loading: false,
    error: null,
    consentDenied: false,
    refresh: vi.fn(),
    progress: { percent: 10, remainingSeconds: 500, stalled: false },
  };
}
const result = (start = false) => ({
  contract: ARRR_SYNC_CONTROL_CONTRACT,
  coin: 'ARRR',
  scope: 'node',
  completed: true,
  enabled: start,
  operation: start ? 'start' : 'stop',
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  delete (globalThis as any).qdnRequest;
});
describe('ARRR sync controls', () => {
  it('asks Home to stop once, waits for its acknowledgement and refreshes status', async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    (globalThis as any).qdnRequest = request;
    const refresh = vi.fn();
    render(<ArrrSyncControls status={status()} onChanged={refresh} />);
    const button = screen.getByRole('button', { name: 'Stop syncing' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      action: 'STOP_ARRR_SYNC',
      coin: 'ARRR',
    });
    expect(
      screen.queryByText('ARRR controller stopped.')
    ).not.toBeInTheDocument();
    resolve(result());
    await waitFor(() =>
      expect(screen.getByText('ARRR controller stopped.')).toBeInTheDocument()
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('starts a disabled controller without claiming wallet readiness', async () => {
    const request = vi.fn().mockResolvedValue(result(true));
    (globalThis as any).qdnRequest = request;
    render(
      <ArrrSyncControls status={status('DISABLED')} onChanged={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start syncing' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'ARRR controller started. Checking wallet sync status…'
        )
      ).toBeInTheDocument()
    );
    expect(request).toHaveBeenCalledWith({
      action: 'START_ARRR_SYNC',
      coin: 'ARRR',
    });
  });
  it.each([false, { accepted: true }, { ...result(), enabled: true }])(
    'never treats a malformed result as success: %j',
    async (reply) => {
      (globalThis as any).qdnRequest = vi.fn().mockResolvedValue(reply);
      render(<ArrrSyncControls status={status()} onChanged={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check stop completion' })
        ).toBeInTheDocument()
      );
      expect(
        screen.queryByText('ARRR controller stopped.')
      ).not.toBeInTheDocument();
    }
  );
  it('an unconfirmed stop does not become Start merely because Core is disabled', async () => {
    const request = vi.fn().mockRejectedValue({
      code: 'ARRR_SYNC_CONTROL_FAILED',
      message: 'Stop completion unconfirmed.',
    });
    (globalThis as any).qdnRequest = request;
    const { rerender } = render(
      <ArrrSyncControls status={status()} onChanged={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    await screen.findByText('Stop completion unconfirmed.');
    rerender(
      <ArrrSyncControls status={status('DISABLED')} onChanged={vi.fn()} />
    );
    expect(
      screen.getByRole('button', { name: 'Check stop completion' })
    ).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('ignores a reply after account/route unmount', async () => {
    let resolve!: (value: unknown) => void;
    (globalThis as any).qdnRequest = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const refresh = vi.fn();
    const view = render(
      <ArrrSyncControls status={status()} onChanged={refresh} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop syncing' }));
    view.unmount();
    resolve(result());
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
  });
});
