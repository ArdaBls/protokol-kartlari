// Takvim düzenleme modalında Tür "Konser" seçilince formun yanında gösterilen
// bilet önizlemesi. Kullanıcının paylaştığı uiverse.io/dexter-st/slippery-bird-76
// "TICKET" kart tasarımından uyarlandı -- perfore/çentikli bilet SİLUETİ (üst/alt
// dalgalı kenar + yan çentikler + kesik-çizgi ayracı, hepsi CSS mask ile) birebir
// taşındı; orijinaldeki holografik parlama animasyonu + SVG bump/turbulence
// filtresi admin panelinin sade tasarım diliyle uyuşmadığı için ÇIKARILDI, yerine
// "Konser" türünün kendi rengi (calendar.js EVENT_TYPES) kullanıldı.
//
// Kullanıcı isteği: bilet etkinlik adını (konser adı) taşısın, üzerinde o an
// oturum açmış kişinin adı ve rolü (editör/admin/kurucu) yazsın.

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

export function ticketBadgeHtml({ ad, tarih, saat, yer, kisiAdi, kisiRol }) {
  const rolLabel = TICKET_ROLE_LABEL[kisiRol] || '';
  const dateLabel = fmtTicketDate(tarih) + (saat ? ' · ' + saat : '');
  return (
    '<div class="cal-ticket">' +
      '<div class="cal-ticket-bg"></div>' +
      '<div class="cal-ticket-header">BİLET<span class="cal-ticket-scissors">✁</span></div>' +
      '<div class="cal-ticket-body">' +
        '<div class="cal-ticket-name" data-cal-ticket-name>' + escapeHtml(ad || 'Konser Adı') + '</div>' +
        '<div class="cal-ticket-date" data-cal-ticket-date>' + escapeHtml(dateLabel) + '</div>' +
        '<div class="cal-ticket-venue" data-cal-ticket-venue>' + escapeHtml(yer || '') + '</div>' +
      '</div>' +
      '<div class="cal-ticket-footer">' +
        '<div class="cal-ticket-person">' +
          '<span data-cal-ticket-person>' + escapeHtml(kisiAdi || '') + '</span>' +
          (rolLabel ? ' <span class="cal-ticket-role" data-cal-ticket-role>' + escapeHtml(rolLabel) + '</span>' : '') +
        '</div>' +
        '<div class="cal-ticket-barcode" aria-hidden="true"></div>' +
      '</div>' +
    '</div>'
  );
}

// Form alanları değiştikçe (Ad/Tarih/Saat/Yer) bileti YENİDEN OLUŞTURMADAN
// (odak/animasyon kaybı olmadan) güncelleyen hafif fonksiyon.
export function updateTicketBadge(container, { ad, tarih, saat, yer }) {
  if (!container) { return; }
  const nameEl = container.querySelector('[data-cal-ticket-name]');
  if (nameEl) { nameEl.textContent = ad || 'Konser Adı'; }
  const dateEl = container.querySelector('[data-cal-ticket-date]');
  if (dateEl) { dateEl.textContent = fmtTicketDate(tarih) + (saat ? ' · ' + saat : ''); }
  const venueEl = container.querySelector('[data-cal-ticket-venue]');
  if (venueEl) { venueEl.textContent = yer || ''; }
}
