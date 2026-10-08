import type { BattleState } from './state'
import type { FoeMountDef } from './types'
import type { UnitSpec } from './combat'
import { isAlive } from './combatMath'

export function syncCoronaFleetFocus(battle: BattleState, foes: readonly UnitSpec[]): void {
  let count = 0
  let changed = false
  for (const foe of foes) {
    if (!foe.foeFocusArray || !battle.units[foe.tag]) continue
    count++
    if (battle.foeFocusArrays?.[foe.tag] !== foe.foeFocusArray) changed = true
  }
  if (count === 0) { delete battle.foeFocusArrays; return }
  if (!changed && Object.keys(battle.foeFocusArrays!).length === count) return
  battle.foeFocusArrays = Object.fromEntries(foes.filter(foe => foe.foeFocusArray && battle.units[foe.tag]).map(foe => [foe.tag, foe.foeFocusArray!]))
}

/** 全队只取最强存活来源；来源死亡在同一拍内立即失效。 */
export function coronaFleetRangeBonusOf(battle: BattleState, own?: FoeMountDef['focusArray']): number {
  if (battle.foeFocusArrays === undefined) return battle.units === undefined ? coronaFocusBonusOf(battle, own, 'rangeBonusPct') : 0
  let bonus = 0
  for (const [tag, focus] of Object.entries(battle.foeFocusArrays)) {
    if (isAlive(battle, tag)) bonus = Math.max(bonus, coronaFocusBonusOf(battle, focus, 'rangeBonusPct'))
  }
  return bonus
}

/** 聚焦的三项效果共用本波时钟，不保存可漂移的累计倍率。 */
export function coronaFocusProgressOf(rampMs: number, elapsedMs: number): number {
  return rampMs > 0 ? Math.min(1, Math.max(0, elapsedMs) / rampMs) : 1
}

export function coronaFocusBonusOf(
  battle: Pick<BattleState, 'startedAtGameMs' | 'foeWaveStartMs' | 'lastTickGameMs'>,
  focus: FoeMountDef['focusArray'],
  kind: 'rangeBonusPct' | 'antiDroneBonusPct',
): number {
  if (focus === undefined) return 0
  const elapsed = battle.lastTickGameMs - (battle.foeWaveStartMs ?? battle.startedAtGameMs)
  return (focus[kind] ?? 0) * coronaFocusProgressOf(focus.rampMs, elapsed)
}

export function coronaFocusFalloffOf(baseFalloff: number, rampMs: number, elapsedMs: number): number {
  if (!(rampMs > 0)) return 1
  const base = Math.max(0, baseFalloff)
  return Math.min(1, base + (1 - base) * coronaFocusProgressOf(rampMs, elapsedMs))
}
