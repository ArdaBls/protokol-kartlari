import { toast } from '@heroui/react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { onDisconnect, onValue, ref, serverTimestamp, set } from 'firebase/database'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { startDbMode } from '../lib/dbMode'
import { auth, db } from '../lib/firebase'
import { fullName, isApprovedRole } from '../lib/roles'
import type { UserProfile } from '../lib/roles'
import { initStreak } from '../lib/streak'
import type { StreakResult } from '../lib/streak'
import { AuthContext } from './AuthContext'
import type { AuthContextValue, AuthState } from './AuthContext'

// Auth hesabı olup users/{uid} kaydı olmayan "yetim" hesap onay listesinde hiç görünmüyordu;
// eski shell.js'teki gibi pending olarak yeniden yazılır (kurallar buna izin veriyor).
function repairOrphanAccount(user: User) {
  const name = (user.displayName ?? '').trim()
  const split = name.lastIndexOf(' ')
  set(ref(db, `users/${user.uid}`), {
    firstName: split === -1 ? name : name.slice(0, split),
    lastName: split === -1 ? '' : name.slice(split + 1),
    email: user.email ?? '',
    role: 'pending',
    createdAt: serverTimestamp(),
  }).catch((err) => console.error('Yetim hesap onarımı başarısız:', err))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [profile, setProfile] = useState<{ uid: string; value: UserProfile | null } | null>(null)
  const [streak, setStreak] = useState<StreakResult | null>(null)

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  // Canlı dinleme: oturum sırasında rol değişirse veya hesap engellenirse anında yansır.
  useEffect(() => {
    if (!user) return
    return onValue(
      ref(db, `users/${user.uid}`),
      (snap) => {
        if (!snap.exists()) repairOrphanAccount(user)
        setProfile({ uid: user.uid, value: snap.val() as UserProfile | null })
      },
      (err) => {
        console.error('Kullanıcı kaydı okunamadı:', err)
        setProfile({ uid: user.uid, value: null })
      },
    )
  }, [user])

  const state = useMemo<AuthState>(() => {
    if (user === undefined) return { status: 'loading' }
    if (user === null) return { status: 'guest' }
    if (!profile || profile.uid !== user.uid) return { status: 'loading' }
    const value = profile.value ?? {}
    if (value.blocked === true) return { status: 'blocked', user }
    if (!isApprovedRole(value.role)) return { status: 'pending', user }
    return { status: 'ready', user, profile: value, role: value.role, displayName: fullName(value) || user.email || 'Kullanıcı' }
  }, [user, profile])

  const isReady = state.status === 'ready'
  const uid = user?.uid
  const displayName = state.status === 'ready' ? state.displayName : ''

  useEffect(() => (isReady ? startDbMode() : undefined), [isReady])

  // Çevrimiçi durumu (presence): bağlantı kurulunca "çevrimiçi" yazılır, kopunca sunucu tarafında çalışan
  // onDisconnect kaydı "çevrimdışı" yapar — sekme aniden kapansa bile durum doğru kalır. Test modunda gölgelenmez.
  useEffect(() => {
    if (!isReady || !uid) return
    const presenceRef = ref(db, `presence/${uid}`)
    return onValue(ref(db, '.info/connected'), (snap) => {
      if (!snap.val()) return
      onDisconnect(presenceRef)
        .set({ cevrimici: false, isim: displayName, sonGorulme: serverTimestamp() })
        .then(() => set(presenceRef, { cevrimici: true, isim: displayName, sonGorulme: serverTimestamp() }))
        .catch((err) => console.error('Çevrimiçi durumu yazılamadı:', err))
    })
  }, [isReady, uid, displayName])

  useEffect(() => {
    if (!isReady || !uid) return
    let isCancelled = false
    initStreak(uid).then((result) => {
      if (isCancelled) return
      setStreak(result)
      if (result.justBroken) toast.warning('Giriş serin sona erdi — bugün yeniden başladı.')
    })
    return () => {
      isCancelled = true
    }
  }, [isReady, uid])

  const value = useMemo<AuthContextValue>(
    () => ({ state, streak: isReady ? streak : null, signOutUser: () => signOut(auth) }),
    [state, streak, isReady],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
