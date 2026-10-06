import assert from 'node:assert/strict'
import test from 'node:test'
import { applyEventPatch, attendanceAtSave, detachDeletedEvent, multiDayDragDates, savedEventSnapshot } from '../src/features/calendar/eventMutations.ts'
import { calHasEventEnded, eventsOnDate } from '../src/features/calendar/calendarTypes.ts'
import type { CalendarEvent } from '../src/features/calendar/calendarTypes.ts'
import { assertRecordWriteMode, MissingRecordError, mutateExistingRecord } from '../src/features/calendar/recordTransactions.ts'
import type { RecordStore } from '../src/features/calendar/recordTransactions.ts'
import { linkedEventDatePatch } from '../src/features/gantt/ganttTypes.ts'
import { kanbanItemKey } from '../src/features/kanban/kanbanTypes.ts'
import { reviewAttendance } from '../src/features/notifications/attendanceReview.ts'
import type { AttendanceEvent, AttendanceRequest } from '../src/features/notifications/attendanceReview.ts'

/** Deterministic compare-and-swap port: a concurrent commit retries the real production callback. No Firebase imports/network. */
class MemoryStore<T> implements RecordStore<T> {
  value: T | null
  version = 0
  writes = 0
  attempts = 0
  readError: Error | null = null
  writeError: Error | null = null
  beforeAttempt: (() => void) | null = null
  constructor(value: T | null) { this.value = structuredClone(value) }
  async read() {
    if (this.readError) throw this.readError
    return structuredClone(this.value)
  }
  async transact(change: (current: T | null) => T | null | undefined) {
    for (let retry = 0; retry < 100; retry++) {
      this.beforeAttempt?.()
      this.attempts++
      const version = this.version
      const next = change(structuredClone(this.value))
      if (next === undefined) return { committed: false, value: structuredClone(this.value) }
      await Promise.resolve() // overlap concurrent transactions
      if (version !== this.version) continue
      if (this.writeError) throw this.writeError
      this.value = structuredClone(next)
      this.version++
      this.writes++
      return { committed: true, value: structuredClone(this.value) }
    }
    throw new Error('Test transaction did not converge')
  }
}

test('failed event read does not start a transaction or replace an event', async () => {
  const store = new MemoryStore({ ad: 'Keep me', guncellemeTs: 1, gorevli: 'Ada' })
  store.readError = new Error('permission_denied')
  await assert.rejects(mutateExistingRecord(store, (event) => applyEventPatch(event, { ad: 'New' }, 1, 2)), /permission_denied/)
  assert.equal(store.attempts, 0)
  assert.equal(store.value?.gorevli, 'Ada')
})

test('a record deleted after the pre-read is never recreated', async () => {
  const store = new MemoryStore<CalendarEvent>({ ad: 'Deleted', guncellemeTs: 1 })
  store.beforeAttempt = () => { store.value = null }
  await assert.rejects(mutateExistingRecord(store, (event) => applyEventPatch(event, { durum: 'tamamlandi' }, 1, 2)), MissingRecordError)
  assert.equal(store.value, null)
})

test('cold Firebase cache can return null before a server-hash retry with the real record', async () => {
  const record = { ad: 'Keep', guncellemeTs: 1, gorevli: 'Ada' }
  const store: RecordStore<CalendarEvent> = {
    read: async () => record,
    transact: async (change) => {
      assert.equal(change(null), null)
      const next = change(record)
      assert.notEqual(next, undefined)
      return { committed: true, value: next! }
    },
  }
  assert.deepEqual(await mutateExistingRecord(store, (event) => applyEventPatch(event, { ad: 'Updated' }, 1, 2)), { ...record, ad: 'Updated', guncellemeTs: 2 })
})

test('concurrent saves with the same opening revision allow only one writer', async () => {
  const store = new MemoryStore<CalendarEvent>({ ad: 'Original', not: 'Preserve', guncellemeTs: 1 })
  const results = await Promise.allSettled(['A', 'B'].map((ad) => mutateExistingRecord(store, (event) => applyEventPatch(event, { ad }, 1, 2))))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(store.value?.not, 'Preserve')
  assert.ok(store.attempts >= 3, 'a colliding transaction must retry against the new revision')
})

test('stale form opening revision cannot be replaced by a newer live snapshot revision', () => {
  const opening = { ad: 'Old', guncellemeTs: 10 }
  const live = { ad: 'Other editor', guncellemeTs: 20 }
  assert.throws(() => applyEventPatch(live, { ad: 'Stale form' }, opening.guncellemeTs, 30), /başka biri/)
})

test('lock is rechecked on the transaction record, including Kanban updates', async () => {
  const store = new MemoryStore<CalendarEvent>({ ad: 'Event', locked: false, guncellemeTs: 1 })
  store.beforeAttempt = () => { store.value!.locked = true }
  await assert.rejects(mutateExistingRecord(store, (event) => applyEventPatch(event, { durum: 'tamamlandi' }, 1, 2)), /kilitli/)
  assert.equal(store.writes, 0)
  assert.equal(applyEventPatch(store.value!, { locked: false }, 1, 2).locked, false)
})

test('same ID in tasks and events has distinct Kanban drag identities', () => {
  assert.notEqual(kanbanItemKey({ source: 'gorev', id: 'same' }), kanbanItemKey({ source: 'etkinlik', id: 'same' }))
})

test('uncommitted transactions never report success', async () => {
  await assert.rejects(mutateExistingRecord({ read: async () => ({ ad: 'Keep' }), transact: async (change) => {
    change({ ad: 'Keep' })
    return { committed: false, value: { ad: 'Keep' } }
  } }, () => ({ ad: 'New' })), /başka biri/)
})

test('mode readiness, read-only, error and branch mismatch all fail closed', () => {
  const ready = { isReady: true, hasError: false, isReadOnly: false, isTestMode: false }
  assert.doesNotThrow(() => assertRecordWriteMode('etkinlikler/e', ready))
  assert.doesNotThrow(() => assertRecordWriteMode('test/etkinlikler/e', { ...ready, isTestMode: true }))
  for (const mode of [{ ...ready, isReady: false }, { ...ready, hasError: true }, { ...ready, isReadOnly: true }, { ...ready, isTestMode: true }]) {
    assert.throws(() => assertRecordWriteMode('etkinlikler/e', mode), /modu/)
  }
  assert.throws(() => assertRecordWriteMode('test/etkinlikler/e', ready), /modu/)
})

test('mode switch while a read is pending blocks the following mutation', async () => {
  const mode = { isReady: true, hasError: false, isReadOnly: false, isTestMode: false }
  const memory = new MemoryStore<CalendarEvent>({ ad: 'Live' })
  const port: RecordStore<CalendarEvent> = {
    read: async () => { const value = await memory.read(); mode.isTestMode = true; return value },
    transact: (change) => { assertRecordWriteMode('etkinlikler/e', mode); return memory.transact(change) },
  }
  await assert.rejects(mutateExistingRecord(port, (event) => ({ ...event, ad: 'Wrong branch' })), /modu/)
  assert.equal(memory.writes, 0)
})

test('clipped multi-day move preserves full duration across week/month/year boundaries', () => {
  assert.deepEqual(multiDayDragDates({ tarih: '2025-12-28', bitisTarihi: '2026-01-10' }, 'move', 2), { tarih: '2025-12-30', bitisTarihi: '2026-01-12' })
  assert.deepEqual(multiDayDragDates({ tarih: '2026-09-25', bitisTarihi: '2026-10-15' }, 'move', -3), { tarih: '2026-09-22', bitisTarihi: '2026-10-12' })
})

test('clipped multi-day resize moves only the actual endpoint and clamps crossing', () => {
  const event = { tarih: '2026-09-25', bitisTarihi: '2026-10-15' }
  assert.deepEqual(multiDayDragDates(event, 'resize-start', 2), { tarih: '2026-09-27', bitisTarihi: '2026-10-15' })
  assert.deepEqual(multiDayDragDates(event, 'resize-end', -2), { tarih: '2026-09-25', bitisTarihi: '2026-10-13' })
  assert.deepEqual(multiDayDragDates(event, 'resize-start', 40), { tarih: '2026-10-15', bitisTarihi: '2026-10-15' })
})

test('changing the form date to the past requires approval at save time', () => {
  const selected = ['Ada', 'Işık', '  IŞIK  ']
  assert.deepEqual(attendanceAtSave('Ada', selected, calHasEventEnded({ tarih: '2100-01-01' })).requested, [])
  assert.deepEqual(attendanceAtSave('Ada', selected, calHasEventEnded({ tarih: '2000-01-01' })), { accepted: ['Ada'], requested: ['IŞIK'] })
  assert.deepEqual(attendanceAtSave(undefined, ['Ada'], true), { accepted: [], requested: ['Ada'] })
})

test('quick event form receives a resolved server revision and can save immediately', () => {
  const saved = savedEventSnapshot('quick-id', { ad: 'Draft', guncellemeTs: 500, olusturmaTs: 500 })
  assert.equal(saved._id, 'quick-id')
  assert.equal(applyEventPatch(saved, { ad: 'Named event' }, saved.guncellemeTs, 501).ad, 'Named event')
  assert.throws(() => savedEventSnapshot('quick-id', { ad: 'Draft' }), /yeniden yüklenemedi/)
  assert.throws(() => savedEventSnapshot('quick-id', null), /yeniden yüklenemedi/)
})

test('deleting an event detaches only its own project link', () => {
  assert.deepEqual(detachDeletedEvent({ ad: 'Project', takvimEtkinlikId: 'deleted', guncellemeTs: 1 }, 'deleted', 2), { ad: 'Project', takvimEtkinlikId: '', guncellemeTs: 2 })
  const rebound = { takvimEtkinlikId: 'different', guncellemeTs: 3 }
  assert.equal(detachDeletedEvent(rebound, 'deleted', 4), rebound)
})

test('Gantt shifting preserves event duration and invalidates stale calendar forms', () => {
  const event = { tarih: '2026-09-29', bitisTarihi: '2026-10-02', guncellemeTs: 4, autoLockedForDate: '2026-10-02' }
  const patch = linkedEventDatePatch(event, '2026-10-05')
  assert.deepEqual(patch, { tarih: '2026-10-02', bitisTarihi: '2026-10-05' })
  const changed = applyEventPatch(event, patch, 4, 5)
  assert.equal(changed.autoLockedForDate, null)
  assert.throws(() => applyEventPatch(changed, { ad: 'Stale' }, 4, 6), /başka biri/)
})

test('month/year date lookup includes cross-year multi-day spans once per day', () => {
  const event = { _id: 'span', tarih: '2025-12-30', bitisTarihi: '2026-01-02' }
  const map = new Map([['2025-12-30', [event]], ['2026-01-01', [event]]])
  assert.deepEqual(eventsOnDate(map, '2026-01-01').map((value) => value._id), ['span'])
  assert.equal(eventsOnDate(map, '2025-12-29').length, 0)
  assert.equal(eventsOnDate(map, '2026-01-03').length, 0)
})

const reviewer = { uid: 'admin', name: 'Reviewer' }
const request = (name: string): AttendanceRequest => ({ status: 'pending', eventId: 'event', attendeeName: name, role: 'gorevli' })

test('concurrent attendance approvals preserve every attendee and unrelated event fields', async () => {
  const event = new MemoryStore<AttendanceEvent & { ad: string }>({ ad: 'Untouched', gorevli: 'Existing', guncellemeTs: 1 })
  const results = await Promise.all(['Ada', 'Bora'].map((name) => reviewAttendance(new MemoryStore(request(name)), () => event, 'approve', reviewer, () => 2)))
  assert.deepEqual(event.value?.gorevli?.split(', ').sort(), ['Ada', 'Bora', 'Existing'])
  assert.equal(event.value?.ad, 'Untouched')
  assert.ok(results.every((result) => result.request.status === 'approved'))
})

test('concurrent approve/reject cannot both claim the same attendance request', async () => {
  const req = new MemoryStore(request('Ada'))
  const event = new MemoryStore<AttendanceEvent>({ gorevli: '' })
  const results = await Promise.allSettled((['approve', 'reject'] as const).map((decision) => reviewAttendance(req, () => event, decision, reviewer, () => 2)))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(req.value?.status, 'approved')
  assert.equal(event.value?.gorevli, 'Ada')
})

test('two identical approvals have only one finalizer; retries do not duplicate attendance', async () => {
  const req = new MemoryStore(request('Işık'))
  const event = new MemoryStore<AttendanceEvent>({ gorevli: 'IŞIK', guncellemeTs: 1 })
  const run = () => reviewAttendance(req, () => event, 'approve', reviewer, () => 2)
  const results = await Promise.all([run(), run()])
  assert.equal(results.filter((result) => result.newlyFinalized).length, 1)
  assert.equal((await run()).newlyFinalized, false)
  assert.equal(event.value?.gorevli, 'IŞIK')
  assert.equal(event.value?.guncellemeTs, 1)
})

test('failed event read leaves a retryable claimed request and no attendee mutation', async () => {
  const req = new MemoryStore(request('Ada'))
  const event = new MemoryStore<AttendanceEvent>({ gorevli: 'Existing' })
  event.readError = new Error('network unavailable')
  await assert.rejects(reviewAttendance(req, () => event, 'approve', reviewer, () => 2), /network unavailable/)
  assert.equal(event.writes, 0)
  assert.equal(req.value?.status, 'pending')
  assert.equal(req.value?.reviewDecision, 'approve')
  await assert.rejects(reviewAttendance(req, () => event, 'reject', reviewer, () => 2), /farklı bir karar/)
  event.readError = null
  assert.equal((await reviewAttendance(req, () => event, 'approve', reviewer, () => 3)).request.status, 'approved')
  assert.equal(event.value?.gorevli, 'Ada, Existing')
})

test('interruption after event commit resumes without a duplicate attendee', async () => {
  const req = new MemoryStore(request('Ada'))
  const event = new MemoryStore<AttendanceEvent>({ gorevli: '' })
  const eventPort: RecordStore<AttendanceEvent> = {
    read: () => event.read(), transact: async (change) => {
      const result = await event.transact(change)
      req.writeError = new Error('request finish failed')
      return result
    },
  }
  await assert.rejects(reviewAttendance(req, () => eventPort, 'approve', reviewer, () => 2), /finish failed/)
  assert.equal(event.value?.gorevli, 'Ada')
  assert.equal(req.value?.status, 'pending')
  req.writeError = null
  const result = await reviewAttendance(req, () => event, 'approve', reviewer, () => 3)
  assert.equal(result.request.status, 'approved')
  assert.equal(event.value?.gorevli, 'Ada')
})

test('missing event rejects the request without resurrecting the event', async () => {
  const req = new MemoryStore(request('Ada'))
  const event = new MemoryStore<AttendanceEvent>(null)
  const result = await reviewAttendance(req, () => event, 'approve', reviewer, () => 2)
  assert.equal(result.request.status, 'rejected')
  assert.equal(result.request.rejectReason, 'event_deleted')
  assert.equal(event.writes, 0)
  assert.equal(event.value, null)
})
