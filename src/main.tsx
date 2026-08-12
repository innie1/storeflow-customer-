import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './design-system.css'
import App from './App.tsx'
import AppErrorBoundary from './components/AppErrorBoundary'
import ServiceBusinessExperience from './components/ServiceBusinessExperience'
import { subscribeUserToPush } from './utils/pushNotifications'
import { installEmailProviderSuggestions } from './utils/emailProviderSuggestions'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] Background Service Worker registered successfully:', reg.scope)
        if ('Notification' in window && Notification.permission === 'granted') {
          subscribeUserToPush().catch(() => {})
        }
      })
      .catch((err) => console.warn('[SW] Service Worker registration failed:', err))
  })
  let refreshing = false
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
      <ServiceBusinessExperience />
    </AppErrorBoundary>
  </StrictMode>,
)