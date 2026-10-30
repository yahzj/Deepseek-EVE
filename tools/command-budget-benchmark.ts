/** 指挥成本设计读数，不改变任何生产规则。
 * npx tsx tools/command-budget-benchmark.ts [--seeds=12] [--roles]
 * 真实舰船/装备目录，正式装配入口和多舰战斗引擎；独立合成状态，不读个人档。
 * 默认输出tools/_ui-artifacts/command-budget-20261030/report.json。
 * --roles另测全部战斗舰、专用机群模板和辅助特性A/B，独立输出roster子目录。
 * 固定模板不是最优配装；名义DPS不是命中后DPS，实战仅覆盖所列敌卡与配置。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, type GameState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule, adjustDroneLoad, cpuBudgetOf, fittedCpuUsed, droneCpuUsed } from '../packages/core/src/equipment'
import { createPlayerSpec, startFleetBattleFor, advanceBattleFor, waveGapTotalMs } from '../packages/core/src/combat'
import { desiredRangeFor } from '../packages/core/src/combat/foes/tactics'
import { volleyGunCountOf, volleyDamageShareOf } from '../packages/core/src/combat/combatVolley'
import type { WeaponSpec } from '../packages/core/src/combat/model'
import { shipSlotsOf } from '../packages/core/src/labels'
import type { ShipDef } from '../packages/core/src/types'

const ctx = buildSimContext()
const roleMode = process.argv.includes('--roles')
const out = resolve('tools/_ui-artifacts/command-budget-20261030', roleMode ? 'roster' : '.')
const seedArg = process.argv.find(arg => arg.startsWith('--seeds='))
const seeds = seedArg ? Number(seedArg.split('=')[1]) : 12
assert(Number.isInteger(seeds) && seeds >= 1 && seeds <= 100)
const official = [...ctx.ships.values()].filter(ship =>
  !ship.id.startsWith('sh-wh-') && (ship.role === 'armed' || ship.role === 'armored'))
const measured = roleMode ? [...ctx.ships.values()].filter(ship => ship.role === 'armed' || ship.role === 'armored') : official

type Template = {
  id: string
  weapon: string
  slots: 'all' | 'two'
  support: boolean
  drones: boolean
  fillSpare?: boolean
  carrier?: 'drone-scout' | 'drone-heavy'
  repairs?: boolean
  tactic: 'mid' | 'assault' | 'kite'
}
const templates: Template[] = [
  { id: 'two-kinetic-mk2', weapon: 'mod-turret-kin-2', slots: 'two', support: false, drones: false, tactic: 'mid' },
  { id: 'kinetic-mk2', weapon: 'mod-turret-kin-2', slots: 'all', support: true, drones: true, tactic: 'mid' },
  { id: 'laser-mk2', weapon: 'mod-laser-2', slots: 'all', support: true, drones: true, tactic: 'mid' },
  { id: 'missile-mk2', weapon: 'mod-missile-2', slots: 'all', support: true, drones: true, tactic: 'kite' },
  { id: 'kinetic-mk3', weapon: 'mod-turret-kin-3', slots: 'all', support: true, drones: true, tactic: 'mid' },
  { id: 'kinetic-mk2-spare-slots', weapon: 'mod-turret-kin-2', slots: 'all', support: true, drones: true, fillSpare: true, tactic: 'mid' },
]
const familyTemplate: Template = { id: 'family-mk2-spare-slots', weapon: 'mod-turret-kin-2', slots: 'all', support: true, drones: true, fillSpare: true, tactic: 'mid' }
const carrierTemplates: Template[] = ['drone-scout', 'drone-heavy'].map(carrier => ({
  id: `${carrier}-carrier-mk2`, weapon: 'mod-drone-tac-2', slots: 'all', support: true, drones: true,
  carrier: carrier as 'drone-scout' | 'drone-heavy', tactic: 'mid',
}))
const repairTemplate: Template = { id: 'repair-mk2', weapon: 'mod-turret-kin-2', slots: 'two', support: true, drones: true, repairs: true, tactic: 'mid' }
const roleTemplates = [familyTemplate, ...carrierTemplates, repairTemplate]

function templateFor(def: ShipDef, template: Template): Template {
  if (template.id !== familyTemplate.id) return template
  const [type] = Object.entries(def.weaponFamilyBonus ?? {}).sort((a, b) => b[1]! - a[1]!)[0] ?? ['kinetic']
  const weapon = type === 'explosive' ? 'mod-missile-2' : type === 'plasma' ? 'mod-laser-2' : 'mod-turret-kin-2'
  return { ...template, weapon, tactic: type === 'explosive' ? 'kite' : 'mid' }
}

function fresh(level: number, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.fleet = {}
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, level]))
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  state.completedBounties = [...ctx.anomalies.keys()]
  for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[id] = 1_000_000
  state.resupplyFromWarehouse = true
  state.warehouse.items['repairkit-mil'] = 100_000
  return state
}

function equip(state: GameState, shipId: string, moduleId: string): void {
  state.moduleBay[moduleId] = (state.moduleBay[moduleId] ?? 0) + 1
  const result = fitModule(state, moduleId, ctx, { shipId })
  assert(result.ok, `${shipId}/${moduleId}: ${JSON.stringify(result)}`)
}

function fitShip(state: GameState, def: ShipDef, template: Template): string {
  template = templateFor(def, template)
  const uid = addShipToFleet(state, def.id)
  if (Object.keys(state.fleet).length === 1) state.shipId = uid
  const slots = shipSlotsOf(def)
  state.fleet[uid]!.fitted = {
    high: Array.from({ length: slots.high }, () => null),
    mid: Array.from({ length: slots.mid }, () => null),
    low: Array.from({ length: slots.low }, () => null),
  }
  if (template.support) {
    equip(state, uid, 'mod-prop-2')
    equip(state, uid, 'mod-shield-kin-2')
    equip(state, uid, 'mod-armor-plate-2')
  }
  if (template.repairs) for (let index = 2; index < slots.mid; index++) equip(state, uid, 'mod-hullrep-2')
  if (template.carrier) {
    equip(state, uid, 'mod-drone-tac-2')
    if (slots.high >= 2) equip(state, uid, 'mod-drone-relay-2')
    if (slots.high >= 3) equip(state, uid, 'mod-drone-launch-2')
    for (let index = 3; index < slots.high; index++) equip(state, uid, 'mod-drone-tac-2')
    if (slots.low >= 2) equip(state, uid, 'mod-drone-rack-2')
  }
  const limit = template.carrier ? 0 : template.slots === 'two' ? 2 : slots.high
  for (let index = 0; index < limit; index++) {
    const module = ctx.modules.get(template.weapon)!
    if (fittedCpuUsed(state.fleet[uid]!.fitted, ctx, def) + (module.cpuUse ?? 0) > cpuBudgetOf(state, ctx, uid)) break
    equip(state, uid, template.weapon)
  }
  const damageType = ctx.modules.get(template.weapon)?.damageType ?? 'kinetic'
  const stability = damageType === 'explosive' ? 'mod-stab-exp-2' : damageType === 'plasma' ? 'mod-stab-pla-2' : 'mod-stab-kin-2'
  if (template.fillSpare) for (const [rack, moduleId] of [['mid', 'mod-shield-ext-2'], ['low', stability]] as const) {
    while (state.fleet[uid]!.fitted[rack].includes(null)) {
      const cpu = ctx.modules.get(moduleId)!.cpuUse ?? 0
      if (fittedCpuUsed(state.fleet[uid]!.fitted, ctx, def) + cpu > cpuBudgetOf(state, ctx, uid)) break
      equip(state, uid, moduleId)
    }
  }
  if (template.drones) {
    const droneId = template.carrier ?? 'drone-scout'
    state.warehouse.items[droneId] = 100_000
    for (let index = 0; index < 300; index++) {
      const result = adjustDroneLoad(state, ctx, droneId, 1, uid)
      if (!result.ok) break
    }
  }
  const spec = createPlayerSpec(state, ctx, uid)!
  assert(template.carrier ? spec.weapons.some(weapon => weapon.src === 'drone') : spec.weapons.some(weapon => weapon.moduleId === template.weapon), `${def.id}: no template weapon`)
  assert(fittedCpuUsed(state.fleet[uid]!.fitted, ctx, def) + droneCpuUsed(state.fleet[uid]!.droneLoad, ctx) <= cpuBudgetOf(state, ctx, uid))
  return uid
}

// 玩家同型号武器已合并为整组齐射伤害，按真实开火拆分后求和，不能再额外乘门数。
function volleyDps(weapon: WeaponSpec): number {
  const damage = weapon.kind === 'gun' ? Object.values(weapon.shotsByType ?? {})[0] ?? 0 : weapon.shotDmg ?? 0
  const count = volleyGunCountOf(weapon)
  let total = 0
  for (let index = 0; index < count; index++) total += volleyDamageShareOf(damage, count, index)
  return total / (weapon.reloadMs / 1000)
}

function reading(state: GameState, uid: string) {
  const ship = state.fleet[uid]!
  const def = ctx.ships.get(ship.defId!)!
  const spec = createPlayerSpec(state, ctx, uid)!
  const active = spec.weapons.filter(weapon => !weapon.disabled)
  return {
    id: def.id, name: def.name, tier: def.tier, role: def.role, subClass: def.subClass,
    hp: spec.hp.s + spec.hp.a + spec.hp.h,
    nominalDps: active.reduce((total, weapon) => total + volleyDps(weapon), 0),
    gunDps: active.filter(weapon => weapon.src !== 'drone').reduce((total, weapon) => total + volleyDps(weapon), 0),
    droneDps: active.filter(weapon => weapon.src === 'drone').reduce((total, weapon) => total + volleyDps(weapon), 0),
    weapons: ship.fitted.high.filter(Boolean).length,
    drones: Object.values(ship.droneLoad ?? {}).reduce((a, b) => a + b, 0),
    cpuUsed: fittedCpuUsed(ship.fitted, ctx, def) + droneCpuUsed(ship.droneLoad, ctx),
    cpuBudget: cpuBudgetOf(state, ctx, uid),
    speed: spec.speedMps, evasion: spec.evasion, hitBonus: spec.hitBonus,
    slots: shipSlotsOf(def), fitted: structuredClone(ship.fitted), resists: spec.resists,
    ...(roleMode ? { traits: { fleetDamage: def.fleetDamageBonusPct ?? 0, foeRangeDebuff: def.foeRangeDebuffPct ?? 0,
      repairTargetsFleet: def.repairPulseTargetsFleet === true, droneLaunchCut: def.droneLaunchCutPct ?? 0,
      droneDmgBonus: def.droneDmgBonus ?? 0, weaponFamilyBonus: def.weaponFamilyBonus ?? {},
      stealthCpuMul: def.stealthCpuMul ?? 1 } } : {}),
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const hulls = official.map(ship => ({ id: ship.id, name: ship.name, tier: ship.tier, role: ship.role,
  hp: (ship.shieldHp ?? 0) + (ship.armorHp ?? 0) + (ship.hullHp ?? 0), cpu: ship.cpu ?? 0,
  slots: shipSlotsOf(ship), speed: ship.maxSpeedMps ?? 0, evasion: ship.evasion ?? 0 }))
const hullMedians = [1, 2, 3, 4, 5].map(tier => {
  const rows = hulls.filter(ship => ship.tier === tier)
  return { tier, count: rows.length, hp: median(rows.map(ship => ship.hp)), cpu: median(rows.map(ship => ship.cpu)),
    high: median(rows.map(ship => ship.slots.high)), speed: median(rows.map(ship => ship.speed)), evasion: median(rows.map(ship => ship.evasion)) }
})
const fitted = []
for (const level of [0, 3, 5]) for (const template of roleMode ? roleTemplates : templates) for (const def of measured) {
  if (template.carrier && (def.droneBayM3 ?? 0) < 100) continue
  const state = fresh(level, 1)
  const uid = fitShip(state, def, template)
  fitted.push({ skillLevel: level, template: template.id, ...reading(state, uid) })
}
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'fits.json'), JSON.stringify({ hulls, hullMedians, fitted }, null, 2), 'utf8')
console.log(JSON.stringify({ phase: '合法配装读数完成', hullMedians, fits: fitted.length }))

const fleets = roleMode ? measured.map(def => ({ id: def.id, defs: [def.id] })) : [
  { id: 'tiger-1', defs: ['sh-tigershark'] },
  { id: 'mako-1', defs: ['sh-mako'] },
  { id: 'white-1', defs: ['sh-whiteshark'] },
  { id: 'tiger-2', defs: ['sh-tigershark', 'sh-tigershark'] },
  { id: 'tiger-4', defs: Array.from({ length: 4 }, () => 'sh-tigershark') },
  { id: 'mako-2', defs: ['sh-mako', 'sh-mako'] },
]
const targets = ['ano-redring-raiders', 'ano-shard-bandits', 'ano-echo-haunt', 'ano-cinder-siege', 'ano-starcore-boss', 'ano-gravekeeper']
const battles = []
for (const skillLevel of [0, 3]) for (const template of roleMode ? [familyTemplate, ...carrierTemplates] : templates.filter(row => row.support)) {
  for (const fleet of fleets) {
    if (roleMode && template.carrier && (ctx.ships.get(fleet.id)?.droneBayM3 ?? 0) < 100) continue
    const base = fresh(skillLevel, 1)
    const ids = fleet.defs.map(id => fitShip(base, ctx.ships.get(id)!, template))
    const specs = ids.map(uid => reading(base, uid))
    const squadHp = specs.reduce((sum, row) => sum + row.hp, 0)
    for (const target of targets) {
      const results = []
      for (let seed = 1; seed <= seeds; seed++) {
        const state = structuredClone(base)
        state.rng = { seed, count: 0 }
        const tactic = templateFor(ctx.ships.get(fleet.defs[0]!)!, template).tactic
        const desire = desiredRangeFor(createPlayerSpec(state, ctx, ids[0]!)!, tactic, ctx.balance.battle)
        const battle = startFleetBattleFor(state, ctx, ids, target, 0, desire)
        assert(battle)
        state.gameMs = ctx.balance.battle.maxBattleMs + 10_000 + waveGapTotalMs(ctx.anomalies.get(target), ctx.balance.battle)
        advanceBattleFor(state, ctx, battle, ids[0]!, target)
        assert(battle.ended !== null, `Unfinished: ${target}/${fleet.id}/${template.id}`)
        const alive = (battle.myFleet ?? []).filter(entry => {
          const unit = battle.units[entry.tag]!
          return unit.hp.s + unit.hp.a + unit.hp.h > 0
        })
        const hpLeft = (battle.myFleet ?? []).reduce((sum, entry) => {
          const hp = battle.units[entry.tag]!.hp
          return sum + hp.s + hp.a + hp.h
        }, 0)
        const ammoUsed = Object.entries(battle.ammoLoaded ?? {}).reduce((sum, [key, loaded]) =>
          sum + Math.max(0, loaded - (battle.ammo[key as keyof typeof battle.ammo] ?? 0)), 0)
        results.push({ seed, won: battle.ended === 'me', durationSeconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000,
          alive: alive.length, hpLeftPct: hpLeft / squadHp * 100, ammoUsed,
          droneLost: Object.values(battle.droneLost ?? {}).reduce((sum, count) => sum + (count ?? 0), 0) })
      }
      const wins = results.filter(result => result.won)
      const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
      battles.push({ skillLevel, template: template.id, fleet: fleet.id,
        squadHp, nominalDps: specs.reduce((sum, row) => sum + row.nominalDps, 0), target, targetName: ctx.anomalies.get(target)!.name,
        trials: seeds, wins: wins.length, winPercent: wins.length / seeds * 100,
        meanWinSeconds: mean(wins.map(result => result.durationSeconds)), meanHpLeftPct: mean(results.map(result => result.hpLeftPct)),
        meanSurvivors: mean(results.map(result => result.alive)), meanAmmoUsed: mean(results.map(result => result.ammoUsed)),
        meanDroneLost: mean(results.map(result => result.droneLost)), results })
    }
    console.log(JSON.stringify({ phase: '实战', skillLevel, template: template.id, fleet: fleet.id, finishedTargets: targets.length }))
  }
}
const supportBattles = []
if (roleMode) {
  const supports = ['sh-wh-a-frigate', 'sh-wh-d-frigate', 'sh-wh-d-destroyer', 'sh-orca', 'sh-wh-g-destroyer']
  for (const supportId of supports) for (const teamSize of [2, 4]) {
    const original = ctx.ships.get(supportId)!
    const ablated = { ...original, fleetDamageBonusPct: 0, foeRangeDebuffPct: 0, repairPulseTargetsFleet: false }
    const without = { ...ctx, ships: new Map(ctx.ships).set(supportId, ablated) }
    for (const target of targets) for (const enabled of [true, false]) {
      const local = enabled ? ctx : without
      const results = []
      for (let seed = 1; seed <= seeds; seed++) {
        const state = fresh(3, seed)
        const ids = Array.from({ length: teamSize - 1 }, () => fitShip(state, ctx.ships.get('sh-hammerhead')!, familyTemplate))
        ids.push(fitShip(state, original, original.repairPulseTargetsFleet ? repairTemplate : familyTemplate))
        const initialHp = ids.reduce((sum, id) => {
          const hp = createPlayerSpec(state, local, id)!.hp
          return sum + hp.s + hp.a + hp.h
        }, 0)
        state.rng = { seed, count: 0 }
        const desire = desiredRangeFor(createPlayerSpec(state, local, ids[0]!)!, 'mid', local.balance.battle)
        const battle = startFleetBattleFor(state, local, ids, target, 0, desire)
        assert(battle)
        state.gameMs = local.balance.battle.maxBattleMs + 10_000 + waveGapTotalMs(local.anomalies.get(target), local.balance.battle)
        advanceBattleFor(state, local, battle, ids[0]!, target)
        assert(battle.ended !== null)
        const hpLeft = (battle.myFleet ?? []).reduce((sum, entry) => {
          const hp = battle.units[entry.tag]!.hp
          return sum + hp.s + hp.a + hp.h
        }, 0)
        results.push({ seed, won: battle.ended === 'me', seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000,
          hpLeftPct: hpLeft / initialHp * 100, kitsUsed: Object.values(battle.repairBy ?? {}).reduce((sum, ledger) => sum + ledger.kitsUsed, 0),
          rangeDebuff: battle.meFoeRangeDebuff ?? 0 })
      }
      const wins = results.filter(row => row.won)
      supportBattles.push({ supportId, supportName: original.name, teamSize, target, targetName: ctx.anomalies.get(target)!.name, enabled,
        wins: wins.length, trials: seeds, meanWinSeconds: wins.length ? wins.reduce((sum, row) => sum + row.seconds, 0) / wins.length : null,
        meanHpLeftPct: results.reduce((sum, row) => sum + row.hpLeftPct, 0) / results.length,
        meanKitsUsed: results.reduce((sum, row) => sum + row.kitsUsed, 0) / results.length, results })
    }
    console.log(JSON.stringify({ phase: '辅助A/B', supportId, teamSize, targets: targets.length }))
  }
}
const report = { assumptions: {
  syntheticOnly: true, productionChanged: false, skillLevels: [0, 3], allKnownSkillsSameLevel: true,
  commonKit: ['mod-prop-2', 'mod-shield-kin-2', 'mod-armor-plate-2'],
  fitting: '先固定通用防御，再填合法高槽；spare-slots模板用余中低槽和CPU加护盾扩展/动能稳定器，最后余CPU及原生机舱装侦察无人机；不装插件、专属件或扩容件，不是优化配装',
  battle: '所有方案使用同一多舰引擎，单舰同样走此入口；无普通遭遇结构自动撤退，仅比较战斗至胜负/时限，不含任务奖励/返航',
  limits: '固定模板与6张常驻卡，不代表舰种全部潜力或最新远行星号数值；未按拟议指挥点实际限制生产入口',
  ...(roleMode ? { mode: 'roles', baseAnchorsForDiscussion: { frigate: 10, destroyer: 15, cruiser: 20, battleship: 30 },
    roleFits: 'family模板按本舰最高武器族加成选武器；carrier用导控/中继/出击加速与原生机舱，repair模板装通用维修件',
    supportAB: '相同锤头鲨主战队与辅助船/配装/种子，仅在隔离上下文关闭该辅助船的船体光环/射程压制/队友维修，保持其他字段不动；不是移除舰船，也不代表按等成本交换已平衡',
  } : {}),
}, hulls, hullMedians, fitted, battles, ...(roleMode ? { supportBattles } : {}) }
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, trials: (battles.length + supportBattles.length) * seeds, cells: battles.length, supportCells: supportBattles.length, out }))
