import { type GameState, addLog, HOME_GALAXY_ID } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { lairAnomalyOf, lairNameOf } from '../lairs'
import { weekendFoeCardOf } from '../weekendEvent'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { settleDroneLosses, refundBattleAmmo, refundRepairKitsAll, persistFleetHullDamage, createPlayerSpec, createFoeSpecs, foeDesiredRange, meFoeRangeDebuffOf, captureBattleReport } from '../combat'
import { formatDurationMs } from '../time'
import { type HullHit, applyArmorFirstDamage, firepowerHitHp, hitDamageText } from '../hullDamage'
import { nextRandom } from '../rng'
import { shipDisplayName } from '../instances'
import { autoLoopInvasionGalaxy, stopAutoLoopInvasion } from './loopState'
import { returnBackMs } from './travel'
import { RETURN_LEG_MUL } from '../balance'
import { beginJumpFuelLeg, jumpFuelLegMsOf } from '../jumpFuel'
import { settleCommandFleet, loseCommandSunkShips } from '../combat/command/settlement'
import { finishDestroyedSortie } from '../combat/command/return'

export function retreatBattle(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active || exp.phase !== 'battle' || !exp.battle) {
    return { ok: false, error: '当前不在交火中，无法撤退。', errorId: 'core.expedition.016' }
  }
  if (exp.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法撤退。', errorId: 'core.expedition.017' }
  }
  settleBattleRetreat(state, ctx, 'manual')
  return { ok: true }
}

export function settleBattleRetreat(
  state: GameState,
  ctx: SimContext,
  mode: 'manual' | 'auto' | 'timeout' | 'cannot-engage',
): void {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const entry = exp.battle?.rangeEwVersion === 1 ? anomaly : anomaly?.rangeEwLegacyCard ?? anomaly
  const source = exp.battle && exp.battle.enemyFormationVersion !== 1 ? entry?.foeFormation?.baseline ?? entry : entry
  const threatCard = source && exp.lairTier ? lairAnomalyOf(source, exp.lairTier, ctx.balance.battle, exp.battle ? exp.battle.enemyFormationVersion ?? 0 : 1, ctx.foeShips) : source
  const battle = exp.battle
  if (!battle) return
  {
    const ev = state.weekendEvent
    const galaxyId = exp.foeGalaxyId
    if (ev !== undefined && ev.endedAtWallMs === undefined && galaxyId !== undefined) {
      const isFlagship =
        exp.anomalyId !== null && exp.anomalyId === weekendFoeCardOf(ev.family, 'flagship') && galaxyId === ev.coreId
      weekendApplyBattleOutcome(state, ctx, exp.anomalyId ?? null, false, state.wallMs ?? Date.now(), battle, {
        kind: isFlagship ? 'flagship' : 'assault',
        galaxyId,
        source: 'battle',
      })
    }
  }
  const multi = (battle.myFleet?.length ?? 0) > 1
  if (multi) settleCommandFleet(state, ctx, battle)
  else settleDroneLosses(state, ctx, state.shipId, battle)
  refundBattleAmmo(state, battle)
  refundRepairKitsAll(state, battle)
  if (!multi) persistFleetHullDamage(state, ctx, state.shipId, battle)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)
  const meSpec = createPlayerSpec(state, ctx, state.shipId)
  const myTopRangeM = meSpec ? meSpec.weapons.reduce((m, w) => Math.max(m, w.maxRangeM), 0) : 0
  const foesNow = threatCard ? createFoeSpecs(threatCard, ctx.balance.battle) : []
  const foeTypicalRangeM =
    meSpec && foesNow.length > 0
      ?
        foeDesiredRange(meSpec, foesNow, ctx.balance.battle, meFoeRangeDebuffOf(state, ctx, [state.shipId]))
      : 0

  const bal = ctx.balance.combat
  const threat = threatCard ? Math.max(1, threatCard.threat) : 0
  let hit: HullHit | null = null
  let legacyLossPct = 0
  const leaderAlive = !multi || (battle.units.player?.hp.h ?? 0) > 0
  if (threat > 0 && leaderAlive) {
    hit = applyArmorFirstDamage(state, ctx, state.shipId, firepowerHitHp(ctx, threat, bal.retreatHitFirepowerSec))
    if (hit?.floored) {
      addLog(
        state,
        'combat',
        mode === 'timeout'
          ? '⚠ 超时撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
          : mode === 'auto'
            ? '⚠ 自动撤退后船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。'
            : '⚠ 撤退时船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。',
        mode === 'timeout' ? 'core.expedition.054' : mode === 'auto' ? 'core.expedition.055' : 'core.expedition.056',
      )
    }
  } else if (leaderAlive) {
    const fleetShipLegacy = state.fleet[state.shipId]
    const baseLoss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const loss = Math.max(0.01, Math.round(baseLoss * 500) / 1000)
    legacyLossPct = Math.round(loss * 100)
    if (fleetShipLegacy) fleetShipLegacy.durability = Math.min(1, Math.max(0.05, fleetShipLegacy.durability - loss))
  }
  const fleetShip = state.fleet[state.shipId]
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : exp.anomalyId ?? '目标'
  const dmgTxt = hit ? hitDamageText(hit) : `结构 -${legacyLossPct}%（旧档兜底）`
  const retreatText =
    mode === 'timeout'
      ? `⏱ 战斗超时（${targetName}）：舰船被迫撤退，正在返航——${dmgTxt}。`
      : mode === 'cannot-engage'
        ?
          `⚔ 无法交战（${targetName}）：我方主武器最远射程 ${myTopRangeM.toLocaleString('zh-CN')} m，` +
          `敌编队停在约 ${foeTypicalRangeM.toLocaleString('zh-CN')} m 外（交火 ${durTxt}，一炮未发）——` +
          `${shipName} 已脱离交火并返航。${dmgTxt}。`
        : mode === 'auto'
          ? `⚔ 自动撤退（${targetName}）：结构损失过半，${shipName} 自动脱离交火（交火 ${durTxt}）——${dmgTxt}，正在返航。`
          : `⚔ 撤退（${targetName}）：${shipName} 主动脱离交火（交火 ${durTxt}）——${dmgTxt}，即刻回港。`
  addLog(state, 'combat', retreatText)
  captureBattleReport(state, battle, {
    source: 'expedition',
    outcome: 'break',
    breakReason: mode === 'timeout' ? 'timeout' : mode === 'cannot-engage' ? 'cannot-engage' : mode === 'auto' ? 'hull' : 'manual',
    summary: retreatText,
  })
  if (multi) loseCommandSunkShips(state, ctx, battle, exp.foeGalaxyId ?? anomaly?.galaxyId ?? HOME_GALAXY_ID)
  if (multi && finishDestroyedSortie(state, battle)) return
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    const armorPct = Math.round((fleetShip?.armorPct ?? 1) * 100)
    const structPct = Math.round((fleetShip?.durability ?? 1) * 100)
    const text =
      mode === 'manual'
        ? `重复清剿已停止（手动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
        : mode === 'timeout'
          ? `重复清剿已停止（战斗超时）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
          : mode === 'cannot-engage'
            ? `重复清剿已停止（无法交战，已脱离）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
            : `重复清剿已停止（本场结构损失过半，自动撤退）——当前 装甲 ${armorPct}% / 结构 ${structPct}%。`
    addLog(state, 'combat', text)
    if (mode === 'auto' || mode === 'cannot-engage') state.autoLoopStopNotice = text
  }
  if (autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined) {
    stopAutoLoopInvasion(state, '本次出击已撤离，修整后可重新开启。', 'core.invasionLoop.005')
  }
  exp.battle = null
  exp.lairTier = undefined
  exp.factionActive = undefined
  exp.phase = 'back'
  exp.returnReason = 'retreat'
  const endAtR = Math.max(battle.startedAtGameMs, battle.lastTickGameMs)
  exp.returnAtGameMs = endAtR
  if (mode === 'manual') {
    exp.finishAtGameMs = endAtR
    addLog(state, 'combat', '舰队脱离战场，即刻返回最近的空间站。', 'core.expedition.028')
    return
  }
  const retR = anomaly ? returnBackMs(state, ctx, exp.foeGalaxyId ?? anomaly.galaxyId) : { ms: 0, base: HOME_GALAXY_ID }
  const rawBackR = retR.ms > 0 ? retR.ms : exp.outMs * RETURN_LEG_MUL
  exp.fuelMul = beginJumpFuelLeg(state, 'expedition', rawBackR)
  exp.finishAtGameMs = endAtR + jumpFuelLegMsOf(rawBackR, exp.fuelMul)
  addLog(state, 'combat', '舰队脱离战场，自动返航（去程时间并入返航）。', 'core.expedition.029')
}
