self.addEventListener('push', (event) => {
  const payload = event.data
    ? event.data.json()
    : { title: 'Gym logger', body: 'Your workout video is ready.', url: '/' };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find(
        (windowClient) => new URL(windowClient.url).origin === location.origin,
      );
      return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
    }),
  );
});
