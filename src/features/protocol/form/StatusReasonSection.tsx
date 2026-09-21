import { Button } from '@heroui/react'
import { Check, Lock, UserPlus } from 'lucide-react'
import { SelectField, TextInputField } from '../../../components/formControls'
import { STATUS_REASONS, reasonKind } from '../personChanges'

interface StatusReasonSectionProps {
  reason: string
  onReasonChange: (reason: string) => void
  newTitle: string
  onNewTitleChange: (title: string) => void
  transitionDate: string
  onTransitionDateChange: (date: string) => void
  onApply: () => void
  onOpenSuccessor: () => void
}

const REASON_OPTIONS = [{ value: '', label: 'Seçiniz…' }, ...STATUS_REASONS]

export function StatusReasonSection(props: StatusReasonSectionProps) {
  const kind = reasonKind(props.reason)

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-warning-soft p-4">
      <SelectField label="Pasife alma sebebi" value={props.reason} onChange={props.onReasonChange} options={REASON_OPTIONS} />

      {kind === 'active' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">Eski unvan görev geçmişine taşınır, kişi yeni unvanıyla aktif kalır.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInputField label="Yeni unvan" value={props.newTitle} onChange={props.onNewTitleChange} placeholder="Örn. Öğretim Üyesi" />
            <TextInputField label="Geçiş tarihi" type="date" value={props.transitionDate} onChange={props.onTransitionDateChange} />
          </div>
          <Button variant="primary" onPress={props.onApply} className="self-start">
            <Check size={16} />
            Uygula
          </Button>
        </div>
      )}

      {kind !== null && (
        <Button variant="secondary" onPress={props.onOpenSuccessor} className="self-start">
          <UserPlus size={16} />
          Yerine yeni kişi ata
        </Button>
      )}

      {kind === 'passive' && (
        <p className="flex items-start gap-2 text-xs text-danger">
          <Lock size={14} className="mt-0.5 shrink-0" />
          Kaydet kilitli — önce yerine atanacak kişiyi kaydedin.
        </p>
      )}
    </div>
  )
}
