const FALLBACK_IMAGE = '/assets/nakuadiary-social.png';

function absolute(value) {
  return new URL(value, window.location.origin).href;
}

function meta(selector, content) {
  const node = document.head.querySelector(selector);
  if (node && content) node.setAttribute('content', content);
}

/** Keeps browser-visible metadata accurate on static Hosting, including
 * product pages that are rendered from a query-string id. */
export function updateSeo({ title, description, image, type = 'website' } = {}) {
  const pageUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const socialImage = absolute(image || FALLBACK_IMAGE);
  if (title) document.title = title;
  meta('meta[name="description"]', description);
  meta('meta[property="og:title"]', title || document.title);
  meta('meta[property="og:description"]', description);
  meta('meta[property="og:type"]', type);
  meta('meta[property="og:url"]', pageUrl);
  meta('meta[property="og:image"]', socialImage);
  meta('meta[name="twitter:title"]', title || document.title);
  meta('meta[name="twitter:description"]', description);
  meta('meta[name="twitter:image"]', socialImage);
  const canonical = document.head.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = pageUrl;
}

updateSeo();
