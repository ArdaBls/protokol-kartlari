import { useIsPresent } from 'motion/react'
import type { ReactNode } from 'react'

export interface PresenceGateRenderProps {
  /** Çıkış animasyonunun başladığı render'dan itibaren false. */
  isPresent: boolean
  /** Kapanan katman animasyon sürerken tıklanamaz ve odak sırasından çıkar. */
  gate: {
    inert: boolean
    style: { pointerEvents: 'auto' | 'none' }
  }
}

/** AnimatePresence altındaki katmanın hâlâ "açık" sayılıp sayılmadığını çocuklarına iletir. */
export function PresenceGate({ children }: { children: (props: PresenceGateRenderProps) => ReactNode }) {
  const isPresent = useIsPresent()
  return children({
    isPresent,
    gate: { inert: !isPresent, style: { pointerEvents: isPresent ? 'auto' : 'none' } },
  })
}
