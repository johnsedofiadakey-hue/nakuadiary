import { products } from './data.js?v=2';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js?v=2';
import { DEFAULT_HOME, DEFAULT_SETTINGS, mergeContent } from './site-content.js?v=2';

const CART_KEY = 'nakuadiary-demo-cart';
const FUNCTIONS_REGION = 'us-central1';
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

const wait = (value) => Promise.resolve(value);

function readLines() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
}
function saveLines(lines) { localStorage.setItem(CART_KEY, JSON.stringify(lines)); return lines; }

// Local, device-only mock adapter. Used until dist/js/firebase-config.js is
// filled in, so the storefront always works — in a checkout, in a demo, or
// before a Firebase project exists.
const mockStore = {
  listProducts: ({ category, featured } = {}) => wait(products.filter((p) => (!category || p.category === category) && (!featured || ['silk-straight', 'body-wave', 'deep-curly'].includes(p.id)))),
  getProduct: (id) => wait(products.find((p) => p.id === id) || null),
  getCart: () => wait({ lines: readLines() }),
  addToCart: ({ productId, variant, quantity = 1 }) => {
    const lines = readLines(); const found = lines.find((line) => line.productId === productId && line.variant === variant);
    if (found) found.quantity += quantity; else lines.push({ productId, variant, quantity });
    return wait({ lines: saveLines(lines) });
  },
  updateCartLine: ({ productId, variant, quantity }) => wait({ lines: saveLines(readLines().flatMap((line) => line.productId === productId && line.variant === variant ? (quantity > 0 ? [{ ...line, quantity }] : []) : [line])) }),
  createCheckout: () => wait({ checkoutUrl: null }),
  // The mock adapter is retail-only — wholesale accounts only exist once a
  // real Firebase project (and an admin-created account) is behind this.
  signIn: () => Promise.reject(new Error('Sign in is available once the store is connected to Firebase.')),
  signOut: () => wait(undefined),
  getAccount: () => wait(null),
  getSiteContent: () => wait({ settings: mergeContent(DEFAULT_SETTINGS), home: mergeContent(DEFAULT_HOME) }),
};

// Real adapter: Firestore for the public catalog and the signed-in-as-guest
// cart, a callable Cloud Function for checkout. See
// docs/FIREBASE_BACKEND_CONTRACT.md for the collection shapes this reads.
async function createFirebaseStore() {
  const [{ initializeApp }, authMod, fsMod, fnMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-functions.js`),
  ]);
  const { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut: firebaseSignOut } = authMod;
  const { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, serverTimestamp } = fsMod;
  const { getFunctions, httpsCallable } = fnMod;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);

  const productCache = new Map();
  let currentUser = null;
  let isWholesale = false;
  let authError = null;
  // Callers waiting for a signed-in user that satisfies `accepts` (any user,
  // an anonymous one after sign-out, or a specific uid after sign-in).
  const waiting = [];

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // No session yet (first visit, or just signed out): start a guest one.
      // Only here — calling signInAnonymously while a wholesale session is
      // restored would replace it and log the customer out on every load.
      currentUser = null;
      isWholesale = false;
      productCache.clear();
      signInAnonymously(auth).catch((err) => {
        authError = err;
        waiting.splice(0).forEach(({ reject }) => reject(err));
      });
      return;
    }
    let wholesale = false;
    try {
      const token = await user.getIdTokenResult();
      wholesale = token.claims.wholesale === true;
    } catch { /* treat as retail */ }
    if (auth.currentUser?.uid !== user.uid) return; // superseded while reading claims
    // Publish user + tier together so nobody sees a user with a stale tier.
    currentUser = user;
    isWholesale = wholesale;
    authError = null;
    productCache.clear();
    for (let i = waiting.length - 1; i >= 0; i -= 1) {
      if (waiting[i].accepts(user)) waiting.splice(i, 1)[0].resolve(user);
    }
  });

  function waitForUser(accepts = () => true) {
    if (currentUser && accepts(currentUser)) return Promise.resolve(currentUser);
    if (authError) return Promise.reject(authError);
    return new Promise((resolve, reject) => waiting.push({ accepts, resolve, reject }));
  }
  const ensureReady = () => waitForUser();
  const uid = async () => (await ensureReady()).uid;

  function mapProduct(id, data) {
    const variants = data.variants || [];
    const price = isWholesale && typeof data.wholesalePrice === 'number' ? data.wholesalePrice : data.price;
    const images = Array.isArray(data.images) && data.images.length
      ? data.images.filter((image) => image?.url)
      : (data.image?.url ? [data.image] : []);
    const cover = images[0] || { url: '', alt: data.name };
    return {
      id,
      slug: data.slug,
      name: data.name,
      category: data.category,
      type: data.type,
      price,
      compareAt: data.compareAt,
      badge: data.badges?.[0],
      description: data.description,
      details: data.details || [],
      variants: variants.map((v) => v.label),
      image: cover.url,
      images,
      alt: cover.alt || data.name,
      crop: cover.focalPoint ? `${cover.focalPoint.x}% ${cover.focalPoint.y}%` : 'center',
      rawVariants: variants,
    };
  }

  async function fetchProduct(id) {
    if (productCache.has(id)) return productCache.get(id);
    const snap = await getDoc(doc(db, 'products', id));
    const product = snap.exists() ? mapProduct(snap.id, snap.data()) : null;
    productCache.set(id, product);
    return product;
  }

  async function readRawLines() {
    const id = await uid();
    const ref = doc(db, 'carts', id);
    const snap = await getDoc(ref);
    return { ref, lines: snap.exists() ? (snap.data().lines || []) : [] };
  }
  async function writeRawLines(ref, lines) {
    await setDoc(ref, { lines, updatedAt: serverTimestamp() });
    return lines;
  }
  async function labelLines(rawLines) {
    return Promise.all(rawLines.map(async (line) => {
      const product = await fetchProduct(line.productId);
      const label = product?.rawVariants?.find((v) => v.id === line.variantId)?.label || line.variantId;
      return { productId: line.productId, variant: label, quantity: line.quantity };
    }));
  }

  const createCheckoutFn = httpsCallable(functions, 'createCheckout');

  return {
    listProducts: async ({ category, featured } = {}) => {
      const clauses = [where('active', '==', true)];
      if (category) clauses.push(where('category', '==', category));
      if (featured) clauses.push(where('featured', '==', true));
      const snap = await getDocs(query(collection(db, 'products'), ...clauses));
      return snap.docs.map((d) => {
        const product = mapProduct(d.id, d.data());
        productCache.set(d.id, product);
        return product;
      });
    },
    getProduct: (id) => fetchProduct(id),
    getCart: async () => ({ lines: await labelLines((await readRawLines()).lines) }),
    addToCart: async ({ productId, variant, quantity = 1 }) => {
      const product = await fetchProduct(productId);
      const variantId = product?.rawVariants?.find((v) => v.label === variant)?.id || variant;
      const { ref, lines } = await readRawLines();
      const found = lines.find((line) => line.productId === productId && line.variantId === variantId);
      if (found) found.quantity += quantity; else lines.push({ productId, variantId, quantity });
      return { lines: await labelLines(await writeRawLines(ref, lines)) };
    },
    updateCartLine: async ({ productId, variant, quantity }) => {
      const product = await fetchProduct(productId);
      const variantId = product?.rawVariants?.find((v) => v.label === variant)?.id || variant;
      const { ref, lines } = await readRawLines();
      const next = lines.flatMap((line) => (line.productId === productId && line.variantId === variantId)
        ? (quantity > 0 ? [{ ...line, quantity }] : [])
        : [line]);
      return { lines: await labelLines(await writeRawLines(ref, next)) };
    },
    createCheckout: async ({ customer } = {}) => {
      const { lines } = await readRawLines();
      if (!lines.length) return { checkoutUrl: null };
      const { data } = await createCheckoutFn({
        lines: lines.map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity })),
        customer,
        callbackUrl: `${window.location.origin}${window.location.pathname}`,
      });
      return data;
    },
    signIn: async ({ email, password }) => {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await waitForUser((u) => u.uid === user.uid); // claims (wholesale tier) loaded
    },
    signOut: async () => {
      await firebaseSignOut(auth);
      await waitForUser((u) => u.isAnonymous); // the listener starts the new guest session
    },
    getAccount: async () => {
      await ensureReady();
      if (!isWholesale || !currentUser) return null;
      return { isWholesale: true, name: currentUser.displayName || currentUser.email || 'Wholesale account' };
    },
    // Public CMS docs written from /admin. Any failure (rules not deployed
    // yet, offline) falls back to the built-in defaults rather than blanking
    // the page.
    getSiteContent: async () => {
      const read = async (id) => {
        try {
          const snap = await getDoc(doc(db, 'site', id));
          return snap.exists() ? snap.data() : undefined;
        } catch (err) {
          console.warn(`Could not load site/${id}; using defaults.`, err);
          return undefined;
        }
      };
      const [settings, home] = await Promise.all([read('settings'), read('home')]);
      return { settings: mergeContent(DEFAULT_SETTINGS, settings), home: mergeContent(DEFAULT_HOME, home) };
    },
  };
}

async function resolveStore() {
  if (!isFirebaseConfigured) return mockStore;
  try {
    return await createFirebaseStore();
  } catch (err) {
    console.error('Firebase backend unavailable, falling back to the local demo cart.', err);
    return mockStore;
  }
}

export const store = await resolveStore();
