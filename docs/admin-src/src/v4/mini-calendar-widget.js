// Grafikler ve mini takvim aynı abonelikten beslenir; Test Modu birlikte değişir.
import { subscribeSharedActivityData } from './charts.js';
import { escapeHtml } from './markup.js';

const AYLAR_KISA = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];

function dKeyToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function hmToMin(s) {
  const a = String(s || '').split(':');
  if (a.length < 2) { return null; }
  const h = Number(a[0]), m = Number(a[1]);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}

// Kullanıcı isteği: "etkinlik şimdiyse yanıp sönen bir yeşil işaret koyalım" --
// bugünün tarih aralığına düşen (tek günlük veya çok günlü) bir etkinlik: saatsizse
// (tüm gün) bugün olması yeterli, saatliyse şu anki saat başlangıç-bitiş arasında mı
// diye de bakılır (calendar.js'teki tam hassasiyet gerekmiyor, küçük bir widget bu).
function isHappeningNow(e) {
  const today = dKeyToday();
  const start = e.tarih, end = e.bitisTarihi || e.tarih;
  if (today < start || today > end) { return false; }
  if (!e.saat) { return true; }
  if (start !== end) { return true; } // çok günlü + saatli: gün aralığında olmak yeterli
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = hmToMin(e.saat);
  if (startMin === null) { return true; }
  const endMin = hmToMin(e.bitisSaat) ?? (startMin + 60);
  return endMin > startMin ? (nowMin >= startMin && nowMin < endMin) : nowMin >= startMin;
}

function renderList(listEl, events) {
  const today = dKeyToday();
  // Bugün ve sonrası, tarihe göre artan, ilk 5 kayıt -- widget kompakt kalsın.
  const upcoming = Object.entries(events || {})
    .map(([id, e]) => (e && typeof e === 'object' ? Object.assign({ _id: id }, e) : null))
    .filter((e) => e && e.tarih && e.tarih >= today)
    .sort((a, b) => (a.tarih === b.tarih ? (a.saat || '').localeCompare(b.saat || '') : a.tarih.localeCompare(b.tarih)))
    .slice(0, 5);

  if (!upcoming.length) {
    listEl.innerHTML = '<p class="hint" style="margin:12px 0;color:var(--text-muted);font-size:12.5px">Yaklaşan etkinlik yok.</p>';
    return;
  }

  listEl.innerHTML = upcoming.map((e) => {
    const [, m, d] = (e.tarih || '').split('-');
    const ay = AYLAR_KISA[parseInt(m, 10) - 1] || '';
    const metaParts = [];
    if (e.saat) { metaParts.push(e.saat); }
    if (e.yer) { metaParts.push(e.yer); }
    else if (e.birim) { metaParts.push(e.birim); }
    // Kullanıcı isteği: "etkinlik şimdiyse yanıp sönen bir yeşil işaret", düzenle
    // butonunun SOLUNDA -- düzenle /takvim.html?duzenle=<id>'ye götürür (bkz.
    // calendar.js'teki maybeOpenDeepLinkedEvent), o sayfada düzenleme modalını açar.
    const liveDot = isHappeningNow(e) ? '<span class="mini-cal-live" title="Şu an devam ediyor" aria-label="Şu an devam ediyor"></span>' : '';
    return `
      <div class="mini-cal-item">
        <div class="mini-cal-date"><span class="d">${escapeHtml(d || '?')}</span><span class="m">${escapeHtml(ay)}</span></div>
        <div class="mini-cal-info">
          <div class="mini-cal-title">${escapeHtml(e.ad || '(adsız)')}</div>
          <div class="mini-cal-meta">${escapeHtml(metaParts.join(' · '))}</div>
        </div>
        ${liveDot}
        <a class="mini-cal-edit" href="/takvim.html?duzenle=${encodeURIComponent(e._id)}" title="Düzenle" aria-label="Düzenle">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2l2.5 2.5-7 7-3 .5.5-3 7-7z"/></svg>
        </a>
      </div>
    `;
  }).join('');
}

export function initMiniCalendarWidget() {
  const listEl = document.querySelector('[data-mini-calendar-list]');
  if (!listEl || listEl.dataset.subscribed) { return; }
  listEl.dataset.subscribed = 'true';
  subscribeSharedActivityData((_users, events) => {
    if (events !== null) { renderList(listEl, events); }
  });
}
