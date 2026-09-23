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
  footer: {
    tagline: 'Wigs, bundles, extensions & accessories',
    showAdminLink: true,
  },
  theme: {
    accent: '#d9799d',
    accentDark: '#b85678',
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
    image: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Model with long, defined curly hair' },
    showLogoPanel: true,
    logoPanelImage: { url: '/assets/nakuadiary-logo.png', alt: 'Nakuadiary — Look Good, Feel Confident.' },
    motionLabel: 'Human hair · Ghana',
    badges: ['Prices in GHS', 'Guest checkout', 'MoMo & card checkout'],
  },
  categories: {
    show: true,
    eyebrow: 'Start here',
    title: 'What are you shopping for?',
    // Fixed to the four catalog categories (same order as data.js) — the
    // tile links to /shop?category=<id>, so only copy and photo are editable.
    tiles: [
      { id: 'wigs', label: 'Wigs', detail: 'Ready-to-wear confidence.', image: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=900', alt: 'Model wearing long defined curly hair' } },
      { id: 'bundles', label: 'Bundles', detail: 'Choose your texture and length.', image: { url: 'https://images.pexels.com/photos/2269878/pexels-photo-2269878.jpeg?auto=compress&cs=tinysrgb&w=900', alt: 'Studio portrait with long dark wavy hair' } },
      { id: 'extensions', label: 'Extensions', detail: 'Add length without the commitment.', image: { url: 'https://images.pexels.com/photos/17291688/pexels-photo-17291688.jpeg?auto=compress&cs=tinysrgb&w=900', alt: 'Woman with long sleek hair in a studio portrait' } },
      { id: 'accessories', label: 'Accessories', detail: 'The finishing details.', image: { url: 'https://images.pexels.com/photos/11292329/pexels-photo-11292329.jpeg?auto=compress&cs=tinysrgb&w=900', alt: 'Lifestyle portrait with long styled hair' } },
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
