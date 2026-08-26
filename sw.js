// v3.0.0 (26 Ağustos 2026) -- ilk KARARLI ana sürüm. 2.9.44-2.9.48 arasında takvimin aylardır
// süren üç kök sebebi (SortableJS draggable eksikliği, tüm-gün etkinliğin saat atanamaması,
// kilit ikonunun ::after ile tüm ekranı kaplaması) bulunup düzeltildi, kilit/bildirim sistemi
// baştan yazıldı ve üç veri kaybı hatası (çift gönderim, gece yarısını aşan etkinlik, yedekten
// geri yüklemede görev geçmişi kaybı) kapatıldı. Bu sürümden itibaren: ana sürüm = kırılgan/
// mimari değişiklik, ikinci hane = yeni özellik, üçüncü hane = hata düzeltmesi.
const CACHE_NAME = "omu-protokol-v3.0.0"; // Her büyük değişiklikte veya ikon değişiminde bu numarayı artır

// Kendi sitenin dosyaları (uygulama iskeleti)
const APP_SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Dış statik kütüphaneler (nadiren değişir, offline çalışmak için şart)
const STATIC_LIBS = [
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js",
  "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js"
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