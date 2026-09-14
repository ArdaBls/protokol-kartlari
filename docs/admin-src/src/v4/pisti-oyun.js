// Pişti (oyun-pisti.html) -- Blackjack ile AYNI mimari (Firebase Realtime
// Database transaction'ı, "kim dağıtıyor" yarışını çözen tek paylaşılan
// masa). Kullanıcı isteği: "minimum 2 kişi oynansın bot olmasın ... blackjack
// gibi anlık görülebilsin kimin ne yaptığı masaya oturduğu vesaire" -- yani
// Hold'em'deki gibi yerel/bot bir simülasyon DEĞİL, gerçek çok oyunculu bir
// masa. Çip/bahis YOK -- Pişti klasik puan oyunudur (101 puana ilk ulaşan
// kazanır), bu yüzden Blackjack'teki cüzdan/işlem-kimliği karmaşıklığının
// hiçbiri burada gerekmiyor.
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner } from './db-mode.js';
import { showToast } from './toast.js';
import { subscribeStaffProfiles, renderStaffAvatar } from './staff-profiles.js';
import {
  MIN_OYUNCU, MAX_OYUNCU, EL_BASINA_KART, HEDEF_PUAN, TOPLAM_KART_SAYISI,
  pistiDestesiOlustur, pistiDesteyiKaris, pistiHamleUygula, pistiSonMasayiDagit,
  pistiElPuanlariniHesapla, pistiDesteYeterliMi
} from './pisti-deste.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};
const MASA_ID = 'ana-masa';
// NOT: oyunBasarimlari/$oyunAdi altında DEĞİL -- o wildcard'ın masalar/$masaId
// kuralı Blackjack'e özel şemayla (.validate) yazılmış ve RTDB'de aynı yoldaki
// wildcard+literal .validate kuralları BİRLEŞİP (AND) hepsi geçmek zorunda
// kalırdı. satranc/amiralBattiGizli gibi kendi tepe-seviye dalını kullanıyoruz.
const MASA_YOLU = 'pisti/masalar/' + MASA_ID;
const AKSIYON_SURESI_MS = 30000;
const EL_BITTI_BEKLEME_MS = 3500;
const OYUN_BITTI_BEKLEME_MS = 3500;
// Firebase kuralındaki (masalar/$masaId .write) "guncellemeTs 130 saniyeden
// eskiyse koltukta oturmayan biri de yazabilir" kurtarma cümlesiyle eşleşir
// -- bkz. Blackjack'te bulunan "terk edilmiş masa sonsuza kadar kilitli
// kalıyordu" hatası. Pişti'de HER ZAMAN >=2 oyuncu olduğu için normal 30sn'lik
// sıra sayacı zaten çoğu durumu çözer; bu yalnızca TÜM koltuklar aynı anda
// terk edilirse devreye giren ek bir güvenlik ağı.
const TERK_EDILME_MS = 130000;

let database = null;
let currentUserUid = '';
let currentUserName = '';
let currentUserEmail = '';
let canPlay = false;
let modeReady = false;

let currentTable = null;
let tableRef = null;
let tableListener = null;
let attachedTablePath = '';
let phaseWatchdog = null;
let pendingTableOperation = null;
let playerActionPending = false;
let tableError = '';
let turnCountdownTimer = null;
let turnCountdownSignature = '';
let lastSeatOrderSignature = '';
const renderedSeatSignatures = new Map();
let lastPileSignature = '';
let lastHandSignature = '';
let sonAnimeEdilenElNo = -1;
const eldeAnimeEdilenSayac = {}; // koltukIndex -> daha önce ne kadar kart animasyonla gösterildi

function masaBaglami() { return { yol: dbPath(MASA_YOLU), uid: currentUserUid, elNo: (currentTable && currentTable.elNo) || 0 }; }

function renderIslemDurumu() {
  const durum = document.querySelector('[data-pisti-durum]');
  const metin = tableError || (playerActionPending || pendingTableOperation ? 'İşlem onaylanıyor…' : '');
  if (durum && durum.textContent !== metin) { durum.textContent = metin; }
  const tekrar = document.querySelector('[data-pisti-yeniden-dene]');
  if (tekrar) { tekrar.hidden = !tableError; }
  document.querySelectorAll('[data-pisti-root] button:not([data-pisti-yeniden-dene])').forEach((button) => {
    button.disabled = !!(tableError || pendingTableOperation || playerActionPending || !canPlay || isReadOnly());
  });
}

function masaHatasi(err) {
  // Teşhis: gerçek Firebase'de bu hatanın kesin nedeni (kural reddi mi,
  // gerçekten bağlantı mı, yoksa güncelleme fonksiyonunda atılan bir JS
  // istisnası mı) konsolsuz görülemiyor -- geçici olarak tam hataburada
  // loglanıyor, kullanıcıdan F12 konsolundaki "Pişti masa hatası:" satırını
  // istemek için.
  console.error('Pişti masa hatası:', err);
  const kod = err && (err.code || err.name || '');
  tableError = err && err.code === 'PERMISSION_DENIED'
    ? 'Masa güncellenemedi: oyun için yazma izni bulunmuyor.'
    : 'Masa güncellenemedi. Bağlantınızı kontrol edip tekrar deneyin.' + (kod ? ' (' + kod + ')' : '');
  renderIslemDurumu();
}

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
  if (playerActionPending || pendingTableOperation || tableError || !canPlay || !modeReady) { return; }
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
  for (let i = 0; i < MAX_OYUNCU; i++) {
    if (table.koltuklar[i] && table.koltuklar[i].uid === currentUserUid) { return i; }
  }
  return null;
}
function oturanKoltukIndeksleri(table) {
  if (!table || !table.koltuklar) { return []; }
  const liste = [];
  for (let i = 0; i < MAX_OYUNCU; i++) { if (table.koltuklar[i] && table.koltuklar[i].uid) { liste.push(i); } }
  return liste;
}

// ── Kart görseli -- Blackjack'in mevcut "temel" stil setini yeniden kullanır. ──
const RUTBE_NO = { as: '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06', '7': '07', '8': '08', '9': '09', '10': '10', joker: '11', kiz: '12', papaz: '13' };
function kartYolu(kart) { return '/assets/blackjack/kartlar/varsayilan/temel/' + (RUTBE_NO[kart.r] || '01') + '-' + kart.r + '-' + kart.s + '.png'; }
function desteArkasiYolu() { return '/assets/blackjack/deste-arkalari/deste-arkasi-01.png'; }
function kartHtml(kart, ekSinif) { return '<img class="pisti-kart' + (ekSinif ? ' ' + ekSinif : '') + '" src="' + kartYolu(kart) + '" alt="' + escapeHtml(kart.r + ' ' + kart.s) + '" draggable="false">'; }

// ── Oturma / kalkma ──
function otur(koltukIndex) {
  if (!canPlay) { showToast('Oynamak için giriş yapmalısınız.', { variant: 'error' }); return; }
  if (!Number.isInteger(koltukIndex) || koltukIndex < 0 || koltukIndex >= MAX_OYUNCU) { return; }
  return masaIslemi((mevcut) => {
    // NOT: masa hiç yoksa (mevcut === null, ilk oturan kişi) bu GEÇERLİ bir
    // durumdur -- boş bekleme odası olarak baştan oluşturulmalı. Sadece masa
    // VARSA ve 'oyuncu_bekleniyor' DIŞINDA bir fazdaysa reddet.
    if (mevcut && mevcut.durum !== 'oyuncu_bekleniyor') { return; }
    const taban = mevcut || { durum: 'oyuncu_bekleniyor', skorlar: {}, elNo: 0 };
    const koltuklar = Object.assign({}, taban.koltuklar || {});
    if (Object.keys(koltuklar).some((i) => koltuklar[i] && koltuklar[i].uid === currentUserUid)) { return; }
    if (koltuklar[koltukIndex] && koltuklar[koltukIndex].uid) { return; }
    koltuklar[koltukIndex] = { uid: currentUserUid, isim: currentUserName || currentUserEmail, katilimDurumu: 'hazir', hazir: false };
    return Object.assign({}, taban, { durum: 'oyuncu_bekleniyor', koltuklar, guncellemeTs: Date.now() });
  }).then((res) => { if (!res.committed) { showToast('Bu koltuk dolu veya oyun başlamış.', { variant: 'error' }); } });
}
function kalk(koltukIndex) {
  if (!Number.isInteger(koltukIndex) || koltukIndex < 0 || koltukIndex >= MAX_OYUNCU) { return; }
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyuncu_bekleniyor') { return; }
    const koltuk = mevcut.koltuklar && mevcut.koltuklar[koltukIndex];
    if (!koltuk || koltuk.uid !== currentUserUid) { return; }
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    koltuklar[koltukIndex] = null;
    return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
  }).then((res) => { if (!res.committed) { showToast('Oyun başlamadan önce/oyun bekleme fazında kalkabilirsiniz.', { variant: 'error' }); } });
}

// "Oyunu başlat" düğmesi YOK -- oturan HERKES kendi hazır durumunu açıp
// kapatıyor, SON kişi hazır deyince belkiSonrakiFazaGec otomatik başlatıyor
// (bkz. aşağı). Godot istemcisi de AYNI fonksiyonu çağıracak.
function hazirVer() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyuncu_bekleniyor') { return; }
    const benim = benimKoltukIndex(mevcut);
    if (benim === null) { return; }
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    const koltuk = koltuklar[benim];
    if (!koltuk) { return; }
    koltuklar[benim] = Object.assign({}, koltuk, { hazir: !koltuk.hazir });
    return Object.assign({}, mevcut, { koltuklar, guncellemeTs: Date.now() });
  });
}

// ── El başlatma ──
// Masaya açılan ilk 4 kart -- gerçek Pişti kurallarında bunlardan biri vale
// olamaz (ilk oyuncuya bedava süpürme hakkı vermemek için), o yüzden vale
// gelirse desteye geri konup (en alta) yerine yenisi çekilir.
function baslangicMasaKartlariniAyikla(deste) {
  const kalan = deste.slice();
  const masaKartlari = [];
  while (masaKartlari.length < 4) {
    const kart = kalan.shift();
    if (kart.r === 'joker') { kalan.push(kart); continue; }
    masaKartlari.push(kart);
  }
  return { masaKartlari, kalanDeste: kalan };
}
function yeniElBaslatSifirdan(mevcut, oturanIndeksler, dagitici) {
  const { masaKartlari, kalanDeste } = baslangicMasaKartlariniAyikla(pistiDesteyiKaris(pistiDestesiOlustur()));
  const eller = {}; const topladiklarim = {}; const pistiSayilari = {};
  oturanIndeksler.forEach((i) => { eller[i] = []; topladiklarim[i] = []; pistiSayilari[i] = 0; });
  let idx = 0;
  for (let tur = 0; tur < EL_BASINA_KART; tur++) {
    oturanIndeksler.forEach((i) => { eller[i].push(kalanDeste[idx]); idx++; });
  }
  const dagiticiSira = oturanIndeksler.indexOf(dagitici) === -1 ? 0 : oturanIndeksler.indexOf(dagitici);
  const ilkOynayan = oturanIndeksler[(dagiticiSira + 1) % oturanIndeksler.length];
  const skorlar = Object.assign({}, mevcut.skorlar || {});
  oturanIndeksler.forEach((i) => { if (!Number.isFinite(skorlar[i])) { skorlar[i] = 0; } });
  return Object.assign({}, mevcut, {
    durum: 'oynaniyor', guncellemeTs: Date.now(), elNo: (mevcut.elNo || 0) + 1,
    deste: kalanDeste, desteIndex: idx, masaKartlari, eller, topladiklarim, pistiSayilari,
    aktifKoltuk: ilkOynayan, dagitici, sonAlanKoltuk: null, skorlar,
    aksiyonBitis: Date.now() + AKSIYON_SURESI_MS, kazananKoltuk: null, sonElPuanlari: null
  });
}
function oyunuBaslat() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyuncu_bekleniyor') { return; }
    const oturanIndeksler = oturanKoltukIndeksleri(mevcut);
    if (oturanIndeksler.length < MIN_OYUNCU) { return; }
    return yeniElBaslatSifirdan(mevcut, oturanIndeksler, oturanIndeksler[0]);
  }).then((res) => { if (!res.committed) { showToast('Oyunu başlatmak için en az ' + MIN_OYUNCU + ' oyuncu oturmalı.', { variant: 'error' }); } });
}
function elBittiSonrakiEl() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'el_bitti') { return; }
    if (!mevcut.guncellemeTs || Date.now() - mevcut.guncellemeTs < EL_BITTI_BEKLEME_MS) { return; }
    const oturanIndeksler = oturanKoltukIndeksleri(mevcut);
    if (oturanIndeksler.length < MIN_OYUNCU) { return Object.assign({}, mevcut, { durum: 'oyuncu_bekleniyor', guncellemeTs: Date.now() }); }
    return yeniElBaslatSifirdan(mevcut, oturanIndeksler, mevcut.dagitici);
  });
}

// ── Bir eli oynamanın ortak mantığı -- normal sıradaki oyuncu VEYA zaman
// aşımı/terk edilme kurtarması TARAFINDAN aynı şekilde çağrılır. ──
function elSonunuIsle(mevcut, oturanIndeksler, koltukIndex, yeniEller, sonuc, pistiSayilariSonraki, topladiklarimSonraki, sonAlanKoltukSonraki) {
  const herkesinEliBosMu = oturanIndeksler.every((i) => (yeniEller[i] || []).length === 0);
  if (!herkesinEliBosMu) {
    const sonrakiAktif = oturanIndeksler[(oturanIndeksler.indexOf(koltukIndex) + 1) % oturanIndeksler.length];
    return Object.assign({}, mevcut, {
      eller: yeniEller, masaKartlari: sonuc.yeniMasaKartlari, topladiklarim: topladiklarimSonraki, pistiSayilari: pistiSayilariSonraki,
      sonAlanKoltuk: sonAlanKoltukSonraki, aktifKoltuk: sonrakiAktif, aksiyonBitis: Date.now() + AKSIYON_SURESI_MS, guncellemeTs: Date.now()
    });
  }
  // (mevcut.deste || []) -- Hold'em'de aynı sınıftan gerçek bir çökme
  // bulundu: gerçek Firebase boş dizileri hiç saklamaz, saf JS testleri bunu
  // yakalayamıyor. Deste pratikte hiç boş olmasa da ucuz bir sigorta.
  const kalanKartSayisi = (mevcut.deste || []).length - mevcut.desteIndex;
  if (pistiDesteYeterliMi(kalanKartSayisi, oturanIndeksler.length)) {
    const yeniEllerYeniden = {};
    oturanIndeksler.forEach((i) => { yeniEllerYeniden[i] = []; });
    let idx = mevcut.desteIndex;
    for (let tur = 0; tur < EL_BASINA_KART; tur++) { oturanIndeksler.forEach((i) => { yeniEllerYeniden[i].push(mevcut.deste[idx]); idx++; }); }
    const sonrakiAktif = oturanIndeksler[(oturanIndeksler.indexOf(koltukIndex) + 1) % oturanIndeksler.length];
    return Object.assign({}, mevcut, {
      eller: yeniEllerYeniden, desteIndex: idx, masaKartlari: sonuc.yeniMasaKartlari, topladiklarim: topladiklarimSonraki, pistiSayilari: pistiSayilariSonraki,
      sonAlanKoltuk: sonAlanKoltukSonraki, aktifKoltuk: sonrakiAktif, aksiyonBitis: Date.now() + AKSIYON_SURESI_MS, guncellemeTs: Date.now()
    });
  }
  // Deste tükendi, el gerçekten bitti -- masada kalan (varsa) son alana gider.
  let topladiklarimArr = oturanIndeksler.map((i) => topladiklarimSonraki[i] || []);
  const masadaKalan = sonuc.yeniMasaKartlari;
  if (sonAlanKoltukSonraki !== null && sonAlanKoltukSonraki !== undefined && masadaKalan.length) {
    const sonAlanPos = oturanIndeksler.indexOf(sonAlanKoltukSonraki);
    topladiklarimArr = pistiSonMasayiDagit(masadaKalan, sonAlanPos, topladiklarimArr);
  }
  const pistiSayilariArr = oturanIndeksler.map((i) => pistiSayilariSonraki[i] || 0);
  const elPuanlariArr = pistiElPuanlariniHesapla(topladiklarimArr, pistiSayilariArr);
  const yeniSkorlar = Object.assign({}, mevcut.skorlar);
  const sonElPuanlari = {};
  oturanIndeksler.forEach((i, pos) => { yeniSkorlar[i] = (yeniSkorlar[i] || 0) + elPuanlariArr[pos]; sonElPuanlari[i] = elPuanlariArr[pos]; });
  const kazananIndex = oturanIndeksler.find((i) => yeniSkorlar[i] >= HEDEF_PUAN);
  const ortak = { eller: yeniEller, masaKartlari: [], skorlar: yeniSkorlar, sonElPuanlari, sonAlanKoltuk: sonAlanKoltukSonraki, aktifKoltuk: null, aksiyonBitis: null, guncellemeTs: Date.now() };
  if (kazananIndex !== undefined) { return Object.assign({}, mevcut, ortak, { durum: 'oyun_bitti', kazananKoltuk: kazananIndex }); }
  const yeniDagitici = oturanIndeksler[(oturanIndeksler.indexOf(mevcut.dagitici) + 1) % oturanIndeksler.length];
  return Object.assign({}, mevcut, ortak, { durum: 'el_bitti', dagitici: yeniDagitici });
}

function kartOyna(koltukIndex, kartIndex) {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oynaniyor' || mevcut.aktifKoltuk !== koltukIndex) { return; }
    const koltuk = mevcut.koltuklar[koltukIndex];
    if (!koltuk || koltuk.uid !== currentUserUid) { return; }
    const el = mevcut.eller[koltukIndex] || [];
    const kart = el[kartIndex];
    if (!kart) { return; }
    const yeniEl = el.slice(); yeniEl.splice(kartIndex, 1);
    const yeniEller = Object.assign({}, mevcut.eller, { [koltukIndex]: yeniEl });
    const sonuc = pistiHamleUygula(mevcut.masaKartlari || [], kart);
    const topladiklarimSonraki = Object.assign({}, mevcut.topladiklarim);
    const pistiSayilariSonraki = Object.assign({}, mevcut.pistiSayilari);
    // KÖK NEDEN (nihayet bulundu): Firebase'de bir alanı `null` yazmak o
    // alanı TAMAMEN SİLER (silinmiş alan == hiç yazılmamış alan) -- yani
    // `sonAlanKoltuk: null` hiçbir zaman GERÇEKTEN saklanmıyor, bir sonraki
    // okumada `mevcut.sonAlanKoltuk` `null` DEĞİL `undefined` geliyor. Bunu
    // doğrudan yeni bir alana yazınca (aşağıda `sonAlanKoltuk:
    // sonAlanKoltukSonraki`) Firebase SDK'sı `undefined` DEĞER içeren
    // nesneleri yazmayı İSTEMCİ TARAFINDA reddediyor (kod'suz, düz `Error`
    // fırlatıyor) -- "Masa güncellenemedi (Error)" hatasının GERÇEK
    // kaynağı buydu: hiçbir eşleşme yakalamayan HER hamlede tetikleniyordu.
    let sonAlanKoltukSonraki = mevcut.sonAlanKoltuk === undefined ? null : mevcut.sonAlanKoltuk;
    if (sonuc.alinanKartlar.length) {
      topladiklarimSonraki[koltukIndex] = (topladiklarimSonraki[koltukIndex] || []).concat(sonuc.alinanKartlar);
      sonAlanKoltukSonraki = koltukIndex;
      if (sonuc.pistiMi) { pistiSayilariSonraki[koltukIndex] = (pistiSayilariSonraki[koltukIndex] || 0) + 1; }
    }
    const oturanIndeksler = oturanKoltukIndeksleri(mevcut);
    return elSonunuIsle(mevcut, oturanIndeksler, koltukIndex, yeniEller, sonuc, pistiSayilariSonraki, topladiklarimSonraki, sonAlanKoltukSonraki);
  });
}

// Sırası gelen oyuncu 30 sn içinde oynamazsa elindeki İLK kartı otomatik oynar
// -- Pişti'de "pas geçme" diye bir şey yok, her turda mutlaka bir kart
// oynanmalı, bu yüzden Blackjack'teki "otomatik Kal" karşılığı budur.
function zamanAsimindaOtomatikOyna() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oynaniyor' || mevcut.aktifKoltuk === null || mevcut.aktifKoltuk === undefined) { return; }
    if (!mevcut.aksiyonBitis || Date.now() < mevcut.aksiyonBitis) { return; }
    const koltukIndex = mevcut.aktifKoltuk;
    const el = mevcut.eller[koltukIndex] || [];
    if (!el.length) { return; }
    const kart = el[0];
    const yeniEl = el.slice(1);
    const yeniEller = Object.assign({}, mevcut.eller, { [koltukIndex]: yeniEl });
    const sonuc = pistiHamleUygula(mevcut.masaKartlari || [], kart);
    const topladiklarimSonraki = Object.assign({}, mevcut.topladiklarim);
    const pistiSayilariSonraki = Object.assign({}, mevcut.pistiSayilari);
    // KÖK NEDEN (nihayet bulundu): Firebase'de bir alanı `null` yazmak o
    // alanı TAMAMEN SİLER (silinmiş alan == hiç yazılmamış alan) -- yani
    // `sonAlanKoltuk: null` hiçbir zaman GERÇEKTEN saklanmıyor, bir sonraki
    // okumada `mevcut.sonAlanKoltuk` `null` DEĞİL `undefined` geliyor. Bunu
    // doğrudan yeni bir alana yazınca (aşağıda `sonAlanKoltuk:
    // sonAlanKoltukSonraki`) Firebase SDK'sı `undefined` DEĞER içeren
    // nesneleri yazmayı İSTEMCİ TARAFINDA reddediyor (kod'suz, düz `Error`
    // fırlatıyor) -- "Masa güncellenemedi (Error)" hatasının GERÇEK
    // kaynağı buydu: hiçbir eşleşme yakalamayan HER hamlede tetikleniyordu.
    let sonAlanKoltukSonraki = mevcut.sonAlanKoltuk === undefined ? null : mevcut.sonAlanKoltuk;
    if (sonuc.alinanKartlar.length) {
      topladiklarimSonraki[koltukIndex] = (topladiklarimSonraki[koltukIndex] || []).concat(sonuc.alinanKartlar);
      sonAlanKoltukSonraki = koltukIndex;
      if (sonuc.pistiMi) { pistiSayilariSonraki[koltukIndex] = (pistiSayilariSonraki[koltukIndex] || 0) + 1; }
    }
    const oturanIndeksler = oturanKoltukIndeksleri(mevcut);
    return elSonunuIsle(mevcut, oturanIndeksler, koltukIndex, yeniEller, sonuc, pistiSayilariSonraki, topladiklarimSonraki, sonAlanKoltukSonraki);
  });
}

function yeniOyunBaslat() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oyun_bitti') { return; }
    const koltuklar = Object.assign({}, mevcut.koltuklar);
    // hazir SIFIRLANIR -- yoksa herkes zaten "hazır" görünüp yeni oyun anında
    // (kimse yeniden onaylamadan) tekrar başlar, sonsuz döngü olurdu.
    Object.keys(koltuklar).forEach((i) => { if (koltuklar[i]) { koltuklar[i] = Object.assign({}, koltuklar[i], { katilimDurumu: 'hazir', hazir: false }); } });
    return Object.assign({}, mevcut, {
      durum: 'oyuncu_bekleniyor', koltuklar, skorlar: {}, eller: {}, topladiklarim: {}, pistiSayilari: {},
      masaKartlari: [], aktifKoltuk: null, aksiyonBitis: null, kazananKoltuk: null, sonElPuanlari: null, guncellemeTs: Date.now()
    });
  });
}

// ── Oyunu erken bitirme (mutabakatla) -- 101 puana ulaşmak birkaç el
// sürebildiğinden kullanıcı isteği: herhangi bir oturan "Oyunu Bitir"
// önerebilir, DİĞER TÜM oturanlar kabul ederse oyun O ANDA biter. Puan,
// deste tükenmesini BEKLEMEDEN şu ana kadar toplanan kartlarla hesaplanır
// (pistiElPuanlariniHesapla zaten kısmi veriyle de doğru çalışır -- hâlâ
// elde/destede duran kartlar hiç kimseye sayılmaz).
function oyunuErkenBitir(mevcut, oturanIndeksler) {
  const topladiklarimArr = oturanIndeksler.map((i) => (mevcut.topladiklarim && mevcut.topladiklarim[i]) || []);
  const pistiSayilariArr = oturanIndeksler.map((i) => (mevcut.pistiSayilari && mevcut.pistiSayilari[i]) || 0);
  const elPuanlariArr = pistiElPuanlariniHesapla(topladiklarimArr, pistiSayilariArr);
  const yeniSkorlar = Object.assign({}, mevcut.skorlar);
  const sonElPuanlari = {};
  oturanIndeksler.forEach((i, pos) => { yeniSkorlar[i] = (yeniSkorlar[i] || 0) + elPuanlariArr[pos]; sonElPuanlari[i] = elPuanlariArr[pos]; });
  const kazananIndex = oturanIndeksler.reduce((en, i) => (en === null || yeniSkorlar[i] > yeniSkorlar[en] ? i : en), null);
  return Object.assign({}, mevcut, {
    durum: 'oyun_bitti', skorlar: yeniSkorlar, sonElPuanlari, kazananKoltuk: kazananIndex, bitirmeTeklifi: null,
    aktifKoltuk: null, aksiyonBitis: null, guncellemeTs: Date.now()
  });
}
function teklifEtBitir() {
  return masaIslemi((mevcut) => {
    if (!mevcut || mevcut.durum !== 'oynaniyor' || mevcut.bitirmeTeklifi) { return; }
    const benim = benimKoltukIndex(mevcut);
    if (benim === null) { return; }
    return Object.assign({}, mevcut, { bitirmeTeklifi: { oneren: benim, kabulEdenler: [benim], ts: Date.now() }, guncellemeTs: Date.now() });
  }).then((res) => { if (!res.committed && !res.beklemede) { showToast('Bitirme teklifi gönderilemedi.', { variant: 'error' }); } });
}
function teklifYanitla(kabul) {
  return masaIslemi((mevcut) => {
    if (!mevcut || !mevcut.bitirmeTeklifi) { return; }
    const benim = benimKoltukIndex(mevcut);
    if (benim === null) { return; }
    if (!kabul) { return Object.assign({}, mevcut, { bitirmeTeklifi: null, guncellemeTs: Date.now() }); }
    const oturanIndeksler = oturanKoltukIndeksleri(mevcut);
    const kabulEdenler = Array.from(new Set((mevcut.bitirmeTeklifi.kabulEdenler || []).concat([benim])));
    const hepsiKabulEtti = oturanIndeksler.every((i) => kabulEdenler.includes(i));
    if (!hepsiKabulEtti) {
      return Object.assign({}, mevcut, { bitirmeTeklifi: Object.assign({}, mevcut.bitirmeTeklifi, { kabulEdenler }), guncellemeTs: Date.now() });
    }
    return oyunuErkenBitir(mevcut, oturanIndeksler);
  });
}

// Bir sonraki adıma geçişi TEK bir istemcinin zamanlayıcısına bağlamıyoruz --
// o istemci sayfadan ayrılırsa masa kilitli kalır (bkz. Blackjack'te bulunup
// düzeltilen aynı hata). Her bağlı istemcinin dinleyicisi tetiklendiğinde
// "geçiş zamanı geldi mi?" diye kontrol eder.
function belkiSonrakiFazaGec(table) {
  if (!table || !canPlay || !modeReady || isReadOnly() || pendingTableOperation || playerActionPending || tableError) { return; }
  const terkEdilmisMi = Boolean(table.guncellemeTs) && Date.now() - table.guncellemeTs > TERK_EDILME_MS;
  if (table.durum !== 'oyuncu_bekleniyor' && benimKoltukIndex(table) === null && !terkEdilmisMi) { return; }
  if (table.durum === 'el_bitti' && table.guncellemeTs && Date.now() - table.guncellemeTs > EL_BITTI_BEKLEME_MS) { elBittiSonrakiEl(); return; }
  if (table.durum === 'oynaniyor' && table.aksiyonBitis && Date.now() >= table.aksiyonBitis) { zamanAsimindaOtomatikOyna(); return; }
  // "Oyunu başlat" düğmesi YOK -- oturan herkes hazır olunca herhangi bir
  // bağlı istemcinin bu watchdog'u (dinleyici tetiklenmesi VEYA 1sn'lik
  // interval) devreye girip başlatması yeterli.
  if (table.durum === 'oyuncu_bekleniyor') {
    const oturanIndeksler = oturanKoltukIndeksleri(table);
    const hepsiHazirMi = oturanIndeksler.length >= MIN_OYUNCU && oturanIndeksler.every((i) => table.koltuklar[i].hazir);
    if (hepsiHazirMi) { oyunuBaslat(); return; }
  }
  // Oyun bitince bir süre sonuç ekranı gösterilip OTOMATİK lobiye dönülür --
  // hazır durumları sıfırlanır (yeniOyunBaslat), tekrar başlamak için herkes
  // yeniden hazır vermeli (sonsuz döngü olmasın diye).
  if (table.durum === 'oyun_bitti' && table.guncellemeTs && Date.now() - table.guncellemeTs > OYUN_BITTI_BEKLEME_MS) { yeniOyunBaslat(); }
}

// ── Render ──
function koltukAdi(index) { return String.fromCharCode(65 + index); } // A, B, C, D -- sadece rozet/etiket amaçlı
function renderMasa(table) {
  currentTable = table;
  const benimKoltuk = benimKoltukIndex(table);
  const root = document.querySelector('[data-pisti-root]');
  if (root) { root.dataset.pistiElNo = table.elNo || 0; }
  renderKoltuklar(table, benimKoltuk);
  renderMasaKartlari(table);
  renderElim(table, benimKoltuk);
  renderDurumSatiri(table, benimKoltuk);
  renderSkorPaneli(table);
  renderElBittiPaneli(table);
  renderOyunBittiPaneli(table);
  renderBitirmeTeklifi(table, benimKoltuk);
  renderIslemDurumu();
}
function renderBitirmeTeklifi(table, benimKoltuk) {
  const bitirBtn = document.querySelector('[data-pisti-teklif-bitir]');
  const teklif = table.bitirmeTeklifi;
  const oturuyorMu = benimKoltuk !== null;
  if (bitirBtn) { bitirBtn.hidden = !oturuyorMu || table.durum !== 'oynaniyor' || Boolean(teklif); }
  const panel = document.querySelector('[data-pisti-teklif-paneli]');
  if (!panel) { return; }
  if (!teklif || !oturuyorMu) { panel.hidden = true; panel.innerHTML = ''; return; }
  const kabulEdenler = teklif.kabulEdenler || [];
  const benKabulEttimMi = kabulEdenler.includes(benimKoltuk);
  const oneren = table.koltuklar && table.koltuklar[teklif.oneren];
  panel.hidden = false;
  if (benKabulEttimMi) {
    panel.innerHTML = '<span>Oyunu bitirme teklifin gönderildi -- diğer oyuncular bekleniyor…</span>';
  } else {
    panel.innerHTML = '<span>' + escapeHtml((oneren && oneren.isim) || 'Bir oyuncu') + ' oyunu şimdi bitirmek istiyor (puanlar şu ana kadarki kartlarla hesaplanır).</span>' +
      '<button type="button" class="btn btn-primary" data-pisti-teklif-kabul>Kabul et</button>' +
      '<button type="button" class="btn btn-outline" data-pisti-teklif-reddet>Reddet</button>';
  }
}
function renderKoltuklar(table, benimKoltuk) {
  const el = document.querySelector('[data-pisti-koltuklar]');
  if (!el) { return; }
  const merkez = Math.floor(MAX_OYUNCU / 2);
  const sira = Array.from({ length: MAX_OYUNCU }, (_, goren) => benimKoltuk === null
    ? goren
    : (((benimKoltuk + (goren - merkez)) % MAX_OYUNCU) + MAX_OYUNCU) % MAX_OYUNCU);
  const siraImzasi = sira.join(':');
  if (siraImzasi !== lastSeatOrderSignature || el.children.length !== MAX_OYUNCU) {
    lastSeatOrderSignature = siraImzasi;
    renderedSeatSignatures.clear();
    el.innerHTML = sira.map((gercekIndex, goren) => '<div class="pisti-koltuk-slot" data-pisti-koltuk-slot="' + goren + '"></div>').join('');
  }
  sira.forEach((gercekIndex, goren) => {
    const slot = el.querySelector('[data-pisti-koltuk-slot="' + goren + '"]');
    const html = koltukHtml(gercekIndex, table.koltuklar && table.koltuklar[gercekIndex], table, benimKoltuk);
    if (slot && renderedSeatSignatures.get(goren) !== html) { renderedSeatSignatures.set(goren, html); slot.innerHTML = html; }
  });
}
function koltukHtml(koltukIndex, koltuk, table, benimKoltuk) {
  if (!koltuk || !koltuk.uid) {
    if (benimKoltuk !== null || table.durum !== 'oyuncu_bekleniyor') { return '<div class="pisti-koltuk pisti-koltuk-bos"></div>'; }
    return '<div class="pisti-koltuk pisti-koltuk-bos"><button type="button" class="pisti-otur-btn" data-pisti-otur="' + koltukIndex + '" title="Otur" aria-label="Otur">+</button></div>';
  }
  const benimMi = koltuk.uid === currentUserUid;
  const avatar = benimMi
    ? renderStaffAvatar(currentUserName, currentUserUid, currentUserName, 40)
    : renderStaffAvatar(koltuk.isim, koltuk.uid, koltuk.isim, 40);
  const aktifMi = table.aktifKoltuk === koltukIndex;
  const elKartSayisi = table.eller && table.eller[koltukIndex] ? table.eller[koltukIndex].length : 0;
  const topladigi = table.topladiklarim && table.topladiklarim[koltukIndex] ? table.topladiklarim[koltukIndex].length : 0;
  const skor = (table.skorlar && table.skorlar[koltukIndex]) || 0;
  const kazandiMi = table.durum === 'oyun_bitti' && table.kazananKoltuk === koltukIndex;
  // Rakiplerin elindeki kartlar SADECE sayı olarak görünür -- kapalı kart
  // yığını (gerçek Pişti'de el gizlidir). Kendi elim ayrı bir panelde (bkz.
  // renderElim) tam açık ve oynanabilir gösterilir, burada tekrar edilmez.
  const kartYiginBlok = !benimMi && elKartSayisi > 0
    ? '<div class="pisti-kapali-yigin"><img class="pisti-kart" src="' + desteArkasiYolu() + '" alt="Kapalı kart"><span class="pisti-kapali-sayac">' + elKartSayisi + '</span></div>'
    : '';
  return '<div class="pisti-koltuk' + (aktifMi ? ' pisti-koltuk-aktif' : '') + (benimMi ? ' pisti-koltuk-ben' : '') + (kazandiMi ? ' pisti-koltuk-kazanan' : '') + '">' +
    '<div class="pisti-avatar-cember">' + avatar + '</div>' +
    '<strong>' + escapeHtml(koltuk.isim || koltukAdi(koltukIndex)) + '</strong>' +
    '<span class="pisti-koltuk-skor">' + skor + ' puan</span>' +
    (topladigi ? '<span class="pisti-koltuk-topladigi">' + topladigi + ' kart topladı</span>' : '') +
    kartYiginBlok +
    (aktifMi ? '<span class="pisti-sira-isareti">◀ sırası</span>' : '') +
    '</div>';
}
function renderMasaKartlari(table) {
  const el = document.querySelector('[data-pisti-masa-kartlari]');
  if (!el) { return; }
  const kartlar = table.masaKartlari || [];
  const signature = table.elNo + ':' + kartlar.length + ':' + (kartlar[kartlar.length - 1] ? kartlar[kartlar.length - 1].r + kartlar[kartlar.length - 1].s : '');
  if (signature === lastPileSignature) { return; }
  lastPileSignature = signature;
  if (!kartlar.length) { el.innerHTML = '<div class="pisti-masa-bos">Masa boş</div>'; return; }
  // Yalnız üstteki (en son oynanan) kart tam görünür, altındakiler hafif
  // kaydırılmış bir yığın hissi versin diye arkada gösterilir.
  const arkaKartSayisi = Math.min(kartlar.length - 1, 4);
  let html = '';
  for (let i = 0; i < arkaKartSayisi; i++) { html += '<div class="pisti-yigin-alt-kart" style="--i:' + i + '"></div>'; }
  html += kartHtml(kartlar[kartlar.length - 1], 'pisti-ust-kart pisti-slide-top');
  el.innerHTML = html;
  el.dataset.pistiKartSayisi = kartlar.length;
}
function renderElim(table, benimKoltuk) {
  const el = document.querySelector('[data-pisti-elim]');
  if (!el) { return; }
  if (benimKoltuk === null || !table.eller || !table.eller[benimKoltuk]) {
    if (el.childElementCount) { el.innerHTML = ''; }
    lastHandSignature = '';
    return;
  }
  const elimKartlari = table.eller[benimKoltuk];
  const sinifAl = yeniKartAnimasyonSinifi('el:' + benimKoltuk, elimKartlari.length, table.elNo);
  const benimSiram = table.durum === 'oynaniyor' && table.aktifKoltuk === benimKoltuk;
  const signature = JSON.stringify(elimKartlari) + ':' + benimSiram;
  if (signature === lastHandSignature) { return; }
  lastHandSignature = signature;
  const sayi = elimKartlari.length;
  let html = '';
  elimKartlari.forEach((kart, index) => {
    const ofset = index - (sayi - 1) / 2;
    const stepDeg = sayi > 1 ? Math.min(9, 46 / (sayi - 1)) : 0;
    const rotate = ofset * stepDeg;
    const spacing = sayi > 5 ? 40 : 48;
    const x = ofset * spacing;
    const y = Math.abs(rotate) * 1.9;
    const stil = '--pisti-rot:' + rotate.toFixed(2) + 'deg; --pisti-x:' + x.toFixed(1) + 'px; --pisti-y:' + y.toFixed(1) + 'px; z-index:' + (10 + index) + ';';
    html += '<button type="button" class="pisti-el-kart-btn" style="' + stil + '" data-pisti-oyna="' + index + '"' + (benimSiram ? '' : ' disabled') + '>' +
      kartHtml(kart, sinifAl(index)) + '</button>';
  });
  el.innerHTML = html;
}
// Her kart yalnız İLK kez göründüğünde kayma animasyonuyla girer -- bkz.
// Blackjack'te aynı isimle bulunup düzeltilen "her render'da tüm kartlar
// yeniden kayıyor" hatası.
let animasyonElNo = null;
let animeSayaclari = {};
function yeniKartAnimasyonSinifi(anahtar, mevcutUzunluk, tableElNo) {
  if (animasyonElNo !== tableElNo) { animasyonElNo = tableElNo; animeSayaclari = {}; }
  const onceki = animeSayaclari[anahtar] || 0;
  animeSayaclari[anahtar] = Math.max(onceki, mevcutUzunluk);
  return (i) => (i >= onceki ? 'pisti-slide-bottom' : '');
}
function renderDurumSatiri(table, benimKoltuk) {
  const durum = document.querySelector('[data-pisti-sira-bildirimi]');
  const sayacEl = document.querySelector('[data-pisti-sayac]');
  const oturanSayisi = oturanKoltukIndeksleri(table).length;
  if (durum) {
    if (table.durum === 'oyuncu_bekleniyor') {
      if (oturanSayisi < MIN_OYUNCU) { durum.textContent = 'En az ' + MIN_OYUNCU + ' oyuncu bekleniyor…'; }
      else {
        const hazirSayisi = oturanKoltukIndeksleri(table).filter((i) => table.koltuklar[i].hazir).length;
        durum.textContent = hazirSayisi + '/' + oturanSayisi + ' oyuncu hazır -- herkes hazır olunca oyun başlar.';
      }
    }
    else if (table.durum === 'oynaniyor') { durum.textContent = table.aktifKoltuk === benimKoltuk ? 'Sıra sende -- bir kart oyna.' : ((table.koltuklar[table.aktifKoltuk] || {}).isim || 'Rakip') + ' oynuyor…'; }
    else if (table.durum === 'el_bitti') { durum.textContent = 'El bitti -- puanlar hesaplandı.'; }
    else if (table.durum === 'oyun_bitti') { durum.textContent = ((table.koltuklar[table.kazananKoltuk] || {}).isim || 'Bir oyuncu') + ' oyunu kazandı!'; }
  }
  if (sayacEl) {
    const saniye = table.durum === 'oynaniyor' && table.aksiyonBitis ? Math.max(0, Math.ceil((table.aksiyonBitis - Date.now()) / 1000)) : null;
    sayacEl.textContent = saniye === null ? '' : saniye + ' sn';
  }
  // Eski "Oyunu başlat" düğmesi artık kişisel "Hazırım" değiştiricisi --
  // herkes hazır olunca belkiSonrakiFazaGec otomatik başlatıyor.
  const baslatBtn = document.querySelector('[data-pisti-baslat]');
  if (baslatBtn) {
    baslatBtn.hidden = benimKoltuk === null || table.durum !== 'oyuncu_bekleniyor';
    const benimHazirMi = benimKoltuk !== null && table.koltuklar[benimKoltuk] && table.koltuklar[benimKoltuk].hazir;
    baslatBtn.textContent = benimHazirMi ? 'Hazır ✓' : 'Hazırım';
    baslatBtn.classList.toggle('btn-outline', Boolean(benimHazirMi));
  }
  const oturBos = document.querySelector('[data-pisti-oturmadim]');
  if (oturBos) { oturBos.hidden = benimKoltuk !== null || table.durum !== 'oyuncu_bekleniyor'; }
  // Kalkma yalnız oyun BAŞLAMADAN ÖNCE anlamlı -- oynaniyor/el_bitti/oyun_bitti
  // fazlarında Pişti'nin sıra bazlı el mekaniği yarım bırakılmış bir koltuğu
  // desteklemiyor (kalk() zaten bu fazlarda no-op, düğme de o yüzden gizli).
  const kalkBtn = document.querySelector('[data-pisti-kalk-durum]');
  if (kalkBtn) { kalkBtn.hidden = benimKoltuk === null || table.durum !== 'oyuncu_bekleniyor'; }
}
function renderSkorPaneli(table) {
  const el = document.querySelector('[data-pisti-skor-tablosu]');
  if (!el) { return; }
  const oturanIndeksler = oturanKoltukIndeksleri(table);
  if (!oturanIndeksler.length) { el.innerHTML = ''; return; }
  el.innerHTML = oturanIndeksler.map((i) => {
    const koltuk = table.koltuklar[i];
    return '<div class="pisti-skor-satir"><span>' + escapeHtml(koltuk.isim || koltukAdi(i)) + '</span><strong>' + ((table.skorlar && table.skorlar[i]) || 0) + '</strong></div>';
  }).join('');
}
function renderElBittiPaneli(table) {
  const el = document.querySelector('[data-pisti-el-bitti-paneli]');
  if (!el) { return; }
  if (table.durum !== 'el_bitti' || !table.sonElPuanlari) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const oturanIndeksler = oturanKoltukIndeksleri(table);
  el.innerHTML = '<strong>El bitti</strong>' + oturanIndeksler.map((i) => {
    const koltuk = table.koltuklar[i];
    const puan = table.sonElPuanlari[i] || 0;
    return '<div class="pisti-el-bitti-satir"><span>' + escapeHtml(koltuk.isim || koltukAdi(i)) + '</span><span>+' + puan + '</span></div>';
  }).join('');
}
function renderOyunBittiPaneli(table) {
  const el = document.querySelector('[data-pisti-oyun-bitti-paneli]');
  if (!el) { return; }
  if (table.durum !== 'oyun_bitti') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const kazanan = table.koltuklar && table.koltuklar[table.kazananKoltuk];
  el.innerHTML = '<strong>🎉 ' + escapeHtml((kazanan && kazanan.isim) || 'Bir oyuncu') + ' kazandı!</strong>' +
    '<button type="button" class="btn btn-primary" data-pisti-yeni-oyun>Yeni oyun</button>';
}

function siraSaatiniBaslat() {
  if (turnCountdownTimer) { return; }
  turnCountdownTimer = setInterval(() => {
    if (!currentTable) { return; }
    const sayacEl = document.querySelector('[data-pisti-sayac]');
    if (!sayacEl || currentTable.durum !== 'oynaniyor' || !currentTable.aksiyonBitis) { return; }
    const signature = currentTable.aktifKoltuk + ':' + currentTable.aksiyonBitis;
    if (signature !== turnCountdownSignature) { turnCountdownSignature = signature; }
    const saniye = Math.max(0, Math.ceil((currentTable.aksiyonBitis - Date.now()) / 1000));
    sayacEl.textContent = saniye + ' sn';
  }, 1000);
}

function eventleriBagla() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-pisti-yeniden-dene]')) { tableError = ''; renderIslemDurumu(); attachTableListener(true); return; }
    // "Oyunu başlat" sayfa BAŞLIĞINDA (.card-options), [data-pisti-root]'un
    // (yalnız masayı saran) DIŞINDA yaşıyor -- aşağıdaki kapsam kontrolünden
    // ÖNCE ele alınmalı, yoksa tıklama sessizce yok sayılıyordu.
    if (e.target.closest('[data-pisti-baslat]')) { if (!isReadOnly()) { oyuncuIslemi(hazirVer); } return; }
    if (e.target.closest('[data-pisti-kalk-durum]')) {
      if (!isReadOnly()) { const benim = benimKoltukIndex(currentTable); if (benim !== null) { oyuncuIslemi(() => kalk(benim)); } }
      return;
    }
    if (e.target.closest('[data-pisti-teklif-bitir]')) { if (!isReadOnly()) { oyuncuIslemi(teklifEtBitir); } return; }
    if (e.target.closest('[data-pisti-teklif-kabul]')) { if (!isReadOnly()) { oyuncuIslemi(() => teklifYanitla(true)); } return; }
    if (e.target.closest('[data-pisti-teklif-reddet]')) { if (!isReadOnly()) { oyuncuIslemi(() => teklifYanitla(false)); } return; }
    if (!e.target.closest('[data-pisti-root]')) { return; }
    if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
    const oturBtn = e.target.closest('[data-pisti-otur]'); if (oturBtn) { oyuncuIslemi(() => otur(Number(oturBtn.dataset.pistiOtur))); return; }
    const kalkBtn = e.target.closest('[data-pisti-kalk]'); if (kalkBtn) { oyuncuIslemi(() => kalk(Number(kalkBtn.dataset.pistiKalk))); return; }
    if (e.target.closest('[data-pisti-yeni-oyun]')) { oyuncuIslemi(yeniOyunBaslat); return; }
    const oynaBtn = e.target.closest('[data-pisti-oyna]');
    if (oynaBtn && !oynaBtn.disabled) {
      const benimKoltuk = benimKoltukIndex(currentTable);
      if (benimKoltuk === null) { return; }
      oyuncuIslemi(() => kartOyna(benimKoltuk, Number(oynaBtn.dataset.pistiOyna)));
    }
  });
}

// ── Godot köprüsü -- Godot (WebAssembly) artık AYRI bir iframe'de
// (/godot/pisti/frame.html) çalışıyor, sitenin CSS/flex/CSP'siyle
// çakışmasın diye izole edildi. Doğrudan window.pistiXxx çağrısı YOK --
// iframe sınırını postMessage ile aşıyoruz. Gerçek kural/yazma mantığı HEP
// burada (masaIslemi/transaction) kalır -- Godot sadece görselleştirip
// tıklamayı yönlendirir, kendi başına state hesaplamaz.
let pistiGodotFrame = null;
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !pistiGodotFrame || e.source !== pistiGodotFrame.contentWindow || !e.data) { return; }
  if (e.data.type === 'pistiHazir') { pistiGodotIlet(); return; }
  if (e.data.type === 'pistiOtur') { oyuncuIslemi(() => otur(Number(e.data.koltukIndex))); return; }
  if (e.data.type === 'pistiHazirVer') { oyuncuIslemi(hazirVer); return; }
  if (e.data.type === 'pistiKalk') { oyuncuIslemi(() => kalk(Number(e.data.koltukIndex))); return; }
  if (e.data.type === 'pistiKartOyna') {
    const benim = benimKoltukIndex(currentTable);
    if (benim === null) { return; }
    oyuncuIslemi(() => kartOyna(benim, Number(e.data.kartIndex)));
  }
});
function pistiGodotIlet() {
  if (!pistiGodotFrame) { pistiGodotFrame = document.getElementById('pisti-godot-iframe'); }
  if (!pistiGodotFrame || !pistiGodotFrame.contentWindow || !currentTable) { return; }
  pistiGodotFrame.contentWindow.postMessage({ type: 'pistiKimlik', uid: currentUserUid }, location.origin);
  pistiGodotFrame.contentWindow.postMessage({ type: 'pistiMasaGuncelle', table: currentTable }, location.origin);
}

function attachTableListener(force = false) {
  if (!modeReady || !canPlay) { return; }
  const yeniYol = dbPath(MASA_YOLU);
  if (!force && tableRef && attachedTablePath === yeniYol && tableListener) { return; }
  if (tableRef && tableListener) { tableRef.off('value', tableListener); }
  if (phaseWatchdog) { clearInterval(phaseWatchdog); phaseWatchdog = null; }
  currentTable = null;
  lastSeatOrderSignature = '';
  renderedSeatSignatures.clear();
  lastPileSignature = '';
  lastHandSignature = '';
  animasyonElNo = null;
  animeSayaclari = {};
  tableRef = database.ref(yeniYol);
  attachedTablePath = yeniYol;
  tableListener = (snap) => {
    if (attachedTablePath !== yeniYol || !canPlay) { return; }
    const table = snap.val() || { durum: 'oyuncu_bekleniyor', koltuklar: {}, skorlar: {}, guncellemeTs: Date.now(), elNo: 0 };
    renderMasa(table);
    belkiSonrakiFazaGec(table);
    pistiGodotIlet(); // Godot iframe'i varsa (bkz. yukarısı) her güncellemeyi ona da ilet
  };
  tableRef.on('value', tableListener, masaHatasi);
  phaseWatchdog = setInterval(() => { if (currentTable) { belkiSonrakiFazaGec(currentTable); } }, 1000);
}

export function initPisti() {
  const firebase = globalThis.firebase;
  if (!firebase) { return; }
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  eventleriBagla();
  siraSaatiniBaslat();
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      canPlay = false; currentUserUid = ''; currentUserName = ''; currentUserEmail = '';
      if (tableRef && tableListener) { tableRef.off('value', tableListener); }
      tableRef = null; tableListener = null;
      if (phaseWatchdog) { clearInterval(phaseWatchdog); phaseWatchdog = null; }
      renderIslemDurumu();
      return;
    }
    currentUserEmail = user.email || '';
    currentUserUid = user.uid;
    try {
      await initDbMode(database);
      renderDbModeBanner();
      modeReady = true;
      const profile = await database.ref('users/' + user.uid).once('value');
      const p = profile.val() || {};
      canPlay = (p.role === 'editor' || p.role === 'admin' || p.role === 'owner') && p.blocked !== true;
      currentUserName = ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || user.email || 'Sen';
      if (!canPlay) { tableError = 'Oynamak için yetkiniz yok.'; renderIslemDurumu(); return; }
      subscribeStaffProfiles(database);
      attachTableListener(true);
    } catch (err) {
      masaHatasi(err);
    }
  });
}
