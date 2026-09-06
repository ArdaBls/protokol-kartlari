const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '../docs/admin-src/src/v4/mini-calendar-widget.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const { isHappeningNow } = new Function(source + '\nreturn { isHappeningNow };')();
const now = new Date(2026, 8, 7, 10, 30);

assert.equal(isHappeningNow({ tarih: '2026-09-07' }, now), true, 'bugünkü tüm gün etkinliği');
assert.equal(isHappeningNow({ tarih: '2026-09-07', saat: '08:00', bitisSaat: '09:00' }, now), false, 'saat aralığı dışı');
assert.equal(isHappeningNow({ tarih: '2026-09-07', saat: '10:00', bitisSaat: '11:00' }, now), true, 'saat aralığı içi');
assert.equal(isHappeningNow({ tarih: '2026-09-07', saat: '10:00' }, now), true, 'eksik bitiş varsayılan 60 dakika');
assert.equal(isHappeningNow({ tarih: '2026-09-07', saat: '10:00' }, new Date(2026, 8, 7, 11, 0)), false, 'varsayılan bitiş hariç sınır');
assert.equal(isHappeningNow({ tarih: '2026-09-06', bitisTarihi: '2026-09-08', saat: '23:00' }, now), true, 'bugünü kapsayan çok günlük etkinlik');
console.log('PASS: mini takvim canlı etkinlik zaman aralıkları');
