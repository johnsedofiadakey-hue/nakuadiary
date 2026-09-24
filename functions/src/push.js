// Admin phone notifications (Firebase Cloud Messaging web push).
//
// Each admin phone/browser that taps "Turn on order alerts" stores its FCM
// token in adminDevices/{id} (own devices only, per firestore.rules). When an
// order becomes paid, notifyAdminsOfPaidOrder sends one push to every enabled
// device. pushLog/{orderId}_paid is created first, so a re-delivered trigger
// can't notify twice. Tokens FCM reports as dead are deleted.
//
// Lock-screen text carries the order reference, total and item count only —
// never the customer's name, phone or address.
const { FieldValue } = require('firebase-admin/firestore');
const { log } = require('./util');

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const cedis = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function paidOrderMessage(orderId, order) {
  const items = order.itemCount ?? (order.lines || []).reduce((n, l) => n + (l.quantity || 0), 0);
  const method = order.customer?.deliveryPreference === 'Pickup' ? 'Pickup' : `Delivery${order.delivery?.zone ? ` · ${order.delivery.zone}` : ''}`;
  return {
    title: `New order · ${cedis(order.total)}`,
    body: `${order.reference || orderId.slice(0, 8)} — ${items} item${items === 1 ? '' : 's'} · ${method}. Tap to open.`,
    url: `/admin#/orders/${orderId}`,
    tag: `order-${orderId}`,
  };
}

/** Sends a data-only web push (the admin service worker displays it) to the given device docs. */
async function sendToDevices(db, messaging, deviceDocs, message) {
  if (!deviceDocs.length) return { sent: 0, failed: 0, removed: 0 };
  const response = await messaging.sendEachForMulticast({
    tokens: deviceDocs.map((d) => d.data().token),
    data: { title: message.title, body: message.body, url: message.url, tag: message.tag },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
  });
  let removed = 0;
  await Promise.all(response.responses.map(async (r, i) => {
    if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) {
      removed += 1;
      await deviceDocs[i].ref.delete().catch(() => {});
    }
  }));
  return { sent: response.successCount, failed: response.failureCount, removed };
}

async function notifyAdminsOfPaidOrder(db, messaging, orderId, order) {
  const logRef = db.collection('pushLog').doc(`${orderId}_paid`);
  try {
    await logRef.create({ orderId, type: 'paid', createdAt: FieldValue.serverTimestamp() });
  } catch (err) {
    if (err.code === 6 || /already exists/i.test(err.message)) return 'duplicate';
    throw err;
  }
  const devices = await db.collection('adminDevices').where('enabled', '==', true).get();
  const result = await sendToDevices(db, messaging, devices.docs, paidOrderMessage(orderId, order));
  await logRef.update({ ...result, finishedAt: FieldValue.serverTimestamp() });
  log.info('admin push sent', { orderId, ...result });
  return result;
}

/** Admin "Send test notification" — only to the caller's own devices. */
async function sendTestPush(db, messaging, uid) {
  const devices = await db.collection('adminDevices').where('uid', '==', uid).where('enabled', '==', true).get();
  return sendToDevices(db, messaging, devices.docs, {
    title: 'Order alerts are on',
    body: 'This is how new paid orders will appear on this phone.',
    url: '/admin#/orders',
    tag: 'test',
  });
}

module.exports = { notifyAdminsOfPaidOrder, sendTestPush, paidOrderMessage, sendToDevices };
