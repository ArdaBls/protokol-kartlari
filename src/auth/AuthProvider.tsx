import { toast } from '@heroui/react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { startDbMode } from '../lib/dbMode'
import { auth, db } from '../lib/firebase'
import { initStreak } from '../lib/streak'
import type { StreakResult } from '../lib/streak'
import { AuthContext } from './AuthContext'
import type { AuthContextValue } from './AuthContext'
import { authStateFromProfile } from './profileState'
import type { ProfileSnapshot } from './profileState'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [profileAttempt, setProfileAttempt] = useState(0)
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null)
  const [streak, setStreak] = useState<{ uid: string; value: StreakResult } | null>(null)
  const retryProfile = useCallback(() => setProfileAttempt((attempt) => attempt + 1), [])

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  // Canlı dinleme: oturum sırasında rol değişirse veya hesap engellenirse anında yansır.
  useEffect(() => {
    if (!user) return
    let active = true
    const stop = onValue(
      ref(db, `users/${user.uid}`),
      (snap) => {
        if (!active) return
        // Eksik profil otomatik oluşturulmaz; açık oturumun silme işlemini geri
        // almasını önlemek için yalnızca açık giriş/kayıt akışı profil oluşturur.
        setProfile({ user, attempt: profileAttempt, value: snap.val() as ProfileSnapshot['value'], failed: false })
      },
      (err) => {
        console.error('Kullanıcı kaydı okunamadı:', err)
        if (active) setProfile({ user, attempt: profileAttempt, value: null, failed: true })
      },
    )
    return () => { active = false; stop() }
  }, [user, profileAttempt])

  const state = useMemo(() => authStateFromProfile(user, profile, profileAttempt), [user, profile, profileAttempt])

  const isReady = state.status === 'ready'
  const uid = user?.uid
  const displayName = state.status === 'ready' ? state.displayName : ''

  useEffect(() => (isReady ? startDbMode() : undefined), [isReady])

  // Kopunca kayıt kaldırılır; silinen hesap için eski ad/durum tekrar yazılmaz.
  useEffect(() => {
    if (!isReady || !uid) return
    const presenceRef = ref(db, `presence/${uid}`)
    const disconnect = onDisconnect(presenceRef)
    let active = true
    const stop = onValue(ref(db, '.info/connected'), (snap) => {
      if (!snap.val()) return
      disconnect.remove()
        .then(() => {
          if (active && auth.currentUser?.uid === uid) {
            return set(presenceRef, { cevrimici: true, isim: displayName, sonGorulme: serverTimestamp() })
          }
        })
        .catch((err) => console.error('Çevrimiçi durumu yazılamadı:', err))
    })
    return () => {
      active = false
      stop()
      void disconnect.cancel().catch(() => undefined)
      // Yetki kaybında yönetici aynı atomik işlemde presence kaydını kaldırır.
      if (auth.currentUser?.uid === uid) void remove(presenceRef).catch(() => undefined)
    }
  }, [isReady, uid, displayName])

  useEffect(() => {
    if (!isReady || !uid) return
    let isCancelled = false
    initStreak(uid).then((result) => {
      if (isCancelled) return
      setStreak({ uid, value: result })
      if (result.justBroken) toast.warning('Giriş serin sona erdi — bugün yeniden başladı.')
    })
    return () => {
      isCancelled = true
    }
  }, [isReady, uid])

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      streak: isReady && streak && streak.uid === uid ? streak.value : null,
      retryProfile,
      signOutUser: () => {
        // Bağlantı yoksa veritabanı yazma sözü çıkışı süresiz bekletmemeli.
        if (auth.currentUser) void remove(ref(db, `presence/${auth.currentUser.uid}`)).catch(() => undefined)
        return signOut(auth)
      },
    }),
    [state, streak, isReady, uid, retryProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
