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

// Hafta yardımcıları -- calendar.js:117-118'den birebir kopyalandı (proje deseni:
// küçük yardımcılar dosyalar arası import edilmeyip kopyalanıyor).
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
const WEEK_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
function weekRangeLabel(weekStart) {
  const end = addDays(weekStart, 6);
  const sm = WEEK_MONTHS[weekStart.getMonth()], em = WEEK_MONTHS[end.getMonth()];
  if (weekStart.getMonth() === end.getMonth()) { return weekStart.getDate() + '–' + end.getDate() + ' ' + em + ' ' + end.getFullYear(); }
  return weekStart.getDate() + ' ' + sm + ' – ' + end.getDate() + ' ' + em + ' ' + end.getFullYear();
}

// "Gerçekleşti" aşaması kaldırılıp durum tek bir haber-üretim iş akışında birleştirildiğinde
// (bkz. app.js EVENT_STATUS) eski kayıtlarda hâlâ cekildi/haber/yayinlandi değerleri olabilir.
// Panoda sessizce kaybolmasınlar diye en yakın yeni sütuna eşlenir; canlı veriye asla
// yazılmaz, sadece görüntüleme sırasında normalize edilir.
const LEGACY_DURUM = { cekildi: 'planlandi', haber: 'yaziliyor', yayinlandi: 'tamamlandi' };
function normalizeDurum(d) { const k = d || 'planlandi'; return LEGACY_DURUM[k] || k; }

let EVENTS = {}; // id -> event object (canlı Firebase verisi, hem etkinlikler hem gorevler, _source etiketli)
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let filterText = '';
let database = null;
let boardEl = null;
let weekLabelEl = null;
let viewedWeek = startOfWeek(new Date());

// Bir kaydın "köken haftası" -- etkinlik için tarih, görev için tarih||oluşturulma.
function originWeekOf(e) {
  const raw = e.tarih || (e.createdAt ? new Date(e.createdAt) : null);
  const d = typeof raw === 'string' ? (parseKeyLoose(raw) || new Date()) : (raw instanceof Date ? raw : new Date());
  return startOfWeek(d);
}
function parseKeyLoose(s) {
  const a = String(s || '').split('-');
  if (a.length !== 3) { return null; }
  const y = Number(a[0]), m = Number(a[1]), day = Number(a[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(day)) { return null; }
  const d = new Date(y, m - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

// Bir kaydın "en son dokunulduğu hafta" -- tamamlandı işaretlemesinin NE ZAMAN
// olduğunu gösterir (guncellemeTs). Görünürlük kuralı bunun üzerinden çalışır ki
// geçmiş haftadan kalıp az önce tamamlanan bir kart, tamamlandığı anda değil,
// gerçek zaman bir SONRAKİ haftaya geçtiğinde kaybolsun (kullanıcı isteği).
function trackWeekOf(e) {
  const ts = e.guncellemeTs || e.createdAt;
  if (typeof ts === 'number') { return startOfWeek(new Date(ts)); }
  return originWeekOf(e);
}

// Ortak görünüm modeli -- etkinlik ve görev kayıtlarını tek bir şekle indirger.
function viewOf(id, e) {
  const source = e._source;
  const durum = normalizeDurum(e.durum);
  const originWeek = originWeekOf(e);
  const trackWeek = trackWeekOf(e);
  return {
    id, source, durum, raw: e,
    title: source === 'gorev' ? (e.metin || '(adsız görev)') : (e.ad || '(adsız)'),
    subtitle: source === 'gorev' ? '' : (e.yer || ''),
    dateKey: e.tarih || '',
    originWeek,
    overdue: originWeek.getTime() < viewedWeek.getTime(),
    visible: durum !== 'tamamlandi' || trackWeek.getTime() === viewedWeek.getTime()
  };
}

function visibleEvents() {
  const q = filterText.toLowerCase();
  return Object.entries(EVENTS)
    .filter(([, e]) => e && e._source && normalizeDurum(e.durum) !== 'iptal')
    .map(([id, e]) => viewOf(id, e))
    .filter((v) => !q || v.title.toLowerCase().includes(q))
    .filter((v) => v.visible)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function renderCard(v) {
  const e = v.raw;
  const writers = v.source === 'gorev' ? [] : parseNameList(e.haberYazanlari);
  const avatars = writers.map((name) => `<span class="kanban-avatar" style="background:var(--primary)" title="${escapeHtml(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>`).join('');
  const weekTag = v.overdue ? `<span class="kanban-card-week-tag">${escapeHtml(weekRangeLabel(v.originWeek))} haftasından</span>` : '';
  // Kullanıcı isteği: takvimdeki etkinlikler için de tamamlayan kişi belli olsun -- kanban
  // panosu görev/etkinlik ayrımı yapmadan tek bir "Tamamlandı" sütununda gösterdiği için
  // tamamlayan izini burada göstermek her iki kaynağı da kapsıyor.
  const completedBy = (v.durum === 'tamamlandi' && e.tamamlayan) ? `<span class="kanban-avatar kanban-avatar--done" title="${escapeHtml(e.tamamlayan)} tamamladı">${escapeHtml(e.tamamlayan.charAt(0).toUpperCase())}</span>` : '';
  return `
    <article class="kanban-card${v.overdue ? ' kanban-card--overdue' : ''}" draggable="${canWrite}" data-id="${v.id}" data-source="${v.source}">
      <div class="kanban-card-title">${escapeHtml(v.title)}</div>
      ${v.subtitle ? `<div class="kanban-card-desc">${escapeHtml(v.subtitle)}</div>` : ''}
      <div class="kanban-card-foot">
        <div class="kanban-card-meta">
          ${v.dateKey ? `<span class="due-date">${escapeHtml(fmtTarih(v.dateKey))}</span>` : ''}
          ${weekTag}
        </div>
        <div class="kanban-card-avatars">${completedBy}${avatars}</div>
      </div>
    </article>
  `;
}

function renderColumn(col, entries) {
  const items = entries.filter((v) => v.durum === col.id);
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
  if (weekLabelEl) { weekLabelEl.textContent = weekRangeLabel(viewedWeek); }
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
    const title = ev._source === 'gorev' ? (ev.metin || 'Görev') : (ev.ad || 'Etkinlik');
    const oldTamamlayan = ev.tamamlayan;
    ev.durum = newCol; // iyimser güncelleme
    ev.tamamlayan = newCol === 'tamamlandi' ? (currentUserName || currentUserEmail) : null;
    render();
    // Durum değişikliği ESKİDEN tek başına .set() ile yazılıyordu: ne işlem günlüğüne
    // (logs/etkinlik) düşüyordu -- yani panodan yapılan durum değişiklikleri admin
    // log ekranında HİÇ görünmüyordu -- ne de guncellemeTs tazeleniyordu (admin
    // panosunun "en eski güncellenen" sıralaması bu alana bakıyor). Projedeki diğer
    // tüm etkinlik yazmaları gibi artık TEK atomik çok-yollu update ile yazılıyor.
    const updates = {};
    const basePath = ev._source === 'gorev' ? 'gorevler/' + draggedId : 'etkinlikler/' + draggedId;
    updates[basePath + '/durum'] = newCol;
    updates[basePath + '/guncellemeTs'] = firebase.database.ServerValue.TIMESTAMP;
    // Kullanıcı isteği: tamamlanan görev/etkinlikte kimin tamamladığı belli olsun (kart
    // üzerinde avatar). Başka bir sütuna geri sürüklenirse temizlenir -- yoksa eski bir
    // tamamlama izi yanlışlıkla kalmış gibi görünürdü.
    updates[basePath + '/tamamlayan'] = newCol === 'tamamlandi' ? (currentUserName || currentUserEmail) : null;
    updates[basePath + '/tamamlayanEmail'] = newCol === 'tamamlandi' ? currentUserEmail : null;
    if (ev._source === 'gorev') {
      // Operasyonlar'daki checkbox hâlâ tamamlandi boolean'ını okuyor -- iki yönlü ayna.
      updates[basePath + '/tamamlandi'] = newCol === 'tamamlandi';
    }
    const logPath = ev._source === 'gorev' ? 'logs/gorev' : 'logs/etkinlik';
    const logKey = database.ref(logPath).push().key;
    updates[logPath + '/' + logKey] = {
      by: currentUserName || currentUserEmail, email: currentUserEmail,
      action: title + (ev._source === 'gorev' ? ' görevinin' : ' etkinliğinin') + ' durumu panodan değiştirildi · Durum: ' + oldTitle + ' → ' + newTitle,
      target: title,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    database.ref('/').update(updates)
      .then(() => showToast(`"${title}" → ${newTitle}`, { variant: 'success' }))
      .catch((err) => {
        console.error('Durum güncellenemedi:', err);
        ev.durum = oldDurum;
        ev.tamamlayan = oldTamamlayan;
        render();
        showToast('Durum güncellenemedi.', { variant: 'error' });
      });
  });
}

// Kullanıcı isteği: "birisi operasyonlarda görevi tamamlarsa anlık işlemiyor, sayfayı
// yenilemek gerekiyor" -- eskiden ikisi de .once('value') idi (tek seferlik anlık görüntü).
// Şimdi CANLI dinleniyor (.on), her biri kendi kaynağının EVENTS'teki payını günceller ki
// bir düğümdeki güncelleme diğerinin (henüz gelmemiş) verisini geçici olarak silmesin.
let etkListenerRef = null;
let gorevListenerRef = null;
function loadEvents() {
  // initKanban()'daki onAuthStateChanged birden fazla kez tetiklenebilir (ör. misafir ->
  // giriş yapmış kullanıcı geçişi) -- her seferinde YENİ .on() dinleyicisi eklemeden önce
  // eskisi kapatılmazsa dinleyiciler birikip her değişiklikte render()'ı N kere çağırırdı.
  if (etkListenerRef) { etkListenerRef.off('value'); }
  if (gorevListenerRef) { gorevListenerRef.off('value'); }

  let etkLoaded = false, gorevLoaded = false;

  etkListenerRef = database.ref('etkinlikler');
  etkListenerRef.on('value', (snap) => {
    const etk = snap.val() || {};
    Object.keys(EVENTS).forEach((id) => { if (EVENTS[id]._source === 'etkinlik') { delete EVENTS[id]; } });
    Object.entries(etk).forEach(([id, v]) => { if (v) { EVENTS[id] = { ...v, _source: 'etkinlik' }; } });
    etkLoaded = true;
    if (etkLoaded && gorevLoaded) { render(); }
  }, (err) => {
    console.error('Etkinlikler yüklenemedi:', err);
    boardEl.innerHTML = '<p class="hint" style="margin:16px;">Yüklenemedi.</p>';
  });

  gorevListenerRef = database.ref('gorevler');
  gorevListenerRef.on('value', (snap) => {
    const gorev = snap.val() || {};
    Object.keys(EVENTS).forEach((id) => { if (EVENTS[id]._source === 'gorev') { delete EVENTS[id]; } });
    Object.entries(gorev).forEach(([id, v]) => { if (v) { EVENTS[id] = { ...v, _source: 'gorev' }; } });
    gorevLoaded = true;
    if (etkLoaded && gorevLoaded) { render(); }
  }, (err) => {
    console.error('Görevler yüklenemedi:', err);
    boardEl.innerHTML = '<p class="hint" style="margin:16px;">Yüklenemedi.</p>';
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

  weekLabelEl = document.querySelector('[data-week-label]');
  document.querySelector('[data-week-prev]')?.addEventListener('click', () => { viewedWeek = addDays(viewedWeek, -7); render(); });
  document.querySelector('[data-week-next]')?.addEventListener('click', () => { viewedWeek = addDays(viewedWeek, 7); render(); });
  document.querySelector('[data-week-today]')?.addEventListener('click', () => { viewedWeek = startOfWeek(new Date()); render(); });
  if (weekLabelEl) { weekLabelEl.textContent = weekRangeLabel(viewedWeek); }
}
