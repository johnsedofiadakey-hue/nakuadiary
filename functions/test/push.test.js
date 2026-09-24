const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyAdminsOfPaidOrder, sendTestPush, paidOrderMessage } = require('../src/push');
const h = require('./helpers');

/** Fake FCM: tokens starting with "dead" fail as unregistered. */
function fakeMessaging() {
  const sent = [];
  return {
    sent,
    sendEachForMulticast: async (msg) => {
      sent.push(msg);
      const responses = msg.tokens.map((t) => (t.startsWith('dead') ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true }));
      return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
    },
  };
}
const device = (id, fields) => h.db.collection('adminDevices').doc(id).set({ uid: 'admin-1', email: 'a@x.com', enabled: true, token: `token-${id}-${'x'.repeat(30)}`, ...fields });
const order = { reference: 'NKD-7F3K9Q', total: 1270, itemCount: 2, customer: { name: 'Ama Mensah', phone: '0241234567', deliveryPreference: 'Delivery' }, delivery: { zone: 'East Legon' } };

test.beforeEach(async () => { await h.resetDb(); });

test('lock-screen text has reference, total and items — no customer details', () => {
  const m = paidOrderMessage('AbCdEfGhIjKlMnOpQrSt', order);
  assert.equal(m.title, 'New order · GHS 1,270');
  assert.equal(m.body, 'NKD-7F3K9Q — 2 items · Delivery · East Legon. Tap to open.');
  assert.equal(m.url, '/admin#/orders/AbCdEfGhIjKlMnOpQrSt');
  assert.ok(!JSON.stringify(m).includes('Ama') && !JSON.stringify(m).includes('0241234567'));
});

test('notifies every enabled device once, and removes dead tokens', async () => {
  await device('phone', {});
  await device('laptop', { uid: 'admin-2' });
  await device('old', { token: `dead-${'y'.repeat(30)}` });
  await device('off', { enabled: false });
  const fcm = fakeMessaging();
  const result = await notifyAdminsOfPaidOrder(h.db, fcm, 'order1', order);
  assert.deepEqual(result, { sent: 2, failed: 1, removed: 1 });
  assert.equal(fcm.sent[0].tokens.length, 3);
  assert.equal(fcm.sent[0].data.url, '/admin#/orders/order1');
  assert.equal((await h.db.collection('adminDevices').doc('old').get()).exists, false);
  // Re-delivered trigger → no second push.
  assert.equal(await notifyAdminsOfPaidOrder(h.db, fcm, 'order1', order), 'duplicate');
  assert.equal(fcm.sent.length, 1);
});

test('no devices → nothing sent, still logged', async () => {
  const fcm = fakeMessaging();
  assert.deepEqual(await notifyAdminsOfPaidOrder(h.db, fcm, 'order2', order), { sent: 0, failed: 0, removed: 0 });
  assert.equal(fcm.sent.length, 0);
  assert.equal((await h.db.collection('pushLog').doc('order2_paid').get()).exists, true);
});

test('test notification goes only to the caller\'s own devices', async () => {
  await device('mine', {});
  await device('theirs', { uid: 'admin-2' });
  const fcm = fakeMessaging();
  const result = await sendTestPush(h.db, fcm, 'admin-1');
  assert.equal(result.sent, 1);
  assert.deepEqual(fcm.sent[0].tokens, [`token-mine-${'x'.repeat(30)}`]);
});
