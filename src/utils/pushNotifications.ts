import { supabase } from '../supabase';
import { getStoredOrderCredentials } from '../lib/orderTokens';

// Default public VAPID key (matching deployed server keypair, or loaded from environment variable)
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BPynrw1Xha05EzgzG_YEMdVyRGsuSlG62pPzLxprxWumTfVetPfAe5kyBM_yLbH_PDId9QjVwdoElfUDtljmGTQ';

/** Utility to convert base64 URL VAPID key to Uint8Array required by PushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushNotificationSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

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
 * Register this browser endpoint for every order token currently held on the
 * device. The optional legacy identifier is accepted so older call sites do not
 * break, but phone/name is never used as authorization or stored by this path.
 */
export async function subscribeUserToPush(_legacyCustomerIdentifier?: string): Promise<boolean> {
  if (!isPushNotificationSupported()) return false;

  try {
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      console.warn('[Push] Permission not granted for push notifications.');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (subscription && !localStorage.getItem('storeflow_vapid_v2_active')) {
      try {
        console.log('[Push] Clearing outdated push subscription to register current VAPID key...');
        await subscription.unsubscribe();
        subscription = null;
        localStorage.setItem('storeflow_vapid_v2_active', 'true');
      } catch (e) {
        console.warn('[Push] Error refreshing old push subscription:', e);
      }
    }

    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey as unknown as BufferSource,
      });
      localStorage.setItem('storeflow_vapid_v2_active', 'true');
      console.log('[Push] Successfully created Web Push subscription.');
    }

    const subscriptionJson = subscription.toJSON();
    const endpoint = subscription.endpoint;
    const p256dh = subscriptionJson.keys?.p256dh || '';
    const auth = subscriptionJson.keys?.auth || '';
    const credentials = getStoredOrderCredentials();

    if (!endpoint || !p256dh || !auth) {
      console.warn('[Push] Browser returned an incomplete subscription.');
      return false;
    }

    if (credentials.length === 0) {
      // Permission/subscription can exist before the first order. There is no
      // customer identity to bind until secure checkout hands this device a
      // private order token.
      console.log('[Push] Browser subscribed; no local order token to bind yet.');
      return true;
    }

    const results = await Promise.all(
      credentials.map(async credential => {
        const { error } = await supabase.rpc('upsert_customer_order_push_subscription', {
          p_order_id: credential.order_id,
          p_access_token: credential.access_token,
          p_endpoint: endpoint,
          p_p256dh: p256dh,
          p_auth: auth,
        });
        if (error) {
          console.warn('[Push] Could not bind subscription to order:', credential.order_id, error.message);
          return false;
        }
        return true;
      })
    );

    return results.some(Boolean);
  } catch (error) {
    console.error('[Push] Failed to register push subscription:', error);
    return false;
  }
}

/** Clear system tray notifications for a specific order. */
export async function clearNotificationsForOrder(orderId: string): Promise<void> {
  if (!isPushNotificationSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'CLEAR_NOTIFICATIONS', orderId });
  } catch (err) {
    console.warn('[Push] clearNotificationsForOrder error:', err);
  }
}

/** Clear all StoreFlow notifications from the system tray. */
export async function clearAllStoreFlowNotifications(): Promise<void> {
  if (!isPushNotificationSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'CLEAR_NOTIFICATIONS' });
  } catch (err) {
    console.warn('[Push] clearAllStoreFlowNotifications error:', err);
  }
}
