// Canlı Texas Hold'em masa çekirdeği. DOM ve Firebase'den bağımsızdır; bu
// nedenle masa transaction'ı, bot zamanlayıcısı ve testler tam aynı kuralları
// kullanır. `deste` bu sürümde masa nesnesinde tutulur: site çipleri gerçek
// para değildir ve kullanıcı bu görünürlük modelini kabul etmiştir.
import { holdemYeniDeste, holdemElDegerlendir, holdemDegerlendirmeKarsilastir } from './holdem-engine.js';

export const HOLDEM_VARSAYILAN_AYARLAR = Object.freeze({
  girisBedeli: 1000,
  kucukKor: 25,
  buyukKor: 50,
  aksiyonSuresiMs: 60000,
  cikisAksiyonSuresiMs: 10000,
  masaKapasitesi: 5
});

const AKTIF_DURUMLAR = new Set(['preflop', 'flop', 'turn', 'river']);

function tamSayi(deger, varsayilan) {
  const sayi = Number(deger);
  return Number.isFinite(sayi) ? Math.floor(sayi) : varsayilan;
}
function sinirla(deger, alt, ust) { return Math.max(alt, Math.min(ust, deger)); }
function tekilOyuncu(oyuncu) {
  if (!oyuncu || typeof oyuncu.uid !== 'string' || !oyuncu.uid) { throw new TypeError('Masa oyuncusunun tekil bir uid değeri olmalı.'); }
  return {
    uid: oyuncu.uid,
    isim: String(oyuncu.isim || 'Oyuncu').slice(0, 200),
    bot: oyuncu.bot === true,
    zorluk: ['kolay', 'normal', 'zor'].includes(oyuncu.zorluk) ? oyuncu.zorluk : 'normal',
    skin: { desteStili: oyuncu.skin?.desteStili || 'temel', yuzKartiTemasi: oyuncu.skin?.yuzKartiTemasi || 'varsayilan', desteArkasi: oyuncu.skin?.desteArkasi || '01' },
    masaBakiyesi: Math.max(0, tamSayi(oyuncu.masaBakiyesi, 0)),
    bagli: oyuncu.bagli !== false,
    ayrilacak: oyuncu.ayrilacak === true
  };
}

/** Owner ayar ekranı için tek kaynak; geçersiz alanlar varsayılana döner. */
export function holdemAyarlariNormalle(raw = {}) {
  const ayarlar = {
    girisBedeli: sinirla(tamSayi(raw.girisBedeli, HOLDEM_VARSAYILAN_AYARLAR.girisBedeli), 100, 100000),
    kucukKor: sinirla(tamSayi(raw.kucukKor, HOLDEM_VARSAYILAN_AYARLAR.kucukKor), 1, 10000),
    buyukKor: sinirla(tamSayi(raw.buyukKor, HOLDEM_VARSAYILAN_AYARLAR.buyukKor), 2, 20000),
    aksiyonSuresiMs: sinirla(tamSayi(raw.aksiyonSuresiMs, HOLDEM_VARSAYILAN_AYARLAR.aksiyonSuresiMs), 15000, 120000),
    cikisAksiyonSuresiMs: HOLDEM_VARSAYILAN_AYARLAR.cikisAksiyonSuresiMs,
    masaKapasitesi: HOLDEM_VARSAYILAN_AYARLAR.masaKapasitesi
  };
  if (ayarlar.buyukKor < ayarlar.kucukKor) { ayarlar.buyukKor = ayarlar.kucukKor * 2; }
  return ayarlar;
}

export function holdemVarsayilanAyarlaraDon() { return { ...HOLDEM_VARSAYILAN_AYARLAR }; }

export function holdemBosCanliMasa({ masaId = 'ana-masa', ayarlar } = {}) {
  return { masaId, surum: 1, ayarlar: holdemAyarlariNormalle(ayarlar), durum: 'lobi', elNo: 0, dagitici: 0, koltuklar: [], kuyruk: [], sonuclar: null, guncellemeTs: Date.now() };
}

function aktifKoltuklar(masa) { return (masa.koltuklar || []).filter((koltuk) => koltuk && koltuk.oynuyor !== false && !koltuk.ayrilacak); }
function sonrakiIndeks(koltuklar, baslangic, filtre = () => true) {
  for (let adim = 1; adim <= koltuklar.length; adim++) {
    const indeks = (baslangic + adim) % koltuklar.length;
    if (filtre(koltuklar[indeks], indeks)) { return indeks; }
  }
  return -1;
}
function oynayabilir(koltuk) { return koltuk && !koltuk.pas && !koltuk.allIn && koltuk.masaBakiyesi > 0; }
function devamEden(koltuk) { return koltuk && !koltuk.pas; }
function potHesapla(koltuklar) { return koltuklar.reduce((toplam, koltuk) => toplam + Math.max(0, tamSayi(koltuk.toplamYatirim, 0)), 0); }
function bahisYapabilenSayisi(masa) { return masa.koltuklar.filter((koltuk) => devamEden(koltuk) && oynayabilir(koltuk)).length; }
// Birden çok oyuncu elde kalsa bile yalnız birinin arkasında çip varsa, artık
// karşılayacak rakip yoktur. O oyuncuya anlamsız check/bet butonları vermek
// yerine kalan ortak kartlar otomatik açılır.
function otomatikRunoutGerekliMi(masa) {
  return masa.koltuklar.filter(devamEden).length > 1 && bahisYapabilenSayisi(masa) <= 1;
}
function kartDagit(deste, koltuklar) {
  const eller = koltuklar.map(() => []);
  let index = 0;
  for (let tur = 0; tur < 2; tur++) {
    koltuklar.forEach((_, koltuk) => { eller[koltuk].push(deste[index++]); });
  }
  return { eller, index };
}
function bahisYatir(koltuk, miktar) {
  const odeme = Math.min(Math.max(0, tamSayi(miktar, 0)), koltuk.masaBakiyesi);
  const sonraki = { ...koltuk, masaBakiyesi: koltuk.masaBakiyesi - odeme, sokakYatirimi: koltuk.sokakYatirimi + odeme, toplamYatirim: koltuk.toplamYatirim + odeme };
  if (sonraki.masaBakiyesi === 0) { sonraki.allIn = true; }
  return sonraki;
}
function sokakBekleyenleri(koltuklar, dagitici) {
  return koltuklar.map((koltuk, indeks) => oynayabilir(koltuk) ? indeks : null).filter((indeks) => indeks !== null && indeks !== dagitici ? true : indeks === dagitici).filter((indeks) => oynayabilir(koltuklar[indeks]));
}
function sokakBaslat(masa, durum, communityCards, desteIndex, now) {
  const koltuklar = masa.koltuklar.map((koltuk) => ({ ...koltuk, sokakYatirimi: 0 }));
  const bekleyen = sokakBekleyenleri(koltuklar, masa.dagitici);
  const currentSeat = sonrakiIndeks(koltuklar, masa.dagitici, (koltuk, indeks) => bekleyen.includes(indeks));
  return { ...masa, durum, koltuklar, communityCards, desteIndex, mevcutBahis: 0, minArtirma: masa.ayarlar.buyukKor, bekleyen, artirmaKapali: [], aktifKoltuk: currentSeat, aksiyonBitis: currentSeat === -1 ? null : now + masa.ayarlar.aksiyonSuresiMs };
}

/** Masaya gelen kişi aktif elde bekleme kuyruğuna alınır; bot ancak el sonunda değişir. */
export function holdemKatilimTalebi(masa, oyuncu) {
  const temiz = tekilOyuncu(oyuncu);
  const mevcut = (masa.koltuklar || []).some((koltuk) => koltuk.uid === temiz.uid) || (masa.kuyruk || []).some((kisi) => kisi.uid === temiz.uid);
  if (mevcut) { return masa; }
  return { ...masa, kuyruk: (masa.kuyruk || []).concat([{ ...temiz, istekTs: Date.now() }]), guncellemeTs: Date.now() };
}

/** El bittiğinde önce ayrılacaklar çıkar, sonra sıradaki gerçek kullanıcılar botların yerini alır. */
export function holdemElSonuKuyruguUygula(masa) {
  const kapasite = masa.ayarlar.masaKapasitesi;
  const koltuklar = (masa.koltuklar || []).filter((koltuk) => !koltuk.ayrilacak).map((koltuk) => ({ ...koltuk, bagli: koltuk.bot ? true : koltuk.bagli }));
  const kuyruk = (masa.kuyruk || []).slice();
  while (kuyruk.length) {
    const aday = kuyruk.shift();
    let hedef = koltuklar.findIndex((koltuk) => koltuk.bot);
    if (hedef < 0 && koltuklar.length < kapasite) { hedef = koltuklar.length; }
    if (hedef < 0) { kuyruk.unshift(aday); break; }
    const yeni = { ...aday, masaBakiyesi: masa.ayarlar.girisBedeli, oynuyor: true, pas: false, allIn: false, ayrilacak: false, toplamYatirim: 0, sokakYatirimi: 0, kartlar: [] };
    if (hedef === koltuklar.length) { koltuklar.push(yeni); } else { koltuklar[hedef] = yeni; }
  }
  return { ...masa, koltuklar, kuyruk, guncellemeTs: Date.now() };
}

/** Bir yeni el: gerçek oyuncular eksik koltuklarda botlarla tamamlanmış olmalıdır. */
export function holdemEliBaslat(masa, now = Date.now(), random) {
  const ayarlar = holdemAyarlariNormalle(masa.ayarlar);
  const koltuklar = aktifKoltuklar(masa).map((koltuk) => ({ ...koltuk, pas: false, allIn: false, toplamYatirim: 0, sokakYatirimi: 0, kartlar: [], ayrilacak: koltuk.ayrilacak === true }));
  if (koltuklar.length < 2) { throw new RangeError('Hold’em eli için en az iki oyuncu gerekir.'); }
  const destePaketi = holdemYeniDeste(random);
  const dagitim = kartDagit(destePaketi.kartlar, koltuklar);
  dagitim.eller.forEach((kartlar, index) => { koltuklar[index].kartlar = kartlar; });
  const dagitici = (tamSayi(masa.dagitici, -1) + 1 + koltuklar.length) % koltuklar.length;
  const headsUp = koltuklar.length === 2;
  const smallBlind = headsUp ? dagitici : sonrakiIndeks(koltuklar, dagitici, (koltuk) => koltuk.masaBakiyesi > 0);
  const bigBlind = sonrakiIndeks(koltuklar, smallBlind, (koltuk) => koltuk.masaBakiyesi > 0);
  koltuklar[smallBlind] = bahisYatir(koltuklar[smallBlind], ayarlar.kucukKor);
  koltuklar[bigBlind] = bahisYatir(koltuklar[bigBlind], ayarlar.buyukKor);
  const bekleyen = koltuklar.map((koltuk, index) => oynayabilir(koltuk) || (index === bigBlind && !koltuk.pas) ? index : null).filter((index) => index !== null);
  const aktifKoltuk = sonrakiIndeks(koltuklar, bigBlind, (koltuk, index) => bekleyen.includes(index));
  return {
    ...masa, ayarlar, durum: 'preflop', elNo: tamSayi(masa.elNo, 0) + 1, dagitici,
    desteId: destePaketi.desteId, deste: destePaketi.kartlar, desteIndex: dagitim.index, yakilanKartlar: [], communityCards: [],
    koltuklar, smallBlind, bigBlind, mevcutBahis: Math.max(koltuklar[bigBlind].sokakYatirimi, ayarlar.buyukKor), minArtirma: ayarlar.buyukKor,
    bekleyen, artirmaKapali: [], aktifKoltuk, aksiyonBitis: now + ayarlar.aksiyonSuresiMs, sonuclar: null, guncellemeTs: now
  };
}

function sokakIlerle(masa, now) {
  const devam = masa.koltuklar.filter(devamEden);
  if (devam.length <= 1) { return holdemEliBitir(masa, now); }
  if (masa.durum === 'river') { return holdemEliBitir(masa, now); }
  const kartSayisi = masa.durum === 'preflop' ? 3 : 1;
  const yakilan = masa.deste[masa.desteIndex];
  const acilan = masa.deste.slice(masa.desteIndex + 1, masa.desteIndex + 1 + kartSayisi);
  const durum = masa.durum === 'preflop' ? 'flop' : masa.durum === 'flop' ? 'turn' : 'river';
  const sonraki = sokakBaslat({ ...masa, yakilanKartlar: masa.yakilanKartlar.concat([yakilan]) }, durum, masa.communityCards.concat(acilan), masa.desteIndex + kartSayisi + 1, now);
  // Tüm rakipler all-in olduğunda ya da yalnız bir oyuncunun bahis yapacak
  // çipi kaldığında flopta takılı kalmadan turn, river ve showdown açılır.
  return otomatikRunoutGerekliMi(sonraki) ? sokakIlerle(sonraki, now) : sonraki;
}
function tumAktiflerAllInMi(masa) { return masa.koltuklar.filter(devamEden).every((koltuk) => koltuk.allIn); }
function sonrakiAksiyon(masa, now) {
  const bekleyen = masa.bekleyen.filter((index) => oynayabilir(masa.koltuklar[index]));
  if (!bekleyen.length) {
    if ((tumAktiflerAllInMi(masa) || otomatikRunoutGerekliMi(masa)) && masa.durum !== 'river') { return sokakIlerle(masa, now); }
    return sokakIlerle({ ...masa, bekleyen: [] }, now);
  }
  const aktifKoltuk = sonrakiIndeks(masa.koltuklar, masa.aktifKoltuk, (_, index) => bekleyen.includes(index));
  return { ...masa, bekleyen, aktifKoltuk, aksiyonBitis: now + masa.ayarlar.aksiyonSuresiMs, guncellemeTs: now };
}

/** Sıradaki tek oyuncunun pas/check/gör/artır/all-in hamlesi. */
export function holdemAksiyonUygula(masa, { koltukIndex, aksiyon, miktar } = {}, now = Date.now()) {
  if (!AKTIF_DURUMLAR.has(masa.durum) || koltukIndex !== masa.aktifKoltuk) { throw new Error('Bu oyuncunun sırası değil.'); }
  const koltuk = masa.koltuklar[koltukIndex];
  if (!oynayabilir(koltuk)) { throw new Error('Oyuncu aksiyon alamaz.'); }
  const toCall = Math.max(0, masa.mevcutBahis - koltuk.sokakYatirimi);
  let koltuklar = masa.koltuklar.slice();
  let mevcutBahis = masa.mevcutBahis;
  let minArtirma = masa.minArtirma;
  let bekleyen = masa.bekleyen.filter((index) => index !== koltukIndex);
  let artirmaKapali = Array.isArray(masa.artirmaKapali) ? masa.artirmaKapali.filter((index) => index !== koltukIndex) : [];
  if (aksiyon === 'fold') { koltuklar[koltukIndex] = { ...koltuk, pas: true, sonAksiyon: 'fold' }; }
  else if (aksiyon === 'check') {
    if (toCall) { throw new Error('Bahis varken check yapılamaz.'); }
    koltuklar[koltukIndex] = { ...koltuk, sonAksiyon: 'check' };
  } else if (aksiyon === 'call') {
    if (!toCall) { throw new Error('Görmek için karşılanacak bahis yok.'); }
    koltuklar[koltukIndex] = { ...bahisYatir(koltuk, toCall), sonAksiyon: 'call' };
  } else if (aksiyon === 'raise' || aksiyon === 'bet' || aksiyon === 'all_in') {
    const hedef = aksiyon === 'all_in' ? koltuk.sokakYatirimi + koltuk.masaBakiyesi : tamSayi(miktar, 0);
    // Bir oyuncu bahis miktarını karşılayamıyorsa all-in, eksik miktarla call
    // sayılır; yeni bir raise değildir ama side-pot için yatırımı korunur.
    if (aksiyon === 'all_in' && hedef <= masa.mevcutBahis) {
      koltuklar[koltukIndex] = { ...bahisYatir(koltuk, toCall), sonAksiyon: 'all_in' };
      return sonrakiAksiyon({ ...masa, koltuklar, bekleyen, artirmaKapali }, now);
    }
    if (hedef <= masa.mevcutBahis || hedef > koltuk.sokakYatirimi + koltuk.masaBakiyesi) { throw new Error('Geçersiz artırma miktarı.'); }
    if (artirmaKapali.includes(koltukIndex)) { throw new Error('Kısa all-in sonrası bahis yeniden açılmadı; yalnız gör veya pas geçebilirsin.'); }
    const artis = hedef - masa.mevcutBahis;
    const tamArtirma = artis >= masa.minArtirma;
    if (!tamArtirma && hedef !== koltuk.sokakYatirimi + koltuk.masaBakiyesi) { throw new Error('Artırma minimum artırmayı karşılamıyor.'); }
    koltuklar[koltukIndex] = { ...bahisYatir(koltuk, hedef - koltuk.sokakYatirimi), sonAksiyon: aksiyon };
    mevcutBahis = hedef;
    if (tamArtirma) {
      minArtirma = artis;
      bekleyen = koltuklar.map((aday, index) => index !== koltukIndex && oynayabilir(aday) ? index : null).filter((index) => index !== null);
      artirmaKapali = [];
    } else {
      // Min-raise altında kalan all-in, daha önce hamle yapmış kişilere yalnız
      // farkı görme/pas geçme hakkını geri verir; bahis yeniden açılmaz.
      const oncekiBekleyen = new Set(masa.bekleyen || []);
      bekleyen = koltuklar.map((aday, index) => index !== koltukIndex && oynayabilir(aday) && aday.sokakYatirimi < mevcutBahis ? index : null).filter((index) => index !== null);
      artirmaKapali = [...new Set(artirmaKapali.concat(bekleyen.filter((index) => !oncekiBekleyen.has(index))))].filter((index) => bekleyen.includes(index));
    }
  } else { throw new Error('Bilinmeyen Hold’em aksiyonu.'); }
  return sonrakiAksiyon({ ...masa, koltuklar, mevcutBahis, minArtirma, bekleyen, artirmaKapali }, now);
}

function kazananlariBul(koltuklar, communityCards, katilanlar) {
  let enIyi = null;
  let kazananlar = [];
  katilanlar.forEach((index) => {
    const el = holdemElDegerlendir(koltuklar[index].kartlar.concat(communityCards));
    if (!enIyi || holdemDegerlendirmeKarsilastir(el, enIyi) > 0) { enIyi = el; kazananlar = [index]; }
    else if (holdemDegerlendirmeKarsilastir(el, enIyi) === 0) { kazananlar.push(index); }
  });
  return { enIyi, kazananlar };
}

/** Ana ve yan potları toplam yatırımlardan üretir, eşitlikte kalan çipi sıra ile dağıtır. */
export function holdemEliBitir(masa, now = Date.now()) {
  const koltuklar = masa.koltuklar.map((koltuk) => ({ ...koltuk }));
  const yatirimSeviyeleri = [...new Set(koltuklar.map((koltuk) => koltuk.toplamYatirim).filter((miktar) => miktar > 0))].sort((a, b) => a - b);
  const odemeler = koltuklar.map(() => 0);
  const potlar = [];
  let onceki = 0;
  yatirimSeviyeleri.forEach((seviye) => {
    const katkiVerenler = koltuklar.map((koltuk, index) => koltuk.toplamYatirim >= seviye ? index : null).filter((index) => index !== null);
    const miktar = (seviye - onceki) * katkiVerenler.length;
    onceki = seviye;
    const adaylar = katkiVerenler.filter((index) => !koltuklar[index].pas);
    if (!adaylar.length || !miktar) { return; }
    const sonuc = adaylar.length === 1 ? { kazananlar: adaylar, enIyi: null } : kazananlariBul(koltuklar, masa.communityCards, adaylar);
    const pay = Math.floor(miktar / sonuc.kazananlar.length);
    let kalan = miktar % sonuc.kazananlar.length;
    sonuc.kazananlar.forEach((index) => { odemeler[index] += pay + (kalan-- > 0 ? 1 : 0); });
    potlar.push({ miktar, kazananlar: sonuc.kazananlar, el: sonuc.enIyi && sonuc.enIyi.turAdi });
  });
  koltuklar.forEach((koltuk, index) => { koltuk.masaBakiyesi += odemeler[index]; });
  return {
    ...masa, durum: 'el_sonucu', aktifKoltuk: null, aksiyonBitis: null, bekleyen: [],
    pot: potHesapla(koltuklar), koltuklar, sonuclar: { odemeler, potlar, ts: now }, guncellemeTs: now
  };
}

/** Tarayıcı/bağlantı gerçekten kesilirse aktif sırada 10 saniyelik son süre verilir. */
export function holdemBaglantiKesildi(masa, uid, now = Date.now()) {
  const index = masa.koltuklar.findIndex((koltuk) => koltuk.uid === uid && !koltuk.bot);
  if (index < 0) { return masa; }
  const koltuklar = masa.koltuklar.slice();
  koltuklar[index] = { ...koltuklar[index], bagli: false, ayrilacak: true };
  const aktifMi = index === masa.aktifKoltuk && AKTIF_DURUMLAR.has(masa.durum);
  return { ...masa, koltuklar, aksiyonBitis: aktifMi ? Math.min(masa.aksiyonBitis || Infinity, now + masa.ayarlar.cikisAksiyonSuresiMs) : masa.aksiyonBitis, guncellemeTs: now };
}
