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
  for (const saved of store.list().filter(i => options.itemId ? i.id === options.itemId : i.watch_enabled !== 0 && (i.target_price != null || i.discount_percent != null))) {
    let item = saved;
    try {
      const data = await inspect(item.selected_url || item.url, { variant_id: item.variant_id });
      result.checked++;
      item = store.get(saved.id);
      if (!item || !options.itemId && item.watch_enabled === 0) continue;
      if (item.variant_id !== saved.variant_id) continue; // Selection changed during the request.
      if (!item.variant_id || item.variant_id === data.variant_id) {
        const preview = {};
        if (data.image) preview.image = data.image;
        if (data.description) preview.description = data.description;
        if (item.title === new URL(item.url).hostname && data.title) preview.title = data.title;
        if (item.category_source !== 'manual') Object.assign(preview, guessCategory({ ...item, ...preview }));
        store.update(item.id, preview);
      }
      if (['needs_variant', 'out_of_stock'].includes(data.extraction_status) || (item.variant_id && data.variant_id !== item.variant_id) || !Number.isFinite(data.price) || data.price <= 0 || !data.currency || (item.currency && data.currency !== item.currency)) {
        result.unavailable++; store.update(item.id, { last_checked_at: now(), extraction_status: data.extraction_status === 'needs_variant' ? 'needs_variant' : data.extraction_status === 'out_of_stock' ? 'out_of_stock' : 'unavailable', variants_json: JSON.stringify(data.variants || []) }); continue;
      }
      // When a price returns above target, a later drop may trigger a fresh alert.
      const baseline = !item.variant_id && data.variant_id ? data.price : item.baseline_price ?? data.price;
      const observed = { ...item, baseline_price: baseline };
      const reset = aboveThreshold(observed, data.price);
      store.update(item.id, {
        price: data.price, baseline_price: baseline, currency: data.currency, price_source: data.price_source || null,
        variant_id: data.variant_id || item.variant_id || null, variant_label: data.variant_label || item.variant_label || null,
        variants_json: JSON.stringify(data.variants || []), extraction_status: 'verified',
        observed_at: now(), last_checked_at: now(), ...(reset ? { last_notified_at: null } : {})
      });
      if (shouldAlert({ ...observed, last_notified_at: reset ? null : item.last_notified_at }, data.price, data.currency)) {
        if (!notify) { result.errors.push(`${item.id}: Phone notifications are not configured`); continue; }
        await notify({ item: { ...item, currency: data.currency }, price: data.price });
        store.update(item.id, { last_notified_at: now() });
        result.alerted++;
      }
    } catch (error) { if (store.get(saved.id)) store.update(saved.id, { last_checked_at: now(), extraction_status: 'unavailable' }); result.errors.push(`${item.id}: ${error.message}`); }
  }
  return result;
}
