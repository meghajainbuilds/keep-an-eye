import { inspectProduct } from './product.mjs';
import { guessCategory } from './categories.mjs';

export function shouldAlert(item, nextPrice, nextCurrency) {
  if (item.watch_enabled === 0 || nextPrice == null || !nextCurrency || item.currency && item.currency !== nextCurrency || item.last_notified_at) return false;
  return item.target_price != null && nextPrice <= item.target_price ||
    item.discount_percent != null && item.baseline_price != null &&
    nextPrice <= item.baseline_price * (1 - item.discount_percent / 100);
}

function aboveThreshold(item, price) {
  return (item.target_price == null || price > item.target_price) &&
    (item.discount_percent == null || item.baseline_price == null || price > item.baseline_price * (1 - item.discount_percent / 100));
}

const running = new WeakMap();
export function checkPrices(store, options = {}) {
  // Serialise checks for this database so scheduled/manual runs cannot duplicate alerts.
  const previous = running.get(store) || Promise.resolve();
  const result = previous.catch(() => {}).then(() => runChecks(store, options));
  running.set(store, result);
  result.finally(() => { if (running.get(store) === result) running.delete(store); }).catch(() => {});
  return result;
}
async function runChecks(store, options = {}) {
  const inspect = options.inspect || inspectProduct;
  const notify = options.notify;
  const now = options.now || (() => new Date().toISOString());
  const result = { checked: 0, alerted: 0, unavailable: 0, errors: [] };
  const tasks = [];
  for (const product of store.list()) {
    if (options.itemId && product.id !== options.itemId) continue;
    if (options.itemId || product.watch_enabled !== 0 && (product.target_price != null || product.discount_percent != null)) tasks.push({ saved: product, child: false });
    for (const watch of product.variant_watches || []) if (watch.watch_enabled !== 0) tasks.push({
      saved: { ...product, ...watch, watch_scope: 'variant' }, child: true });
  }
  for (const { saved, child } of tasks) {
    const read = () => child ? (store.get(saved.item_id) && store.getWatch(saved.id) ? { ...store.get(saved.item_id), ...store.getWatch(saved.id), watch_scope: 'variant' } : null) : store.get(saved.id);
    const write = fields => child ? store.updateWatch(saved.id, fields) : store.update(saved.id, fields);
    let item = saved;
    try {
      const data = await inspect(item.selected_url || item.url, { variant_id: item.watch_scope === 'product' ? null : item.variant_id, scope: item.watch_scope });
      result.checked++;
      item = read();
      if (!item || !options.itemId && item.watch_enabled === 0) continue;
      if (item.variant_id !== saved.variant_id || item.watch_scope !== saved.watch_scope) continue; // Selection changed during the request.
      if (!child && (!item.variant_id || item.variant_id === data.variant_id)) {
        const preview = {};
        const protectBrowserPreview = item.preview_source === 'browser' && data.extraction_status !== 'verified';
        if (!protectBrowserPreview && data.merchant_url && (data.merchant_url !== item.url || !item.merchant_url)) preview.merchant_url = data.merchant_url;
        if (!protectBrowserPreview && data.image) preview.image = data.image;
        if (!protectBrowserPreview && data.description) preview.description = data.description;
        if (data.merchant_category) preview.merchant_category = data.merchant_category;
        if ([new URL(item.url).hostname, item.merchant_url && new URL(item.merchant_url).hostname].includes(item.title) && data.title) preview.title = data.title;
        if (item.category_source === 'rules') Object.assign(preview, guessCategory({ ...item, ...preview, url: preview.merchant_url || item.merchant_url || item.url }));
        store.update(item.id, preview);
      }
      if (['needs_variant', 'out_of_stock'].includes(data.extraction_status) || (item.variant_id && data.variant_id !== item.variant_id) || !Number.isFinite(data.price) || data.price <= 0 || !data.currency || (item.currency && data.currency !== item.currency)) {
        result.unavailable++; write({ last_checked_at: now(), extraction_status: data.extraction_status === 'needs_variant' ? 'needs_variant' : data.extraction_status === 'out_of_stock' ? 'out_of_stock' : 'unavailable', ...(!child ? { variants_json: JSON.stringify(data.variants || []) } : {}) }); continue;
      }
      // When a price returns above target, a later drop may trigger a fresh alert.
      const baseline = item.watch_scope !== 'product' && !item.variant_id && data.variant_id ? data.price : item.baseline_price ?? data.price;
      const observed = { ...item, baseline_price: baseline };
      const reset = aboveThreshold(observed, data.price);
      write({
        price: data.price, baseline_price: baseline, currency: data.currency, price_source: data.price_source || null,
        variant_label: item.watch_scope === 'product' ? null : data.variant_label || item.variant_label || null,
        ...(!child ? { variant_id: item.watch_scope === 'product' ? null : data.variant_id || item.variant_id || null, variants_json: JSON.stringify(data.variants || []), price_kind: data.price_kind || 'exact', matched_variant: data.matched_variant || null } : {}), extraction_status: 'verified',
        observed_at: now(), last_checked_at: now(), ...(reset ? { last_notified_at: null } : {})
      });
      if (shouldAlert({ ...observed, last_notified_at: reset ? null : item.last_notified_at }, data.price, data.currency)) {
        if (!notify) { result.errors.push(`${item.id}: Phone notifications are not configured`); continue; }
        await notify({ item: { ...item, id: saved.item_id || item.id, currency: data.currency, variant_label: data.variant_label || item.variant_label, matched_variant: data.matched_variant }, price: data.price });
        if (read()) write({ last_notified_at: now() });
        result.alerted++;
      }
    } catch (error) { if (read()) write({ last_checked_at: now(), extraction_status: 'unavailable' }); result.errors.push(`${item.id}: ${error.message}`); }
  }
  return result;
}
