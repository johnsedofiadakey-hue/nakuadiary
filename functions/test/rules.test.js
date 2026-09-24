// Security rules, evaluated by the emulators against the real rules files.
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } = require('firebase/firestore');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

let env;
const root = path.join(__dirname, '..', '..');

test.before(async () => {
  const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const [stHost, stPort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-nakuadiary',
    firestore: { host: fsHost, port: Number(fsPort), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
    storage: { host: stHost, port: Number(stPort), rules: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8') },
  });
});
test.after(async () => { await env?.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products/live'), { name: 'Live', active: true });
    await setDoc(doc(db, 'products/hidden'), { name: 'Hidden', active: false });
    await setDoc(doc(db, 'orders/o1'), { buyerUid: 'alice', status: 'paid' });
    await setDoc(doc(db, 'orders/o1/events/e1'), { to: 'paid' });
    await setDoc(doc(db, 'customers/c1'), { name: 'Alice' });
    await setDoc(doc(db, 'smsOutbox/o1_paid'), { state: 'sent' });
    await setDoc(doc(db, 'paystackEvents/charge.success_1'), { outcome: 'paid' });
    await setDoc(doc(db, 'config/sms'), { senderId: 'NAKUA' });
    await setDoc(doc(db, 'site/home'), { hero: {} });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const user = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const admin = () => env.authenticatedContext('boss', { admin: true }).firestore();

test('public: only active products and public site content', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'products/live')));
  await assertFails(getDoc(doc(anon(), 'products/hidden')));
  await assertSucceeds(getDocs(query(collection(anon(), 'products'), where('active', '==', true))));
  await assertFails(getDocs(collection(anon(), 'products')));
  await assertSucceeds(getDoc(doc(anon(), 'site/home')));
  await assertFails(setDoc(doc(anon(), 'site/home'), { hero: 1 }));
  await assertFails(setDoc(doc(user('alice'), 'products/live'), { name: 'x', active: true }));
});

test('orders: owner can read, nobody can write from the client', async () => {
  await assertSucceeds(getDoc(doc(user('alice'), 'orders/o1')));
  await assertFails(getDoc(doc(user('bob'), 'orders/o1')));
  await assertFails(getDoc(doc(anon(), 'orders/o1')));
  await assertFails(updateDoc(doc(user('alice'), 'orders/o1'), { status: 'delivered' }));
  await assertFails(setDoc(doc(user('alice'), 'orders/new'), { buyerUid: 'alice', status: 'paid' }));
  await assertFails(updateDoc(doc(admin(), 'orders/o1'), { status: 'delivered' }));
  await assertSucceeds(getDoc(doc(admin(), 'orders/o1')));
  await assertFails(getDoc(doc(user('alice'), 'orders/o1/events/e1')));
  await assertSucceeds(getDoc(doc(admin(), 'orders/o1/events/e1')));
  await assertFails(setDoc(doc(admin(), 'orders/o1/events/e2'), { to: 'x' }));
});

test('carts: own cart only, bounded shape', async () => {
  await assertSucceeds(setDoc(doc(user('alice'), 'carts/alice'), { lines: [] }));
  await assertFails(setDoc(doc(user('alice'), 'carts/bob'), { lines: [] }));
  await assertFails(setDoc(doc(user('alice'), 'carts/alice'), { lines: [], price: 1 }));
  await assertFails(setDoc(doc(user('alice'), 'carts/alice'), { lines: Array.from({ length: 51 }, () => ({})) }));
  await assertFails(getDoc(doc(user('bob'), 'carts/alice')));
});

test('back-office collections are closed to non-admins', async () => {
  for (const p of ['customers/c1', 'smsOutbox/o1_paid', 'paystackEvents/charge.success_1', 'config/sms']) {
    await assertFails(getDoc(doc(user('alice'), p)));
    await assertFails(getDoc(doc(user('ws', { wholesale: true }), p)));
    await assertFails(setDoc(doc(user('alice'), p), { x: 1 }));
  }
  await assertSucceeds(getDoc(doc(admin(), 'smsOutbox/o1_paid')));
  await assertFails(setDoc(doc(admin(), 'smsOutbox/o1_paid'), { state: 'queued' }));
  await assertFails(setDoc(doc(admin(), 'paystackEvents/x'), { outcome: 'paid' }));
});

test('config/sms: admins may edit only the allowed shape', async () => {
  await assertSucceeds(setDoc(doc(admin(), 'config/sms'), { enabled: true, senderId: 'NAKUADIARY', templates: { paid: 'Hi {name}' } }));
  await assertFails(setDoc(doc(admin(), 'config/sms'), { senderId: 'WAY-TOO-LONG-ID' }));
  await assertFails(setDoc(doc(admin(), 'config/sms'), { apiKey: 'nope' }));
  await assertFails(setDoc(doc(admin(), 'config/sms'), { templates: { refund: 'x' } }));
  await assertFails(setDoc(doc(admin(), 'config/other'), { a: 1 }));
  await assertSucceeds(setDoc(doc(admin(), 'config/sms'), { ownerPhone: '0209998888', ownerAlerts: true, templates: { owner: 'New order {reference}' } }));
  await assertFails(setDoc(doc(admin(), 'config/sms'), { ownerAlerts: 'yes' }));
});

test('storage: public read of product/site images, admin-only image uploads', async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const anonStorage = env.unauthenticatedContext().storage();
  const adminStorage = env.authenticatedContext('boss', { admin: true }).storage();
  const userStorage = env.authenticatedContext('alice').storage();
  await assertSucceeds(uploadBytes(ref(adminStorage, 'site/hero.png'), png, { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ref(anonStorage, 'site/hero.png')));
  await assertFails(uploadBytes(ref(userStorage, 'site/x.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(adminStorage, 'site/x.html'), png, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(adminStorage, 'private/x.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(adminStorage, 'site/big.png'), new Uint8Array(8 * 1024 * 1024), { contentType: 'image/png' }));
  await assertSucceeds(uploadBytes(ref(adminStorage, 'site/hero.mp4'), new Uint8Array(1024), { contentType: 'video/mp4' }));
  await assertFails(uploadBytes(ref(userStorage, 'site/hero.mp4'), new Uint8Array(1024), { contentType: 'video/mp4' }));
  await assertFails(uploadBytes(ref(adminStorage, 'site/huge.mp4'), new Uint8Array(40 * 1024 * 1024), { contentType: 'video/mp4' }));
  await assertFails(uploadBytes(ref(adminStorage, 'products/p1/clip.mp4'), new Uint8Array(1024), { contentType: 'video/mp4' }));
});

test('adminDevices: admins manage only their own devices', async () => {
  const mine = { token: 't'.repeat(40), uid: 'boss', email: 'b@x.com', enabled: true };
  await assertSucceeds(setDoc(doc(admin(), 'adminDevices/d1'), mine));
  await assertSucceeds(getDoc(doc(admin(), 'adminDevices/d1')));
  await assertFails(setDoc(doc(admin(), 'adminDevices/d2'), { ...mine, uid: 'someone-else' }));
  await assertFails(setDoc(doc(admin(), 'adminDevices/d3'), { ...mine, extra: 1 }));
  await assertFails(setDoc(doc(user('alice'), 'adminDevices/d4'), { ...mine, uid: 'alice' }));
  await assertFails(getDoc(doc(env.authenticatedContext('other-admin', { admin: true }).firestore(), 'adminDevices/d1')));
  await assertFails(setDoc(doc(admin(), 'pushLog/x'), { a: 1 }));
});

