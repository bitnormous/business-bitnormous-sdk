/**
 * The whole server side of a Bitnormous integration, in one file.
 *
 * Two routes matter, and the split between them is the point:
 *
 * - `POST /api/bitnormous/checkout` creates the order. Your secret key lives here and nowhere else.
 * - `POST /webhooks/bitnormous` is where an order actually becomes fulfilled — it arrives whether
 *   or not the customer's browser survived the confirmation screen.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { Bitnormous, constructEvent } from '@bitnormous/business-node';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 4242;

const bitnormous = new Bitnormous({
  secretKey: process.env.BITNORMOUS_SECRET_KEY ?? 'sk_test_0000000000000000000000000000000000000000',
  ...(process.env.BITNORMOUS_API_URL ? { baseUrl: process.env.BITNORMOUS_API_URL } : {}),
});

/** Stand-in for your database. Prices come from HERE, never from the request body. */
const ORDERS = new Map([
  ['ORDER-102938', { id: 'ORDER-102938', total: 125, currency: 'USD', email: 'customer@example.com', status: 'awaiting_payment' }],
]);

/** Stand-in for "have I already processed this event?". Delivery is at-least-once. */
const handledEvents = new Set();

const app = express();

// ---------------------------------------------------------------------------------------------
// Webhooks — MUST be registered before express.json(), and take the raw body.
// ---------------------------------------------------------------------------------------------
app.post('/webhooks/bitnormous', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  try {
    event = constructEvent({
      payload: req.body,
      signature: req.header('X-Bitnormous-Signature'),
      secret: process.env.BITNORMOUS_WEBHOOK_SECRET ?? 'whsec_example',
    });
  } catch (error) {
    console.warn('[webhook] rejected:', error.message);
    return res.sendStatus(400);
  }

  // Acknowledge first, work second: anything slow gets retried.
  res.sendStatus(200);
  void handleEvent(event);
});

async function handleEvent(event) {
  if (handledEvents.has(event.id)) {
    return;
  }
  handledEvents.add(event.id);

  const order = ORDERS.get(event.data.reference);
  if (!order) {
    return;
  }

  switch (event.event) {
    case 'checkout_session.completed':
      order.status = 'paid';
      console.log(`[webhook] ${order.id} paid — fulfilling`);
      break;

    case 'checkout_session.processing':
      // Funds are on-chain but not credited. Hold; do not ship.
      order.status = 'confirming';
      break;

    case 'checkout_session.expired':
    case 'checkout_session.cancelled':
      order.status = 'awaiting_payment';
      console.log(`[webhook] ${order.id} ${event.event.split('.')[1]} — stock released`);
      break;
  }
}

app.use(express.json());
app.use(express.static(join(here, 'public')));

// Serve the SDK straight from the workspace build, so this example runs with no bundler at all.
// A real store would `npm install @bitnormous/business-sdk` and let its bundler handle this; the
// import map in index.html is what stands in for that here.
app.use('/sdk', express.static(join(here, '../../packages/sdk/dist')));
app.use('/core', express.static(join(here, '../../packages/core/dist')));

// ---------------------------------------------------------------------------------------------
// The endpoint the browser SDK calls.
// ---------------------------------------------------------------------------------------------
app.post('/api/bitnormous/checkout', async (req, res) => {
  const order = ORDERS.get(req.body.reference);

  if (!order) {
    return res.status(404).json({ error: 'No such order.' });
  }

  try {
    const session = await bitnormous.checkout.sessions.create(
      {
        // Priced from our own records. Trusting req.body.amount would let a customer open
        // devtools and decide what our goods cost.
        amount: order.total,
        currency: order.currency,
        reference: order.id,
        customer: { email: order.email },
        returnUrl: `http://localhost:${PORT}/?paid=${order.id}`,
        cancelUrl: `http://localhost:${PORT}/`,
        metadata: { source: 'express-example' },
      },
      { idempotencyKey: order.id },
    );

    // The browser needs exactly these two.
    res.json({ id: session.id, client_secret: session.client_secret });
  } catch (error) {
    console.error('[checkout] could not create session:', error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = ORDERS.get(req.params.id);

  return order ? res.json(order) : res.sendStatus(404);
});

app.listen(PORT, () => console.log(`Example store on http://localhost:${PORT}`));
