// Ortak "kadro" verisi/pickerları -- Takvim (calendar.js) VE Haber Detayı
// (haber-detayi.html) sayfaları AYNI fakülte/birim listesini ve AYNI basın
// görevlisi havuzunu kullanmalı (kullanıcı isteği: "eşzamanlı olmalı her
// çalıştığı her yer ile"). Projede küçük yardımcılar genelde dosyalar arası
// KOPYALANIR (bkz. escapeHtml/fmtTarih), ama bu veri kopyalanırsa iki sayfa
// zamanla farklı fakülte listesi/basın görevlisi göstermeye başlar -- bu
// yüzden BİLEREK tek, paylaşılan bir modülde tutuluyor.

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
  return database.ref('basinGorevlileri').once('value').then((snap) => {
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
