<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/mark-dark.svg">
  <img src=".github/assets/mark.svg" alt="Bitnormous" height="72">
</picture>

<h1>Bitnormous Business SDK</h1>

<p><strong>Accept crypto payments on your website with a few lines of code.</strong></p>

<p>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A518-5b6ee8?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-9e72ce?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-242424?style=flat-square">
</p>

<p>
  <a href="https://docs.bitnormous.com/sdk/introduction">Documentation</a> ·
  <a href="#the-three-pieces-of-an-integration">Quick start</a> ·
  <a href="examples/express-store">Example store</a> ·
  <a href="#packages">Packages</a>
</p>

</div>

---

```js
import { BitnormousCheckout } from "@bitnormous/business-sdk";

const checkout = new BitnormousCheckout({ createSession: "/api/bitnormous/checkout" });

checkout.open({
  amount: 125,
  currency: "USD",
  reference: "ORDER-102938",
  customer: { email: "customer@example.com" },
  onSuccess: (payment) => console.log("Payment successful", payment),
  onClose: () => console.log("Checkout closed"),
});
```

There is no API key in that snippet, and that is the point. `/api/bitnormous/checkout` is **your**
endpoint; it creates the session with your secret key, on your server, and hands the browser a
credential scoped to that one order.

## Packages

| Package | Runs | Does |
| --- | --- | --- |
| [`@bitnormous/business-node`](packages/node) | Your server | Creates checkout sessions, verifies webhooks. |
| [`@bitnormous/business-sdk`](packages/sdk) | The browser | Modal, redirect and embedded checkout. |
| [`@bitnormous/business-react`](packages/react) | React / Next.js | Hooks and components. |
| [`@bitnormous/business-core`](packages/core) | Anywhere | The isomorphic core — Workers, Deno, React Native. |

TypeScript throughout, no runtime dependencies beyond `fetch`.

```bash
npm install @bitnormous/business-node     # server
npm install @bitnormous/business-sdk      # browser
npm install @bitnormous/business-react    # or React, which brings the browser SDK with it
```

## The three pieces of an integration

**1. Your server creates the order.** One call with your secret key returns a checkout session —
the order, plus a `client_secret` for the browser.

```ts
import { Bitnormous } from "@bitnormous/business-node";

const bitnormous = new Bitnormous({ secretKey: process.env.BITNORMOUS_SECRET_KEY! });

const session = await bitnormous.checkout.sessions.create(
  {
    amount: order.total,
    currency: order.currency,
    reference: order.id,
    customer: { email: order.email },
    returnUrl: `https://store.example/orders/${order.id}`,
  },
  { idempotencyKey: order.id },
);

res.json({ id: session.id, client_secret: session.client_secret });
```

**2. The customer pays.** The browser SDK opens the hosted checkout with that client secret. It can
reach that one order and nothing else, so a compromised device costs you one order rather than your
account.

**3. A webhook tells you it landed.**

```ts
import { constructEvent } from "@bitnormous/business-node";

app.post("/webhooks/bitnormous", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent({
      payload: req.body,                                 // raw bytes, not a parsed object
      signature: req.header("X-Bitnormous-Signature"),
      secret: process.env.BITNORMOUS_WEBHOOK_SECRET!,
    });
  } catch {
    return res.sendStatus(400);
  }

  res.sendStatus(200);   // acknowledge fast — anything slow gets retried
  void handle(event);
});
```

Fulfil from the webhook, not from the browser callback. `onSuccess` fires only if the customer is
still looking at the screen; the webhook arrives whether or not their battery survived it.

## Three presentations, one checkout

The same hosted payment page, framed three ways. Pick by where the customer should feel they are.

| | |
| --- | --- |
| `checkout.open(options)` | A modal over your page. The default. |
| `checkout.redirect(options)` | Send the customer away and back via `returnUrl`. |
| `checkout.mount(target, options)` | Inline, inside your own layout. |

The modal is a native `<dialog>` in a shadow root: a real focus trap, `Escape` to dismiss, top-layer
stacking no `z-index` on your page can cover — and your CSS reset cannot reach inside it. The
checkout itself runs in an iframe on its own origin, so merchant JavaScript cannot read what a
customer types into a payment screen and merchant CSS cannot reshape one.

## React

```tsx
import { BitnormousProvider, useCheckout } from "@bitnormous/business-react";

function App() {
  return (
    <BitnormousProvider createSession="/api/bitnormous/checkout">
      <Cart />
    </BitnormousProvider>
  );
}

function Cart() {
  const { open, isOpen } = useCheckout();

  return (
    <button disabled={isOpen} onClick={() => open({ amount: 125, currency: "USD", reference: "ORDER-1" })}>
      Pay with crypto
    </button>
  );
}
```

`<BitnormousCheckoutEmbed />` does the same inline. Both unmount cleanly — a customer who navigates
mid-payment does not leave an iframe or a poll behind.

## Building your own payment UI

`useCheckoutSession` is the headless escape hatch: the state machine the hosted checkout runs on,
with no markup attached. It owns the polling cadence, the wake-on-focus refresh and the terminal
transitions; you render.

```tsx
const { session, isLoading, selectAsset } = useCheckoutSession({ sessionId, clientSecret });

if (isLoading) return <Skeleton />;
if (!session?.payment) return <AssetPicker accepted={session?.accepted} onPick={selectAsset} />;

return <PayScreen payment={session.payment} />;
```

Outside React — a Cloudflare Worker, a Deno edge function, a React Native app — `CheckoutClient`
from `@bitnormous/business-core` is the same machine without the hooks.

## Errors

Every error descends from `BitnormousError`, so one `catch` can be exhaustive. Branch on `code`,
never on `message`: codes are part of the API contract, messages are English prose that may be
reworded.

```ts
import { BitnormousError, BitnormousConnectionError, ErrorCodes } from "@bitnormous/business-node";

try {
  await bitnormous.checkout.sessions.create(params, { idempotencyKey: order.id });
} catch (error) {
  if (error instanceof BitnormousConnectionError) {
    // We do not know whether it landed. Retry with the SAME idempotency key.
  } else if (error instanceof BitnormousError && error.code === ErrorCodes.BELOW_MINIMUM) {
    // The amount is under what that chain will ever credit. Offer another asset.
  }
}
```

`429` and `5xx` are retried automatically — twice, with backoff, and only for requests that carry an
idempotency key.

## Conventions

**What you write is camelCase; what you read is snake_case.** Options and callbacks are ordinary
JavaScript (`returnUrl`, `onSuccess`). Resource objects mirror the REST API field for field
(`client_secret`, `received_amount`), so the API reference *is* the SDK reference — there is no
second vocabulary to learn and nothing to drift when the API adds a field.

**Money is a string, never a number.** `0.1 + 0.2 !== 0.3`, and a float cannot hold 8 decimal places
of BTC without losing value at the bottom. Use `formatAmount` to display one and a decimal library
if you need arithmetic.

**Pass an idempotency key on every create.** Without one, a lost response leaves you unable to tell
"the order was created and I did not see it" from "it was never created" — and the innocent-looking
retry opens a second checkout the customer can pay twice. It is also what makes the SDK's automatic
retries safe: writes are only ever retried when they carry a key.

## Examples

| Example | Shows |
| --- | --- |
| [`examples/express-store`](examples/express-store) | The whole integration — create, pay, fulfil — in one server file and one HTML page. |

## Development

```bash
npm install
npm run build      # tsc project references, core → sdk/node → react
npm test           # node:test
npm run typecheck
```

```
packages/
  core/     transport, types, checkout state machine, webhook verification
  node/     server client and webhook helpers
  sdk/      browser checkout: modal, redirect, embed
  react/    provider, hooks, embed component
examples/
  express-store/
```

The test suite includes a parity check that signs a payload in JavaScript and again in PHP — the
language the API signs in — and asserts the two are byte-identical. Webhook verification is the one
place where "probably correct" is not good enough.

## Related

The page a customer actually pays on is **`business-bitnormous-checkout`**, the hosted checkout —
and it is built on the packages in this repository, which is the only way to be sure they are good
enough.

## Security

Never ship a secret key to a browser. If you believe you have found a vulnerability in this SDK or
in the Bitnormous API, email **security@bitnormous.com** rather than opening a public issue.

## Documentation

<https://docs.bitnormous.com/sdk/introduction>

## License

[MIT](LICENSE) © Bitnormous
