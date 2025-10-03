const CACHE_NAME = 'dog-bark-sw-v1';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Listen for push events (if you implement Web Push later)
self.addEventListener('push', event => {
  let data = { title: 'Dog bark', body: 'Check the app' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // ignore
  }
  const promise = self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag || 'dog-bark'
  });
  event.waitUntil(promise);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', event => {
  // For now, just pass through
  event.respondWith(fetch(event.request));
});
