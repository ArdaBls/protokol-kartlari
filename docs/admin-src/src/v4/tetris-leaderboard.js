// Tetris (oyun-tetris.html) -- kullanıcı isteği: "en yüksek skor yapanlar için bir tablo
// oluştur sağ tarafa site içindeki kişiler yarışsın orda". Tetris'in kendisi (chvin/react-
// tetris, admin-src/public/oyun-tetris/) bir iframe içinde, KENDİ ayrı document'inde
// çalışıyor -- bu yüzden skoru doğrudan okuyamayız. Oyun bittiğinde (states.js'teki
// overStart(), bkz. kaynak kod düzenlemesi) iframe içi kod `window.parent.postMessage({type:
// 'tetris-gameover', score}, '*')` gönderiyor; burada o mesaj dinlenip Firebase'e (chess-
// game.js'teki AYNI init/auth paterni) yazılıyor. Sadece kullanıcının KENDİ önceki en
// yüksek skorundan büyükse yazılır (gereksiz yazma trafiği + "en iyi skor" tablosunun
// doğal davranışı).
import { dbPath, isReadOnly, initDbMode, onDbModeChange } from './db-mode.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

let database = null;
let currentUserUid = '';
let currentUserName = '';
let canSave = false;

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderLeaderboard(rows) {
  const box = document.getElementById('tetrisLeaderboard');
  if (!box) { return; }
  if (!rows.length) {
    box.innerHTML = '<div class="tetris-lb-empty">Henüz kimse oynamadı -- ilk skoru sen bırak!</div>';
    return;
  }
  box.innerHTML = rows.map((r, i) => {
    const mine = r.uid === currentUserUid ? ' tetris-lb-row--mine' : '';
    return '<div class="tetris-lb-row' + mine + '">' +
      '<span class="tetris-lb-rank">' + (i + 1) + '</span>' +
      '<span class="tetris-lb-name">' + escapeHtml(r.name) + '</span>' +
      '<span class="tetris-lb-score">' + r.score + '</span>' +
      '</div>';
  }).join('');
}

// Kullanıcı isteği: skorlar tek bir oyuna özel düğümde değil, "oyunBasarimlari/{oyunAdi}/
// {uid}" hiyerarşisinde -- ileride eklenecek başka oyunlar (GeoGuessr benzeri, vb.) aynı
// yapıyı paylaşır, her biri kendi alt-düğümünde. Var olan "users/{uid}/basarimlar" (haber/
// görev rozetleri) ile İSİM/AMAÇ ÇAKIŞMASI olmasın diye kullanıcı bilinçli olarak
// "basarimlar" yerine "oyunBasarimlari" adını seçti.
const OYUN_ADI = 'tetris';

function attachLeaderboardListener() {
  // orderByChild + limitToLast: en yüksek 20 skor, Firebase artan sırada döner --
  // ekranda büyükten küçüğe göstermek için sonucu ters çeviriyoruz.
  database.ref(dbPath('oyunBasarimlari/' + OYUN_ADI)).orderByChild('score').limitToLast(20).on('value', (snap) => {
    const obj = snap.val() || {};
    const rows = Object.keys(obj).map((uid) => ({ uid, name: obj[uid].name || '', score: obj[uid].score || 0 }));
    rows.sort((a, b) => b.score - a.score);
    renderLeaderboard(rows);
  });
}

function saveScoreIfHighest(score) {
  if (!canSave || !currentUserUid || !(score > 0)) { return; }
  const ref = database.ref(dbPath('oyunBasarimlari/' + OYUN_ADI + '/' + currentUserUid));
  ref.once('value').then((snap) => {
    const prev = snap.val();
    if (prev && prev.score >= score) { return; } // sadece kişisel rekor kırılırsa yaz
    ref.set({ name: currentUserName, score, ts: firebase.database.ServerValue.TIMESTAMP });
  });
}

export function initTetrisLeaderboard() {
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { canSave = false; return; }
    currentUserUid = user.uid;
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canSave = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || user.email || 'İsimsiz';
    }).catch(() => { canSave = false; });
  });

  initDbMode(database).then(() => { attachLeaderboardListener(); });
  onDbModeChange(() => { attachLeaderboardListener(); });

  // Tetris'ten (iframe içi kaynak kod, bkz. dosya başındaki not) gelen "oyun bitti" mesajı.
  // origin kontrolü YAPILMIYOR -- mesaj SADECE kendi barındırdığımız /oyun-tetris/ iframe'inden
  // gelebilir (aynı origin, GitHub Pages), dışarıdan enjekte edilemez.
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'tetris-gameover') { return; }
    saveScoreIfHighest(Number(e.data.score) || 0);
  });

  // iframe klavye odağı: kullanıcı bulgusu ("ok tuşları/SPACE çalışmıyor, sadece fareyle
  // oynayabiliyorum") -- sayfa yüklendiğinde odak varsayılan olarak üst dokümanda kalıyor,
  // ok tuşları/SPACE bu durumda üst sayfayı kaydırmaya çalışıyor (tarayıcının varsayılan
  // davranışı) ve iframe içindeki oyuna hiç ulaşmıyor. S/P/R gibi harf tuşlarının üst
  // sayfada varsayılan bir davranışı olmadığından o denemeler fark edilmeden zaten iframe’e
  // gidiyordu -- yani sorun kod değil, saf DOM odağıydı. Çözüm: sayfa açılır açılmaz VE
  // iframe alanına her tıklandığında iframe'e programatik focus veriliyor.
  const iframe = document.querySelector('.game-iframe-wrap iframe');
  if (iframe) {
    const focusFrame = () => { try { iframe.contentWindow.focus(); } catch (e) { /* çapraz-origin değil, sorun olmaz ama yine de sessiz geç */ } };
    iframe.addEventListener('load', focusFrame);
    document.querySelector('.game-iframe-wrap').addEventListener('click', focusFrame);
    // Sayfa sekmesine geri dönüldüğünde de (örn. alt-tab) odak iframe'e düşsün.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { focusFrame(); } });
  }
}
