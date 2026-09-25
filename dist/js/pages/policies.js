// Customer policy pages: /privacy, /terms, /refunds, /delivery.
// Business name, contact details, delivery fees, pickup details, the return
// window and dispatch time are pulled from Admin → Settings, so the pages stay
// accurate when those change. Have the wording reviewed by a Ghanaian lawyer
// before relying on it — this is a sound starting point, not legal advice.
import { escapeHtml as esc } from '../site-content.js?v=2';

function contactHtml(ctx) {
  const parts = [];
  if (ctx.whatsapp) parts.push(`WhatsApp: <a href="${esc(ctx.whatsappLink)}" target="_blank" rel="noopener">+${esc(ctx.whatsapp)}</a>`);
  if (ctx.email) parts.push(`Email: <a href="mailto:${esc(ctx.email)}">${esc(ctx.email)}</a>`);
  return parts.join(' · ');
}

const header = (title, ctx, intro) => `<p class="eyebrow">${esc(ctx.businessName)}</p><h1>${title}</h1><p class="policy-updated">Last updated ${esc(ctx.policies.lastUpdated)}</p>${intro ? `<p class="policy-intro">${intro}</p>` : ''}`;
const section = (title, body) => `<section><h2>${title}</h2>${body}</section>`;
const policyNav = (current) => `<nav class="policy-nav" aria-label="Policies">${[['delivery', 'Delivery & pickup'], ['refunds', 'Returns & refunds'], ['privacy', 'Privacy'], ['terms', 'Terms']].map(([key, label]) => (key === current ? `<span>${label}</span>` : `<a href="/${key}">${label}</a>`)).join('')}</nav>`;

function deliveryFeesHtml(ctx) {
  const d = ctx.delivery;
  const freeOver = Number(d.freeOver) || 0;
  const free = freeOver > 0 ? `<p>Delivery is <strong>free on orders over ${ctx.money(freeOver)}</strong>.</p>` : '';
  if (d.mode === 'free') return '<p>Delivery is <strong>free</strong>.</p>';
  if (d.mode === 'flat') return `<p>Delivery costs <strong>${ctx.money(Number(d.flatFee) || 0)}</strong>, added at checkout before you pay.</p>${free}`;
  if (d.mode === 'zones' && ctx.zones.length) {
    return `<p>Delivery fees depend on your area and are added at checkout before you pay:</p><table class="policy-table"><thead><tr><th>Area</th><th>Fee</th></tr></thead><tbody>${ctx.zones.map((z) => `<tr><td>${esc(z.name)}</td><td>${ctx.money(z.fee)}</td></tr>`).join('')}</tbody></table>${free}<p>Outside these areas? Message us before ordering and we’ll quote you.</p>`;
  }
  return '<p>Delivery fees depend on your location. We confirm the fee and delivery arrangements with you by phone or WhatsApp after you order, before anything is dispatched.</p>';
}

const PAGES = {
  delivery: (ctx) => ({
    title: 'Delivery & pickup',
    description: `How ${ctx.businessName} delivers orders, delivery fees, and pickup details.`,
    html: `${header('Delivery &amp; <em>pickup</em>', ctx, 'Every order is packed with care and sent once payment is confirmed.')}
      ${section('When your order ships', `<p>Orders are prepared within <strong>${esc(ctx.policies.dispatchTime)}</strong> of payment being confirmed. You’ll receive SMS updates when your order is being prepared, when it’s on its way, and when it’s delivered.</p>`)}
      ${section('Delivery fees', deliveryFeesHtml(ctx))}
      ${section('Pickup', ctx.delivery.pickupAddress
        ? `<p>Choose <strong>Pickup</strong> at checkout to collect your order for free from:</p><p class="policy-callout">${esc(ctx.delivery.pickupAddress)}${ctx.delivery.pickupHours ? `<br><small>${esc(ctx.delivery.pickupHours)}</small>` : ''}</p><p>Please wait for our message that your order is ready, and bring your order reference.</p>`
        : '<p>Choose <strong>Pickup</strong> at checkout to collect your order for free. We’ll message you with the pickup location and time once it’s ready — please bring your order reference.</p>')}
      ${section('Receiving your order', '<ul><li>Please make sure your phone number and address or landmark are correct — our rider will call that number.</li><li>If a delivery can’t be completed because nobody is available, we’ll arrange a new time with you; a second delivery may carry an extra fee.</li><li>Check your parcel when it arrives. If anything is wrong or damaged, tell us within 48 hours (see <a href="/refunds">Returns &amp; refunds</a>).</li></ul>')}
      ${section('Wholesale orders', '<p>Bulk and wholesale deliveries are arranged individually. We’ll confirm timing and any delivery cost with you directly.</p>')}
      ${section('Questions', `<p>${contactHtml(ctx)}</p>`)}
      ${policyNav('delivery')}`,
  }),

  refunds: (ctx) => ({
    title: 'Returns & refunds',
    description: `${ctx.businessName} returns, exchanges and refunds policy.`,
    html: `${header('Returns &amp; <em>refunds</em>', ctx, 'Because hair is a personal hygiene product, we can only take back items that are exactly as you received them. Here’s how it works.')}
      ${section('Items we can take back', `<p>You can ask for an exchange or refund within <strong>${esc(String(ctx.policies.returnWindowDays))} days</strong> of delivery or collection, if the item is:</p><ul><li>unworn, unwashed and unstyled;</li><li>with the lace <strong>uncut</strong> and the bundles still tied/wefted as supplied;</li><li>in its original packaging with any tags or hairnets.</li></ul>`)}
      ${section('Wrong, damaged or faulty items', '<p>If you received the wrong item, or it arrived damaged or faulty, message us <strong>within 48 hours</strong> with your order reference and clear photos or a short video. We’ll replace it or refund you in full, including the delivery fee.</p>')}
      ${section('Items we can’t take back', '<ul><li>Hair that has been worn, washed, cut, coloured, bleached, styled or had its lace cut.</li><li>Custom or made-to-order units.</li><li>Opened accessories and hair-care items, for hygiene reasons.</li></ul><p>This doesn’t affect your rights if an item is faulty.</p>')}
      ${section('Cancelling an order', '<p>You can cancel any time <strong>before your order is dispatched or collected</strong> for a full refund — just message us with your order reference.</p>')}
      ${section('How refunds are paid', '<p>Once we’ve received and checked a returned item, we’ll confirm your refund. Refunds are paid back to the <strong>original payment method</strong> (Mobile Money or card) through our payment provider, Paystack. They usually arrive within 7–10 working days, depending on your network or bank. Delivery fees are only refunded when the mistake was ours.</p>')}
      ${section('Start a return', `<p>Message us with your order reference and what you’d like to return: ${contactHtml(ctx)}. Please don’t send items back before we’ve confirmed the return with you.</p>`)}
      ${policyNav('refunds')}`,
  }),

  privacy: (ctx) => ({
    title: 'Privacy policy',
    description: `How ${ctx.businessName} collects and protects your personal information.`,
    html: `${header('Privacy <em>policy</em>', ctx, `${esc(ctx.businessName)} respects your privacy. This policy explains what we collect when you shop with us, why, and your rights under Ghana’s Data Protection Act, 2012 (Act 843).`)}
      ${section('What we collect', '<ul><li><strong>Order details:</strong> your name, phone number, delivery or pickup choice, address or landmark, and what you ordered.</li><li><strong>Wholesale accounts:</strong> business or contact name, phone number and email address.</li><li><strong>Payment:</strong> payments are processed by Paystack. We receive a confirmation and reference, and the payment method type (for example Mobile Money or card) — <strong>we never see or store your card number or Mobile Money PIN</strong>.</li><li><strong>Your device:</strong> a small anonymous identifier and your cart are stored in your browser so your cart works. We don’t use advertising trackers.</li></ul>')}
      ${section('How we use it', '<ul><li>To process, deliver and support your order, including SMS updates about your order.</li><li>To confirm payments and prevent fraud.</li><li>To manage wholesale accounts and pricing.</li><li>To keep the business and tax records the law requires.</li></ul><p>We don’t sell your personal information, and we don’t send you marketing messages unless you’ve asked us to.</p>')}
      ${section('Who we share it with', '<p>Only the service providers we need to run the shop, and only what they need:</p><ul><li><strong>Paystack</strong> — to process payments.</li><li><strong>mNotify (BMS)</strong> — to send order SMS to your phone number.</li><li><strong>Google Firebase</strong> — to host this website and store orders securely.</li><li><strong>Our delivery riders</strong> — your name, phone number and delivery location, to deliver your order.</li></ul><p>We may also disclose information if the law requires it.</p>')}
      ${section('How long we keep it', '<p>We keep order records for as long as needed for accounting and tax purposes (generally up to six years), then delete or anonymise them. You can ask us to delete other information sooner.</p>')}
      ${section('Keeping it safe', '<p>Your information is stored on secured servers. Access is limited to authorised staff, and payment and messaging keys are kept in protected systems, never on this website.</p>')}
      ${section('Your rights', `<p>You can ask to see the personal information we hold about you, have it corrected, or have it deleted where we don’t need to keep it. Contact us and we’ll respond within a reasonable time: ${contactHtml(ctx)}. You can also contact Ghana’s Data Protection Commission.</p>`)}
      ${section('Children', '<p>Our shop is intended for adults. If you’re under 18, please shop with a parent or guardian.</p>')}
      ${section('Changes', '<p>If we change this policy we’ll update the date at the top of this page.</p>')}
      ${policyNav('privacy')}`,
  }),

  terms: (ctx) => ({
    title: 'Terms of service',
    description: `Terms for shopping with ${ctx.businessName}.`,
    html: `${header('Terms of <em>service</em>', ctx, `These terms apply when you shop on this website. By placing an order you agree to them.`)}
      ${section('Orders', '<p>Your order is confirmed once your payment has been received and verified. While you pay, we hold the items in your cart for up to 60 minutes. If an item becomes unavailable after you’ve paid, we’ll contact you to offer an alternative or a full refund.</p>')}
      ${section('Prices and payment', '<p>All prices are in Ghana cedis (GHS). Payments are processed securely by Paystack by Mobile Money or card. Delivery fees, where charged, are shown before you pay. If a price is clearly wrong because of an error, we’ll contact you before processing the order.</p>')}
      ${section('Product information', '<p>We describe and photograph our products as accurately as we can. Human hair is a natural product, so colour, texture and lustre can vary slightly from photos and between batches. Lengths are measured straight.</p>')}
      ${section('Delivery, returns and refunds', '<p>Please see our <a href="/delivery">Delivery &amp; pickup</a> and <a href="/refunds">Returns &amp; refunds</a> policies, which form part of these terms.</p>')}
      ${section('Wholesale accounts', '<p>Wholesale accounts are created by us for approved businesses. Wholesale prices and minimum quantities apply only to orders placed while signed in to that account. Keep your login details private — you’re responsible for orders placed with your account. We may suspend accounts that are misused.</p>')}
      ${section('Using this website', '<p>Please don’t misuse the website, attempt to access other people’s information, or interfere with its operation. Photos, text and branding on this site belong to us or our licensors and may not be reused without permission.</p>')}
      ${section('Liability', '<p>Nothing in these terms limits your rights under Ghanaian consumer law. Beyond those rights, our responsibility for any order is limited to the amount you paid for it, and we aren’t responsible for delays caused by events outside our control.</p>')}
      ${section('Governing law', '<p>These terms are governed by the laws of the Republic of Ghana.</p>')}
      ${section('Contact', `<p>${contactHtml(ctx)}</p>`)}
      ${policyNav('terms')}`,
  }),
};

export function policyPage(page, ctx) {
  return (PAGES[page] || PAGES.terms)(ctx);
}
