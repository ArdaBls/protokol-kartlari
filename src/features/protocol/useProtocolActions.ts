import { toast } from '@heroui/react'
import { get, ref, serverTimestamp, update } from 'firebase/database'
import { useAuth } from '../../auth/useAuth'
import { dateKey } from '../../lib/dates'
import { db } from '../../lib/firebase'
import { downloadJson } from '../../lib/browserFiles'
import { useDbMode, dbPathFor } from '../../lib/dbMode'
import { collectLogDeleteUpdates } from '../../lib/logCleanup'
import type { ListKey, Person } from './protocolRules'
import { LIST_PATHS, hierarchyWeight, institutionWeight } from './protocolRules'
import { useProtocolWriter } from './useProtocolWriter'

const nameOf = (person: Person) => person.name || 'İsimsiz kayıt'

/** Protokol listesi üzerindeki toplu/tekil işlemler; her biri yalnızca dokunduğu yolları atomik yazar. */
export function useProtocolActions(listKey: ListKey) {
  const { state } = useAuth()
  const writer = useProtocolWriter(listKey)
  const { isTestMode } = useDbMode()
  const field = (id: string, key: string) => `${writer.personPath(id)}/${key}`

  const trash = async (targets: Person[]) => {
    if (!targets.length) return false
    const updates: Record<string, unknown> = {}
    targets.forEach((person) => {
      updates[field(person._id, 'prevStatus')] = person.status || 'aktif'
      updates[field(person._id, 'status')] = 'silindi'
    })
    const names = targets.map(nameOf)
    const action = names.length === 1 ? `${names[0]} kişisi çöpe atıldı` : `${names.length} kişi çöpe atıldı: ${names.join(', ')}`
    const ok = await writer.commit(updates, [{ action, target: names.length === 1 ? names[0] : '' }])
    if (ok) toast.warning(targets.length === 1 ? 'Kayıt çöpe atıldı.' : `${targets.length} kayıt çöpe taşındı.`)
    return ok
  }

  // Çöpe atılmadan önceki durumuna (aktif ya da arşiv) döner; bilgi yoksa aktif.
  const restore = async (person: Person) => {
    const restored = person.prevStatus === 'pasif' ? 'pasif' : 'aktif'
    const hasRank = person.rank !== undefined && person.rank !== null && person.rank !== ''
    const destination = restored === 'pasif' ? 'arşive (pasif)' : 'aktif listeye'
    const ok = await writer.commit(
      { [field(person._id, 'status')]: restored, [field(person._id, 'prevStatus')]: null },
      [{ action: `${nameOf(person)} kişisi yeniden ${destination} katıldı${hasRank ? `, ${person.rank}. sıraya` : ''}`, target: person.name }],
    )
    if (ok) toast.success(restored === 'pasif' ? 'Kayıt arşive geri alındı.' : 'Kayıt aktif listeye geri alındı.')
  }

  const deleteForever = async (person: Person) => {
    const canDeleteLogs = state.status === 'ready' && (state.role === 'admin' || state.role === 'owner')
    if (!canDeleteLogs) {
      toast.danger('Kişiyi ve bağlı loglarını yalnızca admin veya kurucu silebilir.')
      return false
    }
    const actor = writer.ensureWritable()
    if (!actor) return false
    try {
      const targetName = (person.name ?? '').trim()
      const logDeletes = await collectLogDeleteUpdates(isTestMode, (entry) => !!targetName && entry.target?.trim() === targetName)
      await update(ref(db), { [writer.personPath(person._id)]: null, ...logDeletes })
      toast.warning('Kayıt ve bağlı logları kalıcı olarak silindi.')
      return true
    } catch (err) {
      console.error('Kayıt ve bağlı loglar silinemedi:', err)
      toast.danger('Kayıt silinemedi. Firebase kurallarını kontrol edin.')
      return false
    }
  }

  /** Yalnızca ekranda görünen silinmiş kayıtlar silinir; arama/filtre dışında kalanlara dokunulmaz. */
  const emptyTrash = async (visibleTrash: Person[]) => {
    if (!visibleTrash.length) return toast.success('Çöp kutusu zaten boş.')
    const updates = Object.fromEntries(visibleTrash.map((person) => [writer.personPath(person._id), null]))
    const ok = await writer.commit(updates, [{ action: `Çöp kutusu boşaltıldı (${visibleTrash.length} kayıt kalıcı olarak silindi)` }])
    if (ok) toast.warning('Çöp kutusu boşaltıldı.')
  }

  const verifyMany = async (visibleActive: Person[], verified: boolean) => {
    if (!visibleActive.length) return toast.danger('Doğrulanacak görünür kayıt yok.')
    const actorName = writer.actor?.name || writer.actor?.email || ''
    const updates: Record<string, unknown> = {}
    visibleActive.forEach((person) => {
      updates[field(person._id, 'sonDogrulamaTs')] = verified ? serverTimestamp() : null
      updates[field(person._id, 'dogrulamaKaynak')] = verified ? 'manuel' : null
      updates[field(person._id, 'dogrulayan')] = verified ? actorName : null
    })
    const count = visibleActive.length
    const ok = await writer.commit(updates, [{ action: `${verified ? 'Toplu doğrulama: ' : 'Toplu doğrulanmadı olarak işaretleme: '}${count} kayıt` }])
    if (ok) toast.success(`${count} kayıt ${verified ? 'doğrulandı.' : 'doğrulanmadı olarak işaretlendi.'}`)
  }

  const saveOrder = (ordered: Person[], moved: Person, groupLabel: string) => {
    const updates = Object.fromEntries(ordered.map((person, index) => [field(person._id, 'order'), index + 1]))
    const position = ordered.findIndex((person) => person._id === moved._id) + 1
    return writer.commit(updates, [{ action: `${nameOf(moved)} kişisi ${groupLabel} içinde ${position}. konuma sürüklendi`, target: moved.name }])
  }

  const sortGroupByName = async (members: Person[], groupLabel: string) => {
    const sorted = [...members].sort((a, b) =>
      hierarchyWeight(a) - hierarchyWeight(b) || institutionWeight(a) - institutionWeight(b) || (a.name ?? '').localeCompare(b.name ?? '', 'tr'),
    )
    const updates = Object.fromEntries(sorted.map((person, index) => [field(person._id, 'order'), index + 1]))
    const ok = await writer.commit(updates, [{ action: `${groupLabel} grubu (${sorted.length} kişi) isme göre A-Z sıralandı` }])
    if (ok) toast.success('İsim sırasına göre düzenlendi.')
  }

  const downloadBackup = async () => {
    try {
      const [il, universite] = await Promise.all(
        (['il', 'universite'] as const).map((key) => get(ref(db, dbPathFor(LIST_PATHS[key], isTestMode)))),
      )
      downloadJson(
        { yedekTarihi: new Date().toISOString(), ilProtokolVerileri: il.val() ?? {}, universiteProtokolVerileri: universite.val() ?? {} },
        `Tam-Yedek-${dateKey(new Date())}.json`,
      )
      toast.success('Tam yedek indirildi.')
    } catch (err) {
      console.error('Tam yedek alınamadı:', err)
      toast.danger('Tam yedek alınamadı.')
    }
  }

  return { canWrite: writer.canWrite, trash, restore, deleteForever, emptyTrash, verifyMany, saveOrder, sortGroupByName, downloadBackup }
}
