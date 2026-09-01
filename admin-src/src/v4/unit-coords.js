// OMÜ birim koordinatları — kullanıcı tarafından sağlandı (2026-09-02, Google Maps'ten
// elle çıkarıldı). Anahtarlar app.js'teki FACULTY_GROUPS listesindeki isimlerle BİREBİR
// eşleşir ("Düzenleyen Birim" alanı bu listeden seçildiği için etkinlik.birim değerleri de
// buradaki isimlerle örtüşür). Koordinatı sağlanmayan birimler ("yok" olarak işaretlenenler)
// bilerek burada YOK -- harita bunları göstermez, sadece sağ paneldeki listede "konum yok"
// notuyla belirir.
export const UNIT_COORDS = {
  'Ali Fuad Başgil Hukuk Fakültesi':        [41.20572440377142, 36.711160093873225],
  'Çarşamba İnsan ve Toplum Bilimleri Fakültesi': [41.20539475052086, 36.713084049271444],
  'Diş Hekimliği Fakültesi':                [41.36654502595805, 36.20375004913421],
  'Eczacılık Fakültesi':                    [41.56536988741614, 35.874315672533555],
  'Eğitim Fakültesi':                       [41.36927084650928, 36.18823343856294],
  'Fen Fakültesi':                          [41.36738234112074, 36.18630261603514],
  'Güzel Sanatlar Fakültesi':               [41.323182082846586, 36.31427605749022],
  'İktisadi ve İdari Bilimler Fakültesi':   [41.368755676717065, 36.197015292416886],
  'İlahiyat Fakültesi':                     [41.36802745954825, 36.19859053055914],
  'İletişim Fakültesi':                     [41.20625890910604, 36.711861511334185],
  'İnsan ve Toplum Bilimleri Fakültesi':    [41.366578008409384, 36.185116045848],
  'Mimarlık Fakültesi':                     [41.322688042047275, 36.31433218555496],
  'Mühendislik Fakültesi':                  [41.36430486222524, 36.18456746964151],
  'Sağlık Bilimleri Fakültesi':             [41.36663314983922, 36.19453901762453],
  'Tıp Fakültesi':                          [41.368890187382654, 36.20880431534752],
  'Turizm Fakültesi':                       [41.56574114721119, 35.87458925741295],
  'Veteriner Fakültesi':                    [41.363411758273735, 36.185887762896556],
  'Yaşar Doğu Spor Bilimleri Fakültesi':    [41.36816416321778, 36.20558739856953],
  'Ziraat Fakültesi':                       [41.36499310830285, 36.18767622144811],

  'Devlet Konservatuvarı':                  [41.32321496438816, 36.31541670112868],
  'Yabancı Diller Yüksekokulu':             [41.36911330658792, 36.197210083356396],

  'Lisansüstü Eğitim Enstitüsü':            [41.36847420060691, 36.209015393874374],
  'Kenevir Araştırmaları Enstitüsü':        [41.36229492645458, 36.18403688675062],

  'Alaçam Meslek Yüksekokulu':              [41.61231855693856, 35.60397751007379],
  'Bafra Meslek Yüksekokulu':               [41.56516374319673, 35.900378878107375],
  'Bafra Turizm Meslek Yüksekokulu':        [41.566078290416186, 35.874878938563555],
  'Çarşamba Ticaret Borsası Meslek Yüksekokulu': [41.20455297291719, 36.72884760773915],
  'Havza Meslek Yüksekokulu':               [40.98957213156397, 35.70913002848269],
  'Ladik Meslek Yüksekokulu':               [40.93500133909032, 35.89529605539074],
  'Sağlık Hizmetleri Meslek Yüksekokulu':   [41.36683204292883, 36.19511641557785],
  'Samsun Meslek Yüksekokulu':              [41.32362502780868, 36.3141302369615],
  'Terme Meslek Yüksekokulu':               [41.20483438171254, 37.003546522416784],
  'Vezirköprü Meslek Yüksekokulu':          [41.12994606739397, 35.456367564400715],
  'Yeşilyurt Demir Çelik Meslek Yüksekokulu': [41.240387003360205, 36.434915585521836],

  'Teknoloji Transfer Ofisi':               [41.36101865243636, 36.179853043032445],

  'Araştırma ve Geliştirme Koordinatörlüğü (AR-GE)': [41.373920723403366, 36.21288030662858],
  'Eğitim Öğretim Koordinatörlüğü':         [41.37306084862753, 36.21039580042714],
  'Uluslararası İlişkiler Koordinatörlüğü': [41.368586594536076, 36.209192321208704],

  'Rektörlük':                              [41.37197156043952, 36.22049058492251]
};

// "Düzenleyen Birim" alanı FACULTY_GROUPS'tan seçildiği için gerçek etkinlik kayıtlarında
// "Rektörlük" değil "Rektör" / "Rektör Yardımcısı" değerleri görülür (bkz. app.js
// FACULTY_GROUPS "Rektörlük" grubunun items'ı) -- ikisi de aynı fiziksel binaya işaret eder.
const ALIASES = { 'Rektör': 'Rektörlük', 'Rektör Yardımcısı': 'Rektörlük' };

export function resolveUnitName(birim) {
  const b = String(birim || '').trim();
  return ALIASES[b] || b;
}

export function coordsFor(birim) {
  return UNIT_COORDS[resolveUnitName(birim)] || null;
}
