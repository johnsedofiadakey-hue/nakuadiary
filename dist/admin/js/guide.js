// In-app Help guide (Admin → Help, and the "?" on every screen).
// Written for the shop owner, not a developer: what each page is for, how to
// do each task step by step, and what to do next. Each section has an id so
// screens can deep-link to it: #/help/<id>.

const open = (view, label) => `<a class="guide-go" href="#/${view}">${label} →</a>`;
const next = (html) => `<div class="guide-next"><strong>What next?</strong> ${html}</div>`;
const tip = (html) => `<div class="guide-tip"><strong>Tip:</strong> ${html}</div>`;
const steps = (items) => `<ol class="guide-steps">${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;

export const GUIDE = [
  {
    id: 'start',
    title: 'Start here',
    summary: 'What this admin does, and the first things to set up.',
    body: `
      <p>This is the control room for the Nakuadiary website. From here you <strong>see and fulfil orders</strong>, <strong>keep stock up to date</strong>, <strong>add and edit products</strong>, and <strong>change what the website says and shows</strong>. Everything you save here appears on the website straight away.</p>
      <p>At the bottom of your phone screen (or on the left on a computer) are the main pages:</p>
      <ul class="guide-list">
        <li><strong>Home</strong> — what needs your attention today, and your setup checklist.</li>
        <li><strong>Orders</strong> — every order, and the buttons to move it along.</li>
        <li><strong>Stock</strong> — the fastest way to add or correct quantities.</li>
        <li><strong>Products</strong> — add a new product or edit an existing one.</li>
        <li><strong>More</strong> — Customers, Homepage, Settings, Notifications, this Help guide, and Sign out.</li>
      </ul>
      <h3>Your first-day setup (about 15 minutes)</h3>
      ${steps([
        `<strong>Install the app on your phone</strong> so it opens like any other app — see <a href="#/help/install">Install on your phone</a>.`,
        `<strong>Turn on order alerts</strong> so your phone buzzes when someone pays — see <a href="#/help/alerts">Order alerts on your phone</a>.`,
        `<strong>Settings → Contact:</strong> put in your real WhatsApp number and email. ${open('settings', 'Open Settings')}`,
        `<strong>Settings → Delivery:</strong> choose how you charge for delivery and add your pickup location. See <a href="#/help/delivery">Delivery fees</a>.`,
        `<strong>Check your products</strong> have good photos, the right lengths and correct stock. ${open('products', 'Open Products')}`,
        `<strong>Read the policy pages</strong> (Delivery, Returns, Privacy, Terms — links at the bottom of the website) and tell your developer about anything that doesn’t match how you work.`,
      ])}
      ${next('The <strong>Home</strong> page keeps a checklist of these steps and ticks them off as you go.')}`,
  },
  {
    id: 'install',
    title: 'Install on your phone',
    summary: 'Put the admin on your home screen like a normal app.',
    body: `
      <h3>iPhone (Safari)</h3>
      ${steps([
        'Open <strong>nakuadiary.com/admin</strong> in <strong>Safari</strong> (it must be Safari).',
        'Tap the <strong>Share</strong> button (the square with an arrow pointing up).',
        'Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.',
        'Close Safari and open <strong>Nakua Admin</strong> from your home screen. Sign in once.',
      ])}
      ${tip('On iPhone, order alerts only work from the installed app — so do this before turning on alerts.')}
      <h3>Android (Chrome)</h3>
      ${steps([
        'Open <strong>nakuadiary.com/admin</strong> in <strong>Chrome</strong>.',
        'Tap the <strong>⋮</strong> menu (top right), then <strong>Install app</strong> or <strong>Add to Home screen</strong>.',
        'Open <strong>Nakua Admin</strong> from your home screen.',
      ])}
      ${next('Turn on <a href="#/help/alerts">order alerts</a>.')}`,
  },
  {
    id: 'alerts',
    title: 'Order alerts on your phone',
    summary: 'Get a notification the moment an order is paid.',
    body: `
      <p>When a customer pays, your phone shows a notification like <em>“New order · GHS 1,270 — NKD-7F3K9Q, 2 items · Delivery”</em>. Tap it to open that order. Customer names and numbers are never shown on your lock screen.</p>
      ${steps([
        'On iPhone, first <a href="#/help/install">install the app</a> and open it from your home screen.',
        `Go to <strong>More → Notifications</strong>. ${open('notifications', 'Open Notifications')}`,
        'Under <strong>Alerts on this phone</strong>, tap <strong>Turn on order alerts</strong>, then tap <strong>Allow</strong> when your phone asks.',
        'Tap <strong>Send a test</strong>. A test notification should arrive within a few seconds.',
      ])}
      <p>Do this on every phone or computer that should get alerts. You can remove a device from the same screen.</p>
      ${tip('Also add your number under <strong>New-order text to you</strong> — you’ll get an SMS too, which works even when your phone has no data.')}
      <h3>No notification arrived?</h3>
      <ul class="guide-list">
        <li>Check the phone isn’t on <strong>Do Not Disturb / Focus</strong>.</li>
        <li>In your phone’s Settings, find <strong>Nakua Admin</strong> (or Chrome) → Notifications, and make sure they’re allowed.</li>
        <li>On iPhone, make sure you opened the app from the <strong>home screen icon</strong>, not Safari.</li>
        <li>Tap <strong>Turn on order alerts</strong> again — it’s safe to repeat.</li>
      </ul>`,
  },
  {
    id: 'home',
    title: 'The Home page',
    summary: 'Your daily starting point.',
    body: `
      <ul class="guide-list">
        <li><strong>To do now</strong> — paid orders waiting to be prepared, orders out for delivery, and anything that needs attention (refunds due, stock problems). Tap a card to open it.</li>
        <li><strong>Today</strong> — orders and sales so far today, and this week.</li>
        <li><strong>Low stock</strong> — how many lengths are running low or sold out.</li>
        <li><strong>Setup checklist</strong> — the things still to finish. It disappears when everything is done.</li>
      </ul>
      ${next('Start each day on Home and work through <strong>To do now</strong> from top to bottom.')}`,
  },
  {
    id: 'orders',
    title: 'Orders — from payment to delivery',
    summary: 'What each status means and which button to press.',
    body: `
      <p>An order appears in <strong>Orders</strong> as soon as a customer starts paying. You only need to act once it says <strong>Paid</strong>.</p>
      <table class="guide-table"><thead><tr><th>Status</th><th>What it means</th><th>Your next step</th></tr></thead><tbody>
        <tr><td><span class="badge status-pending_payment">Awaiting payment</span></td><td>The customer is on the payment page.</td><td>Nothing. It turns <em>Paid</em> by itself, or closes after 60 minutes if they don’t pay.</td></tr>
        <tr><td><span class="badge status-paid">Paid</span></td><td>Money received and confirmed by Paystack.</td><td>Tap <strong>Start processing</strong> when you begin preparing it.</td></tr>
        <tr><td><span class="badge status-processing">Processing</span></td><td>You’re preparing it.</td><td><strong>Mark dispatched</strong> when a rider takes it, or <strong>Mark delivered</strong> when a pickup customer collects it.</td></tr>
        <tr><td><span class="badge status-dispatched">Dispatched</span></td><td>On the way.</td><td><strong>Mark delivered</strong> when it arrives.</td></tr>
        <tr><td><span class="badge status-delivered">Delivered</span></td><td>Finished.</td><td>Nothing.</td></tr>
        <tr><td><span class="badge status-cancelled">Cancelled</span> / <span class="badge status-failed">Payment failed</span></td><td>Closed.</td><td>If it says <strong>Refund due</strong>, see <a href="#/help/payments">Refunds</a>.</td></tr>
      </tbody></table>
      <h3>Handling a new order, step by step</h3>
      ${steps([
        'Your phone buzzes: <em>New order</em>. Tap it (or open <strong>Orders</strong>).',
        'Check the <strong>items</strong> (photo, length, quantity) and <strong>Customer & delivery</strong> (name, phone — tap to call — and address or pickup).',
        'Tap <strong>Start processing</strong>. The customer automatically gets an SMS that it’s being prepared.',
        'For delivery: hand it to your rider, type a note like <em>“Rider: Kwame, 024…”</em> in the note box, then tap <strong>Mark dispatched</strong>.',
        'When it arrives (or the customer collects it), tap <strong>Mark delivered</strong>.',
      ])}
      ${tip('Every change is recorded in the <strong>Order timeline</strong> with the time and who did it. Customers get an SMS at Paid, Processing, Dispatched and Delivered.')}
      <h3>Cancelling</h3>
      <p>Tap <strong>Cancel order</strong>. The stock goes back on the shelf automatically. If the customer had already paid, the order shows <strong>Refund due</strong> — refund them in Paystack (see <a href="#/help/payments">Payments & refunds</a>).</p>
      <h3>Red warnings on an order</h3>
      <ul class="guide-list">
        <li><strong>Refund due</strong> — a paid order was cancelled. Refund it in Paystack.</li>
        <li><strong>Stock issue</strong> — the customer paid after their 60-minute hold ended and the item had sold out. Restock it, or cancel and refund.</li>
        <li><strong>Amount mismatch</strong> — Paystack reported a different amount. The order was <em>not</em> marked paid. Check the payment in Paystack before doing anything.</li>
      </ul>
      ${next(`Keep ${open('stock', 'Stock')} accurate so customers can’t order what you don’t have.`)}`,
  },
  {
    id: 'stock',
    title: 'Updating stock',
    summary: 'The quickest way to add deliveries or fix counts.',
    body: `
      <p>Every product length (e.g. <em>Body Wave · 20 inches</em>) has its own stock number. Customers can’t buy a length that’s at 0 — the website shows it as <strong>Sold out</strong>.</p>
      ${steps([
        `Open <strong>Stock</strong>. ${open('stock', 'Open Stock')}`,
        'Find the product (use the search box, or tick <strong>Low stock only</strong>).',
        'New delivery arrived? Tap <strong>+1</strong>, <strong>+5</strong> or <strong>+10</strong> on each length.',
        'Counted your shelf? Type the exact number in <strong>Set to…</strong> and tap <strong>Set</strong>.',
        'Damaged or used one yourself? Tap <strong>−</strong>.',
      ])}
      <p>Colours: <span class="stock-count">green</span> in stock, <span class="stock-count is-low">amber</span> 3 or fewer, <span class="stock-count is-out">red</span> sold out.</p>
      ${tip('You don’t need to reduce stock when you sell online — it goes down by itself when an order is paid, and comes back if it’s cancelled or never paid.')}`,
  },
  {
    id: 'products',
    title: 'Adding a product (step by step)',
    summary: 'The 5-step product wizard explained.',
    body: `
      <p>Tap <strong>Products → + Add product</strong>. The wizard has 5 short steps; you can go <strong>Back</strong> at any time and nothing is saved until the last step.</p>
      <h3>Step 1 — Basics</h3>
      <ul class="guide-list">
        <li><strong>Name</strong> — what shoppers see, e.g. <em>Body Wave</em> or <em>Silky Straight HD Lace Wig</em>.</li>
        <li><strong>Category</strong> — Wigs, Bundles, Extensions or Accessories. This decides where it appears in the shop.</li>
        <li><strong>Type</strong> — a short description shown above the name, e.g. <em>HD lace wig</em> or <em>Raw hair bundle</em>.</li>
        <li><strong>Description</strong> — one or two sentences about how it looks and feels.</li>
      </ul>
      <h3>Step 2 — Photos</h3>
      <p>Tap <strong>Upload from phone</strong> and choose a photo. Repeat for more angles. The <strong>first photo is the cover</strong> shoppers see in the shop — tap <strong>Make cover</strong> on another photo to change it. Big photos are shrunk automatically.</p>
      ${tip('Use natural daylight, a plain background, and show the hair from the front, side and back.')}
      <h3>Step 3 — Lengths & stock</h3>
      <p>Tap the lengths you sell (e.g. <strong>18"</strong>, <strong>22"</strong>, <strong>26"</strong>) to add them, then type how many of each you have. For accessories, use <strong>One size</strong> or type your own option (e.g. <em>Black</em>). Different price for a longer length? Open <strong>Different price for this length</strong> under that length.</p>
      <h3>Step 4 — Prices</h3>
      <ul class="guide-list">
        <li><strong>Price</strong> — the normal price in cedis.</li>
        <li><strong>Wholesale price</strong> — what signed-in wholesale customers pay (optional).</li>
        <li><strong>Minimum wholesale quantity</strong> — how many a wholesale customer must buy at that price.</li>
      </ul>
      <h3>Step 5 — Finish</h3>
      <ul class="guide-list">
        <li><strong>Texture / style tags</strong> — tap suggestions like <em>Body wave</em> or <em>HD lace</em>. Shoppers use these to filter the shop.</li>
        <li><strong>Show in Best sellers</strong> — puts it on the homepage.</li>
        <li><strong>Visible on the website</strong> — untick to keep it hidden while you prepare it.</li>
      </ul>
      <p>Check the summary, then tap <strong>Create product</strong>. It’s live on the website immediately.</p>
      ${next('Open the product on the website to check how it looks, and share the link on WhatsApp or Instagram.')}
      <h3>Editing a product</h3>
      <p>Tap <strong>Edit</strong> on any product. You can jump straight to any step using the step buttons at the top, and tap <strong>Save changes</strong> from any step. To stop selling something without deleting it, go to step 5 and untick <strong>Visible on the website</strong>, then save.</p>`,
  },
  {
    id: 'customers',
    title: 'Customers & wholesale accounts',
    summary: 'Your customer list, and setting up salons and resellers.',
    body: `
      <p><strong>Customers</strong> fills itself from paid orders: name, phone, number of orders and total spent.</p>
      <h3>Creating a wholesale account</h3>
      ${steps([
        'A salon or reseller asks for wholesale prices (usually on WhatsApp).',
        '<strong>More → Customers → + Create wholesale account</strong>. Enter their business name, phone and email.',
        'Copy the <strong>temporary password</strong> shown and send it to them on WhatsApp. It’s only shown once.',
        'They tap <strong>Sign in</strong> on the website with their email and that password, and see wholesale prices everywhere. They can change the password with <strong>Forgot password?</strong>.',
      ])}`,
  },
  {
    id: 'website',
    title: 'Changing the website (Homepage & Settings)',
    summary: 'Words, photos, contact details and more.',
    body: `
      <h3>Homepage</h3>
      <p><strong>More → Homepage</strong> lets you change every heading, paragraph, button and photo on the homepage. Each section has a <strong>Show</strong> switch to hide it. Wrap a word in <code>*asterisks*</code> to make it appear in the pink handwriting style. Tap <strong>Save changes</strong> — then <strong>View site</strong> to check it.</p>
      <h3>Settings</h3>
      <ul class="guide-list">
        <li><strong>Brand</strong> — business name and logo.</li>
        <li><strong>Contact</strong> — the WhatsApp number and email used by every button on the website, plus social media links.</li>
        <li><strong>Announcement bar</strong> — a thin message across the top of every page, e.g. <em>“Free delivery in Accra this weekend”</em>.</li>
        <li><strong>Delivery</strong> — see <a href="#/help/delivery">Delivery fees</a>.</li>
        <li><strong>Policies</strong> — your return window and dispatch time, used on the Delivery and Returns pages.</li>
        <li><strong>Brand colours</strong> and <strong>Search & sharing</strong> — how the site looks in Google and WhatsApp previews.</li>
      </ul>`,
  },
  {
    id: 'delivery',
    title: 'Delivery fees',
    summary: 'The four ways to charge for delivery.',
    body: `
      <p><strong>More → Settings → Delivery</strong>. Pickup is always free.</p>
      <table class="guide-table"><thead><tr><th>Option</th><th>What the customer sees</th></tr></thead><tbody>
        <tr><td>Arrange after the order</td><td>No fee online — you agree the fee with them by phone/WhatsApp after they order.</td></tr>
        <tr><td>Free delivery</td><td>Free.</td></tr>
        <tr><td>One flat fee</td><td>The same fee added before they pay.</td></tr>
        <tr><td>Fee by area</td><td>They pick their area at checkout, and that area’s fee is added.</td></tr>
      </tbody></table>
      <p>For <strong>Fee by area</strong>, type one area per line like <code>East Legon | 30</code>. Use <strong>Free delivery over</strong> to make delivery free above an order amount.</p>`,
  },
  {
    id: 'notifications',
    title: 'Customer texts (SMS)',
    summary: 'What customers receive and how to change the wording.',
    body: `
      <p>Customers get an SMS when their order is <strong>paid</strong>, <strong>being prepared</strong>, <strong>on its way</strong> and <strong>delivered</strong>. You can also get a text for every new paid order.</p>
      ${steps([
        `<strong>More → Notifications</strong>. ${open('notifications', 'Open Notifications')}`,
        '<strong>Sender ID</strong> — the name customers see (up to 11 letters), approved in your MNotify/BMS account.',
        '<strong>New-order text to you</strong> — your phone number.',
        '<strong>Message wording</strong> — change any message, or leave it empty to use the default shown in grey.',
      ])}
      <p>Each order shows its texts under <strong>Customer texts (SMS)</strong>. If one says <em>Failed</em> or <em>Not sent</em>, tap <strong>Resend</strong>.</p>`,
  },
  {
    id: 'payments',
    title: 'Payments & refunds (Paystack)',
    summary: 'Where the money goes and how to refund.',
    body: `
      <p>Customers pay by Mobile Money or card through <strong>Paystack</strong>. Paystack pays the money into your bank or MoMo account on its usual schedule. An order only shows <strong>Paid</strong> after Paystack confirms it — never trust a screenshot alone.</p>
      <h3>Refunding a customer</h3>
      ${steps([
        'Open the order in <strong>Orders</strong> and copy the <strong>Paystack reference</strong> under Payment confirmation.',
        'Log in to your <strong>Paystack dashboard</strong> → <strong>Transactions</strong> and search for that reference.',
        'Tap <strong>Refund</strong> and follow the steps. The customer usually receives it within 7–10 working days.',
      ])}
      ${tip('If the order isn’t cancelled yet, tap <strong>Cancel order</strong> first so the stock goes back on the shelf.')}`,
  },
  {
    id: 'routine',
    title: 'Daily & weekly routine',
    summary: 'A simple habit that keeps everything running.',
    body: `
      <h3>Every day</h3>
      ${steps([
        'Open <strong>Home</strong> and clear <strong>To do now</strong>: start processing paid orders, dispatch and deliver.',
        'Reply to any customer WhatsApp messages about orders — their reference (NKD-…) is on the order.',
        'When new hair arrives, add it in <strong>Stock</strong>.',
      ])}
      <h3>Every week</h3>
      ${steps([
        'Tick <strong>Low stock only</strong> in Stock and reorder what’s running low.',
        'Check <strong>Orders</strong> for anything still <em>Processing</em> or <em>Dispatched</em> from earlier in the week.',
        'Refresh the homepage photos or announcement bar for promotions.',
      ])}`,
  },
  {
    id: 'help',
    title: 'Troubleshooting',
    summary: 'Common questions and quick fixes.',
    body: `
      <dl class="guide-faq">
        <dt>A customer says they paid but the order isn’t Paid.</dt>
        <dd>Wait a few minutes — payments usually confirm within seconds but can take longer. The system also re-checks unpaid orders with Paystack every 15 minutes. Search their phone or reference in your Paystack dashboard. Never mark an order paid from a screenshot.</dd>
        <dt>I changed something but the website still shows the old version.</dt>
        <dd>Make sure you tapped <strong>Save changes</strong>, then refresh the website page (pull down on phone).</dd>
        <dt>A product isn’t showing in the shop.</dt>
        <dd>Edit it and check <strong>Visible on the website</strong> is ticked, and that it has at least one photo and one length.</dd>
        <dt>Customers can’t buy a length.</dt>
        <dd>Its stock is 0 — add stock in <strong>Stock</strong>.</dd>
        <dt>I forgot my password.</dt>
        <dd>On the sign-in screen tap <strong>Forgot password?</strong>, enter your email, and follow the link sent to you (check spam).</dd>
        <dt>Something else isn’t working.</dt>
        <dd>Take a screenshot and note the order reference (NKD-…) if there is one, and send it to your developer.</dd>
      </dl>`,
  },
];
