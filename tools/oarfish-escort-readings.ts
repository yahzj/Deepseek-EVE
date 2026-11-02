/** 满载皇带鱼多波护航实战：独立合成，正式装配/预算/出勤/战斗/结算，无个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { sustainFixture, type SustainProfile } from './enemy-formation-sustain'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { installPlug } from '../packages/core/src/plugs'
import { fitModule, cpuOverloadText } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { cargoCapacityM3Of } from '../packages/core/src/inventory'
import { haulFleetLoadOf } from '../packages/core/src/hauling/load'
import { haulFleetPathOf } from '../packages/core/src/hauling/fleet'
import { haulEffectiveMinutes, haulRewardRange } from '../packages/core/src/hauling/routes'
import { startHauling } from '../packages/core/src/hauling'
import { spawnIndustrialEncounter } from '../packages/core/src/encounters/industrial'
import { advanceEncounterWatch } from '../packages/core/src/encounters/advance'
import { foeStrengthOf, createFoeSpecs } from '../packages/core/src/combat/foes/catalog'
import { industrialFrequencyOf } from '../packages/core/src/encounters/risk'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const cargoM3 = 1_527_660
const profiles: SustainProfile[] = [
  { id: 'solo', name: '皇带鱼单船', fleet: [] },
  { id: 'one-gun', name: '皇带鱼＋1锤头鲨', fleet: ['sh-hammerhead'] },
  { id: 'two-gun', name: '皇带鱼＋2锤头鲨', fleet: Array(2).fill('sh-hammerhead') },
  { id: 'four-gun', name: '皇带鱼＋4锤头鲨', fleet: Array(4).fill('sh-hammerhead') },
  { id: 'three-gun-logi', name: '皇带鱼＋3锤头鲨＋后勤', fleet: [...Array(3).fill('sh-hammerhead'), 'sh-wh-g-destroyer'], defensiveSupport: true },
  { id: 'three-gun-ewar', name: '皇带鱼＋3锤头鲨＋电子', fleet: [...Array(3).fill('sh-hammerhead'), 'sh-wh-d-frigate'], defensiveSupport: true, rangeEwModules: 1 },
  { id: 'two-gun-mixed', name: '皇带鱼＋2锤头鲨＋后勤＋电子', fleet: [...Array(2).fill('sh-hammerhead'), 'sh-wh-g-destroyer', 'sh-wh-d-frigate'], defensiveSupport: true, rangeEwModules: 1 },
  { id: 'drone-mixed', name: '皇带鱼＋2锤头鲨＋无人机巡洋＋后勤', fleet: [...Array(2).fill('sh-hammerhead'), 'sh-sentinel', 'sh-wh-g-destroyer'], defensiveSupport: true },
]

export function fixture(profile: SustainProfile, seed: number) {
  const built = profile.fleet.length ? sustainFixture(ctx, profile, seed) : null
  const state = built?.state ?? createInitialState({ nowWallMs: 0, seed })
  if (!built) {
    state.fleet = {}
    state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
    state.standingsEarned = { dsi: 100 }
    state.standings.dsi = 100
    state.exploredGalaxies = [...ctx.galaxies.keys()]
  }
  const emperor = addShipToFleet(state, 'sh-colossal')
  state.shipId = emperor
  for (const mod of ctx.modules.values()) state.moduleBay[mod.id] = 100
  for (const item of ctx.items.values()) if (item.kind === 'ammo' || item.id.startsWith('repairkit-')) state.warehouse.items[item.id] = 1_000_000
  assert(installPlug(state, ctx, 'plug-low-bay', emperor).ok)
  const modules = [...Array(4).fill('mod-cargo-proto'), 'mod-turret-civ', 'mod-turret-civ', 'mod-hullrep-1', 'mod-shield-ext-1', 'mod-shield-ext-1']
  for (const id of modules) assert(fitModule(state, id, ctx, { shipId: emperor }).ok, `${profile.id}/${id}`)
  const roster = [emperor, ...(built?.roster ?? [])]
  assert(notePreparationSquad(state, 'combat', roster))
  const budget = commandBudgetOf(state, ctx, roster)
  assert(budget.ok, `${profile.id}:${JSON.stringify(budget)}`)
  for (const id of roster) assert.equal(cpuOverloadText(state, ctx, id), null)
  assert.equal(cargoCapacityM3Of(state, ctx, emperor), cargoM3)
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  return { state, roster, budget }
}

function main() {
const rows = []
for (const profile of profiles) {
  const battles = []
  let metadata
  for (let seed = 1; seed <= 20; seed++) {
    const { state, roster, budget } = fixture(profile, seed)
    const load = haulFleetLoadOf(state, ctx, roster, cargoM3)
    const suppliesBefore = Object.fromEntries(Object.entries(state.warehouse.items).filter(([id]) => id.startsWith('ammo-') || id.startsWith('repairkit-')))
    assert(startHauling(state, null, 'site-cinder', ctx, cargoM3).ok)
    assert.equal(state.hauling.fleetLeg!.loadedM3, cargoM3)
    state.rng = { seed, count: 0 }
    assert(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' }))
    const encounter = state.encounter, battle = encounter.battle!, card = encounter.pirate!.card
    assert.equal(encounter.pirate!.targetThreat, 196, '固定货量不得因护航反向增强敌人')
    const strength = foeStrengthOf(card, ctx.balance.battle)
    const formation = card.waves!.map((_, wave) => {
      const composition: Record<string, number> = {}
      for (const slot of card.ships!.filter(row => (row.wave ?? 0) === wave)) composition[slot.ship.name] = (composition[slot.ship.name] ?? 0) + 1
      const specs = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: wave ? `w${wave}-` : '' })
      return { wave: wave + 1, composition, hp: specs.reduce((sum, spec) => sum + spec.hp.s + spec.hp.a + spec.hp.h, 0),
        dps: specs.reduce((sum, spec) => sum + spec.weapons.reduce((n, w) => n + (w.shotDmg ?? 0) * (w.count ?? 1) * 1000 / w.reloadMs, 0), 0) }
    })
    if (seed === 1) {
      const read = loadSaveFile(serializeSaveFile(state)).state
      assert.deepEqual(read.encounter.pirate, state.encounter.pirate)
      const path = haulFleetPathOf(state, ctx, roster, 'galaxy-hub', 'galaxy-cinder')
      const duration = path.reduce((sum, row) => sum + row.durationMs, 0)
      const pay = haulRewardRange(ctx, cargoM3, haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-cinder'))
      const frequency = industrialFrequencyOf(encounter.pirate!.fleet.industrialMassKg, encounter.pirate!.fleet.combatMassKg, ctx.balance.encounter.industrial.frequency)
      metadata = { budget, capacityM3: load.capacityM3, load: load.byShip, cargoM3, soloEmperorCapacityM3: cargoM3,
        travelMinutes: duration / 60_000, theoreticalHourlyMin: pay.min * 3_600_000 / duration, theoreticalHourlyMax: pay.max * 3_600_000 / duration,
        escortReduction: 1 - frequency.escortMul,
        roster: roster.map(id => ({ id, name: ctx.ships.get(state.fleet[id]!.defId!)!.name, fitted: state.fleet[id]!.fitted, droneLoad: state.fleet[id]!.droneLoad })) }
    }
    const started = state.gameMs
    while (state.encounter.active && state.gameMs - started <= ctx.balance.battle.maxBattleMs + 60_000) {
      state.gameMs += 1000
      advanceEncounterWatch(state, ctx, 1000)
    }
    assert(!state.encounter.active, `${profile.id}/${seed}/战斗未收束`)
    const supplyUsed = Object.fromEntries(Object.entries(suppliesBefore).map(([id, count]) => [id, count - (state.warehouse.items[id] ?? 0)]).filter(([, count]) => Number(count) !== 0))
    battles.push({ seed, formationSeed: encounter.pirate!.seed, targetThreat: encounter.pirate!.targetThreat,
      realizedThreat: encounter.pirate!.realizedThreat, waves: card.waves!.length, statMultiplier: card.pirateGeneration!.statMultiplier,
      enemyHp: strength.hp, enemyPeakDps: strength.dps, formation, outcome: state.battleReport!.outcome,
      autoEscaped: battle.autoEscaped === true, reason: battle.escapeReason, lastWave: (battle.waveIdx ?? 0) + 1,
      seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000, wallSeconds: (state.gameMs - started) / 1000,
      sunk: roster.filter(id => !state.fleet[id]), damageDealt: battle.stats.meDmg,
      hp: (battle.myFleet ?? [{ shipId: roster[0]!, tag: 'player' }]).map(row => ({ shipId: row.shipId, hp: battle.units[row.tag]!.hp, hpMax: battle.units[row.tag]!.hpMax })),
      transportContinued: state.hauling.active, returning: state.transit.active, supplyUsed })
  }
  const row = { id: profile.id, name: profile.name, metadata,
    summary: { samples: battles.length, wins: battles.filter(row => row.outcome === 'win').length,
      retreats: battles.filter(row => row.outcome === 'break').length, losses: battles.filter(row => row.outcome === 'lose').length,
      sunk: battles.reduce((sum, row) => sum + row.sunk.length, 0), continued: battles.filter(row => row.transportContinued).length,
      secondsMin: Math.min(...battles.map(row => row.seconds)), secondsMax: Math.max(...battles.map(row => row.seconds)),
      realizedMin: Math.min(...battles.map(row => row.realizedThreat)), realizedMax: Math.max(...battles.map(row => row.realizedThreat)),
      waveMin: Math.min(...battles.map(row => row.waves)), waveMax: Math.max(...battles.map(row => row.waves)),
      statMin: Math.min(...battles.map(row => row.statMultiplier)), statMax: Math.max(...battles.map(row => row.statMultiplier)) }, battles }
  rows.push(row)
  console.log(JSON.stringify({ id: row.id, name: row.name, cost: row.metadata!.budget.cost, reduction: row.metadata!.escortReduction, ...row.summary }))
}
const directory = resolve('tools/_ui-artifacts/oarfish-escort-20261101')
mkdirSync(directory, { recursive: true })
writeFileSync(resolve(directory, 'readings.json'), JSON.stringify({ assumptions: { target: 'd2-real-engine-independent-synthetic', cargoM3,
  emperorUnchanged: true, allSkills5: true, escortsMk2: true, maxWaves: 3, maxStatMultiplier: 2, seeds: 20,
  limitation: '每场独立全修充足补给，正式指挥预算和出勤；固定总货量，护航船不额外加货；非总体胜率和持续收益结论。' }, rows }, null, 2), 'utf8')
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/oarfish-escort-readings.ts')) main()
