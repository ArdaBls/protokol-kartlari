// Operasyonlar (Dashboard) sayfası — "Takvim Görünümü" mini widget'ı.
//
// Kompakt bir yaklaşan-etkinlikler listesi (calendar.js'teki tam Takvim sayfasının
// küçük bir özeti). "Görevler" kartıyla (tasks-widget.js) AYNI desen: kendi Firebase
// bağlantısını açar, `database.ref(dbPath('etkinlikler')).on('value', ...)` ile
// SÜREKLİ AÇIK bir dinleyici kurar -- takvim sayfasında bir etkinlik eklenip/
// silinip/güncellendiğinde bu widget SAYFA YENİLENMEDEN anında güncellenir
// (Realtime Database'in doğası: aynı düğüme yazılan her değişiklik açık TÜM
// .on('value') dinleyicilerine push edilir). calendar.js'e HİÇ dokunulmadı.
//
// db-mode.js (dbPath/isReadOnly/initDbMode) calendar.js'teki İLE AYNI şekilde
// kullanılıyor ki Test Modu açıkken bu widget da doğru dalı (test/etkinlikler) okusun.

import { dbPath, initDbMode, onDbModeChange } from './db-mode.js';
import { escapeHtml } from './markup.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

const AYLAR_KISA = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];

function dKeyToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderList(listEl, events) {
  const today = dKeyToday();
  // Bugün ve sonrası, tarihe göre artan, ilk 5 kayıt -- widget kompakt kalsın.
  const upcoming = Object.values(events || {})
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
    return `
      <div class="mini-cal-item">
        <div class="mini-cal-date"><span class="d">${escapeHtml(d || '?')}</span><span class="m">${escapeHtml(ay)}</span></div>
        <div class="mini-cal-info">
          <div class="mini-cal-title">${escapeHtml(e.ad || '(adsız)')}</div>
          <div class="mini-cal-meta">${escapeHtml(metaParts.join(' · '))}</div>
        </div>
      </div>
    `;
  }).join('');
}

export function initMiniCalendarWidget() {
  const listEl = document.querySelector('[data-mini-calendar-list]');
  if (!listEl) { return; }

  if (!window.firebase) { return; }
  if (!firebase.apps.length) { firebase.initializeApp(FIREBASE_CONFIG); }
  const database = firebase.database();

  let ref = null;
  function attachListener() {
    if (ref) { ref.off(); }
    ref = database.ref(dbPath('etkinlikler'));
    ref.on('value', (snap) => {
      renderList(listEl, snap.val() || {});
    }, (err) => {
      console.error('Mini takvim widget\'ı için etkinlikler okunamadı:', err);
      listEl.innerHTML = '<p class="hint" style="margin:12px 0;color:var(--text-muted);font-size:12.5px">Yüklenemedi.</p>';
    });
  }

  // calendar.js'teki (initCalendar) AYNI desen: ilk değerler gelene kadar bekle, sonra
  // mod CANLI değişirse (başka bir admin ayarlar.html'den değiştirirse) yeniden bağlan --
  // açık bir .on() dinleyicisi yol değişince kendiliğinden yeni dala geçmez.
  initDbMode(database).then(attachListener);
  onDbModeChange(attachListener);
}
