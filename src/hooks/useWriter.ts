import { toast } from '@heroui/react'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../auth/useAuth'
import { dbPathFor, useDbMode } from '../lib/dbMode'
import { logAction } from '../lib/logAction'
import type { Actor } from '../lib/logAction'

export type LogListKey = 'gorev' | 'sayac' | 'haberProje' | 'etkinlik'

/** Yazma yetkisi, test modu yolu ve loglama tek yerden — her yazma işlemi buradan geçer. */
export function useWriter() {
  const { state } = useAuth()
  const { isReady, isTestMode, isReadOnly } = useDbMode()

  const actor: Actor | null =
    state.status === 'ready' ? { uid: state.user.uid, name: state.displayName, email: state.user.email ?? '' } : null
  const canWrite = !!actor && isReady && !isReadOnly

  /** Yazılabiliyorsa işlemi yapan kişiyi döner, değilse kullanıcıya nedenini gösterip null döner. */
  const ensureWritable = (): Actor | null => {
    if (!actor) {
      toast.danger('Bu işlem için giriş yapmanız gerekiyor.')
      return null
    }
    if (!isReady) {
      toast.warning('Veritabanı modu henüz yüklenmedi, birazdan tekrar deneyin.')
      return null
    }
    if (isReadOnly) {
      toast.danger('Salt-okunur kilit açık, düzenleme yapılamaz.')
      return null
    }
    return actor
  }

  const path = (basePath: string) => dbPathFor(basePath, isTestMode)

  const log = (listKey: LogListKey, action: string, target = '') =>
    actor ? logAction(path(`logs/${listKey}`), actor, action, target) : Promise.resolve()

  const reportError = (message: string) => (err: unknown) => {
    console.error(message, err)
    const code = err instanceof FirebaseError ? ` (${err.code})` : ''
    toast.danger(`${message}${code}`)
  }

  return { actor, canWrite, isTestMode, ensureWritable, path, log, reportError }
}
