import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export function cleanUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Paste a product URL under 2,048 characters.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a complete https:// product URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public http(s) product URL.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('This URL uses an unsupported port.');
  url.hash = '';
  return url.toString();
}

function publicIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 ||
      p[0] === 192 && p[1] === 168 || p[0] === 100 && p[1] >= 64 && p[1] <= 127 ||
      p[0] === 192 && p[1] === 0 || p[0] === 192 && p[1] === 0 && p[2] === 0 ||
      p[0] === 198 && p[1] >= 18 && p[1] <= 19 || p[0] === 192 && p[1] === 0 && p[2] === 2 ||
      p[0] === 198 && p[1] === 51 && p[2] === 100 || p[0] === 203 && p[1] === 0 && p[2] === 113);
  }
  if (net.isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return publicIp(v.slice(7));
    return !(v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') ||
      v.startsWith('fe') || v.startsWith('ff') || v.startsWith('2001:db8:'));
  }
  return false;
}

export async function fetchProductHtml(input, depth = 0) {
  if (depth > 3) throw new Error('Too many redirects.');
  const url = new URL(cleanUrl(input));
  const addresses = await dns.promises.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicIp(address))) throw new Error('This address cannot be fetched.');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      headers: { 'user-agent': 'KeepAnEye/0.1 (personal product bookmark)', accept: 'text/html,application/xhtml+xml' },
      timeout: 7000
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        fetchProductHtml(new URL(res.headers.location, url).toString(), depth + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('The store did not make this page available.')); return; }
      if (!String(res.headers['content-type'] || '').toLowerCase().includes('html')) { res.resume(); reject(new Error('The link did not return an HTML product page.')); return; }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 500_000) { req.destroy(new Error('Product page is too large.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The store timed out.')));
    req.on('error', reject);
  });
}

function decode(s = '') {
  return String(s).replace(/&(?:amp|quot|apos|lt|gt|#39|#x27|#x2f|#(\d+));/gi, (m, n) =>
    ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'", '&#x2f;': '/' })[m.toLowerCase()] ?? (n ? String.fromCodePoint(Number(n)) : m));
}

function meta(html, key) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
    if ((attrs.property || attrs.name || '').toLowerCase() === key.toLowerCase()) return decode(attrs.content);
  }
  return null;
}

function productNodes(value) {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...productNodes(value['@graph'] || [])].filter(n =>
    String(n['@type'] || '').toLowerCase().split(',').some(t => t.trim() === 'product'));
}

function amount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n < 1_000_000 ? n : null;
}

export function parseProduct(html, link) {
  let product;
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = productNodes(JSON.parse(match[1]))[0]; if (product) break; } catch { /* store supplied malformed JSON-LD */ }
  }
  const offer = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  const priceValue = offer?.price ?? offer?.priceSpecification?.price ?? meta(html, 'product:price:amount');
  const currencyValue = offer?.priceCurrency ?? offer?.priceSpecification?.priceCurrency ?? meta(html, 'product:price:currency');
  const currency = /^[A-Z]{3}$/.test(String(currencyValue || '')) ? currencyValue : null;
  const price = currency ? amount(priceValue) : null;
  const image = Array.isArray(product?.image) ? product.image[0] : product?.image ?? meta(html, 'og:image');
  let safeImage = null;
  try { if (image && ['https:', 'http:'].includes(new URL(image, link).protocol)) safeImage = new URL(image, link).toString(); } catch { /* no image */ }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return {
    title: decode(product?.name || meta(html, 'og:title') || titleTag || new URL(link).hostname).replace(/\s+/g, ' ').trim().slice(0, 180),
    description: decode(product?.description || meta(html, 'og:description') || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500),
    image: safeImage,
    price,
    currency,
    price_source: price !== null ? (offer?.price || offer?.priceSpecification?.price ? 'JSON-LD offer' : 'product price meta tag') : null
  };
}

export async function inspectProduct(link) {
  const html = await fetchProductHtml(link);
  return parseProduct(html, link);
}
