// Operasyonlar sayfasındaki "Görevler" kartı — gerçek Firebase verisi.
// Kullanıcı isteği: siteye kayıtlı (editor/admin/owner) herkes görev
// ekleyebilsin/silebilsin, işlemler loglansın. Kanban panosundaki auth/role
// ve atomik update+log deseni birebir tekrar kullanılıyor (bkz. kanban.js).

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
let listEl = null;
let counterEl = null;
let TASKS = {};
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let tasksListenerRef = null;

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function fmtTarih(key) {
  if (!key) {return '';}
  const [y, m, d] = key.split('-');
  if (!y || !m || !d) {return key;}
  const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const ay = AYLAR[parseInt(m, 10) - 1] || m;
  return d + ' ' + ay;
}

function sortedEntries() {
  return Object.entries(TASKS)
    .filter(([, v]) => v)
    .sort((a, b) => {
      const da = a[1].tarih || '9999-99-99';
      const db = b[1].tarih || '9999-99-99';
      return da.localeCompare(db);
    });
}

function render() {
  const entries = sortedEntries();
  const total = entries.length;
  const remaining = entries.filter(([, v]) => !v.tamamlandi).length;
  if (counterEl) {counterEl.textContent = total ? remaining + ' / ' + total + ' tamamlanmadı' : 'Görev yok';}

  if (!listEl) {return;}
  if (!total) {
    listEl.innerHTML = '<p class="hint" style="margin:12px 0;color:var(--text-muted);font-size:12.5px">Henüz görev yok.</p>';
    return;
  }

  listEl.innerHTML = entries.map(([id, v]) => `
    <div class="todo-row${v.tamamlandi ? ' done' : ''}" data-task-id="${id}">
      <div class="todo-cb${v.tamamlandi ? ' done' : ''}" data-task-toggle="${id}"></div>
      <span class="todo-text">${escapeHtml(v.metin || '')}</span>
      ${v.durum === 'yaziliyor' ? '<span class="todo-status-badge todo-status-badge--yaziliyor">Haber yazılıyor</span>' : ''}
      ${v.durum === 'incelemede' ? '<span class="todo-status-badge todo-status-badge--incelemede">İncelemede</span>' : ''}
      ${v.tamamlandi && v.tamamlayan ? `
        <span class="todo-status-badge todo-status-badge--tamamlandi">Tamamlandı</span>
        <span class="todo-avatar" title="${escapeHtml(v.tamamlayan)} tamamladı">${escapeHtml((v.tamamlayan || '?').charAt(0).toUpperCase())}</span>
      ` : ''}
      ${canWrite ? `<button type="button" class="todo-delete" data-task-delete="${id}" aria-label="Görevi sil"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg></button>` : ''}
      ${v.tarih ? `<span class="todo-date">${escapeHtml(fmtTarih(v.tarih))}</span>` : ''}
    </div>
  `).join('');
}

function logAction(action, target) {
  const logKey = database.ref(dbPath('logs/gorev')).push().key;
  return database.ref(dbPath('logs/gorev/' + logKey)).set({
    by: currentUserName || currentUserEmail,
    email: currentUserEmail,
    action,
    target: target || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
}

function toggleTask(id) {
  const task = TASKS[id];
  if (!task || !canWrite) {return;}
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const next = !task.tamamlandi;
  database.ref(dbPath('gorevler/' + id)).update({
    tamamlandi: next,
    durum: next ? 'tamamlandi' : 'planlandi',
    // Kullanıcı isteği: tamamlanan görevde kimin tamamladığı görünsün (çarpının solunda
    // "Tamamlandı" yazısı + avatar). Tamamlanmadan geri alınırsa alanlar temizlenir --
    // yoksa bir sonraki tamamlayan farklı biri olsa da eski isim kalırdı.
    tamamlayan: next ? (currentUserName || currentUserEmail) : null,
    tamamlayanEmail: next ? currentUserEmail : null,
    guncellemeTs: firebase.database.ServerValue.TIMESTAMP
  })
    .catch((err) => { console.error('Görev güncellenemedi:', err); showToast('Görev güncellenemedi.', { variant: 'error' }); });
  // Not: silme/oluşturma işlem günlüğüne düşüyor (bkz. logAction), ama
  // tamamlandı işaretleme sık tekrar eden, düşük riskli bir aksiyon olduğu
  // için (kanban panosundaki durum sürüklemesi gibi) günlüğe düşürülmüyor.
}

function deleteTask(id) {
  const task = TASKS[id];
  if (!task || !canWrite) {return;}
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  showModal({
    title: 'Görevi sil?',
    size: 'sm',
    body: '<p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:0">"' + escapeHtml(task.metin || '') + '" görevi kalıcı olarak silinecek.</p>',
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Sil',
        variant: 'danger',
        action: () => {
          database.ref(dbPath('gorevler/' + id)).remove()
            .then(() => logAction('Görev silindi: "' + (task.metin || '') + '"', task.metin || ''))
            .catch((err) => { console.error('Görev silinemedi:', err); showToast('Görev silinemedi.', { variant: 'error' }); });
        }
      }
    ]
  });
}

function openAddModal() {
  if (!canWrite) { showToast('Görev eklemek için giriş yapmanız gerekiyor.', { variant: 'error' }); return; }
  if (isReadOnly()) { showToast('Salt-okunur kilit açık, düzenleme yapılamaz.', { variant: 'error' }); return; }
  const { body } = showModal({
    title: 'Yeni görev',
    size: 'sm',
    body: `
      <div class="form-group">
        <label class="form-label">Görev</label>
        <input type="text" class="form-control" data-task-input-text maxlength="200" placeholder="Ör. Haber taslağını gözden geçir">
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Tarih (opsiyonel)</label>
        <input type="date" class="form-control" data-task-input-date>
      </div>
    `,
    actions: [
      { label: 'Vazgeç', variant: 'ghost' },
      {
        label: 'Ekle',
        variant: 'primary',
        closeOnAction: false,
        action: () => {
          const textEl = body.querySelector('[data-task-input-text]');
          const dateEl = body.querySelector('[data-task-input-date]');
          const metin = (textEl.value || '').trim();
          if (!metin) { textEl.focus(); return false; }
          const key = database.ref(dbPath('gorevler')).push().key;
          database.ref(dbPath('gorevler/' + key)).set({
            metin,
            tarih: dateEl.value || null,
            tamamlandi: false,
            durum: 'planlandi',
            olusturan: currentUserName || currentUserEmail,
            olusturanEmail: currentUserEmail,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            guncellemeTs: firebase.database.ServerValue.TIMESTAMP
          })
            .then(() => logAction('Yeni görev eklendi: "' + metin + '"', metin))
            .catch((err) => { console.error('Görev eklenemedi:', err); showToast('Görev eklenemedi.', { variant: 'error' }); });
          closeModal();
          return undefined;
        }
      }
    ]
  });
}

export function initTasksWidget() {
  listEl = document.querySelector('[data-task-list]');
  if (!listEl) {return;}
  counterEl = document.querySelector('[data-todo-counter]');
  const addBtn = document.querySelector('[data-task-add]');

  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  database = firebase.database();
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; render(); return; }
    currentUserEmail = user.email || '';
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canWrite = (u.role === 'editor' || u.role === 'admin' || u.role === 'owner') && u.blocked !== true;
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      render();
    }).catch(() => { canWrite = false; render(); });
  });

  function attachTasksListener() {
    if (tasksListenerRef) { tasksListenerRef.off('value'); }
    tasksListenerRef = database.ref(dbPath('gorevler'));
    tasksListenerRef.on('value', (snap) => {
      TASKS = snap.val() || {};
      render();
    }, (err) => {
      console.error('Görevler yüklenemedi:', err);
      if (listEl) {listEl.innerHTML = '<p class="hint" style="margin:12px 0;color:var(--text-muted);font-size:12.5px">Görevler yüklenemedi.</p>';}
    });
  }

  // Test Modu/Salt-Okunur Kilit ilk değeri gelene kadar bekle (bkz. calendar.js
  // initCalendar'daki aynı desen), sonra doğru dala bağlan; mod canlı değişirse yeniden bağlan.
  initDbMode(database).then(() => { renderDbModeBanner(); attachTasksListener(); });
  onDbModeChange(() => { renderDbModeBanner(); attachTasksListener(); });

  addBtn?.addEventListener('click', openAddModal);

  listEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-task-toggle]');
    if (toggle) { toggleTask(toggle.dataset.taskToggle); return; }
    const del = e.target.closest('[data-task-delete]');
    if (del) { deleteTask(del.dataset.taskDelete); }
  });
}
