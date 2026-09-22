import fs from 'node:fs';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionRow, type TxRow } from '../TransactionRow';
import type { ChainConfig } from '../../../config/chains';

vi.mock('../../../hooks/useCoinImageUrl', () => ({
  useCoinImageUrl: () => undefined,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const chain = {
  ticker: 'ARRR',
  decimalPlaces: 8,
  key: 'ARRR',
  coinEnum: 'ARRR',
} as ChainConfig;
function show(row: TxRow) {
  render(
    <TransactionRow
      row={row}
      index={0}
      isLastRow
      chain={chain}
      userAddress="mine"
      expanded
      onToggleExpand={() => {}}
      copiedHash={null}
      onCopyHash={() => {}}
    />
  );
}
afterEach(cleanup);

describe('partial ARRR history', () => {
  it('shows unknown amount and fee without inventing zero', () => {
    show({
      txHash: 'pending',
      totalAmount: null,
      feeAmount: null,
      pending: true,
      metadataComplete: false,
      inputs: [
        { address: 'incoming-party', amount: 100, addressInWallet: false },
      ],
    });
    expect(screen.getByText('Amount unavailable')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText(/0\.00000000 ARRR/)).toBeNull();
    expect(screen.getByText('Counterparty')).toBeTruthy();
    expect(screen.queryByText('From')).toBeNull();
    expect(screen.queryByText('To')).toBeNull();
    expect(screen.queryByText(/^to /)).toBeNull();
    expect(
      screen.getByText('transaction_status.pending_confirmation')
    ).toBeTruthy();
    expect(
      screen.getByText(/Recovered recipients may be incomplete/)
    ).toBeTruthy();
  });
  it('labels amount and fee estimates', () => {
    show({
      txHash: 'restored',
      totalAmount: null,
      totalAmountEstimate: -100000000,
      feeAmount: null,
      feeAmountEstimate: 10000,
      metadataComplete: false,
    });
    expect(screen.getByText('Estimated -1.00000000 ARRR')).toBeTruthy();
    expect(screen.getByText('Estimated 0.00010000 ARRR')).toBeTruthy();
  });
  it('keeps known zero distinct from unknown', () => {
    show({ totalAmount: 0, feeAmount: 10000, metadataComplete: true });
    expect(screen.getByText('0.00000000 ARRR')).toBeTruthy();
    expect(screen.queryByText('Amount unavailable')).toBeNull();
  });
  it.runIf(Boolean(process.env.ARRR_HISTORY_FIXTURE))(
    'renders Core wire output after the Home whitelist',
    () => {
      const rows: TxRow[] = JSON.parse(
        fs.readFileSync(process.env.ARRR_HISTORY_FIXTURE!, 'utf8')
      );
      expect(rows).toHaveLength(3);
      show(rows[0]);
      expect(screen.getByText('Amount unavailable')).toBeTruthy();
      expect(
        screen.getByText('transaction_status.pending_confirmation')
      ).toBeTruthy();
      cleanup();
      show(rows[1]);
      expect(screen.getByText('Estimated -1.00000000 ARRR')).toBeTruthy();
      expect(screen.getByText('Estimated 0.00010000 ARRR')).toBeTruthy();
      cleanup();
      show(rows[2]);
      expect(screen.getByText('-0.00000100 ARRR')).toBeTruthy();
    }
  );
});
