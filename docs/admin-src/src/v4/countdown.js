// Operasyonlar sayfasındaki "Sayaç" kartı — büyük etkinlikler için geri
// sayım. Kullanıcı isteği: hedef tarihe kaç gün/saat/dakika/saniye kaldığını
// gösteren canlı bir saat, altındaki dolan bar da hedef güne yaklaştıkça
// (başlangıç → hedef arasındaki geçen oran kadar) yavaş yavaş dolsun.
// Hedef tarih Firebase'te (ayarlar/sayac) tutulur ki HERKES aynı sayacı
// görsün -- kalem ikonuyla editor/admin/owner rolündeki biri değiştirebilir,
// çöp kutusu ikonuyla hedef tarihi tamamen silip sayacı sıfırlayabilir.

import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

let database = null;
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let target = null; // { hedefTarih, baslangicTarih, olusturan } | null
let sayacListenerRef = null;

function pad(n) { return String(n).padStart(2, '0'); }

function fmtRemain(ms) {
  if (ms <= 0) {return 'Süre doldu';}
  const gun = Math.floor(ms / 86400000);
  const saat = Math.floor((ms % 86400000) / 3600000);
  const dk = Math.floor((ms % 3600000) / 60000);
  const sn = Math.floor((ms % 60000) / 1000);
  return gun + 'g ' + pad(saat) + ':' + pad(dk) + ':' + pad(sn);
}

function tick(valueEl, subEl, barEl) {
  if (!target || !target.hedefTarih) {
    valueEl.textContent = '—';
    subEl.textContent = 'Hedef tarih belirlenmedi';
    barEl.style.width = '0%';
    return;
  }

  const now = Date.now();
  const d = new Date(target.hedefTarih);
  const hedef = d.getTime();
  const baslangic = target.baslangicTarih ? new Date(target.baslangicTarih).getTime() : now;
  const diff = hedef - now;

  valueEl.textContent = fmtRemain(diff);
  if (diff <= 0) {
    barEl.style.width = '100%';
  } else {
    const total = hedef - baslangic;
    const gecen = now - baslangic;
    const pct = total > 0 ? Math.min(100, Math.max(0, (gecen / total) * 100)) : 0;
    barEl.style.width = pct.toFixed(2) + '%';
  }

  const tarihStr = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  subEl.textContent = 'Hedef: ' + tarihStr + (target.olusturan ? ' · ' + target.olusturan : '');
}

function logAction(action, targetLabel) {
  const logKey = database.ref(dbPath('logs/sayac')).push().key;
  return database.ref(dbPath('logs/sayac/' + logKey)).set({
    by: currentUserName || currentUserEmail,
    email: currentUserEmail,
    action,
    target: targetLabel || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
}

function openEditModal() {
  if (!canWrite) { showToast('Hedef tarihi ayarlamak için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const current = target && target.hedefTarih ? target.hedefTarih.slice(0, 16) : '';
  const { body } = showModal({
    title: 'Sayaç hedef tarihi',
    size: 'sm',
    body: `
      <div class="form-group">
        <label class="form-label">Hedef tarih ve saat</label>
        <input type="datetime-local" class="form-control" data-countdown-input value="${current}">
      </div>
    `,
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Kaydet',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const input = body.querySelector('[data-countdown-input]');
          const val = input.value;
          if (!val) { input.focus(); return false; }
          const hedefTarih = new Date(val).toISOString();
          const baslangicTarih = new Date().toISOString();
          database.ref(dbPath('ayarlar/sayac')).set({
            hedefTarih,
            baslangicTarih,
            olusturan: currentUserName || currentUserEmail
          })
            .then(() => logAction('Sayaç hedef tarihi ayarlandı: ' + hedefTarih, hedefTarih))
            .catch((err) => {
              console.error('Sayaç kaydedilemedi:', err);
              // En sık neden: yerel-notlar/firebase-database-rules.json'daki
              // "ayarlar/sayac" kuralı Firebase Console'a henüz YAPIŞTIRILMADI --
              // bu durumda yazma PERMISSION_DENIED ile sessizce reddedilir.
              showToast('Sayaç kaydedilemedi (' + (err && err.code || 'hata') + '). Firebase kurallarının güncel olduğundan emin olun.', { variant: 'error' });
            });
          closeModal();
          return undefined;
        }
      }
    ]
  });
}

function resetCountdown() {
  if (!canWrite) { showToast('Bu işlem için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  if (!target || !target.hedefTarih) { showToast('Zaten belirlenmiş bir hedef tarih yok.', { variant: 'error' }); return; }
  showModal({
    title: 'Sayacı sıfırla?',
    size: 'sm',
    body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">Hedef tarih silinecek, sayaç "Hedef tarih belirlenmedi" durumuna dönecek.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Sıfırla',
        variant: 'danger',
        action: () => {
          database.ref(dbPath('ayarlar/sayac')).remove()
            .then(() => logAction('Sayaç sıfırlandı'))
            .catch((err) => { console.error('Sayaç sıfırlanamadı:', err); showToast('Sayaç sıfırlanamadı.', { variant: 'error' }); });
        }
      }
    ]
  });
}

export function initCountdown() {
  const valueEl = document.querySelector('[data-countdown-value]');
  if (!valueEl) {return;}
  const subEl = document.querySelector('[data-countdown-sub]');
  const barEl = document.querySelector('[data-countdown-bar]');
  const editBtn = document.querySelector('[data-countdown-edit]');
  const resetBtn = document.querySelector('[data-countdown-reset]');

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

  function attachSayacListener() {
    if (sayacListenerRef) { sayacListenerRef.off('value'); }
    sayacListenerRef = database.ref(dbPath('ayarlar/sayac'));
    sayacListenerRef.on('value', (snap) => {
      target = snap.val();
      tick(valueEl, subEl, barEl);
    }, (err) => {
      console.error('Sayaç yüklenemedi:', err);
    });
  }

  // Test Modu/Salt-Okunur Kilit ilk değeri gelene kadar bekle, sonra doğru dala bağlan
  // (bkz. calendar.js initCalendar'daki aynı desen); mod canlı değişirse yeniden bağlan.
  initDbMode(database).then(() => { renderDbModeBanner(); attachSayacListener(); });
  onDbModeChange(() => { renderDbModeBanner(); attachSayacListener(); });

  setInterval(() => tick(valueEl, subEl, barEl), 1000);

  editBtn?.addEventListener('click', openEditModal);
  resetBtn?.addEventListener('click', resetCountdown);
}
