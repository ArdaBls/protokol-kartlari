import assert from 'node:assert/strict';
import {
  HOLDEM_VARSAYILAN_AYARLAR,
  holdemAyarlariNormalle,
  holdemBosCanliMasa,
  holdemKatilimTalebi,
  holdemElSonuKuyruguUygula,
  holdemEliBaslat,
  holdemAksiyonUygula,
  holdemEliBitir,
  holdemBaglantiKesildi,
  holdemOyuncuMasadanAyril
} from '../docs/admin-src/src/v4/holdem-masa-oyun.js';

const bot = (uid) => ({ uid, isim: uid, bot: true, masaBakiyesi: 1000 });
const insan = (uid) => ({ uid, isim: uid, bot: false, masaBakiyesi: 1000, skin: { desteArkasi: '08', yuzKartiTemasi: 'koleksiyon-ac-1' } });

const varsayilan = holdemAyarlariNormalle({});
assert.deepEqual(varsayilan, HOLDEM_VARSAYILAN_AYARLAR);
assert.equal(holdemAyarlariNormalle({ kucukKor: 80, buyukKor: 10 }).buyukKor, 160);

let masa = holdemBosCanliMasa();
masa = { ...masa, koltuklar: [insan('u1'), bot('b1'), bot('b2'), bot('b3'), bot('b4')] };
masa = holdemKatilimTalebi(masa, { ...insan('u2'), masaBakiyesi: 3450 });
assert.equal(masa.kuyruk.length, 1);
masa = holdemElSonuKuyruguUygula(masa);
assert.equal(masa.koltuklar.some((koltuk) => koltuk.uid === 'u2'), true);
assert.equal(masa.koltuklar.find((koltuk) => koltuk.uid === 'u2').skin.desteArkasi, '08');
// Kuyruktan oturan gerçek oyuncu KENDİ site bakiyesiyle oturmalı, masanın
// sabit girisBedeli varsayılanıyla DEĞİL (aksi halde çip yaratılır/yok olur).
assert.equal(masa.koltuklar.find((koltuk) => koltuk.uid === 'u2').masaBakiyesi, 3450);

// Deterministik deste ile kör bahis, sıra ve legal check akışı.
masa = holdemEliBaslat(masa, 1000, () => 0.42);
assert.equal(masa.durum, 'preflop');
assert.equal(masa.koltuklar.filter((koltuk) => koltuk.kartlar.length === 2).length, 5);
assert.equal(masa.mevcutBahis, masa.ayarlar.buyukKor);
assert.equal(masa.desteId.length > 0, true);

// Aktif oyuncu karşılanacak bahis varken pas geçebilir; sıra ilerler.
const oncekiAktif = masa.aktifKoltuk;
masa = holdemAksiyonUygula(masa, { koltukIndex: oncekiAktif, aksiyon: 'fold' }, 1100);
assert.notEqual(masa.aktifKoltuk, oncekiAktif);

const kopanUid = masa.koltuklar[masa.aktifKoltuk].uid;
masa = holdemBaglantiKesildi(masa, kopanUid, 1200);
assert.equal(masa.koltuklar[masa.aktifKoltuk].ayrilacak, true);
assert.equal(masa.aksiyonBitis <= 11200, true);

// Tek oyuncu kalınca pot hesaplanır ve ödeme negatif olamaz.
masa = { ...masa, koltuklar: masa.koltuklar.map((koltuk, index) => ({ ...koltuk, pas: index !== 0, toplamYatirim: 100 })) };
masa = holdemEliBitir(masa, 1300);
assert.equal(masa.durum, 'el_sonucu');
assert.equal(masa.sonuclar.odemeler[0], 500);

// 2 kişiden 1'e düşünce oyun otomatik sonlanmalı -- sırası KENDİSİNDE
// OLMAYAN oyuncu masadan kalkarsa (ör. rakip düşünürken), tek kalan oyuncu
// eli hemen kazanmalı, aksiyonBitis/aktifKoltuk temizlenmeli.
let ikili = holdemBosCanliMasa();
ikili = { ...ikili, koltuklar: [insan('h1'), insan('h2')] };
ikili = holdemEliBaslat(ikili, 2000, () => 0.13);
assert.equal(ikili.durum, 'preflop');
const ayrilanIndex = ikili.aktifKoltuk === 0 ? 1 : 0;
ikili = holdemOyuncuMasadanAyril(ikili, ayrilanIndex, 2100);
assert.equal(ikili.durum, 'el_sonucu');
assert.equal(ikili.aktifKoltuk, null);
assert.equal(ikili.sonuclar.odemeler[ayrilanIndex === 0 ? 1 : 0] > 0, true);

console.log(JSON.stringify({ varsayilan: true, kuyruk: true, korVeSira: true, kopma: true, pot: true, ikiliAyrilinca: true }, null, 2));
console.log('ALL_TESTS_PASSED: true');
