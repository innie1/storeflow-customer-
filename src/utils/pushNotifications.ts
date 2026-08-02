import { supabase } from '../supabase';

// Default public VAPID key (matching deployed server keypair, or loaded from environment variable)
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BPynrw1Xha05EzgzG_YEMdVyRGsuSlG62pPzLxprxWumTfVetPfAe5kyBM_yLbH_PDId9QjVwdoElfUDtljmGTQ';

/**
 * Utility to convert base64 URL VAPID key to Uint8Array required by pushManager.subscribe
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if the browser supports Service Workers & Push Notifications
 */
export function isPushNotificationSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushNotificationSupported()) {
    console.warn('[Push] Push notifications are not supported in this browser.');
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    console.log('[Push] User notification permission result:', permission);
    return permission;
  } catch (error) {
    console.error('[Push] Error requesting notification permission:', error);
    return 'denied';
  }
}

/**
 * Register push subscription with the browser's PushManager and save subscription to Supabase
 */
export async function subscribeUserToPush(customerIdentifier?: string): Promise<boolean> {
  if (!isPushNotificationSupported()) return false;

  try {
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Permission not granted for push notifications.');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    // If an old subscription existed under a different VAPID key, clear it once so the new valid key can take over
    if (subscription && !localStorage.getItem('storeflow_vapid_v2_active')) {
      try {
        console.log('[Push] Clearing outdated push subscription to register real server VAPID key...');
        await subscription.unsubscribe();
        subscription = null;
        localStorage.setItem('storeflow_vapid_v2_active', 'true');
      } catch (e) {
        console.warn('[Push] Error refreshing old push subscription:', e);
      }
    }

    // If no existing subscription, create a new one with real VAPID key
    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey as unknown as BufferSource,
      });
      localStorage.setItem('storeflow_vapid_v2_active', 'true');
      console.log('[Push] Successfully created real Web Push Subscription:', subscription);
    } else {
      console.log('[Push] Found active Web Push Subscription:', subscription);
    }

    // Save PushSubscription details to customer_push_subscriptions so backend can send push messages even when offline/closed
    const subscriptionJson = subscription.toJSON();
    const endpoint = subscription.endpoint;
    const p256dh = subscriptionJson.keys?.p256dh || '';
    const auth = subscriptionJson.keys?.auth || '';

    const targetPhone = customerIdentifier || localStorage.getItem('storeflow_customer_phone') || localStorage.getItem('storeflow_saved_checkout_phone') || localStorage.getItem('storeflow_last_order_phone');
    if (customerIdentifier && customerIdentifier.replace(/\D/g, '').length >= 10) {
      localStorage.setItem('storeflow_customer_phone', customerIdentifier);
    }

    if (endpoint && targetPhone) {
      let identifier = targetPhone;
      const cleaned = identifier.replace(/\D/g, '');
      if (cleaned.length >= 10) {
        if (cleaned.startsWith('234') && cleaned.length === 13) identifier = '+' + cleaned;
        else if (cleaned.startsWith('0') && cleaned.length === 11) identifier = '+234' + cleaned.substring(1);
        else if (cleaned.length === 10) identifier = '+234' + cleaned;
      }

      const { error } = await supabase.from('customer_push_subscriptions').upsert(
        {
          customer_phone: identifier,
          endpoint: endpoint,
          p256dh: p256dh,
          auth: auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

      if (error) {
        console.warn('[Push] Supabase table `customer_push_subscriptions` error:', error.message);
      } else {
        console.log('[Push] Successfully saved push subscription to Supabase `customer_push_subscriptions` table for:', identifier);
      }
    }

    return true;
  } catch (error) {
    console.error('[Push] Failed to register push subscription:', error);
    return false;
  }
}

/**
 * Display a background-safe system notification via Service Worker registration if available
 * (This works when the app is in the background, minimized, or closed!)
 */
export async function showSystemNotification(title: string, options: NotificationOptions = {}): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const defaultOptions: NotificationOptions = {
    icon: '/logo.jpg',
    badge: '/logo.jpg',
    data: { url: '/' },
    ...options,
  };

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && registration.showNotification) {
        await registration.showNotification(title, defaultOptions);
        return;
      }
    } catch (err) {
      console.warn('[Push] Service worker showNotification fallback:', err);
    }
  }

  // Fallback to standard Notification if SW is not ready
  try {
    new Notification(title, defaultOptions);
  } catch (err) {
    console.warn('[Push] Standard notification failed:', err);
  }
}

