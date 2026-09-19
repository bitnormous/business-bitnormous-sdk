/**
 * The machine-readable codes the API sends on a typed `422`.
 *
 * These are a contract: a code never changes meaning once published, so branching on one is safe
 * in a way that branching on `error.message` is not.
 */
export const ErrorCodes = {
  /** The order is no longer `open`, so it cannot be paid or modified. */
  CHECKOUT_NOT_OPEN: 'checkout_not_open',
  /** Coins are already on their way; switching asset now would strand them. */
  CHECKOUT_ASSET_LOCKED: 'checkout_asset_locked',
  /** This merchant does not accept the asset, or the platform cannot settle it. */
  UNSUPPORTED_ASSET: 'unsupported_asset',
  /** The chain is not supported for that asset. */
  UNSUPPORTED_CHAIN: 'unsupported_chain',
  /** The amount is below the minimum that chain will ever credit. Offer another asset. */
  BELOW_MINIMUM: 'below_minimum',
  /** No price is available for the pair right now. Usually transient — let the customer retry. */
  RATE_UNAVAILABLE: 'rate_unavailable',
  /** The resource has moved past the point where it could be cancelled. */
  NOT_CANCELLABLE: 'not_cancellable',
  /** A configured per-transaction or network limit would be exceeded. */
  LIMIT_EXCEEDED: 'limit_exceeded',
  /** The balance bucket cannot cover the amount. */
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  /** Allowlist-only mode is on and the destination is not a saved recipient. */
  RECIPIENT_NOT_ALLOWLISTED: 'recipient_not_allowlisted',
  /** The per-(merchant, asset, chain) deposit-address cap has been reached. */
  ADDRESS_CAP_REACHED: 'address_cap_reached',
  /** The quote's lock window elapsed; fetch a fresh one. */
  QUOTE_EXPIRED: 'quote_expired',
  /** Quotes are single-use and this one is spent. */
  QUOTE_CONSUMED: 'quote_consumed',
  /** The quote was issued for the other flow; ramp and swap quotes are not fungible. */
  QUOTE_CONTEXT_MISMATCH: 'quote_context_mismatch',
} as const;

export type BitnormousErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
