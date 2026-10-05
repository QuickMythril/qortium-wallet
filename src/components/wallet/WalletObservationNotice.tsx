import { Box } from '@mui/material';
/** One financial freshness notice shared by custody wallets. Never a readiness verdict. */
export function WalletObservationNotice({
  at,
  historyAt,
  syncing,
  stale,
}: {
  at?: number | null;
  historyAt?: number | null;
  syncing: boolean;
  stale: boolean;
}) {
  if (!syncing && !stale) return null;
  return (
    <Box
      data-wallet-observation="financial"
      sx={{ mt: 1, fontSize: '0.78rem', opacity: 0.8 }}
    >
      {stale && at != null
        ? `${historyAt === undefined || historyAt === at ? 'Balances/history' : 'Balances'} as of ${new Date(at).toLocaleString()}. `
        : ''}
      {stale && historyAt != null && historyAt !== at
        ? `History as of ${new Date(historyAt).toLocaleString()}. `
        : ''}
      {syncing
        ? 'Balances/history may be incomplete while syncing.'
        : 'Balances/history may have changed.'}
    </Box>
  );
}
export function WalletScanDetails({
  height,
  children,
}: {
  height?: number;
  children?: import('react').ReactNode;
}) {
  return (
    <Box component="details" sx={{ mt: 1, fontSize: '0.75rem', opacity: 0.8 }}>
      <summary>Scan details</summary>
      {height != null && (
        <Box>Scan starts at block {height.toLocaleString()}.</Box>
      )}
      {children}
    </Box>
  );
}
