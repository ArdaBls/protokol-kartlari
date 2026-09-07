// Haber üretim Gantt görünümü. Projeler ayrı `haberProjeleri` dalında tutulur;
// takvimle bağ kurulduğunda yalnızca seçilen etkinliğin `projeId` ve `tarih`
// alanları aynı atomik Firebase update'i içinde eşlenir.

import { showToast } from './toast.js';
import { dbPath, isReadOnly, initDbMode, renderDbModeBanner, onDbModeChange } from './db-mode.js';
import { openMenu } from './menus.js';
import { loadPressOfficerPool } from './roster.js';

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
// reui.io/preview/base/gantt-1 referansındaki çubuk tonları -- gerçek renkler
// oradaki oklab arkaplanlardan (alfa karışımı çözülerek) çıkarıldı. Ham
// tonlar (Tailwind ~500) beyaz metinle WCAG AA'yı geçemiyor (~2-3:1), bu
// yüzden çubuklarda düz dolgu yerine soluk/"saydam" dolgu + solid sol kenarlık
// + koyu metin kullanılıyor (kullanıcının "saydam görünüyor, o renkler daha
// iyi" tercihiyle örtüşüyor ve kontrast sorunsuz oluyor).
const PALETTE = {
  mavi: '#2b7fff', indigo: '#615fff', mor: '#8e51ff', camgobegi: '#00b8db',
  turkuaz: '#00bba7', zumrut: '#00bc7d', amber: '#f0b100', turuncu: '#ff6900',
  kirmizi: '#ff2056', pembe: '#f6339a'
};
const PALETTE_ORDER = ['mavi', 'indigo', 'mor', 'camgobegi', 'turkuaz', 'zumrut', 'amber', 'turuncu', 'kirmizi', 'pembe'];
// Durum -&gt; varsayılan renk (kullanıcı elle seçmediyse). PALETTE anahtarlarına işaret eder.
const STATUS_COLOR = {
  fikir: 'indigo', arastirma: 'mavi', hazirlik: 'mor', cekim: 'pembe', kurgu: 'turuncu',
  onay: 'amber', yayinlandi: 'zumrut', iptal: 'kirmizi',
  yapilacak: 'indigo', yapiliyor: 'mavi', incelemede: 'mor', tamamlandi: 'zumrut'
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
// "Sorumlu" artık serbest metin DEĞİL -- calendar.js'teki katılımcı seçici
// gibi havuzdan (basinGorevlileri) tıklayarak seçilen tek bir kişi (chip,
// yanında kaldırmak için ×). Ham JSON string yerine ownerValue tutulur,
// projectFromForm() bunu okur.
let ownerPool = [];
let ownerValue = '';
let ownerPoolRequest = 0;

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

// Proje düzeyinde kullanıcı elle bir PALETTE rengi seçtiyse (project.renk) o
// kullanılır; seçmediyse duruma göre otomatik atanan varsayılana düşülür.
// Adımlar (steps) için elle renk seçimi yok -- her zaman kendi durumlarına
// göre otomatik renklenir (modal karmaşıklığını artırmamak için bilinçli sınır).
function barColorHex(item, status, isProjectLevel) {
  // İptal her zaman kırmızı -- elle seçilmiş renk dahil hiçbir şeyi geçersiz
  // kılmasın diye burada, TEK yerde uygulanıyor (hem asıl çubuk hem de
  // akordeondaki mini ilerleme çubuğu bu fonksiyonu çağırıyor, ikisi de
  // otomatik olarak aynı sonucu görür).
  if (status === 'iptal') { return PALETTE.kirmizi; }
  const manual = isProjectLevel ? item.renk : null;
  if (manual && PALETTE[manual]) { return PALETTE[manual]; }
  return PALETTE[STATUS_COLOR[status]] || PALETTE.indigo;
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
  const color = barColorHex(item, status, !stepId);
  return `<button type="button" class="gantt-bar ${stepId ? 'gantt-bar--step ' : ''}status-${escapeHtml(status)}${overdue ? ' is-overdue' : ''}" ${attrs} style="left:${geometry.left}px;width:${geometry.width}px;--bar-color:${color}" aria-label="${escapeHtml(item.ad)} kaydını düzenle">
    <span class="gantt-resize gantt-resize--start" data-resize="start" aria-hidden="true"><span class="gantt-resize-grip"></span></span>
    <span class="gantt-bar-progress" style="width:${progress}%"></span>
    <span class="gantt-bar-label">${escapeHtml(item.ad)} · ${progress}%</span>
    <span class="gantt-resize gantt-resize--end" data-resize="end" aria-hidden="true"><span class="gantt-resize-grip"></span></span>
  </button>`;
}

function projectSteps(project) {
  return Object.entries(project.adimlar || {})
    .filter(([, step]) => step && step.arsiv !== true)
    .sort(([, a], [, b]) => (Number(a.sira) || 0) - (Number(b.sira) || 0));
}

// shadcn/reui'nin Badge bileşenindeki gibi ("border-warning/15 bg-warning/10
// text-warning ... rounded-full") soluk dolgu + kendi tonunda ince kenarlık +
// koyu-yeterli metin rengi -- rastgele shadcn renk adları yerine kendi
// PALETTE/STATUS_COLOR eşlememiz kullanılıyor (bar renkleriyle aynı dil).
function statusBadgeHtml(status, label) {
  const hex = PALETTE[STATUS_COLOR[status]] || PALETTE.indigo;
  return `<span class="gantt-status-badge" style="--badge-color:${hex}">${escapeHtml(label)}</span>`;
}

// Proje adının hemen sağındaki dairesel ilerleme göstergesi -- stroke-dasharray
// ile doldurulan bir SVG halka, üzerine gelince (mevcut [data-tooltip] CSS
// sistemiyle) yüzdeyi gösterir. Her render()'da progress'e göre yeniden
// çizildiğinden ilerleme her değiştiğinde (anlık) güncellenir.
function progressRingHtml(progress, colorHex) {
  const clamped = Math.min(100, Math.max(0, progress));
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const offset = (c * (1 - clamped / 100)).toFixed(2);
  // [data-tooltip] ::before/::after tutarlı çalışsın diye SVG'nin kendisine
  // değil, onu saran normal bir <span>'e konuyor.
  // data-tooltip-pos="bottom": yukarı açılan varsayılan konum ilk satırda
  // .gantt-grid-head'in (sticky, daha yüksek stacking context) ARKASINDA
  // kalıyordu -- z-index'i ne kadar yükseltilirse yükseltilsin, ata
  // .gantt-project-info'nun kendi (daha düşük) stacking context'i içine
  // hapsolduğu için başlığı geçemiyordu. Aşağı açmak bu çakışmayı ortadan kaldırıyor.
  return `<span class="gantt-progress-ring-wrap" data-tooltip="%${clamped}" data-tooltip-pos="bottom"><svg class="gantt-progress-ring" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="2.4"></circle>
    <circle cx="8" cy="8" r="${r}" fill="none" stroke="${colorHex}" stroke-width="2.4" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 8 8)"></circle>
  </svg></span>`;
}

// Satırın sağ ucundaki "⋮" butonu -- reui.io referansındaki satır menüsü.
// Nested Assignee/Status/Priority alt-menüleri KASITLI OLARAK yok: bunların
// hepsi zaten Düzenle modalında var, burada tekrarlamak menus.js'in düz
// (alt-menüsüz) openMenu() API'sini zorlardı. Adımlarda Arşivle/Sil yok --
// adımlar modal içindeki "×" ile kaldırılıyor.
function rowMenuHtml(id, stepId = '') {
  const attrs = stepId
    ? `data-row-menu="${escapeHtml(id)}" data-row-menu-step="${escapeHtml(stepId)}"`
    : `data-row-menu="${escapeHtml(id)}"`;
  return `<button type="button" class="gantt-row-menu" ${attrs} aria-label="Diğer işlemler" aria-haspopup="menu" aria-expanded="false">
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="13" r="1.3"/></svg>
  </button>`;
}

function renderStepRow(projectId, stepId, step, start, days, dayWidth) {
  const statusKey = step.durum || 'yapilacak';
  return `<div class="gantt-project-row gantt-step-row" data-parent-project="${escapeHtml(projectId)}">
    <div class="gantt-project-info gantt-project-info--step">
      <button type="button" class="gantt-project-main" data-edit-project="${escapeHtml(projectId)}" data-focus-step="${escapeHtml(stepId)}">
        <span class="gantt-project-title"><i class="step-status-${escapeHtml(statusKey)}"></i>${escapeHtml(step.ad || 'Adsız adım')}</span>
        <span class="gantt-project-meta">${statusBadgeHtml(statusKey, STEP_STATUSES[statusKey] || STEP_STATUSES.yapilacak)}<span class="gantt-project-meta-text">${step.sorumlu ? ` · ${escapeHtml(step.sorumlu)}` : ''} · ${escapeHtml(step.bitisTarihi || 'Tarihsiz')}</span></span>
      </button>
      ${rowMenuHtml(projectId, stepId)}
    </div>
    <div class="gantt-track" style="--gantt-days:${days}">${renderTimelineBar(projectId, step, start, days, dayWidth, stepId)}</div>
  </div>`;
}

function renderProjectRow(id, project, start, days, dayWidth) {
  const steps = projectSteps(project);
  const expanded = !collapsedProjects.has(id);
  const statusKey = project.durum || 'fikir';
  const status = STATUSES[statusKey] || 'Fikir';
  const progress = Math.min(100, Math.max(0, Number(project.ilerleme) || 0));
  const disclosure = steps.length
    ? `<button type="button" class="gantt-disclosure" data-toggle-project="${escapeHtml(id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(project.ad)} adımlarını ${expanded ? 'daralt' : 'genişlet'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l5 5-5 5"/></svg></button>`
    : '<span class="gantt-disclosure-placeholder"></span>';
  // Sol akordeon: reui.io/preview/base/gantt-2 referansındaki grup satırlarında
  // olduğu gibi başlığın hemen altında ince, renkli bir ilerleme çubuğu --
  // sadece adımlı projelerde (tek başlarına ilerleme metni yeterli).
  const barColor = barColorHex(project, statusKey, true);
  const miniProgress = steps.length
    ? `<span class="gantt-project-progress" aria-hidden="true"><span style="width:${progress}%;background:${barColor}"></span></span>`
    : '';
  const parentRow = `<div class="gantt-project-row gantt-parent-row">
    <div class="gantt-project-info gantt-project-info--parent">
      ${disclosure}
      <button type="button" class="gantt-project-main" data-edit-project="${escapeHtml(id)}">
        <span class="gantt-project-title-row">
          <span class="gantt-project-title"><i class="priority-${escapeHtml(project.oncelik || 'normal')}"></i>${escapeHtml(project.ad || 'Adsız proje')}</span>
          ${progressRingHtml(progress, barColor)}
        </span>
        ${miniProgress}
        <span class="gantt-project-meta">${statusBadgeHtml(statusKey, status)}<span class="gantt-project-meta-text">${project.sorumlu ? ` · ${escapeHtml(project.sorumlu)}` : ''}${project.tur === 'ozel' ? ' · Özel' : ''}${steps.length ? ` · ${steps.length} adım · %${progress}` : ''}</span></span>
      </button>
      ${rowMenuHtml(id)}
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

// İki satırlı düzen: eskiden tek 7 sütunlu grid, dar modal genişliğinde
// (kullanıcının "sağda sorumlu kişi gözükmüyor" diye bildirdiği) Sorumlu
// alanını görünmez kılıyordu. Şimdi hiçbir alan taşmıyor, hepsi her zaman görünür.
function stepEditorHtml(stepId, step = {}, index = 0) {
  const optionHtml = Object.entries(STEP_STATUSES).map(([value, label]) =>
    `<option value="${value}"${(step.durum || 'yapilacak') === value ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<div class="gantt-step-editor" data-step-row data-step-id="${escapeHtml(stepId)}">
    <div class="gantt-step-editor-row">
      <span class="gantt-step-order" aria-hidden="true">${index + 1}</span>
      <label class="gantt-step-name-field">Adım adı<input class="form-control" data-step-name maxlength="140" required placeholder="Örn. Röportaj çekimi" value="${escapeHtml(step.ad || '')}"></label>
      <label class="gantt-step-status-field">Adım durumu<select class="form-control" data-step-status>${optionHtml}</select></label>
      <button type="button" class="gantt-step-remove" data-remove-step aria-label="Bu adımı kaldır">×</button>
    </div>
    <div class="gantt-step-editor-row gantt-step-editor-row--dates">
      <label>Başlangıç<input type="date" class="form-control" data-step-start required value="${escapeHtml(step.baslangicTarihi || $('#gantt-start').value)}"></label>
      <label>Bitiş<input type="date" class="form-control" data-step-end required value="${escapeHtml(step.bitisTarihi || $('#gantt-end').value)}"></label>
      <label>Sorumlu<input class="form-control" data-step-owner maxlength="120" placeholder="Sorumlu" value="${escapeHtml(step.sorumlu || '')}"></label>
    </div>
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

// Satır "⋮" menüsü -- menus.js'in paylaşılan openMenu() popover'ı (kanban.js
// vb. yerlerde de kullanılıyor). Adımlarda Arşivle/Sil yok, sadece Düzenle.
function openRowMenu(trigger) {
  const id = trigger.dataset.rowMenu;
  const stepId = trigger.dataset.rowMenuStep || '';
  const items = [
    { label: 'Düzenle', action: () => openModal(id, stepId) }
  ];
  if (!stepId) {
    items.push(
      '-',
      { label: 'Arşivle', action: () => archiveCurrentProject(id) },
      { label: 'Sil', variant: 'danger', action: () => deleteCurrentProject(id) }
    );
  }
  openMenu(trigger, items);
}

// reui.io/preview/base/gantt-1 referansındaki combobox-chips deseni: arama
// kutusuna yazınca havuzdan filtrelenmiş öneriler açılır, birine tıklanınca
// arama kutusunun yerini kişi rozeti (chip) alır, rozetin × ile kaldırılması
// arama kutusuna geri döner. Havuzda olmayan bir isim asla YAZILAMAZ --
// kullanıcının "sadece kişi ekleme yapalım, yazmayalım" isteği.
function renderOwnerPicker() {
  const chips = $('#gantt-owner-chips');
  const search = $('#gantt-owner-search');
  if (!chips || !search) { return; }
  chips.innerHTML = ownerValue
    ? `<span class="gantt-owner-chip">${escapeHtml(ownerValue)}<button type="button" data-owner-remove aria-label="${escapeHtml(ownerValue)} kişisini kaldır">×</button></span>`
    : '';
  search.hidden = !!ownerValue;
  if (ownerValue) { search.value = ''; }
}

function renderOwnerSuggestions(query) {
  const box = $('#gantt-owner-suggestions');
  if (!box) { return; }
  const q = query.trim().toLocaleLowerCase('tr');
  const matches = (q ? ownerPool.filter((p) => p.name.toLocaleLowerCase('tr').includes(q)) : ownerPool).slice(0, 8);
  box.innerHTML = matches.length
    ? matches.map((p) => `<button type="button" class="gantt-owner-suggestion" data-owner-pick="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button>`).join('')
    : '<p class="gantt-owner-empty">Kişi bulunamadı.</p>';
  box.hidden = false;
}

function hideOwnerSuggestions() {
  const box = $('#gantt-owner-suggestions');
  if (box) { box.hidden = true; }
}

// Havuz verisi modal her açıldığında tazelenir. Böylece Kullanıcı Yönetimi'nde
// sonradan basın görevlisi yapılan kişi, sayfayı yenilemeden de seçilebilir.
async function refreshOwnerPool() {
  if (!database) { return; }
  const request = ++ownerPoolRequest;
  ownerPool = await loadPressOfficerPool(database);
  if (request !== ownerPoolRequest || $('#gantt-modal')?.hidden) { return; }
  renderOwnerPicker();
}

function renderColorPicker(selected) {
  const el = $('#gantt-color-picker');
  if (!el) { return; }
  el.innerHTML = PALETTE_ORDER.map((key) => `<button type="button" class="gantt-color-swatch${key === selected ? ' is-selected' : ''}" data-color="${key}" style="--swatch:${PALETTE[key]}" role="radio" aria-checked="${key === selected}" aria-label="${key}"></button>`).join('');
}

function selectedColor() {
  return $('#gantt-color-picker')?.querySelector('.is-selected')?.dataset.color || '';
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
  // Yeni projede boş başlamak, havuzda olmayan oturum sahibinin yanlışlıkla
  // serbest metin sorumlu olarak kaydedilmesini engeller. Eski kayıtlardaki
  // isim ise veri kaybetmeden chip olarak gösterilip korunabilir.
  ownerValue = project?.sorumlu || '';
  renderOwnerPicker();
  hideOwnerSuggestions();
  refreshOwnerPool().catch(() => { ownerPool = []; });
  $('#gantt-priority').value = project?.oncelik || 'normal';
  $('#gantt-progress').value = Number(project?.ilerleme) || 0;
  $('#gantt-progress-value').textContent = `${Number(project?.ilerleme) || 0}%`;
  renderColorPicker(project?.renk || '');
  renderStepEditor(project?.adimlar || {});
  refreshEventOptions(project?.takvimEtkinlikId || '');
  $('#gantt-dialog-title').textContent = project ? 'Projeyi düzenle' : 'Yeni proje';
  $('#gantt-archive').hidden = !project;
  $('#gantt-remove').hidden = !project;
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
    sorumlu: ownerValue,
    oncelik: $('#gantt-priority').value,
    ilerleme: progress,
    adimlar: steps,
    takvimEtkinlikId: $('#gantt-event').value,
    renk: selectedColor(),
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

async function archiveCurrentProject(id = $('#gantt-id').value) {
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

// Arşivle geri alınabilir (arsiv:true); bu kalıcı silme -- calendar.js'teki
// etkinlik silme onayıyla aynı desen (window.confirm + kırmızı buton).
async function deleteCurrentProject(id = $('#gantt-id').value) {
  const project = projects[id];
  if (!id || !project || !canWrite || isReadOnly()) { return; }
  if (!window.confirm(`"${project.ad || 'Bu proje'}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) { return; }
  const updates = {};
  updates[dbPath(`haberProjeleri/${id}`)] = null;
  if (project.takvimEtkinlikId) { updates[dbPath(`etkinlikler/${project.takvimEtkinlikId}/projeId`)] = null; }
  const logPath = dbPath('logs/haberProje');
  const logKey = database.ref(logPath).push().key;
  updates[`${logPath}/${logKey}`] = {
    by: currentUserName || currentUserEmail, email: currentUserEmail,
    action: `${project.ad || 'Haber projesi'} kalıcı olarak silindi`, target: project.ad || '',
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  try {
    await database.ref('/').update(updates);
    closeModal();
    showToast('Proje silindi.', { variant: 'success' });
  } catch (error) {
    console.error('Proje silinemedi:', error);
    setFormError('Proje silinemedi.');
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

let panState = null;

function isPannableTarget(el) {
  return !el.closest('.gantt-bar, .gantt-disclosure, button, input, select, a');
}

// Boş zaman çizelgesi alanını (bar/buton olmayan her yer) tutup sürükleyerek
// haftalar arasında sağa/sola gitme -- fare tekerleği/scrollbar'a ek olarak.
function beginPan(event) {
  if (event.button !== 0 || !isPannableTarget(event.target)) { return; }
  const board = $('#gantt-board');
  panState = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: board.scrollLeft };
  board.setPointerCapture(event.pointerId);
  board.classList.add('is-panning');
}

function movePan(event) {
  if (!panState || event.pointerId !== panState.pointerId) { return; }
  const board = $('#gantt-board');
  board.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startX);
}

function endPan(event) {
  if (!panState || event.pointerId !== panState.pointerId) { return; }
  panState = null;
  $('#gantt-board').classList.remove('is-panning');
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
  $('#gantt-owner-search').addEventListener('focus', (event) => renderOwnerSuggestions(event.target.value));
  $('#gantt-owner-search').addEventListener('input', (event) => renderOwnerSuggestions(event.target.value));
  $('#gantt-owner-picker').addEventListener('click', (event) => {
    const pick = event.target.closest('[data-owner-pick]');
    if (pick) {
      ownerValue = pick.dataset.ownerPick || '';
      renderOwnerPicker();
      hideOwnerSuggestions();
      return;
    }
    if (event.target.closest('[data-owner-remove]')) {
      ownerValue = '';
      renderOwnerPicker();
      requestAnimationFrame(() => $('#gantt-owner-search')?.focus());
    }
  });
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
  $('#gantt-color-picker').addEventListener('click', (event) => {
    const btn = event.target.closest('.gantt-color-swatch');
    if (!btn) { return; }
    const wasSelected = btn.classList.contains('is-selected');
    $('#gantt-color-picker').querySelectorAll('.gantt-color-swatch').forEach((b) => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-checked', 'false');
    });
    // Aynı renge tekrar tıklamak seçimi kaldırır -- durum bazlı otomatik renge döner.
    if (!wasSelected) { btn.classList.add('is-selected'); btn.setAttribute('aria-checked', 'true'); }
  });
  $('#gantt-form').addEventListener('submit', saveProject);
  // NOT: doğrudan archiveCurrentProject/deleteCurrentProject referansı VERME --
  // addEventListener click Event nesnesini ilk argüman olarak geçer, bu da
  // varsayılan `id = $('#gantt-id').value` parametresini geçersiz kılar
  // (varsayılan sadece argüman tam olarak undefined ise devreye girer).
  $('#gantt-archive').addEventListener('click', () => archiveCurrentProject());
  $('#gantt-remove').addEventListener('click', () => deleteCurrentProject());
  document.querySelectorAll('[data-gantt-close]').forEach((button) => button.addEventListener('click', closeModal));
  $('#gantt-board').addEventListener('click', (event) => {
    const menuBtn = event.target.closest('[data-row-menu]');
    if (menuBtn) { openRowMenu(menuBtn); return; }
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
  $('#gantt-board').addEventListener('pointerdown', beginPan);
  $('#gantt-board').addEventListener('pointermove', movePan);
  $('#gantt-board').addEventListener('pointerup', endPan);
  $('#gantt-board').addEventListener('pointercancel', endPan);
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
