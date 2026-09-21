import { toast } from '@heroui/react'
import { get, ref, set } from 'firebase/database'
import { useState } from 'react'
import { FormModal } from '../../components/FormModal'
import { useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { SettingsRow, SettingsSection, SwitchButton } from './SettingsSection'

// Test ortamı açılırken bu dalların gerçek verisinin TAZE kopyası test/ altına yazılır (eski panelle aynı liste).
const CLONE_PATHS = ['ilProtokolVerileri', 'universiteProtokolVerileri', 'etkinlikler', 'basinGorevlileri', 'haberProjeleri']

export function TestModeSection() {
  const { isReady, isTestMode, hasError } = useDbMode()
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const applyTestMode = async (next: boolean) => {
    setIsBusy(true)
    try {
      if (next) {
        toast.info('Test ortamı hazırlanıyor…')
        const snapshots = await Promise.all(CLONE_PATHS.map((path) => get(ref(db, path))))
        await Promise.all(CLONE_PATHS.map((path, index) => set(ref(db, `test/${path}`), snapshots[index].val())))
      }
      await set(ref(db, 'ayarlar/testModuAcik'), next)
      toast.success(next ? 'Test modu açıldı.' : 'Test modu kapatıldı.')
    } catch (err) {
      console.error('Test modu değiştirilemedi:', err)
      toast.danger('Test modu değiştirilemedi.')
    } finally {
      setIsBusy(false)
    }
  }

  const status = hasError
    ? 'Durum okunamadı.'
    : !isReady
      ? 'Durum kontrol ediliyor…'
      : isTestMode
        ? 'Açık — site şu anda paylaşımlı test verisini gösteriyor.'
        : 'Kapalı — site gerçek veriyi gösteriyor.'

  return (
    <SettingsSection
      id="test-modu"
      title="Test Modu"
      description="Paylaşımlı bir test ortamı — açıkken siteyi ziyaret eden HERKES (sahadaki ekip dahil) gerçek verinin yerine geçici bir kopyasını görür."
    >
      <SettingsRow
        label="Paylaşımlı test ortamı"
        description={
          <>
            Açıkken gerçek İl/Üniversite/Etkinlik verisinin taze bir kopyası ayrı bir test alanına klonlanır; yapılan hiçbir değişiklik gerçek
            veriye dokunmaz. Kapatınca site otomatik olarak gerçek veriye döner.
            <span className={`mt-2 block font-medium ${isTestMode ? 'text-warning' : 'text-foreground/80'}`}>{status}</span>
          </>
        }
      >
        <SwitchButton
          isOn={isTestMode}
          isDisabled={!isReady || hasError || isBusy}
          label="Test modunu aç/kapat"
          onToggle={() => (isTestMode ? applyTestMode(false) : setIsConfirmOpen(true))}
        />
      </SettingsRow>

      <FormModal isOpen={isConfirmOpen} onOpenChange={setIsConfirmOpen} title="Test ortamı açılsın mı?" submitLabel="Evet, aç" onSubmit={() => { applyTestMode(true) }}>
        <p className="text-sm text-muted">
          Siteyi ziyaret eden <b className="text-foreground">herkes</b> (sahadaki ekip dahil) gerçek verinin yerine geçici bir kopyasını görecek.
          Açılışta gerçek verinin taze bir kopyası test alanına yazılır.
        </p>
      </FormModal>
    </SettingsSection>
  )
}
