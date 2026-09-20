import { Box } from '@mui/material';
import { useEffect, useContext } from 'react';
import { Outlet } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import walletContext, { IContextProps } from './contexts/walletContext';
import { useAuth } from 'qapp-core';
import { useIframe } from './hooks/useIframeListener';
import { TopBar } from './components/layout/TopBar';
import { tokens } from './theme/tokens';
import { useColors } from './theme/ColorTokensContext';
import { EMPTY_STRING, TIME_MINUTES_1 } from './common/constants';
import { walletReadyAtom } from './state/global/system';
import { useMarketPricesPoller } from './hooks/useMarketPricesPoller';
import { usePaymentNotifications } from './hooks/usePaymentNotifications';
import { isUnlockedResult } from './common/walletBridge';
import {
  invalidateCachedAccountUnlocked,
  setCachedAccountUnlocked,
} from './common/accountUnlockState';

export default function AppLayout() {
  useIframe();
  useMarketPricesPoller();
  usePaymentNotifications();
  const c = useColors();

  const { setWalletState } = useContext(walletContext);
  const { address, avatarUrl, name, authenticateUser } = useAuth();
  const setWalletReady = useSetAtom(walletReadyAtom);

  // Home fires SELECTED_ACCOUNT_CHANGED when the user switches accounts or
  // locks/unlocks one; re-authenticate so balances and names follow suit.
  useEffect(() => {
    function onMessage(e: MessageEvent<unknown>) {
      if (
        (e.source === window.parent || e.source === window) &&
        typeof e.data === 'object' &&
        e.data !== null &&
        // Home's electron/qdn-views.ts fires this on both account switch
        // and lock-state change, as action:'SELECTED_ACCOUNT_CHANGED';
        // also accept type:'qortium:selected-account-changed' defensively
        // in case a host sends only that field.
        ((e.data as { action?: unknown }).action ===
          'SELECTED_ACCOUNT_CHANGED' ||
          (e.data as { type?: unknown }).type ===
            'qortium:selected-account-changed')
      ) {
        // The newly-selected account's lock state is unknown until the next
        // GET_SELECTED_ACCOUNT / unlock check re-verifies it.
        invalidateCachedAccountUnlocked();
        authenticateUser().catch(() => {});
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [authenticateUser]);

  // On mount, check if the account is locked and prompt to unlock before balances load
  useEffect(() => {
    let cancelled = false;
    async function checkAndUnlock() {
      try {
        const account = (await qdnRequest({
          action: 'GET_SELECTED_ACCOUNT',
        })) as {
          isUnlocked?: boolean;
        } | null;
        if (account?.isUnlocked === true) {
          setCachedAccountUnlocked(true);
        } else {
          const result = await qdnRequest({
            action: 'UNLOCK_SELECTED_ACCOUNT',
          });
          setCachedAccountUnlocked(isUnlockedResult(result));
        }
      } catch {
        /* proceed regardless - leave the cache unknown so later sends re-check */
      }
      if (!cancelled) setWalletReady(true);
    }
    checkAndUnlock();
    return () => {
      cancelled = true;
    };
  }, [setWalletReady]);

  useEffect(() => {
    const session: IContextProps = {
      address: address ?? EMPTY_STRING,
      avatar: avatarUrl ?? EMPTY_STRING,
      name: name ?? EMPTY_STRING,
      isAuthenticated: !!address,
      isUsingGateway: false,
      nodeInfo: null,
    };
    if (setWalletState) setWalletState(session);
  }, [address, avatarUrl, name, setWalletState]);

  // Poll node info into context
  useEffect(() => {
    const poll = async () => {
      try {
        const [nodeInfo, nodeStatus] = await Promise.all([
          qdnRequest({ action: 'GET_NODE_INFO' }),
          qdnRequest({ action: 'GET_NODE_STATUS' }),
        ]);
        const isGateway = await qdnRequest({
          action: 'IS_USING_PUBLIC_NODE',
        });
        if (setWalletState) {
          setWalletState((prev: IContextProps) => ({
            ...prev,
            isUsingGateway: isGateway,
            nodeInfo: { ...nodeInfo, ...nodeStatus },
          }));
        }
      } catch {
        /* silent */
      }
    };
    poll();
    const id = setInterval(poll, TIME_MINUTES_1);
    return () => clearInterval(id);
  }, [setWalletState]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: c.pageBg }}>
      <TopBar />
      <Box
        sx={{
          pt: `var(--wallet-top-bar-height, ${tokens.spacing.topBarHeight}px)`,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
