import { AnimatePresence, motion, type PanInfo, useDragControls, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { EASE_DRAWER } from '../../lib/ease'
import { cn } from '../../lib/utils'
import { PresenceGate } from './PresenceGate'

const DRAWER_TRANSITION = { duration: 0.5, ease: EASE_DRAWER } as const
const FLING_DISMISS_VELOCITY = 600
const FLING_FORCE_CLOSE_VELOCITY = 800
const FLING_EXPAND_VELOCITY = -500
const SNAP_STEP_OFFSET = 80

export interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Yükseklikler (0-1 arası ekran oranı veya "auto"); ilki varsayılan. */
  snapPoints?: (number | 'auto')[]
  defaultSnap?: number
  title?: string
  description?: string
  children?: ReactNode
  className?: string
  /** Kapatmak için gereken en az aşağı sürükleme (px). */
  dismissThreshold?: number
}

export function BottomSheet({
  open,
  onOpenChange,
  snapPoints = [0.5, 0.92],
  defaultSnap = 0,
  title,
  description,
  children,
  className,
  dismissThreshold = 120,
}: BottomSheetProps) {
  const [snap, setSnap] = useState(defaultSnap)
  const dragControls = useDragControls()
  const reduce = useReducedMotion()
  const uid = useId()
  const titleId = `${uid}-title`
  const descriptionId = `${uid}-description`

  useEffect(() => {
    if (open) setSnap(defaultSnap)
  }, [open, defaultSnap])

  // iOS Safari'de overflow:hidden arka planı kilitlemez; position:fixed kilitler, kapanınca kaydırma geri yüklenir.
  useEffect(() => {
    if (!open) return
    const body = document.body
    const scrollY = window.scrollY
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, right: body.style.right, overflow: body.style.overflow }
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0', overflow: 'hidden' })

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      Object.assign(body.style, previous)
      window.scrollTo(0, scrollY)
    }
  }, [open, onOpenChange])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { y: velocity } = info.velocity
    const { y: offset } = info.offset

    if (velocity > FLING_DISMISS_VELOCITY || offset > dismissThreshold) {
      const canStepDown = snap > 0 && velocity < FLING_FORCE_CLOSE_VELOCITY && offset < dismissThreshold * 1.6
      if (canStepDown) setSnap(snap - 1)
      else onOpenChange(false)
      return
    }
    if (velocity < FLING_EXPAND_VELOCITY) {
      setSnap((current) => Math.min(snapPoints.length - 1, current + 1))
      return
    }
    setSnap((current) => {
      if (offset > SNAP_STEP_OFFSET && current > 0) return current - 1
      if (offset < -SNAP_STEP_OFFSET && current < snapPoints.length - 1) return current + 1
      return current
    })
  }

  const snapValue = snapPoints[snap]
  const heightStyle = snapValue === 'auto' ? { maxHeight: '92vh' } : { height: `${snapValue * 100}vh` }

  // Dönüşüm/backdrop-filter taşıyan bir ata sabit konumu bozmasın diye body'ye portal.
  return createPortal(
    <AnimatePresence>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label="Paneli kapat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={DRAWER_TRANSITION}
              {...gate}
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 z-50 bg-background/50 backdrop-blur-sm"
            />
          )}
        </PresenceGate>
      ) : null}
      {open ? (
        <PresenceGate key="sheet">
          {({ gate }) => (
            <motion.div
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.02, bottom: 0.4 }}
              dragMomentum={false}
              onDragEnd={onDragEnd}
              initial={reduce ? { y: 0, opacity: 0 } : { y: '100%' }}
              animate={reduce ? { y: 0, opacity: 1 } : { y: 0 }}
              exit={reduce ? { y: 0, opacity: 0 } : { y: '100%' }}
              transition={reduce ? { duration: 0.18, ease: EASE_DRAWER } : DRAWER_TRANSITION}
              {...gate}
              style={{ ...heightStyle, ...gate.style }}
              className={cn(
                'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-separator bg-surface shadow-xl will-change-transform',
                className,
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-describedby={description ? descriptionId : undefined}
              aria-label={title ? undefined : 'Alt panel'}
            >
              <div className="flex flex-col items-center px-4 pb-2 pt-3">
                <div
                  onPointerDown={(event) => dragControls.start(event)}
                  className="flex cursor-grab touch-none items-center justify-center py-1 [-webkit-touch-callout:none] active:cursor-grabbing pointer-coarse:select-none"
                >
                  <div className="h-1.5 w-10 rounded-full bg-muted/40" />
                </div>
                {title || description ? (
                  <div className="mt-2 w-full">
                    {title ? (
                      <h2 id={titleId} className="text-base font-semibold">
                        {title}
                      </h2>
                    ) : null}
                    {description ? (
                      <p id={descriptionId} className="mt-0.5 text-sm text-muted">
                        {description}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
            </motion.div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
