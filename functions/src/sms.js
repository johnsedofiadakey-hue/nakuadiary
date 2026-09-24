// Order SMS via MNotify/BMS (https://developer.bms.africa — "Quick Bulk SMS").
//
// Idempotency: a status change enqueues smsOutbox/{orderId}_{status} in the
// same transaction. Because the order state machine never re-enters a status,
// each (order, status) is texted at most once. The sender claims the doc
// (queued → sending) in a transaction before calling MNotify, so retried
// triggers can't double-send. MNotify has no idempotency key, so a crash
// between "sent by MNotify" and "recorded" leaves the doc in `sending`;
// it's never auto-resent — an admin can resend deliberately.
const { FieldValue } = require('firebase-admin/firestore');
const { MNOTIFY_BASE_URL } = require('./config');
const { SMS_STATUSES } = require('./orders');
const { maskPhone, normalizePhone, log } = require('./util');

const OUTBOX = 'smsOutbox';
const TIMEOUT_MS = 15000;

const OWNER_TEMPLATE = 'New paid order {reference}: {itemCount} item(s), GHS {total}, {deliveryPreference}. Customer: {name}.';

const DEFAULT_TEMPLATES = {
  paid: 'Hi {name}, we have received your payment for Nakuadiary order {reference}. We will let you know when it is being prepared.',
  processing: 'Hi {name}, your Nakuadiary order {reference} is being prepared.',
  dispatched: 'Hi {name}, your Nakuadiary order {reference} is on its way to you.',
  delivered: 'Hi {name}, your Nakuadiary order {reference} is complete. Thank you for shopping with us!',
};

const outboxId = (orderId, status) => `${orderId}_${status}`;
const outboxRef = (db, orderId, status) => db.collection(OUTBOX).doc(outboxId(orderId, status));

/**
 * Read phase: call before any transaction writes. Returns a function that
 * writes the outbox doc if needed. `audience: 'owner'` queues the shop-owner
 * alert (smsOutbox/{orderId}_owner_{status}); its number comes from config/sms.
 */
async function prepareSms(tx, db, orderId, status, { audience = 'customer' } = {}) {
  if (audience === 'customer' && !SMS_STATUSES.includes(status)) return () => {};
  const key = audience === 'owner' ? `owner_${status}` : status;
  const ref = outboxRef(db, orderId, key);
  const snap = await tx.get(ref);
  return (order) => {
    if (snap.exists || (audience === 'customer' && !order?.customer?.phone)) return;
    tx.set(ref, {
      orderId,
      status: key,
      audience,
      state: 'queued',
      attempts: 0,
      ...(audience === 'customer' ? { to: maskPhone(order.customer.phone) } : { to: 'shop owner' }), // real numbers are read at send time
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  };
}

/** Local Ghana format as shown in MNotify's docs (0241234567); other numbers as digits. */
function toRecipient(phone) {
  const digits = normalizePhone(phone);
  return digits.startsWith('233') && digits.length === 12 ? `0${digits.slice(3)}` : digits;
}

function renderTemplate(template, order) {
  const firstName = String(order.customer?.name || '').trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 20) || 'there';
  const zone = order.delivery?.zone || order.customer?.deliveryZone;
  const values = {
    name: firstName,
    reference: order.reference || '',
    deliveryPreference: `${String(order.customer?.deliveryPreference || '').toLowerCase()}${zone ? ` (${zone})` : ''}`,
    itemCount: String(order.itemCount ?? (order.lines || []).reduce((n, l) => n + (l.quantity || 0), 0)),
    total: Number(order.total || 0).toFixed(2),
  };
  return template.replace(/\{(name|reference|deliveryPreference|itemCount|total)\}/g, (_, key) => values[key]).replace(/\s+/g, ' ').trim().slice(0, 459);
}

async function loadSmsConfig(db, { senderIdParam }) {
  const snap = await db.collection('config').doc('sms').get();
  const data = snap.exists ? snap.data() : {};
  const templates = { ...DEFAULT_TEMPLATES };
  for (const status of SMS_STATUSES) {
    if (typeof data.templates?.[status] === 'string' && data.templates[status].trim()) templates[status] = data.templates[status].trim();
  }
  const senderId = String((typeof data.senderId === 'string' && data.senderId.trim()) || senderIdParam || '').trim();
  return {
    senderId,
    templates,
    enabled: data.enabled !== false,
    ownerTemplate: typeof data.templates?.owner === 'string' && data.templates.owner.trim() ? data.templates.owner.trim() : OWNER_TEMPLATE,
    ownerPhone: typeof data.ownerPhone === 'string' ? data.ownerPhone.trim() : '',
    ownerAlerts: data.ownerAlerts !== false,
  };
}

/** POST /api/sms/quick. The key travels as the `key` query param per MNotify's docs — never log the URL. */
async function sendQuickSms({ apiKey, senderId, recipient, message }) {
  let response;
  try {
    response = await fetch(`${MNOTIFY_BASE_URL}/sms/quick?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipient: [recipient], sender: senderId, message, is_schedule: false, schedule_date: '' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Deliberately generic: network errors can embed the request URL (and so the key).
    return { ok: false, uncertain: err?.name === 'TimeoutError', error: { code: err?.name === 'TimeoutError' ? 'timeout' : 'network', message: 'Could not reach MNotify.' } };
  }
  let json = null;
  try { json = await response.json(); } catch { /* not JSON */ }
  const summary = json?.summary || {};
  const provider = {
    httpStatus: response.status,
    status: typeof json?.status === 'string' ? json.status : null,
    code: json?.code != null ? String(json.code) : null,
    campaignId: typeof summary._id === 'string' ? summary._id : null,
    totalSent: Number.isFinite(summary.total_sent) ? summary.total_sent : null,
    totalRejected: Number.isFinite(summary.total_rejected) ? summary.total_rejected : null,
    creditUsed: Number.isFinite(summary.credit_used) ? summary.credit_used : null,
  };
  const ok = response.ok && provider.status === 'success' && provider.code === '2000' && provider.totalRejected !== summary.contacts;
  return ok
    ? { ok: true, provider }
    : { ok: false, provider, error: { code: provider.code || `http_${response.status}`, message: typeof json?.message === 'string' ? json.message.slice(0, 160) : 'MNotify rejected the message.' } };
}

/**
 * Processes one outbox doc. Safe to call repeatedly: only a `queued` doc is
 * claimed, and the claim is transactional.
 */
async function processOutboxDoc(db, docId, { apiKey, smsEnabled, senderIdParam }) {
  const ref = db.collection(OUTBOX).doc(docId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().state !== 'queued') return null;
    tx.update(ref, { state: 'sending', attempts: FieldValue.increment(1), claimedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return snap.data();
  });
  if (!claimed) return 'not-queued';

  const finish = (fields) => ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
  const orderSnap = await db.collection('orders').doc(claimed.orderId).get();
  if (!orderSnap.exists) { await finish({ state: 'skipped', reason: 'order_missing' }); return 'skipped'; }
  const order = orderSnap.data();

  const config = await loadSmsConfig(db, { senderIdParam });
  if (!smsEnabled || !config.enabled || !config.senderId || !apiKey) {
    await finish({ state: 'skipped', reason: 'sms_disabled' });
    log.info('sms skipped: disabled', { orderId: claimed.orderId, status: claimed.status });
    return 'skipped';
  }

  const forOwner = claimed.audience === 'owner';
  if (forOwner && (!config.ownerAlerts || !/^\d{9,15}$/.test(normalizePhone(config.ownerPhone)))) {
    await finish({ state: 'skipped', reason: 'no_owner_phone' });
    return 'skipped';
  }
  const template = forOwner ? config.ownerTemplate : config.templates[claimed.status];
  if (!template) { await finish({ state: 'skipped', reason: 'no_template' }); return 'skipped'; }
  const message = renderTemplate(template, order);
  const recipientPhone = forOwner ? config.ownerPhone : order.customer.phone;
  const result = await sendQuickSms({ apiKey, senderId: config.senderId, recipient: toRecipient(recipientPhone), message });
  if (result.ok) {
    await finish({ state: 'sent', provider: result.provider, sentAt: FieldValue.serverTimestamp(), messageLength: message.length, error: FieldValue.delete() });
    log.info('sms sent', { orderId: claimed.orderId, status: claimed.status, campaignId: result.provider.campaignId });
    return 'sent';
  }
  // A timeout may still have been delivered — mark uncertain rather than failed so nobody auto-resends.
  await finish({ state: result.uncertain ? 'unknown' : 'failed', provider: result.provider || null, error: result.error });
  log.warn('sms not sent', { orderId: claimed.orderId, status: claimed.status, code: result.error.code });
  return result.uncertain ? 'unknown' : 'failed';
}

module.exports = { OUTBOX, DEFAULT_TEMPLATES, OWNER_TEMPLATE, outboxId, outboxRef, prepareSms, renderTemplate, toRecipient, loadSmsConfig, sendQuickSms, processOutboxDoc };
