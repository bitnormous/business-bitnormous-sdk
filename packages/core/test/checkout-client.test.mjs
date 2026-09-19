import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CheckoutClient, BitnormousError } from '../dist/index.js';

const session = (overrides = {}) => ({
  id: 'cs_1',
  object: 'checkout_session',
  status: 'open',
  amount: '125.00',
  currency: 'USD',
  reference: 'ORDER-1',
  customer: null,
  return_url: null,
  cancel_url: null,
  payment: null,
  expires_at: '2026-09-18T11:00:00+00:00',
  completed_at: null,
  created_at: '2026-09-18T10:30:00+00:00',
  merchant: { slug: 'store', display_name: 'Example Store', logo_url: null, country: 'GH', support_email: null },
  accepted: [],
  ...overrides,
});

const leg = (overrides = {}) => ({
  id: 'ps_1',
  status: 'pending',
  asset: 'USDT',
  chain: 'trc20',
  amount: '10.00000000',
  received_amount: '0.00000000',
  fiat_amount: '150.00',
  fiat_currency: 'GHS',
  rate: '15.00',
  reference: 'ORDER-1',
  address: 'test_addr_1',
  memo: null,
  payment_uri: 'tron:test_addr_1?amount=10.00000000',
  expires_at: '2026-09-18T10:45:00+00:00',
  paid_at: null,
  created_at: '2026-09-18T10:30:00+00:00',
  ...overrides,
});

/** Replays a script of bodies, one per call, repeating the last forever. */
function scriptedFetch(bodies) {
  const calls = [];
  const queue = [...bodies];

  const impl = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {}, method: init?.method ?? 'GET', body: init?.body });
    const next = queue.length > 1 ? queue.shift() : queue[0];

    if (next instanceof Error) throw next;

    return new Response(JSON.stringify({ status: 'success', success: true, message: 'ok', data: next, code: 200 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { impl, calls };
}

const make = (impl) =>
  new CheckoutClient({ sessionId: 'cs_1', clientSecret: 'csec_abc', fetch: impl, backoffMs: 1 });

describe('checkout client', () => {
  test('requires both halves of the browser credential', () => {
    assert.throws(() => new CheckoutClient({ sessionId: 'cs_1', clientSecret: '' }), (error) => {
      assert.ok(error instanceof BitnormousError);
      assert.equal(error.code, 'missing_checkout_credentials');
      return true;
    });
  });

  test('sends the client secret as a header, never in the query string', async () => {
    const { impl, calls } = scriptedFetch([session()]);

    await make(impl).retrieve();

    assert.equal(calls[0].headers['X-Checkout-Client-Secret'], 'csec_abc');
    assert.equal(new URL(calls[0].url).search, '', 'the secret must not leak into access logs');
    assert.equal(calls[0].headers.Authorization, undefined, 'no API key is involved on the customer side');
  });

  test('selects an asset by catalogue row, not by chain', async () => {
    const { impl, calls } = scriptedFetch([session({ payment: leg() })]);

    const result = await make(impl).selectAsset(3);

    assert.match(calls[0].url, /\/pay\/checkout\/cs_1\/select$/);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), { ecurrency_id: 3 });
    assert.equal(result.payment.chain, 'trc20');
  });

  describe('watch', () => {
    test('reports the first state, then only real movement', async () => {
      const { impl } = scriptedFetch([
        session({ payment: leg() }),
        session({ payment: leg() }), // identical re-derive: must NOT re-notify
        session({ status: 'processing', payment: leg({ status: 'detected' }) }),
        session({ status: 'completed', payment: leg({ status: 'paid', received_amount: '10.00000000' }) }),
      ]);

      const updates = [];
      const client = make(impl);

      const settled = await new Promise((resolve) => {
        const stop = client.watch({
          intervalMs: 1,
          onUpdate: (next) => updates.push(next.status),
          onSuccess: (next) => {
            stop();
            resolve(next);
          },
        });
      });

      assert.equal(settled.status, 'completed');
      assert.deepEqual(updates, ['open', 'processing', 'completed'], 'the duplicate poll must be silent');
    });

    test('fires onExpired and stops polling at a terminal status', async () => {
      const { impl, calls } = scriptedFetch([session({ status: 'expired' })]);

      const expired = await new Promise((resolve) => {
        make(impl).watch({ intervalMs: 1, onExpired: resolve });
      });

      assert.equal(expired.status, 'expired');

      const after = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(calls.length, after, 'a settled checkout must stop costing requests');
    });

    test('fires onCancelled when the merchant calls the order off', async () => {
      const { impl } = scriptedFetch([session({ status: 'cancelled' })]);

      const cancelled = await new Promise((resolve) => {
        make(impl).watch({ intervalMs: 1, onCancelled: resolve });
      });

      assert.equal(cancelled.status, 'cancelled');
    });

    test('the transport absorbs a single blip without the watcher ever seeing it', async () => {
      const { impl } = scriptedFetch([
        Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' }),
        session({ status: 'completed', payment: leg({ status: 'paid' }) }),
      ]);

      const errors = [];
      const settled = await new Promise((resolve) => {
        make(impl).watch({ intervalMs: 1, onError: (error) => errors.push(error), onSuccess: resolve });
      });

      assert.deepEqual(errors, [], 'one dropped request is the transport\'s problem, not the UI\'s');
      assert.equal(settled.status, 'completed');
    });

    test('keeps polling through an outage the transport could not absorb', async () => {
      const { impl } = scriptedFetch([
        Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' }),
        session({ status: 'completed', payment: leg({ status: 'paid' }) }),
      ]);

      // maxRetries: 0 pushes the failure all the way up to the watcher.
      const client = new CheckoutClient({
        sessionId: 'cs_1',
        clientSecret: 'csec_abc',
        fetch: impl,
        maxRetries: 0,
      });

      const errors = [];
      const settled = await new Promise((resolve) => {
        client.watch({ intervalMs: 1, onError: (error) => errors.push(error), onSuccess: resolve });
      });

      assert.ok(errors.length >= 1, 'the outage should be reported so the UI can show a hint');
      assert.equal(settled.status, 'completed', 'and the payment should still land afterwards');
    });

    test('unsubscribing stops the polling for good', async () => {
      const { impl, calls } = scriptedFetch([session()]);

      const stop = make(impl).watch({ intervalMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 15));
      stop();

      const after = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(calls.length, after);

      assert.doesNotThrow(stop, 'unsubscribe must be idempotent');
    });
  });
});
