// Ortak "kadro" verisi/pickerları -- Takvim (calendar.js) VE Haber Detayı
// (haber-detayi.html) sayfaları AYNI fakülte/birim listesini ve AYNI basın
// görevlisi havuzunu kullanmalı (kullanıcı isteği: "eşzamanlı olmalı her
// çalıştığı her yer ile"). Projede küçük yardımcılar genelde dosyalar arası
// KOPYALANIR (bkz. escapeHtml/fmtTarih), ama bu veri kopyalanırsa iki sayfa
// zamanla farklı fakülte listesi/basın görevlisi göstermeye başlar -- bu
// yüzden BİLEREK tek, paylaşılan bir modülde tutuluyor.

import { dbPath } from './db-mode.js';

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export const FACULTY_GROUPS = [
  { title: 'Rektörlük', items: ['Rektörlük'] },
  { title: 'Fakülteler', items: [
    'Ali Fuad Başgil Hukuk Fakültesi', 'Çarşamba İnsan ve Toplum Bilimleri Fakültesi', 'Diş Hekimliği Fakültesi',
    'Eczacılık Fakültesi', 'Eğitim Fakültesi', 'Fen Fakültesi', 'Güzel Sanatlar Fakültesi',
    'İktisadi ve İdari Bilimler Fakültesi', 'İlahiyat Fakültesi', 'İletişim Fakültesi',
    'İnsan ve Toplum Bilimleri Fakültesi', 'Mimarlık Fakültesi', 'Mühendislik Fakültesi',
    'Sağlık Bilimleri Fakültesi', 'Tıp Fakültesi', 'Turizm Fakültesi', 'Veteriner Fakültesi',
    'Yaşar Doğu Spor Bilimleri Fakültesi', 'Ziraat Fakültesi'
  ] },
  { title: 'Yüksekokul ve Konservatuvar', items: ['Devlet Konservatuvarı', 'Yabancı Diller Yüksekokulu'] },
  { title: 'Enstitüler', items: ['Lisansüstü Eğitim Enstitüsü', 'Kenevir Araştırmaları Enstitüsü', 'Yaban Hayatı Araştırmaları Enstitüsü'] },
  { title: 'Meslek Yüksekokulları', items: [
    'Alaçam Meslek Yüksekokulu', 'Bafra Meslek Yüksekokulu', 'Bafra Turizm Meslek Yüksekokulu',
    'Bilişim Teknolojileri Meslek Yüksekokulu', 'Çarşamba Ticaret Borsası Meslek Yüksekokulu',
    'Havelsan Siber Güvenlik Meslek Yüksekokulu', 'Havza Meslek Yüksekokulu', 'Ladik Meslek Yüksekokulu',
    'Sağlık Hizmetleri Meslek Yüksekokulu', 'Samsun Meslek Yüksekokulu', 'Terme Meslek Yüksekokulu',
    'Vezirköprü Meslek Yüksekokulu', 'Yeşilyurt Demir Çelik Meslek Yüksekokulu'
  ] },
  { title: 'Ofisler ve Merkezler', items: ['Teknoloji Transfer Ofisi'] },
  { title: 'Koordinatörlükler', items: [
    'Araştırma ve Geliştirme Koordinatörlüğü (AR-GE)', 'Eğitim Öğretim Koordinatörlüğü', 'Kalite Koordinatörlüğü',
    'Meslek Yüksekokulları Koordinatörlüğü', 'Mezunlar Koordinatörlüğü',
    'Öğretim Üyesi Yetiştirme Programı Koordinatörlüğü', 'Temel Bilimler Dersleri Koordinatörlüğü',
    'Uluslararası İlişkiler Koordinatörlüğü', 'Uygulama ve Araştırma Merkezleri Koordinatörlüğü',
    'Yayın Koordinatörlüğü', 'Toplumsal Katkı Koordinatörlüğü'
  ] }
];

export function facultyOptionsHtml(selected) {
  return FACULTY_GROUPS.map((g) => '<optgroup label="' + escapeHtml(g.title) + '">' +
    g.items.map((name) => '<option value="' + escapeHtml(name) + '"' + (name === selected ? ' selected' : '') + '>' + escapeHtml(name) + '</option>').join('') +
    '</optgroup>').join('');
}

// "Basın Görevlisi" havuzu: admin tarafından işaretlenmiş kullanıcılar (basinGorevlileri
// düğümü). database çağıran sayfanın kendi firebase.database() örneğidir.
export function loadPressOfficerPool(database) {
  return database.ref(dbPath('basinGorevlileri')).once('value').then((snap) => {
    const obj = snap.val() || {};
    const pool = Object.keys(obj).map((uid) => ({ uid, name: String(obj[uid] || '').trim() })).filter((p) => p.name);
    pool.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return pool;
  }).catch(() => []);
}

// Basın görevlisi / haberi yazan(lar) picker'ının HTML'i: AYNI havuzdan tek bir kişi
// listesi, her kişi için İKİ bağımsız işaretleme kutusu (Basın Görevlisi / Haberi Yazdı).
// Kutu elementine bu HTML basılırken ".cal-ev-att-box.cal-ev-role-box" sınıf çifti
// (bkz. _real-calendar.scss) verilmeli, satırlar ise ".cal-ev-role-basin"/".cal-ev-role-haber"
// checkbox değişikliklerini dinleyen bir change listener'a bağlanmalı (bkz. calendar.js).
export function renderPersonRolesPickerHtml(pool, query, pressList, writerList) {
  const q = (query || '').trim().toLocaleLowerCase('tr');
  const filtered = pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q));
  const extraNames = new Set([...pressList, ...writerList].filter((n) => !filtered.some((p) => p.name === n)));
  function row(name) {
    return '<div class="cal-ev-role-item"><span class="name">' + escapeHtml(name) + '</span>' +
      '<span class="cal-ev-role-toggles">' +
        '<label><input type="checkbox" class="cal-ev-role-basin" data-name="' + escapeHtml(name) + '" ' + (pressList.indexOf(name) !== -1 ? 'checked' : '') + '> Basın Görevlisi</label>' +
        '<label><input type="checkbox" class="cal-ev-role-haber" data-name="' + escapeHtml(name) + '" ' + (writerList.indexOf(name) !== -1 ? 'checked' : '') + '> Haberi Yazdı</label>' +
      '</span></div>';
  }
  let html = '';
  extraNames.forEach((name) => { html += row(name); });
  html += filtered.map((p) => row(p.name)).join('');
  if (!html) { html = '<p class="cal-ev-att-empty">' + (pool.length ? 'Eşleşen kişi yok.' : 'Henüz admin tarafından işaretlenmiş basın görevlisi yok.') + '</p>'; }
  return html;
}

// --- İl Protokolü birimleri -------------------------------------------------
// Kullanıcı isteği: takvimdeki "Düzenleyen Birim" alanı üniversite birimlerinin
// yanında SAMSUN İL PROTOKOLÜ kurumlarını da sunmalı. Kaynak: Samsun Valiliği
// "Tebrikata Giriş Sırası" protokol listesi (samsun.gov.tr/protokol-listesi) --
// gruplar VE grup içi sıra o listedeki protokol sırasını izler, alfabetik DEĞİL
// (bu yüzden facultyOptionsHtml'deki gibi sıralama yapılmaz, dizi sırası korunur).
// Kasıtlı olarak SADECE üst düzey kurumlar var: dernek/vakıf/sendika/şube ve
// tek tek müdürlükler altındaki birimler listelenmez -- gerekirse formdaki
// "Diğer…" seçeneğiyle serbest metin yazılır.
export const IL_PROTOCOL_UNIT_GROUPS = [
  { title: 'Mülki İdare ve Yerel Yönetim', items: [
    'Samsun Valiliği', 'Samsun Büyükşehir Belediyesi'
  ] },
  { title: 'Garnizon ve Güvenlik', items: [
    'Samsun Garnizon Komutanlığı', 'Samsun İl Emniyet Müdürlüğü', 'Samsun İl Jandarma Komutanlığı',
    'Sahil Güvenlik Karadeniz Bölge Komutanlığı'
  ] },
  { title: 'Adliye', items: [
    'Samsun Cumhuriyet Başsavcılığı', 'Samsun Adli Yargı Adalet Komisyonu Başkanlığı',
    'Samsun Bölge Adliye Mahkemesi', 'Samsun Bölge İdare Mahkemesi', 'Samsun Barosu'
  ] },
  { title: 'Üniversiteler', items: [
    'Ondokuz Mayıs Üniversitesi', 'Samsun Üniversitesi'
  ] },
  { title: 'Kaymakamlıklar', items: [
    'Alaçam Kaymakamlığı', 'Asarcık Kaymakamlığı', 'Atakum Kaymakamlığı', 'Ayvacık Kaymakamlığı',
    'Bafra Kaymakamlığı', 'Canik Kaymakamlığı', 'Çarşamba Kaymakamlığı', 'Havza Kaymakamlığı',
    'İlkadım Kaymakamlığı', 'Kavak Kaymakamlığı', 'Ladik Kaymakamlığı', '19 Mayıs Kaymakamlığı',
    'Salıpazarı Kaymakamlığı', 'Tekkeköy Kaymakamlığı', 'Terme Kaymakamlığı',
    'Vezirköprü Kaymakamlığı', 'Yakakent Kaymakamlığı'
  ] },
  { title: 'İlçe Belediyeleri', items: [
    'Alaçam Belediyesi', 'Asarcık Belediyesi', 'Atakum Belediyesi', 'Ayvacık Belediyesi',
    'Bafra Belediyesi', 'Canik Belediyesi', 'Çarşamba Belediyesi', 'Havza Belediyesi',
    'İlkadım Belediyesi', 'Kavak Belediyesi', 'Ladik Belediyesi', '19 Mayıs Belediyesi',
    'Salıpazarı Belediyesi', 'Tekkeköy Belediyesi', 'Terme Belediyesi',
    'Vezirköprü Belediyesi', 'Yakakent Belediyesi'
  ] },
  { title: 'İl Müdürlükleri ve Bölge Teşkilatı', items: [
    'Samsun İl Milli Eğitim Müdürlüğü', 'Samsun İl Sağlık Müdürlüğü',
    'Samsun İl Kültür ve Turizm Müdürlüğü', 'Samsun İl Tarım ve Orman Müdürlüğü',
    'Samsun İl Afet ve Acil Durum Müdürlüğü (AFAD)',
    'Samsun Çevre, Şehircilik ve İklim Değişikliği İl Müdürlüğü',
    'Samsun Gençlik ve Spor İl Müdürlüğü', 'Samsun Aile ve Sosyal Hizmetler İl Müdürlüğü',
    'Samsun Ticaret İl Müdürlüğü', 'Samsun Sanayi ve Teknoloji İl Müdürlüğü',
    'Samsun Çalışma ve İş Kurumu İl Müdürlüğü (İŞKUR)', 'Samsun SGK İl Müdürlüğü',
    'Samsun Defterdarlığı', 'Samsun İl Göç İdaresi Müdürlüğü',
    'Samsun İl Nüfus ve Vatandaşlık Müdürlüğü',
    'Cumhurbaşkanlığı İletişim Başkanlığı Samsun Bölge Müdürlüğü',
    'Orta Karadeniz Kalkınma Ajansı (OKA)'
  ] },
  { title: 'Meslek Kuruluşları', items: [
    'Samsun Ticaret ve Sanayi Odası', 'Samsun Ticaret Borsası',
    'Samsun Esnaf ve Sanatkârları Odaları Birliği', 'Samsun Ziraat Odası',
    'Samsun Tabip Odası', '19 Mayıs Gazeteciler Cemiyeti'
  ] }
];

const IL_PROTOCOL_UNIT_SET = new Set(IL_PROTOCOL_UNIT_GROUPS.flatMap((g) => g.items));
const FACULTY_UNIT_SET = new Set(FACULTY_GROUPS.flatMap((g) => g.items));

export function isIlProtocolUnit(name) { return IL_PROTOCOL_UNIT_SET.has(name); }
export function isFacultyUnit(name) { return FACULTY_UNIT_SET.has(name); }

export function ilUnitOptionsHtml(selected) {
  return IL_PROTOCOL_UNIT_GROUPS.map((g) => '<optgroup label="' + escapeHtml(g.title) + '">' +
    g.items.map((name) => '<option value="' + escapeHtml(name) + '"' + (name === selected ? ' selected' : '') + '>' + escapeHtml(name) + '</option>').join('') +
    '</optgroup>').join('');
}
