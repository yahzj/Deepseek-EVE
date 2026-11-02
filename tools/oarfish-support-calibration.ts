/** 新版支援护航校准；独立合成、正式离线、分开现金与资产账，不读取个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { fixture } from './oarfish-escort-readings'
import { supplyCount, supplyPrice, type SustainProfile } from './enemy-formation-sustain'
import { adjustDroneLoad, cpuOverloadText, fitModule, unfitAt } from '../packages/core/src/equipment'
import { allFittedIds } from '../packages/core/src/labels'
import { marketGoodOf } from '../packages/core/src/market/access'
import { startHauling } from '../packages/core/src/hauling'
import { haulFleetLoadOf } from '../packages/core/src/hauling/load'
import { spawnIndustrialEncounter } from '../packages/core/src/encounters/industrial'
import { advanceEncounterWatch } from '../packages/core/src/encounters/advance'
import { beginOfflineCombatStats, newOfflineCombatStats } from '../packages/core/src/offlineCombatStats'
import { newSettleStats } from '../packages/core/src/settleStats'
import { simulateOffline } from '../packages/core/src/simulation'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { repairCostIsk } from '../packages/core/src/shipyard'
import type { GameState } from '../packages/core/src/state'

const ctx = buildSimContext(), emperorM3 = 1_527_660
const smoke = process.argv.includes('--smoke')
const seeds = smoke ? 1 : 20, campaignSeeds = smoke ? 1 : 8, hours = smoke ? 6 : 24
const directory = resolve(`tools/_ui-artifacts/oarfish-support-${Date.now()}`)
mkdirSync(directory, { recursive: false })
const mixed = { fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-wh-g-destroyer', 'sh-wh-d-frigate'], defensiveSupport: true, rangeEwModules: 1 }
const profiles: (SustainProfile & { support?: 'repair' | 'full' })[] = [
  { id: 'solo', name: '皇带鱼单船', fleet: [] },
  { id: 'four-gun', name: '皇带鱼加四炮击', fleet: Array(4).fill('sh-hammerhead') },
  { id: 'mixed-current', name: '混编原装配（当前机制）', ...mixed },
  { id: 'mixed-repair', name: '混编双修理机', ...mixed, support: 'repair' },
  { id: 'mixed-support', name: '混编力场阵列双修理机', ...mixed, support: 'full' },
]

function build(profile: typeof profiles[number], seed: number) {
  const built = fixture(profile, seed), { state, roster } = built
  if (profile.support) {
    const logi = roster.find(id => state.fleet[id]!.defId === 'sh-wh-g-destroyer')!
    for (const [id, n] of Object.entries(state.fleet[logi]!.droneLoad ?? {})) assert(adjustDroneLoad(state, ctx, id, -n, logi).ok)
    state.warehouse.items['drone-repair-mil'] = 1000
    assert(adjustDroneLoad(state, ctx, 'drone-repair-mil', 2, logi).ok)
    if (profile.support === 'full') for (const [index, id] of ['mod-shieldfield-2', 'mod-lock-2'].entries()) {
      assert(unfitAt(state, 'high', index, logi, ctx))
      assert(fitModule(state, id, ctx, { shipId: logi, rack: 'high', index }).ok)
    }
  }
  state.logCap = 100_000
  state.savedAtWallMs = Date.UTC(2026, 10, 1, 0)
  state.character.startedAtWallMs = state.savedAtWallMs
  for (const id of roster) assert.equal(cpuOverloadText(state, ctx, id), null)
  return built
}

const supplyIds = [...ctx.items.values()].filter(item => item.kind === 'ammo' || item.id.startsWith('repairkit-') || item.id.startsWith('drone-')).map(item => item.id)
function inventory(state: GameState) {
  const result = Object.fromEntries(supplyIds.map(id => [id, supplyCount(state, id)]))
  // 战斗结束时刻可能尚未退款，剩余预载仍是资产，不能当成已消耗。
  const battle = state.encounter.battle
  if (state.encounter.active && battle) {
    for (const [id, n] of Object.entries(battle.expeditionAmmo?.stock ?? {})) result[id] = (result[id] ?? 0) + n
    for (const ledger of Object.values(battle.repairBy ?? (battle.repair ? { player: battle.repair } : {}))) {
      for (const [id, n] of Object.entries(ledger.kits)) result[id] = (result[id] ?? 0) + n
    }
  }
  return result
}

function assetValues(state: GameState, roster: string[]) {
  return Object.fromEntries(roster.map(id => {
    const ship = state.fleet[id]!, def = ctx.ships.get(ship.defId!)!
    const value = (marketGoodOf(ctx, 'ship', def.id)?.basePrice ?? def.priceIsk) + [...allFittedIds(ship.fitted), ...(ship.plugs ?? [])].reduce((sum, mod) => {
      const recipe = [...ctx.blueprints.values()].find(bp => bp.moduleId === mod)
      const materialCost = recipe ? recipe.buildCostIsk + recipe.materials.reduce((total, mat) => {
        const unit = marketGoodOf(ctx, 'item', mat.itemId)?.basePrice
        assert(unit && unit > 0, `缺少插件材料估值:${mat.itemId}`)
        return total + mat.count * unit
      }, 0) : undefined
      const price = marketGoodOf(ctx, 'module', mod)?.basePrice ?? materialCost
      assert(price && price > 0, `缺少装备估值:${mod}`)
      return sum + price
    }, 0)
    return [id, value]
  }))
}

function accounting(state: GameState, roster: string[], before: Record<string, number>, assets: Record<string, number>) {
  const after = inventory(state)
  const consumed = Object.fromEntries(supplyIds.map((id): [string, number] => [id, before[id]! - after[id]!]).filter(([, n]) => n !== 0))
  for (const [id, n] of Object.entries(consumed)) assert(n >= 0, `补给增加需解释:${id}/${n}`)
  const supplyCost = Object.entries(consumed).reduce((sum, [id, n]) => sum + n * supplyPrice(ctx, id), 0)
  const sunk = roster.filter(id => !state.fleet[id])
  const replacement = sunk.reduce((sum, id) => sum + assets[id]!, 0)
  const repairDebt = roster.reduce((sum, id) => sum + (state.fleet[id] ? repairCostIsk(state, id, ctx) : 0), 0)
  return { consumed, supplyCost, sunk, replacement, repairDebt }
}

const battleRows: unknown[] = [], campaignRows: unknown[] = []
const metadata = profiles.map(profile => {
  const { state, roster, budget } = build(profile, 1)
  return { profile: profile.id, name: profile.name, budget, capacityM3: haulFleetLoadOf(state, ctx, roster).capacityM3,
    roster: roster.map(id => ({ id, defId: state.fleet[id]!.defId, fitted: state.fleet[id]!.fitted, droneLoad: state.fleet[id]!.droneLoad })) }
})
function checkpoint() {
  writeFileSync(resolve(directory, 'readings.json'), JSON.stringify({ assumptions: { smoke, seeds, campaignSeeds, hours, emperorM3, allSkills5: true, warehouseSupply: true,
    productionParametersUnchanged: true, limitation: '独立合成、固定配装、有限种子，不代表总体概率或最优配置；净值按目录价估算，未计资本成本和残骸回收。' }, config: ctx.balance.encounter.industrial, metadata, battleRows, campaignRows }, null, 2), 'utf8')
}

for (const profile of profiles) {
  let wins = 0, sunk = 0
  for (let seed = 1; seed <= seeds; seed++) {
    const { state, roster } = build(profile, seed), before = inventory(state), assets = assetValues(state, roster)
    assert(startHauling(state, null, 'site-cinder', ctx, emperorM3).ok)
    state.rng = { seed, count: 0 }
    const stats = newOfflineCombatStats(), end = beginOfflineCombatStats(state, stats)
    assert(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' }))
    const encounter = state.encounter, battle = encounter.battle!, pirate = encounter.pirate!
    assert.equal(pirate.targetThreat, 196)
    while (state.encounter.active && state.gameMs <= ctx.balance.battle.maxBattleMs + 60_000) {
      state.gameMs += 1000
      advanceEncounterWatch(state, ctx, 1000)
    }
    assert(!state.encounter.active, '强制场次未收束')
    end()
    const costs = accounting(state, roster, before, assets)
    const ammo = Object.entries(costs.consumed).filter(([id]) => id.startsWith('ammo-')).reduce((sum, [, n]) => sum + n, 0)
    const kits = Object.entries(costs.consumed).filter(([id]) => id.startsWith('repairkit-')).reduce((sum, [, n]) => sum + n, 0)
    assert.equal(stats.ammoUsed, ammo, '简报耗弹与独立库存不一致')
    assert.equal(stats.kitsUsed, kits, '简报组件与独立库存不一致')
    const outcome = state.battleReport!.outcome
    wins += outcome === 'win' ? 1 : 0; sunk += costs.sunk.length
    battleRows.push({ profile: profile.id, seed, outcome, targetThreat: pirate.targetThreat, realizedThreat: pirate.realizedThreat,
      waves: pirate.card.waves?.length, statMultiplier: pirate.card.pirateGeneration?.statMultiplier,
      seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000, transportContinued: state.hauling.active,
      stats, ...costs })
  }
  console.log(JSON.stringify({ stage: 'battle', profile: profile.id, samples: seeds, wins, sunk }))
  checkpoint()
}

for (const profile of profiles.filter(p => ['solo', 'four-gun', 'mixed-support'].includes(p.id))) {
  for (const load of profile.id === 'mixed-support' ? ['quarter', 'emperor-full', 'fleet-full'] : ['quarter', 'emperor-full']) {
    for (let seed = 1; seed <= campaignSeeds; seed++) {
      const { state, roster } = build(profile, seed), before = inventory(state), assets = assetValues(state, roster)
      const amount = load === 'quarter' ? Math.floor(emperorM3 / 4) : load === 'fleet-full' ? Math.floor(haulFleetLoadOf(state, ctx, roster).capacityM3) : emperorM3
      assert(startHauling(state, null, 'site-cinder', ctx, amount).ok)
      state.rng = { seed, count: 0 }
      const initialWallet = state.wallet.isk, stats = newSettleStats(), started = performance.now()
      simulateOffline(state, state.savedAtWallMs, state.savedAtWallMs + hours * 3_600_000, ctx, undefined, { stats })
      assert.equal(state.gameMs, hours * 3_600_000)
      const combat = stats.combat!, costs = accounting(state, roster, before, assets)
      const deliveryLogs = state.logs.filter(row => row.textId === 'core.industrial.004')
      assert.equal(combat.deliveries, deliveryLogs.length, '离线交付计数与独立事件账不一致')
      assert.equal(combat.transportIncome, deliveryLogs.reduce((sum, row) => sum + Number(row.textParams?.p3 ?? 0), 0))
      assert.equal(combat.encounters, state.logs.filter(row => row.textId === 'core.industrial.007').length)
      const ammo = Object.entries(costs.consumed).filter(([id]) => id.startsWith('ammo-')).reduce((sum, [, n]) => sum + n, 0)
      const kits = Object.entries(costs.consumed).filter(([id]) => id.startsWith('repairkit-')).reduce((sum, [, n]) => sum + n, 0)
      assert.equal(combat.ammoUsed, ammo, '离线简报耗弹与独立库存不一致')
      assert.equal(combat.kitsUsed, kits, '离线简报组件与独立库存不一致')
      const read = loadSaveFile(serializeSaveFile(state)).state
      assert.deepEqual(read.hauling, state.hauling)
      assert.deepEqual(read.encounter.pirate, state.encounter.pirate)
      const cashDelta = state.wallet.isk - initialWallet
      const net = combat.transportIncome - costs.supplyCost - costs.replacement - costs.repairDebt
      const row = { profile: profile.id, load, amount, seed, hours, combat, ...costs, cashDelta,
        nonTransportCash: cashDelta - combat.transportIncome, transportNet: net, transportNetPerHour: net / hours,
        withOtherCashNetPerHour: (cashDelta - costs.supplyCost - costs.replacement - costs.repairDebt) / hours,
        transportActive: state.hauling.active, encounterActive: state.encounter.active, runtimeMs: Math.round(performance.now() - started) }
      campaignRows.push(row)
      console.log(JSON.stringify({ stage: 'campaign', ...row }))
      checkpoint()
    }
  }
}
checkpoint()
console.log(JSON.stringify({ output: directory, battleSamples: battleRows.length, campaignSamples: campaignRows.length }))
