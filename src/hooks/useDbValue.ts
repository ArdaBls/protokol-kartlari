import { onValue, ref } from 'firebase/database'
import { useEffect, useState } from 'react'
import { dbPathFor, useDbMode } from '../lib/dbMode'
import { db } from '../lib/firebase'

export interface DbValue<T> {
  data: T | null
  isLoading: boolean
  error: Error | null
}

interface Options {
  /** false: yol test modunda da test/ dalına yönlendirilmez (ör. users). */
  shadow?: boolean
  /** false: hiç dinleme başlatılmaz (ör. editöre kapalı bir yol) -- Rules of Hooks gereği
   *  çağrıyı koşullu yapmak yerine bu bayrak kullanılır. */
  enabled?: boolean
}

const LOADING: DbValue<never> = { data: null, isLoading: true, error: null }

/**
 * Bir Realtime Database yolunu canlı dinler. Test modu durumu okunmadan hiçbir
 * okuma başlamaz; mod değişince eski dalın verisi bir an bile gösterilmez.
 */
export function useDbValue<T>(basePath: string, { shadow = true, enabled = true }: Options = {}): DbValue<T> {
  const { isReady, isTestMode } = useDbMode()
  const path = isReady && enabled ? (shadow ? dbPathFor(basePath, isTestMode) : basePath) : null
  const [result, setResult] = useState<DbValue<T> & { path: string | null }>({ ...LOADING, path: null })

  useEffect(() => {
    if (!path) return
    return onValue(
      ref(db, path),
      (snap) => setResult({ path, data: snap.val() as T | null, isLoading: false, error: null }),
      (error) => {
        console.error(`${path} okunamadı:`, error)
        setResult({ path, data: null, isLoading: false, error })
      },
    )
  }, [path])

  return result.path === path ? result : LOADING
}
