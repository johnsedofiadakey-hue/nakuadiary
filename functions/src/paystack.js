// Minimal Paystack client (https://paystack.com/docs/api/transaction/).
// The secret key is passed in per call from the defineSecret param and is
// never logged or returned.
const crypto = require('crypto');
const { PAYSTACK_BASE_URL } = require('./config');

const TIMEOUT_MS = 15000;

async function paystackRequest(secretKey, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json = null;
  try { json = await response.json(); } catch { /* non-JSON error page */ }
  if (!response.ok || json?.status !== true) {
    const error = new Error(`Paystack ${method} ${path.split('/').slice(0, 3).join('/')} failed (${response.status})`);
    error.httpStatus = response.status;
    error.providerMessage = typeof json?.message === 'string' ? json.message.slice(0, 200) : undefined;
    throw error;
  }
  return json.data;
}

/** POST /transaction/initialize — amount in pesewas. Returns { authorization_url, access_code, reference }. */
function initializeTransaction(secretKey, { email, amountMinor, currency, reference, callbackUrl, orderId }) {
  return paystackRequest(secretKey, '/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: String(amountMinor),
      currency,
      reference,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      channels: ['mobile_money', 'card'],
      // Only the order id — no customer personal data leaves our system here.
      metadata: JSON.stringify({ orderId }),
    },
  });
}

/** GET /transaction/verify/:reference — the authoritative payment state. */
function verifyTransaction(secretKey, reference) {
  return paystackRequest(secretKey, `/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Constant-time check of x-paystack-signature (HMAC-SHA512 of the raw body). */
function isValidSignature(secretKey, rawBody, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature) || !rawBody) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

module.exports = { initializeTransaction, verifyTransaction, isValidSignature };
