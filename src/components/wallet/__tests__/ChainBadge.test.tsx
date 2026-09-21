import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import i18n from '../../../i18n/i18n';
import { ChainBadge } from '../ChainBadge';

describe('ChainBadge', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the Qortium label for a qortium asset', () => {
    render(
      <ChainBadge network="qortium" assetId={1} issuerName="TiumIssuer" />
    );
    expect(screen.getByTestId('chain-badge-qortium')).toHaveTextContent(
      'Qortium'
    );
    expect(screen.queryByText('Qortal')).not.toBeInTheDocument();
  });

  it('renders the Qortal label for a qortal asset', () => {
    render(
      <ChainBadge network="qortal" assetId={11} issuerName="SilverIssuer" />
    );
    expect(screen.getByTestId('chain-badge-qortal')).toHaveTextContent(
      'Qortal'
    );
    expect(screen.queryByText('Qortium')).not.toBeInTheDocument();
  });

  it('renders even without an issuer name, so a placeholder alone still distinguishes the chain', () => {
    render(<ChainBadge network="qortal" assetId={5} issuerName={null} />);
    expect(screen.getByTestId('chain-badge-qortal')).toHaveTextContent(
      'Qortal'
    );
  });

  it('tooltip mentions the asset id and known issuer', () => {
    render(
      <ChainBadge network="qortium" assetId={2} issuerName="ChipIssuer" />
    );
    // MUI's Tooltip (describeChild=false, the default) puts a string title
    // straight onto the child as aria-label, regardless of hover/open state
    // - assert via that rather than simulating a hover, which is flaky here.
    const badge = screen.getByTestId('chain-badge-qortium');
    expect(badge).toHaveAttribute(
      'aria-label',
      expect.stringContaining('ChipIssuer')
    );
    expect(badge.getAttribute('aria-label')).toContain('2');
  });

  it('tooltip falls back to "unknown issuer" when the issuer is not resolved', () => {
    render(<ChainBadge network="qortal" assetId={9} issuerName={null} />);
    const badge = screen.getByTestId('chain-badge-qortal');
    expect(badge).toHaveAttribute(
      'aria-label',
      expect.stringContaining('unknown issuer')
    );
  });
});
