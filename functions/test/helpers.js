// Shared test harness. Runs against the Firestore/Auth emulators started by
// `npm test` (firebase emulators:exec) on the demo-nakuadiary project, so no
// real Firebase, Paystack or MNotify resources are ever touched: outbound
// HTTP goes through a scripted fake `fetch`.
const crypto = require('crypto');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = 'demo-nakuadiary';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run tests with `npm test` so the emulators are running.');
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const SECRET = 'sk_test_fake_secret_for_emulator_only';
const ORIGINS = 'https://nakuadiary.web.app,https://nakuadiary.firebaseapp.com';

async function resetDb() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
}

async function seedProduct(id = 'body-wave', overrides = {}) {
  const product = {
    name: 'Body Wave', category: 'bundles', type: 'Raw hair bundle', active: true,
    price: 620, wholesalePrice: 500, minWholesaleQty: 3, currency: 'GHS', inventoryPolicy: 'deny',
    images: [{ url: 'https://img.example/body-wave.jpg', alt: 'Body wave' }],
    variants: [
      { id: '16-inches', label: '16 inches', available: true, stock: 3 },
      { id: '20-inches', label: '20 inches', available: true, stock: 10, price: 700 },
    ],
    ...overrides,
  };
  await db.collection('products').doc(id).set(product);
  return product;
}

const stockOf = async (productId, variantId) => (await db.collection('products').doc(productId).get()).data().variants.find((v) => v.id === variantId).stock;

const customer = { name: 'Ama Mensah', phone: '024 123 4567', deliveryPreference: 'Delivery', deliveryAddress: 'East Legon, near the mall' };

function callable(data, { uid = 'buyer-1', admin = false, wholesale = false, app } = {}) {
  return { data, auth: uid ? { uid, token: { ...(admin ? { admin: true } : {}), ...(wholesale ? { wholesale: true } : {}) } } : undefined, app };
}

/**
 * Scripted fake fetch. `routes` maps a matcher (substring of the URL) to a
 * handler (url, init) => { status, json } | Error. Records every call.
 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`Unexpected fetch ${url}`);
    const out = await routes[key](String(url), init);
    if (out instanceof Error) throw out;
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.json };
  };
  const original = global.fetch;
  global.fetch = impl;
  return { calls, restore: () => { global.fetch = original; } };
}

const paystackInitOk = (url, init) => {
  const body = JSON.parse(init.body);
  return { status: 200, json: { status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'ac', reference: body.reference } } };
};

function verifyResponse(reference, { status = 'success', amount, currency = 'GHS', id = 555 } = {}) {
  return { status: 200, json: { status: true, data: { id, status, reference, amount, currency, channel: 'mobile_money', paid_at: '2026-09-23T10:00:00.000Z', gateway_response: 'Approved' } } };
}

/** Builds a signed webhook request/response pair. */
function webhookCall(event, { secret = SECRET, signature, ip = '52.31.139.75' } = {}) {
  const rawBody = Buffer.from(JSON.stringify(event));
  const sig = signature ?? crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const req = { method: 'POST', rawBody, ip, get: (h) => (h.toLowerCase() === 'x-paystack-signature' ? sig : undefined) };
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  return { req, res };
}

module.exports = { db, SECRET, ORIGINS, resetDb, seedProduct, stockOf, customer, callable, fakeFetch, paystackInitOk, verifyResponse, webhookCall };
