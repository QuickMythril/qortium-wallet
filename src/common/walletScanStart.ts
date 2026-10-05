export const WALLET_SCAN_START_CONTRACT = 'qortium-home-wallet-scan-start-v1';
export type WalletScanStart = {
  scanMode: 'RESUME' | 'RESTORE_FROM_HEIGHT' | 'NEW_AT_CURRENT_TIP';
  restoreHeight?: number;
};
