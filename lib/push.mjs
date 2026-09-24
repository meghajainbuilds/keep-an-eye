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

export async function sendPushAlert(store, { item, price, publicKey, privateKey, subject, send = webpush.sendNotification }) {
  const subscriptions = store.subscriptions();
  if (!subscriptions.length) throw new Error('Enable phone notifications to receive price alerts.');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(price);
  const payload = JSON.stringify({ title: `Price alert: ${item.title.slice(0, 55)}`,
    body: `${money} at the store. Check size and checkout price.`, url: `/?item=${encodeURIComponent(item.id)}` });
  let accepted = 0;
  for (const entry of subscriptions) {
    try {
      await send({ endpoint: entry.endpoint, keys: { p256dh: entry.p256dh, auth: entry.auth } }, payload,
        { vapidDetails: { subject, publicKey, privateKey }, TTL: 86400 });
      accepted++;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) store.removeSubscription(entry.endpoint);
      else console.error('Push service rejected an alert:', error.statusCode || error.message);
    }
  }
  if (!accepted) throw new Error('No phone push service accepted this price alert.');
  // A push service accepting the message is not proof it appeared on a phone.
  return accepted;
}
