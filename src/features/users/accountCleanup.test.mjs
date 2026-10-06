import assert from 'node:assert/strict'
import test from 'node:test'
import { accountDeleteUpdates } from './accountCleanup.ts'
import { matchesAccountLog, matchingLogDeletes } from '../../lib/logCleanup.ts'

test('names and emails never identify an account for destructive log cleanup', () => {
  assert.equal(matchesAccountLog({ by: 'Ali Yılmaz', email: 'ali@example.com' }, 'user-a'), false)
  assert.equal(matchesAccountLog({ actorUid: 'user-b', email: 'ali@example.com' }, 'user-a'), false)
  assert.equal(matchesAccountLog({ actorUid: 'user-a', email: 'old-address@example.com' }, 'user-a'), true)
  assert.equal(matchesAccountLog({ actorUid: '' }, ''), false)
})

test('only UID-matched logs are removed, including lists not in the old allowlist', () => {
  const logs = {
    etkinlik: {
      mine: { actorUid: 'user-a', by: 'Ali' },
      other: { actorUid: 'user-b', by: 'Ali' },
      legacy: { by: 'Ali', email: 'ali@example.com' },
      malformed: null,
    },
    anotherList: { mine: { actorUid: 'user-a' } },
    malformedList: 'text',
  }
  const match = (entry) => matchesAccountLog(entry, 'user-a')
  assert.deepEqual(matchingLogDeletes('logs', logs, match), {
    'logs/etkinlik/mine': null,
    'logs/anotherList/mine': null,
  })
  assert.deepEqual(matchingLogDeletes('test/logs', logs, match), {
    'test/logs/etkinlik/mine': null,
    'test/logs/anotherList/mine': null,
  })
  assert.deepEqual(matchingLogDeletes('logs', null, match), {})
})

test('account deletion always clears live and test notifications and directory entries', () => {
  assert.deepEqual(accountDeleteUpdates('user-a'), {
    'users/user-a': null,
    'staffProfiles/user-a': null,
    'presence/user-a': null,
    'basinGorevlileri/user-a': null,
    'test/basinGorevlileri/user-a': null,
    'notifications/user-a': null,
    'test/notifications/user-a': null,
  })
  for (const uid of ['', 'users/another-user', 'user.#']) {
    assert.throws(() => accountDeleteUpdates(uid))
  }
})
