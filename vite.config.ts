import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import customerStoreDiscoveryPlugin from './vite-plugin-store-discovery.js'

/**
 * Version the icon URLs by their own content.
 *
 * An installed PWA keeps showing the icon it was installed with. These files
 * had fixed names, so replacing one changed nothing the phone could notice:
 * the URL was identical and the manifest byte-for-byte the same, so both the
 * installed shortcut and the service worker's CacheFirst image rule kept
 * serving the old picture until the app was deleted and installed again.
 *
 * Hashing the files into the URLs makes a new icon a new URL, which makes the
 * manifest different, which is the signal Chrome's periodic update check needs
 * before it will rebuild an installed app's icon. Nothing to bump by hand —
 * replace an icon and the version follows.
 */
const ICON_FILES = [
  'public/logo-192.png',
  'public/logo-512.jpg',
  'public/favicon-32.png',
  'public/apple-touch-icon.png',
]
const iconVersion = ICON_FILES
  .reduce(
    (hash, file) => hash.update(readFileSync(path.resolve(import.meta.dirname, file))),
    createHash('sha256'),
  )
  .digest('hex')
  .slice(0, 8)

/** Keep the <link rel="icon"> tags in index.html on the same version. */
function versionHtmlIcons() {
  return {
    name: 'storeflow-version-html-icons',
    transformIndexHtml(html: string) {
      return html.replace(
        /\/(favicon-32\.png|apple-touch-icon\.png)(?!\?)/g,
        `/$1?v=${iconVersion}`,
      )
    },
  }
}

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
    versionHtmlIcons(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // Serve .well-known files without extension check
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'favicon.svg', 'icons.svg', '.well-known/**'],
      manifest: {
        // Pinned so a changing icon or start_url is never read as a different
        // app. Without it Chrome derives the id from start_url, which carries
        // a utm parameter and would take the install with it if that changed.
        id: '/',
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
          { src: `logo-192.png?v=${iconVersion}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `logo-512.jpg?v=${iconVersion}`, sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
          { src: `logo-512.jpg?v=${iconVersion}`, sizes: '512x512', type: 'image/jpeg', purpose: 'maskable' }
        ],
        shortcuts: [
          {
            name: 'Scan QR Code',
            short_name: 'Scan',
            description: 'Open camera to scan a store QR code',
            url: '/?action=scan',
            icons: [{ src: `logo-192.png?v=${iconVersion}`, sizes: '192x192', type: 'image/png' }]
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
