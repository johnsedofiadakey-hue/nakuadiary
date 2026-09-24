# Firebase backend contract for Claude

## Scope and guardrails

This repository is the presentation layer. Keep the deployed Hosting surface static and public. Implement privileged work in Cloud Functions/Cloud Run only; never expose payment secrets, Admin SDK credentials, private supplier costs, or raw inventory write access in the browser.

Do not change the visual markup or cart interaction contract unless the product requirements change. Replace the mock adapter in `dist/js/store.js` with the real repository methods described below.

## Collections

### `products/{productId}`

```ts
type Product = {
  id: string; slug: string; name: string;
  category: 'wigs' | 'bundles' | 'extensions' | 'accessories';
  type: string; price: number; wholesalePrice?: number; currency: 'GHS'; compareAt?: number;
  minWholesaleQty?: number; // default 1; enforced server-side at checkout
  description: string; details: string[];
  tags?: string[];   // texture/style filters on /shop, e.g. ['Body wave', 'HD lace'] — max 8, ≤ 30 chars, de-duplicated case-insensitively by the admin form
  // `image` remains the cover image for backwards compatibility.
  image: { url: string; alt: string; focalPoint?: { x: number; y: number } };
  // First image is the storefront cover; the remainder form its gallery.
  images?: Array<{ url: string; alt: string; focalPoint?: { x: number; y: number } }>;
  variants: Array<{
    id: string; label: string; available: boolean;
    price?: number; wholesalePrice?: number;
    stock: number; // real inventory count, decremented by paystackWebhook on payment
  }>;
  badges?: string[]; featured?: boolean; active: boolean;
  inventoryPolicy: 'deny' | 'continue'; createdAt: Timestamp; updatedAt: Timestamp;
}
```

### `carts/{uid}`

```ts
type Cart = {
  lines: Array<{ productId: string; variantId: string; quantity: number; unitPriceSnapshot: number }>;
  updatedAt: Timestamp;
}
```

For a signed-out visitor, persist only a local anonymous cart and merge it into the authenticated cart with a callable function. Prices and availability shown here are hints; checkout must retrieve canonical values server-side.

### `customers/{customerId}`

Admin-only collection (never readable by the customer it describes). Retail shoppers don't have accounts, so their record is keyed by a normalized phone number (`p_<digits>`) and upserted by `createCheckout`; wholesale accounts are keyed by their Firebase Auth `uid`.

```ts
type Customer = {
  uid: string | null; name: string; phone: string; email?: string;
  accountType: 'retail' | 'wholesale';
  orderCount: number; totalSpent: number; notes?: string;
  createdAt: Timestamp; updatedAt: Timestamp;
}
```

### `orders/{orderId}`

Created only by the `createCheckout` function; changed only by functions (Paystack webhook, hold-expiry scheduler, `updateOrderStatus`). Customers may read their own order (matched on `buyerUid`); nobody writes from a browser, admins included. The order id is also the Paystack transaction reference.

Each order is an **immutable snapshot**: product name, variant, price and cover image are copied at checkout, so the admin view never depends on the product still existing or staying unchanged.

```ts
type OrderStatus = 'pending_payment' | 'paid' | 'processing' | 'dispatched' | 'delivered' | 'cancelled' | 'failed';
type Actor = { type: 'system' | 'paystack' | 'admin'; uid: string | null }; // uid set for admins

type Order = {
  reference: string;  // customer-facing, e.g. 'NKD-7F3K9Q' (used in SMS)
  buyerUid: string;   // Auth uid that checked out — the read-your-own-order rule matches this
  customerId: string; // customers/{}: uid (wholesale) or 'p_<digits>' (retail)
  accountType: 'retail' | 'wholesale';
  paystackEmail: string; // synthetic '<phone>@guest.nakuadiary.app' — Paystack requires an email
  customer: { name: string; phone: string; phoneNormalized: string; deliveryPreference: 'Delivery' | 'Pickup'; deliveryAddress: string | null; deliveryZone: string | null };
  delivery: { method: 'Delivery' | 'Pickup'; zone: string | null; fee: number; status: 'pickup' | 'arranged' | 'charged' | 'free' }; // fee from site/settings.delivery (functions/src/delivery.js)
  deliveryFee: number;
  lines: Array<{ productId: string; productName: string; variantId: string; variantLabel: string; title: string /* legacy */; quantity: number; unitPrice: number; lineTotal: number; image: string | null }>;
  itemCount: number; subtotal: number; total: number /* subtotal + deliveryFee — the Paystack amount */; currency: 'GHS';
  status: OrderStatus;
  paymentStatus: 'pending' | 'paid' | 'failed';                              // convenience mirror
  fulfillmentStatus: 'unfulfilled' | 'processing' | 'fulfilled' | 'cancelled'; // legacy mirror for older admin builds
  payment: { provider: 'paystack'; reference: string; status: 'pending' | 'paid' | 'failed';
             transactionId?: string; channel?: string; paidAt?: string; amount?: number; currency?: string;
             gatewayResponse?: string; verifiedAt?: Timestamp; verifiedBy?: 'webhook' | 'hold_expiry';
             mismatch?: { amountMinor: number; currency: string; expectedMinor: number } };
  stockHold: { state: 'held' | 'committed' | 'released' | 'none'; heldUntil: Timestamp; releasedAt?: Timestamp };
  stockIssue: boolean;  // paid after the hold expired and stock ran out — admin must restock or refund
  refund: null | { required: true; status: 'pending' | 'done'; reason: 'cancelled_after_payment' | 'paid_after_cancellation'; flaggedAt: Timestamp; flaggedBy?: string };
  statusHistory: Array<{ status: OrderStatus; at: Timestamp; actor: Actor; note?: string }>;
  createdAt: Timestamp; updatedAt: Timestamp; paidAt?: Timestamp;
};
// orders/{id}/events/{auto} — append-only audit: { type: 'status_change', from, to, actor, note?, at }
```

**State machine** (`functions/src/orders.js`; the server rejects anything else):

| From | To | Who |
|---|---|---|
| pending_payment | paid, failed | Paystack webhook / scheduler — only after `GET /transaction/verify` confirms status, amount (pesewas) and currency |
| pending_payment | cancelled | scheduler (60-min hold expired) or admin |
| paid | processing, cancelled | admin |
| processing | dispatched, delivered (pickup), cancelled | admin |
| dispatched | delivered, cancelled | admin |
| delivered, cancelled, failed | — | terminal (a verified late payment on an expired order is still recorded as paid) |

**Stock**: reserved in the same transaction that creates the order (`deny` policy rejects if `stock < quantity`), committed on payment, returned on failure / expiry / cancellation. Cancelling a paid order also sets `refund.required` — refunds are issued manually in the Paystack dashboard.

### `smsOutbox/{orderId}_{status}` — customer SMS (functions only; admin read)

`{ orderId, audience: 'customer'|'owner', status: 'paid'|'processing'|'dispatched'|'delivered'|'owner_paid', state: 'queued'|'sending'|'sent'|'failed'|'skipped'|'unknown', attempts, to /* masked 024****567 */, provider?: { httpStatus, status, code, campaignId, totalSent, totalRejected, creditUsed }, error?: { code, message }, sentAt?, requeuedBy? }`. Enqueued in the status-change transaction; the deterministic id means one text per order per status. A paid order also queues `{orderId}_owner_paid` — the shop-owner alert, sent to `config/sms.ownerPhone`. Message text, full phone number and the API key are never stored.

### `config/sms` — SMS settings (admin read/write)

`{ enabled?: boolean, senderId?: string /* ≤ 11 chars, approved in BMS */, ownerAlerts?: boolean, ownerPhone?: string, templates?: { paid?, processing?, dispatched?, delivered?, owner? } }` — edited in Admin → Notifications. Placeholders: `{name}` (first name), `{reference}`, `{deliveryPreference}`, `{itemCount}`, `{total}`. Missing values fall back to the `MNOTIFY_SENDER_ID` param and the defaults in `functions/src/sms.js`.

### `paystackEvents/{event}_{id}` — webhook de-duplication (functions only; admin read)

`{ type, reference, outcome, receivedAt }`, written after an event is fully processed.

### `site/{docId}` — storefront content (CMS)

Two documents, edited from `/admin` → **Homepage** (`site/home`) and **Settings** (`site/settings`). The full shapes and default values live in `dist/js/site-content.js`, which both the storefront and the admin import. Readers always deep-merge a doc over those defaults (`mergeContent`), so a missing doc or field falls back to the built-in copy; arrays of objects (`categories.tiles`, `steps.items`) keep their default length and merge by index.

```ts
type SiteImage = { url: string; alt: string }; // url '' = none (optional images) or "use default" (required ones)

type SiteSettings = {
  brand: { businessName: string; logo: SiteImage; showWordmark: boolean };
  contact: { whatsappNumber: string /* digits, country code */; email: string; instagramUrl: string; tiktokUrl: string; facebookUrl: string };
  announcement: { enabled: boolean; text: string; link: string };
  shop: { deliveryNote: string };
  footer: { tagline: string; showAdminLink: boolean };
  theme: { accent: string; accentDark: string }; // #rrggbb → --rose / --rose-dark
  seo: { title: string; description: string; shareImage: SiteImage };
  delivery: { mode: 'arranged' | 'free' | 'flat' | 'zones'; flatFee: number; freeOver: number /* 0 = none */; zones: Array<{ name: string; fee: number }>; pickupAddress: string; pickupHours: string }; // read by createCheckout (authoritative) and the storefront (preview)
  policies: { returnWindowDays: number; dispatchTime: string; lastUpdated: string }; // used on /refunds, /delivery
  updatedAt: Timestamp; updatedBy: string | null;
};

type SiteHome = {
  hero: { show: boolean; eyebrow: string; headline: string; body: string; primaryCta: { label: string; href: string }; secondaryCta: { label: string; href: string }; image: SiteImage; showLogoPanel: boolean; logoPanelImage: SiteImage; motionLabel: string; badges: string[] };
  categories: { show: boolean; eyebrow: string; title: string; tiles: Array<{ id: 'wigs' | 'bundles' | 'extensions' | 'accessories'; label: string; detail: string; image: SiteImage }> };
  paths: { show: boolean; eyebrow: string; title: string; retail: PathCard; wholesale: PathCard }; // PathCard = { eyebrow, title, body, ctaLabel }
  featured: { show: boolean; eyebrow: string; title: string; emptyText: string };
  steps: { show: boolean; eyebrow: string; title: string; items: Array<{ title: string; body: string }> };
  newsletter: { show: boolean; eyebrow: string; title: string; body: string; ctaLabel: string; ctaHref: string /* '' = mailto contact email */ };
  updatedAt: Timestamp; updatedBy: string | null;
};
```

All CMS text is HTML-escaped when rendered. Headlines/titles support two formatting affordances only: `*word*` → script accent (`<em>`), newline → `<br>` (`richText`). Links pass through `safeHref` (site-relative, `https://`, `mailto:`, `tel:` only).

## Adapter methods to implement

`store.js` expects promise-returning methods. Preserve these method names and shapes:

```ts
listProducts({ category?, featured? }) -> Product[]
getProduct(id) -> Product | null
getCart() -> { lines: CartLine[] }
addToCart({ productId, variantId, quantity }) -> { lines: CartLine[] }
updateCartLine({ productId, variantId, quantity }) -> { lines: CartLine[] }
createCheckout({ lines, customer }) -> { checkoutUrl: string }
signIn({ email, password }) -> void
signOut() -> void
getAccount() -> { isWholesale: boolean; name: string } | null
getSiteContent() -> { settings: SiteSettings; home: SiteHome } // merged over defaults; never throws
watchOrder(orderId, callback) -> unsubscribe // live order for /order (own orders only, per rules)
resetPassword(email) -> void // Firebase Auth reset email (wholesale accounts)
```

Use Firestore only for publicly readable active-product documents and a user-owned cart. Send `createCheckout` to a callable HTTPS endpoint; it must recalculate product/variant price (retail or wholesale, based on the caller's `wholesale` custom claim — never a client-supplied price) and stock, store the customer's order-contact and delivery-preference details, create the payment intent/session, and return only a provider redirect URL.

## Rules and validation

Least privilege; verified by `functions/test/rules.test.js`.

- Public: `active == true` products and `site/{settings,home}` only. Admins (`admin` claim) read/write products and site content.
- `carts/{uid}`: owner only, `{lines, updatedAt}` shape, ≤ 50 lines. Prices/stock are never trusted from carts — `createCheckout` re-reads Firestore.
- `orders`: owner or admin read; **no client writes, admins included**. `orders/*/events`: admin read only.
- `customers`, `smsOutbox`, `paystackEvents`: admin read; `customers` admin write; the other two functions-only.
- `config/sms`: admin read/write with a validated shape; no other `config` docs.
- Storage: public read and admin-only JPEG/PNG/WebP (< 8 MB) writes under `products/**` and `site/*`; everything else denied.
- Every callable validates its input server-side; `ENFORCE_APP_CHECK=true` makes `createCheckout` require App Check once the storefront sends tokens.

## Roles (custom claims)

- `admin: true` — full read/write on `products`/`customers`, read on all `orders`, and access to the admin-only callables (`updateOrderStatus`, `resendOrderSms`, `createWholesaleAccount`), each of which re-checks the claim server-side. Bootstrapped by `functions/create-admin.js`; there is no self-serve way to become an admin.
- `wholesale: true` — set by `createWholesaleAccount` alongside a `customers/{uid}` doc. Changes checkout pricing to each product's `wholesalePrice` (falling back to retail `price` when absent) and enforces `minWholesaleQty`. No public signup — an admin creates the account and relays the generated password to the customer directly.

## Environment setup

Browser code gets only the public Firebase web config. Everything else is server-side — see [`docs/OPERATIONS.md`](OPERATIONS.md) for secrets, params, deploy commands, dashboard steps and tests.
