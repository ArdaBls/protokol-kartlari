import { Button, Input, Label, ProgressBar, TextField } from '@heroui/react'
import { remove, ref, set } from 'firebase/database'
import { Clock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DigitSwap } from '../../components/motion/DigitSwap'
import { FormModal } from '../../components/FormModal'
import { useDbValue } from '../../hooks/useDbValue'
import { useNow } from '../../hooks/useNow'
import { useWriter } from '../../hooks/useWriter'
import { dateKey, pad2 } from '../../lib/dates'
import { db } from '../../lib/firebase'
import { StatCard } from './StatCard'

interface CountdownRecord {
  hedefTarih?: string
  baslangicTarih?: string
  olusturan?: string
  baslik?: string
}

const TICK_MS = 1000
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const TITLE_MAX = 60

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Süre doldu'
  const days = Math.floor(ms / DAY_MS)
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS)
  const seconds = Math.floor((ms % MINUTE_MS) / 1000)
  return `${days}g ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

const formatTarget = (d: Date) =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`

export function CountdownCard() {
  const { data } = useDbValue<CountdownRecord>('ayarlar/sayac')
  const now = useNow(TICK_MS)
  const writer = useWriter()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [form, setForm] = useState({ title: '', date: '', time: '' })

  const target = data?.hedefTarih ? new Date(data.hedefTarih) : null
  const hasTarget = !!target && !Number.isNaN(target.getTime())
  const remaining = hasTarget ? target.getTime() - now.getTime() : 0
  const start = data?.baslangicTarih ? new Date(data.baslangicTarih).getTime() : now.getTime()
  const total = hasTarget ? target.getTime() - start : 0
  const progress = !hasTarget ? 0 : remaining <= 0 ? 100 : total > 0 ? Math.min(100, Math.max(0, ((now.getTime() - start) / total) * 100)) : 0

  const openEdit = () => {
    if (!writer.ensureWritable()) return
    setForm({
      title: data?.baslik ?? '',
      date: hasTarget ? dateKey(target) : '',
      time: hasTarget ? `${pad2(target.getHours())}:${pad2(target.getMinutes())}` : '',
    })
    setIsEditOpen(true)
  }

  const openReset = () => {
    if (!writer.ensureWritable()) return
    setIsResetOpen(true)
  }

  const saveCountdown = () => {
    if (!form.date) return false
    const actor = writer.ensureWritable()
    if (!actor) return false
    const hedefTarih = new Date(`${form.date}T${form.time || '00:00'}`).toISOString()
    const title = form.title.trim()
    const record = {
      hedefTarih,
      baslangicTarih: new Date().toISOString(),
      olusturan: actor.name || actor.email,
      ...(title ? { baslik: title } : {}),
    }
    set(ref(db, writer.path('ayarlar/sayac')), record)
      .then(() => writer.log('sayac', `Sayaç hedef tarihi ayarlandı: ${hedefTarih}`, hedefTarih))
      .catch(writer.reportError('Sayaç kaydedilemedi.'))
    return true
  }

  const resetCountdown = () => {
    if (!writer.ensureWritable()) return
    remove(ref(db, writer.path('ayarlar/sayac')))
      .then(() => writer.log('sayac', 'Sayaç sıfırlandı'))
      .catch(writer.reportError('Sayaç sıfırlanamadı.'))
  }

  return (
    <>
      <StatCard
        icon={Clock}
        iconClass="bg-accent/15 text-accent"
        label={
          <>
            <span className="truncate">{data?.baslik || 'Sayaç'}</span>
            {writer.canWrite && (
              <>
                <Button isIconOnly size="sm" variant="ghost" aria-label="Hedef tarihi ayarla" className="size-6 min-w-6" onPress={openEdit}>
                  <Pencil size={12} />
                </Button>
                {hasTarget && (
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Sayacı sıfırla" className="size-6 min-w-6" onPress={openReset}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </>
            )}
          </>
        }
        value={hasTarget ? <DigitSwap value={formatRemaining(remaining)} /> : '—'}
        sub={hasTarget ? `Hedef: ${formatTarget(target)}${data?.olusturan ? ` · ${data.olusturan}` : ''}` : 'Hedef tarih belirlenmedi'}
      >
        <ProgressBar aria-label="Sayaç ilerlemesi" value={progress} size="sm" className="mt-3">
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      </StatCard>

      <FormModal isOpen={isEditOpen} onOpenChange={setIsEditOpen} title="Sayaç" submitLabel="Kaydet" onSubmit={saveCountdown}>
        <TextField maxLength={TITLE_MAX} value={form.title} onChange={(title) => setForm((f) => ({ ...f, title }))}>
          <Label>Başlık (opsiyonel)</Label>
          <Input placeholder="Sayaç" />
        </TextField>
        <div className="grid grid-cols-2 gap-3">
          <TextField type="date" isRequired value={form.date} onChange={(date) => setForm((f) => ({ ...f, date }))}>
            <Label>Hedef tarih</Label>
            <Input />
          </TextField>
          <TextField type="time" value={form.time} onChange={(time) => setForm((f) => ({ ...f, time }))}>
            <Label>Saat (opsiyonel)</Label>
            <Input />
          </TextField>
        </div>
      </FormModal>

      <FormModal isOpen={isResetOpen} onOpenChange={setIsResetOpen} title="Sayacı sıfırla?" submitLabel="Sıfırla" isDanger onSubmit={resetCountdown}>
        <p className="text-sm text-muted">Hedef tarih silinecek, sayaç "Hedef tarih belirlenmedi" durumuna dönecek.</p>
      </FormModal>
    </>
  )
}
