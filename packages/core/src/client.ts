/**
 * The server-side client.
 *
 * This is the only place your secret key belongs. It never goes in a browser bundle, a mobile app,
 * or anything a customer can open — and the constructor actively stops you, because a leaked
 * `sk_live_…` is the whole account.
 */

import { BitnormousError } from './errors.js';
import { Transport, type TransportOptions } from './http.js';
import type {
  BitnormousEnvironment,
  CheckoutSession,
  CreateCheckoutSessionParams,
  CreatedCheckoutSession,
  ListCheckoutSessionsParams,
  Paginated,
  PaymentLeg,
} from './types.js';

export interface BitnormousOptions extends TransportOptions {
  /** Your secret key, `sk_test_…` or `sk_live_…`. Read it from the environment, never inline. */
  secretKey: string;
  /**
   * Escape hatch for a non-browser runtime the SDK mistakes for one — a JSDOM test, an SSR shim
   * that defines `window`. It does NOT make shipping a secret key to a browser safe.
   */
  allowBrowser?: boolean;
}

export interface RequestConfig {
  /**
   * Makes this write safely repeatable. Use your own order number.
   *
   * Without it, a lost response leaves you unable to tell "the order was created and I did not see
   * it" from "the order was never created", and the safe-looking retry opens a second payable
   * checkout. With it, the retry returns the original.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Accept crypto payments.
 *
 * @example
 * ```ts
 * const bitnormous = new Bitnormous({ secretKey: process.env.BITNORMOUS_SECRET_KEY! });
 *
 * const session = await bitnormous.checkout.sessions.create(
 *   {
 *     amount: 125,
 *     currency: 'USD',
 *     reference: 'ORDER-102938',
 *     customer: { email: 'customer@example.com' },
 *     returnUrl: 'https://store.example/orders/102938',
 *   },
 *   { idempotencyKey: 'ORDER-102938' },
 * );
 *
 * // Redirect, or hand { id, client_secret } to the browser SDK for a modal.
 * response.redirect(session.url);
 * ```
 */
export class Bitnormous {
  /** Which world this key moves money in. Inferred from its prefix. */
  readonly environment: BitnormousEnvironment;

  readonly checkout: { sessions: CheckoutSessions };

  /**
   * An alias for {@link checkout}.`sessions`, for code that reads better as "payments". Same
   * object, same resource — a Bitnormous payment *is* a checkout session.
   */
  readonly payments: CheckoutSessions;

  readonly paymentSessions: PaymentSessions;

  private readonly transport: Transport;

  constructor(options: BitnormousOptions) {
    const secretKey = options.secretKey?.trim();

    if (!secretKey) {
      throw new BitnormousError(
        'A secret key is required. Pass `secretKey`, e.g. from process.env.BITNORMOUS_SECRET_KEY.',
        { code: 'missing_secret_key' },
      );
    }

    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
      throw new BitnormousError(
        'That does not look like a Bitnormous secret key (expected `sk_test_…` or `sk_live_…`). ' +
          'A publishable key cannot authenticate this client — the browser uses a checkout ' +
          "session's client secret instead.",
        { code: 'invalid_secret_key' },
      );
    }

    // The single most expensive mistake this SDK can prevent.
    if (!options.allowBrowser && isBrowser()) {
      throw new BitnormousError(
        'Refusing to use a secret key in a browser: anyone who opens devtools would own your ' +
          'account. Create checkout sessions on your server, and use @bitnormous/business-sdk in ' +
          'the browser with the returned client secret.',
        { code: 'secret_key_in_browser' },
      );
    }

    this.environment = secretKey.startsWith('sk_test_') ? 'test' : 'live';

    this.transport = new Transport({
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${secretKey}` },
    });

    const sessions = new CheckoutSessions(this.transport);
    this.checkout = { sessions };
    this.payments = sessions;
    this.paymentSessions = new PaymentSessions(this.transport);
  }
}

/** Orders: create one, read it back, list them, call one off. */
export class CheckoutSessions {
  constructor(private readonly transport: Transport) {}

  /**
   * Open a checkout for an order.
   *
   * The customer has not chosen an asset yet, so `payment` comes back `null`. What you do with the
   * result depends on the integration you want:
   *
   * - **Redirect** — send them to `session.url`.
   * - **Modal / embedded** — hand `{ id, client_secret }` to `@bitnormous/business-sdk`.
   *
   * Pass an `idempotencyKey`. It is the difference between a lost response being harmless and it
   * opening a second checkout the customer can pay twice.
   */
  create(params: CreateCheckoutSessionParams, config: RequestConfig = {}): Promise<CreatedCheckoutSession> {
    return this.transport.request<CreatedCheckoutSession>('/checkout-sessions', {
      method: 'POST',
      body: {
        amount: params.amount,
        currency: params.currency,
        reference: params.reference,
        customer: params.customer,
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        metadata: params.metadata,
      },
      ...config,
    });
  }

  /**
   * Read an order, re-derived from the chain and the clock before it answers.
   *
   * This is the call to make when a webhook arrives: confirm here before releasing goods, rather
   * than trusting a request body that arrived over the open internet.
   */
  retrieve(id: string, config: RequestConfig = {}): Promise<CheckoutSession> {
    return this.transport.request<CheckoutSession>(`/checkout-sessions/${encodeURIComponent(id)}`, config);
  }

  list(params: ListCheckoutSessionsParams = {}, config: RequestConfig = {}): Promise<Paginated<CheckoutSession>> {
    return this.transport.request<Paginated<CheckoutSession>>('/checkout-sessions', {
      query: {
        status: params.status,
        reference: params.reference,
        page: params.page,
        per_page: params.perPage,
      },
      ...config,
    });
  }

  /**
   * Call off an unpaid order — an abandoned cart, a stock-out.
   *
   * Only an `open` checkout can be cancelled: once funds are detected the money is real, and you
   * get a typed `not_cancellable` error rather than a silent no-op.
   */
  cancel(id: string, config: RequestConfig = {}): Promise<CheckoutSession> {
    return this.transport.request<CheckoutSession>(`/checkout-sessions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      ...config,
    });
  }
}

/**
 * Payment attempts, read-only.
 *
 * You will usually want {@link CheckoutSessions} instead — an order is what you reconcile against.
 * Reach for these when you need the attempt-level detail: which address a customer actually sent
 * to, or a counter-top scan-to-pay session opened outside any SDK checkout.
 */
export class PaymentSessions {
  constructor(private readonly transport: Transport) {}

  list(
    params: { status?: string; reference?: string; page?: number; perPage?: number } = {},
    config: RequestConfig = {},
  ): Promise<Paginated<PaymentLeg>> {
    return this.transport.request<Paginated<PaymentLeg>>('/payment-sessions', {
      query: {
        status: params.status,
        reference: params.reference,
        page: params.page,
        per_page: params.perPage,
      },
      ...config,
    });
  }

  retrieve(id: string, config: RequestConfig = {}): Promise<PaymentLeg> {
    return this.transport.request<PaymentLeg>(`/payment-sessions/${encodeURIComponent(id)}`, config);
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}
