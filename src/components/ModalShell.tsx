import { Modal } from '@heroui/react'
import type { ReactNode } from 'react'

interface ModalShellProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  /** "xl": çok alanlı formlar için geniş, iki sütuna uygun modal. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
}

const WIDE_DIALOG = 'w-[calc(100vw-2rem)] max-w-5xl sm:max-w-5xl xl:max-w-6xl'

/**
 * Tetikleyicisiz, dışarıdan kontrol edilen modal iskeleti. İçerik yalnızca açıkken bağlanır;
 * böylece içerideki form durumu her açılışta sıfırdan başlar.
 */
export function ModalShell({ isOpen, onOpenChange, size = 'md', children }: ModalShellProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size={size === 'xl' ? 'lg' : size}>
        <Modal.Dialog className={`flex max-h-[92dvh] flex-col ${size === 'xl' ? WIDE_DIALOG : ''}`}>
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
  return <Modal.Body className={`flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto ${className}`}>{children}</Modal.Body>
}
