/**
 * `@bitnormous/business-sdk` — accept crypto payments in the browser.
 *
 * ```ts
 * import { BitnormousCheckout } from '@bitnormous/business-sdk';
 *
 * const checkout = new BitnormousCheckout({ createSession: '/api/bitnormous/checkout' });
 *
 * await checkout.open({
 *   amount: 125,
 *   currency: 'USD',
 *   reference: 'ORDER-102938',
 *   customer: { email: 'customer@example.com' },
 *   onSuccess: (payment) => console.log('Payment successful', payment),
 *   onClose: () => console.log('Checkout closed'),
 * });
 * ```
 *
 * There is no API key in that snippet, and that is the point: `/api/bitnormous/checkout` is YOUR
 * endpoint, it creates the session with `@bitnormous/business-node`, and your secret key never
 * leaves your server.
 */

export {
  BitnormousCheckout,
  DEFAULT_CHECKOUT_URL,
  type BitnormousCheckoutOptions,
  type CheckoutSessionRef,
  type CheckoutResult,
  type CreateSessionResult,
  type SessionFactory,
  type OpenOptions,
  type OpenWithSession,
  type OpenWithParams,
  type MountOptions,
} from './checkout.js';

export type { EmbedHandle } from './embed.js';
export { buildCheckoutUrl } from './frame.js';

// Re-exported so a browser-only integration needs exactly one dependency.
export {
  BitnormousError,
  ErrorCodes,
  CheckoutClient,
  formatAmount,
  formatCrypto,
  formatDuration,
  paymentProgress,
  secondsUntil,
  type BitnormousErrorCode,
  type CheckoutCloseReason,
  type ClientCheckoutSession,
  type CheckoutSession,
  type CheckoutSessionStatus,
  type PaymentLeg,
  type PaymentStatus,
  type AcceptedAsset,
  type AcceptedChain,
  type CreateCheckoutSessionParams,
} from '@bitnormous/business-core';
