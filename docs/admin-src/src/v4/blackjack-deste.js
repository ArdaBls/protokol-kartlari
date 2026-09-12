// Blackjack (oyun-blackjack.html) -- saf kart/deste mantığı, Firebase veya DOM'a
// HİÇ dokunmaz (test edilebilirlik için ayrı tutuluyor, bkz. tests/blackjack-deste-test.js).
// Kart kodlaması ("r","s") doğrudan public/assets/blackjack/kartlar/... dosya
// isimleriyle birebir aynı -- ayrı bir eşleme tablosuna gerek yok. Kullanıcının
// kendi adlandırması: Vale='joker', Kız='kiz', Papaz='papaz'.

export const TAKIMLAR = ['kupa', 'sinek', 'karo', 'maca'];
export const RUTBELER = ['as', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'joker', 'kiz', 'papaz'];
export const DESTE_SAYISI = 4;
export const TEK_DESTE_KART_SAYISI = RUTBELER.length * TAKIMLAR.length; // 52
export const TOPLAM_KART_SAYISI = DESTE_SAYISI * TEK_DESTE_KART_SAYISI; // 208
export const MAX_KOLTUK = 5;
export const BAHIS_SURESI_MS = 6000;
export const BASLANGIC_BAKIYESI = 1000;

/** 208 kartlık (4 deste) sırayı oluşturur -- henüz karılmamış. */
export function tazeDesteOlustur() {
  const deste = [];
  for (let d = 0; d < DESTE_SAYISI; d++) {
    TAKIMLAR.forEach((s) => {
      RUTBELER.forEach((r) => { deste.push({ r, s }); });
    });
  }
  return deste;
}

/** Fisher-Yates -- yerinde karıştırmaz, yeni dizi döndürür. */
export function desteyiKaris(deste) {
  const kopya = deste.slice();
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = kopya[i]; kopya[i] = kopya[j]; kopya[j] = t;
  }
  return kopya;
}

/** Bir kartın blackjack değeri. As için 11 döner (yumuşak/sert hesap kartHucresiDegeri'nde). */
export function kartDegeri(kart) {
  if (kart.r === 'as') { return 11; }
  if (kart.r === 'joker' || kart.r === 'kiz' || kart.r === 'papaz') { return 10; }
  return Number(kart.r);
}

/**
 * Bir elin toplamını hesaplar -- As'lar önce 11 sayılır, eldeki toplam 21'i
 * geçerse (ve elde henüz 1'e indirilmemiş bir As varsa) bir As 1'e düşürülür.
 * @returns {{ toplam: number, yumusakMi: boolean, battiMi: boolean, blackjackMi: boolean }}
 */
export function elDegerlendir(kartlar) {
  let toplam = kartlar.reduce((t, k) => t + kartDegeri(k), 0);
  let asSayisi = kartlar.filter((k) => k.r === 'as').length;
  while (toplam > 21 && asSayisi > 0) { toplam -= 10; asSayisi--; }
  const yumusakMi = asSayisi > 0; // hâlâ 11 sayılan bir As var
  return {
    toplam,
    yumusakMi,
    battiMi: toplam > 21,
    blackjackMi: toplam === 21 && kartlar.length === 2
  };
}

/** İki kart aynı rütbe DEĞERİNDEYSE (10/joker/kiz/papaz hepsi 10 sayılır) bölünebilir mi? */
export function bolunebilirMi(kartlar) {
  if (kartlar.length !== 2) { return false; }
  return kartDegeri(kartlar[0]) === kartDegeri(kartlar[1]) && kartlar[0].r === kartlar[1].r;
}

/**
 * Krupiyerin elini, sabit deste sırasından (desteIndex'ten itibaren) kart
 * çekerek 17 (veya üzeri) olana kadar oynatır. "17'de sert dur" kuralı --
 * yumuşak 17'de de durur. Gizli bilgi kalmadığı (kartlar zaten dağıtılmış)
 * için bu fonksiyon HERHANGİ bir istemcide aynı sonucu üretir, çakışma riski yok.
 * @returns {{ kartlar: object[], yeniDesteIndex: number, sonuc: ReturnType<typeof elDegerlendir> }}
 */
export function krupiyerElOyna(baslangicKartlari, deste, desteIndex) {
  const kartlar = baslangicKartlari.slice();
  let idx = desteIndex;
  let degerlendirme = elDegerlendir(kartlar);
  while (degerlendirme.toplam < 17) {
    kartlar.push(deste[idx]);
    idx++;
    degerlendirme = elDegerlendir(kartlar);
  }
  return { kartlar, yeniDesteIndex: idx, sonuc: degerlendirme };
}

/**
 * Bir sonraki elden önce deste yetecek mi? Split ihtimaliyle her koltuk için
 * kötümser bir üst sınır (5 kart) + krupiyer (5 kart) varsayılıyor -- yetersizse
 * çağıran taraf yeni bir 208'lik deste karıp baştan başlamalı.
 */
export function desteYeterliMi(kalanKartSayisi, aktifKoltukSayisi) {
  const KOTUMSER_KART_PAYI = 5;
  return kalanKartSayisi >= (aktifKoltukSayisi + 1) * KOTUMSER_KART_PAYI;
}

/** Bahis sonucu: 'blackjack' 3:2, 'kazandi' 1:1, 'berabere' bahis iade, 'kaybetti' bahis gider. */
export function elSonucuHesapla(oyuncuDegerlendirme, krupiyerDegerlendirme, bahis) {
  if (oyuncuDegerlendirme.battiMi) { return { sonuc: 'kaybetti', odeme: 0 }; }
  if (oyuncuDegerlendirme.blackjackMi && !krupiyerDegerlendirme.blackjackMi) { return { sonuc: 'blackjack', odeme: bahis + Math.floor(bahis * 1.5) }; }
  if (krupiyerDegerlendirme.battiMi) { return { sonuc: 'kazandi', odeme: bahis * 2 }; }
  if (oyuncuDegerlendirme.blackjackMi && krupiyerDegerlendirme.blackjackMi) { return { sonuc: 'berabere', odeme: bahis }; }
  if (oyuncuDegerlendirme.toplam > krupiyerDegerlendirme.toplam) { return { sonuc: 'kazandi', odeme: bahis * 2 }; }
  if (oyuncuDegerlendirme.toplam < krupiyerDegerlendirme.toplam) { return { sonuc: 'kaybetti', odeme: 0 }; }
  return { sonuc: 'berabere', odeme: bahis };
}
