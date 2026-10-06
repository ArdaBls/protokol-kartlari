import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { accountDeleteUpdates } from '../features/users/accountCleanup.ts'

// The real checked-in expressions are exercised with snapshot fixtures. This is
// a focused rules predicate test, not a replacement for the Firebase emulator.
const rules = JSON.parse(readFileSync(new URL('../../yerel-notlar/firebase-database-rules.json', import.meta.url), 'utf8')).rules
const now = 1700000000000
const admin = { uid: 'admin', token: { email: 'admin@example.com' } }
const member = { uid: 'member', token: { email: 'member@example.com' } }
const profile = { firstName: 'Ali', lastName: 'Yılmaz', email: member.token.email, role: 'editor' }

function snapshot(value) {
  return {
    val: () => value ?? null,
    exists: () => value !== null && value !== undefined,
    child: (path) => snapshot(path.split('/').reduce((node, key) => node?.[key], value)),
    hasChildren: (keys) => keys.every((key) => value?.[key] !== null && value?.[key] !== undefined),
    isString: () => typeof value === 'string',
    isNumber: () => typeof value === 'number',
    isBoolean: () => typeof value === 'boolean',
  }
}

function evaluate(expression, { auth = member, actor = profile, data = null, next = null, uid = 'member', extra = {} } = {}) {
  if (typeof expression === 'boolean') return expression
  const root = snapshot({ ...extra, users: { member: profile, admin: { role: 'admin' }, ...(extra.users ?? {}), ...(auth ? { [auth.uid]: actor } : {}) } })
  return new Function('auth', 'root', 'data', 'newData', '$uid', '$notifUid', 'now', `return (${expression})`)(
    auth, root, snapshot(data), snapshot(next), uid, uid, now,
  )
}

test('pending, deleted, blocked and anonymous accounts cannot read or write presence', () => {
  for (const actor of [null, { role: 'pending' }, { role: 'editor', blocked: true }]) {
    assert.equal(evaluate(rules.presence['.read'], { actor }), false)
    assert.equal(evaluate(rules.presence.$uid['.write'], { actor, next: { cevrimici: true } }), false)
  }
  assert.equal(evaluate(rules.presence['.read'], { auth: null }), false)
  assert.equal(evaluate(rules.presence['.read']), true)
  assert.equal(evaluate(rules.presence.$uid['.write'], { next: { cevrimici: true } }), true)
  assert.equal(evaluate(rules.presence.$uid['.write'], { uid: 'someone-else', next: { cevrimici: true } }), false)
})

for (const [label, branch] of [['live', rules], ['test', rules.test]]) {
  test(`${label}: notification parent and invite child both reject unapproved accounts`, () => {
    const node = branch.notifications.$notifUid
    for (const actor of [null, { role: 'pending' }, { role: 'admin', blocked: true }]) {
      assert.equal(evaluate(node['.read'], { actor }), false)
      assert.equal(evaluate(node['.write'], { actor, next: { existing: {} } }), false)
      assert.equal(evaluate(node.$notificationId['.write'], { actor, next: { type: 'chess_invite' } }), false)
    }
    assert.equal(evaluate(node['.read']), true)
    assert.equal(evaluate(node['.read'], { uid: 'another-user' }), false)
    assert.equal(evaluate(node['.write'], { next: { existing: {} } }), true)
  })

  test(`${label}: log authors cannot forge UID or email; existing writers without UID remain compatible`, () => {
    const expression = branch.logs.$listKey.$logId['.validate']
    const log = { by: 'Ali', email: member.token.email, action: 'updated', timestamp: now, actorUid: member.uid }
    assert.equal(evaluate(expression, { next: log }), true)
    assert.equal(evaluate(expression, { next: { ...log, actorUid: 'other-user' } }), false)
    assert.equal(evaluate(expression, { next: { ...log, email: 'other@example.com' } }), false)
    const { actorUid: _, ...legacy } = log
    assert.equal(evaluate(expression, { next: legacy }), true)
  })
}

test('deleted account may recreate only its own pending profile without erasing the deletion marker', () => {
  const node = rules.users.$uid
  const pending = { ...profile, role: 'pending' }
  const extra = { deletedAccounts: { member: { deletedAt: now, deletedByUid: admin.uid } } }
  assert.equal(evaluate(node['.write'], { actor: null, next: pending, extra }), true)
  assert.equal(evaluate(node['.validate'], { actor: null, next: pending, extra }), true)
  assert.equal(evaluate(node.role['.validate'], { actor: null, next: 'pending', extra }), true)
  for (const role of ['editor', 'admin', 'owner']) {
    assert.equal(evaluate(node.role['.validate'], { actor: null, next: role, extra }), false)
  }
  assert.equal(evaluate(rules.deletedAccounts.$uid['.write'], { actor: null, data: extra.deletedAccounts.member, next: null, extra }), false)
})

test('self email spoofing, self promotion, owner demotion and nonboolean blocks are rejected', () => {
  const node = rules.users.$uid
  assert.equal(evaluate(node.email['.validate'], { data: member.token.email, next: 'victim@example.com' }), false)
  assert.equal(evaluate(node.email['.validate'], { next: member.token.email }), true)
  assert.equal(evaluate(node.role['.validate'], { data: 'editor', next: 'admin' }), false)
  assert.equal(evaluate(node.role['.validate'], { data: 'editor', next: 'editor' }), true)
  assert.equal(evaluate(node.role['.validate'], { auth: admin, actor: { role: 'admin' }, data: 'owner', next: 'pending' }), false)
  assert.equal(evaluate(node.blocked['.validate'], { auth: admin, actor: { role: 'admin' }, next: 'true' }), false)
})

test('an active admin can delete every account cleanup path and write the audit marker', () => {
  const context = { auth: admin, actor: { role: 'admin' }, data: profile, next: null }
  const permissions = {
    'users/member': rules.users.$uid['.write'],
    'staffProfiles/member': rules.staffProfiles.$staffUid['.write'].replaceAll('$staffUid', '$uid'),
    'presence/member': rules.presence.$uid['.write'],
    'basinGorevlileri/member': rules.basinGorevlileri['.write'],
    'test/basinGorevlileri/member': rules.test.basinGorevlileri['.write'],
    'notifications/member': rules.notifications.$notifUid['.write'],
    'test/notifications/member': rules.test.notifications.$notifUid['.write'],
  }
  for (const path of Object.keys(accountDeleteUpdates('member'))) {
    assert.equal(evaluate(permissions[path], context), true, path)
  }
  const marker = { deletedAt: now, deletedByUid: admin.uid }
  assert.equal(evaluate(rules.deletedAccounts.$uid['.write'], { ...context, next: marker }), true)
  assert.equal(evaluate(rules.deletedAccounts.$uid['.validate'], { ...context, next: marker }), true)
  assert.equal(evaluate(rules.deletedAccounts.$uid['.write'], { ...context, actor: { role: 'admin', blocked: true }, next: marker }), false)
})
