import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import {
  WalletAmount,
  WalletBalanceCard,
  WalletControls,
  WalletHeader,
  WalletPage,
  WalletTransactions,
} from '../WalletPage';
import { WalletSyncProgress } from '../WalletSyncProgress';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
const wrap = (child: React.ReactNode) => (
  <MemoryRouter>
    <ThemeProviderWrapper>{child}</ThemeProviderWrapper>
  </MemoryRouter>
);

describe('shared wallet presentation', () => {
  it.each(['ARRR', 'XMR', 'BTC'])(
    'places %s scan controls under the balance and keeps the header coin-neutral',
    (ticker) => {
      const { container } = render(
        wrap(
          <WalletPage header={<WalletHeader name={ticker} ticker={ticker} />}>
            <WalletBalanceCard ticker={ticker} address="synthetic-address">
              <WalletAmount
                amount="9007199254740993.000000000001"
                ticker={ticker}
              />
              <WalletControls
                primary={{ label: 'Stop syncing', onClick: () => {} }}
                refresh={{ label: 'Refresh status', onClick: () => {} }}
              />
            </WalletBalanceCard>
            <WalletTransactions>History</WalletTransactions>
          </WalletPage>
        )
      );
      const stop = screen.getByRole('button', { name: 'Stop syncing' });
      expect(stop.closest('[data-wallet-section="balance"]')).not.toBeNull();
      expect(
        container
          .querySelector('[data-wallet-section="header"]')
          ?.contains(stop)
      ).toBe(false);
      expect(
        screen.getByText('9007199254740993.000000000001').parentElement
      ).toHaveTextContent(ticker);
      expect(screen.getByText('Receive ' + ticker)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Transactions' })
      ).toBeInTheDocument();
    }
  );
  it('drops stale ETA and indeterminate activity when the adapter is inactive', () => {
    const props = {
      label: 'Syncing · 50%',
      active: true,
      syncing: true,
      progress: { percent: 50, remainingSeconds: 120, stalled: false },
    };
    const { rerender } = render(wrap(<WalletSyncProgress {...props} />));
    expect(
      screen.getByText(
        /Rough estimate: Estimated time remaining: about 2 minutes/
      )
    ).toBeInTheDocument();
    rerender(
      wrap(
        <WalletSyncProgress
          {...props}
          active={false}
          progress={{ percent: null, remainingSeconds: null, stalled: false }}
        />
      )
    );
    expect(screen.queryByText(/Estimated time remaining/)).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
    rerender(
      wrap(
        <WalletSyncProgress
          {...props}
          progress={{ percent: 50, remainingSeconds: 120, stalled: true }}
        />
      )
    );
    expect(
      screen.getByText(/Last rough estimate:.*about 2 minutes/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Last rough estimate/)).not.toBeNull();
  });
});
