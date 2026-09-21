import { useEffect, useState } from 'react'

/** Belirli aralıklarla yenilenen "şimdi" — zamana bağlı sınıflandırmalar için. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
