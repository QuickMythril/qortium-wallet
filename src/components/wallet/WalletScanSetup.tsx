import { useEffect, useState } from 'react';
import {
  Box,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { WalletScanStart } from '../../common/walletScanStart';
/** Shared first-use choices. The host approves the choice; Core preserves existing checkpoints. */
export function WalletScanSetup({
  disabled,
  minimumHeight = 0,
  onChange,
}: {
  disabled?: boolean;
  minimumHeight?: number;
  onChange: (choice: WalletScanStart | null) => void;
}) {
  useEffect(() => {
    onChange({ scanMode: 'RESUME' });
  }, [onChange]);
  const [mode, setMode] = useState<WalletScanStart['scanMode']>('RESUME');
  const [height, setHeight] = useState('');
  const [unused, setUnused] = useState(false);
  const update = (
    nextMode: WalletScanStart['scanMode'],
    nextHeight: string,
    nextUnused: boolean
  ) => {
    if (nextMode === 'NEW_AT_CURRENT_TIP')
      onChange(nextUnused ? { scanMode: nextMode } : null);
    else if (nextMode === 'RESTORE_FROM_HEIGHT') {
      const number = Number(nextHeight);
      onChange(
        /^(0|[1-9][0-9]*)$/.test(nextHeight) &&
          Number.isSafeInteger(number) &&
          number >= minimumHeight &&
          number <= 500000000
          ? { scanMode: nextMode, restoreHeight: number }
          : null
      );
    } else onChange({ scanMode: nextMode });
  };
  return (
    <Box sx={{ my: 2 }}>
      <TextField
        select
        label="Wallet scan"
        fullWidth
        size="small"
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value as WalletScanStart['scanMode'];
          setMode(next);
          update(next, height, unused);
        }}
      >
        <MenuItem value="RESUME">Resume saved progress</MenuItem>
        <MenuItem value="RESTORE_FROM_HEIGHT">
          Restore from block height
        </MenuItem>
        <MenuItem value="NEW_AT_CURRENT_TIP">
          New wallet — start at current tip
        </MenuItem>
      </TextField>
      {mode === 'RESTORE_FROM_HEIGHT' && (
        <TextField
          label="Restore height"
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          value={height}
          disabled={disabled}
          inputProps={{ inputMode: 'numeric' }}
          helperText="Choose a block before your first receipt. Existing wallets keep their saved scan start."
          onChange={(event) => {
            setHeight(event.target.value);
            update(mode, event.target.value, unused);
          }}
        />
      )}
      {mode === 'NEW_AT_CURRENT_TIP' && (
        <>
          <FormControlLabel
            control={
              <Checkbox
                checked={unused}
                disabled={disabled}
                onChange={(event) => {
                  setUnused(event.target.checked);
                  update(mode, height, event.target.checked);
                }}
              />
            }
            label="This address has never received funds"
          />
          <Typography variant="body2">
            Older receipts will not be discovered. Home will ask you to approve
            this choice.
          </Typography>
        </>
      )}
    </Box>
  );
}
