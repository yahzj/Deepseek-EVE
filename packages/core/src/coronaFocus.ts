import type { BattleState } from './state'
import type { FoeMountDef } from './types'

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
