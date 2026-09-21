import { Button, Modal, toast } from '@heroui/react'
import { get, push, ref, serverTimestamp, set, update } from 'firebase/database'
import { Download, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { ModalScrollBody, ModalShell, ModalTitle } from '../../components/ModalShell'
import { downloadJson } from '../../lib/browserFiles'
import { dateKey } from '../../lib/dates'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import type { ImportEntry } from './jsonImport'
import { buildFullRestore, buildMerge, parsePeopleFile, sanitizeEvents } from './jsonImport'
import { SettingsRow, SettingsSection } from './SettingsSection'

type CategoryKey = 'il' | 'universite' | 'takvim'

const CATEGORIES: ReadonlyArray<{ key: CategoryKey; label: string; description: string; path: string; fileLabel: string }> = [
  { key: 'il', label: 'İl Protokolü', description: 'İl Protokol Sırası listesinin JSON yedeği', path: 'ilProtokolVerileri', fileLabel: 'İl-Protokol-Listesi' },
  { key: 'universite', label: 'Üniversite Protokolü', description: 'Üniversite Protokol Sırası listesinin JSON yedeği', path: 'universiteProtokolVerileri', fileLabel: 'Üniversite-Protokol-Listesi' },
  { key: 'takvim', label: 'Takvim', description: 'Etkinlik takviminin JSON yedeği — geri yükleme her zaman TAMAMEN GERİ YÜKLE olarak çalışır', path: 'etkinlikler', fileLabel: 'Etkinlik-Takvimi-Yedek' },
]

type ImportState =
  | { kind: 'people-mode'; category: (typeof CATEGORIES)[number]; entries: ImportEntry[] }
  | { kind: 'people-full'; category: (typeof CATEGORIES)[number]; entries: ImportEntry[]; existingCount: number }
  | { kind: 'events'; clean: Record<string, unknown>; kept: number; skipped: number; existingCount: number }

export function JsonSection() {
  const { state: auth } = useAuth()
  const { isTestMode, isReadOnly } = useDbMode()
  const inputs = useRef<Partial<Record<CategoryKey, HTMLInputElement | null>>>({})
  const [busyKey, setBusyKey] = useState<CategoryKey | null>(null)
  const [pending, setPending] = useState<ImportState | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const path = (base: string) => dbPathFor(base, isTestMode)
  const newKey = (base: string) => () => push(ref(db, path(base))).key ?? `-local${Date.now().toString(36)}`
  const openModal = (next: ImportState) => { setPending(next); setIsModalOpen(true) }

  const ensureWritable = () => {
    if (!isReadOnly) return true
    toast.danger('Salt-okunur kilit açıkken JSON içe aktarılamaz.')
    return false
  }

  const download = async (category: (typeof CATEGORIES)[number]) => {
    setBusyKey(category.key)
    try {
      const value = (await get(ref(db, path(category.path)))).val() ?? {}
      if (category.key === 'takvim') {
        downloadJson({ yedekTarihi: new Date().toISOString(), kayitSayisi: Object.keys(value).length, etkinlikler: value }, `${category.fileLabel}-${dateKey(new Date())}.json`)
      } else {
        downloadJson(value, `${category.fileLabel}.json`)
      }
      toast.success('JSON yedeği indirildi.')
    } catch (err) {
      console.error('JSON indirilemedi:', err)
      toast.danger('JSON indirilemedi.')
    } finally {
      setBusyKey(null)
    }
  }

  const readFile = async (category: (typeof CATEGORIES)[number], file?: File) => {
    const input = inputs.current[category.key]
    if (input) input.value = ''
    if (!file || !ensureWritable()) return
    try {
      const raw = await file.text()
      if (category.key === 'takvim') {
        const result = sanitizeEvents(raw, newKey('etkinlikler'), serverTimestamp())
        if (!result) return toast.danger('Format hatalı.')
        if (!result.kept) return toast.danger('Yedekte geçerli etkinlik bulunamadı.')
        const existingCount = Object.keys((await get(ref(db, path('etkinlikler')))).val() ?? {}).length
        openModal({ kind: 'events', ...result, existingCount })
        return
      }
      const entries = parsePeopleFile(raw)
      if (!entries) return toast.danger('Format hatalı.')
      openModal({ kind: 'people-mode', category, entries })
    } catch (err) {
      console.error('JSON dosyası okunamadı:', err)
      toast.danger('Dosya hatalı veya bozuk!')
    }
  }

  const merge = async (category: (typeof CATEGORIES)[number], entries: ImportEntry[]) => {
    setIsModalOpen(false)
    try {
      const existing = (await get(ref(db, path(category.path)))).val() ?? {}
      const { patch, skipped, matchCount, newCount } = buildMerge(entries, existing, newKey(category.path))
      if (!Object.keys(patch).length) return toast.danger('İçe aktarılacak geçerli kayıt yok.')
      await update(ref(db, path(category.path)), patch)
      toast.success(`${matchCount} kayıt güncellendi, ${newCount} kayıt eklendi.${skipped ? ` ${skipped} geçersiz satır atlandı.` : ''}`)
    } catch (err) {
      console.error('JSON içe aktarılamadı:', err)
      toast.danger('JSON içe aktarılamadı.')
    }
  }

  const askFullRestore = async (category: (typeof CATEGORIES)[number], entries: ImportEntry[]) => {
    try {
      const existingCount = Object.keys((await get(ref(db, path(category.path)))).val() ?? {}).length
      setPending({ kind: 'people-full', category, entries, existingCount })
    } catch (err) {
      console.error('Mevcut liste okunamadı:', err)
      toast.danger('Mevcut liste okunamadı, işlem iptal edildi.')
      setIsModalOpen(false)
    }
  }

  const fullRestore = async (category: (typeof CATEGORIES)[number], entries: ImportEntry[]) => {
    setIsModalOpen(false)
    const { records, skipped } = buildFullRestore(entries, newKey(category.path))
    if (!Object.keys(records).length) return toast.danger('İçe aktarılacak geçerli kayıt yok.')
    try {
      await set(ref(db, path(category.path)), records)
      toast.success(`${Object.keys(records).length} kayıtla liste tamamen değiştirildi.${skipped ? ` ${skipped} geçersiz satır atlandı.` : ''}`)
    } catch (err) {
      console.error('JSON içe aktarılamadı:', err)
      toast.danger('JSON içe aktarılamadı.')
    }
  }

  const restoreEvents = async (clean: Record<string, unknown>, kept: number, skipped: number) => {
    setIsModalOpen(false)
    try {
      await set(ref(db, path('etkinlikler')), clean)
      if (auth.status === 'ready') {
        set(push(ref(db, path('logs/etkinlik'))), {
          by: auth.displayName,
          email: auth.user.email ?? '',
          action: `Etkinlik takvimi JSON yedekten geri yüklendi (${kept} kayıt${skipped ? `, ${skipped} geçersiz satır atlandı` : ''})`,
          target: '',
          timestamp: serverTimestamp(),
        }).catch((err) => console.error('Log yazılamadı:', err))
      }
      toast.success(`${kept} etkinlik geri yüklendi.${skipped ? ` ${skipped} geçersiz satır atlandı.` : ''}`)
    } catch (err) {
      console.error('Etkinlikler içe aktarılamadı:', err)
      toast.danger('Etkinlikler içe aktarılamadı.')
    }
  }

  return (
    <SettingsSection
      id="json"
      title="JSON"
      description="Her kategori için ayrı yedek indirme ve JSON'dan geri yükleme. Birleştir: eşleşen kayıtlar güncellenir, yeni olanlar eklenir. Tamamen geri yükle: mevcut tüm kayıtlar silinir, geri alınamaz."
    >
      {CATEGORIES.map((category) => (
        <SettingsRow key={category.key} label={category.label} description={category.description}>
          <Button size="sm" variant="secondary" onPress={() => ensureWritable() && inputs.current[category.key]?.click()}>
            <Upload size={14} />
            JSON yükle
          </Button>
          <Button size="sm" variant="secondary" isPending={busyKey === category.key} onPress={() => download(category)}>
            <Download size={14} />
            JSON indir
          </Button>
          <input
            ref={(element) => { inputs.current[category.key] = element }}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => readFile(category, event.target.files?.[0])}
          />
        </SettingsRow>
      ))}

      <ModalShell isOpen={isModalOpen} onOpenChange={setIsModalOpen} size="md">
        {pending?.kind === 'people-mode' && (
          <>
            <ModalTitle title="İçe aktarma modu" description={`${pending.category.label} · dosyada ${pending.entries.length} satır`} />
            <ModalScrollBody>
              <button type="button" onClick={() => merge(pending.category, pending.entries)} className="rounded-2xl border border-separator bg-surface-secondary/40 p-4 text-left hover:border-accent/50">
                <div className="font-medium">Birleştir (önerilen)</div>
                <div className="mt-1 text-sm text-muted">Eşleşen kayıtlar güncellenir, yeni olanlar eklenir; listedeki diğer kayıtlara dokunulmaz.</div>
              </button>
              <button type="button" onClick={() => askFullRestore(pending.category, pending.entries)} className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-left hover:border-danger/60">
                <div className="font-medium text-danger">Tamamen geri yükle</div>
                <div className="mt-1 text-sm text-muted">Mevcut listedeki TÜM kayıtlar silinir, yalnızca bu dosyadaki kayıtlar kalır. Geri alınamaz.</div>
              </button>
            </ModalScrollBody>
            <Modal.Footer><Button variant="tertiary" slot="close">Vazgeç</Button></Modal.Footer>
          </>
        )}
        {pending?.kind === 'people-full' && (
          <>
            <ModalTitle title="Tamamen geri yüklensin mi?" description={pending.category.label} />
            <ModalScrollBody>
              <p className="text-sm text-muted">
                Mevcut <b className="text-foreground">{pending.existingCount} kayıt SİLİNECEK</b> ve yerine bu dosyadaki kayıtlar yazılacak. Bu işlem geri alınamaz.
              </p>
            </ModalScrollBody>
            <Modal.Footer>
              <Button variant="tertiary" slot="close">Vazgeç</Button>
              <Button variant="danger" onPress={() => fullRestore(pending.category, pending.entries)}>Evet, tamamen geri yükle</Button>
            </Modal.Footer>
          </>
        )}
        {pending?.kind === 'events' && (
          <>
            <ModalTitle title="Takvim geri yüklensin mi?" description={`Yedekte ${pending.kept} geçerli etkinlik${pending.skipped ? `, ${pending.skipped} geçersiz satır` : ''}`} />
            <ModalScrollBody>
              <p className="text-sm text-muted">
                Bu yedek, veritabanındaki <b className="text-foreground">mevcut tüm etkinliklerin ({pending.existingCount} kayıt)</b> yerine geçecek. Bu işlem geri alınamaz.
              </p>
            </ModalScrollBody>
            <Modal.Footer>
              <Button variant="tertiary" slot="close">Vazgeç</Button>
              <Button variant="danger" onPress={() => restoreEvents(pending.clean, pending.kept, pending.skipped)}>Evet, geri yükle</Button>
            </Modal.Footer>
          </>
        )}
      </ModalShell>
    </SettingsSection>
  )
}
