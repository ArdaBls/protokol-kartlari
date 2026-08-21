# Protokol Kartları

Basın ve Halkla İlişkiler için etkinlik öncesi/sonrası protokoldeki kişileri hızlı tanıma kartları ve etkinlik takvimi uygulaması.

**Canlı site:** https://ardabls.github.io/protokol-kartlari/

## Nedir bu proje

Tek dosyalık (`index.html`) bir web uygulaması — derleme adımı yok, doğrudan tarayıcıda çalışır. Firebase Realtime Database ve Firebase Auth ile bulut tabanlı, birden çok kullanıcı aynı anda veri üzerinde çalışabiliyor. GitHub Pages üzerinden yayınlanıyor ve bir Progressive Web App (PWA) olarak (servis çalışanı ile) çevrimdışı da kısmen kullanılabiliyor.

İki ana bölümü var:

- **Protokol kartları** — İl ve Üniversite protokol sıralarındaki kişilerin fotoğraf, unvan ve sıra bilgisini gösteren kart listesi. Arşivleme, çöp kutusu, dosyadan toplu içe/dışa aktarma gibi işlemleri destekler.
- **Etkinlik takvimi** — Gün, hafta, ay, yıl ve liste görünümleriyle etkinlikleri planlama; her etkinlik için tür, durum, yer, sorumlu kişi, basın görevlisi(leri) ve katılımcı (protokol kartlarından seçilen) bilgisi tutulur. Etkinliklerden otomatik haber metni taslağı da üretilebiliyor.

## Rol sistemi

Kayıt olan her kullanıcı `pending` (onay bekliyor) durumunda başlar ve sadece görüntüleme yapabilir. Admin, panelden bir kullanıcıyı şu rollerden birine yükseltebilir:

- **editor** — kart ve etkinlik verilerini ekleyip düzenleyebilir.
- **admin** — editor yetkisine ek olarak: kullanıcı yetkilerini yönetir, kullanıcıları "basın görevlisi" olarak işaretler (bu kişiler etkinlik formundaki basın görevlisi seçicisinde görünür hâle gelir), değişiklik geçmişini (loglar) görür, veritabanı yedeği indirip geri yükleyebilir, regresyon testlerini GitHub Actions üzerinden tetikleyebilir.

Admin paneli, sağ üstteki kullanıcı rozetinden (yalnızca admin rolündeki kullanıcılara) açılır.

## Geliştirme

Derleme adımı yok. `index.html`'i doğrudan bir HTTP sunucusuyla servis edip açmanız yeterli (servis çalışanı ve Firebase SDK'sı `file://` üzerinden düzgün çalışmayabilir), örneğin:

```bash
python3 -m http.server 8000
# sonra tarayıcıda http://localhost:8000
```

`index.html`, satır sonları **CRLF** ve girintisi **tab** kullanılarak tutuluyor — düzenleme yaparken editörünüzün bunu bozmadığından emin olun.

## Testler

`tests/` klasöründe Playwright ile yazılmış regresyon testleri var (Firebase gerçek ağa çıkmadan, sahte/mock bir sürümle çalışır):

```bash
cd tests
npm install
node smoke-test.js               # ör. tek bir testi çalıştırmak için
```

Tüm testleri sırayla çalıştırmak için:

```bash
cd tests
npm install
for f in smoke-test.js notes-fix-test.js news-template-test.js news-rich-template-test.js calendar-lock-undo-test.js admin-test-panel-test.js calendar-rail-now-test.js calendar-year-list-admin-test.js press-officer-lock-test.js; do
  node "$f"
done
```

Aynı testler, admin panelindeki **Test** sekmesinden **"Testi Çalıştır"** butonuyla GitHub Actions üzerinde de (`.github/workflows/regresyon-testi.yml`) manuel olarak tetiklenebilir.

## Dağıtım (Deploy)

`main` dalına yapılan her `push`, GitHub Pages tarafından otomatik olarak canlıya alınır — ayrı bir build/deploy adımı yok.

## Firebase yapılandırması

Firebase bağlantı bilgileri (`firebaseConfig`) `index.html` içinde açıkça yazılıdır — bu normaldir, Firebase istemci uygulamalarında bu bilgiler zaten gizli tutulmaz; gerçek güvenlik sınırı **Realtime Database kurallarıdır** (Firebase Konsolu → Realtime Database → Rules). O kuralların yedek bir kopyası `docs/firebase-database-rules.json` dosyasında tutuluyor — **konsoldaki kurallar değiştiğinde bu dosyanın da elle güncellenmesi gerekir**, otomatik senkron yoktur.

Yeni bir Firebase okuma/yazma yolu eklerken (kod tarafında) kurallara karşılığını eklemeyi unutmayın; aksi hâlde yetkili bir kullanıcı bile "izin reddedildi" hatası alır.

## Güvenlik

Bir güvenlik açığı bulduysanız lütfen [SECURITY.md](./SECURITY.md) dosyasındaki yönergeyi izleyin.
