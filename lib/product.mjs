import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export const MAX_PRODUCT_BYTES = 5_000_000;

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
        if (bytes > MAX_PRODUCT_BYTES) { req.destroy(new Error('Product page is too large.')); return; }
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
  return String(s).replace(/&(?:amp|quot|apos|lt|gt|#(x[0-9a-f]+|\d+));/gi, (m, n) => {
    if (!n) return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[m.toLowerCase()] || m;
    const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(m => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])]));
}
function meta(html, key) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if ((attrs.property || attrs.name || '').toLowerCase() === key.toLowerCase() && attrs.content?.trim()) return attrs.content.trim();
  }
  return null;
}
function canonicalUrl(html, link) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(match[0]);
    if (a.rel?.toLowerCase() !== 'canonical' || !a.href) continue;
    try {
      const requested = new URL(link), canonical = new URL(a.href, link);
      if (canonical.origin !== requested.origin) continue;
      // Canonical tags commonly remove variant selectors. Never discard those.
      canonical.search = requested.search;
      return canonical.href;
    } catch { /* invalid declaration */ }
  }
  return link;
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
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid$|gbraid$|wbraid$|_gl$|ref_$|fm$|shem$|srsltid$|msockid$|fbclid$)/i.test(key)) u.searchParams.delete(key);
    u.pathname = u.pathname.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
    u.searchParams.sort(); return u.href;
  } catch { return null; }
}
function safeImage(value, link) {
  for (const image of array(value)) {
    try {
      const value = image && typeof image === 'object' ? image.url || image.contentUrl : image;
      if (typeof value !== 'string' || !value.trim() || /^https?:[^/]/i.test(value)) continue;
      const url = new URL(decode(value), link);
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
    for (const [key, child] of Object.entries(value)) if (['@graph', 'hasVariant', 'isVariantOf', 'mainEntity', 'itemListElement', 'item', 'offers', 'priceSpecification', 'itemOffered'].includes(key)) visit(child);
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { try { visit(JSON.parse(decode(match[1]))); } catch { /* malformed merchant data */ } }
  }
  // Read commerce JSON even when JSON-LD is present: themes often omit option names
  // in JSON-LD. Match the product handle, never a recommendation or unrelated item.
  const commerce = [];
  const currencyHint = meta(html, 'product:price:currency') || meta(html, 'og:price:currency') ||
    /Shopify\.currency\s*=\s*\{\s*"active"\s*:\s*"([A-Z]{3})"/i.exec(html)?.[1];
  function commerceProduct(raw) {
    if (Array.isArray(raw)) { raw.forEach(commerceProduct); return; }
    const p = raw?.product || raw;
    if (!p?.title || !p.handle || !Array.isArray(p.variants) ||
        !decodeURIComponent(new URL(link).pathname).replace(/\/$/, '').endsWith('/products/' + p.handle)) return;
    const names = array(p.options).map(o => typeof o === 'string' ? o : o?.name);
    for (const v of p.variants) {
      if (!v.id || typeof v.price !== 'number') continue;
      const values = v.options || [v.option1, v.option2, v.option3];
      const attrs = Object.fromEntries(names.map((n, i) => [n || 'Option ' + (i + 1), values[i]]).filter(([,val]) => val != null));
      commerce.push({ id: String(v.sku || v.id), alias: String(v.id),
        name: p.title, description: p.description,
        image: v.featured_image?.src || p.featured_image || p.images?.[0],
        attributes: attrs, label: Object.entries(attrs).map(([k,val]) => k + ': ' + val).join(' · ') || v.title,
        url: new URL('?variant=' + v.id, link).href,
        price: amount(v.price / 100), currency: p.currency || currencyHint,
        availability: v.available === true ? 'InStock' : v.available === false ? 'OutOfStock' : null });
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { commerceProduct(JSON.parse(match[1])); } catch { /* Never execute merchant scripts. */ }
  }
  const resolve = value => value?.['@id'] ? { ...references.get(value['@id']), ...value } : value;
  const groups = nodes.filter(n => types(n, 'ProductGroup'));
  const products = [...new Set([...nodes.filter(n => types(n, 'Product')), ...groups.flatMap(g => array(g.hasVariant).map(resolve)), ...groups.filter(g => g.offers && !array(g.hasVariant).length)])]
    .filter(p => types(p, 'Product') || types(p, 'ProductGroup'));
  const candidates = [];
  const textValue = v => typeof v === 'object' ? v?.name || v?.value : v;
  for (const product of products) {
    if (types(product, 'ProductGroup') && products.some(p => types(p, 'Product') && p.offers)) continue;
    const offers = array(product.offers).map(resolve).filter(o => o && !types(o, 'AggregateOffer'));
    const entries = offers.length ? offers : [null];
    for (const offer of entries) {
      const specs = array(offer?.priceSpecification).map(resolve).filter(x => !x?.priceType || /SalePrice$/.test(x.priceType));
      const spec = specs.length === 1 ? specs[0] : null;
      const currency = String(offer?.priceCurrency || spec?.priceCurrency || '').toUpperCase();
      const id = String(offer?.sku || (offers.length > 1 ? offer?.['@id'] || offer?.url : null) || product.sku || product.productID || product['@id'] || product.url || offer?.url || '');
      const attributes = Object.fromEntries(Object.entries({ Color: textValue(product.color || offer?.itemOffered?.color), Size: textValue(product.size || offer?.itemOffered?.size) }).filter(([,v]) => v != null));
      candidates.push({ product, offer, id, attributes,
        label: [...Object.entries(attributes).map(([k,v]) => k + ': ' + v), offer?.name].filter(Boolean).join(' · ') || offer?.name || product.name || 'Product',
        url: offer?.url || product.url, price: amount(offer?.price ?? spec?.price),
        currency: /^[A-Z]{3}$/.test(currency) ? currency : null });
    }
  }
  for (const c of commerce) {
    const matching = candidates.filter(v => (v.url && urlKey(v.url, link) === urlKey(c.url, link)) || v.id === c.id);
    if (matching.length) {
      for (const v of matching) {
        v.attributes = c.attributes; v.label = c.label || v.label; v.alias = c.alias;
        v.product = { ...v.product, image: c.image || v.product.image };
        // JSON-LD remains the price source when present; conflicting evidence fails closed.
        if (v.price != null && c.price != null && (v.price !== c.price || c.currency && v.currency !== c.currency)) { v.price = null; v.conflict = true; }
        else if (v.price == null && !v.conflict) { v.price = c.price; v.currency = c.currency; }
        if (c.availability) v.offer = { ...v.offer, availability: c.availability };
      }
    } else candidates.push({ ...c, product: { name: c.name, description: c.description, image: c.image },
      offer: { availability: c.availability } });
  }
  // Dedupe references to the same offer, without silently collapsing differently priced sizes.
  const unique = [...new Map(candidates.map(c => [JSON.stringify([c.id,c.url,c.price,c.currency,c.label]), c])).values()];
  const target = urlKey(link, link);
  const canonical = urlKey(canonicalUrl(html, link), link);
  const isTarget = value => value && [target, canonical].includes(urlKey(value, link));
  let matches = options.variant_id ? unique.filter(c => (c.id === options.variant_id || c.alias === options.variant_id)) : unique.filter(c => isTarget(c.url));
  if (!matches.length && !options.variant_id && unique.length === 1) {
    const candidate = unique[0];
    // A different explicit variant URL is evidence of a mismatch, even when only one offer is returned.
    const requested = new URL(target);
    const offeredKey = candidate.url ? urlKey(candidate.url, link) : null;
    const offered = offeredKey ? new URL(offeredKey) : null;
    const canonicalTarget = new URL(canonical);
    const identity = String(candidate.product.mpn || candidate.product.productID || '');
    const suffix = identity && canonicalTarget.pathname.endsWith('-' + identity) ? '-' + identity : null;
    const identifiedAlias = suffix && offered && offered.origin === canonicalTarget.origin && offered.pathname === canonicalTarget.pathname.slice(0, -suffix.length);
    if ((options.scope === 'product' || !requested.search) && (!candidate.url || offered && offered.origin === requested.origin && [requested.pathname, canonicalTarget.pathname].includes(offered.pathname) || identifiedAlias) || offered && isTarget(offered.href)) matches = [candidate];
  }
  let chosen = matches.length === 1 ? matches[0] : null;
  const productScope = options.scope === 'product';
  const page = new URL(canonical);
  const samePage = value => { try { const u = new URL(urlKey(value, link)); return u.origin === page.origin && u.pathname === page.pathname; } catch { return false; } };
  const validGroups = groups.filter(g => !(g.url || g['@id']) || samePage(g.url || g['@id']));
  const groupedProducts = validGroups.flatMap(g => array(g.hasVariant).map(resolve));
  const eligible = unique.filter(c => !c.conflict && (samePage(c.url || c.product.url) ||
    groupedProducts.some(p => p === c.product || p['@id'] && p['@id'] === c.product['@id'] || p.sku && p.sku === c.product.sku) || c.product.isVariantOf && validGroups.some(g => g['@id'] === c.product.isVariantOf['@id']) ||
    matches.includes(c) || !c.url && !c.product.url && unique.length === 1));
  const detailed = eligible.some(c => !types(c.product, 'ProductGroup')) ? eligible.filter(c => !types(c.product, 'ProductGroup')) : eligible;
  const available = detailed.filter(c => !/(?:OutOfStock|Discontinued|SoldOut)$/.test(c.offer?.availability || '') && c.price != null && c.currency);
  const currencies = new Set(available.map(c => c.currency));
  if (productScope) chosen = currencies.size === 1 ? [...available].sort((a,b) => a.price - b.price)[0] || null : null;
  // Preview identity and price certainty are separate: an unresolved size must not hide the product.
  const onPage = products.filter(p => isTarget(p.url || p['@id']));
  const group = groups.find(g => {
    const key = urlKey(g.url || g['@id'], link);
    return (g.url || g['@id']) && key && new URL(key).origin === new URL(canonical).origin && new URL(key).pathname === new URL(canonical).pathname;
  }) || (groups.length === 1 && !groups[0].url && !groups[0]['@id'] ? groups[0] : null);
  const previewProduct = chosen?.product || (onPage.length === 1 ? onPage[0] : null) ||
    (products.length === 1 && (!products[0].url || isTarget(products[0].url)) ? products[0] : null);
  const product = previewProduct;
  const fallback = group;
  // A product-wide observation is safe only while EVERY listed variant agrees. Never pick the cheapest.
  const pagePath = new URL(canonical).pathname;
  const requestedParams = new URL(target).searchParams;
  const scope = unique.filter(c => {
    if (![...requestedParams].length) return true;
    const key = c.url && urlKey(c.url, link);
    if (!key) return false;
    const u = new URL(key);
    return u.origin === new URL(canonical).origin && u.pathname === pagePath &&
      [...requestedParams].every(([key, value]) => u.searchParams.get(key) === value);
  });
  const sameFamily = scope.length > 1 && (group || new Set(unique.map(c => c.product)).size === 1) &&
    scope.every(c => {
      if (!c.url) return c.product === product || array(group?.hasVariant).some(v => resolve(v) === c.product || v['@id'] && v['@id'] === c.product['@id']);
      const key = urlKey(c.url, link); if (!key) return false;
      const u = new URL(key); return u.origin === new URL(canonical).origin && u.pathname === pagePath;
    });
  const uniform = !productScope && !options.variant_id && sameFamily &&
    scope.every(c => c.price !== null && c.currency && c.price === scope[0].price && c.currency === scope[0].currency) &&
    scope.every(c => !c.offer?.eligibleCustomerType && !c.offer?.eligibleQuantity);
  const ambiguous = unique.length > 0 && !chosen && !uniform;
  const currencyMeta = String(meta(html, 'product:price:currency') || meta(html, 'og:price:currency') || '').toUpperCase();
  const currency = chosen?.currency || (uniform ? scope[0].currency : !unique.length && /^[A-Z]{3}$/.test(currencyMeta) ? currencyMeta : null);
  // Meta-only observations cannot prove an explicitly requested variant.
  const metaPrice = !options.variant_id && (productScope || !new URL(target).search) ? amount(meta(html, 'product:price:amount') || meta(html, 'og:price:amount')) : null;
  const price = currency && !ambiguous ? (chosen ? chosen.price : uniform ? scope[0].price : metaPrice) : null;
  const unavailable = c => /(?:OutOfStock|Discontinued|SoldOut)$/.test(c?.offer?.availability || '');
  const outOfStock = chosen ? unavailable(chosen) : uniform && scope.every(unavailable);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const selectable = unique.filter(c => c.id && unique.filter(other => other.id === c.id).length === 1);
  const status = ambiguous ? (productScope ? (eligible.length && eligible.every(unavailable) ? 'out_of_stock' : 'unavailable') : selectable.length ? 'needs_variant' : 'unavailable') : outOfStock ? 'out_of_stock' : price !== null ? 'verified' : 'unavailable';
  const categoryParts = [product?.category, fallback?.category,
    product?.audience?.audienceType, fallback?.audience?.audienceType,
    ...nodes.filter(n => types(n, 'BreadcrumbList')).flatMap(n => array(n.itemListElement).map(v => v.name || v.item?.name))];
  const variantNames = unique.map(c => [c.product.name, c.product.size, c.label].filter(Boolean).join(' ')).join(' ');
  if (/\b\d{1,2}(?:-\d{1,2})?\s*(?:y|yrs?|years?|months?|mos?)\b/i.test(variantNames)) categoryParts.push('Kids');
  return {
    title: decode((productScope && fallback?.name) || product?.name || fallback?.name || meta(html, 'og:title') || titleTag || new URL(link).hostname).replace(/\s+/g, ' ').trim().slice(0, 180),
    description: decode(product?.description || fallback?.description || meta(html, 'og:description') || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500),
    image: [product?.image, ...(group && requestedParams.size ? scope.map(c => c.product.image) : []), fallback?.image, ...(group ? scope.map(c => c.product.image) : []), meta(html, 'og:image:secure_url'), meta(html, 'og:image'), meta(html, 'twitter:image')].map(value => safeImage(value, link)).find(Boolean) || null,
    merchant_category: categoryParts.flat().filter(v => typeof v === 'string').join(' > ').slice(0, 500),
    price, currency,
    price_source: price !== null ? (chosen ? 'JSON-LD offer' : uniform ? 'JSON-LD uniform offers' : 'product price meta tag') : null,
    variant_id: productScope ? null : chosen?.id || null, variant_label: productScope ? null : chosen?.label || null,
    price_kind: productScope && unique.length > 1 ? 'from' : 'exact',
    matched_variant: chosen?.label || null,
    extraction_status: status,
    variants: [...new Map(selectable.map(c => [c.id, { id: c.id, label: c.label, attributes: c.attributes || {}, price: c.price, currency: c.currency, available: !/(?:OutOfStock|Discontinued|SoldOut)$/.test(c.offer?.availability || ''), image: safeImage(c.product.image, link), url: c.url && urlKey(c.url, link) && new URL(urlKey(c.url, link)).origin === new URL(link).origin ? urlKey(c.url, link) : null }])).values()].slice(0, 500)
  };
}

export async function inspectProduct(link, options = {}) {
  let result, resolvedLink = link, html = '';
  const resource = options.resource || fetchProductResource;
  try {
    const page = await resource(link, 0, true);
    resolvedLink = page.url;
    html = page.body.toString('utf8');
    result = parseProduct(html, page.url, options);
  } catch { result = parseProduct('', link, options); }
  // Public Shopify product data can remain readable when the HTML page is blocked.
  // Currency is merchant evidence from the same locale's cart API, never a country guess.
  const pageUrl = new URL(resolvedLink);
  if (/\/products\/[^/]+\/?$/.test(pageUrl.pathname) &&
      (result.price == null || /Shopify\.shop\s*=/.test(html) &&
       (!result.variants.length || result.variants.some(v => !Object.keys(v.attributes).length)))) {
    try {
      const endpoint = new URL(pageUrl); endpoint.search = ''; endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '.js';
      const response = await resource(endpoint.href);
      if (new URL(response.url).origin !== endpoint.origin) throw Error('Cross-origin product data');
      const product = JSON.parse(response.body.toString('utf8'));
      if (!product.title || !product.handle || !Array.isArray(product.variants) ||
          !decodeURIComponent(pageUrl.pathname).replace(/\/$/, '').endsWith('/products/' + product.handle)) throw Error('Unmatched product data');
      if (!product.currency && !meta(html, 'product:price:currency') && !meta(html, 'og:price:currency') && !/Shopify\.currency/.test(html)) {
        const locale = /^\/([a-z]{2}(?:-[a-z]{2})?)\//i.exec(pageUrl.pathname)?.[1];
        const cartUrl = new URL((locale ? '/' + locale : '') + '/cart.js', pageUrl);
        const cartResponse = await resource(cartUrl.href);
        if (new URL(cartResponse.url).origin !== pageUrl.origin) throw Error('Cross-origin currency data');
        const currency = JSON.parse(cartResponse.body.toString('utf8')).currency;
        if (!/^[A-Z]{3}$/.test(currency || '')) throw Error('Missing merchant currency');
        product.currency = currency;
      }
      html += '<script type="application/json">' + JSON.stringify(product).replaceAll('<', '\\u003c') + '</script>';
      result = parseProduct(html, resolvedLink, options);
    } catch { /* Keep independently verified page data. */ }
  }
  if ((result.price != null || result.extraction_status === 'needs_variant') && result.image && result.title !== new URL(link).hostname && result.title !== new URL(resolvedLink).hostname) return result;
  if (options.render || process.env.BROWSER_RENDER_URL && process.env.BROWSER_RENDER_TOKEN) {
    try {
      const render = options.render || (await import('./render-client.mjs')).renderProduct;
      const rendered = parseProduct(await render(resolvedLink), resolvedLink, options);
      const richer = rendered.extraction_status === 'verified' || rendered.extraction_status === 'out_of_stock' ||
        result.extraction_status === 'unavailable' && rendered.extraction_status === 'needs_variant';
      const primary = richer ? rendered : result, secondary = richer ? result : rendered;
      for (const key of ['image', 'description', 'merchant_category']) if (!primary[key] && secondary[key]) primary[key] = secondary[key];
      if (primary.title === new URL(link).hostname && secondary.title !== new URL(link).hostname) primary.title = secondary.title;
      result = primary;
    } catch { /* retain static evidence; failed rendering never creates a price */ }
  }
  return result;
}
