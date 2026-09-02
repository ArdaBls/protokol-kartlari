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

  const d = new Date(target.hedefTarih);
  const tarihStr = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  // Duraklatıldıysa şimdiki zamana göre YENİDEN HESAPLAMA yapılmıyor -- pause
  // anında dondurulan kalan süre (duraklananKalanMs) olduğu gibi gösteriliyor.
  if (target.duraklatildi) {
    valueEl.textContent = fmtRemain(target.duraklananKalanMs || 0) + ' (duraklatıldı)';
    if (typeof target.duraklananPct === 'number') {barEl.style.width = target.duraklananPct.toFixed(2) + '%';}
    subEl.textContent = 'Hedef: ' + tarihStr + (target.olusturan ? ' · ' + target.olusturan : '') + ' · duraklatıldı';
    return;
  }

  const now = Date.now();
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

  subEl.textContent = 'Hedef: ' + tarihStr + (target.olusturan ? ' · ' + target.olusturan : '');
}

function logAction(action, targetLabel) {
  const logKey = database.ref('logs/sayac').push().key;
  return database.ref('logs/sayac/' + logKey).set({
    by: currentUserName || currentUserEmail,
    email: currentUserEmail,
    action,
    target: targetLabel || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
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
            olusturan: currentUserName || currentUserEmail,
            duraklatildi: false,
            duraklananKalanMs: null,
            duraklananPct: null
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

function togglePause() {
  if (!canWrite) { showToast('Bu işlem için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (!target || !target.hedefTarih) { showToast('Önce bir hedef tarih belirleyin.', { variant: 'error' }); return; }

  if (target.duraklatildi) {
    // Devam ettir: kalan süreyi ŞİMDİDEN itibaren yeniden say -- hedefTarih'i
    // (şimdi + donmuş kalan süre) olarak ileri kaydırıyoruz, böylece
    // duraklatılan süre sayaçtan düşülmüş oluyor (komple sıfırlanmıyor).
    const remain = target.duraklananKalanMs || 0;
    const yeniHedef = new Date(Date.now() + remain).toISOString();
    database.ref('ayarlar/sayac').update({
      hedefTarih: yeniHedef,
      duraklatildi: false,
      duraklananKalanMs: null,
      duraklananPct: null
    })
      .then(() => logAction('Sayaç devam ettirildi'))
      .catch((err) => { console.error('Sayaç güncellenemedi:', err); showToast('Sayaç güncellenemedi.', { variant: 'error' }); });
    return;
  }

  const now = Date.now();
  const hedef = new Date(target.hedefTarih).getTime();
  const baslangic = target.baslangicTarih ? new Date(target.baslangicTarih).getTime() : now;
  const remain = Math.max(0, hedef - now);
  const total = hedef - baslangic;
  const pct = total > 0 ? Math.min(100, Math.max(0, ((now - baslangic) / total) * 100)) : 0;
  database.ref('ayarlar/sayac').update({
    duraklatildi: true,
    duraklananKalanMs: remain,
    duraklananPct: pct
  })
    .then(() => logAction('Sayaç duraklatıldı'))
    .catch((err) => { console.error('Sayaç güncellenemedi:', err); showToast('Sayaç güncellenemedi.', { variant: 'error' }); });
}

export function initCountdown() {
  const valueEl = document.querySelector('[data-countdown-value]');
  if (!valueEl) {return;}
  const subEl = document.querySelector('[data-countdown-sub]');
  const barEl = document.querySelector('[data-countdown-bar]');
  const editBtn = document.querySelector('[data-countdown-edit]');
  const pauseBtn = document.querySelector('[data-countdown-pause]');

  const PAUSE_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="2" width="3" height="10" rx="0.5"/></svg>';
  const PLAY_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 2.5v9l8-4.5-8-4.5z"/></svg>';

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
    if (pauseBtn) {
      const paused = !!(target && target.duraklatildi);
      pauseBtn.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
      pauseBtn.setAttribute('aria-label', paused ? 'Sayacı devam ettir' : 'Sayacı duraklat');
    }
  }, (err) => {
    console.error('Sayaç yüklenemedi:', err);
  });

  setInterval(() => tick(valueEl, subEl, barEl), 1000);

  pauseBtn?.addEventListener('click', togglePause);

  editBtn?.addEventListener('click', openEditModal);
}
