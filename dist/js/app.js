import { categories } from './data.js?v=2';
import { store } from './store.js?v=2';
import { money } from './components/templates.js?v=2';
import { updateSeo } from './seo.js?v=2';
import { DEFAULT_HOME, escapeHtml as esc, richText, safeHref, isHexColour } from './site-content.js?v=2';

const app = document.querySelector('#app');
const page = document.body.dataset.page;

// Editable storefront content (see site-content.js). Loaded once at start-up;
// the WhatsApp number, contact email, logo and homepage copy all come from
// /admin → Settings and /admin → Homepage.
const site = await store.getSiteContent();
const settings = site.settings;
const whatsappNumber = () => String(settings.contact.whatsappNumber || '').replace(/\D/g, '');
const contactEmail = () => settings.contact.email.trim();
const waLink = (text) => `https://wa.me/${whatsappNumber()}?text=${encodeURIComponent(text)}`;
const mailLink = (subject) => `mailto:${encodeURIComponent(contactEmail()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`;
const imageUrl = (image, fallback = '') => safeHref(image?.url, fallback);

function applyTheme() {
  const root = document.documentElement.style;
  if (isHexColour(settings.theme.accent)) root.setProperty('--rose', settings.theme.accent);
  if (isHexColour(settings.theme.accentDark)) root.setProperty('--rose-dark', settings.theme.accentDark);
}

let activeProduct = null;
let activeCategory = 'all';
let activeTag = 'all';
let shopSearchTerm = '';
let shopItemsCache = [];

const productType = (product) => product.type || 'Human hair';
const productDetails = (product) => product.details || ['Choose your preferred length'];

function productCard(product) {
  return `<article class="product-card">
    <a class="product-image" href="/product?id=${product.id}" aria-label="View ${product.name}"><img src="${product.image}" alt="${product.alt || product.name}" />${product.images?.length > 1 ? `<span class="photo-count">${product.images.length} photos</span>` : ''}</a>
    <div class="product-card-copy">
      <p class="product-type">${productType(product)}</p>
      <h3><a href="/product?id=${product.id}">${product.name}</a></h3>
      <p class="product-lengths">${product.variants.join(' · ')}</p>
      ${product.soldOut ? '<strong class="sold-out-label">Sold out</strong>' : `<strong>From ${money(product.price)}</strong>`}
      <a class="underlined" href="/product?id=${product.id}">View product →</a>
    </div>
  </article>`;
}

// ---- Shared chrome (header, footer, cart, dialogs) -----------------------

function brandHtml(extraClass = '') {
  const { businessName, logo, showWordmark } = settings.brand;
  const logoUrl = imageUrl(logo, '/assets/nakuadiary-logo.png');
  return `<a class="brand ${extraClass}" href="/" aria-label="${esc(businessName)} home"><img class="brand-mark" src="${esc(logoUrl)}" alt="" />${showWordmark ? '<span>NAKUA<em>diary</em></span>' : ''}</a>`;
}

function announcementHtml() {
  const { enabled, text, link } = settings.announcement;
  if (!enabled || !text.trim()) return '';
  const href = link.trim() ? safeHref(link, '') : '';
  return `<div class="announcement-bar">${href ? `<a href="${esc(href)}">${esc(text)}</a>` : `<span>${esc(text)}</span>`}</div>`;
}

function socialLinksHtml() {
  const links = [['Instagram', settings.contact.instagramUrl], ['TikTok', settings.contact.tiktokUrl], ['Facebook', settings.contact.facebookUrl]]
    .filter(([, url]) => /^https?:\/\//i.test(url.trim()));
  return links.map(([label, url]) => `<a href="${esc(url.trim())}" target="_blank" rel="noopener">${label}</a>`).join('');
}

function headerHtml() {
  const nav = [
    { href: '/', label: 'Home', key: 'home' },
    { href: '/shop', label: 'Shop', key: 'shop' },
    { href: '/wholesale', label: 'Wholesale', key: 'wholesale' },
  ];
  return `${announcementHtml()}<header class="site-header">
    ${brandHtml()}
    <button class="menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav class="site-nav" id="site-nav">${nav.map((n) => `<a href="${n.href}" class="${page === n.key ? 'is-active' : ''}">${n.label}</a>`).join('')}</nav>
    <div class="header-actions">
      <div class="account-area" data-account-area></div>
      <button class="bag-button" type="button" data-open-cart aria-label="Open cart">Cart <span data-cart-count>0</span></button>
    </div>
  </header>`;
}

function footerHtml() {
  const { businessName } = settings.brand;
  const { tagline, showAdminLink } = settings.footer;
  return `<footer class="site-footer">
    ${brandHtml('footer-brand')}
    <nav><a href="/shop">Shop</a><a href="/wholesale">Wholesale</a><a href="${waLink(`Hi! I have a question about ${businessName}.`)}" target="_blank" rel="noopener">WhatsApp us</a>${socialLinksHtml()}</nav>
    <nav class="footer-policies" aria-label="Policies"><a href="/delivery">Delivery &amp; pickup</a><a href="/refunds">Returns &amp; refunds</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    <div class="footer-meta"><p>© ${new Date().getFullYear()} ${esc(businessName)}${tagline.trim() ? ` · ${esc(tagline)}` : ''}</p>${showAdminLink ? '<a class="footer-admin-link" href="/admin">Admin login</a>' : ''}</div>
  </footer>`;
}

function chromeExtrasHtml() {
  return `<div class="overlay" hidden data-overlay></div>
  <aside class="cart" data-cart aria-hidden="true">
    <header><h2>Your cart</h2><button type="button" data-close-cart aria-label="Close cart">×</button></header>
    <div data-cart-lines></div>
    <footer>
      <p class="cart-total"><span>Subtotal</span><strong data-cart-total>${money(0)}</strong></p>
      <p class="delivery-note">${esc(settings.shop.deliveryNote)}</p>
      <button class="btn wide" type="button" data-open-checkout>Checkout</button>
    </footer>
  </aside>
  <dialog class="account-dialog" data-account-dialog>
    <button class="dialog-close" type="button" data-close-account aria-label="Close sign in">×</button>
    <form data-account-form>
      <p class="eyebrow">Wholesale</p>
      <h2>Account <em>access</em></h2>
      <p class="checkout-intro">Sign in with your wholesale account to see wholesale pricing.</p>
      <label>Email<input name="email" type="email" autocomplete="email" required /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      <p class="form-error" data-account-error></p>
      <button class="btn wide" type="submit">Sign in</button>
      <button class="link-button forgot-link" type="button" data-forgot-password>Forgot password?</button>
    </form>
  </dialog>
  <dialog class="checkout-dialog" data-checkout-dialog>
    <button class="dialog-close" type="button" data-close-checkout aria-label="Close checkout">×</button>
    <form data-checkout-form>
      <p class="eyebrow">Checkout</p>
      <h2>Your <em>details</em></h2>
      <p class="checkout-intro">We use these details to prepare and confirm your order.</p>
      <label>Full name<input name="name" autocomplete="name" required /></label>
      <label>WhatsApp / phone number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 024 000 0000" required /></label>
      <label>Delivery preference<select name="deliveryPreference" required data-delivery-preference><option value="">Choose one</option><option>Delivery</option><option>Pickup</option></select></label>
      ${settings.delivery.mode === 'zones' && deliveryZones().length ? `<label data-delivery-zone-field>Delivery area<select name="deliveryZone" data-delivery-zone><option value="">Choose your area</option>${deliveryZones().map((z) => `<option value="${esc(z.name)}">${esc(z.name)} — ${money(z.fee)}</option>`).join('')}</select></label>` : ''}
      <label data-delivery-address-field>Town, area or landmark<textarea name="deliveryAddress" rows="2" placeholder="Tell us where to arrange your order" required></textarea></label>
      <div class="checkout-summary" data-checkout-summary></div>
      <p class="checkout-note">You will be taken to a secure payment page for Mobile Money or card payment.</p>
      <button class="btn wide" type="submit">Pay now</button>
    </form>
  </dialog>
  <div class="toast" data-toast aria-live="polite"></div>`;
}

// ---- Delivery fee preview (the server recomputes it — see functions/src/delivery.js) ----

let cartSubtotal = 0;
const deliveryZones = () => (settings.delivery.zones || []).filter((z) => z && typeof z.name === 'string' && z.name.trim() && Number.isFinite(Number(z.fee)) && Number(z.fee) >= 0).map((z) => ({ name: z.name.trim(), fee: Number(z.fee) }));

/** { fee, label } for the current checkout choices; fee null = decided after ordering. */
function deliveryQuote(preference, zoneName, subtotal) {
  const d = settings.delivery;
  if (preference !== 'Delivery') return { fee: 0, label: preference === 'Pickup' ? 'Pickup — free' : '—' };
  if (d.mode === 'arranged') return { fee: null, label: 'Confirmed with you after ordering' };
  if (d.mode === 'free') return { fee: 0, label: 'Free' };
  const freeOver = Number(d.freeOver) || 0;
  if (d.mode === 'zones') {
    const zone = deliveryZones().find((z) => z.name === zoneName);
    if (!zone) return { fee: null, label: 'Choose your area' };
    return freeOver > 0 && subtotal >= freeOver ? { fee: 0, label: 'Free' } : { fee: zone.fee, label: money(zone.fee) };
  }
  const flat = Math.max(0, Number(d.flatFee) || 0);
  return freeOver > 0 && subtotal >= freeOver ? { fee: 0, label: 'Free' } : { fee: flat, label: flat ? money(flat) : 'Free' };
}

function renderCheckoutSummary() {
  const form = document.querySelector('[data-checkout-form]');
  const box = document.querySelector('[data-checkout-summary]');
  if (!form || !box) return;
  const zoneField = form.querySelector('[data-delivery-zone-field]');
  const isDelivery = form.deliveryPreference.value === 'Delivery';
  if (zoneField) { zoneField.hidden = !isDelivery; zoneField.querySelector('select').required = isDelivery; }
  const quote = deliveryQuote(form.deliveryPreference.value, form.deliveryZone?.value, cartSubtotal);
  const freeOver = Number(settings.delivery.freeOver) || 0;
  const hint = isDelivery && freeOver > 0 && settings.delivery.mode !== 'arranged' && cartSubtotal < freeOver ? `<small>Free delivery on orders over ${money(freeOver)}.</small>` : '';
  box.innerHTML = `<p><span>Subtotal</span><strong>${money(cartSubtotal)}</strong></p><p><span>Delivery</span><strong>${esc(quote.label)}</strong></p>${hint}<p class="checkout-total"><span>Total to pay now</span><strong>${money(cartSubtotal + (quote.fee || 0))}</strong></p>`;
}

function renderShell() {
  app.innerHTML = `${headerHtml()}<main id="main" data-main></main>${footerHtml()}${chromeExtrasHtml()}`;
  syncMobileNavOffset();
}

function syncMobileNavOffset() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  document.documentElement.style.setProperty('--mobile-nav-top', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
}

// ---- Cart / account (shared across every page) ----------------------------

async function renderCart() {
  const { lines } = await store.getCart();
  const detailed = await Promise.all(lines.map(async (line) => ({ ...line, product: await store.getProduct(line.productId) })));
  const valid = detailed.filter((line) => line.product);
  const unitPrice = (line) => line.product.variantDetails?.find((v) => v.label === line.variant)?.price || line.product.price;
  const count = valid.reduce((total, line) => total + line.quantity, 0);
  const total = valid.reduce((sum, line) => sum + line.quantity * unitPrice(line), 0);
  cartSubtotal = total;
  document.querySelector('[data-cart-count]').textContent = count;
  document.querySelector('[data-cart-total]').textContent = money(total);
  document.querySelector('[data-cart-lines]').innerHTML = valid.length
    ? valid.map((line) => `<article class="cart-line"><img src="${line.product.image}" alt="" /><div><p>${productType(line.product)}</p><h3>${line.product.name}</h3><strong>${line.variant} · ${money(unitPrice(line))}</strong></div><div class="quantity"><button type="button" data-line-change="-1" data-product="${line.productId}" data-line-variant="${line.variant}" aria-label="Reduce quantity">−</button><span>${line.quantity}</span><button type="button" data-line-change="1" data-product="${line.productId}" data-line-variant="${line.variant}" aria-label="Increase quantity">+</button></div></article>`).join('')
    : '<p class="empty">Your cart is empty.</p>';
}

async function renderAccount() {
  const account = await store.getAccount();
  document.querySelector('[data-account-area]').innerHTML = account
    ? `<span>Wholesale · ${account.name}</span><button type="button" data-sign-out>Sign out</button>`
    : `<button type="button" data-open-account>Sign in</button>`;
}
async function refreshForAccount() {
  // Re-fetch (not just re-filter) so prices pick up the new wholesale/retail
  // tier — store.js resolves that at fetch time, so a cached grid would
  // otherwise keep showing stale prices after signing in or out.
  let pageRefresh = Promise.resolve();
  if (page === 'shop') pageRefresh = renderShop();
  else if (page === 'home') pageRefresh = renderHome();
  else if (page === 'product') pageRefresh = renderProductPage();
  await Promise.all([renderAccount(), renderCart(), pageRefresh]);
}

function toggleCart(open) {
  document.querySelector('[data-cart]').classList.toggle('open', open);
  document.querySelector('[data-cart]').setAttribute('aria-hidden', String(!open));
  document.querySelector('[data-overlay]').hidden = !open;
}
function toast(text) {
  const node = document.querySelector('[data-toast]');
  node.textContent = text; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2800);
}
function syncDeliveryAddressField(select) {
  const field = document.querySelector('[data-delivery-address-field]'); const textarea = field.querySelector('textarea');
  const show = select.value === 'Delivery'; field.hidden = !show; textarea.required = show; if (!show) textarea.value = '';
}

// ---- Page: home ------------------------------------------------------------

function heroHtml(hero) {
  const heroImage = imageUrl(hero.image, DEFAULT_HOME.hero.image.url);
  const heroDesktopImage = imageUrl(hero.desktopImage, heroImage);
  const heroVideo = safeHref(hero.videoUrl, '');
  const panelImage = imageUrl(hero.logoPanelImage, '');
  const ctas = [[hero.primaryCta, 'btn'], [hero.secondaryCta, 'btn outline']].filter(([cta]) => cta.label.trim());
  return `<section class="hero hero-cinematic">
      <div class="hero-visual"><picture><source media="(min-width: 701px)" srcset="${esc(heroDesktopImage)}" /><img class="hero-poster" src="${esc(heroImage)}" alt="${esc(hero.image.alt)}" /></picture>${heroVideo ? `<video class="hero-video" data-hero-video muted loop playsinline autoplay preload="metadata" poster="${esc(heroImage)}"><source src="${esc(heroVideo)}" type="video/mp4" /></video>` : ''}<span class="hero-light-sweep" aria-hidden="true"></span><span class="hero-hair-flow flow-one" aria-hidden="true"></span><span class="hero-hair-flow flow-two" aria-hidden="true"></span></div>
      <div class="hero-scrim" aria-hidden="true"></div>
      <i class="hero-orbit orbit-a" aria-hidden="true"></i><i class="hero-orbit orbit-b" aria-hidden="true"></i>
      <div class="hero-copy">
        ${hero.eyebrow.trim() ? `<p class="eyebrow">${esc(hero.eyebrow)}</p>` : ''}
        <h1>${richText(hero.headline)}</h1>
        ${hero.body.trim() ? `<p>${esc(hero.body)}</p>` : ''}
        ${ctas.length ? `<div class="hero-actions">${ctas.map(([cta, cls]) => `<a class="${cls}" href="${esc(safeHref(cta.href, '/shop'))}">${esc(cta.label)}</a>`).join('')}</div>` : ''}
      </div>
      ${hero.showLogoPanel && panelImage ? `<div class="hero-logo-panel"><img src="${esc(panelImage)}" alt="${esc(hero.logoPanelImage.alt)}" /></div>` : ''}
      ${hero.motionLabel.trim() ? `<span class="hero-motion-label" aria-hidden="true">${esc(hero.motionLabel)}</span>` : ''}
      <button class="hero-motion-toggle" type="button" data-hero-motion-toggle aria-label="Pause hero motion" aria-pressed="false"><span aria-hidden="true">Ⅱ</span><span class="sr-only">Pause hero motion</span></button>
      ${hero.badges.length ? `<div class="hero-badges">${hero.badges.map((badge) => `<span>${esc(badge)}</span>`).join('')}</div>` : ''}
    </section>`;
}

const sectionHead = ({ eyebrow, title }) => `<div class="section-head">${eyebrow.trim() ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${richText(title)}</h2></div>`;

async function renderHome() {
  const main = document.querySelector('[data-main]');
  const home = site.home;
  const featured = home.featured.show ? await store.listProducts({ featured: true }) : [];
  if (settings.seo.title.trim()) {
    updateSeo({ title: settings.seo.title, description: settings.seo.description, image: imageUrl(settings.seo.shareImage, '/assets/nakuadiary-social.png') });
  }
  const { categories: cats, paths, steps, newsletter } = home;
  const sections = [
    home.hero.show && heroHtml(home.hero),
    cats.show && `<section class="section" data-home-reveal>
      ${sectionHead(cats)}
      <div class="category-grid">${cats.tiles.map((tile) => {
        const photo = imageUrl(tile.image, '');
        return `<a class="category-tile ${photo ? 'has-image' : ''}" href="/shop?category=${encodeURIComponent(tile.id)}">${photo ? `<img class="category-tile-image" src="${esc(photo)}" alt="${esc(tile.image.alt)}" loading="lazy" />` : ''}<b>${esc(tile.label)}</b><span>${esc(tile.detail)}</span><i>Shop now →</i></a>`;
      }).join('')}</div>
    </section>`,
    paths.show && `<section class="section tint" data-home-reveal>
      ${sectionHead(paths)}
      <div class="paths">
        <div class="path-card"><p class="eyebrow">${esc(paths.retail.eyebrow)}</p><h3>${esc(paths.retail.title)}</h3><p>${esc(paths.retail.body)}</p><a class="btn outline" href="/shop">${esc(paths.retail.ctaLabel)}</a></div>
        <div class="path-card wholesale"><p class="eyebrow">${esc(paths.wholesale.eyebrow)}</p><h3>${esc(paths.wholesale.title)}</h3><p>${esc(paths.wholesale.body)}</p><a class="btn" href="/wholesale">${esc(paths.wholesale.ctaLabel)}</a></div>
      </div>
    </section>`,
    home.featured.show && `<section class="section" data-home-reveal>
      ${sectionHead(home.featured)}
      <div class="product-grid home-product-grid">${featured.length ? featured.map(productCard).join('') : `<p class="empty-products">${esc(home.featured.emptyText)}</p>`}</div>
    </section>`,
    steps.show && `<section class="section tint" data-home-reveal>
      ${sectionHead(steps)}
      <div class="steps">${steps.items.map((step, index) => `<div class="step"><span>${String(index + 1).padStart(2, '0')}</span><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></div>`).join('')}</div>
    </section>`,
    newsletter.show && `<section class="newsletter" data-home-reveal>${newsletter.eyebrow.trim() ? `<p class="eyebrow">${esc(newsletter.eyebrow)}</p>` : ''}<h2>${richText(newsletter.title)}</h2>${newsletter.body.trim() ? `<p>${esc(newsletter.body)}</p>` : ''}${newsletter.ctaLabel.trim() ? `<a class="btn" href="${esc(newsletter.ctaHref.trim() ? safeHref(newsletter.ctaHref, '/') : mailLink(`${settings.brand.businessName} private list`))}">${esc(newsletter.ctaLabel)}</a>` : ''}</section>`,
  ];
  main.innerHTML = sections.filter(Boolean).join('');
  setupHomeReveals(main);
}

function setupHomeReveals(main) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  main.querySelectorAll('[data-home-reveal]').forEach((section) => observer.observe(section));
}

// ---- Page: shop --------------------------------------------------------

async function renderShop() {
  const params = new URLSearchParams(location.search);
  activeCategory = params.get('category') || 'all';
  activeTag = params.get('tag') || 'all';
  shopSearchTerm = '';
  const main = document.querySelector('[data-main]');
  main.innerHTML = `<section class="section">
    <div class="section-head"><p class="eyebrow">Shop hair</p><h2>Find your <em>texture.</em></h2><p>Every price is shown in Ghana cedis. Sign in with a wholesale account to see wholesale pricing.</p></div>
    <div class="toolbar">
      <div class="filters" data-filters>
        <button type="button" data-category="all" class="${activeCategory === 'all' ? 'is-active' : ''}">All hair</button>
        ${categories.map((c) => `<button type="button" data-category="${c.id}" class="${activeCategory === c.id ? 'is-active' : ''}">${c.label}</button>`).join('')}
      </div>
      <input class="search-input" type="search" placeholder="Search products…" data-search />
    </div>
    <div class="filters tag-filters" data-tag-filters hidden></div>
    <div class="product-grid" data-products><p class="empty-products">Loading…</p></div>
  </section>`;
  shopItemsCache = await store.listProducts({});
  renderTagFilters();
  renderShopGrid();
}

const sameTag = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const inCategory = (p) => activeCategory === 'all' || p.category === activeCategory;

/** Texture/style chips, built from the tags of products in the chosen category (admin → product → Tags). */
function renderTagFilters() {
  const row = document.querySelector('[data-tag-filters]');
  if (!row) return;
  const tags = [];
  shopItemsCache.filter(inCategory).forEach((p) => (p.tags || []).forEach((tag) => { if (!tags.some((t) => sameTag(t, tag))) tags.push(tag.trim()); }));
  tags.sort((a, b) => a.localeCompare(b));
  if (activeTag !== 'all' && !tags.some((t) => sameTag(t, activeTag))) activeTag = 'all';
  row.hidden = tags.length === 0;
  row.innerHTML = tags.length ? `<button type="button" data-tag="all" class="${activeTag === 'all' ? 'is-active' : ''}">All styles</button>${tags.map((tag) => `<button type="button" data-tag="${esc(tag)}" class="${sameTag(activeTag, tag) ? 'is-active' : ''}">${esc(tag)}</button>`).join('')}` : '';
}

/** Keeps the address bar shareable, e.g. /shop?category=wigs&tag=Body%20wave. */
function syncShopUrl() {
  const params = new URLSearchParams();
  if (activeCategory !== 'all') params.set('category', activeCategory);
  if (activeTag !== 'all') params.set('tag', activeTag);
  history.replaceState(null, '', `/shop${params.toString() ? `?${params}` : ''}`);
}

function renderShopGrid() {
  const grid = document.querySelector('[data-products]');
  if (!grid) return;
  const term = shopSearchTerm;
  const filtered = shopItemsCache.filter((p) => inCategory(p)
    && (activeTag === 'all' || (p.tags || []).some((tag) => sameTag(tag, activeTag)))
    && (!term || p.name.toLowerCase().includes(term) || (p.tags || []).some((tag) => tag.toLowerCase().includes(term))));
  grid.innerHTML = filtered.length ? filtered.map(productCard).join('') : '<p class="empty-products">No products found. Try another search or category.</p>';
}

// ---- Page: product ------------------------------------------------------

async function renderProductPage() {
  const id = new URLSearchParams(location.search).get('id');
  const main = document.querySelector('[data-main]');
  activeProduct = id ? await store.getProduct(id) : null;
  if (!activeProduct) {
    main.innerHTML = '<div class="section"><p class="empty-state">We couldn’t find that product. <a href="/shop">Back to shop →</a></p></div>';
    return;
  }
  document.title = `${activeProduct.name} — Nakuadiary`;
  updateSeo({
    title: `${activeProduct.name} — Nakuadiary`,
    description: `${activeProduct.description} Shop ${activeProduct.type || 'human hair'} in Ghana cedis from Nakuadiary.`,
    image: activeProduct.image,
    type: 'product',
  });
  const gallery = activeProduct.images?.length ? activeProduct.images : [{ url: activeProduct.image, alt: activeProduct.alt }];
  const choices = activeProduct.variantDetails || activeProduct.variants.map((label) => ({ label, price: activeProduct.price, soldOut: false }));
  const firstChoice = choices.find((v) => !v.soldOut);
  main.innerHTML = `<p class="breadcrumb"><a href="/shop">Shop</a> / ${activeProduct.name}</p>
  <div class="product-detail">
    <div class="product-gallery"><div class="product-detail-image"><img data-gallery-main src="${gallery[0].url}" alt="${gallery[0].alt || activeProduct.name}" /></div>${gallery.length > 1 ? `<div class="gallery-thumbnails" aria-label="Product photos">${gallery.map((image, index) => `<button type="button" data-gallery-image="${index}" class="${index === 0 ? 'is-active' : ''}" aria-label="Show photo ${index + 1}"><img src="${image.url}" alt="" /></button>`).join('')}</div>` : ''}</div>
    <div class="product-detail-copy">
      <p class="eyebrow">${productType(activeProduct)}</p>
      <h1>${activeProduct.name}</h1>
      <p class="dialog-price" data-product-price>${money(firstChoice?.price ?? activeProduct.price)}</p>
      <p class="description">${activeProduct.description}</p>
      <ul>${productDetails(activeProduct).map((d) => `<li>${d}</li>`).join('')}</ul>
      ${activeProduct.tags?.length ? `<p class="product-tags">${activeProduct.tags.map((tag) => `<a href="/shop?tag=${encodeURIComponent(tag)}">${esc(tag)}</a>`).join('')}</p>` : ''}
      <fieldset><legend>Choose a length</legend><div class="variant-options">${choices.map((v) => `<button type="button" data-variant="${esc(v.label)}" data-price="${esc(v.price)}" class="${v === firstChoice ? 'selected' : ''} ${v.soldOut ? 'is-sold-out' : ''}" ${v.soldOut ? 'disabled aria-disabled="true"' : ''}>${esc(v.label)}${v.soldOut ? '<small>Sold out</small>' : v.lowStock ? `<small>Only ${esc(v.lowStock)} left</small>` : ''}</button>`).join('')}</div></fieldset>
      ${firstChoice ? '<button class="btn wide" type="button" data-add-product>Add to cart</button>' : `<button class="btn wide" type="button" disabled>Sold out</button><a class="btn outline wide notify-link" href="${waLink(`Hi! Please let me know when ${activeProduct.name} is back in stock.`)}" target="_blank" rel="noopener">Ask about restock on WhatsApp</a>`}
    </div>
  </div>`;
}

// ---- Page: wholesale -------------------------------------------------------

function renderWholesale() {
  const main = document.querySelector('[data-main]');
  main.innerHTML = `<section class="wholesale-hero">
    <div>
      <p class="eyebrow">For salons, stylists &amp; resellers</p>
      <h1>Wholesale <em>hair</em>, made simple.</h1>
      <p>Lower unit prices on the same quality wigs, bundles and extensions — set up with an account made just for your business.</p>
      <ul class="wholesale-perks">
        <li>Wholesale pricing on every product</li>
        <li>Low minimum order quantities</li>
        <li>A dedicated account, set up for you personally</li>
      </ul>
    </div>
    <div class="wholesale-card">
      <h2>Ready to apply?</h2>
      <p>Message us with your business name and what you're looking to stock — we'll set up your wholesale account and send your login directly.</p>
      <a class="btn whatsapp wide" href="${waLink(`Hi! I'd like to apply for a ${settings.brand.businessName} wholesale account.`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>
      <a class="btn outline wide" style="margin-top:.7rem" href="${esc(mailLink('Wholesale enquiry'))}">Email us instead</a>
    </div>
  </section>
  <section class="section">
    <div class="section-head"><p class="eyebrow">Why wholesale with us</p><h2>Built for people who sell hair too.</h2></div>
    <div class="benefit-grid">
      <div class="benefit-card"><div class="icon">💸</div><h3>Better margins</h3><p>Wholesale pricing across our full catalogue, applied automatically once you're signed in.</p></div>
      <div class="benefit-card"><div class="icon">📦</div><h3>Low minimums</h3><p>Minimum order quantities are set per product, not one-size-fits-all.</p></div>
      <div class="benefit-card"><div class="icon">🤝</div><h3>A real relationship</h3><p>Every wholesale account is set up personally, so you're never just a number.</p></div>
    </div>
  </section>
  <section class="section tint">
    <div class="section-head"><p class="eyebrow">Good to know</p><h2>Wholesale FAQ</h2></div>
    <div class="faq">
      <details><summary>How do I get a wholesale account?</summary><p>Message us on WhatsApp or email with your business name and what you sell — we'll get back to you and set up your account directly.</p></details>
      <details><summary>Is there a minimum order?</summary><p>Most products have a small minimum quantity at wholesale pricing, shown at checkout once you're signed in.</p></details>
      <details><summary>How do I check out?</summary><p>Use the "Sign in" link in the menu — wholesale pricing then applies automatically across the shop.</p></details>
    </div>
  </section>`;
}

// ---- Page: order confirmation (Paystack returns here) ------------------------
// The redirect back from Paystack is NOT proof of payment: this page watches
// the order and only says "paid" once the verified webhook has marked it so.

const ORDER_STEPS = ['paid', 'processing', 'dispatched', 'delivered'];
const ORDER_STEP_LABEL = { paid: 'Payment received', processing: 'Being prepared', dispatched: 'On its way', delivered: 'Delivered / collected' };
let stopOrderWatch = () => {};

function orderLinesHtml(order) {
  const fee = Number(order.deliveryFee || 0);
  const deliveryLabel = order.delivery?.status === 'arranged' ? 'Confirmed with you' : order.delivery?.status === 'pickup' ? 'Pickup — free' : fee ? money(fee) : 'Free';
  return `<div class="order-summary-lines">${(order.lines || []).map((l) => `<div class="order-summary-line">${l.image ? `<img src="${esc(l.image)}" alt="" />` : ''}<span><strong>${esc(l.productName || l.title)}</strong><small>${esc(l.variantLabel || '')} · Qty ${esc(l.quantity)}</small></span><strong>${money(l.lineTotal ?? l.unitPrice * l.quantity)}</strong></div>`).join('')}
    <p><span>Subtotal</span><strong>${money(order.subtotal)}</strong></p><p><span>Delivery</span><strong>${esc(deliveryLabel)}</strong></p><p class="checkout-total"><span>Total paid</span><strong>${money(order.total ?? order.subtotal)}</strong></p></div>`;
}

function orderPageHtml(order, ref) {
  const reference = order.reference || ref;
  const help = `<a class="btn outline" href="${waLink(`Hi! I have a question about my order ${reference}.`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>`;
  if (order.status === 'unavailable' || order.status === 'not_found') {
    return `<p class="order-ref">Order <strong>${esc(ref)}</strong></p><h1>We couldn’t load this order <em>here.</em></h1><p>Order details are only shown on the phone or computer you ordered from. If you’ve paid, you’re all set — we’ll be in touch. Questions? Send us your reference: <strong>${esc(ref)}</strong>.</p><div class="order-actions">${help}<a class="btn" href="/shop">Keep shopping</a></div>`;
  }
  const status = order.status || 'pending_payment';
  if (status === 'pending_payment') {
    return `<p class="order-ref">Order <strong>${esc(reference)}</strong></p><h1>Confirming your <em>payment…</em></h1><p>This usually takes a few seconds. Please keep this page open — it updates by itself.</p><div class="order-spinner" aria-hidden="true"></div><p class="order-slow" data-order-slow hidden>Still waiting? If money has left your account, <strong>please don’t pay again</strong> — message us with your reference <strong>${esc(reference)}</strong> and we’ll confirm it for you.</p><div class="order-actions">${help}</div>`;
  }
  if (status === 'failed' || status === 'cancelled') {
    const paidAnyway = order.paymentStatus === 'paid';
    return `<p class="order-ref">Order <strong>${esc(reference)}</strong></p><h1>${paidAnyway ? 'This order was <em>cancelled.</em>' : 'Payment didn’t go <em>through.</em>'}</h1><p>${paidAnyway ? 'Your refund is being arranged. We’ll contact you with the details.' : 'No money was taken for this order. Your cart is still saved — you can try again, or choose a different payment method.'}</p><div class="order-actions"><a class="btn" href="/shop">Back to the shop</a>${help}</div>`;
  }
  const current = ORDER_STEPS.indexOf(status);
  const c = order.customer || {};
  const where = c.deliveryPreference === 'Pickup'
    ? `Pickup${settings.delivery.pickupAddress ? ` — ${esc(settings.delivery.pickupAddress)}` : ''}${settings.delivery.pickupHours ? ` (${esc(settings.delivery.pickupHours)})` : ''}`
    : `Delivery${order.delivery?.zone ? ` to ${esc(order.delivery.zone)}` : ''}${c.deliveryAddress ? ` — ${esc(c.deliveryAddress)}` : ''}`;
  return `<p class="order-ref">Order <strong>${esc(reference)}</strong></p>
    <h1>Thank you${c.name ? `, ${esc(c.name.split(' ')[0])}` : ''}! Your order is <em>confirmed.</em></h1>
    <p>We’ve received your payment. We’ll prepare your order within ${esc(settings.policies.dispatchTime)} and keep you updated by SMS.</p>
    <ol class="order-steps">${ORDER_STEPS.map((step, i) => `<li class="${i <= current ? 'is-done' : ''} ${i === current ? 'is-current' : ''}"><span>${i + 1}</span>${ORDER_STEP_LABEL[step]}</li>`).join('')}</ol>
    ${orderLinesHtml(order)}
    <p class="order-where"><strong>${c.deliveryPreference === 'Pickup' ? 'Pickup' : 'Delivery'}:</strong> ${where}</p>
    <p class="muted-note">Keep your reference <strong>${esc(reference)}</strong> for any questions.</p>
    <div class="order-actions"><a class="btn" href="/shop">Keep shopping</a>${help}</div>`;
}

function renderOrderPage() {
  const params = new URLSearchParams(location.search);
  const ref = (params.get('reference') || params.get('trxref') || params.get('ref') || '').trim();
  const main = document.querySelector('[data-main]');
  if (!/^[A-Za-z0-9]{20}$/.test(ref)) {
    main.innerHTML = '<section class="section order-page"><h1>Order <em>status</em></h1><p>Open the link from your payment confirmation to see your order here.</p><div class="order-actions"><a class="btn" href="/shop">Go to the shop</a></div></section>';
    return;
  }
  main.innerHTML = '<section class="section order-page" data-order-page aria-live="polite"><div class="order-spinner" aria-hidden="true"></div><p>Checking your order…</p></section>';
  const started = Date.now();
  let lastStatus = null;
  stopOrderWatch();
  stopOrderWatch = store.watchOrder(ref, (order) => {
    const box = document.querySelector('[data-order-page]');
    if (!box) return;
    box.innerHTML = orderPageHtml(order, ref);
    if (order.status === 'pending_payment') setTimeout(() => { const slow = document.querySelector('[data-order-slow]'); if (slow && Date.now() - started > 45000) slow.hidden = false; }, 46000);
    if (order.status && order.status !== lastStatus && ORDER_STEPS.includes(order.status)) renderCart(); // the webhook empties the cart on payment
    lastStatus = order.status;
  });
}

// ---- Pages: policies (privacy, terms, refunds, delivery) ------------------------

async function renderPolicyPage() {
  const { policyPage } = await import('./pages/policies.js?v=2');
  const content = policyPage(page, {
    businessName: settings.brand.businessName,
    email: contactEmail(),
    whatsapp: whatsappNumber(),
    whatsappLink: waLink(`Hi! I have a question for ${settings.brand.businessName}.`),
    delivery: settings.delivery,
    zones: deliveryZones(),
    policies: settings.policies,
    money,
  });
  document.title = `${content.title} — ${settings.brand.businessName}`;
  updateSeo({ title: document.title, description: content.description });
  document.querySelector('[data-main]').innerHTML = `<article class="section policy-page">${content.html}</article>`;
}

// ---- Global event wiring ----------------------------------------------

function wireEvents() {
  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-delivery-preference]'); if (select) syncDeliveryAddressField(select);
    if (select || event.target.closest('[data-delivery-zone]')) renderCheckoutSummary();
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-search]')) { shopSearchTerm = event.target.value.trim().toLowerCase(); renderShopGrid(); }
  });
  document.addEventListener('click', async (event) => {
    const menu = event.target.closest('[data-menu-button]');
    if (menu) { const header = document.querySelector('.site-header'); const open = header.classList.toggle('menu-open'); menu.setAttribute('aria-expanded', String(open)); return; }

    const heroMotionToggle = event.target.closest('[data-hero-motion-toggle]');
    if (heroMotionToggle) {
      const hero = heroMotionToggle.closest('.hero'); const video = hero.querySelector('[data-hero-video]');
      const paused = hero.classList.toggle('is-paused');
      if (video) paused ? video.pause() : video.play().catch(() => {});
      heroMotionToggle.setAttribute('aria-pressed', String(paused));
      heroMotionToggle.setAttribute('aria-label', paused ? 'Play hero motion' : 'Pause hero motion');
      heroMotionToggle.querySelector('.sr-only').textContent = paused ? 'Play hero motion' : 'Pause hero motion';
      heroMotionToggle.querySelector('[aria-hidden]').textContent = paused ? '▶' : 'Ⅱ';
      return;
    }

    if (event.target.closest('[data-open-cart]')) { await renderCart(); return toggleCart(true); }
    if (event.target.closest('[data-close-cart]') || event.target.matches('[data-overlay]')) return toggleCart(false);
    if (event.target.closest('[data-close-checkout]')) return document.querySelector('[data-checkout-dialog]').close();
    if (event.target.closest('[data-open-account]')) return document.querySelector('[data-account-dialog]').showModal();
    if (event.target.closest('[data-close-account]')) return document.querySelector('[data-account-dialog]').close();
    if (event.target.closest('[data-sign-out]')) { await store.signOut(); await refreshForAccount(); return toast('Signed out.'); }

    const filterBtn = event.target.closest('[data-filters] [data-category]');
    if (filterBtn) {
      activeCategory = filterBtn.dataset.category;
      document.querySelectorAll('[data-filters] [data-category]').forEach((b) => b.classList.toggle('is-active', b === filterBtn));
      renderTagFilters(); syncShopUrl();
      return renderShopGrid();
    }
    const tagBtn = event.target.closest('[data-tag-filters] [data-tag]');
    if (tagBtn) {
      activeTag = tagBtn.dataset.tag;
      document.querySelectorAll('[data-tag-filters] [data-tag]').forEach((b) => b.classList.toggle('is-active', b === tagBtn));
      syncShopUrl();
      return renderShopGrid();
    }

    const variantBtn = event.target.closest('[data-variant]');
    if (variantBtn) {
      if (variantBtn.disabled) return;
      document.querySelectorAll('[data-variant]').forEach((b) => b.classList.toggle('selected', b === variantBtn));
      const priceEl = document.querySelector('[data-product-price]');
      if (priceEl && variantBtn.dataset.price) priceEl.textContent = money(Number(variantBtn.dataset.price));
      return;
    }
    if (event.target.closest('[data-forgot-password]')) {
      const form = document.querySelector('[data-account-form]');
      const email = form.email.value.trim();
      const errorEl = document.querySelector('[data-account-error]');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Enter your email above, then tap “Forgot password?” again.'; form.email.focus(); return; }
      try { await store.resetPassword(email); } catch { /* same message either way — never reveal whether an account exists */ }
      errorEl.textContent = '';
      return toast('If there’s an account for that email, a password reset link is on its way.');
    }
    const galleryButton = event.target.closest('[data-gallery-image]');
    if (galleryButton && activeProduct) {
      const image = activeProduct.images?.[Number(galleryButton.dataset.galleryImage)];
      if (image) {
        const mainImage = document.querySelector('[data-gallery-main]');
        mainImage.src = image.url; mainImage.alt = image.alt || activeProduct.name;
        document.querySelectorAll('[data-gallery-image]').forEach((button) => button.classList.toggle('is-active', button === galleryButton));
      }
      return;
    }
    if (event.target.closest('[data-add-product]')) {
      const variant = document.querySelector('[data-variant].selected')?.dataset.variant;
      await store.addToCart({ productId: activeProduct.id, variant });
      await renderCart(); toggleCart(true);
      return toast(`${activeProduct.name} added to your cart.`);
    }

    const change = event.target.closest('[data-line-change]');
    if (change) {
      const { lines } = await store.getCart();
      const line = lines.find((item) => item.productId === change.dataset.product && item.variant === change.dataset.lineVariant);
      await store.updateCartLine({ productId: line.productId, variant: line.variant, quantity: line.quantity + Number(change.dataset.lineChange) });
      return renderCart();
    }

    if (event.target.closest('[data-open-checkout]')) {
      const { lines } = await store.getCart();
      if (!lines.length) return toast('Your cart is empty. Add a product first.');
      toggleCart(false);
      renderCheckoutSummary();
      return document.querySelector('[data-checkout-dialog]').showModal();
    }
  });

  document.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-checkout-form]')) {
      event.preventDefault();
      const form = new FormData(event.target); const submit = event.target.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = 'Opening payment page…';
      try {
        const result = await store.createCheckout({ customer: { name: form.get('name'), phone: form.get('phone'), deliveryPreference: form.get('deliveryPreference'), deliveryAddress: form.get('deliveryAddress'), deliveryZone: form.get('deliveryZone') || '' } });
        if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
        toast('Checkout is being connected. Your cart is saved on this device for now.');
      } catch (error) {
        // Our checkout function returns customer-ready messages (sold out, invalid phone…);
        // anything else (network, outage) gets a friendly fallback instead of e.g. "internal".
        const ours = typeof error?.code === 'string' && !['functions/internal', 'functions/unknown', 'functions/not-found'].includes(error.code);
        toast(ours && error.message ? error.message : 'We could not start payment right now. Please try again in a moment, or message us on WhatsApp.');
      } finally {
        submit.disabled = false; submit.textContent = 'Pay now';
      }
    }
    if (event.target.matches('[data-account-form]')) {
      event.preventDefault();
      const form = new FormData(event.target); const submit = event.target.querySelector('button[type="submit"]');
      const errorEl = document.querySelector('[data-account-error]'); errorEl.textContent = ''; submit.disabled = true; submit.textContent = 'Signing in…';
      try {
        await store.signIn({ email: form.get('email'), password: form.get('password') });
        document.querySelector('[data-account-dialog]').close(); event.target.reset();
        await refreshForAccount(); toast('Signed in — wholesale pricing applied.');
      } catch (error) {
        errorEl.textContent = error?.message || 'Could not sign in. Check your email and password.';
      } finally {
        submit.disabled = false; submit.textContent = 'Sign in';
      }
    }
  });
}

// ---- Init ------------------------------------------------------------

applyTheme();
renderShell();
addEventListener('resize', syncMobileNavOffset);
addEventListener('scroll', syncMobileNavOffset, { passive: true });
wireEvents();
renderAccount();
renderCart();
syncDeliveryAddressField(document.querySelector('[data-delivery-preference]'));
if (page === 'home') renderHome();
else if (page === 'shop') renderShop();
else if (page === 'product') renderProductPage();
else if (page === 'wholesale') renderWholesale();
else if (page === 'order') renderOrderPage();
else if (['privacy', 'terms', 'refunds', 'delivery'].includes(page)) renderPolicyPage();
