// Texas Hold'em'in saf deste ve el değerlendirme motoru. Bu dosya bilerek
// DOM, Firebase ve oyun turu durumundan bağımsızdır; hem botlar hem de masa
// arayüzü aynı, denetlenebilir kuralları kullanabilir.

export const HOLDEM_TAKIMLARI = ['kupa', 'sinek', 'karo', 'maca'];
export const HOLDEM_RUTBELERI = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'joker', 'kiz', 'papaz', 'as'];
export const HOLDEM_DESTE_KART_SAYISI = 52;

const RUTBE_DEGERLERI = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  joker: 11, kiz: 12, papaz: 13, as: 14,
  J: 11, Q: 12, K: 13, A: 14
};

const TUR_BILGILERI = [
  ['high_card', 'Yüksek kart'],
  ['pair', 'Bir çift'],
  ['two_pair', 'İki çift'],
  ['three_of_a_kind', 'Üçlü'],
  ['straight', 'Kent'],
  ['flush', 'Renk'],
  ['full_house', 'Full'],
  ['four_of_a_kind', 'Kare'],
  ['straight_flush', 'Sıralı renk']
];

/** Standart 52 kartlık deste; joker veya Blackjack'e özgü ek kart içermez. */
export function holdemDestesiOlustur() {
  const deste = [];
  HOLDEM_TAKIMLARI.forEach((s) => HOLDEM_RUTBELERI.forEach((r) => deste.push({ r, s })));
  return deste;
}

/** Fisher-Yates karıştırması; çağıranın dizisini değiştirmez. */
export function holdemDesteyiKaris(deste, rastgele = Math.random) {
  const kopya = Array.isArray(deste) ? deste.slice() : [];
  for (let i = kopya.length - 1; i > 0; i--) {
    const j = Math.floor(rastgele() * (i + 1));
    [kopya[i], kopya[j]] = [kopya[j], kopya[i]];
  }
  return kopya;
}

/** Tarayıcı destekliyorsa kriptografik rastgelelik, yoksa güvenli geri dönüş. */
export function holdemGuvenliRastgele() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const değer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(değer);
    return değer[0] / 4294967296;
  }
  return Math.random();
}

function desteKimligiOlustur() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') { return globalThis.crypto.randomUUID(); }
  return 'holdem-' + Date.now().toString(36) + '-' + Math.floor(holdemGuvenliRastgele() * 0xFFFFFFFF).toString(36);
}

/** Her el için yeni, tekil kimlikli ve 52 farklı karttan oluşan deste paketi. */
export function holdemYeniDeste(rastgele = holdemGuvenliRastgele) {
  const deste = holdemDesteyiKaris(holdemDestesiOlustur(), rastgele);
  return { desteId: desteKimligiOlustur(), kartlar: deste, kartSayisi: HOLDEM_DESTE_KART_SAYISI };
}

function kartDegeri(kart) {
  if (!kart || !Object.prototype.hasOwnProperty.call(RUTBE_DEGERLERI, kart.r)) {
    throw new TypeError('Geçersiz Hold’em kart rütbesi.');
  }
  if (!HOLDEM_TAKIMLARI.includes(kart.s)) {
    throw new TypeError('Geçersiz Hold’em kart takımı.');
  }
  return RUTBE_DEGERLERI[kart.r];
}

function azalanSirala(sayilar) {
  return sayilar.slice().sort((a, b) => b - a);
}

function duzYuksekligi(degerler) {
  const farkli = [...new Set(degerler)].sort((a, b) => a - b);
  if (farkli.length !== 5) {return 0;}
  // As, A-2-3-4-5 kentinde 1 kabul edilir; karşılaştırmada yükseklik 5'tir.
  if (farkli.join(',') === '2,3,4,5,14') {return 5;}
  return farkli[4] - farkli[0] === 4 ? farkli[4] : 0;
}

function besliDegerlendir(kartlar) {
  const degerler = kartlar.map(kartDegeri);
  const azalan = azalanSirala(degerler);
  const gruplar = new Map();
  degerler.forEach((deger) => gruplar.set(deger, (gruplar.get(deger) || 0) + 1));
  const adetSonraDeger = [...gruplar.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const renkMi = kartlar.every((kart) => kart.s === kartlar[0].s);
  const duzYuksek = duzYuksekligi(degerler);

  let siralama;
  let esKirma;
  let tur;
  if (renkMi && duzYuksek) {
    siralama = 8;
    esKirma = [duzYuksek];
    tur = duzYuksek === 14 ? 'royal_flush' : 'straight_flush';
  } else if (adetSonraDeger[0][1] === 4) {
    siralama = 7;
    esKirma = [adetSonraDeger[0][0], adetSonraDeger[1][0]];
    tur = 'four_of_a_kind';
  } else if (adetSonraDeger[0][1] === 3 && adetSonraDeger[1][1] === 2) {
    siralama = 6;
    esKirma = [adetSonraDeger[0][0], adetSonraDeger[1][0]];
    tur = 'full_house';
  } else if (renkMi) {
    siralama = 5;
    esKirma = azalan;
    tur = 'flush';
  } else if (duzYuksek) {
    siralama = 4;
    esKirma = [duzYuksek];
    tur = 'straight';
  } else if (adetSonraDeger[0][1] === 3) {
    siralama = 3;
    esKirma = [adetSonraDeger[0][0], ...azalan.filter((d) => d !== adetSonraDeger[0][0])];
    tur = 'three_of_a_kind';
  } else if (adetSonraDeger[0][1] === 2 && adetSonraDeger[1][1] === 2) {
    const ciftler = azalan.filter((d) => gruplar.get(d) === 2);
    siralama = 2;
    esKirma = [...ciftler, azalan.find((d) => gruplar.get(d) === 1)];
    tur = 'two_pair';
  } else if (adetSonraDeger[0][1] === 2) {
    siralama = 1;
    esKirma = [adetSonraDeger[0][0], ...azalan.filter((d) => d !== adetSonraDeger[0][0])];
    tur = 'pair';
  } else {
    siralama = 0;
    esKirma = azalan;
    tur = 'high_card';
  }
  const bilgi = TUR_BILGILERI[siralama];
  return { tur, turAdi: tur === 'royal_flush' ? 'Royal flush' : bilgi[1], siralama, esKirma, anahtar: [siralama, ...esKirma], kartlar: kartlar.slice() };
}

/**
 * 5, 6 veya 7 kart içinden en güçlü beşliyi bulur. Dönüşteki `anahtar`,
 * önce kombinasyon gücünü sonra eşitliği bozan kart değerlerini içerir.
 */
export function holdemElDegerlendir(kartlar) {
  if (!Array.isArray(kartlar) || kartlar.length < 5 || kartlar.length > 7) {
    throw new RangeError('Hold’em eli 5 ile 7 kart arasında olmalıdır.');
  }
  const gorulen = new Set();
  kartlar.forEach((kart) => {
    kartDegeri(kart);
    const anahtar = `${kart.r}-${kart.s}`;
    if (gorulen.has(anahtar)) {throw new TypeError('Aynı kart bir elde iki kez bulunamaz.');}
    gorulen.add(anahtar);
  });

  let enIyi = null;
  for (let a = 0; a < kartlar.length - 4; a++) {
    for (let b = a + 1; b < kartlar.length - 3; b++) {
      for (let c = b + 1; c < kartlar.length - 2; c++) {
        for (let d = c + 1; d < kartlar.length - 1; d++) {
          for (let e = d + 1; e < kartlar.length; e++) {
            const aday = besliDegerlendir([kartlar[a], kartlar[b], kartlar[c], kartlar[d], kartlar[e]]);
            if (!enIyi || holdemDegerlendirmeKarsilastir(aday, enIyi) > 0) {enIyi = aday;}
          }
        }
      }
    }
  }
  return enIyi;
}

/** Değerlendirilmiş iki eli karşılaştırır: 1 ilk el, -1 ikinci el, 0 beraberlik. */
export function holdemDegerlendirmeKarsilastir(ilki, ikincisi) {
  const ilkAnahtar = ilki && ilki.anahtar;
  const ikinciAnahtar = ikincisi && ikincisi.anahtar;
  if (!Array.isArray(ilkAnahtar) || !Array.isArray(ikinciAnahtar)) {
    throw new TypeError('Karşılaştırma için iki Hold’em değerlendirmesi gerekir.');
  }
  const uzunluk = Math.max(ilkAnahtar.length, ikinciAnahtar.length);
  for (let i = 0; i < uzunluk; i++) {
    const fark = (ilkAnahtar[i] || 0) - (ikinciAnahtar[i] || 0);
    if (fark) {return fark > 0 ? 1 : -1;}
  }
  return 0;
}

/** Kart dizilerini tek çağrıda değerlendirip karşılaştıran kolaylık fonksiyonu. */
export function holdemElleriniKarsilastir(ilki, ikincisi) {
  return holdemDegerlendirmeKarsilastir(holdemElDegerlendir(ilki), holdemElDegerlendir(ikincisi));
}
