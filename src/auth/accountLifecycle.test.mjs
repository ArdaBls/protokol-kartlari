import assert from 'node:assert/strict'
import test from 'node:test'
import { finishRegistration, IncompleteRegistrationError } from './finishRegistration.ts'
import { pendingProfileIfMissing } from './pendingProfile.ts'
import { authStateFromProfile } from './profileState.ts'

const user = { uid: 'new-user', email: 'auth@example.com', displayName: 'Ali Yılmaz' }

test('profile read errors, missing profiles and pending approvals are distinct states', () => {
  const result = { user, attempt: 0, value: null, failed: true }
  assert.equal(authStateFromProfile(user, result, 0).status, 'error')
  assert.equal(authStateFromProfile(user, { ...result, failed: false }, 0).status, 'missing')
  assert.equal(authStateFromProfile(user, { ...result, failed: false, value: { role: 'pending' } }, 0).status, 'pending')
})

test('retry and a new login cannot reuse a stale approved profile', () => {
  const result = { user, attempt: 0, value: { role: 'admin' }, failed: false }
  assert.equal(authStateFromProfile(user, result, 1).status, 'loading')
  assert.equal(authStateFromProfile({ ...user }, result, 0).status, 'loading')
  assert.equal(authStateFromProfile(null, result, 0).status, 'guest')
  assert.equal(authStateFromProfile(undefined, result, 0).status, 'loading')
})

test('a blocked approved account never becomes ready', () => {
  const result = { user, attempt: 0, value: { role: 'admin', blocked: true }, failed: false }
  assert.equal(authStateFromProfile(user, result, 0).status, 'blocked')
  assert.equal(authStateFromProfile(user, { ...result, value: { role: 'editor' } }, 0).status, 'ready')
})

test('re-registration always starts pending and uses the Auth email', () => {
  assert.deepEqual(pendingProfileIfMissing(null, user, 123), {
    firstName: 'Ali', lastName: 'Yılmaz', email: 'auth@example.com', role: 'pending', createdAt: 123,
  })
  assert.deepEqual(pendingProfileIfMissing(null, { ...user, displayName: null }, 123, {
    firstName: 'Ayşe', lastName: 'Kaya',
  }), {
    firstName: 'Ayşe', lastName: 'Kaya', email: 'auth@example.com', role: 'pending', createdAt: 123,
  })
})

test('a competing approval or block aborts profile creation instead of overwriting it', () => {
  for (const current of [{ role: 'admin' }, { role: 'editor', blocked: true }, { role: 'pending' }]) {
    assert.equal(pendingProfileIfMissing(current, user, 123), undefined)
  }
})

test('profile save failure retains the Auth user and retry does not create another account', async () => {
  const failure = new Error('database unavailable')
  let creates = 0
  let syncs = 0
  const create = async () => { creates++; return user }
  const syncName = async () => { syncs++ }
  let incomplete
  await assert.rejects(finishRegistration({
    user: null, create, save: async () => { throw failure }, syncName,
  }), (err) => {
    assert.ok(err instanceof IncompleteRegistrationError)
    assert.equal(err.user, user)
    assert.equal(err.cause, failure)
    incomplete = err.user
    return true
  })
  assert.equal(syncs, 0)
  await finishRegistration({ user: incomplete, create, save: async () => {}, syncName })
  assert.equal(creates, 1)
  assert.equal(syncs, 1)
})

test('Auth display name failure does not report a saved account as a failed registration', async () => {
  const calls = []
  const failure = new Error('Auth update failed')
  const result = await finishRegistration({
    user: null,
    create: async () => { calls.push('create'); return user },
    save: async () => { calls.push('save') },
    syncName: async () => { calls.push('name'); throw failure },
  })
  assert.deepEqual(calls, ['create', 'save', 'name'])
  assert.equal(result.nameSyncError, failure)
})

test('Auth creation errors remain creation errors and never attempt profile writes', async () => {
  const failure = new Error('email already registered')
  await assert.rejects(finishRegistration({
    user: null,
    create: async () => { throw failure },
    save: async () => assert.fail('must not write a profile'),
    syncName: async () => assert.fail('must not update an Auth profile'),
  }), (err) => err === failure)
})
