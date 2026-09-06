const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="calMainBody"></div>');
    const source = fs.readFileSync(path.join(__dirname, '../docs/admin-src/src/v4/calendar.js'), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(async () => {
      const raw = JSON.parse('{"__proto__":{"tarih":"2026-09-07"},"constructor":{},"prototype":{}}');
      raw.multi = { ad: 'Çok günlük', tarih: '2026-09-07', bitisTarihi: '2026-09-09' };
      raw.late = { ad: 'Geç', tarih: '2026-09-07', saat: '15:00' };
      raw.early = { ad: 'Erken', tarih: '2026-09-07', saat: '09:00', durum: 'iptal' };
      EVENTS = cleanEvents(raw);
      let sorts = 0;
      const original = eventList;
      eventList = () => { sorts++; return original(); };
      calAnchor = new Date(2026, 8, 7);
      calView = 'year'; renderCalendar();
      const yearSorts = sorts;
      const ids = eventsOn('2026-09-07').map(e => e._id);
      const nextDay = eventsOn('2026-09-08').length;
      EVENTS.early.tarih = '2026-09-08';
      calView = 'month'; renderCalendar();
      const moved = eventsOn('2026-09-08').map(e => e._id);
      delete EVENTS.late; renderCalendar();
      const deleted = !eventsOn('2026-09-07').some(e => e._id === 'late');
      const rejected = [];
      for (const id of ['__proto__', 'constructor', 'prototype', '../users', 'a/b', '']) {
        rejected.push(safeEventId(id) === null && await persistEvent(id, {}) === null);
        await deleteEvent(id); // Yetki/DB erişimine gelmeden reddedilmeli.
      }
      return { yearSorts, ids, nextDay, moved, deleted, rejected,
        nullPrototype: Object.getPrototypeOf(EVENTS) === null,
        keys: Object.keys(EVENTS), normalId: safeEventId('-Normal_123') };
    });
    assert.equal(result.yearSorts, 1, '504 hücre için yalnızca bir sıralama yapılmalı');
    assert.deepEqual(result.ids, ['multi', 'early', 'late']);
    assert.equal(result.nextDay, 0, 'çok günlük başlangıç-günü davranışı korunmalı');
    assert.deepEqual(result.moved, ['early']);
    assert.equal(result.deleted, true);
    assert.equal(result.nullPrototype, true);
    assert.deepEqual(result.keys.sort(), ['early', 'multi']);
    assert.ok(result.rejected.every(Boolean));
    assert.equal(result.normalId, '-Normal_123');
    console.log('PASS: takvim tarih indeksi, önbellek yenileme ve güvenli etkinlik kimlikleri');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
