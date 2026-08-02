/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// Precache static assets compiled by Vite
precacheAndRoute(self.__WB_MANIFEST || []);

// 1. Supabase REST API caching strategy
registerRoute(
  /^https:\/\/[a-z]+\.supabase\.co\/rest\/.*/i,
  new NetworkFirst({
    cacheName: 'supabase-api',
    networkTimeoutSeconds: 3,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 5, // 5 minutes
      }),
    ],
  })
);

// 2. Product images caching strategy
registerRoute(
  /\.(png|jpg|jpeg|webp|svg|gif)$/i,
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      }),
    ],
  })
);

// 3. Google Fonts caching strategy
registerRoute(
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  })
);

// =========================================================================
// BACKGROUND PUSH NOTIFICATION HANDLER
// Fires EVEN WHEN THE APP TAB IS CLOSED OR IN THE BACKGROUND
// =========================================================================
self.addEventListener('push', (event: PushEvent) => {
  console.log('[SW Push] Background push event received:', event);

  let data = {
    title: 'StoreFlow Order Update',
    body: 'You have a new status update on your order!',
    icon: '/logo.jpg',
    badge: '/logo.jpg',
    url: '/',
    tag: 'storeflow-notification',
    orderId: '',
    orderNumber: '',
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch {
      data.body = event.data.text();
    }
  }

  const targetUrl = data.url && data.url !== '/' ? data.url : (data.orderId ? `/?tracking_order_id=${data.orderId}` : '/');

  const notificationOptions: NotificationOptions = {
    body: data.body,
    icon: data.icon || '/logo.jpg',
    badge: data.badge || '/logo.jpg',
    data: {
      url: targetUrl,
      orderId: data.orderId || null,
      orderNumber: data.orderNumber || null,
      dateOfArrival: Date.now(),
    },
    tag: data.tag || (data.orderId ? `order-${data.orderId}` : 'storeflow-push'),
  };

  event.waitUntil(
    self.registration.showNotification(data.title, notificationOptions)
  );
});

// =========================================================================
// NOTIFICATION TAP / CLICK HANDLER
// Opens/focuses the app window and navigates directly to order tracking
// =========================================================================
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  console.log('[SW Notification] User tapped notification:', event.notification);
  event.notification.close();

  const notificationData = event.notification.data || {};
  const orderId = notificationData.orderId;
  const orderNumber = notificationData.orderNumber || '';
  const targetUrl = notificationData.url || (orderId ? `/?tracking_order_id=${orderId}` : '/');

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList: readonly Client[]) => {
        // If an app window/tab is already open, focus it, navigate, and postMessage
        for (const client of clientList) {
          const windowClient = client as WindowClient;
          if ('focus' in windowClient) {
            windowClient.focus();
            if ('navigate' in windowClient) {
              windowClient.navigate(targetUrl);
            }
            if (orderId) {
              windowClient.postMessage({
                type: 'STOREFLOW_OPEN_ORDER',
                orderId: orderId,
                orderNumber: orderNumber,
              });
            }
            return;
          }
        }
        // Otherwise open a new window directly with targetUrl
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// Immediately activate service worker upon update
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
