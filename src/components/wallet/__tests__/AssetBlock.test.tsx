import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThemeProviderWrapper from '../../../styles/theme/theme-provider';
import i18n from '../../../i18n/i18n';
import { AssetBlock } from '../AssetBlock';
import type { AssetHolding } from '../../../utils/Types';

// Round 3b: the chain badge moved from an absolutely-positioned corner on
// the circular tile (clipped by the tile's own `overflow: hidden` circle
// crop) to the same spot the old plain-text "qortium"/"qortal" label used
// to occupy, under the asset name - replacing it, not duplicating it.
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

function renderBlock(asset: AssetHolding) {
  return render(
    <MemoryRouter>
      <ThemeProviderWrapper>
        <AssetBlock asset={asset} canSend tileSize={3} />
      </ThemeProviderWrapper>
    </MemoryRouter>
  );
}

describe('AssetBlock chain badge placement (round 3b)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAssetImageUrlMock.mockReset();
    useAssetImageUrlMock.mockReturnValue({ url: null, issuerName: null });
  });

  it('shows exactly one chain badge, under the asset name, with no separate plain-text network label', () => {
    renderBlock(makeAsset('qortium'));

    expect(screen.getAllByTestId('chain-badge-qortium')).toHaveLength(1);
    expect(screen.getByTestId('chain-badge-qortium')).toHaveTextContent(
      'Qortium'
    );
    // The old plain-text label duplicated this as raw lowercase text
    // ('qortium') alongside the badge - it must be gone now that the badge
    // replaces it rather than sitting next to it.
    expect(screen.queryByText('qortium')).not.toBeInTheDocument();

    // The badge sits in the same info column as the asset name (a sibling
    // of the name's own Box, one level down through its centering
    // wrapper) - not inside the circular avatar/image zone above it.
    const nameEl = screen.getByText('CHIP');
    const badgeEl = screen.getByTestId('chain-badge-qortium');
    expect(nameEl.parentElement).toBe(badgeEl.parentElement?.parentElement);
  });

  it('shows the Qortal badge (info token) for a Qortal asset, same placement', () => {
    renderBlock(makeAsset('qortal', { assetId: 11, name: 'SILVER' }));

    expect(screen.getAllByTestId('chain-badge-qortal')).toHaveLength(1);
    expect(screen.getByTestId('chain-badge-qortal')).toHaveTextContent(
      'Qortal'
    );
    expect(screen.queryByText('qortal')).not.toBeInTheDocument();
  });

  it('renders the resolved image when useAssetImageUrl returns a data: URL, badge still separate from it', () => {
    useAssetImageUrlMock.mockReturnValue({
      url: 'data:image/png;base64,AAAA',
      issuerName: 'chip-issuer',
    });
    const { container } = renderBlock(makeAsset('qortium'));

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');

    const badge = screen.getByTestId('chain-badge-qortium');
    // The image is a leaf node; confirming it isn't the badge's ancestor is
    // the same "not nested inside the avatar" guarantee as the null-image
    // case above - the img and the badge are siblings under different
    // parents entirely.
    expect(img!.contains(badge)).toBe(false);
    expect(badge.contains(img)).toBe(false);
  });
});
