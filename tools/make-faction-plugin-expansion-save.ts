/** 新增阵营插件独立验收：node --import tsx tools/make-faction-plugin-expansion-save.ts；不读个人档。 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext, COMMS_MESSAGES } from '@whale/data'
import { addLog, createInitialState, MAX_SKILL_LEVEL, type GameState } from '../packages/core/src/state'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, cpuOverloadText, droneBayTotalM3, droneLoadM3, fitModule } from '../packages/core/src/equipment'
import { installPlug, plugSlotsOf } from '../packages/core/src/plugs'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { createPlayerSpec } from '../packages/core/src/combat/player/create'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const ctx = buildSimContext()
const now = Date.now()
const state = createInitialState({ nowWallMs: now, seed: 20261104 })
const plugins = ['plug-pirate-damage-management', 'plug-alien-nanobiomass', 'plug-gravekeeper-charge',
  'plug-titan-drone-command', 'plug-deadarmy-reinforced-hull'] as const
const [a, c, d, e, g] = plugins
for (const id of plugins) {
  assert(ctx.modules.has(id), `插件数据尚未就绪：${id}`)
  assert(ctx.blueprints.get(`bp-once-${id}`)?.singleUse, `一次性图纸尚未就绪：${id}`)
}
state.modeChosen = true
state.onboarding.step = 99
state.character.name = '阵营插件扩充验收'
state.debugQuick = false
state.wallet.isk = 1_000_000_000
state.standings.dsi = 100
state.standingsEarned = { dsi: 100 }
state.blackboxSeen = true
state.exploredGalaxies = [...ctx.galaxies.keys()]
for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, MAX_SKILL_LEVEL]))
state.skills.queue = []
state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
state.commsPopups = []
state.resupplyFromWarehouse = true
for (const item of ctx.items.values()) {
  if (!item.unreleased && ['ammo', 'drone'].includes(item.kind)) state.warehouse.items[item.id] = 10_000
}
for (const id of ['repairkit-civ', 'repairkit-mil', 'repairkit-dc', 'jump-fuel']) state.warehouse.items[id] = 1000
addLog(state, 'system', '独立合成验收开始：从初始状态准备阵营插件对照，不读取个人档。')

function add(name: string, defId: string, modules: readonly string[], plugs: readonly string[] = [], drones = 0): string {
  const uid = addShipToFleet(state, defId)
  state.fleet[uid]!.customName = name
  for (const id of modules) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    const result = fitModule(state, id, ctx, { shipId: uid })
    assert(result.ok, `${uid}/${id}：${result.error}`)
  }
  for (const id of plugs) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    assert(installPlug(state, ctx, id, uid).ok, `${uid}/${id}安装失败`)
  }
  if (drones) assert(adjustDroneLoad(state, ctx, 'drone-scout', drones, uid).ok, `${uid}无人机装载失败`)
  assert.equal(cpuOverloadText(state, ctx, uid), null, uid)
  return uid
}

const aModules = ['mod-turret-kin-1', 'mod-salvager-1', 'mod-prop-1']
const aManaged = add('A 双件与重复战损', 'sh-wh-a-frigate', aModules, [a, a])
const aControl = add('A 同战损无插件', 'sh-wh-a-frigate', aModules)
for (const uid of [aManaged, aControl]) {
  state.fleet[uid]!.damagePlugs = ['shield', 'shield', 'armor', 'hull', 'speed', 'cargo', 'range']
}
const cModules = ['mod-laser-1', 'mod-prop-1']
const cHealing = add('C 半装甲自愈', 'sh-wh-c-destroyer', cModules, [c])
const cControl = add('C 半装甲无插件', 'sh-wh-c-destroyer', cModules)
for (const uid of [cHealing, cControl]) state.fleet[uid]!.armorPct = 0.5
const dModules = ['mod-turret-kin-1', 'mod-missile-1', 'mod-laser-1', 'mod-prop-1']
const dCharged = add('D 蓄能三武器', 'sh-wh-d-cruiser', dModules, [d])
const dControl = add('D 同武器无插件', 'sh-wh-d-cruiser', dModules)
const eModules = ['mod-turret-kin-1', 'mod-drone-tac-2', 'mod-drone-deck-1', 'mod-prop-1']
const eCommand = add('E 指挥主源双件', 'sh-wh-e-carrier', eModules, [e, e], 8)
const eSecondary = add('E 次源指挥对照', 'sh-wh-e-destroyer', eModules, [e], 6)
const eControl = add('E 普通无人机友舰', 'sh-wh-e-destroyer', eModules, [], 6)
const gModules = ['mod-turret-kin-1', 'mod-prop-1']
const gRecover = add('G 活船回收与旧战损', 'sh-wh-g-frigate', gModules, [g])
const gControl = add('G 同战损无插件', 'sh-wh-g-frigate', gModules)
for (const uid of [gRecover, gControl]) state.fleet[uid]!.damagePlugs = ['hull', 'hull', 'cargo']
const recovery = add('回收作业备用船', 'sh-manatee', ['mod-salvager-1'])
state.shipId = aManaged
const roster = [aManaged, cHealing, dCharged, eCommand, eControl, gRecover]
assert(notePreparationSquad(state, 'combat', roster))
assert(commandBudgetOf(state, ctx, roster).ok)
assert(commandBudgetOf(state, ctx, [eCommand, eSecondary, eControl]).ok)

for (const id of plugins) {
  state.moduleBay[id] = 3
  const bp = ctx.blueprints.get(`bp-once-${id}`)!
  state.blueprintStock[bp.id] = 3
  for (const material of bp.materials) {
    const itemId = material.itemId.startsWith('blackbox-') ? 'blackbox-universal' : material.itemId
    state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + material.count * 3
  }
}
for (const family of ['a', 'c', 'd', 'e', 'g']) state.warehouse.items[`box-encrypted-${family}`] = 20
for (const id of ['mod-gravekeeper-crisis', 'mod-gravekeeper-rebirth', 'mod-lair-armor-c',
  'plug-gravekeeper-capacitor', 'plug-alien-shield-coating']) {
  assert(ctx.modules.has(id), `对照备件不存在：${id}`)
  state.moduleBay[id] = Math.max(state.moduleBay[id] ?? 0, 3)
}
addLog(state, 'system', '独立合成验收完成：六舰110/125预算停港，图纸未使用，全部舰船存活；另备对照舰与回收船。')

function validate(read: GameState): void {
  assert.equal(read.gameMs, 0)
  assert.equal(read.awayGalaxy, null)
  assert.equal(read.departure, undefined)
  assert.equal(read.encounter.active, false)
  assert.equal(read.encounter.battle, null)
  assert.equal(read.expedition.active, false)
  assert.equal(read.expedition.battle, null)
  assert.equal(read.wormhole.run, null)
  assert.equal(read.mining.active, false)
  assert.equal(read.hauling.active, false)
  assert.equal(read.salvaging.active, false)
  assert.equal(read.transit.active, false)
  assert.equal(read.debugQuick, false)
  assert.equal(read.manufacturingRuns.length, 0)
  assert.equal(read.refineRuns.length, 0)
  assert.equal(Object.keys(read.shipWrecks ?? {}).length, 0)
  assert.deepEqual(read.preparationSquads?.combat, roster)
  assert.equal(commandBudgetOf(read, ctx, roster).ok, true)
  assert.deepEqual(new Set(Object.values(read.fleet).map(ship => ctx.ships.get(ship.defId!)!.tier)), new Set([1, 2, 3]))
  for (const [uid, ship] of Object.entries(read.fleet)) {
    const def = ctx.ships.get(ship.defId!)!
    assert(ship.durability > 0, uid)
    assert.equal(cpuOverloadText(read, ctx, uid), null, uid)
    assert((ship.plugs?.length ?? 0) <= plugSlotsOf(read, ctx, uid), uid)
    assert(droneLoadM3(ship.droneLoad, ctx) <= droneBayTotalM3(def, ship.fitted, ctx), uid)
  }
  for (const id of plugins) {
    assert.equal(read.moduleBay[id], 3, id)
    assert.equal(read.blueprintStock[`bp-once-${id}`], 3, id)
    assert(!read.learnedRecipes.includes(`bp-once-${id}`), id)
    assert(!read.learnedRecipes.includes(`bp-${id}`), id)
    assert(!(read.spentOneTimeRecipes ?? []).includes(`bp-once-${id}`), id)
  }
  assert.equal(read.fleet[cHealing]!.armorPct, 0.5)
  assert.equal(read.fleet[cControl]!.armorPct, 0.5)
  assert.deepEqual(read.fleet[aManaged]!.damagePlugs, state.fleet[aManaged]!.damagePlugs)
  assert.deepEqual(read.fleet[gRecover]!.damagePlugs, state.fleet[gRecover]!.damagePlugs)
  const charged = createPlayerSpec(read, ctx, dCharged)!
  assert(charged.weapons.some(weapon => weapon.src === 'turret' && (weapon.shotsByType?.kinetic ?? 0) > 0))
  assert(charged.weapons.some(weapon => weapon.src === 'missile'))
  assert(charged.weapons.some(weapon => weapon.src === 'laser'))
  assert((createPlayerSpec(read, ctx, eCommand)!.droneDamageBonusPct ?? 0) >
    (createPlayerSpec(read, ctx, eSecondary)!.droneDamageBonusPct ?? 0))
  assert.equal(read.fleet[recovery]!.durability, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(read.fleet)), JSON.parse(JSON.stringify(state.fleet)))
  assert.deepEqual(read.warehouse, state.warehouse)
  assert.deepEqual(read.blueprintStock, state.blueprintStock)
}

const text = serializeSaveFile(state, now)
const read = loadSaveFile(text).state
validate(read)
validate(loadSaveFile(serializeSaveFile(read, now)).state)
const directory = resolve('docs/test-saves')
mkdirSync(directory, { recursive: true })
const target = resolve(directory, 'test-save-faction-plugin-expansion-20261104.json')
writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' })
validate(loadSaveFile(readFileSync(target, 'utf8')).state)
console.log(JSON.stringify({ target, fleetSize: Object.keys(state.fleet).length,
  budget: commandBudgetOf(state, ctx, roster), roster,
  controls: { aControl, cControl, dControl, eSecondary, eControl, gControl, recovery },
  newPluginStock: Object.fromEntries(plugins.map(id => [id, state.moduleBay[id]])),
  idleAtHome: true, personalSaveRead: false, battleStarted: false, manufactured: false }, null, 2))
