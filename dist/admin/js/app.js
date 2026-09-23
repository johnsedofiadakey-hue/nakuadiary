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
    root.innerHTML = `<div class="login-screen"><div class="login-card not-authorized"><h1>Not authorized</h1><p>${esc(session.user.email)} doesn't have admin access on this project.</p><button class="btn" type="button" data-sign-out>Sign out</button></div></div>`;
    return;
  }
  root.innerHTML = shellHtml();
  loadAndRenderView(currentView);
}

function loginScreenHtml() {
  return `<div class="login-screen"><div class="login-card">
    <img class="admin-login-mark" src="/assets/nakuadiary-logo.png" alt="Nakuadiary" />
    <h1>Nakuadiary Admin</h1>
    <p>Sign in with your staff account.</p>
    <form data-login-form>
      <label>Email<input name="email" type="email" autocomplete="username" required /></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
      <p class="form-error" data-login-error></p>
      <button type="submit">Sign in</button>
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
        <button type="button" data-view="orders" class="${currentView === 'orders' ? 'is-active' : ''}">Orders</button>
        <button type="button" data-view="customers" class="${currentView === 'customers' ? 'is-active' : ''}">Customers</button>
        <span class="admin-nav-label">Website</span>
        <button type="button" data-view="homepage" class="${currentView === 'homepage' ? 'is-active' : ''}">Homepage</button>
        <button type="button" data-view="settings" class="${currentView === 'settings' ? 'is-active' : ''}">Settings</button>
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
function productRow(p) {
  const stockTotal = totalStock(p);
  return `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.category)}</td><td>${money(p.price)}</td><td>${typeof p.wholesalePrice === 'number' ? money(p.wholesalePrice) : '—'}</td><td class="${stockTotal <= 5 ? 'low-stock' : ''}">${esc(stockTotal)}</td><td><span class="badge ${p.active !== false ? 'status-paid' : 'status-inactive'}">${p.active !== false ? 'Active' : 'Inactive'}</span></td><td><button class="btn secondary" type="button" data-edit-product="${esc(p.id)}">Edit</button></td></tr>`;
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
      await adminStore.saveProduct(collected, { isNew });
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
    featured: fd.has('featured'),
    active: fd.has('active'),
    inventoryPolicy: fd.get('inventoryPolicy'),
    variants,
    slug: isNew ? slugify(fd.get('name').trim()) : (existing?.slug || slugify(fd.get('name').trim())),
  };
}

// ---- Orders --------------------------------------------------------

const ALLOWED_NEXT_STATUS = { unfulfilled: ['processing', 'cancelled'], processing: ['fulfilled', 'cancelled'], fulfilled: [], cancelled: [] };
const STATUS_FILTERS = ['all', 'unfulfilled', 'processing', 'fulfilled', 'cancelled'];

function ordersViewHtml() {
  const filtered = orderStatusFilter === 'all' ? ordersCache : ordersCache.filter((o) => o.fulfillmentStatus === orderStatusFilter);
  return `<div class="view-head"><div><h1>Orders</h1><p>${ordersCache.length} orders</p></div></div>
  <div class="filters">${STATUS_FILTERS.map((s) => `<button type="button" data-order-filter="${s}" class="${orderStatusFilter === s ? 'is-active' : ''}">${s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
  ${filtered.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Customer</th><th>Account</th><th>Subtotal</th><th>Payment</th><th>Fulfillment</th><th></th></tr></thead><tbody>${filtered.map(orderRow).join('')}</tbody></table>` : '<p class="empty-state">No orders in this view.</p>'}`;
}
function orderRow(o) {
  return `<tr><td class="muted">${formatDate(o.createdAt)}</td><td>${esc(o.customer?.name || '—')}<br><span class="muted">${esc(o.customer?.phone)}</span></td><td><span class="badge account-${esc(o.accountType)}">${esc(o.accountType)}</span></td><td>${money(o.subtotal)}</td><td><span class="badge status-${esc(o.paymentStatus)}">${esc(o.paymentStatus)}</span></td><td><span class="badge status-${esc(o.fulfillmentStatus)}">${esc(o.fulfillmentStatus)}</span></td><td><button class="btn secondary" type="button" data-view-order="${esc(o.id)}">View</button></td></tr>`;
}

function orderDrawerHtml(order) {
  const allowedNext = ALLOWED_NEXT_STATUS[order.fulfillmentStatus] || [];
  const payment = order.payment || { provider: 'paystack', reference: order.id, status: order.paymentStatus };
  const history = order.statusHistory || [{ status: order.fulfillmentStatus, source: 'system' }];
  return `<div class="drawer" data-order-drawer>
    <div class="drawer-head"><h2>Order ${esc(order.id.slice(0, 8))}</h2><button type="button" data-close-order aria-label="Close">×</button></div>
    <p><span class="badge status-${esc(order.paymentStatus)}">${esc(order.paymentStatus)}</span> <span class="badge status-${esc(order.fulfillmentStatus)}">${esc(order.fulfillmentStatus)}</span> <span class="badge account-${esc(order.accountType)}">${esc(order.accountType)}</span></p>
    <p class="muted">${formatDate(order.createdAt)}</p>
    <fieldset><legend>Customer</legend><p><strong>${esc(order.customer?.name)}</strong><br>${esc(order.customer?.phone)}</p><p>${esc(order.customer?.deliveryPreference)}${order.customer?.deliveryAddress ? ` — ${esc(order.customer.deliveryAddress)}` : ''}</p></fieldset>
    <fieldset><legend>Payment confirmation</legend><dl class="order-payment"><div><dt>Provider</dt><dd>${esc(payment.provider || 'Paystack')}</dd></div><div><dt>Reference</dt><dd>${esc(payment.reference || order.id)}</dd></div><div><dt>Status</dt><dd>${esc(payment.status || order.paymentStatus)}</dd></div>${payment.channel ? `<div><dt>Method</dt><dd>${esc(payment.channel)}</dd></div>` : ''}${payment.paidAt ? `<div><dt>Confirmed</dt><dd>${esc(payment.paidAt)}</dd></div>` : ''}</dl></fieldset>
    <fieldset><legend>Items</legend><div class="order-lines">${order.lines.map((l) => `<div class="order-line-item">${l.image ? `<img src="${esc(l.image)}" alt="" />` : ''}<span>${esc(l.title)} × ${esc(l.quantity)}</span><strong>${money(l.unitPrice * l.quantity)}</strong></div>`).join('')}<div><strong>Subtotal</strong><strong>${money(order.subtotal)}</strong></div></div></fieldset>
    <fieldset><legend>Order timeline</legend><ol class="order-timeline">${history.map((entry) => `<li><strong>${esc(entry.status)}</strong><span>${entry.at ? new Date(entry.at).toLocaleString('en-GB') : ''} · ${esc(entry.source || 'system')}</span></li>`).join('')}</ol></fieldset>
    ${allowedNext.length ? `<div class="status-actions">${allowedNext.map((s) => `<button class="btn ${s === 'cancelled' ? 'danger' : ''}" type="button" data-set-status="${s}">Mark ${s}</button>`).join('')}</div>` : '<p class="muted">No further status changes available.</p>'}
    <p class="form-error" data-order-error></p>
  </div>`;
}

function openOrderDrawer(order) {
  openDrawer(orderDrawerHtml(order));
  document.querySelector('[data-order-drawer]').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-set-status]');
    if (!button) return;
    const fulfillmentStatus = button.dataset.setStatus;
    const errorEl = document.querySelector('[data-order-error]');
    button.disabled = true;
    try {
      await adminStore.updateOrderStatus({ orderId: order.id, fulfillmentStatus });
      closeDrawer('[data-order-drawer]');
      toast(`Order marked ${fulfillmentStatus}.`);
      await loadAndRenderView('orders');
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not update this order.';
      button.disabled = false;
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
      document.querySelector('[data-wholesale-result]').innerHTML = `<div class="temp-password">Temporary password — share this with the customer directly (WhatsApp/SMS). It will not be shown again.<code>${esc(result.temporaryPassword)}</code></div>`;
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

// ---- Global event delegation ----------------------------------------------

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]');
  if (view) {
    if ((cmsDirty || cmsUploads) && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    return loadAndRenderView(view.dataset.view);
  }

  if (event.target.closest('[data-sign-out]')) {
    if ((cmsDirty || cmsUploads) && !window.confirm('You have unsaved changes. Sign out without saving?')) return;
    cmsDirty = false;
    return adminStore.signOutAdmin();
  }

  if (event.target.closest('[data-new-product]')) return openProductDrawer(null, true);
  const editProduct = event.target.closest('[data-edit-product]');
  if (editProduct) { const product = productsCache.find((p) => p.id === editProduct.dataset.editProduct); return openProductDrawer(product, false); }
  if (event.target.closest('[data-close-product]')) return closeDrawer('[data-product-drawer]');
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
