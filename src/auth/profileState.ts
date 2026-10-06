import type { User } from 'firebase/auth'
import { fullName, isApprovedRole } from '../lib/roles.ts'
import type { UserProfile } from '../lib/roles.ts'
import type { AuthState } from './AuthContext'

export interface ProfileSnapshot {
  user: User
  attempt: number
  value: UserProfile | null
  failed: boolean
}

export function authStateFromProfile(
  user: User | null | undefined,
  profile: ProfileSnapshot | null,
  attempt: number,
): AuthState {
  if (user === undefined) return { status: 'loading' }
  if (user === null) return { status: 'guest' }
  if (!profile || profile.user !== user || profile.attempt !== attempt) return { status: 'loading' }
  if (profile.failed) return { status: 'error', user }
  if (!profile.value) return { status: 'missing', user }
  const value = profile.value
  if (value.blocked === true) return { status: 'blocked', user }
  if (!isApprovedRole(value.role)) return { status: 'pending', user }
  return { status: 'ready', user, profile: value, role: value.role, displayName: fullName(value) || user.email || 'Kullanıcı' }
}
