import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './design-system.css'
import App from './App.tsx'
import { subscribeUserToPush } from './utils/pushNotifications'

// Register Service Worker for background Push Notifications when user exits app
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] Background Service Worker registered successfully:', reg.scope);
        // Auto subscribe for push notifications if permission was already granted
        if ('Notification' in window && Notification.permission === 'granted') {
          subscribeUserToPush().catch(() => {});
        }
      })
      .catch((err) => {
        console.warn('[SW] Service Worker registration failed:', err);
      });
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
