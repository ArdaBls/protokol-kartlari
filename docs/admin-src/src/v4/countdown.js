// Operasyonlar sayfasındaki "Sayaç" kartı — büyük etkinlikler için geri
// sayım. Kullanıcı isteği: hedef tarihe kaç gün/saat/dakika/saniye kaldığını
// gösteren canlı bir saat, altındaki dolan bar da hedef güne yaklaştıkça
// (başlangıç → hedef arasındaki geçen oran kadar) yavaş yavaş dolsun.
// Hedef tarih Firebase'te (ayarlar/sayac) tutulur ki HERKES aynı sayacı
// görsün -- kalem ikonuyla editor/admin/owner rolündeki biri değiştirebilir.

import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';

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

function pad(n) { return String(n).padStart(2, '0'); }

function tick(valueEl, subEl, barEl) {
  if (!target || !target.hedefTarih) {
    valueEl.textContent = '—';
    subEl.textContent = 'Hedef tarih belirlenmedi';
    barEl.style.width = '0%';
    return;
  }
  const now = Date.now();
  const hedef = new Date(target.hedefTarih).getTime();
  const baslangic = target.baslangicTarih ? new Date(target.baslangicTarih).getTime() : now;
  const diff = hedef - now;

  if (diff <= 0) {
    valueEl.textContent = 'Süre doldu';
    barEl.style.width = '100%';
  } else {
    const gun = Math.floor(diff / 86400000);
    const saat = Math.floor((diff % 86400000) / 3600000);
    const dk = Math.floor((diff % 3600000) / 60000);
    const sn = Math.floor((diff % 60000) / 1000);
    valueEl.textContent = gun + 'g ' + pad(saat) + ':' + pad(dk) + ':' + pad(sn);
    const total = hedef - baslangic;
    const gecen = now - baslangic;
    const pct = total > 0 ? Math.min(100, Math.max(0, (gecen / total) * 100)) : 0;
    barEl.style.width = pct.toFixed(2) + '%';
  }

  const d = new Date(target.hedefTarih);
  const tarihStr = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  subEl.textContent = 'Hedef: ' + tarihStr + (target.olusturan ? ' · ' + target.olusturan : '');
}

function openEditModal() {
  if (!canWrite) { showToast('Hedef tarihi ayarlamak için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
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
          database.ref('ayarlar/sayac').set({
            hedefTarih,
            baslangicTarih,
            olusturan: currentUserName || currentUserEmail
          })
            .then(() => {
              const logKey = database.ref('logs/sayac').push().key;
              return database.ref('logs/sayac/' + logKey).set({
                by: currentUserName || currentUserEmail,
                email: currentUserEmail,
                action: 'Sayaç hedef tarihi ayarlandı: ' + hedefTarih,
                target: hedefTarih,
                timestamp: firebase.database.ServerValue.TIMESTAMP
              });
            })
            .catch((err) => { console.error('Sayaç kaydedilemedi:', err); showToast('Sayaç kaydedilemedi.', { variant: 'error' }); });
          closeModal();
          return undefined;
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

  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; return; }
    currentUserEmail = user.email || '';
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canWrite = u.role === 'editor' || u.role === 'admin' || u.role === 'owner';
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
    }).catch(() => { canWrite = false; });
  });

  database.ref('ayarlar/sayac').on('value', (snap) => {
    target = snap.val();
    tick(valueEl, subEl, barEl);
  }, (err) => {
    console.error('Sayaç yüklenemedi:', err);
  });

  setInterval(() => tick(valueEl, subEl, barEl), 1000);

  editBtn?.addEventListener('click', openEditModal);
}
