/** 单皇带鱼运输遇袭读数；独立合成，不读个人档，不修改生产参数。 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { createInitialState, MAX_SKILL_LEVEL } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule, cpuBudgetOf, fittedCpuUsed } from '../packages/core/src/equipment'
import { installPlug } from '../packages/core/src/plugs'
import { cargoCapacityM3Of } from '../packages/core/src/inventory'
import { haulEndpoints, haulEffectiveMinutes, haulRewardRange } from '../packages/core/src/hauling/routes'
import { haulFleetPathOf } from '../packages/core/src/hauling/fleet'
import { warpSpeedAus } from '../packages/core/src/travel'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { industrialBaseThreatOf, industrialThreatOf, industrialFrequencyOf } from '../packages/core/src/encounters/risk'
import { pirateFormationOf } from '../packages/core/src/encounters/pirateFormation'
import { foeStrengthOf } from '../packages/core/src/combat/foes/catalog'
import { createPlayerSpec } from '../packages/core/src/combat/player/create'
import { startHauling } from '../packages/core/src/hauling'
import { spawnIndustrialEncounter } from '../packages/core/src/encounters/industrial'
import { advanceEncounterWatch } from '../packages/core/src/encounters/advance'

const ctx = buildSimContext()

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 20261101 })
  state.fleet = {}
  state.shipId = addShipToFleet(state, 'sh-colossal')
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, MAX_SKILL_LEVEL]))
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.modeChosen = true
  state.onboarding.step = 99
  for (const mod of ctx.modules.values()) if (!mod.unreleased) state.moduleBay[mod.id] = 100
  for (const item of ctx.items.values()) if (!item.unreleased) state.warehouse.items[item.id] = 1_000_000
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  return state
}

const relevant = [...ctx.modules.values()].filter(mod => mod.slot === 'plug' || mod.slot === 'cargo' || mod.warpSpeedBonusPct || mod.id === 'mod-hullrep-2' || mod.id.startsWith('mod-shield-ext-'))
if (process.argv.includes('--inspect')) console.log('MODULES', JSON.stringify(relevant))

for (const plug of [undefined, 'plug-low-bay', 'plug-titan-compression', 'plug-cpu-core']) {
  for (const cargoId of ['mod-cargo-3', 'mod-cargo-proto']) {
    const state = world()
    if (plug) {
      const result = installPlug(state, ctx, plug)
      assert(result.ok, `${plug}: ${JSON.stringify(result)}`)
    }
    const fitted = []
    while (true) {
      const result = fitModule(state, cargoId, ctx)
      if (!result.ok) break
      fitted.push(cargoId)
    }
    const cap = cargoCapacityM3Of(state, ctx, state.shipId)
    const endpoints = haulEndpoints(state, ctx)
    const routes = []
    for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i]!, b = endpoints[j]!
      const path = haulFleetPathOf(state, ctx, [state.shipId], a.galaxyId, b.galaxyId)
      const timeMs = path.reduce((sum, row) => sum + row.durationMs, 0)
      const pay = haulRewardRange(ctx, cap, haulEffectiveMinutes(ctx, a.galaxyId, b.galaxyId))
      routes.push({ a: a.name, b: b.name, timeMinutes: timeMs / 60_000, hourlyMin: pay.min * 3_600_000 / timeMs, hourlyMax: pay.max * 3_600_000 / timeMs })
    }
    if (process.argv.includes('--inspect')) console.log('LOADOUT', JSON.stringify({ plug, fitted, cap, warp: warpSpeedAus(state, ctx), cpu: fittedCpuUsed(state.fleet[state.shipId]!.fitted, ctx, ctx.ships.get('sh-colossal')), cpuBudget: cpuBudgetOf(state, ctx, state.shipId), routes }))
  }
}

function fittedWorld() {
  const state = world()
  assert(installPlug(state, ctx, 'plug-low-bay').ok)
  for (const id of [...Array(4).fill('mod-cargo-proto'), 'mod-turret-civ', 'mod-turret-civ', 'mod-hullrep-1', 'mod-shield-ext-1', 'mod-shield-ext-1']) {
    const result = fitModule(state, id, ctx)
    assert(result.ok, `${id}:${JSON.stringify(result)}`)
  }
  state.preparationSquads = { combat: [state.shipId] }
  return state
}

const state = fittedWorld()
const cap = cargoCapacityM3Of(state, ctx, state.shipId)
const ship = ctx.ships.get('sh-colossal')!
const player = createPlayerSpec(state, ctx, state.shipId)!
const endpoints = haulEndpoints(state, ctx)
const routes = []
for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
  const a = endpoints[i]!, b = endpoints[j]!
  const path = haulFleetPathOf(state, ctx, [state.shipId], a.galaxyId, b.galaxyId)
  const timeMs = path.reduce((sum, row) => sum + row.durationMs, 0)
  const reward = haulRewardRange(ctx, cap, haulEffectiveMinutes(ctx, a.galaxyId, b.galaxyId))
  routes.push({ a: a.name, b: b.name, from: a.galaxyId, to: b.galaxyId, timeMinutes: timeMs / 60_000,
    hourlyMin: reward.min * 3_600_000 / timeMs, hourlyMax: reward.max * 3_600_000 / timeMs,
    hourlyMean: (reward.min + reward.max) / 2 * 3_600_000 / timeMs, path })
}
const riskGalaxies = [...new Set(routes.flatMap(route => route.path.map(row => row.galaxyId)))].filter(id => (ctx.galaxies.get(id)?.security ?? 1) <= 0)
const reports = []
for (const galaxy of riskGalaxies) {
  const base = industrialBaseThreatOf(ctx, galaxy)
  assert(base !== null)
  const threat = industrialThreatOf(base, ship.massKg!, cap, ctx.balance.encounter.industrial.threat.profiles.hauling)
  const frequency = industrialFrequencyOf(ship.massKg!, 0, ctx.balance.encounter.industrial.frequency)
  // 仅生成器容量对照：测试配置限制为头目舰，不修改ctx或生产池权重。
  const maximumHullConfig = { ...ctx.balance.encounter.industrial.formation, pool: [{ shipId: 'foe-pirate-warlord', weight: 1 }] }
  const headOnly = pirateFormationOf(threat.targetThreat, 1, maximumHullConfig, ctx.foeShips!, ctx.balance.battle)!
  const headStrength = foeStrengthOf(headOnly.card, ctx.balance.battle)
  const samples = Array.from({ length: 128 }, (_, index) => {
    const generated = pirateFormationOf(threat.targetThreat, index + 1, ctx.balance.encounter.industrial.formation, ctx.foeShips!, ctx.balance.battle)!
    assert(generated)
    const strength = foeStrengthOf(generated.card, ctx.balance.battle)
    const composition: Record<string, number> = {}
    for (const slot of generated.card.ships!) composition[slot.ship.name] = (composition[slot.ship.name] ?? 0) + 1
    return { seed: index + 1, realizedThreat: generated.realizedThreat, count: generated.card.ships!.length,
      hp: strength.hp, dps: strength.dps, strength: strength.x, unusedStrength: generated.unusedStrength, composition }
  })
  const combats = []
  for (let seed = 1; seed <= 20; seed++) {
    const battleState = fittedWorld()
    assert(startHauling(battleState, null, 'site-cinder', ctx, cap).ok)
    battleState.rng = { seed, count: 0 }
    assert(spawnIndustrialEncounter(battleState, ctx, { galaxyId: galaxy, shipId: battleState.shipId, kind: '停留' }))
    const encounter = battleState.encounter
    const battle = encounter.battle!
    const enemy = foeStrengthOf(encounter.pirate!.card, ctx.balance.battle)
    const composition: Record<string, number> = {}
    for (const slot of encounter.pirate!.card.ships!) composition[slot.ship.name] = (composition[slot.ship.name] ?? 0) + 1
    let elapsed = 0
    while (battleState.encounter.active && elapsed <= ctx.balance.battle.maxBattleMs + 5000) {
      elapsed += 1000
      battleState.gameMs += 1000
      advanceEncounterWatch(battleState, ctx, 1000)
    }
    assert(!battleState.encounter.active, 'battle-did-not-settle')
    const runtime = battle.units.player!
    combats.push({ seed, targetThreat: encounter.pirate!.targetThreat, realizedThreat: encounter.pirate!.realizedThreat,
      composition, enemyHp: enemy.hp, enemyDps: enemy.dps, seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000,
      ended: battle.ended, autoEscaped: battle.autoEscaped === true, escapeReason: battle.escapeReason,
      hpAtCombatEnd: runtime.hp, hpMax: runtime.hpMax, damageDealt: battle.stats.meDmg,
      reportOutcome: battleState.battleReport?.outcome, sunk: !battleState.fleet['sh-colossal'],
      hullAfterSettlement: battleState.fleet['sh-colossal']?.durability, armorAfterSettlement: battleState.fleet['sh-colossal']?.armorPct,
      transportActive: battleState.hauling.active, returning: battleState.transit.active })
  }
  const minmax = (key: 'realizedThreat' | 'count' | 'hp' | 'dps') => [Math.min(...samples.map(row => row[key])), Math.max(...samples.map(row => row[key]))]
  const security = ctx.galaxies.get(galaxy)!.security ?? 1
  const baseProbability = Math.min(0.9, ctx.balance.encounter.ambushChanceAtZero + ctx.balance.encounter.ambushChancePerSec * Math.min(1.5, Math.max(0, ctx.balance.encounter.lowSecMax - security)))
  reports.push({ galaxy, name: ctx.galaxies.get(galaxy)!.name, security, baseThreat: base, threat,
    headOnlyCapacityComparison: { count: headOnly.card.ships!.length, realizedThreat: headOnly.realizedThreat, hp: headStrength.hp, dps: headStrength.dps, note: '仅头目舰测试池容量对照，不是正常池抽样结果或概率结论。' },
    frequencyMultiplier: frequency.multiplier, chancePerBaseEventBeforeSkillCorrection: baseProbability * frequency.multiplier,
    samples: { count: samples.length, realizedThreatRange: minmax('realizedThreat'), shipsRange: minmax('count'), hpRange: minmax('hp'), dpsRange: minmax('dps'),
      weakest: [...samples].sort((a, b) => a.strength - b.strength)[0], strongest: [...samples].sort((a, b) => b.strength - a.strength)[0] },
    combatSummary: { count: combats.length, wins: combats.filter(row => row.reportOutcome === 'win').length,
      retreats: combats.filter(row => row.reportOutcome === 'break').length, losses: combats.filter(row => row.reportOutcome === 'lose').length,
      sunk: combats.filter(row => row.sunk).length,
      hullRetreats: combats.filter(row => row.escapeReason === 'hull').length,
      cannotEngage: combats.filter(row => row.escapeReason === 'cannot-engage').length,
      hullAfterRange: [Math.min(...combats.map(row => row.hullAfterSettlement ?? 0)), Math.max(...combats.map(row => row.hullAfterSettlement ?? 0))],
      secondsRange: [Math.min(...combats.map(row => row.seconds)), Math.max(...combats.map(row => row.seconds))] }, combats })
}
const result = { target: 'd2-source-real-engine-independent-synthetic', balanceChanged: false,
  ship: { id: ship.id, name: ship.name, massKg: ship.massKg, cargoM3: cap, warp: warpSpeedAus(state, ctx),
    fitted: state.fleet[state.shipId]!.fitted, plugs: state.fleet[state.shipId]!.plugs,
    cpu: fittedCpuUsed(state.fleet[state.shipId]!.fitted, ctx, ship), cpuBudget: cpuBudgetOf(state, ctx, state.shipId),
    hp: player.hp, weapons: player.weapons.map(w => ({ label: w.label, kind: w.kind, count: w.count, shotsByType: w.shotsByType, shotDmg: w.shotDmg, reloadMs: w.reloadMs, maxRangeM: w.maxRangeM })) },
  routes, reports, limitations: ['满级技能和合法满舱运输配装，不代表所有满配定义；无额外护航。', '普通海盗池，每风险星系128阵容种子、20场真实战斗，非总体胜率或绝对最坏组合。', '测试主动创建一次遇袭以测敌人和战斗，不据此推算每趟遇袭次数；不读取个人档。'] }
const directory = resolve('tools/_ui-artifacts/oarfish-transport-20261101')
mkdirSync(directory, { recursive: true })
writeFileSync(resolve(directory, 'readings.json'), JSON.stringify(result, null, 2), 'utf8')
console.log(JSON.stringify({ ...result, routes: routes.map(({ path, ...route }) => route), reports: reports.map(({ combats, ...report }) => report) }, null, 2))
