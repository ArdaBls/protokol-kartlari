// Admin paneli — giriş noktası
// Self-contained dashboard skin. Loads only the v4 design system.

import './scss/v4/main.scss';
import { mountShell } from './v4/shell.js';
import { initCharts, initPhotoCounter, initProtocolCounter } from './v4/charts.js';
import { initTables } from './v4/tables.js';
import { openMenu, DEFAULT_CARD_MENU } from './v4/menus.js';
import { initCommandPalette } from './v4/command-palette.js';
import { initPageActions } from './v4/page-actions.js';

mountShell();
initCharts();
initPhotoCounter();
initProtocolCounter();
initTables();
initCommandPalette();
initPageActions();

// Service worker — only in production builds (skip on dev so HMR isn't fought
// by the cache). Single site-wide SW now (protokol.html shares this same
// registration/scope) — see admin-src/public/sw.js's header comment.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swPath = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swPath).catch(() => { /* ignore */ });

    // ESKİ/ÖLÜ service worker kayıtlarını temizle.
    //
    // Site bir zamanlar /admin/ önekiyle yayınlanıyordu ve o dönemden kalma
    // "/admin/sw.js" kaydı hâlâ bazı tarayıcılarda AKTİF duruyor (kullanıcının
    // tarayıcısında iki kayıt görüldü: "/" ve "/admin/"). O script artık
    // sunucuda YOK (404) ve kendi önbelleğinden bayat sayfa servis edebilir --
    // tuhaf, açıklaması zor davranışların (eski sürümün geri gelmesi gibi)
    // kaynağı olabilir. Kapsamı bu sayfanın kökü OLMAYAN her kaydı kaldırıyoruz;
    // güncel kayıt (BASE_URL kapsamı) dokunulmadan kalır.
    navigator.serviceWorker.getRegistrations().then((kayitlar) => {
      const guncelKapsam = new URL(swPath, location.href).href.replace(/sw\.js$/, '');
      kayitlar.forEach((kayit) => {
        if (kayit.scope !== guncelKapsam) {
          kayit.unregister().catch(() => { /* ignore */ });
        }
      });
    }).catch(() => { /* ignore */ });
  });
}

// Lazy-load page-specific modules only when their host element is on the page.
// (calendar.js is self-loaded from takvim.html's own inline module script,
// same pattern as yapilacaklar.html — it needs the Firebase compat scripts to be
// present first, which only that page's <head> loads.)
if (document.querySelector('.settings-content')) {
  import('./v4/settings.js').then((m) => m.initSettings());
}
if (document.querySelector('[data-date-range], [data-rich-text], [data-multi-select]')) {
  import('./v4/form-controls.js').then((m) => m.initFormControls());
}
if (document.querySelector('[data-task-list]')) {
  import('./v4/tasks-widget.js').then((m) => m.initTasksWidget());
}
if (document.querySelector('[data-countdown-value]')) {
  import('./v4/countdown.js').then((m) => m.initCountdown());
}

// ────────────────────────
//  Delegated interactions
// ────────────────────────

// Toggle switches
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.toggle');
  if (toggle) {toggle.classList.toggle('on');}
});

// Todo checkboxes — toggle .done on the cb + row, then refresh any
// `[data-todo-counter]` element inside the parent card so the "X of Y
// remaining" subtitle stays in sync with the actual checkboxes.
document.addEventListener('click', (e) => {
  const cb = e.target.closest('.todo-cb');
  if (!cb) {return;}
  cb.classList.toggle('done');
  const row = cb.closest('.todo-row');
  if (row) {row.classList.toggle('done');}
  // Update counter text within the same card.
  const card = cb.closest('.card');
  if (!card) {return;}
  const counter = card.querySelector('[data-todo-counter]');
  if (!counter) {return;}
  const all = card.querySelectorAll('.todo-row');
  const done = card.querySelectorAll('.todo-row.done');
  const remaining = all.length - done.length;
  // Format: "<remaining> of <total> remaining" — matches existing copy.
  counter.textContent = `${remaining} of ${all.length} remaining`;
});

// Tab groups: works for any container of .chart-tab buttons (chart cards,
// calendar view switcher, generic tab strips). Adds .active to the clicked
// tab and removes it from siblings in the same parent.
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.chart-tab');
  if (!tab) {return;}
  tab.parentElement.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
});

// Button groups with [data-group]: radio-style single-select. Click sets
// .active on the clicked button and clears its siblings in the same group.
// Opt-in via data-group so plain action button groups are unaffected.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-group[data-group] > .btn');
  if (!btn) {return;}
  btn.parentElement.querySelectorAll('.btn').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
});

// Card option buttons → popover menu.
// Calendar nav buttons (prev/next month) are also .card-opt-btn but live
// inside .calendar-toolbar; calendar.js stops propagation on those clicks
// so they never reach this handler.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-opt-btn');
  if (!btn) {return;}
  // Tasks kartındaki "+" (yeni görev) butonu da görsel tutarlılık için
  // .card-opt-btn stilini kullanıyor, ama kendi tıklama işleyicisi var
  // (bkz. tasks-widget.js) -- bu genel dropdown menüsüne düşmemeli, aksi
  // halde İngilizce "Refresh/Edit/Duplicate" menüsü açılırdı.
  if (btn.hasAttribute('data-task-add')) {return;}
  // Skip if the click was already handled (e.g. calendar prev/next).
  if (e.defaultPrevented) {return;}
  e.preventDefault();
  openMenu(btn, DEFAULT_CARD_MENU);
});

// Editör Aktivitesi kartındaki "%" düğmesi: aylık çizgi grafiği ↔ Kişilere
// Göre Etkinlik Payı donut'u arasında geçiş yapar (bkz. index.html'deki
// [data-chart-view] konteynerleri). Donut, display:none iken 0x0 boyutla
// mount olduğu için görünür olduğunda ECharts'a "resize" event'i üzerinden
// (bkz. charts.js'teki mounted-chart resize dinleyicisi) yeniden ölç
// tetiklenir -- ayrı bir API'ye ihtiyaç duymadan mevcut mekanizma tekrar
// kullanılıyor.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-chart-view-toggle]');
  if (!btn) {return;}
  const card = btn.closest('.card');
  if (!card) {return;}
  const lineView = card.querySelector('[data-chart-view="line"]');
  const shareView = card.querySelector('[data-chart-view="share"]');
  const subtitle = card.querySelector('[data-editor-activity-subtitle]');
  if (!lineView || !shareView) {return;}
  const showingShare = shareView.style.display !== 'none';
  lineView.style.display = showingShare ? '' : 'none';
  shareView.style.display = showingShare ? 'none' : '';
  btn.classList.toggle('active', !showingShare);
  if (subtitle) {
    subtitle.textContent = showingShare
      ? 'Basın görevlisi olarak atandıkları etkinlik sayısı, aylık · Ocak – Aralık'
      : 'Basın görevlisi olarak atandıkları toplam etkinlik payı';
  }
  window.dispatchEvent(new Event('resize'));
});

// Chip dismiss (× icon) and chip toggle.
document.addEventListener('click', (e) => {
  const closer = e.target.closest('.chip-close');
  if (closer) {
    const chip = closer.closest('.chip');
    if (chip) {
      chip.style.transition = 'opacity 150ms, transform 150ms';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.85)';
      setTimeout(() => chip.remove(), 160);
    }
    return;
  }
  const chip = e.target.closest('.chip');
  if (chip) {chip.classList.toggle('active');}
});

// Form submit — let HTML5 validation run, then fake-submit on valid forms.
// Lazy-imports the toast helper so the dependency stays out of the entry chunk.
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) {return;}
  // Native :invalid forms still get the browser's validation UI before we
  // see the submit event, so reaching here means the form is already valid.
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
  const label = (submitBtn?.textContent || submitBtn?.value || 'Saved').trim();
  import('./v4/toast.js').then(({ showToast }) => showToast(`${label} ✓`, { variant: 'success' }));
  if (form.dataset.resetOnSubmit !== 'false') {form.reset();}
});

// Topbar search box opens the command palette — wired by initCommandPalette.
// Page-actions (Print / Export / Compose / Add / etc.) wired via initPageActions.
