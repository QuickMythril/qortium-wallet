# Changelog

All notable changes to Qortium Wallet will be documented in this file.

## [1.7.16] - 2026-09-22 (QuickMythril fork test build)

### Added

- The send form now tells you WHICH unsupported address format you pasted instead of a generic "not a valid `<TICKER>` address" (owner decision 2026-09-22, round 6 item B). `src/utils/addressValidation.ts` gained `classifyRecipient(coin, address)`, returning a structured `{ valid, reason?, otherCoin? }` instead of just a boolean - `validateAddress()` is now a thin wrapper over it, so every existing caller/test keeps working unchanged. Recognised reasons: `TAPROOT_UNSUPPORTED` (a real bech32m witness-v1 address for BTC/LTC/DGB - "Taproot (bc1p…) addresses aren't supported yet - use a legacy or bc1q address."), `MWEB_UNSUPPORTED` (Litecoin `ltcmweb1…`), `SPARK_UNSUPPORTED`/`LELANTUS_UNSUPPORTED` (Firo `sm1…` Spark addresses, source-verified against firoorg/firo's `src/libspark/util.h`/`keys.cpp` - HRP `sm` + bech32m; `LELANTUS_UNSUPPORTED` is kept in the reason union for forward-compatibility, but Firo's older Lelantus/Sigma mints have no equivalent user-facing address format to recognise, so nothing currently classifies as it), `CASHADDR_WRONG_COIN` (a real, checksum-verified Bitcoin Cash CashAddr address, with or without its `bitcoincash:` prefix), `WRONG_COIN` (a genuinely valid address for a different supported coin, naming which one), and `BAD_CHECKSUM` vs `UNKNOWN_FORMAT` (right shape/wrong checksum - likely a typo - versus a format this wallet doesn't recognise at all). The bech32 decoder gained real bech32m (BIP350) support alongside its existing BIP173 bech32 decode, so a valid bech32m string is recognised as such rather than being treated as a bad-checksum bech32 string. `CoinDetail.tsx`'s send form shows the specific message via six new i18n keys (`send_dialog.recipient_invalid_{taproot,mweb,spark,cashaddr,wrong_coin,bad_checksum}`) added to all 20 locales.
- Fixed a namecoin (NMC) validation gap: `validateNmcAddress()` only accepted base58 addresses, while Core (`BitcoinyChainSpecs.namecoinParams()` - `.segwitAddressHrp("nc")`) and Home both accept segwit v0 `nc1q…` addresses too - a real, sendable NMC address this form was wrongly rejecting.

## [1.7.15] - 2026-09-21 (QuickMythril fork test build)

### Added

- ARRR balances and receive now work through Home 2's new trusted-Core custody read adapter (`TRUSTED_CORE_CUSTODY` / `qortium-home-arrr-custody-v1`) instead of the old free-text sync-status polling loop. `homeWalletCapabilities.ts` gained a coin-aware ARRR-only branch (`src/common/homeWalletCapabilities.ts`) that only ever grants `TRUSTED_CORE_CUSTODY` for `coinEnum === 'ARRR'` when the exact custody contract, `syncStatus: true`, `send: false`/`sendMode: 'NONE'`, and `GET_ARRR_SYNC_STATUS` are all present - any other coin advertising that mode, or ARRR advertising it with `send: true`, is rejected exactly like a missing capability. The eight bitcoiny coins' existing gate is unchanged.
- The ARRR coin page now renders the five structured sync states (`DISABLED`, `LOADING`, `SYNCHRONIZING`, `DEGRADED`, `READY`) from Core's typed `GET_ARRR_SYNC_STATUS` snapshot (`src/common/arrrSync.ts`, `src/hooks/useArrrSyncStatus.ts`) instead of matching against Core's old free-text status strings and estimating a percentage from a retry counter. Progress shows the real `scannedHeight`/`tipHeight` (falling back to `syncedBlocks`/`totalBlocks`, then an indeterminate spinner) while `SYNCHRONIZING`; `DEGRADED` shows Core's `lastError.message` and a restart hint when `restartRequired`; a `stale` `READY` snapshot is labeled "last updated ... · provisional" rather than shown as current. Balances are gated on Core's own `ready` verdict, never on `state` alone. Polling starts immediately on page entry, runs every 15s while `LOADING`/`SYNCHRONIZING`/`DEGRADED`, every 3 minutes once `READY`/`DISABLED`, pauses entirely while the tab is hidden (resuming with an immediate poll on becoming visible again), and is cancelled on unmount or account switch. The receive address (`GET_USER_WALLET`) now shows as soon as it resolves, independent of sync state - it no longer waits behind the old sync gate.
- ARRR balances now show the verified (spendable) amount as the primary figure and the total (including unconfirmed/unverified) as a secondary line, each formatted to exactly 8 decimals and never rendered as `0` when the read hasn't resolved. If the verified read specifically rejects with `ARRR_VERIFIED_BALANCE_UNAVAILABLE`, the total is shown instead with a "verifying…" label rather than being presented as spendable. Both values, plus the sync state, are stored in the existing per-account balance cache (`src/common/balanceCache.ts`) under `(account, 'ARRR')`, so the grid tile can render Wallet's last-known ARRR balance without polling `GET_WALLET_BALANCE` itself - the grid tile now skips ARRR entirely in its own balance-fetch pass, deferring to whatever the coin page last wrote.
- `ARRR_WALLET_BUSY` (another account's ARRR wallet active on the trusted Core) now auto-retries every 10s for up to 6 attempts before falling back to a manual retry button, on both the sync-status poll and the balance/transaction reads (`requestWithArrrBusyRetry` in `src/common/arrrSync.ts`). `ARRR_SYNC_CONTRACT_UNSUPPORTED` shows "Update Qortium Core to see ARRR balances"; denying the distinct ARRR custody consent prompt shows "custody not approved" with a retry; an old Home without the custody capability leaves the ARRR row unavailable (showing Home's own `unavailableReason`) without polling or offering to send.
- New strings across all 20 locales (`src/i18n/locales/*/core.json`, `arrr.*`) for every new ARRR state/error/label.

### Removed

- Every ARRR send entry point - the coin page's Send button, the grid tile's quick-send icon, and the ElectrumX-style ARRR lightwallet-server picker dialog (server selection is no longer part of the custody contract) - is gone. The Send affordances are disabled with a "Sending ARRR is not available yet" note instead of hidden outright, matching how the other foreign coins already explain a disabled Send button.

## [1.7.14] - 2026-09-21 (QuickMythril fork test build)

### Added

- The main "All Transactions" unified history page now renders each account's pending (not-yet-confirmed) sends - across every chain, not just the coin page - with the same "pending confirmation" styling CoinDetail already used, at the top of the list, deduped against the fetched rows by signature and cleared automatically the moment the shared poller (`src/common/pendingSends.ts`) sees a confirmation. The page also registers as a poller subscriber itself for as long as it's open, so tracking keeps working even if it's the only pending-sends-aware view currently mounted.
- The send form now validates the recipient address against the selected coin's real address format - a base58check decode (version byte + checksum) for BTC/LTC/DOGE/RVN/DGB/DASH/NMC/FIRO/QORT, and a bech32 (BIP173) decode + checksum for the segwit chains (BTC `bc1...`, LTC `ltc1...`, DGB `dgb1...`) - instead of only checking that something non-empty and under 256 characters was typed. An invalid address now shows "not a valid `<TICKER>` address" inline and disables Send; a resolved Qortal name or contact card still bypasses this raw-address check, since it already carries a real resolved address. Version bytes are taken directly from Core's `org.qortium.crosschain.BitcoinyChainSpecs.java`; DASH, NMC, and FIRO validators are new, the rest replace the previous regex-only checks. No dependency was added for this - both base58 decoding and the SHA-256 checksum are small, dependency-free implementations in `src/utils/addressValidation.ts`.
- The send form now warns before submit, rather than only after Core rejects it: `src/config/minimums.ts` declares Core's own minimum non-dust output per foreign chain (BTC 546, LTC 100000, DOGE 100000000, DGB 546, RVN 2730, NMC 546, FIRO 1000, DASH 546 sats/atomic-units - sourced from `BitcoinyChainSpecs.java`), and an amount below it now shows "minimum is X `<TICKER>`" inline and disables Send. Separately, once the balance is known, a non-blocking warning appears when the amount plus an estimated fee (fee-per-byte × 250 bytes for foreign coins, the fixed fee for QORT) would exceed it - this never blocks Send and is skipped entirely for send-max.

## [1.7.13] - 2026-09-20 (QuickMythril fork test build)

### Fixed

- Qortal asset images now actually show. `useAssetImageUrl` previously resolved a Qortal image via `GET_QDN_RESOURCE_URL` and loaded it as a cross-origin `<img src>` pointed at the Qortal node's own origin (CSP-limited in Home, and the node answered HTTP 503 for a freshly-requested, never-rendered image) - it never appeared, on either network but especially Qortal. It now fetches the image's bytes through the same bridge as every other asset read (`FETCH_QDN_RESOURCE` with `encoding: 'base64'`, following Q-Assets' own asset-detail-page convention), sniffs the decoded header against an allow-list of real image formats (PNG/JPEG/GIF/WebP/SVG - anything else, or anything that fails to decode, is rejected and never rendered), and renders a same-origin `data:<mime>;base64,...` URL. The fallback chain (issuer image, then the shared `Q-Assets` default avatar on Qortal only, then the placeholder) is unchanged. A `data:` URL never 503s, so the retry-while-Core-is-still-building behavior that used to live at the `<img onError>` level now lives at the fetch level instead (three retries at 1.5s/4s/10s before giving up to the placeholder, never cached as a permanent failure); the issuer's QDN name still surfaces as soon as it's resolved, independently of how long the image fetch/retry takes.
- The chain badge no longer sits in an absolutely-positioned corner of the circular asset tile, where the tile's own `overflow: hidden` circle crop clipped it, and no longer duplicates the plain-text "qortium"/"qortal" label that used to sit under the asset name on rows and tiles. The badge now replaces that plain-text label in place (rows, tiles, and the detail page header); nothing inside the circular avatar/image wrapper carries the badge on any of the three surfaces.

## [1.7.12] - 2026-09-20 (QuickMythril fork test build)

### Added

- A chain-of-origin badge ("Qortium" / "Qortal", i18n'd across all 20 locales) now appears on every asset row, tile, and detail-page header, using the app's existing accent color for Qortium and the separate `info` token for Qortal so the two are never the same hue in any theme variant. The badge is always rendered independently of whether an image loaded, so the two chains stay distinguishable with letter-circle placeholders alone, and its tooltip shows the asset ID and the resolved issuer name (or "unknown issuer").
- A new `useAssetImageUrl` hook resolves an issuer-published asset avatar following the Q-Assets convention (`crowetic/Q-Assets`): the issuer's QDN name is resolved once per (network, owner) from the asset's owner address via `GET_PRIMARY_NAME` (falling back to `GET_ACCOUNT_NAMES`), then the image is fetched as `service: 'IMAGE'`, `identifier: asset<id>_<name>_aavatar` under that name. A Qortal asset with no issuer-published image falls back to the shared `Q-Assets` app's default avatar (`assetAvatar_default`); Qortium has no equivalent shared name yet, so a Qortium miss falls straight through to the placeholder. Resolved URLs are cached per (network, assetId) in module memory and rendered through the existing `CoinImage`/`useRetryingImageSrc` retry-with-backoff component (Core can answer 503 while it builds a freshly-requested image, same as coin icons); only a resolved URL is cached - a miss is retried on the next mount or Home bridge-state change, never cached as a permanent failure. Issuer metadata is treated as untrusted throughout: it is only ever passed through as a resource coordinate (an address, or a `name`/`identifier` pair) to the bridge, never rendered as HTML or trusted text.
- The asset detail page now shows the resolved issuer name (or "unknown issuer") and the asset ID under the title, and clamps a published `description` (if `GET_ASSET_INFO` returns one) to 3 lines of plain, auto-escaped text - never HTML.
- When the unified asset list mixes networks, Qortium assets now group before Qortal assets under every sort mode (name, balance, and custom/pinned order), while each network's own relative order - including any pin ordering - is preserved within its group.

### Follow-up (not in this round)

- Q-Assets' `BLOG_POST` publication metadata (genesis post, group metadata, structured JSON, dividends, custom fields) is not parsed or displayed yet - only the `IMAGE` avatar convention and the plain `description` field from `GET_ASSET_INFO`.

## [1.7.11] - 2026-09-20 (QuickMythril fork test build)

### Added

- A QORT send now appears immediately in the coin's transaction list as a "pending confirmation" row (with its signature, amount, and recipient), tracked in a shared module (`src/common/pendingSends.ts`) and polled every 15 s against `SEARCH_TRANSACTIONS`/`GET_QORTAL_TRANSACTIONS` (`confirmationStatus: 'BOTH'`) until a block height is seen, then flips to confirmed and refreshes the QORT balance exactly once. Tracking survives navigating away from the coin page to the main grid and back - a single poller keeps running as long as either is open. If no confirmation appears within an absolute 30-minute wall-clock deadline (checked on every poll and when the app becomes visible again, not an active-poll count) the row is marked "unconfirmed - check later" instead of polling forever.
- A shared, module-level balance cache (`src/common/balanceCache.ts`) keyed by the selected Home account and chain, with a 2-minute freshness window. The main coin grid renders cached balances instantly on every mount and only re-fetches a coin when its cache is stale, when it was just sent from or just confirmed, on the manual retry button, or when the page becomes visible again after being hidden for more than 2 minutes. A `qortiumBridgeStateChanged` event no longer forces a whole-grid refetch unless a coin's actual capability set changed. Switching Home accounts clears both this cache and the pending-send tracker above, so one account's balances or in-flight sends can never appear under another.
- While the coin grid or the QORT coin page is open, QORT's balance is polled every 60 s (a single cheap `GET_BALANCE`) so an incoming payment is noticed without opening the coin page; on the coin page, a balance change also refreshes that coin's transaction history. Foreign coins are not polled on this interval and keep their existing 3-minute cadence. All of this polling pauses while the document is hidden.
- A shared `useSuggestedFee` hook now loads the suggested fee for every path that opens a send form, including a deep link (`?send=true`, or the Home `wallet` assignment-role link) that previously bypassed the fee lookup entirely - this is what made the grid's quick-send action show no suggested fee even though the coin page's own Send button did. The fee field now shows a "loading fee…" state and Send stays disabled until the lookup resolves or fails.
- A foreign send rejected with a message containing "previous transaction hash is invalid" (a known Qortium Core spend-context serialization bug, fixed in Core after 1.8.0) now shows an additional one-line hint that this is a Core-update issue, not a wallet or balance problem.

### Fixed

- A native QORT send that Home can't confirm the broadcast outcome for (`accepted:false`, `outcome: 'unknown'` or `'mismatch'`) now shows the same "transaction status unknown - don't retry" state as an ambiguous foreign send, instead of always being treated as a hard failure.
- The QORT coin page's 60-second balance poll no longer compares against a value captured when the poll effect happened to start (always empty on the very first tick); it now compares against the balance the last real fetch actually resolved, so an unchanged balance never triggers a spurious history refetch.

## [1.7.10] - 2026-09-20 (QuickMythril fork test build, published as APP/QortiumHomeTest/Wallet)

### Added

- Home `wallet` assignment-role deep link: opening the app with a top-level `?to=<address or name>` (or `?send=true`) now lands on the native-coin send form with the recipient filled in, so Home's account context menu "Send coins" works without the caller knowing the app's hash routes. `?_route=` still wins when present.

### Fixed

- Send errors and ambiguous foreign-send outcomes are no longer shown or treated as success. A decoded, readable message (never a raw object) is now shown under the send form, and Home's `accepted:false` / `foreignOutcome` results surface a distinct "transaction status unknown - don't retry" state instead of a green checkmark. Balance, transaction history, and ARRR sync failures now keep their decoded reason (shown on hover/tap with a manual retry) instead of silently going blank, and balance retries are capped at one retry that only fires when the error is marked retryable.
- Account unlock is no longer requested before every send. `GET_SELECTED_ACCOUNT` (or a cached result from the app's mount-time check) is consulted first, and `UNLOCK_SELECTED_ACCOUNT` is skipped whenever the account is already known to be unlocked; the cache is invalidated on a Home account switch and on any unlock-related send error.
- Coin icons now recover from Core's asynchronous thumbnail build: a first view (or one after the built copy was purged) answers with a temporary HTTP 503 while Core builds the image in the background, which previously failed the `<img>` permanently. A shared `CoinImage` component (used by the coin detail header/logo, list rows, and transaction rows) now retries the same URL with a cache-busting parameter up to 4 times (1.5s/4s/10s/25s backoff) before falling back to the existing letter-circle placeholder, and a failed `GET_QDN_RESOURCE_URL` lookup is no longer cached forever - it retries on the next mount and after a Home bridge-state change. Qortium assets continue to use `qdnRequest`, while Qortal assets use `qortalRequest`; balances, metadata, transfers, receive addresses, pins, routes, and sends stay on the selected chain even when the same asset ID exists on both.
- A Wallet build published to Qortal QDN can read Qortal asset data through public same-origin Core endpoints when its host lacks the newer structured read actions, while transfer requests remain single-shot `TRANSFER_ASSET` bridge calls. In Qortium Home, Qortal asset support remains fail-closed until Home advertises the matching Qortal asset actions.
- Native asset ID `0` is excluded from the generic asset list so QORT and any future Qortium native coin are not duplicated as ordinary assets.
- Foreign receive, balance, history, send, payment-notification, and ElectrumX server operations now require both their advertised Home action and a live versioned per-chain wallet capability. Cached or generic actions cannot enable unsupported foreign calls, and bridge-state changes refresh the capability decision.
- Foreign capability booleans must now agree with their operation modes. Missing, contradictory, `NONE`, or legacy `TRUSTED_CORE` send modes fail closed. An exact `qortium-home` 1.x host identity retains its established foreign receive, balance, history, notification, and server-management compatibility, but its private-key-to-Core send path remains disabled.
- Refreshed the lockfile to patched DOMPurify and React Router releases after the production dependency audit began flagging their superseded versions.
- QORT address, balance, history, name lookup, account unlock, and send operations now prefer the `qortalRequest` bridge. This keeps QORT on the Qortal chain in Qortium Home 2 and allows the same Wallet build to run from Qortal QDN. Qortium assets and foreign wallets remain on `qdnRequest`.
- QORT addresses now use Qortal's standard `GET_USER_ACCOUNT`, balances use `GET_BALANCE` with that address, and history uses `SEARCH_TRANSACTIONS`, rather than the Home 1.x-only `GET_QORT_BALANCE` and `SEARCH_QORTAL_TRANSACTIONS` QDN aliases. Those aliases remain as a compatibility fallback only when a host does not expose `qortalRequest`.
- QORT sending selects Home 2's advertised `SEND_QORT` action or Qortal Core's standard `SEND_COIN` contract before approval and makes exactly one send request, avoiding unsafe retry-based protocol detection. The Wallet only invokes Home's explicit account-unlock action when the host advertises it; standard Qortal hosts use their own send approval flow.
- QORT name recipients now resolve directly against Qortal names instead of requiring a Qortium contact card. Qortium asset and foreign-coin recipient resolution remains on Qortium.
- QORT payment-notification rules now watch the address returned by the Qortal wallet bridge instead of the Qortium selected-account address.
- Qortal-only hosts no longer populate unsupported Qortium foreign-chain fallback rows when `qdnRequest` is unavailable.

## [1.7.9] - 2026-07-10

### Added

- QORT (Qortal native coin) is now fully supported: balance via `GET_QORT_BALANCE`, send via `SEND_QORT`, address via `GET_USER_WALLET` with native asset (`assetId: 0`). QORT is always shown first in the coin list regardless of chain discovery state.

### Fixed

- Send button availability now checks `SEND_QORT` for QORT and `SEND_COIN` for all foreign coins, so QORT send is correctly gated on Qortal bridge availability rather than Qortium bridge availability.
- QORT wallet detail no longer shows "wallet unavailable" on public nodes - the foreign-wallet guard (`GET_WALLET_BALANCE`) is bypassed for native QORT since it does not apply.
- Fee input is hidden in the QORT send dialog since `SEND_QORT` computes the fee automatically.
- QORT name resolution in the address book now uses `GET_NAME_DATA` bridge action instead of a direct API fetch, which was broken inside the Q-App sandbox.

## [1.7.3] - 2026-07-09

### Added

- Coin icons loaded from QDN (THUMBNAIL service, `wallet-coin-{ticker}` identifiers) rather than bundled as static assets, allowing new icons to be published without a full app update.
- Placeholder icon (initial letter in a circle) shown for any coin without a published QDN image.

## Previously unreleased

### Added

- Apply Qortium Home text-size settings on app launch and when Home sends text-size changes, matching the existing theme and language bridge behavior.
- Added foreign-coin send-max support and prepared-transaction previews using Qortium Home's send result metadata.

### Changed

- Migrated Home bridge calls from legacy `qortalRequest` globals to `qdnRequest`.
- Limited visible wallet chains to Qortium Home-supported wallets: QORT, BTC, LTC, DOGE, DGB, RVN, DASH, NMC, and FIRO.
- Foreign sends now pass fee overrides as `feePerByte` strings and omit `amount` when send-max is enabled.

### Fixed

- Updated native wallet requests to use Home 1.3-compatible native asset forms and `GET_BALANCE`.
- Disabled encrypted QDN address-book sync when Home does not expose encryption bridge actions, while keeping local address books available.
- Foreign sends now only pass fee-per-byte values returned by `GET_FOREIGN_FEE`; when fee lookup fails, Home/Core defaults are used.
- Mapped `/crosschain/blockchains` support data from `supportsLocalChainTrades`.

## [1.3.2] - 2026-03-06

### Fixed

- QDN address book check: added `coinType` field to published QDN resources and dual validation in `fetchFromQDN` to discard resources returned by the Qortal node for a different coin identifier. Primary check uses the new top-level `coinType` field; secondary check uses entries' `coinType` field for backward compatibility with older published resources.
- TypeScript build errors for MUI v7 compatibility: replaced removed named exports (`SlideProps`, `TooltipProps`, `TransitionProps`, `SnackbarCloseReason`, `ToggleButtonGroupProps`) with `ComponentProps<typeof ...>` equivalents or local type definitions; added explicit `Theme` typing to `styled()` callbacks.
- `NumericFormat` forwarded MUI props no longer cause TypeScript errors.

### Tests

- Added 4 tests covering the QDN coinType mismatch scenario.

## [1.3.1] - 2026-02-27

### Fixed

- QDN address book sync: skip unnecessary publish when timestamps diverge but content is identical (hash comparison before publishing)
- QDN address book sync: re-align local timestamp to QDN after skipping publish, and sync forward after publishing, to avoid redundant evaluations on next startup

### Changed

- Release workflow now fails with a clear message if the release version already exists, instead of silently deleting it
- Removed push trigger from npm tests workflow

### Tests

- Added tests covering the QDN address book hash-comparison sync bugfix

## [1.3.0] - 2026-01-23

### Added

- Address book feature with QDN persistence
- QORT address search by name
- Double-click to copy address or add name to address book
- Validation functions for all coin addresses
- `maxSendable` functions for all supported coins (ARRR, BTC, DOGE, LTC, RVN, DGB)
- Tests for LTC validation
- New translations for address book
- Add CHANGELOG.md file
- Display changelog in a dialog

### Changed

- Updated qapp-core to version 1.0.75
- Improved I18N translations

## [1.2.1] - 2026-01-02

### Changed

- Improved send validation flow
- Updated GitHub Actions release workflow with simplified changelog template
- Added concurrency groups to GitHub Actions workflows
- Added condition to run workflows only on specific repository

### Fixed

- Send max button validation improvements

## [1.2.0] - 2025-12-27

### Changed

- Qortal Transaction table updates and improvements
- GitHub Actions parametrization of APP_NAME
- Improved release changelog diff with comparison links

## [1.1.3] - 2025-12-24

### Added

- GitHub Actions release workflow with automated changelog generation
- New contributors section in releases
- ASSET type transactions support

### Changed

- Improved API call for validating addresses (allows sending QORT to addresses with no transactions)
- Refactored wallet info loading with better async operations
- Added `useCallback` and `AbortController` for cleaner code

### Fixed

- Address validation for empty or malformed addresses

## [1.1.2] - 2025-11-28

### Added

- Font optimization with woff2 format and font-display swap
- Copy confirmation message
- Better precision for numeric values

### Changed

- Improved mobile responsiveness and layout
- Better loading states with LinearProgress
- Refactored embedded colors into theme
- Trimmed recipient address input
- More efficient async/await calls

### Fixed

- Mobile view for menu
- Modal reset after sending
- Address and amount validation
- Error reset when changing pages

## [1.1.1] - 2025-11-24

### Fixed

- Missing QORT import
- Duplicated check conditions
- Renamed methods for clarity
- Added EMPTY_STRING constant for consistency

## [1.1.0] - 2025-11-15

### Added

- Initial release of Walletium
- Support for multiple cryptocurrencies: QORT, BTC, LTC, DOGE, DGB, RVN, ARRR
- Transaction history with pagination
- Send functionality for all supported coins
- QR code generation for receiving addresses
- Internationalization (i18n) support
- Responsive design for mobile devices
- Transaction fee display
- Copy to clipboard functionality

### Changed

- Refactored time constants
- Improved lateral menu responsiveness
- Better layout adaptation for different devices
