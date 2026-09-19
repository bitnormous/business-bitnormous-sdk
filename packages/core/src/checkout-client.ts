/**
 * The customer's side of a checkout — browser-safe.
 *
 * It authenticates with one order's `client_secret` and can reach that order and nothing else. No
 * API key is involved, so this is safe to run in a browser, a mobile app, or anywhere else the
 * customer can see.
 *
 * The interesting part is {@link CheckoutClient.watch}, which is the difference between a checkout
 * that feels instant and one that hammers the API: it polls faster while money is in flight, backs
 * off when it is not, stops dead on a terminal status, and sleeps entirely while the tab is hidden
 * (a customer who switches to their wallet app is the normal case, not the exception).
 */

import { BitnormousError } from './errors.js';
import { Transport, type TransportOptions } from './http.js';
import type { ClientCheckoutSession } from './types.js';

export interface CheckoutClientOptions extends Omit<TransportOptions, 'headers'> {
  /** The `cs_…` id from your server. */
  sessionId: string;
  /** That session's client secret, also from your server. */
  clientSecret: string;
}

export interface WatchOptions {
  /** Fires on every state change, and once immediately with the current state. */
  onUpdate?: (session: ClientCheckoutSession) => void;
  /** Fires once, when the order is paid in full. */
  onSuccess?: (session: ClientCheckoutSession) => void;
  /** Fires once, when the order can no longer be paid. */
  onExpired?: (session: ClientCheckoutSession) => void;
  /** Fires once, when the order is called off by the merchant. */
  onCancelled?: (session: ClientCheckoutSession) => void;
  /**
   * Fires on a failed poll. Polling CONTINUES — a customer on a train should not lose their
   * checkout to one dropped request. Use it to show a muted "reconnecting" hint, not an error page.
   */
  onError?: (error: BitnormousError) => void;
  /** Override the adaptive cadence with a fixed interval, in ms. */
  intervalMs?: number;
}

/** Stop watching. Idempotent. */
export type Unsubscribe = () => void;

/**
 * How often to poll, given where the order is.
 *
 * Money in flight deserves a fast tick — the customer is staring at the screen waiting for the
 * green tick, and two seconds of lag reads as "it didn't work". Before they have even picked an
 * asset there is nothing to see, so polling slowly there costs nothing and saves everyone's rate
 * limit.
 */
const POLL_INTERVALS = {
  /** Funds seen on-chain, confirming. The moment that matters most. */
  processing: 2_000,
  /** An address is on screen and the customer is sending. */
  awaitingPayment: 3_000,
  /** No asset picked yet: nothing can change without the customer acting. */
  idle: 8_000,
} as const;

/** Backoff applied to the next tick after a failed poll, capped. */
const ERROR_BACKOFF_MS = 5_000;
const MAX_INTERVAL_MS = 30_000;

export class CheckoutClient {
  readonly sessionId: string;

  private readonly transport: Transport;

  constructor(options: CheckoutClientOptions) {
    if (!options.sessionId || !options.clientSecret) {
      throw new BitnormousError(
        'A checkout session id and client secret are required. Both come from the ' +
          'checkout session your server created.',
        { code: 'missing_checkout_credentials' },
      );
    }

    this.sessionId = options.sessionId;
    this.transport = new Transport({
      ...options,
      // A header rather than a query parameter: query strings end up in access logs, browser
      // history and `Referer`. Same reason the hosted URL keeps it in the fragment.
      headers: { 'X-Checkout-Client-Secret': options.clientSecret },
    });
  }

  /** Read the order: status, merchant, payable assets, and the live payment leg. */
  retrieve(signal?: AbortSignal): Promise<ClientCheckoutSession> {
    return this.transport.request<ClientCheckoutSession>(
      `/pay/checkout/${encodeURIComponent(this.sessionId)}`,
      signal ? { signal } : {},
    );
  }

  /**
   * Choose what to pay in.
   *
   * Prices the order at the rate current right now and binds a fresh address to it. Send an
   * `ecurrency.id` from `accepted` — never a chain; which rail an asset settles on is custody's
   * business, and comes back on `payment.chain`.
   */
  selectAsset(ecurrencyId: number, signal?: AbortSignal): Promise<ClientCheckoutSession> {
    return this.transport.request<ClientCheckoutSession>(
      `/pay/checkout/${encodeURIComponent(this.sessionId)}/select`,
      { method: 'POST', body: { ecurrency_id: ecurrencyId }, ...(signal ? { signal } : {}) },
    );
  }

  /**
   * Watch the order until it settles.
   *
   * @example
   * ```ts
   * const stop = client.watch({
   *   onUpdate: (session) => render(session),
   *   onSuccess: (session) => showReceipt(session),
   * });
   *
   * // Always clean up — on unmount, on close, on navigation.
   * stop();
   * ```
   */
  watch(options: WatchOptions = {}): Unsubscribe {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let lastSignature = '';
    let settled = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = (delay: number) => {
      clearTimer();
      if (!stopped) {
        timer = setTimeout(poll, Math.min(delay, MAX_INTERVAL_MS));
      }
    };

    const poll = async (): Promise<void> => {
      if (stopped) {
        return;
      }

      try {
        const session = await this.retrieve(controller.signal);
        if (stopped) {
          return;
        }

        // Only announce real movement: an idle re-derive returns an identical body every few
        // seconds and must not re-render the checkout or re-fire a callback.
        const signature = signatureOf(session);
        if (signature !== lastSignature) {
          lastSignature = signature;
          options.onUpdate?.(session);
        }

        if (!settled && isTerminal(session)) {
          settled = true;
          stopped = true;
          clearTimer();

          if (session.status === 'completed') {
            options.onSuccess?.(session);
          } else if (session.status === 'cancelled') {
            options.onCancelled?.(session);
          } else {
            options.onExpired?.(session);
          }
          return;
        }

        schedule(options.intervalMs ?? intervalFor(session));
      } catch (error) {
        if (stopped) {
          return;
        }

        // Keep polling through a blip. A customer mid-payment loses nothing to one failed read,
        // and giving up here would strand a payment that is about to land.
        options.onError?.(
          error instanceof BitnormousError ? error : new BitnormousError('Could not read the checkout.', { cause: error }),
        );
        schedule((options.intervalMs ?? POLL_INTERVALS.awaitingPayment) + ERROR_BACKOFF_MS);
      }
    };

    // A hidden tab is the normal case here: the customer has switched to their wallet app to send
    // the payment. Polling on into the background drains their battery and buys nothing, so sleep
    // and read once immediately on return — which is also exactly when they expect the tick.
    const onVisibility = () => {
      if (stopped) {
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void poll();
      } else {
        clearTimer();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    void poll();

    return () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTimer();
      controller.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }
}

function isTerminal(session: ClientCheckoutSession): boolean {
  return session.status === 'completed' || session.status === 'expired' || session.status === 'cancelled';
}

function intervalFor(session: ClientCheckoutSession): number {
  if (session.status === 'processing') {
    return POLL_INTERVALS.processing;
  }

  return session.payment ? POLL_INTERVALS.awaitingPayment : POLL_INTERVALS.idle;
}

/** The fields whose movement is worth a re-render. */
function signatureOf(session: ClientCheckoutSession): string {
  return [
    session.status,
    session.payment?.id ?? '',
    session.payment?.status ?? '',
    session.payment?.received_amount ?? '',
    session.payment?.address ?? '',
  ].join('|');
}
