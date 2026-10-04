import { WalletSendButton } from './WalletPage';
import { requestWalletAction } from '../../common/walletRequest';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import { formatXmr } from '../../common/xmrWallet';
import {
  parseXmrSend,
  terminalXmrSend,
  type XmrSendView,
} from '../../common/xmrSend';

/** Parent keys this component by account and bridge revision. No authority or payment persistence. */
export function XmrSendPanel({
  ready,
  account,
}: {
  ready: boolean;
  account: string;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [value, setValue] = useState<XmrSendView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const active = useRef(false);
  const generation = useRef(0);
  const [verified, setVerified] = useState(false);
  const key = `xmr-dismissed:${account}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const request = async (action: string, passive = false) => {
    if (active.current || !alive.current) return;
    const epoch = generation.current;
    const current = () => alive.current && generation.current === epoch;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await requestWalletAction({
        action,
        coin: 'XMR',
        ...(action === 'PREPARE_XMR_SEND'
          ? { recipient, amount }
          : action === 'GET_XMR_SEND_STATUS'
            ? { passive }
            : { handle: value?.handle }),
      });
      const next = parseXmrSend(response);
      if (current()) {
        setVerified(true);
        setValue(next);
        if (next.state === 'PREPARED') setOpen(true);
      }
    } catch {
      if (current()) setVerified(false);
      if (current() && !passive)
        setError(
          'XMR access did not complete. Check the existing operation before trying another payment.'
        );
    } finally {
      active.current = false;
      if (current()) setBusy(false);
    }
  };
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++;
    alive.current = true;
    return () => {
      lifecycle.current++;
      alive.current = false;
    };
  }, []);
  // Readiness gates new work/polling; an already approved request retains its account lifetime.
  useEffect(() => {
    if (ready) void latest.current('GET_XMR_SEND_STATUS', true);
    const timer = setInterval(() => {
      if (ready && !document.hidden)
        void latest.current('GET_XMR_SEND_STATUS', true);
    }, 6000);
    return () => clearInterval(timer);
  }, [ready]);
  const shown =
    value &&
    value.state !== 'NONE' &&
    !(value.state === 'CONFIRMED' && value.handle === dismissed);
  const canPrepare =
    ready &&
    verified &&
    value !== null &&
    terminalXmrSend(value.state) &&
    !value.walletHeld;
  const dismiss = () => {
    if (value?.handle) {
      setDismissed(value.handle);
      try {
        localStorage.setItem(key, value.handle);
      } catch {
        /* display only */
      }
    }
  };
  const label =
    value?.state === 'UNKNOWN' || value?.state === 'STATUS_REQUIRED'
      ? 'Outcome needs checking. Do not send this payment again.'
      : value?.state === 'BROADCAST'
        ? 'Broadcast; awaiting confirmation.'
        : value?.state === 'CONFIRMED_WAIT'
          ? `Confirmed (${value.confirmations ?? 0}/10); waiting for unlocked inputs.`
          : value?.state === 'CONFIRMED'
            ? 'Confirmed.'
            : value?.state === 'PREPARED'
              ? 'Transaction prepared. Review the exact fee before approving.'
              : value?.state.toLowerCase().replace(/_/g, ' ');
  return (
    <Box sx={{ my: 3 }}>
      <WalletSendButton
        disabled={!ready || busy}
        onClick={() => {
          setOpen(true);
          void request('GET_XMR_SEND_STATUS');
        }}
        label="Send XMR"
      />
      {shown && (
        <Typography role="status" sx={{ overflowWrap: 'anywhere' }}>
          {label}
          {value.txid ? ` Transaction: ${value.txid}` : ''}
        </Typography>
      )}
      {shown && value.state === 'CONFIRMED' && (
        <Button onClick={dismiss}>Dismiss confirmation</Button>
      )}
      {value?.walletHeld && terminalXmrSend(value.state) && (
        <Typography role="status">
          An earlier XMR payment still needs recovery. Status is checked
          automatically; further spending waits for confirmation and unlocked
          inputs.
        </Typography>
      )}
      {error && <Typography role="alert">{error}</Typography>}
      {open && (
        <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
          <TextField
            label="Recipient XMR address"
            value={recipient}
            disabled={!canPrepare || busy}
            onChange={(e) => setRecipient(e.target.value)}
          />
          <TextField
            label="Amount (XMR)"
            value={amount}
            disabled={!canPrepare || busy}
            onChange={(e) => setAmount(e.target.value)}
            inputProps={{ inputMode: 'decimal' }}
          />
          <Button
            disabled={!canPrepare || busy || !recipient || !amount}
            onClick={() => void request('PREPARE_XMR_SEND')}
          >
            Review network fee
          </Button>
          {value?.state === 'PREPARED' && (
            <>
              <Typography sx={{ overflowWrap: 'anywhere' }}>
                Recipient: {value.recipient}
              </Typography>
              <Typography>
                Amount: {formatXmr(value.amountAtomic ?? null)} XMR
              </Typography>
              <Typography>
                Network fee: {formatXmr(value.feeAtomic ?? null)} XMR
              </Typography>
              <Button
                variant="contained"
                disabled={
                  busy || !ready || (value.expiresAt ?? 0) <= Date.now()
                }
                onClick={() => void request('COMMIT_XMR_SEND')}
              >
                Approve and send
              </Button>
            </>
          )}
          {value?.handle && value.canCancelPreparation === true && (
            <Button
              disabled={busy}
              onClick={() => void request('CANCEL_XMR_SEND')}
            >
              Cancel preparation
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => void request('GET_XMR_SEND_STATUS')}
          >
            Refresh send status
          </Button>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </Box>
      )}
    </Box>
  );
}
