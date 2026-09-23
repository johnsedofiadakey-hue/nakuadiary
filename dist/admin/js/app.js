import * as adminStore from './admin-store.js';
import { slugify, CATEGORIES } from './admin-store.js';

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
    root.innerHTML = `<div class="login-screen"><div class="login-card not-authorized"><h1>Not authorized</h1><p>${session.user.email} doesn't have admin access on this project.</p><button class="btn" type="button" data-sign-out>Sign out</button></div></div>`;
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
      </nav>
      <div class="signed-in-as">${session.user.email}<button type="button" data-sign-out>Sign out</button></div>
    </aside>
    <main class="admin-main" data-main></main>
  </div>
  <div class="overlay" hidden data-overlay></div>
  <div class="toast" data-toast></div>`;
}

async function loadAndRenderView(view) {
  currentView = view;
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
  const main = document.querySelector('[data-main]');
  main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (view === 'products') { productsCache = await adminStore.listProducts(); main.innerHTML = productsViewHtml(); }
    if (view === 'orders') { ordersCache = await adminStore.listOrders(); main.innerHTML = ordersViewHtml(); }
    if (view === 'customers') { customersCache = await adminStore.listCustomers(); main.innerHTML = customersViewHtml(); }
  } catch (err) {
    main.innerHTML = `<p class="form-error">Could not load ${view}: ${err?.message || err}</p>`;
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
  return `<tr><td>${p.name}</td><td class="muted">${p.category}</td><td>${money(p.price)}</td><td>${typeof p.wholesalePrice === 'number' ? money(p.wholesalePrice) : '—'}</td><td class="${stockTotal <= 5 ? 'low-stock' : ''}">${stockTotal}</td><td><span class="badge ${p.active !== false ? 'status-paid' : 'status-inactive'}">${p.active !== false ? 'Active' : 'Inactive'}</span></td><td><button class="btn secondary" type="button" data-edit-product="${p.id}">Edit</button></td></tr>`;
}

function variantRowHtml(v = {}) {
  return `<div class="variant-row">
    <button type="button" class="remove-variant" data-remove-variant>Remove</button>
    <input type="hidden" data-field="id" value="${v.id || ''}" />
    <div class="field-row">
      <label class="field">Label<input data-field="label" value="${v.label || ''}" required /></label>
      <label class="field">Stock<input data-field="stock" type="number" min="0" value="${v.stock ?? 0}" required /></label>
    </div>
    <div class="field-row">
      <label class="field">Retail price override<input data-field="price" type="number" min="0" step="0.01" value="${v.price ?? ''}" placeholder="Uses product price" /></label>
      <label class="field">Wholesale price override<input data-field="wholesalePrice" type="number" min="0" step="0.01" value="${v.wholesalePrice ?? ''}" placeholder="Uses product wholesale price" /></label>
    </div>
    <label class="field checkbox"><input data-field="available" type="checkbox" ${v.available !== false ? 'checked' : ''} /> Available</label>
  </div>`;
}

function normaliseImages(product = {}) {
  const list = Array.isArray(product.images) && product.images.length ? product.images : (product.image?.url ? [product.image] : []);
  return list.filter((image) => image?.url).map((image) => ({ url: image.url, alt: image.alt || product.name || 'Product photo', focalPoint: image.focalPoint || { x: 50, y: 50 } }));
}

function galleryEditorHtml(images) {
  return `<div class="image-editor" data-image-editor>${images.length ? images.map((image, index) => `<article class="image-editor-card"><img src="${image.url}" alt="${image.alt || ''}" /><div><strong>${index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</strong><button type="button" data-remove-image="${index}">Remove</button></div></article>`).join('') : '<p class="muted image-empty">Add at least one photo. The first one becomes the shop cover.</p>'}</div>`;
}

function productDrawerHtml(product, isNew) {
  const p = product || {};
  const images = normaliseImages(p);
  return `<div class="drawer" data-product-drawer>
    <div class="drawer-head"><h2>${isNew ? 'Add product' : 'Edit product'}</h2><button type="button" data-close-product aria-label="Close">×</button></div>
    <form data-product-form>
      <label class="field">Name<input name="name" value="${p.name || ''}" required /></label>
      ${!isNew ? `<p class="muted" style="margin:-.5rem 0 1rem">ID: ${p.id}</p>` : ''}
      <div class="field-row">
        <label class="field">Category<select name="category" required>${CATEGORIES.map((c) => `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field">Type<input name="type" value="${p.type || ''}" placeholder="e.g. HD lace wig" /></label>
      </div>
      <div class="field-row">
        <label class="field">Retail price (GHS)<input name="price" type="number" min="0" step="0.01" value="${p.price ?? ''}" required /></label>
        <label class="field">Wholesale price (GHS)<input name="wholesalePrice" type="number" min="0" step="0.01" value="${p.wholesalePrice ?? ''}" placeholder="Optional" /></label>
      </div>
      <label class="field">Minimum wholesale quantity<input name="minWholesaleQty" type="number" min="1" value="${p.minWholesaleQty ?? 1}" /></label>
      <label class="field">Description<textarea name="description" rows="2" required>${p.description || ''}</textarea></label>
      <label class="field">Details (one per line)<textarea name="details" rows="3">${(p.details || []).join('\n')}</textarea></label>
      <fieldset class="product-images"><legend>Product photos</legend>
        <p class="muted image-help">Upload JPG, PNG, or WebP below 8 MB. The first photo is the cover shoppers see in the collection.</p>
        ${galleryEditorHtml(images)}
        <label class="field">Photo description (optional)<input data-image-alt placeholder="e.g. 22-inch deep-curly wig, front view" /></label>
        <label class="image-upload"><span>Upload from phone or computer</span><input type="file" data-product-image-upload accept="image/jpeg,image/png,image/webp" /><small data-image-upload-status></small></label>
        <div class="image-url-row"><input type="url" data-product-image-url placeholder="Or paste an image URL" /><button type="button" class="btn secondary" data-add-image-url>Add photo</button></div>
      </fieldset>
      <label class="field">Badges (comma separated)<input name="badges" value="${(p.badges || []).join(', ')}" /></label>
      <div class="field-row">
        <label class="field checkbox"><input name="featured" type="checkbox" ${p.featured ? 'checked' : ''} /> Featured</label>
        <label class="field checkbox"><input name="active" type="checkbox" ${p.active !== false ? 'checked' : ''} /> Active (visible to shoppers)</label>
      </div>
      <label class="field">Inventory policy<select name="inventoryPolicy"><option value="deny" ${p.inventoryPolicy !== 'continue' ? 'selected' : ''}>Deny sale at 0 stock</option><option value="continue" ${p.inventoryPolicy === 'continue' ? 'selected' : ''}>Allow backorder</option></select></label>
      <fieldset><legend>Variants (lengths / options)</legend><div data-variant-rows>${(p.variants && p.variants.length ? p.variants : [{}]).map(variantRowHtml).join('')}</div><button type="button" class="add-variant" data-add-variant>+ Add variant</button></fieldset>
      <p class="form-error" data-product-error></p>
      <div class="status-actions">
        <button class="btn" type="submit">${isNew ? 'Create product' : 'Save changes'}</button>
        ${!isNew ? `<button type="button" class="btn secondary" data-toggle-active="${p.id}">${p.active !== false ? 'Deactivate' : 'Reactivate'}</button>` : ''}
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
  return `<tr><td class="muted">${formatDate(o.createdAt)}</td><td>${o.customer?.name || '—'}<br><span class="muted">${o.customer?.phone || ''}</span></td><td><span class="badge account-${o.accountType}">${o.accountType}</span></td><td>${money(o.subtotal)}</td><td><span class="badge status-${o.paymentStatus}">${o.paymentStatus}</span></td><td><span class="badge status-${o.fulfillmentStatus}">${o.fulfillmentStatus}</span></td><td><button class="btn secondary" type="button" data-view-order="${o.id}">View</button></td></tr>`;
}

function orderDrawerHtml(order) {
  const allowedNext = ALLOWED_NEXT_STATUS[order.fulfillmentStatus] || [];
  return `<div class="drawer" data-order-drawer>
    <div class="drawer-head"><h2>Order ${order.id.slice(0, 8)}</h2><button type="button" data-close-order aria-label="Close">×</button></div>
    <p><span class="badge status-${order.paymentStatus}">${order.paymentStatus}</span> <span class="badge status-${order.fulfillmentStatus}">${order.fulfillmentStatus}</span> <span class="badge account-${order.accountType}">${order.accountType}</span></p>
    <p class="muted">${formatDate(order.createdAt)}</p>
    <fieldset><legend>Customer</legend><p><strong>${order.customer?.name}</strong><br>${order.customer?.phone}</p><p>${order.customer?.deliveryPreference}${order.customer?.deliveryAddress ? ` — ${order.customer.deliveryAddress}` : ''}</p></fieldset>
    <fieldset><legend>Items</legend><div class="order-lines">${order.lines.map((l) => `<div><span>${l.title} × ${l.quantity}</span><span>${money(l.unitPrice * l.quantity)}</span></div>`).join('')}<div><strong>Subtotal</strong><strong>${money(order.subtotal)}</strong></div></div></fieldset>
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
  return `<tr><td>${c.name}</td><td>${c.phone}</td><td class="muted">${c.email || '—'}</td><td><span class="badge account-${c.accountType}">${c.accountType}</span></td><td>${c.orderCount || 0}</td><td>${money(c.totalSpent)}</td></tr>`;
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
      document.querySelector('[data-wholesale-result]').innerHTML = `<div class="temp-password">Temporary password — share this with the customer directly (WhatsApp/SMS). It will not be shown again.<code>${result.temporaryPassword}</code></div>`;
      toast('Wholesale account created.');
      customersCache = await adminStore.listCustomers();
      if (currentView === 'customers') document.querySelector('[data-main]').innerHTML = customersViewHtml();
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not create this account.';
      submit.disabled = false;
    }
  });
}

// ---- Global event delegation ----------------------------------------------

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]');
  if (view) return loadAndRenderView(view.dataset.view);

  if (event.target.closest('[data-sign-out]')) return adminStore.signOutAdmin();

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
