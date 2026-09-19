import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  Bitnormous,
  BitnormousAuthenticationError,
  BitnormousConnectionError,
  BitnormousError,
  BitnormousNotFoundError,
  BitnormousRateLimitError,
  BitnormousRuleError,
  BitnormousServerError,
  BitnormousValidationError,
  ErrorCodes,
} from '../dist/index.js';

/** A fetch stand-in that replays scripted responses and records what it was asked. */
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];

  const impl = async (url, init) => {
    calls.push({ url, init, headers: init?.headers ?? {} });
    const next = queue.length > 1 ? queue.shift() : queue[0];

    if (next instanceof Error) {
      throw next;
    }

    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: next.headers ?? { 'content-type': 'application/json' },
    });
  };

  return { impl, calls };
}

const ok = (data) => ({ status: 200, body: { status: 'success', success: true, message: 'ok', data, code: 200 } });

const client = (fetchImpl, options = {}) =>
  new Bitnormous({
    secretKey: 'sk_test_' + 'x'.repeat(40),
    fetch: fetchImpl,
    backoffMs: 1,
    ...options,
  });

describe('transport', () => {
  test('unwraps the platform envelope so callers never see it', async () => {
    const { impl, calls } = stubFetch([ok({ id: 'cs_1', status: 'open' })]);

    const session = await client(impl).checkout.sessions.retrieve('cs_1');

    assert.equal(session.id, 'cs_1');
    assert.match(calls[0].url, /\/api\/v1\/business\/checkout-sessions\/cs_1$/);
  });

  test('sends the secret key as a bearer token and identifies itself', async () => {
    const { impl, calls } = stubFetch([ok({ id: 'cs_1' })]);

    await client(impl).checkout.sessions.retrieve('cs_1');

    assert.match(calls[0].headers.Authorization, /^Bearer sk_test_/);
    assert.match(calls[0].headers['X-Bitnormous-Client'], /^bitnormous-business-sdk\//);
  });

  test('maps camelCase options onto the API wire format', async () => {
    const { impl, calls } = stubFetch([{ status: 201, body: { data: { id: 'cs_1' } } }]);

    await client(impl).checkout.sessions.create(
      {
        amount: 125,
        currency: 'USD',
        reference: 'ORDER-102938',
        customer: { email: 'a@b.com' },
        returnUrl: 'https://store.example/thanks',
        cancelUrl: 'https://store.example/cart',
        metadata: { cart: 'ck_1' },
      },
      { idempotencyKey: 'ORDER-102938' },
    );

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.return_url, 'https://store.example/thanks');
    assert.equal(body.cancel_url, 'https://store.example/cart');
    assert.equal(body.amount, 125);
    assert.equal(calls[0].headers['Idempotency-Key'], 'ORDER-102938');
  });

  test('serialises list filters into the query string, dropping undefined', async () => {
    const { impl, calls } = stubFetch([ok({ data: [], meta: {} })]);

    await client(impl).checkout.sessions.list({ status: 'completed', perPage: 50 });

    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('status'), 'completed');
    assert.equal(url.searchParams.get('per_page'), '50');
    assert.equal(url.searchParams.has('reference'), false);
  });

  describe('error mapping', () => {
    test('reads Laravel validation errors into fieldErrors', async () => {
      const { impl } = stubFetch([
        {
          status: 422,
          body: { message: 'The amount must be greater than 0.', errors: { amount: ['The amount must be greater than 0.'] } },
        },
      ]);

      await assert.rejects(
        () => client(impl).checkout.sessions.create({ amount: 0 }),
        (error) => {
          assert.ok(error instanceof BitnormousValidationError);
          assert.equal(error.first('amount'), 'The amount must be greater than 0.');
          return true;
        },
      );
    });

    test('reads typed business rule codes out of the platform envelope', async () => {
      const { impl } = stubFetch([
        {
          status: 422,
          body: { status: 'error', success: false, message: 'A [cancelled] checkout cannot be cancelled.', data: { error_code: 'not_cancellable' }, code: 422 },
        },
      ]);

      await assert.rejects(
        () => client(impl).checkout.sessions.cancel('cs_1'),
        (error) => {
          assert.ok(error instanceof BitnormousRuleError);
          assert.equal(error.code, ErrorCodes.NOT_CANCELLABLE);
          return true;
        },
      );
    });

    test('maps 401 and 404, including the bare routing envelope', async () => {
      const auth = stubFetch([{ status: 401, body: { status: 'error', message: 'Invalid or missing API key.', data: [] } }]);
      await assert.rejects(() => client(auth.impl).checkout.sessions.retrieve('cs_1'), BitnormousAuthenticationError);

      const missing = stubFetch([{ status: 404, body: { message: 'Route not found.' } }]);
      await assert.rejects(() => client(missing.impl).checkout.sessions.retrieve('cs_x'), BitnormousNotFoundError);
    });

    test('surfaces Retry-After on a rate limit', async () => {
      const { impl } = stubFetch([
        { status: 429, body: { message: 'Too Many Requests.' }, headers: { 'content-type': 'application/json', 'retry-after': '7' } },
      ]);

      await assert.rejects(
        () => client(impl, { maxRetries: 0 }).checkout.sessions.retrieve('cs_1'),
        (error) => {
          assert.ok(error instanceof BitnormousRateLimitError);
          assert.equal(error.retryAfter, 7);
          return true;
        },
      );
    });

    test('keeps an unparseable body for diagnosis instead of crashing', async () => {
      const { impl } = stubFetch([{ status: 502, body: undefined, headers: { 'content-type': 'text/html' } }]);
      const bad = async (url, init) => new Response('<html>502 Bad Gateway</html>', { status: 502 });

      await assert.rejects(
        () => client(bad, { maxRetries: 0 }).checkout.sessions.retrieve('cs_1'),
        (error) => {
          assert.ok(error instanceof BitnormousServerError);
          assert.match(error.raw.message, /Bad Gateway/);
          return true;
        },
      );
      void impl;
    });
  });

  describe('retries', () => {
    test('retries a GET through a 500 and returns the eventual success', async () => {
      const { impl, calls } = stubFetch([{ status: 500, body: { message: 'boom' } }, ok({ id: 'cs_1' })]);

      const session = await client(impl).checkout.sessions.retrieve('cs_1');

      assert.equal(session.id, 'cs_1');
      assert.equal(calls.length, 2);
    });

    test('retries a write ONLY when it carries an idempotency key', async () => {
      const withKey = stubFetch([{ status: 500, body: { message: 'boom' } }, { status: 201, body: { data: { id: 'cs_1' } } }]);
      const session = await client(withKey.impl).checkout.sessions.create({ amount: 10 }, { idempotencyKey: 'ORDER-1' });
      assert.equal(session.id, 'cs_1');
      assert.equal(withKey.calls.length, 2);

      // Without a key, repeating the POST could open a second payable checkout — so it must not.
      const noKey = stubFetch([{ status: 500, body: { message: 'boom' } }]);
      await assert.rejects(() => client(noKey.impl).checkout.sessions.create({ amount: 10 }), BitnormousServerError);
      assert.equal(noKey.calls.length, 1);
    });

    test('does not retry a decision the server has already made', async () => {
      const { impl, calls } = stubFetch([{ status: 422, body: { message: 'nope', data: { error_code: 'below_minimum' } } }]);

      await assert.rejects(() => client(impl).checkout.sessions.retrieve('cs_1'), BitnormousRuleError);
      assert.equal(calls.length, 1);
    });

    test('retries a dropped connection, then reports it honestly', async () => {
      const failing = async () => {
        throw Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
      };

      await assert.rejects(
        () => client(failing, { maxRetries: 1 }).checkout.sessions.retrieve('cs_1'),
        (error) => {
          assert.ok(error instanceof BitnormousConnectionError);
          assert.match(error.message, /Could not reach Bitnormous/);
          return true;
        },
      );
    });

    test('honours a caller abort signal', async () => {
      const controller = new AbortController();
      const hanging = (url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });

      const promise = client(hanging, { maxRetries: 0 }).checkout.sessions.retrieve('cs_1', { signal: controller.signal });
      controller.abort();

      await assert.rejects(promise, BitnormousConnectionError);
    });
  });
});

describe('client guards', () => {
  test('rejects a key that is not a secret key', () => {
    assert.throws(() => new Bitnormous({ secretKey: 'pk_test_abc' }), (error) => {
      assert.ok(error instanceof BitnormousError);
      assert.equal(error.code, 'invalid_secret_key');
      return true;
    });
  });

  test('rejects an empty key with an actionable message', () => {
    assert.throws(() => new Bitnormous({ secretKey: '  ' }), /secret key is required/i);
  });

  test('infers the environment from the key prefix', () => {
    assert.equal(new Bitnormous({ secretKey: 'sk_test_' + 'x'.repeat(40) }).environment, 'test');
    assert.equal(new Bitnormous({ secretKey: 'sk_live_' + 'x'.repeat(40) }).environment, 'live');
  });

  test('refuses to run a secret key in a browser', () => {
    globalThis.window = { document: {} };
    try {
      assert.throws(
        () => new Bitnormous({ secretKey: 'sk_live_' + 'x'.repeat(40) }),
        (error) => {
          assert.equal(error.code, 'secret_key_in_browser');
          return true;
        },
      );
      // The escape hatch exists for JSDOM and SSR shims.
      assert.doesNotThrow(() => new Bitnormous({ secretKey: 'sk_live_' + 'x'.repeat(40), allowBrowser: true }));
    } finally {
      delete globalThis.window;
    }
  });

  test('payments is the same resource as checkout.sessions', () => {
    const bitnormous = new Bitnormous({ secretKey: 'sk_test_' + 'x'.repeat(40) });
    assert.equal(bitnormous.payments, bitnormous.checkout.sessions);
  });
});
