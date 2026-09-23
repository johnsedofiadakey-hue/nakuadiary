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

Only a trusted server creates orders and changes their status (via the `updateOrderStatus` callable). Customers may read their own order (matched on `buyerUid`, the Auth uid that placed it), never write anything on it.

```ts
type Order = {
  customerId: string; // dedup key into customers/{}: uid (wholesale) or 'p_<digits>' (retail)
  buyerUid: string;   // Firebase Auth uid on the request — the read-your-own-order rule matches this
  accountType: 'retail' | 'wholesale';
  paystackEmail: string; // synthetic, derived from phone — Paystack's API requires *an* email; never shown to or collected from the customer
  lines: Array<{ productId: string; variantId: string; quantity: number; title: string; unitPrice: number }>;
  customer: { name: string; phone: string; deliveryPreference: 'Delivery' | 'Pickup'; deliveryAddress?: string }; // deliveryAddress required only when deliveryPreference is 'Delivery'
  subtotal: number; currency: 'GHS'; paymentStatus: 'pending' | 'paid' | 'failed';
  fulfillmentStatus: 'unfulfilled' | 'processing' | 'fulfilled' | 'cancelled';
  createdAt: Timestamp; updatedAt: Timestamp;
}
```

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
```

Use Firestore only for publicly readable active-product documents and a user-owned cart. Send `createCheckout` to a callable HTTPS endpoint; it must recalculate product/variant price (retail or wholesale, based on the caller's `wholesale` custom claim — never a client-supplied price) and stock, store the customer's order-contact and delivery-preference details, create the payment intent/session, and return only a provider redirect URL.

## Rules and validation

- Anonymous visitors can read only `active == true` product records; admins (the `admin` custom claim) can read and write any product.
- Authenticated users can read/write only `carts/{request.auth.uid}`; validate line shape and cap quantity, but use the server to enforce stock.
- `orders` are server-created; client writes are forbidden. Status changes go through the `updateOrderStatus` callable (admin-only), not a direct write.
- `customers` are admin-only, both read and write.
- Store storefront product images only under `products/{productId}/{fileName}` in Cloud Storage. The first `images[]` item is copied to `image` as the cover. Browser uploads are limited to JPEG, PNG, or WebP below 8 MB and require the `admin` custom claim; supplier/source assets stay in a separate private path or bucket.
- Add Firebase App Check before enabling public write paths.
- Stock lives in Firestore as a real number (`variants[].stock`) and is only ever decremented inside `paystackWebhook`'s transaction on confirmed payment; never decrement stock from this frontend.

## Roles (custom claims)

- `admin: true` — full read/write on `products`/`customers`, read on all `orders`, and access to the admin-only callables (`updateOrderStatus`, `createWholesaleAccount`). Bootstrapped by `functions/create-admin.js`; there is no self-serve way to become an admin.
- `wholesale: true` — set by `createWholesaleAccount` alongside a `customers/{uid}` doc. Changes checkout pricing to each product's `wholesalePrice` (falling back to retail `price` when absent) and enforces `minWholesaleQty`. No public signup — an admin creates the account and relays the generated password to the customer directly.

## Environment setup

Expose only Firebase web configuration (project ID, auth domain, etc.) in a browser config module. Keep payment secrets and service credentials in Functions/Cloud Run secret storage. Configure separate dev/staging/production projects and test emulator flows before production.
