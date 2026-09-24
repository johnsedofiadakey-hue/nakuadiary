// Order state machine, timeline, stock holds, and legacy-field mirroring.
// Every mutation here runs inside a Firestore transaction supplied by the
// caller, so status, stock, timeline and SMS outbox always change together.
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { STOCK_HOLD_MINUTES } = require('./config');

const STATUSES = ['pending_payment', 'paid', 'processing', 'dispatched', 'delivered', 'cancelled', 'failed'];

// Who may make each transition: 'paystack' = verified webhook, 'system' = checkout / scheduler, 'admin' = updateOrderStatus.
const TRANSITIONS = {
  pending_payment: { paid: ['paystack', 'system'], failed: ['paystack', 'system'], cancelled: ['system', 'admin'] },
  paid: { processing: ['admin'], cancelled: ['admin'] },
  processing: { dispatched: ['admin'], delivered: ['admin'], cancelled: ['admin'] }, // delivered directly = pickup collected
  dispatched: { delivered: ['admin'], cancelled: ['admin'] },
  delivered: {},
  cancelled: {},
  failed: {},
};

const ADMIN_TARGETS = ['processing', 'dispatched', 'delivered', 'cancelled'];

// Statuses that text the customer (templates in sms.js).
const SMS_STATUSES = ['paid', 'processing', 'dispatched', 'delivered'];

// The pre-existing admin portal reads fulfillmentStatus/paymentStatus and
// sends legacy fulfillment values; keep both mirrored so it keeps working.
const LEGACY_FULFILLMENT = {
  pending_payment: 'unfulfilled', paid: 'unfulfilled', processing: 'processing', dispatched: 'processing',
  delivered: 'fulfilled', cancelled: 'cancelled', failed: 'cancelled',
};
const LEGACY_TO_STATUS = { processing: 'processing', fulfilled: 'delivered', cancelled: 'cancelled' };

function canTransition(from, to, actorType) {
  return (TRANSITIONS[from]?.[to] || []).includes(actorType);
}

/** Current status of an order, including orders written before `status` existed. */
function currentStatus(order) {
  if (STATUSES.includes(order.status)) return order.status;
  if (order.fulfillmentStatus === 'cancelled') return order.paymentStatus === 'failed' ? 'failed' : 'cancelled';
  if (order.fulfillmentStatus === 'fulfilled') return 'delivered';
  if (order.fulfillmentStatus === 'processing') return 'processing';
  if (order.paymentStatus === 'paid') return 'paid';
  if (order.paymentStatus === 'failed') return 'failed';
  return 'pending_payment';
}

function timelineEntry(status, actor, note) {
  return {
    status,
    at: Timestamp.now(), // serverTimestamp() is not allowed inside arrays
    actor: { type: actor.type, uid: actor.uid || null },
    ...(note ? { note } : {}),
  };
}

/** Fields to write for a status change: status, legacy mirrors, timeline. */
function statusFields(order, status, actor, note) {
  const paymentStatus = status === 'paid' ? 'paid'
    : status === 'failed' ? 'failed'
    : order.paymentStatus || 'pending';
  return {
    status,
    fulfillmentStatus: LEGACY_FULFILLMENT[status],
    paymentStatus,
    statusHistory: [...(order.statusHistory || []), timelineEntry(status, actor, note)],
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Append-only audit record next to the order (never updated or deleted). */
function writeAuditEvent(tx, orderRef, { from, to, actor, note }) {
  tx.set(orderRef.collection('events').doc(), {
    type: 'status_change', from, to,
    actor: { type: actor.type, uid: actor.uid || null },
    ...(note ? { note } : {}),
    at: FieldValue.serverTimestamp(),
  });
}

// ---- Stock -----------------------------------------------------------------------

const productRef = (db, id) => db.collection('products').doc(id);

/**
 * Reads every product an order touches (all reads must happen before any
 * write in a Firestore transaction). Returns Map<productId, {ref, data}>.
 */
async function readProducts(tx, db, lines) {
  const ids = [...new Set(lines.map((line) => line.productId))];
  const snaps = await Promise.all(ids.map((id) => tx.get(productRef(db, id))));
  return new Map(snaps.map((snap) => [snap.id, { ref: snap.ref, data: snap.exists ? snap.data() : null }]));
}

/**
 * Applies a stock delta (negative = take, positive = return) for each line
 * against products already read in this transaction. With `strict`, a
 * `deny`-policy variant that would drop below zero returns a shortage
 * instead of writing anything. Returns { ok, shortages }.
 */
function applyStock(tx, products, lines, direction, { strict }) {
  const next = new Map();
  const shortages = [];
  for (const line of lines) {
    const entry = products.get(line.productId);
    if (!entry?.data) { if (direction < 0) shortages.push({ productId: line.productId, variantId: line.variantId, available: 0 }); continue; }
    const product = next.get(line.productId) || { ...entry.data, variants: (entry.data.variants || []).map((v) => ({ ...v })) };
    const variant = product.variants.find((v) => v.id === line.variantId);
    if (!variant) { if (direction < 0) shortages.push({ productId: line.productId, variantId: line.variantId, available: 0 }); continue; }
    const stock = Number.isFinite(variant.stock) ? variant.stock : 0;
    const after = stock + direction * line.quantity;
    if (direction < 0 && strict && product.inventoryPolicy !== 'continue' && after < 0) {
      shortages.push({ productId: line.productId, variantId: line.variantId, available: Math.max(0, stock) });
      continue;
    }
    variant.stock = after;
    next.set(line.productId, product);
  }
  if (shortages.length) return { ok: false, shortages };
  for (const [id, product] of next) {
    tx.update(products.get(id).ref, { variants: product.variants, updatedAt: FieldValue.serverTimestamp() });
  }
  return { ok: true, shortages: [] };
}

const holdExpiry = (from = Date.now()) => Timestamp.fromMillis(from + STOCK_HOLD_MINUTES * 60 * 1000);

module.exports = {
  STATUSES, TRANSITIONS, ADMIN_TARGETS, SMS_STATUSES, LEGACY_TO_STATUS,
  canTransition, currentStatus, statusFields, writeAuditEvent, readProducts, applyStock, holdExpiry,
};
