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
// Dağıtım animasyonu ve düşük performanslı telefonlar da bu sürenin içinde
// kalıyordu; 10 sn bazı cihazlarda oyuncu ilk kartlarını görmeden bitiyordu.
const AKSIYON_SURESI_MS = 30000;
const DESTE_STILLERI = ['temel', 'altin', 'celik'];
const VARSAYILAN_TEMA = 'varsayilan';
const KOLEKSIYON_DOSYA_ON_EKI = 'koleksiyon-';
// Bunlar ek bir oyun kartı/değer değil: mevcut "joker" (vale) rütbesinin
// arada gelen özel görsel varyantlarıdır. Hepsi normal vale gibi 10 sayılır.
// Dosya listesi sabit tutulur; kullanıcıdan gelen bir yol asla <img>'e yazılmaz.
const BONUS_JOKER_DOSYALARI = ['Jokers1.png', 'Jokers11.png', 'Jokers24.png', 'Jokers37.png', 'Jokers48.png', 'Jokers60.png', 'Jokers73.png', 'Jokers83.png', 'Jokers100.png', 'Jokers112.png', 'Jokers124.png', 'Jokers140.png'];
const CIP_ISLEM_KAYIT_LIMITI = 80;

let database = null;
let currentUserUid = '';
let currentUserName = '';
let currentUserEmail = '';
let canPlay = false;

let currentTable = null;
let myChipBalance = 0;
let mySkin = { desteStili: 'temel', yuzKartiTemasi: VARSAYILAN_TEMA };
let skinCache = {}; // uid -> {desteStili, yuzKartiTemasi}
const skinListeners = new Map(); // uid -> { ref, listener }
let walletRef = null;
let walletListener = null;
let myWalletOperationIds = new Set();
const pendingChipOperations = new Set();
let countdownTimer = null;
let aksiyonCountdownTimer = null;
let countdownSignature = '';
let aksiyonCountdownSignature = '';
let tableRef = null;
let tableListener = null;
let attachedTablePath = '';
let phaseWatchdog = null;
let activeDistribution = null;
let lastSeatOrderSignature = '';
const renderedSeatSignatures = new Map();
let lastDealerSignature = '';
let lastDeckSignature = '';
let lastActionSignature = '';
let lastBetPanelSignature = '';
let pendingTableOperation = null;
let playerActionPending = false;
let tableError = '';
let modeReady = false;

function masaBaglami() {
  return { yol: dbPath(MASA_YOLU), cuzdan: cuzdanYolu(currentUserUid), uid: currentUserUid, elNo: (currentTable && currentTable.elNo) || 0 };
}

function renderIslemDurumu() {
  const durum = document.querySelector('[data-bj-durum]');
  const metin = tableError || (playerActionPending || pendingTableOperation ? 'İşlem onaylanıyor…' : '');
  if (durum && durum.textContent !== metin) { durum.textContent = metin; }
  const tekrar = document.querySelector('[data-bj-yeniden-dene]');
  if (tekrar) { tekrar.hidden = !tableError; }
  document.querySelectorAll('[data-bj-root] button:not([data-bj-yeniden-dene])').forEach((button) => {
    button.disabled = !!(tableError || pendingTableOperation || playerActionPending || !canPlay || isReadOnly());
  });
}

function masaHatasi(err) {
  tableError = err && err.code === 'PERMISSION_DENIED'
    ? 'Masa güncellenemedi: oyun için yazma izni bulunmuyor.'
    : 'Masa güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.';
  renderIslemDurumu();
}

// Firebase'in tahmini yerel yazıları faz dinleyicisini yeniden tetikliyordu.
// Yalnız sunucunun onayladığı masa yayınlanır; aynı istemci ikinci bir masa
// işlemini ilk işlem tamamlanmadan başlatamaz. Ret halinde otomatik döngü durur.
function masaIslemi(guncelle, baglam = masaBaglami()) {
  if (pendingTableOperation || tableError || !canPlay || !modeReady || isReadOnly()) {
    return Promise.resolve({ committed: false, beklemede: true });
  }
  const islem = { baglam };
  pendingTableOperation = islem;
  renderIslemDurumu();
  return Promise.resolve().then(() => database.ref(baglam.yol).transaction((mevcut) => {
    if (baglam.uid !== currentUserUid || baglam.yol !== dbPath(MASA_YOLU) || isReadOnly()) { return; }
    if (mevcut && (mevcut.elNo || 0) !== baglam.elNo) { return; }
    return guncelle(mevcut ? JSON.parse(JSON.stringify(mevcut)) : mevcut);
  }, undefined, false)).catch((err) => {
    if (baglam.uid === currentUserUid && baglam.yol === dbPath(MASA_YOLU)) { masaHatasi(err); }
    return { committed: false, hata: err };
  }).finally(() => {
    if (pendingTableOperation === islem) { pendingTableOperation = null; }
    renderIslemDurumu();
  });
}

function oyuncuIslemi(islem) {
  if (playerActionPending || pendingTableOperation || tableError || !canPlay || !modeReady || activeDistribution) { return; }
  playerActionPending = true;
  renderIslemDurumu();
  Promise.resolve().then(islem).catch(masaHatasi).finally(() => {
    playerActionPending = false;
    renderIslemDurumu();
  });
}

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function benimKoltukIndex(table) {
  if (!table || !table.koltuklar) { return null; }
  for (let i = 0; i < MAX_KOLTUK; i++) {
    if (table.koltuklar[i] && table.koltuklar[i].uid === currentUserUid) { return i; }
  }
  return null;
}

// ── Kart görsel yolu -- kullanıcının seçtiği stil/temaya göre. ──
function normalleSkin(raw) {
  const skin = raw && typeof raw === 'object' ? raw : {};
  const desteStili = DESTE_STILLERI.includes(skin.desteStili) ? skin.desteStili : 'temel';
  const tema = typeof skin.yuzKartiTemasi === 'string' ? skin.yuzKartiTemasi : VARSAYILAN_TEMA;
  const temaGecerliMi = tema === VARSAYILAN_TEMA || collabKodlari().some((kod) => tema === kod + '-1' || tema === kod + '-2');
  return { desteStili, yuzKartiTemasi: temaGecerliMi ? tema : VARSAYILAN_TEMA };
}
function varsayilanKartGorselYolu(kart, stil = 'temel') {
  const rutbeKodlari = { as: '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06', '7': '07', '8': '08', '9': '09', '10': '10', joker: '11', kiz: '12', papaz: '13' };
  const rutbe = kart && rutbeKodlari[kart.r] ? kart.r : 'as';
  const rutbeNo = rutbeKodlari[rutbe];
  const takim = kart && ['kupa', 'sinek', 'karo', 'maca'].includes(kart.s) ? kart.s : 'kupa';
  const guvenliStil = DESTE_STILLERI.includes(stil) ? stil : 'temel';
  return '/assets/blackjack/kartlar/varsayilan/' + guvenliStil + '/' + rutbeNo + '-' + rutbe + '-' + takim + '.png';
}
function bonusJokerGorselYolu(dosya) {
  return '/assets/blackjack/Joker%20Kartlar%C4%B1/' + encodeURIComponent(dosya);
}
function yuzKartiGorselYolu(tema, rutbe) {
  return '/assets/blackjack/yuz-kartlari-koleksiyon/' + KOLEKSIYON_DOSYA_ON_EKI + tema + '-' + rutbe + '.png';
}
function kartGorselYolu(kart, uid) {
  const skin = skinCache[uid] || { desteStili: 'temel', yuzKartiTemasi: VARSAYILAN_TEMA };
  if (kart && kart.r === 'joker' && BONUS_JOKER_DOSYALARI.includes(kart.bonusJokerGorseli)) {
    return bonusJokerGorselYolu(kart.bonusJokerGorseli);
  }
  const yuzKartiMi = kart.r === 'joker' || kart.r === 'kiz' || kart.r === 'papaz';
  if (yuzKartiMi && skin.yuzKartiTemasi && skin.yuzKartiTemasi !== VARSAYILAN_TEMA) {
    // Tek tema seçimi Vale + Kız + Papaz'ın aynı koleksiyondaki üçlüsünü
    // birlikte değiştirir; tek tek kart seçimi yoktur.
    return yuzKartiGorselYolu(skin.yuzKartiTemasi, kart.r);
  }
  return varsayilanKartGorselYolu(kart, skin.desteStili);
}
function desteArkasiYolu() { return '/assets/blackjack/deste-arkalari/deste-arkasi-01.png'; }

// ── Skin ayarları ──
function skinYolu(uid) { return dbPath('blackjackAyarlari/' + uid); }
function skinDinlemeyiBaslat(uid) {
  if (!database || !uid || skinListeners.has(uid)) { return; }
  const ref = database.ref(skinYolu(uid));
  const listener = (snap) => {
    const sonraki = normalleSkin(snap.val());
    const onceki = skinCache[uid];
    skinCache[uid] = sonraki;
    if (uid === currentUserUid) { mySkin = sonraki; }
    if (JSON.stringify(onceki) !== JSON.stringify(sonraki) && currentTable) { renderMasa(currentTable); }
  };
  skinListeners.set(uid, { ref, listener });
  ref.on('value', listener);
}
function skinDinlemeleriniEsitle(table) {
  const gerekenler = new Set();
  if (currentUserUid) { gerekenler.add(currentUserUid); }
  for (let i = 0; i < MAX_KOLTUK; i++) {
    const uid = table && table.koltuklar && table.koltuklar[i] && table.koltuklar[i].uid;
    if (uid) { gerekenler.add(uid); }
  }
  skinListeners.forEach(({ ref, listener }, uid) => {
    if (!gerekenler.has(uid)) { ref.off('value', listener); skinListeners.delete(uid); delete skinCache[uid]; }
  });
  gerekenler.forEach((uid) => skinDinlemeyiBaslat(uid));
}
function skinDinlemeleriniTemizle() {
  skinListeners.forEach(({ ref, listener }) => ref.off('value', listener));
  skinListeners.clear();
  skinCache = {};
}
function loadSkinFor(uid) {
  skinDinlemeyiBaslat(uid);
  if (skinCache[uid]) { return Promise.resolve(skinCache[uid]); }
  return database.ref(skinYolu(uid)).once('value').then((snap) => {
    const v = normalleSkin(snap.val());
    skinCache[uid] = v;
    if (uid === currentUserUid) { mySkin = v; }
    return v;
  });
}
// Skin seçimi önizlemeleri -- kullanıcı isteği: "hangisini seçtiğimizi
// bilelim" (sade metin/radio yerine gerçek kart görseli).
function stilOnizlemeYolu(stil) { return '/assets/blackjack/kartlar/varsayilan/' + stil + '/07-7-kupa.png'; }
function temaUcluOnizlemeHtml(tema) {
  const yollar = ['joker', 'kiz', 'papaz'].map((rutbe) => tema === VARSAYILAN_TEMA
    ? varsayilanKartGorselYolu({ r: rutbe, s: 'kupa' })
    : yuzKartiGorselYolu(tema, rutbe));
  return '<span class="bj-skin-uclu">' + yollar.map((src) => '<img class="bj-skin-onizleme" src="' + src + '" alt="">').join('') + '</span>';
}
function openSkinModal() {
  loadSkinFor(currentUserUid).then(() => {
    const stilHtml = DESTE_STILLERI.map((s) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-destestili" value="' + s + '"' + (mySkin.desteStili === s ? ' checked' : '') + '><img class="bj-skin-onizleme" src="' + stilOnizlemeYolu(s) + '" alt=""> ' + escapeHtml(s === 'temel' ? 'Sade' : s === 'altin' ? 'Altın' : 'Çelik') + '</label>'
    ).join('');
    const temaSecenekleri = ['varsayilan'].concat(collabKodlari().flatMap((kod) => [kod + '-1', kod + '-2']));
    const temaHtml = temaSecenekleri.map((t) =>
      '<label class="bj-skin-secenek"><input type="radio" name="bj-tema" value="' + t + '"' + (mySkin.yuzKartiTemasi === t ? ' checked' : '') + '>' + temaUcluOnizlemeHtml(t) + '<span>' + escapeHtml(t === 'varsayilan' ? 'Varsayılan üçlü' : t) + '</span></label>'
    ).join('');
    showModal({
      title: 'Kart Skinleri',
      body: '<div class="bj-skin-grup"><h4>Deste Stili</h4>' + stilHtml + '</div><div class="bj-skin-grup"><h4>Vale + Kız + Papaz üçlüsü</h4><p class="hint">Tek seçim, aynı koleksiyondaki üç kartı birlikte değiştirir.</p><div class="bj-skin-tema-liste">' + temaHtml + '</div></div>',
      actions: [
        {
          label: 'Kaydet', variant: 'primary', action: ({ dialog }) => {
            const stil = dialog.querySelector('input[name="bj-destestili"]:checked').value;
            const tema = dialog.querySelector('input[name="bj-tema"]:checked').value;
            database.ref(skinYolu(currentUserUid)).set({ desteStili: stil, yuzKartiTemasi: tema }).then(() => {
              skinCache[currentUserUid] = normalleSkin({ desteStili: stil, yuzKartiTemasi: tema });
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
function cuzdanYolu(uid) { return dbPath('cipBakiyeleri/' + uid); }
function temizIslemListesi(islemler) {
  const kaynak = islemler && typeof islemler === 'object' ? islemler : {};
  const anahtarlar = Object.keys(kaynak);
  if (anahtarlar.length <= CIP_ISLEM_KAYIT_LIMITI) { return Object.assign({}, kaynak); }
  return anahtarlar
    .sort((a, b) => ((kaynak[a] && kaynak[a].ts) || 0) - ((kaynak[b] && kaynak[b].ts) || 0))
    .slice(-(CIP_ISLEM_KAYIT_LIMITI - 1))
    .reduce((sonuc, anahtar) => Object.assign(sonuc, { [anahtar]: kaynak[anahtar] }), {});
}
function normalleCuzdan(raw, uid) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    const migrasyonId = 'blackjack:migrasyon:' + uid;
    return { bakiye: raw, sonIslemId: migrasyonId, islemler: { [migrasyonId]: { delta: raw, kaynak: 'migrasyon', ts: Date.now() } }, legacyMi: true };
  }
  const deger = raw && typeof raw === 'object' ? raw : {};
  return {
    bakiye: Number.isFinite(deger.bakiye) && deger.bakiye >= 0 ? deger.bakiye : 0,
    sonIslemId: typeof deger.sonIslemId === 'string' ? deger.sonIslemId : '',
    islemler: temizIslemListesi(deger.islemler),
    legacyMi: false
  };
}
function bootstrapCuzdan(uid) {
  const bootstrapId = 'blackjack:bootstrap:' + uid;
  const ref = database.ref(cuzdanYolu(uid));
  return ref.transaction((mevcut) => {
    if (mevcut === null || mevcut === undefined) {
      return { bakiye: BASLANGIC_BAKIYESI, sonIslemId: bootstrapId, islemler: { [bootstrapId]: { delta: BASLANGIC_BAKIYESI, kaynak: 'baslangic', ts: Date.now() } } };
    }
    const cuzdan = normalleCuzdan(mevcut, uid);
    if (cuzdan.legacyMi) {
      const { legacyMi: _legacyMi, ...migrasyon } = cuzdan;
      return migrasyon;
    }
  }, undefined, false);
}
function subscribeMyBalance() {
  if (!currentUserUid) { return; }
  if (walletRef && walletListener) { walletRef.off('value', walletListener); }
  walletRef = database.ref(cuzdanYolu(currentUserUid));
  walletListener = (snap) => {
    if (!snap.exists()) {
      myChipBalance = null;
      renderBakiye();
      bootstrapCuzdan(currentUserUid).catch((err) => console.error('Başlangıç çipi oluşturulamadı:', err));
      return;
    }
    const cuzdan = normalleCuzdan(snap.val(), currentUserUid);
    myChipBalance = cuzdan.bakiye;
    myWalletOperationIds = new Set(Object.keys(cuzdan.islemler));
    renderBakiye();
    if (currentTable && !activeDistribution) {
      renderBahisPaneli(currentTable, benimKoltukIndex(currentTable));
      renderIslemDurumu();
    }
    if (cuzdan.legacyMi) { bootstrapCuzdan(currentUserUid).catch((err) => console.error('Çip bakiyesi dönüştürülemedi:', err)); }
  };
  walletRef.on('value', walletListener);
}
function renderBakiye() {
  const el = document.querySelector('[data-bj-bakiye]');
  if (el) { el.textContent = (myChipBalance === null ? '…' : myChipBalance.toLocaleString('tr-TR')) + ' çip'; }
}
function bakiyeGuncelle(uid, delta, islemId, kaynak, yol = cuzdanYolu(uid)) {
  if (!uid || uid !== currentUserUid || !Number.isFinite(delta) || !islemId || !kaynak) {
    return Promise.resolve({ committed: false, gecersiz: true });
  }
  if (pendingChipOperations.has(islemId)) {
    return Promise.resolve({ committed: false, beklemede: true });
  }
  if (myWalletOperationIds.has(islemId)) {
    return Promise.resolve({ committed: true, tekrar: true });
  }
  pendingChipOperations.add(islemId);
  let yetersizBakiye = false;
  return database.ref(yol).transaction((mevcut) => {
    const cuzdan = normalleCuzdan(mevcut, uid);
    if (cuzdan.islemler[islemId]) { return; }
    const yeniBakiye = cuzdan.bakiye + delta;
    if (yeniBakiye < 0) { yetersizBakiye = true; return; }
    const yeniIslemler = temizIslemListesi(cuzdan.islemler);
    // Yeni işlem eklenmeden önce kayıt sınırında bir yer boşaltılır. Böylece
    // sınır her yazıda korunur, tam sınırdaki eski kayıt durup dururken silinmez.
    const islemAnahtarlari = Object.keys(yeniIslemler);
    if (islemAnahtarlari.length >= CIP_ISLEM_KAYIT_LIMITI) {
      const enEski = islemAnahtarlari.sort((a, b) => ((yeniIslemler[a] && yeniIslemler[a].ts) || 0) - ((yeniIslemler[b] && yeniIslemler[b].ts) || 0))[0];
      delete yeniIslemler[enEski];
    }
    yeniIslemler[islemId] = { delta, kaynak, ts: Date.now() };
    return { bakiye: yeniBakiye, sonIslemId: islemId, islemler: yeniIslemler };
  }, undefined, false).then((res) => {
    const yeni = normalleCuzdan(res.snapshot && res.snapshot.val(), uid);
    const tekrar = Boolean(yeni.islemler[islemId]) && !res.committed;
    if (res.committed || tekrar) { myWalletOperationIds.add(islemId); }
    return { committed: res.committed || tekrar, tekrar, yetersizBakiye };
  }).catch((err) => {
    console.error('Çip bakiyesi güncellenemedi:', err);
    return { committed: false, hata: err };
  }).finally(() => pendingChipOperations.delete(islemId));
}

// ── Oturma / kalkma ──
function otur(koltukIndex) {
  if (!canPlay) { showToast('Oynamak için giriş yapmalısınız.', { variant: 'error' }); return; }
  if (!Number.isInteger(koltukIndex) || koltukIndex < 0 || koltukIndex >= MAX_KOLTUK) { return; }
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'bahis_bekleniyor') { return; }
    const koltuklar = Object.assign({}, mevcut.koltuklar || {});
    // Sadece ekrandaki eski state'e değil, transaction'ın güncel masa haline
    // bakılır; böylece aynı hesap iki sekmede iki koltuğa oturamaz.
    if (Object.keys(koltuklar).some((i) => koltuklar[i] && koltuklar[i].uid === currentUserUid)) { return; }
    if (koltuklar[koltukIndex] && koltuklar[koltukIndex].uid) { return; }
    koltuklar[koltukIndex] = { uid: currentUserUid, isim: currentUserName || currentUserEmail, bahis: null, katilimDurumu: 'hazir' };
    return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
  }).then((res) => {
    if (!res.committed) { showToast('Bu koltuk dolu veya el başlamış.', { variant: 'error' }); }
  });
}
function kalk(koltukIndex) {
  if (!Number.isInteger(koltukIndex) || koltukIndex < 0 || koltukIndex >= MAX_KOLTUK) { return; }
  const baglam = masaBaglami();
  let iadeMiktari = 0;
  let iadeElNo = 0;
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'bahis_bekleniyor') { return; }
    const koltuk = mevcut.koltuklar && mevcut.koltuklar[koltukIndex];
    if (!koltuk || koltuk.uid !== currentUserUid) { return; }
    iadeMiktari = Number(koltuk.bahis) || 0;
    iadeElNo = (mevcut.elNo || 0) + 1;
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    koltuklar[koltukIndex] = null;
    return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
  }, baglam).then((res) => {
    if (!res.committed) { showToast('El bitmeden veya başka bir kullanıcının koltuğundan kalkamazsınız.', { variant: 'error' }); return; }
    if (iadeMiktari > 0) {
      return bakiyeGuncelle(baglam.uid, iadeMiktari, 'blackjack:' + iadeElNo + ':koltuk:' + koltukIndex + ':kalk-iade:' + window.crypto.randomUUID(), 'iade', baglam.cuzdan)
        .then((sonuc) => { if (!sonuc.committed) { showToast('Bahis iadesi bekliyor; sayfayı açık tutun.', { variant: 'error' }); } });
    }
  });
}

// ── Bahis ──
function bahisYap(koltukIndex, miktar) {
  // Tıklanan çip miktarı MEVCUT bahise EKLENİR (üzerine yazılmaz) -- kullanıcı
  // isteği: "2 kere 100'e basınca 200 olması lazım". Bakiye kontrolü toplam
  // (mevcut bahis + eklenen) üzerinden yapılır.
  if (!currentTable || currentTable.durum !== 'bahis_bekleniyor' || !CIP_DEGERLERI.includes(miktar)) { return; }
  const yerelKoltuk = currentTable.koltuklar && currentTable.koltuklar[koltukIndex];
  if (!yerelKoltuk || yerelKoltuk.uid !== currentUserUid) { return; }
  const oncekiBahis = Number(yerelKoltuk.bahis) || 0;
  if (!Number.isFinite(myChipBalance) || miktar > myChipBalance) { showToast('Yetersiz bakiye.', { variant: 'error' }); return; }
  const gelecekElNo = (currentTable.elNo || 0) + 1;
  const baglam = masaBaglami();
  const islemId = 'blackjack:' + gelecekElNo + ':koltuk:' + koltukIndex + ':bahis:' + oncekiBahis + ':' + miktar + ':' + window.crypto.randomUUID();

  // Çip önce rezervasyon olarak düşer, ardından bahis güncel masaya yazılır.
  // İkinci adım yarışta kaybederse aynı işlem kimliğiyle iade edilir; bu, eski
  // "dağıtımdan sonra düş" akışındaki ücretsiz bahis penceresini kapatır.
  return bakiyeGuncelle(baglam.uid, -miktar, islemId, 'bahis', baglam.cuzdan).then((bakiyeSonucu) => {
    if (bakiyeSonucu.beklemede) { return; }
    if (!bakiyeSonucu.committed) {
      showToast(bakiyeSonucu.yetersizBakiye ? 'Yetersiz bakiye.' : 'Bahis için çip ayrılamadı.', { variant: 'error' });
      return;
    }
    return masaIslemi((mevcut) => {
      if (!mevcut || mevcut.durum !== 'bahis_bekleniyor') { return; }
      const koltuk = mevcut.koltuklar && mevcut.koltuklar[koltukIndex];
      if (!koltuk || koltuk.uid !== currentUserUid || (Number(koltuk.bahis) || 0) !== oncekiBahis) { return; }
      const koltuklar = Object.assign({}, mevcut.koltuklar);
      koltuklar[koltukIndex] = Object.assign({}, koltuk, { bahis: oncekiBahis + miktar, katilimDurumu: 'hazir' });
      return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
    }, baglam).then((res) => {
      if (res.committed) { return; }
      const iadeId = islemId + ':iade';
      return bakiyeGuncelle(baglam.uid, miktar, iadeId, 'iade', baglam.cuzdan).then((iade) => showToast(iade.committed ? 'Bahis işlenemedi; ayrılan çip iade edildi.' : 'Bahis iadesi tamamlanamadı.', { variant: iade.committed ? 'info' : 'error' }));
    });
  });
}

// ── El/koltuk yardımcıları ──
function eldekiOyuncuSayisi(table) {
  return Object.values(table.koltuklar || {}).filter((k) => k && k.eller && k.eller.length).length;
}
// Bahis penceresindeyken oturan (uid dolu) koltuk sayısı -- kullanıcı isteği:
// "tek kişi oynayınca geri sayım olmasın" (aksiyon sırası sayacı zaten
// eldekiOyuncuSayisi>1 ile aynı şekilde gizleniyordu, bahis sayacı için de
// aynı kural uygulanır).
function oturanKoltukSayisi(table) {
  return Object.values(table.koltuklar || {}).filter((k) => k && k.uid).length;
}

// Bahis kapanınca iade yapılamaz. Masadan yalnızca bu işlem gerçekten
// kaldırdıysa cüzdana geri yazılır; çift tıklama/çoklu sekme çip çoğaltamaz.
function bahsiGeriAl(koltukIndex) {
  const baglam = masaBaglami();
  const islemId = 'blackjack:' + (baglam.elNo + 1) + ':koltuk:' + koltukIndex + ':bahis-iade:' + window.crypto.randomUUID();
  let miktar = 0;
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'bahis_bekleniyor' || Date.now() >= mevcut.bahisSuresiBitis) { return; }
    const koltuk = mevcut.koltuklar && mevcut.koltuklar[koltukIndex];
    if (!koltuk || koltuk.uid !== baglam.uid || !(koltuk.bahis > 0)) { return; }
    miktar = koltuk.bahis;
    koltuk.bahis = null;
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  }, baglam).then((res) => {
    if (!res.committed) { return; }
    return bakiyeGuncelle(baglam.uid, miktar, islemId, 'iade', baglam.cuzdan).then((iade) => {
      showToast(iade.committed ? 'Bahsiniz geri alındı.' : 'Çip iadesi tamamlanamadı.', { variant: iade.committed ? 'info' : 'error' });
    });
  });
}

function sonrakiAktifElVarMi(table) {
  for (let i = 0; i < MAX_KOLTUK; i++) {
    const k = table.koltuklar && table.koltuklar[i];
    if (!k || !k.eller) { continue; }
    for (let e = 0; e < k.eller.length; e++) { if (k.eller[e].durum === 'oynuyor') { return { koltuk: i, el: e }; } }
  }
  return null;
}
function sonrakiSirayiAyarla(mevcut) {
  const sonraki = sonrakiAktifElVarMi(mevcut);
  if (sonraki) {
    mevcut.aktifKoltuk = sonraki.koltuk;
    mevcut.aksiyonSuresiBitis = eldekiOyuncuSayisi(mevcut) > 1 ? Date.now() + AKSIYON_SURESI_MS : null;
  } else {
    mevcut.durum = 'kurpiyer_sirasi';
    mevcut.aktifKoltuk = null;
    mevcut.aksiyonSuresiBitis = null;
  }
  mevcut.guncellemeTs = Date.now();
  return mevcut;
}
function odemeGecmisiniEkle(mevcut, koltuklar) {
  const gecmis = Object.assign({}, mevcut.odemeGecmisi || {});
  const buEl = {};
  Object.keys(koltuklar || {}).forEach((i) => {
    const koltuk = koltuklar[i];
    if (!koltuk || !koltuk.uid || !koltuk.eller) { return; }
    buEl[i] = { uid: koltuk.uid, odeme: koltuk.eller.reduce((toplam, el) => toplam + (Number(el.odeme) || 0), 0) };
  });
  gecmis[String(mevcut.elNo)] = { koltuklar: buEl };
  const eskiAnahtarlar = Object.keys(gecmis).sort((a, b) => Number(a) - Number(b));
  while (eskiAnahtarlar.length > 20) { delete gecmis[eskiAnahtarlar.shift()]; }
  mevcut.odemeGecmisi = gecmis;
}

// ── Faz geçişleri (transaction ile "kim yönetiyor" çözülür) ──
function bahisPenceresiniBaslat() {
  return masaIslemi((mevcut) => {
    if (mevcut && mevcut.durum && mevcut.durum !== 'el_sonucu' && mevcut.durum !== undefined) { return; }
    // NOT: Firebase transaction dönen değerle DÜĞÜMÜN TAMAMINI DEĞİŞTİRİR (birleştirmez) --
    // deste/desteIndex/elNo burada KORUNMAZSA her el yeni bir 208'lik deste
    // karılıyor (kullanıcı bildirimi: "kart sayısı her oyunda yeniden
    // yükseliyor"). Deste SADECE bahisSuresiDolunca'daki desteYeterliMi
    // kontrolü yetersiz derse yeniden karılmalı, her elin başında değil.
    const temiz = {
      durum: 'bahis_bekleniyor', bahisSuresiBitis: Date.now() + BAHIS_SURESI_MS, aktifKoltuk: null, aksiyonSuresiBitis: null, kurpiyerEli: null, guncellemeTs: Date.now(),
      deste: (mevcut && mevcut.deste) || null, desteIndex: (mevcut && mevcut.desteIndex) || 0, elNo: (mevcut && mevcut.elNo) || 0,
      odemeGecmisi: (mevcut && mevcut.odemeGecmisi) || {}
    };
    const koltuklar = (mevcut && mevcut.koltuklar) || {};
    Object.keys(koltuklar).forEach((i) => { if (koltuklar[i]) { koltuklar[i] = Object.assign({}, koltuklar[i], { bahis: null, eller: null, katilimDurumu: 'hazir' }); } });
    temiz.koltuklar = koltuklar;
    return temiz;
  });
}

function bahisSuresiDolunca() {
  return masaIslemi((mevcut) => {
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
    // Krupiyer açık → oyuncular açık → krupiyer kapalı → oyuncular açık.
    // Animasyon da desteden alınan kartlarla tam olarak aynı sırayı izler.
    const elBaslangic = {};
    bahisliKoltuklar.forEach((i) => { elBaslangic[i] = []; });
    const krupiyerKartlari = [deste[desteIndex]]; desteIndex++;
    bahisliKoltuklar.forEach((i) => { elBaslangic[i].push(deste[desteIndex]); desteIndex++; });
    krupiyerKartlari.push(deste[desteIndex]); desteIndex++;
    bahisliKoltuklar.forEach((i) => { elBaslangic[i].push(deste[desteIndex]); desteIndex++; });
    Object.values(koltuklar).forEach((k) => {
      if (k && !(k.bahis > 0)) { k.eller = null; k.katilimDurumu = 'sonraki-elde'; }
    });

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
    mevcut.aksiyonSuresiBitis = ilkAktif === undefined || bahisliKoltuklar.length === 1 ? null : Date.now() + AKSIYON_SURESI_MS;
    // Her el için artan numara, kalıcı cüzdan işlem anahtarlarında kullanılır.
    // Bahisler artık dağıtımdan ÖNCE rezerve edildiği için burada ikinci kez
    // tahsilat yapılmaz; sonuç ödemeleri de bu numarayla idempotent kalır.
    mevcut.elNo = (mevcut.elNo || 0) + 1;
    mevcut.guncellemeTs = Date.now();
    return mevcut;
  });
}

function krupiyerSirasiGeldi() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'kurpiyer_sirasi' || (mevcut.kurpiyerEli && mevcut.kurpiyerEli.acikMi)) { return; }
    const herkesBattiMi = Object.keys(mevcut.koltuklar || {}).every((i) => {
      const k = mevcut.koltuklar[i];
      if (!k || !k.eller) { return true; }
      return k.eller.every((el) => el.durum === 'batti');
    });
    let kartlar = mevcut.kurpiyerEli.kartlar;
    let desteIndex = mevcut.desteIndex;
    let desteTukendiMi = false;
    if (!herkesBattiMi) {
      const sonuc = krupiyerElOyna(kartlar, mevcut.deste, desteIndex);
      kartlar = sonuc.kartlar;
      desteIndex = sonuc.yeniDesteIndex;
      desteTukendiMi = sonuc.desteTukendiMi;
    }
    const krupiyerDegerlendirme = elDegerlendir(kartlar);
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    Object.keys(koltuklar).forEach((i) => {
      const k = koltuklar[i];
      if (!k || !k.eller) { return; }
      const yeniEller = k.eller.map((el) => {
        // Deste olağanüstü biçimde tükenirse eldeki bahisler eksiksiz iade
        // edilir; eksik/undefined kart üzerinden sonuç üretmekten güvenlidir.
        if (desteTukendiMi) { return Object.assign({}, el, { sonuc: 'berabere', odeme: el.bahisMiktari }); }
        if (el.durum === 'batti') { return Object.assign({}, el, { sonuc: 'kaybetti', odeme: 0 }); }
        const degerlendirme = elDegerlendir(el.kartlar);
        const sonuc = elSonucuHesapla(degerlendirme, krupiyerDegerlendirme, el.bahisMiktari, { splittenGeldiMi: el.splittenGeldiMi === true });
        return Object.assign({}, el, { sonuc: sonuc.sonuc, odeme: sonuc.odeme });
      });
      koltuklar[i] = Object.assign({}, k, { eller: yeniEller });
    });
    mevcut.kurpiyerEli = { kartlar, acikMi: true };
    mevcut.desteIndex = desteIndex;
    mevcut.koltuklar = koltuklar;
    mevcut.durum = 'el_sonucu';
    mevcut.guncellemeTs = Date.now();
    odemeGecmisiniEkle(mevcut, koltuklar);
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
  if (!table || !canPlay || !modeReady || isReadOnly() || pendingTableOperation || playerActionPending || tableError || activeDistribution) { return; }
  if (table.durum !== 'bahis_bekleniyor' && benimKoltukIndex(table) === null) { return; }
  if (table.durum === 'kurpiyer_sirasi' && (!table.kurpiyerEli || !table.kurpiyerEli.acikMi)) { krupiyerSirasiGeldi(); return; }
  if (table.durum === 'el_sonucu' && table.guncellemeTs && Date.now() - table.guncellemeTs > EL_SONUCU_BEKLEME_MS) { bahisPenceresiniBaslat(); return; }
  if (table.durum === 'bahis_bekleniyor' && table.bahisSuresiBitis && Date.now() >= table.bahisSuresiBitis) { bahisSuresiDolunca(); return; }
  if (table.durum === 'oyunculuk' && eldekiOyuncuSayisi(table) > 1 && table.aksiyonSuresiBitis && Date.now() >= table.aksiyonSuresiBitis) { aksiyonSuresiDolunca(); }
}

// Sırası gelen oyuncu 30 sn içinde karar vermezse otomatik "Kal" -- süresiz
// bekleme olmasın (kullanıcı bildirimi). Amiral Battı/bahis penceresindeki
// AYNI "herkes kendi istemcisinde fark eder" deseni.
function aksiyonSuresiDolunca() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyunculuk' || mevcut.aktifKoltuk === null || mevcut.aktifKoltuk === undefined) { return; }
    if (eldekiOyuncuSayisi(mevcut) <= 1 || !mevcut.aksiyonSuresiBitis || Date.now() < mevcut.aksiyonSuresiBitis) { return; }
    const koltukIndex = mevcut.aktifKoltuk;
    const koltuk = mevcut.koltuklar[koltukIndex];
    const elIndex = activeElIndex(koltuk);
    if (elIndex === -1) { return sonrakiSirayiAyarla(mevcut); }
    const yeniEller = koltuk.eller.slice();
    yeniEller[elIndex] = Object.assign({}, yeniEller[elIndex], { durum: 'kaldi' });
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    return sonrakiSirayiAyarla(mevcut);
  });
}

// Sonuç ödemeleri masadaki son 20 elde tutulur. Böylece oyuncu sonuç anında
// çevrimdışı olsa bile geri döndüğünde kendi cüzdan işlem anahtarıyla tek kez
// tahsil eder; tarayıcı belleğindeki sayaçlara veya açık sekmeye bağlı değildir.
function islemBakiyeYansit(table) {
  if (!currentUserUid || !table || !table.odemeGecmisi) { return; }
  Object.keys(table.odemeGecmisi).forEach((elNo) => {
    const gecmisEl = table.odemeGecmisi[elNo];
    Object.keys((gecmisEl && gecmisEl.koltuklar) || {}).forEach((koltukIndex) => {
      const odeme = gecmisEl.koltuklar[koltukIndex];
      if (!odeme || odeme.uid !== currentUserUid || !(Number(odeme.odeme) > 0)) { return; }
      const islemId = 'blackjack:' + elNo + ':koltuk:' + koltukIndex + ':odeme';
      bakiyeGuncelle(currentUserUid, Number(odeme.odeme), islemId, 'odeme');
    });
  });
}

// ── Oyuncu aksiyonları ──
function guncelElAl(mevcut, koltukIndex, elIndex) {
  if (!mevcut || mevcut.durum !== 'oyunculuk' || mevcut.aktifKoltuk !== koltukIndex) { return null; }
  const koltuk = mevcut.koltuklar && mevcut.koltuklar[koltukIndex];
  if (!koltuk || koltuk.uid !== currentUserUid || !Array.isArray(koltuk.eller) || activeElIndex(koltuk) !== elIndex) { return null; }
  const el = koltuk.eller[elIndex];
  return el && el.durum === 'oynuyor' ? { koltuk, el } : null;
}
function kartCek(koltukIndex, elIndex) {
  return masaIslemi((mevcut) => {
    const aktif = guncelElAl(mevcut, koltukIndex, elIndex);
    if (!aktif) { return; }
    const { koltuk, el } = aktif;
    const yeniKart = mevcut.deste[mevcut.desteIndex];
    if (!yeniKart) { return; }
    const yeniKartlar = el.kartlar.concat([yeniKart]);
    const degerlendirme = elDegerlendir(yeniKartlar);
    const yeniEl = Object.assign({}, el, { kartlar: yeniKartlar, durum: degerlendirme.battiMi ? 'batti' : (degerlendirme.toplam === 21 ? 'kaldi' : 'oynuyor') });
    const yeniEller = koltuk.eller.slice(); yeniEller[elIndex] = yeniEl;
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    mevcut.desteIndex = mevcut.desteIndex + 1;
    return yeniEl.durum === 'oynuyor' ? Object.assign(mevcut, { guncellemeTs: Date.now() }) : sonrakiSirayiAyarla(mevcut);
  });
}
function kal(koltukIndex, elIndex) {
  return masaIslemi((mevcut) => {
    const aktif = guncelElAl(mevcut, koltukIndex, elIndex);
    if (!aktif) { return; }
    const { koltuk, el } = aktif;
    const yeniEller = koltuk.eller.slice(); yeniEller[elIndex] = Object.assign({}, el, { durum: 'kaldi' });
    mevcut.koltuklar[koltukIndex] = Object.assign({}, koltuk, { eller: yeniEller });
    return sonrakiSirayiAyarla(mevcut);
  });
}
function katla(koltukIndex, elIndex) {
  const koltuk = currentTable && currentTable.koltuklar && currentTable.koltuklar[koltukIndex];
  const el = koltuk && koltuk.eller && koltuk.eller[elIndex];
  if (!koltuk || koltuk.uid !== currentUserUid || !el || el.durum !== 'oynuyor' || el.kartlar.length !== 2) { showToast('Sadece ilk karardan sonra katlayabilirsiniz.', { variant: 'error' }); return; }
  if (el.bahisMiktari > myChipBalance) { showToast('Katlamak için yetersiz bakiye.', { variant: 'error' }); return; }
  const baglam = masaBaglami();
  const islemId = 'blackjack:' + baglam.elNo + ':koltuk:' + koltukIndex + ':el:' + elIndex + ':katla:' + window.crypto.randomUUID();
  return bakiyeGuncelle(baglam.uid, -el.bahisMiktari, islemId, 'katla', baglam.cuzdan).then((bakiyeSonucu) => {
    if (bakiyeSonucu.beklemede) { return; }
    if (!bakiyeSonucu.committed) { showToast('Katlama için yeterli çip yok.', { variant: 'error' }); return; }
    return masaIslemi((mevcut) => {
      const aktif = guncelElAl(mevcut, koltukIndex, elIndex);
      if (!aktif || aktif.el.kartlar.length !== 2 || aktif.el.katlandi) { return; }
      const yeniKart = mevcut.deste[mevcut.desteIndex];
      if (!yeniKart) { return; }
      const yeniKartlar = aktif.el.kartlar.concat([yeniKart]);
      const degerlendirme = elDegerlendir(yeniKartlar);
      const yeniEl = Object.assign({}, aktif.el, { kartlar: yeniKartlar, bahisMiktari: aktif.el.bahisMiktari * 2, katlandi: true, durum: degerlendirme.battiMi ? 'batti' : 'kaldi' });
      const yeniEller = aktif.koltuk.eller.slice(); yeniEller[elIndex] = yeniEl;
      mevcut.koltuklar[koltukIndex] = Object.assign({}, aktif.koltuk, { eller: yeniEller });
      mevcut.desteIndex = mevcut.desteIndex + 1;
      return sonrakiSirayiAyarla(mevcut);
    }, baglam).then((res) => {
      if (!res.committed) { return bakiyeGuncelle(baglam.uid, el.bahisMiktari, islemId + ':iade', 'iade', baglam.cuzdan); }
    });
  });
}
function bol(koltukIndex, elIndex) {
  const koltuk = currentTable && currentTable.koltuklar && currentTable.koltuklar[koltukIndex];
  const el = koltuk && koltuk.eller && koltuk.eller[elIndex];
  if (!koltuk || koltuk.uid !== currentUserUid || !el || !bolunebilirMi(el.kartlar)) { return; }
  if (koltuk.eller.length !== 1 || elIndex !== 0) { showToast('Sadece bir kez bölebilirsiniz.', { variant: 'error' }); return; }
  if (el.bahisMiktari > myChipBalance) { showToast('Bölmek için yetersiz bakiye.', { variant: 'error' }); return; }
  const baglam = masaBaglami();
  const islemId = 'blackjack:' + baglam.elNo + ':koltuk:' + koltukIndex + ':el:' + elIndex + ':bol:' + window.crypto.randomUUID();
  return bakiyeGuncelle(baglam.uid, -el.bahisMiktari, islemId, 'bol', baglam.cuzdan).then((bakiyeSonucu) => {
    if (bakiyeSonucu.beklemede) { return; }
    if (!bakiyeSonucu.committed) { showToast('Bölmek için yeterli çip yok.', { variant: 'error' }); return; }
    return masaIslemi((mevcut) => {
      const aktif = guncelElAl(mevcut, koltukIndex, elIndex);
      if (!aktif || aktif.koltuk.eller.length !== 1 || !bolunebilirMi(aktif.el.kartlar)) { return; }
      const yeniKart1 = mevcut.deste[mevcut.desteIndex];
      const yeniKart2 = mevcut.deste[mevcut.desteIndex + 1];
      if (!yeniKart1 || !yeniKart2) { return; }
      const kart1 = aktif.el.kartlar[0], kart2 = aktif.el.kartlar[1];
      const el1Kartlar = [kart1, yeniKart1];
      const el2Kartlar = [kart2, yeniKart2];
      const asBolunmesiMi = kart1.r === 'as';
      const elDurumu = (kartlar) => {
        const degerlendirme = elDegerlendir(kartlar);
        return asBolunmesiMi || degerlendirme.toplam === 21 ? 'kaldi' : (degerlendirme.battiMi ? 'batti' : 'oynuyor');
      };
      // Splitten gelen iki kartlı 21 doğal Blackjack değildir; bu işaret hem
      // ödeme oranını hem de otomatik "kal" davranışını doğru tutar.
      const el1 = { kartlar: el1Kartlar, bahisMiktari: aktif.el.bahisMiktari, splittenGeldiMi: true, durum: elDurumu(el1Kartlar) };
      const el2 = { kartlar: el2Kartlar, bahisMiktari: aktif.el.bahisMiktari, splittenGeldiMi: true, durum: elDurumu(el2Kartlar) };
      mevcut.koltuklar[koltukIndex] = Object.assign({}, aktif.koltuk, { eller: [el1, el2] });
      mevcut.desteIndex = mevcut.desteIndex + 2;
      return sonrakiSirayiAyarla(mevcut);
    }, baglam).then((res) => {
      if (!res.committed) { return bakiyeGuncelle(baglam.uid, el.bahisMiktari, islemId + ':iade', 'iade', baglam.cuzdan); }
    });
  });
}

// ── Render ──
function hucreSinifi(sonuc) {
  if (sonuc === 'kazandi' || sonuc === 'blackjack') { return 'bj-sonuc-kazandi'; }
  if (sonuc === 'kaybetti') { return 'bj-sonuc-kaybetti'; }
  if (sonuc === 'berabere') { return 'bj-sonuc-berabere'; }
  return '';
}
// animasyonSinifi: kartın masaya konurken kaydığı yön -- kullanıcı isteği
// üzerine krupiyer kartları yukarıdan (bj-slide-top), oyuncu kartları
// aşağıdan (bj-slide-bottom) kayarak gelir (bkz. _blackjack.scss).
function kartHtml(kart, uid, kapaliMi, animasyonSinifi) {
  const src = kapaliMi ? desteArkasiYolu() : kartGorselYolu(kart, uid);
  const fallback = kapaliMi ? desteArkasiYolu() : varsayilanKartGorselYolu(kart, (skinCache[uid] || mySkin).desteStili);
  return '<img class="bj-kart' + (animasyonSinifi ? ' ' + animasyonSinifi : '') + '" src="' + src + '" data-bj-kart-fallback="' + fallback + '" alt="" decoding="async">';
}
function elHtml(el, uid) {
  const degerlendirme = elDegerlendir(el.kartlar);
  // Yalnızca EN SON gelen kart kayma animasyonuyla girer -- önceki kartlara
  // her yeniden render'da (yeni kart çekilince, hit/split) animasyon
  // sınıfı TEKRAR verilirse hepsi aynı anda yeniden kayıyormuş gibi görünür
  // (kullanıcı bildirimi: "her kart geldiğinde bütün kartlar yeniden slide
  // animasyonu ile gelmesin ... dursun bir yere gitmesin").
  const sonKartIndex = el.kartlar.length - 1;
  const kartlarHtml = el.kartlar.map((k, i) => kartHtml(k, uid, false, i === sonKartIndex ? 'bj-slide-bottom' : '')).join('');
  const sonucEtiket = el.sonuc ? '<span class="bj-el-sonuc ' + hucreSinifi(el.sonuc) + '">' + escapeHtml({ kazandi: 'Kazandı', kaybetti: 'Kaybetti', berabere: 'Berabere', blackjack: 'Blackjack!' }[el.sonuc] || '') + '</span>' : '';
  // Kazanınca toplam rozeti yeşile döner -- kullanıcı isteği: "kazanınca
  // bj-el-toplam yeşil yansın".
  const toplamSinifi = 'bj-el-toplam' + ((el.sonuc === 'kazandi' || el.sonuc === 'blackjack') ? ' bj-el-toplam-kazandi' : '');
  return '<div class="bj-el">' +
    '<div class="bj-el-kartlar">' + kartlarHtml + '</div>' +
    '<div class="' + toplamSinifi + '">' + degerlendirme.toplam + (degerlendirme.battiMi ? ' (Battı)' : '') + '</div>' +
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

function iadeCipiHtml(koltukIndex, miktar) {
  return '<button type="button" class="bj-cip-iade" data-bj-bahis-iade="' + koltukIndex + '" aria-label="' + miktar + ' çip bahsini geri al" title="Bahsi geri al">' + cipYiginiHtml(miktar) + '</button>';
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
      // Çip seçimi ayrı "Oyun Başlarken" panelinde gösterilir. Merkezdeki
      // oyuncu koltuğu yalnızca yerleştirilmiş bahsi/kartları taşır.
      icerik = koltuk.bahis ? iadeCipiHtml(koltukIndex, koltuk.bahis) : '<div class="bj-bahis-mevcut bj-bahis-yok">Bahis bekleniyor</div>';
    } else {
      // Diğer oyuncular için sade görünüm -- kullanıcı isteği: "sadece avatar
      // ve kartları gözükecek" (metin etiketleri değil).
      icerik = koltuk.bahis ? cipYiginiHtml(koltuk.bahis) : '';
    }
  } else if (koltuk.eller) {
    icerik = koltuk.eller.map((el, i) => elHtml(el, koltuk.uid) + ((aktifMi && i === activeElIndex(koltuk)) ? '<span class="bj-sira-isareti">◀ sırası</span>' : '')).join('');
  } else {
    icerik = koltuk.katilimDurumu === 'sonraki-elde' ? '<div class="bj-bahis-mevcut">Bu el pas</div>' : '';
  }
  return '<div class="bj-koltuk' + (aktifMi ? ' bj-koltuk-aktif' : '') + (benimMi ? ' bj-koltuk-ben' : '') + '">' +
    '<div class="bj-koltuk-oyuncu">' + avatarHtml + '<span>' + escapeHtml(koltuk.isim || '') + '</span></div>' +
    icerik +
    '</div>';
}
function activeElIndex(koltuk) {
  if (!koltuk || !koltuk.eller) { return -1; }
  for (let i = 0; i < koltuk.eller.length; i++) { if (koltuk.eller[i].durum === 'oynuyor') { return i; } }
  return -1;
}

// Krupiyer bu elde en az bir oyuncuya karşı kazandı mı (o oyuncunun sonucu
// "kaybetti") -- kullanıcı isteği: "kurpiyer kazanırsa o [toplam] yeşil
// yansın" (krupiyerin kendi toplam rozeti için).
function krupiyerKazandiMi(table) {
  return Object.values(table.koltuklar || {}).some((k) => k && k.eller && k.eller.some((el) => el.sonuc === 'kaybetti'));
}
function renderKrupiyer(table) {
  const el = document.querySelector('[data-bj-krupiyer]');
  const signature = JSON.stringify({ el: table.kurpiyerEli || null, desteStili: mySkin.desteStili, tema: mySkin.yuzKartiTemasi });
  if (el && signature !== lastDealerSignature) {
    lastDealerSignature = signature;
    if (!table.kurpiyerEli) {
      el.innerHTML = '<div class="bj-krupiyer-bos">Bahisler bekleniyor…</div>';
    } else {
      const acikMi = table.kurpiyerEli.acikMi;
      // Yalnızca en son kart kayarak gelir -- bkz. elHtml'deki aynı düzeltme.
      const sonKartIndex = table.kurpiyerEli.kartlar.length - 1;
      const kartlarHtml = table.kurpiyerEli.kartlar.map((k, i) => kartHtml(k, currentUserUid, i === 1 && !acikMi, i === sonKartIndex ? 'bj-slide-top' : '')).join('');
      // Gerçek kumarhanede kapalı kart açılana kadar sadece AÇIK kartın değeri
      // görünür -- kullanıcı bildirimi: "kurpiyerin toplamı yok".
      const toplamHtml = acikMi
        ? (() => {
          const d = elDegerlendir(table.kurpiyerEli.kartlar);
          const sinif = 'bj-el-toplam' + (krupiyerKazandiMi(table) ? ' bj-el-toplam-kazandi' : '');
          return '<div class="' + sinif + '">' + d.toplam + (d.battiMi ? ' (Battı)' : '') + '</div>';
        })()
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
  const signature = String(kalan);
  if (signature === lastDeckSignature) { return; }
  lastDeckSignature = signature;
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
  const signature = table.durum === 'bahis_bekleniyor' && table.bahisSuresiBitis && oturanKoltukSayisi(table) > 1 ? String(table.bahisSuresiBitis) : '';
  if (!signature) { el.textContent = ''; countdownSignature = ''; if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
  if (signature === countdownSignature && countdownTimer) { return; }
  countdownSignature = signature;
  if (countdownTimer) { clearInterval(countdownTimer); }
  const tick = () => {
    const kalanMs = table.bahisSuresiBitis - Date.now();
    if (kalanMs <= 0) { el.textContent = 'Bahisler kapandı…'; clearInterval(countdownTimer); countdownTimer = null; return; }
    el.textContent = 'Bahis için: ' + Math.ceil(kalanMs / 1000) + ' sn';
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function renderAksiyonSayaci(table) {
  const el = document.querySelector('[data-bj-aksiyon-sayac]');
  if (!el) { return; }
  const signature = table.durum === 'oyunculuk' && eldekiOyuncuSayisi(table) > 1 && table.aksiyonSuresiBitis ? String(table.aktifKoltuk) + ':' + table.aksiyonSuresiBitis : '';
  if (!signature) { el.textContent = ''; aksiyonCountdownSignature = ''; if (aksiyonCountdownTimer) { clearInterval(aksiyonCountdownTimer); aksiyonCountdownTimer = null; } return; }
  if (signature === aksiyonCountdownSignature && aksiyonCountdownTimer) { return; }
  aksiyonCountdownSignature = signature;
  if (aksiyonCountdownTimer) { clearInterval(aksiyonCountdownTimer); }
  const koltuk = table.koltuklar[table.aktifKoltuk];
  const isim = koltuk ? koltuk.isim : '';
  const tick = () => {
    const kalanMs = table.aksiyonSuresiBitis - Date.now();
    if (kalanMs <= 0) { el.textContent = 'Süre doldu…'; clearInterval(aksiyonCountdownTimer); aksiyonCountdownTimer = null; return; }
    el.textContent = escapeHtml(isim || 'Sıradaki') + ' için: ' + Math.ceil(kalanMs / 1000) + ' sn';
  };
  tick();
  aksiyonCountdownTimer = setInterval(tick, 250);
}

function renderAksiyonlar(table, benimKoltuk) {
  const el = document.querySelector('[data-bj-aksiyonlar]');
  if (!el) { return; }
  if (table.durum !== 'oyunculuk' || benimKoltuk === null || table.aktifKoltuk !== benimKoltuk) {
    if (el.childElementCount) { el.innerHTML = ''; }
    lastActionSignature = '';
    return;
  }
  const koltuk = table.koltuklar[benimKoltuk];
  const elIndex = activeElIndex(koltuk);
  if (elIndex === -1) { if (el.childElementCount) { el.innerHTML = ''; } lastActionSignature = ''; return; }
  const aktifEl = koltuk.eller[elIndex];
  const ilkKararMi = aktifEl.kartlar.length === 2;
  const html =
    '<button type="button" class="btn btn-primary" data-bj-kartcek>Kart Çek</button>' +
    '<button type="button" class="btn btn-outline" data-bj-kal>Kal</button>' +
    (ilkKararMi ? '<button type="button" class="btn btn-outline" data-bj-katla>Katla</button>' : '') +
    (ilkKararMi && bolunebilirMi(aktifEl.kartlar) && koltuk.eller.length === 1 ? '<button type="button" class="btn btn-outline" data-bj-bol>Böl</button>' : '');
  if (html !== lastActionSignature) { lastActionSignature = html; el.innerHTML = html; }
}
function renderBahisPaneli(table, benimKoltuk) {
  const panel = document.querySelector('[data-bj-bahis-panel]');
  if (!panel) { return; }
  const koltuk = benimKoltuk === null ? null : table.koltuklar && table.koltuklar[benimKoltuk];
  if (!koltuk || table.durum !== 'bahis_bekleniyor') {
    if (panel.childElementCount) { panel.innerHTML = ''; }
    lastBetPanelSignature = '';
    return;
  }
  const bahisSecim = CIP_DEGERLERI.filter((v) => Number.isFinite(myChipBalance) && v <= myChipBalance).map((v) =>
    '<button type="button" class="bj-cip-btn" aria-label="' + v + ' çip bahis yap" data-bj-bahis="' + benimKoltuk + '" data-miktar="' + v + '"><img class="bj-cip-gorsel" src="' + cipGorselYolu(v) + '" alt=""><span class="bj-cip-deger">' + v + '</span></button>'
  ).join('');
  const avatar = '<div class="bj-avatar-cember">' + renderStaffAvatar(koltuk.isim, koltuk.uid, koltuk.isim, 40) + '</div>';
  const html = '<div class="bj-bahis-panel-oyuncu">' + avatar + '<span>' + escapeHtml(koltuk.isim || '') + '</span></div>' +
    '<div class="bj-bahis-secim">' + (bahisSecim || (!koltuk.bahis && Number.isFinite(myChipBalance) ? '<span class="bj-bahis-mevcut">Yeterli çip yok. Bu eli pas geçiyorsunuz.</span>' : '')) + '</div>' +
    '<div class="bj-bahis-panel-alt">' + (koltuk.bahis ? iadeCipiHtml(benimKoltuk, koltuk.bahis) : '<div class="bj-bahis-mevcut bj-bahis-yok">Bahis yok</div>') +
    '<button type="button" class="btn btn-ghost bj-kalk-btn" data-bj-kalk="' + benimKoltuk + '">Kalk</button></div>';
  if (html !== lastBetPanelSignature) { lastBetPanelSignature = html; panel.innerHTML = html; }
}

// ── Kademeli dağıtım animasyonu (madde 1: "kartlar bana spawn oluyor") ──
// bahisSuresiDolunca TÜM eli TEK transaction'da yazıyor -- elimizde zaten
// NİHAİ veri var, sunucuya ekstra istek atmadan YEREL olarak kademeli açığa
// çıkarılıyor: krupiyer açık, oyuncular, krupiyer kapalı, oyuncular.
let sonAnimeEdilenElNo = -1;
// 650ms -- kullanıcı isteği: "kartlar yavaş dağıtılsın" (0.5s'lik kayma
// animasyonu bir sonraki kart gelmeden tamamen bitsin diye animasyon
// süresinden biraz uzun tutuldu).
const DAGITIM_ADIM_MS = 650;

function renderMasa(table) {
  currentTable = table;
  skinDinlemeleriniEsitle(table);
  const yeniDagitimMi = table.elNo && table.elNo !== sonAnimeEdilenElNo &&
    (table.durum === 'oyunculuk' || table.durum === 'kurpiyer_sirasi') &&
    table.koltuklar && Object.keys(table.koltuklar).some((i) => table.koltuklar[i] && table.koltuklar[i].eller);
  const tabloImzasi = [table.elNo || 0, table.durum || '', table.desteIndex || 0, table.guncellemeTs || 0].join(':');
  if (activeDistribution) {
    if (activeDistribution.elNo === table.elNo && activeDistribution.tabloImzasi === tabloImzasi) { return; }
    // Yeni bir Firebase güncellemesi geldiyse eski setTimeout zincirinin
    // gecikmiş karesi masa üstüne yazılamaz; en güncel tabloya geçilir.
    activeDistribution.iptalEdildi = true;
    activeDistribution = null;
  }
  if (yeniDagitimMi) {
    sonAnimeEdilenElNo = table.elNo;
    dagitimAnimasyonuOynat(table, tabloImzasi);
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
  kopya.durum = 'dagitiliyor';
  kopya.aktifKoltuk = null;
  return kopya;
}

function dagitimAnimasyonuOynat(table, tabloImzasi) {
  const denetleyici = { elNo: table.elNo, tabloImzasi, iptalEdildi: false };
  activeDistribution = denetleyici;
  const bahisliKoltuklar = [];
  for (let i = 0; i < MAX_KOLTUK; i++) { if (table.koltuklar && table.koltuklar[i] && table.koltuklar[i].eller) { bahisliKoltuklar.push(i); } }
  const adimlar = [];
  for (let tur = 0; tur < 2; tur++) {
    adimlar.push('krupiyer');
    bahisliKoltuklar.forEach((i) => adimlar.push(i));
  }
  const koltukSayaclari = {};
  bahisliKoltuklar.forEach((i) => { koltukSayaclari[i] = 0; });
  let krupiyerSayaci = 0;
  let adimNo = 0;
  function birAdimOynat() {
    if (denetleyici.iptalEdildi || activeDistribution !== denetleyici) { return; }
    if (adimNo >= adimlar.length) {
      activeDistribution = null;
      renderMasaGercek(currentTable && currentTable.elNo === table.elNo ? currentTable : table);
      return;
    }
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
  const koltuklarEl = document.querySelector('[data-bj-koltuklar]');
  if (koltuklarEl) {
    // Kendi koltuğum HER ZAMAN üçüncü fiziksel slotta kalır. Sabit grid ile
    // birlikte bu slot hem masaüstünde hem telefonda gerçek geometrik merkezdir.
    const merkez = Math.floor(MAX_KOLTUK / 2);
    const sira = Array.from({ length: MAX_KOLTUK }, (_, goren) => benimKoltuk === null
      ? goren
      : (((benimKoltuk + (goren - merkez)) % MAX_KOLTUK) + MAX_KOLTUK) % MAX_KOLTUK);
    const siraImzasi = sira.join(':');
    if (siraImzasi !== lastSeatOrderSignature || koltuklarEl.children.length !== MAX_KOLTUK) {
      lastSeatOrderSignature = siraImzasi;
      renderedSeatSignatures.clear();
      koltuklarEl.innerHTML = sira.map((gercekIndex, goren) => '<div class="bj-koltuk-slot bj-koltuk-slot-' + goren + '" data-bj-koltuk-slot="' + goren + '" data-bj-gercek-koltuk="' + gercekIndex + '"></div>').join('');
    }
    sira.forEach((gercekIndex, goren) => {
      const slot = koltuklarEl.querySelector('[data-bj-koltuk-slot="' + goren + '"]');
      const html = koltukHtml(gercekIndex, table.koltuklar && table.koltuklar[gercekIndex], table, benimKoltuk);
      if (slot && renderedSeatSignatures.get(goren) !== html) {
        renderedSeatSignatures.set(goren, html);
        slot.innerHTML = html;
      }
    });
  }
  renderKrupiyer(table);
  renderBahisSayaci(table);
  renderAksiyonSayaci(table);
  renderBahisPaneli(table, benimKoltuk);
  renderAksiyonlar(table, benimKoltuk);
  renderIslemDurumu();
}

function eventleriBagla() {
  // document'e bağlanıyor -- skin çarkı butonu .page-header'da, yani
  // .bj-masa'nın (data-bj-root) DIŞINDA; sadece root'u dinlemek onu kaçırırdı.
  document.addEventListener('error', (event) => {
    const kart = event.target;
    if (!kart || !kart.matches || !kart.matches('img.bj-kart[data-bj-kart-fallback]')) { return; }
    const fallback = kart.dataset.bjKartFallback;
    if (!fallback || kart.dataset.bjKartFallbackKullanildi === 'true') { return; }
    kart.dataset.bjKartFallbackKullanildi = 'true';
    kart.src = fallback;
  }, true);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-bj-yeniden-dene]')) {
      tableError = '';
      renderIslemDurumu();
      attachTableListener(true);
      return;
    }
    if (e.target.closest('[data-bj-skin-carki]')) {
      if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
      openSkinModal();
      return;
    }
    if (!e.target.closest('[data-bj-root]')) { return; }
    if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
    const oturBtn = e.target.closest('[data-bj-otur]'); if (oturBtn) { oyuncuIslemi(() => otur(Number(oturBtn.dataset.bjOtur))); return; }
    const kalkBtn = e.target.closest('[data-bj-kalk]'); if (kalkBtn) { oyuncuIslemi(() => kalk(Number(kalkBtn.dataset.bjKalk))); return; }
    const bahisBtn = e.target.closest('[data-bj-bahis]'); if (bahisBtn) { oyuncuIslemi(() => bahisYap(Number(bahisBtn.dataset.bjBahis), Number(bahisBtn.dataset.miktar))); return; }
    const iadeBtn = e.target.closest('[data-bj-bahis-iade]'); if (iadeBtn) { oyuncuIslemi(() => bahsiGeriAl(Number(iadeBtn.dataset.bjBahisIade))); return; }
    const benimKoltuk = benimKoltukIndex(currentTable);
    if (benimKoltuk === null || !currentTable) { return; }
    const elIndex = activeElIndex(currentTable.koltuklar[benimKoltuk]);
    if (e.target.closest('[data-bj-kartcek]')) { oyuncuIslemi(() => kartCek(benimKoltuk, elIndex)); return; }
    if (e.target.closest('[data-bj-kal]')) { oyuncuIslemi(() => kal(benimKoltuk, elIndex)); return; }
    if (e.target.closest('[data-bj-katla]')) { oyuncuIslemi(() => katla(benimKoltuk, elIndex)); return; }
    if (e.target.closest('[data-bj-bol]')) { oyuncuIslemi(() => bol(benimKoltuk, elIndex)); }
  });
}

function attachTableListener(force = false) {
  if (!modeReady || !canPlay) { return; }
  const yeniYol = dbPath(MASA_YOLU);
  if (!force && tableRef && attachedTablePath === yeniYol && tableListener) { return; }
  if (tableRef && tableListener) { tableRef.off('value', tableListener); }
  if (phaseWatchdog) { clearInterval(phaseWatchdog); phaseWatchdog = null; }
  activeDistribution = null;
  sonAnimeEdilenElNo = -1;
  currentTable = null;
  lastSeatOrderSignature = '';
  renderedSeatSignatures.clear();
  lastDealerSignature = '';
  lastDeckSignature = '';
  lastActionSignature = '';
  lastBetPanelSignature = '';
  tableRef = database.ref(yeniYol);
  attachedTablePath = yeniYol;
  tableListener = (snap) => {
    if (attachedTablePath !== yeniYol || !canPlay) { return; }
    const table = snap.val() || { durum: 'bahis_bekleniyor', koltuklar: {} };
    if (!snap.exists()) { bahisPenceresiniBaslat(); }
    renderMasa(table);
    belkiSonrakiFazaGec(table);
    islemBakiyeYansit(table);
  };
  tableRef.on('value', tableListener, masaHatasi);
  // Veri DEĞİŞMESE bile (örn. kimse kart çekmiyor, sadece süre doluyor) zaman
  // aşımı geçişlerini kaçırmamak için periyodik bir yoklama.
  phaseWatchdog = setInterval(() => { if (currentTable) { belkiSonrakiFazaGec(currentTable); } }, 1000);
}

export function initBlackjack() {
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  eventleriBagla();
  subscribeStaffProfiles(database, () => { if (currentTable) { renderMasa(currentTable); } });

  auth.onAuthStateChanged((user) => {
    if (!user) {
      canPlay = false;
      currentUserUid = '';
      currentUserName = '';
      currentUserEmail = '';
      if (walletRef && walletListener) { walletRef.off('value', walletListener); }
      walletRef = null;
      walletListener = null;
      myWalletOperationIds.clear();
      skinDinlemeleriniTemizle();
      if (tableRef && tableListener) { tableRef.off('value', tableListener); }
      tableRef = null;
      tableListener = null;
      if (phaseWatchdog) { clearInterval(phaseWatchdog); phaseWatchdog = null; }
      if (currentTable) { renderMasa(currentTable); }
      return;
    }
    currentUserEmail = user.email || '';
    currentUserUid = user.uid;
    database.ref('users/' + user.uid).once('value').then(async (snap) => {
      if (user.uid !== currentUserUid) { return; }
      const u = snap.val() || {};
      canPlay = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      if (!canPlay) { renderIslemDurumu(); return; }
      await initDbMode(database);
      if (user.uid !== currentUserUid) { return; }
      modeReady = true;
      renderDbModeBanner();
      subscribeMyBalance();
      attachTableListener();
      loadSkinFor(currentUserUid).then(() => { if (currentTable) { renderMasa(currentTable); islemBakiyeYansit(currentTable); } });
    }).catch((err) => { canPlay = false; masaHatasi(err); });
  });

  // Test modu çözümlenmeden masa/cüzdan/skin dinleyicisi açılmaz. Mod sonradan
  // değişirse eski canlı yol mutlaka kapatılıp yeni test/canlı yola bağlanır.
  onDbModeChange(() => {
    if (!modeReady || !canPlay) { return; }
    renderDbModeBanner();
    skinDinlemeleriniTemizle();
    tableError = '';
    if (currentUserUid) { subscribeMyBalance(); }
    attachTableListener();
    renderIslemDurumu();
  });
}
