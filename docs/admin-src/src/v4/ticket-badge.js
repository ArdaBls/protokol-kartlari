// Konser bileti -- kullanıcının paylaştığı uiverse.io/dexter-st/slippery-bird-76
// "TICKET" kart tasarımının BİREBİR portu -- kullanıcı isteği: "o ticketin aynı
// görünmesini hareket etmesini istiyorum". Holografik parlama (conic-gradient +
// mix-blend-mode katmanları), SVG feTurbulence/feSpecularLighting "bump" doku
// filtresi, kartın "yüzme" (translateY+scale, 3s infinite) animasyonu VE
// holografik arka planın kayan (bg-pos, 3s infinite alternate) animasyonu
// orijinal CSS'ten DEĞİŞTİRİLMEDEN taşındı (bkz. _real-calendar.scss ".cal-ticket"
// bloğu). Sınıf adları site genelindeki .card/.header/.body/.footer gibi ÇOK
// genel adlarla ÇAKIŞMASIN diye "cal-ticket-" öneki eklendi -- bu SADECE isim
// alanı izolasyonu, görsel/davranış birebir aynı kalıyor. İçerik (metinler)
// orijinaldeki "Day pass / May 14th 2026 / Venue.../ Seat E7" yerine etkinlik
// adı/tarihi/yeri ve BİLETİ GÖREN KİŞİNİN (etkinliği oluşturanın DEĞİL) adı+
// rolü ile dolduruluyor -- her kullanıcı kendi adını taşıyan bir bilet görür
// (bkz. concert-ticket-popup.js). Artık Takvim düzenleme modalında DEĞİL,
// Operasyonlar (index.html) sayfasında kullanılıyor.
//
// Kullanıcı bulgusu: orijinal tasarımın header'ı (beyaz + mix-blend-mode)
// ve gövde metni bizim renk şemamızda GÖRÜNMÜYORDU -- tüm metin rengi düz
// siyaha sabitlendi (bkz. _real-calendar.scss ".cal-ticket" bloğu).

function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const TICKET_ROLE_LABEL = { editor: 'Editör', admin: 'Admin', owner: 'Kurucu' };
const TICKET_AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function fmtTicketDate(tarih) {
  if (!tarih) { return ''; }
  const parts = String(tarih).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) { return ''; }
  const [y, m, d] = parts;
  if (m < 1 || m > 12) { return ''; }
  return d + ' ' + TICKET_AYLAR[m - 1] + ' ' + y;
}

// Orijinal HTML iskeleti (uiverse) birebir korunuyor: 3 "notes" dekor katmanı,
// header+sembol, body (3 satır), footer (numara + barkod), sonda bg+holografik
// katman ve SVG bump filtresi. Filtre id'si "cal-ticket-bump" olarak
// isimlendirildi (orijinali "bump") -- sayfadaki başka bir id ile çakışmasın.
export function ticketBadgeHtml({ ad, tarih, saat, yer, kisiAdi, kisiRol }) {
  const rolLabel = TICKET_ROLE_LABEL[kisiRol] || '';
  const dateLabel = fmtTicketDate(tarih) + (saat ? ' · ' + saat : '');
  const personLabel = (kisiAdi ? escapeHtml(kisiAdi) : '') + (rolLabel ? ' (' + escapeHtml(rolLabel) + ')' : '');
  return (
    '<div class="cal-ticket">' +
      '<div class="cal-ticket-notes">♪♪♪♪♪</div>' +
      '<div class="cal-ticket-notes">♪♪♪♪</div>' +
      '<div class="cal-ticket-notes">♪♪♪♪♪</div>' +
      '<div class="cal-ticket-header">BİLET<div class="cal-ticket-symbol">✁</div></div>' +
      '<div class="cal-ticket-body">' +
        '<em data-cal-ticket-name>' + escapeHtml(ad || 'Konser Adı') + '</em><br>' +
        '<span data-cal-ticket-date>' + escapeHtml(dateLabel) + '</span><br>' +
        '<span data-cal-ticket-venue>' + escapeHtml(yer || '') + '</span>' +
      '</div>' +
      '<div class="cal-ticket-footer">' +
        '<div class="cal-ticket-number">Bilet Sahibi <span class="cal-ticket-bold" data-cal-ticket-person>' + personLabel + '</span></div>' +
        '<div class="cal-ticket-barcode"></div>' +
      '</div>' +
      '<div class="cal-ticket-bg cal-ticket-holographic"></div>' +
      '<svg class="cal-ticket-filter-svg">' +
        '<filter id="cal-ticket-bump">' +
          '<feTurbulence result="noise" numOctaves="3" baseFrequency="0.7" type="fractalNoise"></feTurbulence>' +
          '<feSpecularLighting in="noise" result="specular" lighting-color="#fffffc" specularExponent="25" specularConstant="0.8" surfaceScale="0.15">' +
            '<fePointLight z="210" y="100" x="100"></fePointLight>' +
          '</feSpecularLighting>' +
          '<feComposite result="noise2" operator="in" in="specular" in2="SourceGraphic"></feComposite>' +
          '<feBlend mode="screen" in2="noise2" in="SourceGraphic"></feBlend>' +
        '</filter>' +
      '</svg>' +
    '</div>'
  );
}

// Form alanları değiştikçe (Ad/Tarih/Saat/Yer) bileti YENİDEN OLUŞTURMADAN
// (animasyon/odak kaybı olmadan) güncelleyen hafif fonksiyon.
export function updateTicketBadge(container, { ad, tarih, saat, yer }) {
  if (!container) { return; }
  const nameEl = container.querySelector('[data-cal-ticket-name]');
  if (nameEl) { nameEl.textContent = ad || 'Konser Adı'; }
  const dateEl = container.querySelector('[data-cal-ticket-date]');
  if (dateEl) { dateEl.textContent = fmtTicketDate(tarih) + (saat ? ' · ' + saat : ''); }
  const venueEl = container.querySelector('[data-cal-ticket-venue]');
  if (venueEl) { venueEl.textContent = yer || ''; }
}
