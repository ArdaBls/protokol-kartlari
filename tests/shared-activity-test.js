const assert = require('node:assert/strict');

(async () => {
  const handlers = new Map(), opened = [];
  const initial = {
    'ayarlar/testModuAcik': true, 'ayarlar/saltOkunur': false,
    users: { editor: { firstName: 'Test' } },
    etkinlikler: { live: { ad: 'Canlı kayıt' } },
    'test/etkinlikler': { test: { ad: 'Test kaydı' } }
  };
  const database = { ref(path) { return {
    on(_event, callback) {
      opened.push(path); handlers.set(path, callback);
      callback({ val: () => initial[path] });
    },
    off() { handlers.delete(path); }
  }; } };
  global.window = {};
  global.firebase = window.firebase = { apps: [{}], database: () => database };
  const { subscribeSharedActivityData } = await import('../docs/admin-src/src/v4/charts.js');
  let graph, widget;
  const stopGraph = subscribeSharedActivityData((users, events) => { graph = { users, events }; });
  const stopWidget = subscribeSharedActivityData((_users, events) => { widget = events; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.filter(p => p === 'test/etkinlikler').length, 1);
  assert.equal(opened.includes('etkinlikler'), false, 'başlangıçta canlı veri okunmamalı');
  assert.equal(opened.includes('test/users'), false, 'hesaplar test dalına taşınmamalı');
  assert.equal(graph.events, widget);
  assert.equal(widget.test.ad, 'Test kaydı');
  const staleCallback = handlers.get('test/etkinlikler');
  handlers.get('ayarlar/testModuAcik')({ val: () => false });
  assert.equal(handlers.has('test/etkinlikler'), false);
  assert.equal(widget.live.ad, 'Canlı kayıt');
  staleCallback({ val: () => ({ stale: {} }) });
  assert.equal(widget.live.ad, 'Canlı kayıt', 'geciken eski dal bildirimi yeni dalı ezmemeli');
  handlers.get('ayarlar/saltOkunur')({ val: () => true });
  assert.equal(opened.filter(p => p === 'etkinlikler').length, 1, 'salt okunur değişimi aynı dalı yeniden açmamalı');
  stopWidget(); stopGraph();
  console.log('PASS: ortak abonelik, başlangıç Test Modu, canlı geçiş, eski dal bildirimi ve hesap yolu');
})().catch(error => { console.error(error); process.exitCode = 1; });
