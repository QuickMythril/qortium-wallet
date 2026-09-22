import { describe, expect, it } from 'vitest';
import type { ChainConfig } from '../../config/chains';
import {
  ARRR_CUSTODY_CONTRACT,
  foreignWalletAvailability,
  HOME_1_WALLET_READ_CONTRACT,
  HOME_WALLET_CONTRACT,
  legacyHome1WalletCapability,
} from '../homeWalletCapabilities';

const chain: ChainConfig = {
  key: 'BTC',
  name: 'Bitcoin',
  ticker: 'BTC',
  coinEnum: 'BTC',
  route: 'bitcoin',
  defaultFee: 0.00001,
  isNative: false,
  decimalPlaces: 8,
  activeNetwork: 'MAIN',
  supportsHtlc: true,
  supportsLocalChainTrades: true,
  homeWallet: {
    contract: HOME_WALLET_CONTRACT,
    implemented: true,
    protocol: 'qdnRequest',
    read: true,
    readMode: 'PUBLIC_NODE',
    receive: true,
    receiveMode: 'HOME_LOCAL',
    requiresUnlockedAccount: true,
    send: true,
    serverManagement: true,
    sendMode: 'HOME_SIGNED_PUBLIC_NODE',
    serverManagementMode: 'HOME_LOCAL',
  },
};

describe('foreign wallet capability contract', () => {
  it('does not infer foreign sending from generic actions alone', () => {
    const withoutCapability = foreignWalletAvailability(
      { ...chain, homeWallet: undefined },
      ['SEND_COIN', 'GET_WALLET_BALANCE']
    );
    expect(withoutCapability.canSend).toBe(false);

    const unversioned = foreignWalletAvailability(
      {
        ...chain,
        homeWallet: { ...chain.homeWallet!, contract: undefined },
      },
      ['SEND_COIN', 'GET_WALLET_BALANCE']
    );
    expect(unversioned.canSend).toBe(false);
  });

  it('gates each operation independently', () => {
    const partial = foreignWalletAvailability(
      {
        ...chain,
        homeWallet: {
          ...chain.homeWallet!,
          requiresUnlockedAccount: false,
        },
      },
      ['SEND_COIN']
    );
    expect(partial).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: true,
    });

    const complete = foreignWalletAvailability(chain, [
      'GET_USER_WALLET',
      'GET_WALLET_BALANCE',
      'GET_USER_WALLET_TRANSACTIONS',
      'SEND_COIN',
      'UNLOCK_SELECTED_ACCOUNT',
      'GET_CROSSCHAIN_SERVER_INFO',
      'SET_CURRENT_FOREIGN_SERVER',
    ]);
    expect(complete).toEqual({
      canManageServer: true,
      canReadBalance: true,
      canReadTransactions: true,
      canReceive: true,
      canSend: true,
    });
  });

  it('accepts Home 2 trusted-Core reads and server management', () => {
    const home2Chain: ChainConfig = {
      ...chain,
      homeWallet: {
        ...chain.homeWallet!,
        readMode: 'TRUSTED_CORE',
        send: false,
        sendMode: 'NONE',
        serverManagementMode: 'TRUSTED_CORE',
      },
    };
    expect(
      foreignWalletAvailability(home2Chain, [
        'GET_USER_WALLET',
        'GET_WALLET_BALANCE',
        'GET_USER_WALLET_TRANSACTIONS',
        'GET_CROSSCHAIN_SERVER_INFO',
        'SET_CURRENT_FOREIGN_SERVER',
      ])
    ).toEqual({
      canManageServer: true,
      canReadBalance: true,
      canReadTransactions: true,
      canReceive: true,
      canSend: false,
    });
  });

  it('honors explicit per-chain send refusal', () => {
    const availability = foreignWalletAvailability(
      {
        ...chain,
        homeWallet: {
          ...chain.homeWallet!,
          send: false,
          sendMode: 'NONE',
        },
      },
      ['SEND_COIN', 'GET_WALLET_BALANCE']
    );
    expect(availability.canReadBalance).toBe(true);
    expect(availability.canSend).toBe(false);
  });

  it('requires the advertised unlock action only when the chain contract does', () => {
    expect(foreignWalletAvailability(chain, ['SEND_COIN']).canSend).toBe(false);
    expect(
      foreignWalletAvailability(chain, ['SEND_COIN', 'UNLOCK_SELECTED_ACCOUNT'])
        .canSend
    ).toBe(true);
    expect(
      foreignWalletAvailability(
        {
          ...chain,
          homeWallet: {
            ...chain.homeWallet!,
            requiresUnlockedAccount: false,
          },
        },
        ['SEND_COIN']
      ).canSend
    ).toBe(true);
  });

  it('requires both server read and update actions', () => {
    expect(
      foreignWalletAvailability(chain, ['SET_CURRENT_FOREIGN_SERVER'])
        .canManageServer
    ).toBe(false);
    expect(
      foreignWalletAvailability(chain, [
        'GET_CROSSCHAIN_SERVER_INFO',
        'SET_CURRENT_FOREIGN_SERVER',
      ]).canManageServer
    ).toBe(true);
  });

  it('rejects contradictory, missing, and Core-signed modes', () => {
    for (const homeWallet of [
      { ...chain.homeWallet!, readMode: 'NONE' as const },
      { ...chain.homeWallet!, receiveMode: undefined as any },
      { ...chain.homeWallet!, sendMode: 'TRUSTED_CORE' as const },
      {
        ...chain.homeWallet!,
        serverManagement: false,
        serverManagementMode: 'HOME_LOCAL' as const,
      },
    ]) {
      expect(
        foreignWalletAvailability({ ...chain, homeWallet }, [
          'GET_USER_WALLET',
          'GET_WALLET_BALANCE',
          'GET_USER_WALLET_TRANSACTIONS',
          'SEND_COIN',
          'UNLOCK_SELECTED_ACCOUNT',
          'GET_CROSSCHAIN_SERVER_INFO',
          'SET_CURRENT_FOREIGN_SERVER',
        ])
      ).toEqual({
        canManageServer: false,
        canReadBalance: false,
        canReadTransactions: false,
        canReceive: false,
        canSend: false,
      });
    }
  });

  it('grants exact Home 1.x read compatibility but never legacy send', () => {
    const legacy = legacyHome1WalletCapability({
      hostName: 'qortium-home',
      hostVersion: '1.8.0',
      platform: 'desktop',
    });
    expect(legacy?.contract).toBe(HOME_1_WALLET_READ_CONTRACT);
    expect(
      foreignWalletAvailability({ ...chain, homeWallet: legacy }, [
        'GET_USER_WALLET',
        'GET_WALLET_BALANCE',
        'GET_USER_WALLET_TRANSACTIONS',
        'SEND_COIN',
        'UNLOCK_SELECTED_ACCOUNT',
        'GET_CROSSCHAIN_SERVER_INFO',
        'SET_CURRENT_FOREIGN_SERVER',
      ])
    ).toEqual({
      canManageServer: true,
      canReadBalance: true,
      canReadTransactions: true,
      canReceive: true,
      canSend: false,
    });
    expect(
      legacyHome1WalletCapability({
        hostName: 'qortium-home',
        hostVersion: '2.1.0',
      })
    ).toBeUndefined();
    expect(
      legacyHome1WalletCapability({
        hostName: 'another-host',
        hostVersion: '1.8.0',
      })
    ).toBeUndefined();
  });

  it('rejects an unverified copy of the Wallet-local Home 1.x marker', () => {
    expect(
      foreignWalletAvailability(
        {
          ...chain,
          homeWallet: {
            ...legacyHome1WalletCapability({
              hostName: 'qortium-home',
              hostVersion: '1.8.0',
            })!,
          },
        },
        [
          'GET_USER_WALLET',
          'GET_WALLET_BALANCE',
          'GET_USER_WALLET_TRANSACTIONS',
          'GET_CROSSCHAIN_SERVER_INFO',
          'SET_CURRENT_FOREIGN_SERVER',
        ]
      )
    ).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: false,
    });
  });
});

describe('ARRR custody gate (round 5)', () => {
  const arrrChain: ChainConfig = {
    key: 'ARRR',
    name: 'Pirate Chain',
    ticker: 'ARRR',
    coinEnum: 'ARRR',
    route: 'pirate-chain',
    defaultFee: 0.0001,
    isNative: false,
    decimalPlaces: 8,
    activeNetwork: 'MAIN',
    supportsHtlc: false,
    supportsLocalChainTrades: false,
    homeWallet: {
      contract: HOME_WALLET_CONTRACT,
      implemented: true,
      protocol: 'qdnRequest',
      read: true,
      readMode: 'TRUSTED_CORE_CUSTODY',
      receive: true,
      receiveMode: 'TRUSTED_CORE_CUSTODY',
      requiresUnlockedAccount: true,
      send: false,
      sendMode: 'NONE',
      serverManagement: false,
      serverManagementMode: 'NONE',
      custodyContract: ARRR_CUSTODY_CONTRACT,
      syncStatus: true,
    },
  };
  const arrrActions = [
    'GET_USER_WALLET',
    'GET_WALLET_BALANCE',
    'GET_USER_WALLET_TRANSACTIONS',
    'GET_ARRR_SYNC_STATUS',
  ];

  it('accepts a fully-conforming ARRR custody capability for read/receive/transactions, never send', () => {
    expect(foreignWalletAvailability(arrrChain, arrrActions)).toEqual({
      canManageServer: false,
      canReadBalance: true,
      canReadTransactions: true,
      canReceive: true,
      canSend: false,
    });
  });

  it('rejects TRUSTED_CORE_CUSTODY for every other coin', () => {
    const btcWithCustody: ChainConfig = {
      ...chain,
      homeWallet: { ...arrrChain.homeWallet!, contract: HOME_WALLET_CONTRACT },
    };
    expect(foreignWalletAvailability(btcWithCustody, arrrActions)).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: false,
    });
  });

  it('rejects ARRR custody advertised with send:true', () => {
    const sendable: ChainConfig = {
      ...arrrChain,
      homeWallet: {
        ...arrrChain.homeWallet!,
        send: true,
        sendMode: 'HOME_LOCAL',
      },
    };
    expect(foreignWalletAvailability(sendable, arrrActions).canSend).toBe(
      false
    );
    expect(foreignWalletAvailability(sendable, arrrActions)).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: false,
    });
  });

  it('rejects a missing or wrong custodyContract', () => {
    expect(
      foreignWalletAvailability(
        {
          ...arrrChain,
          homeWallet: { ...arrrChain.homeWallet!, custodyContract: undefined },
        },
        arrrActions
      ).canReceive
    ).toBe(false);
    expect(
      foreignWalletAvailability(
        {
          ...arrrChain,
          homeWallet: {
            ...arrrChain.homeWallet!,
            custodyContract: 'some-other-contract',
          },
        },
        arrrActions
      ).canReceive
    ).toBe(false);
  });

  it('rejects missing syncStatus', () => {
    expect(
      foreignWalletAvailability(
        {
          ...arrrChain,
          homeWallet: { ...arrrChain.homeWallet!, syncStatus: false },
        },
        arrrActions
      ).canReceive
    ).toBe(false);
    expect(
      foreignWalletAvailability(
        {
          ...arrrChain,
          homeWallet: { ...arrrChain.homeWallet!, syncStatus: undefined },
        },
        arrrActions
      ).canReceive
    ).toBe(false);
  });

  it('rejects when GET_ARRR_SYNC_STATUS is not advertised, even with a valid capability', () => {
    const withoutSyncAction = arrrActions.filter(
      (a) => a !== 'GET_ARRR_SYNC_STATUS'
    );
    expect(foreignWalletAvailability(arrrChain, withoutSyncAction)).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: false,
    });
  });

  it('never grants server management for ARRR, even if advertised', () => {
    expect(
      foreignWalletAvailability(arrrChain, [
        ...arrrActions,
        'GET_CROSSCHAIN_SERVER_INFO',
        'SET_CURRENT_FOREIGN_SERVER',
      ]).canManageServer
    ).toBe(false);
  });

  it('is unavailable with no capability at all - old Home without the custody extension', () => {
    expect(
      foreignWalletAvailability(
        { ...arrrChain, homeWallet: undefined },
        arrrActions
      )
    ).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: false,
      canSend: false,
    });
  });

  it('gates each ARRR read independently on its own advertised action', () => {
    expect(
      foreignWalletAvailability(arrrChain, [
        'GET_ARRR_SYNC_STATUS',
        'GET_USER_WALLET',
      ])
    ).toEqual({
      canManageServer: false,
      canReadBalance: false,
      canReadTransactions: false,
      canReceive: true,
      canSend: false,
    });
  });
});
