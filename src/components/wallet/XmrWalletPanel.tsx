import { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import _QRCode from 'react-qr-code';
import type { ChainConfig } from '../../config/chains';
import { isSelectedAccountChangedMessage } from '../../common/accountChangedMessage';
import { describeBridgeError } from '../../common/bridgeErrors';
import {
  formatXmr,
  parseXmrSnapshot,
  supportsXmr,
  type XmrSnapshot,
} from '../../common/xmrWallet';
import { copyToClipboard } from '../../common/functions';
const QRCode =
  (_QRCode as unknown as { default?: typeof _QRCode }).default ?? _QRCode;

/** No keys or persisted wallet data. Requests are serialized, and old account replies are discarded. */
export function XmrWalletPanel({ chain }: { chain: ChainConfig }) {
  const { address: account } = useAuth();
  const navigate = useNavigate();
  const enabled = supportsXmr(chain);
  const [revision, setRevision] = useState(0);
  const [request, setRequest] = useState({
    action: 'GET_XMR_WALLET',
    passive: false,
    account,
    revision: 0,
  });
  const [state, setState] = useState<{
    account: unknown;
    revision: number;
    value: XmrSnapshot | null;
    error: string | null;
    locked: boolean;
    busy: boolean;
  }>({
    account,
    revision,
    value: null,
    error: null,
    locked: false,
    busy: true,
  });
  const generation = useRef(0);
  const consumedRequest = useRef<unknown>(null);
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const lane = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      setRevision((n) => n + 1);
      setRequest((r) => ({
        action: 'GET_XMR_WALLET',
        passive: true,
        account: null,
        revision: r.revision + 1,
      }));
    };
    const message = (event: MessageEvent) => {
      if (isSelectedAccountChangedMessage(event)) invalidate();
    };
    window.addEventListener('message', message);
    window.addEventListener('qortiumBridgeStateChanged', invalidate);
    return () => {
      window.removeEventListener('message', message);
      window.removeEventListener('qortiumBridgeStateChanged', invalidate);
    };
  }, []);
  useEffect(() => {
    const id = ++generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    if (!enabled) return;
    const poll = async (action = 'GET_XMR_WALLET', passive = true) => {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      clearTimeout(timer);
      const work = lane.current
        .catch(() => {})
        .then(async () => {
          if (id !== generation.current) return;
          setState((old) => ({
            account,
            revision,
            value:
              old.account === account && old.revision === revision
                ? old.value
                : null,
            error: null,
            locked: false,
            busy: true,
          }));
          const response = await qdnRequest({
            action,
            coin: 'XMR',
            ...(action === 'GET_XMR_WALLET' ? { passive } : {}),
          });
          if (id !== generation.current) return;
          const value = parseXmrSnapshot(response);
          setState({
            account,
            revision,
            value,
            error: null,
            locked: false,
            busy: false,
          });
          if (
            ['OPENING', 'SCANNING', 'READY', 'SWITCHING', 'CLOSING'].includes(
              value.state
            )
          )
            timer = setTimeout(() => void poll(), 5000);
        });
      lane.current = work;
      try {
        await work;
      } catch (error) {
        if (id !== generation.current) return;
        stopped = true; // Polls never reopen a declined or expired approval.
        const code = describeBridgeError(error).code;
        const locked = code === 'ACCOUNT_LOCKED';
        setState((old) => ({
          account,
          revision,
          value:
            code === 'XMR_READ_APPROVAL_REQUIRED' &&
            old.account === account &&
            old.revision === revision
              ? old.value
              : null,
          error:
            code === 'XMR_READ_APPROVAL_REQUIRED'
              ? 'Automatic updates are paused. Refresh status to approve wallet reads.'
              : locked
                ? 'Unlock the selected account to use its XMR wallet.'
                : 'XMR access paused. Check the local Core and wallet approval, then refresh.',
          locked,
          busy: false,
        }));
      } finally {
        inFlight = false;
      }
    };
    const freshRequest =
      consumedRequest.current !== request && request.account === account;
    consumedRequest.current = request;
    void poll(
      freshRequest ? request.action : 'GET_XMR_WALLET',
      freshRequest ? request.passive : true
    );
    const visible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      generation.current++;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [account, revision, request, enabled]);
  const current =
    state.account === account && state.revision === revision ? state : null;
  const value = current?.value;
  const wallet = value?.wallet;
  const refresh = (action = 'GET_XMR_WALLET') =>
    setRequest((r) => ({
      action,
      passive: false,
      account,
      revision: r.revision + 1,
    }));
  const unlock = async () => {
    const unlockAccount = account;
    try {
      await qdnRequest({ action: 'UNLOCK_SELECTED_ACCOUNT' });
      if (currentAccount.current === unlockAccount) refresh();
    } catch {
      /* Explicit retry remains available. */
    }
  };
  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Button onClick={() => navigate('/')}>Back to wallets</Button>
      <Typography variant="h4" component="h1" sx={{ my: 2 }}>
        Monero (XMR)
      </Typography>
      {!enabled ? (
        <Typography>
          XMR requires desktop Home and an enabled, supported local Core wallet.
        </Typography>
      ) : (
        <>
          <Typography sx={{ mb: 2 }}>
            Receive and view XMR. Sending is not available yet.
          </Typography>
          {current?.error && (
            <Typography role="alert" sx={{ mb: 2 }}>
              {current.error}
            </Typography>
          )}
          {current?.locked && (
            <Button onClick={() => void unlock()}>Unlock account</Button>
          )}
          <Button disabled={current?.busy} onClick={() => refresh()}>
            Refresh status
          </Button>
          {(!value ||
            ['INACTIVE', 'IDLE', 'STOPPED', 'ACTIVATION_REJECTED'].includes(
              value.state
            )) &&
            !current?.locked && (
              <Button
                disabled={!current || current.busy}
                variant="contained"
                onClick={() => refresh('ACTIVATE_XMR_WALLET')}
              >
                Activate this wallet
              </Button>
            )}
          <Typography role="status" sx={{ my: 2 }}>
            {current?.busy && !value
              ? 'Loading XMR wallet…'
              : value?.state === 'CLEANUP_REQUIRED'
                ? 'A previous wallet session still needs cleanup. Check the local Core, then refresh. Activation is paused.'
                : value?.state === 'RESTART_REQUIRED'
                  ? 'The XMR wallet worker needs a Core restart.'
                  : value?.state === 'INACTIVE'
                    ? 'Activate this wallet to begin scanning. The first scan starts at block zero.'
                    : value?.state === 'ACTIVATION_REJECTED'
                      ? 'Activation did not complete. Check the local Core and retry.'
                      : wallet?.synced && value?.state === 'READY'
                        ? current?.error
                          ? 'Last known status: synced (updates paused)'
                          : 'Synced'
                        : value
                          ? 'Wallet status: ' +
                            value.state.toLowerCase().replace(/_/g, ' ')
                          : ''}
          </Typography>
          {wallet && (
            <>
              {value?.state !== 'READY' && value?.state !== 'SCANNING' && (
                <Typography role="alert">
                  This is the last recorded wallet snapshot. Balances and
                  history may be out of date.
                </Typography>
              )}
              <Typography variant="h6">Receive XMR</Typography>
              <Box
                sx={{
                  background: '#fff',
                  p: 2,
                  display: 'inline-block',
                  my: 2,
                }}
              >
                <QRCode value={wallet.address} size={192} />
              </Box>
              <Typography sx={{ overflowWrap: 'anywhere', mb: 1 }}>
                {wallet.address}
              </Typography>
              <Button onClick={() => void copyToClipboard(wallet.address)}>
                Copy address
              </Button>
              <Typography sx={{ mt: 3 }}>
                Balance: {formatXmr(wallet.balanceAtomic)}
                {wallet.balanceAtomic === null ? '' : ' XMR'}
              </Typography>
              <Typography>
                Unlocked: {formatXmr(wallet.unlockedAtomic)}
                {wallet.unlockedAtomic === null ? '' : ' XMR'}
              </Typography>
              <Typography sx={{ my: 2 }}>
                Scan: {wallet.height.toLocaleString()} /{' '}
                {wallet.targetHeight.toLocaleString()} blocks
                {!wallet.synced ? ' — balances may be incomplete' : ''}
              </Typography>
              <Typography variant="h6">Recent transactions</Typography>
              {!wallet.transactions.length && (
                <Typography>
                  No transactions found in the scanned history.
                </Typography>
              )}
              {wallet.transactions.map((tx) => (
                <Box
                  key={tx.txid}
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    py: 2,
                    overflowWrap: 'anywhere',
                  }}
                >
                  <Typography>
                    {tx.confirmed ? 'Confirmed' : 'Pending'} ·{' '}
                    {tx.timestamp === null
                      ? 'Time unavailable'
                      : new Date(tx.timestamp * 1000).toLocaleString()}
                  </Typography>
                  <Typography>
                    Received: {formatXmr(tx.incomingAtomic)} · Sent:{' '}
                    {formatXmr(tx.outgoingAtomic)}
                  </Typography>
                  <Typography variant="body2">{tx.txid}</Typography>
                </Box>
              ))}
              <Typography variant="body2" sx={{ mt: 2 }}>
                Up to 100 recent transactions.
              </Typography>
            </>
          )}
        </>
      )}
    </Box>
  );
}
