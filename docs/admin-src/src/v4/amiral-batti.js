// Amiral Battı (oyun-amiral-batti.html) -- kullanıcı isteği: "masaütümdeki amiral
// battı oyununu site içinde satranç gibi iki kişinin oynayabileceği bir hale
// getirelim, bir kazanma liderboardı olsun". Mimari tamamen chess-game.js ile
// AYNI desen: Firebase Realtime Database senkronu, davet-linki tabanlı lobi,
// "Oyunlarım" listesi, staffProfiles'tan rakip seçimi.
//
// Oyun durumu (davet/yerleştirme/atışlar) `oyunBasarimlari/amiralBatti/oyunlar/{id}`
// altında -- kullanıcı isteği: "oyunBasarimlari altına koyalım, amiralbattı>
// amiralbattıgizli konumlarını böyle klasörleyelim". Liderlik tablosu zaten
// `oyunBasarimlari/amiralBatti/{uid}` altındaydı, bu ikisi artık aynı üst
// düğümün ("oyunlar" ve $scoreUid) kardeş çocukları.
//
// Gemi yerleşimi GİZLİ olmalı (rakip görmemeli) -- `oyunBasarimlari/$oyunAdi`
// düğümünün .read kuralı TÜM editör/admin/owner'lara açık (liderlik tablosu
// herkes tarafından görülebilsin diye) ve Firebase'de bir üst düğümdeki geniş
// okuma izni alt düğümlere de otomatik sızıyor -- bu yüzden gemi yerleşimi
// BİLEREK oyunBasarimlari'nin DIŞINDA, kendi ayrı üst düzey düğümünde kaldı:
// `amiralBattiGizli/{id}/{uid}` -- yalnızca kendi uid'i okuyabilir/yazabilir
// (bkz. firebase-database-rules.json). İsabet/ıska sonucu ise SADECE hedef
// oyuncunun istemcisi hesaplayabilir (gemi hücrelerini yalnızca o biliyor) --
// bu yüzden bir atış önce "bekliyor" olarak yazılır, hedef oyuncunun istemcisi
// onu görüp kendi gizli filosuna bakarak sonucu ("kacti"/"isabet"/"batti")
// geri yazar.
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';
import { showToast } from './toast.js';
import { showModal } from './modal.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const SIZE = 10;
const FLEET = [
  { id: 'ucak-gemisi', ad: 'Uçak Gemisi', boy: 5 },
  { id: 'zirhli', ad: 'Zırhlı', boy: 4 },
  { id: 'kruvazor', ad: 'Kruvazör', boy: 3 },
  { id: 'denizalti', ad: 'Denizaltı', boy: 3 },
  { id: 'muhrip', ad: 'Muhrip', boy: 2 }
];
const TOPLAM_HUCRE = FLEET.reduce((t, g) => t + g.boy, 0); // 17

let database = null;
let currentUserUid = '';
let currentUserName = '';
let currentUserEmail = '';
let canPlay = false;
let staffPool = null;

let currentGameId = null;
let currentGame = null;
let gameListenerRef = null;
let myGamesListenerRef = null;
let lastLobbyItems = null;

// ── Yerleştirme aşaması durumu ──
let yerlesim = new Map(); // gemiId -> { hucreler: [{r,c}] }
let seciliGemiId = null;
let yerlestirmeYonu = 'h'; // 'h' | 'v'
let hazirBildirildi = false;

// ── Oyun içi (savaş) durumu ──
let benimGemilerim = null; // [{id, hucreler:[{r,c}]}] -- once('value') ile amiralBattiGizli'den yüklenir
let cozulmekteOlanHucreler = new Set(); // aynı hücrenin iki kez işlenmesini engeller

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hucreAnahtari(r, c) { return r + '_' + c; }

function benimOyuncuNumaram(game) {
  if (!game) { return null; }
  if (game.oyuncu1Uid === currentUserUid) { return 1; }
  if (game.oyuncu2Uid === currentUserUid) { return 2; }
  return null;
}
function rakipOyuncuNumaram(game) { const n = benimOyuncuNumaram(game); return n === 1 ? 2 : (n === 2 ? 1 : null); }
function oyuncuUid(game, no) { return no === 1 ? game.oyuncu1Uid : game.oyuncu2Uid; }
function oyuncuAdi(game, no) { return no === 1 ? (game.oyuncu1Ad || '') : (game.oyuncu2Ad || ''); }

function loadStaffPool() {
  if (staffPool) { return Promise.resolve(staffPool); }
  return database.ref(dbPath('staffProfiles')).once('value').then((snap) => {
    const obj = snap.val() || {};
    staffPool = Object.keys(obj)
      .filter((uid) => uid !== currentUserUid)
      .map((uid) => ({ uid, name: String((obj[uid] || {}).displayName || '').trim() }))
      .filter((p) => p.name);
    staffPool.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    return staffPool;
  }).catch(() => { staffPool = []; return staffPool; });
}

function abNotificationPatch(uid, notif) {
  const patch = {};
  if (!uid) { return patch; }
  const key = 'notif_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  patch[dbPath('notifications/' + uid + '/' + key)] = Object.assign({
    createdAt: firebase.database.ServerValue.TIMESTAMP, read: false
  }, notif);
  return patch;
}

// ── Lobi ──

function openInvitePicker() {
  const modalHost = document.querySelector('[data-ab-invite-modal]');
  if (!modalHost) { return; }
  modalHost.hidden = false;
  const input = modalHost.querySelector('[data-ab-invite-search]');
  const list = modalHost.querySelector('[data-ab-invite-list]');
  input.value = '';
  list.innerHTML = '<p class="hint" style="padding:8px 0">Yükleniyor…</p>';
  loadStaffPool().then((pool) => { renderInviteList(list, pool, ''); input.focus(); });
  input.oninput = () => { loadStaffPool().then((pool) => renderInviteList(list, pool, input.value)); };
}
function closeInvitePicker() {
  const modalHost = document.querySelector('[data-ab-invite-modal]');
  if (modalHost) { modalHost.hidden = true; }
}
function renderInviteList(listEl, pool, query) {
  const q = query.trim().toLocaleLowerCase('tr');
  const filtered = q ? pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : pool;
  if (!filtered.length) { listEl.innerHTML = '<p class="hint" style="padding:8px 0">Kişi bulunamadı.</p>'; return; }
  listEl.innerHTML = filtered.slice(0, 30).map((p) =>
    '<button type="button" class="ab-invite-row" data-ab-invite-pick="' + escapeHtml(p.uid) + '" data-ab-invite-name="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</button>'
  ).join('');
}

function createGame(opponentUid, opponentName) {
  const id = database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar')).push().key;
  const game = {
    oyuncu1Uid: currentUserUid, oyuncu1Ad: currentUserName || currentUserEmail,
    oyuncu2Uid: opponentUid, oyuncu2Ad: opponentName,
    durum: 'davet_edildi', hazir1: false, hazir2: false, sira: null, sonuc: null, sonNot: '',
    olusturmaTs: firebase.database.ServerValue.TIMESTAMP, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  };
  const updates = {};
  updates[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id)] = game;
  Object.assign(updates, abNotificationPatch(opponentUid, {
    type: 'amiral_batti_invite', title: 'Amiral Battı daveti',
    message: (currentUserName || currentUserEmail) + ' sizi bir Amiral Battı oyununa davet etti.',
    relatedGameId: id
  }));
  database.ref('/').update(updates).then(() => {
    window.location.href = 'oyun-amiral-batti.html?oyun=' + id;
  }).catch((err) => { console.error('Oyun oluşturulamadı:', err); showToast('Oyun oluşturulamadı.', { variant: 'error' }); });
}

function renderMyGames(items) {
  const listEl = document.querySelector('[data-ab-my-games]');
  const countEl = document.querySelector('[data-ab-my-games-count]');
  if (!listEl) { return; }
  const mine = items.filter((g) => g.oyuncu1Uid === currentUserUid || g.oyuncu2Uid === currentUserUid)
    .sort((a, b) => (b.guncellemeTs || 0) - (a.guncellemeTs || 0));
  if (countEl) { countEl.textContent = mine.length + ' oyun'; }
  if (!mine.length) { listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Henüz oyununuz yok.</p>'; return; }
  const DURUM_LABEL = { davet_edildi: 'Davet bekleniyor', yerlestirme: 'Gemiler yerleştiriliyor', oynaniyor: 'Oynanıyor', bitti: 'Bitti', iptal: 'İptal edildi' };
  listEl.innerHTML = mine.map((g) => {
    const rakip = g.oyuncu1Uid === currentUserUid ? (g.oyuncu2Ad || '') : (g.oyuncu1Ad || '');
    return '<a class="ab-game-row" href="oyun-amiral-batti.html?oyun=' + escapeHtml(g._id) + '">' +
      '<span class="ab-game-row-vs">vs ' + escapeHtml(rakip || '(bilinmiyor)') + '</span>' +
      '<span class="ab-game-row-status">' + escapeHtml(DURUM_LABEL[g.durum] || g.durum) + '</span>' +
      '</a>';
  }).join('');
}

function renderLeaderboard() {
  const listEl = document.querySelector('[data-ab-leaderboard]');
  if (!listEl) { return; }
  database.ref(dbPath('oyunBasarimlari/amiralBatti')).once('value').then((snap) => {
    const obj = snap.val() || {};
    // NOT: 'oyunlar' anahtarı, oyun durumlarının (davet/yerleştirme/atışlar)
    // tutulduğu KARDEŞ düğüm -- burada bir kullanıcı skoru DEĞİL, listeye dahil
    // edilmemeli.
    const rows = Object.keys(obj).filter((k) => k !== 'oyunlar').map((k) => obj[k])
      .sort((a, b) => (b.kazanilan || 0) - (a.kazanilan || 0) || (b.oynanan || 0) - (a.oynanan || 0));
    if (!rows.length) { listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Henüz kimse oyun bitirmedi.</p>'; return; }
    listEl.innerHTML = rows.slice(0, 20).map((r) =>
      '<div class="ab-leaderboard-row"><span>' + escapeHtml(r.isim || '?') + '</span><span>' + (r.kazanilan || 0) + ' galibiyet · ' + (r.oynanan || 0) + ' oyun</span></div>'
    ).join('');
  }).catch(() => { listEl.innerHTML = ''; });
}

function initLobby() {
  myGamesListenerRef = database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar'));
  myGamesListenerRef.on('value', (snap) => {
    const val = snap.val() || {};
    lastLobbyItems = Object.keys(val).map((id) => Object.assign({ _id: id }, val[id]));
    renderMyGames(lastLobbyItems);
  }, (err) => { console.error('Oyunlar yüklenemedi:', err); });
  renderLeaderboard();

  document.querySelector('[data-ab-new-game]')?.addEventListener('click', () => {
    if (!canPlay) { showToast('Oyun başlatmak için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
    openInvitePicker();
  });
  document.querySelector('[data-ab-invite-close]')?.addEventListener('click', closeInvitePicker);
  document.querySelector('[data-ab-invite-modal]')?.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-ab-invite-modal')) { closeInvitePicker(); }
  });
  document.querySelector('[data-ab-invite-list]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ab-invite-pick]');
    if (!btn) { return; }
    closeInvitePicker();
    createGame(btn.dataset.abInvitePick, btn.dataset.abInviteName);
  });
}

// ── Gemi yerleştirme ──

function gemiHucreleri(gemiId, baslangicR, baslangicC, yon, boy) {
  const hucreler = [];
  for (let i = 0; i < boy; i++) {
    hucreler.push(yon === 'h' ? { r: baslangicR, c: baslangicC + i } : { r: baslangicR + i, c: baslangicC });
  }
  return hucreler;
}
function hucrelerGecerliMi(hucreler, haricGemiId) {
  const dolu = new Set();
  yerlesim.forEach((deger, gemiId) => {
    if (gemiId === haricGemiId) { return; }
    deger.hucreler.forEach((h) => dolu.add(hucreAnahtari(h.r, h.c)));
  });
  return hucreler.every((h) => h.r >= 0 && h.r < SIZE && h.c >= 0 && h.c < SIZE && !dolu.has(hucreAnahtari(h.r, h.c)));
}

function otomatikYerlestir() {
  const yeniYerlesim = new Map();
  const doluHucreler = () => {
    const s = new Set();
    yeniYerlesim.forEach((d) => d.hucreler.forEach((h) => s.add(hucreAnahtari(h.r, h.c))));
    return s;
  };
  FLEET.forEach((gemi) => {
    let denemeSayaci = 0;
    while (denemeSayaci < 200) {
      denemeSayaci++;
      const yon = Math.random() < 0.5 ? 'h' : 'v';
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const hucreler = gemiHucreleri(gemi.id, r, c, yon, gemi.boy);
      const dolu = doluHucreler();
      const gecerli = hucreler.every((h) => h.r >= 0 && h.r < SIZE && h.c >= 0 && h.c < SIZE && !dolu.has(hucreAnahtari(h.r, h.c)));
      if (gecerli) { yeniYerlesim.set(gemi.id, { hucreler }); break; }
    }
  });
  if (yeniYerlesim.size === FLEET.length) { yerlesim = yeniYerlesim; }
  renderYerlestirmeEkrani();
}

function renderYerlestirmeEkrani() {
  const tray = document.querySelector('[data-ab-ship-tray]');
  const grid = document.querySelector('[data-ab-placement-grid]');
  const readyBtn = document.querySelector('[data-ab-ready]');
  if (!tray || !grid) { return; }

  tray.innerHTML = FLEET.map((gemi) => {
    const yerlesti = yerlesim.has(gemi.id);
    const secili = seciliGemiId === gemi.id;
    return '<button type="button" class="ab-ship-chip' + (secili ? ' selected' : '') + (yerlesti ? ' placed' : '') + '" data-ab-ship-pick="' + gemi.id + '">' +
      '<span class="ab-ship-chip-name">' + escapeHtml(gemi.ad) + '</span>' +
      '<span class="ab-ship-chip-cells">' + '<span class="ab-ship-chip-cell"></span>'.repeat(gemi.boy) + '</span>' +
      '</button>';
  }).join('');

  const doluHucreler = new Set();
  yerlesim.forEach((d) => d.hucreler.forEach((h) => doluHucreler.add(hucreAnahtari(h.r, h.c))));
  let html = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      html += '<button type="button" class="ab-cell' + (doluHucreler.has(hucreAnahtari(r, c)) ? ' ship' : '') + '" data-ab-place-cell data-r="' + r + '" data-c="' + c + '"></button>';
    }
  }
  grid.innerHTML = html;

  if (readyBtn) { readyBtn.disabled = yerlesim.size !== FLEET.length; }
}

function placementEventleriBagla() {
  document.querySelector('[data-ab-ship-tray]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ab-ship-pick]');
    if (!btn) { return; }
    const gemiId = btn.dataset.abShipPick;
    if (yerlesim.has(gemiId)) { yerlesim.delete(gemiId); seciliGemiId = gemiId; }
    else { seciliGemiId = seciliGemiId === gemiId ? null : gemiId; }
    renderYerlestirmeEkrani();
  });
  document.querySelector('[data-ab-rotate]')?.addEventListener('click', () => {
    yerlestirmeYonu = yerlestirmeYonu === 'h' ? 'v' : 'h';
    showToast(yerlestirmeYonu === 'h' ? 'Yatay yerleştirme' : 'Dikey yerleştirme', { variant: 'info' });
  });
  document.querySelector('[data-ab-random-place]')?.addEventListener('click', () => { otomatikYerlestir(); });
  document.querySelector('[data-ab-placement-grid]')?.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-ab-place-cell]');
    if (!cell || !seciliGemiId) { return; }
    const gemi = FLEET.find((g) => g.id === seciliGemiId);
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const hucreler = gemiHucreleri(gemi.id, r, c, yerlestirmeYonu, gemi.boy);
    if (!hucrelerGecerliMi(hucreler, gemi.id)) { showToast('Buraya yerleştirilemez.', { variant: 'error' }); return; }
    yerlesim.set(gemi.id, { hucreler });
    seciliGemiId = null;
    renderYerlestirmeEkrani();
  });
  document.querySelector('[data-ab-ready]')?.addEventListener('click', () => {
    if (yerlesim.size !== FLEET.length || hazirBildirildi) { return; }
    hazirBildirildi = true;
    const gemiler = FLEET.map((gemi) => ({ id: gemi.id, hucreler: yerlesim.get(gemi.id).hucreler }));
    benimGemilerim = gemiler;
    const no = benimOyuncuNumaram(currentGame);
    const patch = {};
    patch[dbPath('amiralBattiGizli/' + currentGameId + '/' + currentUserUid)] = { gemiler };
    patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/hazir' + no)] = true;
    patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/guncellemeTs')] = firebase.database.ServerValue.TIMESTAMP;
    database.ref('/').update(patch).catch((err) => { console.error('Filo kaydedilemedi:', err); showToast('Filo kaydedilemedi.', { variant: 'error' }); hazirBildirildi = false; });
  });
}

// Her iki oyuncu da hazır olunca oyunu 'oynaniyor'a geçirir -- iki tarafın
// istemcisi de aynı anda tetiklenebilir, ikinci yazım aynı değeri yazdığı
// için zararsız (idempotent).
function belkiSavasiBaslat(game) {
  if (game.durum !== 'yerlestirme' || !game.hazir1 || !game.hazir2) { return; }
  database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId)).update({
    durum: 'oynaniyor', sira: game.oyuncu1Uid, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  }).catch(() => {});
}

// ── Savaş (atış) mantığı ──

function ensureBenimGemilerim() {
  if (benimGemilerim) { return Promise.resolve(benimGemilerim); }
  return database.ref(dbPath('amiralBattiGizli/' + currentGameId + '/' + currentUserUid)).once('value').then((snap) => {
    const val = snap.val();
    benimGemilerim = (val && val.gemiler) || [];
    return benimGemilerim;
  });
}

// Bana (savunan tarafa) yönelik "bekliyor" atışları çözer: kendi gizli filo
// verimle karşılaştırıp isabet/ıska/batti sonucunu geri yazar. Gemi tamamen
// batmışsa oyunun kaybedilip kaybedilmediğini de kontrol eder.
function bekleyenAtislariCoz(game) {
  const benimNo = benimOyuncuNumaram(game);
  if (!benimNo) { return; }
  const banaGelenAnahtar = benimNo === 1 ? 'atislar2' : 'atislar1';
  const banaGelenAtislar = game[banaGelenAnahtar] || {};
  const bekleyenler = Object.keys(banaGelenAtislar).filter((k) => banaGelenAtislar[k] === 'bekliyor' && !cozulmekteOlanHucreler.has(k));
  if (!bekleyenler.length) { return; }
  bekleyenler.forEach((k) => cozulmekteOlanHucreler.add(k));

  ensureBenimGemilerim().then((gemiler) => {
    const hucreGemiHaritasi = new Map(); // "r_c" -> gemiId
    gemiler.forEach((g) => g.hucreler.forEach((h) => hucreGemiHaritasi.set(hucreAnahtari(h.r, h.c), g.id)));

    const patch = {};
    // Aynı anda birden fazla bekleyen atış olabilir (sayfa geç açıldıysa) --
    // hepsini tek update'te çöz.
    const guncelAtislar = Object.assign({}, banaGelenAtislar);
    bekleyenler.forEach((k) => {
      const gemiId = hucreGemiHaritasi.get(k);
      guncelAtislar[k] = gemiId ? 'isabet' : 'kacti';
    });
    // İsabet alan her gemi için TÜM hücreleri isabet/batti oldu mu kontrol et.
    gemiler.forEach((g) => {
      const hepsiVuruldu = g.hucreler.every((h) => {
        const v = guncelAtislar[hucreAnahtari(h.r, h.c)];
        return v === 'isabet' || v === 'batti';
      });
      if (hepsiVuruldu) { g.hucreler.forEach((h) => { guncelAtislar[hucreAnahtari(h.r, h.c)] = 'batti'; }); }
    });
    // NOT: sadece bekleyenler değil, 'batti' yükseltmesiyle değeri DEĞİŞEN her
    // hücre yazılmalı -- bir geminin son hücresi vurulduğunda o geminin daha
    // ÖNCEKİ turlarda 'isabet' yazılmış hücreleri de 'batti'ye yükseliyor
    // (yoksa geriye sadece son vurulan hücre kırmızı/batmış görünüyor, diğerleri
    // kalıcı olarak 'isabet' (küçük kırmızı nokta) durumunda kalıyordu).
    Object.keys(guncelAtislar).forEach((k) => {
      if (guncelAtislar[k] !== banaGelenAtislar[k]) { patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/' + banaGelenAnahtar + '/' + k)] = guncelAtislar[k]; }
    });

    const toplamVurulan = Object.values(guncelAtislar).filter((v) => v === 'isabet' || v === 'batti').length;
    if (toplamVurulan >= TOPLAM_HUCRE) {
      const saldiranNo = benimNo === 1 ? 2 : 1;
      patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/durum')] = 'bitti';
      patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/sonuc')] = oyuncuUid(game, saldiranNo);
      patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/sonNot')] = (oyuncuAdi(game, saldiranNo) || 'Rakip') + ' tüm filonu batırdı.';
    }
    patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/guncellemeTs')] = firebase.database.ServerValue.TIMESTAMP;
    database.ref('/').update(patch).catch((err) => console.error('Atış sonucu yazılamadı:', err))
      .finally(() => { bekleyenler.forEach((k) => cozulmekteOlanHucreler.delete(k)); });
  });
}

function atisYap(r, c) {
  const benimNo = benimOyuncuNumaram(currentGame);
  if (!benimNo || currentGame.sira !== currentUserUid || currentGame.durum !== 'oynaniyor') { return; }
  const benimAtisAnahtarim = benimNo === 1 ? 'atislar1' : 'atislar2';
  const mevcut = (currentGame[benimAtisAnahtarim] || {})[hucreAnahtari(r, c)];
  if (mevcut) { return; }
  const rakipNo = benimNo === 1 ? 2 : 1;
  const patch = {};
  patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/' + benimAtisAnahtarim + '/' + hucreAnahtari(r, c))] = 'bekliyor';
  patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/sira')] = oyuncuUid(currentGame, rakipNo);
  patch[dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + currentGameId + '/guncellemeTs')] = firebase.database.ServerValue.TIMESTAMP;
  database.ref('/').update(patch).catch((err) => { console.error('Atış yapılamadı:', err); showToast('Atış yapılamadı.', { variant: 'error' }); });
}

function istatistikGuncelle(game) {
  if (!game || game.durum !== 'bitti' || !game.sonuc) { return; }
  const kazandimMi = game.sonuc === currentUserUid;
  const ref = database.ref(dbPath('oyunBasarimlari/amiralBatti/' + currentUserUid));
  ref.transaction((mevcut) => {
    const m = mevcut || { isim: currentUserName || currentUserEmail, oynanan: 0, kazanilan: 0 };
    return {
      isim: currentUserName || currentUserEmail || m.isim,
      oynanan: (m.oynanan || 0) + 1,
      kazanilan: (m.kazanilan || 0) + (kazandimMi ? 1 : 0)
    };
  }).catch((err) => console.error('İstatistik güncellenemedi:', err));
}
let istatistikYazildi = new Set();
let sonucModaliGosterildi = new Set();

function sonucModaliniGoster(game) {
  const kazandimMi = game.sonuc === currentUserUid;
  const kazananAd = game.sonuc === game.oyuncu1Uid ? game.oyuncu1Ad : game.oyuncu2Ad;
  showModal({
    title: kazandimMi ? 'Kazandınız! 🎉' : 'Kaybettiniz',
    body: '<p>' + escapeHtml(kazandimMi ? 'Tüm rakip filoyu batırdınız.' : (kazananAd || 'Rakibiniz') + ' tüm filonuzu batırdı.') + (game.sonNot ? '<p style="color:var(--text-muted)">' + escapeHtml(game.sonNot) + '</p>' : '') + '</p>',
    actions: [
      { label: 'Yeni Oyun', variant: 'primary', action: () => { window.location.href = 'oyun-amiral-batti.html'; } },
      { label: 'Kapat', variant: 'outline' }
    ]
  });
}

// ── Render ──

function hucreSinifi(deger) {
  if (deger === 'kacti') { return 'miss'; }
  if (deger === 'isabet') { return 'hit'; }
  if (deger === 'batti') { return 'sunk'; }
  if (deger === 'bekliyor') { return 'pending'; }
  return '';
}

function renderSavasTahtalari(game) {
  const benimNo = benimOyuncuNumaram(game);
  if (!benimNo) { return; }
  const rakipNo = benimNo === 1 ? 2 : 1;
  const benimAtisAnahtarim = benimNo === 1 ? 'atislar1' : 'atislar2';
  const banaGelenAnahtar = benimNo === 1 ? 'atislar2' : 'atislar1';
  const benimAtislarim = game[benimAtisAnahtarim] || {};
  const banaGelenAtislar = game[banaGelenAnahtar] || {};

  const kendiHucreler = new Set();
  (benimGemilerim || []).forEach((g) => g.hucreler.forEach((h) => kendiHucreler.add(hucreAnahtari(h.r, h.c))));

  const kendiTahta = document.querySelector('[data-ab-own-board]');
  const dusmanTahta = document.querySelector('[data-ab-enemy-board]');
  if (kendiTahta) {
    let html = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const k = hucreAnahtari(r, c);
        const sinif = hucreSinifi(banaGelenAtislar[k]);
        html += '<div class="ab-cell' + (kendiHucreler.has(k) ? ' ship' : '') + (sinif ? ' ' + sinif : '') + '"></div>';
      }
    }
    kendiTahta.innerHTML = html;
  }
  if (dusmanTahta) {
    const siraBende = game.durum === 'oynaniyor' && game.sira === currentUserUid;
    dusmanTahta.classList.toggle('combat-target', siraBende);
    let html = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const k = hucreAnahtari(r, c);
        const sinif = hucreSinifi(benimAtislarim[k]);
        html += '<button type="button" class="ab-cell' + (sinif ? ' ' + sinif : '') + '"' + (sinif || !siraBende ? ' disabled' : '') + ' data-ab-fire-cell data-r="' + r + '" data-c="' + c + '"></button>';
      }
    }
    dusmanTahta.innerHTML = html;
  }
}

function renderStatus(game) {
  const statusEl = document.querySelector('[data-ab-status]');
  const actionsEl = document.querySelector('[data-ab-actions]');
  const p1El = document.querySelector('[data-ab-player-1]');
  const p2El = document.querySelector('[data-ab-player-2]');
  if (!statusEl || !actionsEl) { return; }
  if (p1El) { p1El.textContent = (game.oyuncu1Ad || '') + (game.durum === 'oynaniyor' && game.sira === game.oyuncu1Uid ? ' · sırası' : ''); }
  if (p2El) { p2El.textContent = (game.oyuncu2Ad || '(davet bekleniyor)') + (game.durum === 'oynaniyor' && game.sira === game.oyuncu2Uid ? ' · sırası' : ''); }

  const benimNo = benimOyuncuNumaram(game);
  actionsEl.innerHTML = '';
  let statusText = '';

  if (game.durum === 'davet_edildi') {
    if (benimNo === 2) {
      statusText = (game.oyuncu1Ad || 'Rakip') + ' sizi Amiral Battı oynamaya davet etti.';
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary" data-ab-accept>Kabul Et</button>' +
        '<button type="button" class="btn btn-outline" data-ab-reject>Reddet</button>';
    } else if (benimNo === 1) {
      statusText = (game.oyuncu2Ad || 'Rakibiniz') + ' daveti kabul etmesini bekliyor…';
      actionsEl.innerHTML = '<button type="button" class="btn btn-outline" data-ab-cancel>Daveti İptal Et</button>';
    }
  } else if (game.durum === 'yerlestirme') {
    const benimHazir = benimNo === 1 ? game.hazir1 : game.hazir2;
    const rakipHazir = benimNo === 1 ? game.hazir2 : game.hazir1;
    statusText = benimHazir ? 'Filonuz hazır, rakibinizi bekliyorsunuz…' : 'Filonuzu yerleştirin.';
    if (rakipHazir && !benimHazir) { statusText = (benimNo === 1 ? game.oyuncu2Ad : game.oyuncu1Ad || 'Rakibiniz') + ' hazır, sıra sizde.'; }
  } else if (game.durum === 'oynaniyor') {
    statusText = game.sira === currentUserUid ? 'Sizin sıranız — düşman sularına ateş edin.' : 'Rakibin sırası.';
    if (benimNo) { actionsEl.innerHTML = '<button type="button" class="btn btn-danger" data-ab-resign>Oyundan Çekil</button>'; }
  } else if (game.durum === 'bitti') {
    const kazananUid = game.sonuc;
    const kazananAd = kazananUid === game.oyuncu1Uid ? game.oyuncu1Ad : game.oyuncu2Ad;
    statusText = (kazananUid === currentUserUid ? 'Kazandınız! 🎉' : (kazananAd || 'Rakip') + ' kazandı.') + (game.sonNot ? ' · ' + game.sonNot : '');
    actionsEl.innerHTML = '<a class="btn btn-primary" href="oyun-amiral-batti.html">Yeni Oyun</a>';
    if (benimNo && !istatistikYazildi.has(currentGameId)) { istatistikYazildi.add(currentGameId); istatistikGuncelle(game); }
    if (benimNo && !sonucModaliGosterildi.has(currentGameId)) { sonucModaliGosterildi.add(currentGameId); sonucModaliniGoster(game); }
  } else if (game.durum === 'iptal') {
    statusText = 'Oyun iptal edildi' + (game.sonNot ? ' · ' + game.sonNot : '') + '.';
  }
  statusEl.textContent = statusText;
}

function renderOyunEkrani(game) {
  const yerlestirmeBolumu = document.querySelector('[data-ab-placement]');
  const savasBolumu = document.querySelector('[data-ab-combat]');
  if (yerlestirmeBolumu) { yerlestirmeBolumu.hidden = game.durum !== 'yerlestirme'; }
  if (savasBolumu) { savasBolumu.hidden = !(game.durum === 'oynaniyor' || game.durum === 'bitti'); }

  if (game.durum === 'yerlestirme') {
    const benimNo = benimOyuncuNumaram(game);
    const benimHazir = benimNo === 1 ? game.hazir1 : game.hazir2;
    if (!benimHazir) { renderYerlestirmeEkrani(); }
  } else if (game.durum === 'oynaniyor' || game.durum === 'bitti') {
    // NOT: currentUserUid henüz auth çözülmeden (sayfa ilk yüklendiğinde
    // Firebase dinleyicisi senkron olarak anında tetiklenir) boş olabilir --
    // o an ensureBenimGemilerim() çağrılırsa YANLIŞ (boş uid'li) yola bakıp
    // boş bir filo önbelleğe alır ve auth çözülünce bile bir daha DÜZELMEZ
    // (ensureBenimGemilerim boş diziyi bile "zaten yüklü" sayar). Bu yüzden
    // ikisi de kimliğimiz belli olana kadar bekletiliyor.
    if (benimOyuncuNumaram(game)) {
      ensureBenimGemilerim().then(() => renderSavasTahtalari(game));
      bekleyenAtislariCoz(game);
    }
  }
  renderStatus(game);
}

function attachGameListener(id) {
  if (gameListenerRef) { gameListenerRef.off('value'); }
  gameListenerRef = database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id));
  gameListenerRef.on('value', (snap) => {
    const game = snap.val();
    if (!game) { showToast('Oyun bulunamadı.', { variant: 'error' }); return; }
    currentGame = game;
    belkiSavasiBaslat(game);
    renderOyunEkrani(game);
  }, (err) => { console.error('Oyun yüklenemedi:', err); showToast('Oyun yüklenemedi.', { variant: 'error' }); });
}

function initGameView(id) {
  currentGameId = id;
  document.querySelector('[data-ab-lobby]').hidden = true;
  const view = document.querySelector('[data-ab-game-view]');
  view.hidden = false;
  view.innerHTML =
    '<div class="ab-layout">' +
      '<div class="ab-side">' +
        '<div class="ab-player" data-ab-player-1></div>' +
        '<div class="ab-status" data-ab-status></div>' +
        '<div class="ab-actions" data-ab-actions></div>' +
        '<div class="ab-player" data-ab-player-2></div>' +
        '<a class="btn btn-outline" href="oyun-amiral-batti.html" style="margin-top:12px">← Oyunlarıma dön</a>' +
      '</div>' +
      '<div class="ab-main">' +
        '<div data-ab-placement hidden>' +
          '<div class="ab-placement-bar">' +
            '<div class="ab-ship-tray" data-ab-ship-tray></div>' +
            '<div class="ab-placement-controls">' +
              '<button type="button" class="btn btn-outline" data-ab-rotate>Döndür</button>' +
              '<button type="button" class="btn btn-outline" data-ab-random-place>Rastgele Yerleştir</button>' +
              '<button type="button" class="btn btn-primary" data-ab-ready disabled>Hazırım</button>' +
            '</div>' +
          '</div>' +
          '<div class="ab-board ab-placement-grid" data-ab-placement-grid></div>' +
        '</div>' +
        '<div data-ab-combat hidden>' +
          '<div class="ab-boards">' +
            '<div class="ab-board-panel"><h3 class="ab-board-title">Filon</h3><div class="ab-board" data-ab-own-board></div></div>' +
            '<div class="ab-board-panel"><h3 class="ab-board-title">Düşman Suları</h3><div class="ab-board" data-ab-enemy-board></div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  placementEventleriBagla();

  view.addEventListener('click', (e) => {
    if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
    const atesCell = e.target.closest('[data-ab-fire-cell]');
    if (atesCell) { atisYap(Number(atesCell.dataset.r), Number(atesCell.dataset.c)); return; }
    if (e.target.closest('[data-ab-accept]')) { database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id)).update({ durum: 'yerlestirme', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-ab-reject]')) { database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id)).update({ durum: 'iptal', sonNot: 'Davet reddedildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-ab-cancel]')) { database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id)).update({ durum: 'iptal', sonNot: 'Davet iptal edildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-ab-resign]')) {
      const benimNo = benimOyuncuNumaram(currentGame);
      if (!benimNo || !window.confirm('Oyundan çekilmek istediğinize emin misiniz?')) { return; }
      const rakipNo = benimNo === 1 ? 2 : 1;
      database.ref(dbPath('oyunBasarimlari/amiralBatti/oyunlar/' + id)).update({ durum: 'bitti', sonuc: oyuncuUid(currentGame, rakipNo), sonNot: 'Oyundan çekildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
    }
  });

  attachGameListener(id);
}

export function initAmiralBatti() {
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  const gameId = new URLSearchParams(window.location.search).get('oyun');

  auth.onAuthStateChanged((user) => {
    if (!user) { canPlay = false; return; }
    currentUserEmail = user.email || '';
    currentUserUid = user.uid;
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canPlay = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      if (currentGame) { renderOyunEkrani(currentGame); }
      if (lastLobbyItems) { renderMyGames(lastLobbyItems); }
    }).catch(() => { canPlay = false; });
  });

  initDbMode(database).then(() => { renderDbModeBanner(); });
  onDbModeChange(() => { renderDbModeBanner(); });

  if (gameId) { initGameView(gameId); } else { initLobby(); }
}
