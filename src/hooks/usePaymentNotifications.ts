import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  notificationsEnabledAtom,
  notificationsSupportedAtom,
  paymentNotificationRegistrationErrorAtom,
  paymentNotificationRegistrationStatusAtom,
  walletReadyAtom,
} from '../state/global/system';
import { useSupportedChains } from './useSupportedChains';
import {
  supportsNotifications,
  removeNotificationRules,
} from '../notifications/notificationsApi';
import {
  paymentNotificationErrorMessage,
  registerPaymentNotifications,
} from '../notifications/paymentNotificationRegistration';
import { foreignWalletAvailability } from '../common/homeWalletCapabilities';
import { isSelectedAccountChangedMessage } from '../common/accountChangedMessage';

// Registers background payment notifications (own QORT address + foreign coin
// xpubs) with Home's notification bridge. ARRR is excluded here - the Core watcher
// behind FOREIGN_PAYMENT_RECEIVED only covers the Bitcoiny/ElectrumX coin set.
export function usePaymentNotifications() {
  const walletReady = useAtomValue(walletReadyAtom);
  const [enabled, setEnabled] = useAtom(notificationsEnabledAtom);
  const [supported, setSupported] = useAtom(notificationsSupportedAtom);
  const registrationError = useAtomValue(
    paymentNotificationRegistrationErrorAtom
  );
  const setRegistrationError = useSetAtom(
    paymentNotificationRegistrationErrorAtom
  );
  const setRegistrationStatus = useSetAtom(
    paymentNotificationRegistrationStatusAtom
  );
  const {
    chains,
    status: chainDiscoveryStatus,
    walletAuthorityReady,
  } = useSupportedChains();
  const disabledCleanupAttempted = useRef(false);
  const [accountRevision, setAccountRevision] = useState(0);
  const [foreignActions, setForeignActions] = useState<string[] | null>(null);

  useEffect(() => {
    supportsNotifications()
      .then(setSupported)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof qdnRequest !== 'function') {
      setForeignActions(null);
      return;
    }

    let cancelled = false;
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      qdnRequest({ action: 'SHOW_ACTIONS' })
        .then((actions: unknown) => {
          if (!cancelled && requestRevision === revision) {
            setForeignActions(Array.isArray(actions) ? actions : null);
          }
        })
        .catch(() => {
          if (!cancelled && requestRevision === revision)
            setForeignActions(null);
        });
    };
    const handleBridgeChange = () => {
      setForeignActions(null);
      refresh();
    };

    refresh();
    window.addEventListener('qortiumBridgeStateChanged', handleBridgeChange);
    return () => {
      cancelled = true;
      revision++;
      window.removeEventListener(
        'qortiumBridgeStateChanged',
        handleBridgeChange
      );
    };
  }, []);

  useEffect(() => {
    const handleAccountChange = (event: MessageEvent<unknown>) => {
      if (isSelectedAccountChangedMessage(event)) {
        disabledCleanupAttempted.current = false;
        setAccountRevision((value) => value + 1);
      }
    };

    window.addEventListener('message', handleAccountChange);
    return () => window.removeEventListener('message', handleAccountChange);
  }, []);

  useEffect(() => {
    if (!supported) return;

    let cancelled = false;

    if (!enabled) {
      if (disabledCleanupAttempted.current) {
        if (!registrationError) setRegistrationStatus('idle');
        return;
      }

      // Rules are durable in Home, while this hook's refs are not. Always make
      // one app-scoped removal attempt from a disabled mount so turning the bell
      // off after a restart also clears rules registered by the previous mount.
      disabledCleanupAttempted.current = true;
      setRegistrationStatus('registering');
      removeNotificationRules()
        .then(() => {
          if (cancelled) return;
          setRegistrationStatus(registrationError ? 'error' : 'idle');
        })
        .catch((error) => {
          if (cancelled) return;
          setRegistrationError(paymentNotificationErrorMessage(error));
          setRegistrationStatus('error');
        });

      return () => {
        cancelled = true;
      };
    }

    if (
      !walletReady ||
      foreignActions === null ||
      chainDiscoveryStatus !== 'live' ||
      !walletAuthorityReady
    )
      return;

    disabledCleanupAttempted.current = false;
    const foreignCoins = chains
      .filter(
        (chain) =>
          !chain.isNative &&
          chain.key !== 'ARRR' &&
          foreignWalletAvailability(chain, foreignActions).canReceive
      )
      .map((chain) => chain.coinEnum);

    setRegistrationError(null);
    setRegistrationStatus('registering');
    registerPaymentNotifications(foreignCoins)
      .then(() => {
        if (cancelled) return;
        setRegistrationStatus('registered');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Payment notification registration failed:', error);
        setRegistrationError(paymentNotificationErrorMessage(error));
        setRegistrationStatus('error');
        setEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    accountRevision,
    chains,
    chainDiscoveryStatus,
    enabled,
    foreignActions,
    registrationError,
    setEnabled,
    setRegistrationError,
    setRegistrationStatus,
    supported,
    walletReady,
    walletAuthorityReady,
  ]);
}
