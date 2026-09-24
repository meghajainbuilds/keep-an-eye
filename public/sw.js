self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message || typeof message.title !== 'string') return;
  const destination = new URL(message.url || '/', self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body || 'A saved product met your price watch.',
    icon: '/icon.svg', tag: destination.search, data: { url: destination.href }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || self.location.origin;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(window => new URL(window.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return clients.openWindow(url);
  })());
});
