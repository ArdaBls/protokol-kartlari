// Benzersiz deste, burn-card dağıtımı ve masa hafızası testi.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'docs', 'admin-src', 'src', 'v4', 'holdem-masa-oturumu.js')).href;
  const mod = await import(url);
  const oyuncular = [
    { id: 'bot-1', bot: true, zorluk: 'kolay', bakiye: 1000 }, { id: 'bot-2', bot: true, zorluk: 'normal', bakiye: 1000 },
    { id: 'oyuncu', bot: false, bakiye: 1000 }, { id: 'bot-3', bot: true, zorluk: 'zor', bakiye: 1000 }, { id: 'bot-4', bot: true, bakiye: 1000 }
  ];
  const ilk = mod.holdemYeniMasaEli({ oyuncular });
  const ikinci = mod.holdemYeniMasaEli({ oyuncular, oncekiEl: ilk });
  const sonuc = {};
  sonuc.besOyuncu = ilk.oyuncular.length === 5 && Object.values(ilk.eller).every((el) => el.length === 2);
  sonuc.benzersizDeste = ilk.deste.length === 52 && new Set(ilk.deste.map((kart) => kart.r + '-' + kart.s)).size === 52 && ilk.desteId !== ikinci.desteId;
  let sokak = mod.holdemSonrakiSokagiAc(ilk);
  sokak = mod.holdemSonrakiSokagiAc(sokak);
  sokak = mod.holdemSonrakiSokagiAc(sokak);
  sonuc.burnVeSokak = sokak.durum === 'river' && sokak.ortakKartlar.length === 5 && sokak.yakilanKartlar.length === 3 && sokak.desteIndex === 18;
  const hafiza = mod.holdemMasaHafizaOlayKaydet(ilk.hafiza, { elNo: 1, botId: 'bot-1', oyuncuId: 'oyuncu', aksiyon: 'fold', blöf: true, kazandi: false, blöfePas: true, rakipPasOrani: 0.2 });
  sonuc.masaHafizasi = hafiza.botlar['bot-1'].basarisizBlöf === 1 && hafiza.oyuncuEgilimleri.oyuncu.pas === 1 && hafiza.oyuncuEgilimleri.oyuncu.blöfePas === 1 && hafiza.sonAksiyonlar.length === 1;
  Object.entries(sonuc).forEach(([ad, geçti]) => assert.equal(geçti, true, ad));
  console.log(JSON.stringify(sonuc, null, 2));
  console.log('ALL_TESTS_PASSED: true');
})().catch((error) => { console.error(error); process.exitCode = 1; });
