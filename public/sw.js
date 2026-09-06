// Service Worker：处理 Web Push 通知展示
self.addEventListener('push', event => {
  let data = { title: 'KidTodo 提醒', body: '到时间做任务啦！', url: '/' };
  try { data = Object.assign(data, event.data.json()); } catch (e) { /* 默认 */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'kidtodo-reminder',
    renotify: true,
    vibrate: [300, 120, 300, 120, 500],
    requireInteraction: true,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'));
});
