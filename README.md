# Nakuadiary — frontend

A framework-free, Firebase Hosting-ready storefront for a premium wigs, extensions, bundles, and accessories business. It is deliberately a static, deployable frontend: no customer, catalog, checkout, or payment data is hard-coded as live state.

## Run locally

Serve `dist/` with any static server. For example: `npx serve dist`.

## Firebase Hosting

1. Create or select the Firebase project.
2. Run `firebase use <project-id>` in this folder.
3. Run `firebase deploy --only hosting`.

The hosting configuration sends client-side paths to `dist/index.html` and sets clean URLs. Pages, JS and CSS are served `no-cache` (browsers revalidate on every load and get a cheap 304 when nothing changed), so a deploy reaches every visitor immediately; `/assets` images cache for a day. File names aren't content-hashed, so never switch JS/CSS back to a long `max-age`/`immutable` without adding versioned URLs — the `?v=2` on every script/stylesheet reference exists only to escape an earlier year-long `immutable` cache. `firebase deploy --only hosting` deploys the static frontend alone; it never touches Firestore/Storage rules or Functions.

## What is included

- A real multi-page storefront — `/` (home), `/shop` (catalog with category, texture/style tag and search filtering), `/product?id=` (product detail with per-length prices and sold-out lengths), `/wholesale`, `/order` (live order confirmation after Paystack), and policy pages `/delivery`, `/refunds`, `/privacy`, `/terms`
- A soft, romantic visual design system (blush/lavender/cream palette, rounded corners, script accents) shared across every page via `dist/styles.css`
- GHS pricing, texture/length selection, and a dedicated product detail page per item
- Guest checkout that collects name, phone, and a delivery/pickup preference — no email required — before passing the buyer to Paystack for Mobile Money or card payment
- An optional wholesale sign-in (header "Sign in" link): an admin-created account sees wholesale pricing throughout the storefront automatically
- A `/admin` back office (`dist/admin/`) for managing products, inventory, orders, and wholesale customers — see below
- Reduced-motion support, focus styles, semantic controls, and mobile-first layout
- Starter catalog data in `dist/js/data.js` / `functions/seed.js`

Every page (`dist/index.html`, `dist/shop.html`, `dist/product.html`, `dist/wholesale.html`) is a thin static shell — a `<div id="app">` plus a `data-page` attribute on `<body>`. All markup, including the shared header/footer/cart/dialogs, is rendered by the one shared `dist/js/app.js`, which branches on `data-page`. Internal links use the clean-URL form (`/shop`, not `/shop.html`) so a `.html`-stripping redirect (Firebase Hosting's `cleanUrls`, and `serve`'s equivalent) never has a chance to drop a query string like `?id=`.

Before going live, set the real WhatsApp number and contact email in `/admin` → **Settings** — until then the storefront uses the placeholders in `dist/js/site-content.js` (`233200000000`, `hello@example.com`).

**Owner's guide:** [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) explains day-to-day use of the admin portal in plain language.

## Backend setup (Firebase)

The backend lives alongside the frontend: `firestore.rules`, `storage.rules`, and `functions/` (Paystack-backed checkout, order status, and wholesale account management). See [`docs/FIREBASE_BACKEND_CONTRACT.md`](docs/FIREBASE_BACKEND_CONTRACT.md) for the full data contract.

1. Create a Firebase project and, inside it, a Web app — copy its config into `dist/js/firebase-config.js` (safe to commit; it's a public app identifier, not a secret). Until every `REPLACE_ME` is filled in, the storefront runs on the local mock cart automatically, and `/admin` shows a "not connected" screen.
2. Enable **Anonymous** and **Email/Password** sign-in under Authentication → Sign-in method (anonymous owns a guest cart; email/password is for admin and wholesale accounts).
3. `firebase use <project-id>`
4. `firebase functions:secrets:set PAYSTACK_SECRET_KEY` and `firebase functions:secrets:set MNOTIFY_API_KEY` — paste each key at the prompt (see [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for the optional SMS/App Check params).
5. `cd functions && npm install`
6. Seed the starter catalog: `node seed.js` (needs `gcloud auth application-default login` once, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account key).
7. Bootstrap your own admin account: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node create-admin.js`. There's no self-serve way to become an admin after this — it's the one manual step.
8. `firebase deploy --only firestore:rules,firestore:indexes,storage,functions`
9. In your Paystack dashboard, add a webhook pointing at the deployed `paystackWebhook` function URL (printed by the deploy command). Payments, orders, stock holds and SMS are documented in [`docs/OPERATIONS.md`](docs/OPERATIONS.md); run the backend tests with `cd functions && npm test` (needs Java 21+).
10. Deploy the frontend: `firebase deploy --only hosting`.

Before enabling public write paths, also turn on Firebase App Check per the contract doc.

### Using the admin portal

Visit `/admin` on your deployed site (or `http://localhost:PORT/admin` locally) and sign in with the account from step 7. From there:

- **Products** — add/edit the catalog, including per-variant stock counts, retail and wholesale prices, a minimum wholesale quantity, and a photo gallery. Upload JPG, PNG, or WebP product photos below 8 MB directly from the device; the first photo is the storefront cover. Deactivating a product hides it from the storefront without deleting its order history.
- **Orders** — every order with its customer, delivery details, item photos, Paystack confirmation, full status timeline (who/when) and customer-SMS status. Move paid orders through `processing → dispatched → delivered` (pickup can go straight to delivered), or cancel — which returns stock and flags a manual Paystack refund if it was paid.
- **Customers** — a running list built automatically from checkout (retail, keyed by phone) and wholesale accounts you create here. Creating a wholesale account shows a one-time temporary password to relay to the customer yourself (WhatsApp/SMS) — the system never emails or stores it.
- **Homepage** — edit every piece of homepage text, upload the hero photo, floating logo card and optional category-tile photos straight from your phone or computer, and show/hide each section. Changes go live on save.
- **Settings** — business name and logo, WhatsApp number and contact email (used by every WhatsApp/email button), social links, an announcement bar, the cart's delivery note, footer options, brand colours, and the homepage's Google/share title, description and image.

## For Claude: backend contract

Read [`docs/FIREBASE_BACKEND_CONTRACT.md`](docs/FIREBASE_BACKEND_CONTRACT.md) before touching data/auth/checkout. The UI uses an adapter boundary in `dist/js/store.js` — it now contains both the real Firebase-backed implementation and the original mock, selected automatically based on whether `dist/js/firebase-config.js` is filled in. Keep changes to Firestore/Functions inside that boundary rather than coupling Firebase calls directly into components. The admin portal (`dist/admin/`) has its own equivalent boundary in `dist/admin/js/admin-store.js` — it talks to Firestore directly (gated by the `admin` custom claim in `firestore.rules`) and to the `updateOrderStatus`/`createWholesaleAccount` callables for anything that needs server-side validation.
