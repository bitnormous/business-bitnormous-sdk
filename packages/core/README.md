# @bitnormous/business-core

The isomorphic core of the Bitnormous Business SDK: transport, types, the checkout state machine
and webhook verification.

You usually want one of the packages built on it — [`@bitnormous/business-node`](../node) on a
server, [`@bitnormous/business-sdk`](../sdk) in a browser, [`@bitnormous/business-react`](../react)
in React.

Reach for this one where those do not fit: a Cloudflare Worker, a Deno edge function, or a React
Native app that needs the checkout state machine without the DOM.

```bash
npm install @bitnormous/business-core
```

```ts
// Webhook verification on the edge — Web Crypto, so it is async here.
import { constructEvent } from "@bitnormous/business-core";

const event = await constructEvent({
  payload: await request.text(),
  signature: request.headers.get("x-bitnormous-signature"),
  secret: env.BITNORMOUS_WEBHOOK_SECRET,
});
```

```ts
// The customer-side client: one order's client secret, no API key.
import { CheckoutClient } from "@bitnormous/business-core";

const client = new CheckoutClient({ sessionId, clientSecret });

const stop = client.watch({
  onUpdate: (session) => render(session),
  onSuccess: (session) => showReceipt(session),
});
```

`watch` polls faster while money is in flight, backs off when it is not, sleeps while the tab is
hidden and stops dead at a terminal status. Always call the returned unsubscribe.

## Docs

<https://docs.bitnormous.com/sdk/introduction>
