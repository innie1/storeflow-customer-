import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Serve .well-known files without extension check
      includeAssets: ['logo.jpg', 'favicon.svg', 'icons.svg', '.well-known/**'],
      manifest: {
        name: 'StoreFlow Customer',
        short_name: 'StoreFlow',
        description: 'Scan, Order, and Collect in under a minute — no account needed.',
        theme_color: '#2F343A',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/?utm_source=pwa',
        categories: ['shopping'],
        icons: [
          {
            src: 'logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any'
          },
          {
            src: 'logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'maskable'
          }
        ],
        shortcuts: [
          {
            name: 'Scan QR Code',
            short_name: 'Scan',
            description: 'Open camera to scan a store QR code',
            url: '/?action=scan',
            icons: [{ src: 'logo.jpg', sizes: '512x512', type: 'image/jpeg' }]
          }
        ]
      },
      workbox: {
        // Cache pages / navigation with NetworkFirst (fresh data, offline fallback)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/.well-known\//],
        runtimeCaching: [
          {
            // Supabase REST API — NetworkFirst for live inventory
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 } // 5 min
            }
          },
          {
            // Product images — CacheFirst (images rarely change)
            urlPattern: /\.(png|jpg|jpeg|webp|svg|gif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } // 7 days
            }
          },
          {
            // Google Fonts — CacheFirst
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ]
})
