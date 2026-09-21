import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '../../lib/ease'
import { cn } from '../../lib/utils'

export type DigitSwapDirection = 'up' | 'down'

export interface DigitSwapProps {
  /** Sabit karakter yuvalarında gösterilen değer; yalnızca değişen karakter kayar. */
  value: string | number
  direction?: DigitSwapDirection
  /** Karakter başına geçiş süresi (saniye). */
  duration?: number
  /** Komşu karakterler arası gecikme (saniye). */
  stagger?: number
  className?: string
  glyphClassName?: string
}

interface GlyphMotionContext {
  direction: DigitSwapDirection
  reduceMotion: boolean
}

const GLYPH_VARIANTS = {
  enter: ({ direction, reduceMotion }: GlyphMotionContext) => ({
    opacity: 0,
    transform: reduceMotion ? 'none' : `translateY(${direction === 'up' ? '45%' : '-45%'})`,
  }),
  visible: { opacity: 1, transform: 'translateY(0%)' },
  exit: ({ direction, reduceMotion }: GlyphMotionContext) => ({
    opacity: 0,
    transform: reduceMotion ? 'none' : `translateY(${direction === 'up' ? '-45%' : '45%'})`,
  }),
}

export function DigitSwap({ value, direction = 'up', duration = 0.18, stagger = 0.006, className, glyphClassName }: DigitSwapProps) {
  const reduceMotion = useReducedMotion() ?? false
  const text = String(value)
  const motionContext: GlyphMotionContext = { direction, reduceMotion }

  return (
    <span data-slot="digit-swap" className={cn('inline-flex items-center whitespace-nowrap', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {Array.from(text, (character, position) => {
          const id = `glyph-${position}`
          if (character === ' ') return <span key={id} className="inline-block w-[0.7ch]" />
          return (
            <span key={id} className="relative inline-block h-[1.1em] w-[1ch] shrink-0 overflow-hidden align-bottom">
              <AnimatePresence initial={false} custom={motionContext}>
                <motion.span
                  key={`${id}-${character}`}
                  custom={motionContext}
                  variants={GLYPH_VARIANTS}
                  initial="enter"
                  animate="visible"
                  exit="exit"
                  transition={{
                    duration: reduceMotion ? Math.min(duration, 0.12) : duration,
                    delay: reduceMotion ? 0 : position * stagger,
                    ease: EASE_OUT,
                  }}
                  className={cn('absolute inset-0 flex items-center justify-center leading-none', glyphClassName)}
                >
                  {character}
                </motion.span>
              </AnimatePresence>
            </span>
          )
        })}
      </span>
    </span>
  )
}
