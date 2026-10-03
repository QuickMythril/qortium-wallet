import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { XmrSendPanel } from '../XmrSendPanel';
const contract = 'qortium-home-xmr-send-v1';
const handle = '11111111-1111-1111-1111-111111111111';
const quote = {
  contract,
  handle,
  state: 'PREPARED',
  recipient: '4'.repeat(95),
  amountAtomic: '9007199254740993',
  feeAtomic: '123456789',
  expiresAt: Date.now() + 120000,
  walletHeld: true,
  canCancelPreparation: true,
};
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('automatically recovers, displays exact fee, and sends only on explicit approval click', async () => {
  const request = vi.fn(async ({ action }) =>
    action === 'PREPARE_XMR_SEND'
      ? quote
      : action === 'COMMIT_XMR_SEND'
        ? { ...quote, state: 'BROADCAST', txid: 'a'.repeat(64) }
        : { contract, handle: null, state: 'NONE', walletHeld: false }
  );
  vi.stubGlobal('qdnRequest', request);
  render(<XmrSendPanel ready account="A" />);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'GET_XMR_SEND_STATUS', passive: true })
    )
  );
  fireEvent.click(screen.getByText('Send XMR'));
  await waitFor(() =>
    expect(screen.getByLabelText('Recipient XMR address')).not.toBeDisabled()
  );
  fireEvent.change(screen.getByLabelText('Recipient XMR address'), {
    target: { value: quote.recipient },
  });
  fireEvent.change(screen.getByLabelText('Amount (XMR)'), {
    target: { value: '9007.199254740993' },
  });
  fireEvent.click(screen.getByText('Review network fee'));
  await screen.findByText('Network fee: 0.000123456789 XMR');
  expect(
    request.mock.calls.filter(([r]) => r.action === 'COMMIT_XMR_SEND')
  ).toHaveLength(0);
  fireEvent.click(screen.getByText('Approve and send'));
  await screen.findByText(/Broadcast; awaiting confirmation/);
  expect(
    request.mock.calls.filter(([r]) => r.action === 'COMMIT_XMR_SEND')
  ).toHaveLength(1);
});
it('confirmation dismissal survives remount without clearing Home recovery record', async () => {
  const request = vi.fn<({ action }: { action: string }) => Promise<unknown>>(
    async () => ({
      ...quote,
      state: 'CONFIRMED',
      walletHeld: false,
      confirmations: 10,
    })
  );
  vi.stubGlobal('qdnRequest', request);
  const first = render(<XmrSendPanel ready account="A" />);
  fireEvent.click(await screen.findByText('Dismiss confirmation'));
  first.unmount();
  render(<XmrSendPanel ready account="A" />);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Dismiss confirmation')).toBeNull();
  expect(
    request.mock.calls.every(([r]) => r.action === 'GET_XMR_SEND_STATUS')
  ).toBe(true);
});
it('old account reply cannot create controls in replacement instance', async () => {
  let resolve!: (v: unknown) => void;
  vi.stubGlobal(
    'qdnRequest',
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
      .mockResolvedValue({
        contract,
        handle: null,
        state: 'NONE',
        walletHeld: false,
      })
  );
  const view = render(<XmrSendPanel key="A" ready account="A" />);
  view.rerender(<XmrSendPanel key="B" ready account="B" />);
  resolve(quote);
  await waitFor(() => expect(screen.getAllByText('Send XMR')).toHaveLength(1));
  expect(screen.queryByText('Approve and send')).toBeNull();
});
