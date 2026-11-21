import { repairUsageText, persistFleetHullDamage, sunkShipIdsOfBattle, settleDroneLosses, refundBattleAmmo, refundRepairKitsAll, captureBattleReport } from '../combat'
import type { SimContext } from '../types'
import { type GameState, addLog } from '../state'
import { shipDisplayName } from '../instances'
import { loseShip } from '../shipyard'
import { markAmbushRetreat, clearEncounter, settleEncounterFleetTail, weekendKindOfEncounter } from './return'
import { lootOf, dropWrecks, ambushHitHp } from './loot'
import { weekendInvolvedAt } from './presence'
import { weekendWreckDensityOf, wreckDensityOf } from '../salvage'
import { applyArmorFirstDamage, pctOf as pct } from '../hullDamage'
import { nextRandom } from '../rng'
import { ceilFinalQuantity } from '../quantity'
import { weekendApplyBattleOutcome } from '../weekendBattle'
import { settleCommandFleet, prepareCommandPilotAfterLoss } from '../combat/command/settlement'
import { settleIndustrialEncounter } from './settlement'
import { finishFleetHaulingAbortAfterEncounter } from '../hauling/fleet'

export function repairTail(battle: Parameters<typeof repairUsageText>[0], ctx: SimContext): string {
  const t = repairUsageText(battle, ctx)
  return t.length > 0 ? `，船体维修装置${t}` : ''
}

export function persistBattleDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: GameState['encounter']['battle'],
): void {
  const fleet = battle?.myFleet
  if (fleet && fleet.length > 0) {
    for (const e of fleet) persistFleetHullDamage(state, ctx, e.shipId, battle)
    return
  }
  persistFleetHullDamage(state, ctx, shipId, battle)
}

export function loseSunkShipsOfBattle(state: GameState, ctx: SimContext, shipId: string): number {
  const enc = state.encounter
  const battle = enc.battle
  const sunk = sunkShipIdsOfBattle(battle, shipId)
  if (battle?.myFleet) prepareCommandPilotAfterLoss(state, ctx, sunk, battle)
  sunk.sort((a, b) => Number(a === state.shipId) - Number(b === state.shipId))
  if (sunk.length === 0) return 0
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? enc.galaxyId ?? ''
  for (const uid of sunk) {
    const name = shipDisplayName(state, ctx, uid)
    addLog(
      state,
      'warn',
      `☠ ${name} 在「${galaxyName}·${enc.name}」被打沉（交火中结构归零）——船体与货仓全损；` +
        `残骸留在该星系，可前往打捞。`,
    )
    loseShip(state, uid, ctx, `遭遇战中被击沉（${name}）`, enc.galaxyId ?? undefined, {
      cause: 'encounter-lost',
    })
  }
  return sunk.length
}

export function settleBattleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: GameState['encounter']['battle'],
): void {
  const fleet = battle?.myFleet
  if (fleet && fleet.length > 0) {
    settleCommandFleet(state, ctx, battle!)
    return
  }
  settleDroneLosses(state, ctx, shipId, battle)
}

export function settleEscape(state: GameState, ctx: SimContext, mode: 'hull' | 'manual' = 'hull'): void {
  if (state.encounter.pirate || state.encounter.automatic) { settleIndustrialEncounter(state, ctx, { settleBattleDroneLosses, persistBattleDamage, loseSunkShipsOfBattle }, true); return }
  const enc = state.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const battle = enc.battle
  if (battle) {
    settleBattleDroneLosses(state, ctx, shipId, battle)
    refundBattleAmmo(state, battle)
    refundRepairKitsAll(state, battle)
    persistBattleDamage(state, ctx, shipId, battle)
  }
  const ship = state.fleet[shipId]
  const armourPct = Math.round((ship?.armorPct ?? 1) * 100)
  const hullPct = Math.round((ship?.durability ?? 1) * 100)
  const tail = repairTail(battle, ctx)
  if (mode === 'manual') {
    addLog(
      state,
      'combat',
      `⚔ 主动脱离（${galaxyName}·${enc.name}）：${shipName} 收手退出交火（现 装甲 ${armourPct}% / 结构 ${hullPct}%）${tail}。`,
      'core.encounters.011',
      { p1: galaxyName, p2: enc.name, p3: shipName, p4: armourPct, p5: hullPct, p6: tail },
    )
  } else {
    addLog(
      state,
      'combat',
      `⚔ 遭遇战自动脱离（${galaxyName}·${enc.name}）：${shipName} 结构损失过半，及时退出交火（现 装甲 ${armourPct}% / 结构 ${hullPct}%）${tail}。`,
    )
  }
  if (mode === 'hull') markAmbushRetreat(state)
  loseSunkShipsOfBattle(state, ctx, shipId)
  clearEncounter(state)
  settleEncounterFleetTail(state, ctx, shipId, battle)
  finishFleetHaulingAbortAfterEncounter(state, ctx)
}

export function settleFight(state: GameState, ctx: SimContext): void {
  if (state.encounter.pirate || state.encounter.automatic) { settleIndustrialEncounter(state, ctx, { settleBattleDroneLosses, persistBattleDamage, loseSunkShipsOfBattle }); return }
  const enc = state.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const battle = enc.battle
  const bal = ctx.balance.encounter
  const fleetShip = state.fleet[shipId]
  if (battle) {
    settleBattleDroneLosses(state, ctx, shipId, battle)
    refundBattleAmmo(state, battle)
    refundRepairKitsAll(state, battle)
    persistBattleDamage(state, ctx, shipId, battle)
  }
  if (battle && battle.ended === 'me') {
    const seizeF = 1 + 0.1 * Math.min(5, state.skills.trained['seizure-appraisal'] ?? 0)
    const loot = lootOf(state, ctx, seizeF)
    state.wallet.isk += loot
    dropWrecks(state, ctx)
    const invasion = weekendInvolvedAt(state, ctx)
    const d = state.encounter.galaxyId
      ? invasion
        ? weekendWreckDensityOf(state, state.encounter.galaxyId)
        : wreckDensityOf(state, state.encounter.galaxyId, ctx)
      : null
    const encWinText = invasion
      ? `★ 击退入侵舰队（${galaxyName}·${enc.name}）：${shipName} 全歼来敌——本场无赏金（进度收入在活动结束时按进度统一结算）${
          d !== null ? `，入侵残骸沉积 ${d.toFixed(1)}` : ''
        }${repairTail(battle, ctx)}。`
      : `★ 遭遇战大捷（${galaxyName}·${enc.name}）：${shipName} 全歼来敌——缴获 ${loot.toLocaleString('zh-CN')} 信用点${
          d !== null ? `，敌舰残骸沉积（密度 ${d.toFixed(1)}）` : ''
        }${repairTail(battle, ctx)}。`
    addLog(state, 'combat', encWinText)
    captureBattleReport(state, battle, { source: 'encounter', outcome: 'win', summary: encWinText })
  } else {
    const hit = applyArmorFirstDamage(state, ctx, shipId, ambushHitHp(ctx, enc.threat))
    if (hit && hit.floored) addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。')
    let takenUnits = 0
    if (fleetShip && nextRandom(state.rng) < 0.5) {
      const total = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
      const take = ceilFinalQuantity(
        total * bal.lootTakenMaxPct * (0.5 + nextRandom(state.rng) * 0.5) * (1 - 0.12 * Math.min(5, state.skills.trained['lowsec-survival'] ?? 0)),
      )
      let rest = take
      for (const key of Object.keys(fleetShip.cargo)) {
        if (rest <= 0) break
        const unit = fleetShip.cargo[key]!
        const grab = Math.min(unit, rest)
        fleetShip.cargo[key] = unit - grab
        rest -= grab
        if (fleetShip.cargo[key] <= 0) delete fleetShip.cargo[key]
      }
      takenUnits = take - rest
    }
    const encLoseText = `⚔ 遭遇战失利（${galaxyName}·${enc.name}）：${shipName} 不敌来敌——${
      hit
        ? `装甲 -${pct(hit.armorLost)}%${hit.hullLost > 0 ? `、结构 -${pct(hit.hullLost)}%` : ''}（现 装甲 ${pct(hit.armorTo)}% / 结构 ${pct(hit.hullTo)}%）`
        : '船体带着损伤'
    }${takenUnits > 0 ? `，货仓被劫走 ${takenUnits.toLocaleString('zh-CN')} 单位` : ''}，狼狈脱离${repairTail(battle, ctx)}。`
    addLog(state, 'combat', encLoseText)
    if (battle) captureBattleReport(state, battle, { source: 'encounter', outcome: 'lose', summary: encLoseText })
  }
  loseSunkShipsOfBattle(state, ctx, shipId)
  clearEncounter(state)
  settleEncounterFleetTail(state, ctx, shipId, battle)
  finishFleetHaulingAbortAfterEncounter(state, ctx)
}

export function settleEncounterBattle(state: GameState, ctx: SimContext, enc: GameState['encounter']): void {
  settleFight(state, ctx)
  weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, enc.battle?.ended === 'me', Date.now(), enc.battle, {
    kind: weekendKindOfEncounter(state, enc),
    galaxyId: enc.galaxyId ?? '',
    source: 'battle',
  })
}
