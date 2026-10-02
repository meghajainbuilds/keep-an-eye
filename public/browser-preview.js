// Self-contained so the same function can run as a user-invoked browser bookmark.
// Read product preview fields only: no forms, cookies, storage, prices or network requests.
export function captureBrowserPreview(doc, pageUrl) {
  const meta = name => [...doc.querySelectorAll('meta')].find(el =>
    (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase() === name)?.getAttribute('content') || '';
  const clean = (value, max) => String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  let image = meta('og:image:secure_url') || meta('og:image') || meta('twitter:image');
  try { image = image ? new URL(image, pageUrl).href : ''; } catch { image = ''; }
  return { version: 1, url: pageUrl, title: clean(meta('og:title') || meta('twitter:title') || doc.title, 180),
    description: clean(meta('og:description') || meta('twitter:description') || meta('description'), 500), image };
}
export const previewBookmark = 'javascript:' + encodeURIComponent('void((' + function(capture) {
  const preview = capture(document, location.href);
  window.prompt('Copy these product details, then paste them into Keep an Eye → Import browser preview.', JSON.stringify(preview));
}.toString() + ')(' + captureBrowserPreview.toString() + '))');
