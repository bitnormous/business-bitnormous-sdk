/**
 * Webhook verification on Node.
 *
 * The isomorphic verifier in `@bitnormous/business-core` is async because Web Crypto is. On a
 * server you usually want the synchronous one: `node:crypto` gives a real `timingSafeEqual`, and a
 * webhook handler reads better when verification is not another `await` between the request
 * arriving and the decision to trust it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { BitnormousSignatureError, type WebhookEvent, type VerifyWebhookOptions } from '@bitnormous/business-core';

export type VerifyOptions = Omit<VerifyWebhookOptions, 'payload'> & {
  /**
   * The raw body, exactly as received.
   *
   * A `Buffer` is ideal. If it is already a parsed object you cannot verify it — see the note in
   * {@link constructEvent} about capturing the raw body first.
   */
  payload: string | Buffer | Uint8Array;
};

/**
 * Verify a delivery and return the parsed event. Synchronous.
 *
 * @example Express
 * ```ts
 * import express from 'express';
 * import { constructEvent } from '@bitnormous/business-node';
 *
 * // `express.raw` MUST come before any JSON body parser on this route.
 * app.post('/webhooks/bitnormous', express.raw({ type: 'application/json' }), (req, res) => {
 *   let event;
 *   try {
 *     event = constructEvent({
 *       payload: req.body,
 *       signature: req.header('X-Bitnormous-Signature'),
 *       secret: process.env.BITNORMOUS_WEBHOOK_SECRET!,
 *     });
 *   } catch {
 *     return res.sendStatus(400);
 *   }
 *
 *   res.sendStatus(200);         // acknowledge fast; we retry anything slow
 *   void handle(event);          // then do the work
 * });
 * ```
 */
export function constructEvent<T = unknown>(options: VerifyOptions): WebhookEvent<T> {
  const payload = toText(options.payload);

  assertSignature(payload, options);

  try {
    return JSON.parse(payload) as WebhookEvent<T>;
  } catch {
    throw new BitnormousSignatureError('The webhook signature verified but the body was not valid JSON.');
  }
}

/** `true`/`false` instead of throwing. Prefer {@link constructEvent} — it tells you why. */
export function verifyWebhookSignature(options: VerifyOptions): boolean {
  try {
    assertSignature(toText(options.payload), options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign a payload the way Bitnormous does, for building fixtures in your own tests.
 *
 * Use this to exercise your real handler end to end rather than stubbing out verification and
 * shipping an endpoint that has never seen a signature.
 */
export function signPayload(payload: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${payload}`)}`;
}

function assertSignature(payload: string, options: VerifyOptions): void {
  const tolerance = options.toleranceSeconds ?? 300;

  if (!options.signature) {
    throw new BitnormousSignatureError('No X-Bitnormous-Signature header was present on the request.');
  }
  if (!options.secret) {
    throw new BitnormousSignatureError('No webhook signing secret was supplied.');
  }

  const parts: Record<string, string> = {};
  for (const segment of options.signature.split(',')) {
    const index = segment.indexOf('=');
    if (index > 0) {
      parts[segment.slice(0, index).trim()] = segment.slice(index + 1).trim();
    }
  }

  const timestamp = Number.parseInt(parts['t'] ?? '', 10);
  const provided = parts['v1'];

  if (!Number.isFinite(timestamp) || provided === undefined) {
    throw new BitnormousSignatureError(`Malformed signature header: "${options.signature}".`);
  }

  if (tolerance > 0) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new BitnormousSignatureError(
        `The webhook timestamp is outside the ${tolerance}s tolerance — this may be a replay.`,
      );
    }
  }

  const expected = Buffer.from(hmac(options.secret, `${timestamp}.${payload}`), 'utf8');
  const actual = Buffer.from(provided, 'utf8');

  // timingSafeEqual throws on a length mismatch, so the length is checked first — and a wrong
  // length is a wrong signature either way.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new BitnormousSignatureError('The webhook signature did not match the payload.');
  }
}

function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function toText(payload: string | Buffer | Uint8Array): string {
  if (typeof payload === 'string') {
    return payload;
  }

  return Buffer.from(payload).toString('utf8');
}
