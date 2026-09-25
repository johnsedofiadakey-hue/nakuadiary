# Operations — payments, orders, SMS

Backend code: `functions/` (Node 22, `firebase-functions` v7). Data contract: [`FIREBASE_BACKEND_CONTRACT.md`](FIREBASE_BACKEND_CONTRACT.md).

## Functions

| Function | Trigger | Secrets | Purpose |
|---|---|---|---|
| `createCheckout` | callable (storefront) | `PAYSTACK_SECRET_KEY` | Validate cart, price from Firestore, reserve stock, snapshot order, open Paystack checkout |
| `paystackWebhook` | HTTPS (Paystack) | `PAYSTACK_SECRET_KEY` | Signature check → de-dupe → `verify` with Paystack → mark paid/failed |
| `expireStockHolds` | every 15 min | `PAYSTACK_SECRET_KEY` | Settle (if Paystack says paid) or release checkouts whose 60-min hold expired |
| `sendOrderSms` | `smsOutbox/{id}` written | `MNOTIFY_API_KEY` | Send one queued SMS through MNotify |
| `updateOrderStatus` | callable (admin) | — | Status change with audit, restock on cancel, refund flag, SMS |
| `resendOrderSms` | callable (admin) | — | Re-queue a failed/skipped/unconfirmed SMS |
| `createWholesaleAccount` | callable (admin) | — | Create a wholesale login |

A paid order also texts the **shop owner** (`config/sms.ownerPhone`, Admin → Notifications). Delivery fees come from `site/settings.delivery` (Admin → Settings → Delivery) and are computed server-side in `functions/src/delivery.js`. Customers return from Paystack to **/order**, which watches the order live and shows "confirming…" until the verified webhook marks it paid.

A browser redirect back from Paystack is **never** treated as payment. Only a verified webhook (or the scheduler's own `verify` call) marks an order paid.

## Secrets and params

Secrets are stored in Cloud Secret Manager. Never put them in code, `.env`, Firestore, docs or chat.

```bash
firebase functions:secrets:set PAYSTACK_SECRET_KEY   # sk_test_… first, sk_live_… when going live
firebase functions:secrets:set MNOTIFY_API_KEY
```

After changing a secret's value, redeploy functions so new instances pick it up.

Non-secret params have safe defaults. Override them in `functions/.env` (git-ignored) when needed:

| Param | Default | Notes |
|---|---|---|
| `SMS_ENABLED` | `false` | Master switch. Leave off until the sender ID is approved; queued texts are marked `skipped` and can be resent from the admin |
| `MNOTIFY_SENDER_ID` | *(empty)* | Approved BMS sender ID, max 11 chars. `config/sms.senderId` overrides it |
| `CHECKOUT_ALLOWED_ORIGINS` | `https://nakuadiary.web.app,https://nakuadiary.firebaseapp.com` | Where Paystack may send customers back to. Add a custom domain here |
| `ENFORCE_APP_CHECK` | `false` | Turn on only after the storefront initialises App Check |

## Runtime service account (one-time, done 2026-09-24)

Functions build and run as the project's default compute service account (`<project-number>-compute@developer.gserviceaccount.com`). New projects don't grant it broad access, so it was given exactly:

- `roles/cloudbuild.builds.builder` (build functions)
- `roles/datastore.user` (Firestore)
- `roles/firebaseauth.admin` (wholesale accounts)
- `roles/secretmanager.secretAccessor` on each secret (granted automatically by `firebase deploy`)

## Deploying before the Paystack key exists

The CLI refuses to deploy **any** function while a declared secret has no value. Until `PAYSTACK_SECRET_KEY` is set, the git-ignored marker file `functions/PAYMENTS_DISABLED` leaves out `createCheckout`, `paystackWebhook` and `expireStockHolds` (see `functions/src/config.js`). Once the key is set: delete the file, then deploy functions.

Non-interactive deploys also need every param written out in `functions/.env` (git-ignored): `SMS_ENABLED`, `MNOTIFY_SENDER_ID`, `CHECKOUT_ALLOWED_ORIGINS`, `ENFORCE_APP_CHECK`.

## Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,functions
```

The `orders(status, stockHold.heldUntil)` index is needed by the scheduler; it can take a few minutes to build after the first deploy.

## Dashboard steps

**Paystack** (Settings → API Keys & Webhooks)
1. Set the Webhook URL to the `paystackWebhook` URL printed by the deploy (e.g. `https://us-central1-nakuadiary.cloudfunctions.net/paystackWebhook`), for both Test and Live.
2. Make sure Mobile Money (GHS) and card are enabled for the account.
3. Refunds for orders flagged **Refund due** in the admin are issued here, manually, against the Paystack reference shown on the order.

**BMS / MNotify**
1. Register the sender ID and wait for approval. You can check it with `POST https://api.mnotify.com/api/senderid/status`.
2. Keep the account topped up with SMS credit. `provider.creditUsed` is recorded per text.
3. Then set `SMS_ENABLED=true` (and `MNOTIFY_SENDER_ID`) in `functions/.env` and redeploy functions.

## Monitoring

Logs are structured and contain order IDs, never names, phone numbers or keys:

```bash
firebase functions:log --only paystackWebhook
```

Worth alerting on in Cloud Logging:
- `paystack webhook needs admin attention` (amount mismatch, stock issue, paid after cancellation)
- `paystack webhook rejected: bad signature`
- `sms not sent`

In the admin, the Orders list shows a "need attention" count for refunds due, stock issues and amount mismatches.

## Tests

The tests run against local emulators on the `demo-nakuadiary` project, with Paystack and MNotify faked, so nothing real is touched. The Firebase emulators need Java 21+.

```bash
cd functions && JAVA_HOME=/opt/homebrew/opt/openjdk@21 npm test
```

They cover pricing, input validation, concurrent-checkout oversell, callback allow-listing, signature forgery, replayed/duplicate/out-of-order webhooks, amount and currency mismatches, hold expiry and late payments, admin transitions and audit trail, restock and refund flags, exactly-once SMS, secret and PII hygiene, and the Firestore and Storage rules.
