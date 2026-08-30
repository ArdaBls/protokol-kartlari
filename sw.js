// v3.3.0 (30 Ağustos 2026) -- Faz 2: Rektörlük/koordinatörlük hiyerarşisi, koordinatörlük ek
// görev alanı, fotoğraf yardım ikonu, birim/unvan aranabilir dropdown. v3.2.0: onboarding +
// PIN ile hızlı hesap değiştirme. v3.1.0: çok sayfalı mimari. Ana sürüm = kırılgan/mimari
// değişiklik, ikinci hane = yeni özellik, üçüncü hane = hata düzeltmesi.
const CACHE_NAME = "omu-protokol-v3.3.0"; // Her büyük değişiklikte veya ikon değişiminde bu numarayı artır

// Kendi sitenin dosyaları (uygulama iskeleti)
const APP_SHELL = [
  "./index.html",
  "./protokol.html",
  "./takvim.html",
  "./admin.html",
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