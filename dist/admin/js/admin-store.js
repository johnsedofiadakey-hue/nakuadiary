import { firebaseConfig, isFirebaseConfigured } from '/js/firebase-config.js?v=2';
import { mergeContent } from '/js/site-content.js?v=2';

const FUNCTIONS_REGION = 'us-central1';
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
export async function saveProduct(product, { isNew }) {
  const { db, fsMod } = await loadSdk();
  const id = isNew ? slugify(product.name) : product.id;
  const ref = fsMod.doc(db, 'products', id);
  if (isNew) {
    const existing = await fsMod.getDoc(ref);
    if (existing.exists()) throw new Error(`A product with the id "${id}" already exists — rename it.`);
  }
  const { id: _drop, ...data } = product;
  await fsMod.setDoc(ref, {
    ...data,
    createdAt: isNew ? fsMod.serverTimestamp() : product.createdAt,
    updatedAt: fsMod.serverTimestamp(),
  });
  return id;
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

/** Uploads a homepage/branding image (hero, logo, category tiles, share image). */
export async function uploadSiteImage({ file }) {
  return uploadImage(file, 'site');
}

export { CATEGORIES };

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

export async function updateOrderStatus({ orderId, fulfillmentStatus }) {
  const { functions, fnMod } = await loadSdk();
  const fn = fnMod.httpsCallable(functions, 'updateOrderStatus');
  await fn({ orderId, fulfillmentStatus });
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
