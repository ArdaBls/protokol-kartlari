// A threshold ends a match only when there is a unique highest-scoring player.
// A tied automatic finish continues with another hand; an agreed finish may draw.
export function highestScorer(seats, scores, threshold = 101) {
  const highest = Math.max(...seats.map((seat) => Number(scores[seat]) || 0))
  const winners = seats.filter((seat) => (Number(scores[seat]) || 0) === highest)
  return highest >= threshold && winners.length === 1 ? winners[0] : undefined
}
