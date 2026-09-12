// Blackjack (oyun-blackjack.html) -- kullanıcı isteği: "gerçek blackjack
// kuralları, katlama, bölme... hem tek oyunculu hem çok oyunculu, aynı anda
// oturup kalkabilen bir masa sistemi, site içi çip ekonomisi (ileride Texas
// Hold'em'de de kullanılacak)". Mimari: satranç/amiral battı ile AYNI desen
// (Firebase Realtime Database senkronu) ama TEK PAYLAŞILAN MASA -- davet linki
// yok, herkes aynı masaya oturur/kalkar (fiziksel bir kumarhane masası gibi).
//
// "Kim dağıtıyor?" sorunu: gerçek bir sunucu/krupiyer olmadığı için birden
// fazla istemci aynı anda "yeni el başlasın" yazmaya çalışabilir. Bunu bir
// Firebase transaction ile çözüyoruz -- masanın `durum` alanını değiştiren
// transaction'ı SADECE bir istemci kazanır, ağır işi (karma/dağıtma/krupiyer
// oyunu/ödeme) sadece o yazar; kaybedenler no-op. Krupiyerin kendi oyunu
// tamamen deterministik olduğu (kart sırası zaten belli, gizli bilgi kalmıyor)
// için hangi istemci hesaplarsa hesaplasın SONUÇ AYNI -- çakışma riski yok.
//
// Krupiyerin kapalı kartı (hole card) DAHİL tüm el verisi paylaşılan masa
// belgesinde tutuluyor (Amiral Battı'daki gizli filo düğümü gibi AYRI bir
// düğüme konmadı) -- kullanıcı bu riski bilerek kabul etti ("kimse konsola
// bakmaz, sorun yok").
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';
import { showToast } from './toast.js';
import { showModal } from './modal.js';
import { subscribeStaffProfiles, renderStaffAvatar } from './staff-profiles.js';
import {
  MAX_KOLTUK, BAHIS_SURESI_MS, BASLANGIC_BAKIYESI,
  tazeDesteOlustur, desteyiKaris, elDegerlendir, bolunebilirMi,
  krupiyerElOyna, desteYeterliMi, elSonucuHesapla
} from './blackjack-deste.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};
const MASA_ID = 'ana-masa'; // Tek paylaşılan masa -- kumarhanedeki fiziksel masa gibi.
const MASA_YOLU = 'oyunBasarimlari/blackjack/masalar/' + MASA_ID;
const CIP_DEGERLERI = [25, 50, 75, 100, 200, 500, 750, 1000, 5000, 10000];
const DESTE_STILLERI = ['temel', 'altin', 'celik'];
const VARSAYILAN_TEMA = 'varsayilan';

let database = null;
let currentUserUid = '';
let currentUserName = '';
let currentUserEmail = '';
let canPlay = false;

let currentTable = null;
let myChipBalance = 0;
let mySkin = { desteStili: 'temel', yuzKartiTemasi: VARSAYILAN_TEMA };
let skinCache = {}; // uid -> {desteStili, yuzKartiTemasi}
let countdownTimer = null;

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function benimKoltukIndex(table) {
  if (!table || !table.koltuklar) { return null; }
  for (let i = 0; i < MAX_KOLTUK; i++) {
    if (table.koltuklar[i] && table.koltuklar[i].uid === currentUserUid) { return i; }
  }
  return null;
}

// ── Kart görsel yolu -- kullanıcının seçtiği stil/temaya göre. ──
function kartGorselYolu(kart, uid) {
  const skin = skinCache[uid] || mySkin;
  const yuzKartiMi = kart.r === 'joker' || kart.r === 'kiz' || kart.r === 'papaz';
  if (yuzKartiMi && skin.yuzKartiTemasi && skin.yuzKartiTemasi !== VARSAYILAN_TEMA) {
    // "koleksiyon-{kod}-{varyant}" teması -- her üç rütbe de aynı temadan.
    return '/assets/blackjack/yuz-kartlari-koleksiyon/' + skin.yuzKartiTemasi + '-' + kart.r + '.png';
  }
  const stil = (skin.desteStili && DESTE_STILLERI.includes(skin.desteStili)) ? skin.desteStili : 'temel';
  const rutbeNo = { as: '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06', '7': '07', '8': '08', '9': '09', '10': '10', joker: '11', kiz: '12', papaz: '13' }[kart.r];
  return '/assets/blackjack/kartlar/varsayilan/' + stil + '/' + rutbeNo + '-' + kart.r + '-' + kart.s + '.png';
}
function desteArkasiYolu() { return '/assets/blackjack/deste-arkalari/deste-arkasi-01.png'; }

// ── Skin ayarları ──
function loadSkinFor(uid) {
  if (skinCache[uid]) { return Promise.resolve(skinCache[uid]); }
  return database.ref('blackjackAyarlari/' + uid).once('value').then((snap) => {
    const v = snap.val() || { desteStili: 'temel', yuzKartiTemasi: VARSAYILAN_TEMA };
    skinCache[uid] = v;
    if (uid === currentUserUid) { mySkin = v; }
    return v;
  });
}
function ensureSkinsLoaded(table) {
  const uids = [];
  for (let i = 0; i < MAX_KOLTUK; i++) { if (table.koltuklar && table.koltuklar[i] && table.koltuklar[i].uid) { uids.push(table.koltuklar[i].uid); } }
  return Promise.all(uids.map((u) => loadSkinFor(u)));
}

function openSkinModal() {
  loadSkinFor(currentUserUid).then(() => {
    const stilHtml = DESTE_STILLERI.map((s) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-destestili" value="' + s + '"' + (mySkin.desteStili === s ? ' checked' : '') + '> ' + escapeHtml(s === 'temel' ? 'Sade' : s === 'altin' ? 'Altın' : 'Çelik') + '</label>'
    ).join('');
    const temaSecenekleri = ['varsayilan'].concat(collabKodlari().flatMap((kod) => [kod + '-1', kod + '-2']));
    const temaHtml = temaSecenekleri.map((t) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-tema" value="' + t + '"' + (mySkin.yuzKartiTemasi === t ? ' checked' : '') + '> ' + escapeHtml(t === 'varsayilan' ? 'Varsayılan' : t) + '</label>'
    ).join('');
    showModal({
      title: 'Kart Skinleri',
      body: '<div class="bj-skin-grup"><h4>Deste Stili</h4>' + stilHtml + '</div><div class="bj-skin-grup"><h4>Vale / Kız / Papaz Teması</h4><div class="bj-skin-tema-liste">' + temaHtml + '</div></div>',
      actions: [
        {
          label: 'Kaydet', variant: 'primary', action: ({ dialog }) => {
            const stil = dialog.querySelector('input[name="bj-destestili"]:checked').value;
            const tema = dialog.querySelector('input[name="bj-tema"]:checked').value;
            database.ref('blackjackAyarlari/' + currentUserUid).set({ desteStili: stil, yuzKartiTemasi: tema }).then(() => {
              skinCache[currentUserUid] = { desteStili: stil, yuzKartiTemasi: tema };
              mySkin = skinCache[currentUserUid];
              if (currentTable) { renderMasa(currentTable); }
              showToast('Skin kaydedildi.', { variant: 'success' });
            }).catch(() => showToast('Kaydedilemedi.', { variant: 'error' }));
          }
        },
        { label: 'Vazgeç', variant: 'outline' }
      ]
    });
  });
}
// 24 koleksiyon kodu -- yuz-kartlari-koleksiyon dosya adlarından (organize
// ederken sabitlenen kod listesi).
function collabKodlari() {
  return ['ac', 'au', 'bug', 'c7', 'cl', 'cr', 'cyp', 'd2', 'dbd', 'ds', 'dtd', 'eg', 'fo', 'pc', 'r', 'sk', 'stp', 'sts', 'sv', 'tboi', 'tw', 'vs', 'wf', 'xr'];
}

// ── Çip bakiyesi ──
function subscribeMyBalance() {
  database.ref('cipBakiyeleri/' + currentUserUid).on('value', (snap) => {
    myChipBalance = snap.exists() ? snap.val() : null;
    if (myChipBalance === null) {
      database.ref('cipBakiyeleri/' + currentUserUid).set(BASLANGIC_BAKIYESI).then(() => { myChipBalance = BASLANGIC_BAKIYESI; renderBakiye(); });
    } else { renderBakiye(); }
  });
}
function renderBakiye() {
  const el = document.querySelector('[data-bj-bakiye]');
  if (el) { el.textContent = (myChipBalance === null ? '…' : myChipBalance.toLocaleString('tr-TR')) + ' çip'; }
}
function bakiyeGuncelle(uid, delta) {
  return database.ref('cipBakiyeleri/' + uid).transaction((mevcut) => (mevcut || 0) + delta);
}

// ── Oturma / kalkma ──
function otur(koltukIndex) {
  if (!canPlay) { showToast('Oynamak için giriş yapmalısınız.', { variant: 'error' }); return; }
  if (benimKoltukIndex(currentTable) !== null) { showToast('Zaten bir koltukta oturuyorsunuz.', { variant: 'error' }); return; }
  const ref = database.ref(dbPath(MASA_YOLU + '/koltuklar/' + koltukIndex));
  ref.transaction((mevcut) => {
    if (mevcut && mevcut.uid) { return; } // dolu -- vazgeç
    return { uid: currentUserUid, isim: currentUserName || currentUserEmail, bahis: null, katilimDurumu: 'hazir' };
  }).then((res) => {
    if (!res.committed) { showToast('Bu koltuk dolu.', { variant: 'error' }); }
  });
}
function kalk(koltukIndex) {
  if (currentTable && currentTable.durum !== 'bahis_bekleniyor') { showToast('El bitmeden kalkamazsınız.', { variant: 'error' }); return; }
  database.ref(dbPath(MASA_YOLU + '/koltuklar/' + koltukIndex)).set(null);
}

// ── Bahis ──
function bahisYap(koltukIndex, miktar) {
  // Tıklanan çip miktarı MEVCUT bahise EKLENİR (üzerine yazılmaz) -- kullanıcı
  // isteği: "2 kere 100'e basınca 200 olması lazım". Bakiye kontrolü toplam
  // (mevcut bahis + eklenen) üzerinden yapılır.
  const ref = database.ref(dbPath(MASA_YOLU + '/koltuklar/' + koltukIndex));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.uid !== currentUserUid) { return; }
    const yeniBahis = (mevcut.bahis || 0) + miktar;
    if (yeniBahis > myChipBalance) { return; }
    return Object.assign({}, mevcut, { bahis: yeniBahis, katilimDurumu: 'hazir' });
  }).then((res) => {
    if (!res.committed) { showToast('Yetersiz bakiye.', { variant: 'error' }); }
  });
}

// ── El/koltuk yardımcıları ──
function sonrakiAktifElVarMi(table) {
  for (let i = 0; i < MAX_KOLTUK; i++) {
    const k = table.koltuklar && table.koltuklar[i];
    if (!k || !k.eller) { continue; }
    for (let e = 0; e < k.eller.length; e++) { if (k.eller[e].durum === 'oynuyor') { return { koltuk: i, el: e }; } }
  }
  return null;
}

// ── Faz geçişleri (transaction ile "kim yönetiyor" çözülür) ──
function bahisPenceresiniBaslat() {
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (mevcut && mevcut.durum && mevcut.durum !== 'el_sonucu' && mevcut.durum !== undefined) { return; }
    const temiz = { durum: 'bahis_bekleniyor', bahisSuresiBitis: Date.now() + BAHIS_SURESI_MS, aktifKoltuk: null, kurpiyerEli: null, guncellemeTs: Date.now() };
    const koltuklar = (mevcut && mevcut.koltuklar) || {};
    Object.keys(koltuklar).forEach((i) => { if (koltuklar[i]) { koltuklar[i] = Object.assign({}, koltuklar[i], { bahis: null, eller: null, katilimDurumu: 'hazir' }); } });
    temiz.koltuklar = koltuklar;
    return temiz;
  });
}

function bahisSuresiDolunca() {
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.durum !== 'bahis_bekleniyor') { return; }
    if (!mevcut.bahisSuresiBitis || Date.now() < mevcut.bahisSuresiBitis) { return; }
    const bahisliKoltuklar = [];
    for (let i = 0; i < MAX_KOLTUK; i++) { if (mevcut.koltuklar && mevcut.koltuklar[i] && mevcut.koltuklar[i].bahis > 0) { bahisliKoltuklar.push(i); } }
    if (!bahisliKoltuklar.length) { mevcut.bahisSuresiBitis = Date.now() + BAHIS_SURESI_MS; return mevcut; }

    let deste = mevcut.deste;
    let desteIndex = mevcut.desteIndex || 0;
    const kalan = (deste ? deste.length : 0) - desteIndex;
    if (!deste || !desteYeterliMi(kalan, bahisliKoltuklar.length)) {
      deste = desteyiKaris(tazeDesteOlustur());
      desteIndex = 0;
    }
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    // Sırayla: her bahisli koltuğa 1 kart, sonra krupiyere 1 (açık), sonra tekrar
    // her koltuğa 1 kart, sonra krupiyere 1 (kapalı) -- gerçek kumarhane sırası.
    const elBaslangic = {};
    bahisliKoltuklar.forEach((i) => { elBaslangic[i] = []; });
    for (let tur = 0; tur < 2; tur++) {
      bahisliKoltuklar.forEach((i) => { elBaslangic[i].push(deste[desteIndex]); desteIndex++; });
    }
    const krupiyerKartlari = [deste[desteIndex]]; desteIndex++;
    krupiyerKartlari.push(deste[desteIndex]); desteIndex++;

    bahisliKoltuklar.forEach((i) => {
      const degerlendirme = elDegerlendir(elBaslangic[i]);
      koltuklar[i] = Object.assign({}, koltuklar[i], {
        eller: [{ kartlar: elBaslangic[i], durum: degerlendirme.blackjackMi ? 'blackjack' : 'oynuyor', bahisMiktari: koltuklar[i].bahis }]
      });
    });
    const ilkAktif = bahisliKoltuklar.find((i) => koltuklar[i].eller[0].durum === 'oynuyor');
    mevcut.deste = deste;
    mevcut.desteIndex = desteIndex;
    mevcut.koltuklar = koltuklar;
    mevcut.kurpiyerEli = { kartlar: krupiyerKartlari, acikMi: false };
    mevcut.aktifKoltuk = ilkAktif === undefined ? null : ilkAktif;
    mevcut.durum = ilkAktif === undefined ? 'kurpiyer_sirasi' : 'oyunculuk';
    // Her el için artan bir numara -- bakiye düşme/ödeme işlemlerini KİM
    // DAĞITTIYSA onun değil, HER oturan istemcinin kendi listener'ında bir kez
    // işlemesi için (bkz. islemBakiyeYansit). "Kim dağıtıyor" yarışını sadece
    // BİR istemci kazanır ama masadaki HERKESİN kendi bahsini düşmesi/ödemesini
    // alması gerekiyor -- bu numaraya göre "bu eli zaten işledim mi" kontrolü var.
    mevcut.elNo = (mevcut.elNo || 0) + 1;
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  });
}

function siraSonrakineGecsin(table) {
  const sonraki = sonrakiAktifElVarMi(table);
  const patch = {};
  if (sonraki) {
    patch[dbPath(MASA_YOLU + '/aktifKoltuk')] = sonraki.koltuk;
  } else {
    patch[dbPath(MASA_YOLU + '/durum')] = 'kurpiyer_sirasi';
    patch[dbPath(MASA_YOLU + '/aktifKoltuk')] = null;
  }
  patch[dbPath(MASA_YOLU + '/guncellemeTs')] = Date.now();
  database.ref('/').update(patch);
}

function krupiyerSirasiGeldi() {
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.durum !== 'kurpiyer_sirasi' || (mevcut.kurpiyerEli && mevcut.kurpiyerEli.acikMi)) { return; }
    const herkesBattiMi = Object.keys(mevcut.koltuklar || {}).every((i) => {
      const k = mevcut.koltuklar[i];
      if (!k || !k.eller) { return true; }
      return k.eller.every((el) => el.durum === 'batti');
    });
    let kartlar = mevcut.kurpiyerEli.kartlar;
    let desteIndex = mevcut.desteIndex;
    if (!herkesBattiMi) {
      const sonuc = krupiyerElOyna(kartlar, mevcut.deste, desteIndex);
      kartlar = sonuc.kartlar;
      desteIndex = sonuc.yeniDesteIndex;
    }
    const krupiyerDegerlendirme = elDegerlendir(kartlar);
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    Object.keys(koltuklar).forEach((i) => {
      const k = koltuklar[i];
      if (!k || !k.eller) { return; }
      const yeniEller = k.eller.map((el) => {
        if (el.durum === 'batti') { return Object.assign({}, el, { sonuc: 'kaybetti', odeme: 0 }); }
        const degerlendirme = elDegerlendir(el.kartlar);
        const sonuc = elSonucuHesapla(degerlendirme, krupiyerDegerlendirme, el.bahisMiktari);
        return Object.assign({}, el, { sonuc: sonuc.sonuc, odeme: sonuc.odeme });
      });
      koltuklar[i] = Object.assign({}, k, { eller: yeniEller });
    });
    mevcut.kurpiyerEli = { kartlar, acikMi: true };
    mevcut.desteIndex = desteIndex;
    mevcut.koltuklar = koltuklar;
    mevcut.durum = 'el_sonucu';
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  });
}
// Bir sonraki adıma geçişi TEK bir istemcinin zamanlayıcısına bağlamıyoruz --
// o istemci sayfadan ayrılırsa masa kilitli kalır. Bunun yerine her bağlı
// istemcinin `value` dinleyicisi her tetiklendiğinde "geçiş zamanı geldi mi?"
// diye kontrol ediyor (bkz. attachTableListener) -- transaction zaten hangi
// istemcinin kazandığını çözüyor, burada sadece "kim önce fark ederse o dener".
const EL_SONUCU_BEKLEME_MS = 4000;
function belkiSonrakiFazaGec(table) {
  if (!table) { return; }
  if (table.durum === 'kurpiyer_sirasi' && (!table.kurpiyerEli || !table.kurpiyerEli.acikMi)) { krupiyerSirasiGeldi(); return; }
  if (table.durum === 'el_sonucu' && table.guncellemeTs && Date.now() - table.guncellemeTs > EL_SONUCU_BEKLEME_MS) { bahisPenceresiniBaslat(); return; }
  if (table.durum === 'bahis_bekleniyor' && table.bahisSuresiBitis && Date.now() >= table.bahisSuresiBitis) { bahisSuresiDolunca(); }
}

// "Kim dağıtıyor / kim krupiyeri oynatıyor" yarışını SADECE BİR istemci
// kazanır (bkz. yukarıdaki transaction'lar) -- ama masadaki HERKESİN kendi
// bahsini düşmesi ve kendi ödemesini alması gerekiyor. Bu yüzden bakiye
// hareketleri o yarışı kazanan istemciye değil, HER oturan istemcinin kendi
// `value` dinleyicisine bağlı -- elNo'ya göre "bu eli zaten işledim mi" diye
// bakıp bir kez uyguluyor (bkz. sonIslenenBahisElNo/sonOdenenElNo).
let sonIslenenBahisElNo = -1;
let sonOdenenElNo = -1;
function islemBakiyeYansit(table) {
  const benimKoltuk = benimKoltukIndex(table);
  if (benimKoltuk === null || !table.elNo) { return; }
  const koltuk = table.koltuklar[benimKoltuk];
  if (!koltuk || !koltuk.eller || !koltuk.eller[0]) { return; }
  if (table.elNo !== sonIslenenBahisElNo) {
    sonIslenenBahisElNo = table.elNo;
    const dusulecek = koltuk.eller[0].bahisMiktari;
    if (dusulecek > 0) { bakiyeGuncelle(currentUserUid, -dusulecek); }
  }
  if (table.durum === 'el_sonucu' && table.elNo !== sonOdenenElNo && koltuk.eller[0].odeme !== undefined) {
    sonOdenenElNo = table.elNo;
    const toplamOdeme = koltuk.eller.reduce((t, el) => t + (el.odeme || 0), 0);
    if (toplamOdeme > 0) { bakiyeGuncelle(currentUserUid, toplamOdeme); }
  }
}

// ── Oyuncu aksiyonları ──
function kartCek(koltukIndex, elIndex) {
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.aktifKoltuk !== koltukIndex) { return; }
    const koltuk = mevcut.koltuklar[koltukIndex];
    const el = koltuk.eller[elIndex];
    if (el.durum !== 'oynuyor') { return; }
    const yeniKart = mevcut.deste[mevcut.desteIndex];
    const yeniKartlar = el.kartlar.concat([yeniKart]);
    const degerlendirme = elDegerlendir(yeniKartlar);
    const yeniEl = Object.assign({}, el, { kartlar: yeniKartlar, durum: degerlendirme.battiMi ? 'batti' : (degerlendirme.toplam === 21 ? 'kaldi' : 'oynuyor') });
    const yeniEller = koltuk.eller.slice(); yeniEller[elIndex] = yeniEl;
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    mevcut.desteIndex = mevcut.desteIndex + 1;
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }).then((res) => { if (res.committed) { siraSonrakiEliyaGec(res.snapshot.val(), koltukIndex, elIndex); } });
}
function siraSonrakiEliyaGec(table, koltukIndex, elIndex) {
  const koltuk = table.koltuklar[koltukIndex];
  if (koltuk.eller[elIndex].durum === 'oynuyor') { return; } // hâlâ aynı elde (21 olmadıysa devam eder, UI tekrar kartÇek çağırır)
  if (koltuk.eller[elIndex + 1]) {
    database.ref(dbPath(MASA_YOLU + '/aktifKoltuk')).set(koltukIndex); // aynı koltuk, sıradaki (bölünmüş) el
    return;
  }
  siraSonrakineGecsin(table);
}
function kal(koltukIndex, elIndex) {
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.aktifKoltuk !== koltukIndex) { return; }
    const koltuk = mevcut.koltuklar[koltukIndex];
    const el = koltuk.eller[elIndex];
    if (el.durum !== 'oynuyor') { return; }
    const yeniEller = koltuk.eller.slice(); yeniEller[elIndex] = Object.assign({}, el, { durum: 'kaldi' });
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }).then((res) => { if (res.committed) { siraSonrakiEliyaGec(res.snapshot.val(), koltukIndex, elIndex); } });
}
function katla(koltukIndex, elIndex) {
  const koltuk = currentTable.koltuklar[koltukIndex];
  const el = koltuk.eller[elIndex];
  if (el.kartlar.length !== 2) { showToast('Sadece ilk karardan sonra katlayabilirsiniz.', { variant: 'error' }); return; }
  if (el.bahisMiktari > myChipBalance) { showToast('Katlamak için yetersiz bakiye.', { variant: 'error' }); return; }
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.aktifKoltuk !== koltukIndex) { return; }
    const k = mevcut.koltuklar[koltukIndex];
    const e = k.eller[elIndex];
    if (e.kartlar.length !== 2) { return; }
    const yeniKart = mevcut.deste[mevcut.desteIndex];
    const yeniKartlar = e.kartlar.concat([yeniKart]);
    const degerlendirme = elDegerlendir(yeniKartlar);
    const yeniEl = Object.assign({}, e, { kartlar: yeniKartlar, bahisMiktari: e.bahisMiktari * 2, katlandi: true, durum: degerlendirme.battiMi ? 'batti' : 'kaldi' });
    const yeniEller = k.eller.slice(); yeniEller[elIndex] = yeniEl;
    mevcut.koltuklar[koltukIndex] = Object.assign({}, k, { eller: yeniEller });
    mevcut.desteIndex = mevcut.desteIndex + 1;
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }).then((res) => { if (res.committed) { bakiyeGuncelle(currentUserUid, -el.bahisMiktari); siraSonrakiEliyaGec(res.snapshot.val(), koltukIndex, elIndex); } });
}
function bol(koltukIndex, elIndex) {
  const koltuk = currentTable.koltuklar[koltukIndex];
  const el = koltuk.eller[elIndex];
  if (!bolunebilirMi(el.kartlar)) { return; }
  if (koltuk.eller.length > 1) { showToast('Sadece bir kez bölebilirsiniz.', { variant: 'error' }); return; }
  if (el.bahisMiktari > myChipBalance) { showToast('Bölmek için yetersiz bakiye.', { variant: 'error' }); return; }
  const asBolunmesiMi = el.kartlar[0].r === 'as';
  const ref = database.ref(dbPath(MASA_YOLU));
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.aktifKoltuk !== koltukIndex) { return; }
    const k = mevcut.koltuklar[koltukIndex];
    const e = k.eller[elIndex];
    if (!e || e.kartlar.length !== 2) { return; }
    const kart1 = e.kartlar[0], kart2 = e.kartlar[1];
    const yeniKart1 = mevcut.deste[mevcut.desteIndex]; mevcut.desteIndex++;
    const yeniKart2 = mevcut.deste[mevcut.desteIndex]; mevcut.desteIndex++;
    const el1Kartlar = [kart1, yeniKart1];
    const el2Kartlar = [kart2, yeniKart2];
    // As bölünmesinde her el sadece 1 kart alır ve otomatik durur (gerçek kural).
    const el1 = { kartlar: el1Kartlar, bahisMiktari: e.bahisMiktari, durum: asBolunmesiMi ? 'kaldi' : (elDegerlendir(el1Kartlar).battiMi ? 'batti' : 'oynuyor') };
    const el2 = { kartlar: el2Kartlar, bahisMiktari: e.bahisMiktari, durum: asBolunmesiMi ? 'kaldi' : (elDegerlendir(el2Kartlar).battiMi ? 'batti' : 'oynuyor') };
    mevcut.koltuklar[koltukIndex] = Object.assign({}, k, { eller: [el1, el2] });
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }).then((res) => { if (res.committed) { bakiyeGuncelle(currentUserUid, -el.bahisMiktari); if (asBolunmesiMi) { siraSonrakineGecsin(res.snapshot.val()); } } });
}

// ── Render ──
function hucreSinifi(sonuc) {
  if (sonuc === 'kazandi' || sonuc === 'blackjack') { return 'bj-sonuc-kazandi'; }
  if (sonuc === 'kaybetti') { return 'bj-sonuc-kaybetti'; }
  if (sonuc === 'berabere') { return 'bj-sonuc-berabere'; }
  return '';
}
function kartHtml(kart, uid, kapaliMi) {
  const src = kapaliMi ? desteArkasiYolu() : kartGorselYolu(kart, uid);
  return '<img class="bj-kart" src="' + src + '" alt="">';
}
function elHtml(el, uid) {
  const degerlendirme = elDegerlendir(el.kartlar);
  const kartlarHtml = el.kartlar.map((k) => kartHtml(k, uid, false)).join('');
  const sonucEtiket = el.sonuc ? '<span class="bj-el-sonuc ' + hucreSinifi(el.sonuc) + '">' + escapeHtml({ kazandi: 'Kazandı', kaybetti: 'Kaybetti', berabere: 'Berabere', blackjack: 'Blackjack!' }[el.sonuc] || '') + '</span>' : '';
  return '<div class="bj-el">' +
    '<div class="bj-el-kartlar">' + kartlarHtml + '</div>' +
    '<div class="bj-el-toplam">' + degerlendirme.toplam + (degerlendirme.battiMi ? ' (Battı)' : '') + '</div>' +
    '<div class="bj-el-bahis">' + el.bahisMiktari + ' çip</div>' + sonucEtiket +
    '</div>';
}
function koltukHtml(koltukIndex, koltuk, table, benimKoltuk) {
  if (!koltuk || !koltuk.uid) {
    if (benimKoltuk !== null) { return '<div class="bj-koltuk bj-koltuk-bos"></div>'; }
    return '<div class="bj-koltuk bj-koltuk-bos"><button type="button" class="bj-otur-btn" data-bj-otur="' + koltukIndex + '" title="Otur" aria-label="Otur">+</button></div>';
  }
  const avatarHtml = renderStaffAvatar(koltuk.isim, koltuk.uid, koltuk.isim, 40);
  const aktifMi = table.aktifKoltuk === koltukIndex;
  let icerik;
  if (table.durum === 'bahis_bekleniyor') {
    if (koltuk.uid === currentUserUid) {
      icerik = '<div class="bj-bahis-secim">' + CIP_DEGERLERI.filter((v) => v <= myChipBalance).map((v) => '<button type="button" class="bj-cip-btn" data-bj-bahis="' + koltukIndex + '" data-miktar="' + v + '">' + v + '</button>').join('') + '</div>' +
        (koltuk.bahis ? '<div class="bj-bahis-mevcut">Bahis: ' + koltuk.bahis + '</div>' : '<div class="bj-bahis-mevcut bj-bahis-yok">Bahis yok</div>');
    } else {
      icerik = koltuk.bahis ? '<div class="bj-bahis-mevcut">Bahis: ' + koltuk.bahis + '</div>' : '<div class="bj-bahis-mevcut bj-bahis-yok">Bekliyor…</div>';
    }
  } else if (koltuk.eller) {
    icerik = koltuk.eller.map((el, i) => elHtml(el, koltuk.uid) + ((aktifMi && i === activeElIndex(koltuk)) ? '<span class="bj-sira-isareti">◀ sırası</span>' : '')).join('');
  } else {
    icerik = '<div class="bj-bahis-mevcut bj-bahis-yok">Bu el dışında</div>';
  }
  return '<div class="bj-koltuk' + (aktifMi ? ' bj-koltuk-aktif' : '') + (koltuk.uid === currentUserUid ? ' bj-koltuk-ben' : '') + '">' +
    '<div class="bj-koltuk-oyuncu">' + avatarHtml + '<span>' + escapeHtml(koltuk.isim || '') + '</span></div>' +
    icerik +
    (koltuk.uid === currentUserUid && table.durum === 'bahis_bekleniyor' ? '<button type="button" class="btn btn-ghost bj-kalk-btn" data-bj-kalk="' + koltukIndex + '">Kalk</button>' : '') +
    '</div>';
}
function activeElIndex(koltuk) {
  if (!koltuk.eller) { return -1; }
  for (let i = 0; i < koltuk.eller.length; i++) { if (koltuk.eller[i].durum === 'oynuyor') { return i; } }
  return -1;
}

function renderKrupiyer(table) {
  const el = document.querySelector('[data-bj-krupiyer]');
  if (!el) { return; }
  if (!table.kurpiyerEli) { el.innerHTML = '<div class="bj-krupiyer-bos">Bahisler bekleniyor…</div>'; return; }
  const acikMi = table.kurpiyerEli.acikMi;
  const kartlarHtml = table.kurpiyerEli.kartlar.map((k, i) => kartHtml(k, currentUserUid, i === 1 && !acikMi)).join('');
  const degerlendirme = acikMi ? elDegerlendir(table.kurpiyerEli.kartlar) : null;
  el.innerHTML = '<div class="bj-el-kartlar">' + kartlarHtml + '</div>' + (degerlendirme ? '<div class="bj-el-toplam">' + degerlendirme.toplam + (degerlendirme.battiMi ? ' (Battı)' : '') + '</div>' : '');
}

function renderBahisSayaci(table) {
  const el = document.querySelector('[data-bj-sayac]');
  if (!el) { return; }
  if (table.durum !== 'bahis_bekleniyor' || !table.bahisSuresiBitis) { el.textContent = ''; if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
  if (countdownTimer) { clearInterval(countdownTimer); }
  const tick = () => {
    const kalanMs = table.bahisSuresiBitis - Date.now();
    if (kalanMs <= 0) { el.textContent = 'Bahisler kapandı…'; clearInterval(countdownTimer); countdownTimer = null; bahisSuresiDolunca(); return; }
    el.textContent = 'Bahis için: ' + Math.ceil(kalanMs / 1000) + ' sn';
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function renderAksiyonlar(table, benimKoltuk) {
  const el = document.querySelector('[data-bj-aksiyonlar]');
  if (!el) { return; }
  if (benimKoltuk === null || table.aktifKoltuk !== benimKoltuk) { el.innerHTML = ''; return; }
  const koltuk = table.koltuklar[benimKoltuk];
  const elIndex = activeElIndex(koltuk);
  if (elIndex === -1) { el.innerHTML = ''; return; }
  const aktifEl = koltuk.eller[elIndex];
  const ilkKararMi = aktifEl.kartlar.length === 2;
  el.innerHTML =
    '<button type="button" class="btn btn-primary" data-bj-kartcek>Kart Çek</button>' +
    '<button type="button" class="btn btn-outline" data-bj-kal>Kal</button>' +
    (ilkKararMi ? '<button type="button" class="btn btn-outline" data-bj-katla>Katla</button>' : '') +
    (ilkKararMi && bolunebilirMi(aktifEl.kartlar) && koltuk.eller.length === 1 ? '<button type="button" class="btn btn-outline" data-bj-bol>Böl</button>' : '');
}

function renderMasa(table) {
  currentTable = table;
  const benimKoltuk = benimKoltukIndex(table);
  ensureSkinsLoaded(table).then(() => {
    const koltuklarEl = document.querySelector('[data-bj-koltuklar]');
    if (koltuklarEl) {
      // Kendi koltuğum HER ZAMAN tam ortada (goren=2, 5 koltuğun merkezi) --
      // diğerleri bu merkeze göre sağa/sola yayla dizilir. Oturmuyorsam
      // (izleyici) doğal sırada gösterilir.
      const merkez = Math.floor(MAX_KOLTUK / 2);
      let html = '';
      for (let goren = 0; goren < MAX_KOLTUK; goren++) {
        const gercekIndex = benimKoltuk === null ? goren : (((benimKoltuk + (goren - merkez)) % MAX_KOLTUK) + MAX_KOLTUK) % MAX_KOLTUK;
        html += '<div class="bj-koltuk-slot bj-koltuk-slot-' + goren + '">' + koltukHtml(gercekIndex, table.koltuklar && table.koltuklar[gercekIndex], table, benimKoltuk) + '</div>';
      }
      koltuklarEl.innerHTML = html;
    }
    renderKrupiyer(table);
    renderBahisSayaci(table);
    renderAksiyonlar(table, benimKoltuk);
  });
}

function eventleriBagla() {
  // document'e bağlanıyor -- skin çarkı butonu .page-header'da, yani
  // .bj-masa'nın (data-bj-root) DIŞINDA; sadece root'u dinlemek onu kaçırırdı.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-bj-skin-carki]')) { openSkinModal(); return; }
    if (!e.target.closest('[data-bj-root]')) { return; }
    if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
    const oturBtn = e.target.closest('[data-bj-otur]'); if (oturBtn) { otur(Number(oturBtn.dataset.bjOtur)); return; }
    const kalkBtn = e.target.closest('[data-bj-kalk]'); if (kalkBtn) { kalk(Number(kalkBtn.dataset.bjKalk)); return; }
    const bahisBtn = e.target.closest('[data-bj-bahis]'); if (bahisBtn) { bahisYap(Number(bahisBtn.dataset.bjBahis), Number(bahisBtn.dataset.miktar)); return; }
    const benimKoltuk = benimKoltukIndex(currentTable);
    if (benimKoltuk === null || !currentTable) { return; }
    const elIndex = activeElIndex(currentTable.koltuklar[benimKoltuk]);
    if (e.target.closest('[data-bj-kartcek]')) { kartCek(benimKoltuk, elIndex); return; }
    if (e.target.closest('[data-bj-kal]')) { kal(benimKoltuk, elIndex); return; }
    if (e.target.closest('[data-bj-katla]')) { katla(benimKoltuk, elIndex); return; }
    if (e.target.closest('[data-bj-bol]')) { bol(benimKoltuk, elIndex); }
  });
}

function attachTableListener() {
  database.ref(dbPath(MASA_YOLU)).on('value', (snap) => {
    const table = snap.val() || { durum: 'bahis_bekleniyor', koltuklar: {} };
    if (!snap.exists()) { bahisPenceresiniBaslat(); }
    renderMasa(table);
    belkiSonrakiFazaGec(table);
    islemBakiyeYansit(table);
  });
  // Veri DEĞİŞMESE bile (örn. kimse kart çekmiyor, sadece süre doluyor) zaman
  // aşımı geçişlerini kaçırmamak için periyodik bir yoklama.
  setInterval(() => { if (currentTable) { belkiSonrakiFazaGec(currentTable); } }, 1000);
}

export function initBlackjack() {
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  eventleriBagla();
  subscribeStaffProfiles(database, () => { if (currentTable) { renderMasa(currentTable); } });

  auth.onAuthStateChanged((user) => {
    if (!user) { canPlay = false; return; }
    currentUserEmail = user.email || '';
    currentUserUid = user.uid;
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canPlay = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      subscribeMyBalance();
      loadSkinFor(currentUserUid).then(() => { if (currentTable) { renderMasa(currentTable); islemBakiyeYansit(currentTable); } });
    }).catch(() => { canPlay = false; });
  });

  initDbMode(database).then(() => { renderDbModeBanner(); });
  onDbModeChange(() => { renderDbModeBanner(); });

  attachTableListener();
}
