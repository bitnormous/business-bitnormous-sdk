# @bitnormous/business-sdk

The browser checkout for Bitnormous Business.

```bash
npm install @bitnormous/business-sdk
```

```ts
import { BitnormousCheckout } from "@bitnormous/business-sdk";

const checkout = new BitnormousCheckout({ createSession: "/api/bitnormous/checkout" });

const result = await checkout.open({
  amount: 125,
  currency: "USD",
  reference: "ORDER-102938",
  customer: { email: "customer@example.com" },
  onSuccess: (session) => console.log("Paid", session.payment?.amount, session.payment?.asset),
});
```

Three presentations, all driving the same hosted checkout:

| | |
| --- | --- |
| `checkout.open(options)` | A modal over your page. The default. |
| `checkout.redirect(options)` | Send the customer to the hosted checkout and back. |
| `checkout.mount(target, options)` | Inline, inside your own layout. |

## How it is built

The modal is a native `<dialog>` inside a shadow root, so the customer gets a real focus trap,
`Escape` to dismiss, and top-layer stacking no `z-index` on your page can cover — and your CSS
reset cannot reach inside it.

The checkout itself runs in an iframe on its own origin. That is deliberate: merchant JavaScript
cannot read what the customer types into a payment screen, and merchant CSS cannot reshape one.

## A note on `onSuccess`

It fires in the customer's browser, which means it fires only if they are still there. Use it for
what they see; do the fulfilment from the `checkout_session.completed` webhook, which arrives
whatever they do.

## Docs

<https://docs.bitnormous.com/sdk/checkout>
