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

export async function sendSms({ to, from, accountSid, authToken, item, price, request = fetch }) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(price);
  const message = `Keep an Eye: ${item.title.slice(0, 55)} is ${money}, at or below your watch price. Check size and final price: ${item.url}`;
  const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message })
  });
  if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
  const result = await response.json();
  if (!result.sid || ['failed', 'undelivered'].includes(result.status)) throw new Error('SMS provider did not accept the message.');
}

export async function checkPrices(store, options = {}) {
  const inspect = options.inspect || inspectProduct;
  const send = options.send || sendSms;
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
        if (!/^\+[1-9]\d{7,14}$/.test(options.sms?.to || '') ||
          !/^\+[1-9]\d{7,14}$/.test(options.sms?.from || '') ||
          !/^AC[a-f\d]{32}$/i.test(options.sms?.accountSid || '') || !options.sms?.authToken) {
          result.errors.push(`${item.id}: SMS is not configured`); continue;
        }
        await send({ ...options.sms, item: { ...item, currency: data.currency }, price: data.price });
        store.update(item.id, { last_notified_at: now() });
        result.alerted++;
      }
    } catch (error) { result.errors.push(`${item.id}: ${error.message}`); }
  }
  return result;
}
