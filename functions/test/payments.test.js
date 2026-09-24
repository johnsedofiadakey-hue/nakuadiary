const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const { createCheckout } = require('../src/checkout');
const { handlePaystackWebhook } = require('../src/webhook');
const { expireHolds } = require('../src/lifecycle');
const { verifyTransaction } = require('../src/paystack');
const h = require('./helpers');

const checkoutOpts = { db: h.db, secretKey: h.SECRET, allowedOrigins: h.ORIGINS, enforceAppCheck: false };

async function newOrder(quantity = 2) {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    const { orderId } = await createCheckout(h.callable({ lines: [{ productId: 'body-wave', variantId: '16-inches', quantity }], customer: h.customer }), checkoutOpts);
    return orderId;
  } finally { f.restore(); }
}
const getOrder = async (id) => (await h.db.collection('orders').doc(id).get()).data();
const chargeEvent = (reference, { id = 555, type = 'charge.success', amount = 124000 } = {}) => ({ event: type, data: { id, reference, amount, currency: 'GHS', status: type === 'charge.success' ? 'success' : 'failed' } });

async function deliver(event, verify, opts) {
  const f = h.fakeFetch({ '/transaction/verify/': verify });
  try {
    const { req, res } = h.webhookCall(event, opts);
    await handlePaystackWebhook(req, res, { db: h.db, secretKey: h.SECRET });
    return { res, calls: f.calls };
  } finally { f.restore(); }
}

test.beforeEach(async () => { await h.resetDb(); await h.seedProduct(); });

test('rejects missing, malformed and forged signatures without touching data', async () => {
  const orderId = await newOrder();
  for (const signature of ['', 'abc', 'f'.repeat(128)]) {
    const { res, calls } = await deliver(chargeEvent(orderId), () => { throw new Error('must not verify'); }, { signature });
    assert.equal(res.code, 401);
    assert.equal(calls.length, 0);
  }
  const forged = await deliver(chargeEvent(orderId), () => { throw new Error('must not verify'); }, { secret: 'sk_attacker' });
  assert.equal(forged.res.code, 401);
  assert.equal((await getOrder(orderId)).status, 'pending_payment');
});

test('charge.success is verified with Paystack, marks paid, commits stock, queues one SMS', async () => {
  const orderId = await newOrder();
  const { res, calls } = await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { amount: 124000 }));
  assert.equal(res.code, 200);
  assert.match(calls[0].url, new RegExp(`/transaction/verify/${orderId}$`));

  const order = await getOrder(orderId);
  assert.equal(order.status, 'paid');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.payment.transactionId, '555');
  assert.equal(order.payment.channel, 'mobile_money');
  assert.equal(order.payment.amount, 1240);
  assert.equal(order.stockHold.state, 'committed');
  assert.deepEqual(order.statusHistory.map((e) => [e.status, e.actor.type]), [['pending_payment', 'system'], ['paid', 'paystack']]);
  assert.equal(await h.stockOf('body-wave', '16-inches'), 1); // held at checkout, not taken twice

  const sms = await h.db.collection('smsOutbox').doc(`${orderId}_paid`).get();
  assert.equal(sms.data().state, 'queued');
  assert.equal(sms.data().to, '024****567');
  const customerDoc = (await h.db.collection('customers').doc('p_233241234567').get()).data();
  assert.equal(customerDoc.orderCount, 1);
  assert.equal(customerDoc.totalSpent, 1240);
  assert.equal((await h.db.collection('orders').doc(orderId).collection('events').get()).size, 2);
});

test('replayed and duplicate events are acknowledged but applied once', async () => {
  const orderId = await newOrder();
  const verify = (url) => h.verifyResponse(url.split('/').pop(), { amount: 124000 });
  await deliver(chargeEvent(orderId), verify);
  const replay = await deliver(chargeEvent(orderId), verify);
  assert.equal(replay.res.body, 'duplicate');
  assert.equal(replay.calls.length, 0);
  // Same payment, different event id (e.g. resent from the dashboard): state machine makes it a no-op.
  await deliver(chargeEvent(orderId, { id: 999 }), verify);
  const customerDoc = (await h.db.collection('customers').doc('p_233241234567').get()).data();
  assert.equal(customerDoc.orderCount, 1);
  assert.equal((await getOrder(orderId)).statusHistory.length, 2);
});

test('the webhook payload is not trusted: verification decides', async () => {
  const orderId = await newOrder();
  // Payload says success; Paystack says abandoned.
  await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { status: 'abandoned', amount: 124000 }));
  assert.equal((await getOrder(orderId)).status, 'pending_payment');
});

test('an amount or currency mismatch never marks the order paid', async () => {
  const orderId = await newOrder();
  await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { amount: 100 }));
  let order = await getOrder(orderId);
  assert.equal(order.status, 'pending_payment');
  assert.equal(order.payment.mismatch.amountMinor, 100);
  await deliver(chargeEvent(orderId, { id: 777 }), (url) => h.verifyResponse(url.split('/').pop(), { amount: 124000, currency: 'NGN' }));
  order = await getOrder(orderId);
  assert.equal(order.status, 'pending_payment');
});

test('a late charge.failed cannot regress a paid order', async () => {
  const orderId = await newOrder();
  await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { amount: 124000 }));
  await deliver(chargeEvent(orderId, { id: 556, type: 'charge.failed' }), (url) => h.verifyResponse(url.split('/').pop(), { status: 'success', amount: 124000 }));
  assert.equal((await getOrder(orderId)).status, 'paid');
});

test('a verified failure releases the hold', async () => {
  const orderId = await newOrder();
  await deliver(chargeEvent(orderId, { type: 'charge.failed' }), (url) => h.verifyResponse(url.split('/').pop(), { status: 'failed', amount: 124000 }));
  const order = await getOrder(orderId);
  assert.equal(order.status, 'failed');
  assert.equal(order.paymentStatus, 'failed');
  assert.equal(await h.stockOf('body-wave', '16-inches'), 3);
});

test('transient verify errors return 500 so Paystack retries, and are not recorded as processed', async () => {
  const orderId = await newOrder();
  const first = await deliver(chargeEvent(orderId), () => new Error('socket hang up'));
  assert.equal(first.res.code, 500);
  const retry = await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { amount: 124000 }));
  assert.equal(retry.res.code, 200);
  assert.equal((await getOrder(orderId)).status, 'paid');
});

test('events for references we did not issue are ignored', async () => {
  const { res, calls } = await deliver(chargeEvent('T123456789'), () => { throw new Error('must not verify'); });
  assert.equal(res.code, 200);
  assert.equal(calls.length, 0);
});

test('expired holds: abandoned checkouts are cancelled and restocked; paid ones are settled', async () => {
  const abandoned = await newOrder(1);
  const paidLate = await newOrder(1);
  const past = Timestamp.fromMillis(Date.now() - 60_000);
  for (const id of [abandoned, paidLate]) await h.db.collection('orders').doc(id).update({ 'stockHold.heldUntil': past });

  const f = h.fakeFetch({ '/transaction/verify/': (url) => {
    const ref = url.split('/').pop();
    return ref === paidLate ? h.verifyResponse(ref, { amount: 62000 }) : { status: 400, json: { status: false, message: 'Transaction reference not found' } };
  } });
  try {
    const outcomes = await expireHolds(h.db, { verify: (ref) => verifyTransaction(h.SECRET, ref) });
    assert.deepEqual(outcomes, { cancelled: 1, paid: 1 });
  } finally { f.restore(); }
  assert.equal((await getOrder(abandoned)).status, 'cancelled');
  assert.equal((await getOrder(paidLate)).status, 'paid');
  assert.equal(await h.stockOf('body-wave', '16-inches'), 2); // one returned, one sold
});

test('a payment that lands after expiry re-takes stock, or flags a stock issue', async () => {
  const orderId = await newOrder(3); // takes all 3
  await h.db.collection('orders').doc(orderId).update({ 'stockHold.heldUntil': Timestamp.fromMillis(Date.now() - 1000) });
  const f = h.fakeFetch({ '/transaction/verify/': () => ({ status: 404, json: { status: false } }) });
  try { await expireHolds(h.db, { verify: (ref) => verifyTransaction(h.SECRET, ref) }); } finally { f.restore(); }
  assert.equal(await h.stockOf('body-wave', '16-inches'), 3);

  // Someone else buys 2 meanwhile; the late payment for 3 can't be fully restocked.
  await h.db.collection('products').doc('body-wave').update({ variants: [{ id: '16-inches', label: '16 inches', available: true, stock: 1 }] });
  await deliver(chargeEvent(orderId), (url) => h.verifyResponse(url.split('/').pop(), { amount: 186000 }));
  const order = await getOrder(orderId);
  assert.equal(order.status, 'paid');
  assert.equal(order.stockIssue, true);
  assert.equal(await h.stockOf('body-wave', '16-inches'), 1);
});
