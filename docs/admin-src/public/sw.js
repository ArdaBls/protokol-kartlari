// Protokol — tek site geneli service worker
//
// Kullanıcı isteği: site artık tek bir kök altında yayınlanıyor (admin/production/
// önek yolu kaldırıldı), bu yüzden eski iki AYRI service worker (kök sw.js +
// admin-src/public/sw.js) artık aynı '/sw.js' dosya yoluna ve aynı '/' scope'una
// yazıyor olurdu -- ikisi bir arada duramaz (tarayıcı son kaydedileni aktif eder,
// diğeri sessizce devre dışı kalır). Bu dosya ikisinin mantığını BİRLEŞTİRİYOR:
// kök sw.js'in dış-kütüphane (Firebase/Sortable/Fuse) stale-while-revalidate
// stratejisi + admin panelinin hash'li derleme çıktıları (js/assets/images/fonts)
// için cache-first stratejisi + tüm HTML sayfaları için network-first (çevrimdışı
// olunca en son önbelleklenene, o da yoksa cevrimdisi.html'e düşer).
//
// Sürüm numarası: her önemli değişiklikte veya ikon/önbellek şeması değişiminde
// artırılmalı (eski iki sürüm şeması -- omu-protokol-vX / protokol-admin-vX --
// artık TEK bir şemada birleşti).
const CACHE_NAME = "protokol-v3.64.0";

const OFFLINE_URL = "./cevrimdisi.html";

// Uygulama iskeleti: hem halka açık kart sayfası hem de yeni ana panel.
const APP_SHELL = [
  "./index.html",
  "./protokol.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./site.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  OFFLINE_URL
];

// Dış statik kütüphaneler (nadiren değişir, offline çalışmak için şart)
const STATIC_LIBS = [
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js",
  "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => {
      return c.addAll(APP_SHELL).catch(() => {}).then(() => {
        // Dış kütüphaneler CDN'den geldiği için tek tek ekle,
        // biri başarısız olsa bile kurulum tamamen çökmesin
        return Promise.all(
          STATIC_LIBS.map((url) => c.add(url).catch((err) => console.log("Önbelleğe alınamadı:", url, err)))
        );
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = req.url;

  // 0) Sadece http/https istekleri (chrome-extension:// vb. Cache API'de desteklenmiyor)
  if (!url.startsWith("http")) return;

  // 1) Firebase veritabanı / auth istekleri: ASLA önbelleğe alma, doğrudan ağa bırak
  if (url.includes("firebaseio.com") || url.includes("firebasedatabase.app") || url.includes("googleapis.com")) {
    return;
  }

  // 2) Dış statik kütüphaneler + fontlar: stale-while-revalidate
  const isStaticLib = STATIC_LIBS.includes(url) || url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com") || url.includes("cdn.jsdelivr.net");
  if (isStaticLib) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const networkFetch = fetch(req).then((response) => {
            cache.put(req, response.clone());
            return response;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  const sameOrigin = url.startsWith(self.location.origin);

  // 3) Panelin hash'li derleme çıktıları (js/assets/images/fonts): cache-first,
  // dosya adları içerik-hash'li olduğu için değişince zaten yeni bir URL doğar.
  if (sameOrigin && /\/(js|assets|images|fonts)\//.test(new URL(url).pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((response) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(req, response.clone())).catch(() => {});
        return response;
      }))
    );
    return;
  }

  // 4) Geri kalan her şey (HTML sayfaları dahil kendi dosyaların): önce ağdan
  // taze veriyi dene, olmazsa önbellekten, o da yoksa (sayfa isteğiyse)
  // çevrimdışı sayfasına düş.
  e.respondWith(
    fetch(req)
      .then((response) => {
        if (sameOrigin) {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, response.clone())).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match(OFFLINE_URL) : undefined))
      )
  );
});
