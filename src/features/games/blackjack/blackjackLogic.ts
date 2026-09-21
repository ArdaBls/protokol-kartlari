export type Suit = 'sinek' | 'karo' | 'kupa' | 'maca'
export type Rank = 'as' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'vale' | 'kiz' | 'papaz'

export interface Card { r: Rank; s: Suit; id: string }
export interface HandValue { total: number; soft: boolean; blackjack: boolean; bust: boolean }

export const SUITS: Suit[] = ['sinek', 'karo', 'kupa', 'maca']
export const RANKS: Rank[] = ['as', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'vale', 'kiz', 'papaz']

export function createDeck(decks = 1): Card[] {
  const result: Card[] = []
  for (let d = 0; d < decks; d += 1) {
    for (const s of SUITS) for (const r of RANKS) result.push({ r, s, id: `${d}-${r}-${s}` })
  }
  return result
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = result[i]; result[i] = result[j]; result[j] = temp
  }
  return result
}

export function evaluateHand(cards: Card[]): HandValue {
  let total = 0; let aces = 0
  for (const card of cards) {
    if (card.r === 'as') { total += 11; aces += 1 }
    else if (card.r === '10' || card.r === 'vale' || card.r === 'kiz' || card.r === 'papaz') total += 10
    else total += Number(card.r)
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1 }
  return { total, soft: aces > 0, blackjack: cards.length === 2 && total === 21, bust: total > 21 }
}

export function dealerShouldHit(cards: Card[]): boolean {
  const value = evaluateHand(cards)
  return value.total < 17 || (value.total === 17 && value.soft)
}

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose'

export function settleHand(player: Card[], dealer: Card[], wager: number, naturalBlackjack = true): { outcome: Outcome; payout: number } {
  const p = evaluateHand(player); const d = evaluateHand(dealer)
  if (p.bust) return { outcome: 'lose', payout: 0 }
  if (p.blackjack && naturalBlackjack && !d.blackjack) return { outcome: 'blackjack', payout: Math.floor(wager * 2.5) }
  if (d.bust || p.total > d.total) return { outcome: 'win', payout: wager * 2 }
  if (p.total === d.total) return { outcome: 'push', payout: wager }
  return { outcome: 'lose', payout: 0 }
}
