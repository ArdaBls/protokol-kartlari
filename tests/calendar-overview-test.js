// Takvim sayfası etkinlik özeti (Bugün/Bu hafta/Yaklaşan) ve istatistik
// uygunluk kuralı (hasEventEnded) testi.
//
// mini-calendar-widget-test.js'teki teknik izlenir: kaynak dosyadaki import/
// export ifadeleri metinden çıkarılır, kalan saf fonksiyon tanımları
// new Function(...) ile çalıştırılıp ihtiyaç duyulan isimler dışa aktarılır.
// Bu, calendar.js/charts.js'in üst düzeyde DOM/Firebase'e dokunmayan (yalnızca
// fonksiyon gövdelerinde) yapısına dayanır (bkz. dosyaların kendi üst-seviye
// yan etkisi olmadığını doğrulayan grep sonucu).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function loadPureModule(relativePath, exportNames) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '');
  return new Function(source + '\nreturn { ' + exportNames.join(', ') + ' };')();
}

const { getEventStartDate, getEventEndDate, eventOverlapsRange, getCalendarOverviewBuckets } =
  loadPureModule('docs/admin-src/src/v4/calendar.js', [
    'getEventStartDate', 'getEventEndDate', 'eventOverlapsRange', 'getCalendarOverviewBuckets'
  ]);
const { hasEventEnded } = loadPureModule('docs/admin-src/src/v4/charts.js', ['hasEventEnded']);

// ── hasEventEnded (Bölüm 2: istatistiğe erken ekleme hatası) ──────────────

// Tek günlük, saatli: bitisSaat varsa tam o an biter.
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '10:00', bitisSaat: '11:00' }, new Date(2026, 0, 10, 10, 59)), false, 'bitmeden önce sayılmamalı');
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '10:00', bitisSaat: '11:00' }, new Date(2026, 0, 10, 11, 0)), true, 'tam bitiş anında bitmiş sayılmalı');

// bitisSaat yoksa: başlangıç + 60 dk.
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '10:00' }, new Date(2026, 0, 10, 10, 59)), false, 'varsayılan 60 dk dolmadan bitmemeli');
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '10:00' }, new Date(2026, 0, 10, 11, 0)), true, 'varsayılan 60 dk dolunca bitmeli');

// Hiç saat yoksa: günün sonu.
assert.equal(hasEventEnded({ tarih: '2026-01-10' }, new Date(2026, 0, 10, 23, 0)), false, 'saatsiz etkinlik gün bitmeden bitmiş sayılmamalı');
assert.equal(hasEventEnded({ tarih: '2026-01-10' }, new Date(2026, 0, 11, 0, 0)), true, 'saatsiz etkinlik ertesi gün bitmiş sayılmalı');

// Çok günlü: bitisTarihi gününün sonu.
assert.equal(hasEventEnded({ tarih: '2026-01-10', bitisTarihi: '2026-01-12', saat: '09:00' }, new Date(2026, 0, 11, 10, 0)), false, 'çok günlü etkinlik aradaki günde bitmiş sayılmamalı');
assert.equal(hasEventEnded({ tarih: '2026-01-10', bitisTarihi: '2026-01-12' }, new Date(2026, 0, 13, 0, 0)), true, 'çok günlü etkinlik son günden sonra bitmiş sayılmalı');

// Gece yarısını aşan: bitisSaat <= başlangıç saati => ertesi güne taşınır.
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '22:00', bitisSaat: '02:00' }, new Date(2026, 0, 11, 1, 0)), false, 'gece yarısını aşan etkinlik ertesi gün 01:00da bitmiş sayılmamalı');
assert.equal(hasEventEnded({ tarih: '2026-01-10', saat: '22:00', bitisSaat: '02:00' }, new Date(2026, 0, 11, 2, 0)), true, 'gece yarısını aşan etkinlik ertesi gün 02:00da bitmiş sayılmalı');

// Gelecek etkinlik hiçbir zaman bitmiş sayılmamalı.
assert.equal(hasEventEnded({ tarih: '2099-01-01', saat: '10:00' }, new Date(2026, 0, 10)), false, 'gelecek etkinlik bitmiş sayılmamalı');

console.log('PASS: hasEventEnded tüm uç durumlarda (tek/çok günlü, saatsiz, gece yarısı aşımı, gelecek) doğru');

// ── getEventStartDate / getEventEndDate / eventOverlapsRange ──────────────

{
  const s = getEventStartDate({ tarih: '2026-03-01', saat: '09:30' });
  assert.equal(s.getHours(), 9); assert.equal(s.getMinutes(), 30);
  const e = getEventEndDate({ tarih: '2026-03-01', saat: '09:30', bitisSaat: '10:15' });
  assert.equal(e.getHours(), 10); assert.equal(e.getMinutes(), 15);
  console.log('PASS: getEventStartDate/getEventEndDate saat bilgisini doğru taşıyor');
}

{
  // Çok günlü etkinlik: tek bir gün aralığıyla kesişip kesişmediği doğru hesaplanmalı.
  const event = { tarih: '2026-03-01', bitisTarihi: '2026-03-03' };
  const mar2Start = new Date(2026, 2, 2, 0, 0, 0, 0);
  const mar2End = new Date(2026, 2, 2, 23, 59, 59, 999);
  assert.equal(eventOverlapsRange(event, mar2Start, mar2End), true, 'aradaki gün kesişmeli');
  const mar5Start = new Date(2026, 2, 5, 0, 0, 0, 0);
  const mar5End = new Date(2026, 2, 5, 23, 59, 59, 999);
  assert.equal(eventOverlapsRange(event, mar5Start, mar5End), false, 'aralık dışı gün kesişmemeli');
  console.log('PASS: eventOverlapsRange çok günlü etkinliklerde tarih-aralığı çakışmasını doğru buluyor (yalnızca başlangıç değil)');
}

// ── getCalendarOverviewBuckets (Bölüm 1: takvim özet alanları) ───────────

// Sabit "şimdi": 2026-09-07 Pazartesi 10:00 (bilinçli seçim: haftanın ilk günü,
// bu haftanın sınırlarını test etmeyi kolaylaştırır).
const NOW = new Date(2026, 8, 7, 10, 0, 0, 0);
assert.equal(NOW.getDay(), 1, 'test sabiti gerçekten Pazartesi olmalı');

{
  const events = {
    simdi: { tarih: '2026-09-07', saat: '09:00', bitisSaat: '11:00', ad: 'Şu anki toplantı' },
    bugunDaha: { tarih: '2026-09-07', saat: '15:00', ad: 'Bugün ilerleyen saatte' },
    buHafta: { tarih: '2026-09-10', saat: '10:00', ad: 'Bu hafta Perşembe' },
    yaklasan: { tarih: '2026-09-20', ad: 'Yaklaşan (bu haftadan sonra, 30 gün içinde)' },
    cokUzak: { tarih: '2026-12-01', ad: 'Çok uzak (30 gün dışı)' },
    iptalEdilen: { tarih: '2026-09-07', saat: '09:00', durum: 'iptal', ad: 'İptal edilen bugünkü' },
    arsivlenen: { tarih: '2026-09-07', saat: '09:00', arsiv: true, ad: 'Arşivlenen bugünkü' },
    cokGunluBugunuKapsayan: { tarih: '2026-09-06', bitisTarihi: '2026-09-08', ad: 'Çok günlü, bugünü kapsayan' }
  };
  const buckets = getCalendarOverviewBuckets(events, NOW);

  const todayIds = buckets.today.map((e) => e._id);
  const weekIds = buckets.week.map((e) => e._id);
  const upcomingIds = buckets.upcoming.map((e) => e._id);

  assert.ok(todayIds.includes('simdi'), 'şu anki etkinlik bugün listesinde olmalı');
  assert.ok(todayIds.includes('bugunDaha'), 'bugün ilerleyen saatteki etkinlik bugün listesinde olmalı');
  assert.ok(todayIds.includes('cokGunluBugunuKapsayan'), 'bugünü kapsayan çok günlü etkinlik bugün listesinde olmalı (yalnızca başlangıç tarihine göre değil)');
  assert.equal(todayIds.includes('iptalEdilen'), false, 'iptal edilen etkinlik varsayılan listede olmamalı');
  assert.equal(todayIds.includes('arsivlenen'), false, 'arşivlenen etkinlik varsayılan listede olmamalı');

  assert.ok(weekIds.includes('buHafta'), 'bu haftaki etkinlik hafta listesinde olmalı');
  assert.equal(weekIds.includes('simdi'), false, 'bugünün etkinliği hafta listesinde TEKRAR görünmemeli (mükerrer yok)');

  assert.ok(upcomingIds.includes('yaklasan'), 'bu haftadan sonraki 30 gün içindeki etkinlik yaklaşan listesinde olmalı');
  assert.equal(upcomingIds.includes('cokUzak'), false, '30 günden uzak etkinlik yaklaşan listesinde olmamalı');

  // Sıralama: devam eden etkinlikler (Şu anda -- hem 'simdi' hem de o anı
  // kapsayan çok günlü etkinlik) listenin başında, henüz başlamamış 'bugunDaha'
  // etkinliğinden ÖNCE olmalı.
  const bugunDahaIdx = todayIds.indexOf('bugunDaha');
  assert.ok(todayIds.indexOf('simdi') < bugunDahaIdx, 'devam eden etkinlik henüz başlamamış etkinlikten önce sıralanmalı');
  assert.ok(todayIds.indexOf('cokGunluBugunuKapsayan') < bugunDahaIdx, 'devam eden çok günlü etkinlik de henüz başlamamış etkinlikten önce sıralanmalı');

  console.log('PASS: getCalendarOverviewBuckets bugün/hafta/yaklaşan kovalarını doğru, mükerrersiz ve sıralı üretiyor');
}

{
  // Aynı etkinlik iki kovada birden GÖRÜNMEMELİ (seen Set kontrolü) -- bugünle
  // kesişen VE aynı zamanda bu hafta aralığında olan bir etkinlik yalnızca
  // "today" kovasında kalmalı.
  const events = { e1: { tarih: '2026-09-07', saat: '09:00', ad: 'Bugün' } };
  const buckets = getCalendarOverviewBuckets(events, NOW);
  assert.equal(buckets.today.length, 1);
  assert.equal(buckets.week.length, 0, 'bugünün etkinliği hafta kovasında da yer almamalı');
  console.log('PASS: aynı etkinlik iki kovada birden listelenmiyor');
}

console.log('ALL_TESTS_PASSED: true');
