/** 功能域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { repairWithKitsFor } from '../shipyard'
import { shipDisplayName } from '../instances'
import { pctOf as pct } from '../hullDamage'
import { cancelAiTask } from '../aiCores'
import { stopMining } from '../mining'
import { stopSalvageOp } from '../salvaging'
import { startTransitHome } from '../location'
import { weekendFlagshipEncounterOf } from '../weekendBattle'

/**
 * 遭遇**收场尾巴**（**2026-09-12 船长定：先修后判**）：
 * ① **先自动修理**：装甲或结构 <50% ⇒ 就地用**修理组件**补到两者 ≥60% 或**组件耗尽**
 *    （来源 = 货舱优先、仓库兜底；见 `shipyard.repairWithKitsFor`）；
 *    ⚠ **2026-09-16 船长改判**：这一步**需要该船装着船体维修装置**，且**消耗的组件类型跟着装置走**
 *    （民用装置吃民用组件、MK1/MK2 吃军用组件）——**没装装置 ⇒ 完全不修**（`hasDevice=false`），
 *    此时 `outOfKits` 恒为 `false` ⇒ **不会**被误判成"断料返港"，只按下面的结构线判。
 * ② **再判返港**：**组件不足（断料）** 或 **修完后结构仍 <50%** ⇒ 被袭船收手返港**待命**。
 *
 * ⚠ **旧口径作废**（2026-09-11 的「不自动维修」＋「结构 <50% 一律撤退」两条由船长 2026-09-12 改判）：
 * 现在**只要组件够，被伏击的船就不会自动撤退**（修好继续干活），返港降级为"修不动 / 修不好"时的保命档。
 * 为什么改：长途运输也会遇袭（同日裁定）⇒ 低安受损变得高频，逐件手点不现实。
 */
export function settleEncounterTail(state: GameState, ctx: SimContext, shipId: string): void {
  const ship = state.fleet[shipId]
  if (!ship) return
  const frac = ctx.balance.encounter.retreatHullFrac
  let outOfKits = false
  // 触发线 = 装甲**或**结构 <50%（与重复清剿同口径）；目标 60% 给"战斗内结构<50% 自动脱离"留缓冲
  if (ship.durability < frac || (ship.armorPct ?? 1) < frac) {
    outOfKits = repairWithKitsFor(state, ctx, shipId, ctx.balance.encounter.repairTargetFrac, 'cargo+warehouse').outOfKits
  }
  const after = state.fleet[shipId]
  const hullLow = !after || after.durability < ctx.balance.encounter.retreatHullFrac
  if (outOfKits) retreatEncounterShip(state, ctx, shipId, hullLow ? 'hull+kits' : 'kits')
  else if (hullLow) retreatEncounterShip(state, ctx, shipId, 'hull')
}

/**
 * 记一次「因低安袭击自动撤离」（一次性标记；新通讯 `msg-ambush-retreat` 的触发面，船长 2026-09-14 定）。
 *
 * **两处置位**（船长裁定「也算自动脱离交火」）：① `retreatEncounterShip` = 被袭船自动收手返港待命；
 * ② `settleEscape` = 应战中途结构过半**自动脱离交火**。主控与副船同口径，只置一次。
 * 判定侧读它（`comms.commsTriggerMet` 的 `ambushRetreat`）；老档缺字段 = 从未发生 ⇒ 不补发。
 */
export function markAmbushRetreat(state: GameState): void {
  if (state.ambushRetreatSeen !== true) state.ambushRetreatSeen = true
}

/**
 * 收手返港待命（原因只影响日志文案；执行口径一处）：
 * 主控：停掉低安作业（采矿/打捞/扫描）并即时返航最近已建成站（既有"返航即时到站"口径，到港自动卸货）；
 * 副船：中止 AI 任务召回回港（既有召回口径，核心归还核心库）。
 * **不自动再派**：回港后由玩家决定下一步（副船耐久 <50% 本就不能再派任务）。
 * 返回是否确实撤退（用于测试）。
 */
export function retreatEncounterShip(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  cause: 'hull' | 'kits' | 'hull+kits',
): boolean {
  const ship = state.fleet[shipId]
  if (!ship) return false
  const frac = ctx.balance.encounter.retreatHullFrac
  const name = shipDisplayName(state, ctx, shipId)
  const line =
    cause === 'hull'
      ? `结构低于 ${pct(frac)}%`
      : cause === 'kits'
        ? '修理组件耗尽（未修到目标）'
        : `修理组件耗尽且结构仍低于 ${pct(frac)}%`
  if (shipId !== state.shipId) {
    // 副船：中止任务召回回港待命（核心归还核心库）
    if (!cancelAiTask(state, shipId, ctx)) return false
    addLog(
      state,
      'warn',
      `⚠ [AI·${name}] ${line}——已中止任务召回回港待命（请维修后再派；此状态下无法再派任务）。`,
      'core.encounters.001',
      { p1: name, p2: line },
    )
    markAmbushRetreat(state)
    return true
  }
  // 主控：先停手（作业状态各自清理），再走既有"返航最近已建成站"（即时到站 + 自动卸货）
  if (state.mining.active) stopMining(state, ctx)
  if (state.salvaging.active) stopSalvageOp(state, ctx)
  // ⚠ 2026-09-15 起**不含星系扫描**（船长：无人扫描艇不占主控、也不算暴露 ⇒ 没得停、也不会挨打）
  let home = state.awayGalaxy === null
  if (!home && !state.expedition.active) {
    const r = startTransitHome(state, ctx)
    home = r.ok || state.awayGalaxy === null
  }
  addLog(
    state,
    'warn',
    home
      ? `⚠ ${name} ${line}——已自动停手返港（回港后请及时维修）。`
      : `⚠ ${name} ${line}——已自动停手，正在返航途中（到港后请及时维修）。`,
  )
  markAmbushRetreat(state)
  return true
}

export function clearEncounter(state: GameState): void {
  state.encounter = {
    active: false,
    shipId: null,
    galaxyId: null,
    name: '',
    threat: 0,
    anomalyId: null,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
}

/**
 * **这一场遭遇在入侵里算哪一类**（遭遇槽自己知道）：旗舰挑战挂的正是该族**旗舰卡**且在核心星系，
 * 其余一律按**伏击**算。只作 `weekendApplyBattleOutcome` 的归属提示用——"算不算入侵"仍由 core 侧
 * （伏击要求活的占领区）兜底，非占领区的普通遭遇照样什么都不做。
 * ⚠ 判据本体已收口到 `weekendBattle.weekendFlagshipEncounterOf`（战斗界面的宿主解析读同一处）。
 */
export function weekendKindOfEncounter(state: GameState, enc: GameState['encounter']): 'ambush' | 'flagship' {
  return weekendFlagshipEncounterOf(state, enc) ? 'flagship' : 'ambush'
}
