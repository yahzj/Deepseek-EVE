const ALIEN_INVASION_CONTENT = new Set(['mod-alien-acid-launcher', 'mod-alien-pressure-chamber', 'drone-jawclaw'])

/** 新入侵内容置于既有同类内容之后；只变手册视图，不改变游戏目录和随机流。 */
export function handbookContentOrderOf<T>(entries: readonly T[], idOf: (entry: T) => string): T[] {
  return [
    ...entries.filter(entry => !ALIEN_INVASION_CONTENT.has(idOf(entry))),
    ...entries.filter(entry => ALIEN_INVASION_CONTENT.has(idOf(entry))),
  ]
}
