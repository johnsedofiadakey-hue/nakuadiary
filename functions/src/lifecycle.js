// Order lifecycle operations shared by the webhook, the hold-expiry scheduler
// and the admin callable. Each is a single Firestore transaction: all reads
// (order, products, SMS outbox, customer) first, then all writes.
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { canTransition, currentStatus, statusFields, writeAuditEvent, readProducts, applyStock } = require('./orders');
const { prepareSms } = require('./sms');
const { log } = require('./util');

const PAID_STATES = new Set(['paid', 'processing', 'dispatched', 'delivered']);

/** Returns a pending order's stock and moves it to `to` ('failed' | 'cancelled'). No-op unless pending_payment. */
async function releaseOrder(db, orderId, { to, actor, note }) {
  const orderRef = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return 'missing';
    const order = snap.data();
    const from = currentStatus(order);
    if (from !== 'pending_payment' || !canTransition(from, to, actor.type)) return 'skipped';
    const products = order.stockHold?.state === 'held' ? await readProducts(tx, db, order.lines) : null;
    if (products) applyStock(tx, products, order.lines, +1, { strict: false });
    tx.update(orderRef, {
      ...statusFields(order, to, actor, note),
      'stockHold.state': products ? 'released' : (order.stockHold?.state || 'none'),
      'stockHold.releasedAt': FieldValue.serverTimestamp(),
      ...(to === 'failed' ? { 'payment.status': 'failed' } : {}),
    });
    writeAuditEvent(tx, orderRef, { from, to, actor, note });
    return to;
  });
}

/**
 * Applies a Paystack-verified successful payment. `verified` is the `data`
 * object from GET /transaction/verify — never the webhook body alone.
 * Returns an outcome string for logging.
 */
async function markPaid(db, orderId, verified, { source }) {
  const orderRef = db.collection('orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return 'unknown_order';
    const order = snap.data();
    const from = currentStatus(order);
    if (PAID_STATES.has(from) || order.payment?.status === 'paid') return 'already_paid';

    const expectedMinor = Math.round(order.total * 100);
    if (verified.status !== 'success') return 'not_successful';
    if (Number(verified.amount) !== expectedMinor || String(verified.currency).toUpperCase() !== order.currency) {
      tx.update(orderRef, {
        'payment.mismatch': { amountMinor: Number(verified.amount) || null, currency: String(verified.currency || ''), expectedMinor, detectedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      });
      writeAuditEvent(tx, orderRef, { from, to: from, actor: { type: 'paystack' }, note: 'payment_amount_mismatch' });
      return 'amount_mismatch';
    }

    // Late payment after the hold expired (or an admin cancelled the unpaid
    // order): the money is real, so record it; re-take stock if we can.
    const adminCancelled = from === 'cancelled' && (order.statusHistory || []).at(-1)?.actor?.type === 'admin';
    const needsStock = order.stockHold?.state !== 'held';
    const products = needsStock && !adminCancelled ? await readProducts(tx, db, order.lines) : null;
    const customerRef = db.collection('customers').doc(order.customerId);
    const customerSnap = await tx.get(customerRef);
    const writeSms = adminCancelled ? () => {} : await prepareSms(tx, db, orderId, 'paid');
    const writeOwnerAlert = await prepareSms(tx, db, orderId, 'paid', { audience: 'owner' });

    let stockState = order.stockHold?.state === 'held' ? 'committed' : order.stockHold?.state;
    let stockIssue = false;
    if (products) {
      const taken = applyStock(tx, products, order.lines, -1, { strict: true });
      if (taken.ok) stockState = 'committed'; else stockIssue = true;
    }

    const payment = {
      provider: 'paystack',
      reference: orderId,
      status: 'paid',
      transactionId: verified.id != null ? String(verified.id) : null,
      channel: typeof verified.channel === 'string' ? verified.channel : null,
      paidAt: typeof verified.paid_at === 'string' ? verified.paid_at : new Date().toISOString(),
      amount: Number(verified.amount) / 100,
      currency: order.currency,
      gatewayResponse: typeof verified.gateway_response === 'string' ? verified.gateway_response.slice(0, 120) : null,
      verifiedAt: Timestamp.now(),
      verifiedBy: source,
    };

    const actor = { type: 'paystack' };
    const update = adminCancelled
      ? { payment, paymentStatus: 'paid', refund: { required: true, status: 'pending', reason: 'paid_after_cancellation', flaggedAt: Timestamp.now() }, updatedAt: FieldValue.serverTimestamp() }
      : { ...statusFields(order, 'paid', actor, from === 'pending_payment' ? undefined : `late_payment_after_${from}`), payment, paidAt: FieldValue.serverTimestamp(), 'stockHold.state': stockState || 'none', stockIssue };
    tx.update(orderRef, update);
    writeAuditEvent(tx, orderRef, { from, to: adminCancelled ? from : 'paid', actor, note: adminCancelled ? 'paid_after_cancellation' : stockIssue ? 'paid_stock_unavailable' : undefined });

    tx.set(customerRef, {
      name: order.customer.name,
      phone: order.customer.phone,
      accountType: order.accountType,
      uid: order.accountType === 'wholesale' ? order.buyerUid : null,
      orderCount: FieldValue.increment(1),
      totalSpent: FieldValue.increment(order.total),
      lastOrderAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(customerSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    tx.set(db.collection('carts').doc(order.buyerUid), { lines: [], updatedAt: FieldValue.serverTimestamp() });
    writeSms(order);
    writeOwnerAlert(order);
    return adminCancelled ? 'paid_after_cancellation' : stockIssue ? 'paid_stock_issue' : 'paid';
  });
}

/** Admin-driven status change with audit trail, restock on cancel, refund flag, and SMS. */
async function adminTransition(db, orderId, to, { adminUid, note }) {
  const orderRef = db.collection('orders').doc(orderId);
  const actor = { type: 'admin', uid: adminUid };
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    const from = currentStatus(order);
    if (from === to) return { status: to, changed: false };
    if (!canTransition(from, to, 'admin')) {
      const hint = from === 'pending_payment' ? ' This order has not been paid yet.' : '';
      throw new HttpsError('failed-precondition', `Cannot move an order from "${from}" to "${to}".${hint}`);
    }
    const restock = to === 'cancelled' && ['held', 'committed'].includes(order.stockHold?.state);
    const products = restock ? await readProducts(tx, db, order.lines) : null;
    const writeSms = await prepareSms(tx, db, orderId, to);

    if (products) applyStock(tx, products, order.lines, +1, { strict: false });
    const wasPaid = order.paymentStatus === 'paid' || order.payment?.status === 'paid';
    tx.update(orderRef, {
      ...statusFields(order, to, actor, note),
      ...(products ? { 'stockHold.state': 'released', 'stockHold.releasedAt': FieldValue.serverTimestamp() } : {}),
      ...(to === 'cancelled' && wasPaid ? { refund: { required: true, status: 'pending', reason: 'cancelled_after_payment', flaggedAt: Timestamp.now(), flaggedBy: adminUid } } : {}),
    });
    writeAuditEvent(tx, orderRef, { from, to, actor, note });
    writeSms(order);
    return { status: to, changed: true };
  });
}

/** Releases or settles pending orders whose stock hold has expired. */
async function expireHolds(db, { verify, now = Timestamp.now(), limit = 100 }) {
  const snap = await db.collection('orders')
    .where('status', '==', 'pending_payment')
    .where('stockHold.heldUntil', '<=', now)
    .orderBy('stockHold.heldUntil')
    .limit(limit)
    .get();
  const outcomes = {};
  for (const doc of snap.docs) {
    let outcome;
    try {
      // Ask Paystack first: the customer may have paid but the webhook hasn't landed yet.
      const verified = await verify(doc.id).catch((err) => (err.httpStatus === 400 || err.httpStatus === 404 ? { status: 'abandoned' } : Promise.reject(err)));
      outcome = verified.status === 'success'
        ? await markPaid(db, doc.id, verified, { source: 'hold_expiry' })
        : ['failed', 'reversed'].includes(verified.status)
          ? await releaseOrder(db, doc.id, { to: 'failed', actor: { type: 'system' }, note: `payment_${verified.status}` })
          : ['ongoing', 'pending', 'processing', 'queued'].includes(verified.status) && now.toMillis() - doc.data().stockHold.heldUntil.toMillis() < 24 * 60 * 60 * 1000
            ? 'still_in_progress' // re-checked next run; give up after 24h past the hold
            : await releaseOrder(db, doc.id, { to: 'cancelled', actor: { type: 'system' }, note: 'payment_window_expired' });
    } catch (err) {
      outcome = 'error';
      log.error('hold expiry failed for order', err, { orderId: doc.id });
    }
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;
  }
  return outcomes;
}

module.exports = { releaseOrder, markPaid, adminTransition, expireHolds, PAID_STATES };
