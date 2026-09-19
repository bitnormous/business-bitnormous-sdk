/**
 * `BitnormousCheckout` — the browser entry point.
 *
 * Three ways to show a checkout, all driving the same hosted page:
 *
 * - {@link BitnormousCheckout.open} — a modal over your page. The default, and the one to reach for.
 * - {@link BitnormousCheckout.redirect} — send the customer to the hosted checkout and back.
 * - {@link BitnormousCheckout.mount} — embed it inline, in your own layout.
 *
 * None of them take an API key, because none of them should. A checkout session is created on your
 * server, and the browser only ever holds that one session's client secret.
 */

import {
  BitnormousError,
  type ClientCheckoutSession,
  type CheckoutCloseReason,
  type CheckoutOutboundMessage,
  type CreateCheckoutSessionParams,
} from '@bitnormous/business-core';

import { buildCheckoutUrl } from './frame.js';
import { mountEmbed, type EmbedHandle } from './embed.js';
import { openModal, type ModalHandle } from './modal.js';

export const DEFAULT_CHECKOUT_URL = 'https://checkout.bitnormous.com';

/** The two values the browser needs, and the only ones it should ever see. */
export interface CheckoutSessionRef {
  id: string;
  clientSecret: string;
}

/** What your endpoint may return — `client_secret` straight from the API is accepted too. */
export type CreateSessionResult = CheckoutSessionRef | { id: string; client_secret: string };

/**
 * How the SDK gets a session when you ask it to open one from order details.
 *
 * Either the path to your own endpoint (it is `POST`ed the order and must answer with the created
 * session), or a function you write — handy when your API client already handles auth, CSRF or
 * error reporting.
 */
export type SessionFactory =
  | string
  | ((params: CreateCheckoutSessionParams) => Promise<CreateSessionResult>);

export interface BitnormousCheckoutOptions {
  /**
   * Your server endpoint, or a function, that creates the checkout session.
   *
   * Required only if you call {@link BitnormousCheckout.open} with order details rather than a
   * session you already created.
   */
  createSession?: SessionFactory;
  /** Override the hosted checkout origin. You will not normally need this. */
  checkoutUrl?: string;
  /** `auto` follows the customer's system setting. Default: `auto`. */
  theme?: 'light' | 'dark' | 'auto';
  /** BCP-47 tag, e.g. `en-GH`. Defaults to the browser's. */
  locale?: string;
}

/** How a checkout ended. `completed` is the only outcome that means money moved. */
export interface CheckoutResult {
  status: CheckoutCloseReason;
  session?: ClientCheckoutSession;
}

interface Callbacks {
  /** The order was paid in full. Fulfil from your webhook, not from here — see the note below. */
  onSuccess?: (session: ClientCheckoutSession) => void;
  /** The checkout closed, however it ended. Always fires exactly once. */
  onClose?: (result: CheckoutResult) => void;
  /** Every movement in the order, including the first read. */
  onStatusChange?: (session: ClientCheckoutSession) => void;
  /** The checkout could not run — a session that does not exist, a network it cannot reach. */
  onError?: (error: BitnormousError) => void;
}

/** Open with a session your server already created. */
export interface OpenWithSession extends Callbacks {
  session: CheckoutSessionRef;
}

/** Open from order details, letting the SDK call your `createSession` endpoint. */
export interface OpenWithParams extends Callbacks, CreateCheckoutSessionParams {}

export type OpenOptions = OpenWithSession | OpenWithParams;

export interface MountOptions extends Callbacks {
  session: CheckoutSessionRef;
}

/**
 * @example Modal, with the SDK creating the session through your endpoint
 * ```ts
 * const checkout = new BitnormousCheckout({ createSession: '/api/bitnormous/checkout' });
 *
 * await checkout.open({
 *   amount: 125,
 *   currency: 'USD',
 *   reference: 'ORDER-102938',
 *   customer: { email: 'customer@example.com' },
 *   onSuccess: (session) => (window.location.href = `/orders/${session.reference}`),
 * });
 * ```
 *
 * @example Modal, with a session you created server-side already
 * ```ts
 * await checkout.open({ session: { id, clientSecret }, onSuccess });
 * ```
 *
 * @remarks
 * `onSuccess` fires in the customer's browser, which means it fires only if they are still there —
 * not if their battery died on the confirmation screen. Use it for what the customer sees; do the
 * fulfilment from the `checkout_session.completed` webhook, which arrives whatever they do.
 */
export class BitnormousCheckout {
  private readonly options: BitnormousCheckoutOptions;

  private readonly checkoutUrl: string;

  private active: ModalHandle | undefined;

  constructor(options: BitnormousCheckoutOptions = {}) {
    assertBrowser();

    this.options = options;
    this.checkoutUrl = (options.checkoutUrl ?? DEFAULT_CHECKOUT_URL).replace(/\/+$/, '');
  }

  /**
   * Open the checkout in a modal.
   *
   * Resolves when it closes, with how it ended — so `await` reads naturally, and the callbacks are
   * there for the cases where you would rather not.
   */
  async open(options: OpenOptions): Promise<CheckoutResult> {
    // Two modals would fight over the scroll lock and the customer's attention.
    this.close();

    let session: CheckoutSessionRef;
    try {
      session = await this.resolveSession(options);
    } catch (cause) {
      const error =
        cause instanceof BitnormousError
          ? cause
          : new BitnormousError('Could not start the checkout.', { code: 'checkout_start_failed', cause });

      options.onError?.(error);
      throw error;
    }

    return new Promise<CheckoutResult>((resolve) => {
      let settled = false;

      const finish = (result: CheckoutResult) => {
        if (settled) {
          return;
        }
        settled = true;
        this.active = undefined;

        options.onClose?.(result);
        resolve(result);
      };

      this.active = openModal({
        checkoutUrl: this.checkoutUrl,
        sessionId: session.id,
        clientSecret: session.clientSecret,
        ...(this.options.theme !== undefined ? { theme: this.options.theme } : {}),
        ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
        onMessage: (message) => this.dispatch(message, options, finish),
        onDismiss: () => finish({ status: 'dismissed', ...(this.active?.session() ? { session: this.active.session()! } : {}) }),
      });
    });
  }

  /**
   * Send the customer to the hosted checkout.
   *
   * The most robust integration there is — no iframe, no third-party cookie questions, and it
   * degrades gracefully on anything with a browser. Set `returnUrl` when you create the session so
   * the checkout knows where to send them back to.
   */
  async redirect(options: { session: CheckoutSessionRef } | CreateCheckoutSessionParams): Promise<never> {
    const session = await this.resolveSession(options as OpenOptions);

    window.location.assign(
      buildCheckoutUrl({
        checkoutUrl: this.checkoutUrl,
        sessionId: session.id,
        clientSecret: session.clientSecret,
        embedded: false,
        ...(this.options.theme !== undefined ? { theme: this.options.theme } : {}),
        ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
      }),
    );

    // The navigation has been requested; nothing after this runs.
    return new Promise<never>(() => {});
  }

  /**
   * Embed the checkout inline, inside your own page.
   *
   * The frame reports its height as the customer moves through the steps and the embed follows it,
   * so there is no inner scrollbar and no dead space under the content.
   */
  mount(target: string | HTMLElement, options: MountOptions): EmbedHandle {
    const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;

    if (!element) {
      throw new BitnormousError(`No element matched "${String(target)}" to mount the checkout into.`, {
        code: 'mount_target_not_found',
      });
    }

    return mountEmbed({
      target: element,
      checkoutUrl: this.checkoutUrl,
      sessionId: options.session.id,
      clientSecret: options.session.clientSecret,
      ...(this.options.theme !== undefined ? { theme: this.options.theme } : {}),
      ...(this.options.locale !== undefined ? { locale: this.options.locale } : {}),
      onMessage: (message) =>
        this.dispatch(message, options, (result) => options.onClose?.(result)),
    });
  }

  /** Close the modal from your own code. Safe to call when nothing is open. */
  close(): void {
    this.active?.close();
    this.active = undefined;
  }

  /** Route one protocol message to the caller's callbacks. */
  private dispatch(
    message: CheckoutOutboundMessage,
    callbacks: Callbacks,
    finish: (result: CheckoutResult) => void,
  ): void {
    switch (message.type) {
      case 'status':
        callbacks.onStatusChange?.(message.session);
        break;

      case 'success':
        callbacks.onStatusChange?.(message.session);
        callbacks.onSuccess?.(message.session);
        break;

      case 'error':
        callbacks.onError?.(
          new BitnormousError(message.message, message.code !== undefined ? { code: message.code } : {}),
        );
        break;

      case 'close':
        finish({ status: message.reason, ...(message.session ? { session: message.session } : {}) });
        break;
    }
  }

  /** Either the caller brought a session, or we ask their server for one. */
  private async resolveSession(options: OpenOptions | CreateCheckoutSessionParams): Promise<CheckoutSessionRef> {
    if ('session' in options && options.session) {
      return options.session;
    }

    const factory = this.options.createSession;

    if (!factory) {
      throw new BitnormousError(
        'No checkout session was supplied and no `createSession` was configured. Either pass ' +
          '`session: { id, clientSecret }` from your server, or configure `createSession` with the ' +
          'endpoint that creates one.',
        { code: 'missing_create_session' },
      );
    }

    const params = pickParams(options);
    const created = typeof factory === 'string' ? await postJson(factory, params) : await factory(params);

    return normalize(created);
  }
}

/** Only the order fields go to your endpoint; callbacks are browser-side and stay here. */
function pickParams(options: OpenOptions | CreateCheckoutSessionParams): CreateCheckoutSessionParams {
  const {
    onSuccess: _onSuccess,
    onClose: _onClose,
    onStatusChange: _onStatusChange,
    onError: _onError,
    session: _session,
    ...params
  } = options as CreateCheckoutSessionParams & Partial<OpenWithSession>;

  return params;
}

async function postJson(url: string, params: CreateCheckoutSessionParams): Promise<CreateSessionResult> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Your endpoint is on your own origin, so session cookies and CSRF flows keep working.
      credentials: 'same-origin',
      body: JSON.stringify(params),
    });
  } catch (cause) {
    throw new BitnormousError(`Could not reach ${url} to create a checkout session.`, {
      code: 'create_session_unreachable',
      cause,
    });
  }

  if (!response.ok) {
    throw new BitnormousError(
      `${url} answered ${response.status} when asked to create a checkout session.`,
      { code: 'create_session_failed', status: response.status },
    );
  }

  const body = (await response.json()) as CreateSessionResult | { data?: CreateSessionResult };

  // Tolerate an endpoint that forwards the API envelope verbatim — a very common way to write it.
  return 'data' in body && body.data ? body.data : (body as CreateSessionResult);
}

/** Accept either casing, so proxying the API response straight through just works. */
function normalize(result: CreateSessionResult): CheckoutSessionRef {
  const id = result.id;
  const clientSecret = 'clientSecret' in result ? result.clientSecret : result.client_secret;

  if (!id || !clientSecret) {
    throw new BitnormousError(
      'The checkout session response was missing `id` or `client_secret`. Return the session your ' +
        'server created, unchanged.',
      { code: 'invalid_create_session_response', raw: result },
    );
  }

  return { id, clientSecret };
}

function assertBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new BitnormousError(
      'BitnormousCheckout needs a browser. On the server, create the session with ' +
        '@bitnormous/business-node and construct this in the client component that opens it.',
      { code: 'no_browser_environment' },
    );
  }
}
