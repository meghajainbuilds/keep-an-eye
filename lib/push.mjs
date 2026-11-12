import webpush from 'web-push';

const decodeKey = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return Buffer.from(value, 'base64url');
};

export function validSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return false;
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { return false; }
  // Push endpoints are fetched by our server; only accept known browser push services.
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port ||
      !(endpoint.hostname.endsWith('.push.apple.com') ||
        endpoint.hostname === 'fcm.googleapis.com' ||
        endpoint.hostname === 'updates.push.services.mozilla.com')) return false;
  return decodeKey(value.keys?.p256dh)?.length === 65 && decodeKey(value.keys?.auth)?.length === 16;
}

async function deliverPushAlert(store, { item, price, publicKey, privateKey, subject, notificationId, send = webpush.sendNotification }) {
  const subscriptions = store.subscriptions();
  if (!subscriptions.length) throw new Error('Enable phone notifications to receive price alerts.');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(price);
  const payload = JSON.stringify({ notificationId, unreadCount: store.unreadCount(), title: `Price alert: ${item.title.slice(0, 55)}`,
    body: `${item.watch_scope === 'product' ? 'From ' : ''}${money} · ${item.variant_label || item.matched_variant || 'Product price'}. Confirm availability at the store.`, url: `/?item=${encodeURIComponent(item.id)}` });
  let accepted = 0, failed = 0;
  for (const entry of subscriptions) {
    if (notificationId && store.wasDelivered(notificationId, entry.endpoint)) { accepted++; continue; }
    try {
      await send({ endpoint: entry.endpoint, keys: { p256dh: entry.p256dh, auth: entry.auth } }, payload,
        { vapidDetails: { subject, publicKey, privateKey }, TTL: 86400, timeout: 15_000 });
      if (notificationId) store.delivered(notificationId, entry.endpoint);
      accepted++;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) store.removeSubscription(entry.endpoint);
      else { failed++; console.error('Push service rejected an alert:', error.statusCode || 'delivery_error'); }
    }
  }
  if (failed) throw new Error('Some phone push services could not accept this alert.');
  if (!accepted) throw new Error('No phone push service accepted this price alert.');
  // A push service accepting the message is not proof it appeared on a phone.
  return accepted;
}

// Coalesce outbox retries and price checks for the same event in this process.
const deliveries = new Map();
export function sendPushAlert(store, options) {
  if (!options.notificationId) return deliverPushAlert(store, options);
  const key = options.notificationId;
  if (deliveries.has(key)) return deliveries.get(key);
  const result = deliverPushAlert(store, options).finally(() => deliveries.delete(key));
  deliveries.set(key, result);
  return result;
}
