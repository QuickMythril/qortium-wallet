import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import i18n from '../../../i18n/i18n';
import { UnifiedHistory } from '../UnifiedHistory';
import type { ChainConfig } from '../../../config/chains';
import {
  __resetPendingSendsForTests,
  addPendingSend,
  __tickPendingSendsForTests,
} from '../../../common/pendingSends';

// Round 4, item A: pending sends only showed on the coin page (CoinDetail);
// the unified "All Transactions" history rendered nothing for them. This
// covers the fix - a pending entry shows a row at the top of the unified
// list, and it disappears (with no duplicate) once the confirmation poll
// sees it land.

const { qortChain, chainsFixture } = vi.hoisted(() => {
  const qortChain: ChainConfig = {
    key: 'QORT',
    name: 'Qortal',
    ticker: 'QORT',
    coinEnum: 'QORT' as any,
    route: 'qort',
    defaultFee: 0.001,
    isNative: true,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: false,
    supportsLocalChainTrades: false,
  };
  // A single stable array reference - a fresh literal per render would make
  // useUnifiedHistory's effect think the chain list changed every render
  // and re-fetch forever (the CoinGrid-hang gotcha applies here too).
  const chainsFixture: ChainConfig[] = [qortChain];
  return { qortChain, chainsFixture };
});

vi.mock('qapp-core', () => ({
  useAuth: () => ({ address: 'qort-user-address', name: 'testuser' }),
}));

vi.mock('../../../hooks/useSupportedChains', () => ({
  useSupportedChains: () => ({
    chains: chainsFixture,
    status: 'live',
    walletAuthorityReady: true,
  }),
}));

function renderHistory() {
  return render(
    <MemoryRouter initialEntries={['/history']}>
      <UnifiedHistory />
    </MemoryRouter>
  );
}

const flushMicrotasks = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe('UnifiedHistory pending sends', () => {
  let qortalRequestMock: ReturnType<typeof vi.fn>;
  let confirmed: boolean;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();
    __resetPendingSendsForTests();

    confirmed = false;
    qortalRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_USER_ACCOUNT':
          return { address: 'qort-wallet-address' };
        case 'GET_BALANCE':
          return '10';
        case 'SEARCH_TRANSACTIONS':
          if (opts.confirmationStatus === 'BOTH' && confirmed) {
            return [
              {
                signature: 'sig-abc',
                recipient: 'qort-recipient-address',
                amount: '1.25',
                fee: '0.001',
                timestamp: Date.now(),
                blockHeight: 500,
              },
            ];
          }
          // The unified history fetch itself (confirmationStatus: CONFIRMED)
          // - nothing confirmed yet from the chain's own point of view.
          return [];
        default:
          return null;
      }
    });
    (globalThis as any).qortalRequest = qortalRequestMock;
    (globalThis as any).qdnRequest = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (globalThis as any).qortalRequest;
    delete (globalThis as any).qdnRequest;
    __resetPendingSendsForTests();
  });

  it('renders a pending row for a tracked send, then removes it (no duplicate) once confirmed', async () => {
    addPendingSend({
      account: 'qort-user-address',
      chain: qortChain,
      txHash: 'sig-abc',
      totalAmount: -125000000,
      recipient: 'qort-recipient-address',
      sender: 'qort-wallet-address',
    });

    renderHistory();
    await flushMicrotasks();

    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/pending confirmation/i)).toHaveLength(1);

    // Now let the shared poller see the confirmation.
    confirmed = true;
    await act(async () => {
      await __tickPendingSendsForTests();
    });
    await flushMicrotasks();

    expect(screen.queryByText(/pending confirmation/i)).not.toBeInTheDocument();
  });

  it('renders nothing pending when there is no tracked entry', async () => {
    renderHistory();
    await flushMicrotasks();
    expect(screen.queryByText(/pending confirmation/i)).not.toBeInTheDocument();
  });
});
