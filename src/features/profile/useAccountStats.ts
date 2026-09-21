import { useMemo } from 'react'
import { useDbValue } from '../../hooks/useDbValue'

interface EventRecord {
  olusturan?: string
  gorevli?: string
  haberYazanlari?: string
}

const parseNameList = (value?: string) => String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean)

export interface AccountStats {
  isLoading: boolean
  etkinlik: number
  gorevli: number
  haber: number
}

/** users/{uid} yerine ad EŞLEŞMESİYLE sayılır -- eski panelin profil.html'deki AYNI yöntem. */
export function useAccountStats(fullName: string): AccountStats {
  const { data, isLoading } = useDbValue<Record<string, EventRecord | null>>('etkinlikler')

  return useMemo(() => {
    if (!fullName) return { isLoading, etkinlik: 0, gorevli: 0, haber: 0 }
    const events = Object.values(data ?? {}).flatMap((event) => (event ? [event] : []))
    return {
      isLoading,
      etkinlik: events.filter((event) => event.olusturan === fullName).length,
      gorevli: events.filter((event) => parseNameList(event.gorevli).includes(fullName)).length,
      haber: events.filter((event) => parseNameList(event.haberYazanlari).includes(fullName)).length,
    }
  }, [data, isLoading, fullName])
}
