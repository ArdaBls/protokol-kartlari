# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ondokuz Mayıs Üniversitesi (OMÜ) Basın ve Halkla İlişkiler ekibi. Sistem herkese
açık değil: kayıt olan herkes `pending` rolüyle başlar ve bir yönetici
onaylayana kadar hiçbir sayfayı göremez.

Üç yetki kademesi var ve bunlar üründe gerçek anlam taşır:

- **Kurucu (owner) / Admin** — tüm sekmeleri görür; kullanıcıları onaylar ve rol atar.
- **Editör** — Operasyonlar, Protokol Kartları, Takvim, Harita, Yapılacaklar
  Listesi, Tüm haberler, Haber detayı, Profiliniz, Ayarlar, Yardım merkezi.
  Kişiler, Kullanıcı yönetimi, Bildirimler ve geliştirici araçları kapalıdır.
- **Onay bekleyen (pending)** — yalnızca "Talebiniz alındı" ekranını görür.

Kullanım iki bağlamda **eşit ağırlıkta** (kullanıcı onayı): sahada, etkinlik
anında, telefonla hızlı başvuru; ve masabaşında kayıt bakımı, sıralama düzenleme,
takvim ve haber çıktısı yönetimi. İkisi de birinci sınıf desteklenmeli, hiçbiri
ikincil sayılmaz.

## Product Purpose

OMÜ etkinliklerinde protokol sırasının doğru bilinmesini ve bu bilginin ekipçe
tek bir yerden güncel tutulmasını sağlar. İki liste yönetilir: İl Protokol Sırası
ve Üniversite Protokol Sırası. Kartlar kişinin adını, unvanını, birimini,
fotoğrafını, görev başlangıç/bitiş tarihini ve doğrulanma durumunu taşır.

Başarı, sahadaki kişinin doğru sırayı tereddütsüz teyit edebilmesi ve masabaşındaki
kişinin kaydı güncel tutarken yanlışlıkla kurumsal sıralamayı bozamamasıdır.

## Positioning

Ayırt edici iddia (kullanıcı onayı): **tek kaynaktan canlı ortak çalışma.** Ekip
aynı anda çalışır, değişiklik anında herkese yansır, kimin neyi değiştirdiği
görünür. Dosya sürümü karmaşası ve "hangi Excel güncel" sorusu ortadan kalkar.

## Operating Context

- Yayın: GitHub Pages üzerinde `protokol.sbs`. PWA olarak masaüstüne/telefona kurulabilir.
- Veri ve kimlik: Firebase Authentication + Realtime Database. Yetki sınırı
  arayüzde değil, veritabanı güvenlik kurallarında tanımlıdır.
- Çevrimdışı: service worker uygulama iskeletini önbelleğe alır; bağlantı yokken
  salt-okunur moda düşülür.
- Panelin içindeki başlıca akışlar: protokol kartları listesi ve sıralama modu,
  etkinlik takvimi, harita, yapılacaklar listesi, haber çıktısı üretimi,
  kullanıcı onayı ve rol yönetimi.

## Capabilities and Constraints

- İki ayrı protokol listesi (İl / Üniversite) ve aktif / arşiv / silinenler durumları.
- Sıralama modu sürükle-bırak ile çalışır; her taşıma tek atomik güncelleme olarak yazılır.
- Etkinliklere görevli ve haber yazan atanır; editör aktivitesi bu alanlardan üretilir.
- Kayıt akışı: Auth hesabı + `users/{uid}` kaydı. Kaydı eksik kalan hesaplar
  ("yetim hesap") ilk girişte `pending` olarak onarılır, aksi halde yönetici
  listesinde hiç görünmez ve onaylanamazlar.
- Teknik kısıt: panel Vite ile derlenir, çıktı `docs/` köküne yayınlanır; protokol
  kartları sayfası ayrıca eski `app.js` ve `style.css` dosyalarını olduğu gibi
  kullanır. Bu iki dünya aynı sayfada yaşadığı için kapsamsız CSS seçicileri
  (`.card`, `.grid`, `.modal`, `.cal-*`) çakışma riski taşır.

### Bağlayıcı kısıtlar

Kullanıcının açıkça kalıcı olarak işaretlediği, gelecekteki hiçbir çalışmanın
bozmaması gereken üç kural:

1. **Protokol sıralaması kurumsal olarak bağlayıcıdır.** Sıra numarası ve unvan
   katmanı keyfi değiştirilemez; bir dekan rektörün önüne alınamaz. Bu bir tercih
   değil, kurumsal kuraldır ve sürükle-bırak kilidi bunu uygular.
2. **Doğrulama izi denetlenebilir kalmalıdır.** Kimin neyi ne zaman doğruladığı
   veya değiştirdiği kayıt altında kalır (denetim günlüğü, "Hiç Doğrulanmadı"
   rozetleri, son doğrulama tarihi).
3. **Arayüz tamamen Türkçedir.** İngilizce kalıntı bırakılmaz.

## Brand Commitments

- Ad: "OMÜ Protokol Kartları"; panel kısa adı "Protokol".
- Kurum: Ondokuz Mayıs Üniversitesi Basın ve Halkla İlişkiler.
- Uygulama ikonu: `docs/admin-src/public/icon-192.png` ve `icon-512.png`
  (kullanıcı bunları sonradan SVG ile değiştirecek; dosya adları korunmalı).
- PWA tema/arka plan rengi lacivert `#16233d`.

## Evidence on Hand

- Canlı Firebase verisi: gerçek kişiler, unvanlar ve fotoğraflar. Yani ekran
  görüntüleri, dışa aktarmalar ve önbellek çıktıları gerçek kişisel veri
  içerebilir. (Bu bir tasarım tercihi değil, doğrulanmış bir olgu: canlı
  veritabanı bu oturumda okundu.)
- Denetim günlüğü (`logs/`) ve kullanıcı kayıtları (`users/`) mevcut.
- Firebase güvenlik kurallarının çalışma kopyası `yerel-notlar/` altında; gizlilik
  gereği repoya commit edilmez, Console'a elle yapıştırılır.
- Otomatik test paketi `tests/` altında (17 test, tamamı geçiyor).
- **Uydurulmaması gerekenler:** müşteri referansı, kullanım istatistiği, kurum
  onayı veya performans iddiası yok. Bunlar hiçbir yerde üretilmemeli.

## Product Principles

1. **Kurumsal doğruluk, kullanım kolaylığından önce gelir.** Arayüz, yanlış
   sıralamayı kolaylaştıracak hiçbir kısayol sunmaz.
2. **Saha ve masabaşı eşit yurttaştır.** Bir iyileştirme birini kolaylaştırıp
   diğerini bozuyorsa, çözüm henüz tamam değildir.
3. **Değişiklik iz bırakır.** Sessiz düzenleme yoktur; kim, ne zaman, neyi
   değiştirdi her zaman geri okunabilir olmalıdır.
4. **Yetki arayüzde değil sunucuda biter.** Menü gizlemek bir kolaylıktır;
   asıl sınır Firebase kurallarıdır ve ikisi birbirinin yerine geçmez.
5. **Gerçek kişisel veriyle çalışıyoruz.** Yeni her özellik, veriyi nereye
   taşıdığını (ekran görüntüsü, dosya, önbellek) açıkça hesaba katmalıdır.
