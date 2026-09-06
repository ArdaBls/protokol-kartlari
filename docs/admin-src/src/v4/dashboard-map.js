// Operasyonlar (Dashboard) sayfası — küçük, ETKİLEŞİMSİZ harita önizlemesi.
//
// NEDEN: Kullanıcı isteği "harita.html'deki gibi ama küçük ve dokununca Takvim'e
// götürsün" -- ayrı, tam harita.js/harita.html'e (aynı Leaflet kurulumu, aynı
// UNIT_COORDS) HİÇ dokunmadan, burada KENDİ küçük/salt-görsel kopyasını kuruyoruz.
// Ana haritadaki gibi fakülte/protokol noktalarını (renk skalasıyla) gösterir ama
// pan/zoom/tıklama YOK -- dragging/zoomControl/scrollWheelZoom vb. hepsi kapalı
// (bkz. aşağıdaki L.map seçenekleri) ve üzerine .dash-map-surface * { pointer-events:none }
// (bkz. _dashboard.scss) eklenerek marker popup'ları da açılamaz hale getirildi.
//
// Tıklanınca (kart NEREDE tıklanırsa tıklansın, harita/overlay farketmez)
// /takvim.html'e yönlendirir.

import { UNIT_COORDS } from './unit-coords.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDOfhq3aYW6sg2_zj0sFsRzXeGziGtLxCk',
  authDomain: 'omu-protokol.firebaseapp.com',
  databaseURL: 'https://omu-protokol-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'omu-protokol'
};

// Ana haritadaki (harita.html) renk skalasıyla AYNI mantık: sayı arttıkça
// açık amberden koyu kırmızıya kayar. Burada "bu yıl en yoğun birimler"
// hesaplaması yapılmıyor -- teaser sadece TÜM koordinatlı birimleri sabit,
// nötr bir tonda gösteriyor (tam liste ana harita sayfasında).
const MARKER_COLOR = '#f97316';

function goToCalendar() {
  window.location.href = '/takvim.html';
}

export function initDashboardMap() {
  const card = document.querySelector('[data-dash-map-card]');
  const mapEl = document.querySelector('[data-dash-map]');
  if (!card || !mapEl) { return; }

  card.addEventListener('click', goToCalendar);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToCalendar(); }
  });

  if (window.firebase && !firebase.apps.length) {
    try { firebase.initializeApp(FIREBASE_CONFIG); } catch (err) { /* zaten başka bir modül initialize etmiş olabilir */ }
  }

  import('leaflet').then(({ default: L }) => {
    // Kart henüz gerçek boyutuna oturmamışsa (harita.html'deki AYNI Leaflet
    // sorunu -- bkz. o dosyadaki waitForRealSize yorumunun aynısı) haritayı
    // hemen kurmuyoruz, birkaç kare bekliyoruz.
    waitForRealSize(mapEl, () => {
      const map = L.map(mapEl, {
        dragging: false,
        zoomControl: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: false,
        fadeAnimation: false
      }).setView([41.3641, 36.1946], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

      Object.values(UNIT_COORDS).forEach((coords) => {
        L.circleMarker(coords, {
          radius: 8,
          color: MARKER_COLOR,
          fillColor: MARKER_COLOR,
          fillOpacity: 0.7,
          weight: 1.5,
          interactive: false
        }).addTo(map);
      });

      requestAnimationFrame(() => map.invalidateSize());
      setTimeout(() => map.invalidateSize(), 250);
      new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
    });
  }).catch((err) => {
    console.error('Dashboard harita önizlemesi yüklenemedi:', err);
  });
}

function waitForRealSize(el, cb, tries) {
  tries = tries || 0;
  if (el.clientHeight > 40 || tries > 40) { cb(); return; }
  requestAnimationFrame(() => waitForRealSize(el, cb, tries + 1));
}
