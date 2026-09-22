import { MemoryRouter } from 'react-router-dom';
import { Provider, createStore } from 'jotai';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { walletReadyAtom } from '../../../state/global/system';
import { AssetDetail } from '../AssetDetail';

vi.mock('react-qr-code', () => ({ default: () => null }));

function renderDetail(store: ReturnType<typeof createStore>) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <ThemeProviderWrapper>
          <AssetDetail assetId={42} />
        </ThemeProviderWrapper>
      </MemoryRouter>
    </Provider>
  );
}

describe('AssetDetail asset reads', () => {
  let qdnRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');

    qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_ASSET_INFO':
          expect(opts).toMatchObject({ assetId: 42 });
          return {
            assetId: 42,
            owner: 'Qissuer',
            name: 'GOLD',
            quantity: '1000000000000',
            isDivisible: true,
            isUnspendable: false,
            creationGroupId: 0,
            isOwnerForSale: false,
          };
        case 'GET_USER_WALLET':
          return { address: 'Qholder' };
        case 'GET_ASSET_BALANCES':
          expect(opts).toMatchObject({
            address: 'Qholder',
            assetId: 42,
            limit: 0,
          });
          return [{ address: 'Qholder', assetId: 42, balance: '500000000' }];
        case 'GET_ASSET_TRANSFERS':
          expect(opts).toMatchObject({
            assetId: 42,
            address: 'Qholder',
            limit: 20,
            reverse: true,
          });
          return [];
        case 'SHOW_ACTIONS':
          return ['TRANSFER_ASSET'];
        default:
          return null;
      }
    });

    (globalThis as any).qdnRequest = qdnRequestMock;
  });

  it('loads asset info, balance, and transfers via the named actions, not FETCH_NODE_API', async () => {
    const store = createStore();
    store.set(walletReadyAtom, true);
    renderDetail(store);

    await waitFor(() => expect(screen.getByText('GOLD')).toBeInTheDocument());
    await waitFor(() =>
      expect(
        qdnRequestMock.mock.calls.some(
          ([opts]) => opts.action === 'GET_ASSET_BALANCES'
        )
      ).toBe(true)
    );

    expect(
      qdnRequestMock.mock.calls.some(
        ([opts]) => opts.action === 'FETCH_NODE_API'
      )
    ).toBe(false);
  });
});

describe('AssetDetail unlock gating', () => {
  it('unlocks before sending a qortium asset even when SHOW_ACTIONS omits UNLOCK_SELECTED_ACCOUNT', async () => {
    await i18n.changeLanguage('en');

    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_ASSET_INFO':
          return {
            assetId: 42,
            owner: 'Qissuer',
            name: 'GOLD',
            quantity: '1000000000000',
            isDivisible: true,
            isUnspendable: false,
            creationGroupId: 0,
            isOwnerForSale: false,
          };
        case 'GET_USER_WALLET':
          return { address: 'Qholder' };
        case 'GET_ASSET_BALANCES':
          return [{ address: 'Qholder', assetId: 42, balance: '500000000' }];
        case 'GET_ASSET_TRANSFERS':
          return [];
        // A Home build advertising TRANSFER_ASSET without listing
        // UNLOCK_SELECTED_ACCOUNT - the scenario the qortium override covers.
        case 'SHOW_ACTIONS':
          return ['TRANSFER_ASSET'];
        case 'UNLOCK_SELECTED_ACCOUNT':
          return { isUnlocked: true };
        case 'TRANSFER_ASSET':
          return { accepted: true };
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const user = userEvent.setup();
    const store = createStore();
    store.set(walletReadyAtom, true);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ThemeProviderWrapper>
            <AssetDetail assetId={42} />
          </ThemeProviderWrapper>
        </MemoryRouter>
      </Provider>
    );

    await user.click(await screen.findByRole('button', { name: /^send$/i }));
    await user.type(screen.getByLabelText(/amount \(GOLD\)/i), '1.5');
    await user.type(screen.getByLabelText(/recipient address/i), 'Qrecipient');
    await user.click(screen.getByRole('button', { name: /confirm send/i }));

    await waitFor(() =>
      expect(
        qdnRequestMock.mock.calls.some(
          ([opts]) => opts.action === 'TRANSFER_ASSET'
        )
      ).toBe(true)
    );
    expect(qdnRequestMock).toHaveBeenCalledWith({
      action: 'UNLOCK_SELECTED_ACCOUNT',
    });

    delete (globalThis as any).qdnRequest;
  });
});

describe('AssetDetail chain badge (round 3b)', () => {
  it('shows the chain badge in the header, separate from the letter-avatar circle, with no leftover plain-text network label', async () => {
    await i18n.changeLanguage('en');

    const qdnRequestMock = vi.fn(async (opts: Record<string, unknown>) => {
      switch (opts.action) {
        case 'GET_ASSET_INFO':
          return {
            assetId: 42,
            owner: 'Qissuer',
            name: 'GOLD',
            quantity: '1000000000000',
            isDivisible: true,
            isUnspendable: false,
            creationGroupId: 0,
            isOwnerForSale: false,
          };
        case 'GET_USER_WALLET':
          return { address: 'Qholder' };
        case 'GET_ASSET_BALANCES':
          return [{ address: 'Qholder', assetId: 42, balance: '500000000' }];
        case 'GET_ASSET_TRANSFERS':
          return [];
        case 'SHOW_ACTIONS':
          return ['TRANSFER_ASSET'];
        case 'GET_PRIMARY_NAME':
          return 'gold-issuer';
        case 'FETCH_QDN_RESOURCE':
          return ''; // no avatar published - irrelevant to this test
        default:
          return null;
      }
    });
    (globalThis as any).qdnRequest = qdnRequestMock;

    const store = createStore();
    store.set(walletReadyAtom, true);
    render(
      <Provider store={store}>
        <MemoryRouter>
          <ThemeProviderWrapper>
            <AssetDetail assetId={42} />
          </ThemeProviderWrapper>
        </MemoryRouter>
      </Provider>
    );

    const badge = await screen.findByTestId('chain-badge-qortium');
    expect(badge).toHaveTextContent('Qortium');
    expect(screen.getAllByTestId('chain-badge-qortium')).toHaveLength(1);

    // The header's small letter-avatar circle is a separate, aria-hidden
    // element - the badge must not be nested inside it.
    const avatarCircle = document.querySelector('[aria-hidden="true"]');
    expect(avatarCircle).not.toBeNull();
    expect(avatarCircle!.contains(badge)).toBe(false);

    // No separate lowercase "qortium" text node duplicating the badge.
    expect(screen.queryByText('qortium')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('asset-issuer-line')).toHaveTextContent(
        'gold-issuer'
      )
    );

    delete (globalThis as any).qdnRequest;
  });
});
