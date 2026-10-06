// Firebase may return numeric-keyed records as arrays and omit null children.
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.entries(value).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
}

export function sameGameState(current: unknown, expected: unknown): boolean {
  return current != null && expected != null && canonical(current) === canonical(expected)
}

/** Apply an RTDB-style patch to a transaction's private copy, including nested deletes. */
export function patchGame<T extends object>(current: T, patch: Record<string, unknown>): T {
  const result = structuredClone(current) as Record<string, unknown>
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('/')
    let target = result
    for (const part of parts.slice(0, -1)) {
      target[part] = { ...(target[part] as object ?? {}) }
      target = target[part] as Record<string, unknown>
    }
    if (value == null) delete target[parts.at(-1)!]
    else target[parts.at(-1)!] = value
  }
  return result as T
}
