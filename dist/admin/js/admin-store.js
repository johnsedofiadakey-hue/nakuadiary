import { firebaseConfig, isFirebaseConfigured } from '/js/firebase-config.js?v=2';
import { mergeContent } from '/js/site-content.js?v=2';

const FUNCTIONS_REGION = 'us-central1';
// Firebase Cloud Messaging "Web Push certificate" public key (Firebase console →
// Project settings → Cloud Messaging). Public by design — safe in browser code.
const FCM_VAPID_KEY = 'BN5CvtCZnY3f_CxPjH3hJgTaBGb6Nj2MkBmXYFGh5O0QX6F7OzeYQIVz-jMBzgPcVy0Ycr2sXWFU_ubp4KbSIIQ';
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const CATEGORIES = ['wigs', 'bundles', 'extensions', 'accessories'];

export const slugify = (label) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

let sdk;
async function loadSdk() {
  if (sdk) return sdk;
  const [{ initializeApp }, authMod, fsMod, fnMod, storageMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-functions.js`),
    import(`${SDK}/firebase-storage.js`),
  ]);
  const app = initializeApp(firebaseConfig, 'admin');
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);
  const functions = fnMod.getFunctions(app, FUNCTIONS_REGION);
  const storage = storageMod.getStorage(app);
  sdk = { app, auth, db, authMod, fsMod, fnMod, functions, storage, storageMod };
  return sdk;
}

/**
 * Subscribes to admin auth state. Calls `callback` with `null` when signed
 * out, and with `{ user, isAdmin }` whenever signed in — isAdmin reflects
 * the `admin` custom claim, set only by functions/create-admin.js or a
 * future staff-management screen, never by this portal itself.
 */
export async function onAdminAuthChange(callback) {
  if (!isFirebaseConfigured) {
    callback({ notConfigured: true });
    return;
  }
  const { auth, authMod } = await loadSdk();
  authMod.onAuthStateChanged(auth, async (user) => {
    if (!user) return callback(null);
    try {
      const token = await user.getIdTokenResult();
      callback({ user, isAdmin: token.claims.admin === true });
    } catch {
      callback({ user, isAdmin: false });
    }
  });
}

export async function getOrder(id) {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDoc(fsMod.doc(db, 'orders', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---- Phone alerts (web push) ---------------------------------------------------

const DEVICE_KEY = 'nakua-admin-device';
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'ready' | 'ios-install' (iPhone must add to Home Screen first) | 'denied' | 'unsupported'. */
export function pushAvailability() {
  if (isIos() && !isInstalled()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

export const thisDeviceId = () => { try { return localStorage.getItem(DEVICE_KEY); } catch { return null; } };

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin' }).catch(() => null);
}

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android phone' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows PC' : 'Device';
  const browser = /edg/i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${browser}${isInstalled() ? ' (app)' : ''}`;
}

/** Asks permission, gets an FCM token and saves this device. Returns the device id. */
export async function enablePushOnThisDevice() {
  const availability = pushAvailability();
  if (availability !== 'ready') throw new Error(availability === 'ios-install' ? 'On iPhone, add this app to your Home Screen first, then open it from there.' : availability === 'denied' ? 'Notifications are blocked for this site. Allow them in your phone/browser settings, then try again.' : 'This browser can’t receive notifications. Try Chrome on Android, or the installed app on iPhone.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed. Tap “Allow” when asked.');
  const registration = await registerServiceWorker();
  if (!registration) throw new Error('Could not set up notifications on this device.');
  await navigator.serviceWorker.ready;
  const { app, db, fsMod, auth } = await loadSdk();
  const messagingMod = await import(`${SDK}/firebase-messaging.js`);
  if (!(await messagingMod.isSupported())) throw new Error('This browser can’t receive notifications.');
  const token = await messagingMod.getToken(messagingMod.getMessaging(app), { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Could not get a notification token. Please try again.');
  const id = await sha256Hex(token);
  const ref = fsMod.doc(db, 'adminDevices', id);
  const existing = await fsMod.getDoc(ref).catch(() => null);
  await fsMod.setDoc(ref, {
    token, uid: auth.currentUser.uid, email: auth.currentUser.email || null, label: deviceLabel(), enabled: true,
    createdAt: existing?.exists() ? existing.data().createdAt : fsMod.serverTimestamp(), lastSeenAt: fsMod.serverTimestamp(),
  });
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* private mode */ }
  return id;
}

export async function listMyDevices() {
  const { db, fsMod, auth } = await loadSdk();
  const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'adminDevices'), fsMod.where('uid', '==', auth.currentUser.uid)));
  return snap.docs.map((d) => ({ id: d.id, label: d.data().label, enabled: d.data().enabled, lastSeenAt: d.data().lastSeenAt }));
}

export async function removeDevice(id) {
  const { db, fsMod, app } = await loadSdk();
  await fsMod.deleteDoc(fsMod.doc(db, 'adminDevices', id));
  if (id === thisDeviceId()) {
    try { localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
    try { const m = await import(`${SDK}/firebase-messaging.js`); await m.deleteToken(m.getMessaging(app)); } catch { /* already gone */ }
  }
}

export async function sendTestPush() {
  const { functions, fnMod } = await loadSdk();
  const { data } = await fnMod.httpsCallable(functions, 'sendTestPush')();
  return data;
}

export async function signIn({ email, password }) {
  const { auth, authMod } = await loadSdk();
  await authMod.signInWithEmailAndPassword(auth, email, password);
}

export async function signOutAdmin() {
  const { auth, authMod } = await loadSdk();
  await authMod.signOut(auth);
}

// ---- Products --------------------------------------------------------

export async function listProducts() {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'products'), fsMod.orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getProduct(id) {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDoc(fsMod.doc(db, 'products', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Creates (new id derived from name) or overwrites (existing id) a product. */
export async function saveProduct(product, { isNew, original }) {
  const { db, fsMod } = await loadSdk();
  const id = isNew ? slugify(product.name) : product.id;
  const ref = fsMod.doc(db, 'products', id);
  if (isNew) {
    const existing = await fsMod.getDoc(ref);
    if (existing.exists()) throw new Error(`A product with the id "${id}" already exists — rename it.`);
  }
  const { id: _drop, ...data } = product;
  if (isNew) {
    await fsMod.setDoc(ref, { ...data, createdAt: fsMod.serverTimestamp(), updatedAt: fsMod.serverTimestamp() });
    return id;
  }
  // Checkouts reserve stock while this form is open. Apply the admin's stock
  // *change* (edited − value when the form opened) to the latest server count
  // instead of overwriting it, so concurrent sales are never un-done.
  const opened = new Map((original?.variants || []).map((v) => [v.id, Number(v.stock) || 0]));
  await fsMod.runTransaction(db, async (tx) => {
    const latest = await tx.get(ref);
    const serverStock = new Map((latest.exists() ? latest.data().variants || [] : []).map((v) => [v.id, Number(v.stock) || 0]));
    const variants = (data.variants || []).map((v) => (opened.has(v.id) && serverStock.has(v.id)
      ? { ...v, stock: serverStock.get(v.id) + ((Number(v.stock) || 0) - opened.get(v.id)) }
      : v));
    tx.set(ref, { ...data, variants, createdAt: product.createdAt || fsMod.serverTimestamp(), updatedAt: fsMod.serverTimestamp() });
  });
  return id;
}

/**
 * Quick stock change for one variant: `{ delta }` (e.g. +5 when a delivery
 * arrives) or `{ set }` (exact count after a stock take). Runs as a
 * transaction on the latest server value so it never overwrites stock that
 * checkouts reserved meanwhile. Returns the new count.
 */
export async function changeVariantStock({ productId, variantId, delta, set }) {
  const { db, fsMod, auth } = await loadSdk();
  const ref = fsMod.doc(db, 'products', productId);
  return fsMod.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This product no longer exists.');
    const variants = (snap.data().variants || []).map((v) => ({ ...v }));
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) throw new Error('This length/option no longer exists.');
    const current = Number(variant.stock) || 0;
    const next = typeof set === 'number' ? set : current + delta;
    if (!Number.isInteger(next) || next < 0 || next > 100000) throw new Error(next < 0 ? 'Stock can’t go below 0.' : 'Enter a whole number.');
    variant.stock = next;
    variant.stockUpdatedAt = new Date().toISOString();
    variant.stockUpdatedBy = auth.currentUser?.email || null;
    tx.update(ref, { variants, updatedAt: fsMod.serverTimestamp() });
    return next;
  });
}

export async function setProductActive(id, active) {
  const { db, fsMod } = await loadSdk();
  await fsMod.updateDoc(fsMod.doc(db, 'products', id), { active, updatedAt: fsMod.serverTimestamp() });
}

// ---- Image uploads ---------------------------------------------------------

const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // raw phone photos; shrunk before upload
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;  // mirrors storage.rules
const UPLOADABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Resizes large photos (longest edge `maxEdge`) and re-encodes them as WebP
 * so a 6 MB phone photo lands as a few hundred KB. PNGs keep transparency
 * (logos); browsers that can't encode WebP fall back to JPEG/PNG. Small,
 * already-web-friendly files are uploaded untouched.
 */
async function optimiseImage(file, { maxEdge = 2000, quality = 0.86 } = {}) {
  if (!file) throw new Error('Choose an image first.');
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Choose a photo (JPG, PNG, WebP or a phone photo).');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That photo is over 25 MB — choose a smaller one.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (UPLOADABLE_TYPES.includes(file.type) && file.size < MAX_UPLOAD_BYTES) return file;
    throw new Error('This photo format isn’t supported here — save it as JPG or PNG and try again.');
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && UPLOADABLE_TYPES.includes(file.type) && file.size < 1.5 * 1024 * 1024) { bitmap.close(); return file; }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  if (!blob) throw new Error('Could not process this photo.');
  if (blob.size >= MAX_UPLOAD_BYTES) throw new Error('This photo is still over 8 MB after resizing — try a smaller one.');
  const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[blob.type];
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

async function uploadImage(file, folder) {
  const prepared = await optimiseImage(file);
  const { storage, storageMod } = await loadSdk();
  const safeName = (prepared.name || 'photo').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const target = storageMod.ref(storage, `${folder}/${Date.now()}-${safeName || 'photo'}`);
  await storageMod.uploadBytes(target, prepared, { contentType: prepared.type, cacheControl: 'public,max-age=31536000,immutable' });
  return storageMod.getDownloadURL(target);
}

/** Uploads a public-facing product photo. Storage rules require `admin: true`
 * on the signed-in user's custom claims; public visitors cannot upload files. */
export async function uploadProductImage({ file, productId }) {
  return uploadImage(file, `products/${slugify(productId) || 'draft'}`);
}

/** Uploads the optional hero video (MP4 only; storage.rules caps it at 40 MB). */
export async function uploadSiteVideo({ file }) {
  if (!file) throw new Error('Choose a video first.');
  if (file.type !== 'video/mp4') throw new Error('Use an MP4 video.');
  if (file.size >= 40 * 1024 * 1024) throw new Error('Keep the video under 40 MB — a 6–10 second loop is plenty.');
  const { storage, storageMod } = await loadSdk();
  const safeName = (file.name || 'hero').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'hero.mp4';
  const target = storageMod.ref(storage, `site/${Date.now()}-${safeName}`);
  await storageMod.uploadBytes(target, file, { contentType: 'video/mp4', cacheControl: 'public,max-age=31536000,immutable' });
  return storageMod.getDownloadURL(target);
}

/** Uploads a homepage/branding image (hero, logo, category tiles, share image). */
export async function uploadSiteImage({ file }) {
  return uploadImage(file, 'site');
}

export { CATEGORIES };

// ---- Notifications (config/sms) -----------------------------------------------
// Sender ID, owner alert number and message templates. Admin-only in
// firestore.rules; the MNotify API key is NOT here (it's a server secret).

export async function getSmsConfig() {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDoc(fsMod.doc(db, 'config', 'sms'));
  return snap.exists() ? snap.data() : {};
}

export async function saveSmsConfig({ enabled, senderId, ownerAlerts, ownerPhone, templates }) {
  const { db, fsMod, auth } = await loadSdk();
  await fsMod.setDoc(fsMod.doc(db, 'config', 'sms'), {
    enabled, senderId, ownerAlerts, ownerPhone, templates,
    updatedAt: fsMod.serverTimestamp(),
    updatedBy: auth.currentUser?.email || null,
  });
}

export async function sendTestSms(phone) {
  const { functions, fnMod } = await loadSdk();
  const { data } = await fnMod.httpsCallable(functions, 'sendTestSms')({ phone });
  return data;
}

export async function sendPasswordReset(email) {
  const { auth, authMod } = await loadSdk();
  await authMod.sendPasswordResetEmail(auth, String(email || '').trim(), { url: `${window.location.origin}/admin` });
}

// ---- Site content (CMS) ----------------------------------------------------
// site/settings and site/home — public-read, admin-write. Shapes and
// defaults live in /js/site-content.js, shared with the storefront.

export async function getSiteDoc(id, defaults) {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDoc(fsMod.doc(db, 'site', id));
  return mergeContent(defaults, snap.exists() ? snap.data() : undefined);
}

export async function saveSiteDoc(id, data) {
  const { db, fsMod, auth } = await loadSdk();
  await fsMod.setDoc(fsMod.doc(db, 'site', id), {
    ...data,
    updatedAt: fsMod.serverTimestamp(),
    updatedBy: auth.currentUser?.email || null,
  });
}

// ---- Orders ------------------------------------------------------------

export async function listOrders() {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'orders'), fsMod.orderBy('createdAt', 'desc'), fsMod.limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateOrderStatus({ orderId, status, note }) {
  const { functions, fnMod } = await loadSdk();
  const fn = fnMod.httpsCallable(functions, 'updateOrderStatus');
  const { data } = await fn({ orderId, status, note });
  return data;
}

/** Customer SMS records for one order (smsOutbox is admin-read-only; writes go through functions). */
export async function listOrderSms(orderId) {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'smsOutbox'), fsMod.where('orderId', '==', orderId)));
  const order = ['paid', 'owner_paid', 'processing', 'dispatched', 'delivered'];
  return snap.docs.map((d) => d.data()).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

export async function resendOrderSms({ orderId, status, force }) {
  const { functions, fnMod } = await loadSdk();
  const fn = fnMod.httpsCallable(functions, 'resendOrderSms');
  const { data } = await fn({ orderId, status, force: force === true });
  return data;
}

// ---- Customers -----------------------------------------------------------

export async function listCustomers() {
  const { db, fsMod } = await loadSdk();
  const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'customers'), fsMod.orderBy('updatedAt', 'desc'), fsMod.limit(500)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createWholesaleAccount({ name, phone, email }) {
  const { functions, fnMod } = await loadSdk();
  const fn = fnMod.httpsCallable(functions, 'createWholesaleAccount');
  const { data } = await fn({ name, phone, email });
  return data;
}
