import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EASE_OUT } from '../../lib/ease'
import { cn } from '../../lib/utils'

export interface NumberTickerProps {
  value: number
  /** Soldan sıfırla doldurulacak basamak sayısı. */
  pad?: number
  /** Basamak başına yuvarlanma süresi (saniye). */
  duration?: number
  /** Basamaklar arası gecikme. */
  stagger?: number
  /** Eleman görünür alana girince başlasın. */
  startOnView?: boolean
  prefix?: string
  suffix?: string
  /** Yuvarlanırken hafif bulanıklık. */
  blur?: boolean
  className?: string
  digitClassName?: string
  format?: (value: number) => string
}

const DIGIT_HEIGHT_EM = 1.1
const DIGITS = Array.from({ length: 10 }, (_, n) => n)

export function NumberTicker({
  value,
  pad,
  duration = 0.9,
  stagger = 0.04,
  startOnView = true,
  prefix,
  suffix,
  blur = false,
  className,
  digitClassName,
  format,
}: NumberTickerProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const inView = useInView(containerRef, { once: true, amount: 0.6 })
  const [armed, setArmed] = useState(!startOnView)

  useEffect(() => {
    if (startOnView && inView) setArmed(true)
  }, [startOnView, inView])

  const text = useMemo(() => {
    const rounded = Math.round(value)
    const formatted = format ? format(rounded) : rounded.toString()
    return pad ? formatted.padStart(pad, '0') : formatted
  }, [value, pad, format])

  // Basamak konumuna (sağdan) göre anahtar: değişen basamak kimliğini korur ve 0'dan
  // yeniden başlamak yerine yeni değere yuvarlanır.
  const glyphs = useMemo(() => {
    const chars = text.split('')
    return chars.map((char, i) => ({ char, id: `g-${chars.length - 1 - i}` }))
  }, [text])

  // Gecikme yalnızca ilk girişte; sonraki canlı güncellemelerde gecikme gecikmiş gibi okunur.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!armed || entered) return
    const total = (duration + glyphs.length * stagger) * 1000
    const timer = window.setTimeout(() => setEntered(true), total)
    return () => window.clearTimeout(timer)
  }, [armed, entered, duration, stagger, glyphs.length])

  return (
    <span ref={containerRef} className={cn('inline-flex items-center tabular-nums', className)}>
      <span className="sr-only">{`${prefix ?? ''}${text}${suffix ?? ''}`}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {prefix ? <span>{prefix}</span> : null}
        {glyphs.map(({ char, id }, i) =>
          /\d/.test(char) ? (
            <Digit
              key={id}
              digit={armed ? Number(char) : 0}
              delay={entered ? 0 : i * stagger}
              duration={duration}
              blur={blur}
              className={digitClassName}
            />
          ) : (
            <span key={id} className="inline-block">
              {char}
            </span>
          ),
        )}
        {suffix ? <span className="whitespace-pre">{suffix}</span> : null}
      </span>
    </span>
  )
}

interface DigitProps {
  digit: number
  delay: number
  duration: number
  blur: boolean
  className?: string
}

function Digit({ digit, delay, duration, blur, className }: DigitProps) {
  const reduce = useReducedMotion()
  const columnRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (reduce || !blur || !columnRef.current || !Number.isFinite(digit)) return
    const node = columnRef.current
    const controls = animate(
      node,
      { filter: ['blur(10px)', 'blur(0px)'] },
      { duration: Math.min(duration * 0.75, 0.32), delay, ease: EASE_OUT },
    )
    return () => {
      controls.stop()
      node.style.filter = 'blur(0px)'
    }
  }, [blur, delay, digit, duration, reduce])

  return (
    <span className={cn('relative inline-block overflow-hidden', className)} style={{ height: `${DIGIT_HEIGHT_EM}em`, width: '1ch' }}>
      <motion.span
        ref={columnRef}
        initial={{ y: 0 }}
        animate={{ y: `-${digit * DIGIT_HEIGHT_EM}em` }}
        transition={reduce ? { duration: 0 } : { duration, delay, ease: EASE_OUT }}
        className="absolute inset-x-0 top-0 flex flex-col items-center will-change-[transform,filter]"
      >
        {DIGITS.map((n) => (
          <span key={n} className="flex h-[1.1em] items-center justify-center leading-none">
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  )
}
