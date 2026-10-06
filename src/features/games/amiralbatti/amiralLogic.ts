export type Durum = 'davet_edildi' | 'yerlestirme' | 'oynaniyor' | 'bitti' | 'iptal'
export type AtisSonucu = 'bekliyor' | 'kacti' | 'isabet' | 'batti'
export interface AbGame {
  oyuncu1Uid?: string; oyuncu1Ad?: string; oyuncu2Uid?: string; oyuncu2Ad?: string
  durum?: Durum; hazir1?: boolean; hazir2?: boolean; sira?: string | null
  sonuc?: string | null; sonNot?: string
  atislar1?: Record<string, AtisSonucu>; atislar2?: Record<string, AtisSonucu>
  guncellemeTs?: number
}
export interface Hucre { r: number; c: number }
export interface GemiYerlesim { id: string; hucreler: Hucre[] }
export const key = (r: number, c: number) => `${r}_${c}`
export const oyuncuNo = (game: AbGame | null | undefined, uid: string): 1 | 2 | null => {
  if (!game) return null
  if (game.oyuncu1Uid === uid) return 1
  if (game.oyuncu2Uid === uid) return 2
  return null
}
export const oyuncuUid = (game: AbGame, no: 1 | 2) => (no === 1 ? game.oyuncu1Uid : game.oyuncu2Uid)
export const oyuncuAdi = (game: AbGame, no: 1 | 2) => (no === 1 ? game.oyuncu1Ad : game.oyuncu2Ad)


export interface AmiralStats {
  isim: string; oynanan: number; kazanilan: number
  sayilanOyunlar?: Record<string, true>
}
export function nextAmiralStats(previous: AmiralStats | null, gameId: string, won: boolean, name: string): AmiralStats | undefined {
  if (previous?.sayilanOyunlar?.[gameId]) return
  return { ...previous, isim: name || previous?.isim || 'İsimsiz',
    oynanan: (previous?.oynanan || 0) + 1, kazanilan: (previous?.kazanilan || 0) + (won ? 1 : 0),
    sayilanOyunlar: { ...previous?.sayilanOyunlar, [gameId]: true } }
}
export const hasPendingShot = (game: AbGame) =>
  [...Object.values(game.atislar1 || {}), ...Object.values(game.atislar2 || {})].includes('bekliyor')

export function fireShot(game: AbGame | null, uid: string, cell: string, now: number): AbGame | undefined {
  const no = oyuncuNo(game, uid)
  if (!game || !no || game.durum !== 'oynaniyor' || game.sira !== uid || hasPendingShot(game) || !/^[0-9]_[0-9]$/.test(cell)) return
  const field = no === 1 ? 'atislar1' : 'atislar2'
  if (game[field]?.[cell]) return
  return { ...game, [field]: { ...game[field], [cell]: 'bekliyor' },
    sira: oyuncuUid(game, no === 1 ? 2 : 1), guncellemeTs: now }
}
export function resolveShots(game: AbGame | null, uid: string, fleet: GemiYerlesim[], now: number): AbGame | undefined {
  const no = oyuncuNo(game, uid)
  if (!game || !no || game.durum !== 'oynaniyor' || !fleet?.length) return
  const field = no === 1 ? 'atislar2' : 'atislar1'
  const shots = { ...game[field] }
  const pending = Object.keys(shots).filter((k) => shots[k] === 'bekliyor')
  if (!pending.length) return
  const shipCells = new Set(fleet.flatMap((g) => g.hucreler.map((h) => key(h.r, h.c))))
  if (shipCells.size !== 17) return
  for (const k of pending) shots[k] = shipCells.has(k) ? 'isabet' : 'kacti'
  for (const ship of fleet) {
    if (ship.hucreler.every((h) => ['isabet', 'batti'].includes(shots[key(h.r, h.c)]))) {
      for (const h of ship.hucreler) shots[key(h.r, h.c)] = 'batti'
    }
  }
  const sunk = [...shipCells].every((k) => shots[k] === 'batti')
  return { ...game, [field]: shots, guncellemeTs: now,
    ...(sunk ? { durum: 'bitti', sonuc: oyuncuUid(game, no === 1 ? 2 : 1),
      sonNot: `${oyuncuAdi(game, no === 1 ? 2 : 1) || 'Rakip'} tüm filonu batırdı.` } : {}) }
}
export function startBattle(game: AbGame | null, uid: string, now: number): AbGame | undefined {
  if (!game || !oyuncuNo(game, uid) || game.durum !== 'yerlestirme' || !game.hazir1 || !game.hazir2) return
  return { ...game, durum: 'oynaniyor', sira: game.oyuncu1Uid, guncellemeTs: now }
}
