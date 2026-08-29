import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './design-system.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import { subscribeUserToPush } from './utils/pushNotifications'
import { installEmailProviderSuggestions } from './utils/emailProviderSuggestions'

// Installed StoreFlow Customer is a PWA, so an old service worker can keep an
// old app shell alive even after Vercel already has a newer deployment. Do not
// clear storage/caches here: customer identity, scanned stores and offline order
// state are intentionally local-first. Instead, explicitly ask the registered
// worker to check for a new sw.js whenever the app is launched/resumed/online.
if ('serviceWorker' in navigator) {
  let refreshing = false
  let activeRegistration: ServiceWorkerRegistration | null = null
  let updateInFlight: Promise<void> | null = null

  const checkForPwaUpdate = async () => {
    if (updateInFlight) return updateInFlight
    updateInFlight = (async () => {
      try {
        const reg = activeRegistration || await navigator.serviceWorker.getRegistration('/')
        if (!reg) return
        activeRegistration = reg
        await reg.update()
      } catch (err) {
        // Update checks must never stop the app from opening offline.
        console.debug('[SW] Update check skipped:', err)
      } finally {
        updateInFlight = null
      }
    })()
    return updateInFlight
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async (reg) => {
        activeRegistration = reg
        console.log('[SW] Background Service Worker registered successfully:', reg.scope)
        await checkForPwaUpdate()
        if ('Notification' in window && Notification.permission === 'granted') {
          subscribeUserToPush().catch(() => {})
        }
      })
      .catch((err) => console.warn('[SW] Service Worker registration failed:', err))
  })

  // Android can leave an installed PWA suspended for hours/days. Resuming it
  // should immediately check the production worker rather than waiting for the
  // browser's normal service-worker update interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void checkForPwaUpdate()
    }
  })
  window.addEventListener('online', () => void checkForPwaUpdate())
  window.addEventListener('pageshow', () => {
    if (navigator.onLine) void checkForPwaUpdate()
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}

if (typeof window !== 'undefined') {
  installEmailProviderSuggestions()
}

const root = document.getElementById('root')
if (!root) throw new Error('StoreFlow root element was not found.')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
