import { toast } from '@heroui/react'
import { useEffect, useRef } from 'react'

// Caydırıcı katman: tarayıcıya inen içerik tamamen gizlenemez; asıl koruma yasal bildirim ve veritabanı kurallarıdır.
const EXEMPT_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-copy-allowed]'
const WARN_INTERVAL_MS = 3000
const OWNER = 'Arda Bilasa'

const isExempt = (target: EventTarget | null) => target instanceof Element && !!target.closest(EXEMPT_SELECTOR)

export function useCopyGuard() {
  const lastWarnRef = useRef(0)

  useEffect(() => {
    const warn = (message: string) => {
      const now = Date.now()
      if (now - lastWarnRef.current < WARN_INTERVAL_MS) return
      lastWarnRef.current = now
      toast.danger(message)
    }
    const onContextMenu = (event: MouseEvent) => {
      if (isExempt(event.target)) return
      event.preventDefault()
      warn(`Bu içerik telif hakkıyla korunmaktadır (© ${OWNER}).`)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isExempt(event.target)) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && (key === 'u' || key === 's')) {
        event.preventDefault()
        warn('Bu sayfanın kaynağı telif hakkıyla korunmaktadır.')
      }
    }
    const onDragStart = (event: DragEvent) => {
      if (event.target instanceof HTMLImageElement) event.preventDefault()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('dragstart', onDragStart)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('dragstart', onDragStart)
    }
  }, [])
}
