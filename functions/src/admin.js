// Admin-only callables. Every entry point re-checks the `admin` custom claim
// server-side; Firestore rules are a second, independent gate.
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { ADMIN_TARGETS, LEGACY_TO_STATUS } = require('./orders');
const { adminTransition } = require('./lifecycle');
const { OUTBOX } = require('./sms');
const { cleanText, requireAdmin, log } = require('./util');

const ORDER_ID_RE = /^[A-Za-z0-9]{20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9 ()-]{7,24}$/;

/**
 * { orderId, status, note? } — new portal.
 * { orderId, fulfillmentStatus } — legacy portal (processing | fulfilled | cancelled).
 */
async function updateOrderStatus(request, { db }) {
  const adminUid = requireAdmin(request);
  const { orderId, status, fulfillmentStatus, note } = request.data || {};
  const target = status || LEGACY_TO_STATUS[fulfillmentStatus];
  if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId) || !ADMIN_TARGETS.includes(target)) {
    throw new HttpsError('invalid-argument', `A valid orderId and status (${ADMIN_TARGETS.join(', ')}) are required.`);
  }
  const cleanNote = cleanText(note, 200) || undefined;
  const result = await adminTransition(db, orderId, target, { adminUid, note: cleanNote });
  log.info('order status updated by admin', { orderId, status: target, changed: result.changed, adminUid });
  return { ok: true, ...result };
}

/**
 * Re-queues an order SMS that failed, was skipped (SMS disabled at the time),
 * or is stuck/unknown. `force` is required for `unknown`/`sending`, since the
 * customer may already have received it.
 */
async function resendOrderSms(request, { db }) {
  const adminUid = requireAdmin(request);
  const { orderId, status, force } = request.data || {};
  if (typeof orderId !== 'string' || !ORDER_ID_RE.test(orderId) || typeof status !== 'string' || !/^[a-z_]{3,20}$/.test(status)) {
    throw new HttpsError('invalid-argument', 'A valid orderId and status are required.');
  }
  const ref = db.collection(OUTBOX).doc(`${orderId}_${status}`);
  const state = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'No SMS was queued for that order status.');
    const current = snap.data().state;
    if (current === 'sent' && force !== true) throw new HttpsError('failed-precondition', 'This SMS was already sent.');
    if (['sending', 'unknown'].includes(current) && force !== true) {
      throw new HttpsError('failed-precondition', 'This SMS may already have been delivered. Confirm to send it again.');
    }
    if (current === 'queued') return current;
    tx.update(ref, { state: 'queued', requeuedBy: adminUid, requeuedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return 'queued';
  });
  log.info('order sms requeued by admin', { orderId, status, adminUid });
  return { ok: true, state };
}

/** Creates a wholesale login and returns a one-time temporary password (never stored). */
async function createWholesaleAccount(request, { db, auth }) {
  requireAdmin(request);
  const { name, phone, email } = request.data || {};
  const customerName = cleanText(name, 100);
  const customerPhone = cleanText(phone, 24);
  const customerEmail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
  if (customerName.length < 2 || !PHONE_RE.test(customerPhone) || !EMAIL_RE.test(customerEmail)) {
    throw new HttpsError('invalid-argument', 'A name, phone number, and valid email are required.');
  }
  const temporaryPassword = crypto.randomBytes(12).toString('base64url');
  let userRecord;
  try {
    userRecord = await auth.createUser({ email: customerEmail, password: temporaryPassword, displayName: customerName });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with this email already exists.');
    log.error('create wholesale account failed', err);
    throw new HttpsError('internal', 'Could not create the account.');
  }
  await auth.setCustomUserClaims(userRecord.uid, { wholesale: true });
  await db.collection('customers').doc(userRecord.uid).set({
    uid: userRecord.uid, name: customerName, phone: customerPhone, email: customerEmail,
    accountType: 'wholesale', orderCount: 0, totalSpent: 0,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  log.info('wholesale account created', { uid: userRecord.uid });
  return { uid: userRecord.uid, email: customerEmail, temporaryPassword };
}

module.exports = { updateOrderStatus, resendOrderSms, createWholesaleAccount };
