/* Minimal notification worker. No private response caching or offline mutation queue. */
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* A generic notification is safe without private payload parsing. */ }
  const path = typeof payload.path === 'string' && /^\/(?:plan|today|home|act|settings)(?:\?[^#]*)?$/.test(payload.path) ? payload.path : '/plan';
  event.waitUntil(self.registration.showNotification('HALO', {
    body: 'You have an update in HALO.', icon: '/halo-logo-mark.png', badge: '/halo-logo-mark.png',
    tag: typeof payload.id === 'string' ? payload.id.slice(0,120) : undefined, data: { path },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.path === 'string' ? event.notification.data.path : '/plan';
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) if (new URL(client.url).origin === target.origin && 'focus' in client) { await client.navigate(target.href); return client.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
