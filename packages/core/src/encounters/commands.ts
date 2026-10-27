/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, shipLockedInWormhole, addLog } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { withBattleRangeCheck } from '../battleRangeMemory'
import { weekendBattleInvolvedOf, weekendApplyBattleOutcome } from '../weekendBattle'
import { startBattleFor } from '../combat'
import { foeKeyOf } from './presence'
import { weekendKindOfEncounter } from './return'
import { settleEscape } from './outcome'

/** 玩家指令：迎战（进入 V12 实时战斗，自动打完出战报） */
export function fightEncounter(state: GameState, ctx: SimContext): CommandResult {
  return withBattleRangeCheck(state, { kind: 'encounter', invitedAtGameMs: state.encounter.invitedAtGameMs }, staged => fightEncounterMutable(staged, ctx))
}

export function fightEncounterMutable(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可应战的遭遇。', errorId: 'core.encounters.003' }
  // **洞内战斗时洞外可以开新战斗**（船长 2026-09-13），但**锚点船不能被锁在洞里**：
  // 洞内锚 = `run.fleet[0]`、洞外锚 = 这里那艘 —— 同一艘船被两场战斗同时读写会互相串台。
  if (shipLockedInWormhole(state, enc.shipId ?? state.shipId)) {
    return { ok: false, error: '这艘船在虫洞里（已锁定）：换一艘应战，或先撤离本趟。', errorId: 'core.encounters.004' }
  }
  // 船长2026-10-21：遭遇同样按实际敌卡读取，不回落模板母港的旧星系设置。
  /**
   * **周末入侵**：占领区的遇袭要打**缩放后的入侵强度**（`enc.foeStrengthMul`，2026-09-25 起 ×0.75），
   * 敌卡自带原强度 ⇒ 用覆写口把 `threat`（标签）与 `strengthMul`（真强度）一起传给战斗层；
   * 非入侵遭遇不传 ⇒ 行为一字不变。
   */
  const weekendFoe = weekendBattleInvolvedOf(state, ctx, enc.anomalyId ?? null, Date.now())
  const battle = startBattleFor(
    state,
    ctx,
    enc.shipId ?? state.shipId,
    foeKeyOf(enc),
    state.gameMs,
    undefined,
    weekendFoe
      ? { threat: enc.threat, ...(enc.foeStrengthMul !== undefined ? { strengthMul: enc.foeStrengthMul } : {}) }
      : undefined,
  )
  if (!battle) return { ok: false, error: '遭遇异常，无法开战。', errorId: 'core.encounters.005' }
  // 连续作战保险（船长 2026-09-11 定：低安遭遇同样适用）——结构剩余低于撤退线（50%）即自动脱离，
  // 绝不拖到弃船（旧行为：应战一直打到分胜负，可能把副船打没）
  battle.hullEscapeFrac = ctx.balance.encounter.retreatHullFrac
  enc.battle = battle
  addLog(state, 'combat', '已应战：遭遇战打响（引擎自动推演，战报稍后）。', 'core.encounters.006')
  return { ok: true }
}

/**
 * **玩家指令：主动脱离进行中的遭遇战**（2026-09-25 加 · 起因＝旗舰战要进战斗画面）。
 *
 * 为什么需要它：洞外遭遇战此前**没有"打到一半退出"这条路**——只有结构过半自动脱离
 * （`settleEscape`）与开打前的「快速脱离」（`fleeEncounter`）。旗舰战是**编队战 + 要玩家观战**的场次
 * （战斗画面里那枚「⚴ 撤退」因此必须是真能用的），且船长既定口径是「**撤退照记对母舰的伤害**」。
 *
 * 结算内容 = 自动脱离那一套（退弹药/修理组件、逐舰落盘承伤、无缴获、无额外扣损）：
 * - 先按"没打赢"走一遍入侵结算（只记母舰伤害 · 不给进度 · 不判击沉）——与自动脱离那条路同一顺序；
 * - 再 `settleEscape(mode='manual')` 收场（措辞为"主动脱离"，且**不**记"因袭击自动撤离"那笔账）。
 */
export function retreatEncounterBattle(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || !enc.battle) {
    return { ok: false, error: '当前不在交火中，无法脱离。', errorId: 'core.encounters.009' }
  }
  if (enc.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法脱离。', errorId: 'core.encounters.010' }
  }
  weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, false, Date.now(), enc.battle, {
    kind: weekendKindOfEncounter(state, enc),
    galaxyId: enc.galaxyId ?? '',
    source: 'battle',
  })
  settleEscape(state, ctx, 'manual')
  return { ok: true }
}
