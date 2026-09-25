// createCheckout: validates the cart, prices it from Firestore, reserves stock
// and writes an immutable order snapshot in ONE transaction, then opens a
// Paystack transaction whose reference is the order id. The browser only
// ever chooses which product/variant/quantity — never price or totals.
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { CURRENCY, PAYSTACK_EMAIL_DOMAIN, MAX_LINES, MAX_QUANTITY } = require('./config');
const { readProducts, applyStock, holdExpiry, statusFields, writeAuditEvent } = require('./orders');
const { resolveDelivery } = require('./delivery');
const { initializeTransaction } = require('./paystack');
const { cleanText, normalizePhone, makeOrderReference, requireAuth, requireAppCheck, log } = require('./util');

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const DELIVERY_PREFERENCES = new Set(['Delivery', 'Pickup']);
const MAX_OPEN_CHECKOUTS = 5;

/** Validates and merges cart lines. Throws invalid-argument on anything malformed. */
function parseLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) {
    throw new HttpsError('invalid-argument', 'Your cart is empty or has too many items.');
  }
  const merged = new Map();
  for (const raw of lines) {
    const { productId, variantId, quantity } = raw || {};
    if (!ID_RE.test(productId || '') || !ID_RE.test(variantId || '') || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpsError('invalid-argument', 'One of the items in your cart is not valid. Please remove it and try again.');
    }
    const key = `${productId}::${variantId}`;
    const total = (merged.get(key)?.quantity || 0) + quantity;
    if (total > MAX_QUANTITY) throw new HttpsError('invalid-argument', `You can order up to ${MAX_QUANTITY} of one item at a time.`);
    merged.set(key, { productId, variantId, quantity: total });
  }
  return [...merged.values()];
}

function parseCustomer(customer) {
  const name = cleanText(customer?.name, 100);
  const phone = cleanText(customer?.phone, 24);
  const deliveryPreference = cleanText(customer?.deliveryPreference, 20);
  const deliveryAddress = cleanText(customer?.deliveryAddress, 240);
  const deliveryZone = cleanText(customer?.deliveryZone, 60);
  const phoneDigits = normalizePhone(phone);
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Please enter your full name.');
  if (!/^[+0-9 ()-]{7,24}$/.test(phone) || !/^\d{9,15}$/.test(phoneDigits)) throw new HttpsError('invalid-argument', 'Please enter a valid phone number.');
  if (!DELIVERY_PREFERENCES.has(deliveryPreference)) throw new HttpsError('invalid-argument', 'Please choose delivery or pickup.');
  if (deliveryPreference === 'Delivery' && deliveryAddress.length < 3) throw new HttpsError('invalid-argument', 'Please add a delivery address or landmark, or choose pickup.');
  return { name, phone, phoneNormalized: phoneDigits, deliveryPreference, deliveryAddress: deliveryPreference === 'Delivery' ? deliveryAddress : null, deliveryZone: deliveryPreference === 'Delivery' ? deliveryZone : '' };
}

/** Only redirect back to our own origins; anything else falls back to Paystack's dashboard callback. */
function safeCallbackUrl(callbackUrl, allowedOrigins) {
  if (typeof callbackUrl !== 'string' || callbackUrl.length > 500) return null;
  try {
    const url = new URL(callbackUrl);
    const allowed = allowedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
    return allowed.includes(url.origin) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function unitPriceFor(product, variant, accountType) {
  const pick = (...values) => values.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return accountType === 'wholesale'
    ? pick(variant.wholesalePrice, product.wholesalePrice, variant.price, product.price)
    : pick(variant.price, product.price);
}

const roundMoney = (value) => Math.round(value * 100) / 100;

async function createCheckout(request, { db, secretKey, allowedOrigins, enforceAppCheck }) {
  requireAppCheck(request, enforceAppCheck);
  const uid = requireAuth(request);
  const accountType = request.auth.token?.wholesale === true ? 'wholesale' : 'retail';
  const lines = parseLines(request.data?.lines);
  const customer = parseCustomer(request.data?.customer);
  const callbackUrl = safeCallbackUrl(request.data?.callbackUrl, allowedOrigins);

  // Abuse guard: expired holds are cleared by the scheduler, so this only
  // blocks someone spinning up many live checkouts at once.
  const open = await db.collection('orders').where('buyerUid', '==', uid).where('status', '==', 'pending_payment').count().get();
  if (open.data().count >= MAX_OPEN_CHECKOUTS) {
    throw new HttpsError('resource-exhausted', 'You have several unfinished checkouts. Please complete one or try again in an hour.');
  }

  const settingsSnap = await db.collection('site').doc('settings').get();
  const settingsDoc = settingsSnap.exists ? settingsSnap.data() : {};

  const orderRef = db.collection('orders').doc();
  const reference = makeOrderReference();
  const customerId = accountType === 'wholesale' ? uid : `p_${customer.phoneNormalized}`;

  const order = await db.runTransaction(async (tx) => {
    const products = await readProducts(tx, db, lines);
    const snapshotLines = lines.map((line) => {
      const product = products.get(line.productId)?.data;
      if (!product || product.active !== true) throw new HttpsError('failed-precondition', 'One of the items in your cart is no longer available. Please remove it and try again.');
      const variant = (product.variants || []).find((v) => v.id === line.variantId);
      if (!variant || variant.available === false) throw new HttpsError('failed-precondition', `The selected option for ${product.name} is no longer available.`);
      if (accountType === 'wholesale') {
        const minQty = Number.isInteger(product.minWholesaleQty) ? product.minWholesaleQty : 1;
        if (line.quantity < minQty) throw new HttpsError('invalid-argument', `${product.name} needs at least ${minQty} at wholesale pricing.`);
      }
      const unitPrice = unitPriceFor(product, variant, accountType);
      if (!unitPrice) throw new HttpsError('failed-precondition', `${product.name} can't be ordered right now.`);
      const cover = (Array.isArray(product.images) && product.images[0]?.url) || product.image?.url || null;
      return {
        productId: line.productId,
        productName: String(product.name || ''),
        variantId: line.variantId,
        variantLabel: String(variant.label || line.variantId),
        title: `${product.name} — ${variant.label}`, // legacy field read by the current admin portal
        quantity: line.quantity,
        unitPrice,
        lineTotal: roundMoney(unitPrice * line.quantity),
        image: cover,
      };
    });

    const stock = applyStock(tx, products, lines, -1, { strict: true });
    if (!stock.ok) {
      const short = stock.shortages[0];
      const line = snapshotLines.find((l) => l.productId === short.productId && l.variantId === short.variantId);
      throw new HttpsError('failed-precondition', short.available > 0
        ? `Only ${short.available} left of ${line?.title || 'one item'}. Please reduce the quantity.`
        : `${line?.title || 'One item'} is sold out. Please remove it from your cart.`);
    }

    const subtotal = roundMoney(snapshotLines.reduce((sum, l) => sum + l.lineTotal, 0));
    const delivery = resolveDelivery(settingsDoc, { preference: customer.deliveryPreference, zone: customer.deliveryZone, subtotal });
    const base = { statusHistory: [], paymentStatus: 'pending' };
    const doc = {
      reference,
      buyerUid: uid,
      customerId,
      accountType,
      paystackEmail: `${customer.phoneNormalized}@${PAYSTACK_EMAIL_DOMAIN}`,
      customer: {
        name: customer.name,
        phone: customer.phone,
        phoneNormalized: customer.phoneNormalized,
        deliveryPreference: customer.deliveryPreference,
        deliveryAddress: customer.deliveryAddress,
        deliveryZone: delivery.zone,
      },
      lines: snapshotLines,
      itemCount: snapshotLines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal,
      delivery,
      deliveryFee: delivery.fee,
      total: roundMoney(subtotal + delivery.fee),
      currency: CURRENCY,
      payment: { provider: 'paystack', reference: orderRef.id, status: 'pending' },
      stockHold: { state: 'held', heldUntil: holdExpiry() },
      refund: null,
      stockIssue: false,
      createdAt: FieldValue.serverTimestamp(),
      ...statusFields(base, 'pending_payment', { type: 'system' }),
    };
    tx.create(orderRef, doc);
    writeAuditEvent(tx, orderRef, { from: null, to: 'pending_payment', actor: { type: 'system' }, note: 'checkout_created' });
    return doc;
  });

  try {
    const session = await initializeTransaction(secretKey, {
      email: order.paystackEmail,
      amountMinor: Math.round(order.total * 100),
      currency: CURRENCY,
      reference: orderRef.id,
      callbackUrl,
      orderId: orderRef.id,
    });
    await orderRef.update({ 'payment.initializedAt': FieldValue.serverTimestamp() });
    log.info('checkout created', { orderId: orderRef.id, accountType, lineCount: order.lines.length, total: order.total });
    return { checkoutUrl: session.authorization_url, orderId: orderRef.id, reference };
  } catch (err) {
    log.error('paystack initialize failed', err, { orderId: orderRef.id, httpStatus: err.httpStatus });
    // Release the hold immediately rather than waiting for expiry.
    const { releaseOrder } = require('./lifecycle');
    await releaseOrder(db, orderRef.id, { to: 'failed', actor: { type: 'system' }, note: 'payment_init_failed' }).catch((releaseErr) => log.error('release after init failure failed', releaseErr, { orderId: orderRef.id }));
    throw new HttpsError('unavailable', 'We could not start the payment. Please try again in a moment.');
  }
}

module.exports = { createCheckout, parseLines, parseCustomer, safeCallbackUrl, unitPriceFor };
