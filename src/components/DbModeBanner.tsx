import { useDbMode } from '../lib/dbMode'

// Hangi dalda çalışıldığı HER ZAMAN görünür olmalı: aksi halde test verisi canlı sanılabilir.
export function DbModeBanner() {
  const { isTestMode, isReadOnly, hasError } = useDbMode()
  const parts = [
    isTestMode && '🧪 TEST MODU — değişiklikler test/ dalına yazılır, canlı veriye dokunulmaz',
    hasError && '⚠️ Veritabanı modu okunamadı — güvenlik için yazma kapatıldı',
    isReadOnly && !hasError && '🔒 SALT-OKUNUR KİLİT — veri değişikliği kapalı',
  ].filter(Boolean)

  if (!parts.length) return null

  return (
    <div
      role="status"
      className={`px-4 py-2 text-center text-xs font-semibold ${
        isReadOnly ? 'bg-danger text-danger-foreground' : 'bg-warning text-warning-foreground'
      }`}
    >
      {parts.join(' · ')}
    </div>
  )
}
