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
  MAX_KOLTUK, BAHIS_SURESI_MS, BASLANGIC_BAKIYESI, TOPLAM_KART_SAYISI,
  tazeDesteOlustur, desteyiKaris, elDegerlendir, bolunebilirMi,
  krupiyerElOyna, desteYeterliMi, elSonucuHesapla, kartDegeri
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
// CIP_DEGERLERI ile AYNI SIRADA -- her değere gerçek bir çip görseli (kullanıcı
// isteği: "bizim çipleri kullanacağız"). En yüksek değer (10000) için özel
// "joker" çipi kullanılıyor (organize ederken kalan tek görsel).
const CIP_GORSELLERI = ['cip-01-beyaz', 'cip-02-kirmizi', 'cip-03-yesil', 'cip-04-mavi', 'cip-05-siyah', 'cip-06-mor', 'cip-07-turuncu-koyu', 'cip-08-bej', 'cip-09-turuncu', 'cip-10-joker'];
function cipGorselYolu(miktar) {
  const idx = CIP_DEGERLERI.indexOf(miktar);
  return '/assets/blackjack/cipler/' + (CIP_GORSELLERI[idx] || CIP_GORSELLERI[0]) + '.png';
}
const AKSIYON_SURESI_MS = 10000; // Sırası gelen oyuncu için 10 sn -- süresiz bekleme olmasın.
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
let aksiyonCountdownTimer = null;

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

// Skin seçimi önizlemeleri -- kullanıcı isteği: "hangisini seçtiğimizi
// bilelim" (sade metin/radio yerine gerçek kart görseli).
function stilOnizlemeYolu(stil) { return '/assets/blackjack/kartlar/varsayilan/' + stil + '/07-7-kupa.png'; }
function temaOnizlemeYolu(tema) {
  return tema === VARSAYILAN_TEMA
    ? '/assets/blackjack/kartlar/varsayilan/temel/13-papaz-kupa.png'
    : '/assets/blackjack/yuz-kartlari-koleksiyon/' + tema + '-papaz.png';
}
function openSkinModal() {
  loadSkinFor(currentUserUid).then(() => {
    const stilHtml = DESTE_STILLERI.map((s) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-destestili" value="' + s + '"' + (mySkin.desteStili === s ? ' checked' : '') + '><img class="bj-skin-onizleme" src="' + stilOnizlemeYolu(s) + '" alt=""> ' + escapeHtml(s === 'temel' ? 'Sade' : s === 'altin' ? 'Altın' : 'Çelik') + '</label>'
    ).join('');
    const temaSecenekleri = ['varsayilan'].concat(collabKodlari().flatMap((kod) => [kod + '-1', kod + '-2']));
    const temaHtml = temaSecenekleri.map((t) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-tema" value="' + t + '"' + (mySkin.yuzKartiTemasi === t ? ' checked' : '') + '><img class="bj-skin-onizleme" src="' + temaOnizlemeYolu(t) + '" alt=""> ' + escapeHtml(t === 'varsayilan' ? 'Varsayılan' : t) + '</label>'
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
  // NOT: Firebase kuralı "newData.val() >= 0" şartı koyuyor. mevcut null/stale
  // okunduğu bir anda (örn. ilk set(1000) sunucuya henüz ulaşmadan bir el
  // başlarsa) DÜŞÜŞ negatife düşüp kural tarafından SESSİZCE reddediliyordu --
  // KAZANÇ (pozitif delta) her zaman geçtiği için sadece kayıplarda görünen
  // bir "çip düşmüyor" hatasına yol açıyordu. Math.max(0, ...) ile asla
  // kural-reddi bir değer önerilmiyor; .catch ile de artık sessiz kalmıyor.
  return database.ref('cipBakiyeleri/' + uid).transaction((mevcut) => Math.max(0, (mevcut || 0) + delta))
    .catch((err) => {
      console.error('Çip bakiyesi güncellenemedi:', err);
      showToast('Bakiye güncellenemedi, sayfayı yenileyin.', { variant: 'error' });
    });
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
    // NOT: Firebase transaction dönen değerle DÜĞÜMÜN TAMAMINI DEĞİŞTİRİR (birleştirmez) --
    // deste/desteIndex/elNo burada KORUNMAZSA her el yeni bir 208'lik deste
    // karılıyor (kullanıcı bildirimi: "kart sayısı her oyunda yeniden
    // yükseliyor"). Deste SADECE bahisSuresiDolunca'daki desteYeterliMi
    // kontrolü yetersiz derse yeniden karılmalı, her elin başında değil.
    const temiz = {
      durum: 'bahis_bekleniyor', bahisSuresiBitis: Date.now() + BAHIS_SURESI_MS, aktifKoltuk: null, kurpiyerEli: null, guncellemeTs: Date.now(),
      deste: (mevcut && mevcut.deste) || null, desteIndex: (mevcut && mevcut.desteIndex) || 0, elNo: (mevcut && mevcut.elNo) || 0
    };
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
    mevcut.aksiyonSuresiBitis = ilkAktif === undefined ? null : Date.now() + AKSIYON_SURESI_MS;
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
    patch[dbPath(MASA_YOLU + '/aksiyonSuresiBitis')] = Date.now() + AKSIYON_SURESI_MS;
  } else {
    patch[dbPath(MASA_YOLU + '/durum')] = 'kurpiyer_sirasi';
    patch[dbPath(MASA_YOLU + '/aktifKoltuk')] = null;
    patch[dbPath(MASA_YOLU + '/aksiyonSuresiBitis')] = null;
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
  if (table.durum === 'bahis_bekleniyor' && table.bahisSuresiBitis && Date.now() >= table.bahisSuresiBitis) { bahisSuresiDolunca(); return; }
  if (table.durum === 'oyunculuk' && table.aksiyonSuresiBitis && Date.now() >= table.aksiyonSuresiBitis) { aksiyonSuresiDolunca(); }
}

// Sırası gelen oyuncu 10 sn içinde karar vermezse otomatik "Kal" -- süresiz
// bekleme olmasın (kullanıcı bildirimi). Amiral Battı/bahis penceresindeki
// AYNI "herkes kendi istemcisinde fark eder" deseni.
function aksiyonSuresiDolunca() {
  const ref = database.ref(dbPath(MASA_YOLU));
  let islenenKoltuk = null;
  let islenenEl = null;
  ref.transaction((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyunculuk' || mevcut.aktifKoltuk === null || mevcut.aktifKoltuk === undefined) { return; }
    if (!mevcut.aksiyonSuresiBitis || Date.now() < mevcut.aksiyonSuresiBitis) { return; }
    const koltukIndex = mevcut.aktifKoltuk;
    const koltuk = mevcut.koltuklar[koltukIndex];
    const elIndex = activeElIndex(koltuk);
    if (elIndex === -1) { return; }
    islenenKoltuk = koltukIndex;
    islenenEl = elIndex;
    const yeniEller = koltuk.eller.slice();
    yeniEller[elIndex] = Object.assign({}, yeniEller[elIndex], { durum: 'kaldi' });
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }).then((res) => {
    if (res.committed && islenenKoltuk !== null) { siraSonrakiEliyaGec(res.snapshot.val(), islenenKoltuk, islenenEl); }
  });
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
    // Aynı koltuk, sıradaki (bölünmüş) el -- süre de sıfırlanır.
    database.ref('/').update({
      [dbPath(MASA_YOLU + '/aktifKoltuk')]: koltukIndex,
      [dbPath(MASA_YOLU + '/aksiyonSuresiBitis')]: Date.now() + AKSIYON_SURESI_MS
    });
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
    cipYiginiHtml(el.bahisMiktari) + sonucEtiket +
    '</div>';
}
// Bahis tutarını gerçek çip görsellerinden bir yığın olarak gösterir (aç gözlü
// ayrıştırma: en büyük değerden başlayıp en fazla 5 çip -- kullanıcı isteği:
// "bizim çipleri kullanacağız", tam sayı da altında okunur kalsın diye.
function cipYiginiHtml(miktar) {
  if (!miktar) { return ''; }
  const kalanlar = [];
  let kalan = miktar;
  const azalanDegerler = CIP_DEGERLERI.slice().sort((a, b) => b - a);
  azalanDegerler.forEach((v) => { while (kalan >= v && kalanlar.length < 5) { kalanlar.push(v); kalan -= v; } });
  const imgHtml = kalanlar.map((v) => '<img class="bj-cip-gorsel" src="' + cipGorselYolu(v) + '" alt="">').join('');
  return '<div class="bj-cip-yigin">' + imgHtml + '</div><div class="bj-bahis-mevcut">' + miktar + ' çip</div>';
}

// Avatarın etrafındaki kazanma (yeşil)/kaybetme (kırmızı) halkası -- kullanıcı
// isteği: "kazanınca yeşil çember kaybedince kırmızı". Bölünmüş elde ilk elin
// sonucu esas alınır (çoğunlukla tek el olduğu için yeterli).
function avatarCemberSinifi(koltuk) {
  if (!koltuk.eller || !koltuk.eller[0] || !koltuk.eller[0].sonuc) { return ''; }
  const sonuc = koltuk.eller[0].sonuc;
  if (sonuc === 'kazandi' || sonuc === 'blackjack') { return ' bj-cember-kazandi'; }
  if (sonuc === 'kaybetti') { return ' bj-cember-kaybetti'; }
  return '';
}

function koltukHtml(koltukIndex, koltuk, table, benimKoltuk) {
  if (!koltuk || !koltuk.uid) {
    if (benimKoltuk !== null) { return '<div class="bj-koltuk bj-koltuk-bos"></div>'; }
    return '<div class="bj-koltuk bj-koltuk-bos"><button type="button" class="bj-otur-btn" data-bj-otur="' + koltukIndex + '" title="Otur" aria-label="Otur">+</button></div>';
  }
  const benimMi = koltuk.uid === currentUserUid;
  const avatarHtml = '<div class="bj-avatar-cember' + avatarCemberSinifi(koltuk) + '">' + renderStaffAvatar(koltuk.isim, koltuk.uid, koltuk.isim, 40) + '</div>';
  const aktifMi = table.aktifKoltuk === koltukIndex;
  let icerik;
  if (table.durum === 'bahis_bekleniyor') {
    if (benimMi) {
      icerik = '<div class="bj-bahis-secim">' + CIP_DEGERLERI.filter((v) => v <= myChipBalance).map((v) =>
        '<button type="button" class="bj-cip-btn" data-bj-bahis="' + koltukIndex + '" data-miktar="' + v + '"><img class="bj-cip-gorsel" src="' + cipGorselYolu(v) + '" alt=""><span class="bj-cip-deger">' + v + '</span></button>'
      ).join('') + '</div>' +
        (koltuk.bahis ? cipYiginiHtml(koltuk.bahis) : '<div class="bj-bahis-mevcut bj-bahis-yok">Bahis yok</div>');
    } else {
      // Diğer oyuncular için sade görünüm -- kullanıcı isteği: "sadece avatar
      // ve kartları gözükecek" (metin etiketleri değil).
      icerik = koltuk.bahis ? cipYiginiHtml(koltuk.bahis) : '';
    }
  } else if (koltuk.eller) {
    icerik = koltuk.eller.map((el, i) => elHtml(el, koltuk.uid) + ((aktifMi && i === activeElIndex(koltuk)) ? '<span class="bj-sira-isareti">◀ sırası</span>' : '')).join('');
  } else {
    icerik = '';
  }
  return '<div class="bj-koltuk' + (aktifMi ? ' bj-koltuk-aktif' : '') + (benimMi ? ' bj-koltuk-ben' : '') + '">' +
    '<div class="bj-koltuk-oyuncu">' + avatarHtml + '<span>' + escapeHtml(koltuk.isim || '') + '</span></div>' +
    icerik +
    (benimMi && table.durum === 'bahis_bekleniyor' ? '<button type="button" class="btn btn-ghost bj-kalk-btn" data-bj-kalk="' + koltukIndex + '">Kalk</button>' : '') +
    '</div>';
}
function activeElIndex(koltuk) {
  if (!koltuk.eller) { return -1; }
  for (let i = 0; i < koltuk.eller.length; i++) { if (koltuk.eller[i].durum === 'oynuyor') { return i; } }
  return -1;
}

function renderKrupiyer(table) {
  const el = document.querySelector('[data-bj-krupiyer]');
  if (el) {
    if (!table.kurpiyerEli) {
      el.innerHTML = '<div class="bj-krupiyer-bos">Bahisler bekleniyor…</div>';
    } else {
      const acikMi = table.kurpiyerEli.acikMi;
      const kartlarHtml = table.kurpiyerEli.kartlar.map((k, i) => kartHtml(k, currentUserUid, i === 1 && !acikMi)).join('');
      // Gerçek kumarhanede kapalı kart açılana kadar sadece AÇIK kartın değeri
      // görünür -- kullanıcı bildirimi: "kurpiyerin toplamı yok".
      // NOT: kademeli dağıtım animasyonu sırasında krupiyerin İLK kartı henüz
      // gelmemiş olabilir (kirpilmisTabloOlustur ile kartlar kırpılıyor) --
      // kartlar[0] o an undefined olabilir, kartDegeri'ne öyle geçmemeli.
      const toplamHtml = acikMi
        ? (() => { const d = elDegerlendir(table.kurpiyerEli.kartlar); return '<div class="bj-el-toplam">' + d.toplam + (d.battiMi ? ' (Battı)' : '') + '</div>'; })()
        : (table.kurpiyerEli.kartlar[0] ? '<div class="bj-el-toplam bj-el-toplam-kismi">Görünen: ' + kartDegeri(table.kurpiyerEli.kartlar[0]) + '</div>' : '');
      el.innerHTML = '<div class="bj-el-kartlar">' + kartlarHtml + '</div>' + toplamHtml;
    }
  }
  renderDesteYigini(table);
}

// Kalan kart yığını (deste) -- sadece kozmetik, deste-arkası görselinden
// üst üste bindirilmiş sabit bir yığın (kullanıcı bildirimi: "krupiyerin
// kartları kenarda olmalı, deste arkaları gözükmeli").
function renderDesteYigini(table) {
  const el = document.querySelector('[data-bj-deste-yigini]');
  if (!el) { return; }
  const kalan = table.deste ? (table.deste.length - (table.desteIndex || 0)) : TOPLAM_KART_SAYISI;
  if (kalan <= 0) { el.innerHTML = ''; return; }
  const KART_SAYISI_GORUNEN = 4;
  let html = '';
  for (let i = 0; i < KART_SAYISI_GORUNEN; i++) { html += '<img class="bj-deste-kart" src="' + desteArkasiYolu() + '" alt="">'; }
  html += '<div class="bj-deste-sayac">' + kalan + '</div>';
  el.innerHTML = html;
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

function renderAksiyonSayaci(table) {
  const el = document.querySelector('[data-bj-aksiyon-sayac]');
  if (!el) { return; }
  if (table.durum !== 'oyunculuk' || !table.aksiyonSuresiBitis) { el.textContent = ''; if (aksiyonCountdownTimer) { clearInterval(aksiyonCountdownTimer); aksiyonCountdownTimer = null; } return; }
  if (aksiyonCountdownTimer) { clearInterval(aksiyonCountdownTimer); }
  const koltuk = table.koltuklar[table.aktifKoltuk];
  const isim = koltuk ? koltuk.isim : '';
  const tick = () => {
    const kalanMs = table.aksiyonSuresiBitis - Date.now();
    if (kalanMs <= 0) { el.textContent = 'Süre doldu…'; clearInterval(aksiyonCountdownTimer); aksiyonCountdownTimer = null; aksiyonSuresiDolunca(); return; }
    el.textContent = escapeHtml(isim || 'Sıradaki') + ' için: ' + Math.ceil(kalanMs / 1000) + ' sn';
  };
  tick();
  aksiyonCountdownTimer = setInterval(tick, 250);
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

// Koltuklar HTML'i, bir önceki render ile AYNIYSA yeniden yazılmaz -- kullanıcı
// bildirimi: boş koltuklardaki "+" düğmeleri "yanıp sönüyor". Kök neden: masa
// belgesi aktif oyunda ÇOK sık değişiyor (her vur/kal/krupiyer adımı) ve
// `.on('value')` HER değişiklikte tetikleniyor; koltuklar HTML'i her seferinde
// sıfırdan yazılınca (hiçbir şey görsel olarak değişmese bile) tarayıcı aynı
// düğmeleri yok edip yeniden yaratıyor -- kısa bir flaş/kaybolma hissi veriyor.
let sonKoltuklarImzasi = null;

// ── Kademeli dağıtım animasyonu (madde 1: "kartlar bana spawn oluyor") ──
// bahisSuresiDolunca TÜM eli TEK transaction'da yazıyor -- elimizde zaten
// NİHAİ veri var, sunucuya ekstra istek atmadan YEREL olarak kademeli açığa
// çıkarılıyor: gerçek kumarhane sırası (koltuklar artan indeksle 1. tur,
// krupiyer açık, 2. tur, krupiyer kapalı).
let sonAnimeEdilenElNo = -1;
const DAGITIM_ADIM_MS = 300;

function renderMasa(table) {
  const yeniDagitimMi = table.elNo && table.elNo !== sonAnimeEdilenElNo &&
    (table.durum === 'oyunculuk' || table.durum === 'kurpiyer_sirasi') &&
    table.koltuklar && Object.keys(table.koltuklar).some((i) => table.koltuklar[i] && table.koltuklar[i].eller);
  if (yeniDagitimMi) {
    sonAnimeEdilenElNo = table.elNo;
    dagitimAnimasyonuOynat(table);
    return;
  }
  renderMasaGercek(table);
}

function kirpilmisTabloOlustur(table, bahisliKoltuklar, koltukSayaclari, krupiyerSayaci) {
  const kopya = Object.assign({}, table);
  kopya.koltuklar = Object.assign({}, table.koltuklar);
  bahisliKoltuklar.forEach((i) => {
    const koltuk = table.koltuklar[i];
    const sayi = koltukSayaclari[i] || 0;
    kopya.koltuklar[i] = Object.assign({}, koltuk, {
      eller: [Object.assign({}, koltuk.eller[0], { kartlar: koltuk.eller[0].kartlar.slice(0, sayi), durum: 'oynuyor', sonuc: undefined, odeme: undefined })]
    });
  });
  if (table.kurpiyerEli) {
    kopya.kurpiyerEli = Object.assign({}, table.kurpiyerEli, { kartlar: table.kurpiyerEli.kartlar.slice(0, krupiyerSayaci), acikMi: false });
  }
  // Animasyon adımları sırasında aksiyon çubuğu/sayaç/aktif koltuk vurgusu
  // henüz devreye girmesin -- bahis_bekleniyor gibi "sakin" bir görünüm.
  kopya.durum = 'bahis_bekleniyor';
  kopya.aktifKoltuk = null;
  return kopya;
}

function dagitimAnimasyonuOynat(table) {
  const bahisliKoltuklar = [];
  for (let i = 0; i < MAX_KOLTUK; i++) { if (table.koltuklar && table.koltuklar[i] && table.koltuklar[i].eller) { bahisliKoltuklar.push(i); } }
  const adimlar = [];
  for (let tur = 0; tur < 2; tur++) {
    bahisliKoltuklar.forEach((i) => adimlar.push(i));
    adimlar.push('krupiyer');
  }
  const koltukSayaclari = {};
  bahisliKoltuklar.forEach((i) => { koltukSayaclari[i] = 0; });
  let krupiyerSayaci = 0;
  let adimNo = 0;
  function birAdimOynat() {
    // NOT: bu setTimeout zinciri, dağıtım anındaki SABİT bir tablo görüntüsünü
    // kademeli açığa çıkarıyor -- zincir bitene kadar (~2 sn) başka bir
    // istemcinin yaptığı değişiklik burada YANSIMAZ, ama zincir bitince
    // renderMasaGercek(table) NİHAİ (o anki en güncel olmayan, dağıtım anındaki)
    // veriyle render eder; hemen ardından gelecek bir sonraki `value` tetiklemesi
    // (Firebase zaten sürekli dinlediği için) tabloyu anında güncel hale getirir.
    if (adimNo >= adimlar.length) { renderMasaGercek(table); return; }
    const adim = adimlar[adimNo]; adimNo++;
    if (adim === 'krupiyer') { krupiyerSayaci++; } else { koltukSayaclari[adim]++; }
    renderMasaGercek(kirpilmisTabloOlustur(table, bahisliKoltuklar, koltukSayaclari, krupiyerSayaci), true);
    setTimeout(birAdimOynat, DAGITIM_ADIM_MS);
  }
  birAdimOynat();
}

function renderMasaGercek(table, geciciMi) {
  if (!geciciMi) { currentTable = table; }
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
      if (html !== sonKoltuklarImzasi) { sonKoltuklarImzasi = html; koltuklarEl.innerHTML = html; }
    }
    renderKrupiyer(table);
    renderBahisSayaci(table);
    renderAksiyonSayaci(table);
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
