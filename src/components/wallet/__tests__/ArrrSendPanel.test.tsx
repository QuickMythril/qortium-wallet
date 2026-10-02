import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrrSendPanel } from '../ArrrSendPanel';
import { cleanup } from '@testing-library/react';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('ARRR durable send view', () => {
  it('shows the fixed fee and submits once, retaining unknown outcome for status lookup', async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'qdnRequest',
      vi.fn(async (request: Record<string, unknown>) => {
        calls.push(request);
        if (request.action === 'SEND_COIN') throw new Error('lost reply');
        return { sendProtocolVersion: 2, sendAllowed: true };
      })
    );
    render(<ArrrSendPanel enabled onBroadcast={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send ARRR' });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(screen.getByText(/Fixed fee: 0.0001 ARRR/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sapling recipient address'), {
      target: { value: 'zs1' + 'a'.repeat(75) },
    });
    fireEvent.change(screen.getByLabelText('Amount (ARRR)'), {
      target: { value: '1.25' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review in Home' })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review in Home' }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/did not return a verified result/).length
      ).toBeGreaterThan(0)
    );
    expect(calls.filter((c) => c.action === 'SEND_COIN')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Review in Home' })
    ).toBeDisabled();
  });
  it('updates broadcast confirmation only from explicit matching confirmed history', async () => {
    const txid = 'ab'.repeat(32);
    const bridge = vi.fn(async () => ({
      sendProtocolVersion: 2,
      sendAllowed: true,
      operation: {
        sendProtocolVersion: 2,
        operationId: 'receipt',
        state: 'BROADCAST',
        txid,
      },
    }));
    vi.stubGlobal('qdnRequest', bridge);
    const onBroadcast = vi.fn();
    const view = render(<ArrrSendPanel enabled onBroadcast={onBroadcast} />);
    await screen.findByText(/Broadcast; awaiting confirmation/);
    for (const transactions of [
      [{ txHash: txid, pending: true }],
      [{ txHash: txid }],
      [{ txHash: 'cd'.repeat(32), pending: false }],
    ]) {
      view.rerender(
        <ArrrSendPanel
          enabled
          onBroadcast={onBroadcast}
          transactions={transactions}
        />
      );
      expect(
        screen.getByText(/Broadcast; awaiting confirmation/)
      ).toBeInTheDocument();
    }
    view.rerender(
      <ArrrSendPanel
        enabled
        onBroadcast={onBroadcast}
        transactions={[{ txHash: txid, pending: false }]}
      />
    );
    expect(
      screen.getByText(`Confirmed. Transaction: ${txid}`)
    ).toBeInTheDocument();
    expect(onBroadcast).not.toHaveBeenCalled();
    expect(bridge).toHaveBeenCalledTimes(1);
  });
  it('dismisses only a confirmed receipt across remounts while retaining its new-send acknowledgement', async () => {
    const receipt = {
      sendProtocolVersion: 2,
      operationId: 'retained',
      state: 'BROADCAST',
      txid: 'ab'.repeat(32),
    };
    const bridge = vi.fn(async (req: Record<string, unknown>) =>
      req.action === 'SEND_COIN'
        ? { ...receipt, operationId: 'new', state: 'ACCEPTED', txid: null }
        : { sendProtocolVersion: 2, sendAllowed: true, operation: receipt }
    );
    vi.stubGlobal('qdnRequest', bridge);
    const props = {
      enabled: true,
      receiptScope: 'account-a',
      onBroadcast: vi.fn(),
      transactions: [{ txHash: receipt.txid, pending: false }],
    };
    const first = render(<ArrrSendPanel {...props} />);
    await screen.findByText(/Confirmed. Transaction/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      screen.queryByText(/Confirmed. Transaction/)
    ).not.toBeInTheDocument();
    first.unmount();
    render(<ArrrSendPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send ARRR' })).toBeEnabled()
    );
    expect(
      screen.queryByText(/Confirmed. Transaction/)
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    fireEvent.change(screen.getByLabelText('Sapling recipient address'), {
      target: { value: 'zs1' + 'a'.repeat(75) },
    });
    fireEvent.change(screen.getByLabelText('Amount (ARRR)'), {
      target: { value: '1' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review in Home' })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review in Home' }));
    await screen.findByText(/Payment is being processed/);
    expect(
      bridge.mock.calls.find(([req]) => req.action === 'SEND_COIN')?.[0]
        .acknowledgedOperationId
    ).toBe('retained');
  });
  it('checks readiness on Send after a startup failure without posting a payment', async () => {
    const bridge = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue({ sendProtocolVersion: 2, sendAllowed: true });
    vi.stubGlobal('qdnRequest', bridge);
    render(<ArrrSendPanel enabled onBroadcast={() => {}} />);
    await screen.findByText(/Send status is unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText(/Send status is unavailable/)
      ).not.toBeInTheDocument()
    );
    expect(
      bridge.mock.calls.every(
        ([req]) => req.action === 'GET_ARRR_SEND_READINESS'
      )
    ).toBe(true);
  });
  it('does not automatically reopen denied custody when readiness changes', async () => {
    const bridge = vi.fn().mockRejectedValue({
      code: 'PERMISSION_DENIED',
      message: 'Account access was denied.',
    });
    vi.stubGlobal('qdnRequest', bridge);
    const view = render(
      <ArrrSendPanel enabled ready={false} onBroadcast={() => {}} />
    );
    await screen.findByText(/Send status is unavailable/);
    view.rerender(<ArrrSendPanel enabled ready onBroadcast={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledTimes(2));
  });
  it('refreshes balances once when a locally submitted pending send later broadcasts', async () => {
    let operation: Record<string, unknown> | null = null;
    const onBroadcast = vi.fn();
    vi.stubGlobal(
      'qdnRequest',
      vi.fn(async (req: Record<string, unknown>) => {
        if (req.action === 'SEND_COIN') {
          operation = {
            sendProtocolVersion: 2,
            operationId: 'local-send',
            state: 'ACCEPTED',
            txid: null,
          };
          return operation;
        }
        return { sendProtocolVersion: 2, sendAllowed: !operation, operation };
      })
    );
    render(<ArrrSendPanel enabled onBroadcast={onBroadcast} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send ARRR' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    fireEvent.change(screen.getByLabelText('Sapling recipient address'), {
      target: { value: 'zs1' + 'a'.repeat(75) },
    });
    fireEvent.change(screen.getByLabelText('Amount (ARRR)'), {
      target: { value: '1' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review in Home' })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review in Home' }));
    await screen.findByText(/Payment is being processed/);
    expect(onBroadcast).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    operation = {
      sendProtocolVersion: 2,
      operationId: 'local-send',
      state: 'BROADCAST',
      txid: 'ab'.repeat(32),
    };
    fireEvent.click(screen.getByRole('button', { name: 'Check send status' }));
    await screen.findByText(/Broadcast; awaiting confirmation/);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check send status' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Check send status' })
      ).toBeEnabled()
    );
    expect(onBroadcast).toHaveBeenCalledTimes(1);
  });
  it('unresolved operation blocks send and never triggers another payment', async () => {
    const bridge = vi.fn(async () => ({
      sendProtocolVersion: 2,
      operation: {
        sendProtocolVersion: 2,
        operationId: 'operation',
        state: 'UNRESOLVED',
        txid: null,
      },
    }));
    vi.stubGlobal('qdnRequest', bridge);
    render(<ArrrSendPanel enabled onBroadcast={() => {}} />);
    await screen.findByText(/Outcome unknown/);
    expect(
      screen.queryByRole('button', { name: 'Close' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send ARRR' })).toBeDisabled();
    expect(bridge).toHaveBeenCalledTimes(1);
  });
  it('recovers while syncing is unavailable and acknowledges a retained broadcast before a new payment', async () => {
    const calls: Record<string, unknown>[] = [];
    const onBroadcast = vi.fn();
    const receipt = {
      sendProtocolVersion: 2,
      operationId: '123e4567-e89b-12d3-a456-426614174000',
      state: 'BROADCAST',
      txid: 'ab'.repeat(32),
    };
    vi.stubGlobal(
      'qdnRequest',
      vi.fn(async (request: Record<string, unknown>) => {
        calls.push(request);
        return request.action === 'SEND_COIN'
          ? { ...receipt, state: 'ACCEPTED', txid: null }
          : { sendProtocolVersion: 2, sendAllowed: true, operation: receipt };
      })
    );
    const view = render(
      <ArrrSendPanel enabled ready={false} onBroadcast={onBroadcast} />
    );
    await screen.findByText(/Broadcast; awaiting confirmation/);
    expect(screen.getByRole('button', { name: 'Send ARRR' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Check send status' })
    ).toBeEnabled();
    view.rerender(<ArrrSendPanel enabled ready onBroadcast={onBroadcast} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send ARRR' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    fireEvent.change(screen.getByLabelText('Sapling recipient address'), {
      target: { value: 'zs1' + 'a'.repeat(75) },
    });
    fireEvent.change(screen.getByLabelText('Amount (ARRR)'), {
      target: { value: '1' },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Review in Home' })
      ).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review in Home' }));
    await screen.findByText(/Payment is being processed/);
    expect(
      calls.find((c) => c.action === 'SEND_COIN')?.acknowledgedOperationId
    ).toBe(receipt.operationId);
    expect(onBroadcast).not.toHaveBeenCalled();
  });
});
