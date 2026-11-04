import type { BattleFx } from '@whale/core'

type FxBattle = { startedAtGameMs: number; lastTickGameMs: number; fxSeq: number; fx: BattleFx[]; speedX?: number }
export interface BattleFxCursor { battle?: object; seq: number }

/** 游标按具体战斗对象续播；换场/读档序号回退不沿用上一代，历史弹道不补播。 */
export function battleFxArrivals(cursor: BattleFxCursor, battle: FxBattle): { reset: boolean; events: BattleFx[] } {
  const tail = battle.fx.at(-1)?.seq ?? -1
  const reset = cursor.battle !== battle || tail < cursor.seq
  if (reset) cursor.seq = -1
  cursor.battle = battle
  const windowMs = 200 * Math.max(1, battle.speedX ?? 1)
  const events = battle.fx.filter(f => f.seq > cursor.seq && battle.lastTickGameMs - f.atMs <= windowMs)
  cursor.seq = tail
  return { reset, events }
}
