/** 满技能全舰船编队夹具；只接受独立初始状态，不读取个人档。 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { MAX_SKILL_LEVEL, type GameState } from '../packages/core/src/state'
import { adjustDroneLoad, cpuOverloadText, droneBayTotalM3, droneLoadM3, fitModule } from '../packages/core/src/equipment'
import { notePreparationSquad } from '../packages/core/src/preparationSquads'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { shipHasWeapon } from '../packages/core/src/ships/fitting/stock'
import type { SimContext } from '../packages/core/src/types'

export function injectCommandFleetAllShipsFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  assert.equal(state.gameMs, 0, '只允许从未推进的初始状态合成')
  state.character.name = '多舰编队验收'
  state.modeChosen = true
  state.onboarding.step = 99
  state.debugQuick = false
  state.wallet.isk = 1_000_000_000
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.skills.queue = []
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, MAX_SKILL_LEVEL]))
  for (const item of ctx.items.values()) {
    if (!item.unreleased && (item.kind === 'ammo' || item.kind === 'drone')) state.warehouse.items[item.id] = 100_000
  }
  for (const id of ['repairkit-civ', 'repairkit-mil', 'repairkit-dc']) state.warehouse.items[id] = 10_000
  for (const mod of ctx.modules.values()) if (!mod.unreleased) state.moduleBay[mod.id] = 100
  state.resupplyFromWarehouse = true
  state.fleet = {}
  for (const def of ctx.ships.values()) if (!def.unreleased) addShipToFleet(state, def.id)
  const falconets = ['sh-falconet', ...Array.from({ length: 5 }, () => addShipToFleet(state, 'sh-falconet'))]
  state.shipId = falconets[0]!

  for (const [uid, ship] of Object.entries(state.fleet)) {
    const def = ctx.ships.get(ship.defId!)!
    if (def.civilianFittingOnly || def.role === 'industrial') continue
    const tier = def.tier >= 3 ? 3 : 2
    const weapon = def.weaponFamilyBonus?.explosive ? `mod-missile-${tier}`
      : def.weaponFamilyBonus?.plasma ? `mod-laser-${tier}` : `mod-turret-kin-${tier}`
    const droneCarrier = (def.droneDmgBonus ?? 0) > 0
    const high = def.slots?.high ?? 1
    const modules = droneCarrier ? [weapon, 'mod-drone-tac-2', ...Array(Math.max(0, high - 2)).fill(weapon)]
      : Array(high).fill(weapon) as string[]
    modules.push(def.repairPulseTargetsFleet ? 'mod-hullrep-2' : 'mod-prop-2', 'mod-shield-ext-2', 'mod-armor-plate-2')
    if ((def.slots?.low ?? 1) > 1) modules.push('mod-rof-2')
    for (const moduleId of modules) {
      const result = fitModule(state, moduleId, ctx, { shipId: uid })
      assert(result.ok, `${uid}/${moduleId}：${result.error}`)
    }
    const droneId = droneCarrier ? 'drone-assault' : 'drone-scout'
    const cap = droneBayTotalM3(def, ship.fitted, ctx)
    const count = Math.min(droneCarrier ? 8 : 2, Math.floor(cap / ctx.items.get(droneId)!.unitM3))
    if (count > 0) {
      const result = adjustDroneLoad(state, ctx, droneId, count, uid)
      assert(result.ok, `${uid}/${droneId}：${result.error}`)
    }
  }
  const roster = [...falconets, 'sh-swarm', 'sh-wh-a-frigate', 'sh-wh-c-frigate', 'sh-wh-d-frigate', 'sh-wh-e-frigate', 'sh-wh-g-frigate']
  assert(notePreparationSquad(state, 'combat', roster))
  assertCommandFleetAllShipsFixture(state, ctx)
  const budget = commandBudgetOf(state, ctx, roster)
  return [`独立合成：${ctx.skills.size}项技能全${MAX_SKILL_LEVEL}级，${Object.keys(state.fleet).length}艘舰船，覆盖全部已上线船型。`,
    `战斗编队${roster.length}舰，成本${budget.cost}/${budget.capacity}；全舰停靠母港、未代为出击。`,
    '10亿信用点、协会声望100、全星图、弹药无人机与装备备件齐备；调试加速关闭，舰体和敌人保持正常数值。']
}

/** 对正式读档结果复核，防止生成时存在而规范化时丢失。 */
export function assertCommandFleetAllShipsFixture(state: GameState, ctx: SimContext = buildSimContext()): void {
  const defs = [...ctx.ships.values()].filter(def => !def.unreleased)
  const ships = Object.entries(state.fleet)
  assert.deepEqual(new Set(ships.map(([, ship]) => ship.defId)), new Set(defs.map(def => def.id)))
  assert.equal(ships.length, defs.length + 5)
  for (const id of ctx.skills.keys()) assert.equal(state.skills.trained[id], MAX_SKILL_LEVEL, id)
  assert.equal(state.skills.queue.length, 0)
  for (const [uid, ship] of ships) {
    const def = ctx.ships.get(ship.defId!)!
    assert.equal(ship.durability, 1, uid)
    assert.equal(ship.armorPct, 1, uid)
    assert.equal(cpuOverloadText(state, ctx, uid), null, uid)
    assert(droneLoadM3(ship.droneLoad, ctx) <= droneBayTotalM3(def, ship.fitted, ctx), uid)
    if (!def.civilianFittingOnly && def.role !== 'industrial') assert(shipHasWeapon(state, ctx, uid), uid)
  }
  const roster = state.preparationSquads?.combat ?? []
  assert.equal(roster.length, 12)
  assert.equal(roster[0], state.shipId)
  assert.equal(commandBudgetOf(state, ctx, roster).ok, true)
  assert.equal(state.awayGalaxy, null)
  assert.equal(state.expedition.active, false)
  assert.equal(state.encounter.active, false)
  assert.equal(state.wormhole.run, null)
  assert.equal(state.debugQuick, false)
}
