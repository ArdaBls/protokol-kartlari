import { Button } from '@heroui/react'
import { ArrowUpDown, BadgeCheck, BadgeX, Check, Download, FileText, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { StatusView } from './protocolRules'

export type PageMode = 'normal' | 'reorder' | 'bulk' | 'news'

interface ProtocolToolbarProps {
  mode: PageMode
  statusView: StatusView
  canWrite: boolean
  canBackup: boolean
  trashCount: number
  onAdd: () => void
  onToggleReorder: () => void
  onToggleNews: () => void
  onToggleBulk: () => void
  onVerifyAll: (verified: boolean) => void
  onEmptyTrash: () => void
  onBackup: () => void
}

const MENU_ITEM = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-default-soft'
const PANEL_WIDTH = 256

/** Araç çubuğu her görünümde aynı yüksekliği korur; sekme değişince altındaki panel ve kartlar kaymaz. */
function ToolbarRow({ children }: { children?: ReactNode }) {
  return <div className="flex min-h-10 flex-wrap items-center gap-2">{children}</div>
}

/** "Diğer" açılır menüsü -- konumu JS ile hesaplanıp `fixed` yerleştirilir, çünkü tetikleyici buton
 * telefonda ekranın sağ kenarına yakın olmayabilir: CSS-only `absolute right-0` o durumda panelin
 * sol kenarının ekran dışına taşmasına yol açıyordu (kullanıcı bulgusu: "modal ekrandan çıkıyor"). */
function OtherMenu({ canWrite, canBackup, onVerifyAll, onToggleBulk, onBackup }: {
  canWrite: boolean; canBackup: boolean; onVerifyAll: (v: boolean) => void; onToggleBulk: () => void; onBackup: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8)
      setPos({ top: rect.bottom + 6, left })
    }
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const item = (onClick: () => void, icon: ReactNode, label: string, danger?: boolean) => (
    <button type="button" className={`${MENU_ITEM} ${danger ? 'text-danger' : ''}`} onClick={() => { onClick(); setIsOpen(false) }}>
      {icon}
      {label}
    </button>
  )

  return (
    <>
      <Button ref={triggerRef} variant="secondary" size="sm" isIconOnly={false} onPress={() => (isOpen ? setIsOpen(false) : open())} aria-haspopup="menu" aria-expanded={isOpen}>
        <MoreHorizontal size={16} />
        <span className="hidden sm:inline">Diğer</span>
      </Button>
      {isOpen && (
        <div
          ref={panelRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH }}
          className="z-30 flex flex-col gap-0.5 rounded-2xl bg-overlay p-1.5 shadow-[var(--overlay-shadow)]"
        >
          {canWrite && (
            <>
              {item(() => onVerifyAll(true), <BadgeCheck size={16} className="text-success" />, 'Görünenlerin hepsini doğrula')}
              {item(() => onVerifyAll(false), <BadgeX size={16} className="text-warning" />, 'Doğrulanmadı olarak işaretle')}
              {item(onToggleBulk, <Trash2 size={16} />, 'Toplu çöpe at', true)}
            </>
          )}
          {canBackup && item(onBackup, <Download size={16} />, 'Tam yedek indir (JSON)')}
        </div>
      )}
    </>
  )
}

export function ProtocolToolbar(props: ProtocolToolbarProps) {
  const { mode, statusView, canWrite, canBackup } = props

  if (mode === 'reorder') {
    return (
      <ToolbarRow>
        <span className="text-sm text-muted">Sıralama modu · değişiklikler bırakır bırakmaz kaydedilir</span>
        <Button variant="primary" className="ml-auto" onPress={props.onToggleReorder}>
          <Check size={16} />
          Bitti
        </Button>
      </ToolbarRow>
    )
  }

  if (mode !== 'normal') {
    return (
      <ToolbarRow>
        <span className="text-sm text-muted">
          {mode === 'bulk' ? 'Çöpe atılacak kişileri seçin' : 'Habere eklenecek kişileri seçin'} · alttaki çubuktan devam edin
        </span>
      </ToolbarRow>
    )
  }

  if (statusView === 'silindi') {
    return (
      <ToolbarRow>
        {canWrite && (
          <Button variant="danger-soft" isDisabled={props.trashCount === 0} onPress={props.onEmptyTrash}>
            <Trash2 size={16} />
            Çöp kutusunu boşalt
          </Button>
        )}
      </ToolbarRow>
    )
  }

  return (
    <div className="flex min-h-10 flex-nowrap items-center gap-1.5 overflow-x-auto sm:gap-2">
      {canWrite && (
        <Button variant="primary" size="sm" className="shrink-0" onPress={props.onAdd}>
          <Plus size={16} />
          <span className="hidden sm:inline">Yeni kişi</span>
        </Button>
      )}
      <Button variant="secondary" size="sm" className="shrink-0" onPress={props.onToggleNews}>
        <FileText size={16} />
        <span className="hidden sm:inline">Haber çıktısı</span>
      </Button>
      {canWrite && (
        <Button variant="secondary" size="sm" className="shrink-0" onPress={props.onToggleReorder}>
          <ArrowUpDown size={16} />
          <span className="hidden sm:inline">Sıralamayı düzenle</span>
          <span className="sm:hidden">Sırala</span>
        </Button>
      )}
      {(canWrite || canBackup) && (
        <div className="ml-auto shrink-0">
          <OtherMenu canWrite={canWrite} canBackup={canBackup} onVerifyAll={props.onVerifyAll} onToggleBulk={props.onToggleBulk} onBackup={props.onBackup} />
        </div>
      )}
    </div>
  )
}
