// Operasyonlar (index.html) sayfasındaki "Etkinlik Özeti" kartı -- Bugün/Şimdiki,
// Bu Hafta, Yaklaşan etkinlik listeleri. Kullanıcı isteği: bu bölümler Takvim
// sayfasından kaldırılıp buraya, Editör Aktivitesi'nin sağına taşındı; eski
// "Takvim Görünümü" mini takvim kartının (mini-calendar-widget.js) yerini alır.
//
// Sınıflandırma mantığı event-overview.js'te (saf fonksiyonlar); burası sadece
// Firebase verisini charts.js'in PAYLAŞILAN aboneliğinden alır (mini-calendar-
// widget.js'in de yaptığı gibi -- ayrı bir dinleyici AÇMAZ) ve render eder.
// Kartlara tıklayınca /takvim.html?duzenle=<id>'ye gider -- calendar.js'teki
// maybeOpenDeepLinkedEvent bu deep-link'i zaten işliyor (mini-calendar-widget.js
// ile AYNI mekanizma), ayrı bir düzenleme modalı burada YOK.
import { subscribeSharedActivityData } from './charts.js';
import { escapeHtml } from './markup.js';
import { getEventStartDate, getEventEndDate, getCalendarOverviewBuckets } from './event-overview.js';

const AYLAR_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function isSameDay(a, b) { return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function todayDate() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function overviewOngoing(e, now) {
  const s = getEventStartDate(e), en = getEventEndDate(e);
  return !!(s && en && s.getTime() <= now.getTime() && en.getTime() >= now.getTime());
}
function fmtTrDate(d) { return d.getDate() + ' ' + AYLAR_KISA[d.getMonth()]; }
function fmtDateLabel(e) {
  const s = getEventStartDate(e), en = getEventEndDate(e);
  const isMultiDay = !!e.bitisTarihi && e.bitisTarihi !== e.tarih;
  if (isMultiDay && s && en) { return fmtTrDate(s) + '–' + fmtTrDate(en); }
  const base = s ? fmtTrDate(s) : (e.tarih || '');
  return e.saat ? base + ' · ' + e.saat + (e.bitisSaat ? '–' + e.bitisSaat : '') : base;
}

function overviewCardHtml(e, now) {
  const ongoing = overviewOngoing(e, now);
  const isToday = isSameDay(getEventStartDate(e), todayDate());
  // Yalnızca renkle anlam verilmiyor -- "Şu anda"/"Bugün" METİN rozeti de var.
  const badge = ongoing ? '<span class="overview-badge overview-badge--now">Şu anda</span>'
    : (isToday ? '<span class="overview-badge overview-badge--today">Bugün</span>' : '');
  const meta = [fmtDateLabel(e)];
  if (e.yer) { meta.push(escapeHtml(e.yer)); }
  else if (e.birim) { meta.push(escapeHtml(e.birim)); }
  return `<a class="overview-card${ongoing ? ' is-ongoing' : ''}" href="/takvim.html?duzenle=${encodeURIComponent(e._id)}">
    <span class="overview-main">
      <span class="overview-title">${escapeHtml(e.ad || '(adsız)')}</span>
      <span class="overview-meta">${meta.join(' · ')}</span>
    </span>
    ${badge}
  </a>`;
}

function renderList(containerId, items, emptyText) {
  const el = document.querySelector(`[data-overview-list="${containerId}"]`);
  if (!el) { return; }
  const now = new Date();
  el.innerHTML = items.length ? items.map((e) => overviewCardHtml(e, now)).join('') : `<p class="overview-empty">${emptyText}</p>`;
}

let lastEvents = null;
function renderAll() {
  if (lastEvents === null) { return; }
  const buckets = getCalendarOverviewBuckets(lastEvents, new Date());
  renderList('today', buckets.today, 'Bugün için planlanmış veya devam eden bir etkinlik yok.');
  renderList('week', buckets.week, 'Bu hafta başka etkinlik yok.');
  renderList('upcoming', buckets.upcoming, 'Önümüzdeki 30 günde başka etkinlik yok.');
}

export function initOperationsOverviewWidget() {
  const root = document.querySelector('[data-operations-overview]');
  if (!root || root.dataset.subscribed) { return; }
  root.dataset.subscribed = 'true';
  subscribeSharedActivityData((_users, events) => {
    if (events !== null) { lastEvents = events; renderAll(); }
  });
  // Etkinliğin zamanı Firebase'de hiçbir alan değişmeden dolabilir (ör. "Şu anda"
  // bir "Bugün"e, "Bugün" bir "Yaklaşan"a dönüşebilir) -- dakikada bir aynı
  // (değişmemiş) veriyle yeniden sınıflandırılır (bkz. charts.js'teki AYNI desen).
  const refreshTimer = setInterval(renderAll, 60000);
  if (refreshTimer && typeof refreshTimer.unref === 'function') { refreshTimer.unref(); }
}
