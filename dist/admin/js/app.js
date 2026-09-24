import * as adminStore from './admin-store.js?v=2';
import { slugify, CATEGORIES } from './admin-store.js?v=2';
import { homepageViewHtml, settingsViewHtml, collectCmsForm, validateCms, setImageField } from './cms.js?v=2';
import { DEFAULT_HOME, DEFAULT_SETTINGS, escapeHtml as esc } from '/js/site-content.js?v=2';

const root = document.querySelector('#admin-app');
root.innerHTML = '<p class="muted" style="padding:2rem">Loading…</p>';
const money = (amount) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(amount || 0);
const formatDate = (ts) => {
  if (!ts) return '—';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

let session = null;
let currentView = 'products';
let productsCache = [];
let ordersCache = [];
let customersCache = [];
let orderStatusFilter = 'all';
// CMS editor state: the doc as last loaded/saved, whether the form has
// unsaved edits, and how many photo uploads are still in flight.
let cmsDoc = null;
let cmsDirty = false;
let cmsUploads = 0;

function toast(text) {
  const node = document.querySelector('[data-toast]');
  if (!node) return;
  node.textContent = text; node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2800);
}

// ---- Root / auth ---------------------------------------------------------

function renderRoot() {
  if (!session) {
    root.innerHTML = loginScreenHtml();
    wireLoginForm();
    return;
  }
  if (session.notConfigured) {
    root.innerHTML = `<div class="login-screen"><div class="login-card"><h1>Not connected</h1><p>Fill in <code>dist/js/firebase-config.js</code> with a real Firebase project to use the admin portal.</p></div></div>`;
    return;
  }
  if (!session.isAdmin) {
    root.innerHTML = `<div class="login-screen"><div class="login-card not-authorized"><a class="back-link" href="/">← Back to shop</a><h1>Not authorized</h1><p>${esc(session.user.email)} doesn't have admin access on this project.</p><button class="btn" type="button" data-sign-out>Sign out</button></div></div>`;
    return;
  }
  root.innerHTML = shellHtml();
  loadAndRenderView(currentView);
}

function loginScreenHtml() {
  return `<div class="login-screen"><div class="login-card">
    <a class="back-link" href="/">← Back to shop</a>
    <img class="admin-login-mark" src="/assets/nakuadiary-logo.png" alt="Nakuadiary" />
    <h1>Nakuadiary Admin</h1>
    <p>Sign in with your staff account.</p>
    <form data-login-form>
      <label>Email<input name="email" type="email" autocomplete="username" required /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      <p class="form-error" data-login-error></p>
      <button type="submit">Sign in</button>
      <button type="button" class="link-button forgot-link" data-admin-forgot>Forgot password?</button>
    </form>
  </div></div>`;
}

function wireLoginForm() {
  document.querySelector('[data-login-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errorEl = document.querySelector('[data-login-error]');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    errorEl.textContent = ''; submit.disabled = true; submit.textContent = 'Signing in…';
    try {
      await adminStore.signIn({ email: form.get('email'), password: form.get('password') });
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not sign in.';
      submit.disabled = false; submit.textContent = 'Sign in';
    }
  });
}

function shellHtml() {
  return `<div class="admin-shell">
    <aside class="admin-sidebar">
      <p class="brand"><img src="/assets/nakuadiary-logo.png" alt="Nakuadiary" /><span>NAKUADIARY<small>Admin</small></span></p>
      <nav class="admin-nav">
        <button type="button" data-view="products" class="${currentView === 'products' ? 'is-active' : ''}">Products</button>
        <button type="button" data-view="stock" class="${currentView === 'stock' ? 'is-active' : ''}">Stock</button>
        <button type="button" data-view="orders" class="${currentView === 'orders' ? 'is-active' : ''}">Orders</button>
        <button type="button" data-view="customers" class="${currentView === 'customers' ? 'is-active' : ''}">Customers</button>
        <span class="admin-nav-label">Website</span>
        <button type="button" data-view="homepage" class="${currentView === 'homepage' ? 'is-active' : ''}">Homepage</button>
        <button type="button" data-view="settings" class="${currentView === 'settings' ? 'is-active' : ''}">Settings</button>
        <button type="button" data-view="notifications" class="${currentView === 'notifications' ? 'is-active' : ''}">Notifications</button>
      </nav>
      <div class="signed-in-as">${esc(session.user.email)}<button type="button" data-sign-out>Sign out</button></div>
    </aside>
    <main class="admin-main" data-main></main>
  </div>
  <div class="overlay" hidden data-overlay></div>
  <div class="toast" data-toast></div>`;
}

async function loadAndRenderView(view) {
  currentView = view;
  cmsDirty = false; cmsDoc = null;
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
  const main = document.querySelector('[data-main]');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (view === 'products') { productsCache = await adminStore.listProducts(); main.innerHTML = productsViewHtml(); }
    if (view === 'notifications') { main.innerHTML = notificationsViewHtml(await adminStore.getSmsConfig()); }
    if (view === 'stock') { productsCache = await adminStore.listProducts(); main.innerHTML = stockViewHtml(); }
    if (view === 'orders') { ordersCache = await adminStore.listOrders(); main.innerHTML = ordersViewHtml(); }
    if (view === 'customers') { customersCache = await adminStore.listCustomers(); main.innerHTML = customersViewHtml(); }
    if (view === 'homepage') { cmsDoc = await adminStore.getSiteDoc('home', DEFAULT_HOME); main.innerHTML = homepageViewHtml(cmsDoc); wireCmsForm(); }
    if (view === 'settings') { cmsDoc = await adminStore.getSiteDoc('settings', DEFAULT_SETTINGS); main.innerHTML = settingsViewHtml(cmsDoc); wireCmsForm(); }
  } catch (err) {
    main.innerHTML = `<p class="form-error">Could not load ${view}: ${esc(err?.message || err)}</p>`;
  }
}

// ---- Products --------------------------------------------------------

function totalStock(product) { return (product.variants || []).reduce((sum, v) => sum + (v.stock || 0), 0); }

function productsViewHtml() {
  return `<div class="view-head"><div><h1>Products</h1><p>${productsCache.length} products</p></div><button class="btn" type="button" data-new-product>+ Add product</button></div>
  ${productsCache.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Category</th><th>Retail</th><th>Wholesale</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>${productsCache.map(productRow).join('')}</tbody></table>` : '<p class="empty-state">No products yet. Add your first one.</p>'}`;
}
// ---- Tags (texture/style filters on the shop page) -----------------------------

const SUGGESTED_TAGS = ['Straight', 'Body wave', 'Loose wave', 'Deep wave', 'Water wave', 'Curly', 'Kinky straight', 'HD lace', 'Transparent lace', 'Glueless', 'Closure', 'Frontal', 'Clip-in', 'Tape-in'];

/** Trims, caps length/count, and removes case-insensitive duplicates ("body wave" = "Body Wave"). */
function parseTags(raw) {
  const tags = [];
  String(raw || '').split(',').map((t) => t.trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean)
    .forEach((tag) => { if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag); });
  return tags.slice(0, 8);
}

/** Tags already used on other products first (keeps spelling consistent), then common hair styles. */
function tagSuggestionsHtml(current) {
  const used = [];
  [...productsCache.flatMap((p) => p.tags || []), ...SUGGESTED_TAGS].forEach((tag) => { if (!used.some((t) => t.toLowerCase() === tag.toLowerCase())) used.push(tag); });
  const available = used.filter((tag) => !current.some((t) => t.toLowerCase() === tag.toLowerCase())).slice(0, 16);
  return available.map((tag) => `<button type="button" data-add-tag="${esc(tag)}">+ ${esc(tag)}</button>`).join('');
}

function productRow(p) {
  const stockTotal = totalStock(p);
  return `<tr><td>${esc(p.name)}${p.tags?.length ? `<br><small class="muted">${esc(p.tags.join(' · '))}</small>` : ''}</td><td class="muted">${esc(p.category)}</td><td>${money(p.price)}</td><td>${typeof p.wholesalePrice === 'number' ? money(p.wholesalePrice) : '—'}</td><td class="${stockTotal <= 5 ? 'low-stock' : ''}">${esc(stockTotal)} <button type="button" class="link-button" data-open-stock="${esc(p.id)}">Update</button></td><td><span class="badge ${p.active !== false ? 'status-paid' : 'status-inactive'}">${p.active !== false ? 'Active' : 'Inactive'}</span></td><td><button class="btn secondary" type="button" data-edit-product="${esc(p.id)}">Edit</button></td></tr>`;
}

function variantRowHtml(v = {}) {
  return `<div class="variant-row">
    <button type="button" class="remove-variant" data-remove-variant>Remove</button>
    <input type="hidden" data-field="id" value="${esc(v.id)}" />
    <div class="field-row">
      <label class="field">Label<input data-field="label" value="${esc(v.label)}" required /></label>
      <label class="field">Stock<input data-field="stock" type="number" min="0" value="${esc(v.stock ?? 0)}" required /></label>
    </div>
    <div class="field-row">
      <label class="field">Retail price override<input data-field="price" type="number" min="0" step="0.01" value="${esc(v.price)}" placeholder="Uses product price" /></label>
      <label class="field">Wholesale price override<input data-field="wholesalePrice" type="number" min="0" step="0.01" value="${esc(v.wholesalePrice)}" placeholder="Uses product wholesale price" /></label>
    </div>
    <label class="field checkbox"><input data-field="available" type="checkbox" ${v.available !== false ? 'checked' : ''} /> Available</label>
  </div>`;
}

function normaliseImages(product = {}) {
  const list = Array.isArray(product.images) && product.images.length ? product.images : (product.image?.url ? [product.image] : []);
  return list.filter((image) => image?.url).map((image) => ({ url: image.url, alt: image.alt || product.name || 'Product photo', focalPoint: image.focalPoint || { x: 50, y: 50 } }));
}

function galleryEditorHtml(images) {
  return `<div class="image-editor" data-image-editor>${images.length ? images.map((image, index) => `<article class="image-editor-card"><img src="${esc(image.url)}" alt="${esc(image.alt)}" /><div><strong>${index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</strong><button type="button" data-remove-image="${index}">Remove</button></div></article>`).join('') : '<p class="muted image-empty">Add at least one photo. The first one becomes the shop cover.</p>'}</div>`;
}

function productDrawerHtml(product, isNew) {
  const p = product || {};
  const images = normaliseImages(p);
  return `<div class="drawer" data-product-drawer>
    <div class="drawer-head"><h2>${isNew ? 'Add product' : 'Edit product'}</h2><button type="button" data-close-product aria-label="Close">×</button></div>
    <form data-product-form>
      <label class="field">Name<input name="name" value="${esc(p.name)}" required /></label>
      ${!isNew ? `<p class="muted" style="margin:-.5rem 0 1rem">ID: ${esc(p.id)}</p>` : ''}
      <div class="field-row">
        <label class="field">Category<select name="category" required>${CATEGORIES.map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field">Type<input name="type" value="${esc(p.type)}" placeholder="e.g. HD lace wig" /></label>
      </div>
      <div class="field-row">
        <label class="field">Retail price (GHS)<input name="price" type="number" min="0" step="0.01" value="${esc(p.price)}" required /></label>
        <label class="field">Wholesale price (GHS)<input name="wholesalePrice" type="number" min="0" step="0.01" value="${esc(p.wholesalePrice)}" placeholder="Optional" /></label>
      </div>
      <label class="field">Minimum wholesale quantity<input name="minWholesaleQty" type="number" min="1" value="${esc(p.minWholesaleQty ?? 1)}" /></label>
      <label class="field">Description<textarea name="description" rows="2" required>${esc(p.description)}</textarea></label>
      <label class="field">Details (one per line)<textarea name="details" rows="3">${esc((p.details || []).join('\n'))}</textarea></label>
      <fieldset class="product-images"><legend>Product photos</legend>
        <p class="muted image-help">Upload straight from your phone or computer — large photos are resized automatically. The first photo is the cover shoppers see in the collection.</p>
        ${galleryEditorHtml(images)}
        <label class="field">Photo description (optional)<input data-image-alt placeholder="e.g. 22-inch deep-curly wig, front view" /></label>
        <label class="image-upload"><span>Upload from phone or computer</span><input type="file" data-product-image-upload accept="image/*" /><small data-image-upload-status></small></label>
        <div class="image-url-row"><input type="url" data-product-image-url placeholder="Or paste an image URL" /><button type="button" class="btn secondary" data-add-image-url>Add photo</button></div>
      </fieldset>
      <label class="field">Texture / style tags<input name="tags" value="${esc((p.tags || []).join(', '))}" placeholder="e.g. Body wave, HD lace" data-tags-input /><small class="field-hint">Comma separated. Shoppers can filter the shop by these. Tap to add:</small></label>
      <div class="tag-suggestions" data-tag-suggestions>${tagSuggestionsHtml(p.tags || [])}</div>
      <label class="field">Badges (comma separated)<input name="badges" value="${esc((p.badges || []).join(', '))}" /></label>
      <div class="field-row">
        <label class="field checkbox"><input name="featured" type="checkbox" ${p.featured ? 'checked' : ''} /> Featured</label>
        <label class="field checkbox"><input name="active" type="checkbox" ${p.active !== false ? 'checked' : ''} /> Active (visible to shoppers)</label>
      </div>
      <label class="field">Inventory policy<select name="inventoryPolicy"><option value="deny" ${p.inventoryPolicy !== 'continue' ? 'selected' : ''}>Deny sale at 0 stock</option><option value="continue" ${p.inventoryPolicy === 'continue' ? 'selected' : ''}>Allow backorder</option></select></label>
      <fieldset><legend>Variants (lengths / options)</legend><div data-variant-rows>${(p.variants && p.variants.length ? p.variants : [{}]).map(variantRowHtml).join('')}</div><button type="button" class="add-variant" data-add-variant>+ Add variant</button></fieldset>
      <p class="form-error" data-product-error></p>
      <div class="status-actions">
        <button class="btn" type="submit">${isNew ? 'Create product' : 'Save changes'}</button>
        ${!isNew ? `<button type="button" class="btn secondary" data-toggle-active="${esc(p.id)}">${p.active !== false ? 'Deactivate' : 'Reactivate'}</button>` : ''}
      </div>
    </form>
  </div>`;
}

function openDrawer(html) {
  document.querySelector('[data-overlay]').hidden = false;
  document.body.insertAdjacentHTML('beforeend', html);
}
function closeDrawer(selector) {
  document.querySelector('[data-overlay]').hidden = true;
  document.querySelector(selector)?.remove();
}

function openProductDrawer(product, isNew) {
  openDrawer(productDrawerHtml(product, isNew));
  const form = document.querySelector('[data-product-form]');
  let images = normaliseImages(product);
  const renderImages = () => { form.querySelector('[data-image-editor]').outerHTML = galleryEditorHtml(images); };
  form.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-image]');
    if (!remove) return;
    images.splice(Number(remove.dataset.removeImage), 1);
    renderImages();
  });
  form.querySelector('[data-add-image-url]').addEventListener('click', () => {
    const urlInput = form.querySelector('[data-product-image-url]');
    const url = urlInput.value.trim();
    if (!url) return;
    try { new URL(url); } catch { return toast('Enter a valid image URL.'); }
    images.push({ url, alt: form.querySelector('[data-image-alt]').value.trim() || form.elements.name.value.trim() || 'Product photo', focalPoint: { x: 50, y: 50 } });
    urlInput.value = ''; renderImages();
  });
  form.querySelector('[data-product-image-upload]').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const status = form.querySelector('[data-image-upload-status]');
    status.textContent = 'Uploading photo…'; event.target.disabled = true;
    try {
      const name = form.elements.name.value.trim();
      const productId = product?.id || slugify(name) || 'nakuadiary-product';
      const url = await adminStore.uploadProductImage({ file, productId });
      images.push({ url, alt: form.querySelector('[data-image-alt]').value.trim() || name || 'Product photo', focalPoint: { x: 50, y: 50 } });
      status.textContent = 'Photo uploaded.'; renderImages();
    } catch (err) {
      status.textContent = err?.message || 'Upload failed.';
    } finally {
      event.target.value = ''; event.target.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = document.querySelector('[data-product-error]');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    errorEl.textContent = ''; submit.disabled = true;
    try {
      const collected = collectProductForm(event.currentTarget, product, isNew, images);
      await adminStore.saveProduct(collected, { isNew, original: product });
      closeDrawer('[data-product-drawer]');
      toast(isNew ? 'Product created.' : 'Product saved.');
      await loadAndRenderView('products');
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not save this product.';
      submit.disabled = false;
    }
  });
}

function collectProductForm(form, existing, isNew, images) {
  const fd = new FormData(form);
  const variants = [...form.querySelectorAll('.variant-row')].map((row) => {
    const get = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
    const label = get('label');
    const priceRaw = get('price'); const wholesaleRaw = get('wholesalePrice');
    return {
      id: get('id') || slugify(label),
      label,
      available: row.querySelector('[data-field="available"]').checked,
      stock: Number(get('stock')) || 0,
      price: priceRaw ? Number(priceRaw) : null,
      wholesalePrice: wholesaleRaw ? Number(wholesaleRaw) : null,
    };
  }).filter((v) => v.label);

  if (!images.length) throw new Error('Add at least one product photo before saving.');
  const cleanImages = images.map((image) => ({ url: image.url, alt: image.alt || fd.get('name').trim(), focalPoint: image.focalPoint || { x: 50, y: 50 } }));
  return {
    ...(isNew ? {} : existing),
    name: fd.get('name').trim(),
    category: fd.get('category'),
    type: fd.get('type').trim(),
    price: Number(fd.get('price')),
    wholesalePrice: fd.get('wholesalePrice').trim() ? Number(fd.get('wholesalePrice')) : null,
    minWholesaleQty: Number(fd.get('minWholesaleQty')) || 1,
    currency: 'GHS',
    description: fd.get('description').trim(),
    details: fd.get('details').split('\n').map((s) => s.trim()).filter(Boolean),
    image: cleanImages[0],
    images: cleanImages,
    badges: fd.get('badges').split(',').map((s) => s.trim()).filter(Boolean),
    tags: parseTags(fd.get('tags')),
    featured: fd.has('featured'),
    active: fd.has('active'),
    inventoryPolicy: fd.get('inventoryPolicy'),
    variants,
    slug: isNew ? slugify(fd.get('name').trim()) : (existing?.slug || slugify(fd.get('name').trim())),
  };
}

// ---- Stock (quick adjust) ----------------------------------------------------
// One screen to top up or correct stock without opening the product form.
// Every change is a server-side transaction applied to the latest count, so
// it can't undo stock that checkouts reserved in the meantime.

let stockSearch = '';
let stockLowOnly = false;
const LOW_STOCK = 3;

function stockLevelClass(stock) { return stock <= 0 ? 'is-out' : stock <= LOW_STOCK ? 'is-low' : ''; }

function stockViewHtml() {
  const term = stockSearch.trim().toLowerCase();
  const products = [...productsCache]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .filter((p) => !term || String(p.name).toLowerCase().includes(term))
    .filter((p) => !stockLowOnly || (p.variants || []).some((v) => (Number(v.stock) || 0) <= LOW_STOCK));
  const lowCount = productsCache.reduce((n, p) => n + (p.variants || []).filter((v) => (Number(v.stock) || 0) <= LOW_STOCK).length, 0);
  return `<div class="view-head"><div><h1>Stock</h1><p>Tap + when new stock arrives, or type the exact count after a stock take.${lowCount ? ` <strong class="needs-attention">${lowCount} running low</strong>` : ''}</p></div></div>
  <div class="stock-toolbar">
    <input type="search" class="stock-search" placeholder="Search products…" value="${esc(stockSearch)}" data-stock-search />
    <label class="field checkbox"><input type="checkbox" data-stock-low ${stockLowOnly ? 'checked' : ''} /> Low stock only</label>
  </div>
  ${products.length ? `<div class="stock-list">${products.map(stockCardHtml).join('')}</div>` : '<p class="empty-state">No products match.</p>'}`;
}

function stockCardHtml(p) {
  const cover = (Array.isArray(p.images) && p.images[0]?.url) || p.image?.url || '';
  return `<article class="stock-card" data-stock-product="${esc(p.id)}">
    <header>${cover ? `<img src="${esc(cover)}" alt="" />` : '<span class="stock-thumb"></span>'}<div><strong>${esc(p.name)}</strong><small>${esc(p.category)}${p.active === false ? ' · hidden from shop' : ''}</small></div></header>
    ${(p.variants || []).map((v) => stockRowHtml(p, v)).join('') || '<p class="muted">No lengths/options yet — add them in Products.</p>'}
  </article>`;
}

function stockRowHtml(p, v) {
  const stock = Number(v.stock) || 0;
  const key = `${esc(p.id)}|${esc(v.id)}`;
  return `<div class="stock-row" data-stock-row="${key}">
    <span class="stock-label">${esc(v.label)}${v.available === false ? ' <small>(unavailable)</small>' : ''}</span>
    <span class="stock-count ${stockLevelClass(stock)}" data-stock-count>${stock <= 0 ? 'Sold out' : `${esc(stock)} in stock`}</span>
    <span class="stock-buttons">
      <button type="button" data-stock-adjust="-1" aria-label="Remove one ${esc(v.label)}" ${stock <= 0 ? 'disabled' : ''}>−</button>
      <button type="button" data-stock-adjust="1" aria-label="Add one ${esc(v.label)}">+1</button>
      <button type="button" data-stock-adjust="5">+5</button>
      <button type="button" data-stock-adjust="10">+10</button>
    </span>
    <form class="stock-set" data-stock-set><input type="number" min="0" max="100000" inputmode="numeric" placeholder="Set to…" aria-label="Set exact stock for ${esc(v.label)}" /><button type="submit">Set</button></form>
  </div>`;
}

async function applyStockChange(row, change) {
  const [productId, variantId] = row.dataset.stockRow.split('|');
  row.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
  try {
    const stock = await adminStore.changeVariantStock({ productId, variantId, ...change });
    const product = productsCache.find((p) => p.id === productId);
    const variant = product?.variants?.find((v) => v.id === variantId);
    if (variant) variant.stock = stock;
    row.outerHTML = stockRowHtml(product, variant);
    toast(`${product.name} · ${variant.label}: ${stock} in stock`);
  } catch (err) {
    toast(err?.message || 'Could not update stock.');
    row.querySelectorAll('button, input').forEach((el) => { el.disabled = false; });
  }
}

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-stock-search]')) {
    stockSearch = event.target.value;
    const caret = event.target.selectionStart;
    document.querySelector('[data-main]').innerHTML = stockViewHtml();
    const input = document.querySelector('[data-stock-search]'); input.focus(); input.setSelectionRange(caret, caret);
  }
});
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-stock-low]')) { stockLowOnly = event.target.checked; document.querySelector('[data-main]').innerHTML = stockViewHtml(); }
});
document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-stock-set]');
  if (!form) return;
  event.preventDefault();
  const value = form.querySelector('input').value.trim();
  if (!/^\d+$/.test(value)) return toast('Enter a whole number, 0 or more.');
  applyStockChange(form.closest('[data-stock-row]'), { set: Number(value) });
});

// ---- Orders --------------------------------------------------------

// Mirrors functions/src/orders.js — the server enforces it; this only decides which buttons to show.
const ADMIN_NEXT_STATUS = {
  pending_payment: ['cancelled'], paid: ['processing', 'cancelled'], processing: ['dispatched', 'delivered', 'cancelled'],
  dispatched: ['delivered', 'cancelled'], delivered: [], cancelled: [], failed: [],
};
const STATUS_LABEL = { pending_payment: 'Awaiting payment', paid: 'Paid', processing: 'Processing', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled', failed: 'Payment failed' };
const ACTION_LABEL = { processing: 'Start processing', dispatched: 'Mark dispatched', delivered: 'Mark delivered', cancelled: 'Cancel order' };
const STATUS_FILTERS = ['all', 'paid', 'processing', 'dispatched', 'delivered', 'pending_payment', 'cancelled', 'failed'];
const SMS_LABEL = { queued: 'Queued', sending: 'Sending…', sent: 'Sent', failed: 'Failed', skipped: 'Not sent (SMS off)', unknown: 'Unconfirmed' };

/** Orders written before the `status` field existed. */
function orderStatus(o) {
  if (STATUS_LABEL[o.status]) return o.status;
  if (o.fulfillmentStatus === 'fulfilled') return 'delivered';
  if (o.fulfillmentStatus === 'processing') return 'processing';
  if (o.fulfillmentStatus === 'cancelled') return o.paymentStatus === 'failed' ? 'failed' : 'cancelled';
  if (o.paymentStatus === 'paid') return 'paid';
  if (o.paymentStatus === 'failed') return 'failed';
  return 'pending_payment';
}
const statusBadge = (status) => `<span class="badge status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
const orderRef = (o) => o.reference || o.id.slice(0, 8);
const toDate = (value) => (value && typeof value.toDate === 'function' ? value.toDate() : value ? new Date(value) : null);
const formatDateTime = (value) => toDate(value)?.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) || '';
function actorLabel(actor, legacySource) {
  if (!actor) return legacySource || 'system';
  if (actor.type === 'admin') return actor.uid && actor.uid === session?.user?.uid ? 'You' : `Admin ${esc(String(actor.uid || '').slice(0, 6))}`;
  return actor.type === 'paystack' ? 'Paystack' : 'System';
}

function ordersViewHtml() {
  const filtered = orderStatusFilter === 'all' ? ordersCache : ordersCache.filter((o) => orderStatus(o) === orderStatusFilter);
  const attention = ordersCache.filter((o) => o.refund?.required && o.refund?.status !== 'done' || o.stockIssue || o.payment?.mismatch).length;
  return `<div class="view-head"><div><h1>Orders</h1><p>${ordersCache.length} orders${attention ? ` · <strong class="needs-attention">${attention} need attention</strong>` : ''}</p></div></div>
  <div class="filters">${STATUS_FILTERS.map((s) => `<button type="button" data-order-filter="${s}" class="${orderStatusFilter === s ? 'is-active' : ''}">${s === 'all' ? 'All' : esc(STATUS_LABEL[s])}</button>`).join('')}</div>
  ${filtered.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Account</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map(orderRow).join('')}</tbody></table>` : '<p class="empty-state">No orders in this view.</p>'}`;
}
function orderRow(o) {
  const flags = [o.refund?.required && o.refund?.status !== 'done' ? '<span class="badge status-refund">Refund due</span>' : '', o.stockIssue ? '<span class="badge status-failed">Stock issue</span>' : '', o.payment?.mismatch ? '<span class="badge status-failed">Amount mismatch</span>' : ''].join(' ');
  return `<tr><td><strong>${esc(orderRef(o))}</strong></td><td class="muted">${formatDate(o.createdAt)}</td><td>${esc(o.customer?.name || '—')}<br><span class="muted">${esc(o.customer?.phone)}</span></td><td><span class="badge account-${esc(o.accountType)}">${esc(o.accountType)}</span></td><td>${money(o.total ?? o.subtotal)}</td><td>${statusBadge(orderStatus(o))} ${flags}</td><td><button class="btn secondary" type="button" data-view-order="${esc(o.id)}">View</button></td></tr>`;
}

function orderAlertsHtml(order) {
  const alerts = [];
  if (order.refund?.required && order.refund?.status !== 'done') alerts.push(`<strong>Refund due.</strong> This order was paid and then cancelled (${esc(order.refund.reason || 'cancelled')}). Refund ${money(order.payment?.amount ?? order.total)} to the customer from your Paystack dashboard using reference <code>${esc(order.payment?.reference || order.id)}</code>.`);
  if (order.stockIssue) alerts.push('<strong>Stock issue.</strong> Payment arrived after the 60-minute hold expired and there wasn’t enough stock left. Restock, or cancel and refund.');
  if (order.payment?.mismatch) alerts.push(`<strong>Payment amount mismatch.</strong> Paystack reported ${money((order.payment.mismatch.amountMinor || 0) / 100)} ${esc(order.payment.mismatch.currency)}, expected ${money((order.payment.mismatch.expectedMinor || 0) / 100)}. The order was not marked paid — check Paystack.`);
  return alerts.map((text) => `<div class="order-alert">${text}</div>`).join('');
}

function smsHtml(messages) {
  if (!messages) return '<p class="muted">Loading…</p>';
  if (!messages.length) return '<p class="muted">No customer texts for this order yet.</p>';
  return `<ul class="sms-list">${messages.map((m) => `<li><span><strong>${esc(STATUS_LABEL[m.status] || m.status)}</strong> text to ${esc(m.to || 'customer')}</span><span class="sms-state sms-${esc(m.state)}">${esc(SMS_LABEL[m.state] || m.state)}${m.error?.message ? ` — ${esc(m.error.message)}` : ''}</span>${['failed', 'skipped', 'unknown', 'sending', 'sent'].includes(m.state) ? `<button type="button" class="link-button" data-resend-sms="${esc(m.status)}" data-sms-state="${esc(m.state)}">${m.state === 'sent' ? 'Send again' : 'Resend'}</button>` : ''}</li>`).join('')}</ul>`;
}

function orderDrawerHtml(order) {
  const status = orderStatus(order);
  const allowedNext = ADMIN_NEXT_STATUS[status] || [];
  const payment = order.payment || { provider: 'paystack', reference: order.id, status: order.paymentStatus };
  const history = order.statusHistory?.length ? order.statusHistory : [{ status }];
  const c = order.customer || {};
  return `<div class="drawer" data-order-drawer>
    <div class="drawer-head"><h2>Order ${esc(orderRef(order))}</h2><button type="button" data-close-order aria-label="Close">×</button></div>
    <p>${statusBadge(status)} <span class="badge account-${esc(order.accountType)}">${esc(order.accountType)}</span></p>
    <p class="muted">Placed ${formatDateTime(order.createdAt)}</p>
    ${orderAlertsHtml(order)}
    <fieldset><legend>Customer & delivery</legend><dl class="order-payment"><div><dt>Name</dt><dd>${esc(c.name)}</dd></div><div><dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd></div><div><dt>Method</dt><dd>${esc(c.deliveryPreference)}</dd></div>${c.deliveryAddress ? `<div><dt>Address / landmark</dt><dd>${esc(c.deliveryAddress)}</dd></div>` : ''}</dl></fieldset>
    <fieldset><legend>Payment confirmation</legend><dl class="order-payment"><div><dt>Provider</dt><dd>${esc(payment.provider || 'paystack')}</dd></div><div><dt>Paystack reference</dt><dd>${esc(payment.reference || order.id)}</dd></div><div><dt>Status</dt><dd>${esc(payment.status || order.paymentStatus)}</dd></div>${payment.amount != null ? `<div><dt>Amount received</dt><dd>${money(payment.amount)}</dd></div>` : ''}${payment.channel ? `<div><dt>Method</dt><dd>${esc(payment.channel.replace('_', ' '))}</dd></div>` : ''}${payment.transactionId ? `<div><dt>Transaction ID</dt><dd>${esc(payment.transactionId)}</dd></div>` : ''}${payment.paidAt ? `<div><dt>Paid at</dt><dd>${formatDateTime(payment.paidAt)}</dd></div>` : ''}</dl></fieldset>
    <fieldset><legend>Items</legend><div class="order-lines">${(order.lines || []).map((l) => `<div class="order-line-item">${l.image ? `<img src="${esc(l.image)}" alt="" />` : ''}<span>${esc(l.productName || l.title)}${l.variantLabel ? `<small>${esc(l.variantLabel)}</small>` : ''}<small>${esc(l.quantity)} × ${money(l.unitPrice)}</small></span><strong>${money(l.lineTotal ?? l.unitPrice * l.quantity)}</strong></div>`).join('')}${order.delivery ? `<div><span>Subtotal</span><span>${money(order.subtotal)}</span></div><div><span>Delivery${order.delivery.zone ? ` — ${esc(order.delivery.zone)}` : ''}</span><span>${order.delivery.status === 'arranged' ? 'To arrange with customer' : order.delivery.status === 'pickup' ? 'Pickup' : money(order.deliveryFee || 0)}</span></div>` : ''}<div><strong>Total</strong><strong>${money(order.total ?? order.subtotal)}</strong></div></div></fieldset>
    <fieldset><legend>Order timeline</legend><ol class="order-timeline">${history.map((entry) => `<li><strong>${esc(STATUS_LABEL[entry.status] || entry.status)}</strong><span>${formatDateTime(entry.at)} · ${actorLabel(entry.actor, esc(entry.source))}${entry.note ? ` · ${esc(entry.note.replace(/_/g, ' '))}` : ''}</span></li>`).join('')}</ol></fieldset>
    <fieldset><legend>Customer texts (SMS)</legend><div data-order-sms>${smsHtml(null)}</div></fieldset>
    ${allowedNext.length ? `<label class="field">Note for the timeline (optional)<input data-status-note maxlength="200" placeholder="e.g. Rider: Kwame, 024…" /></label><div class="status-actions">${allowedNext.map((s) => `<button class="btn ${s === 'cancelled' ? 'danger' : ''}" type="button" data-set-status="${s}">${ACTION_LABEL[s]}</button>`).join('')}</div>` : '<p class="muted">No further status changes available.</p>'}
    <p class="form-error" data-order-error></p>
  </div>`;
}

function openOrderDrawer(order) {
  openDrawer(orderDrawerHtml(order));
  const drawer = document.querySelector('[data-order-drawer]');
  const loadSms = async () => {
    try { drawer.querySelector('[data-order-sms]').innerHTML = smsHtml(await adminStore.listOrderSms(order.id)); } catch { drawer.querySelector('[data-order-sms]').innerHTML = '<p class="muted">Could not load texts.</p>'; }
  };
  loadSms();
  drawer.addEventListener('click', async (event) => {
    const errorEl = drawer.querySelector('[data-order-error]');
    const resend = event.target.closest('[data-resend-sms]');
    if (resend) {
      const risky = ['sent', 'unknown', 'sending'].includes(resend.dataset.smsState);
      if (risky && !window.confirm('This text may already have reached the customer. Send it again anyway?')) return;
      resend.disabled = true;
      try { await adminStore.resendOrderSms({ orderId: order.id, status: resend.dataset.resendSms, force: risky }); toast('Text queued.'); setTimeout(loadSms, 2500); } catch (err) { errorEl.textContent = err?.message || 'Could not resend.'; resend.disabled = false; }
      return;
    }
    const button = event.target.closest('[data-set-status]');
    if (!button) return;
    const status = button.dataset.setStatus;
    const wasPaid = order.paymentStatus === 'paid' || order.payment?.status === 'paid';
    if (status === 'cancelled' && !window.confirm(wasPaid ? 'Cancel this paid order? Stock will be returned and the order flagged for a refund, which you issue in Paystack.' : 'Cancel this order and return its stock?')) return;
    drawer.querySelectorAll('[data-set-status]').forEach((b) => { b.disabled = true; });
    try {
      await adminStore.updateOrderStatus({ orderId: order.id, status, note: drawer.querySelector('[data-status-note]')?.value || '' });
      closeDrawer('[data-order-drawer]');
      toast(`Order ${orderRef(order)}: ${STATUS_LABEL[status]}.`);
      await loadAndRenderView('orders');
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not update this order.';
      drawer.querySelectorAll('[data-set-status]').forEach((b) => { b.disabled = false; });
    }
  });
}

// ---- Customers -----------------------------------------------------------

function customersViewHtml() {
  return `<div class="view-head"><div><h1>Customers</h1><p>${customersCache.length} customers</p></div><button class="btn" type="button" data-new-wholesale>+ Create wholesale account</button></div>
  ${customersCache.length ? `<table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Account</th><th>Orders</th><th>Total spent</th></tr></thead><tbody>${customersCache.map(customerRow).join('')}</tbody></table>` : '<p class="empty-state">No customers yet.</p>'}`;
}
function customerRow(c) {
  return `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td class="muted">${esc(c.email || '—')}</td><td><span class="badge account-${esc(c.accountType)}">${esc(c.accountType)}</span></td><td>${esc(c.orderCount || 0)}</td><td>${money(c.totalSpent)}</td></tr>`;
}

function wholesaleDrawerHtml() {
  return `<div class="drawer" data-wholesale-drawer>
    <div class="drawer-head"><h2>Create wholesale account</h2><button type="button" data-close-wholesale aria-label="Close">×</button></div>
    <form data-wholesale-form>
      <label class="field">Business / contact name<input name="name" required /></label>
      <label class="field">Phone<input name="phone" inputmode="tel" required /></label>
      <label class="field">Email<input name="email" type="email" required /></label>
      <p class="form-error" data-wholesale-error></p>
      <button class="btn" type="submit">Create account</button>
    </form>
    <div data-wholesale-result></div>
  </div>`;
}

function openWholesaleDrawer() {
  openDrawer(wholesaleDrawerHtml());
  document.querySelector('[data-wholesale-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errorEl = document.querySelector('[data-wholesale-error]');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    errorEl.textContent = ''; submit.disabled = true;
    try {
      const result = await adminStore.createWholesaleAccount({ name: form.get('name'), phone: form.get('phone'), email: form.get('email') });
      event.currentTarget.hidden = true;
      document.querySelector('[data-wholesale-result]').innerHTML = `<div class="temp-password">Temporary password — share this with the customer directly (WhatsApp/SMS). It will not be shown again. They can set their own with “Forgot password?” on the shop’s sign-in.<code>${esc(result.temporaryPassword)}</code></div>`;
      toast('Wholesale account created.');
      customersCache = await adminStore.listCustomers();
      if (currentView === 'customers') document.querySelector('[data-main]').innerHTML = customersViewHtml();
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not create this account.';
      submit.disabled = false;
    }
  });
}

// ---- Website (Homepage + Settings CMS) ---------------------------------------

function setCmsDirty(dirty) {
  cmsDirty = dirty;
  const state = document.querySelector('[data-cms-state]');
  if (!state) return;
  state.textContent = cmsUploads ? 'Uploading photo…' : dirty ? 'Unsaved changes' : 'All changes saved';
  state.classList.toggle('is-dirty', dirty || cmsUploads > 0);
}

function wireCmsForm() {
  const form = document.querySelector('[data-cms-form]');
  const kind = form.dataset.cmsForm;
  setCmsDirty(false);

  form.addEventListener('input', (event) => {
    if (event.target.type === 'file') return;
    if (event.target.type === 'color') event.target.closest('.colour-field').querySelector('[data-colour-value]').textContent = event.target.value;
    setCmsDirty(true);
  });
  form.addEventListener('change', (event) => { if (event.target.dataset.kind === 'bool') setCmsDirty(true); });

  form.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-cms-clear]');
    if (clear) {
      const container = clear.closest('[data-cms-image]');
      setImageField(container, container.dataset.defaultUrl || '');
      container.querySelector('[data-cms-status]').textContent = container.dataset.defaultUrl ? 'Using the default photo.' : 'Photo removed.';
      return setCmsDirty(true);
    }
    const resetColour = event.target.closest('[data-colour-reset]');
    if (resetColour) {
      const input = resetColour.closest('.colour-field').querySelector('input[type="color"]');
      input.value = resetColour.dataset.colourReset;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  form.addEventListener('change', async (event) => {
    const video = event.target.closest('[data-cms-video-upload]');
    if (!video?.files?.[0]) return;
    const status = form.querySelector('[data-cms-video-status]');
    status.textContent = 'Uploading video…'; video.disabled = true; cmsUploads += 1; setCmsDirty(cmsDirty);
    try {
      form.elements['hero.videoUrl'].value = await adminStore.uploadSiteVideo({ file: video.files[0] });
      status.textContent = 'Uploaded — save to publish.';
      cmsUploads -= 1; setCmsDirty(true);
    } catch (err) {
      status.textContent = err?.message || 'Upload failed.';
      cmsUploads -= 1; setCmsDirty(cmsDirty);
    } finally {
      video.value = ''; video.disabled = false;
    }
  });

  form.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-cms-upload]');
    if (!input?.files?.[0]) return;
    const container = input.closest('[data-cms-image]');
    const status = container.querySelector('[data-cms-status]');
    status.textContent = 'Uploading…'; input.disabled = true; cmsUploads += 1; setCmsDirty(cmsDirty);
    try {
      const url = await adminStore.uploadSiteImage({ file: input.files[0] });
      setImageField(container, url);
      status.textContent = 'Uploaded — save to publish.';
      cmsUploads -= 1; setCmsDirty(true);
    } catch (err) {
      status.textContent = err?.message || 'Upload failed.';
      cmsUploads -= 1; setCmsDirty(cmsDirty);
    } finally {
      input.value = ''; input.disabled = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = form.querySelector('[data-cms-error]');
    const submit = form.querySelector('[data-cms-save]');
    errorEl.textContent = '';
    if (cmsUploads) return toast('Wait for the photo upload to finish.');
    const data = collectCmsForm(form, cmsDoc);
    const problem = validateCms(kind, data);
    if (problem) { errorEl.textContent = problem; return toast(problem); }
    submit.disabled = true; submit.textContent = 'Saving…';
    try {
      await adminStore.saveSiteDoc(kind, data);
      cmsDoc = data;
      setCmsDirty(false);
      toast(kind === 'home' ? 'Homepage published.' : 'Settings saved.');
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not save.';
    } finally {
      submit.disabled = false; submit.textContent = 'Save changes';
    }
  });
}

window.addEventListener('beforeunload', (event) => {
  if (cmsDirty || cmsUploads) { event.preventDefault(); event.returnValue = ''; }
});

// ---- Notifications (customer SMS + owner alerts) ------------------------------

// Keep in sync with functions/src/sms.js (used when a template is left blank).
const SMS_DEFAULTS = {
  paid: 'Hi {name}, we have received your payment for Nakuadiary order {reference}. We will let you know when it is being prepared.',
  processing: 'Hi {name}, your Nakuadiary order {reference} is being prepared.',
  dispatched: 'Hi {name}, your Nakuadiary order {reference} is on its way to you.',
  delivered: 'Hi {name}, your Nakuadiary order {reference} is complete. Thank you for shopping with us!',
  owner: 'New paid order {reference}: {itemCount} item(s), GHS {total}, {deliveryPreference}. Customer: {name}.',
};
const SMS_TEMPLATE_LABELS = { paid: 'Payment received (to customer)', processing: 'Being prepared (to customer)', dispatched: 'On its way (to customer)', delivered: 'Delivered / collected (to customer)', owner: 'New paid order (to you)' };

function notificationsViewHtml(cfg = {}) {
  const t = cfg.templates || {};
  return `<form class="cms-form" data-sms-form novalidate>
    <div class="view-head cms-head"><div><h1>Notifications</h1><p>Texts sent through MNotify when an order is paid or its status changes.</p></div><div class="cms-save"><button class="btn" type="submit">Save changes</button></div></div>
    <section class="cms-card"><header class="cms-card-head"><div><h2>Sending</h2><p>Your sender ID must be approved in your MNotify/BMS dashboard first. Texting is also switched on or off on the server by your developer (the SMS_ENABLED setting); until then, texts show as “Not sent (SMS off)” on each order and can be resent later.</p></div>
      <label class="switch"><input name="enabled" type="checkbox" ${cfg.enabled !== false ? 'checked' : ''} /><span>On</span></label></header>
      <div class="cms-card-body"><div class="field-row">
        <label class="field">Sender ID<input name="senderId" maxlength="11" value="${esc(cfg.senderId || '')}" placeholder="e.g. NAKUADIARY" /><small class="field-hint">Up to 11 letters/numbers — the name customers see.</small></label>
      </div></div></section>
    <section class="cms-card"><header class="cms-card-head"><div><h2>New-order alerts to you</h2><p>Get a text on your own phone every time an order is paid.</p></div>
      <label class="switch"><input name="ownerAlerts" type="checkbox" ${cfg.ownerAlerts !== false ? 'checked' : ''} /><span>On</span></label></header>
      <div class="cms-card-body"><div class="field-row"><label class="field">Your phone number<input name="ownerPhone" inputmode="tel" value="${esc(cfg.ownerPhone || '')}" placeholder="e.g. 024 123 4567" /></label></div></div></section>
    <section class="cms-card"><header class="cms-card-head"><div><h2>Message wording</h2><p>Leave a box empty to use the default shown in grey. You can use <code>{name}</code> (first name), <code>{reference}</code>, <code>{deliveryPreference}</code>, <code>{itemCount}</code> and <code>{total}</code>. Keep texts short — 160 characters is one SMS.</p></div></header>
      <div class="cms-card-body">${Object.keys(SMS_DEFAULTS).map((key) => `<label class="field">${SMS_TEMPLATE_LABELS[key]}<textarea name="template.${key}" rows="2" maxlength="300" placeholder="${esc(SMS_DEFAULTS[key])}">${esc(t[key] || '')}</textarea></label>`).join('')}</div></section>
    <p class="form-error" data-sms-error></p>
  </form>`;
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-sms-form]');
  if (!form) return;
  event.preventDefault();
  const errorEl = form.querySelector('[data-sms-error]');
  const senderId = form.senderId.value.trim();
  const digits = form.ownerPhone.value.replace(/\D/g, '').replace(/^0(\d{9})$/, '233$1');
  errorEl.textContent = '';
  if (senderId && !/^[A-Za-z0-9 ]{1,11}$/.test(senderId)) { errorEl.textContent = 'Sender ID: up to 11 letters, numbers or spaces.'; return; }
  if (form.ownerAlerts.checked && form.ownerPhone.value.trim() && !/^\d{9,15}$/.test(digits)) { errorEl.textContent = 'Enter your phone number like 024 123 4567.'; return; }
  const templates = {};
  Object.keys(SMS_DEFAULTS).forEach((key) => { const v = form.elements[`template.${key}`].value.trim(); if (v) templates[key] = v; });
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await adminStore.saveSmsConfig({ enabled: form.enabled.checked, senderId, ownerAlerts: form.ownerAlerts.checked, ownerPhone: form.ownerPhone.value.trim() ? digits : '', templates });
    toast('Notification settings saved.');
  } catch (err) {
    errorEl.textContent = err?.message || 'Could not save.';
  } finally {
    submit.disabled = false;
  }
});

// ---- Global event delegation ----------------------------------------------

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]');
  if (view) {
    if ((cmsDirty || cmsUploads) && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    return loadAndRenderView(view.dataset.view);
  }

  if (event.target.closest('[data-admin-forgot]')) {
    const form = document.querySelector('[data-login-form]');
    const errorEl = document.querySelector('[data-login-error]');
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Enter your email above, then tap “Forgot password?” again.'; form.email.focus(); return; }
    try { await adminStore.sendPasswordReset(email); } catch { /* same message either way */ }
    errorEl.textContent = '';
    form.insertAdjacentHTML('beforeend', '<p class="reset-sent">If there’s an account for that email, a reset link is on its way. Check your inbox and spam folder.</p>');
    return;
  }
  if (event.target.closest('[data-sign-out]')) {
    if ((cmsDirty || cmsUploads) && !window.confirm('You have unsaved changes. Sign out without saving?')) return;
    cmsDirty = false;
    return adminStore.signOutAdmin();
  }

  const adjust = event.target.closest('[data-stock-adjust]');
  if (adjust) return applyStockChange(adjust.closest('[data-stock-row]'), { delta: Number(adjust.dataset.stockAdjust) });
  const openStock = event.target.closest('[data-open-stock]');
  if (openStock) { stockSearch = productsCache.find((p) => p.id === openStock.dataset.openStock)?.name || ''; stockLowOnly = false; return loadAndRenderView('stock'); }

  if (event.target.closest('[data-new-product]')) return openProductDrawer(null, true);
  const editProduct = event.target.closest('[data-edit-product]');
  if (editProduct) { const product = productsCache.find((p) => p.id === editProduct.dataset.editProduct); return openProductDrawer(product, false); }
  if (event.target.closest('[data-close-product]')) return closeDrawer('[data-product-drawer]');
  const addTag = event.target.closest('[data-add-tag]');
  if (addTag) {
    const input = document.querySelector('[data-tags-input]');
    const tags = parseTags(`${input.value},${addTag.dataset.addTag}`);
    input.value = tags.join(', ');
    document.querySelector('[data-tag-suggestions]').innerHTML = tagSuggestionsHtml(tags);
    return;
  }
  if (event.target.closest('[data-add-variant]')) { document.querySelector('[data-variant-rows]').insertAdjacentHTML('beforeend', variantRowHtml()); return; }
  if (event.target.closest('[data-remove-variant]')) { event.target.closest('.variant-row').remove(); return; }
  const toggleActive = event.target.closest('[data-toggle-active]');
  if (toggleActive) {
    const product = productsCache.find((p) => p.id === toggleActive.dataset.toggleActive);
    await adminStore.setProductActive(product.id, product.active === false);
    closeDrawer('[data-product-drawer]');
    toast(product.active === false ? 'Product reactivated.' : 'Product deactivated.');
    return loadAndRenderView('products');
  }

  const orderFilter = event.target.closest('[data-order-filter]');
  if (orderFilter) { orderStatusFilter = orderFilter.dataset.orderFilter; return loadAndRenderView('orders'); }
  const viewOrder = event.target.closest('[data-view-order]');
  if (viewOrder) { const order = ordersCache.find((o) => o.id === viewOrder.dataset.viewOrder); return openOrderDrawer(order); }
  if (event.target.closest('[data-close-order]')) return closeDrawer('[data-order-drawer]');

  if (event.target.closest('[data-new-wholesale]')) return openWholesaleDrawer();
  if (event.target.closest('[data-close-wholesale]')) return closeDrawer('[data-wholesale-drawer]');

  if (event.target.matches('[data-overlay]')) {
    closeDrawer('[data-product-drawer]'); closeDrawer('[data-order-drawer]'); closeDrawer('[data-wholesale-drawer]');
  }
});

adminStore.onAdminAuthChange((next) => { session = next; renderRoot(); });
