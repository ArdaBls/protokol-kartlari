interface AccountIdentity {
  displayName: string | null
  email: string | null
}

export interface RegistrationName {
  firstName: string
  lastName: string
}

/** Transaction yeniden çalışsa bile mevcut onay/engel bilgisi asla ezilmez. */
export function pendingProfileIfMissing(
  current: unknown,
  user: AccountIdentity,
  createdAt: unknown,
  registrationName?: RegistrationName,
) {
  if (current !== null) return undefined
  const name = (user.displayName ?? '').trim()
  const split = name.lastIndexOf(' ')
  return {
    firstName: registrationName?.firstName ?? (split === -1 ? name : name.slice(0, split)),
    lastName: registrationName?.lastName ?? (split === -1 ? '' : name.slice(split + 1)),
    email: user.email ?? '',
    role: 'pending' as const,
    createdAt,
  }
}
