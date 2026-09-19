# Example: Express store

The whole integration — create, pay, fulfil — in one server file and one HTML page.

```bash
npm install
BITNORMOUS_SECRET_KEY=sk_test_... \
BITNORMOUS_WEBHOOK_SECRET=whsec_... \
npm start
# http://localhost:4242
```

## What to read

| File | Shows |
| --- | --- |
| `server.mjs` | Creating a session with your secret key, and verifying a webhook. |
| `public/index.html` | Opening the checkout with no API key in the browser. |

## The three things this example is careful about

**The price comes from the server's own records**, never from the request body. Trusting
`req.body.amount` lets a customer open devtools and decide what your goods cost.

**The webhook route is registered before `express.json()`** and takes the raw body. Verification
runs on the exact bytes we signed; a parsed-then-re-serialised body will never match.

**Fulfilment happens in the webhook handler**, not in the browser's `onSuccess`. The callback fires
only if the customer is still looking at the screen. The webhook arrives regardless.

## Receiving webhooks locally

Point a tunnel at this server and register the URL in **Developers → Webhooks**:

```bash
cloudflared tunnel --url http://localhost:4242
```
