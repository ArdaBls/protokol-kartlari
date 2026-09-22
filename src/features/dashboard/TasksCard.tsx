import { Avatar, Button, Card, Checkbox, Chip, Input, Label, TextField, toast } from '@heroui/react'
import { push, ref, remove, serverTimestamp, set, update } from 'firebase/database'
import { MapPinned, Plus, Ticket, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FormModal } from '../../components/FormModal'
import { EventModal } from '../calendar/EventModal'
import type { CalendarEventWithId } from '../calendar/calendarTypes'
import { QUICK_DRAFT_NAME, minToHm } from '../calendar/calendarTypes'
import { useCalendarWriter } from '../calendar/useCalendarWriter'
import { useDbValue } from '../../hooks/useDbValue'
import { useWriter } from '../../hooks/useWriter'
import { dateKey, formatShortDateKey } from '../../lib/dates'
import { db } from '../../lib/firebase'
import { initials } from '../../lib/roles'

type TaskStatus = 'planlandi' | 'yaziliyor' | 'incelemede' | 'tamamlandi'

interface TaskRecord {
  metin?: string
  tarih?: string | null
  tamamlandi?: boolean
  durum?: TaskStatus
  tamamlayan?: string | null
}

type Task = TaskRecord & { id: string }

const TEXT_MAX = 200
const NO_DATE = '9999-99-99'

const STATUS_CHIPS: Partial<Record<TaskStatus, { label: string; color: 'accent' | 'warning' | 'success' }>> = {
  yaziliyor: { label: 'Haber yazılıyor', color: 'accent' },
  incelemede: { label: 'İncelemede', color: 'warning' },
  tamamlandi: { label: 'Tamamlandı', color: 'success' },
}

export function TasksCard({ hasConcertTicket = false, onOpenConcertTicket }: { hasConcertTicket?: boolean; onOpenConcertTicket?: () => void }) {
  const { data, isLoading, error } = useDbValue<Record<string, TaskRecord | null>>('gorevler')
  const writer = useWriter()
  const calendarWriter = useCalendarWriter()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [draft, setDraft] = useState({ text: '', date: '' })
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null)
  const [quickEntry, setQuickEntry] = useState<[string, CalendarEventWithId] | null>(null)
  const [isCreatingQuick, setIsCreatingQuick] = useState(false)

  // Eski sitedeki "📍 Bir Etkinliğe Gidiyorum" -- saha kullanımında Takvim'e gitmeden şu andan
  // +1 saatlik, "(Düzenlenmeye muhtaç)" adlı bir taslak etkinlik ANINDA oluşturulur ve düzenleme
  // modalı hemen açılır; kullanıcı modalı hiçbir şey değiştirmeden kapatsa bile taslak kalıcıdır.
  const createQuickEvent = async () => {
    setIsCreatingQuick(true)
    try {
      const now = new Date()
      const end = new Date(now.getTime() + 60 * 60000)
      const patch = {
        ad: QUICK_DRAFT_NAME, tur: 'diger', durum: 'planlandi',
        tarih: dateKey(now), saat: minToHm(now.getHours() * 60 + now.getMinutes()), bitisSaat: minToHm(end.getHours() * 60 + end.getMinutes()),
        yer: '', birim: '', planlayan: '', gorevli: '', haberYazanlari: '', katilimcilar: [], not: '', rozetler: [], haberKaynagi: '',
        taslak: true,
      }
      const id = await calendarWriter.persistEvent(null, patch, `${QUICK_DRAFT_NAME} taslak etkinliği oluşturuldu ("Bir Etkinliğe Gidiyorum")`, undefined)
      if (id) {
        toast.success('Taslak etkinlik oluşturuldu.')
        setQuickEntry([id, { ...patch, _id: id }])
      }
    } finally {
      setIsCreatingQuick(false)
    }
  }

  const tasks = useMemo<Task[]>(
    () =>
      Object.entries(data ?? {})
        .flatMap(([id, task]) => (task ? [{ ...task, id }] : []))
        .sort((a, b) => (a.tarih || NO_DATE).localeCompare(b.tarih || NO_DATE)),
    [data],
  )
  const remaining = tasks.filter((task) => !task.tamamlandi).length

  const toggleTask = (task: Task, isDone: boolean) => {
    const actor = writer.ensureWritable()
    if (!actor) return
    update(ref(db, writer.path(`gorevler/${task.id}`)), {
      tamamlandi: isDone,
      durum: isDone ? 'tamamlandi' : 'planlandi',
      tamamlayan: isDone ? actor.name || actor.email : null,
      tamamlayanEmail: isDone ? actor.email : null,
      tamamlayanUid: isDone ? actor.uid : null,
      guncellemeTs: serverTimestamp(),
    }).catch(writer.reportError('Görev güncellenemedi.'))
  }

  const openAdd = () => {
    if (!writer.ensureWritable()) return
    setDraft({ text: '', date: '' })
    setIsAddOpen(true)
  }

  const addTask = () => {
    const metin = draft.text.trim()
    if (!metin) return false
    const actor = writer.ensureWritable()
    if (!actor) return false
    set(push(ref(db, writer.path('gorevler'))), {
      metin,
      tarih: draft.date || null,
      tamamlandi: false,
      durum: 'planlandi',
      olusturan: actor.name || actor.email,
      olusturanEmail: actor.email,
      createdAt: serverTimestamp(),
      guncellemeTs: serverTimestamp(),
    })
      .then(() => writer.log('gorev', `Yeni görev eklendi: "${metin}"`, metin))
      .catch(writer.reportError('Görev eklenemedi.'))
    return true
  }

  const deleteTask = () => {
    const task = pendingDelete
    if (!task || !writer.ensureWritable()) return
    remove(ref(db, writer.path(`gorevler/${task.id}`)))
      .then(() => writer.log('gorev', `Görev silindi: "${task.metin ?? ''}"`, task.metin ?? ''))
      .catch(writer.reportError('Görev silinemedi.'))
  }

  const subtitle = isLoading ? 'Yükleniyor…' : tasks.length ? `${remaining} / ${tasks.length} tamamlanmadı` : ''

  return (
    <Card className="h-[402px]">
      <Card.Header className="flex flex-row items-start justify-between gap-4">
        <div>
          <Card.Title>Görevler</Card.Title>
          {subtitle && <Card.Description>{subtitle}</Card.Description>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {hasConcertTicket && onOpenConcertTicket && (
            <Button isIconOnly size="sm" variant="secondary" aria-label="Bugünün konser biletini aç" className="concert-ticket-chip size-8 min-w-8" onPress={onOpenConcertTicket}>
              <Ticket size={16} />
            </Button>
          )}
          {writer.canWrite && (
            <Button isIconOnly size="sm" variant="secondary" aria-label="Bir Etkinliğe Gidiyorum" isPending={isCreatingQuick} onPress={createQuickEvent}>
              <MapPinned size={16} />
            </Button>
          )}
          {writer.canWrite && (
            <Button isIconOnly size="sm" variant="primary" aria-label="Yeni görev ekle" onPress={openAdd}>
              <Plus size={16} />
            </Button>
          )}
        </div>
      </Card.Header>
      <Card.Content className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {error && <p className="py-3 text-sm text-danger">Görevler yüklenemedi.</p>}
        <ul className="flex flex-col">
          {tasks.map((task) => {
            const chip = task.durum ? STATUS_CHIPS[task.durum] : undefined
            return (
              <li key={task.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-separator py-2.5 last:border-b-0">
                <Checkbox
                  isSelected={!!task.tamamlandi}
                  isDisabled={!writer.canWrite}
                  onChange={(isDone) => toggleTask(task, isDone)}
                  aria-label={task.metin ?? 'Görev'}
                >
                  {/* Content, tıklanabilir label'ı ve gizli input'u render eder; onsuz checkbox tıklanmaz. */}
                  <Checkbox.Content>
                    <Checkbox.Control className="border border-border">
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                  </Checkbox.Content>
                </Checkbox>
                <span className={`min-w-0 flex-1 truncate text-sm ${task.tamamlandi ? 'text-muted line-through' : ''}`}>
                  {task.metin}
                </span>
                {chip && (
                  <Chip size="sm" variant="soft" color={chip.color}>
                    {chip.label}
                  </Chip>
                )}
                {task.tamamlandi && task.tamamlayan && (
                  <Avatar size="sm" color="success" className="size-6" title={task.tamamlayan}>
                    <Avatar.Fallback className="text-[10px]">{initials(task.tamamlayan)}</Avatar.Fallback>
                  </Avatar>
                )}
                {task.tarih && (
                  <span className="w-12 shrink-0 text-right text-xs text-muted tabular-nums">{formatShortDateKey(task.tarih)}</span>
                )}
                {writer.canWrite && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label="Görevi sil"
                    className="size-7 min-w-7 opacity-60 group-hover:opacity-100"
                    onPress={() => writer.ensureWritable() && setPendingDelete(task)}
                  >
                    <X size={14} />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Card.Content>

      <FormModal isOpen={isAddOpen} onOpenChange={setIsAddOpen} title="Yeni görev" submitLabel="Ekle" onSubmit={addTask}>
        <TextField isRequired autoFocus maxLength={TEXT_MAX} value={draft.text} onChange={(text) => setDraft((d) => ({ ...d, text }))}>
          <Label>Görev</Label>
          <Input placeholder="Ör. Haber taslağını gözden geçir" />
        </TextField>
        <TextField type="date" value={draft.date} onChange={(date) => setDraft((d) => ({ ...d, date }))}>
          <Label>Tarih (opsiyonel)</Label>
          <Input />
        </TextField>
      </FormModal>

      <FormModal
        isOpen={pendingDelete !== null}
        onOpenChange={(isOpen) => !isOpen && setPendingDelete(null)}
        title="Görevi sil?"
        submitLabel="Sil"
        isDanger
        onSubmit={deleteTask}
      >
        <p className="text-sm text-muted">"{pendingDelete?.metin}" görevi kalıcı olarak silinecek.</p>
      </FormModal>

      <EventModal isOpen={quickEntry !== null} onOpenChange={(isOpen) => { if (!isOpen) setQuickEntry(null) }} entry={quickEntry} />
    </Card>
  )
}
