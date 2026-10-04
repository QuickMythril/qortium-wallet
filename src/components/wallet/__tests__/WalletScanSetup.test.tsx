import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalletScanSetup } from '../WalletScanSetup';

describe('shared wallet scan choices', () => {
  it('requires an unused-address affirmation and validates exact integer restore height', () => {
    const change = vi.fn();
    render(<WalletScanSetup onChange={change} minimumHeight={1} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Wallet scan' }));
    fireEvent.click(
      screen.getByRole('option', { name: 'New wallet — start at current tip' })
    );
    expect(change).toHaveBeenLastCalledWith(null);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'This address has never received funds',
      })
    );
    expect(change).toHaveBeenLastCalledWith({ scanMode: 'NEW_AT_CURRENT_TIP' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Wallet scan' }));
    fireEvent.click(
      screen.getByRole('option', { name: 'Restore from block height' })
    );
    expect(change).toHaveBeenLastCalledWith(null);
    for (const value of ['0', '-1', '1e3', '1.2', '500000001']) {
      fireEvent.change(screen.getByLabelText('Restore height'), {
        target: { value },
      });
      expect(change).toHaveBeenLastCalledWith(null);
    }
    fireEvent.change(screen.getByLabelText('Restore height'), {
      target: { value: '3000000' },
    });
    expect(change).toHaveBeenLastCalledWith({
      scanMode: 'RESTORE_FROM_HEIGHT',
      restoreHeight: 3000000,
    });
  });
});
