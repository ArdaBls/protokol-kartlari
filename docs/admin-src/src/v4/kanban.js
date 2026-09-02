// Haber üretim panosu (Kanban) — gerçek Firebase verisine bağlı.
// Her kart, takvimdeki bir GERÇEK etkinliği temsil eder. Sütun = etkinliğin
// "Durum" alanı (aynı alan takvimde de kullanılıyor, bkz. app.js EVENT_STATUS).
// Sürükle-bırak, o etkinliğin Durum alanını gerçekten günceller (yazma yetkisi
// gerektirir). Kart oluşturma/silme burada YOK — etkinlikler takvimden
// yönetilir, bu pano sadece haber üretim iş akışının durumunu gösterir.

import { showToast } from './toast.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const COLUMNS = [
  { id: 'planlandi',  title: 'Planlandı',       color: 'var(--text-muted)' },
  { id: 'yaziliyor',  title: 'Haber yazılıyor', color: 'var(--yellow)' },
  { id: 'incelemede', title: 'İncelemede',      color: 'var(--purple)' },
  { id: 'tamamlandi', title: 'Tamamlandı',      color: 'var(--green)' }
];

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function fmtTarih(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return d && m && y ? `${d}.${m}.${y}` : key;
}

function parseNameList(s) { return String(s || '').split(',').map((x) => x.trim()).filter(Boolean); }

// "Gerçekleşti" aşaması kaldırılıp durum tek bir haber-üretim iş akışında birleştirildiğinde
// (bkz. app.js EVENT_STATUS) eski kayıtlarda hâlâ cekildi/haber/yayinlandi değerleri olabilir.
// Panoda sessizce kaybolmasınlar diye en yakın yeni sütuna eşlenir; canlı veriye asla
// yazılmaz, sadece görüntüleme sırasında normalize edilir.
const LEGACY_DURUM = { cekildi: 'planlandi', haber: 'yaziliyor', yayinlandi: 'tamamlandi' };
function normalizeDurum(d) { const k = d || 'planlandi'; return LEGACY_DURUM[k] || k; }

let EVENTS = {}; // id -> event object (canlı Firebase verisi)
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let filterText = '';
let database = null;
let boardEl = null;

function visibleEvents() {
  const q = filterText.toLowerCase();
  return Object.entries(EVENTS)
    .filter(([, e]) => e && normalizeDurum(e.durum) !== 'iptal')
    .filter(([, e]) => !q || (e.ad || '').toLowerCase().includes(q))
    .sort((a, b) => (a[1].tarih || '').localeCompare(b[1].tarih || ''));
}

function renderCard([id, e]) {
  const writers = parseNameList(e.haberYazanlari);
  const avatars = writers.map((name) => `<span class="kanban-avatar" style="background:var(--primary)" title="${escapeHtml(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`).join('');
  return `
    <article class="kanban-card" draggable="${canWrite}" data-id="${id}">
      <div class="kanban-card-title">${escapeHtml(e.ad || '(adsız)')}</div>
      ${e.yer ? `<div class="kanban-card-desc">${escapeHtml(e.yer)}</div>` : ''}
      <div class="kanban-card-foot">
        <div class="kanban-card-meta">
          ${e.tarih ? `<span class="due-date">${escapeHtml(fmtTarih(e.tarih))}</span>` : ''}
        </div>
        <div class="kanban-card-avatars">${avatars}</div>
      </div>
    </article>
  `;
}

function renderColumn(col, entries) {
  const items = entries.filter(([, e]) => normalizeDurum(e.durum) === col.id);
  return `
    <section class="kanban-column" data-col="${col.id}">
      <header class="kanban-column-head">
        <span class="dot" style="background:${col.color}"></span>
        <span class="title">${escapeHtml(col.title)}</span>
        <span class="count">${items.length}</span>
      </header>
      <div class="kanban-column-body" data-drop="${col.id}">
        ${items.map(renderCard).join('') || '<p class="hint" style="margin:8px;">Etkinlik yok.</p>'}
      </div>
    </section>
  `;
}

function render() {
  const entries = visibleEvents();
  boardEl.innerHTML = COLUMNS.map((c) => renderColumn(c, entries)).join('');
}

// ── Sürükle-bırak: gerçek yazma ──

let draggedId = null;

function setupDnD() {
  boardEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card || card.getAttribute('draggable') !== 'true') { return; }
    draggedId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
  });

  boardEl.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (card) { card.classList.remove('dragging'); }
    document.querySelectorAll('.kanban-column-body.drop-target').forEach((el) => el.classList.remove('drop-target'));
    draggedId = null;
  });

  boardEl.addEventListener('dragover', (e) => {
    const body = e.target.closest('[data-drop]');
    if (!body) { return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    body.classList.add('drop-target');
  });

  boardEl.addEventListener('dragleave', (e) => {
    const body = e.target.closest('[data-drop]');
    if (body && !body.contains(e.relatedTarget)) { body.classList.remove('drop-target'); }
  });

  boardEl.addEventListener('drop', (e) => {
    const body = e.target.closest('[data-drop]');
    if (!body || !draggedId) { return; }
    e.preventDefault();
    body.classList.remove('drop-target');
    const newCol = body.dataset.drop;
    const ev = EVENTS[draggedId];
    if (!ev || normalizeDurum(ev.durum) === newCol) { return; }
    if (!canWrite) { showToast('Bu işlem için düzenleme yetkiniz yok.', { variant: 'error' }); return; }
    const oldDurum = ev.durum;
    const oldTitle = COLUMNS.find((c) => c.id === normalizeDurum(oldDurum))?.title || oldDurum || '—';
    const newTitle = COLUMNS.find((c) => c.id === newCol)?.title || newCol;
    ev.durum = newCol; // iyimser güncelleme
    render();
    // Durum değişikliği ESKİDEN tek başına .set() ile yazılıyordu: ne işlem günlüğüne
    // (logs/etkinlik) düşüyordu -- yani panodan yapılan durum değişiklikleri admin
    // log ekranında HİÇ görünmüyordu -- ne de guncellemeTs tazeleniyordu (admin
    // panosunun "en eski güncellenen" sıralaması bu alana bakıyor). Projedeki diğer
    // tüm etkinlik yazmaları gibi artık TEK atomik çok-yollu update ile yazılıyor.
    const updates = {};
    updates['etkinlikler/' + draggedId + '/durum'] = newCol;
    updates['etkinlikler/' + draggedId + '/guncellemeTs'] = firebase.database.ServerValue.TIMESTAMP;
    const logKey = database.ref('logs/etkinlik').push().key;
    updates['logs/etkinlik/' + logKey] = {
      by: currentUserName || currentUserEmail, email: currentUserEmail,
      action: (ev.ad || 'Etkinlik') + ' etkinliğinin durumu panodan değiştirildi · Durum: ' + oldTitle + ' → ' + newTitle,
      target: ev.ad || '',
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    database.ref('/').update(updates)
      .then(() => showToast(`"${ev.ad}" → ${newTitle}`, { variant: 'success' }))
      .catch((err) => {
        console.error('Durum güncellenemedi:', err);
        ev.durum = oldDurum;
        render();
        showToast('Durum güncellenemedi.', { variant: 'error' });
      });
  });
}

function loadEvents() {
  database.ref('etkinlikler').once('value').then((snap) => {
    EVENTS = snap.val() || {};
    render();
  }).catch((err) => {
    console.error('Etkinlikler yüklenemedi:', err);
    boardEl.innerHTML = '<p class="hint" style="margin:16px;">Etkinlikler yüklenemedi.</p>';
  });
}

export function initKanban() {
  boardEl = document.getElementById('kanban-board');
  if (!boardEl) { return; }

  if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
  database = firebase.database();
  const auth = firebase.auth();

  boardEl.innerHTML = '<p class="hint" style="margin:16px;">Yükleniyor…</p>';
  setupDnD();

  auth.onAuthStateChanged((user) => {
    if (!user) { canWrite = false; currentUserName = ''; currentUserEmail = ''; loadEvents(); return; }
    currentUserEmail = user.email || '';
    // Log satırındaki "kim" bilgisi için rolle birlikte ad/soyad da okunur (users/{uid}
    // kendi kaydını okuma kuralı zaten var: ".read": "auth.uid === $uid").
    database.ref('users/' + user.uid).once('value').then((snap) => {
      const u = snap.val() || {};
      canWrite = u.role === 'editor' || u.role === 'admin' || u.role === 'owner';
      currentUserName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || currentUserEmail;
      loadEvents();
    }).catch(() => { canWrite = false; loadEvents(); });
  });

  document.getElementById('kanban-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value.trim();
    render();
  });
}
