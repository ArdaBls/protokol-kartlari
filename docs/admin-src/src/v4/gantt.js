// Haber üretim Gantt görünümü. Projeler ayrı `haberProjeleri` dalında tutulur;
// takvimle bağ kurulduğunda yalnızca seçilen etkinliğin `projeId` ve `tarih`
// alanları aynı atomik Firebase update'i içinde eşlenir.

import { showToast } from './toast.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

// Zoom seviyeleri: reui.io/preview/base/gantt-1 referansındaki gibi ctrl+tekerlek
// veya +/- ile geçilen, gün başına piksel genişliği kademeleri. Sürekli/analog
// bir ölçek yerine sabit kademeler kullanılıyor -- yuvarlama sürüklenmesi
// (rounding drift) olmadan basit ve öngörülebilir.
const ZOOM_LEVELS = [14, 20, 28, 38, 50, 66, 86];
const DEFAULT_ZOOM_INDEX = 3;
const DAY_MS = 86400000;
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SHORT_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'];
const STATUSES = {
  fikir: 'Fikir', arastirma: 'Araştırma', hazirlik: 'Hazırlık', cekim: 'Çekim',
  kurgu: 'Kurgu', onay: 'Onay', yayinlandi: 'Yayınlandı', iptal: 'İptal'
};
const STEP_STATUSES = {
  yapilacak: 'Yapılacak', yapiliyor: 'Yapılıyor', incelemede: 'İncelemede',
  tamamlandi: 'Tamamlandı', iptal: 'İptal'
};

let database;
let projects = {};
let events = {};
let projectsRef = null;
let eventsRef = null;
let canWrite = false;
let currentUserName = '';
let currentUserEmail = '';
let anchor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let searchText = '';
let statusFilter = '';
let dragState = null;
let modeReady = false;
let zoomIndex = DEFAULT_ZOOM_INDEX;
let currentRangeStart = null;
let currentRangeDays = 0;
let scrollRaf = null;
let initialScrollDone = false;
let dataLoaded = false;
const collapsedProjects = new Set();

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) { return null; }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === value ? date : null;
}

function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function dayDiff(a, b) {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / DAY_MS);
}

// reui.io referansındaki gibi zaman çizelgesi tek bir yılın tamamını kapsar
// (Pazartesi hizalı başlangıçtan Pazar hizalı bitişe) ve kullanıcı bu geniş
// alanda serbestçe kaydırma/yakınlaştırma yapar -- ay değişince yeniden
// render etmek yerine sadece scrollLeft değişir (bkz. scrollByDays/scrollToToday).
function computeRange(year) {
  const yearFirst = new Date(year, 0, 1);
  const yearLast = new Date(year, 11, 31);
  const start = addDays(yearFirst, -((yearFirst.getDay() + 6) % 7));
  const end = addDays(yearLast, 6 - ((yearLast.getDay() + 6) % 7));
  return { start, days: dayDiff(start, end) + 1 };
}

function currentDayWidth() {
  return ZOOM_LEVELS[zoomIndex];
}

function nameColWidth() {
  return $('.gantt-name-head')?.offsetWidth || 270;
}

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
}

function visibleProjects() {
  const query = searchText.toLocaleLowerCase('tr-TR');
  return Object.entries(projects)
    .filter(([, project]) => project && project.arsiv !== true)
    .filter(([, project]) => !statusFilter || project.durum === statusFilter)
    .filter(([, project]) => {
      if (!query) { return true; }
      const stepText = Object.values(project.adimlar || {}).map((step) => `${step.ad || ''} ${step.sorumlu || ''}`).join(' ');
      return `${project.ad || ''} ${project.sorumlu || ''} ${stepText}`.toLocaleLowerCase('tr-TR').includes(query);
    })
    .sort(([, a], [, b]) => String(a.bitisTarihi || '').localeCompare(String(b.bitisTarihi || '')));
}

function renderSummary() {
  const today = localDateKey(new Date());
  const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const list = Object.values(projects).filter((project) => project && project.arsiv !== true);
  const active = list.filter((project) => !['yayinlandi', 'iptal'].includes(project.durum)).length;
  const month = list.filter((project) => String(project.bitisTarihi || '').startsWith(monthPrefix)).length;
  const overdue = list.filter((project) => project.bitisTarihi < today && !['yayinlandi', 'iptal'].includes(project.durum)).length;
  const special = list.filter((project) => project.tur === 'ozel').length;
  $('#gantt-active-count').textContent = active;
  $('#gantt-month-count').textContent = month;
  $('#gantt-overdue-count').textContent = overdue;
  $('#gantt-special-count').textContent = special;
}

function renderWeekHead(start, days, dayWidth) {
  let cells = '';
  for (let index = 0; index < days; index += 7) {
    const weekStart = addDays(start, index);
    const weekEnd = addDays(start, index + 6);
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    const label = sameMonth
      ? `Hf ${isoWeekNumber(weekStart)} · ${weekStart.getDate()}-${weekEnd.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]}`
      : `Hf ${isoWeekNumber(weekStart)} · ${weekStart.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]} - ${weekEnd.getDate()} ${SHORT_MONTHS[weekEnd.getMonth()]}`;
    cells += `<div class="gantt-week-cell">${label}</div>`;
  }
  return `<div class="gantt-week-row"><div class="gantt-week-name-head"></div><div class="gantt-week-head" style="--gantt-days:${days};--gantt-day-width:${dayWidth}px">${cells}</div></div>`;
}

function renderDayHead(start, days) {
  const today = localDateKey(new Date());
  let cells = '';
  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    const key = localDateKey(date);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    cells += `<div class="gantt-day${weekend ? ' is-weekend' : ''}${key === today ? ' is-today' : ''}">
      <span>${WEEKDAYS[(date.getDay() + 6) % 7]}</span><strong>${date.getDate()}</strong>
      ${date.getDate() === 1 ? `<small>${SHORT_MONTHS[date.getMonth()]}</small>` : ''}
    </div>`;
  }
  return `<div class="gantt-day-row"><div class="gantt-name-head">Proje</div><div class="gantt-days-head" style="--gantt-days:${days}">${cells}</div></div>`;
}

function barGeometry(project, start, days, dayWidth) {
  const projectStart = parseDateKey(project.baslangicTarihi);
  const projectEnd = parseDateKey(project.bitisTarihi);
  if (!projectStart || !projectEnd) { return null; }
  const rawLeft = dayDiff(start, projectStart);
  const rawRight = dayDiff(start, projectEnd);
  if (rawRight < 0 || rawLeft >= days) { return null; }
  const left = Math.max(0, rawLeft);
  const right = Math.min(days - 1, rawRight);
  return { left: left * dayWidth, width: Math.max(dayWidth, (right - left + 1) * dayWidth) };
}

function renderTimelineBar(id, item, start, days, dayWidth, stepId = '') {
  const geometry = barGeometry(item, start, days, dayWidth);
  if (!geometry) { return ''; }
  const progress = Math.min(100, Math.max(0, Number(item.ilerleme) || 0));
  const today = localDateKey(new Date());
  const status = stepId ? (item.durum || 'yapilacak') : (item.durum || 'fikir');
  const finished = stepId ? ['tamamlandi', 'iptal'].includes(status) : ['yayinlandi', 'iptal'].includes(status);
  const overdue = item.bitisTarihi < today && !finished;
  const attrs = stepId
    ? `data-project-id="${escapeHtml(id)}" data-step-id="${escapeHtml(stepId)}"`
    : `data-project-id="${escapeHtml(id)}"`;
  return `<button type="button" class="gantt-bar ${stepId ? 'gantt-bar--step ' : ''}status-${escapeHtml(status)}${overdue ? ' is-overdue' : ''}" ${attrs} style="left:${geometry.left}px;width:${geometry.width}px" aria-label="${escapeHtml(item.ad)} kaydını düzenle">
    <span class="gantt-resize gantt-resize--start" data-resize="start" aria-hidden="true"></span>
    <span class="gantt-bar-progress" style="width:${progress}%"></span>
    <span class="gantt-bar-label">${escapeHtml(item.ad)} · ${progress}%</span>
    <span class="gantt-resize gantt-resize--end" data-resize="end" aria-hidden="true"></span>
  </button>`;
}

function projectSteps(project) {
  return Object.entries(project.adimlar || {})
    .filter(([, step]) => step && step.arsiv !== true)
    .sort(([, a], [, b]) => (Number(a.sira) || 0) - (Number(b.sira) || 0));
}

function renderStepRow(projectId, stepId, step, start, days, dayWidth) {
  const status = STEP_STATUSES[step.durum] || STEP_STATUSES.yapilacak;
  return `<div class="gantt-project-row gantt-step-row" data-parent-project="${escapeHtml(projectId)}">
    <button type="button" class="gantt-project-info gantt-step-info" data-edit-project="${escapeHtml(projectId)}" data-focus-step="${escapeHtml(stepId)}">
      <span class="gantt-project-title"><i class="step-status-${escapeHtml(step.durum || 'yapilacak')}"></i>${escapeHtml(step.ad || 'Adsız adım')}</span>
      <span class="gantt-project-meta"><b>${escapeHtml(status)}</b>${step.sorumlu ? ` · ${escapeHtml(step.sorumlu)}` : ''} · ${escapeHtml(step.bitisTarihi || 'Tarihsiz')}</span>
    </button>
    <div class="gantt-track" style="--gantt-days:${days}">${renderTimelineBar(projectId, step, start, days, dayWidth, stepId)}</div>
  </div>`;
}

function renderProjectRow(id, project, start, days, dayWidth) {
  const steps = projectSteps(project);
  const expanded = !collapsedProjects.has(id);
  const status = STATUSES[project.durum] || 'Fikir';
  const progress = Math.min(100, Math.max(0, Number(project.ilerleme) || 0));
  const disclosure = steps.length
    ? `<button type="button" class="gantt-disclosure" data-toggle-project="${escapeHtml(id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(project.ad)} adımlarını ${expanded ? 'daralt' : 'genişlet'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5"/></svg></button>`
    : '<span class="gantt-disclosure-placeholder"></span>';
  const parentRow = `<div class="gantt-project-row gantt-parent-row">
    <div class="gantt-project-info gantt-project-info--parent">
      ${disclosure}
      <button type="button" class="gantt-project-main" data-edit-project="${escapeHtml(id)}">
        <span class="gantt-project-title"><i class="priority-${escapeHtml(project.oncelik || 'normal')}"></i>${escapeHtml(project.ad || 'Adsız proje')}</span>
        <span class="gantt-project-meta"><b>${escapeHtml(status)}</b>${project.sorumlu ? ` · ${escapeHtml(project.sorumlu)}` : ''}${project.tur === 'ozel' ? ' · Özel' : ''}${steps.length ? ` · ${steps.length} adım · %${progress}` : ''}</span>
      </button>
    </div>
    <div class="gantt-track" style="--gantt-days:${days}">${renderTimelineBar(id, project, start, days, dayWidth)}</div>
  </div>`;
  const childRows = expanded ? steps.map(([stepId, step]) => renderStepRow(id, stepId, step, start, days, dayWidth)).join('') : '';
  return parentRow + childRows;
}

function render() {
  const board = $('#gantt-board');
  if (!board) { return; }
  renderSummary();
  const dayWidth = currentDayWidth();
  const { start, days } = computeRange(anchor.getFullYear());
  currentRangeStart = start;
  currentRangeDays = days;
  board.style.setProperty('--gantt-day-width', `${dayWidth}px`);
  const list = visibleProjects();
  board.innerHTML = `<div class="gantt-grid" style="--gantt-width:${days * dayWidth}px">
    <div class="gantt-grid-head">${renderWeekHead(start, days, dayWidth)}${renderDayHead(start, days)}</div>
    ${list.map(([id, project]) => renderProjectRow(id, project, start, days, dayWidth)).join('') || '<div class="gantt-empty"><strong>Bu görünümde proje yok.</strong><span>Yeni proje ekleyin veya filtreleri temizleyin.</span></div>'}
  </div>`;
  updatePeriodLabel();
  // Firebase verisi henüz gelmeden (auth/rol çözümü asenkron) kullanıcı
  // ctrl+tekerlek veya +/- ile yakınlaştırırsa da render() tetiklenir --
  // bu erken/boş render, "bugüne kaydır" hakkını (initialScrollDone) tüketmesin
  // diye gerçek Firebase verisi gelene kadar bekliyoruz (dataLoaded).
  if (dataLoaded && !initialScrollDone) {
    initialScrollDone = true;
    scrollToToday(false);
  }
}

function updatePeriodLabel() {
  const board = $('#gantt-board');
  const label = $('#gantt-period-label');
  if (!board || !label || !currentRangeStart) { return; }
  // Görünür şerit, sticky isim sütununun (nameColWidth) sağında başlıyor --
  // ortasını board.clientWidth/2 sanmak sütun genişliği kadar sola kayardı.
  const contentCenterX = board.scrollLeft + (board.clientWidth - nameColWidth()) / 2;
  const dayIndex = Math.max(0, Math.min(currentRangeDays - 1, Math.round(contentCenterX / currentDayWidth())));
  const date = addDays(currentRangeStart, dayIndex);
  label.textContent = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function scrollByDays(days) {
  const board = $('#gantt-board');
  if (!board) { return; }
  board.scrollBy({ left: days * currentDayWidth(), behavior: 'smooth' });
}

function scrollToToday(smooth = true) {
  const board = $('#gantt-board');
  if (!board) { return; }
  const year = new Date().getFullYear();
  if (anchor.getFullYear() !== year) {
    anchor = new Date(year, new Date().getMonth(), 1);
    render();
    // render()'ın kendi ilk-kaydırma mandalı (initialScrollDone) artık
    // tüketilmiş olabilir -- yıl değiştikten sonra "bugüne" gerçekten
    // kaydırdığımızdan emin olmak için kendimizi tekrar çağırıyoruz.
    scrollToToday(smooth);
    return;
  }
  const { start } = computeRange(year);
  const offset = dayDiff(start, new Date()) * currentDayWidth();
  board.scrollTo({ left: Math.max(0, offset - (board.clientWidth - nameColWidth()) / 2), behavior: smooth ? 'smooth' : 'auto' });
}

// Fare imlecinin (veya klavye kısayolunda görünür alanın ortasının) altındaki
// güne "kilitlenerek" yakınlaştırma yapar -- reui.io referansındaki ctrl+tekerlek
// davranışı. Yeni genişlikte aynı gün yine imlecin altında kalsın diye
// scrollLeft, eski/yeni piksel-başına-gün oranına göre yeniden hesaplanır.
function setZoom(nextIndex, clientX = null) {
  const board = $('#gantt-board');
  if (!board) { return; }
  const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, nextIndex));
  if (clamped === zoomIndex) { return; }
  const oldWidth = ZOOM_LEVELS[zoomIndex];
  const newWidth = ZOOM_LEVELS[clamped];
  const rect = board.getBoundingClientRect();
  const colWidth = nameColWidth();
  // Klavye kısayolunda (clientX yok) "görünür alanın ortası" da aynı şekilde
  // sticky sütunun sağındaki şeridin ortası olmalı, tüm board genişliğinin
  // ortası değil.
  const pointerOffset = clientX === null ? colWidth + (rect.width - colWidth) / 2 : clientX - rect.left;
  const contentX = board.scrollLeft + pointerOffset - colWidth;
  const dayIndex = contentX / oldWidth;
  zoomIndex = clamped;
  render();
  board.scrollLeft = Math.max(0, dayIndex * newWidth - pointerOffset + colWidth);
}

function detachData() {
  if (projectsRef) { projectsRef.off('value'); projectsRef = null; }
  if (eventsRef) { eventsRef.off('value'); eventsRef = null; }
}

function attachData() {
  detachData();
  projectsRef = database.ref(dbPath('haberProjeleri'));
  eventsRef = database.ref(dbPath('etkinlikler'));
  projectsRef.on('value', (snapshot) => {
    projects = snapshot.val() || {};
    dataLoaded = true;
    render();
  }, (error) => {
    console.error('Haber projeleri yüklenemedi:', error);
    $('#gantt-board').innerHTML = '<div class="gantt-empty"><strong>Projeler yüklenemedi.</strong><span>Firebase kurallarında haberProjeleri okuma iznini kontrol edin.</span></div>';
  });
  eventsRef.on('value', (snapshot) => {
    events = snapshot.val() || {};
    refreshEventOptions($('#gantt-event').value);
  });
}

function refreshEventOptions(selectedId = '') {
  const select = $('#gantt-event');
  if (!select) { return; }
  const options = Object.entries(events)
    .filter(([, event]) => event && event.arsiv !== true)
    .sort(([, a], [, b]) => String(a.tarih || '').localeCompare(String(b.tarih || '')))
    .map(([id, event]) => `<option value="${escapeHtml(id)}"${id === selectedId ? ' selected' : ''}>${escapeHtml(event.tarih || 'Tarihsiz')} — ${escapeHtml(event.ad || 'Adsız etkinlik')}</option>`)
    .join('');
  select.innerHTML = `<option value="">Bağlantı yok</option>${options}`;
  select.value = selectedId;
}

function stepProgress(status) {
  if (status === 'tamamlandi') { return 100; }
  if (status === 'incelemede') { return 80; }
  if (status === 'yapiliyor') { return 50; }
  return 0;
}

function stepEditorHtml(stepId, step = {}, index = 0) {
  const optionHtml = Object.entries(STEP_STATUSES).map(([value, label]) =>
    `<option value="${value}"${(step.durum || 'yapilacak') === value ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<div class="gantt-step-editor" data-step-row data-step-id="${escapeHtml(stepId)}">
    <span class="gantt-step-order" aria-hidden="true">${index + 1}</span>
    <label><span class="sr-only">Adım adı</span><input class="form-control" data-step-name maxlength="140" required placeholder="Örn. Röportaj çekimi" value="${escapeHtml(step.ad || '')}"></label>
    <label><span class="sr-only">Adım durumu</span><select class="form-control" data-step-status>${optionHtml}</select></label>
    <label><span class="sr-only">Başlangıç tarihi</span><input type="date" class="form-control" data-step-start required value="${escapeHtml(step.baslangicTarihi || $('#gantt-start').value)}"></label>
    <label><span class="sr-only">Bitiş tarihi</span><input type="date" class="form-control" data-step-end required value="${escapeHtml(step.bitisTarihi || $('#gantt-end').value)}"></label>
    <label><span class="sr-only">Sorumlu</span><input class="form-control" data-step-owner maxlength="120" placeholder="Sorumlu" value="${escapeHtml(step.sorumlu || '')}"></label>
    <button type="button" class="gantt-step-remove" data-remove-step aria-label="Bu adımı kaldır">×</button>
  </div>`;
}

function syncProjectProgressFromSteps() {
  const rows = [...document.querySelectorAll('[data-step-row]')];
  const progressInput = $('#gantt-progress');
  if (!rows.length) {
    progressInput.disabled = false;
    $('#gantt-progress-value').textContent = `${progressInput.value}%`;
    return;
  }
  const activeRows = rows.filter((row) => row.querySelector('[data-step-status]').value !== 'iptal');
  const progress = activeRows.length
    ? Math.round(activeRows.reduce((sum, row) => sum + stepProgress(row.querySelector('[data-step-status]').value), 0) / activeRows.length)
    : 0;
  progressInput.value = progress;
  progressInput.disabled = true;
  $('#gantt-progress-value').textContent = `${progress}% (adımlardan)`;
}

function renderStepEditor(steps = {}) {
  const entries = Object.entries(steps)
    .filter(([, step]) => step && step.arsiv !== true)
    .sort(([, a], [, b]) => (Number(a.sira) || 0) - (Number(b.sira) || 0));
  $('#gantt-step-list').innerHTML = entries.map(([stepId, step], index) => stepEditorHtml(stepId, step, index)).join('') || '<p class="gantt-step-empty">Henüz üretim adımı eklenmedi.</p>';
  syncProjectProgressFromSteps();
}

function addStepEditor() {
  const list = $('#gantt-step-list');
  list.querySelector('.gantt-step-empty')?.remove();
  const stepId = database.ref(dbPath('haberProjeleri')).push().key;
  const count = list.querySelectorAll('[data-step-row]').length;
  list.insertAdjacentHTML('beforeend', stepEditorHtml(stepId, {}, count));
  syncProjectProgressFromSteps();
  list.querySelector(`[data-step-id="${stepId}"] [data-step-name]`)?.focus();
}

function collectSteps() {
  const steps = {};
  [...document.querySelectorAll('[data-step-row]')].forEach((row, index) => {
    const start = row.querySelector('[data-step-start]').value;
    const end = row.querySelector('[data-step-end]').value;
    const name = row.querySelector('[data-step-name]').value.trim();
    if (!name) { throw new Error(`${index + 1}. üretim adımının adı zorunludur.`); }
    if (!parseDateKey(start) || !parseDateKey(end) || end < start) {
      throw new Error(`${index + 1}. üretim adımının tarih aralığı geçersizdir.`);
    }
    const status = row.querySelector('[data-step-status]').value;
    steps[row.dataset.stepId] = {
      ad: name,
      durum: status,
      baslangicTarihi: start,
      bitisTarihi: end,
      sorumlu: row.querySelector('[data-step-owner]').value.trim(),
      ilerleme: stepProgress(status),
      sira: index,
      arsiv: false
    };
  });
  return steps;
}

function setFormError(message = '') {
  $('#gantt-form-error').textContent = message;
}

function openModal(id = '', focusStepId = '') {
  if (!canWrite || isReadOnly()) {
    showToast(isReadOnly() ? 'Salt-okunur kilit açık.' : 'Proje düzenleme yetkiniz yok.', { variant: 'error' });
    return;
  }
  const project = id ? projects[id] : null;
  const today = localDateKey(new Date());
  $('#gantt-id').value = id;
  $('#gantt-title').value = project?.ad || '';
  $('#gantt-type').value = project?.tur || 'ozel';
  $('#gantt-status').value = project?.durum || 'fikir';
  $('#gantt-start').value = project?.baslangicTarihi || today;
  $('#gantt-end').value = project?.bitisTarihi || localDateKey(addDays(new Date(), 7));
  $('#gantt-owner').value = project?.sorumlu || currentUserName;
  $('#gantt-priority').value = project?.oncelik || 'normal';
  $('#gantt-progress').value = Number(project?.ilerleme) || 0;
  $('#gantt-progress-value').textContent = `${Number(project?.ilerleme) || 0}%`;
  $('#gantt-notes').value = project?.notlar || '';
  renderStepEditor(project?.adimlar || {});
  refreshEventOptions(project?.takvimEtkinlikId || '');
  $('#gantt-dialog-title').textContent = project ? 'Projeyi düzenle' : 'Yeni proje';
  $('#gantt-archive').hidden = !project;
  setFormError();
  $('#gantt-modal').hidden = false;
  document.body.classList.add('gantt-modal-open');
  requestAnimationFrame(() => {
    const stepField = focusStepId ? document.querySelector(`[data-step-id="${focusStepId}"] [data-step-name]`) : null;
    (stepField || $('#gantt-title')).focus();
  });
}

function closeModal() {
  $('#gantt-modal').hidden = true;
  document.body.classList.remove('gantt-modal-open');
  setFormError();
}

function projectFromForm() {
  const start = $('#gantt-start').value;
  const end = $('#gantt-end').value;
  if (!parseDateKey(start) || !parseDateKey(end)) { throw new Error('Geçerli başlangıç ve bitiş tarihleri girin.'); }
  if (end < start) { throw new Error('Bitiş tarihi başlangıç tarihinden önce olamaz.'); }
  const title = $('#gantt-title').value.trim();
  if (!title) { throw new Error('Proje adı zorunludur.'); }
  const steps = collectSteps();
  const activeSteps = Object.values(steps).filter((step) => step.durum !== 'iptal');
  const progress = activeSteps.length
    ? Math.round(activeSteps.reduce((sum, step) => sum + step.ilerleme, 0) / activeSteps.length)
    : (Number($('#gantt-progress').value) || 0);
  return {
    ad: title,
    tur: $('#gantt-type').value,
    durum: $('#gantt-status').value,
    baslangicTarihi: start,
    bitisTarihi: end,
    sorumlu: $('#gantt-owner').value.trim(),
    oncelik: $('#gantt-priority').value,
    ilerleme: progress,
    adimlar: steps,
    takvimEtkinlikId: $('#gantt-event').value,
    notlar: $('#gantt-notes').value.trim(),
    arsiv: false
  };
}

async function saveProject(event) {
  event.preventDefault();
  if (!canWrite || isReadOnly()) { setFormError('Bu işlem için düzenleme yetkiniz yok.'); return; }
  let next;
  try { next = projectFromForm(); } catch (error) { setFormError(error.message); return; }
  const currentId = $('#gantt-id').value;
  const id = currentId || database.ref(dbPath('haberProjeleri')).push().key;
  const previous = currentId ? projects[currentId] : null;
  const button = $('#gantt-save');
  button.disabled = true;
  setFormError();
  try {
    if (previous?.guncellemeTs) {
      const fresh = await database.ref(dbPath(`haberProjeleri/${id}/guncellemeTs`)).once('value');
      if (fresh.val() !== previous.guncellemeTs) { throw new Error('Bu proje başka biri tarafından değiştirildi. Pencereyi kapatıp yeniden açın.'); }
    }
    const updates = {};
    updates[dbPath(`haberProjeleri/${id}`)] = {
      ...next,
      olusturan: previous?.olusturan || currentUserName || currentUserEmail,
      olusturmaTs: previous?.olusturmaTs || firebase.database.ServerValue.TIMESTAMP,
      guncelleyen: currentUserName || currentUserEmail,
      guncellemeTs: firebase.database.ServerValue.TIMESTAMP
    };
    if (previous?.takvimEtkinlikId && previous.takvimEtkinlikId !== next.takvimEtkinlikId) {
      updates[dbPath(`etkinlikler/${previous.takvimEtkinlikId}/projeId`)] = null;
    }
    if (next.takvimEtkinlikId) {
      updates[dbPath(`etkinlikler/${next.takvimEtkinlikId}/projeId`)] = id;
      updates[dbPath(`etkinlikler/${next.takvimEtkinlikId}/tarih`)] = next.bitisTarihi;
      updates[dbPath(`etkinlikler/${next.takvimEtkinlikId}/guncellemeTs`)] = firebase.database.ServerValue.TIMESTAMP;
    }
    const logPath = dbPath('logs/haberProje');
    const logKey = database.ref(logPath).push().key;
    updates[`${logPath}/${logKey}`] = {
      by: currentUserName || currentUserEmail, email: currentUserEmail,
      action: `${next.ad} haber projesi ${previous ? 'güncellendi' : 'oluşturuldu'}`,
      target: next.ad, timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    await database.ref('/').update(updates);
    closeModal();
    showToast(previous ? 'Proje güncellendi.' : 'Proje oluşturuldu.', { variant: 'success' });
  } catch (error) {
    console.error('Proje kaydedilemedi:', error);
    setFormError(error.message || 'Proje kaydedilemedi.');
  } finally {
    button.disabled = false;
  }
}

async function archiveCurrentProject() {
  const id = $('#gantt-id').value;
  const project = projects[id];
  if (!id || !project || !canWrite || isReadOnly()) { return; }
  const updates = {};
  updates[dbPath(`haberProjeleri/${id}/arsiv`)] = true;
  updates[dbPath(`haberProjeleri/${id}/guncelleyen`)] = currentUserName || currentUserEmail;
  updates[dbPath(`haberProjeleri/${id}/guncellemeTs`)] = firebase.database.ServerValue.TIMESTAMP;
  if (project.takvimEtkinlikId) { updates[dbPath(`etkinlikler/${project.takvimEtkinlikId}/projeId`)] = null; }
  const logPath = dbPath('logs/haberProje');
  const logKey = database.ref(logPath).push().key;
  updates[`${logPath}/${logKey}`] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: `${project.ad || 'Haber projesi'} arşivlendi`, target: project.ad || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    await database.ref('/').update(updates);
    closeModal();
    showToast('Proje arşivlendi.', { variant: 'success' });
  } catch (error) {
    console.error('Proje arşivlenemedi:', error);
    setFormError('Proje arşivlenemedi.');
  }
}

async function updateProjectDates(id, startKey, endKey, stepId = '') {
  const project = projects[id];
  const item = stepId ? project?.adimlar?.[stepId] : project;
  if (!project || !item || !canWrite || isReadOnly() || endKey < startKey) { render(); return; }
  const updates = {};
  const itemPath = stepId ? `haberProjeleri/${id}/adimlar/${stepId}` : `haberProjeleri/${id}`;
  updates[dbPath(`${itemPath}/baslangicTarihi`)] = startKey;
  updates[dbPath(`${itemPath}/bitisTarihi`)] = endKey;
  updates[dbPath(`haberProjeleri/${id}/guncelleyen`)] = currentUserName || currentUserEmail;
  updates[dbPath(`haberProjeleri/${id}/guncellemeTs`)] = firebase.database.ServerValue.TIMESTAMP;
  if (!stepId && project.takvimEtkinlikId) {
    updates[dbPath(`etkinlikler/${project.takvimEtkinlikId}/tarih`)] = endKey;
    updates[dbPath(`etkinlikler/${project.takvimEtkinlikId}/guncellemeTs`)] = firebase.database.ServerValue.TIMESTAMP;
  }
  const logPath = dbPath('logs/haberProje');
  const logKey = database.ref(logPath).push().key;
  updates[`${logPath}/${logKey}`] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: `${item.ad || project.ad || 'Haber projesi'} ${stepId ? 'üretim adımı' : 'haber projesi'} zaman çizelgesinde taşındı · ${startKey} → ${endKey}`,
    target: project.ad || '', timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    if (project.guncellemeTs) {
      const fresh = await database.ref(dbPath(`haberProjeleri/${id}/guncellemeTs`)).once('value');
      if (fresh.val() !== project.guncellemeTs) {
        throw new Error('Bu proje başka biri tarafından değiştirildi.');
      }
    }
    await database.ref('/').update(updates);
    showToast('Proje tarihleri güncellendi.', { variant: 'success' });
  } catch (error) {
    console.error('Proje tarihleri güncellenemedi:', error);
    render();
    showToast('Proje tarihleri güncellenemedi.', { variant: 'error' });
  }
}

function beginBarDrag(event) {
  const bar = event.target.closest('.gantt-bar');
  if (!bar || event.button !== 0) { return; }
  if (!canWrite || isReadOnly()) { openModal(bar.dataset.projectId); return; }
  const project = projects[bar.dataset.projectId];
  const item = bar.dataset.stepId ? project?.adimlar?.[bar.dataset.stepId] : project;
  const start = parseDateKey(item?.baslangicTarihi);
  const end = parseDateKey(item?.bitisTarihi);
  if (!start || !end) { return; }
  const handle = event.target.closest('[data-resize]');
  dragState = {
    id: bar.dataset.projectId,
    stepId: bar.dataset.stepId || '',
    bar,
    pointerId: event.pointerId,
    originX: event.clientX,
    delta: 0,
    mode: handle?.dataset.resize || 'move',
    start,
    end,
    originalWidth: bar.offsetWidth
  };
  bar.setPointerCapture(event.pointerId);
  bar.classList.add('is-dragging');
  event.preventDefault();
}

function moveBarDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) { return; }
  const dayWidth = currentDayWidth();
  dragState.delta = Math.round((event.clientX - dragState.originX) / dayWidth);
  if (dragState.mode === 'move') { dragState.bar.style.transform = `translateX(${dragState.delta * dayWidth}px)`; }
  if (dragState.mode === 'start') {
    const maxDelta = dayDiff(dragState.start, dragState.end);
    const delta = Math.min(maxDelta, dragState.delta);
    dragState.bar.style.transform = `translateX(${delta * dayWidth}px)`;
    dragState.bar.style.width = `${Math.max(dayWidth, dragState.originalWidth - delta * dayWidth)}px`;
  }
  if (dragState.mode === 'end') {
    const minDelta = -dayDiff(dragState.start, dragState.end);
    const delta = Math.max(minDelta, dragState.delta);
    dragState.bar.style.width = `${Math.max(dayWidth, dragState.originalWidth + delta * dayWidth)}px`;
  }
}

function endBarDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) { return; }
  const state = dragState;
  dragState = null;
  state.bar.classList.remove('is-dragging');
  if (!state.delta) { openModal(state.id, state.stepId); render(); return; }
  let start = state.start;
  let end = state.end;
  if (state.mode === 'move') { start = addDays(start, state.delta); end = addDays(end, state.delta); }
  if (state.mode === 'start') { start = addDays(start, Math.min(dayDiff(start, end), state.delta)); }
  if (state.mode === 'end') { end = addDays(end, Math.max(-dayDiff(start, end), state.delta)); }
  updateProjectDates(state.id, localDateKey(start), localDateKey(end), state.stepId);
}

function bindUi() {
  $('#gantt-new').addEventListener('click', () => openModal());
  // Sürekli/geniş (tüm yıl) zaman çizelgesinde önceki/sonraki artık ayı
  // değiştirip yeniden render etmiyor -- sadece 4 hafta kaydırıyor (reui.io
  // referansındaki kaydırma davranışı). "Bugün" gerekirse yılı da değiştirir.
  $('#gantt-prev').addEventListener('click', () => scrollByDays(-28));
  $('#gantt-next').addEventListener('click', () => scrollByDays(28));
  $('#gantt-today').addEventListener('click', () => scrollToToday(true));
  $('#gantt-search').addEventListener('input', (event) => { searchText = event.target.value.trim(); render(); });
  $('#gantt-status-filter').addEventListener('change', (event) => { statusFilter = event.target.value; render(); });
  $('#gantt-progress').addEventListener('input', (event) => { $('#gantt-progress-value').textContent = `${event.target.value}%`; });
  $('#gantt-add-step').addEventListener('click', addStepEditor);
  $('#gantt-step-list').addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-step]');
    if (!removeButton) { return; }
    removeButton.closest('[data-step-row]').remove();
    const rows = [...document.querySelectorAll('[data-step-row]')];
    rows.forEach((row, index) => { row.querySelector('.gantt-step-order').textContent = index + 1; });
    if (!rows.length) { $('#gantt-step-list').innerHTML = '<p class="gantt-step-empty">Henüz üretim adımı eklenmedi.</p>'; }
    syncProjectProgressFromSteps();
  });
  $('#gantt-step-list').addEventListener('change', (event) => {
    if (event.target.matches('[data-step-status]')) { syncProjectProgressFromSteps(); }
  });
  $('#gantt-form').addEventListener('submit', saveProject);
  $('#gantt-archive').addEventListener('click', archiveCurrentProject);
  document.querySelectorAll('[data-gantt-close]').forEach((button) => button.addEventListener('click', closeModal));
  $('#gantt-board').addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle-project]');
    if (toggle) {
      const id = toggle.dataset.toggleProject;
      if (collapsedProjects.has(id)) { collapsedProjects.delete(id); } else { collapsedProjects.add(id); }
      render();
      return;
    }
    const edit = event.target.closest('[data-edit-project]');
    if (edit) { openModal(edit.dataset.editProject, edit.dataset.focusStep || ''); }
  });
  $('#gantt-board').addEventListener('pointerdown', beginBarDrag);
  $('#gantt-board').addEventListener('pointermove', moveBarDrag);
  $('#gantt-board').addEventListener('pointerup', endBarDrag);
  $('#gantt-board').addEventListener('pointercancel', endBarDrag);
  $('#gantt-board').addEventListener('keydown', (event) => {
    const bar = event.target.closest('.gantt-bar');
    if (bar && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openModal(bar.dataset.projectId, bar.dataset.stepId || '');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#gantt-modal').hidden) { closeModal(); }
  });
  const board = $('#gantt-board');
  // Ctrl/Cmd + tekerlek: reui.io referansındaki yakınlaştırma. preventDefault
  // şart -- yoksa tarayıcı bunu sayfa yakınlaştırma (page zoom) kısayolu olarak
  // yakalar ve tüm sayfa büyür/küçülür (reui.io'da elle test edilirken görüldü).
  board.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) { return; }
    event.preventDefault();
    setZoom(zoomIndex + (event.deltaY < 0 ? 1 : -1), event.clientX);
  }, { passive: false });
  document.addEventListener('keydown', (event) => {
    if (!$('#gantt-board') || !$('#gantt-modal').hidden) { return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoomIndex + 1); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoomIndex - 1); }
  });
  board.addEventListener('scroll', () => {
    if (scrollRaf) { return; }
    scrollRaf = requestAnimationFrame(() => { scrollRaf = null; updatePeriodLabel(); });
  }, { passive: true });
}

export function initGantt() {
  if (!$('#gantt-board')) { return; }
  if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
  database = firebase.database();
  bindUi();
  firebase.auth().onAuthStateChanged(async (user) => {
    detachData();
    if (!user) { return; }
    currentUserEmail = user.email || '';
    try {
      const snapshot = await database.ref(`users/${user.uid}`).once('value');
      const profile = snapshot.val() || {};
      canWrite = ['editor', 'admin', 'owner'].includes(profile.role) && profile.blocked !== true;
      currentUserName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || currentUserEmail;
      await initDbMode(database);
      modeReady = true;
      renderDbModeBanner();
      $('#gantt-new').disabled = !canWrite || isReadOnly();
      attachData();
    } catch (error) {
      console.error('Gantt yetkisi çözülemedi:', error);
      $('#gantt-board').innerHTML = '<div class="gantt-empty"><strong>Yetki bilgisi alınamadı.</strong></div>';
    }
  });
  onDbModeChange(() => {
    if (!modeReady) { return; }
    renderDbModeBanner();
    $('#gantt-new').disabled = !canWrite || isReadOnly();
    closeModal();
    attachData();
  });
}
