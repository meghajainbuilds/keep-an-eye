import { inspectProduct } from './product.mjs';

export function shouldAlert(item, nextPrice, nextCurrency) {
  if (nextPrice == null || !nextCurrency || item.currency && item.currency !== nextCurrency || item.last_notified_at) return false;
  return item.target_price != null && nextPrice <= item.target_price ||
    item.discount_percent != null && item.baseline_price != null &&
    nextPrice <= item.baseline_price * (1 - item.discount_percent / 100);
}

function aboveThreshold(item, price) {
  return (item.target_price == null || price > item.target_price) &&
    (item.discount_percent == null || item.baseline_price == null || price > item.baseline_price * (1 - item.discount_percent / 100));
}

export async function checkPrices(store, options = {}) {
  const inspect = options.inspect || inspectProduct;
  const notify = options.notify;
  const now = options.now || (() => new Date().toISOString());
  const result = { checked: 0, alerted: 0, unavailable: 0, errors: [] };
  for (const item of store.list().filter(i => i.target_price != null || i.discount_percent != null)) {
    try {
      const data = await inspect(item.url);
      result.checked++;
      if (data.price === null || !data.currency || (item.currency && data.currency !== item.currency)) {
        result.unavailable++; store.update(item.id, { last_checked_at: now() }); continue;
      }
      // When a price returns above target, a later drop may trigger a fresh alert.
      const baseline = item.baseline_price ?? data.price;
      const observed = { ...item, baseline_price: baseline };
      const reset = aboveThreshold(observed, data.price);
      store.update(item.id, {
        price: data.price, baseline_price: baseline, currency: data.currency, price_source: data.price_source,
        observed_at: now(), last_checked_at: now(), ...(reset ? { last_notified_at: null } : {})
      });
      if (shouldAlert({ ...observed, last_notified_at: reset ? null : item.last_notified_at }, data.price, data.currency)) {
        if (!notify) { result.errors.push(`${item.id}: Phone notifications are not configured`); continue; }
        await notify({ item: { ...item, currency: data.currency }, price: data.price });
        store.update(item.id, { last_notified_at: now() });
        result.alerted++;
      }
    } catch (error) { result.errors.push(`${item.id}: ${error.message}`); }
  }
  return result;
}
