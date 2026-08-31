// v3.8.3 (31 Ağustos 2026) -- admin paneli görsel yenileme (Faz 8): emoji nav ikonları
// gerçek SVG sprite ile değiştirildi (<body> altına eklenen <symbol> bloğu), aktif nav
// öğesi solid lacivert dolgu yerine kart yüzeyi + sol vurgu çubuğuna çevrildi, KPI şeridi
// tek cam panelden her biri ayrı kart olan responsive bir grid'e (.admin-kpi) çevrildi,
// .btn/.admin-nav-item/.admin-back-btn'e ince bir "basılı" mikro-etkileşimi eklendi.
// v3.8.2 (31 Ağustos 2026) -- protokol sıra ağırlıkları (TITLE_HIERARCHY) 0'dan değil 1'den
// başlıyor artık: Vali=1, Milletvekili=2, ... göreli sıra AYNI, sadece tüm ağırlıklar +1
// kaydırıldı (kullanıcı isteği).
// v3.8.1: açık tema, sitenin İLK yapıldığındaki orijinal krem palete
// (--paper:#f3efe6 vb.) geri döndürüldü -- bu oturumda önce #DECDBE'ye sonra #F1F0F6
// lavanta-beyazına denenmişti, kullanıcı en baştaki hâlini istedi. Koyu tema DOKUNULMADI.
// v3.8.0: takvim çizgi/panel dili modernleştirildi (inspora.design
// referansı): gün sütunları arası, saat çizgileri, üst bar ve sol panel kenarlıkları
// var(--divider-faint)'e soluklaştırıldı, saat çizgisi opacity:.55, dört panelde padding
// artırıldı (nefes alanı) -- boşlukla ayrım, ağır çizgi yerine. Kartların renkleri değişmedi.
// v3.7.9: takvim kanvasının brass-tint radial-gradient opaklığı .10'dan
// .035'e düşürüldü -- referans videodaki gibi neredeyse dumduz/nötr bir zemin, tüm rengi
// doygun etkinlik kartları taşıyor (kartların kendisi değişmedi).
// v3.7.8: Faz 7 v2/v3: admin dashboard "liquid glass" diline çevrildi
// (cam sidebar + her sekmede sabit KPI şeridi + cam içerik kartı), açık tema ana rengi soft
// lavanta-beyazına (#F1F0F6) geçti, takvimdeki eski-palet sabit renkleri (#e6dfcd vb.)
// değişkene bağlandı, Test Modu kutusu tek satıra küçültüldü, Geçmiş sekmesi iki sütuna
// (Tüm Kayıtlar / Test Günlüğü) bölündü, İstatistikler KPI+cam-kart+gradyan bar ile
// modernleştirildi. v3.7.7: (1) admin paneli artık ortada küçük bir dialog değil, tam
// sayfa dashboard (sol dikey nav ikonlu sekmeler + sağda geniş içerik alanı, referans:
// "admin dashboarda nasıl gözükebilir.jpeg"), (2) haber taslağı "Katılımcı Grubu" seçicisinde
// Öğrenci/Vatandaş artık diğerleri gibi işaretsiz geliyor (önceden hep dolu geliyordu).
// v3.7.6: kullanıcı geri bildirimi: (1) v3.7.4'te eklenen ana sayfa mini
// takvim widget'ı tamamen kaldırıldı, (2) mobil cam tepsideki düğmelerin etiket metinleri
// kaldırılıp ikisi de sadece ikon taşıyan 48px daireye çevrildi, (3) arama kutusuna hâlâ
// otomatik doldurma olduğu için çok katmanlı engel eklendi: type="search" + parola yöneticisi
// yoksay öznitelikleri + kullanıcı yazana kadar dışarıdan gelen değeri temizleyen JS güvenlik
// ağı. v3.7.5: kişi formundaki "Bağlı Olduğu Birim(ler)/Ek Görev(ler)" çoklu seçim kutusuna
// arama + canlı seçili-pill önizlemesi eklendi (tag-picker deseni).
// v3.7.3: Faz 6 mobil alt tepsideki
// iki düğme ("Takvim" tek satır kısa, "Fakülte Filtrele" iki satıra kırılan uzun etiket) eşit
// sabit genişliğe, ikon-üstte/etiket-altta dikey düzene alındı. v3.7.2: "liquid glass" alt
// navigasyon -- eski calendar-fab/faculty-fab tek bulanık-cam (.mobile-glass-nav) çubukta
// birleşti, ikisi de yarı saydam cam segment; fakülte ikonu 🎓→🔍. v3.7.1: takvim kart tasarımı
// doygun renk stiline güncellendi.
// v3.7.0: yeni renk paleti (#DECDBE açık / #1F1F2B koyu), koyu tema textarea düzeltmesi, takvim
// user-select:none. v3.6.0: Faz 5. v3.5.0: Faz 4. v3.4.0: Faz 3. v3.3.0: Faz 2. v3.2.0: onboarding
// + PIN. v3.1.0: çok sayfalı mimari. Ana sürüm = kırılgan/mimari değişiklik, ikinci hane = yeni
// özellik, üçüncü hane = hata düzeltmesi.
const CACHE_NAME = "omu-protokol-v3.10.0"; // Her büyük değişiklikte veya ikon değişiminde bu numarayı artır

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