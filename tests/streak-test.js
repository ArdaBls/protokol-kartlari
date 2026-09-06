const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [2026, 8, 7, 12, 0, 0])); }
  static now() { return new RealDate(2026, 8, 7, 12, 0, 0).getTime(); }
};

function databaseFor(initial) {
  let value = initial;
  const writes = [];
  return {
    writes,
    database: { ref: () => ({
      once: async () => ({ val: () => value }),
      set: async next => { writes.push(next); value = next; }
    }) }
  };
}

(async () => {
  try {
    const url = pathToFileURL(path.join(__dirname, '../docs/admin-src/src/v4/streak.js')).href;
    const { initStreak } = await import(url);

    let mock = databaseFor(null);
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 1, longest: 1, justBroken: false });
    assert.equal(mock.writes.length, 1);

    mock = databaseFor({ count: 4, lastDate: '2026-09-07', longest: 7 });
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 4, longest: 7, justBroken: false });
    assert.equal(mock.writes.length, 0, 'aynı gün tekrar yazılmamalı');

    mock = databaseFor({ count: 4, lastDate: '2026-09-06', longest: 4 });
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 5, longest: 5, justBroken: false });
    assert.equal(mock.writes[0].count, 5);

    mock = databaseFor({ count: 3, lastDate: '2026-09-04', longest: 8 });
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 1, longest: 8, justBroken: true });
    assert.equal(mock.writes[0].brokenNoticeShown, '2026-09-07');

    mock = databaseFor({ count: 1, lastDate: '2026-09-04', longest: 1 });
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 1, longest: 1, justBroken: false });

    mock = databaseFor({ count: 5, lastDate: '2026-09-04', longest: 6, brokenNoticeShown: '2026-09-07' });
    assert.deepEqual(await initStreak(mock.database, 'u'), { count: 1, longest: 6, justBroken: false });
    console.log('PASS: giriş serisinin ilk, aynı, ardışık ve kırılma dalları');
  } finally { global.Date = RealDate; }
})().catch(error => { console.error(error); process.exitCode = 1; });
