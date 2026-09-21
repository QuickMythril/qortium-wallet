// Qortium Home's qdnRequest bridge rejects with an Error, a plain string, or
// a {message, code?, retryable?} object (see the host contract notes in
// projects/wallet-review). SEND_COIN can also *resolve* with
// {accepted: false, error: string, retryable: false} rather than throwing.
// This module turns any of those shapes into readable, user-safe text so UI
// code never has to guess at the error's shape (or render '[object Object]').

export interface DecodedBridgeError {
  message: string;
  code?: string;
  retryable?: boolean;
}

const FALLBACK_MESSAGE = 'An unknown error occurred.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Decode an unknown thrown value or resolved error payload into a readable
 * message plus optional code/retryable metadata. Never returns
 * '[object Object]' - unrecognized objects fall back to a JSON dump or a
 * generic message.
 */
export function describeBridgeError(err: unknown): DecodedBridgeError {
  if (err instanceof Error) {
    const withMeta = err as Error & { code?: unknown; retryable?: unknown };
    return {
      message: err.message || FALLBACK_MESSAGE,
      code: stringOrUndefined(withMeta.code),
      retryable: boolOrUndefined(withMeta.retryable),
    };
  }

  if (typeof err === 'string') {
    return { message: err.trim() || FALLBACK_MESSAGE };
  }

  if (isPlainObject(err)) {
    const message =
      stringOrUndefined(err.message) ?? stringOrUndefined(err.error);
    const code = stringOrUndefined(err.code);
    const retryable = boolOrUndefined(err.retryable);
    if (message) return { message, code, retryable };

    try {
      const serialized = JSON.stringify(err);
      if (serialized && serialized !== '{}') {
        return { message: serialized, code, retryable };
      }
    } catch {
      /* not serializable - fall through to the generic message */
    }
    return { message: FALLBACK_MESSAGE, code, retryable };
  }

  return { message: FALLBACK_MESSAGE };
}

/** True when a decoded error looks like it means "the account is locked". */
export function isUnlockRequiredError(decoded: DecodedBridgeError): boolean {
  const haystack = `${decoded.code ?? ''} ${decoded.message}`.toLowerCase();
  return haystack.includes('unlock');
}

// A foreign send rejected with this text is a known Qortium Core
// spend-context serialization bug (fixed in Core after 1.8.0), not a
// wallet, balance, or user-recipient problem - see round 2 item E.
const CORE_SPEND_CONTEXT_BUG_SUBSTRING = 'previous transaction hash is invalid';

/** True when a decoded send-error message matches the known Core spend-context serialization bug. */
export function isCoreSpendContextBugError(
  decoded: DecodedBridgeError
): boolean {
  return decoded.message
    .toLowerCase()
    .includes(CORE_SPEND_CONTEXT_BUG_SUBSTRING);
}

// ARRR custody read error codes (round 5 host contract - see the ARRR rows
// of qortium-home's HOME_V2_BRIDGE_COMPATIBILITY.md). Every ARRR custody
// rejection carries one of these as `code`, plus a human `message`.
export const ARRR_WALLET_BUSY_CODE = 'ARRR_WALLET_BUSY';
export const ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE =
  'ARRR_SYNC_CONTRACT_UNSUPPORTED';
export const ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE =
  'ARRR_VERIFIED_BALANCE_UNAVAILABLE';
export const ARRR_READ_BACKLOG_CODE = 'ARRR_READ_BACKLOG';
export const ARRR_READ_CANCELLED_CODE = 'ARRR_READ_CANCELLED';
export const ARRR_READ_SUPERSEDED_CODE = 'ARRR_READ_SUPERSEDED';

/** True when another account's ARRR wallet is currently active on the trusted Core (retryable). */
export function isArrrWalletBusyError(decoded: DecodedBridgeError): boolean {
  return decoded.code === ARRR_WALLET_BUSY_CODE;
}

/** True when the trusted Core is too old to speak the structured ARRR sync-status contract. */
export function isArrrSyncContractUnsupportedError(
  decoded: DecodedBridgeError
): boolean {
  return decoded.code === ARRR_SYNC_CONTRACT_UNSUPPORTED_CODE;
}

/** True when the verified (spendable) ARRR balance isn't known yet, but the total may still be readable. */
export function isArrrVerifiedBalanceUnavailableError(
  decoded: DecodedBridgeError
): boolean {
  return decoded.code === ARRR_VERIFIED_BALANCE_UNAVAILABLE_CODE;
}

// The distinct `account.arrr-custody.read` consent prompt (separate from
// the eight-coin foreign-wallet disclosure) is rejected by Home with its
// generic account-access-denial wording, NOT anything mentioning "custody"
// or "ARRR" - Home's home-v2-app-bridge.ts throws the exact string
// "Account access was denied." for every denied prompt, this one included
// (Codex round 5 review finding 3: the earlier "custody"+"denied" keyword
// combo could never match that real string, so a genuine denial fell
// through to the generic retry path instead of surfacing "custody not
// approved"). Matched by exact string (trimmed) plus the documented
// PERMISSION_DENIED code, and nothing broader - a loose substring match
// here risks treating an unrelated transient error as a permanent denial
// and wrongly freezing the ARRR-only retry loop that calls this. This
// predicate is called ONLY from the ARRR custody read path
// (useArrrSyncStatus.ts), never shared with unrelated bridge errors.
const ARRR_CUSTODY_CONSENT_DENIED_MESSAGE = 'Account access was denied.';
const PERMISSION_DENIED_CODE = 'PERMISSION_DENIED';

export function isArrrCustodyConsentDeniedError(
  decoded: DecodedBridgeError
): boolean {
  if (decoded.code === PERMISSION_DENIED_CODE) return true;
  return decoded.message.trim() === ARRR_CUSTODY_CONSENT_DENIED_MESSAGE;
}
