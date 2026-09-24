// Paystack webhook (https://paystack.com/docs/payments/webhooks/).
//  1. Reject anything without a valid HMAC-SHA512 signature (constant-time).
//  2. De-duplicate by event id (paystackEvents/{id}); replays are acknowledged, not re-applied.
//  3. Never trust the payload's status/amount: re-verify with GET /transaction/verify.
//  4. Apply through the order state machine, so out-of-order events can't regress an order.
//  5. Reply 200 quickly; 5xx only for transient failures we want Paystack to retry.
const { FieldValue } = require('firebase-admin/firestore');
const { isValidSignature, verifyTransaction } = require('./paystack');
const { markPaid, releaseOrder } = require('./lifecycle');
const { log } = require('./util');

const PAYSTACK_IPS = new Set(['52.31.139.75', '52.49.173.169', '52.214.14.220']);
const ORDER_ID_RE = /^[A-Za-z0-9]{20}$/; // Firestore auto-ids — the Paystack reference we issue

function eventKey(event) {
  const id = event?.data?.id != null ? String(event.data.id) : String(event?.data?.reference || 'none');
  return `${String(event?.event || 'unknown')}_${id}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

async function handlePaystackWebhook(req, res, { db, secretKey }) {
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
  if (!isValidSignature(secretKey, req.rawBody, req.get('x-paystack-signature'))) {
    log.warn('paystack webhook rejected: bad signature', { ip: req.ip });
    res.status(401).send('Invalid signature');
    return;
  }
  if (!PAYSTACK_IPS.has(req.ip)) log.warn('paystack webhook from unlisted IP (signature valid)', { ip: req.ip });

  let event;
  try { event = JSON.parse(req.rawBody.toString('utf8')); } catch { res.status(400).send('Bad JSON'); return; }
  const type = String(event?.event || '');
  const reference = String(event?.data?.reference || '');
  const eventRef = db.collection('paystackEvents').doc(eventKey(event));

  if ((await eventRef.get()).exists) {
    log.info('paystack webhook duplicate', { type, reference });
    res.status(200).send('duplicate');
    return;
  }

  let outcome = 'ignored';
  try {
    if ((type === 'charge.success' || type === 'charge.failed') && ORDER_ID_RE.test(reference)) {
      const verified = await verifyTransaction(secretKey, reference);
      if (verified.reference !== reference) outcome = 'reference_mismatch';
      else if (verified.status === 'success') outcome = await markPaid(db, reference, verified, { source: 'webhook' });
      else if (['failed', 'reversed'].includes(verified.status)) outcome = await releaseOrder(db, reference, { to: 'failed', actor: { type: 'paystack' }, note: `payment_${verified.status}` });
      else outcome = `verify_status_${verified.status}`;
    } else if (type.startsWith('charge.')) {
      outcome = 'foreign_reference';
    }
  } catch (err) {
    // Transient (Paystack verify / Firestore contention): let Paystack retry.
    log.error('paystack webhook processing failed', err, { type, reference, httpStatus: err.httpStatus });
    res.status(500).send('retry');
    return;
  }

  await eventRef.set({
    type,
    reference: reference || null,
    outcome,
    receivedAt: FieldValue.serverTimestamp(),
  });
  log.info('paystack webhook processed', { type, reference, outcome });
  if (['amount_mismatch', 'reference_mismatch', 'paid_stock_issue', 'paid_after_cancellation'].includes(outcome)) {
    log.warn('paystack webhook needs admin attention', { type, reference, outcome });
  }
  res.status(200).send('ok');
}

module.exports = { handlePaystackWebhook, eventKey };
