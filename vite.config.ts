import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import customerStoreDiscoveryPlugin from './vite-plugin-store-discovery.js'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        // The app shipped as one ~654 kB chunk, so a customer re-downloaded
        // React and the whole Supabase client on every deploy even when only
        // app code changed. Splitting the two big, rarely-changing vendor
        // groups out lets them stay in the browser cache across releases.
        advancedChunks: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: 'supabase-vendor', test: /node_modules[\/]@supabase[\/]/ },
          ],
        },
      },
    },
  },
  plugins: [
    customerStoreDiscoveryPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // Serve .well-known files without extension check
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'favicon.svg', 'icons.svg', '.well-known/**'],
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
        // These declared 512x512 but pointed at a 1024x1024 file, so every
        // install downloaded 175 kB to render a home-screen icon.
        icons: [
          { src: 'logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'logo-512.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
          { src: 'logo-512.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' }
        ],
        shortcuts: [
          {
            name: 'Scan QR Code',
            short_name: 'Scan',
            description: 'Open camera to scan a store QR code',
            url: '/?action=scan',
            icons: [{ src: 'logo-192.png', sizes: '192x192', type: 'image/png' }]
          }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/.well-known\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 }
            }
          },
          {
            urlPattern: /\.(png|jpg|jpeg|webp|svg|gif)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          },
          {
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
