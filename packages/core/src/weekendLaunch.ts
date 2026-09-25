/**
 * **周末入侵 · 开战入口**（2026-09-23 船长令「继续补」）：把 core 的入侵规格接到**真实战斗**上。
 *
 * 为什么单独一层：`combat.ts` 不 import 入侵模块，而这里要同时用「战斗入口」与「入侵规格」⇒
 * 单独一个薄模块避免 `combat ←→ weekendBattle` 的相互导入。
 *
 * 口径：**旗舰 = 120 威胁 · 4 波 · 4 艘小队战**（口径定稿 #8）——4 波通过 `FoeOverride.waves`
 * 覆写成 `[{units:4, hpShare:0.25}] × 4`（整场总血不变，分 4 批入场）；我方编队取「主控 + 其余自有舰」，上限 4 艘。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
import { startFleetBattleFor } from './combat'
import { weekendFlagshipSpecOf } from './weekendBattle'
import { WEEKEND_FLAGSHIP_SHIP_ID, weekendFlagshipHpRemaining } from './weekendEvent'
import type { FoeOverride } from './combat'

/** 旗舰的 4 波（每波 4 艘、各占 1/4 总血） */
export function weekendFlagshipWavesOf(): ReadonlyArray<{ units: number; hpShare: number }> {
  return Array.from({ length: 4 }, () => ({ units: 4, hpShare: 0.25 }))
}

/** 我方编队：主控置首 + 其余自有舰，最多 4 艘（与"4 艘小队战"口径一致） */
export function weekendFlagshipSquadOf(state: GameState): string[] {
  const ids: string[] = []
  for (const id of [state.shipId, ...Object.keys(state.fleet)]) {
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  return ids.slice(0, 4)
}

/**
 * **挑战旗舰**（界面按钮调它）：核心条满才成立；返回 battle 表示开打成功（`null` = 条件不满足/无法开战）。
 * ⚠ 只负责"开战"——结果结算走 `weekendApplyBattleOutcome`（引擎在战斗收尾时调）。
 */
export function weekendStartFlagshipBattle(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
): ReturnType<typeof startFleetBattleFor> {
  const spec = weekendFlagshipSpecOf(state, ctx, nowWallMs)
  if (!spec) return null
  const squad = weekendFlagshipSquadOf(state)
  if (squad.length === 0) return null
  /**
   * **母舰血条 = 池子剩余**（船长 2026-09-25 选「甲」）：开战这一刻把 `weekendFlagshipHpRemaining(ev)`
   * 传进覆写口 ⇒ 战斗里母舰的满血就是池子剩余（单场不死名副其实；打空即击沉）。
   * 覆写随档存进 `BattleState.foeOverride` ⇒ 逐拍重建母舰、读档续战都吃同一份。
   */
  const bossHp = weekendFlagshipHpRemaining(state.weekendEvent)
  const override: FoeOverride = {
    threat: spec.threat,
    waves: weekendFlagshipWavesOf(),
    bossHp,
    bossShipId: WEEKEND_FLAGSHIP_SHIP_ID,
  }
  return startFleetBattleFor(state, ctx, squad, spec.cardId, state.gameMs, undefined, undefined, override)
}
