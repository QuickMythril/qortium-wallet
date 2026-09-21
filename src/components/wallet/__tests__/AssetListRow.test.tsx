import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { AssetListRow } from '../AssetListRow';
import type { AssetHolding } from '../../../utils/Types';

const useAssetImageUrlMock = vi.fn();
vi.mock('../../../hooks/useAssetImageUrl', () => ({
  useAssetImageUrl: (...args: unknown[]) => useAssetImageUrlMock(...args),
}));

function makeAsset(
  network: AssetHolding['network'],
  overrides: Partial<AssetHolding> = {}
): AssetHolding {
  return {
    network,
    assetId: 2,
    name: 'CHIP',
    owner: 'QissuerAddress',
    quantity: '1000000000',
    isDivisible: true,
    isOwnerForSale: false,
    balance: '100000000',
    pinned: false,
    ...overrides,
  };
}

function renderRow(asset: AssetHolding) {
  return render(
    <MemoryRouter>
      <ThemeProviderWrapper>
        <AssetListRow asset={asset} canSend />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

describe('AssetListRow chain badge placement (round 3b)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAssetImageUrlMock.mockReset();
    useAssetImageUrlMock.mockReturnValue({ url: null, issuerName: null });
  });

  it('shows exactly one chain badge under the asset name, with no separate plain-text network label', () => {
    renderRow(makeAsset('qortium'));

    expect(screen.getAllByTestId('chain-badge-qortium')).toHaveLength(1);
    expect(screen.getByTestId('chain-badge-qortium')).toHaveTextContent(
      'Qortium'
    );
    // The row used to show "QORTIUM ASSET #2" as one plain-text line - the
    // badge replaces the network part of that, so the bare uppercase
    // network word must not appear as its own text node any more.
    expect(screen.queryByText('QORTIUM')).not.toBeInTheDocument();
    expect(screen.getByText('ASSET #2')).toBeInTheDocument();
  });

  it('shows the Qortal badge for a Qortal asset, same placement', () => {
    renderRow(makeAsset('qortal', { assetId: 11, name: 'SILVER' }));

    expect(screen.getAllByTestId('chain-badge-qortal')).toHaveLength(1);
    expect(screen.getByTestId('chain-badge-qortal')).toHaveTextContent(
      'Qortal'
    );
    expect(screen.queryByText('QORTAL')).not.toBeInTheDocument();
  });

  it('the badge is not nested inside the circular avatar image element', () => {
    useAssetImageUrlMock.mockReturnValue({
      url: 'data:image/png;base64,AAAA',
      issuerName: 'chip-issuer',
    });
    const { container } = renderRow(makeAsset('qortium'));

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    const badge = screen.getByTestId('chain-badge-qortium');
    expect(img!.contains(badge)).toBe(false);
    expect(badge.contains(img)).toBe(false);
  });
});
