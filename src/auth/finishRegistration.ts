import type { User } from 'firebase/auth'

export class IncompleteRegistrationError extends Error {
  readonly user: User

  constructor(user: User, cause: unknown) {
    super('Auth hesabı oluşturuldu; profil kaydı tamamlanamadı.', { cause })
    this.user = user
  }
}

/** Profil hatasında aynı Auth hesabıyla tekrar denenir; ad eşitlemesi kaydı geri almaz. */
export async function finishRegistration({ user, create, save, syncName }: {
  user: User | null
  create: () => Promise<User>
  save: (user: User) => Promise<unknown>
  syncName: (user: User) => Promise<void>
}): Promise<{ nameSyncError: unknown | null }> {
  const account = user ?? await create()
  try {
    await save(account)
  } catch (cause) {
    throw new IncompleteRegistrationError(account, cause)
  }
  try {
    await syncName(account)
    return { nameSyncError: null }
  } catch (nameSyncError) {
    return { nameSyncError }
  }
}
