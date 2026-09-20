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
