/** 指挥成本设计读数，不改变任何生产规则。
 * npx tsx tools/command-budget-benchmark.ts [--seeds=12] [--roles | --budgets] [--out=目录]
 * 真实舰船/装备目录，正式装配入口和多舰战斗引擎；独立合成状态，不读个人档。
 * 默认输出tools/_ui-artifacts/command-budget-20261030/report.json。
 * --roles另测全部战斗舰、专用机群模板和辅助特性A/B，独立输出roster子目录。
 * --budgets从本批设计稿读取候选成本，测同预算组合并用现行训练公式计算容量候选。
 * 固定模板不是最优配装；名义DPS不是命中后DPS，实战仅覆盖所列敌卡与配置。
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, type GameState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule, adjustDroneLoad, cpuBudgetOf, fittedCpuUsed, droneCpuUsed } from '../packages/core/src/equipment'
import { createPlayerSpec, startFleetBattleFor, advanceBattleFor, waveGapTotalMs } from '../packages/core/src/combat'
import { desiredRangeFor } from '../packages/core/src/combat/foes/tactics'
import { volleyGunCountOf, volleyDamageShareOf } from '../packages/core/src/combat/combatVolley'
import { fleetDamageAuraOf } from '../packages/core/src/combat/fleetSpecs'
import { playerTargetWeightOf } from '../packages/core/src/combat/targeting'
import type { WeaponSpec } from '../packages/core/src/combat/model'
import { shipSlotsOf } from '../packages/core/src/labels'
import { totalTimeToLevel, trainingTimeFactor } from '../packages/core/src/skills/training'
import type { ShipDef } from '../packages/core/src/types'

const ctx = buildSimContext()
const roleMode = process.argv.includes('--roles')
const budgetMode = process.argv.includes('--budgets')
assert(!(roleMode && budgetMode), '--roles和--budgets须分别运行')
const outputArg = process.argv.find(arg => arg.startsWith('--out='))?.slice(6)
const out = outputArg ? resolve(outputArg) : resolve('tools/_ui-artifacts/command-budget-20261030', budgetMode ? 'budgets' : roleMode ? 'roster' : '.')
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

type Member = { defId: string; template: Template }
type FleetPlan = {
  id: string
  defs: string[]
  members?: Member[]
  budget?: number
  scenario?: 'fresh' | 'damaged'
  tactic?: Template['tactic']
}

// 仅接受本批现行候选表；格式、重复或目录不符即停，不从旧稿或生产表猜价格。
function discussionCosts(): Map<string, number> {
  const doc = readFileSync(resolve('docs/design/combat-command-budget-20261030.md'), 'utf8')
  const section = doc.split('## 逐船成本第一轮候选')[1]?.split('### 作业与运输船登记')[0]
  assert(section, '缺少逐船候选表')
  const prices = new Map<string, number>()
  const seen = new Set<string>()
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('| `sh-')) continue
    const columns = line.split('|').map(value => value.trim())
    assert.equal(columns.length, 7, `候选行格式错误: ${line}`)
    const id = columns[1]!.slice(1, -1)
    assert(ctx.ships.has(id) && !seen.has(id), `未知或重复舰型: ${id}`)
    seen.add(id)
    if (columns[3] === '待定') continue
    const price = Number(columns[3])
    assert(Number.isInteger(price) && price > 0, `非法候选成本: ${id}`)
    prices.set(id, price)
  }
  const combat = [...ctx.ships.values()].filter(ship => ship.role === 'armed' || ship.role === 'armored')
  assert.equal(seen.size, combat.length)
  assert(combat.every(ship => seen.has(ship.id)), '候选表漏舰')
  return prices
}

const budgetCosts = budgetMode ? discussionCosts() : new Map<string, number>()
const member = (defId: string, template = familyTemplate): Member => ({ defId, template })
const repeat = (defId: string, count: number, template = familyTemplate): Member[] => Array.from({ length: count }, () => member(defId, template))
const budgetPlans: FleetPlan[] = []
function plan(id: string, budget: number, members: Member[], scenario: FleetPlan['scenario'] = 'fresh', tactic?: Template['tactic']): void {
  if (!budgetMode) return
  const sum = members.reduce((total, row) => {
    const cost = budgetCosts.get(row.defId)
    assert(cost, `未定价舰型不能进入预算对照: ${row.defId}`)
    return total + cost
  }, 0)
  assert(sum <= budget && members.length <= 4, `${id}: 超出候选预算/4舰测量边界`)
  budgetPlans.push({ id, budget, members, defs: members.map(row => row.defId), scenario, tactic })
}
plan('shrike-2', 20, repeat('sh-shrike', 2))
plan('hammer-1', 20, repeat('sh-hammerhead', 1))
plan('tiger-2', 24, repeat('sh-tigershark', 2))
plan('sentinel-scout-1', 24, repeat('sh-sentinel', 1, carrierTemplates[0]!))
plan('sentinel-heavy-1', 24, repeat('sh-sentinel', 1, carrierTemplates[1]!))
plan('a-cruiser-1', 24, repeat('sh-wh-a-cruiser', 1))
plan('e-torpedo-2', 28, repeat('sh-wh-e-frigate', 2))
plan('e-carrier-scout-1', 28, repeat('sh-wh-e-carrier', 1, carrierTemplates[0]!))
plan('e-carrier-heavy-1', 28, repeat('sh-wh-e-carrier', 1, carrierTemplates[1]!))
plan('tortoise-2', 28, repeat('sh-tortoise', 2))
plan('xuanwu-1', 28, repeat('sh-xuanwu', 1))
plan('mako-2', 30, repeat('sh-mako', 2))
plan('mega-1', 30, repeat('sh-megalodon', 1))
plan('white-2', 36, repeat('sh-whiteshark', 2))
plan('hammer-mako', 36, [member('sh-hammerhead'), member('sh-mako')])
plan('hammer-command', 38, [member('sh-hammerhead'), member('sh-wh-d-destroyer')])
plan('hammer-white', 38, [member('sh-hammerhead'), member('sh-whiteshark')])
plan('hammer-logistics', 38, [member('sh-hammerhead'), member('sh-wh-g-destroyer', repairTemplate)])
plan('hammer-2', 40, repeat('sh-hammerhead', 2))
plan('shrike-4', 40, repeat('sh-shrike', 4))
plan('tiger-hawksbill', 32, [member('sh-tigershark'), member('sh-hawksbill')])
plan('hawksbill-tiger', 32, [member('sh-hawksbill'), member('sh-tigershark')])
plan('hammer-tiger', 32, [member('sh-hammerhead'), member('sh-tigershark')])
plan('hammer-orca', 52, [member('sh-hammerhead'), member('sh-orca')])
plan('hammer-2-tiger', 52, [...repeat('sh-hammerhead', 2), member('sh-tigershark')])
plan('hammer-2-d-electronic', 52, [...repeat('sh-hammerhead', 2), member('sh-wh-d-frigate')])
plan('hammer-2-a-electronic', 53, [...repeat('sh-hammerhead', 2), member('sh-wh-a-frigate')])
plan('mega-2', 60, repeat('sh-megalodon', 2))
plan('hammer-3', 60, repeat('sh-hammerhead', 3))
plan('hammer-4', 80, repeat('sh-hammerhead', 4))
plan('hammer-3-command', 80, [...repeat('sh-hammerhead', 3), member('sh-wh-d-destroyer')])
plan('hammer-2-command-2', 76, [...repeat('sh-hammerhead', 2), ...repeat('sh-wh-d-destroyer', 2)])
plan('hammer-2-white-2', 76, [...repeat('sh-hammerhead', 2), ...repeat('sh-whiteshark', 2)])
plan('hammer-3-orca', 92, [...repeat('sh-hammerhead', 3), member('sh-orca')])
plan('mega-3', 92, repeat('sh-megalodon', 3))
plan('mega-4', 120, repeat('sh-megalodon', 4))
plan('mega-3-orca', 125, [...repeat('sh-megalodon', 3), member('sh-orca')])
plan('orca-4', 128, repeat('sh-orca', 4))
plan('damaged-hammer-command', 38, [member('sh-hammerhead'), member('sh-wh-d-destroyer')], 'damaged')
plan('damaged-hammer-white', 38, [member('sh-hammerhead'), member('sh-whiteshark')], 'damaged')
plan('damaged-hammer-logistics', 38, [member('sh-hammerhead'), member('sh-wh-g-destroyer', repairTemplate)], 'damaged')
plan('hammer-2-repair', 40, repeat('sh-hammerhead', 2, repairTemplate), 'damaged')

function capacityReadings() {
  const tiers = [{ rank: 2, perLevel: 5 }, { rank: 4, perLevel: 7 }, { rank: 5, perLevel: 8 }]
  const baseCapacity = 25
  const prototype = ctx.skills.get('spaceship-command')!
  const learning = fresh(0, 1)
  learning.skills.trained['accelerated-learning'] = 5
  const learnedFactor = trainingTimeFactor(learning)
  learning.skillBoostUntilMs = 1
  const boostedFactor = trainingTimeFactor(learning)
  const allocations: { levels: number[]; capacity: number; trainHours: number }[] = []
  for (let first = 0; first <= 5; first++) for (let second = 0; second <= 5; second++) for (let third = 0; third <= 5; third++) {
    if ((second > 0 && first < 3) || (third > 0 && second < 3)) continue
    const levels = [first, second, third]
    const capacity = baseCapacity + tiers.reduce((sum, row, index) => sum + row.perLevel * levels[index]!, 0)
    const trainMs = tiers.reduce((sum, row, index) => sum + totalTimeToLevel({ ...prototype, rank: row.rank }, 0, levels[index]!), 0)
    allocations.push({ levels, capacity, trainHours: trainMs / 3_600_000 })
  }
  assert.equal(allocations.length, 66)
  const milestones = [25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 122, 125].map(required => {
    const fastest = allocations.filter(row => row.capacity >= required).sort((a, b) => a.trainHours - b.trainHours)[0]!
    assert(fastest && fastest.capacity >= required)
    return { required, ...fastest, learnedHours: fastest.trainHours * learnedFactor, boostedHours: fastest.trainHours * boostedFactor }
  })
  return { baseCapacity, tiers, prerequisiteLevel: 3, maxCapacity: Math.max(...allocations.map(row => row.capacity)),
    normalOnly: true, learnedFactor, boostedFactor,
    tierHours: tiers.map(row => ({ ...row, cumulativeHours: [1, 2, 3, 4, 5].map(level => totalTimeToLevel({ ...prototype, rank: row.rank }, 0, level) / 3_600_000) })),
    milestones, allocations }
}

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
    targetWeight: playerTargetWeightOf(spec),
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
for (const level of budgetMode ? [] : [0, 3, 5]) for (const template of roleMode ? roleTemplates : templates) for (const def of measured) {
  if (template.carrier && (def.droneBayM3 ?? 0) < 100) continue
  const state = fresh(level, 1)
  const uid = fitShip(state, def, template)
  fitted.push({ skillLevel: level, template: template.id, ...reading(state, uid) })
}
mkdirSync(out, { recursive: true })
if (!budgetMode) writeFileSync(resolve(out, 'fits.json'), JSON.stringify({ hulls, hullMedians, fitted }, null, 2), 'utf8')
console.log(JSON.stringify(budgetMode ? { phase: '预算方案校验完成', plans: budgetPlans.length, seeds }
  : { phase: '合法配装读数完成', hullMedians, fits: fitted.length }))

const fleets: FleetPlan[] = budgetMode ? budgetPlans : roleMode ? measured.map(def => ({ id: def.id, defs: [def.id] })) : [
  { id: 'tiger-1', defs: ['sh-tigershark'] },
  { id: 'mako-1', defs: ['sh-mako'] },
  { id: 'white-1', defs: ['sh-whiteshark'] },
  { id: 'tiger-2', defs: ['sh-tigershark', 'sh-tigershark'] },
  { id: 'tiger-4', defs: Array.from({ length: 4 }, () => 'sh-tigershark') },
  { id: 'mako-2', defs: ['sh-mako', 'sh-mako'] },
]
const targets = ['ano-redring-raiders', 'ano-shard-bandits', 'ano-echo-haunt', 'ano-cinder-siege', 'ano-starcore-boss', 'ano-gravekeeper']
if (budgetMode) targets.push('ano-vault-sentinel', 'ano-core-section', 'ano-maw-hunt')
const battles = []
for (const skillLevel of [0, 3]) for (const template of budgetMode ? [familyTemplate] : roleMode ? [familyTemplate, ...carrierTemplates] : templates.filter(row => row.support)) {
  for (const fleet of fleets) {
    if (roleMode && template.carrier && (ctx.ships.get(fleet.id)?.droneBayM3 ?? 0) < 100) continue
    const base = fresh(skillLevel, 1)
    const ids = fleet.members
      ? fleet.members.map(row => fitShip(base, ctx.ships.get(row.defId)!, row.template))
      : fleet.defs.map(id => fitShip(base, ctx.ships.get(id)!, template))
    const specs = ids.map(uid => reading(base, uid))
    const squadHp = specs.reduce((sum, row) => sum + row.hp, 0)
    const hullAura = fleetDamageAuraOf(base, ctx, ids)
    if (budgetMode) fitted.push({ skillLevel, fleet: fleet.id, members: fleet.members, specs })
    if (fleet.scenario === 'damaged') for (const id of ids) {
      base.fleet[id]!.armorPct = 0.35
      base.fleet[id]!.durability = 0.7
    }
    for (const target of targets) {
      const results = []
      for (let seed = 1; seed <= seeds; seed++) {
        const state = structuredClone(base)
        state.rng = { seed, count: 0 }
        const leaderTemplate = fleet.members?.[0]?.template ?? template
        const tactic = fleet.tactic ?? templateFor(ctx.ships.get(fleet.defs[0]!)!, leaderTemplate).tactic
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
          ...(budgetMode ? { kitsUsed: Object.values(battle.repairBy ?? {}).reduce((sum, ledger) => sum + ledger.kitsUsed, 0),
            fleetDamageAura: hullAura,
            members: (battle.myFleet ?? []).map(entry => ({ defId: state.fleet[entry.shipId]!.defId, tag: entry.tag,
              hp: battle.units[entry.tag]!.hp, kitsUsed: battle.repairBy?.[entry.tag]?.kitsUsed ?? 0 })) } : {}),
          droneLost: Object.values(battle.droneLost ?? {}).reduce((sum, count) => sum + (count ?? 0), 0) })
      }
      const wins = results.filter(result => result.won)
      const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
      battles.push({ skillLevel, template: template.id, fleet: fleet.id,
        ...(budgetMode ? { budget: fleet.budget, cost: fleet.defs.reduce((sum, id) => sum + budgetCosts.get(id)!, 0),
          defs: fleet.defs, scenario: fleet.scenario, members: fleet.members,
          nominalDpsWithHullAura: specs.reduce((sum, row) => sum + row.nominalDps, 0) * (1 + hullAura) } : {}),
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
  syntheticOnly: true, toolMutatesProductionRules: false, skillLevels: [0, 3], allKnownSkillsSameLevel: true,
  targeting: '现行playerTargetWeightOf舰级权重×插件乘数；先筛特殊倾向。不能把此报告当成旧等权基线。',
  commonKit: ['mod-prop-2', 'mod-shield-kin-2', 'mod-armor-plate-2'],
  fitting: '先固定通用防御，再填合法高槽；spare-slots模板用余中低槽和CPU加护盾扩展/动能稳定器，最后余CPU及原生机舱装侦察无人机；不装插件、专属件或扩容件，不是优化配装',
  battle: '所有方案使用同一多舰引擎，单舰同样走此入口；无普通遭遇结构自动撤退，仅比较战斗至胜负/时限，不含任务奖励/返航',
  limits: `固定模板与${targets.length}张常驻卡，不代表舰种全部潜力或最新远行星号数值；未按拟议指挥点实际限制生产入口`,
  ...(roleMode ? { mode: 'roles', baseAnchorsForDiscussion: { frigate: 10, destroyer: 15, cruiser: 20, battleship: 30 },
    roleFits: 'family模板按本舰最高武器族加成选武器；carrier用导控/中继/出击加速与原生机舱，repair模板装通用维修件',
    supportAB: '相同锤头鲨主战队与辅助船/配装/种子，仅在隔离上下文关闭该辅助船的船体光环/射程压制/队友维修，保持其他字段不动；不是移除舰船，也不代表按等成本交换已平衡',
  } : {}),
  ...(budgetMode ? { mode: 'budgets', pricesFrom: 'docs/design/combat-command-budget-20261030.md:逐船成本第一轮候选',
    candidateCosts: Object.fromEntries(budgetCosts), plans: budgetPlans,
    budgetLimits: '预算只是候选分组，不改生产门槛；余量不虚填舰船。2种技能档，9张卡；主控居首，战术取主控模板，不宣称各队最优距离。受损组为合成甲35%/结构70%，护盾满，不是连续作战模拟。',
    nominalDps: 'nominalDps为装配规格、未加队伍光环；nominalDpsWithHullAura另乘正式fleetDamageAuraOf，仍非实战命中后DPS。',
  } : {}),
}, hulls, hullMedians, fitted, battles, ...(roleMode ? { supportBattles } : {}), ...(budgetMode ? { capacity: capacityReadings() } : {}) }
if (budgetMode) {
  assert.equal(battles.length, budgetPlans.length * 2 * targets.length)
  assert.equal(fitted.length, budgetPlans.length * 2)
  for (const cell of battles) {
    assert.equal(cell.results.length, seeds)
    assert.equal(new Set(cell.results.map(row => row.seed)).size, seeds)
    assert.equal(cell.wins, cell.results.filter(row => row.won).length)
    assert(cell.cost! <= cell.budget!)
    assert(cell.results.every(row => Number.isFinite(row.hpLeftPct) && row.alive <= cell.defs!.length))
  }
}
if (budgetMode) writeFileSync(resolve(out, 'fits.json'), JSON.stringify({ fitted }, null, 2), 'utf8')
writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, trials: (battles.length + supportBattles.length) * seeds, cells: battles.length, supportCells: supportBattles.length, out }))
