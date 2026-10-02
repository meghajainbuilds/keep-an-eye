import { cleanUrl, resolvePublicProductUrl } from './product.mjs';
import { guessCategory } from './categories.mjs';

// User-reviewed browser metadata repairs previews only. It is never a price observation.
function publicHttps(value) {
  const url = new URL(cleanUrl(value));
  if (url.protocol !== 'https:' || url.port || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw Error('Invalid preview URL. Use a public HTTPS page.');
  return url.href;
}
const text = (value, limit) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
export async function browserPreviewPatch(item, input, now = () => new Date().toISOString()) {
  if (!input || input.confirm_match !== true || input.version !== 1) throw Error('Choose a valid browser preview and confirm it matches this saved product.');
  const merchant_url = publicHttps(input.url);
  const title = text(input.title, 180);
  if (!title) throw Error('Enter a product name in the browser preview.');
  const patch = { merchant_url, preview_source: 'browser', preview_captured_at: now() };
  // A custom title remains the owner's choice. Imported fields cannot mutate watches or prices.
  if ([new URL(item.url).hostname, item.merchant_url && new URL(item.merchant_url).hostname].includes(item.title)) patch.title = title;
  const description = text(input.description, 500);
  if (description) patch.description = description;
  if (input.image) patch.image = publicHttps(input.image);
  if (item.category_source === 'rules') Object.assign(patch, guessCategory({ ...item, ...patch, url: merchant_url }));
  // Imported URLs receive the same public-network checks as fetched product pages.
  try { await resolvePublicProductUrl(merchant_url); if (patch.image) await resolvePublicProductUrl(patch.image); }
  catch { throw Error('Invalid preview URL. Use a reachable public HTTPS host.'); }
  return patch;
}
