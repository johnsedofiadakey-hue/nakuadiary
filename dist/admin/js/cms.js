// Homepage + Settings editors (the CMS). Every input's `name` is a dotted
// path into the site/home or site/settings doc (e.g. "hero.image.url",
// "categories.tiles.2.label"), so collectCmsForm() can rebuild the doc
// generically. Shapes and defaults live in /js/site-content.js.
import { DEFAULT_HOME, DEFAULT_SETTINGS, escapeHtml as esc, isHexColour } from '/js/site-content.js?v=2';

const ACCENT_HINT = 'Wrap words in *asterisks* for the pink script accent. Press Enter for a new line.';

// ---- Field builders ----------------------------------------------------------

function textField(name, label, value, { multiline = false, rows = 2, placeholder = '', hint = '', type = 'text' } = {}) {
  const control = multiline
    ? `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
  return `<label class="field">${label}${control}${hint ? `<small class="field-hint">${hint}</small>` : ''}</label>`;
}

function linesField(name, label, values, hint = 'One per line.') {
  return `<label class="field">${label}<textarea name="${name}" data-kind="lines" rows="${Math.max(2, values.length + 1)}">${esc(values.join('\n'))}</textarea><small class="field-hint">${hint}</small></label>`;
}

function selectField(name, label, value, options, hint = '') {
  return `<label class="field">${label}<select name="${name}">${options.map(([v, text]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>${hint ? `<small class="field-hint">${hint}</small>` : ''}</label>`;
}

function numberField(name, label, value, { hint = '', min = 0, max = 100000, step = '0.01' } = {}) {
  return `<label class="field">${label}<input name="${name}" type="number" data-kind="number" min="${min}" max="${max}" step="${step}" inputmode="decimal" value="${esc(value)}" />${hint ? `<small class="field-hint">${hint}</small>` : ''}</label>`;
}

/** Delivery areas as "Area | fee" lines — easier on a phone than a table editor. */
function zonesField(name, label, zones) {
  const text = (zones || []).map((z) => `${z.name} | ${z.fee}`).join('\n');
  return `<label class="field">${label}<textarea name="${name}" data-kind="zones" rows="${Math.max(3, (zones || []).length + 1)}" placeholder="East Legon | 30&#10;Tema | 45&#10;Kumasi | 80">${esc(text)}</textarea><small class="field-hint">One area per line: <code>Area | fee in GHS</code>. Customers pick their area at checkout.</small></label>`;
}

function toggleField(name, label, checked) {
  return `<label class="field checkbox"><input name="${name}" type="checkbox" data-kind="bool" ${checked ? 'checked' : ''} /> ${label}</label>`;
}

function colourField(name, label, value, fallback) {
  const colour = isHexColour(value) ? value : fallback;
  return `<label class="field colour-field">${label}<span><input name="${name}" type="color" value="${esc(colour)}" /><code data-colour-value>${esc(colour)}</code><button type="button" class="link-button" data-colour-reset="${esc(fallback)}">Reset</button></span></label>`;
}

/** Photo picker: preview + upload-from-device + remove/default + alt text. */
function imageField(name, label, image, { hint = '', defaultUrl = '', wide = false } = {}) {
  const url = image?.url || '';
  return `<div class="cms-image ${wide ? 'wide' : ''}" data-cms-image="${name}" data-default-url="${esc(defaultUrl)}">
    <div class="cms-image-preview" data-cms-preview>${url ? `<img src="${esc(url)}" alt="" />` : '<span>No photo</span>'}</div>
    <div class="cms-image-body">
      <strong>${label}</strong>
      ${hint ? `<small class="field-hint">${hint}</small>` : ''}
      <div class="cms-image-actions">
        <label class="btn secondary upload-button">Upload photo<input type="file" accept="image/*" data-cms-upload /></label>
        <button type="button" class="btn secondary" data-cms-clear>${defaultUrl ? 'Use default' : 'Remove'}</button>
      </div>
      <small class="cms-upload-status" data-cms-status></small>
      <input type="hidden" name="${name}.url" value="${esc(url)}" />
      <label class="field compact">Photo description <span class="muted">(for screen readers &amp; Google)</span><input name="${name}.alt" value="${esc(image?.alt || '')}" /></label>
    </div>
  </div>`;
}

function card(title, description, body, { toggleName, toggleOn } = {}) {
  return `<section class="cms-card">
    <header class="cms-card-head">
      <div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>
      ${toggleName ? `<label class="switch"><input name="${toggleName}" type="checkbox" data-kind="bool" ${toggleOn ? 'checked' : ''} /><span>Show</span></label>` : ''}
    </header>
    <div class="cms-card-body">${body}</div>
  </section>`;
}

function saveBar(title, subtitle) {
  return `<div class="view-head cms-head">
    <div><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="cms-save">
      <span class="cms-dirty" data-cms-state>All changes saved</span>
      <a class="btn secondary" href="/" target="_blank" rel="noopener">View site ↗</a>
      <button class="btn" type="submit" data-cms-save>Save changes</button>
    </div>
  </div>`;
}

// ---- Homepage editor ----------------------------------------------------------

export function homepageViewHtml(home) {
  const { hero, categories, paths, featured, steps, newsletter } = home;
  return `<form class="cms-form" data-cms-form="home" novalidate>
    ${saveBar('Homepage', 'Edit the words and photos on your homepage. Changes go live as soon as you save.')}

    ${card('Hero', 'The first thing shoppers see.', `
      <div class="cms-split">
        <div>
          ${textField('hero.eyebrow', 'Small intro line', hero.eyebrow)}
          ${textField('hero.headline', 'Headline', hero.headline, { multiline: true, rows: 3, hint: ACCENT_HINT })}
          ${textField('hero.body', 'Paragraph', hero.body, { multiline: true, rows: 3 })}
          <div class="field-row">
            ${textField('hero.primaryCta.label', 'Main button text', hero.primaryCta.label)}
            ${textField('hero.primaryCta.href', 'Main button link', hero.primaryCta.href, { placeholder: '/shop' })}
          </div>
          <div class="field-row">
            ${textField('hero.secondaryCta.label', 'Second button text', hero.secondaryCta.label, { hint: 'Leave empty to hide.' })}
            ${textField('hero.secondaryCta.href', 'Second button link', hero.secondaryCta.href, { placeholder: '/wholesale' })}
          </div>
          ${linesField('hero.badges', 'Badges under the hero', hero.badges)}
        </div>
        <div>
          ${imageField('hero.image', 'Hero photo (mobile)', hero.image, { hint: 'Portrait photos work best (4:5). This loads first on phones.', defaultUrl: DEFAULT_HOME.hero.image.url, wide: true })}
          ${imageField('hero.desktopImage', 'Hero photo (desktop)', hero.desktopImage, { hint: 'Wide images work best (21:9). This prevents a portrait photo from being cropped on large screens.', defaultUrl: DEFAULT_HOME.hero.desktopImage.url, wide: true })}
          ${textField('hero.videoUrl', 'Hero video link', hero.videoUrl || '', { hint: 'Optional. A short, silent MP4 (under 40 MB, ideally under 8 MB). Upload it below or paste a link; clear the box to remove it. The photo above stays as the fast-loading fallback.' })}
          <div class="cms-image-actions video-actions"><label class="btn secondary upload-button">Upload video<input type="file" accept="video/mp4" data-cms-video-upload /></label><small class="cms-upload-status" data-cms-video-status></small></div>
          ${toggleField('hero.showLogoPanel', 'Show the floating logo card on the photo', hero.showLogoPanel)}
          ${imageField('hero.logoPanelImage', 'Floating logo card', hero.logoPanelImage, { defaultUrl: DEFAULT_HOME.hero.logoPanelImage.url })}
          ${textField('hero.motionLabel', 'Photo tag', hero.motionLabel, { hint: 'Small label on the top corner of the photo. Leave empty to hide.' })}
        </div>
      </div>`, { toggleName: 'hero.show', toggleOn: hero.show })}

    ${card('Shop by category', 'Four tiles linking to each part of the shop. Photos are optional.', `
      <div class="field-row">
        ${textField('categories.eyebrow', 'Small intro line', categories.eyebrow)}
        ${textField('categories.title', 'Section title', categories.title, { hint: ACCENT_HINT })}
      </div>
      <div class="cms-grid">${categories.tiles.map((tile, i) => `<div class="cms-subcard">
        <p class="cms-subcard-label">Links to /shop?category=${esc(tile.id)}</p>
        ${textField(`categories.tiles.${i}.label`, 'Name', tile.label)}
        ${textField(`categories.tiles.${i}.detail`, 'Short description', tile.detail)}
        ${imageField(`categories.tiles.${i}.image`, 'Tile photo', tile.image, { hint: 'Optional · landscape (4:3).' })}
      </div>`).join('')}</div>`, { toggleName: 'categories.show', toggleOn: categories.show })}

    ${card('Retail & wholesale', 'Two cards that point shoppers to the right place.', `
      <div class="field-row">
        ${textField('paths.eyebrow', 'Small intro line', paths.eyebrow)}
        ${textField('paths.title', 'Section title', paths.title, { hint: ACCENT_HINT })}
      </div>
      <div class="cms-grid two">${['retail', 'wholesale'].map((key) => `<div class="cms-subcard">
        <p class="cms-subcard-label">${key === 'retail' ? 'Retail card → /shop' : 'Wholesale card → /wholesale'}</p>
        ${textField(`paths.${key}.eyebrow`, 'Label', paths[key].eyebrow)}
        ${textField(`paths.${key}.title`, 'Title', paths[key].title)}
        ${textField(`paths.${key}.body`, 'Text', paths[key].body, { multiline: true, rows: 3 })}
        ${textField(`paths.${key}.ctaLabel`, 'Button text', paths[key].ctaLabel)}
      </div>`).join('')}</div>`, { toggleName: 'paths.show', toggleOn: paths.show })}

    ${card('Best sellers', 'Shows products marked <strong>Featured</strong> in Products. Their photos are managed there.', `
      <div class="field-row">
        ${textField('featured.eyebrow', 'Small intro line', featured.eyebrow)}
        ${textField('featured.title', 'Section title', featured.title, { hint: ACCENT_HINT })}
      </div>
      ${textField('featured.emptyText', 'Message when nothing is featured', featured.emptyText)}`, { toggleName: 'featured.show', toggleOn: featured.show })}

    ${card('How it works', 'Three numbered steps.', `
      <div class="field-row">
        ${textField('steps.eyebrow', 'Small intro line', steps.eyebrow)}
        ${textField('steps.title', 'Section title', steps.title, { hint: ACCENT_HINT })}
      </div>
      <div class="cms-grid three">${steps.items.map((step, i) => `<div class="cms-subcard">
        <p class="cms-subcard-label">Step ${String(i + 1).padStart(2, '0')}</p>
        ${textField(`steps.items.${i}.title`, 'Title', step.title)}
        ${textField(`steps.items.${i}.body`, 'Text', step.body, { multiline: true, rows: 3 })}
      </div>`).join('')}</div>`, { toggleName: 'steps.show', toggleOn: steps.show })}

    ${card('Mailing list', 'The closing call-to-action at the bottom of the page.', `
      <div class="field-row">
        ${textField('newsletter.eyebrow', 'Small intro line', newsletter.eyebrow)}
        ${textField('newsletter.title', 'Title', newsletter.title, { hint: ACCENT_HINT })}
      </div>
      ${textField('newsletter.body', 'Text', newsletter.body, { multiline: true })}
      <div class="field-row">
        ${textField('newsletter.ctaLabel', 'Button text', newsletter.ctaLabel, { hint: 'Leave empty to hide the button.' })}
        ${textField('newsletter.ctaHref', 'Button link', newsletter.ctaHref, { placeholder: 'Emails your contact address', hint: 'Optional — e.g. a WhatsApp channel or form link.' })}
      </div>`, { toggleName: 'newsletter.show', toggleOn: newsletter.show })}

    <p class="form-error" data-cms-error></p>
  </form>`;
}

// ---- Settings editor ------------------------------------------------------------

export function settingsViewHtml(settings) {
  const { brand, contact, announcement, shop, footer, theme, seo } = settings;
  return `<form class="cms-form" data-cms-form="settings" novalidate>
    ${saveBar('Settings', 'Brand, contact details and site-wide options.')}

    ${card('Brand', 'Your name and logo across the header and footer.', `
      <div class="cms-split">
        <div>
          ${textField('brand.businessName', 'Business name', brand.businessName)}
          ${toggleField('brand.showWordmark', 'Show the “NAKUAdiary” wordmark next to the logo', brand.showWordmark)}
        </div>
        ${imageField('brand.logo', 'Logo', brand.logo, { hint: 'Square PNG with a transparent background works best.', defaultUrl: DEFAULT_SETTINGS.brand.logo.url })}
      </div>`)}

    ${card('Contact', 'Used by every WhatsApp and email button on the site.', `
      <div class="field-row">
        ${textField('contact.whatsappNumber', 'WhatsApp number', contact.whatsappNumber, { placeholder: '233241234567', hint: 'e.g. 024 123 4567 — it is saved in international format automatically.' })}
        ${textField('contact.email', 'Contact email', contact.email, { type: 'email' })}
      </div>
      <div class="field-row three">
        ${textField('contact.instagramUrl', 'Instagram link', contact.instagramUrl, { placeholder: 'https://instagram.com/…' })}
        ${textField('contact.tiktokUrl', 'TikTok link', contact.tiktokUrl, { placeholder: 'https://tiktok.com/@…' })}
        ${textField('contact.facebookUrl', 'Facebook link', contact.facebookUrl, { placeholder: 'https://facebook.com/…' })}
      </div>
      <small class="field-hint">Social links appear in the footer. Leave empty to hide.</small>`)}

    ${card('Announcement bar', 'A thin strip above the header on every page — promos, delivery news, holiday hours.', `
      ${textField('announcement.text', 'Message', announcement.text)}
      ${textField('announcement.link', 'Link (optional)', announcement.link, { placeholder: '/shop' })}`, { toggleName: 'announcement.enabled', toggleOn: announcement.enabled })}

    ${card('Delivery', 'How delivery is priced at checkout. Pickup is always free. The fee is added to the Paystack payment.', `
      ${selectField('delivery.mode', 'Delivery pricing', settings.delivery.mode, [
        ['arranged', 'Arrange after the order (no fee charged online)'],
        ['free', 'Free delivery'],
        ['flat', 'One flat fee'],
        ['zones', 'Fee by area'],
      ], 'Choose “Fee by area” to list the places you deliver to with their prices.')}
      <div class="field-row">
        ${numberField('delivery.flatFee', 'Flat fee (GHS)', settings.delivery.flatFee, { hint: 'Used with “One flat fee”.' })}
        ${numberField('delivery.freeOver', 'Free delivery over (GHS)', settings.delivery.freeOver, { hint: '0 = no free-delivery threshold.' })}
      </div>
      ${zonesField('delivery.zones', 'Delivery areas and fees', settings.delivery.zones)}
      <div class="field-row">
        ${textField('delivery.pickupAddress', 'Pickup location', settings.delivery.pickupAddress, { placeholder: 'e.g. Shop 12, Accra Mall, Spintex Road' })}
        ${textField('delivery.pickupHours', 'Pickup hours', settings.delivery.pickupHours, { placeholder: 'e.g. Mon–Sat, 10am–6pm' })}
      </div>`)}

    ${card('Policies', 'Used on the Delivery and Returns pages linked in the footer.', `
      <div class="field-row three">
        ${numberField('policies.returnWindowDays', 'Return window (days)', settings.policies.returnWindowDays, { step: '1', max: 60 })}
        ${textField('policies.dispatchTime', 'Dispatch time', settings.policies.dispatchTime, { placeholder: '1–2 working days' })}
        ${textField('policies.lastUpdated', 'Policies last updated', settings.policies.lastUpdated, { type: 'date' })}
      </div>
      <p class="field-hint">Preview: <a href="/delivery" target="_blank" rel="noopener">Delivery</a> · <a href="/refunds" target="_blank" rel="noopener">Returns</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></p>`)}

    ${card('Checkout & footer', '', `
      ${textField('shop.deliveryNote', 'Delivery note in the shopping bag', shop.deliveryNote, { multiline: true })}
      ${textField('footer.tagline', 'Footer tagline', footer.tagline)}
      ${toggleField('footer.showAdminLink', 'Show the small “Admin login” link in the footer', footer.showAdminLink)}`)}

    ${card('Brand colours', 'Buttons, links and accents across the storefront.', `
      <div class="field-row">
        ${colourField('theme.accent', 'Accent', theme.accent, DEFAULT_SETTINGS.theme.accent)}
        ${colourField('theme.accentDark', 'Accent (dark — hovers & script text)', theme.accentDark, DEFAULT_SETTINGS.theme.accentDark)}
      </div>`)}

    ${card('Search & sharing', 'How the homepage looks in Google results and when shared on WhatsApp or social media.', `
      <div class="cms-split">
        <div>
          ${textField('seo.title', 'Page title', seo.title, { hint: 'Aim for under 60 characters.' })}
          ${textField('seo.description', 'Description', seo.description, { multiline: true, rows: 3, hint: 'Aim for under 160 characters.' })}
        </div>
        ${imageField('seo.shareImage', 'Share image', seo.shareImage, { hint: 'Landscape, 1200 × 630.', defaultUrl: DEFAULT_SETTINGS.seo.shareImage.url })}
      </div>`)}

    <p class="form-error" data-cms-error></p>
  </form>`;
}

// ---- Collect / validate -----------------------------------------------------------

function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  keys.slice(0, -1).forEach((key, index) => {
    if (node[key] === undefined || node[key] === null) node[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    node = node[key];
  });
  node[keys.at(-1)] = value;
}

/** Rebuilds the doc from the form, starting from `base` so unknown fields survive. */
export function collectCmsForm(form, base) {
  const data = structuredClone(base);
  for (const el of form.elements) {
    if (!el.name || el.type === 'file') continue;
    const kind = el.dataset.kind;
    const value = kind === 'bool' ? el.checked
      : kind === 'lines' ? el.value.split('\n').map((line) => line.trim()).filter(Boolean)
      : kind === 'number' ? (el.value.trim() === '' ? 0 : Number(el.value))
      : kind === 'zones' ? el.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, fee] = line.split('|').map((part) => (part || '').trim());
        return { name, fee: Number(String(fee).replace(/[^0-9.]/g, '')), raw: line };
      })
      : el.value.trim();
    setPath(data, el.name, value);
  }
  return data;
}

const isSafeLink = (value) => !value || /^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(value);

/** Returns a human-readable problem, or '' when the doc is fine to save. */
export function validateCms(kind, data) {
  if (kind === 'home') {
    const links = [data.hero.primaryCta.href, data.hero.secondaryCta.href, data.newsletter.ctaHref];
    if (!links.every(isSafeLink)) return 'Button links must start with /, https://, mailto: or tel:.';
    if (!data.hero.headline) return 'The hero needs a headline.';
    if (data.hero.videoUrl && !/^(https:\/\/|\/(?!\/))/i.test(data.hero.videoUrl)) return 'The hero video link must start with https://.';
    return '';
  }
  // Accept local Ghana format (024 123 4567) and store it wa.me-ready (233241234567).
  data.contact.whatsappNumber = data.contact.whatsappNumber.replace(/\D/g, '').replace(/^0(\d{9})$/, '233$1');
  if (!/^\d{9,15}$/.test(data.contact.whatsappNumber)) return 'Enter the WhatsApp number with country code, digits only (e.g. 233241234567).';
  if (data.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact.email)) return 'Enter a valid contact email.';
  if (!data.brand.businessName) return 'Enter your business name.';
  const socials = [data.contact.instagramUrl, data.contact.tiktokUrl, data.contact.facebookUrl];
  if (!socials.every((url) => !url || /^https?:\/\//i.test(url))) return 'Social links must start with https://.';
  if (!isSafeLink(data.announcement.link)) return 'The announcement link must start with / or https://.';
  if (data.announcement.enabled && !data.announcement.text) return 'Add a message for the announcement bar, or switch it off.';
  if (!isHexColour(data.theme.accent) || !isHexColour(data.theme.accentDark)) return 'Choose valid brand colours.';
  const d = data.delivery;
  const badZone = d.zones.find((z) => !z.name || z.name.length > 60 || !Number.isFinite(z.fee) || z.fee < 0 || !String(z.raw).includes('|'));
  if (badZone) return `Delivery area “${badZone.raw}” should look like “East Legon | 30”.`;
  d.zones = d.zones.map(({ name, fee }) => ({ name, fee: Math.round(fee * 100) / 100 }));
  if (d.mode === 'zones' && !d.zones.length) return 'Add at least one delivery area, or choose a different delivery pricing option.';
  if (![d.flatFee, d.freeOver].every((n) => Number.isFinite(n) && n >= 0)) return 'Delivery fees must be 0 or more.';
  if (!Number.isInteger(data.policies.returnWindowDays) || data.policies.returnWindowDays < 0) return 'The return window must be a whole number of days.';
  return '';
}

// ---- Image field behaviour ----------------------------------------------------------

export function setImageField(container, url) {
  container.querySelector(`input[name="${container.dataset.cmsImage}.url"]`).value = url;
  container.querySelector('[data-cms-preview]').innerHTML = url ? `<img src="${esc(url)}" alt="" />` : '<span>No photo</span>';
}
