import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { constructEvent, verifyWebhookSignature, signPayload, BitnormousSignatureError } from '../dist/index.js';

const SECRET = 'whsec_test_deadbeef';
const BODY = JSON.stringify({
  id: 'evt_01k5',
  event: 'checkout_session.completed',
  occurred_at: '2026-09-18T10:00:00+00:00',
  data: { id: 'cs_01k5', status: 'completed', amount: '125.00', currency: 'USD' },
});

const at = (timestamp, body = BODY, secret = SECRET) =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

describe('webhook verification', () => {
  test('accepts a delivery signed the way the API signs it', async () => {
    const now = 1_760_000_000;
    const event = await constructEvent({ payload: BODY, signature: at(now), secret: SECRET, now });

    assert.equal(event.event, 'checkout_session.completed');
    assert.equal(event.data.id, 'cs_01k5');
  });

  test('signPayload agrees byte for byte with the server recipe', async () => {
    const now = 1_760_000_000;
    assert.equal(await signPayload(BODY, SECRET, now), at(now));
  });

  test('verifies raw bytes as well as a string, so Buffer bodies work', async () => {
    const now = 1_760_000_000;
    const event = await constructEvent({
      payload: new TextEncoder().encode(BODY),
      signature: at(now),
      secret: SECRET,
      now,
    });
    assert.equal(event.id, 'evt_01k5');
  });

  test('rejects a body that was re-serialised rather than kept raw', async () => {
    const now = 1_760_000_000;
    // The classic mistake: parse then stringify. Key order survives here, but the API emits
    // unescaped slashes (JSON_UNESCAPED_SLASHES) and JSON.stringify does not.
    const reserialised = JSON.stringify({ ...JSON.parse(BODY), data: { extra: 1 } });

    await assert.rejects(
      () => constructEvent({ payload: reserialised, signature: at(now), secret: SECRET, now }),
      BitnormousSignatureError,
    );
  });

  test('rejects a tampered payload', async () => {
    const now = 1_760_000_000;
    const signature = at(now);
    const tampered = BODY.replace('125.00', '1.00');

    assert.equal(await verifyWebhookSignature({ payload: tampered, signature, secret: SECRET, now }), false);
  });

  test('rejects a signature made with the wrong secret', async () => {
    const now = 1_760_000_000;
    const signature = at(now, BODY, 'whsec_someone_elses');

    assert.equal(await verifyWebhookSignature({ payload: BODY, signature, secret: SECRET, now }), false);
  });

  test('rejects a replay outside the tolerance window', async () => {
    const signedAt = 1_760_000_000;
    const now = signedAt + 301;

    await assert.rejects(
      () => constructEvent({ payload: BODY, signature: at(signedAt), secret: SECRET, now }),
      (error) => error instanceof BitnormousSignatureError && /replay/i.test(error.message),
    );

    // Inside the window it still verifies.
    const event = await constructEvent({ payload: BODY, signature: at(signedAt), secret: SECRET, now: signedAt + 299 });
    assert.equal(event.id, 'evt_01k5');
  });

  test('rejects a future timestamp just as firmly as a stale one', async () => {
    const signedAt = 1_760_000_000;
    assert.equal(
      await verifyWebhookSignature({ payload: BODY, signature: at(signedAt), secret: SECRET, now: signedAt - 600 }),
      false,
    );
  });

  test('rejects malformed and missing headers instead of throwing something unhelpful', async () => {
    for (const signature of [null, undefined, '', 'nonsense', 't=abc,v1=xyz', 'v1=onlythis']) {
      await assert.rejects(
        () => constructEvent({ payload: BODY, signature, secret: SECRET, now: 1_760_000_000 }),
        BitnormousSignatureError,
      );
    }
  });

  test('a tolerance of 0 disables the clock check, for stored fixtures', async () => {
    const signedAt = 1_600_000_000;
    const event = await constructEvent({
      payload: BODY,
      signature: at(signedAt),
      secret: SECRET,
      toleranceSeconds: 0,
      now: 1_760_000_000,
    });
    assert.equal(event.id, 'evt_01k5');
  });
});
