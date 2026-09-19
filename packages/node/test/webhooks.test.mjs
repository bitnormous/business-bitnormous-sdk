import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { constructEvent, verifyWebhookSignature, signPayload } from '../dist/index.js';
import { constructEvent as constructEventAsync } from '@bitnormous/business-core';

const SECRET = 'whsec_test_deadbeef';
const BODY = '{"id":"evt_1","event":"checkout_session.completed","occurred_at":"2026-09-18T10:00:00+00:00","data":{"id":"cs_1","amount":"125.00"}}';
const NOW = 1_760_000_000;

describe('node webhook verification', () => {
  test('verifies its own signature', () => {
    const event = constructEvent({ payload: signedBody(), signature: signPayload(BODY, SECRET, NOW), secret: SECRET, now: NOW });
    assert.equal(event.data.id, 'cs_1');
  });

  test('accepts a Buffer body, which is what express.raw gives you', () => {
    const event = constructEvent({
      payload: Buffer.from(BODY, 'utf8'),
      signature: signPayload(BODY, SECRET, NOW),
      secret: SECRET,
      now: NOW,
    });
    assert.equal(event.id, 'evt_1');
  });

  test('agrees exactly with the isomorphic core verifier', async () => {
    const signature = signPayload(BODY, SECRET, NOW);

    const fromNode = constructEvent({ payload: BODY, signature, secret: SECRET, now: NOW });
    const fromCore = await constructEventAsync({ payload: BODY, signature, secret: SECRET, now: NOW });

    assert.deepEqual(fromNode, fromCore);
  });

  test('rejects tampering, a wrong secret and a replay', () => {
    const signature = signPayload(BODY, SECRET, NOW);

    assert.equal(verifyWebhookSignature({ payload: BODY.replace('125.00', '1.00'), signature, secret: SECRET, now: NOW }), false);
    assert.equal(verifyWebhookSignature({ payload: BODY, signature, secret: 'whsec_other', now: NOW }), false);
    assert.equal(verifyWebhookSignature({ payload: BODY, signature, secret: SECRET, now: NOW + 301 }), false);
  });

  test('a signature of the wrong length never reaches timingSafeEqual', () => {
    assert.equal(verifyWebhookSignature({ payload: BODY, signature: `t=${NOW},v1=abc`, secret: SECRET, now: NOW }), false);
  });
});

/**
 * The verifier is only worth anything if it agrees with the server that signs. This runs the
 * SAME recipe through PHP — the language the API signs in — and asserts byte equality.
 */
describe('parity with the API signer', () => {
  test('matches hash_hmac in PHP, byte for byte', (t) => {
    let php;
    try {
      php = execFileSync(
        'php',
        ['-r', `echo hash_hmac('sha256', $argv[1].'.'.$argv[2], $argv[3]);`, '--', String(NOW), BODY, SECRET],
        { encoding: 'utf8' },
      );
    } catch {
      return t.skip('php is not available on this machine');
    }

    assert.equal(signPayload(BODY, SECRET, NOW), `t=${NOW},v1=${php}`);
  });
});

function signedBody() {
  return BODY;
}
