import { cleanUrl } from './product.mjs';

// App share sheets commonly provide prose containing a URL rather than a URL value.
// Never silently pick one product from a collection or a multi-link message.
export function sharedUrl(value) {
  if (typeof value !== 'string' || value.length > 10_000) throw Error('Paste a product link.');
  const text = value.trim();
  if (/^https?:\/\/\S+$/i.test(text)) return cleanUrl(text);
  const links = [...new Set((text.match(/https?:\/\/[^\s<>"\u201c\u201d]+/gi) || [])
    .map(link => link.replace(/[),.;!\]}]+$/, '')).map(cleanUrl))];
  if (links.length !== 1) throw Error(links.length ? 'Choose one product link from the shared text.' : 'Paste a product link.');
  return links[0];
}
