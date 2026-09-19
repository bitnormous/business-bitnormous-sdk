/**
 * Webhook verification.
 *
 * Every delivery carries `X-Bitnormous-Signature: t=<unix>,v1=<hmac>`, where the HMAC is
 * SHA-256 over `` `${t}.${rawBody}` `` keyed with your endpoint's signing secret.
 *
 * Three things decide whether your endpoint is actually secure, and all three are easy to get
 * wrong:
 *
 * 1. **Verify the RAW body.** `JSON.parse` then `JSON.stringify` will re-order keys and re-escape
 *    slashes, and the signature will never match. Capture the bytes before any body parser runs.
 * 2. **Keep the tolerance.** Without it, anyone who ever captured one valid delivery can replay it
 *    forever. The default of 5 minutes is the right answer unless you know otherwise.
 * 3. **Deduplicate on `event.id`.** Delivery is at-least-once: a slow `200` means you will see the
 *    same event again. Fulfilling an order twice is a real bug, not a theoretical one.
 *
 * This implementation uses Web Crypto, so it runs unchanged on Node 18+, Bun, Deno, Cloudflare
 * Workers and Vercel Edge.
 */

import { BitnormousSignatureError } from './errors.js';
import type { WebhookEvent } from './types.js';

/** The header Bitnormous signs every delivery with. */
export const SIGNATURE_HEADER = 'x-bitnormous-signature';

/** The header carrying the event name, if you want to route before verifying. */
export const EVENT_HEADER = 'x-bitnormous-webhook-event';

/** The header carrying the delivery id (distinct from the event id — a redelivery gets a new one). */
export const DELIVERY_HEADER = 'x-bitnormous-webhook-id';

export interface VerifyWebhookOptions {
  /**
   * The raw request body, exactly as received — a string or the bytes.
   *
   * If your framework has already parsed it into an object, you cannot verify it. Configure the
   * route to keep the raw body first.
   */
  payload: string | Uint8Array;
  /** The `X-Bitnormous-Signature` header value. */
  signature: string | null | undefined;
  /** The endpoint's signing secret, from the dashboard. */
  secret: string;
  /**
   * How far out of date a delivery may be, in seconds. Default: 300.
   *
   * Set it to `0` only to verify a stored fixture in a test — never on a live endpoint.
   */
  toleranceSeconds?: number;
  /** Override "now", in seconds since the epoch. For tests. */
  now?: number;
}

/**
 * Verify a delivery and return the parsed event.
 *
 * Throws {@link BitnormousSignatureError} if anything is off — a bad signature, a stale timestamp,
 * a malformed header. Let it reject the request; never fall through to processing.
 *
 * @example
 * ```ts
 * app.post('/webhooks/bitnormous', express.raw({ type: 'application/json' }), async (req, res) => {
 *   let event;
 *   try {
 *     event = await constructEvent({
 *       payload: req.body,                                  // a Buffer, not a parsed object
 *       signature: req.header('X-Bitnormous-Signature'),
 *       secret: process.env.BITNORMOUS_WEBHOOK_SECRET!,
 *     });
 *   } catch {
 *     return res.sendStatus(400);
 *   }
 *
 *   // Acknowledge FIRST, then do the slow work: we retry anything that is not a prompt 2xx.
 *   res.sendStatus(200);
 *
 *   if (event.event === 'checkout_session.completed' && !(await alreadyHandled(event.id))) {
 *     await fulfil(event.data.reference);
 *   }
 * });
 * ```
 */
export async function constructEvent<T = unknown>(options: VerifyWebhookOptions): Promise<WebhookEvent<T>> {
  const payload = toText(options.payload);

  await assertSignature(payload, options);

  try {
    return JSON.parse(payload) as WebhookEvent<T>;
  } catch {
    throw new BitnormousSignatureError('The webhook signature verified but the body was not valid JSON.');
  }
}

/**
 * Verify a delivery without parsing it — `true` or `false`, no throwing.
 *
 * Prefer {@link constructEvent}: it gives you the typed event and a reason when it fails.
 */
export async function verifyWebhookSignature(options: VerifyWebhookOptions): Promise<boolean> {
  try {
    await assertSignature(toText(options.payload), options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign a payload the way Bitnormous does.
 *
 * Exported so you can build realistic fixtures in your own test suite rather than mocking the
 * verifier away and shipping an endpoint nobody has actually exercised.
 */
export async function signPayload(payload: string, secret: string, timestamp: number): Promise<string> {
  const v1 = await hmacHex(secret, `${timestamp}.${payload}`);

  return `t=${timestamp},v1=${v1}`;
}

async function assertSignature(payload: string, options: VerifyWebhookOptions): Promise<void> {
  const { signature, secret } = options;
  const tolerance = options.toleranceSeconds ?? 300;

  if (!signature) {
    throw new BitnormousSignatureError('No X-Bitnormous-Signature header was present on the request.');
  }
  if (!secret) {
    throw new BitnormousSignatureError('No webhook signing secret was supplied.');
  }

  const parts = parseHeader(signature);
  const timestamp = Number.parseInt(parts['t'] ?? '', 10);
  const provided = parts['v1'];

  if (!Number.isFinite(timestamp) || provided === undefined) {
    throw new BitnormousSignatureError(`Malformed signature header: "${signature}".`);
  }

  if (tolerance > 0) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new BitnormousSignatureError(
        `The webhook timestamp is outside the ${tolerance}s tolerance — this may be a replay.`,
      );
    }
  }

  const expected = await hmacHex(secret, `${timestamp}.${payload}`);

  if (!timingSafeEqual(expected, provided)) {
    throw new BitnormousSignatureError('The webhook signature did not match the payload.');
  }
}

/** `t=1710000000,v1=abc…` into `{t, v1}`. Unknown keys are ignored so new ones can be added. */
function parseHeader(header: string): Record<string, string> {
  const parts: Record<string, string> = {};

  for (const segment of header.split(',')) {
    const index = segment.indexOf('=');
    if (index > 0) {
      parts[segment.slice(0, index).trim()] = segment.slice(index + 1).trim();
    }
  }

  return parts;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new BitnormousSignatureError(
      'Web Crypto is unavailable. Use Node 18+, or verify with @bitnormous/business-node.',
    );
  }

  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await subtle.sign('HMAC', key, encoder.encode(message));

  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare in time that does not depend on WHERE the strings differ.
 *
 * A `===` on a secret leaks its prefix: it returns faster the earlier the mismatch, and enough
 * timed attempts recover the value a byte at a time. The length check is deliberately not
 * short-circuited into the loop for the same reason.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return mismatch === 0;
}

function toText(payload: string | Uint8Array): string {
  return typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
}
