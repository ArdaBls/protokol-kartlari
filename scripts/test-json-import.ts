import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeEvents, sanitizePerson } from '../src/features/settings/jsonImport'

test('calendar backup preserves lock override, archive boolean and completion identity', () => {
  const original = { ad: 'Arşivlenmiş etkinlik', tarih: '2026-10-01', locked: false, autoLockedForDate: '2026-10-01', arsiv: true, tamamlayanUid: 'user-123', tamamlayanEmail: 'sample@example.invalid', olusturmaTs: 12345 }
  const result = sanitizeEvents(JSON.stringify({ etkinlikler: { event1: original } }), () => 'new-key', 67890)!
  assert.equal(result.kept, 1)
  const event = result.clean.event1
  assert.equal(event.locked, false)
  assert.equal(event.autoLockedForDate, original.autoLockedForDate)
  assert.equal(event.arsiv, true)
  assert.equal(event.tamamlayanUid, 'user-123')
  assert.equal(event.olusturmaTs, 12345)
  assert.equal(event.guncellemeTs, 67890)
})

test('invalid dates are rejected, leap days retained and booleans normalized', () => {
  const result = sanitizeEvents(JSON.stringify({ invalid: { ad: 'Hatalı', tarih: '2026-02-31' }, leap: { ad: 'Geçerli', tarih: '2028-02-29', locked: 'false', arsiv: 'true' }, blank: { ad: '   ', tarih: '2026-01-01' } }), () => 'new-key', 1)!
  assert.equal(result.kept, 1)
  assert.equal(result.skipped, 2)
  assert.equal(result.clean.leap.locked, false)
  assert.equal(result.clean.leap.arsiv, true)
})

test('non-finite ranks cannot reach Firebase', () => {
  const person = sanitizePerson({ name: 'Örnek', title: 'Ünvan', rank: 'Infinity', order: '-Infinity' })
  assert.equal(person.rank, '')
  assert.equal(person.order, undefined)
  const events = sanitizeEvents(JSON.stringify({ event1: { ad: 'Deneme', tarih: '2026-10-01', katilimcilar: [{ name: 'Örnek', rank: 'Infinity' }] } }), () => 'id', 1)!
  assert.equal((events.clean.event1.katilimcilar as { rank: unknown }[])[0].rank, '')
})
