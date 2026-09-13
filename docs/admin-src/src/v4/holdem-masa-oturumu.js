// Paylaşımlı Hold'em masa durumunun saf çekirdeği. Kart sırası, masa hafızası
// ve bot hafızası burada tutulur; DOM/Firebase katmanı yalnız bu nesneyi
// transaction ile saklayıp ekrana çizer.
import { holdemYeniDeste } from './holdem-engine.js';
import { holdemBosBotHafizasi, holdemBotHafizasiniGuncelle } from './holdem-bot-strateji.js';

export const HOLDEM_MAKSIMUM_OYUNCU = 5;
const HAFIZA_GECMISI_LIMITI = 30;

function temizOyuncular(oyuncular) {
  if (!Array.isArray(oyuncular) || oyuncular.length < 2 || oyuncular.length > HOLDEM_MAKSIMUM_OYUNCU) {
    throw new RangeError('Hold’em masasında iki ile beş oyuncu olmalı.');
  }
  const ids = new Set();
  return oyuncular.map((oyuncu, slot) => {
    const id = String(oyuncu && oyuncu.id || 'slot-' + slot);
    if (ids.has(id)) { throw new TypeError('Masa oyuncu kimlikleri tekil olmalı.'); }
    ids.add(id);
    return { id, slot, bot: oyuncu && oyuncu.bot === true, zorluk: oyuncu && oyuncu.zorluk || 'normal', bakiye: Math.max(0, Number(oyuncu && oyuncu.bakiye) || 0) };
  });
}

export function holdemBosMasaHafizasi(oyuncular = []) {
  const botlar = {};
  oyuncular.filter((oyuncu) => oyuncu.bot).forEach((oyuncu) => { botlar[oyuncu.id] = holdemBosBotHafizasi(); });
  return { surum: 1, elSayisi: 0, botlar, oyuncuEgilimleri: {}, sonAksiyonlar: [] };
}

/** Gizli kart tutmadan yalnız aksiyon eğilimlerini masa boyunca saklar. */
export function holdemMasaHafizaOlayKaydet(eski, olay = {}) {
  const hafiza = { ...holdemBosMasaHafizasi(), ...(eski || {}) };
  const botlar = { ...(hafiza.botlar || {}) };
  const egilimler = { ...(hafiza.oyuncuEgilimleri || {}) };
  const oyuncuId = olay.oyuncuId ? String(olay.oyuncuId) : '';
  if (olay.botId) { botlar[olay.botId] = holdemBotHafizasiniGuncelle(botlar[olay.botId], olay); }
  if (oyuncuId) {
    const önceki = { toplam: 0, pas: 0, gör: 0, artır: 0, blöfePas: 0, ...egilimler[oyuncuId] };
    const aksiyon = olay.aksiyon;
    egilimler[oyuncuId] = {
      toplam: önceki.toplam + 1,
      pas: önceki.pas + (aksiyon === 'fold' ? 1 : 0),
      gör: önceki.gör + (aksiyon === 'call' ? 1 : 0),
      artır: önceki.artır + (aksiyon === 'raise' || aksiyon === 'bet' ? 1 : 0),
      blöfePas: önceki.blöfePas + (olay.blöfePas ? 1 : 0)
    };
  }
  const özet = { elNo: Number(olay.elNo) || 0, oyuncuId, botId: olay.botId || null, aksiyon: olay.aksiyon || null, blöf: olay.blöf === true, ts: Number(olay.ts) || Date.now() };
  return { ...hafiza, botlar, oyuncuEgilimleri: egilimler, sonAksiyonlar: (hafiza.sonAksiyonlar || []).concat([özet]).slice(-HAFIZA_GECMISI_LIMITI) };
}

function kartDagit(paket, oyuncular) {
  const eller = Object.fromEntries(oyuncular.map((oyuncu) => [oyuncu.id, []]));
  let desteIndex = 0;
  // Gerçek dağıtım sırası: birinci tur herkes, ikinci tur herkes.
  for (let tur = 0; tur < 2; tur++) {
    oyuncular.forEach((oyuncu) => { eller[oyuncu.id].push(paket.kartlar[desteIndex++]); });
  }
  return { eller, desteIndex };
}

/** Yeni el, her çağrıda farklı 52'lik deste paketi ve yeni kapalı kartlar üretir. */
export function holdemYeniMasaEli({ masaId = 'ana-masa', oyuncular, oncekiEl = null, random } = {}) {
  const temiz = temizOyuncular(oyuncular);
  const paket = holdemYeniDeste(random);
  const dağıtım = kartDagit(paket, temiz);
  const eskiHafiza = oncekiEl && oncekiEl.hafiza;
  const hafiza = { ...holdemBosMasaHafizasi(temiz), ...(eskiHafiza || {}) };
  return {
    masaId, elNo: (oncekiEl && Number(oncekiEl.elNo) || 0) + 1,
    desteId: paket.desteId, deste: paket.kartlar, desteIndex: dağıtım.desteIndex,
    oyuncular: temiz, eller: dağıtım.eller, ortakKartlar: [], yakilanKartlar: [], durum: 'preflop',
    hafiza: { ...hafiza, elSayisi: (hafiza.elSayisi || 0) + 1 }
  };
}

/** Burn-card kuralıyla sıradaki sokak kartlarını açar; kart yeniden kullanılmaz. */
export function holdemSonrakiSokagiAc(el) {
  if (!el || !Array.isArray(el.deste) || !['preflop', 'flop', 'turn'].includes(el.durum)) {
    throw new TypeError('Sokak açmak için geçerli, tamamlanmamış bir el gerekir.');
  }
  const kartSayisi = el.durum === 'preflop' ? 3 : 1;
  const başlangıç = el.desteIndex;
  const yakilan = el.deste[başlangıç];
  const açık = el.deste.slice(başlangıç + 1, başlangıç + 1 + kartSayisi);
  if (!yakilan || açık.length !== kartSayisi) { throw new RangeError('Deste yeni sokak için yetersiz.'); }
  return {
    ...el,
    desteIndex: başlangıç + 1 + kartSayisi,
    yakilanKartlar: (el.yakilanKartlar || []).concat([yakilan]),
    ortakKartlar: (el.ortakKartlar || []).concat(açık),
    durum: el.durum === 'preflop' ? 'flop' : el.durum === 'flop' ? 'turn' : 'river'
  };
}
