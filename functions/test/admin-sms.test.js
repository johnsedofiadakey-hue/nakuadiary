const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckout } = require('../src/checkout');
const { markPaid } = require('../src/lifecycle');
const { updateOrderStatus, resendOrderSms } = require('../src/admin');
const { processOutboxDoc, renderTemplate, toRecipient } = require('../src/sms');
const h = require('./helpers');

const smsOpts = { apiKey: 'mnotify-test-key', smsEnabled: true, senderIdParam: 'NAKUADIARY' };
const getOrder = async (id) => (await h.db.collection('orders').doc(id).get()).data();
const outbox = async (id) => (await h.db.collection('smsOutbox').doc(id).get()).data();
const mnotifyOk = () => ({ status: 200, json: { status: 'success', code: '2000', message: 'messages sent successfully', summary: { _id: 'CAMPAIGN-1', type: 'API QUICK SMS', total_sent: 1, contacts: 1, total_rejected: 0, numbers_sent: [], credit_used: 1, credit_left: 99 } } });

async function paidOrder() {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  let orderId;
  try {
    ({ orderId } = await createCheckout(h.callable({ lines: [{ productId: 'body-wave', variantId: '16-inches', quantity: 1 }], customer: h.customer }), { db: h.db, secretKey: h.SECRET, allowedOrigins: h.ORIGINS, enforceAppCheck: false }));
  } finally { f.restore(); }
  await markPaid(h.db, orderId, { status: 'success', amount: 62000, currency: 'GHS', id: 1, reference: orderId }, { source: 'test' });
  return orderId;
}
const adminCall = (data, uid = 'admin-1') => updateOrderStatus(h.callable(data, { uid, admin: true }), { db: h.db });

test.beforeEach(async () => { await h.resetDb(); await h.seedProduct(); });

// ---- Admin status changes ----------------------------------------------------------

test('only admins can change status or resend SMS', async () => {
  const orderId = await paidOrder();
  await assert.rejects(updateOrderStatus(h.callable({ orderId, status: 'processing' }), { db: h.db }), /Admin access required/);
  await assert.rejects(updateOrderStatus({ data: { orderId, status: 'processing' } }, { db: h.db }), /sign in/i);
  await assert.rejects(resendOrderSms(h.callable({ orderId, status: 'paid' }), { db: h.db }), /Admin access required/);
});

test('status flow is enforced, audited with the admin uid, and mirrored for the legacy portal', async () => {
  const orderId = await paidOrder();
  await assert.rejects(adminCall({ orderId, status: 'delivered' }), /Cannot move an order from "paid" to "delivered"/);
  await assert.rejects(adminCall({ orderId, status: 'paid' }), /valid orderId and status/);
  await adminCall({ orderId, status: 'processing', note: 'Packed' });
  await adminCall({ orderId, status: 'dispatched' });
  await adminCall({ orderId, status: 'delivered' });
  await assert.rejects(adminCall({ orderId, status: 'cancelled' }), /Cannot move/);

  const order = await getOrder(orderId);
  assert.equal(order.status, 'delivered');
  assert.equal(order.fulfillmentStatus, 'fulfilled');
  const adminEntries = order.statusHistory.filter((e) => e.actor.type === 'admin');
  assert.deepEqual(adminEntries.map((e) => [e.status, e.actor.uid]), [['processing', 'admin-1'], ['dispatched', 'admin-1'], ['delivered', 'admin-1']]);
  assert.equal(adminEntries[0].note, 'Packed');
  assert.ok(adminEntries.every((e) => typeof e.at.toMillis === 'function'));
  const events = (await h.db.collection('orders').doc(orderId).collection('events').get()).docs.map((d) => d.data());
  assert.equal(events.filter((e) => e.actor.uid === 'admin-1').length, 3);
});

test('unpaid orders cannot be fulfilled', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  let orderId;
  try { ({ orderId } = await createCheckout(h.callable({ lines: [{ productId: 'body-wave', variantId: '16-inches', quantity: 1 }], customer: h.customer }), { db: h.db, secretKey: h.SECRET, allowedOrigins: h.ORIGINS, enforceAppCheck: false })); } finally { f.restore(); }
  await assert.rejects(adminCall({ orderId, status: 'processing' }), /not been paid/);
  await adminCall({ orderId, status: 'cancelled' });
  assert.equal(await h.stockOf('body-wave', '16-inches'), 3);
  assert.equal((await getOrder(orderId)).refund, null);
});

test('legacy portal payloads still work', async () => {
  const orderId = await paidOrder();
  await adminCall({ orderId, fulfillmentStatus: 'processing' });
  await adminCall({ orderId, fulfillmentStatus: 'fulfilled' }); // pickup: processing → delivered
  const order = await getOrder(orderId);
  assert.equal(order.status, 'delivered');
  assert.equal(order.fulfillmentStatus, 'fulfilled');
});

test('cancelling a paid order restocks it and flags a manual refund', async () => {
  const orderId = await paidOrder();
  assert.equal(await h.stockOf('body-wave', '16-inches'), 2);
  await adminCall({ orderId, status: 'cancelled' });
  const order = await getOrder(orderId);
  assert.equal(order.status, 'cancelled');
  assert.equal(order.refund.required, true);
  assert.equal(order.refund.flaggedBy, 'admin-1');
  assert.equal(await h.stockOf('body-wave', '16-inches'), 3);
});

test('repeated clicks and concurrent requests produce one status change and one SMS', async () => {
  const orderId = await paidOrder();
  await Promise.allSettled([1, 2, 3, 4].map(() => adminCall({ orderId, status: 'processing' })));
  const order = await getOrder(orderId);
  assert.equal(order.statusHistory.filter((e) => e.status === 'processing').length, 1);
  const queued = await h.db.collection('smsOutbox').where('orderId', '==', orderId).get();
  assert.deepEqual(queued.docs.map((d) => d.id).sort(), [`${orderId}_owner_paid`, `${orderId}_paid`, `${orderId}_processing`]);
});

// ---- SMS ---------------------------------------------------------------------------

test('sends through MNotify exactly once, and records safe metadata only', async () => {
  const orderId = await paidOrder();
  const f = h.fakeFetch({ 'api.mnotify.com/api/sms/quick': mnotifyOk });
  try {
    const results = await Promise.all([1, 2, 3].map(() => processOutboxDoc(h.db, `${orderId}_paid`, smsOpts)));
    assert.deepEqual(results.sort(), ['not-queued', 'not-queued', 'sent']);
    assert.equal(f.calls.length, 1);
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.recipient, ['0241234567']);
    assert.equal(body.sender, 'NAKUADIARY');
    assert.equal(body.is_schedule, false);
    assert.equal(body.sms_type, undefined);
    const order = await getOrder(orderId);
    assert.ok(body.message.includes(order.reference));
    assert.ok(body.message.startsWith('Hi Ama,'));
    assert.match(f.calls[0].url, /\?key=mnotify-test-key$/);
  } finally { f.restore(); }
  const doc = await outbox(`${orderId}_paid`);
  assert.equal(doc.state, 'sent');
  assert.equal(doc.provider.campaignId, 'CAMPAIGN-1');
  assert.equal(doc.attempts, 1);
  const stored = JSON.stringify(doc);
  assert.ok(!stored.includes('mnotify-test-key') && !stored.includes('0241234567') && !stored.includes('Ama'), 'no key, phone or name stored');
});

test('SMS disabled or no sender id → skipped (and can be resent later)', async () => {
  const orderId = await paidOrder();
  const f = h.fakeFetch({});
  try {
    assert.equal(await processOutboxDoc(h.db, `${orderId}_paid`, { ...smsOpts, smsEnabled: false }), 'skipped');
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
  await resendOrderSms(h.callable({ orderId, status: 'paid' }, { admin: true }), { db: h.db });
  assert.equal((await outbox(`${orderId}_paid`)).state, 'queued');
});

test('provider rejection → failed; timeout → unknown and needs explicit force to resend', async () => {
  const orderId = await paidOrder();
  let f = h.fakeFetch({ 'sms/quick': () => ({ status: 200, json: { status: 'error', code: '1004', message: 'Sender ID not approved' } }) });
  try { assert.equal(await processOutboxDoc(h.db, `${orderId}_paid`, smsOpts), 'failed'); } finally { f.restore(); }
  assert.equal((await outbox(`${orderId}_paid`)).error.code, '1004');

  await resendOrderSms(h.callable({ orderId, status: 'paid' }, { admin: true }), { db: h.db });
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  f = h.fakeFetch({ 'sms/quick': () => timeout });
  try { assert.equal(await processOutboxDoc(h.db, `${orderId}_paid`, smsOpts), 'unknown'); } finally { f.restore(); }
  const unknown = await outbox(`${orderId}_paid`);
  assert.ok(!JSON.stringify(unknown).includes('mnotify-test-key'));
  await assert.rejects(resendOrderSms(h.callable({ orderId, status: 'paid' }, { admin: true }), { db: h.db }), /may already have been delivered/);
  await resendOrderSms(h.callable({ orderId, status: 'paid', force: true }, { admin: true }), { db: h.db });
  assert.equal((await outbox(`${orderId}_paid`)).state, 'queued');
});

test('templates and sender id come from the protected config doc when set', async () => {
  const orderId = await paidOrder();
  await h.db.collection('config').doc('sms').set({ senderId: 'NAKUA', templates: { paid: 'Paid! Ref {reference} for {name}.' } });
  const f = h.fakeFetch({ 'sms/quick': mnotifyOk });
  try {
    await processOutboxDoc(h.db, `${orderId}_paid`, smsOpts);
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.sender, 'NAKUA');
    assert.match(body.message, /^Paid! Ref NKD-\w{6} for Ama\.$/);
  } finally { f.restore(); }
});

test('template rendering and recipient formatting', () => {
  const order = { reference: 'NKD-ABC234', customer: { name: '  <script>Kofi  Boateng', deliveryPreference: 'Pickup' } };
  assert.equal(renderTemplate('Hi {name}, {reference} ready for {deliveryPreference}. {unknown}', order), 'Hi scriptKofi, NKD-ABC234 ready for pickup. {unknown}');
  assert.equal(toRecipient('+233 24 123 4567'), '0241234567');
  assert.equal(toRecipient('024-123-4567'), '0241234567');
  assert.equal(toRecipient('+44 7700 900123'), '447700900123');
});

// ---- Owner alerts --------------------------------------------------------------------

test('a paid order queues one owner alert, sent to the number in config/sms', async () => {
  const orderId = await paidOrder();
  const alert = await outbox(`${orderId}_owner_paid`);
  assert.equal(alert.audience, 'owner');
  assert.equal(alert.to, 'shop owner');

  // No owner number configured → skipped, nothing sent.
  let f = h.fakeFetch({});
  try { assert.equal(await processOutboxDoc(h.db, `${orderId}_owner_paid`, smsOpts), 'skipped'); assert.equal(f.calls.length, 0); } finally { f.restore(); }
  assert.equal((await outbox(`${orderId}_owner_paid`)).reason, 'no_owner_phone');

  await h.db.collection('config').doc('sms').set({ ownerPhone: '020 999 8888' });
  await resendOrderSms(h.callable({ orderId, status: 'owner_paid' }, { admin: true }), { db: h.db });
  f = h.fakeFetch({ 'sms/quick': mnotifyOk });
  try {
    assert.equal(await processOutboxDoc(h.db, `${orderId}_owner_paid`, smsOpts), 'sent');
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.recipient, ['0209998888']);
    assert.match(body.message, /^New paid order NKD-\w{6}: 1 item\(s\), GHS 620\.00, delivery\. Customer: Ama\.$/);
  } finally { f.restore(); }
});

test('owner alerts can be switched off in config/sms', async () => {
  const orderId = await paidOrder();
  await h.db.collection('config').doc('sms').set({ ownerPhone: '0209998888', ownerAlerts: false });
  const f = h.fakeFetch({});
  try { assert.equal(await processOutboxDoc(h.db, `${orderId}_owner_paid`, smsOpts), 'skipped'); assert.equal(f.calls.length, 0); } finally { f.restore(); }
});
