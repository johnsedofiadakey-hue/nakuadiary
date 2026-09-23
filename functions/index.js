const crypto = require('crypto');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();
const auth = getAuth();

const PAYSTACK_SECRET_KEY = defineSecret('PAYSTACK_SECRET_KEY');
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_EMAIL_DOMAIN = 'guest.nakuadiary.app';

const MAX_LINES = 50;
const MAX_QUANTITY = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9 ()-]{7,24}$/;
const DELIVERY_PREFERENCES = new Set(['Delivery', 'Pickup']);
const FULFILLMENT_STATUSES = ['unfulfilled', 'processing', 'fulfilled', 'cancelled'];
const ALLOWED_STATUS_TRANSITIONS = {
  unfulfilled: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

/** Ghana-shaped normalization: strips formatting, maps a leading 0 to 233. */
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  return digits;
}

function requireAdmin(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
}

function resolveUnitPrice(product, variant, accountType) {
  if (accountType === 'wholesale') {
    if (typeof variant.wholesalePrice === 'number') return variant.wholesalePrice;
    if (typeof product.wholesalePrice === 'number') return product.wholesalePrice;
  }
  return typeof variant.price === 'number' ? variant.price : product.price;
}

/**
 * Guest checkout entry point. Trusts nothing from the client except *which*
 * product/variant/quantity was requested — price (retail or wholesale,
 * decided by the caller's own `wholesale` custom claim), availability and
 * the order total are all recomputed from Firestore here, per the
 * contract's "checkout must retrieve canonical values server-side" rule.
 */
exports.createCheckout = onCall({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in (even as a guest) before checking out.');
  }
  const accountType = request.auth.token.wholesale === true ? 'wholesale' : 'retail';

  const { lines, customer, callbackUrl } = request.data || {};
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) {
    throw new HttpsError('invalid-argument', 'Your bag is empty or has too many lines.');
  }

  const customerName = cleanText(customer?.name, 100);
  const customerPhone = cleanText(customer?.phone, 24);
  const deliveryPreference = cleanText(customer?.deliveryPreference, 30);
  const deliveryAddress = cleanText(customer?.deliveryAddress, 180);
  if (!customerName || !PHONE_RE.test(customerPhone) || !DELIVERY_PREFERENCES.has(deliveryPreference)) {
    throw new HttpsError('invalid-argument', 'Please complete your name, phone number, and delivery preference.');
  }
  if (deliveryPreference === 'Delivery' && !deliveryAddress) {
    throw new HttpsError('invalid-argument', 'Please add a delivery address, or choose pickup instead.');
  }

  const orderLines = [];
  let subtotal = 0;

  for (const rawLine of lines) {
    const { productId, variantId, quantity } = rawLine || {};
    if (
      typeof productId !== 'string' ||
      typeof variantId !== 'string' ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > MAX_QUANTITY
    ) {
      throw new HttpsError('invalid-argument', 'One of the items in your bag is malformed.');
    }

    const productSnap = await db.collection('products').doc(productId).get();
    if (!productSnap.exists || productSnap.data().active !== true) {
      throw new HttpsError('failed-precondition', 'One of the items in your bag is no longer available.');
    }
    const product = productSnap.data();

    const variant = (product.variants || []).find((v) => v.id === variantId);
    if (!variant || variant.available !== true) {
      throw new HttpsError('failed-precondition', `The selected option for ${product.name} is unavailable.`);
    }

    if (accountType === 'wholesale') {
      const minQty = typeof product.minWholesaleQty === 'number' ? product.minWholesaleQty : 1;
      if (quantity < minQty) {
        throw new HttpsError('invalid-argument', `${product.name} requires a minimum of ${minQty} at wholesale pricing.`);
      }
    }

    const unitPrice = resolveUnitPrice(product, variant, accountType);
    subtotal += unitPrice * quantity;
    orderLines.push({
      productId,
      variantId,
      quantity,
      title: `${product.name} — ${variant.label}`,
      unitPrice,
      // Snapshot the cover photo so the admin can see exactly what was
      // ordered even if the product photos change later.
      image: product.images?.[0]?.url || product.image?.url || null,
    });
  }

  const normalizedPhone = normalizePhone(customerPhone);
  const customerId = accountType === 'wholesale' ? uid : `p_${normalizedPhone}`;
  const paystackEmail = `${normalizedPhone}@${PAYSTACK_EMAIL_DOMAIN}`;

  const orderRef = db.collection('orders').doc();
  const customerRef = db.collection('customers').doc(customerId);
  const customerSnap = await customerRef.get();

  const batch = db.batch();
  batch.set(orderRef, {
    customerId,
    buyerUid: uid,
    accountType,
    paystackEmail,
    customer: {
      name: customerName,
      phone: customerPhone,
      deliveryPreference,
      ...(deliveryAddress ? { deliveryAddress } : {}),
    },
    lines: orderLines,
    subtotal,
    currency: 'GHS',
    paymentStatus: 'pending',
    payment: { provider: 'paystack', reference: orderRef.id, status: 'pending' },
    fulfillmentStatus: 'unfulfilled',
    statusHistory: [{ status: 'unfulfilled', at: new Date().toISOString(), source: 'system' }],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const customerUpdate = {
    uid: accountType === 'wholesale' ? uid : null,
    name: customerName,
    phone: customerPhone,
    accountType,
    orderCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!customerSnap.exists) {
    customerUpdate.createdAt = FieldValue.serverTimestamp();
    customerUpdate.totalSpent = 0;
  }
  batch.set(customerRef, customerUpdate, { merge: true });

  await batch.commit();

  const amountInPesewas = Math.round(subtotal * 100);
  let checkoutUrl;
  try {
    const paystackRes = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: paystackEmail,
        amount: amountInPesewas,
        currency: 'GHS',
        reference: orderRef.id,
        callback_url: typeof callbackUrl === 'string' ? callbackUrl : undefined,
        metadata: {
          orderId: orderRef.id,
          customerName,
          customerPhone,
          deliveryPreference,
        },
      }),
    });
    const body = await paystackRes.json();
    if (!paystackRes.ok || !body.status) {
      throw new Error(body.message || `Paystack responded with ${paystackRes.status}`);
    }
    checkoutUrl = body.data.authorization_url;
  } catch (err) {
    await orderRef.update({ paymentStatus: 'failed', updatedAt: FieldValue.serverTimestamp() });
    throw new HttpsError('unavailable', 'Could not start checkout with the payment provider. Please try again.');
  }

  return { checkoutUrl };
});

/**
 * Paystack webhook. Verifies the request actually came from Paystack via
 * the HMAC-SHA512 signature, then marks the matching order paid/failed,
 * decrements real stock, credits the customer's lifetime spend, and clears
 * their cart on success. Idempotent: replays of the same "charge.success"
 * event are a no-op once the order is already paid.
 */
exports.paystackWebhook = onRequest({ secrets: [PAYSTACK_SECRET_KEY] }, async (req, res) => {
  const signature = req.get('x-paystack-signature');
  const expected = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY.value())
    .update(req.rawBody)
    .digest('hex');

  if (!signature || signature !== expected) {
    res.status(401).send('Invalid signature');
    return;
  }

  const event = req.body;
  const reference = event?.data?.reference;
  if (!reference) {
    res.status(200).send('ignored');
    return;
  }

  const orderRef = db.collection('orders').doc(reference);

  if (event.event === 'charge.success') {
    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || orderSnap.data().paymentStatus === 'paid') return;
      const order = orderSnap.data();

      const productIds = [...new Set(order.lines.map((line) => line.productId))];
      const productRefs = productIds.map((id) => db.collection('products').doc(id));
      const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
      const productsById = new Map(productSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

      for (const line of order.lines) {
        const product = productsById.get(line.productId);
        if (!product) continue;
        const variants = (product.variants || []).map((v) => {
          if (v.id !== line.variantId) return v;
          const nextStock = Math.max(0, (v.stock || 0) - line.quantity);
          const nextAvailable = product.inventoryPolicy === 'deny' && nextStock <= 0 ? false : v.available;
          return { ...v, stock: nextStock, available: nextAvailable };
        });
        productsById.set(line.productId, { ...product, variants });
        tx.update(db.collection('products').doc(line.productId), {
          variants,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(orderRef, {
        paymentStatus: 'paid',
        payment: {
          provider: 'paystack',
          reference,
          status: 'paid',
          transactionId: event?.data?.id ? String(event.data.id) : null,
          channel: event?.data?.channel || null,
          paidAt: event?.data?.paid_at || new Date().toISOString(),
          amount: typeof event?.data?.amount === 'number' ? event.data.amount / 100 : order.subtotal,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('carts').doc(order.buyerUid), {
        lines: [],
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('customers').doc(order.customerId), {
        totalSpent: FieldValue.increment(order.subtotal),
        lastOrderAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } else if (event.event === 'charge.failed') {
    await orderRef.update({ paymentStatus: 'failed', payment: { provider: 'paystack', reference, status: 'failed' }, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
  }

  res.status(200).send('ok');
});

/**
 * Admin-only: moves an order through the fulfillment state machine.
 * Rejects illegal transitions (e.g. skipping straight from unfulfilled to
 * fulfilled, or changing anything once fulfilled/cancelled) rather than
 * trusting the portal's UI to only ever send legal ones.
 */
exports.updateOrderStatus = onCall(async (request) => {
  requireAdmin(request);

  const { orderId, fulfillmentStatus } = request.data || {};
  if (typeof orderId !== 'string' || !FULFILLMENT_STATUSES.includes(fulfillmentStatus)) {
    throw new HttpsError('invalid-argument', 'A valid orderId and fulfillmentStatus are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const current = snap.data().fulfillmentStatus;
    if (current === fulfillmentStatus) return;
    const allowed = ALLOWED_STATUS_TRANSITIONS[current] || [];
    if (!allowed.includes(fulfillmentStatus)) {
      throw new HttpsError('failed-precondition', `Cannot move an order from "${current}" to "${fulfillmentStatus}".`);
    }
    tx.update(orderRef, {
      fulfillmentStatus,
      statusHistory: FieldValue.arrayUnion({ status: fulfillmentStatus, at: new Date().toISOString(), source: 'admin' }),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});

/**
 * Admin-only: creates a wholesale customer's login. Generates a temporary
 * password and returns it once in the response — the admin portal shows it
 * exactly one time for the owner to relay to the customer directly
 * (WhatsApp/SMS); it is never stored or emailed by this system.
 */
exports.createWholesaleAccount = onCall(async (request) => {
  requireAdmin(request);

  const { name, phone, email } = request.data || {};
  const customerName = cleanText(name, 100);
  const customerPhone = cleanText(phone, 24);
  const customerEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!customerName || !PHONE_RE.test(customerPhone) || !EMAIL_RE.test(customerEmail)) {
    throw new HttpsError('invalid-argument', 'A name, phone number, and valid email are required.');
  }

  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  let userRecord;
  try {
    userRecord = await auth.createUser({
      email: customerEmail,
      password: temporaryPassword,
      displayName: customerName,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists.');
    }
    throw err;
  }
  await auth.setCustomUserClaims(userRecord.uid, { wholesale: true });

  await db.collection('customers').doc(userRecord.uid).set({
    uid: userRecord.uid,
    name: customerName,
    phone: customerPhone,
    email: customerEmail,
    accountType: 'wholesale',
    orderCount: 0,
    totalSpent: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid, email: customerEmail, temporaryPassword };
});
