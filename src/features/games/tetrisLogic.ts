export function tetrisScoreFromMessage(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  frame: Window | null | undefined,
  origin: string,
): number | null {
  if (!frame || event.source !== frame || event.origin !== origin || event.data?.type !== 'tetris-gameover') return null
  const score: unknown = event.data.score
  return typeof score === 'number' && Number.isSafeInteger(score) && score > 0 && score <= 999999 ? score : null
}
