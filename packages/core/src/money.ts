/**
 * Money formatting.
 *
 * Amounts cross the wire as decimal strings and stay that way inside the SDK — see {@link Decimal}
 * for why. These helpers turn one into something a person can read, without ever routing the value
 * through a float.
 */

import type { Decimal } from './types.js';

/**
 * Format a fiat amount for display.
 *
 * The parse to `Number` here is safe and deliberate: it happens at the very last step, purely to
 * hand `Intl` something to lay out, and the value is never stored or sent back. Do arithmetic on
 * the string with a decimal library instead.
 *
 * @example formatAmount('125.00', 'USD') // "$125.00"
 * @example formatAmount('150.00', 'GHS', 'en-GH') // "GH₵150.00"
 */
export function formatAmount(amount: Decimal, currency: string, locale?: string): string {
  const value = Number.parseFloat(amount);

  if (!Number.isFinite(value)) {
    return `${amount} ${currency}`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    // An ISO code `Intl` does not know is still perfectly payable.
    return `${trimTrailingZeros(amount)} ${currency.toUpperCase()}`;
  }
}

/**
 * Format a crypto amount: the significant digits and no more.
 *
 * Chain amounts arrive padded to scale 8 (`10.00000000`), which reads as noise next to an asset
 * ticker. This keeps every digit that carries value and drops the rest.
 *
 * @example formatCrypto('10.00000000', 'USDT') // "10 USDT"
 * @example formatCrypto('0.00042100', 'BTC')   // "0.000421 BTC"
 */
export function formatCrypto(amount: Decimal, asset?: string): string {
  const trimmed = trimTrailingZeros(amount);

  return asset ? `${trimmed} ${asset.toUpperCase()}` : trimmed;
}

/** `10.00000000` -> `10`; `0.00042100` -> `0.000421`; integers pass through untouched. */
export function trimTrailingZeros(amount: Decimal): string {
  if (!amount.includes('.')) {
    return amount;
  }

  const trimmed = amount.replace(/0+$/, '').replace(/\.$/, '');

  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * How far through a partial payment the customer is, 0–1.
 *
 * Underpayments are common — a wallet deducts its network fee from the amount sent — so a checkout
 * should show progress rather than silently waiting. Returns `0` if either value is unreadable.
 */
export function paymentProgress(received: Decimal, expected: Decimal): number {
  const paid = Number.parseFloat(received);
  const total = Number.parseFloat(expected);

  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, paid / total));
}

/** Seconds left until an ISO timestamp, floored at 0. */
export function secondsUntil(isoTimestamp: string, now: number = Date.now()): number {
  const expiry = Date.parse(isoTimestamp);

  if (!Number.isFinite(expiry)) {
    return 0;
  }

  return Math.max(0, Math.floor((expiry - now) / 1000));
}

/** `903` -> `"15:03"`, for a countdown. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);

  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
