/**
 * `@bitnormous/business-core` — the isomorphic heart of the Bitnormous Business SDK.
 *
 * You usually want one of the packages built on it instead:
 *
 * - `@bitnormous/business-node` — your server. Creates orders, verifies webhooks.
 * - `@bitnormous/business-sdk` — the browser. Opens the checkout in a modal, an embed or a redirect.
 * - `@bitnormous/business-react` — the same, as hooks and components.
 *
 * Reach for this one directly when you are somewhere those do not fit: a Cloudflare Worker, a Deno
 * edge function, or a React Native app that needs the checkout state machine without the DOM.
 */

export { Bitnormous, CheckoutSessions, PaymentSessions } from './client.js';
export type { BitnormousOptions, RequestConfig } from './client.js';

export { CheckoutClient, type CheckoutClientOptions, type WatchOptions, type Unsubscribe } from './checkout-client.js';

export { Transport, DEFAULT_BASE_URL, SDK_VERSION, shouldRetry } from './http.js';
export type { TransportOptions, RequestOptions, RetryOptions } from './http.js';

export {
  BitnormousError,
  BitnormousConnectionError,
  BitnormousAuthenticationError,
  BitnormousPermissionError,
  BitnormousNotFoundError,
  BitnormousValidationError,
  BitnormousRuleError,
  BitnormousRateLimitError,
  BitnormousServerError,
  BitnormousSignatureError,
  errorFromResponse,
} from './errors.js';

export { ErrorCodes, type BitnormousErrorCode } from './error-codes.js';

export {
  constructEvent,
  verifyWebhookSignature,
  signPayload,
  SIGNATURE_HEADER,
  EVENT_HEADER,
  DELIVERY_HEADER,
  type VerifyWebhookOptions,
} from './webhooks.js';

export {
  formatAmount,
  formatCrypto,
  trimTrailingZeros,
  paymentProgress,
  secondsUntil,
  formatDuration,
} from './money.js';

export {
  PROTOCOL_SOURCE,
  PROTOCOL_VERSION,
  envelope,
  readMessage,
  type CheckoutCloseReason,
  type CheckoutOutboundMessage,
  type CheckoutInboundMessage,
  type CheckoutMessageEnvelope,
} from './protocol.js';

export type * from './types.js';
