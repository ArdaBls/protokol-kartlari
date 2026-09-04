// Operasyonlar sayfasındaki "📍 Bir Etkinliğe Gidiyorum" butonu -- gerçek
// Firebase verisi. Kullanıcı isteği: saha kullanımında (çoklu etkinlik günü,
// 3-4 kişi aynı anda) Takvim sayfasına gitmeden şu andan +1 saatlik, adı
// "(Düzenlenmeye muhtaç)" olan boş bir taslak etkinlik oluşturulsun -- HİÇBİR
// modal/yönlendirme olmadan, sadece toast bildirimi. Kullanıcı kendi
// isteğiyle Takvim'e girince taslak "taslak:true" alanı sayesinde görsel
// olarak öne çıkar (bkz. calendar.js calBlockClasses, _real-calendar.scss
// .cal-taslak). calendar.js'in persistEvent/EVENT_TYPES gibi fonksiyonları
// module-private ve #calMainBody DOM'una bağımlı olduğu için buradan
// çağrılamıyor -- tasks-widget.js'in kanban.js'in desenini tekrar yazdığı
// gibi (bkz. o dosyanın başındaki yorum), aynı atomik update+log deseni
// burada da tekrarlanıyor.

import { showToast } from './toast.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const QUICK_DRAFT_NAME = '(Düzenlenmeye muhtaç)';

let database = null;
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';

function pad2(n) { return String(n).padStart(2, '0'); }
function dKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

function createDraft() {
  if (!canWrite) { showToast('Etkinlik eklemek için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60000);
  const id = database.ref('etkinlikler').push().key;
  const event = {
    ad: QUICK_DRAFT_NAME,
    tur: 'diger',
    durum: 'planlandi',
    tarih: dKey(now),
    saat: hm(now),
    bitisSaat: hm(end),
    yer: '', birim: '', planlayan: '', gorevli: '', haberYazanlari: '',
    haberMetni: '', katilimcilar: [], not: '', rozetler: [], haberKaynagi: '',
    taslak: true,
    olusturan: currentUserName || currentUserEmail,
    olusturmaTs: firebase.database.ServerValue.TIMESTAMP,
    guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  };
  const logKey = database.ref('logs/etkinlik').push().key;
  const updates = {};
  updates['etkinlikler/' + id] = event;
  updates['logs/etkinlik/' + logKey] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: 'Hızlı taslak etkinlik oluşturuldu ("Bir Etkinliğe Gidiyorum")', target: QUICK_DRAFT_NAME,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  database.ref('/').update(updates)
    .then(() => showToast('Taslak etkinlik oluşturuldu, Takvim\'de düzenleyebilirsiniz.', { variant: 'success' }))
    .catch((err) => {
      console.error('Taslak etkinlik oluşturulamadı:', err);
      showToast('Taslak etkinlik oluşturulamadı.', { variant: 'error' });
    });
}

export function initQuickEvent() {
  const btn = document.querySelector('[data-quick-event-btn]');
  if (!btn) { return; }

  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; return; }
    currentUserEmail = user.email || '';
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canWrite = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
    }).catch(() => { canWrite = false; });
  });

  btn.addEventListener('click', createDraft);
}
