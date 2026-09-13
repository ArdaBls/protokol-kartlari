// Bot stratejisi: chart sınıfları, pozisyon, korku ve kombinasyon ağırlıkları.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'holdem-bot-strateji.js')).href;
  const mod = await import(url);
  const k = (r, s) => ({ r, s });
  const sonuc = {};

  const a2 = mod.holdemPreflop4xSinifi([k('as', 'kupa'), k('2', 'sinek')]);
  const k3s = mod.holdemPreflop4xSinifi([k('papaz', 'kupa'), k('3', 'kupa')]);
  const q4o = mod.holdemPreflop4xSinifi([k('kiz', 'kupa'), k('4', 'sinek')]);
  sonuc.dortXTablosu = a2.sınıf === 'always' && k3s.sınıf === 'suited' && q4o.sınıf === 'never';

  const aks = (ek = {}, random = () => 0) => mod.holdemBotAksiyonSec({
    bot: { profil: 'dengeli' }, holeCards: [k('as', 'kupa'), k('papaz', 'kupa')], communityCards: [],
    bigBlind: 50, currentBet: 50, stack: 1000, pot: 75, toCall: 50, position: 'late', activeOpponents: 4, ...ek
  }, random);
  sonuc.gucluElArtirir = aks().action === 'raise';
  sonuc.normalVeDortXAcis = aks({ actionContext: 'unopened' }).amount === 110 && aks({ actionContext: 'limped' }).amount >= 200;
  sonuc.kisaStackShove = aks({ stack: 400, toCall: 0, position: 'early' }).action === 'all_in';
  sonuc.zayifErkenElPas = mod.holdemBotAksiyonSec({
    bot: { profil: 'sakin' }, holeCards: [k('7', 'kupa'), k('2', 'sinek')], communityCards: [], bigBlind: 50,
    currentBet: 100, stack: 1000, pot: 150, toCall: 100, position: 'early', activeOpponents: 4
  }, () => 0.99).action === 'fold';

  const aa = mod.holdemPreflopGuvenSkoru([k('as', 'kupa'), k('as', 'sinek')], 1);
  const yediIki = mod.holdemPreflopGuvenSkoru([k('7', 'kupa'), k('2', 'sinek')], 4);
  sonuc.isiHaritasiGuveni = aa > yediIki && aa >= 0.8 && yediIki < 0.3;
  const küçükPotKorku = mod.holdemBotRiskAlgisi({ pot: 100, toCall: 25, stack: 1000, elGucu: 0.3, profil: 'dengeli' });
  const buyukPotKorku = mod.holdemBotRiskAlgisi({ pot: 1800, toCall: 500, stack: 1000, elGucu: 0.3, raiseCount: 2, profil: 'sakin' });
  sonuc.buyukPotKorkutur = buyukPotKorku > küçükPotKorku;

  const kuruCbet = mod.holdemCbetPlani({ communityCards: [k('as', 'kupa'), k('8', 'karo'), k('2', 'sinek')], pot: 100, stack: 1000, bot: { profil: 'dengeli' }, activeOpponents: 1 }, () => 0);
  const drawliCbet = mod.holdemCbetPlani({ communityCards: [k('joker', 'kupa'), k('10', 'kupa'), k('9', 'sinek')], pot: 100, stack: 1000, bot: { profil: 'dengeli' }, activeOpponents: 1 }, () => 0.99);
  const pairedCbet = mod.holdemCbetPlani({ communityCards: [k('4', 'kupa'), k('4', 'karo'), k('9', 'sinek')], pot: 100, stack: 1000, bot: { profil: 'dengeli' }, activeOpponents: 1 }, () => 0);
  sonuc.cbetDokusu = kuruCbet.bahis && kuruCbet.potOrani === 0.3 && !drawliCbet.bahis && drawliCbet.potOrani === 0.72 && pairedCbet.bahis && pairedCbet.potOrani === 0.25;
  const tekliMasa = mod.holdemCbetPlani({ communityCards: [k('as', 'kupa'), k('8', 'karo'), k('2', 'sinek')], pot: 100, stack: 1000, activeOpponents: 1 });
  const cokluMasa = mod.holdemCbetPlani({ communityCards: [k('as', 'kupa'), k('8', 'karo'), k('2', 'sinek')], pot: 100, stack: 1000, activeOpponents: 4 });
  sonuc.cokluPotCbetAzaltir = cokluMasa.frekans < tekliMasa.frekans;
  sonuc.outsVePotOdds = Math.abs(mod.holdemOutsEquity(9, true) - 0.35) < 0.01 && Math.abs(mod.holdemGerekliEquity(5, 1) - 1 / 6) < 0.001;

  const güçlüPostflop = mod.holdemBotAksiyonSec({
    bot: { profil: 'dengeli' }, holeCards: [k('as', 'kupa'), k('as', 'sinek')],
    communityCards: [k('as', 'karo'), k('8', 'kupa'), k('3', 'sinek')], bigBlind: 50, currentBet: 50,
    stack: 1000, pot: 200, toCall: 50, activeOpponents: 3
  }, () => 0).action;
  sonuc.kombinasyonKullanimi = güçlüPostflop === 'raise';
  const turnIkinciMermi = mod.holdemBotAksiyonSec({
    bot: { profil: 'dengeli' }, holeCards: [k('as', 'kupa'), k('papaz', 'sinek')],
    communityCards: [k('kiz', 'karo'), k('8', 'kupa'), k('3', 'sinek'), k('as', 'karo')], bigBlind: 50, currentBet: 50,
    stack: 1000, pot: 200, toCall: 0, wasPreflopAggressor: true, cbetYapti: true, activeOpponents: 2
  }, () => 0).action;
  sonuc.turnIkinciMermi = turnIkinciMermi === 'bet';
  const riverBlocker = mod.holdemBotAksiyonSec({
    bot: { profil: 'agresif' }, holeCards: [k('as', 'kupa'), k('2', 'sinek')],
    communityCards: [k('papaz', 'kupa'), k('10', 'kupa'), k('4', 'kupa'), k('9', 'karo'), k('3', 'sinek')], bigBlind: 50,
    currentBet: 50, stack: 1000, pot: 200, toCall: 0, activeOpponents: 1
  }, () => 0).action;
  sonuc.riverBlockerBlofu = riverBlocker === 'bet';

  const hafiza = mod.holdemBotHafizasiniGuncelle(mod.holdemBosBotHafizasi(), { blöf: true, kazandi: false, rakipPasOrani: 0.2 });
  sonuc.hafizaBlufuAzaltir = hafiza.basarisizBlöf === 1 && hafiza.rakipPasOrani === 0.2;

  Object.entries(sonuc).forEach(([ad, geçti]) => assert.equal(geçti, true, ad));
  console.log(JSON.stringify(sonuc, null, 2));
  console.log('ALL_TESTS_PASSED: true');
})().catch((error) => { console.error(error); process.exitCode = 1; });
