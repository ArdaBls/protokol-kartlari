import type { User } from 'firebase/auth'
import { createContext } from 'react'
import type { Role, UserProfile } from '../lib/roles'
import type { StreakResult } from '../lib/streak'

export type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'pending' | 'blocked' | 'missing' | 'error'; user: User }
  | { status: 'ready'; user: User; profile: UserProfile; role: Role; displayName: string }

export interface AuthContextValue {
  state: AuthState
  streak: StreakResult | null
  signOutUser: () => Promise<void>
  retryProfile: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
