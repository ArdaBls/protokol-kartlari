import { Chess } from 'chess.js'
import { sameGameState } from '../gameMutations'

export interface ChessMove { from: string; to: string; promotion?: string | null }
export type Renk = 'w' | 'b'
export type Durum = 'davet_edildi' | 'oynaniyor' | 'bitti' | 'iptal'

export interface ChessGame {
  beyazUid?: string; beyazAd?: string; siyahUid?: string; siyahAd?: string
  fen?: string; sira?: Renk; durum?: Durum
  sonuc?: 'beyaz' | 'siyah' | 'beraberlik' | null; sonNot?: string
  beraberlikTeklifEden?: Renk | null; geriAlmaTeklifEden?: Renk | null
  oncekiFen?: string | null; oncekiSira?: Renk | null
  hamleler?: Record<string, ChessMove>
  yenidenOynaBeyaz?: boolean; yenidenOynaSiyah?: boolean; yeniOyunId?: string | null
  guncellemeTs?: number
}

export const myColor = (game: ChessGame | null, uid: string): Renk | null => {
  if (!game) return null
  if (game.beyazUid === uid) return 'w'
  if (game.siyahUid === uid) return 'b'
  return null
}
export const hamleListesi = (game: ChessGame | null | undefined): ChessMove[] =>
  Object.keys(game?.hamleler ?? {}).map(Number).sort((a, b) => a - b).map((k) => game!.hamleler![k])

function gameOverInfo(chess: Chess): { over: boolean; sonuc?: 'beyaz' | 'siyah' | 'beraberlik'; sonNot?: string } {
  if (chess.isCheckmate()) return { over: true, sonuc: chess.turn() === 'w' ? 'siyah' : 'beyaz', sonNot: 'Şah mat' }
  if (chess.isStalemate()) return { over: true, sonuc: 'beraberlik', sonNot: 'Pat (berabere)' }
  if (chess.isThreefoldRepetition()) return { over: true, sonuc: 'beraberlik', sonNot: 'Üç kez tekrar (berabere)' }
  if (chess.isInsufficientMaterial()) return { over: true, sonuc: 'beraberlik', sonNot: 'Yetersiz materyal (berabere)' }
  if (chess.isDraw()) return { over: true, sonuc: 'beraberlik', sonNot: 'Elli hamle kuralı (berabere)' }
  return { over: false }
}


/** Restore history as well as FEN, otherwise repetition detection resets every turn. */
export function chessFromGame(game: ChessGame): Chess {
  const replay = new Chess()
  try {
    for (const move of hamleListesi(game)) replay.move({ ...move, promotion: move.promotion || 'q' })
    if (!game.fen || replay.fen() === game.fen) return replay
  } catch { /* Older/imported games may have no usable history. */ }
  return new Chess(game.fen)
}

export function applyChessMove(current: ChessGame | null, expected: ChessGame, uid: string, move: ChessMove, now: number): ChessGame | undefined {
  if (!current || !sameGameState(current, expected) || current.durum !== 'oynaniyor') return
  const color = myColor(current, uid)
  if (!color || current.sira !== color) return
  try {
    const chess = chessFromGame(current)
    if (chess.turn() !== color || chess.isGameOver()) return
    const before = chess.fen()
    chess.move({ ...move, promotion: move.promotion || 'q' })
    const info = gameOverInfo(chess)
    return {
      ...current, fen: chess.fen(), sira: chess.turn(), guncellemeTs: now,
      beraberlikTeklifEden: null, geriAlmaTeklifEden: null, oncekiFen: before, oncekiSira: color,
      hamleler: { ...current.hamleler, [hamleListesi(current).length]: { ...move, promotion: move.promotion || null } },
      ...(info.over ? { durum: 'bitti', sonuc: info.sonuc, sonNot: info.sonNot } : {}),
    }
  } catch { return }
}

export function claimChessRematch(current: ChessGame | null, uid: string, id: string): ChessGame | undefined {
  if (!current || current.durum !== 'bitti' || current.siyahUid !== uid
    || !current.yenidenOynaBeyaz || !current.yenidenOynaSiyah || current.yeniOyunId) return
  return { ...current, yeniOyunId: id }
}
