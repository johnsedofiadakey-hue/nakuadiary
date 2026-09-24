import * as adminStore from './admin-store.js?v=2';
import { slugify, CATEGORIES } from './admin-store.js?v=2';
import { homepageViewHtml, settingsViewHtml, collectCmsForm, validateCms, setImageField } from './cms.js?v=2';
import { DEFAULT_HOME, DEFAULT_SETTINGS, escapeHtml as esc } from '/js/site-content.js?v=2';
import { GUIDE } from './guide.js?v=2';

const root = document.querySelector('#admin-app');
root.innerHTML = '<p class="muted" style="padding:2rem">Loading…</p>';
const money = (amount) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(amount || 0);
const formatDate = (ts) => {
  if (!ts) return '—';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

let session = null;
let currentView = 'home';
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
  routedView = null;
  handleRoute();
  adminStore.registerServiceWorker(); // offline shell + push; harmless if unsupported
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

// ---- Shell & navigation -------------------------------------------------------
// Desktop: left sidebar. Phone: top bar + bottom tab bar + "More" sheet.
// Every screen has a URL (#/orders, #/orders/<id>, #/help/products…) so push
// notifications can deep-link and the phone's back button works.

const VIEWS = ['home', 'orders', 'stock', 'products', 'customers', 'homepage', 'settings', 'notifications', 'help'];
const VIEW_TITLE = { home: 'Home', orders: 'Orders', stock: 'Stock', products: 'Products', customers: 'Customers', homepage: 'Homepage', settings: 'Settings', notifications: 'Notifications', help: 'Help' };
const VIEW_HELP = { home: 'home', orders: 'orders', stock: 'stock', products: 'products', customers: 'customers', homepage: 'website', settings: 'website', notifications: 'alerts' };
const TABS = ['home', 'orders', 'stock', 'products'];
const MORE = ['customers', 'homepage', 'settings', 'notifications', 'help'];

const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  orders: '<path d="M6 3h12l1 18H5L6 3Z"/><path d="M9 7a3 3 0 0 0 6 0"/>',
  stock: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  products: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  homepage: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h6M7 16h10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  notifications: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  site: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
const navButton = (view, cls = '') => `<button type="button" class="${cls}" data-view="${view}">${icon(view)}<span>${VIEW_TITLE[view]}</span></button>`;

function shellHtml() {
  return `<div class="admin-shell">
    <aside class="admin-sidebar">
      <p class="brand"><img src="/assets/nakuadiary-logo.png" alt="" /><span>Nakuadiary<small>Admin</small></span></p>
      <nav class="admin-nav" aria-label="Main">
        ${[...TABS, 'customers'].map((v) => navButton(v)).join('')}
        <span class="admin-nav-label">Website</span>
        ${['homepage', 'settings', 'notifications'].map((v) => navButton(v)).join('')}
        <span class="admin-nav-label">Support</span>
        ${navButton('help')}
        <a class="nav-link" href="/" target="_blank" rel="noopener">${icon('site')}<span>View website</span></a>
      </nav>
      <div class="signed-in-as"><span>${esc(session.user.email)}</span><button type="button" data-sign-out>${icon('signout')} Sign out</button></div>
    </aside>
    <header class="admin-topbar">
      <img src="/assets/nakuadiary-logo.png" alt="" />
      <h1 data-topbar-title>Home</h1>
      <a class="topbar-help" href="#/help" data-topbar-help aria-label="Help for this page">${icon('help')}</a>
    </header>
    <main class="admin-main" data-main></main>
    <nav class="admin-tabbar" aria-label="Main">
      ${TABS.map((v) => navButton(v, 'tab')).join('')}
      <button type="button" class="tab" data-more-toggle aria-expanded="false">${icon('more')}<span>More</span></button>
    </nav>
  </div>
  <div class="sheet-backdrop" data-more-backdrop hidden></div>
  <div class="more-sheet" data-more-sheet hidden role="dialog" aria-label="More">
    <div class="sheet-handle"></div>
    ${MORE.map((v) => navButton(v, 'sheet-item')).join('')}
    <a class="sheet-item" href="/" target="_blank" rel="noopener">${icon('site')}<span>View website</span></a>
    <button type="button" class="sheet-item" data-sign-out>${icon('signout')}<span>Sign out <small>${esc(session.user.email)}</small></span></button>
  </div>
  <div class="overlay" hidden data-overlay></div>
  <div class="toast" data-toast></div>`;
}

function toggleMoreSheet(open) {
  const sheet = document.querySelector('[data-more-sheet]');
  if (!sheet) return;
  sheet.hidden = !open;
  document.querySelector('[data-more-backdrop]').hidden = !open;
  document.querySelector('[data-more-toggle]')?.setAttribute('aria-expanded', String(open));
}

let routedView = null;
let orderPushed = false; // true when the open order drawer added a history entry

function parseRoute() {
  const [view, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { view: VIEWS.includes(view) ? view : 'home', param: rest.length ? decodeURIComponent(rest.join('/')) : '' };
}

function navigate(view, param = '') {
  const hash = `#/${view}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (location.hash === hash) handleRoute(); else location.hash = hash;
}

async function handleRoute() {
  if (!session?.isAdmin || !document.querySelector('[data-main]')) return;
  const { view, param } = parseRoute();
  toggleMoreSheet(false);
  if (view !== routedView) {
    if ((cmsDirty || cmsUploads) && !window.confirm('You have unsaved changes. Leave without saving?')) {
      history.replaceState(null, '', `#/${routedView}`);
      return;
    }
    closeAllDrawers();
    routedView = view;
    await loadAndRenderView(view);
  }
  if (view === 'orders') {
    if (param) await openOrderById(param);
    else if (document.querySelector('[data-order-drawer]')) { orderPushed = false; closeDrawer('[data-order-drawer]'); }
  }
  if (view === 'products' && param === 'new' && !document.querySelector('[data-product-drawer]')) {
    history.replaceState(null, '', '#/products');
    openProductDrawer(null, true);
  }
  if (view === 'help') {
    const target = param && document.getElementById(`guide-${param}`);
    if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
}

window.addEventListener('hashchange', handleRoute);
navigator.serviceWorker?.addEventListener('message', (event) => {
  if (event.data?.type === 'open' && event.data.url) location.href = event.data.url;
});

function closeAllDrawers() {
  ['[data-product-drawer]', '[data-order-drawer]', '[data-wholesale-drawer]'].forEach(closeDrawer);
  orderPushed = false;
}

async function loadAndRenderView(view) {
  currentView = view;
  cmsDirty = false; cmsDoc = null;
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
  document.querySelector('[data-more-toggle]')?.classList.toggle('is-active', MORE.includes(view));
  const title = document.querySelector('[data-topbar-title]');
  if (title) title.textContent = VIEW_TITLE[view];
  const topHelp = document.querySelector('[data-topbar-help]');
  if (topHelp) topHelp.href = `#/help${VIEW_HELP[view] ? `/${VIEW_HELP[view]}` : ''}`;
  document.title = `${VIEW_TITLE[view]} · Nakuadiary Admin`;
  const main = document.querySelector('[data-main]');
  main.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  window.scrollTo(0, 0);
  try {
    if (view === 'home') main.innerHTML = await homeViewHtml();
    if (view === 'help') main.innerHTML = helpViewHtml();
    if (view === 'products') { productsCache = await adminStore.listProducts(); main.innerHTML = productsViewHtml(); }
    if (view === 'notifications') { const [cfg, devices] = await Promise.all([adminStore.getSmsConfig(), adminStore.listMyDevices().catch(() => [])]); main.innerHTML = notificationsViewHtml(cfg, devices); }
    if (view === 'stock') { productsCache = await adminStore.listProducts(); main.innerHTML = stockViewHtml(); }
    if (view === 'orders') { ordersCache = await adminStore.listOrders(); main.innerHTML = ordersViewHtml(); }
    if (view === 'customers') { customersCache = await adminStore.listCustomers(); main.innerHTML = customersViewHtml(); }
    if (view === 'homepage') { cmsDoc = await adminStore.getSiteDoc('home', DEFAULT_HOME); main.innerHTML = homepageViewHtml(cmsDoc); wireCmsForm(); }
    if (view === 'settings') { cmsDoc = await adminStore.getSiteDoc('settings', DEFAULT_SETTINGS); main.innerHTML = settingsViewHtml(cmsDoc); wireCmsForm(); }
    // "?" next to every page title opens the matching Help section.
    const h1 = main.querySelector('.view-head h1');
    if (h1 && VIEW_HELP[view] && !h1.querySelector('.help-link')) h1.insertAdjacentHTML('beforeend', ` <a class="help-link" href="#/help/${VIEW_HELP[view]}" aria-label="How this page works">?</a>`);
  } catch (err) {
    main.innerHTML = `<div class="empty-state"><p class="form-error">Could not load ${esc(VIEW_TITLE[view] || view)}: ${esc(err?.message || err)}</p><button class="btn secondary" type="button" data-view="${esc(view)}">Try again</button></div>`;
  }
}

// ---- Home (dashboard) ------------------------------------------------------------

const PAID_LIKE = ['paid', 'processing', 'dispatched', 'delivered'];
const cedis = (n) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(n || 0);
const toMillis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : ts ? new Date(ts).getTime() : 0);
function timeAgo(ts) {
  const mins = Math.round((Date.now() - toMillis(ts)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDate(ts);
}
const needsAttention = (o) => (o.refund?.required && o.refund?.status !== 'done') || o.stockIssue || o.payment?.mismatch;

function miniOrderHtml(o, hint) {
  return `<a class="mini-order" href="#/orders/${esc(o.id)}"><span><strong>${esc(orderRef(o))}</strong><small>${esc(o.customer?.deliveryPreference || '')}${o.delivery?.zone ? ` · ${esc(o.delivery.zone)}` : ''} · ${timeAgo(o.paidAt || o.createdAt)}</small></span><span class="mini-order-right"><strong>${money(o.total ?? o.subtotal)}</strong><small>${hint}</small></span></a>`;
}

async function homeViewHtml() {
  const [orders, products, siteSettings, smsCfg, devices] = await Promise.all([
    adminStore.listOrders(), adminStore.listProducts(),
    adminStore.getSiteDoc('settings', DEFAULT_SETTINGS).catch(() => DEFAULT_SETTINGS),
    adminStore.getSmsConfig().catch(() => ({})), adminStore.listMyDevices().catch(() => []),
  ]);
  ordersCache = orders; productsCache = products;

  const toPrepare = orders.filter((o) => orderStatus(o) === 'paid');
  const inProgress = orders.filter((o) => orderStatus(o) === 'processing');
  const onTheWay = orders.filter((o) => orderStatus(o) === 'dispatched');
  const attention = orders.filter(needsAttention);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const paid = orders.filter((o) => PAID_LIKE.includes(orderStatus(o)));
  const sum = (list) => list.reduce((n, o) => n + (o.total ?? o.subtotal ?? 0), 0);
  const today = paid.filter((o) => toMillis(o.paidAt || o.createdAt) >= startOfDay.getTime());
  const week = paid.filter((o) => toMillis(o.paidAt || o.createdAt) >= weekAgo);
  const lengths = products.filter((p) => p.active !== false).flatMap((p) => p.variants || []);
  const lowCount = lengths.filter((v) => (Number(v.stock) || 0) <= LOW_STOCK).length;
  const outCount = lengths.filter((v) => (Number(v.stock) || 0) <= 0).length;

  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const checklist = [
    { done: siteSettings.contact.whatsappNumber !== DEFAULT_SETTINGS.contact.whatsappNumber && siteSettings.contact.email !== DEFAULT_SETTINGS.contact.email, label: 'Add your real WhatsApp number and email', href: '#/settings' },
    { done: Boolean(siteSettings.delivery?.pickupAddress) || siteSettings.delivery?.mode !== 'arranged', label: 'Set delivery pricing and your pickup location', href: '#/settings' },
    { done: installed, label: 'Install the admin app on your phone', href: '#/help/install' },
    { done: devices.some((d) => d.id === adminStore.thisDeviceId()), label: 'Turn on order alerts on this phone', href: '#/notifications' },
    { done: Boolean(smsCfg.ownerPhone), label: 'Add your number for new-order texts', href: '#/notifications' },
    { done: products.some((p) => p.active !== false && (p.images?.length || p.image?.url)), label: 'Add a product with photos and stock', href: '#/products/new' },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const todo = [
    toPrepare.length && `<div class="todo-group"><h3><span class="dot dot-paid"></span>${toPrepare.length} paid order${toPrepare.length === 1 ? '' : 's'} to prepare</h3>${toPrepare.slice(0, 4).map((o) => miniOrderHtml(o, 'Start processing')).join('')}</div>`,
    inProgress.length && `<div class="todo-group"><h3><span class="dot dot-processing"></span>${inProgress.length} being prepared</h3>${inProgress.slice(0, 4).map((o) => miniOrderHtml(o, o.customer?.deliveryPreference === 'Pickup' ? 'Mark collected' : 'Mark dispatched')).join('')}</div>`,
    onTheWay.length && `<div class="todo-group"><h3><span class="dot dot-dispatched"></span>${onTheWay.length} on the way</h3>${onTheWay.slice(0, 4).map((o) => miniOrderHtml(o, 'Mark delivered')).join('')}</div>`,
    attention.length && `<div class="todo-group attention"><h3><span class="dot dot-alert"></span>${attention.length} need${attention.length === 1 ? 's' : ''} attention</h3>${attention.slice(0, 4).map((o) => miniOrderHtml(o, o.refund?.required ? 'Refund due' : o.stockIssue ? 'Stock issue' : 'Check payment')).join('')}</div>`,
  ].filter(Boolean);

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';
  return `<div class="view-head"><div><h1>${greeting}</h1><p>${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
    <div class="quick-actions">
      <a class="quick-action primary" href="#/products/new">${icon('products')}<span>Add product</span></a>
      <a class="quick-action" href="#/stock">${icon('stock')}<span>Update stock</span></a>
      <a class="quick-action" href="#/orders">${icon('orders')}<span>Orders</span></a>
      <a class="quick-action" href="/" target="_blank" rel="noopener">${icon('site')}<span>View website</span></a>
    </div>
    <div class="stat-row">
      <div class="stat"><small>Today</small><strong>${cedis(sum(today))}</strong><span>${today.length} order${today.length === 1 ? '' : 's'}</span></div>
      <div class="stat"><small>Last 7 days</small><strong>${cedis(sum(week))}</strong><span>${week.length} order${week.length === 1 ? '' : 's'}</span></div>
      <a class="stat ${lowCount ? 'stat-warn' : ''}" href="#/stock"><small>Stock</small><strong>${lowCount ? `${lowCount} low` : 'All good'}</strong><span>${outCount ? `${outCount} sold out` : 'Nothing sold out'}</span></a>
    </div>
    <section class="panel"><header class="panel-head"><h2>To do now</h2><a href="#/orders">All orders →</a></header>
      ${todo.length ? todo.join('') : '<p class="empty-inline">🎉 Nothing waiting. New paid orders will appear here — and on your phone if <a href="#/notifications">order alerts</a> are on.</p>'}
    </section>
    ${doneCount < checklist.length ? `<section class="panel checklist"><header class="panel-head"><h2>Setup checklist</h2><span class="progress-pill">${doneCount} of ${checklist.length} done</span></header>
      <div class="progress-bar"><span style="width:${Math.round((doneCount / checklist.length) * 100)}%"></span></div>
      <ul>${checklist.map((c) => `<li class="${c.done ? 'is-done' : ''}"><span class="check">${c.done ? '✓' : ''}</span>${c.done ? `<span>${esc(c.label)}</span>` : `<a href="${c.href}">${esc(c.label)} →</a>`}</li>`).join('')}</ul>
    </section>` : ''}
    <section class="panel help-panel"><h2>New here?</h2><p>The Help guide explains every page and walks you through adding products, handling orders and more.</p><a class="btn secondary" href="#/help">Open the guide</a></section>`;
}

// ---- Help guide --------------------------------------------------------------------

function helpViewHtml() {
  return `<div class="view-head"><div><h1>Help guide</h1><p>Everything you can do here, step by step.</p></div></div>
    <input type="search" class="guide-search" placeholder="Search the guide… e.g. refund, photo, stock" data-guide-search />
    <nav class="guide-toc" aria-label="Guide sections">${GUIDE.map((g) => `<a href="#/help/${g.id}">${esc(g.title)}</a>`).join('')}</nav>
    ${GUIDE.map((g) => `<section class="guide-section" id="guide-${g.id}" data-guide-section><h2>${esc(g.title)}</h2><p class="guide-summary">${esc(g.summary)}</p>${g.body}<a class="guide-top" href="#/help">↑ Back to contents</a></section>`).join('')}
    <p class="guide-empty" data-guide-empty hidden>Nothing matches — try another word, or browse the contents above.</p>`;
}

document.addEventListener('input', (event) => {
  if (!event.target.matches('[data-guide-search]')) return;
  const term = event.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('[data-guide-section]').forEach((section) => {
    const match = !term || section.textContent.toLowerCase().includes(term);
    section.hidden = !match; if (match) shown += 1;
  });
  document.querySelector('.guide-toc').hidden = Boolean(term);
  document.querySelector('[data-guide-empty]').hidden = shown > 0;
});

// ---- Products --------------------------------------------------------

function totalStock(product) { return (product.variants || []).reduce((sum, v) => sum + (v.stock || 0), 0); }

let productSearch = '';

function productsViewHtml() {
  const term = productSearch.trim().toLowerCase();
  const list = [...productsCache].sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .filter((p) => !term || `${p.name} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(term));
  return `<div class="view-head"><div><h1>Products</h1><p>${productsCache.length} product${productsCache.length === 1 ? '' : 's'} · tap one to edit</p></div><a class="btn" href="#/products/new">+ Add product</a></div>
  ${productsCache.length > 4 ? `<input type="search" class="stock-search list-search" placeholder="Search products…" value="${esc(productSearch)}" data-product-search />` : ''}
  ${list.length ? `<div class="product-cards">${list.map(productCardHtml).join('')}</div>` : productsCache.length ? '<p class="empty-state">No products match.</p>' : `<div class="empty-state"><p>No products yet.</p><a class="btn" href="#/products/new">Add your first product</a><p class="muted">Not sure how? <a href="#/help/products">Read the step-by-step guide</a>.</p></div>`}`;
}

function productCardHtml(p) {
  const cover = (Array.isArray(p.images) && p.images[0]?.url) || p.image?.url || '';
  const stockTotal = totalStock(p);
  const lengths = (p.variants || []).length;
  const out = (p.variants || []).filter((v) => (Number(v.stock) || 0) <= 0).length;
  return `<article class="product-admin-card ${p.active === false ? 'is-hidden' : ''}">
    <button type="button" class="product-admin-main" data-edit-product="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">
      ${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" />` : '<span class="img-placeholder">No photo</span>'}
      <span class="product-admin-copy">
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.category)}${p.type ? ` · ${esc(p.type)}` : ''}</small>
        <span class="product-admin-meta"><b>${money(p.price)}</b>${typeof p.wholesalePrice === 'number' ? `<span class="muted">Wholesale ${money(p.wholesalePrice)}</span>` : ''}</span>
        <span class="product-admin-badges">${p.active === false ? '<span class="badge status-inactive">Hidden</span>' : ''}${p.featured ? '<span class="badge status-processing">Best seller</span>' : ''}<span class="badge ${stockTotal <= 5 ? 'status-pending' : 'status-paid'}">${stockTotal} in stock · ${lengths} length${lengths === 1 ? '' : 's'}</span>${out ? `<span class="badge status-failed">${out} sold out</span>` : ''}</span>
      </span>
    </button>
    <div class="product-admin-actions"><button type="button" class="btn secondary" data-edit-product="${esc(p.id)}">Edit</button><button type="button" class="btn secondary" data-open-stock="${esc(p.id)}">Stock</button></div>
  </article>`;
}

document.addEventListener('input', (event) => {
  if (!event.target.matches('[data-product-search]')) return;
  productSearch = event.target.value;
  const caret = event.target.selectionStart;
  document.querySelector('[data-main]').innerHTML = productsViewHtml();
  const input = document.querySelector('[data-product-search]'); input?.focus(); input?.setSelectionRange(caret, caret);
});

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

function variantRowHtml(v = {}) {
  const hasOverride = v.price != null || v.wholesalePrice != null || v.available === false;
  return `<div class="variant-row">
    <input type="hidden" data-field="id" value="${esc(v.id)}" />
    <div class="variant-main">
      <label class="field">Length / option<input data-field="label" value="${esc(v.label)}" placeholder="e.g. 18 inches" required /></label>
      <label class="field stock-field">How many in stock?<input data-field="stock" type="number" min="0" inputmode="numeric" value="${esc(v.stock ?? '')}" placeholder="0" required /></label>
      <button type="button" class="remove-variant" data-remove-variant aria-label="Remove this length">✕</button>
    </div>
    <details class="variant-extra" ${hasOverride ? 'open' : ''}><summary>Different price for this length?</summary>
      <div class="field-row">
        <label class="field">Price for this length (GHS)<input data-field="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(v.price)}" placeholder="Same as main price" /></label>
        <label class="field">Wholesale price for this length<input data-field="wholesalePrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(v.wholesalePrice)}" placeholder="Same as main wholesale" /></label>
      </div>
      <label class="field checkbox"><input data-field="available" type="checkbox" ${v.available !== false ? 'checked' : ''} /> Available to buy</label>
    </details>
  </div>`;
}

const COMMON_LENGTHS = { wigs: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], bundles: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], extensions: [12, 14, 16, 18, 20, 22, 24, 26], accessories: [] };
const COMMON_OPTIONS = { accessories: ['One size', 'Black', 'Brown', 'Small', 'Medium', 'Large'] };
const TYPE_SUGGESTIONS = { wigs: ['HD lace wig', 'Transparent lace wig', 'Glueless wig', 'Closure wig', 'Frontal wig', 'Bob wig'], bundles: ['Raw hair bundle', 'Virgin hair bundle', 'Bundle deal (3 bundles)'], extensions: ['Clip-in extensions', 'Tape-in extensions', 'Ponytail', 'Closure', 'Frontal'], accessories: ['Finishing accessory', 'Hair care', 'Tools', 'Bonnet & scarf'] };

function lengthChipsHtml(category, existing) {
  const labels = (COMMON_OPTIONS[category] || (COMMON_LENGTHS[category] || []).map((n) => `${n} inches`));
  const have = new Set(existing.map((l) => l.toLowerCase()));
  return labels.map((label) => `<button type="button" class="chip ${have.has(label.toLowerCase()) ? 'is-on' : ''}" data-add-length="${esc(label)}">${have.has(label.toLowerCase()) ? '✓ ' : '+ '}${esc(label.replace(' inches', '"'))}</button>`).join('');
}

function normaliseImages(product) {
  product = product || {}; // new products pass null
  const list = Array.isArray(product.images) && product.images.length ? product.images : (product.image?.url ? [product.image] : []);
  return list.filter((image) => image?.url).map((image) => ({ url: image.url, alt: image.alt || product.name || 'Product photo', focalPoint: image.focalPoint || { x: 50, y: 50 } }));
}

function galleryEditorHtml(images) {
  return `<div class="image-editor" data-image-editor>${images.length ? images.map((image, index) => `<article class="image-editor-card ${index === 0 ? 'is-cover' : ''}"><img src="${esc(image.url)}" alt="${esc(image.alt)}" /><div><strong>${index === 0 ? '★ Cover' : `Photo ${index + 1}`}</strong><span>${index ? `<button type="button" class="make-cover" data-cover-image="${index}">Make cover</button>` : ''}<button type="button" data-remove-image="${index}">Remove</button></span></div></article>`).join('') : '<p class="muted image-empty">No photos yet. Add at least one — the first becomes the cover shoppers see in the shop.</p>'}</div>`;
}

const WIZARD_STEPS = [
  { key: 'basics', title: 'Basics', help: 'Name it and choose where it appears in the shop.' },
  { key: 'photos', title: 'Photos', help: 'Upload clear photos. The first one is the cover.' },
  { key: 'lengths', title: 'Lengths & stock', help: 'Tap each length you sell, then type how many you have.' },
  { key: 'prices', title: 'Prices', help: 'Set the price shoppers pay, and your wholesale price.' },
  { key: 'finish', title: 'Finish', help: 'Add style tags, choose where it shows, then save.' },
];

function productDrawerHtml(product, isNew) {
  const p = product || {};
  const images = normaliseImages(p);
  const category = p.category || 'wigs';
  const variants = p.variants && p.variants.length ? p.variants : [];
  return `<div class="drawer wizard" data-product-drawer data-new="${isNew ? '1' : ''}">
    <div class="drawer-head"><div><h2>${isNew ? 'Add a product' : `Edit ${esc(p.name)}`}</h2><p class="muted wizard-help" data-wizard-help>${WIZARD_STEPS[0].help}</p></div><button type="button" data-close-product aria-label="Close">×</button></div>
    <ol class="wizard-steps">${WIZARD_STEPS.map((step, i) => `<li><button type="button" data-goto-step="${i}" class="${i === 0 ? 'is-current' : ''}" ${isNew && i > 0 ? 'disabled' : ''}><span>${i + 1}</span>${step.title}</button></li>`).join('')}</ol>
    <form data-product-form novalidate>
      <section class="wizard-step" data-step="0">
        <label class="field">Product name<input name="name" value="${esc(p.name)}" placeholder="e.g. Body Wave" required /><small class="field-hint">What shoppers see. Keep it short — the length is chosen separately.</small></label>
        <fieldset class="choice-group"><legend>Category</legend><div class="choices">${CATEGORIES.map((c) => `<label class="choice"><input type="radio" name="category" value="${c}" ${category === c ? 'checked' : ''} /><span>${c[0].toUpperCase() + c.slice(1)}</span></label>`).join('')}</div><small class="field-hint">Decides which part of the shop it appears in.</small></fieldset>
        <label class="field">Type<input name="type" value="${esc(p.type)}" placeholder="e.g. HD lace wig" list="type-suggestions" /><datalist id="type-suggestions" data-type-suggestions>${(TYPE_SUGGESTIONS[category] || []).map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist><small class="field-hint">A few words shown above the name in the shop.</small></label>
        <label class="field">Description<textarea name="description" rows="3" placeholder="e.g. Soft, full body wave with natural movement. Easy to style and holds curls well." required>${esc(p.description)}</textarea><small class="field-hint">One or two sentences about how it looks and feels.</small></label>
        <details class="advanced"><summary>Extra details (optional)</summary>
          <label class="field">Details — one per line<textarea name="details" rows="3" placeholder="100g per bundle&#10;Natural black&#10;Can be dyed">${esc((p.details || []).join('\n'))}</textarea><small class="field-hint">Shown as bullet points on the product page.</small></label>
        </details>
      </section>

      <section class="wizard-step" data-step="1" hidden>
        ${galleryEditorHtml(images)}
        <label class="upload-cta"><input type="file" data-product-image-upload accept="image/*" /><span>${icon('products')} Upload from phone or computer</span><small data-image-upload-status>JPG, PNG or phone photos. Big photos are shrunk automatically.</small></label>
        <details class="advanced"><summary>More options</summary>
          <label class="field">Photo description for the next upload (optional)<input data-image-alt placeholder="e.g. 22-inch body wave, front view" /><small class="field-hint">Helps Google and people using screen readers.</small></label>
          <div class="image-url-row"><input type="url" data-product-image-url placeholder="Or paste an image link" /><button type="button" class="btn secondary" data-add-image-url>Add</button></div>
        </details>
        <p class="guide-tip"><strong>Tip:</strong> natural daylight, plain background, and show the front, side and back.</p>
      </section>

      <section class="wizard-step" data-step="2" hidden>
        <p class="field-label">Tap the lengths you sell:</p>
        <div class="chips" data-length-chips>${lengthChipsHtml(category, variants.map((v) => v.label || ''))}</div>
        <div data-variant-rows>${variants.map(variantRowHtml).join('')}</div>
        <p class="muted empty-lengths" data-empty-lengths ${variants.length ? 'hidden' : ''}>No lengths yet — tap one above, or add your own option.</p>
        <button type="button" class="add-variant" data-add-variant>+ Add a different option (e.g. a colour)</button>
      </section>

      <section class="wizard-step" data-step="3" hidden>
        <div class="field-row">
          <label class="field">Price (GHS)<input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.price)}" placeholder="e.g. 620" required /><small class="field-hint">What shoppers pay. Individual lengths can differ (step 3).</small></label>
          <label class="field">Wholesale price (GHS)<input name="wholesalePrice" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.wholesalePrice)}" placeholder="Optional" /><small class="field-hint">What signed-in wholesale customers pay.</small></label>
        </div>
        <label class="field">Minimum wholesale quantity<input name="minWholesaleQty" type="number" min="1" inputmode="numeric" value="${esc(p.minWholesaleQty ?? 1)}" /><small class="field-hint">Wholesale customers must buy at least this many.</small></label>
      </section>

      <section class="wizard-step" data-step="4" hidden>
        <label class="field">Texture / style tags<input name="tags" value="${esc((p.tags || []).join(', '))}" placeholder="e.g. Body wave, HD lace" data-tags-input /><small class="field-hint">Shoppers filter the shop by these. Tap to add:</small></label>
        <div class="tag-suggestions" data-tag-suggestions>${tagSuggestionsHtml(p.tags || [])}</div>
        <label class="toggle-row"><input name="active" type="checkbox" ${p.active !== false ? 'checked' : ''} /><span><strong>Visible on the website</strong><small>Untick to keep it hidden while you prepare it.</small></span></label>
        <label class="toggle-row"><input name="featured" type="checkbox" ${p.featured ? 'checked' : ''} /><span><strong>Show in “Best sellers” on the homepage</strong><small>Pick your 3–6 most popular pieces.</small></span></label>
        <details class="advanced"><summary>Advanced</summary>
          <label class="field">When a length reaches 0<select name="inventoryPolicy"><option value="deny" ${p.inventoryPolicy !== 'continue' ? 'selected' : ''}>Stop selling it — show “Sold out” (recommended)</option><option value="continue" ${p.inventoryPolicy === 'continue' ? 'selected' : ''}>Keep selling it (pre-order)</option></select></label>
          <label class="field">Badges (comma separated)<input name="badges" value="${esc((p.badges || []).join(', '))}" placeholder="e.g. New, Limited" /></label>
        </details>
        <div class="wizard-summary" data-wizard-summary></div>
      </section>

      <p class="form-error" data-product-error></p>
      <div class="wizard-footer">
        <button type="button" class="btn secondary" data-wizard-back hidden>← Back</button>
        <span class="spacer"></span>
        ${!isNew ? '<button class="btn secondary" type="submit" data-save-anytime>Save changes</button>' : ''}
        <button type="button" class="btn" data-wizard-next>Next →</button>
        <button class="btn" type="submit" data-wizard-save hidden>${isNew ? 'Create product' : 'Save changes'}</button>
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
  const drawer = document.querySelector('[data-product-drawer]');
  const form = drawer.querySelector('[data-product-form]');
  let images = normaliseImages(product);
  let step = 0;
  let furthest = isNew ? 0 : WIZARD_STEPS.length - 1;
  const renderImages = () => { form.querySelector('[data-image-editor]').outerHTML = galleryEditorHtml(images); };
  const category = () => form.querySelector('input[name="category"]:checked')?.value || 'wigs';
  const labels = () => [...form.querySelectorAll('[data-field="label"]')].map((input) => input.value.trim()).filter(Boolean);
  const refreshChips = () => {
    form.querySelector('[data-length-chips]').innerHTML = lengthChipsHtml(category(), labels());
    form.querySelector('[data-empty-lengths]').hidden = form.querySelectorAll('.variant-row').length > 0;
  };
  const errorEl = drawer.querySelector('[data-product-error]');

  function validateStep(i) {
    if (i === 0) {
      if (!form.elements.name.value.trim()) return 'Give the product a name.';
      if (!form.elements.description.value.trim()) return 'Add a short description.';
    }
    if (i === 1 && !images.length) return 'Add at least one photo.';
    if (i === 2) {
      const rows = [...form.querySelectorAll('.variant-row')];
      if (!rows.some((row) => row.querySelector('[data-field="label"]').value.trim())) return 'Add at least one length or option.';
      if (rows.some((row) => { const v = row.querySelector('[data-field="stock"]').value.trim(); return v !== '' && (!/^\d+$/.test(v)); })) return 'Stock must be a whole number (0 or more).';
    }
    if (i === 3 && !(Number(form.elements.price.value) > 0)) return 'Enter the price in cedis.';
    return '';
  }

  function summaryHtml() {
    const rows = [...form.querySelectorAll('.variant-row')].map((row) => ({ label: row.querySelector('[data-field="label"]').value.trim(), stock: Number(row.querySelector('[data-field="stock"]').value) || 0 })).filter((v) => v.label);
    return `<h3>Check before saving</h3><div class="summary-card">${images[0] ? `<img src="${esc(images[0].url)}" alt="" />` : ''}<div><strong>${esc(form.elements.name.value)}</strong><small>${esc(category())}${form.elements.type.value ? ` · ${esc(form.elements.type.value)}` : ''}</small><b>${money(Number(form.elements.price.value))}</b><small>${images.length} photo${images.length === 1 ? '' : 's'} · ${rows.map((r) => `${esc(r.label.replace(' inches', '"'))} (${r.stock})`).join(', ') || 'no lengths'}</small><small>${form.elements.active.checked ? 'Visible on the website' : 'Hidden from the website'}</small></div></div>`;
  }

  function showStep(i) {
    step = i;
    furthest = Math.max(furthest, i);
    drawer.querySelectorAll('.wizard-step').forEach((section) => { section.hidden = Number(section.dataset.step) !== i; });
    drawer.querySelectorAll('[data-goto-step]').forEach((btn) => {
      const n = Number(btn.dataset.gotoStep);
      btn.classList.toggle('is-current', n === i);
      btn.classList.toggle('is-done', n < i || (!isNew && n !== i));
      btn.disabled = n > furthest;
    });
    drawer.querySelector('[data-wizard-help]').textContent = WIZARD_STEPS[i].help;
    drawer.querySelector('[data-wizard-back]').hidden = i === 0;
    const last = i === WIZARD_STEPS.length - 1;
    drawer.querySelector('[data-wizard-next]').hidden = last;
    drawer.querySelector('[data-wizard-save]').hidden = !last;
    if (last) drawer.querySelector('[data-wizard-summary]').innerHTML = summaryHtml();
    errorEl.textContent = '';
    drawer.scrollTop = 0;
  }

  drawer.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-goto-step]');
    if (goto) {
      const target = Number(goto.dataset.gotoStep);
      if (target > step && isNew) { const problem = validateStep(step); if (problem) { errorEl.textContent = problem; return; } }
      return showStep(target);
    }
    if (event.target.closest('[data-wizard-next]')) {
      const problem = validateStep(step);
      if (problem) { errorEl.textContent = problem; return; }
      return showStep(step + 1);
    }
    if (event.target.closest('[data-wizard-back]')) return showStep(step - 1);
    const remove = event.target.closest('[data-remove-image]');
    if (remove) { images.splice(Number(remove.dataset.removeImage), 1); return renderImages(); }
    const cover = event.target.closest('[data-cover-image]');
    if (cover) { const [img] = images.splice(Number(cover.dataset.coverImage), 1); images.unshift(img); return renderImages(); }
    const chip = event.target.closest('[data-add-length]');
    if (chip) {
      const label = chip.dataset.addLength;
      const existing = [...form.querySelectorAll('.variant-row')].find((row) => row.querySelector('[data-field="label"]').value.trim().toLowerCase() === label.toLowerCase());
      if (existing) { existing.remove(); refreshChips(); return; } // tap again to remove
      form.querySelector('[data-variant-rows]').insertAdjacentHTML('beforeend', variantRowHtml({ label }));
      refreshChips();
      form.querySelector('.variant-row:last-child [data-field="stock"]').focus();
      return;
    }
    if (event.target.closest('[data-add-variant]')) {
      form.querySelector('[data-variant-rows]').insertAdjacentHTML('beforeend', variantRowHtml());
      refreshChips();
      form.querySelector('.variant-row:last-child [data-field="label"]').focus();
      return;
    }
    if (event.target.closest('[data-remove-variant]')) { event.target.closest('.variant-row').remove(); refreshChips(); }
  });

  form.addEventListener('change', (event) => {
    if (event.target.name === 'category') {
      refreshChips();
      form.querySelector('[data-type-suggestions]').innerHTML = (TYPE_SUGGESTIONS[category()] || []).map((t) => `<option value="${esc(t)}"></option>`).join('');
    }
    if (event.target.matches('[data-field="label"]')) refreshChips();
  });

  form.querySelector('[data-add-image-url]').addEventListener('click', () => {
    const urlInput = form.querySelector('[data-product-image-url]');
    const url = urlInput.value.trim();
    if (!url) return;
    try { new URL(url); } catch { return toast('Enter a valid image link.'); }
    images.push({ url, alt: form.querySelector('[data-image-alt]').value.trim() || form.elements.name.value.trim() || 'Product photo', focalPoint: { x: 50, y: 50 } });
    urlInput.value = ''; renderImages();
  });
  form.querySelector('[data-product-image-upload]').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    const status = form.querySelector('[data-image-upload-status]');
    event.target.disabled = true;
    try {
      for (const [n, file] of files.entries()) {
        status.textContent = `Uploading photo ${n + 1} of ${files.length}…`;
        const name = form.elements.name.value.trim();
        const url = await adminStore.uploadProductImage({ file, productId: product?.id || slugify(name) || 'nakuadiary-product' });
        images.push({ url, alt: form.querySelector('[data-image-alt]').value.trim() || name || 'Product photo', focalPoint: { x: 50, y: 50 } });
        renderImages();
      }
      status.textContent = files.length > 1 ? `${files.length} photos uploaded.` : 'Photo uploaded.';
    } catch (err) {
      status.textContent = err?.message || 'Upload failed.';
    } finally {
      event.target.value = ''; event.target.disabled = false;
    }
  });
  form.querySelector('[data-product-image-upload]').multiple = true;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (let i = 0; i < WIZARD_STEPS.length; i += 1) {
      const problem = validateStep(i);
      if (problem) { showStep(i); errorEl.textContent = problem; return; }
    }
    const buttons = drawer.querySelectorAll('[type="submit"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const collected = collectProductForm(form, product, isNew, images);
      await adminStore.saveProduct(collected, { isNew, original: product });
      closeDrawer('[data-product-drawer]');
      toast(isNew ? `${collected.name} is now ${collected.active ? 'live on the website' : 'saved (hidden)'}.` : 'Product saved.');
      await loadAndRenderView('products');
    } catch (err) {
      errorEl.textContent = err?.message || 'Could not save this product.';
      buttons.forEach((b) => { b.disabled = false; });
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
  <div class="filters scroll-x">${STATUS_FILTERS.map((s) => `<button type="button" data-order-filter="${s}" class="${orderStatusFilter === s ? 'is-active' : ''}">${s === 'all' ? 'All' : esc(STATUS_LABEL[s])}</button>`).join('')}</div>
  ${filtered.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Account</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${filtered.map(orderRow).join('')}</tbody></table>` : `<div class="empty-state"><p>${ordersCache.length ? 'No orders in this view.' : 'No orders yet.'}</p>${ordersCache.length ? '' : '<p class="muted">When a customer pays, their order appears here — <a href="#/help/orders">see how orders work</a>.</p>'}</div>`}`;
}
function orderRow(o) {
  const flags = [o.refund?.required && o.refund?.status !== 'done' ? '<span class="badge status-refund">Refund due</span>' : '', o.stockIssue ? '<span class="badge status-failed">Stock issue</span>' : '', o.payment?.mismatch ? '<span class="badge status-failed">Amount mismatch</span>' : ''].join(' ');
  return `<tr class="clickable-row" data-view-order="${esc(o.id)}"><td data-label="Order"><strong>${esc(orderRef(o))}</strong></td><td class="muted" data-label="Date">${formatDate(o.createdAt)}</td><td data-label="Customer"><span class="cell-stack">${esc(o.customer?.name || '—')}<small class="muted">${esc(o.customer?.phone)}</small></span></td><td data-label="Account"><span class="badge account-${esc(o.accountType)}">${esc(o.accountType)}</span></td><td data-label="Total"><strong>${money(o.total ?? o.subtotal)}</strong></td><td data-label="Status">${statusBadge(orderStatus(o))} ${flags}</td><td class="row-action"><button class="btn secondary" type="button" data-view-order="${esc(o.id)}">Open</button></td></tr>`;
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

async function openOrderById(id) {
  if (document.querySelector(`[data-order-drawer][data-order-id="${CSS.escape(id)}"]`)) return;
  closeDrawer('[data-order-drawer]');
  let order = ordersCache.find((o) => o.id === id);
  if (!order) { try { order = await adminStore.getOrder(id); } catch { order = null; } }
  if (!order) { toast('That order could not be found.'); history.replaceState(null, '', '#/orders'); return; }
  openOrderDrawer(order);
}

function closeOrderDrawer() {
  if (orderPushed) { orderPushed = false; history.back(); return; } // hashchange closes it
  history.replaceState(null, '', '#/orders');
  closeDrawer('[data-order-drawer]');
}

function openOrderDrawer(order) {
  openDrawer(orderDrawerHtml(order));
  const drawer = document.querySelector('[data-order-drawer]');
  drawer.dataset.orderId = order.id;
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
      orderPushed = false;
      history.replaceState(null, '', '#/orders');
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
  return `<tr><td data-label="Name"><strong>${esc(c.name)}</strong></td><td data-label="Phone"><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></td><td class="muted" data-label="Email">${esc(c.email || '—')}</td><td data-label="Account"><span class="badge account-${esc(c.accountType)}">${esc(c.accountType)}</span></td><td data-label="Orders">${esc(c.orderCount || 0)}</td><td data-label="Spent">${money(c.totalSpent)}</td></tr>`;
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

function phoneAlertsHtml(devices = []) {
  const availability = adminStore.pushAvailability();
  const thisId = adminStore.thisDeviceId();
  const onHere = devices.some((d) => d.id === thisId);
  const action = onHere
    ? `<p class="alert-state on">✓ Order alerts are on for this ${/iphone|android/i.test(navigator.userAgent) ? 'phone' : 'device'}.</p><div class="status-actions"><button type="button" class="btn" data-push-test>Send a test</button><button type="button" class="btn secondary" data-push-enable>Refresh</button></div>`
    : availability === 'ios-install'
      ? `<p class="alert-state">On iPhone, alerts work from the installed app. <strong>Tap Share → Add to Home Screen</strong>, open Nakua Admin from your home screen, then come back here. <a href="#/help/install">Show me how</a></p>`
      : availability === 'denied'
        ? '<p class="alert-state warn">Notifications are blocked for this site. Allow them in your phone or browser settings, then tap the button.</p><button type="button" class="btn" data-push-enable>Turn on order alerts</button>'
        : availability === 'unsupported'
          ? '<p class="alert-state warn">This browser can’t receive notifications. Use Chrome on Android, or the installed app on iPhone.</p>'
          : '<p class="alert-state">Get a notification on this device the moment an order is paid.</p><button type="button" class="btn" data-push-enable>Turn on order alerts</button>';
  return `<section class="cms-card" data-phone-alerts><header class="cms-card-head"><div><h2>Alerts on this phone</h2><p>Push notifications for new paid orders. Turn them on for each phone or computer you use.</p></div></header>
    <div class="cms-card-body">${action}
      ${devices.length ? `<ul class="device-list">${devices.map((d) => `<li><span>${esc(d.label || 'Device')}${d.id === thisId ? ' <em>(this device)</em>' : ''}</span><button type="button" class="link-button" data-push-remove="${esc(d.id)}">Remove</button></li>`).join('')}</ul>` : ''}
    </div></section>`;
}

function notificationsViewHtml(cfg = {}, devices = []) {
  const t = cfg.templates || {};
  return `<div class="view-head"><div><h1>Notifications</h1><p>Alerts on your phone when an order is paid, and the texts customers receive.</p></div></div>
  ${phoneAlertsHtml(devices)}<form class="cms-form" data-sms-form novalidate>
    <div class="view-head cms-head"><div><h2>Text messages (SMS)</h2><p>Texts sent through MNotify when an order is paid or its status changes.</p></div><div class="cms-save"><button class="btn" type="submit">Save changes</button></div></div>
    <section class="cms-card"><header class="cms-card-head"><div><h2>Sending</h2><p>Your sender ID must be approved in your MNotify/BMS dashboard first. Texting is also switched on or off on the server by your developer (the SMS_ENABLED setting); until then, texts show as “Not sent (SMS off)” on each order and can be resent later.</p></div>
      <label class="switch"><input name="enabled" type="checkbox" ${cfg.enabled !== false ? 'checked' : ''} /><span>On</span></label></header>
      <div class="cms-card-body"><div class="field-row">
        <label class="field">Sender ID<input name="senderId" maxlength="11" value="${esc(cfg.senderId || '')}" placeholder="e.g. NAKUADIARY" /><small class="field-hint">Up to 11 letters/numbers — the name customers see.</small></label>
      </div></div></section>
    <section class="cms-card"><header class="cms-card-head"><div><h2>New-order text to you</h2><p>Also get an SMS on your own phone every time an order is paid — works even without mobile data.</p></div>
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
  if (view) { toggleMoreSheet(false); return navigate(view.dataset.view); }
  if (event.target.closest('[data-more-toggle]')) return toggleMoreSheet(document.querySelector('[data-more-sheet]').hidden);
  if (event.target.closest('[data-more-backdrop]')) return toggleMoreSheet(false);

  if (event.target.closest('[data-push-enable]')) {
    const btn = event.target.closest('[data-push-enable]');
    btn.disabled = true; btn.textContent = 'Turning on…';
    try {
      await adminStore.enablePushOnThisDevice();
      toast('Order alerts are on for this device.');
      document.querySelector('[data-phone-alerts]').outerHTML = phoneAlertsHtml(await adminStore.listMyDevices());
    } catch (err) {
      toast(err?.message || 'Could not turn on alerts.');
      btn.disabled = false; btn.textContent = 'Turn on order alerts';
    }
    return;
  }
  if (event.target.closest('[data-push-test]')) {
    const btn = event.target.closest('[data-push-test]');
    btn.disabled = true;
    try {
      const result = await adminStore.sendTestPush();
      toast(result.sent ? 'Test sent — it should arrive in a few seconds.' : 'No devices received it. Tap Refresh and try again.');
    } catch (err) { toast(err?.message || 'Could not send a test.'); }
    btn.disabled = false;
    return;
  }
  const removeDevice = event.target.closest('[data-push-remove]');
  if (removeDevice) {
    if (!window.confirm('Stop order alerts on this device?')) return;
    await adminStore.removeDevice(removeDevice.dataset.pushRemove).catch(() => {});
    document.querySelector('[data-phone-alerts]').outerHTML = phoneAlertsHtml(await adminStore.listMyDevices().catch(() => []));
    return toast('Device removed.');
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
  if (openStock) { stockSearch = productsCache.find((p) => p.id === openStock.dataset.openStock)?.name || ''; stockLowOnly = false; return navigate('stock'); }

  if (event.target.closest('[data-new-product]')) return openProductDrawer(null, true);
  const editProduct = event.target.closest('[data-edit-product]');
  if (editProduct) { const product = productsCache.find((p) => p.id === editProduct.dataset.editProduct); return openProductDrawer(product, false); }
  if (event.target.closest('[data-close-product]')) {
    const isNew = document.querySelector('[data-product-drawer]')?.dataset.new;
    if (isNew && document.querySelector('[data-product-form] [name="name"]')?.value.trim() && !window.confirm('Close without saving this product?')) return;
    return closeDrawer('[data-product-drawer]');
  }
  const addTag = event.target.closest('[data-add-tag]');
  if (addTag) {
    const input = document.querySelector('[data-tags-input]');
    const tags = parseTags(`${input.value},${addTag.dataset.addTag}`);
    input.value = tags.join(', ');
    document.querySelector('[data-tag-suggestions]').innerHTML = tagSuggestionsHtml(tags);
    return;
  }
  const toggleActive = event.target.closest('[data-toggle-active]');
  if (toggleActive) {
    const product = productsCache.find((p) => p.id === toggleActive.dataset.toggleActive);
    await adminStore.setProductActive(product.id, product.active === false);
    closeDrawer('[data-product-drawer]');
    toast(product.active === false ? `${product.name} is back in the shop.` : `${product.name} is hidden from the shop.`);
    return loadAndRenderView('products');
  }

  const orderFilter = event.target.closest('[data-order-filter]');
  if (orderFilter) { orderStatusFilter = orderFilter.dataset.orderFilter; return loadAndRenderView('orders'); }
  const viewOrder = event.target.closest('[data-view-order]');
  if (viewOrder) { orderPushed = true; return navigate('orders', viewOrder.dataset.viewOrder); }
  if (event.target.closest('[data-close-order]')) return closeOrderDrawer();

  if (event.target.closest('[data-new-wholesale]')) return openWholesaleDrawer();
  if (event.target.closest('[data-close-wholesale]')) return closeDrawer('[data-wholesale-drawer]');

  if (event.target.matches('[data-overlay]')) {
    if (document.querySelector('[data-order-drawer]')) return closeOrderDrawer();
    if (document.querySelector('[data-product-drawer]') && !window.confirm('Close without saving this product?')) return;
    closeDrawer('[data-product-drawer]'); closeDrawer('[data-wholesale-drawer]');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!document.querySelector('[data-more-sheet]')?.hidden) return toggleMoreSheet(false);
  if (document.querySelector('[data-order-drawer]')) return closeOrderDrawer();
  if (document.querySelector('[data-wholesale-drawer]')) closeDrawer('[data-wholesale-drawer]');
});

adminStore.onAdminAuthChange((next) => { session = next; renderRoot(); });
