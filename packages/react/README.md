# @bitnormous/business-react

React hooks and components for Bitnormous checkouts.

```bash
npm install @bitnormous/business-react
```

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

| | |
| --- | --- |
| `<BitnormousProvider>` | Holds one checkout instance for your app. |
| `useCheckout()` | Open the modal; track its state. |
| `useCheckoutSession()` | Headless — the state machine with no markup, for your own UI. |
| `<BitnormousCheckoutEmbed>` | The checkout inline. |

`useCheckoutSession` handles the polling cadence, sleeps while the tab is hidden (a customer who
switches to their wallet app is the normal case), wakes on return and stops at a terminal status.
The hosted checkout is itself built on it, so anything it renders, you can.

## Docs

<https://docs.bitnormous.com/sdk/react>
