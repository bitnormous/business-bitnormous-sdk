/**
 * The contract between the hosted checkout and whatever embeds it.
 *
 * The checkout runs in an iframe on `checkout.bitnormous.com`, which means it is on a different
 * origin from the merchant's page — deliberately, so merchant JavaScript cannot read what the
 * customer types and merchant CSS cannot reshape a payment screen. `postMessage` is therefore the
 * only channel between them, and this module is its vocabulary.
 *
 * Both sides import these constants. If you are writing your own embedder, the rules are:
 *
 * - **Always check `event.origin`** against the checkout origin before trusting a message. Any page
 *   on the internet can post to your window.
 * - **Always check `source`** is {@link PROTOCOL_SOURCE}. Other embedded widgets post too.
 * - Treat an unknown `type` as a no-op, never an error — it is how this protocol grows without
 *   breaking older SDKs pinned in the wild.
 */

import type { ClientCheckoutSession } from './types.js';

/** Stamped on every message so a listener can tell ours from the rest of the page's traffic. */
export const PROTOCOL_SOURCE = 'bitnormous-checkout';

/** Bumped only on a breaking change; the checkout supports the previous version for a year. */
export const PROTOCOL_VERSION = 1;

/** Why a checkout closed. `success` is the only one that means money moved. */
export type CheckoutCloseReason = 'success' | 'dismissed' | 'expired' | 'cancelled' | 'error';

/** Messages the checkout sends OUT to its embedder. */
export type CheckoutOutboundMessage =
  /** The checkout has loaded and painted. Hide your skeleton on this, not on the iframe's onload. */
  | { type: 'ready' }
  /** Embedded mode: the content changed height and the iframe should follow it. */
  | { type: 'resize'; height: number }
  /** Any movement in the order, including the first read. */
  | { type: 'status'; session: ClientCheckoutSession }
  /** Paid in full. Fires once. */
  | { type: 'success'; session: ClientCheckoutSession }
  /** The customer or the checkout is done. Tear down the modal. */
  | { type: 'close'; reason: CheckoutCloseReason; session?: ClientCheckoutSession }
  /** Something went wrong the customer cannot fix, e.g. the session could not be loaded. */
  | { type: 'error'; message: string; code?: string };

/** Messages an embedder sends IN to the checkout. */
export type CheckoutInboundMessage =
  /** Sent once when the frame reports `ready`, carrying presentation preferences. */
  | { type: 'init'; theme?: 'light' | 'dark' | 'auto'; locale?: string; embedded?: boolean }
  /** Ask the checkout to shut down — the merchant closed the modal from outside. */
  | { type: 'close' };

/** The envelope both directions travel in. */
export interface CheckoutMessageEnvelope<T> {
  source: typeof PROTOCOL_SOURCE;
  version: number;
  /** The `cs_…` this message concerns, so one page can host two checkouts without crossing wires. */
  sessionId: string;
  payload: T;
}

export function envelope<T>(sessionId: string, payload: T): CheckoutMessageEnvelope<T> {
  return { source: PROTOCOL_SOURCE, version: PROTOCOL_VERSION, sessionId, payload };
}

/**
 * Narrow an arbitrary `MessageEvent` to one of ours.
 *
 * Returns the payload, or `null` when the message is not a Bitnormous message for this session —
 * including when it came from the wrong origin, which is the check that actually matters.
 */
export function readMessage<T>(
  event: MessageEvent,
  expected: { origin: string; sessionId: string },
): T | null {
  if (event.origin !== expected.origin) {
    return null;
  }

  const data = event.data as Partial<CheckoutMessageEnvelope<T>> | null | undefined;

  if (!data || typeof data !== 'object' || data.source !== PROTOCOL_SOURCE) {
    return null;
  }

  if (data.sessionId !== expected.sessionId) {
    return null;
  }

  return (data.payload ?? null) as T | null;
}
