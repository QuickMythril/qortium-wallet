import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button', { name: 'Send ARRR' }));
    fireEvent.change(screen.getByLabelText('Sapling recipient address'), {
      target: { value: 'zs1' + 'a'.repeat(75) },
    });
    fireEvent.change(screen.getByLabelText('Amount (ARRR)'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review in Home' }));
    await screen.findByText(/Payment is being processed/);
    expect(
      calls.find((c) => c.action === 'SEND_COIN')?.acknowledgedOperationId
    ).toBe(receipt.operationId);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
  });
});
