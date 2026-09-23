import { categories, editorialImages } from './data.js';
import { store } from './store.js';
import { money } from './components/templates.js';
import { updateSeo } from './seo.js';

const app = document.querySelector('#app');
const page = document.body.dataset.page;

// Replace with the real business WhatsApp number (digits only, country code,
// no leading +) before going live — this is a placeholder.
const WHATSAPP_NUMBER = '233200000000';
const waLink = (text) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

let activeProduct = null;
let activeCategory = 'all';
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
      <strong>From ${money(product.price)}</strong>
      <a class="underlined" href="/product?id=${product.id}">Choose length →</a>
    </div>
  </article>`;
}

// ---- Shared chrome (header, footer, cart, dialogs) -----------------------

function headerHtml() {
  const nav = [
    { href: '/', label: 'Home', key: 'home' },
    { href: '/shop', label: 'Shop', key: 'shop' },
    { href: '/wholesale', label: 'Wholesale', key: 'wholesale' },
  ];
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="Nakuadiary home"><img class="brand-mark" src="/assets/nakuadiary-logo.png" alt="" /><span>NAKUA<em>diary</em></span></a>
    <button class="menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav class="site-nav" id="site-nav">${nav.map((n) => `<a href="${n.href}" class="${page === n.key ? 'is-active' : ''}">${n.label}</a>`).join('')}</nav>
    <div class="header-actions">
      <div class="account-area" data-account-area></div>
      <button class="bag-button" type="button" data-open-cart aria-label="Open bag">Bag <span data-cart-count>0</span></button>
    </div>
  </header>`;
}

function footerHtml() {
  return `<footer class="site-footer">
    <a class="brand footer-brand" href="/" aria-label="Nakuadiary home"><img class="brand-mark" src="/assets/nakuadiary-logo.png" alt="" /><span>NAKUA<em>diary</em></span></a>
    <nav><a href="/shop">Shop</a><a href="/wholesale">Wholesale</a><a href="${waLink('Hi! I have a question about Nakuadiary.')}" target="_blank" rel="noopener">WhatsApp us</a></nav>
    <p>© ${new Date().getFullYear()} Nakuadiary · Wigs, bundles, extensions & accessories</p>
  </footer>`;
}

function chromeExtrasHtml() {
  return `<div class="overlay" hidden data-overlay></div>
  <aside class="cart" data-cart aria-hidden="true">
    <header><h2>Your bag</h2><button type="button" data-close-cart aria-label="Close bag">×</button></header>
    <div data-cart-lines></div>
    <footer>
      <p class="cart-total"><span>Subtotal</span><strong data-cart-total>${money(0)}</strong></p>
      <p class="delivery-note">Delivery arrangements are confirmed before your order is dispatched.</p>
      <button class="btn wide" type="button" data-open-checkout>Continue to checkout</button>
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
    </form>
  </dialog>
  <dialog class="checkout-dialog" data-checkout-dialog>
    <button class="dialog-close" type="button" data-close-checkout aria-label="Close checkout">×</button>
    <form data-checkout-form>
      <p class="eyebrow">Guest checkout</p>
      <h2>Your order <em>details</em></h2>
      <p class="checkout-intro">We use these details to prepare and confirm your order.</p>
      <label>Full name<input name="name" autocomplete="name" required /></label>
      <label>WhatsApp / phone number<input name="phone" inputmode="tel" autocomplete="tel" placeholder="e.g. 024 000 0000" required /></label>
      <label>Delivery preference<select name="deliveryPreference" required data-delivery-preference><option value="">Choose one</option><option>Delivery</option><option>Pickup</option></select></label>
      <label data-delivery-address-field>Town, area or landmark<textarea name="deliveryAddress" rows="2" placeholder="Tell us where to arrange your order" required></textarea></label>
      <p class="checkout-note">You will be taken to a secure payment page for Mobile Money or card payment.</p>
      <button class="btn wide" type="submit">Continue to payment</button>
    </form>
  </dialog>
  <div class="toast" data-toast aria-live="polite"></div>`;
}

function renderShell() {
  app.innerHTML = `${headerHtml()}<main id="main" data-main></main>${footerHtml()}${chromeExtrasHtml()}`;
}

// ---- Cart / account (shared across every page) ----------------------------

async function renderCart() {
  const { lines } = await store.getCart();
  const detailed = await Promise.all(lines.map(async (line) => ({ ...line, product: await store.getProduct(line.productId) })));
  const valid = detailed.filter((line) => line.product);
  const count = valid.reduce((total, line) => total + line.quantity, 0);
  const total = valid.reduce((sum, line) => sum + line.quantity * line.product.price, 0);
  document.querySelector('[data-cart-count]').textContent = count;
  document.querySelector('[data-cart-total]').textContent = money(total);
  document.querySelector('[data-cart-lines]').innerHTML = valid.length
    ? valid.map((line) => `<article class="cart-line"><img src="${line.product.image}" alt="" /><div><p>${productType(line.product)}</p><h3>${line.product.name}</h3><strong>${line.variant} · ${money(line.product.price)}</strong></div><div class="quantity"><button type="button" data-line-change="-1" data-product="${line.productId}" data-line-variant="${line.variant}" aria-label="Reduce quantity">−</button><span>${line.quantity}</span><button type="button" data-line-change="1" data-product="${line.productId}" data-line-variant="${line.variant}" aria-label="Increase quantity">+</button></div></article>`).join('')
    : '<p class="empty">Your bag is waiting for its first piece.</p>';
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

async function renderHome() {
  const main = document.querySelector('[data-main]');
  const featured = await store.listProducts({ featured: true });
  main.innerHTML = `
    <section class="hero">
      <div class="hero-blob b1"></div><div class="hero-blob b2"></div>
      <div class="hero-copy">
        <p class="eyebrow">Soft hair, softer prices</p>
        <h1>HAIR THAT<br>FEELS LIKE <em>you</em>.</h1>
        <p>Human hair wigs, bundles and extensions — retail and wholesale — with prices in Ghana cedis and a checkout that doesn't overcomplicate things.</p>
        <div class="hero-actions"><a class="btn" href="/shop">Shop the edit</a><a class="btn outline" href="/wholesale">Wholesale pricing</a></div>
      </div>
      <div class="hero-visual"><img src="${editorialImages.hero.url}" alt="${editorialImages.hero.alt}" /></div>
      <div class="hero-badges"><span>Prices in GHS</span><span>Guest checkout</span><span>MoMo & card checkout</span></div>
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">Start here</p><h2>What are you shopping for?</h2></div>
      <div class="category-grid">${categories.map((c) => `<a class="category-tile" href="/shop?category=${c.id}"><b>${c.label}</b><span>${c.detail}</span><i>Shop now →</i></a>`).join('')}</div>
    </section>
    <section class="section tint">
      <div class="section-head"><p class="eyebrow">Two ways to shop</p><h2>Retail &amp; wholesale, both welcome.</h2></div>
      <div class="paths">
        <div class="path-card"><p class="eyebrow">Retail</p><h3>Shopping for yourself?</h3><p>Browse the full collection, pick your length, and check out as a guest — no account needed.</p><a class="btn outline" href="/shop">Shop retail</a></div>
        <div class="path-card wholesale"><p class="eyebrow">Wholesale</p><h3>Buying in bulk?</h3><p>Salons, stylists and resellers get a dedicated price list and lower minimums once their account is set up.</p><a class="btn" href="/wholesale">See wholesale pricing</a></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">Best sellers</p><h2>A few favourites.</h2></div>
      <div class="product-grid">${featured.length ? featured.map(productCard).join('') : '<p class="empty-products">The edit is on its way.</p>'}</div>
    </section>
    <section class="section tint">
      <div class="section-head"><p class="eyebrow">Simple from phone to order</p><h2>Shop in three steps.</h2></div>
      <div class="steps">
        <div class="step"><span>01</span><h3>Choose your texture</h3><p>Wigs, bundles, extensions or accessories.</p></div>
        <div class="step"><span>02</span><h3>Select your length</h3><p>See the GHS price before you add it to your bag.</p></div>
        <div class="step"><span>03</span><h3>Check out as a guest</h3><p>Enter your delivery details, then pay by Mobile Money or card.</p></div>
      </div>
    </section>
    <section class="newsletter"><p class="eyebrow">The Nakuadiary list</p><h2>New textures, <em>good hair days.</em></h2><p>Be first to hear about new arrivals and restocks.</p><a class="btn" href="mailto:hello@example.com?subject=Nakuadiary%20private%20list">Join the private list</a></section>`;
}

// ---- Page: shop --------------------------------------------------------

async function renderShop() {
  const params = new URLSearchParams(location.search);
  activeCategory = params.get('category') || 'all';
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
    <div class="product-grid" data-products><p class="empty-products">Loading…</p></div>
  </section>`;
  shopItemsCache = await store.listProducts({});
  renderShopGrid();
}

function renderShopGrid() {
  const grid = document.querySelector('[data-products]');
  if (!grid) return;
  const term = shopSearchTerm;
  const filtered = shopItemsCache.filter((p) => (activeCategory === 'all' || p.category === activeCategory) && (!term || p.name.toLowerCase().includes(term)));
  grid.innerHTML = filtered.length ? filtered.map(productCard).join('') : '<p class="empty-products">No pieces found. Try another search or category.</p>';
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
  main.innerHTML = `<p class="breadcrumb"><a href="/shop">Shop</a> / ${activeProduct.name}</p>
  <div class="product-detail">
    <div class="product-gallery"><div class="product-detail-image"><img data-gallery-main src="${gallery[0].url}" alt="${gallery[0].alt || activeProduct.name}" /></div>${gallery.length > 1 ? `<div class="gallery-thumbnails" aria-label="Product photos">${gallery.map((image, index) => `<button type="button" data-gallery-image="${index}" class="${index === 0 ? 'is-active' : ''}" aria-label="Show photo ${index + 1}"><img src="${image.url}" alt="" /></button>`).join('')}</div>` : ''}</div>
    <div class="product-detail-copy">
      <p class="eyebrow">${productType(activeProduct)}</p>
      <h1>${activeProduct.name}</h1>
      <p class="dialog-price">${money(activeProduct.price)}</p>
      <p class="description">${activeProduct.description}</p>
      <ul>${productDetails(activeProduct).map((d) => `<li>${d}</li>`).join('')}</ul>
      <fieldset><legend>Choose your length</legend><div class="variant-options">${activeProduct.variants.map((v, i) => `<button type="button" data-variant="${v}" class="${i === 0 ? 'selected' : ''}">${v}</button>`).join('')}</div></fieldset>
      <button class="btn wide" type="button" data-add-product>Add to bag</button>
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
      <a class="btn whatsapp wide" href="${waLink("Hi! I'd like to apply for a Nakuadiary wholesale account.")}" target="_blank" rel="noopener">Message us on WhatsApp</a>
      <a class="btn outline wide" style="margin-top:.7rem" href="mailto:hello@example.com?subject=Wholesale%20enquiry">Email us instead</a>
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

// ---- Global event wiring ----------------------------------------------

function wireEvents() {
  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-delivery-preference]'); if (select) syncDeliveryAddressField(select);
  });
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-search]')) { shopSearchTerm = event.target.value.trim().toLowerCase(); renderShopGrid(); }
  });
  document.addEventListener('click', async (event) => {
    const menu = event.target.closest('[data-menu-button]');
    if (menu) { const header = document.querySelector('.site-header'); const open = header.classList.toggle('menu-open'); menu.setAttribute('aria-expanded', String(open)); return; }

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
      return renderShopGrid();
    }

    if (event.target.closest('[data-variant]')) return document.querySelectorAll('[data-variant]').forEach((b) => b.classList.toggle('selected', b === event.target));
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
      return toast(`${activeProduct.name} is in your bag.`);
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
      if (!lines.length) return toast('Add a piece to your bag before checking out.');
      toggleCart(false);
      return document.querySelector('[data-checkout-dialog]').showModal();
    }
  });

  document.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-checkout-form]')) {
      event.preventDefault();
      const form = new FormData(event.target); const submit = event.target.querySelector('button[type="submit"]');
      submit.disabled = true; submit.textContent = 'Starting secure payment…';
      try {
        const result = await store.createCheckout({ customer: { name: form.get('name'), phone: form.get('phone'), deliveryPreference: form.get('deliveryPreference'), deliveryAddress: form.get('deliveryAddress') } });
        if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
        toast('Checkout is being connected. Your bag is saved on this device for now.');
      } catch (error) {
        toast(error?.message || 'We could not start payment. Please try again.');
      } finally {
        submit.disabled = false; submit.textContent = 'Continue to payment';
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

renderShell();
wireEvents();
renderAccount();
renderCart();
syncDeliveryAddressField(document.querySelector('[data-delivery-preference]'));
if (page === 'home') renderHome();
else if (page === 'shop') renderShop();
else if (page === 'product') renderProductPage();
else if (page === 'wholesale') renderWholesale();
