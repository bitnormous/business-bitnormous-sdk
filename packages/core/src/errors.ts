/**
 * Errors you can branch on.
 *
 * Two rules worth knowing before you write a `catch`:
 *
 * 1. **Branch on `code`, never on `message`.** Messages are English prose and may be reworded at
 *    any time; codes are part of the API contract and never change meaning once published.
 * 2. **`BitnormousConnectionError` means "we do not know".** The request may or may not have
 *    reached us. Retry it with the same `idempotencyKey` — that is exactly what the key is for.
 */

import type { BitnormousErrorCode } from './error-codes.js';

/** Everything this SDK throws descends from here, so one `catch` can be exhaustive. */
export class BitnormousError extends Error {
  /** HTTP status, when the failure came from a response at all. */
  readonly status?: number;

  /** The machine-readable code to branch on. */
  readonly code?: BitnormousErrorCode | string;

  /** The raw body, for logging what the SDK could not interpret. */
  readonly raw?: unknown;

  constructor(message: string, options: { status?: number; code?: string; raw?: unknown; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.raw = options.raw;

    // Without this, `instanceof` breaks for anyone compiling to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The request never completed: DNS, TLS, a dropped socket, a timeout, an offline browser.
 *
 * The safe assumption is that the server MAY have processed it. Retry writes with the same
 * idempotency key rather than issuing a fresh one.
 */
export class BitnormousConnectionError extends BitnormousError {}

/** The key is missing, malformed, or revoked. Not retryable. */
export class BitnormousAuthenticationError extends BitnormousError {}

/**
 * The key is real but not allowed to do this: a scope it lacks, an IP outside its allowlist, a
 * live key on a business that has not finished verification, or a suspended merchant.
 */
export class BitnormousPermissionError extends BitnormousError {}

/** No such resource — or one you are not allowed to know exists. */
export class BitnormousNotFoundError extends BitnormousError {}

/** The request body was malformed. `fieldErrors` is keyed by field, values are human-readable. */
export class BitnormousValidationError extends BitnormousError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message: string,
    fieldErrors: Record<string, string[]> = {},
    options: { status?: number; raw?: unknown } = {},
  ) {
    super(message, { ...options, code: 'validation_failed' });
    this.fieldErrors = fieldErrors;
  }

  /** The first message for a field, for putting next to an input. */
  first(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }
}

/**
 * The request was well-formed but the money rules say no — below a chain's minimum, an asset this
 * merchant does not take, an order that is no longer open. `code` says which; see
 * {@link BitnormousErrorCode}.
 */
export class BitnormousRuleError extends BitnormousError {}

/** Too many requests. `retryAfter` is in seconds, when the server said. */
export class BitnormousRateLimitError extends BitnormousError {
  readonly retryAfter?: number;

  constructor(message: string, options: { status?: number; raw?: unknown; retryAfter?: number } = {}) {
    super(message, { ...options, code: 'rate_limited' });
    this.retryAfter = options.retryAfter;
  }
}

/** Something broke on our side. Safe to retry with the same idempotency key. */
export class BitnormousServerError extends BitnormousError {}

/** A webhook signature did not verify. Treat the delivery as hostile and drop it. */
export class BitnormousSignatureError extends BitnormousError {
  constructor(message: string) {
    super(message, { code: 'invalid_signature' });
  }
}

/**
 * Build the right error from a response the SDK could not use.
 *
 * The API speaks three envelope dialects — Laravel's validation shape, the platform's
 * `{status, message, data}` envelope, and a bare `{message}` for routing failures — so this is the
 * one place that has to know about all three, and every caller gets one shape back.
 */
export function errorFromResponse(status: number, body: unknown, headers?: Headers): BitnormousError {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  const message =
    typeof record['message'] === 'string' && record['message'].length > 0
      ? record['message']
      : `Bitnormous request failed with status ${status}.`;

  // Laravel's validation dialect: {message, errors: {field: [...]}}
  const errors = record['errors'];
  if (status === 422 && errors && typeof errors === 'object') {
    return new BitnormousValidationError(message, errors as Record<string, string[]>, { status, raw: body });
  }

  // The platform envelope carries typed codes under `data.error_code`.
  const data = record['data'];
  const code =
    data && typeof data === 'object' && !Array.isArray(data)
      ? ((data as Record<string, unknown>)['error_code'] as string | undefined)
      : undefined;

  switch (status) {
    case 401:
      return new BitnormousAuthenticationError(message, { status, code, raw: body });
    case 403:
      return new BitnormousPermissionError(message, { status, code, raw: body });
    case 404:
      return new BitnormousNotFoundError(message, { status, code, raw: body });
    case 429: {
      const header = headers?.get('retry-after');
      const retryAfter = header ? Number.parseInt(header, 10) : undefined;
      return new BitnormousRateLimitError(message, {
        status,
        raw: body,
        ...(retryAfter !== undefined && Number.isFinite(retryAfter) ? { retryAfter } : {}),
      });
    }
  }

  if (status >= 500) {
    return new BitnormousServerError(message, { status, code, raw: body });
  }

  if (status === 422) {
    return new BitnormousRuleError(message, { status, code, raw: body });
  }

  return new BitnormousError(message, { status, code, raw: body });
}
