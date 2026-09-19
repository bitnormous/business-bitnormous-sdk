/**
 * The Bitnormous Business API, as TypeScript.
 *
 * Two casing rules, applied without exception, so you never have to guess which one you are
 * looking at:
 *
 * - **What you write is camelCase.** Options, callbacks and request payloads are ordinary
 *   JavaScript. The SDK maps them to the wire format for you.
 * - **What you read is snake_case.** Resource objects mirror the REST API field for field, so the
 *   API reference at docs.bitnormous.com *is* the SDK reference. There is no second vocabulary to
 *   learn and nothing to drift out of sync when the API adds a field.
 */

/** Which set of keys, and therefore which world the money is in. Inferred from the key prefix. */
export type BitnormousEnvironment = 'test' | 'live';

/**
 * Money is a decimal STRING everywhere, never a number.
 *
 * `0.1 + 0.2 !== 0.3`, and a float cannot hold 8 decimal places of BTC without losing value at the
 * bottom. Amounts arrive from the API as strings and the SDK keeps them that way — use
 * {@link formatAmount} to display one, and a decimal library if you must do arithmetic.
 */
export type Decimal = string;

/** ISO-4217, uppercase. */
export type CurrencyCode = string;

// ---------------------------------------------------------------------------------------------
// Checkout sessions — the ORDER
// ---------------------------------------------------------------------------------------------

/**
 * Where an order is in its life.
 *
 * - `open` — payable. The customer may still pick, or re-pick, an asset.
 * - `processing` — funds are on-chain but not yet credited. **Do not release goods yet.**
 * - `completed` — paid in full. Terminal.
 * - `expired` — the window lapsed unpaid. Terminal.
 * - `cancelled` — the merchant called it off. Terminal.
 */
export type CheckoutSessionStatus = 'open' | 'processing' | 'completed' | 'expired' | 'cancelled';

/** Where one payment ATTEMPT is. An order may go through several of these. */
export type PaymentStatus = 'pending' | 'detected' | 'paid' | 'expired';

export interface CheckoutCustomer {
  email?: string;
  name?: string;
  /** Your own id for this customer. */
  reference?: string;
}

/**
 * The payment leg: one attempt to pay an order, bound to its own address and its own clock.
 *
 * `null` on a checkout until the customer picks an asset.
 */
export interface PaymentLeg {
  id: string;
  status: PaymentStatus;
  /** e.g. `USDT`. The asset the customer is sending. */
  asset: string;
  /** e.g. `trc20`. Derived from custody — the customer never picks a chain. */
  chain: string;
  /** Exactly how much of `asset` to send, scale 8. */
  amount: Decimal;
  /** How much has credited so far. A partial payment leaves the order open. */
  received_amount: Decimal;
  /** The fiat this was priced from, scale 2. */
  fiat_amount: Decimal | null;
  fiat_currency: CurrencyCode | null;
  /** Fiat units per whole asset unit, snapshotted when the customer picked. */
  rate: Decimal | null;
  reference: string | null;
  /**
   * Where to send the coins. Briefly `null` while custody allocates — show a skeleton and keep
   * polling rather than an empty box.
   */
  address: string | null;
  /** Destination tag / memo on chains that need one. Sending without it can lose the payment. */
  memo: string | null;
  /** A BIP-21 style deep link with the amount prefilled, for an "Open in wallet" button. */
  payment_uri: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string | null;
}

/** The merchant header the checkout renders. */
export interface CheckoutMerchant {
  slug: string;
  display_name: string;
  logo_url: string | null;
  country: string | null;
  support_email: string | null;
}

/** One chain a merchant can be paid on, as the picker renders it. */
export interface AcceptedChain {
  chain: string;
  /** Below this the deposit could never credit. Surface it before the customer commits. */
  min_amount: Decimal | null;
  confirmations_required: number;
  memo_supported: boolean;
  /**
   * The catalogue row to send to `select`. `null` means the pair is payable but the catalogue
   * describes no row for it, so it cannot be picked by id.
   */
  ecurrency: {
    id: number;
    slug: string;
    name: string;
    short_name: string;
    image: string | null;
  } | null;
}

export interface AcceptedAsset {
  asset: string;
  chains: AcceptedChain[];
}

/** An order, as the merchant's server sees it. */
export interface CheckoutSession {
  id: string;
  object: 'checkout_session';
  status: CheckoutSessionStatus;
  /** The fiat amount to collect, scale 2. */
  amount: Decimal;
  currency: CurrencyCode;
  reference: string | null;
  customer: CheckoutCustomer | null;
  return_url: string | null;
  cancel_url: string | null;
  metadata: Record<string, unknown> | null;
  payment: PaymentLeg | null;
  expires_at: string;
  completed_at: string | null;
  created_at: string | null;
}

/**
 * What `checkout.sessions.create` returns, and the only time the browser credential exists.
 *
 * `client_secret` is never returned by any later read. Hand it to the browser; never log it, never
 * put it in a URL you control (the hosted `url` already carries it in the fragment, which browsers
 * do not send to servers).
 */
export interface CreatedCheckoutSession extends CheckoutSession {
  client_secret: string;
  /** The hosted checkout, secret included. Redirect here, or hand the pair to the SDK. */
  url: string;
}

/** An order as the customer's browser sees it: no metadata, plus who they are paying. */
export interface ClientCheckoutSession extends Omit<CheckoutSession, 'metadata'> {
  merchant: CheckoutMerchant;
  /** Build the asset picker from this, never from the full catalogue. */
  accepted?: AcceptedAsset[];
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export interface CreateCheckoutSessionParams {
  /** The fiat amount to collect. A number is fine here — it is yours, not the chain's. */
  amount: number | Decimal;
  /** Defaults to your settlement currency. */
  currency?: CurrencyCode;
  /** Your own order number. Echoed on every webhook; this is what you reconcile against. */
  reference?: string;
  customer?: CheckoutCustomer;
  /** Where to send the customer after a successful payment. */
  returnUrl?: string;
  /** Where to send them if they abandon the checkout. */
  cancelUrl?: string;
  /** Stored with the order, returned on every read, never shown to the customer. */
  metadata?: Record<string, unknown>;
}

export interface ListCheckoutSessionsParams {
  status?: CheckoutSessionStatus;
  reference?: string;
  page?: number;
  perPage?: number;
}

/** The API's list envelope. */
export interface Paginated<T> {
  data: T[];
  meta: {
    current_page: number;
    per_page: number;
    from: number | null;
    to: number | null;
    total: number;
    last_page: number;
  };
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

/**
 * Every event Bitnormous can send you.
 *
 * For fulfilling an order, subscribe to `checkout_session.*` — one order, whatever it took to pay
 * it. The `payment_session.*` family is the attempt-level detail underneath, and a single order
 * may emit several if the customer switches asset.
 */
export type WebhookEventName =
  | 'checkout_session.processing'
  | 'checkout_session.completed'
  | 'checkout_session.expired'
  | 'checkout_session.cancelled'
  | 'payment_session.paid'
  | 'payment_session.expired'
  | 'crypto_deposit.detected'
  | 'crypto_deposit.credited'
  | 'crypto_deposit.on_hold'
  | 'crypto_deposit.rejected'
  | 'deposit_address.activated'
  | 'ramp_order.created'
  | 'ramp_order.deposit_detected'
  | 'ramp_order.confirming'
  | 'ramp_order.settling'
  | 'ramp_order.completed'
  | 'ramp_order.failed'
  | 'ramp_order.expired'
  | 'ramp_order.cancelled'
  | 'fiat.deposit.confirmed'
  | 'fiat.payout.settled'
  | 'fiat.payout.failed'
  | 'withdrawal.awaiting_approval'
  | 'withdrawal.processing'
  | 'withdrawal.completed'
  | 'withdrawal.failed'
  | 'withdrawal.cancelled'
  | 'swap.completed'
  | 'transfer.completed'
  | 'webhook.test';

export interface WebhookEvent<T = unknown> {
  /** Unique per event. Store it and ignore repeats — delivery is at-least-once. */
  id: string;
  event: WebhookEventName;
  occurred_at: string;
  data: T;
}

/** The shape of a `checkout_session.*` delivery. */
export type CheckoutSessionEvent = WebhookEvent<CheckoutSession>;
