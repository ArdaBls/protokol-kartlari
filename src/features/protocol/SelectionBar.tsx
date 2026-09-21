import { Button } from '@heroui/react'
import { FileText, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE_OUT } from '../../lib/ease'

export type SelectionMode = 'bulk' | 'news'

interface SelectionBarProps {
  mode: SelectionMode | null
  count: number
  onPrimary: () => void
  onClear: () => void
  onCancel: () => void
}

export function SelectionBar({ mode, count, onPrimary, onClear, onCancel }: SelectionBarProps) {
  return (
    <AnimatePresence>
      {mode && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-xl items-center gap-2 rounded-full bg-overlay p-2 pl-5 text-overlay-foreground shadow-[var(--overlay-shadow)] lg:left-64"
          role="toolbar"
          aria-label="Seçim işlemleri"
        >
          <span className="min-w-0 flex-1 truncate text-sm">
            <b className="tabular-nums">{count}</b> {mode === 'bulk' ? 'kişi çöpe atılacak' : 'kişi habere eklenecek'}
          </span>
          {count > 0 && (
            <Button size="sm" variant="ghost" onPress={onClear}>Temizle</Button>
          )}
          <Button size="sm" variant={mode === 'bulk' ? 'danger' : 'primary'} isDisabled={count === 0} onPress={onPrimary}>
            {mode === 'bulk' ? <Trash2 size={14} /> : <FileText size={14} />}
            {mode === 'bulk' ? 'Çöpe at' : 'Taslak oluştur'}
          </Button>
          <Button isIconOnly size="sm" variant="tertiary" aria-label="Seçim modundan çık" onPress={onCancel}>
            <X size={16} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
