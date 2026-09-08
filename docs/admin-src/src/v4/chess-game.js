// Satranç (oyun-satranc.html) -- kullanıcı isteği: "kendi sitemizde
// arkadaşımla online satranç oynamak istiyorum", "lichesteki gibi gözüksün...
// yine lichess kütüphanesinden kullanalım her şeyi" -- tahta Lichess'in kendi
// açık kaynak "chessground" bileşeni (brown tahta teması + cburnett taş seti;
// ikisi de npm paketinin İÇİNDE base64 gömülü SVG olarak geliyor, ayrı bir
// dosya indirmeye gerek YOK), hamle kuralları/şah-mat/berabere tespiti
// chess.js (bağımsız, endüstri standardı, Lichess'in KENDİSİ değil ama
// chessground ile birlikte topluluğun standart eşleşmesi) ile. Senkron:
// Firebase Realtime Database (satranc/{id}), sitenin her yerde kullandığı
// canlı-dinleyici deseni -- Lichess sunucusuna hiç bağlanmıyoruz.
//
// Akış: "Yeni Oyun" -> kadrodan (staffProfiles -- editör de okuyabiliyor,
// "users" düğümünün aksine) bir kişi seçilir -> o kişiye bildirim gider
// (notifications/{uid}, attendance.js'teki AYNI desen) -> bildirime tıklayınca
// oyun sayfasına gelir (bkz. bildirimler.html renderPersonalNotifications'a
// eklenen bağlantı) -> "Kabul Et" -> oyun başlar. İstifa / beraberlik teklifi /
// (henüz kabul edilmemiş bir daveti) iptal etme hepsi var.
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';
import { showToast } from './toast.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

let database = null;
let currentUserUid = '';
let currentUserName = '';
let currentUserEmail = '';
let canPlay = false;
let staffPool = null; // [{uid, name}] -- staffProfiles'tan, seçici için tembel yüklenir

let cg = null;
let chess = null;
let currentGameId = null;
let currentGame = null;
let gameListenerRef = null;
let myGamesListenerRef = null;
let lastLobbyItems = null;

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function myColor(game) {
  if (!game) { return null; }
  if (game.beyazUid === currentUserUid) { return 'w'; }
  if (game.siyahUid === currentUserUid) { return 'b'; }
  return null;
}
function colorLabel(c) { return c === 'w' ? 'Beyaz' : 'Siyah'; }

function toDests(chessInstance) {
  const dests = new Map();
  chessInstance.moves({ verbose: true }).forEach((m) => {
    const arr = dests.get(m.from) || [];
    arr.push(m.to);
    dests.set(m.from, arr);
  });
  return dests;
}

// chess.js'in KENDİ durum sorgularından oyun sonu bilgisini çıkarır. NOT:
// isCheckmate/isStalemate anındaki turn() "sırası gelen ama oynayamayan"
// taraftır -- mat durumunda bu taraf KAYBEDER.
function gameOverInfo(chessInstance) {
  if (chessInstance.isCheckmate()) {
    return { over: true, sonuc: chessInstance.turn() === 'w' ? 'siyah' : 'beyaz', sonNot: 'Şah mat' };
  }
  if (chessInstance.isStalemate()) { return { over: true, sonuc: 'beraberlik', sonNot: 'Pat (berabere)' }; }
  if (chessInstance.isThreefoldRepetition()) { return { over: true, sonuc: 'beraberlik', sonNot: 'Üç kez tekrar (berabere)' }; }
  if (chessInstance.isInsufficientMaterial()) { return { over: true, sonuc: 'beraberlik', sonNot: 'Yetersiz materyal (berabere)' }; }
  if (chessInstance.isDraw()) { return { over: true, sonuc: 'beraberlik', sonNot: 'Elli hamle kuralı (berabere)' }; }
  return { over: false };
}

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

// ── Bildirim (attendance.js'teki notificationPatch ile AYNI desen) ──
function chessNotificationPatch(uid, notif) {
  const patch = {};
  if (!uid) { return patch; }
  const key = 'notif_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  patch[dbPath('notifications/' + uid + '/' + key)] = Object.assign({
    createdAt: firebase.database.ServerValue.TIMESTAMP, read: false
  }, notif);
  return patch;
}

// ── Lobi: yeni oyun + oyunlarım listesi ──

function openInvitePicker() {
  const modalHost = document.querySelector('[data-chess-invite-modal]');
  if (!modalHost) { return; }
  modalHost.hidden = false;
  const input = modalHost.querySelector('[data-chess-invite-search]');
  const list = modalHost.querySelector('[data-chess-invite-list]');
  input.value = '';
  list.innerHTML = '<p class="hint" style="padding:8px 0">Yükleniyor…</p>';
  loadStaffPool().then((pool) => { renderInviteList(list, pool, ''); input.focus(); });
  input.oninput = () => { loadStaffPool().then((pool) => renderInviteList(list, pool, input.value)); };
}
function closeInvitePicker() {
  const modalHost = document.querySelector('[data-chess-invite-modal]');
  if (modalHost) { modalHost.hidden = true; }
}
function renderInviteList(listEl, pool, query) {
  const q = query.trim().toLocaleLowerCase('tr');
  const filtered = q ? pool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : pool;
  if (!filtered.length) { listEl.innerHTML = '<p class="hint" style="padding:8px 0">Kişi bulunamadı.</p>'; return; }
  listEl.innerHTML = filtered.slice(0, 30).map((p) =>
    '<button type="button" class="chess-invite-row" data-chess-invite-pick="' + escapeHtml(p.uid) + '" data-chess-invite-name="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</button>'
  ).join('');
}

function createGame(opponentUid, opponentName) {
  const id = database.ref(dbPath('satranc')).push().key;
  const game = {
    beyazUid: currentUserUid, beyazAd: currentUserName || currentUserEmail,
    siyahUid: opponentUid, siyahAd: opponentName,
    fen: new Chess().fen(), sira: 'w', durum: 'davet_edildi', sonuc: null, sonNot: '',
    beraberlikTeklifEden: null,
    olusturmaTs: firebase.database.ServerValue.TIMESTAMP, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  };
  const updates = {};
  updates[dbPath('satranc/' + id)] = game;
  Object.assign(updates, chessNotificationPatch(opponentUid, {
    type: 'chess_invite', title: 'Satranç daveti',
    message: (currentUserName || currentUserEmail) + ' sizi bir satranç oyununa davet etti.',
    relatedGameId: id
  }));
  database.ref('/').update(updates).then(() => {
    window.location.href = 'oyun-satranc.html?oyun=' + id;
  }).catch((err) => { console.error('Oyun oluşturulamadı:', err); showToast('Oyun oluşturulamadı.', { variant: 'error' }); });
}

function renderMyGames(items) {
  const listEl = document.querySelector('[data-chess-my-games]');
  const countEl = document.querySelector('[data-chess-my-games-count]');
  if (!listEl) { return; }
  const mine = items.filter((g) => g.beyazUid === currentUserUid || g.siyahUid === currentUserUid)
    .sort((a, b) => (b.guncellemeTs || 0) - (a.guncellemeTs || 0));
  if (countEl) { countEl.textContent = mine.length + ' oyun'; }
  if (!mine.length) { listEl.innerHTML = '<p class="hint" style="margin:16px;color:var(--text-muted)">Henüz oyununuz yok.</p>'; return; }
  const DURUM_LABEL = { davet_edildi: 'Davet bekleniyor', oynaniyor: 'Oynanıyor', bitti: 'Bitti', iptal: 'İptal edildi' };
  listEl.innerHTML = mine.map((g) => {
    const rakip = g.beyazUid === currentUserUid ? (g.siyahAd || '') : (g.beyazAd || '');
    return '<a class="chess-game-row" href="oyun-satranc.html?oyun=' + escapeHtml(g._id) + '">' +
      '<span class="chess-game-row-vs">vs ' + escapeHtml(rakip || '(bilinmiyor)') + '</span>' +
      '<span class="chess-game-row-status">' + escapeHtml(DURUM_LABEL[g.durum] || g.durum) + '</span>' +
      '</a>';
  }).join('');
}

function initLobby() {
  myGamesListenerRef = database.ref(dbPath('satranc'));
  myGamesListenerRef.on('value', (snap) => {
    const val = snap.val() || {};
    lastLobbyItems = Object.keys(val).map((id) => Object.assign({ _id: id }, val[id]));
    renderMyGames(lastLobbyItems);
  }, (err) => { console.error('Oyunlar yüklenemedi:', err); });

  document.querySelector('[data-chess-new-game]')?.addEventListener('click', () => {
    if (!canPlay) { showToast('Oyun başlatmak için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
    openInvitePicker();
  });
  document.querySelector('[data-chess-invite-close]')?.addEventListener('click', closeInvitePicker);
  document.querySelector('[data-chess-invite-modal]')?.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-chess-invite-modal')) { closeInvitePicker(); }
  });
  document.querySelector('[data-chess-invite-list]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chess-invite-pick]');
    if (!btn) { return; }
    closeInvitePicker();
    createGame(btn.dataset.chessInvitePick, btn.dataset.chessInviteName);
  });
}

// ── Oyun ekranı ──

function ensureBoard(fen) {
  const boardEl = document.querySelector('[data-chess-board]');
  if (!boardEl) { return; }
  if (cg) { return; }
  cg = Chessground(boardEl, {
    fen,
    coordinates: true,
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, dests: new Map(), showDests: true, events: { after: onUserMove } },
    // Lichess'teki gibi önceden hamle (premove): sıra rakipteyken movable.color
    // KENDİ rengimde SABİT kalmalı (viewOnly'yi de false tutuyoruz) -- chessground
    // bunu görüp "sıra bende değil ama kendi taşımı sürüklüyorum" durumunu premove
    // olarak ayırt ediyor (bkz. chessground/board.js isPremovable). Rakibin hamlesi
    // gelince syncBoardFromGame() cg.playPremove() çağırır, kuyruktaki hamle varsa
    // otomatik oynanır (movable.events.after yine tetiklenir, normal hamle gibi
    // Firebase'e yazılır).
    premovable: { enabled: true, showDests: true },
    draggable: { enabled: true, showGhost: true }
  });
}

let promotionResolve = null;
function promptPromotion(color) {
  const box = document.querySelector('[data-chess-promo]');
  if (!box) { return Promise.resolve('q'); }
  box.hidden = false;
  box.dataset.color = color;
  return new Promise((resolve) => { promotionResolve = resolve; });
}
function resolvePromotion(piece) {
  const box = document.querySelector('[data-chess-promo]');
  if (box) { box.hidden = true; }
  if (promotionResolve) { promotionResolve(piece); promotionResolve = null; }
}

function onUserMove(orig, dest) {
  const moves = chess.moves({ square: orig, verbose: true });
  const match = moves.find((m) => m.to === dest);
  if (!match) { cg.set({ fen: chess.fen() }); return; }
  if (match.promotion) {
    promptPromotion(chess.turn()).then((piece) => finalizeMove(orig, dest, piece));
    return;
  }
  finalizeMove(orig, dest);
}
function hamleListesi(game) {
  return Object.keys((game && game.hamleler) || {}).map(Number).sort((a, b) => a - b).map((k) => game.hamleler[k]);
}

function finalizeMove(orig, dest, promotion) {
  const oncekiFen = chess.fen();
  const oncekiSira = chess.turn();
  const result = chess.move({ from: orig, to: dest, promotion: promotion || 'q' });
  if (!result) { cg.set({ fen: chess.fen() }); return; }
  const info = gameOverInfo(chess);
  const hamleIndex = hamleListesi(currentGame).length;
  const patch = {
    fen: chess.fen(), sira: chess.turn(), guncellemeTs: firebase.database.ServerValue.TIMESTAMP,
    beraberlikTeklifEden: null, geriAlmaTeklifEden: null, oncekiFen, oncekiSira
  };
  // Hamle geçmişi: sadece geri alma (bir sonraki hamleden önce) VE oyun bitince
  // Lichess'teki gibi adım adım gezinme (ileri/geri/başa/sona) için gerekiyor --
  // sadece güncel FEN yeterli değil, chess.js'e new Chess(fen) ile yüklenen bir
  // pozisyonun kendi hamle geçmişi YOK (bkz. syncBoardFromGame'deki eski lastMove
  // hatası -- chess.history() hep boştu, o yüzden lastMove hiç görünmüyordu).
  patch['hamleler/' + hamleIndex] = { from: orig, to: dest, promotion: promotion || null };
  if (info.over) { patch.durum = 'bitti'; patch.sonuc = info.sonuc; patch.sonNot = info.sonNot; }
  database.ref(dbPath('satranc/' + currentGameId)).update(patch)
    .catch((err) => { console.error('Hamle kaydedilemedi:', err); showToast('Hamle kaydedilemedi.', { variant: 'error' }); });
}

function syncBoardFromGame(game) {
  chess = new Chess(game.fen);
  ensureBoard(game.fen);
  const mine = myColor(game);
  const active = game.durum === 'oynaniyor';
  const isMyTurn = active && mine && chess.turn() === mine;
  const canInteract = active && !!mine;
  const liste = hamleListesi(game);
  const last = liste[liste.length - 1];
  cg.set({
    fen: game.fen,
    orientation: mine === 'b' ? 'black' : 'white',
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    check: chess.inCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : false,
    lastMove: last ? [last.from, last.to] : undefined,
    viewOnly: !canInteract,
    movable: {
      free: false,
      // movable.color sıra rakipteyken de KENDİ rengimde sabit kalır (premove
      // için gerekli -- bkz. ensureBoard'daki not); sadece dests, gerçek
      // hamle hakkı sırada olduğumuzda dolduruluyor.
      color: canInteract ? (mine === 'w' ? 'white' : 'black') : undefined,
      dests: isMyTurn ? toDests(chess) : new Map(),
      showDests: true
    }
  });
  // Rakibin hamlesi geldi ve artık sıra bende: kuyrukta bekleyen bir premove
  // varsa şimdi oynanır (yoksa no-op).
  if (isMyTurn) { cg.playPremove(); }
}

// ── Oyun bitince adım adım inceleme (Lichess'teki |< < > >| gibi) ──
let reviewFens = null;
let reviewLastMoves = null;
let reviewIndex = 0;
let reviewGameId = null;

function buildReviewData(game) {
  const c = new Chess();
  const fens = [c.fen()];
  const lastMoves = [null];
  hamleListesi(game).forEach((m) => {
    const res = c.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    fens.push(c.fen());
    lastMoves.push(res ? [res.from, res.to] : lastMoves[lastMoves.length - 1]);
  });
  return { fens, lastMoves };
}

function renderReviewPosition() {
  if (!cg || !reviewFens) { return; }
  const fen = reviewFens[reviewIndex];
  const posEl = document.querySelector('[data-chess-review-pos]');
  if (posEl) { posEl.textContent = reviewIndex + ' / ' + (reviewFens.length - 1); }
  const c = new Chess(fen);
  cg.set({
    fen,
    lastMove: reviewLastMoves[reviewIndex] || undefined,
    check: c.inCheck() ? (c.turn() === 'w' ? 'white' : 'black') : false,
    viewOnly: true,
    movable: { free: false, color: undefined, dests: new Map() }
  });
  const startBtn = document.querySelector('[data-chess-review-start]');
  const prevBtn = document.querySelector('[data-chess-review-prev]');
  const nextBtn = document.querySelector('[data-chess-review-next]');
  const endBtn = document.querySelector('[data-chess-review-end]');
  if (startBtn) { startBtn.disabled = reviewIndex === 0; }
  if (prevBtn) { prevBtn.disabled = reviewIndex === 0; }
  if (nextBtn) { nextBtn.disabled = reviewIndex === reviewFens.length - 1; }
  if (endBtn) { endBtn.disabled = reviewIndex === reviewFens.length - 1; }
}

function updateReviewNav(game) {
  const nav = document.querySelector('[data-chess-review-nav]');
  if (!nav) { return; }
  if (game.durum !== 'bitti') {
    nav.hidden = true;
    reviewFens = null; reviewLastMoves = null; reviewGameId = null;
    return;
  }
  if (reviewGameId !== currentGameId || !reviewFens) {
    const data = buildReviewData(game);
    reviewFens = data.fens;
    reviewLastMoves = data.lastMoves;
    reviewIndex = reviewFens.length - 1;
    reviewGameId = currentGameId;
  }
  nav.hidden = false;
  renderReviewPosition();
}

// ── Oyun bitince yeniden oyna teklifi (renkler değişir) ──
let rematchRedirected = false;

function maybeStartRematch(game) {
  if (!game || game.durum !== 'bitti' || game.yeniOyunId) { return; }
  if (!game.yenidenOynaBeyaz || !game.yenidenOynaSiyah) { return; }
  // Çakışmayı önlemek için yeni oyunu SADECE eski siyah taraf oluşturur --
  // KRİTİK: Firebase kuralı yeni bir satranc/{id} oluşturmak için
  // "newData.child('beyazUid').val() === auth.uid" istiyor; renkler değiştiği
  // için yeni oyunun beyazUid'i eski siyah oyuncu -- yazma yetkisi de o yüzden
  // SADECE ona ait olabilir (eski beyaz oyuncu bu yazıyı yapmaya çalışsa
  // PERMISSION_DENIED alır).
  if (myColor(game) !== 'b') { return; }
  const yeniId = database.ref(dbPath('satranc')).push().key;
  const yeniOyun = {
    beyazUid: game.siyahUid, beyazAd: game.siyahAd,
    siyahUid: game.beyazUid, siyahAd: game.beyazAd,
    fen: new Chess().fen(), sira: 'w', durum: 'oynaniyor', sonuc: null, sonNot: '',
    beraberlikTeklifEden: null,
    olusturmaTs: firebase.database.ServerValue.TIMESTAMP, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  };
  const updates = {};
  updates[dbPath('satranc/' + yeniId)] = yeniOyun;
  updates[dbPath('satranc/' + currentGameId + '/yeniOyunId')] = yeniId;
  database.ref('/').update(updates).catch((err) => console.error('Yeniden oyun başlatılamadı:', err));
}

function redirectToRematchIfReady(game) {
  if (!game.yeniOyunId || rematchRedirected) { return; }
  rematchRedirected = true;
  showToast('Yeni oyun başlıyor…', { variant: 'success' });
  setTimeout(() => { window.location.href = 'oyun-satranc.html?oyun=' + encodeURIComponent(game.yeniOyunId); }, 500);
}

function renderStatus(game) {
  const statusEl = document.querySelector('[data-chess-status]');
  const actionsEl = document.querySelector('[data-chess-actions]');
  const whiteEl = document.querySelector('[data-chess-player-white]');
  const blackEl = document.querySelector('[data-chess-player-black]');
  if (!statusEl || !actionsEl) { return; }
  if (whiteEl) { whiteEl.textContent = '⚪ ' + (game.beyazAd || '') + (game.durum === 'oynaniyor' && game.sira === 'w' ? ' · sırası' : ''); }
  if (blackEl) { blackEl.textContent = '⚫ ' + (game.siyahAd || (game.durum === 'davet_edildi' ? '(davet bekleniyor)' : '')) + (game.durum === 'oynaniyor' && game.sira === 'b' ? ' · sırası' : ''); }

  const mine = myColor(game);
  actionsEl.innerHTML = '';
  let statusText = '';

  if (game.durum === 'davet_edildi') {
    if (mine === 'b') {
      statusText = (game.beyazAd || 'Rakip') + ' sizi satranç oynamaya davet etti.';
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary" data-chess-accept>Kabul Et</button>' +
        '<button type="button" class="btn btn-outline" data-chess-reject>Reddet</button>';
    } else if (mine === 'w') {
      statusText = (game.siyahAd || 'Rakibiniz') + ' daveti kabul etmesini bekliyor…';
      actionsEl.innerHTML = '<button type="button" class="btn btn-outline" data-chess-cancel>Daveti İptal Et</button>';
    } else {
      statusText = 'Bu davet size ait değil.';
    }
  } else if (game.durum === 'oynaniyor') {
    if (chess.isCheckmate() || chess.isDraw()) {
      // Firebase'e henüz yazılmamış (yarış durumu) -- normalde finalizeMove
      // zaten durum:'bitti' yazar, burası sadece görsel yansımayı geciktirmemek için.
      statusText = 'Oyun bitiyor…';
    } else if (chess.inCheck()) {
      statusText = colorLabel(chess.turn()) + ' ŞAH altında.';
    } else {
      statusText = mine ? (chess.turn() === mine ? 'Sizin sıranız.' : 'Rakibin sırası.') : (colorLabel(chess.turn()) + ' oynuyor (izleyicisiniz).');
    }
    if (mine && game.beraberlikTeklifEden && game.beraberlikTeklifEden !== mine) {
      statusText = (mine === 'w' ? game.siyahAd : game.beyazAd) + ' beraberlik teklif ediyor.';
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary" data-chess-draw-accept>Beraberliği Kabul Et</button>' +
        '<button type="button" class="btn btn-outline" data-chess-draw-reject>Reddet</button>';
    } else if (mine && game.geriAlmaTeklifEden && game.geriAlmaTeklifEden !== mine) {
      statusText = (mine === 'w' ? game.siyahAd : game.beyazAd) + ' son hamleyi geri almak istiyor.';
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary" data-chess-undo-accept>Geri Almayı Kabul Et</button>' +
        '<button type="button" class="btn btn-outline" data-chess-undo-reject>Reddet</button>';
    } else if (mine) {
      const canOfferUndo = !!game.oncekiFen && !game.geriAlmaTeklifEden;
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-outline"' + (game.beraberlikTeklifEden === mine ? ' disabled' : '') + ' data-chess-draw-offer>' + (game.beraberlikTeklifEden === mine ? 'Beraberlik teklifiniz bekleniyor…' : 'Beraberlik Teklif Et') + '</button>' +
        '<button type="button" class="btn btn-outline"' + (canOfferUndo ? '' : ' disabled') + ' data-chess-undo-offer>' + (game.geriAlmaTeklifEden === mine ? 'Geri alma teklifiniz bekleniyor…' : 'Hamleyi Geri Al Teklif Et') + '</button>' +
        '<button type="button" class="btn btn-danger" data-chess-resign>Oyundan Çekil</button>';
    }
  } else if (game.durum === 'bitti') {
    const sonucText = game.sonuc === 'beraberlik' ? 'Berabere' : (game.sonuc === 'beyaz' ? (game.beyazAd || 'Beyaz') + ' kazandı' : (game.siyahAd || 'Siyah') + ' kazandı');
    statusText = sonucText + (game.sonNot ? ' · ' + game.sonNot : '');
    if (mine && !game.yeniOyunId) {
      const benIstiyorum = mine === 'w' ? game.yenidenOynaBeyaz : game.yenidenOynaSiyah;
      const rakipIstiyor = mine === 'w' ? game.yenidenOynaSiyah : game.yenidenOynaBeyaz;
      if (rakipIstiyor && !benIstiyorum) {
        statusText += ' · ' + (mine === 'w' ? (game.siyahAd || 'Rakibiniz') : (game.beyazAd || 'Rakibiniz')) + ' yeniden oynamak istiyor.';
        actionsEl.innerHTML =
          '<button type="button" class="btn btn-primary" data-chess-rematch-accept>Yeniden Oynamayı Kabul Et</button>' +
          '<button type="button" class="btn btn-outline" data-chess-rematch-reject>Reddet</button>';
      } else if (benIstiyorum) {
        actionsEl.innerHTML = '<button type="button" class="btn btn-outline" disabled>Yeniden oyna teklifiniz bekleniyor…</button>';
      } else {
        actionsEl.innerHTML = '<button type="button" class="btn btn-primary" data-chess-rematch-offer>Yeniden Oyna</button>';
      }
    } else if (game.yeniOyunId) {
      statusText += ' · Yeni oyun başlıyor…';
    }
  } else if (game.durum === 'iptal') {
    statusText = 'Oyun iptal edildi' + (game.sonNot ? ' · ' + game.sonNot : '') + '.';
  }
  statusEl.textContent = statusText;
}

function attachGameListener(id) {
  if (gameListenerRef) { gameListenerRef.off('value'); }
  gameListenerRef = database.ref(dbPath('satranc/' + id));
  gameListenerRef.on('value', (snap) => {
    const game = snap.val();
    if (!game) { showToast('Oyun bulunamadı.', { variant: 'error' }); return; }
    currentGame = game;
    syncBoardFromGame(game);
    renderStatus(game);
    updateReviewNav(game);
    maybeStartRematch(game);
    redirectToRematchIfReady(game);
  }, (err) => { console.error('Oyun yüklenemedi:', err); showToast('Oyun yüklenemedi.', { variant: 'error' }); });
}

function initGameView(id) {
  currentGameId = id;
  document.querySelector('[data-chess-lobby]').hidden = true;
  const view = document.querySelector('[data-chess-game-view]');
  view.hidden = false;
  view.innerHTML =
    '<div class="chess-layout">' +
      '<div class="chess-board-wrap">' +
        '<div class="chess-board" data-chess-board></div>' +
        '<div class="chess-promo" data-chess-promo hidden>' +
          [['q', '♕'], ['r', '♖'], ['b', '♗'], ['n', '♘']].map(([p, glyph]) => '<button type="button" class="chess-promo-btn" data-chess-promo-pick="' + p + '">' + glyph + '</button>').join('') +
        '</div>' +
        '<div class="chess-review-nav" data-chess-review-nav hidden>' +
          '<button type="button" class="chess-review-btn" data-chess-review-start title="Başa dön">⏮</button>' +
          '<button type="button" class="chess-review-btn" data-chess-review-prev title="Geri">◀</button>' +
          '<span class="chess-review-pos" data-chess-review-pos></span>' +
          '<button type="button" class="chess-review-btn" data-chess-review-next title="İleri">▶</button>' +
          '<button type="button" class="chess-review-btn" data-chess-review-end title="Sona git">⏭</button>' +
        '</div>' +
      '</div>' +
      '<div class="chess-side">' +
        '<div class="chess-player chess-player--black" data-chess-player-black></div>' +
        '<div class="chess-status" data-chess-status></div>' +
        '<div class="chess-actions" data-chess-actions></div>' +
        '<div class="chess-player chess-player--white" data-chess-player-white></div>' +
        '<a class="btn btn-outline" href="oyun-satranc.html" style="margin-top:12px">← Oyunlarıma dön</a>' +
      '</div>' +
    '</div>';

  view.querySelector('[data-chess-promo]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chess-promo-pick]');
    if (btn) { resolvePromotion(btn.dataset.chessPromoPick); }
  });
  view.addEventListener('click', (e) => {
    // İnceleme (gezinme) okları yazma yapmaz, salt-okunur kilit altında da çalışır.
    if (e.target.closest('[data-chess-review-start]')) { reviewIndex = 0; renderReviewPosition(); return; }
    if (e.target.closest('[data-chess-review-prev]')) { reviewIndex = Math.max(0, reviewIndex - 1); renderReviewPosition(); return; }
    if (e.target.closest('[data-chess-review-next]')) { reviewIndex = Math.min(reviewFens ? reviewFens.length - 1 : 0, reviewIndex + 1); renderReviewPosition(); return; }
    if (e.target.closest('[data-chess-review-end]')) { reviewIndex = reviewFens ? reviewFens.length - 1 : 0; renderReviewPosition(); return; }
    if (isReadOnly()) { showToast('Salt-okunur kilit açık.', { variant: 'error' }); return; }
    if (e.target.closest('[data-chess-accept]')) { database.ref(dbPath('satranc/' + id)).update({ durum: 'oynaniyor', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-chess-reject]')) { database.ref(dbPath('satranc/' + id)).update({ durum: 'iptal', sonNot: 'Davet reddedildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-chess-cancel]')) { database.ref(dbPath('satranc/' + id)).update({ durum: 'iptal', sonNot: 'Davet iptal edildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP }); return; }
    if (e.target.closest('[data-chess-resign]')) {
      const mine = myColor(currentGame);
      if (!mine || !window.confirm('Oyundan çekilmek istediğinize emin misiniz?')) { return; }
      database.ref(dbPath('satranc/' + id)).update({ durum: 'bitti', sonuc: mine === 'w' ? 'siyah' : 'beyaz', sonNot: 'Oyundan çekildi', guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-draw-offer]')) {
      const mine = myColor(currentGame);
      if (!mine) { return; }
      // Firebase'den yeni anlık görüntü gelene kadar (ağ gecikmesi) buton anında
      // kilitlensin -- kullanıcı isteği: "teklif eden kişinin tuşu karşı taraf
      // seçim yapana kadar basılamaz hale gelsin", çift tıklamayı da önler.
      e.target.closest('[data-chess-draw-offer]').disabled = true;
      database.ref(dbPath('satranc/' + id)).update({ beraberlikTeklifEden: mine, guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-draw-accept]')) {
      database.ref(dbPath('satranc/' + id)).update({ durum: 'bitti', sonuc: 'beraberlik', sonNot: 'Karşılıklı anlaşma', beraberlikTeklifEden: null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-draw-reject]')) {
      database.ref(dbPath('satranc/' + id)).update({ beraberlikTeklifEden: null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-undo-offer]')) {
      const mine = myColor(currentGame);
      if (!mine || !currentGame.oncekiFen || currentGame.geriAlmaTeklifEden) { return; }
      e.target.closest('[data-chess-undo-offer]').disabled = true;
      database.ref(dbPath('satranc/' + id)).update({ geriAlmaTeklifEden: mine, guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-undo-accept]')) {
      if (!currentGame.oncekiFen) { return; }
      const anahtarlar = Object.keys(currentGame.hamleler || {}).map(Number).sort((a, b) => a - b);
      const sonIndex = anahtarlar[anahtarlar.length - 1];
      const patch = {
        fen: currentGame.oncekiFen, sira: currentGame.oncekiSira, geriAlmaTeklifEden: null,
        oncekiFen: null, oncekiSira: null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP
      };
      if (sonIndex !== undefined) { patch['hamleler/' + sonIndex] = null; }
      database.ref(dbPath('satranc/' + id)).update(patch);
      return;
    }
    if (e.target.closest('[data-chess-undo-reject]')) {
      database.ref(dbPath('satranc/' + id)).update({ geriAlmaTeklifEden: null, guncellemeTs: firebase.database.ServerValue.TIMESTAMP });
      return;
    }
    if (e.target.closest('[data-chess-rematch-offer]') || e.target.closest('[data-chess-rematch-accept]')) {
      const mine = myColor(currentGame);
      if (!mine) { return; }
      const patch = {};
      patch[mine === 'w' ? 'yenidenOynaBeyaz' : 'yenidenOynaSiyah'] = true;
      patch.guncellemeTs = firebase.database.ServerValue.TIMESTAMP;
      database.ref(dbPath('satranc/' + id)).update(patch);
      return;
    }
    if (e.target.closest('[data-chess-rematch-reject]')) {
      const mine = myColor(currentGame);
      if (!mine) { return; }
      const patch = {};
      patch[mine === 'w' ? 'yenidenOynaSiyah' : 'yenidenOynaBeyaz'] = false;
      patch.guncellemeTs = firebase.database.ServerValue.TIMESTAMP;
      database.ref(dbPath('satranc/' + id)).update(patch);
    }
  });

  attachGameListener(id);
}

export function initChessGame() {
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
      if (currentGame) { syncBoardFromGame(currentGame); renderStatus(currentGame); }
      if (lastLobbyItems) { renderMyGames(lastLobbyItems); }
    }).catch(() => { canPlay = false; });
  });

  initDbMode(database).then(() => { renderDbModeBanner(); });
  onDbModeChange(() => { renderDbModeBanner(); });

  if (gameId) { initGameView(gameId); } else { initLobby(); }
}
