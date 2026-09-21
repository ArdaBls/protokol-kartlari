// Test Modu + Salt-Okunur Kilit — eski paneldeki db-mode.js'in karşılığı.
// ayarlar/testModuAcik açıkken içerik okuma/yazmaları test/ dalına gider;
// ayarlar/saltOkunur açıkken rol ne olursa olsun yazma kapalıdır.
// users/ (hesap/rol) ASLA test dalına yönlendirilmez.
import { onValue, ref } from 'firebase/database'
import { useSyncExternalStore } from 'react'
import { db } from './firebase'

export interface DbModeState {
  isReady: boolean
  isTestMode: boolean
  isReadOnly: boolean
  hasError: boolean
}

const INITIAL_STATE: DbModeState = { isReady: false, isTestMode: false, isReadOnly: false, hasError: false }

let state = INITIAL_STATE
const listeners = new Set<() => void>()

function setState(patch: Partial<DbModeState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Onaylı oturum açıldığında çağrılır; dönen fonksiyon dinleyicileri kapatıp durumu sıfırlar. */
export function startDbMode(): () => void {
  let hasTest = false
  let hasReadOnly = false
  const markReadyIfComplete = () => {
    if (hasTest && hasReadOnly && !state.isReady) setState({ isReady: true })
  }
  // Mod okunamazsa canlı veriye yanlışlıkla yazılmasın diye yazma kilitlenir.
  const handleError = (label: string) => (err: Error) => {
    console.error(label, err)
    hasTest = true
    hasReadOnly = true
    setState({ isReadOnly: true, hasError: true, isReady: true })
  }

  const stopTest = onValue(
    ref(db, 'ayarlar/testModuAcik'),
    (snap) => {
      hasTest = true
      setState({ isTestMode: !!snap.val() })
      markReadyIfComplete()
    },
    handleError('Test modu durumu okunamadı:'),
  )
  const stopReadOnly = onValue(
    ref(db, 'ayarlar/saltOkunur'),
    (snap) => {
      hasReadOnly = true
      setState({ isReadOnly: !!snap.val() || state.hasError })
      markReadyIfComplete()
    },
    handleError('Salt-okunur durumu okunamadı:'),
  )

  return () => {
    stopTest()
    stopReadOnly()
    setState(INITIAL_STATE)
  }
}

export function useDbMode(): DbModeState {
  return useSyncExternalStore(subscribe, () => state)
}

export function dbPathFor(basePath: string, isTestMode: boolean): string {
  return isTestMode ? `test/${basePath}` : basePath
}
