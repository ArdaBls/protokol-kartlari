// Operasyonlar (index.html) sayfası -- kullanıcı isteği: bugün bir "Konser"
// türü etkinlik varsa (etkinlik bitene kadar): (1) Görevler kartının
// sağında küçük bir bilet rozeti/ikonu dursun, (2) o gün İLK ziyarette
// (bir başarım kazanma ekranı gibi) YALNIZCA bileti gösteren, kapatma
// düğmesi OLMAYAN bir katman kendiliğinden açılsın -- kapatmak için sitenin
// diğer katmanları gibi herhangi bir yere tıklanır. Bilet HER KULLANICI
// için KENDİ adını taşır (etkinliği oluşturanın değil) -- bkz. ticket-badge.js.
//
// Kullanıcı isteği (önceki tur): bu bilet ARTIK Takvim'in düzenleme
// modalında DEĞİL, burada. Modal genişliği (720px) o tarafta değişmedi.
//
// "O gün ilk gösterim" takibi localStorage'ta tutulur (kişiye/tarayıcıya
// özel bir kolaylık -- paylaşılan durum DEĞİL, bkz. proje kuralı: bu tür
// "gördüm" bayrakları Firebase'e yazılmaz).
import { subscribeSharedActivityData } from './charts.js';
import { getEventEndDate } from './event-overview.js';
import { ticketBadgeHtml } from './ticket-badge.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

let currentUserName = '';
let currentUserEmail = '';
let currentUserRole = '';
let currentUserUid = '';
let authReady = false;
let lastEvents = null;
let activeConcert = null;
let overlayShownForKey = null;

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function findTodaysActiveConcert(events, now) {
  const today = todayKey();
  const list = Object.keys(events || {}).map((id) => {
    const e = events[id];
    return (e && typeof e === 'object') ? Object.assign({}, e, { _id: id }) : null;
  }).filter((e) => e && e.tur === 'konser' && e.durum !== 'iptal' && e.tarih === today);
  for (const e of list) {
    const end = getEventEndDate(e);
    if (end && end.getTime() > now.getTime()) { return e; }
  }
  return null;
}

function shownFlagKey(ev) {
  return 'concertTicketShown:' + (currentUserUid || 'anon') + ':' + ev._id + ':' + todayKey();
}

function hasShownToday(ev) {
  try { return window.localStorage.getItem(shownFlagKey(ev)) === '1'; } catch (_e) { return false; }
}
function markShownToday(ev) {
  try { window.localStorage.setItem(shownFlagKey(ev), '1'); } catch (_e) { /* sessiz -- gizli/kısıtlı depolama olabilir, kritik değil */ }
}

function buildTicketProps(ev) {
  return {
    ad: ev.ad, tarih: ev.tarih, saat: ev.saat, yer: ev.yer,
    kisiAdi: currentUserName || currentUserEmail, kisiRol: currentUserRole
  };
}

// Kullanıcı isteği: "başarımlar gibi gelsin ... çarpı butonu vs olmasın,
// sitede bir yere basınca gidiyo zaten" -- header/footer/kapatma tuşu
// olmayan, sadece bileti gösteren, herhangi bir yere tıklanınca kapanan
// bir katman. modal.js'in showModal'ı KULLANILMIYOR (o her zaman başlık +
// X içeriyor) -- bu yüzden kendi minimal katmanı.
function openTicketOverlay(ev) {
  const existing = document.querySelector('[data-concert-ticket-overlay]');
  if (existing) { existing.remove(); }
  const overlay = document.createElement('div');
  overlay.className = 'concert-ticket-overlay';
  overlay.setAttribute('data-concert-ticket-overlay', '');
  overlay.innerHTML = '<div class="concert-ticket-overlay-inner">' + ticketBadgeHtml(buildTicketProps(ev)) + '</div>';
  document.body.appendChild(overlay);
  document.body.classList.add('concert-ticket-overlay-open');
  requestAnimationFrame(() => { overlay.classList.add('show'); });
  const close = () => {
    overlay.classList.remove('show');
    document.body.classList.remove('concert-ticket-overlay-open');
    setTimeout(() => { overlay.remove(); }, 220);
  };
  overlay.addEventListener('click', close);
  markShownToday(ev);
}

function renderSlot() {
  const slot = document.querySelector('[data-concert-ticket-slot]');
  if (!slot) { return; }
  if (!activeConcert) { slot.hidden = true; slot.innerHTML = ''; return; }
  slot.hidden = false;
  slot.innerHTML = '<button type="button" class="card-opt-btn card-opt-btn-labeled concert-ticket-chip" data-concert-ticket-chip title="Bugünün konser bileti">🎫 Bilet</button>';
}

function evaluate() {
  if (lastEvents === null) { return; }
  const now = new Date();
  activeConcert = findTodaysActiveConcert(lastEvents, now);
  renderSlot();
  // Kullanıcı adı/rolü (auth) gelmeden bilet açılırsa "Bilet Sahibi" boş
  // görünüyordu -- popup SADECE auth çözüldükten sonra otomatik açılır
  // (rozet/slot ise beklemeden görünebilir, kişisel içerik taşımıyor).
  if (activeConcert && authReady && !hasShownToday(activeConcert) && overlayShownForKey !== activeConcert._id) {
    overlayShownForKey = activeConcert._id;
    openTicketOverlay(activeConcert);
  }
}

export function initConcertTicketPopup() {
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  const database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { currentUserName = ''; currentUserEmail = ''; currentUserRole = ''; currentUserUid = ''; authReady = true; evaluate(); return; }
    currentUserEmail = user.email || '';
    currentUserUid = user.uid;
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
      currentUserRole = u.role || '';
      authReady = true;
      evaluate();
    }).catch(() => { authReady = true; evaluate(); });
  });

  subscribeSharedActivityData((_users, events) => {
    if (events !== null) { lastEvents = events; evaluate(); }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-concert-ticket-chip]') && activeConcert) { openTicketOverlay(activeConcert); }
  });

  // Etkinlik saati Firebase'de hiçbir alan değişmeden dolabilir (bkz.
  // charts.js/operations-overview-widget.js'teki AYNI desen) -- dakikada
  // bir yeniden değerlendirilir ki bitiş saati geçince rozet kendiliğinden
  // kaybolsun.
  const timer = setInterval(evaluate, 60000);
  if (timer && typeof timer.unref === 'function') { timer.unref(); }
}
