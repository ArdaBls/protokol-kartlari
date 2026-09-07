# Protokol Kartları

Basın ve Halkla İlişkiler için etkinlik öncesi/sonrası protokoldeki kişileri hızlı tanıma kartları ve etkinlik takvimi uygulaması.

**Canlı site:** https://ardabls.github.io/protokol-kartlari/

## Nedir bu proje

Firebase Realtime Database ve Firebase Auth kullanan, birden çok kullanıcının aynı anda çalışabildiği bir web uygulamasıdır. Kaynak kod `docs/admin-src/` altındaki Vite projesindedir; production derlemesi GitHub Pages'in yayınladığı `docs/` köküne alınır. Uygulama servis çalışanıyla PWA olarak kurulabilir ve çevrimdışı durumda sınırlı işlev sunar.

İki ana bölümü var:

- **Protokol kartları** — İl ve Üniversite protokol sıralarındaki kişilerin fotoğraf, unvan ve sıra bilgisini gösteren kart listesi. Arşivleme, çöp kutusu, dosyadan toplu içe/dışa aktarma gibi işlemleri destekler.
- **Etkinlik takvimi** — Gün, hafta, ay, yıl ve liste görünümleriyle etkinlikleri planlama; her etkinlik için tür, durum, yer, sorumlu kişi, basın görevlisi(leri) ve katılımcı (protokol kartlarından seçilen) bilgisi tutulur. Etkinliklerden otomatik haber metni taslağı da üretilebiliyor.
- **Haber üretim Gantt'ı** — Özel ve normal haber projelerini, alt üretim adımlarını, sorumluları ve takvim etkinliği bağlantılarını zaman çizelgesinde yönetir.

## Rol sistemi

Kayıt olan her kullanıcı `pending` (onay bekliyor) durumunda başlar ve sadece görüntüleme yapabilir. Admin, panelden bir kullanıcıyı şu rollerden birine yükseltebilir:

- **editor** — kart ve etkinlik verilerini ekleyip düzenleyebilir.
- **admin** — editor yetkisine ek olarak: kullanıcı yetkilerini yönetir, kullanıcıları "basın görevlisi" olarak işaretler (bu kişiler etkinlik formundaki basın görevlisi seçicisinde görünür hâle gelir), değişiklik geçmişini (loglar) görür, veritabanı yedeği indirip geri yükleyebilir, regresyon testlerini GitHub Actions üzerinden tetikleyebilir.

`owner` rolü kurucu hesabı için en yüksek yetki düzeyidir. Yönetim ekranları kullanıcı rolüne göre menüde gösterilir.

## Geliştirme

Node.js 22 ile:

```bash
cd docs/admin-src
npm ci
npm run dev
```

Production çıktısını yenilemek için `npm run build` çalıştırılır. Bu komut önce Vite derlemesini yapar, ardından yayınlanacak dosyaları `docs/` köküne kopyalar. Kaynak değişiklikleriyle birlikte üretilen `docs/` çıktısı da commit edilmelidir.

## Testler

`tests/` klasöründe Playwright ile yazılmış regresyon testleri var (Firebase gerçek ağa çıkmadan, sahte/mock bir sürümle çalışır):

```bash
cd tests
npm ci
node smoke-test.js               # ör. tek bir testi çalıştırmak için
```

Tüm testleri sırayla çalıştırmak için:

```bash
cd tests
for f in *-test.js; do
  node "$f"
done
```

Aynı testler, admin panelindeki **Test** sekmesinden **"Testi Çalıştır"** butonuyla GitHub Actions üzerinde de (`.github/workflows/regresyon-testi.yml`) manuel olarak tetiklenebilir.

## Dağıtım (Deploy)

Önce `docs/admin-src/` içinde `npm run build` çalıştırılmalı ve oluşan `docs/` dosyaları commit edilmelidir. `main` dalına yapılan push sonrasında GitHub Pages, `docs/` klasöründeki hazır çıktıyı yayınlar.

## Firebase yapılandırması

Firebase istemci bağlantı bilgileri tarayıcı paketinde görünür; gerçek güvenlik sınırı **Realtime Database kurallarıdır** (Firebase Konsolu → Realtime Database → Rules). Kuralların yerel çalışma kopyası `yerel-notlar/firebase-database-rules.json` dosyasındadır ve güvenlik nedeniyle Git'e eklenmez. Değişiklikler Firebase Console'a elle yapıştırılıp yayınlanmalıdır.

Yeni bir Firebase okuma/yazma yolu eklerken (kod tarafında) kurallara karşılığını eklemeyi unutmayın; aksi hâlde yetkili bir kullanıcı bile "izin reddedildi" hatası alır.

## Güvenlik

Bir güvenlik açığı bulduysanız lütfen [SECURITY.md](./SECURITY.md) dosyasındaki yönergeyi izleyin.
