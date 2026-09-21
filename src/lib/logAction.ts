import { push, ref, serverTimestamp, set } from 'firebase/database'
import { db } from './firebase'

export interface Actor {
  uid: string
  name: string
  email: string
}

/** Kayıt üzerine yazılır, log ise HER SEFERİNDE yeni satır olarak eklenir. */
export async function logAction(logPath: string, actor: Actor, action: string, target = ''): Promise<void> {
  await set(push(ref(db, logPath)), {
    by: actor.name || actor.email,
    email: actor.email,
    action,
    target,
    timestamp: serverTimestamp(),
  })
}
