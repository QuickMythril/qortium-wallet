import '../../../i18n/i18n';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { XmrSyncProgress } from '../XmrSyncProgress';
import { XMR_CONTRACT, type XmrSnapshot } from '../../../common/xmrWallet';
afterEach(cleanup);
const value: XmrSnapshot = {
  contract: XMR_CONTRACT,
  state: 'UNAVAILABLE',
  updatedAt: null,
  progress: null,
  wallet: null,
};
const progress = { percent: null, remainingSeconds: null, stalled: true };
it('distinguishes a running overdue scan from an actual scheduled retry', () => {
  const ui = render(
    <XmrSyncProgress
      value={{
        ...value,
        read: { state: 'OVERDUE', phase: 'SYNC', retryAt: null },
      }}
      progress={progress}
      now={100000}
    />
  );
  expect(
    screen.getByText('Waiting for the current scan operation to finish…')
  ).toBeInTheDocument();
  expect(screen.queryByText(/retry/i)).not.toBeInTheDocument();
  ui.rerender(
    <XmrSyncProgress
      value={{
        ...value,
        read: { state: 'RETRY_SCHEDULED', phase: null, retryAt: 110000 },
      }}
      progress={progress}
      now={100000}
    />
  );
  expect(
    screen.getByText('Waiting to retry the wallet update automatically…')
  ).toBeInTheDocument();
});
it('does not invent a balance phase from stale data or a retry for older bridges', () => {
  const ui = render(
    <XmrSyncProgress
      value={{
        ...value,
        state: 'STALE',
        read: { state: 'IN_FLIGHT', phase: 'SYNC', retryAt: null },
      }}
      progress={progress}
      now={100000}
    />
  );
  expect(
    screen.queryByText(/Updating balances and history/)
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Balances and history will refresh/)
  ).not.toBeInTheDocument();
  ui.rerender(
    <XmrSyncProgress value={value} progress={progress} now={100000} />
  );
  expect(screen.getByText('Syncing')).toBeInTheDocument();
  expect(screen.queryByText(/retry/i)).not.toBeInTheDocument();
});
