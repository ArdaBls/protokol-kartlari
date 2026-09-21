import { Button, Modal } from '@heroui/react'
import type { FormEvent, ReactNode } from 'react'

interface FormModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  title: string
  submitLabel: string
  isDanger?: boolean
  /** false dönerse modal açık kalır (ör. doğrulama hatası). */
  onSubmit: () => boolean | void
  children: ReactNode
}

export function FormModal({ isOpen, onOpenChange, title, submitLabel, isDanger, onSubmit, children }: FormModalProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (onSubmit() !== false) onOpenChange(false)
  }

  // Modal kökü (DialogTrigger) açık durumunu bir tetikleyiciden okur ve Backdrop'a verilen
  // isOpen'ı yok sayar; tetikleyicisiz kontrollü kullanımda Backdrop tek başına kullanılır.
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <form onSubmit={handleSubmit}>
              <Modal.Header>
                <Modal.Heading>{title}</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">{children}</Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" slot="close">
                  Vazgeç
                </Button>
                <Button type="submit" variant={isDanger ? 'danger' : 'primary'}>
                  {submitLabel}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
  )
}
