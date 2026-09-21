import { Button, Card, Input, Tabs, TextField, toast } from '@heroui/react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { FormModal } from '../../components/FormModal'
import { BottomSheet } from '../../components/motion/BottomSheet'
import { useDbValue } from '../../hooks/useDbValue'
import { FacultyFilter } from './FacultyFilter'
import { NewsModal } from './NewsModal'
import { PersonCard } from './PersonCard'
import { PersonModal } from './form/PersonModal'
import type { PageMode } from './ProtocolToolbar'
import { ProtocolToolbar } from './ProtocolToolbar'
import type { ListKey, Person, PersonRecord, StatusView } from './protocolRules'
import { LIST_LABELS, LIST_PATHS, STATUS_LABELS, compareByProtocol, isCentralAdmin, statusOf, toPeopleList } from './protocolRules'
import { ReorderBoard } from './ReorderBoard'
import { createPeopleSearch } from './searchPeople'
import { SelectionBar } from './SelectionBar'
import { useCopyGuard } from './useCopyGuard'
import { useProtocolActions } from './useProtocolActions'

type ConfirmState = { kind: 'trash' | 'deleteForever'; person: Person } | { kind: 'bulkTrash' | 'emptyTrash' } | null

const STATUS_VIEWS: StatusView[] = ['aktif', 'pasif', 'silindi']
const SKELETON_CARDS = 10
const NEWS_SELECTION_KEY = 'omuProtokolNewsSelection'
const COLUMNS_KEY = 'protokol-mobil-sutun'
const MOBILE_COLUMN_CLASS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const
const MOBILE_COLUMN_LABEL = { 2: '2li', 3: '3lü', 4: '4lü' } as const
type MobileColumns = keyof typeof MOBILE_COLUMN_CLASS

function readStorage<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key)
    return (raw === null ? null : parse(raw)) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Tercih kaydedilemese de sayfa çalışmaya devam eder (gizli pencere vb.).
  }
}

const pickPeople = (byId: ReadonlyMap<string, Person>, ids: Iterable<string>) =>
  [...ids].map((id) => byId.get(id)).filter((person): person is Person => !!person)

const toggleInSet = (set: ReadonlySet<string>, value: string) => {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function ProtocolPage() {
  useCopyGuard()
  const { state } = useAuth()
  const canBackup = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')

  const [listKey, setListKey] = useState<ListKey>('universite')
  const [statusView, setStatusView] = useState<StatusView>('aktif')
  const [query, setQuery] = useState('')
  const [selectedFaculties, setSelectedFaculties] = useState<ReadonlySet<string>>(new Set())
  const [selectedCentral, setSelectedCentral] = useState<ReadonlySet<string>>(new Set())
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [mode, setMode] = useState<PageMode>('normal')
  const [bulkSelection, setBulkSelection] = useState<ReadonlySet<string>>(new Set())
  const [newsSelection, setNewsSelection] = useState<string[]>([])
  const [editing, setEditing] = useState<{ isOpen: boolean; person: Person | null }>({ isOpen: false, person: null })
  const [isNewsOpen, setIsNewsOpen] = useState(false)
  // Onay içeriği kapanış animasyonu boyunca korunur; yalnızca görünürlük ayrı tutulur.
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [columns, setColumns] = useState<MobileColumns>(() =>
    readStorage<MobileColumns>(COLUMNS_KEY, 2, (raw) => (['2', '3', '4'].includes(raw) ? (Number(raw) as MobileColumns) : null)),
  )

  const { data, isLoading, error } = useDbValue<Record<string, PersonRecord | null> | PersonRecord[]>(LIST_PATHS[listKey])
  const people = useMemo(() => toPeopleList(data), [data])
  const peopleById = useMemo(() => new Map(people.map((person) => [person._id, person])), [people])
  const search = useMemo(() => createPeopleSearch(people), [people])
  const actions = useProtocolActions(listKey)
  const { canWrite } = actions

  const isUniversity = listKey === 'universite'
  const isSelecting = mode === 'bulk' || mode === 'news'
  const filterCount = selectedFaculties.size + selectedCentral.size
  const matches = useMemo(() => search(query), [search, query])

  const statusCounts = useMemo(() => {
    const counts: Record<StatusView, number> = { aktif: 0, pasif: 0, silindi: 0 }
    matches.forEach((person) => { counts[statusOf(person)] += 1 })
    return counts
  }, [matches])

  const visible = useMemo(() => {
    // Silinenler ve sıralama görünümünde fakülte filtresi uygulanmaz: ekranda görünmeyen kayıt işlem görmesin, tam tablo görünsün.
    const applyFacultyFilter = isUniversity && statusView !== 'silindi' && mode !== 'reorder' && filterCount > 0
    return matches
      .filter((person) => statusOf(person) === statusView)
      .filter((person) =>
        !applyFacultyFilter ||
        selectedCentral.has(person._id) ||
        (Array.isArray(person.faculties) && person.faculties.some((faculty) => selectedFaculties.has(faculty))),
      )
      .sort(compareByProtocol)
  }, [matches, statusView, isUniversity, mode, filterCount, selectedCentral, selectedFaculties])

  const centralAdmins = useMemo(
    () => people.filter((person) => statusOf(person) === 'aktif' && isCentralAdmin(person)).sort(compareByProtocol),
    [people],
  )
  const bulkPeople = useMemo(() => pickPeople(peopleById, bulkSelection), [bulkSelection, peopleById])
  const newsPeople = useMemo(() => pickPeople(peopleById, newsSelection), [newsSelection, peopleById])
  const statusViews = canWrite ? STATUS_VIEWS : STATUS_VIEWS.filter((view) => view !== 'silindi')

  const clearFilters = () => {
    setSelectedFaculties(new Set())
    setSelectedCentral(new Set())
  }

  const leaveMode = () => {
    // Haber seçimi yalnızca mod açıkken hatırlanır; moddan çıkınca sonraki alakasız etkinliğe taşınmasın diye silinir.
    if (mode === 'news') writeStorage(NEWS_SELECTION_KEY, '[]')
    setMode('normal')
    setBulkSelection(new Set())
    setNewsSelection([])
  }

  const changeMode = (next: PageMode) => {
    if (next === mode) return leaveMode()
    leaveMode()
    setStatusView('aktif')
    if (next === 'reorder') setQuery('')
    if (next === 'news') {
      const stored = readStorage<string[]>(NEWS_SELECTION_KEY, [], (raw) => {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && peopleById.has(id)) : null
      })
      setNewsSelection(stored)
      toast.info(stored.length ? `Önceki seçiminiz hatırlandı (${stored.length} kişi).` : 'Metinde geçecek kişileri seçin.')
    }
    if (next === 'bulk') toast.info('Çöpe atmak istediğiniz kişileri seçin.')
    setMode(next)
  }

  const switchList = (key: ListKey) => {
    leaveMode()
    setListKey(key)
    setStatusView('aktif')
    setQuery('')
    clearFilters()
  }

  const toggleSelect = useCallback((id: string) => {
    if (mode === 'bulk') {
      setBulkSelection((current) => toggleInSet(current, id))
      return
    }
    setNewsSelection((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
      writeStorage(NEWS_SELECTION_KEY, JSON.stringify(next))
      return next
    })
  }, [mode])

  const clearSelection = () => {
    setBulkSelection(new Set())
    setNewsSelection([])
    if (mode === 'news') writeStorage(NEWS_SELECTION_KEY, '[]')
  }

  const openConfirm = useCallback((next: NonNullable<ConfirmState>) => {
    setConfirm(next)
    setIsConfirmOpen(true)
  }, [])
  const openEdit = useCallback((person: Person) => setEditing({ isOpen: true, person }), [])
  const requestDeleteForever = useCallback((person: Person) => openConfirm({ kind: 'deleteForever', person }), [openConfirm])
  const fromModal = (kind: 'trash' | 'deleteForever') => (person: Person) => {
    setEditing({ isOpen: false, person: null })
    openConfirm({ kind, person })
  }

  const confirmCopy = confirm && {
    trash: { title: 'Çöpe at', body: `${'person' in confirm ? confirm.person.name : ''} silinenler klasörüne taşınacak.`, submit: 'Evet, çöpe at' },
    deleteForever: { title: 'Kalıcı olarak sil', body: `${'person' in confirm ? confirm.person.name : ''} veritabanından tamamen silinecek. Bu işlem geri alınamaz.`, submit: 'Kalıcı sil' },
    bulkTrash: { title: 'Toplu çöpe atma', body: `${bulkPeople.length} kaydı çöp kutusuna taşımak istediğinize emin misiniz?`, submit: 'Evet, çöpe at' },
    emptyTrash: { title: 'Çöpü tamamen boşalt', body: `Ekranda görünen ${visible.length} silinmiş kaydın tümü kalıcı olarak silinecek. Bu işlem geri alınamaz.`, submit: 'Evet, tümünü sil' },
  }[confirm.kind]

  const runConfirm = () => {
    if (!confirm) return
    if (confirm.kind === 'trash') {
      actions.trash([confirm.person])
    } else if (confirm.kind === 'deleteForever') {
      const { person } = confirm
      actions.deleteForever(person).then((ok) => { if (ok) setSelectedCentral((current) => { const next = new Set(current); next.delete(person._id); return next }) })
    } else if (confirm.kind === 'bulkTrash') {
      actions.trash(bulkPeople).then((ok) => { if (ok) leaveMode() })
    } else {
      actions.emptyTrash(visible)
    }
  }

  const filter = (
    <FacultyFilter
      centralAdmins={centralAdmins}
      selectedFaculties={selectedFaculties}
      selectedCentral={selectedCentral}
      onToggleFaculty={(faculty) => setSelectedFaculties((current) => toggleInSet(current, faculty))}
      onToggleCentral={(id) => setSelectedCentral((current) => toggleInSet(current, id))}
      onClear={clearFilters}
    />
  )

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Protokol</div>
          <h1 className="mt-1 text-2xl font-semibold">{LIST_LABELS[listKey]}</h1>
        </div>
        <Tabs selectedKey={listKey} onSelectionChange={(key) => switchList(key as ListKey)}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Protokol listesi">
              <Tabs.Tab id="universite">Üniversite<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="il">İl<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      <ProtocolToolbar
        mode={mode}
        statusView={statusView}
        canWrite={canWrite}
        canBackup={canBackup}
        trashCount={statusView === 'silindi' ? visible.length : 0}
        onAdd={() => setEditing({ isOpen: true, person: null })}
        onToggleReorder={() => changeMode('reorder')}
        onToggleNews={() => changeMode('news')}
        onToggleBulk={() => changeMode('bulk')}
        onVerifyAll={(verified) => actions.verifyMany(visible, verified)}
        onEmptyTrash={() => openConfirm({ kind: 'emptyTrash' })}
        onBackup={actions.downloadBackup}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs selectedKey={statusView} onSelectionChange={(key) => setStatusView(key as StatusView)} variant="secondary" isDisabled={mode !== 'normal'}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="Kayıt durumu">
              {statusViews.map((view) => (
                <Tabs.Tab key={view} id={view}>
                  {STATUS_LABELS[view]}
                  <span className="ml-1.5 text-xs text-muted tabular-nums">{isLoading ? '' : statusCounts[view]}</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>

        <TextField value={query} onChange={setQuery} aria-label="Kişi ara" isDisabled={mode === 'reorder'} className="relative w-full md:w-80">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-muted" />
          <Input name="protokolSearch" placeholder="İsim, unvan veya birim ara…" autoComplete="off" data-lpignore="true" data-1p-ignore className="pl-10 pr-10" />
          {query && (
            <Button isIconOnly size="sm" variant="ghost" aria-label="Aramayı temizle" onPress={() => setQuery('')} className="absolute right-1.5 top-1/2 size-7 min-w-7 -translate-y-1/2">
              <X size={14} />
            </Button>
          )}
        </TextField>
      </div>

      <div className="flex items-start gap-6">
        {isUniversity && mode !== 'reorder' && (
          <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-72 shrink-0 overflow-y-auto rounded-3xl bg-surface p-3 shadow-[var(--surface-shadow)] lg:block">
            {filter}
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted">
            <span>
              {isLoading ? 'Yükleniyor…' : `${visible.length} kayıt`}
              {filterCount > 0 && isUniversity && statusView !== 'silindi' && mode !== 'reorder' && ` · ${filterCount} filtre`}
            </span>
            {mode !== 'reorder' && (
              <div className="flex rounded-full bg-default p-0.5 sm:hidden" role="group" aria-label="Mobil sütun sayısı">
                {([2, 3, 4] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={columns === count}
                    onClick={() => { setColumns(count); writeStorage(COLUMNS_KEY, String(count)) }}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${columns === count ? 'bg-surface text-foreground shadow-sm' : ''}`}
                  >
                    {MOBILE_COLUMN_LABEL[count]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <Card>
              <Card.Header>
                <Card.Title>Liste yüklenemedi</Card.Title>
                <Card.Description>Bağlantınızı kontrol edip sayfayı yenileyin.</Card.Description>
              </Card.Header>
            </Card>
          )}

          {mode === 'reorder' && !isLoading ? (
            <ReorderBoard people={visible} onSaveOrder={actions.saveOrder} onSortByName={actions.sortGroupByName} />
          ) : (
            <div className={`grid gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5 ${MOBILE_COLUMN_CLASS[columns]}`}>
              {isLoading &&
                Array.from({ length: SKELETON_CARDS }, (_, i) => <div key={i} className="aspect-[4/6.2] animate-pulse rounded-3xl bg-surface" />)}
              {!isLoading &&
                visible.map((person) => (
                  <PersonCard
                    key={person._id}
                    person={person}
                    isSelectable={isSelecting}
                    isSelected={mode === 'bulk' ? bulkSelection.has(person._id) : newsSelection.includes(person._id)}
                    mobileColumns={columns}
                    onToggleSelect={toggleSelect}
                    onEdit={canWrite && statusView !== 'silindi' ? openEdit : undefined}
                    onRestore={canWrite && statusView === 'silindi' ? actions.restore : undefined}
                    onDeleteForever={canWrite && statusView === 'silindi' ? requestDeleteForever : undefined}
                  />
                ))}
            </div>
          )}

          {!isLoading && !error && visible.length === 0 && (
            <Card className="items-center py-10 text-center">
              <Card.Header className="items-center">
                <Card.Title>Kayıt yok</Card.Title>
                <Card.Description>{query ? 'Aramanızla eşleşen kişi bulunamadı.' : 'Arama veya filtre ölçütünüzü değiştirmeyi deneyin.'}</Card.Description>
              </Card.Header>
            </Card>
          )}
        </div>
      </div>

      {isUniversity && mode === 'normal' && (
        <>
          <Button variant="primary" aria-label="Fakülte filtresi" onPress={() => setIsFilterSheetOpen(true)} className="fixed bottom-5 right-5 z-30 h-12 rounded-full px-5 shadow-lg lg:hidden">
            <SlidersHorizontal size={18} />
            Filtre
            {filterCount > 0 && <span className="rounded-full bg-accent-foreground/20 px-1.5 text-xs tabular-nums">{filterCount}</span>}
          </Button>
          <BottomSheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen} title="Fakülte / Birim Filtresi" snapPoints={[0.7, 0.92]}>
            {filter}
          </BottomSheet>
        </>
      )}

      <SelectionBar
        mode={isSelecting ? mode : null}
        count={mode === 'bulk' ? bulkPeople.length : newsPeople.length}
        onPrimary={() => (mode === 'bulk' ? openConfirm({ kind: 'bulkTrash' }) : setIsNewsOpen(true))}
        onClear={clearSelection}
        onCancel={leaveMode}
      />

      <PersonModal
        isOpen={editing.isOpen}
        onOpenChange={(isOpen) => setEditing((current) => ({ ...current, isOpen }))}
        listKey={listKey}
        person={editing.person}
        people={people}
        onRequestTrash={fromModal('trash')}
      />

      <NewsModal isOpen={isNewsOpen} onOpenChange={setIsNewsOpen} people={newsPeople} />

      <FormModal
        isOpen={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={confirmCopy?.title ?? ''}
        submitLabel={confirmCopy?.submit ?? ''}
        isDanger
        onSubmit={runConfirm}
      >
        <p className="text-sm text-muted">{confirmCopy?.body}</p>
      </FormModal>
    </div>
  )
}
