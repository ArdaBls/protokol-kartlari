// Etkinlik özeti sınıflandırma mantığı -- Bugün/Şimdiki, Bu hafta, Yaklaşan.
//
// Kullanıcı isteği: bu bölümler Takvim sayfasından kaldırılıp Operasyonlar
// (index.html) sayfasına, Editör Aktivitesi'nin sağına taşındı (eski "Takvim
// Görünümü" mini takvim kartının yerine). Saf sınıflandırma mantığı burada
// tutulur (operations-overview-widget.js'in tek tüketicisi); calendar.js
// artık bu fonksiyonları KULLANMIYOR, kasıtlı olarak buraya taşındı ki
// index.html'in bundle'ı takvim.html'in ağır sürükle-bırak/ızgara kodunu
// (sortablejs dahil) içe aktarmasın.
//
// parseKey/hmToMin/addDays/startOfWeek: calendar.js/charts.js'teki AYNI
// mantığın kasıtlı kopyası (bkz. roster.js'teki proje kuralı notu -- küçük
// yardımcılar dosyalar arası paylaşılmaz).
function parseKey(s) {
  const a = String(s || '').split('-');
  if (a.length !== 3) { return null; }
  const y = Number(a[0]), m = Number(a[1]), day = Number(a[2]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(day)) { return null; }
  const d = new Date(y, m - 1, day);
  if (isNaN(d.getTime())) { return null; }
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) { return null; }
  return d;
}
function hmToMin(s) { const a = String(s || '').split(':'); if (a.length < 2) { return null; } const h = Number(a[0]), m = Number(a[1]); if (isNaN(h) || isNaN(m)) { return null; } if (h < 0 || h > 23 || m < 0 || m > 59) { return null; } return h * 60 + m; }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }

// getEventStartDate/getEventEndDate: TAM an (tarih+saat), sadece tarih değil
// -- "şu anda devam ediyor mu" ve hafta/30 gün aralık kesişimi hesapları için
// gerekli. charts.js'teki hasEventEnded ile AYNI bitiş kuralları (kasıtlı kod
// tekrarı, bkz. dosya başındaki not): saatsiz -> günün sonu, bitisSaat yoksa
// başlangıç+60dk, bitisSaat <= başlangıçsa gece yarısını aşan etkinlik.
export function getEventStartDate(event) {
  const start = parseKey(event && event.tarih);
  if (!start) { return null; }
  const startMin = hmToMin(event.saat);
  if (startMin === null) { return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0); }
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, startMin, 0, 0);
}
export function getEventEndDate(event) {
  if (!event) { return null; }
  const start = parseKey(event.tarih);
  if (!start) { return null; }
  const isMultiDay = !!event.bitisTarihi && event.bitisTarihi !== event.tarih;
  if (isMultiDay) {
    const end = parseKey(event.bitisTarihi) || start;
    return new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  }
  const startMin = hmToMin(event.saat);
  if (startMin === null) { return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999); }
  let endMin = hmToMin(event.bitisSaat);
  if (endMin === null) { endMin = startMin + 60; } else if (endMin <= startMin) { endMin += 24 * 60; }
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, endMin, 0, 0);
}
// [rangeStart, rangeEnd] KAPSAYICI (inclusive) aralıkla kesişim -- çok günlü
// bir etkinlik bitiş tarihiyle DEĞİL, aralıkla KESİŞMESİNE göre sınıflandırılır
// (kullanıcı isteği: "sadece başlangıç tarihine göre değil, ilgili tarih
// aralığıyla kesişmesine göre sınıflandır").
export function eventOverlapsRange(event, rangeStart, rangeEnd) {
  const s = getEventStartDate(event);
  const e = getEventEndDate(event);
  if (!s || !e || !rangeStart || !rangeEnd) { return false; }
  return s.getTime() <= rangeEnd.getTime() && e.getTime() >= rangeStart.getTime();
}
function overviewOngoing(event, now) {
  const s = getEventStartDate(event), e = getEventEndDate(event);
  return !!(s && e && s.getTime() <= now.getTime() && e.getTime() >= now.getTime());
}
function overviewSort(now) {
  return (a, b) => {
    const aOngoing = overviewOngoing(a, now), bOngoing = overviewOngoing(b, now);
    if (aOngoing !== bOngoing) { return aOngoing ? -1 : 1; }
    const sa = getEventStartDate(a)?.getTime() ?? 0, sb = getEventStartDate(b)?.getTime() ?? 0;
    if (sa !== sb) { return sa - sb; }
    return String(a.ad || '').localeCompare(String(b.ad || ''), 'tr');
  };
}
// Sınıflandırma (kullanıcı isteği): Şu anda (başlangıç<=now<=bitiş) + Bugün
// (bugünle kesişen DİĞERLERİ) TEK "today" listesinde (devam edenler önce);
// Bu hafta (Pzt-Paz, today'de olmayanlar); Yaklaşan (hafta sonundan sonraki
// 30 gün). Aynı etkinlik birden fazla kovaya girmez (seen Set). İptal/arşiv
// varsayılan listelere alınmaz.
export function getCalendarOverviewBuckets(events, now) {
  const list = Object.keys(events || {}).map((id) => {
    const e = events[id];
    return (e && typeof e === 'object') ? Object.assign({}, e, { _id: id }) : null;
  }).filter((e) => e && e.durum !== 'iptal' && e.arsiv !== true && e.tarih);

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const weekStartDay = startOfWeek(now);
  const weekEndDay = addDays(weekStartDay, 6);
  // Kullanıcı isteği: "Bu hafta" bugünden ÖNCEKİ (haftanın geçmiş/bitmiş) günlerini
  // göstermesin -- pazartesiden değil, bugünün BİTİMİNDEN (dayEnd+1ms) başlar. Bugünün
  // kendisi zaten "today" kovasında (yukarıda), böylece hiçbir gün iki kovada birden
  // görünmez ve geçmiş günler bu kovaya hiç girmez.
  const weekStart = new Date(dayEnd.getTime() + 1);
  const weekEnd = new Date(weekEndDay.getFullYear(), weekEndDay.getMonth(), weekEndDay.getDate(), 23, 59, 59, 999);
  const upcomingStart = new Date(weekEnd.getTime() + 1);
  const upcomingEnd = addDays(weekEndDay, 30);
  upcomingEnd.setHours(23, 59, 59, 999);

  const nowList = [], todayList = [], weekList = [], upcomingList = [];
  const seen = new Set();
  list.forEach((e) => {
    if (overviewOngoing(e, now)) { nowList.push(e); seen.add(e._id); }
  });
  list.forEach((e) => {
    if (!seen.has(e._id) && eventOverlapsRange(e, dayStart, dayEnd)) { todayList.push(e); seen.add(e._id); }
  });
  list.forEach((e) => {
    if (!seen.has(e._id) && eventOverlapsRange(e, weekStart, weekEnd)) { weekList.push(e); seen.add(e._id); }
  });
  list.forEach((e) => {
    if (!seen.has(e._id) && eventOverlapsRange(e, upcomingStart, upcomingEnd)) { upcomingList.push(e); seen.add(e._id); }
  });
  const sortFn = overviewSort(now);
  return {
    today: nowList.concat(todayList).sort(sortFn),
    week: weekList.sort(sortFn),
    upcoming: upcomingList.sort(sortFn)
  };
}
