# @bitnormous/business-node

The server half of a Bitnormous integration: create checkout sessions, verify webhooks.

```bash
npm install @bitnormous/business-node
```

```ts
import { Bitnormous } from "@bitnormous/business-node";

const bitnormous = new Bitnormous({ secretKey: process.env.BITNORMOUS_SECRET_KEY! });

const session = await bitnormous.checkout.sessions.create(
  { amount: 125, currency: "USD", reference: "ORDER-102938" },
  { idempotencyKey: "ORDER-102938" },
);

session.url;            // redirect the customer here
session.client_secret;  // or hand this to @bitnormous/business-sdk for a modal
```

Constructing this in a browser throws. A leaked `sk_live_…` is the whole account, and the browser
does not need it — it uses a checkout session's `client_secret` instead.

## Webhooks

```ts
import { constructEvent } from "@bitnormous/business-node";

const event = constructEvent({
  payload: req.body,                                  // RAW bytes — `express.raw()`, not `express.json()`
  signature: req.header("X-Bitnormous-Signature"),
  secret: process.env.BITNORMOUS_WEBHOOK_SECRET!,
});
```

Verification is synchronous here (`node:crypto`). The three ways to get a webhook endpoint wrong:
verifying a re-serialised body, dropping the timestamp tolerance, and not deduplicating on
`event.id` — delivery is at-least-once.

`signPayload` builds a real signature so you can test the endpoint you are actually shipping.

## Docs

<https://docs.bitnormous.com/sdk/server>
