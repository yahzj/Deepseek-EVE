import type { BattleState } from '@whale/core'

/** 新入场舰优先使用已空出的舰位，尸骸演出不得把同时展示数量推过12。 */
export function visibleEnemyTags(battle: BattleState, tags: readonly string[], dead: ReadonlySet<string>, dropped: ReadonlySet<string>): string[] {
  const shown = tags.filter(tag => !dead.has(tag) || !dropped.has(tag))
  if (shown.length <= 12) return shown
  const live = shown.filter(tag => {
    const hp = battle.units[tag]?.hp
    return hp !== undefined && hp.s + hp.a + hp.h > 0
  })
  const liveSet = new Set(live)
  return [...live, ...shown.filter(tag => !liveSet.has(tag)).slice(-(12 - live.length))].slice(0, 12)
}
