import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const THEME_COLOR = '#0f0b15'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const MAX_PRECACHE_BYTES = 4 * 1024 * 1024

// https://vite.dev/config/
export default defineConfig({
  build: {
    // GitHub Pages bu depoda docs/ klasörünü yayınlıyor; build çıktısı doğrudan buraya gider.
    outDir: 'docs',
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Yeni sürüm sessizce devreye girmez; kullanıcı "Yenile" deyince geçilir (açık formdaki veri kaybolmasın).
      registerType: 'prompt',
      includeAssets: ['icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-180.png'],
      manifest: {
        id: '/',
        name: 'OMÜ Protokol',
        short_name: 'Protokol',
        description: 'OMÜ Basın ve Halkla İlişkiler protokol kartları, etkinlik ve operasyon paneli.',
        lang: 'tr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: THEME_COLOR,
        background_color: THEME_COLOR,
        categories: ['productivity', 'business'],
        icons: [
          { src: '/icons/icon-72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'Protokol Kartları', url: '/protokol', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Takvim', url: '/takvim', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Ayarlar', url: '/ayarlar', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Eski sitedeki elle yazılmış "CACHE_NAME = protokol-vX.Y.Z" deseninin karşılığı --
        // Workbox önbellek adlarının önüne eklenir, sürüm değişince tarayıcı eski önbelleği atar.
        cacheId: 'protokol-v5.0.23',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
        // SPA: doğrudan açılan /protokol gibi adresler çevrimdışıyken de uygulamayı yükler.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Firebase (veritabanı/kimlik) istekleri bilerek eşleşmez: veri her zaman canlı ağdan gelir, önbelleğe alınmaz.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: ONE_YEAR_SECONDS },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
