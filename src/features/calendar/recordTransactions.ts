/** Küçük kayıt transaction'ları: Firebase adaptörü ve çevrimdışı regresyon testleri aynı akışı kullanır. */
export interface RecordStore<T> {
  read: () => Promise<T | null>
  transact: (change: (current: T | null) => T | null | undefined) => Promise<{ committed: boolean; value: T | null }>
}

export class MissingRecordError extends Error {
  constructor() { super('Kayıt artık mevcut değil.') }
}

export function assertRecordWriteMode(path: string, mode: { isReady: boolean; hasError: boolean; isReadOnly: boolean; isTestMode: boolean }) {
  if (!mode.isReady || mode.hasError || mode.isReadOnly || mode.isTestMode !== path.startsWith('test/')) {
    throw new Error('Veritabanı modu değişti veya salt-okunur kilit açık. Yeniden deneyin.')
  }
}

export async function mutateExistingRecord<T>(store: RecordStore<T>, change: (current: T) => T | null): Promise<T | null> {
  // Okuma hatasını boş kayıt sayma; özellikle kısmi yamalar silinmiş kaydı yeniden oluşturamaz.
  if (!await store.read()) throw new MissingRecordError()
  let failure: unknown
  let applied = false
  const result = await store.transact((current) => {
    failure = undefined
    applied = false
    // Firebase soğuk önbellekte önce null verebilir. null göndererek sunucunun hash
    // kontrolünü ve yeniden denemesini sağla; hiçbir zaman eski snapshot'ı geri koyma.
    if (current === null) return null
    try {
      const next = change(current)
      applied = true
      return next
    } catch (err) {
      failure = err
      return undefined
    }
  })
  if (failure) throw failure
  if (!applied) throw new MissingRecordError()
  if (!result.committed) throw new Error('Kayıt başka biri tarafından değiştirildi. Yeniden açıp deneyin.')
  return result.value
}
