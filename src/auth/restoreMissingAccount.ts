import type { User } from 'firebase/auth'
import { get, ref, runTransaction, serverTimestamp } from 'firebase/database'
import { db } from '../lib/firebase'
import { pendingProfileIfMissing } from './pendingProfile'
import type { RegistrationName } from './pendingProfile'

/**
 * Auth hesabı duruyor fakat users/{uid} kaydı silinmişse, yalnızca başarılı bir
 * girişten sonra yeni pending profil oluşturur. AuthProvider bunu kendiliğinden
 * çağırmaz; böylece admin hesabı silerken açık oturum profili geri yazamaz.
 */
export async function restoreMissingAccount(user: User, registrationName?: RegistrationName): Promise<boolean> {
  const userRef = ref(db, `users/${user.uid}`)
  const existing = await get(userRef)
  if (existing.exists()) return false

  const result = await runTransaction(
    userRef,
    (current) => pendingProfileIfMissing(current, user, serverTimestamp(), registrationName),
    { applyLocally: false },
  )
  // Son silme işareti denetim kaydı olarak korunur; yeniden başvuruyu engellemez.
  return result.committed
}
