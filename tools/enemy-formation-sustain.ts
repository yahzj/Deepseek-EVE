/** 敌卡持续作战夹具与账本；只接受独立合成状态，不读取个人档。 */
import assert from 'node:assert/strict'
import { createInitialState, type GameState } from '../packages/core/src/state'
import type { SimContext } from '../packages/core/src/types'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, cpuOverloadText, fitModule, unfitAt } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { startExpedition } from '../packages/core/src/expedition/launch'
import { advanceExpedition } from '../packages/core/src/expedition/advance'
import { consumeDeparture } from '../packages/core/src/departure'
import { advanceAutoLoopBounty, setAutoLoopBounty } from '../packages/core/src/expedition/loop'
import { bountyCooldownRemainingMs } from '../packages/core/src/expedition/cooldown'
import { advanceBattleFor } from '../packages/core/src/combat/advance'
import { waveGapTotalMs } from '../packages/core/src/combat/combatMath'
import { repairCostIsk, repairShip } from '../packages/core/src/shipyard'
import { marketGoodOf } from '../packages/core/src/market/access'
import { withBattleRangeConsent } from '../packages/core/src/battleRangeMemory'
import { allFittedIds } from '../packages/core/src/labels'

export interface SustainProfile { id: string; name: string; fleet: readonly string[]; defensiveSupport?: boolean; rangeEwModules?: number }
export const SUSTAIN_PROFILES: readonly SustainProfile[] = [
  { id: 'guns', name: '纯炮击', fleet: Array(5).fill('sh-hammerhead') as string[] },
  { id: 'logistics', name: '四炮击＋后勤', fleet: [...Array(4).fill('sh-hammerhead'), 'sh-wh-g-destroyer'] as string[] },
  { id: 'ewar', name: '四炮击＋电子', fleet: [...Array(4).fill('sh-hammerhead'), 'sh-wh-d-frigate'] as string[] },
  { id: 'mixed', name: '三炮击＋后勤＋电子', fleet: [...Array(3).fill('sh-hammerhead'), 'sh-wh-g-destroyer', 'sh-wh-d-frigate'] as string[] },
  { id: 'drones', name: '两炮击＋无人机＋后勤＋电子', fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-sentinel', 'sh-wh-g-destroyer', 'sh-wh-d-frigate'] },
] as const
export const DEFENSIVE_MIX_PROFILE: SustainProfile = {
  ...SUSTAIN_PROFILES.find(profile => profile.id === 'mixed')!, id: 'mixed-defense', name: '三炮击＋后勤＋电子（辅助加防护）', defensiveSupport: true,
}
export type SustainPolicy = 'port' | 'continuous'
export type FormationVersion = 0 | 1
export const SUPPLY_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'repairkit-mil', 'drone-scout', 'drone-assault'] as const

export function oldFormationContext(ctx: SimContext): SimContext {
  return { ...ctx, anomalies: new Map([...ctx.anomalies].map(([id, card]) => [id, card.foeFormation?.baseline ?? card])) }
}

export function withoutSupportTraits(ctx: SimContext): SimContext {
  return { ...ctx, ships: new Map([...ctx.ships].map(([id, ship]) => [id, {
    ...ship, repairOutputBonusPct: 0, foeRangeDebuffPct: 0, rangeEwBonus: 0, rangeEwEquipmentBonusPct: 0,
  }])) }
}

export function supplyCount(state: GameState, id: string): number {
  return (state.warehouse.items[id] ?? 0) + Object.values(state.fleet).reduce((sum, ship) =>
    sum + (ship.cargo[id] ?? 0) + (ship.droneLoad?.[id] ?? 0), 0)
}

export function supplyPrice(ctx: SimContext, id: string): number {
  const good = marketGoodOf(ctx, 'item', id)
  assert(good && good.basePrice > 0, `缺少补给目录价:${id}`)
  return good.basePrice
}

function shipAssetValue(state: GameState, ctx: SimContext, uid: string): number {
  const ship = state.fleet[uid]!
  const def = ctx.ships.get(ship.defId!)!
  const hull = marketGoodOf(ctx, 'ship', def.id)?.basePrice ?? def.priceIsk
  assert(hull > 0, `缺少船体估值:${def.id}`)
  return hull + allFittedIds(ship.fitted).reduce((sum, id) => {
    const good = marketGoodOf(ctx, 'module', id)
    assert(good && good.basePrice > 0, `缺少装配估值:${id}`)
    return sum + good.basePrice
  }, 0)
}

export function sustainFixture(ctx: SimContext, profile: SustainProfile, seed: number) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.modeChosen = true
  state.onboarding.step = 99
  state.fleet = {}
  state.wallet.isk = 1_000_000_000
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.importantTasks['first-bounty'] = { done: true }
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
  state.completedBounties = [...ctx.anomalies.keys()]
  state.resupplyFromWarehouse = true
  state.warehouse.items = Object.fromEntries(SUPPLY_IDS.map(id => [id, id.startsWith('ammo-') ? 100_000 : 2_000]))
  state.sideTasks.faction = null
  const roster = profile.fleet.map(defId => {
    const uid = addShipToFleet(state, defId), def = ctx.ships.get(defId)!
    const carrier = defId === 'sh-sentinel'
    const high = carrier ? ['mod-turret-kin-2', 'mod-drone-tac-2', 'mod-turret-kin-2', 'mod-turret-kin-2']
      : Array(def.slots!.high).fill('mod-turret-kin-2') as string[]
    const modules = [...high, 'mod-prop-2', 'mod-shield-ext-2',
      ...(def.repairPulseTargetsFleet || defId === 'sh-wh-g-destroyer' ? ['mod-hullrep-2'] : []), 'mod-armor-plate-2']
    if (profile.defensiveSupport && ['sh-wh-g-destroyer', 'sh-wh-d-frigate'].includes(defId)) {
      modules.push('mod-shield-ext-2', 'mod-armor-plate-2')
    }
    for (const id of modules) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
      const fitted = fitModule(state, id, ctx, { shipId: uid })
      assert(fitted.ok, `${profile.id}/${defId}/${id}:${fitted.error}`)
    }
    const result = adjustDroneLoad(state, ctx, carrier ? 'drone-assault' : 'drone-scout', carrier ? 8 : 2, uid)
    assert(result.ok, `${profile.id}/${defId}/机群:${result.error}`)
    if (def.rangeEwBonus && profile.rangeEwModules) {
      const moduleId = 'mod-lair-ecm-h', rack = ctx.modules.get(moduleId)!.rack!
      for (let index = 0; index < profile.rangeEwModules; index++) {
        assert(unfitAt(state, rack, index, uid, ctx), `${profile.id}/${uid}/卸装${index}`)
        state.moduleBay[moduleId] = (state.moduleBay[moduleId] ?? 0) + 1
        const fitted = fitModule(state, moduleId, ctx, { shipId: uid, rack, index })
        assert(fitted.ok, `${profile.id}/${uid}/${moduleId}:${fitted.error}`)
      }
    }
    assert.equal(cpuOverloadText(state, ctx, uid), null, `${profile.id}/${defId}`)
    return uid
  })
  state.shipId = roster[0]!
  assert(notePreparationSquad(state, 'combat', roster))
  const budget = commandBudgetOf(state, ctx, roster)
  assert(budget.ok, profile.id)
  const assetValues = Object.fromEntries(roster.map(uid => [uid, shipAssetValue(state, ctx, uid)]))
  return { state, roster, budget, assetValues }
}

export function runSustainCampaign(ctx: SimContext, profile: SustainProfile, cardId: string, seed: number,
  version: FormationVersion, policy: SustainPolicy, rounds: number) {
  const { state, roster, budget, assetValues } = sustainFixture(ctx, profile, seed)
  const card = ctx.anomalies.get(cardId)!
  assert(card && !card.hidden)
  const initialWallet = state.wallet.isk
  const initialSupplies = Object.fromEntries(SUPPLY_IDS.map(id => [id, supplyCount(state, id)]))
  const lootIds = [...new Set(card.loot.map(row => row.itemId))]
  const initialLoot = Object.fromEntries(lootIds.map(id => [id, supplyCount(state, id)]))
  const records = []
  let stopped = '', totalPortRepair = 0
  if (policy === 'continuous') assert(setAutoLoopBounty(state, ctx, cardId).ok)
  for (let round = 1; round <= rounds; round++) {
    const started = state.gameMs
    const before = roster.map(uid => ({ uid, armor: state.fleet[uid]?.armorPct ?? 1, hull: state.fleet[uid]?.durability ?? 1 }))
    const open = () => policy === 'continuous' ? advanceAutoLoopBounty(state, ctx) : startExpedition(state, cardId, ctx)
    let launch = open()
    if (state.pendingBattleRange) launch = withBattleRangeConsent(state, state.pendingBattleRange.desireM, open)
    if (state.expedition.active && state.expedition.phase === 'out') {
      const wait = state.expedition.finishAtGameMs - state.gameMs
      state.gameMs += wait
      consumeDeparture(state, 'expedition', wait)
      advanceExpedition(state, ctx)
    }
    if (!state.expedition.battle) {
      stopped = typeof launch === 'string' ? launch : '未能再次开战，或触发正式停环保护'
      break
    }
    const battle = state.expedition.battle
    if (version === 0) delete battle.enemyFormationVersion
    state.gameMs = battle.startedAtGameMs + ctx.balance.battle.maxBattleMs + 30_000 + waveGapTotalMs(card, ctx.balance.battle)
    advanceBattleFor(state, ctx, battle, roster[0]!, cardId)
    assert(battle.ended || battle.autoEscaped, `${profile.id}/${cardId}/战斗未收束`)
    const seconds = (battle.lastTickGameMs - battle.startedAtGameMs) / 1000
    const end = battle.ended, escaped = battle.autoEscaped === true
    const armorMin = Math.min(...roster.map((uid, index) => {
      const unit = battle.units[index === 0 ? 'player' : `ally-${index}`]
      return unit ? unit.hp.a / Math.max(1, unit.hpMax?.a ?? unit.hp.a) : 0
    }))
    const hullMin = Math.min(...roster.map((uid, index) => {
      const unit = battle.units[index === 0 ? 'player' : `ally-${index}`]
      return unit ? unit.hp.h / Math.max(1, unit.hpMax?.h ?? unit.hp.h) : 0
    }))
    state.gameMs = battle.lastTickGameMs + ctx.balance.battle.killcamMs + 1
    advanceExpedition(state, ctx)
    if (state.expedition.active) {
      assert.equal(state.expedition.phase, 'back')
      state.gameMs = Math.max(state.gameMs, state.expedition.finishAtGameMs)
      advanceExpedition(state, ctx)
    }
    assert(!state.expedition.active && !state.expedition.sortie, '返航尚未完成')
    state.gameMs += bountyCooldownRemainingMs(state, cardId)
    const missing = roster.filter(uid => !state.fleet[uid])
    let portRepair = 0
    if (policy === 'port') for (const uid of roster) {
      if (!state.fleet[uid]) continue
      const price = repairCostIsk(state, uid, ctx)
      if (price > 0) {
        assert(repairShip(state, uid, ctx).ok, `港内维修:${uid}`)
        portRepair += price
      }
    }
    totalPortRepair += portRepair
    records.push({ round, won: end === 'me' && !escaped, escaped, seconds,
      cycleSeconds: (state.gameMs - started) / 1000, armorMin, hullMin, portRepair, missing, before,
      after: roster.map(uid => ({ uid, armor: state.fleet[uid]?.armorPct, hull: state.fleet[uid]?.durability })),
      loopOn: state.autoLoopAnomalyId === cardId })
    if (missing.length) { stopped = '实际沉船或弃船，停止并计入船体与装配损失'; break }
    if (policy === 'continuous' && state.autoLoopAnomalyId !== cardId) { stopped = '正式停环保护已触发'; break }
  }
  const consumed = Object.fromEntries(SUPPLY_IDS.map(id => [id, initialSupplies[id]! - supplyCount(state, id)]))
  for (const [id, n] of Object.entries(consumed)) assert(n >= 0, `补给总量增加:${id}/${n}`)
  const supplyCost = SUPPLY_IDS.reduce((sum, id) => sum + consumed[id]! * supplyPrice(ctx, id), 0)
  const sunk = roster.filter(uid => !state.fleet[uid])
  const replacement = sunk.reduce((sum, uid) => sum + assetValues[uid]!, 0)
  const repairDebt = roster.reduce((sum, uid) => sum + (state.fleet[uid] ? repairCostIsk(state, uid, ctx) : 0), 0)
  const lootValue = lootIds.reduce((sum, id) => sum + Math.max(0, supplyCount(state, id) - initialLoot[id]!) * (ctx.items.get(id)?.baseSellPriceIsk ?? 0), 0)
  const walletDelta = state.wallet.isk - initialWallet
  // 连续作战结束后的未修损伤列为负债，不能让少修船看起来多赚钱。
  const net = walletDelta - supplyCost - replacement - repairDebt
  const hours = state.gameMs / 3_600_000
  return { profile: profile.id, cardId, seed, version, policy, capacity: budget.capacity, cost: budget.cost,
    rounds: records.length, wins: records.filter(row => row.won).length, stopped, sunk, consumed, supplyCost,
    replacement, repairDebt, portRepair: totalPortRepair, walletDelta, lootValue, net,
    seconds: state.gameMs / 1000, netPerHour: hours > 0 ? net / hours : 0,
    withLootPerHour: hours > 0 ? (net + lootValue) / hours : 0, records }
}

export type SustainResult = ReturnType<typeof runSustainCampaign>
