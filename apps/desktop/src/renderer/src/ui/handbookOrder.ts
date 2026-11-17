const ALIEN_INVASION_CONTENT = new Set(['mod-alien-acid-launcher', 'mod-alien-pressure-chamber', 'drone-jawclaw'])

export function handbookContentOrderOf<T>(entries: readonly T[], idOf: (entry: T) => string): T[] {
  return [
    ...entries.filter(entry => !ALIEN_INVASION_CONTENT.has(idOf(entry))),
    ...entries.filter(entry => ALIEN_INVASION_CONTENT.has(idOf(entry))),
  ]
}
