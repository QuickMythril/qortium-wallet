import { WalletSendButton } from './WalletPage';
import { requestWalletAction } from '../../common/walletRequest';
import { requestWithArrrBusyRetry } from '../../common/arrrSync';
import {
  describeBridgeError,
  ARRR_READ_CANCELLED_CODE,
  isArrrCustodyConsentDeniedError,
} from '../../common/bridgeErrors';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import type { TxRow } from './TransactionRow';
import { decimalToAtomic } from '../../utils/walletSend';

type Operation = {
  operationId: string;
  state: 'ACCEPTED' | 'NATIVE_STARTED' | 'BROADCAST' | 'FAILED' | 'UNRESOLVED';
  txid: string | null;
};
function operationFrom(value: unknown): Operation {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    v.sendProtocolVersion !== 2 ||
    typeof v.operationId !== 'string' ||
    ![
      'ACCEPTED',
      'NATIVE_STARTED',
      'BROADCAST',
      'FAILED',
      'UNRESOLVED',
    ].includes(String(v.state)) ||
    (v.state === 'BROADCAST' &&
      (typeof v.txid !== 'string' || !/^[0-9a-f]{64}$/.test(v.txid)))
  )
    throw new Error('Unrecognized send status. Do not send again.');
  return {
    operationId: v.operationId,
    state: v.state as Operation['state'],
    txid: v.state === 'BROADCAST' ? String(v.txid) : null,
  };
}
/** Home owns the durable request identity. This view never retries a POST. */
export function ArrrSendPanel({
  enabled,
  ready = true,
  onBroadcast,
  transactions = [],
  receiptScope,
}: {
  enabled: boolean;
  ready?: boolean;
  onBroadcast: () => void;
  transactions?: readonly TxRow[];
  receiptScope?: string;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const dismissalKey = receiptScope
    ? `arrr-dismissed-receipt:${receiptScope}`
    : null;
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return dismissalKey ? localStorage.getItem(dismissalKey) : null;
    } catch {
      return null;
    }
  });
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const consentDenied = useRef(false);
  const reported = useRef<string | null>(null);
  const submittedOperation = useRef<string | null>(null);
  const onBroadcastRef = useRef(onBroadcast);
  onBroadcastRef.current = onBroadcast;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const accept = useCallback((next: Operation, notify = true) => {
    if (!mounted.current) return;
    setOperation(next);
    setAllowed(false);
    if (
      notify &&
      next.state === 'BROADCAST' &&
      reported.current !== next.operationId
    ) {
      reported.current = next.operationId;
      onBroadcastRef.current();
    }
  }, []);
  const check = useCallback(
    async (automatic = false) => {
      if (!enabled || inFlight.current || (automatic && consentDenied.current))
        return;
      inFlight.current = true;
      setBusy(true);
      try {
        const result = (await requestWithArrrBusyRetry(
          () =>
            requestWalletAction({
              action: 'GET_ARRR_SEND_READINESS',
              coin: 'ARRR',
            }),
          { shouldAbort: () => !mounted.current || document.hidden }
        )) as Record<string, unknown>;
        if (!mounted.current) return;
        if (result.sendProtocolVersion !== 2)
          throw new Error('ARRR send requires an updated Home and Core.');
        consentDenied.current = false;
        setError(null);
        if (result.operation) {
          const next = operationFrom(result.operation);
          accept(next, next.operationId === submittedOperation.current);
        } else setOperation(null);
        setAllowed(result.sendAllowed === true);
      } catch (cause) {
        if (mounted.current) {
          if (describeBridgeError(cause).code === ARRR_READ_CANCELLED_CODE)
            return;
          consentDenied.current = isArrrCustodyConsentDeniedError(
            describeBridgeError(cause)
          );
          setAllowed(false);
          setError(
            'Send status is unavailable. Check again before sending; do not repeat a payment whose outcome is unknown.'
          );
        }
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [enabled, accept]
  );
  useEffect(() => {
    setAllowed(false);
    if (enabled) void check(true);
  }, [enabled, ready, check]);
  useEffect(() => {
    if (
      !enabled ||
      !operation ||
      !['ACCEPTED', 'NATIVE_STARTED', 'UNRESOLVED'].includes(operation.state)
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden) void check(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, operation, check]);
  let valid = false;
  try {
    valid =
      /^zs1[023456789acdefghjklmnpqrstuvwxyz]{75}$/.test(recipient) &&
      decimalToAtomic(amount, 8) > 0n &&
      new TextEncoder().encode(memo).length <= 512;
  } catch {
    /* Incomplete form. */
  }
  const send = async () => {
    if (!enabled || !ready || !allowed || !valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setAllowed(false);
    setError(null);
    try {
      const result = await requestWalletAction({
        action: 'SEND_COIN',
        coin: 'ARRR',
        recipient,
        amount,
        ...(operation && ['BROADCAST', 'FAILED'].includes(operation.state)
          ? { acknowledgedOperationId: operation.operationId }
          : {}),
        ...(memo ? { memo } : {}),
      });
      const next = operationFrom(result);
      submittedOperation.current = next.operationId;
      accept(next);
      if (mounted.current) setOpen(false);
    } catch (error) {
      if (mounted.current)
        setError(
          describeBridgeError(error).code === 'ARRR_SEND_NOT_STARTED'
            ? 'The payment was not sent. Check the request, wallet readiness and approval.'
            : 'The send did not return a verified result. Check send status before trying another payment.'
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  // A broadcast receipt proves submission, not confirmation. Only explicit
  // confirmed history for the same transaction can upgrade the display.
  const confirmed =
    operation?.state === 'BROADCAST' &&
    transactions.some(
      (row) => row.txHash === operation.txid && row.pending === false
    );
  const blocked =
    operation != null &&
    ['ACCEPTED', 'NATIVE_STARTED', 'UNRESOLVED'].includes(operation.state);
  const receiptHidden =
    operation?.state === 'BROADCAST' && dismissed === operation.operationId;
  const dismiss = () => {
    if (!confirmed || !operation) return;
    setDismissed(operation.operationId);
    try {
      if (dismissalKey)
        localStorage.setItem(dismissalKey, operation.operationId);
    } catch {
      /* Session-only dismissal when storage is unavailable. */
    }
  };
  return (
    <Box sx={{ mt: 2, width: '100%', maxWidth: 600 }}>
      {operation && !receiptHidden && (
        <Alert
          onClose={confirmed ? dismiss : undefined}
          severity={
            operation.state === 'BROADCAST'
              ? 'success'
              : operation.state === 'FAILED'
                ? 'warning'
                : 'info'
          }
          sx={{ overflowWrap: 'anywhere', mb: 1 }}
        >
          {operation.state === 'BROADCAST'
            ? `${confirmed ? 'Confirmed' : 'Broadcast; awaiting confirmation'}. Transaction: ${operation.txid}`
            : operation.state === 'FAILED'
              ? 'This operation failed before the payment was sent. Check readiness before starting a new payment.'
              : operation.state === 'UNRESOLVED'
                ? 'Outcome unknown. Do not send this payment again. Spending from this wallet, including trade funding, is blocked while it remains unresolved.'
                : 'Payment is being processed. Do not send it again.'}
        </Alert>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <WalletSendButton
        disabled={!enabled || !ready || blocked || busy}
        onClick={() => {
          setRecipient('');
          setAmount('');
          setMemo('');
          setAllowed(false);
          setOpen(true);
          void check();
        }}
        label="Send ARRR"
      />
      <Button disabled={!enabled || busy} onClick={() => void check()}>
        Check send status
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Send ARRR</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Fixed fee: 0.0001 ARRR. Home will ask you to approve the recipient,
            amount, fee and memo before your trusted Core sends the payment.
          </Typography>
          <TextField
            fullWidth
            margin="dense"
            label="Sapling recipient address"
            value={recipient}
            disabled={busy}
            onChange={(e) => setRecipient(e.target.value.trim())}
          />
          <TextField
            fullWidth
            margin="dense"
            label="Amount (ARRR)"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
            inputProps={{ inputMode: 'decimal' }}
          />
          <TextField
            fullWidth
            margin="dense"
            label="Memo (optional)"
            value={memo}
            disabled={busy}
            onChange={(e) => setMemo(e.target.value)}
            helperText={`${new TextEncoder().encode(memo).length}/512 UTF-8 bytes`}
          />
          {busy && (
            <Typography role="status">Checking wallet readiness…</Typography>
          )}
          {!busy && !allowed && !error && (
            <Alert severity="info">
              The wallet is not ready to send yet. Check send status to refresh.
            </Alert>
          )}
          {error && <Alert severity="warning">{error}</Alert>}
          {!busy && !allowed && (
            <Button onClick={() => void check()}>Refresh readiness</Button>
          )}
          <Button disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!enabled || !ready || !allowed || !valid || busy}
            onClick={() => void send()}
          >
            Review in Home
          </Button>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
