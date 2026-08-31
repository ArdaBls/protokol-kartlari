// v3.14.0 (31 Ağustos 2026) -- Faz 10 Part B TAMAMLANDI: "Yedekleme & Çöp" sekmesi açıldı --
// (1) Tam Yedek İndir: İl+Üniversite+Etkinlik verisini TEK JSON dosyasında indirir (arşiv/
// felaket kurtarma, sadece indirme -- geri yükleme mevcut ayrı akışlarla yapılır). (2) Salt-
// Okunur Kilit: admin açtığında HİÇ KİMSE (editör/admin fark etmez) veri düzenleyemez, sadece
// görüntüleme yapılabilir -- ayarlar/saltOkunur, testModuAcik ile AYNI paylaşımlı/canlı desen.
// Kilit canEditData()'ya (tek merkezi nokta) bağlandığı için mevcut 34+ requireEdit()/
// edit-only çağrı noktasının HİÇBİRİNE ayrı ayrı dokunulmadı. Test Modu şeridi (#testModeBanner)
// artık kilidi de gösteriyor (ikisi aynı anda açık olabilir), kilit varsa kırmızıya dönüyor
// (.banner-lock). Firebase kuralı güncellendi (Console'a elle yapıştırılmalı). Admin overview
// şeridine 6. bir KPI kartı (Salt-Okunur Kilit durumu) eklendi. Bu, Part B admin dashboard
// genişletmesinin (12 sekme) SON parçasıydı -- artık hepsi tamam.
// v3.13.0 (31 Ağustos 2026) -- Faz 10 Part B'nin son ölçülü aşaması: "Veri Sözlüğü" sekmesi
// açıldı -- kişi formundaki birim/unvan öneri (otomatik tamamlama) havuzunu (oneriler/{il|
// universite}/{birimler|unvanlar}) admin listeler ve SİLEBİLİR (yalnızca "silme" var,
// "birleştirme" bilinçli olarak kapsam dışı bırakıldı -- mevcut TÜM kişi kayıtlarını
// etkileyeceği için çok daha riskli, ayrı bir iş kalemi). Silme sadece öneri listesinden
// kaldırır, hiçbir kişi kaydına dokunmaz; logs/dictionary'e loglanır. Firebase kuralı
// (docs/firebase-database-rules.json, .gitignore'da -- Console'a elle yapıştırılmalı)
// admin'e $oneriId silme izni verecek şekilde güncellendi. Kalan en riskli parça (backup
// sekmesi + global salt-okunur kilit) hâlâ sırada, henüz yapılmadı.
// v3.12.1 (31 Ağustos 2026) -- Faz 10 (devam): (1) Takvimde sürükleyerek etkinlik oluşturma
// artık İKİ ADIMLI -- bırakınca modal HEMEN açılmıyor, ghost + küçük bir "Oluştur/Vazgeç"
// onay çubuğu (.cal-create-confirm-bar, ekranın altına sabit) gösteriliyor; modal SADECE
// "Oluştur"a basılınca açılıyor. Mobilde parmak hassasiyetiyle yanlış saat aralığı
// bırakılırsa artık düzenleme ekranına hiç girmeden "Vazgeç" ile iptal edilebiliyor.
// (2) Admin panelindeki mobil çekmece scrim'li OVERLAY'den PUSH düzenine çevrildi --
// kullanıcı "içerik altında kalıyor" diye bildirdi; artık açılınca .admin-main sağa daralıyor,
// hiçbir şey örtülmüyor (scrim kaldırıldı). Escape/dışarı-tıklama ile kapanma korundu, ayrıca
// Escape'in yanlışlıkla TÜM admin panelini de kapatan bir çakışması (capture+stopPropagation
// ile) düzeltildi. (3) index/protokol/takvim.html'deki admin paneli bloğu, Faz 9'dan beri
// sadece admin.html'de güncellenmiş kalmıştı (4 sayfa aynı DOM kuralı bozulmuştu, pratikte
// zararsızdı çünkü panel her zaman admin.html'e yönlendirilerek açılıyor) -- 4 dosya artık
// yeniden birebir aynı. (4) İki kullanılmayan yardımcı fonksiyon (turkishList) temizlendi.
// v3.12.0 (31 Ağustos 2026) -- Faz 10: (1) Giriş/Kayıt ekranı tamamen yeniden tasarlandı
// (uiverse.io by Praashoo7 referansından ilham, kod kopyalanmadı) -- yuvarlak (28px) kart,
// e-posta/şifre alanlarına gömülü ikon (CSS mask+:has(), HTML değişmedi), tam pill CTA
// butonu, iki formun boyu/eni artık EŞİT (min-height:472px + width:min(350px,100%)). Login
// sayfasında artık header/footer/test-modu şeridi TAMAMEN gizli -- sadece kart görünüyor.
// (2) Mobil liquid-glass alt navigasyon (uiverse.io by mymiamo referansından ilham) daha
// güçlü blur/saturate/contrast + iç kenarlarda ince ışık halkası (::after) aldı.
// (3) Admin panelinde mobil sidebar artık üstte yatay sıralanmıyor -- soldan kayan bir
// çekmece (nav drawer, namethatui.com/web/hamburger-menu deseni: aria-expanded/aria-controls,
// scrim, Escape/scrim-tap ile kapanma, odak geri dönüşü, body scroll kilidi) oldu
// (toggleAdminDrawer/openAdminDrawer/closeAdminDrawer, app.js). Şu an OVERLAY (üste biner) --
// kullanıcı "sağa daralt/push" davranışını istedi, bu ayrı bir iş kalemi olarak sıraya alındı.
// v3.11.3 (31 Ağustos 2026) -- Çapraz-kullanıcı canlı takvim silüeti (Part D'nin
// canliTakvimSecim yayın/dinleme özelliği) tamamen kaldırıldı -- gerçek cihazlarda ısrarla
// çalışmadığı doğrulanamadı, kullanıcı isteğiyle geri alındı. Sürükleme sırasındaki YEREL
// silüet (sadece kendi ekranınızda, kendi jestinizi gösteren) DOKUNULMADI, aynen çalışmaya
// devam ediyor. Kaldırılanlar: calBroadcastLiveSelection/calClearLiveSelection/
// attachLiveSelectionListener/renderRemoteLiveSelections fonksiyonları, canliTakvimSecim
// Firebase kuralı (docs/firebase-database-rules.json -- Console'daki kural elle
// kaldırılabilir, kaldırılmasa da zararsızdır, artık hiçbir kod o yola yazmıyor).
// v3.11.2 (31 Ağustos 2026) -- Part D hata düzeltmeleri (devam): (1) etkinlik TAŞIMA
// sürüklemesi (mevcut etkinliği sürükleyip günü/saatini değiştirme) diğer kullanıcılara hiç
// canlı yayınlanmıyordu -- sadece boş ızgarada yeni etkinlik oluşturma sürüklemesi yayın
// yapıyordu; calBroadcastLiveSelection()/calClearLiveSelection() ortak fonksiyonlarına
// çıkarılıp calOnDragMove/calOnDragEnd'e de bağlandı. (2) iOS/mobilde boş ızgarada basılı
// tutup aşağı çekerken tarayıcı bunu sayfa kaydırma sanıp pointermove'ları hiç göndermeden
// jesti iptal ediyordu -- jest sürerken .cal-daycol'a geçici touch-action:none eklendi.
// (3) hızlı sağ/sol kaydırmayla gün/hafta değiştirme (swipe-nav) aynı parmak temasında bu
// jestle çakışıp yanlışlıkla düzenleme ekranını açıyordu -- yatay ağırlıklı hareket tespit
// edilince jest artık tamamen iptal ediliyor, calShift()'e (sayfa navigasyonu) bırakılıyor.
// v3.11.1 (31 Ağustos 2026) -- Part D hata düzeltmeleri: (1) canlı takvim silüeti diğer
// kullanıcılara hiç yansımıyordu -- renderRemoteLiveSelections() sadece Firebase verisi
// DEĞİŞİNCE çağrılıyordu, takvim açılınca/görünüm değişince çağrılmıyordu; calLastLiveMap
// önbelleği eklenip renderCalendar() sonuna eklendi. (2) sürükleyerek etkinlik oluştururken
// "düzenle" modalı açılınca arka plandaki seçim silüeti hemen kayboluyordu -- artık
// calActiveCreateGhost ile closeEventModal() çağrılana kadar DOM'da kalıyor.
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
const CACHE_NAME = "omu-protokol-v3.14.0"; // Her büyük değişiklikte veya ikon değişiminde bu numarayı artır

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