import { Modal } from '@heroui/react'
import type { ReactNode } from 'react'

interface ModalShellProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** "xl": çok alanlı formlar için geniş, iki sütuna uygun modal. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
}

const WIDE_DIALOG = 'min-w-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-5xl xl:max-w-6xl'

/**
 * Tetikleyicisiz, dışarıdan kontrol edilen modal iskeleti. İçerik yalnızca açıkken bağlanır;
 * böylece içerideki form durumu her açılışta sıfırdan başlar.
 */
export function ModalShell({ isOpen, onOpenChange, size = 'md', children }: ModalShellProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="top" size={size === 'xl' ? 'lg' : size} className="modal-safe-container">
        <Modal.Dialog className={`modal-safe-dialog min-w-0 flex flex-col ${size === 'xl' ? WIDE_DIALOG : ''}`}>
          <Modal.CloseTrigger />
          {children}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export function ModalTitle({ title, description }: { title: string; description?: string }) {
  return (
    <Modal.Header className="flex flex-col items-start gap-1 pr-10">
      <Modal.Heading>{title}</Modal.Heading>
      {description && <p className="text-sm text-muted">{description}</p>}
    </Modal.Header>
  )
}

export function ModalScrollBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Modal.Body className={`flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto overscroll-contain ${className}`}>{children}</Modal.Body>
}
