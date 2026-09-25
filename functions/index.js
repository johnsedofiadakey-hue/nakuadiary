// Nakuadiary Cloud Functions. Entry points only — logic lives in src/.
// See docs/FIREBASE_BACKEND_CONTRACT.md for data shapes and the order state machine.
const { onCall, onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

const config = require('./src/config');
const { createCheckout } = require('./src/checkout');
const { handlePaystackWebhook } = require('./src/webhook');
const { expireHolds } = require('./src/lifecycle');
const { verifyTransaction } = require('./src/paystack');
const { processOutboxDoc, sendTestSms, OUTBOX } = require('./src/sms');
const admin = require('./src/admin');
const { log, requireAdmin } = require('./src/util');
const push = require('./src/push');

initializeApp();
const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();

setGlobalOptions({ region: config.REGION, maxInstances: 10 });

// Callables must be reachable from the browser; each one authorises the caller
// itself (requireAdmin / requireAuth). Stated explicitly so every deploy
// re-applies it — the default is only applied when a function is first created.
const CALLABLE = { invoker: 'public' };

// Payment functions are skipped while functions/PAYMENTS_DISABLED exists — see src/config.js.
if (config.PAYMENTS_ENABLED) {
  // ---- Storefront --------------------------------------------------------------

  exports.createCheckout = onCall({ ...CALLABLE, secrets: [config.PAYSTACK_SECRET_KEY], timeoutSeconds: 30 }, (request) => createCheckout(request, {
    db,
    secretKey: config.PAYSTACK_SECRET_KEY.value(),
    allowedOrigins: config.CHECKOUT_ALLOWED_ORIGINS.value(),
    enforceAppCheck: config.ENFORCE_APP_CHECK.value(),
  }));

  // ---- Paystack --------------------------------------------------------------

  exports.paystackWebhook = onRequest({ secrets: [config.PAYSTACK_SECRET_KEY], timeoutSeconds: 25, invoker: 'public' }, (req, res) => handlePaystackWebhook(req, res, {
    db,
    secretKey: config.PAYSTACK_SECRET_KEY.value(),
  }));

  /** Every 15 minutes: settle or release checkouts whose 60-minute stock hold expired. */
  exports.expireStockHolds = onSchedule({ schedule: 'every 15 minutes', secrets: [config.PAYSTACK_SECRET_KEY], timeoutSeconds: 300, retryCount: 0 }, async () => {
    const secretKey = config.PAYSTACK_SECRET_KEY.value();
    const outcomes = await expireHolds(db, { verify: (reference) => verifyTransaction(secretKey, reference) });
    if (Object.keys(outcomes).length) log.info('stock holds processed', outcomes);
  });
}

// ---- SMS -----------------------------------------------------------------------

/** Sends an order SMS whenever an outbox doc becomes `queued` (created, or re-queued by an admin). */
exports.sendOrderSms = onDocumentWritten({ document: `${OUTBOX}/{messageId}`, secrets: [config.MNOTIFY_API_KEY], retry: false }, async (event) => {
  const after = event.data?.after?.data();
  const before = event.data?.before?.data();
  if (!after || after.state !== 'queued' || before?.state === 'queued') return;
  await processOutboxDoc(db, event.params.messageId, {
    apiKey: config.MNOTIFY_API_KEY.value(),
    smsEnabled: config.SMS_ENABLED.value(),
    senderIdParam: config.MNOTIFY_SENDER_ID.value(),
  });
});

// ---- Admin phone notifications -----------------------------------------------------

/** Push "New order" to every admin phone when an order becomes paid (from any source). */
exports.notifyAdminsOnPaidOrder = onDocumentWritten({ document: 'orders/{orderId}', retry: false }, async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after || after.status !== 'paid' || before?.status === 'paid') return;
  await push.notifyAdminsOfPaidOrder(db, messaging, event.params.orderId, after);
});

exports.sendTestPush = onCall(CALLABLE, async (request) => {
  const uid = requireAdmin(request);
  return push.sendTestPush(db, messaging, uid);
});

// ---- Admin -----------------------------------------------------------------------

/** Admin "Send a test text" (Notifications screen). */
exports.sendTestSms = onCall({ ...CALLABLE, secrets: [config.MNOTIFY_API_KEY] }, (request) => {
  const uid = requireAdmin(request);
  return sendTestSms(db, {
    uid,
    phone: typeof request.data?.phone === 'string' ? request.data.phone.slice(0, 24) : '',
    apiKey: config.MNOTIFY_API_KEY.value(),
    smsEnabled: config.SMS_ENABLED.value(),
    senderIdParam: config.MNOTIFY_SENDER_ID.value(),
  });
});

exports.updateOrderStatus = onCall(CALLABLE, (request) => admin.updateOrderStatus(request, { db }));
exports.resendOrderSms = onCall(CALLABLE, (request) => admin.resendOrderSms(request, { db }));
exports.createWholesaleAccount = onCall(CALLABLE, (request) => admin.createWholesaleAccount(request, { db, auth }));
