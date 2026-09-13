// Pişti (oyun-pisti.html) -- saf kart/deste mantığı, Firebase veya DOM'a HİÇ
// dokunmaz (test edilebilirlik için ayrı tutuluyor, bkz. tests/pisti-deste-test.js).
// Kart kodlaması Blackjack ile AYNI ("r","s") -- ayrı bir eşleme tablosuna
// gerek yok, aynı kart görselleri (public/assets/blackjack/kartlar/...)
// doğrudan yeniden kullanılabilir. Vale='joker', Kız='kiz', Papaz='papaz'.
// Standart 52 kartlık TEK deste -- Blackjack'in 4 destelik/bonus joker'li
// yapısıyla KARIŞTIRILMAMALI, kasıtlı olarak ayrı bir dosya.

export const TAKIMLAR = ['kupa', 'sinek', 'karo', 'maca'];
export const RUTBELER = ['as', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'joker', 'kiz', 'papaz'];
export const TOPLAM_KART_SAYISI = RUTBELER.length * TAKIMLAR.length; // 52
export const MIN_OYUNCU = 2;
export const MAX_OYUNCU = 4;
export const EL_BASINA_KART = 4;
export const HEDEF_PUAN = 101;
export const PISTI_PUANI = 10;
export const EN_COK_KART_PUANI = 3;

/** 52 kartlık standart destenin (henüz karılmamış) sırası. */
export function pistiDestesiOlustur() {
  const deste = [];
  TAKIMLAR.forEach((s) => { RUTBELER.forEach((r) => { deste.push({ r, s }); }); });
  return deste;
}

/** Fisher-Yates -- yerinde karıştırmaz, yeni dizi döndürür. */
export function pistiDesteyiKaris(deste) {
  const kopya = deste.slice();
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = kopya[i]; kopya[i] = kopya[j]; kopya[j] = t;
  }
  return kopya;
}

/**
 * Bir kartın el sonu sayım değeri: As ve Vale 1, Sinek 2 -> 2, Karo 10 -> 3,
 * geri kalanı 0. (Kağıt sayısı bonusu -- "en çok kart toplayan +3" -- ayrı
 * bir kuraldır, bkz. pistiElPuanlariniHesapla.)
 */
export function pistiKartDegeri(kart) {
  if (kart.r === 'as' || kart.r === 'joker') { return 1; }
  if (kart.r === '2' && kart.s === 'sinek') { return 2; }
  if (kart.r === '10' && kart.s === 'karo') { return 3; }
  return 0;
}

/**
 * Bir kart oynandığında masanın yeni halini ve bu hamlenin sonucunu hesaplar.
 * Basitleştirme: "pişti" (masada TAM OLARAK bir kart varken eşleşen bir kart
 * ya da vale ile o tek kartı süpürmek), oyunun İLK hamlesi dahil her zaman
 * geçerlidir -- bazı yerel varyantlar ilk açık kartı hariç tutar, burada
 * kasıtlı olarak tutulmadı (basitlik için).
 *
 * @returns {{ yeniMasaKartlari: object[], alinanKartlar: object[], pistiMi: boolean }}
 *   alinanKartlar boşsa (kart sadece masaya eklendiyse) hiçbir şey alınmamış demektir.
 */
export function pistiHamleUygula(masaKartlari, oynananKart) {
  const masa = Array.isArray(masaKartlari) ? masaKartlari : [];
  const valeMi = oynananKart.r === 'joker';
  const ustKart = masa[masa.length - 1];
  const eslesmeMi = Boolean(ustKart) && ustKart.r === oynananKart.r;
  const alirMi = masa.length > 0 && (valeMi || eslesmeMi);
  if (!alirMi) {
    return { yeniMasaKartlari: masa.concat([oynananKart]), alinanKartlar: [], pistiMi: false };
  }
  // Pişti: hamleden ÖNCE masada tam olarak bir kart vardı ve o kart bu
  // hamleyle (eşleşme ya da vale) süpürüldü.
  const pistiMi = masa.length === 1;
  return { yeniMasaKartlari: [], alinanKartlar: masa.concat([oynananKart]), pistiMi };
}

/**
 * Destenin ve tüm ellerin tükendiği elin SONUNDA (son kart oynandıktan sonra)
 * masada kalan kartları -- kim alacaksa -- kurallara göre onun toplamına ekler.
 * "Son kartı oynayan, masada ne kalırsa (eşleşme olmasa bile) alır."
 */
export function pistiSonMasayiDagit(masaKartlari, sonOynayanKoltukIndex, topladiklarim) {
  if (!masaKartlari.length) { return topladiklarim; }
  const yeni = topladiklarim.map((liste) => liste.slice());
  yeni[sonOynayanKoltukIndex] = yeni[sonOynayanKoltukIndex].concat(masaKartlari);
  return yeni;
}

/**
 * Bir elin (deste bitince) puanlarını hesaplar: kağıt değerleri toplamı +
 * pişti başına 10 + en çok kart toplayana (kesin çoğunluk, berabere ise
 * bonus YOK) +3. `topladiklarim` ve `pistiSayilari` koltuk indeksine göre
 * dizilerdir (aynı uzunlukta).
 * @returns {number[]} her koltuğun bu eldeki puanı
 */
export function pistiElPuanlariniHesapla(topladiklarim, pistiSayilari) {
  const kartSayilari = topladiklarim.map((liste) => liste.length);
  const enCokKart = Math.max(...kartSayilari);
  const enCokTekBasinaMi = kartSayilari.filter((n) => n === enCokKart).length === 1;
  return topladiklarim.map((liste, index) => {
    const kagitPuani = liste.reduce((toplam, kart) => toplam + pistiKartDegeri(kart), 0);
    const pistiPuani = (pistiSayilari[index] || 0) * PISTI_PUANI;
    const cokKartPuani = enCokTekBasinaMi && kartSayilari[index] === enCokKart ? EN_COK_KART_PUANI : 0;
    return kagitPuani + pistiPuani + cokKartPuani;
  });
}

/** Deste, oyuncu sayısına göre bir SONRAKİ eli dağıtmaya yeter mi (4'er kart)? */
export function pistiDesteYeterliMi(kalanKartSayisi, oyuncuSayisi) {
  if (!Number.isSafeInteger(kalanKartSayisi) || kalanKartSayisi < 0) { return false; }
  if (!Number.isSafeInteger(oyuncuSayisi) || oyuncuSayisi < MIN_OYUNCU || oyuncuSayisi > MAX_OYUNCU) { return false; }
  return kalanKartSayisi >= oyuncuSayisi * EL_BASINA_KART;
}
