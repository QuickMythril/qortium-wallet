# Shared Wallet presentation and requests

`components/wallet/WalletPage.tsx` owns coin-neutral page/header, balance/receive
card, exact formatted amount, address bar, send trigger, scan controls and history
surfaces. All coin pages use these components; send and scan controls are below
the balance. `WalletSyncProgress.tsx` owns shared progress/ETA presentation and
uses the existing coin-neutral `common/scanProgress.ts` arithmetic.

Adapters determine whether an account owns a session, which operations exist,
what counts as a fresh snapshot, and whether spending is permitted. Preserve
those decisions outside shared visual components. ARRR Stop is node-scoped and
XMR Stop is owner-scoped; their explicit scope notes remain distinct. Coin-native
transaction detail and send approval/recovery adapters remain separate because
their protocols and available metadata differ.

`common/walletRequest.ts` selects `WALLET_REQUEST` from the current Home's exact
advertised contract. Discovery cache never grants that capability. Existing
legacy Home actions remain usable without it. Timeout-wrapped reads use the
same transport selection. Selection happens before one dispatch: no rejection,
timeout or unknown send outcome triggers a fallback/replay. Native QORT retains
its existing dual-network bridge selection.

New coins should compose these components and register tested bridge/backend
adapters rather than copy an entire wallet page or create arbitrary API routes.
