import { Button, toast } from '@heroui/react'
import { get, ref } from 'firebase/database'
import { Download, Mail } from 'lucide-react'
import { useState } from 'react'
import { downloadJson } from '../../lib/browserFiles'
import { dateKey } from '../../lib/dates'
import { dbPathFor, useDbMode } from '../../lib/dbMode'
import { db } from '../../lib/firebase'
import { SettingsRow, SettingsSection } from './SettingsSection'

const EXPORT_PATHS = ['ilProtokolVerileri', 'universiteProtokolVerileri', 'etkinlikler', 'haberProjeleri'] as const
const ACCOUNT_DELETION_MAIL = 'mailto:bilasaarda@gmail.com?subject=Hesap%20silme%20talebi'

export function DangerSection() {
  const { isTestMode } = useDbMode()
  const [isExporting, setIsExporting] = useState(false)

  const exportAll = async () => {
    setIsExporting(true)
    try {
      const snapshots = await Promise.all(EXPORT_PATHS.map((path) => get(ref(db, dbPathFor(path, isTestMode)))))
      const payload = Object.fromEntries(EXPORT_PATHS.map((path, index) => [path, snapshots[index].val()]))
      downloadJson({ ...payload, disaAktarilmaTarihi: new Date().toISOString() }, `protokol-veri-yedegi-${dateKey(new Date())}.json`)
      toast.success('Veriler indirildi.')
    } catch (err) {
      console.error('Dışa aktarma başarısız:', err)
      toast.danger('Dışa aktarma başarısız oldu.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <SettingsSection id="tehlikeli" title="Tehlikeli bölge" description="Geniş kapsamlı işlemler. Dikkatli olun." isDanger>
      <SettingsRow label="Tüm verileri dışa aktar" description="İl, Üniversite, Takvim ve haber projelerinin JSON arşivini indir.">
        <Button variant="secondary" isPending={isExporting} onPress={exportAll}>
          <Download size={16} />
          Dışa aktar
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Hesabı sil"
        description="Hesap ve ilişkili kayıtların silinmesi yönetici tarafından yapılır; kayıtlı işlem geçmişi korunarak hesabınız kapatılır."
        isDanger
      >
        <Button variant="danger-soft" onPress={() => { window.location.href = ACCOUNT_DELETION_MAIL }}>
          <Mail size={16} />
          Silme talebi gönder
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
