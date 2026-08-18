const CACHE_NAME = "omu-protokol-v2.1.1"; // Her büyük değişiklikte veya ikon değişiminde bu numarayı artır (v5, v6...)

// Kendi sitenin dosyaları (uygulama iskeleti)
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Dış statik kütüphaneler (nadiren değişir, offline çalışmak için şart)
const STATIC_LIBS = [
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"
];

// Kurulum aşaması: Uygulama iskeletini ve kütüphaneleri önbelleğe al
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => {
      return c.addAll(APP_SHELL).then(() => {
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

// Aktivasyon aşaması: Eski tüm önbellekleri anında sil ve temizle
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log("Eski önbellek siliniyor:", k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch (Ağ İstekleri)
self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // 0) Sadece http/https isteklerini ele al. Tarayıcı uzantılarının (chrome-extension://)
  // ürettiği istekler Cache API tarafından desteklenmiyor, bunları hiç işleme.
  if (!url.startsWith("http")) {
    return;
  }

  // 1) Firebase veritabanı / auth istekleri: ASLA önbelleğe alma, doğrudan ağa bırak
  if (url.includes("firebaseio.com") || url.includes("firebasedatabase.app") || url.includes("googleapis.com")) {
    return;
  }

  // 2) Dış statik kütüphaneler (fontlar, sortablejs, firebase sdk dosyaları):
  // Önce önbellekten anında göster, arka planda ağdan güncelle (stale-while-revalidate)
  const isStaticLib = STATIC_LIBS.includes(url) || url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com") || url.includes("cdn.jsdelivr.net");
  if (isStaticLib) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(e.request).then((cached) => {
          const networkFetch = fetch(e.request).then((response) => {
            cache.put(e.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // 3) Kendi dosyaların (index.html, manifest, ikonlar):
  // Önce ağdan taze veriyi dene, internet yoksa önbellekten sun
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, response.clone());
          return response;
        });
      })
      .catch(() => {
        return caches.match(e.request).then((cached) => {
          // Önbellekte de yoksa ve bu bir sayfa isteğiyse, index.html'i fallback olarak göster
          return cached || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined);
        });
      })
  );
});