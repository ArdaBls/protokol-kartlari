---
name: OMÜ Protokol Kartları
description: Ekibin etkinlik anında ve masabaşında aynı protokol sırasına baktığı canlı operasyon panosu.
colors:
  teal: "#1ABB9C"
  teal-deep: "#169f85"
  teal-wash: "rgba(26,187,156,0.06)"
  gece: "#1a2332"
  zemin: "#f5f7fb"
  yuzey: "#ffffff"
  yuzey-ikincil: "#f9fafb"
  metin: "#1e2633"
  metin-ikincil: "#626d7d"
  metin-solgun: "#7e8896"
  metin-kapali: "#c0c7cf"
  cizgi: "#e6e7eb"
  cizgi-ince: "#eff0f3"
  yesil: "#2fb344"
  sari: "#f59f00"
  kirmizi: "#d63939"
  mavi: "#066fd1"
  mor: "#ae3ec9"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  headline:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4286
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4286
  label:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.06em"
  mono:
    fontFamily: "SF Mono, Monaco, Consolas, Liberation Mono, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  "8": "64px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.yuzey}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.teal-deep}"
  button-outline:
    backgroundColor: "{colors.yuzey}"
    textColor: "{colors.metin-ikincil}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.yuzey-ikincil}"
    textColor: "{colors.metin}"
  card:
    backgroundColor: "{colors.yuzey}"
    textColor: "{colors.metin}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.yuzey}"
    textColor: "{colors.metin}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  chip-active:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  nav-link:
    textColor: "#7b8fa3"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  nav-link-active:
    backgroundColor: "rgba(26,187,156,0.08)"
    textColor: "{colors.yuzey}"
---

# Design System: OMÜ Protokol Kartları

## Overview

**Creative North Star: "Sahne Arkası Panosu"**

Bu bir tören yayını değil, törenin arkasındaki panodur. Etkinlik başlamadan on
dakika önce telefonundan sıraya bakan kişiyle, masabaşında kaydı güncelleyen
kişi aynı panoya bakar ve değişiklik ikisine de anında yansır. Tasarımın işi bu
eşzamanlılığı hissettirmek: arayüz kendini değil, verinin güncelliğini gösterir.
Ürünün ayırt edici iddiası "tek kaynaktan canlı ortak çalışma" olduğu için,
görsel sistemin taşıması gereken duygu ağırbaşlılık değil **güven veren hız**.

Palet tek ve soğuk: teal vurgu, açık gri zemin, beyaz yüzey. Teal burada bir
marka rengi olduğu kadar bir **durum** rengidir — aktif olan, seçili olan, canlı
olan odur. Renk bütçesi dar tutulur; ekranın büyük kısmı nötr kalır ki tek bir
teal işaret gerçekten bir şey söylesin.

Bileşenler ölçülü ve sessizdir. 32 px buton, 4 px köşe, neredeyse görünmez
gölge, 120 ms geçiş. Hiçbir denetim dikkat istemez; hepsi elinin altındadır ama
hiçbiri öne çıkmaz. Arayüz kendini değil, veriyi gösterir — bu yüzden ekranda
gözü çeken tek şey teal işaret ve kişinin fotoğrafıdır.

**Key Characteristics:**
- Tek vurgu rengi (teal), dar bütçeyle kullanılır
- Nötr soğuk gri zemin, beyaz kart yüzeyi
- Küçük köşe yarıçapı (4/6/8 px) — hiçbir yerde hap şeklinde kart yok
- Yoğun ama nefes alan bilgi: 14 px gövde, 4 px tabanlı boşluk ölçeği
- Neredeyse düz yüzeyler; gölge bir duruma cevaptır, dekor değil
- Her etkileşimin görünür ama sessiz bir cevabı var (hover, focus, aktif)
- Arayüz dili tamamen Türkçe

**Anti-referans:** Kurumsal tören estetiği (lacivert + pirinç + krem, serif
başlıklar, altın rozetler). Sistem bir tören kılavuzu gibi görünmemeli.

## Colors

Palet soğuk ve nötr; tek sıcak nokta yok. Renk taşıyan her şey ya bir durum ya
bir eylem bildirir.

### Primary
- **Pano Teali** (`#1ABB9C`): Birincil eylem butonu, aktif menü öğesi, seçili
  filtre çipi, odak halkası, bağlantı metni. Kanonik marka rengi.
- **Derin Teal** (`#169f85`): Yalnızca birincil butonun hover hâli. Başka hiçbir
  yerde zemin rengi olarak kullanılmaz.
- **Teal Yıkaması** (`rgba(26,187,156,0.06)`): Aktif çip zemini, odak halkası
  parıltısı, aktif menü öğesinin zemini. Koyu temada opaklık 0.14'e çıkar.

### Neutral
- **Gece Lacivert** (`#1a2332`): Yan menü zemini. Koyu temada aynı değer kart
  yüzeyi olur — sistemin tek çift rollü rengi.
- **Pano Zemini** (`#f5f7fb`): Sayfa arka planı. Kartların üzerinde durduğu
  soğuk gri; saf gri değil, mavi tarafa kaymış.
- **Yüzey** (`#ffffff`): Kart, tablo, açılır menü, modal zemini.
- **İkincil Yüzey** (`#f9fafb`): Tablo başlığı, hover zemini, ghost buton hover.
- **Mürekkep** (`#1e2633`): Gövde metni ve başlıklar.
- **İkincil Metin** (`#626d7d`): Alt başlık, açıklama, ikincil buton metni.
- **Solgun Metin** (`#7e8896`): Etiket, meta bilgi, tablo başlığı.
- **Kapalı Metin** (`#c0c7cf`): Devre dışı denetim.
- **Çizgi** (`#e6e7eb`) / **İnce Çizgi** (`#eff0f3`): Kenarlık ve ayraç.

### Semantic
- **Yeşil** (`#2fb344`): Aktif kayıt, onaylanmış, doğrulanmış.
- **Sarı** (`#f59f00`): Uyarı, doğrulaması eskimiş kayıt, onay bekleyen.
- **Kırmızı** (`#d63939`): Silme, hata, kilitli kural ihlali.
- **Mavi** (`#066fd1`): Haber modu seçimi.
- Her birinin `-lt` yıkaması var (`rgba(...,0.06)`, koyu temada 0.16).

### Named Rules

**Tek Ses Kuralı.** Teal bir ekranın en fazla %10'unda görünür. Aynı ekranda iki
farklı birincil buton olmaz. Nadir olması onun anlamıdır.

**Anlam Rengi Marka Rengi Değildir.** Yeşil/sarı/kırmızı yalnızca durum bildirir,
asla dekorasyon veya kategori ayırt etmek için kullanılmaz. Teal bunların yerine
geçemez, onlar da tealin yerine geçemez.

**Miras Palet Kuralı.** Lacivert `#16233d`, pirinç `#b8923f` ve krem `#f3efe6`
bu sistemin parçası **değildir**. `docs/style.css` bunları hâlâ taşıyor; orası
sistemin dışında kalmış eski bir bölgedir ve teal palete taşınana kadar yeni iş
oraya bu renkleri eklemez.

## Typography

**Tek aile:** Plus Jakarta Sans (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
Roboto, sans-serif` yedeğiyle)
**Mono:** SF Mono / Monaco / Consolas / Liberation Mono — sistem zinciri, webfont değil

**Karakter:** Tek aileli, ağırlıkla ayrışan bir sistem. Plus Jakarta Sans'ın uzun
harf gövdesi 10–13 px aralığında okunurluk kazandırır; panelin ağırlığı tam
orada olduğu için seçildi. Türkçe aksanları (ğ, ş, İ/ı, Ç, Ö, Ü) küçük puntoda
bile net ayrışır.

### Hierarchy
- **Display** (600, 20 px, 1.25): Sayfa başlığı. Sayfa başına bir tane.
- **Headline** (600, 17 px, 1.2): Kişi kartındaki isim satırı; en fazla iki satır.
- **Title** (600, 13 px, 1.4286): Kart başlığı, tablo başlığı, buton metni.
- **Body** (400, 14 px, 1.4286): Varsayılan gövde. Okuma metni 65–75ch'i geçmez.
- **Label** (500, 10 px, 0.06em, BÜYÜK HARF): Durum çipi, rozet, meta etiketi.
- **Mono** (400, 12 px): Yalnızca kimlik, saat ızgarası etiketi, kod.

### Named Rules

**Aile Adı Yazma Kuralı.** Hiçbir kural bir font ailesi ADI yazmaz. Aile tek
yerde tanımlıdır: `_tokens.scss` içindeki `--font`. Diğer her yer `inherit` veya
`var(--font)` okur. `docs/style.css`'teki 87 bildirim bu yüzden `inherit`'tir.
Tek istisna CSS göremeyen dört yer: Google Fonts bağlantısı, `charts.js` (canvas),
TinyMCE `content_style` (iframe).

**Form Denetimi Kuralı.** `button`, `input`, `select`, `textarea` gövdeden font
miras almaz; tarayıcı kendi varsayılanını dayatır. Sıfırlama `_tokens.scss`'te
`font-family: inherit` ile yapılır. Yeni bir denetim türü eklenirse bu listeye
de eklenir.

## Layout

Sabit genişlikte yan menü (252 px) + akışkan içerik. İçerik `.page-wrapper`
içinde, kartlar CSS Grid ile dizilir. Boşluk ölçeği 4 px tabanlıdır: 4 / 8 / 12 /
16 / 24 / 32 / 48 / 64. Ölçek dışına çıkmak istisna olmalıdır.

Yoğunluk kasıtlı olarak yüksek: 14 px gövde, 32 px buton, 36 px form denetimi.
Bu bir okuma yüzeyi değil, çalışma yüzeyidir.

Kart ızgarası ekran daraldıkça 4 → 3 → 2 → 1 sütuna iner ve her adımda punto ile
iç boşluk birlikte küçülür; kart oranı korunur. Grid izleri daima `minmax(0, 1fr)`
ile tanımlanır — `1fr` tek başına `minmax(auto, 1fr)` demektir ve `auto` en az
min-content kadar olduğu için uzun bir isim izi taşırır.

Dokunmatik girdide (`pointer: coarse`) tüm dokunma hedefleri en az 44 px olur.
Bu ekran genişliğine değil, girdi yöntemine bağlıdır.

## Elevation & Depth

Sistem **neredeyse düz**dür: derinlik öncelikle çizgiyle ve ton farkıyla kurulur,
gölge yalnızca ikinci sırada gelir. Her kart 1 px kenarlık taşır; kenarlık
nesnenin sınırını söyler, gölge sadece onu zeminden bir kâğıt kalınlığı kadar
ayırır. Gölgenin neredeyse görünmez olması bir eksiklik değil, kararın kendisidir.

Yükseltme bütçesi dardır ve yukarı doğru sadece iki adımı vardır: sürüklenen bir
kart ve üstteki bir katman (modal, açılır menü). Bunların dışında hiçbir şey
zeminden kalkmaz.

### Shadow Vocabulary
- **Durgun** (`box-shadow: rgba(30,38,51,0.04) 0 2px 4px 0`): Varsayılan kart ve
  panel gölgesi. Neredeyse görünmez olması kasıtlı.
- **Kart** (`box-shadow: 0 0 0 1px rgba(4,32,69,0.08), rgba(30,38,51,0.04) 0 2px 4px 0`):
  Kenarlığı gölgeyle birleştiren tek katman; kenarlık düzeni bozmasın diye
  `inset` yerine yayılma halkası kullanılır.
- **Yüzen** (`box-shadow: rgba(30,38,51,0.16) 0 12px 32px -8px`): Yalnızca üstteki
  katman — modal, açılır menü ve sürüklenen kart. Başka hiçbir yerde kullanılmaz.

Hover durumu gölgeyle değil, **zemin tonuyla** bildirilir (`--bg-surface-secondary`).
Bu, ölçülü ve sessiz karakterin en görünür sonucudur: fare gezdirmek nesneyi
kaldırmaz, sadece aydınlatır.

Koyu temada aynı roller siyah opaklığıyla yeniden tanımlanır (0.4 / 0.3);
renk değil yalnızca yoğunluk değişir.

### Named Rules

**Sessiz Yüzey Kuralı.** Yüzeyler durgun hâlde neredeyse düzdür ve hover onları
kaldırmaz — yalnızca zemin tonu değişir. Gerçek yükseltme (Yüzen gölge) sadece
iki duruma ayrılmıştır: sürüklenen kart ve üstteki katman.

## Shapes

Köşe yarıçapı küçüktür ve üç adımda kalır: 4 px (denetimler — buton, input,
menü öğesi), 6 px (varsayılan), 8 px (kart ve panel). Hap şekli (`999px`)
yalnızca çip, rozet ve durum etiketinde kullanılır; asla bir kartta veya butonda.

Kenarlık her zaman 1 px ve tek renklidir. Kesikli çizgi (`dashed`) yalnızca bir
ayraçtır (kart içindeki meta satırının üstü), asla bir kutunun sınırı değildir.

Fotoğraf alanı 1:1 kare, üstten hizalı kırpma (`object-position: center top`) —
portre fotoğrafında yüzün kesilmemesi için.

## Components

### Buttons
- **Şekil:** Küçük köşe (`4px`), 32 px yükseklik, `0 12px` iç boşluk, ikonla
  arasında 5 px.
- **Birincil:** Teal zemin, beyaz metin. Hover'da derin teale iner.
- **Outline:** Beyaz zemin, çizgi kenarlık, ikincil metin. Hover'da ikincil
  yüzeye ve tam mürekkebe geçer.
- **Ghost:** Zeminsiz, kenarlıksız. Yalnızca ikincil eylem yığınlarında.
- **Boyutlar:** `sm` 28 px, varsayılan 32 px, `lg` 38 px. `btn-icon` kare olur.
- **Geçiş:** 120 ms — zemin, kenarlık, renk, gölge.
- **Odak:** `outline` teal, `outline-offset: -2px`.

### Chips
- **Stil:** Hap şekli, zeminsiz durgun hâl, `11–12 px` metin.
- **Durum:** Aktifken teal yıkaması zemin + teal metin. Kapatma düğmesi durgun
  hâlde soluk, hover'da tam opak ve hafif koyu zeminli.

### Cards / Containers
- **Köşe:** `8px`.
- **Zemin:** Beyaz yüzey.
- **Kenarlık:** 1 px çizgi rengi.
- **Gölge:** Durgun. Hover'da gölge DEĞİŞMEZ; yalnızca zemin ikincil yüzeye döner.
- **İç boşluk:** 16 px (`--space-4`); yoğun ızgarada 12 → 8 → 6 px'e iner.
- **Başlık satırı:** Başlık grubu ile sağdaki denetimler arasında en az 16 px.

### Inputs / Fields
- **Stil:** 36 px yükseklik, `0 12px` iç boşluk, 4 px köşe, 1 px çizgi kenarlık,
  beyaz zemin, 13 px metin.
- **Odak:** Kenarlık teale döner + `0 0 0 3px` teal yıkaması halkası.
- **Devre dışı:** Kapalı metin rengi, ikincil yüzey zemini.
- **Geçiş:** 150 ms.

### Navigation
- **Yan menü:** Gece lacivert zemin, 252 px sabit genişlik.
- **Öğe:** 13 px, 400 ağırlık, `6px 12px` iç boşluk, 4 px köşe, 10 px ikon
  boşluğu. Durgun renk `#7b8fa3`.
- **Hover:** `rgba(255,255,255,0.04)` zemin, metin `#c5d0dc`.
- **Aktif:** `rgba(26,187,156,0.08)` zemin, beyaz metin.
- **Rol farkı:** Editöre kapalı sekmeler DOM'dan gizlenir; boşalan grup başlığı
  da gizlenir. Devre dışı görünen ama tıklanabilir bir sekme bırakılmaz.

### Protokol Kartı (imza bileşen)
Sistemin en karakteristik nesnesi. 1:1 fotoğraf alanı, sol üstte sıra rozeti,
sağ üstte durum çipi, altında bilgi bloğu (isim → unvan → birim → tarih meta
satırı) ve en altta eylem butonu.

- İsim satırı Headline (600, 17 px, 1.2), en fazla iki satır, taşan kısım kırpılır.
- Sıra rozeti daire, 26 px, teal kenarlık, gece lacivert zemin.
- Eylem butonu `margin-top: auto` ile daima kartın dibine yapışır; kart içeriği
  kısa da olsa uzun da olsa butonlar aynı hizada durur.
- Sıralama modunda kart sürüklenebilir; yalnızca sürüklenen kart Yüzen gölgeyi
  alır — durgun kartlar düz kalır.

## Do's and Don'ts

### Do:
- **Do** her rengi tokendan al (`var(--primary)`, `var(--text)`); ham hex yazma.
- **Do** boşlukları `--space-*` ölçeğinden seç; ölçek dışına çıkmak istisna olsun.
- **Do** grid izlerini `minmax(0, 1fr)` ile tanımla.
- **Do** dokunma hedeflerini `@media (pointer: coarse)` altında 44 px yap.
- **Do** her etkileşimli öğeye görünür bir `:focus-visible` durumu ver.
- **Do** durum bilgisini renkle **ve** biçimle birlikte kodla (çip, rozet, şerit)
  — tek başına renk yeterli değildir.
- **Do** arayüz metnini tamamen Türkçe yaz.
- **Do** hover'ı zemin tonuyla bildir; gölgeyi yalnızca sürükleme ve üst katman
  için sakla.

### Don't:
- **Don't** lacivert `#16233d`, pirinç `#b8923f` veya krem `#f3efe6` ekleme —
  bunlar emekli edilmiş miras palettir.
- **Don't** hiçbir CSS kuralına font ailesi ADI yazma; `--font` tek kaynaktır.
- **Don't** aynı ekrana iki birincil buton koyma.
- **Don't** anlam renklerini (yeşil/sarı/kırmızı) dekorasyon olarak kullanma.
- **Don't** kartlara veya butonlara hap köşe (`999px`) verme; o yalnızca çip
  ve rozet içindir.
- **Don't** `overscroll-behavior-y: none` ile `overflow-x: hidden`'ı aynı
  kaydırma kabında birleştirme — gövde kaydırma zincirini koparır ve tekerlek
  olayları yutulur.
- **Don't** hover'da nesneyi kaldırma (`translateY` + büyüyen gölge); bu sistemin
  sessiz karakterine aykırıdır.
- **Don't** yeni bir font ailesi yükleme; tek aile ve tek mono zinciri yeterlidir.
