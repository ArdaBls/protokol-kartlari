// Texas Hold'em bot karar motoru. Ağ, DOM ve cüzdandan bağımsız tutulur:
// aynı karar hem canlı masa transaction'ında hem de testte üretilebilir.
import { holdemElDegerlendir } from './holdem-engine.js';

const RUTBE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, joker: 11, kiz: 12, papaz: 13, as: 14 };
const PROFILLER = {
  sakin: { blöf: 0.035, agresiflik: 0.76, potOrani: 0.22 },
  dengeli: { blöf: 0.075, agresiflik: 1, potOrani: 0.31 },
  agresif: { blöf: 0.14, agresiflik: 1.22, potOrani: 0.42 }
};
// "Zor", mükemmel/GTO bot anlamına gelmez. Bu katman yalnız daha tutarlı
// aralık ve pot-odds kullanır; kasıtlı hata payı oyunları erişilebilir tutar.
export const HOLDEM_ZORLUKLARI = {
  kolay: { profil: 'sakin', kararTutarliligi: 0.68, etiket: 'Kolay' },
  normal: { profil: 'dengeli', kararTutarliligi: 0.82, etiket: 'Dengeli' },
  zor: { profil: 'agresif', kararTutarliligi: 0.9, etiket: 'Zor' }
};

function sinirliSayi(value, alt, ust) { return Math.max(alt, Math.min(ust, value)); }
function tamSayi(value, varsayilan) { return Number.isFinite(Number(value)) ? Math.floor(Number(value)) : varsayilan; }
function kartDegeri(kart) { return kart && RUTBE[kart.r] ? RUTBE[kart.r] : 0; }
function ayniKartMi(a, b) { return a && b && a.r === b.r && a.s === b.s; }
function sonuc(action, amount, reason, extra = {}) { return { action, amount: Math.max(0, Math.floor(amount || 0)), reason, ...extra }; }

/**
 * Gönderilen görseldeki 4x raise tablosunun programatik karşılığı.
 * always = yeşil (takımdan bağımsız), suited = sarı, never = kırmızı.
 * Çiftler matriste görünmediği için ayrı bir başlangıç kuralıyla ele alınır.
 */
export function holdemPreflop4xSinifi(kartlar) {
  if (!Array.isArray(kartlar) || kartlar.length !== 2 || !kartDegeri(kartlar[0]) || !kartDegeri(kartlar[1]) || ayniKartMi(kartlar[0], kartlar[1])) {
    throw new TypeError('Preflop sınıfı için iki farklı geçerli kart gerekir.');
  }
  const [a, b] = kartlar;
  const yüksek = Math.max(kartDegeri(a), kartDegeri(b));
  const düşük = Math.min(kartDegeri(a), kartDegeri(b));
  const suited = a.s === b.s;
  if (yüksek === düşük) {
    return { sınıf: yüksek >= 7 ? 'always' : yüksek >= 4 ? 'call' : 'never', suited, yüksek, düşük, pair: true };
  }

  let sınıf = 'never';
  if (yüksek === 14) { sınıf = 'always'; }
  else if (yüksek === 13) { sınıf = düşük >= 5 ? 'always' : düşük >= 2 ? 'suited' : 'never'; }
  else if (yüksek === 12) { sınıf = düşük >= 8 ? 'always' : düşük >= 6 ? 'suited' : 'never'; }
  else if (yüksek === 11) { sınıf = düşük >= 9 ? 'always' : düşük >= 7 ? 'suited' : 'never'; }
  else if (yüksek === 10) { sınıf = düşük >= 9 ? 'always' : düşük >= 7 ? 'suited' : 'never'; }
  else if (yüksek === 9 && düşük >= 7) { sınıf = 'suited'; }
  else if (yüksek === 8 && düşük >= 6) { sınıf = 'suited'; }
  else if (yüksek === 7 && düşük >= 5) { sınıf = 'suited'; }
  return { sınıf, suited, yüksek, düşük, pair: false };
}

/** Pozisyon çizelgelerindeki beyaz/yeşil/sarı/kırmızı alanların karşılığı. */
export function holdemPozisyonAralikSinifi(kartlar) {
  const temel = holdemPreflop4xSinifi(kartlar);
  const { yüksek, düşük, pair, suited } = temel;
  if (pair) { return { ...temel, aralik: yüksek >= 7 ? 'all_positions' : yüksek >= 4 ? 'middle_late' : 'late_only' }; }
  if (suited) {
    if ((yüksek === 14 && düşük >= 10) || (yüksek === 13 && düşük >= 11) || (yüksek === 12 && düşük >= 11)) { return { ...temel, aralik: 'all_positions' }; }
    if ((yüksek === 14 && düşük >= 5) || (yüksek === 13 && düşük >= 8) || (yüksek === 12 && düşük >= 9) || (yüksek === 11 && düşük >= 9) || (yüksek === 10 && düşük >= 9)) { return { ...temel, aralik: 'middle_late' }; }
    if ((yüksek === 14 && düşük >= 2) || (yüksek === 13 && düşük >= 5) || (yüksek - düşük <= 2 && yüksek >= 6)) { return { ...temel, aralik: 'late_only' }; }
  } else {
    if ((yüksek === 14 && düşük >= 11) || (yüksek === 13 && düşük >= 12) || (yüksek === 12 && düşük >= 12)) { return { ...temel, aralik: 'all_positions' }; }
    if ((yüksek === 14 && düşük >= 9) || (yüksek === 13 && düşük >= 10) || (yüksek === 12 && düşük >= 10) || (yüksek === 11 && düşük >= 10)) { return { ...temel, aralik: 'middle_late' }; }
    if ((yüksek === 14 && düşük >= 7) || (yüksek === 13 && düşük >= 8) || (yüksek === 12 && düşük >= 8)) { return { ...temel, aralik: 'late_only' }; }
  }
  return { ...temel, aralik: 'never' };
}

/**
 * Gönderilen 20–90 ısı haritasından türetilmiş göreli preflop güç katsayısı.
 * Bu kesin showdown equity'si değildir: rakip sayısı yükseldikçe bot aynı
 * kartla daha az özgüvenli olur. Kesin oran için her karar noktasında pahalı
 * Monte Carlo çalıştırmak yerine kararlı ve açıklanabilir bir model kullanırız.
 */
export function holdemPreflopGuvenSkoru(kartlar, activeOpponents = 1) {
  const { yüksek, düşük, pair, suited } = holdemPreflop4xSinifi(kartlar);
  let güven;
  if (pair) {
    güven = 0.5 + (yüksek - 2) / 12 * 0.38;
  } else {
    const gap = yüksek - düşük - 1;
    güven = 0.17 + (yüksek - 2) / 12 * 0.29 + (düşük - 2) / 12 * 0.14;
    if (suited) { güven += 0.045; }
    if (gap === 0) { güven += 0.045; }
    else if (gap === 1) { güven += 0.018; }
    else { güven -= Math.min(0.1, gap * 0.018); }
  }
  // Çok oyunculu potta tek başına as gibi marjinal ellerin gerçek değeri düşer.
  güven -= Math.max(0, tamSayi(activeOpponents, 1) - 1) * 0.027;
  return sinirliSayi(güven, 0.12, 0.9);
}

function pozisyonIzinli(aralik, position) {
  const p = ['early', 'middle', 'late', 'small_blind', 'big_blind'].includes(position) ? position : 'middle';
  if (aralik === 'all_positions') { return true; }
  if (aralik === 'middle_late') { return ['middle', 'late', 'small_blind', 'big_blind'].includes(p); }
  return aralik === 'late_only' && ['late', 'small_blind', 'big_blind'].includes(p);
}

// EP1 ve small blind open-shove çizelgeleri, yalnız 10 BB ve altındaki açık
// potlara uygulanır. Daha derin stack'te bot asla bu görsellere bakıp gereksiz
// all-in yapmaz; normal pozisyon/4x akışına geri döner.
function kısaStackShoveUygunMu(kartlar, position) {
  const { yüksek, düşük, pair, suited } = holdemPreflop4xSinifi(kartlar);
  if (pair) { return yüksek >= (position === 'small_blind' ? 2 : 5); }
  if (position === 'small_blind') {
    return yüksek === 14 || (yüksek === 13 && düşük >= 5) || (yüksek === 12 && düşük >= 8) || (yüksek === 11 && düşük >= 9) || (suited && yüksek - düşük <= 2 && yüksek >= 6);
  }
  // Erken pozisyonda daha dar EP1 aralığı: güçlü aslar, yüksek broadway ve
  // orta-üst çiftler. Buradaki kartlar kırmızı open-shove alanlarının özeti.
  return (yüksek === 14 && düşük >= 9) || (yüksek === 13 && düşük >= 11) || (yüksek === 12 && düşük >= 11) || (suited && yüksek === 14 && düşük >= 5);
}

export function holdemBosBotHafizasi() {
  return { eller: 0, blöfDenemesi: 0, basariliBlöf: 0, basarisizBlöf: 0, gosterimdeKazanc: 0, gosterimdeKayip: 0, rakipPasOrani: 0.5 };
}

/** Oyun sonuçlarından botun bir sonraki el riskini yumuşakça ayarlar. */
export function holdemBotHafizasiniGuncelle(eski, olay = {}) {
  const onceki = { ...holdemBosBotHafizasi(), ...(eski || {}) };
  const eller = tamSayi(onceki.eller, 0) + 1;
  const pasOrani = Number.isFinite(Number(olay.rakipPasOrani)) ? Number(olay.rakipPasOrani) : Number(onceki.rakipPasOrani);
  return {
    ...onceki,
    eller,
    blöfDenemesi: tamSayi(onceki.blöfDenemesi, 0) + (olay.blöf ? 1 : 0),
    basariliBlöf: tamSayi(onceki.basariliBlöf, 0) + (olay.blöf && olay.kazandi ? 1 : 0),
    basarisizBlöf: tamSayi(onceki.basarisizBlöf, 0) + (olay.blöf && olay.kazandi === false ? 1 : 0),
    gosterimdeKazanc: tamSayi(onceki.gosterimdeKazanc, 0) + (olay.gosterim && olay.kazandi ? 1 : 0),
    gosterimdeKayip: tamSayi(onceki.gosterimdeKayip, 0) + (olay.gosterim && olay.kazandi === false ? 1 : 0),
    rakipPasOrani: sinirliSayi(pasOrani, 0.05, 0.95)
  };
}

function profilAl(bot, hafiza) {
  const zorluk = HOLDEM_ZORLUKLARI[bot && bot.zorluk] || HOLDEM_ZORLUKLARI.normal;
  const temel = PROFILLER[bot && bot.profil] || PROFILLER[zorluk.profil] || PROFILLER.dengeli;
  const h = { ...holdemBosBotHafizasi(), ...(hafiza || {}) };
  const blöfBasarisi = h.blöfDenemesi ? (h.basariliBlöf - h.basarisizBlöf) / h.blöfDenemesi : 0;
  // Öğrenme sınırlıdır: birkaç el, botu tamamen çılgın veya pasif yapmaz.
  const blöf = sinirliSayi(temel.blöf + blöfBasarisi * 0.035 + (h.rakipPasOrani - 0.5) * 0.09, 0.01, 0.25);
  return { ...temel, blöf, hafiza: h, zorluk: bot && bot.zorluk || 'normal', kararTutarliligi: zorluk.kararTutarliligi };
}

function artirmaMiktari({ bigBlind, stack, toCall, currentBet, profil, dörtX = false }) {
  const bb = Math.max(1, tamSayi(bigBlind, 50));
  const karsilanan = Math.max(0, tamSayi(toCall, 0));
  const mevcut = Math.max(bb, tamSayi(currentBet, bb));
  const hedef = dörtX ? Math.max(bb * 4, mevcut * 2) : Math.max(mevcut + bb * 2, Math.round((mevcut + bb) * profil.agresiflik));
  return Math.min(Math.max(0, tamSayi(stack, 0)), Math.max(karsilanan, hedef));
}

/** Flop/turn/river kartlarını kuru, draw'lı veya eşleşmiş dokuya ayırır. */
export function holdemBoardDokusu(communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3 || communityCards.length > 5) {
    throw new TypeError('Board dokusu için üç ile beş ortak kart gerekir.');
  }
  const değerler = communityCards.map(kartDegeri);
  if (değerler.some((değer) => !değer)) { throw new TypeError('Board kartları geçersiz.'); }
  const rankSayisi = new Map();
  const suitSayisi = new Map();
  communityCards.forEach((kart) => {
    rankSayisi.set(kart.r, (rankSayisi.get(kart.r) || 0) + 1);
    suitSayisi.set(kart.s, (suitSayisi.get(kart.s) || 0) + 1);
  });
  const paired = [...rankSayisi.values()].some((n) => n >= 2);
  const maxSuit = Math.max(...suitSayisi.values());
  const farklı = [...new Set(değerler)].sort((a, b) => a - b);
  const bağlı = farklı.some((start) => [1, 2].some((adım) => farklı.filter((n) => n >= start && n <= start + 4).length >= 3 && adım > 0));
  // Aynı takım iki kart + bağlı değerler, draw'lı "wet" boardun ana işareti.
  const dynamic = maxSuit >= 2 && bağlı || maxSuit >= 3 || bağlı && (farklı[farklı.length - 1] - farklı[0] <= 5);
  if (paired) { return { tür: 'paired', paired, dynamic, maxSuit, bağlı }; }
  return dynamic ? { tür: 'dynamic', paired, dynamic, maxSuit, bağlı } : { tür: 'dry', paired, dynamic, maxSuit, bağlı };
}

/** Gönderilen C-bet frekansları ve boyutlarının çalıştırılabilir karşılığı. */
export function holdemCbetPlani({ communityCards, pot = 0, stack = 0, bot, memory, elGucu = 0.3, raiseCount = 0, activeOpponents = 1 } = {}, random = Math.random) {
  const doku = holdemBoardDokusu(communityCards);
  const profil = profilAl(bot, memory);
  const temel = doku.tür === 'paired' && !doku.dynamic ? { frekans: 0.82, boyut: 0.25 } : doku.tür === 'dynamic' ? { frekans: 0.4, boyut: 0.72 } : { frekans: 0.75, boyut: 0.3 };
  const korku = holdemBotRiskAlgisi({ pot, toCall: 0, stack, raiseCount, activeOpponents, elGucu, memory: profil.hafiza, profil: bot && bot.profil });
  // Güçlü hazır el frekansı yükseltir; dinamik boardda ise boyutu korur.
  const cokluMasaCezasi = Math.max(0, tamSayi(activeOpponents, 1) - 2) * 0.075;
  const frekans = sinirliSayi(temel.frekans * profil.agresiflik + (elGucu - 0.35) * 0.2 - korku * 0.12 - cokluMasaCezasi, 0.12, 0.96);
  const miktar = Math.min(Math.max(0, tamSayi(stack, 0)), Math.max(1, Math.round(Math.max(1, Number(pot)) * temel.boyut)));
  const bahis = random() < frekans;
  const neden = doku.tür === 'dry' ? 'Kuru boardda küçük C-bet' : doku.tür === 'paired' ? 'Eşleşmiş boardda çok küçük C-bet' : 'Draw’lı boardda seçici ve büyük C-bet';
  return { bahis, frekans, potOrani: temel.boyut, miktar, doku, korku, neden };
}

/** Outs tablosundaki yaklaşık equity; `ikiKart` flop→river, aksi tek karttır. */
export function holdemOutsEquity(outs, ikiKart = false, street = 'turn') {
  const n = sinirliSayi(tamSayi(outs, 0), 0, 20);
  // Tablo değerlerine yakın, kombinatorik olasılık: turn/riverda en az bir out.
  const tekKart = n ? n / (street === 'flop' ? 47 : 46) : 0;
  const ikiKartEquity = n ? 1 - (47 - n) / 47 * (46 - n) / 46 : 0;
  return ikiKart ? ikiKartEquity : tekKart;
}

/** Bir bahsi görmek için gereken minimum equity (pot odds) hesabı. */
export function holdemGerekliEquity(pot, toCall) {
  const p = Math.max(0, Number(pot) || 0);
  const c = Math.max(0, Number(toCall) || 0);
  return c ? c / Math.max(1, p + c) : 0;
}

function cekisBilgisi(kartlar) {
  const suitSayisi = new Map();
  const değerler = new Set();
  kartlar.forEach((k) => {
    suitSayisi.set(k.s, (suitSayisi.get(k.s) || 0) + 1);
    değerler.add(kartDegeri(k));
  });
  const renkCekisi = [...suitSayisi.values()].some((n) => n === 4);
  const kentHedefleri = new Set();
  const değerKopya = new Set(değerler);
  if (değerKopya.has(14)) { değerKopya.add(1); }
  for (let başlangıç = 1; başlangıç <= 10; başlangıç++) {
    const dizi = [başlangıç, başlangıç + 1, başlangıç + 2, başlangıç + 3, başlangıç + 4];
    const eksik = dizi.filter((değer) => !değerKopya.has(değer));
    if (eksik.length === 1 && dizi.filter((değer) => değerKopya.has(değer)).length === 4) { kentHedefleri.add(eksik[0] === 1 ? 14 : eksik[0]); }
  }
  const kentOuts = kentHedefleri.size * 4;
  const kentCekisi = kentOuts > 0;
  const renkOuts = renkCekisi ? 9 : 0;
  // Kombine drawlarda bazı kartlar iki çekişi de tamamlar; 15 out üst sınırı
  // bu ortak kartların iki kez sayılmasını muhafazakâr biçimde engeller.
  const outs = Math.min(15, renkOuts + kentOuts);
  return { renkCekisi, kentCekisi, outs, kentOuts, renkOuts };
}

function ikinciMermiUygunMu(options, el, çekiş) {
  if (options.communityCards.length !== 4 || !options.cbetYapti || !options.wasPreflopAggressor) { return false; }
  const flop = options.communityCards.slice(0, 3).map(kartDegeri);
  const turn = kartDegeri(options.communityCards[3]);
  const turnOvercard = turn > Math.max(...flop) && turn >= 11;
  const eldeTurnEslesmesi = options.holeCards.some((kart) => kartDegeri(kart) === turn);
  return turnOvercard || eldeTurnEslesmesi || çekiş.renkCekisi || çekiş.kentCekisi || el.siralama >= 2;
}

function riverBlockerBlöfüUygunMu(options, el) {
  if (options.communityCards.length !== 5 || options.toCall !== 0 || el.siralama >= 2) { return false; }
  const suitSayisi = new Map();
  options.communityCards.forEach((kart) => suitSayisi.set(kart.s, (suitSayisi.get(kart.s) || 0) + 1));
  return options.holeCards.some((kart) => kart.r === 'as' && (suitSayisi.get(kart.s) || 0) >= 3);
}

function elGuveni(el, çekiş) {
  // Kombinasyon yükseldikçe stratejiyi kullanma (bahis/görme) isteği artar.
  // Çekiş, hazır bir el kadar güçlü değildir fakat insanın "bir kart daha"
  // diye görme eğilimini küçük ve sınırlı biçimde artırır.
  const temel = [0.08, 0.29, 0.53, 0.7, 0.78, 0.84, 0.9, 0.95, 0.985][el.siralama] || 0.08;
  return sinirliSayi(temel + (çekiş.renkCekisi ? 0.12 : 0) + (çekiş.kentCekisi ? 0.1 : 0), 0.02, 0.99);
}

/**
 * İnsan benzeri risk algısı: büyük pot ve pahalı görme zayıf elleri korkutur;
 * güçlü kombinasyonlar bu korkuyu azaltır. Değer 0 (rahat) ile 1 (pas eşiği)
 * arasındadır ve arayüzde/debug kaydında da gösterilebilir.
 */
export function holdemBotRiskAlgisi({ pot = 0, toCall = 0, stack = 0, raiseCount = 0, activeOpponents = 1, elGucu = 0, memory, profil = 'dengeli' } = {}) {
  const p = PROFILLER[profil] || PROFILLER.dengeli;
  const h = { ...holdemBosBotHafizasi(), ...(memory || {}) };
  const güvenliStack = Math.max(1, tamSayi(stack, 0));
  const potBaskisi = sinirliSayi(Number(pot) / güvenliStack, 0, 2);
  const görmeBaskisi = sinirliSayi(Number(toCall) / güvenliStack, 0, 1);
  const masaBaskisi = sinirliSayi(tamSayi(raiseCount, 0) * 0.07 + Math.max(0, tamSayi(activeOpponents, 1) - 2) * 0.025, 0, 0.28);
  const kötüBlöfEtkisi = h.blöfDenemesi ? Math.max(0, h.basarisizBlöf - h.basariliBlöf) / h.blöfDenemesi * 0.1 : 0;
  const cesaret = (p.agresiflik - 1) * 0.14 + (Number(h.rakipPasOrani) - 0.5) * 0.08;
  const korku = 0.08 + potBaskisi * 0.2 + görmeBaskisi * 0.5 + masaBaskisi + kötüBlöfEtkisi - Number(elGucu) * 0.62 - cesaret;
  return sinirliSayi(korku, 0, 0.96);
}

function postflopKarari(options, profil, random) {
  const { holeCards, communityCards, toCall, bigBlind, currentBet, stack, pot, raiseCount = 0, bluffCount = 0 } = options;
  const kartlar = holeCards.concat(communityCards);
  const el = holdemElDegerlendir(kartlar);
  const potOrani = toCall > 0 ? toCall / Math.max(1, pot + toCall) : 0;
  const çekiş = cekisBilgisi(kartlar);
  const güven = elGuveni(el, çekiş);
  const korku = holdemBotRiskAlgisi({ ...options, elGucu: güven, memory: profil.hafiza, profil: options.bot && options.bot.profil });
  const sokak = communityCards.length === 3 ? 'flop' : communityCards.length === 4 ? 'turn' : 'river';
  if (sokak === 'flop' && options.wasPreflopAggressor && toCall === 0) {
    const cbet = holdemCbetPlani({ ...options, elGucu: güven, memory: profil.hafiza }, random);
    if (cbet.bahis) {
      return sonuc('bet', cbet.miktar, cbet.neden, { el, isBluff: el.siralama === 0, güven, korku: cbet.korku, stratejiKullanimi: cbet.frekans, cbet });
    }
  }
  if (sokak === 'turn' && toCall === 0 && ikinciMermiUygunMu(options, el, çekiş)) {
    const doku = holdemBoardDokusu(communityCards);
    const ihtimal = sinirliSayi(güven * 0.65 * profil.agresiflik + (çekiş.outs ? 0.12 : 0) - korku * 0.2, 0.12, 0.88);
    if (random() < ihtimal) {
      const boyut = doku.tür === 'dynamic' ? 0.7 : 0.55;
      const miktar = Math.min(stack, Math.max(bigBlind, Math.round(Math.max(1, pot) * boyut)));
      return sonuc('bet', miktar, 'Turn kartı ikinci mermi için uygun', { el, isBluff: el.siralama === 0, güven, korku, stratejiKullanimi: ihtimal, potOrani: boyut });
    }
  }
  if (sokak === 'river' && riverBlockerBlöfüUygunMu(options, el) && bluffCount < 2) {
    const ihtimal = sinirliSayi(profil.blöf * 1.8 * (1 - korku), 0.04, 0.32);
    if (random() < ihtimal) {
      const miktar = Math.min(stack, Math.max(bigBlind, Math.round(Math.max(1, pot) * 0.72)));
      return sonuc('bet', miktar, 'River’da nut flush blocker ile seçici blöf', { el, isBluff: true, güven, korku, stratejiKullanimi: ihtimal, potOrani: 0.72 });
    }
  }
  const artırmaİhtimali = sinirliSayi(güven * 0.68 * profil.agresiflik - korku * 0.24, 0.02, 0.93);
  const görmeİhtimali = sinirliSayi(güven * 0.84 + (çekiş.renkCekisi || çekiş.kentCekisi ? 0.12 : 0) - korku * 0.42, 0.03, 0.98);
  const çokGüçlü = el.siralama >= 3;
  if ((çokGüçlü && random() < Math.max(0.62, artırmaİhtimali)) || (el.siralama >= 2 && random() < artırmaİhtimali)) {
    return sonuc('raise', artirmaMiktari({ bigBlind, stack, toCall, currentBet, profil }), el.turAdi + ' ile değer artırması', { el, isBluff: false, güven, korku, stratejiKullanimi: artırmaİhtimali });
  }
  if (toCall === 0) {
    if (güven >= 0.44 || çekiş.renkCekisi || çekiş.kentCekisi) {
      return sonuc('check', 0, çekiş.renkCekisi || çekiş.kentCekisi ? 'Çekişi ücretsiz görme' : 'Kombinasyon pot kontrolü', { el, isBluff: false, güven, korku, stratejiKullanimi: görmeİhtimali });
    }
  } else {
    const drawEquity = holdemOutsEquity(çekiş.outs, sokak === 'flop');
    const gerekliEquity = holdemGerekliEquity(pot, toCall);
    const görmeIcinYeterli = Math.max(drawEquity, güven * 0.52) >= gerekliEquity;
    if ((potOrani <= profil.potOrani || görmeIcinYeterli) && random() < görmeİhtimali) {
      return sonuc('call', toCall, görmeIcinYeterli && çekiş.outs ? 'Outs equity pot odds için yeterli' : 'El gücü, pot oranı ve risk eşiği görmeye uygun', { el, isBluff: false, güven, korku, stratejiKullanimi: görmeİhtimali, drawEquity, gerekliEquity });
    }
  }
  const blöfİhtimali = sinirliSayi(profil.blöf * (1 - korku) * (1 - güven * 0.55), 0, 0.2);
  const blöfUygun = toCall === 0 && raiseCount < 2 && bluffCount < 2 && random() < blöfİhtimali;
  if (blöfUygun) {
    return sonuc('raise', artirmaMiktari({ bigBlind, stack, toCall: 0, currentBet, profil }), 'Rakip pas eğilimine karşı kontrollü blöf', { el, isBluff: true, güven, korku, stratejiKullanimi: blöfİhtimali });
  }
  return toCall === 0 ? sonuc('check', 0, 'Gösterim değerini korumak için kontrol', { el, isBluff: false, güven, korku, stratejiKullanimi: görmeİhtimali }) : sonuc('fold', 0, korku >= 0.5 ? 'Büyük pot ve görme bedeli botu pas geçmeye itti' : 'El gücü ve pot oranı yetersiz', { el, isBluff: false, güven, korku, stratejiKullanimi: görmeİhtimali });
}

/**
 * Botun tek karar noktası. `random` parametresi testlerde deterministik,
 * canlı masada varsayılan Math.random olabilir. Bot yalnız kendi iki kartını
 * ve açık ortak kartları alır; insan oyuncunun kapalı kartlarına erişemez.
 */
export function holdemBotAksiyonSec(options = {}, random = Math.random) {
  const holeCards = Array.isArray(options.holeCards) ? options.holeCards : [];
  const communityCards = Array.isArray(options.communityCards) ? options.communityCards : [];
  if (holeCards.length !== 2 || communityCards.length > 5) { throw new TypeError('Bot kararı için iki kapalı ve en fazla beş ortak kart gerekir.'); }
  const profil = profilAl(options.bot, options.memory);
  const toCall = Math.max(0, tamSayi(options.toCall, 0));
  const bigBlind = Math.max(1, tamSayi(options.bigBlind, 50));
  const stack = Math.max(0, tamSayi(options.stack, 0));
  if (stack < toCall) { return sonuc('fold', 0, 'Karşılanacak bahis desteyi aşıyor', { isBluff: false }); }
  if (communityCards.length >= 3) {
    return postflopKarari({ ...options, holeCards, communityCards, toCall, bigBlind, stack }, profil, random);
  }

  const sinif = holdemPozisyonAralikSinifi(holeCards);
  const position = options.position || 'middle';
  const actionContext = ['unopened', 'limped', 'facing_open', 'facing_3bet'].includes(options.actionContext) ? options.actionContext : 'unopened';
  const stackBb = stack / bigBlind;
  const açıkPot = toCall <= bigBlind;
  const güven = holdemPreflopGuvenSkoru(holeCards, options.activeOpponents);
  const korku = holdemBotRiskAlgisi({ ...options, elGucu: güven, memory: profil.hafiza, profil: options.bot && options.bot.profil });
  if (stackBb <= 10 && açıkPot && ['unopened', 'limped'].includes(actionContext) && kısaStackShoveUygunMu(holeCards, position)) {
    const shoveİhtimali = sinirliSayi(0.48 + güven * 0.48 - korku * 0.16, 0.45, 0.9);
    if (random() < shoveİhtimali) {
      return sonuc('all_in', stack, position === 'small_blind' ? 'Kısa stack small blind shove çizelgesi' : 'Kısa stack erken pozisyon shove çizelgesi', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: shoveİhtimali });
    }
  }
  const pozisyonUygun = pozisyonIzinli(sinif.aralik, position);
  const açılışEli = pozisyonUygun && (sinif.sınıf === 'always' || (sinif.sınıf === 'suited' && sinif.suited));
  // 4x tablo genel açılış standardı değildir. Normal açık potta 2.2BB,
  // limper izolasyonunda veya masanın özel kuralında seçili 4x kullanılır.
  const dörtX = açılışEli && (actionContext === 'limped' || options.forceFourX === true);
  const artırmaİhtimali = sinirliSayi(güven * 0.76 * profil.agresiflik - korku * 0.2, 0.03, 0.94);
  if (açılışEli && ['unopened', 'limped'].includes(actionContext) && random() < artırmaİhtimali) {
    const miktar = dörtX ? artirmaMiktari({ bigBlind, stack, toCall, currentBet: options.currentBet, profil, dörtX: true }) : Math.min(stack, Math.max(bigBlind * 2, Math.round(bigBlind * 2.2)));
    const neden = dörtX ? (sinif.pair ? 'Güçlü çiftle 4x izolasyon artırması' : 'Limper karşısında 4x strateji matrisi') : 'Pozisyona uygun standart 2.2BB açılış';
    return sonuc('raise', miktar, neden, { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: artırmaİhtimali, actionContext });
  }
  if (pozisyonUygun || sinif.sınıf === 'call' || (sinif.sınıf === 'suited' && !sinif.suited)) {
    const görmeİhtimali = sinirliSayi(güven * 0.9 - korku * 0.34, 0.05, 0.96);
    if (toCall === 0 || random() < görmeİhtimali) {
      return toCall === 0 ? sonuc('check', 0, 'Pozisyona uygun marjinal eli ücretsiz görme', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: görmeİhtimali }) : sonuc('call', toCall, 'Pozisyon, el gücü ve pot korkusu görmeye uygun', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: görmeİhtimali });
    }
  }
  const blöfUygun = toCall === 0 && options.raiseCount < 2 && options.bluffCount < 2 && random() < profil.blöf;
  if (blöfUygun) {
    return sonuc('raise', artirmaMiktari({ bigBlind, stack, toCall: 0, currentBet: options.currentBet, profil }), 'Preflop pozisyon blöfü', { preflop: sinif, isBluff: true });
  }
  // Masa oyunu yalnız dar bir chart ezberi gibi görünmesin: kötü eller de
  // küçük kör bahis bedelinde zaman zaman limp/call ile flop görür. Oran
  // düşük tutulur; pahalı bahis ya da yükseltilmiş potta bu istisna çalışmaz.
  const gevsekGormeIhtimali = sinirliSayi(0.16 + profil.blöf * 0.65 + (position === 'late' ? 0.1 : 0) - korku * 0.16, 0.08, 0.3);
  if (toCall > 0 && toCall <= bigBlind && random() < gevsekGormeIhtimali) {
    return sonuc('call', toCall, 'Ucuz kör bahiste zayıf eli de flopta deniyor', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: gevsekGormeIhtimali });
  }
  return toCall === 0 ? sonuc('check', 0, 'Zayıf eli kontrol etme', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: artırmaİhtimali }) : sonuc('fold', 0, korku >= 0.5 ? 'Büyük pot ve görme bedeli botu preflop pasına itti' : 'Pozisyon ve preflop strateji matrisi pas öneriyor', { preflop: sinif, isBluff: false, stackBb, güven, korku, stratejiKullanimi: artırmaİhtimali });
}
