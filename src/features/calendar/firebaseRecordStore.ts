import { get, ref, runTransaction } from 'firebase/database'
import { db } from '../../lib/firebase'
import { getDbModeState } from '../../lib/dbMode'
import type { RecordStore } from './recordTransactions'
import { assertRecordWriteMode } from './recordTransactions'

export function assertWritableDbPath(path: string) {
  assertRecordWriteMode(path, getDbModeState())
}

export function firebaseRecordStore<T>(path: string, ensureWritable?: () => unknown): RecordStore<T> {
  const recordRef = ref(db, path)
  return {
    read: async () => (await get(recordRef)).val() as T | null,
    transact: async (change) => {
      const check = () => {
        assertWritableDbPath(path)
        if (ensureWritable && !ensureWritable()) throw new Error('Düzenleme yetkisi veya veritabanı modu değişti.')
      }
      check()
      let failure: unknown
      const result = await runTransaction(recordRef, (current) => {
        try { check() } catch (err) { failure = err; return undefined }
        return change(current)
      }, { applyLocally: false })
      if (failure) throw failure
      return { committed: result.committed, value: result.snapshot.val() as T | null }
    },
  }
}
