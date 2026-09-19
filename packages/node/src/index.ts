/**
 * `@bitnormous/business-node` — the server half of a Bitnormous integration.
 *
 * Two jobs, and they are the only two your server has:
 *
 * 1. **Create checkout sessions.** Your secret key lives here and nowhere else.
 * 2. **Receive webhooks.** This is where an order actually becomes fulfilled — not in the
 *    customer's browser, which may close, lose signal or run out of battery on the success screen.
 *
 * ```ts
 * import { Bitnormous } from '@bitnormous/business-node';
 *
 * const bitnormous = new Bitnormous({ secretKey: process.env.BITNORMOUS_SECRET_KEY! });
 *
 * app.post('/api/bitnormous/checkout', async (req, res) => {
 *   const order = await orders.find(req.body.reference);
 *
 *   const session = await bitnormous.checkout.sessions.create(
 *     {
 *       amount: order.total,
 *       currency: order.currency,
 *       reference: order.id,
 *       customer: { email: order.email },
 *       returnUrl: `https://store.example/orders/${order.id}`,
 *     },
 *     { idempotencyKey: order.id },
 *   );
 *
 *   // The browser SDK needs exactly these two. Never send the whole session — it is fine if you
 *   // do, but there is no reason to widen what the customer's device holds.
 *   res.json({ id: session.id, client_secret: session.client_secret });
 * });
 * ```
 */

export { constructEvent, verifyWebhookSignature, signPayload, type VerifyOptions } from './webhooks.js';

export {
  Bitnormous,
  CheckoutSessions,
  PaymentSessions,
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
  ErrorCodes,
  SIGNATURE_HEADER,
  EVENT_HEADER,
  DELIVERY_HEADER,
  formatAmount,
  formatCrypto,
  type BitnormousOptions,
  type RequestConfig,
  type BitnormousErrorCode,
} from '@bitnormous/business-core';

export type * from '@bitnormous/business-core';
