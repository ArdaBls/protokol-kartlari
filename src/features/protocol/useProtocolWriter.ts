import { push, ref, serverTimestamp, set, update } from 'firebase/database'
import { useWriter } from '../../hooks/useWriter'
import { db } from '../../lib/firebase'
import type { ListKey } from './protocolRules'
import { LIST_PATHS } from './protocolRules'

export interface LogLine {
  action: string
  target?: string
}

export type SuggestionKind = 'birimler' | 'unvanlar'

/**
 * Protokol listelerine tüm yazmalar buradan geçer: veri ve log satır(lar)ı TEK çok yollu
 * update() ile atomik yazılır, test modunda hepsi test/ dalına gider. Tüm listeyi yeniden
 * yazmak yerine yalnızca dokunulan yollar gönderilir; eş zamanlı başka bir editörün kaydı ezilmez.
 */
export function useProtocolWriter(listKey: ListKey) {
  const writer = useWriter()
  const listPath = writer.path(LIST_PATHS[listKey])
  const logsPath = writer.path(`logs/${listKey}`)
  const suggestionsPath = writer.path(`oneriler/${listKey}`)

  const commit = async (updates: Record<string, unknown>, logs: LogLine[]): Promise<boolean> => {
    const actor = writer.ensureWritable()
    if (!actor) return false
    const payload: Record<string, unknown> = { ...updates }
    logs.forEach((log) => {
      const key = push(ref(db, logsPath)).key
      payload[`${logsPath}/${key}`] = {
        by: actor.name || actor.email,
        email: actor.email,
        action: log.action,
        target: log.target ?? '',
        timestamp: serverTimestamp(),
      }
    })
    try {
      await update(ref(db), payload)
      return true
    } catch (err) {
      writer.reportError('Buluta kaydedilemedi.')(err)
      return false
    }
  }

  const saveSuggestion = (kind: SuggestionKind, value: string) => {
    if (!value || !writer.canWrite) return
    set(push(ref(db, `${suggestionsPath}/${kind}`)), { deger: value }).catch((err) =>
      console.error('Öneri havuzuna yazılamadı (kaydı etkilemez):', err),
    )
  }

  return {
    actor: writer.actor,
    canWrite: writer.canWrite,
    commit,
    saveSuggestion,
    suggestionsPath,
    personPath: (id: string) => `${listPath}/${id}`,
    newPersonId: () => push(ref(db, listPath)).key ?? `-local${Date.now().toString(36)}`,
    listPath,
  }
}
