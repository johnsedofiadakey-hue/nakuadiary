// Editable storefront content (CMS). The admin portal writes two Firestore
// docs — site/settings and site/home — and the storefront deep-merges them
// over these defaults, so a missing doc, a missing field, or an older saved
// shape always falls back to sensible copy instead of a blank section.
// See docs/FIREBASE_BACKEND_CONTRACT.md → "Site content".

export const DEFAULT_SETTINGS = {
  brand: {
    businessName: 'Nakuadiary',
    logo: { url: '/assets/nakuadiary-logo.png', alt: 'Nakuadiary' },
    showWordmark: true,
  },
  contact: {
    // Digits only, with country code and no leading + (wa.me format).
    whatsappNumber: '233200000000',
    email: 'hello@example.com',
    instagramUrl: '',
    tiktokUrl: '',
    facebookUrl: '',
  },
  announcement: {
    enabled: false,
    text: 'Free delivery within Accra on orders over GHS 1,500',
    link: '/shop',
  },
  shop: {
    deliveryNote: 'Delivery arrangements are confirmed before your order is dispatched.',
  },
  // Checkout delivery pricing. The server (functions/src/delivery.js) applies
  // the same rules — this copy is only for showing the fee before payment.
  delivery: {
    mode: 'arranged', // 'arranged' (fee confirmed after ordering) | 'free' | 'flat' | 'zones'
    flatFee: 0,
    freeOver: 0, // 0 = no free-delivery threshold
    zones: [], // [{ name: 'East Legon', fee: 30 }]
    pickupAddress: '',
    pickupHours: '',
  },
  // Used in the Refunds and Delivery policy pages.
  policies: {
    returnWindowDays: 3,
    dispatchTime: '1–2 working days',
    lastUpdated: '2026-09-24',
  },
  footer: {
    tagline: 'Wigs, bundles, extensions & accessories',
    showAdminLink: true,
  },
  theme: {
    accent: '#b86b61',
    accentDark: '#7c3b35',
  },
  seo: {
    title: 'Nakuadiary — Wigs, bundles & extensions',
    description: 'Nakuadiary — soft, romantic human hair wigs, bundles, and extensions. Retail and wholesale, prices in Ghana cedis.',
    shareImage: { url: '/assets/nakuadiary-social.png', alt: 'Nakuadiary' },
  },
};

export const DEFAULT_HOME = {
  hero: {
    show: true,
    eyebrow: 'Premium human hair · Ghana',
    // `*word*` renders in the script accent font; a line break becomes <br>.
    headline: 'YOUR *best* HAIR DAY,\nSTARTS HERE.',
    body: 'Shop ready-to-wear wigs, bundles and extensions with clear Ghana cedi prices. Choose your texture, select a length, and order straight from your phone.',
    primaryCta: { label: 'Shop hair now', href: '/shop' },
    secondaryCta: { label: 'Wholesale pricing', href: '/wholesale' },
    image: { url: '/assets/campaign/nakuadiary-hero-poster-v1.webp', alt: 'Nakuadiary campaign model with long loose-wave human hair' },
    desktopImage: { url: '/assets/campaign/nakuadiary-hero-desktop-v1.webp', alt: 'Nakuadiary campaign model with long loose-wave human hair and bundles' },
    // Upload a short, silent .mp4 to Firebase Storage, then paste its public
    // URL in Admin → Homepage to replace the animated poster with a real loop.
    videoUrl: '',
    showLogoPanel: false,
    logoPanelImage: { url: '/assets/nakuadiary-logo.png', alt: 'Nakuadiary — Look Good, Feel Confident.' },
    motionLabel: 'Hair in motion',
    badges: ['GHS prices', 'MoMo & card', 'Delivery / pickup'],
  },
  categories: {
    show: true,
    eyebrow: 'The Nakuadiary edit',
    title: 'Shop by *category.*',
    // Fixed to the four catalog categories (same order as data.js) — the
    // tile links to /shop?category=<id>, so only copy and photo are editable.
    tiles: [
      { id: 'wigs', label: 'Wigs', detail: 'Ready-to-wear luxury.', image: { url: '/assets/campaign/nakuadiary-wigs-v1.webp', alt: 'Long loose-wave lace-front wig on a mannequin' } },
      { id: 'bundles', label: 'Bundles', detail: 'Texture you can feel.', image: { url: '/assets/campaign/nakuadiary-bundles-v1.webp', alt: 'Three loose-wave human hair bundles' } },
      { id: 'extensions', label: 'Extensions', detail: 'Length that blends beautifully.', image: { url: '/assets/campaign/nakuadiary-extensions-v1.webp', alt: 'Long loose-wave hair extensions shown from the back' } },
      { id: 'accessories', label: 'Accessories', detail: 'The finishing details.', image: { url: '/assets/campaign/nakuadiary-accessories-v1.webp', alt: 'Silk bonnet, scrunchie, comb and edge brush' } },
    ],
  },
  paths: {
    show: true,
    eyebrow: 'Two ways to shop',
    title: 'Retail & wholesale, both welcome.',
    retail: { eyebrow: 'Retail', title: 'Shopping for yourself?', body: 'Browse the full collection, pick your length, and check out as a guest — no account needed.', ctaLabel: 'Shop retail' },
    wholesale: { eyebrow: 'Wholesale', title: 'Buying in bulk?', body: 'Salons, stylists and resellers get a dedicated price list and lower minimums once their account is set up.', ctaLabel: 'See wholesale pricing' },
  },
  featured: {
    show: true,
    eyebrow: 'Most wanted',
    title: 'Textures people are *loving* now.',
    emptyText: 'The edit is on its way.',
  },
  steps: {
    show: true,
    eyebrow: 'Simple from phone to order',
    title: 'Shop in three steps.',
    items: [
      { title: 'Choose your texture', body: 'Wigs, bundles, extensions or accessories.' },
      { title: 'Select your length', body: 'See the GHS price before you add it to your bag.' },
      { title: 'Check out as a guest', body: 'Enter your delivery details, then pay by Mobile Money or card.' },
    ],
  },
  newsletter: {
    show: true,
    eyebrow: 'The Nakuadiary list',
    title: 'New textures, *good hair days.*',
    body: 'Be first to hear about new arrivals and restocks.',
    ctaLabel: 'Join the private list',
    // Empty = email the contact address from Settings.
    ctaHref: '',
  },
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Deep-merges saved content over defaults. Arrays of objects (tiles, steps)
 * keep the default length and merge by index; arrays of scalars (badges)
 * are replaced wholesale. Values whose type doesn't match the default are
 * ignored, so a malformed doc can't break rendering.
 */
export function mergeContent(defaults, saved) {
  if (Array.isArray(defaults)) {
    if (!Array.isArray(saved)) return structuredClone(defaults);
    if (!defaults.length) return structuredClone(saved.filter((item) => item !== null && item !== undefined)); // open-ended lists (delivery zones): shape is validated by the reader
    if (defaults.length && isPlainObject(defaults[0])) return defaults.map((item, index) => mergeContent(item, saved[index]));
    return saved.filter((item) => typeof item === typeof (defaults[0] ?? ''));
  }
  if (isPlainObject(defaults)) {
    const source = isPlainObject(saved) ? saved : {};
    return Object.fromEntries(Object.keys(defaults).map((key) => [key, mergeContent(defaults[key], source[key])]));
  }
  return saved !== undefined && saved !== null && typeof saved === typeof defaults ? saved : defaults;
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Escaped text with two tiny formatting affordances: *accent* and line breaks. */
export const richText = (value) => escapeHtml(value).replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');

/** Allows site-relative, http(s), mailto: and tel: links only. */
export function safeHref(value, fallback = '/') {
  const href = String(value || '').trim();
  return /^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(href) ? href : fallback;
}

export const isHexColour = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ''));
