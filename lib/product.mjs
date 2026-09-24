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

export async function fetchProductResource(input, depth = 0, htmlOnly = false) {
  if (depth > 3) throw new Error('Too many redirects.');
  const url = new URL(cleanUrl(input));
  const addresses = await dns.promises.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicIp(address))) throw new Error('This address cannot be fetched.');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      lookup: (_host, options, callback) => options?.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      headers: { 'user-agent': 'KeepAnEye/0.1 (personal product bookmark)', accept: 'text/html,application/xhtml+xml' },
      timeout: 7000
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        fetchProductResource(new URL(res.headers.location, url).toString(), depth + 1, htmlOnly).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('The store did not make this page available.')); return; }
      if (htmlOnly && !String(res.headers['content-type'] || '').toLowerCase().includes('html')) { res.resume(); reject(new Error('The link did not return an HTML product page.')); return; }
      let bytes = 0; const chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { req.destroy(new Error('Product page is too large.')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), url: url.href, contentType: String(res.headers['content-type'] || 'application/octet-stream') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The store timed out.')));
    req.on('error', reject);
  });
}

export async function fetchProductHtml(input, depth = 0) {
  const result = await fetchProductResource(input, depth, true);
  return result.body.toString('utf8');
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

function types(node, name) {
  return [node?.['@type']].flat().some(t => String(t).split('/').at(-1).toLowerCase() === name.toLowerCase());
}
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];

export function amount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let raw = String(value).trim().replace(/[\s\u00a0]/g, '');
  // Merchant structured data sometimes contains formatted rather than numeric prices.
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) raw = raw.replaceAll(',', '');
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(raw)) raw = raw.replaceAll('.', '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(raw)) raw = raw.replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n < 1_000_000 ? n : null;
}
function urlKey(value, base) {
  try {
    const u = new URL(value, base); u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid$|gbraid$|wbraid$|_gl$|ref_$|fm$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.href;
  } catch { return null; }
}
function safeImage(value, link) {
  for (const image of array(value)) {
    try {
      const url = new URL(typeof image === 'object' ? image.url || image.contentUrl : image, link);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* try next image */ }
  }
  return null;
}

export function parseProduct(html, link, options = {}) {
  const nodes = [], references = new Map();
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (value['@id'] && Object.keys(value).length > 1) references.set(value['@id'], value);
    nodes.push(value);
    for (const [key, child] of Object.entries(value)) if (['@graph', 'hasVariant', 'mainEntity', 'itemListElement'].includes(key)) visit(child);
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* malformed merchant data */ }
  }
  // Common commerce payload: explicitly identified product JSON, with variant prices in minor units.
  if (!nodes.some(n => types(n, 'Product') || types(n, 'ProductGroup'))) {
    for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const raw = JSON.parse(match[1]); const p = raw.product || raw;
        if (!p.title || !p.handle || !Array.isArray(p.variants) || !p.variants.length || !p.variants.every(v => v.id && typeof v.price === 'number' && Array.isArray(v.options))) continue;
        const currency = p.currency || meta(html, 'product:price:currency');
        // Without merchant currency evidence this payload cannot produce an alertable price.
        const group = { '@type': 'ProductGroup', name: p.title, image: p.featured_image || p.images?.[0],
          hasVariant: p.variants.map(v => ({ '@type': 'Product', sku: String(v.id), name: p.title, color: v.title,
            image: v.featured_image?.src || p.featured_image || p.images?.[0],
            offers: { '@type': 'Offer', price: v.price / 100, priceCurrency: currency,
              url: '/products/' + p.handle + '?variant=' + v.id,
              availability: v.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } })) };
        visit(group); break;
      } catch { /* unknown payloads are never guessed */ }
    }
  }
  const resolve = value => value?.['@id'] ? { ...references.get(value['@id']), ...value } : value;
  const groups = nodes.filter(n => types(n, 'ProductGroup'));
  const products = [...new Set([...nodes.filter(n => types(n, 'Product')), ...groups.flatMap(g => array(g.hasVariant).map(resolve))])]
    .filter(p => types(p, 'Product'));
  const candidates = [];
  for (const product of products) {
    const offers = array(product.offers).map(resolve).filter(o => o && !types(o, 'AggregateOffer'));
    const entries = offers.length ? offers : [null];
    for (const offer of entries) {
      const specs = array(offer?.priceSpecification).map(resolve).filter(x => !x?.priceType || /SalePrice$/.test(x.priceType));
      const spec = specs.length === 1 ? specs[0] : null;
      const currency = String(offer?.priceCurrency || spec?.priceCurrency || '').toUpperCase();
      const id = String(offer?.sku || product.sku || product.productID || product['@id'] || product.url || offer?.url || '');
      candidates.push({ product, offer, id,
        label: [product.color, product.size].filter(Boolean).join(' · ') || product.name || 'Product',
        url: offer?.url || product.url, price: amount(offer?.price ?? spec?.price),
        currency: /^[A-Z]{3}$/.test(currency) ? currency : null });
    }
  }
  // Dedupe references to the same offer, without silently collapsing differently priced sizes.
  const unique = [...new Map(candidates.map(c => [JSON.stringify([c.id,c.url,c.price,c.currency,c.label]), c])).values()];
  const target = urlKey(link, link);
  let matches = options.variant_id ? unique.filter(c => c.id === options.variant_id) : unique.filter(c => c.url && urlKey(c.url, link) === target);
  if (!matches.length && !options.variant_id && unique.length === 1) {
    const candidate = unique[0];
    // A different explicit variant URL is evidence of a mismatch, even when only one offer is returned.
    const requested = new URL(target);
    const offered = candidate.url ? new URL(candidate.url, link) : null;
    if (!requested.search && (!offered || offered.origin === requested.origin && offered.pathname === requested.pathname) || offered && urlKey(offered.href, link) === target) matches = [candidate];
  }
  const chosen = matches.length === 1 ? matches[0] : null;
  const ambiguous = unique.length > 0 && !chosen;
  const product = chosen?.product;
  const fallback = groups[0];
  const currencyMeta = String(meta(html, 'product:price:currency') || '').toUpperCase();
  const currency = chosen?.currency || (!unique.length && /^[A-Z]{3}$/.test(currencyMeta) ? currencyMeta : null);
  const price = currency && !ambiguous ? (chosen ? chosen.price : amount(meta(html, 'product:price:amount'))) : null;
  const outOfStock = /(?:OutOfStock|Discontinued|SoldOut)$/.test(chosen?.offer?.availability || '');
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const status = ambiguous ? 'needs_variant' : outOfStock ? 'out_of_stock' : price !== null ? 'verified' : 'unavailable';
  return {
    title: decode(product?.name || fallback?.name || meta(html, 'og:title') || titleTag || new URL(link).hostname).replace(/\s+/g, ' ').trim().slice(0, 180),
    description: decode(product?.description || fallback?.description || meta(html, 'og:description') || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500),
    image: safeImage(product?.image || fallback?.image || meta(html, 'og:image'), link),
    price, currency,
    price_source: price !== null ? (chosen ? 'JSON-LD offer' : 'product price meta tag') : null,
    variant_id: chosen?.id || null, variant_label: chosen?.label || null,
    extraction_status: status,
    variants: [...new Map(unique.filter(c => c.id).map(c => [c.id, { id: c.id, label: c.label, url: c.url && new URL(c.url, link).origin === new URL(link).origin ? urlKey(c.url, link) : null }])).values()].slice(0, 100)
  };
}

export async function inspectProduct(link, options = {}) {
  let result;
  try { const page = await fetchProductResource(link, 0, true); result = parseProduct(page.body.toString('utf8'), page.url, options); }
  catch { result = parseProduct('', link, options); }
  if (result.extraction_status === 'needs_variant' || result.price != null && result.image) return result;
  if (process.env.BROWSER_RENDER_URL && process.env.BROWSER_RENDER_TOKEN) {
    try {
      const { renderProduct } = await import('./render-client.mjs');
      const rendered = parseProduct(await renderProduct(link), link, options);
      if (rendered.extraction_status === 'verified' || rendered.extraction_status === 'needs_variant') return rendered;
      if (!result.image && rendered.image) result.image = rendered.image;
    } catch { /* retain static evidence; failed rendering never creates a price */ }
  }
  return result;
}
