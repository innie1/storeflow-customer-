/// <reference lib="webworker" />
// StoreFlow Customer Service Worker
//
// Production-grade push notification handler with:
// - Foreground suppression (no system notification if app window is visible)
// - Auto-clear stale notifications via CLEAR_NOTIFICATIONS message
// - Badge count management
// - Tag-based deduplication (no renotify)
// - Priority-based requireInteraction

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST || []);

// Supabase REST API caching
registerRoute(
  /^https:\/\/[a-z]+\.supabase\.co\/rest\/.*/i,
  new NetworkFirst({
    cacheName: 'supabase-api',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  })
);

// Product images caching
registerRoute(
  /\.(png|jpg|jpeg|webp|svg|gif)$/i,
  new CacheFirst({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 604800 })],
  })
);

// Google Fonts caching
registerRoute(
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 31536000 })],
  })
);

// ─── Push Notifications ──────────────────────────────────────────────────

self.addEventListener('push', (event: PushEvent) => {
  let data: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    tag?: string;
    notification_id?: string;
    orderId?: string;
    orderNumber?: string;
    priority?: 'critical' | 'normal';
  } = {
    title: 'StoreFlow Order Update',
    body: 'You have a new status update on your order!',
    icon: '/logo-192.png',
    badge: '/logo-192.png',
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

  const tag = data.tag || data.notification_id || (data.orderId ? `order-${data.orderId}` : 'storeflow-push');
  const targetUrl = data.url && data.url !== '/'
    ? data.url
    : (data.orderId ? `/?tracking_order_id=${data.orderId}` : '/');
  const priority = data.priority || 'normal';

  const showNotification = () => {
    const options: any = {
      body: data.body || 'New update received!',
      icon: data.icon || '/logo-192.png',
      badge: data.badge || '/logo-192.png',
      data: {
        url: targetUrl,
        orderId: data.orderId || null,
        orderNumber: data.orderNumber || null,
      },
      tag,
      renotify: false, // Don't re-display same-tag notifications — dedup
      requireInteraction: priority === 'critical', // Only pin critical ones
      vibrate: priority === 'critical' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    };

    return self.registration.showNotification(data.title || 'StoreFlow', options);
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Check if any visible window exists
      const visibleClient = clients.find(
        (c) => (c as WindowClient).visibilityState === 'visible'
      ) as WindowClient | undefined;

      if (visibleClient) {
        // App is in foreground — relay to app for in-app toast instead
        visibleClient.postMessage({
          type: 'STOREFLOW_PUSH_RECEIVED',
          title: data.title || 'StoreFlow',
          body: data.body || '',
          url: targetUrl,
          orderId: data.orderId || null,
          orderNumber: data.orderNumber || null,
          tag,
          priority,
        });
        // Don't show system notification — app handles it
        return;
      }

      // App is in background or closed — show system notification
      await showNotification();

      // Update badge
      const existing = await self.registration.getNotifications();
      if ('setAppBadge' in navigator) {
        try { (navigator as any).setAppBadge(existing.length + 1); } catch {}
      }
    })
  );
});

// ─── Notification Click ──────────────────────────────────────────────────

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const orderId = notifData.orderId;
  const orderNumber = notifData.orderNumber || '';
  const targetUrl = notifData.url || (orderId ? `/?tracking_order_id=${orderId}` : '/');

  event.waitUntil(
    (async () => {
      // Clear badge
      if ('clearAppBadge' in navigator) {
        try { (navigator as any).clearAppBadge(); } catch {}
      }

      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      // Find existing open window
      for (const client of clientList) {
        const wc = client as WindowClient;
        if ('focus' in wc) {
          await wc.focus();
          if ('navigate' in wc) {
            await wc.navigate(targetUrl).catch(() => {});
          }
          if (orderId) {
            wc.postMessage({
              type: 'STOREFLOW_OPEN_ORDER',
              orderId,
              orderNumber,
            });
          }
          return;
        }
      }

      // No window open — open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// ─── Message Handler (clear notifications from app) ──────────────────────

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'CLEAR_NOTIFICATIONS') {
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications();
        const orderId = msg.orderId;

        for (const n of notifications) {
          if (orderId) {
            if (n.data?.orderId === orderId || n.tag?.includes(orderId)) {
              n.close();
            }
          } else {
            n.close();
          }
        }

        if ('clearAppBadge' in navigator) {
          try { (navigator as any).clearAppBadge(); } catch {}
        }
      })()
    );
  }
});

// ─── Lifecycle ───────────────────────────────────────────────────────────

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
