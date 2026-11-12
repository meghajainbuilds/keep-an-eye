// Self-contained so the same function can run as a user-invoked browser bookmark.
// Read product preview fields only: no forms, cookies, storage, prices or network requests.
export function captureBrowserPreview(doc, pageUrl) {
  const meta = name => [...doc.querySelectorAll('meta')].find(el =>
    (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase() === name)?.getAttribute('content') || '';
  const clean = (value, max) => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const products = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if ([].concat(value['@type'] || []).some(t => t === 'Product' || t === 'ProductGroup')) products.push(value);
    for (const key of ['@graph', 'mainEntity', 'hasVariant']) if (value[key]) visit(value[key]);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    if ((script.textContent || '').length > 500_000) continue;
    try { visit(JSON.parse(script.textContent)); } catch { /* malformed structured data */ }
  }
  const samePage = value => { try { const u = new URL(value, pageUrl), p = new URL(pageUrl); return u.origin === p.origin && u.pathname === p.pathname; } catch { return false; } };
  const matches = products.filter(p => p.url && samePage(p.url));
  const product = matches.length === 1 ? matches[0] : products.length === 1 && !products[0].url ? products[0] : null;
  const firstImage = [].concat(product?.image || [])[0];
  const productImage = typeof firstImage === 'string' ? firstImage : firstImage?.url || firstImage?.contentUrl;
  let image = meta('og:image:secure_url') || meta('og:image') || meta('twitter:image') || productImage;
  try { image = image ? new URL(image, pageUrl).href : ''; } catch { image = ''; }
  return { version: 1, url: pageUrl, title: clean(meta('og:title') || meta('twitter:title') || product?.name || doc.title, 180),
    description: clean(meta('og:description') || meta('twitter:description') || meta('description') || product?.description, 500), image };
}
export const previewBookmark = 'javascript:' + encodeURIComponent('void((' + function(capture) {
  const preview = capture(document, location.href);
  window.prompt('Copy these product details, then paste them into Keep an Eye → Import browser preview.', JSON.stringify(preview));
}.toString() + ')(' + captureBrowserPreview.toString() + '))');

export const shortcutCaptureScript = 'completion(JSON.stringify((' + captureBrowserPreview.toString() + ')(document, location.href)));';
