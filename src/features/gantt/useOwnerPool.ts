import { useMemo } from 'react'
import { useDbValue } from '../../hooks/useDbValue'

export interface OwnerPoolEntry {
  uid: string
  name: string
}

/** basinGorevlileri havuzu: admin tarafından işaretlenmiş kullanıcılar, "Sorumlu" seçicisinde kullanılır. */
export function useOwnerPool(): OwnerPoolEntry[] {
  const { data } = useDbValue<Record<string, string | null>>('basinGorevlileri')
  return useMemo(
    () =>
      Object.entries(data ?? {})
        .flatMap(([uid, name]) => (name && name.trim() ? [{ uid, name: name.trim() }] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [data],
  )
}
