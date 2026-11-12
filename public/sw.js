self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(clients.claim()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message || typeof message.title !== 'string') return;
  const destination = new URL(message.url || '/', self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil((async () => { await self.registration.showNotification(message.title, {
    body: message.body || 'A saved product met your price watch.',
    icon: '/icon.svg', tag: message.notificationId || destination.search, data: { url: destination.href, notificationId: message.notificationId }
  });
    if (Number.isSafeInteger(message.unreadCount) && message.unreadCount >= 0 && self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(message.unreadCount); } catch { /* OS permissions control badges. */ }
    }
    for (const client of await clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type:'price-alert'});
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin);
  if (destination.origin !== self.location.origin) return;
  if (event.notification.data?.notificationId) destination.searchParams.set('notification', event.notification.data.notificationId);
  const url = destination.href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(window => new URL(window.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return clients.openWindow(url);
  })());
});
