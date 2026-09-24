const test = require('node:test');
const assert = require('node:assert/strict');
const { createCheckout } = require('../src/checkout');
const h = require('./helpers');

const opts = { db: h.db, secretKey: h.SECRET, allowedOrigins: h.ORIGINS, enforceAppCheck: false };
const line = (variantId = '16-inches', quantity = 1) => ({ productId: 'body-wave', variantId, quantity });

test.beforeEach(async () => { await h.resetDb(); await h.seedProduct(); });

test('prices from Firestore, snapshots the order, and holds stock', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    const out = await createCheckout(h.callable({
      lines: [{ ...line('20-inches', 2), unitPrice: 1, price: 1 }], // client price fields are ignored
      customer: h.customer,
      callbackUrl: 'https://nakuadiary.web.app/shop?x=1',
    }), opts);
    assert.match(out.checkoutUrl, /^https:\/\/checkout\.paystack\.com\//);
    assert.match(out.reference, /^NKD-[2-9A-HJ-NP-Z]{6}$/);

    const order = (await h.db.collection('orders').doc(out.orderId).get()).data();
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.fulfillmentStatus, 'unfulfilled');
    assert.equal(order.total, 1400); // variant override 700 × 2
    assert.deepEqual(
      { productName: order.lines[0].productName, variantLabel: order.lines[0].variantLabel, unitPrice: order.lines[0].unitPrice, lineTotal: order.lines[0].lineTotal, image: order.lines[0].image },
      { productName: 'Body Wave', variantLabel: '20 inches', unitPrice: 700, lineTotal: 1400, image: 'https://img.example/body-wave.jpg' },
    );
    assert.equal(order.customer.deliveryAddress, 'East Legon, near the mall');
    assert.equal(order.customer.phoneNormalized, '233241234567');
    assert.equal(order.stockHold.state, 'held');
    assert.equal(order.statusHistory.length, 1);
    assert.equal(order.statusHistory[0].actor.type, 'system');
    assert.equal(await h.stockOf('body-wave', '20-inches'), 8);

    const sent = JSON.parse(f.calls[0].init.body);
    assert.equal(sent.amount, '140000'); // pesewas
    assert.equal(sent.reference, out.orderId);
    assert.equal(sent.callback_url, 'https://nakuadiary.web.app/shop'); // query stripped, allowed origin
    assert.deepEqual(JSON.parse(sent.metadata), { orderId: out.orderId }); // no personal data to Paystack
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${h.SECRET}`);
  } finally { f.restore(); }
});

test('drops callback URLs on foreign origins', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    await createCheckout(h.callable({ lines: [line()], customer: h.customer, callbackUrl: 'https://evil.example/phish' }), opts);
    assert.equal(JSON.parse(f.calls[0].init.body).callback_url, undefined);
  } finally { f.restore(); }
});

test('cannot oversell under concurrent checkouts', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => createCheckout(h.callable({ lines: [line()], customer: h.customer }, { uid: `buyer-${i}` }), opts)));
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    assert.equal(ok.length, 3, 'exactly the 3 units in stock can be held');
    assert.ok(attempts.filter((a) => a.status === 'rejected').every((a) => /sold out|Only/.test(a.reason.message)));
    assert.equal(await h.stockOf('body-wave', '16-inches'), 0);
  } finally { f.restore(); }
});

test('rejects quantities above stock with a clear message', async () => {
  await assert.rejects(createCheckout(h.callable({ lines: [line('16-inches', 4)], customer: h.customer }), opts), /Only 3 left/);
  assert.equal(await h.stockOf('body-wave', '16-inches'), 3);
});

test('validates input server-side', async () => {
  const bad = [
    [{ lines: [], customer: h.customer }, /empty/],
    [{ lines: [line('16-inches', 0)], customer: h.customer }, /not valid/],
    [{ lines: [line('16-inches', 1.5)], customer: h.customer }, /not valid/],
    [{ lines: [{ productId: '../x', variantId: 'a', quantity: 1 }], customer: h.customer }, /not valid/],
    [{ lines: [line()], customer: { ...h.customer, phone: 'abc' } }, /phone/],
    [{ lines: [line()], customer: { ...h.customer, deliveryPreference: 'Drone' } }, /delivery or pickup/],
    [{ lines: [line()], customer: { ...h.customer, deliveryAddress: '' } }, /address/],
    [{ lines: [{ productId: 'nope', variantId: 'x', quantity: 1 }], customer: h.customer }, /no longer available/],
  ];
  for (const [data, message] of bad) await assert.rejects(createCheckout(h.callable(data), opts), message);
  await assert.rejects(createCheckout({ data: { lines: [line()], customer: h.customer } }, opts), /sign in/i);
  await assert.rejects(createCheckout(h.callable({ lines: [line()], customer: h.customer }), { ...opts, enforceAppCheck: true }), /could not be verified/);
});

test('pickup orders do not keep an address', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    const out = await createCheckout(h.callable({ lines: [line()], customer: { ...h.customer, deliveryPreference: 'Pickup' } }), opts);
    assert.equal((await h.db.collection('orders').doc(out.orderId).get()).data().customer.deliveryAddress, null);
  } finally { f.restore(); }
});

test('wholesale pricing and minimum quantity come from the custom claim', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    await assert.rejects(createCheckout(h.callable({ lines: [line('20-inches', 2)], customer: h.customer }, { wholesale: true }), opts), /at least 3/);
    const out = await createCheckout(h.callable({ lines: [line('20-inches', 3)], customer: h.customer }, { uid: 'ws-1', wholesale: true }), opts);
    const order = (await h.db.collection('orders').doc(out.orderId).get()).data();
    assert.equal(order.accountType, 'wholesale');
    assert.equal(order.lines[0].unitPrice, 500);
    assert.equal(order.customerId, 'ws-1');
  } finally { f.restore(); }
});

test('a failed Paystack initialize releases the stock and fails the order', async () => {
  const f = h.fakeFetch({ '/transaction/initialize': () => ({ status: 401, json: { status: false, message: 'Invalid key' } }) });
  try {
    await assert.rejects(createCheckout(h.callable({ lines: [line('16-inches', 2)], customer: h.customer }), opts), /could not start the payment/);
    assert.equal(await h.stockOf('body-wave', '16-inches'), 3);
    const [order] = (await h.db.collection('orders').get()).docs.map((d) => d.data());
    assert.equal(order.status, 'failed');
    assert.equal(order.stockHold.state, 'released');
  } finally { f.restore(); }
});

test('caps simultaneous unfinished checkouts per buyer', async () => {
  await h.seedProduct('body-wave', { variants: [{ id: '16-inches', label: '16 inches', available: true, stock: 100 }] });
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    for (let i = 0; i < 5; i += 1) await createCheckout(h.callable({ lines: [line()], customer: h.customer }), opts);
    await assert.rejects(createCheckout(h.callable({ lines: [line()], customer: h.customer }), opts), /unfinished checkouts/);
  } finally { f.restore(); }
});

// ---- Delivery fees (site/settings.delivery) -------------------------------------------

const setDelivery = (delivery) => h.db.collection('site').doc('settings').set({ delivery });
async function checkoutWith(customer, lines = [line()]) {
  const f = h.fakeFetch({ '/transaction/initialize': h.paystackInitOk });
  try {
    const out = await createCheckout(h.callable({ lines, customer }), opts);
    return { order: (await h.db.collection('orders').doc(out.orderId).get()).data(), amount: JSON.parse(f.calls[0].init.body).amount };
  } finally { f.restore(); }
}

test('delivery: default "arranged" charges nothing online', async () => {
  const { order, amount } = await checkoutWith(h.customer);
  assert.deepEqual(order.delivery, { method: 'Delivery', zone: null, fee: 0, status: 'arranged' });
  assert.equal(order.total, 620);
  assert.equal(amount, '62000');
});

test('delivery: area fees are server-side and added to the Paystack amount', async () => {
  await setDelivery({ mode: 'zones', zones: [{ name: 'East Legon', fee: 30 }, { name: 'Kumasi', fee: 80 }], freeOver: 0 });
  const { order, amount } = await checkoutWith({ ...h.customer, deliveryZone: 'east legon', deliveryFee: 0 });
  assert.equal(order.delivery.zone, 'East Legon');
  assert.equal(order.deliveryFee, 30);
  assert.equal(order.total, 650);
  assert.equal(amount, '65000');
  await assert.rejects(checkoutWith({ ...h.customer, deliveryZone: 'Moon' }), /delivery area/);
  const pickup = await checkoutWith({ ...h.customer, deliveryPreference: 'Pickup', deliveryZone: 'Moon' });
  assert.deepEqual(pickup.order.delivery, { method: 'Pickup', zone: null, fee: 0, status: 'pickup' });
});

test('delivery: flat fee, and free above the threshold', async () => {
  await setDelivery({ mode: 'flat', flatFee: 25, freeOver: 1000 });
  assert.equal((await checkoutWith(h.customer)).order.total, 645);
  const big = await checkoutWith(h.customer, [line('20-inches', 2)]); // 1400 ≥ 1000
  assert.equal(big.order.deliveryFee, 0);
  assert.equal(big.order.delivery.status, 'free');
});

test('delivery: malformed settings fall back safely', async () => {
  await setDelivery({ mode: 'teleport', flatFee: -5, zones: [{ name: '', fee: 10 }, { name: 'Tema', fee: 'x' }] });
  assert.equal((await checkoutWith(h.customer)).order.delivery.status, 'arranged');
  await setDelivery({ mode: 'flat', flatFee: -5 });
  assert.equal((await checkoutWith(h.customer)).order.deliveryFee, 0);
});
