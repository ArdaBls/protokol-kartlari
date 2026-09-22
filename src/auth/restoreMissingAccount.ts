import type { User } from 'firebase/auth'
import { get, ref, remove, runTransaction } from 'firebase/database'
import { db } from '../lib/firebase'

function profileFromAuthUser(user: User) {
  const name = (user.displayName ?? '').trim()
  const split = name.lastIndexOf(' ')

  return {
    firstName: split === -1 ? name : name.slice(0, split),
    lastName: split === -1 ? '' : name.slice(split + 1),
    email: user.email ?? '',
    role: 'pending' as const,
    createdAt: Date.now(),
  }
}

/**
 * Auth hesabı duruyor fakat users/{uid} kaydı silinmişse, yalnızca başarılı bir
 * girişten sonra yeni pending profil oluşturur. AuthProvider bunu kendiliğinden
 * çağırmaz; böylece admin hesabı silerken açık oturum profili geri yazamaz.
 */
export async function restoreMissingAccount(user: User): Promise<boolean> {
  const userRef = ref(db, `users/${user.uid}`)
  const existing = await get(userRef)
  if (existing.exists()) return false

  const result = await runTransaction(userRef, (current) => current ?? profileFromAuthUser(user))
  if (!result.committed) return false

  // Tombstone denetim kaydıdır. Eski Firebase kurallarında silinemiyorsa
  // profilin oluşturulmasını engellememelidir.
  await remove(ref(db, `deletedAccounts/${user.uid}`)).catch((err) => {
    console.warn('Silinmiş hesap işareti temizlenemedi:', err)
  })
  return true
}
