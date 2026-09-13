// Texas Hold'em saf kural motoru testi -- DOM/Firebase yok.
const path = require('path');
const { pathToFileURL } = require('url');

const k = (r, s) => ({ r, s });
const kupa = 'kupa'; const sinek = 'sinek'; const karo = 'karo'; const maca = 'maca';

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'holdem-engine.js')).href);
  const { holdemDestesiOlustur, holdemDesteyiKaris, holdemElDegerlendir, holdemElleriniKarsilastir } = mod;
  const sonuc = {};
  const tur = (ad, kartlar) => { sonuc[ad] = holdemElDegerlendir(kartlar).tur; };

  // Standart 52: dört takımda 13 rütbe, joker yok.
  const deste = holdemDestesiOlustur();
  sonuc.deste52Kart = deste.length === 52 && new Set(deste.map((x) => `${x.r}-${x.s}`)).size === 52;
  sonuc.desteJokerIcermez = !deste.some((x) => x.r === 'bonus_joker');
  const karisik = holdemDesteyiKaris(deste, () => 0);
  sonuc.karistirmaPermutasyon = karisik.length === 52 && new Set(karisik.map((x) => `${x.r}-${x.s}`)).size === 52 && karisik !== deste;

  tur('royalFlush', [k('10', kupa), k('joker', kupa), k('kiz', kupa), k('papaz', kupa), k('as', kupa)]);
  tur('straightFlush', [k('5', maca), k('6', maca), k('7', maca), k('8', maca), k('9', maca)]);
  tur('kare', [k('as', kupa), k('as', sinek), k('as', karo), k('as', maca), k('2', kupa)]);
  tur('full', [k('papaz', kupa), k('papaz', sinek), k('papaz', karo), k('2', maca), k('2', kupa)]);
  tur('renk', [k('as', karo), k('joker', karo), k('8', karo), k('5', karo), k('2', karo)]);
  tur('kent', [k('5', kupa), k('6', sinek), k('7', karo), k('8', maca), k('9', kupa)]);
  tur('tekerlekKent', [k('as', kupa), k('2', sinek), k('3', karo), k('4', maca), k('5', kupa)]);
  tur('uclu', [k('8', kupa), k('8', sinek), k('8', karo), k('as', maca), k('2', kupa)]);
  tur('ikiCift', [k('papaz', kupa), k('papaz', sinek), k('5', karo), k('5', maca), k('as', kupa)]);
  tur('cift', [k('kiz', kupa), k('kiz', sinek), k('as', karo), k('8', maca), k('2', kupa)]);
  tur('yuksekKart', [k('as', kupa), k('joker', sinek), k('8', karo), k('5', maca), k('2', kupa)]);
  Object.assign(sonuc, {
    royalFlush: sonuc.royalFlush === 'royal_flush', straightFlush: sonuc.straightFlush === 'straight_flush', kare: sonuc.kare === 'four_of_a_kind',
    full: sonuc.full === 'full_house', renk: sonuc.renk === 'flush', kent: sonuc.kent === 'straight', tekerlekKent: sonuc.tekerlekKent === 'straight',
    uclu: sonuc.uclu === 'three_of_a_kind', ikiCift: sonuc.ikiCift === 'two_pair', cift: sonuc.cift === 'pair', yuksekKart: sonuc.yuksekKart === 'high_card'
  });

  // Eşitlik bozma: çiftin, sonra kicker'ın; kentte ise en yüksek kartın önemi.
  sonuc.ciftTieBreak = holdemElleriniKarsilastir([k('as', kupa), k('as', sinek), k('papaz', karo), k('5', maca), k('2', kupa)], [k('papaz', kupa), k('papaz', sinek), k('as', karo), k('5', maca), k('2', kupa)]) > 0;
  sonuc.kickerTieBreak = holdemElleriniKarsilastir([k('as', kupa), k('as', sinek), k('papaz', karo), k('5', maca), k('2', kupa)], [k('as', karo), k('as', maca), k('kiz', karo), k('5', sinek), k('2', karo)]) > 0;
  sonuc.tekerlekAltinciKenttenDusuk = holdemElleriniKarsilastir([k('as', kupa), k('2', sinek), k('3', karo), k('4', maca), k('5', kupa)], [k('2', karo), k('3', kupa), k('4', sinek), k('5', karo), k('6', maca)]) < 0;
  sonuc.besKartBerabere = holdemElleriniKarsilastir([k('as', kupa), k('papaz', sinek), k('8', karo), k('5', maca), k('2', kupa)], [k('as', sinek), k('papaz', karo), k('8', maca), k('5', kupa), k('2', sinek)]) === 0;

  // Yedi kart arasındaki en güçlü beşliyi seçmelidir; burada çift yerine renk kazanır.
  const yedi = holdemElDegerlendir([k('as', kupa), k('as', sinek), k('joker', karo), k('9', karo), k('7', karo), k('4', karo), k('2', karo)]);
  sonuc.yediKarttanEnIyiBesli = yedi.tur === 'flush' && yedi.kartlar.length === 5 && yedi.esKirma[0] === 11;

  console.log(JSON.stringify(sonuc, null, 2));
  const hatalar = Object.keys(sonuc).filter((ad) => sonuc[ad] !== true);
  console.log('ALL_TESTS_PASSED: ' + (hatalar.length === 0));
  if (hatalar.length) { console.log('FAILS: ' + hatalar.join(', ')); process.exit(1); }
})();
