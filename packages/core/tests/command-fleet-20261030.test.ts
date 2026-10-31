import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { commandBudgetOf, commandCapacityOf, shipCommandCostOf } from '../src/combat/command/rules'
import { startExpedition } from '../src/expedition/launch'
import { advanceExpedition } from '../src/expedition/advance'
import { resolveBattleOutcome } from '../src/expedition/outcome'
import { retreatBattle } from '../src/expedition/retreat'
import { shipOperationBlockReason } from '../src/shipActionPolicy'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { notePreparationSquad } from '../src/preparationSquads'
import { createPlayerSpec, startFleetBattleFor, startBattleFor, advanceBattleFor } from '../src/combat'
import { enemyFleetRoom } from '../src/combat/foes/capacity'
import type { AnomalyDef } from '../src/types'
import { denseBattleLayout } from '../../../apps/desktop/src/renderer/src/features/combat/battleDenseGeometry'
import { applyActivityGate } from '../src/activityGate'
import { checkAssignable, idleAiShipIds } from '../src/ai/cores'
import { fightEncounter } from '../src/encounters/commands'
import { battleAmmoIdsFor, consumeBattleAmmo, refundBattleAmmo } from '../src/combat/combatAmmo'
import { deployedCombatEscorts } from '../src/combat/command/locks'
import { combatRosterOf, cleanCombatSortie } from '../src/combat/command/roster'
import { enqueueSkill, skillLockMissing } from '../src/skills/queue'
import { recallExpedition } from '../src/expedition/recall'
import { advanceGame } from '../src/engine'
import { changeShip } from '../src/shipyard'
import { visibleEnemyTags } from '../../../apps/desktop/src/renderer/src/features/combat/battleVisibleFleet'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendNoteContribution } from '../src/weekendEvent'

const ctx = buildSimContext()
function world(count = 2) {
  const state = createInitialState({ nowWallMs: 0, seed: 8 })
  state.fleet = {}
  const ids = Array.from({ length: count }, () => addShipToFleet(state, 'sh-shrike'))
  state.shipId = ids[0]!
  state.standingsEarned = { dsi: 20 }
  state.standings.dsi = 0
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  for (const id of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration']) state.skills.trained[id] = 5
  notePreparationSquad(state, 'combat', ids)
  return { state, ids }
}

describe('统一指挥预算', () => {
  it('46船均有正整数成本，容量25到125且脏等级不突破', () => {
    expect([...ctx.ships.values()]).toHaveLength(46)
    for (const ship of ctx.ships.values()) {
      expect(Number.isSafeInteger(ship.commandCost), ship.id).toBe(true)
      expect(shipCommandCostOf(ship)).toBeGreaterThan(0)
    }
    const { state } = world()
    expect(commandCapacityOf(state)).toBe(125)
    state.skills.trained = {}
    expect(commandCapacityOf(state)).toBe(25)
    state.skills.trained = { 'fleet-command-basic': NaN, 'fleet-command-coordination': 999, 'fleet-command-integration': -5 }
    expect(commandCapacityOf(state)).toBe(60)
    expect(shipCommandCostOf(undefined)).toBeGreaterThan(0)
  })

  it('累计19/20与余额不同，恰好容量/差1、重复和13艘明确拒绝', () => {
    const { state, ids } = world(13)
    state.skills.trained = {}
    expect(commandBudgetOf(state, ctx, ids.slice(0, 2)).ok).toBe(true)
    state.standingsEarned!.dsi = 19
    state.standings.dsi = 999
    expect(commandBudgetOf(state, ctx, ids.slice(0, 2)).errorId).toBe('core.command.004')
    expect(commandBudgetOf(state, ctx, [ids[0]!]).ok).toBe(true)
    state.standingsEarned!.dsi = 20
    const def = ctx.ships.get('sh-shrike')!
    const local = { ...ctx, ships: new Map(ctx.ships).set(def.id, { ...def, commandCost: 12 }) }
    expect(commandBudgetOf(state, local, ids.slice(0, 2)).cost).toBe(24)
    state.fleet[ids[1]!]!.defId = 'sh-falconet'
    local.ships.set('sh-falconet', { ...ctx.ships.get('sh-falconet')!, commandCost: 13 })
    expect(commandBudgetOf(state, local, ids.slice(0, 2))).toMatchObject({ ok: true, cost: 25 })
    local.ships.set('sh-falconet', { ...ctx.ships.get('sh-falconet')!, commandCost: 14 })
    expect(commandBudgetOf(state, local, ids.slice(0, 2))).toMatchObject({ ok: false, cost: 26 })
    state.fleet[ids[1]!]!.defId = 'sh-shrike'
    state.skills.trained['fleet-command-basic'] = 1
    expect(commandBudgetOf(state, ctx, ids.slice(0, 3)).ok).toBe(true)
    expect(commandBudgetOf(state, ctx, ids.slice(0, 4)).errorId).toBe('core.command.005')
    expect(commandBudgetOf(state, ctx, [ids[0]!, ids[0]!]).errorId).toBe('core.command.002')
    expect(commandBudgetOf(state, ctx, ids).errorId).toBe('core.command.003')
  })

  it('12舰准备和出勤往返不截断，返航锁舰到到港', () => {
    const { state, ids } = world(12)
    expect(commandBudgetOf(state, ctx, ids).ok).toBe(true)
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    expect(state.expedition.battle!.myFleet).toHaveLength(12)
    expect(state.expedition.sortie!.shipIds).toEqual(ids)
    expect(shipOperationBlockReason(state, ctx, ids[11]!, 'configure')).not.toBeNull()
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.expedition.sortie!.shipIds).toEqual(ids)
    expect(back.preparationSquads!.combat).toEqual(ids)
    for (const unit of Object.values(back.expedition.battle!.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    back.expedition.battle!.ended = 'me'
    resolveBattleOutcome(back, ctx)
    expect(shipOperationBlockReason(back, ctx, ids[11]!, 'configure')).not.toBeNull()
    back.gameMs = back.expedition.finishAtGameMs
    advanceExpedition(back, ctx)
    expect(back.expedition.sortie).toBeUndefined()
    expect(shipOperationBlockReason(back, ctx, ids[11]!, 'configure')).toBeNull()
  })

  it('预算失败状态不变，胜利只发一次奖金，沉僚舰不复活', () => {
    const { state, ids } = world(3)
    state.skills.trained = {}
    const before = structuredClone(state)
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(false)
    expect(state).toEqual(before)
    state.skills.trained['fleet-command-basic'] = 1
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    const battle = state.expedition.battle!
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    battle.units['ally-2']!.hp.a /= 2
    battle.ended = 'me'
    resolveBattleOutcome(state, ctx)
    expect(state.fleet[ids[1]!]).toBeUndefined()
    expect(state.fleet[ids[2]!]!.armorPct).toBeLessThan(1)
    expect(state.firstStats?.bountyWins).toBe(1)
    expect(state.expedition.sortie!.shipIds).toEqual(ids)
    expect(state.shipId).toBe(ids[0])
  })

  it('逐档弹药装载/消耗/读档/退还守恒，不把MK2变成基础弹', () => {
    const { state, ids } = world()
    state.resupplyFromWarehouse = false
    state.warehouse.items = {}
    for (const [i, id] of ids.entries()) {
      const ammo = i ? 'ammo-kinetic-2' : 'ammo-kinetic-l'
      state.fleet[id]!.fitted.high = ['mod-turret-kin-2']
      state.fleet[id]!.ammoPref = { kinetic: ammo }
      state.fleet[id]!.cargo = { [ammo]: 10000 }
    }
    const battle = startFleetBattleFor(state, ctx, ids, 'ano-training')!
    expect(battleAmmoIdsFor(battle, 'player')!.kinetic).toBe('ammo-kinetic-l')
    expect(battleAmmoIdsFor(battle, 'ally-1')!.kinetic).toBe('ammo-kinetic-2')
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', 3)).toBe(true)
    expect(consumeBattleAmmo(battle, 'ally-1', 'kinetic', 7)).toBe(true)
    state.expedition = { ...state.expedition, active: true, anomalyId: 'ano-training', phase: 'battle', battle }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    refundBattleAmmo(back, back.expedition.battle!)
    const total = (id: string) => (back.warehouse.items[id] ?? 0) + ids.reduce((sum, uid) => sum + (back.fleet[uid]!.cargo[id] ?? 0), 0)
    expect(total('ammo-kinetic-l')).toBe(9997)
    expect(total('ammo-kinetic-2')).toBe(9993)
    refundBattleAmmo(back, back.expedition.battle!)
    expect(total('ammo-kinetic-l')).toBe(9997)
    expect(total('ammo-kinetic-2')).toBe(9993)
  })

  it('活动出发前拒绝忙舰且状态不变，出发快照往返后仍锁舰，旧在途不召来基地船', () => {
    const { state, ids } = world()
    state.shipReturns[ids[1]!] = { beltId: null, legMs: 10000, phaseAccMs: 0 }
    const before = structuredClone(state)
    expect(applyActivityGate(state, 'mining', ctx)?.ok).toBe(false)
    expect(state).toEqual(before)
    delete state.shipReturns[ids[1]!]
    expect(applyActivityGate(state, 'mining', ctx)).toBeNull()
    state.mining.active = true
    expect(deployedCombatEscorts(state)).toEqual(ids)
    expect(idleAiShipIds(state)).not.toContain(ids[1])
    expect(checkAssignable(state, ids[1]!, 'basic', ctx).ok).toBe(false)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.combatEscort!.shipIds).toEqual(ids)
    expect(shipOperationBlockReason(back, ctx, ids[1]!, 'configure')).not.toBeNull()
    const invite = () => ({ ...back.encounter, active: true, shipId: back.shipId, galaxyId: 'galaxy-kor',
      name: '测试', anomalyId: 'ano-training', threat: 6, invitedAtGameMs: 0, deadlineGameMs: 60000, battle: null })
    back.encounter = invite()
    expect(fightEncounter(back, ctx).ok).toBe(true)
    expect(back.encounter.battle!.myFleet).toHaveLength(2)
    back.encounter = invite()
    delete back.combatEscort
    delete back.battleRangeByCard
    expect(fightEncounter(back, ctx).ok).toBe(true)
    expect(back.encounter.battle!.myFleet?.length ?? 1).toBe(1)
  })

  it('新技能等级/前置与训练许可生效，空/重复/超12快照被清掉', () => {
    const { state, ids } = world()
    state.skills.trained = {}
    const basic = ctx.skills.get('fleet-command-basic')!, coord = ctx.skills.get('fleet-command-coordination')!
    expect(basic.rank).toBe(2)
    expect(coord.rank).toBe(4)
    expect(skillLockMissing(state, coord, ctx.skills)[0]!.needLevel).toBe(3)
    state.skills.trained[basic.id] = 3
    expect(skillLockMissing(state, coord, ctx.skills)).toEqual([])
    state.wallet.isk = 100000000
    expect(enqueueSkill(state, basic.id, 4, ctx.skills).ok).toBe(true)
    expect(cleanCombatSortie({ version: 1, leaderShipId: ids[0], shipIds: [ids[0], ids[0]] })).toBeUndefined()
    expect(cleanCombatSortie({ version: 1, leaderShipId: ids[0], shipIds: [] })).toBeUndefined()
    expect(cleanCombatSortie({ version: 1, leaderShipId: ids[0], shipIds: Array.from({ length: 13 }, (_, i) => String(i)) })).toBeUndefined()
    delete state.fleet[ids[1]!]
    expect(combatRosterOf(state)).toEqual([ids[0]])
  })

  it('撤退逐舰写回真实损伤，已沉主控不带回', () => {
    const { state, ids } = world()
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    const battle = state.expedition.battle!
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    battle.units['ally-1']!.hp.a /= 2
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(state.fleet[ids[0]!]).toBeUndefined()
    expect(state.shipId).toBe(ids[1])
    expect(state.fleet[ids[1]!]!.armorPct).toBeLessThan(1)
    expect(state.expedition.sortie!.shipIds).toEqual(ids)
  })

  it('整队全损不接管AI或洞内舰，保底驾驶舰不继承返航与扣损', () => {
    const { state, ids } = world()
    const busy = addShipToFleet(state, 'sh-thresher')
    state.aiAssignments[busy] = { coreType: 'basic', startedAtGameMs: 0, task: {
      kind: 'standby', phase: 'stand', galaxyId: 'galaxy-kor', finishAtGameMs: 0, legMs: 1,
    } } as never
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    for (const row of state.expedition.battle!.myFleet!) state.expedition.battle!.units[row.tag]!.hp = { s: 0, a: 0, h: 0 }
    state.expedition.battle!.ended = 'foe'
    resolveBattleOutcome(state, ctx)
    expect(ids.every(id => !state.fleet[id])).toBe(true)
    expect(state.shipId).not.toBe(busy)
    expect(state.fleet[state.shipId]!.durability).toBe(1)
    expect(state.expedition.active).toBe(false)
    expect(state.expedition.sortie).toBeUndefined()
    expect(state.battleReport!.shipsLost).toHaveLength(2)
    expect(state.aiAssignments[busy]).toBeDefined()
  })

  it('失利召回整队卸货；返航换驾驶后僚舰锁到真实到港，读档不漏货', () => {
    const first = world()
    expect(startExpedition(first.state, 'ano-training', ctx).ok).toBe(true)
    first.state.expedition.battle = null
    first.state.expedition.phase = 'back'
    first.state.expedition.returnReason = 'defeat'
    for (const id of first.ids) first.state.fleet[id]!.cargo = { 'min-tritanium': 3 }
    const stock = first.state.warehouse.items['min-tritanium'] ?? 0
    expect(recallExpedition(first.state, ctx).ok).toBe(true)
    expect(first.state.expedition.sortie).toBeUndefined()
    expect(first.state.warehouse.items['min-tritanium']).toBe(stock + 6)

    const { state, ids } = world()
    const idle = addShipToFleet(state, 'sh-falconet')
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    state.fleet[ids[1]!]!.cargo = { 'min-tritanium': 7 }
    expect(changeShip(state, idle, ctx).ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(shipOperationBlockReason(back, ctx, ids[1]!, 'configure')).not.toBeNull()
    advanceGame(back, 300000, ctx, { offline: true })
    expect(back.expedition.sortie).toBeUndefined()
    expect(back.fleet[ids[1]!]!.cargo['min-tritanium'] ?? 0).toBe(0)
    expect(shipOperationBlockReason(back, ctx, ids[1]!, 'configure')).toBeNull()
  })

  it('目标奖金、首胜声望与战利品不乘参战舰数', () => {
    const solo = world(1), squad = world(12)
    for (const { state } of [solo, squad]) {
      expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
      state.expedition.battle!.ended = 'me'
      resolveBattleOutcome(state, ctx)
    }
    expect(squad.state.wallet).toEqual(solo.state.wallet)
    expect(squad.state.standingsEarned).toEqual(solo.state.standingsEarned)
    expect(squad.state.completedBounties).toEqual(solo.state.completedBounties)
    expect(squad.state.fleet[squad.ids[0]!]!.cargo).toEqual(solo.state.fleet[solo.ids[0]!]!.cargo)
  })

  it('主舰沉没但胜利时，目标战利品交给幸存舰而非随沉船消失', () => {
    const { state, ids } = world()
    const original = ctx.anomalies.get('ano-training')!
    const card = { ...original, loot: [{ itemId: 'min-tritanium', units: 3 }] }
    const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card) }
    expect(startExpedition(state, card.id, local).ok).toBe(true)
    const battle = state.expedition.battle!
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    battle.ended = 'me'
    resolveBattleOutcome(state, local)
    expect(state.shipId).toBe(ids[1])
    expect(state.fleet[ids[0]!]).toBeUndefined()
    expect(state.fleet[ids[1]!]!.cargo['min-tritanium']).toBe(3)
  })

  it.each([1, 2, 3, 'faction'] as const)('多舰首波与原单舰敌阵保持同一强化：%s', tier => {
    const { state, ids } = world()
    if (tier === 'faction') state.expedition.factionActive = true
    else state.expedition.lairTier = tier
    const single = startBattleFor(structuredClone(state), ctx, ids[0]!, 'ano-redring-raiders')!
    const fleet = startFleetBattleFor(structuredClone(state), ctx, ids, 'ano-redring-raiders')!
    expect(Object.values(fleet.units).filter(unit => unit.side === 'foe'))
      .toEqual(Object.values(single.units).filter(unit => unit.side === 'foe'))
  })

  it('旧4舰配置仍可恢复且不影响普通预算', async () => {
    vi.resetModules()
    vi.doMock('../src/combat/command/config.json', async () => {
      const actual = await vi.importActual<{ default: Record<string, unknown> }>('../src/combat/command/config.json')
      return { default: { ...actual.default, legacySpecialFourShips: true } }
    })
    const rules = await import('../src/combat/command/rules')
    const { state, ids } = world(5)
    state.skills.trained = {}
    state.standingsEarned!.dsi = 0
    expect(rules.combatShipLimit(true)).toBe(4)
    expect(rules.commandBudgetOf(state, ctx, ids.slice(0, 4), true).ok).toBe(true)
    expect(rules.commandBudgetOf(state, ctx, ids, true).ok).toBe(false)
    expect(rules.commandBudgetOf(state, ctx, ids.slice(0, 2)).ok).toBe(false)
    const hole = await import('../src/wormhole')
    expect(hole.wormholeEnter(state, ctx, ids.slice(0, 4), 11).ok).toBe(true)
    expect(hole.wormholeAdmission(ctx, ids).ok).toBe(false)
    state.wormhole.run = null
    const now = Date.now()
    state.weekendEvent = { seq: 1, startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], family: 'H', contributed: {} }
    weekendNoteContribution(state.weekendEvent, 'galaxy-redring', 1)
    weekendNoteContribution(state.weekendEvent, 'galaxy-kor', 1)
    const flagship = await import('../src/weekendLaunch')
    expect(flagship.weekendStartFlagshipBattle(state, ctx, now, ids)).toBeNull()
    expect(flagship.weekendStartFlagshipBattle(state, ctx, now, ids.slice(0, 4))!.myFleet).toHaveLength(4)
    vi.doUnmock('../src/combat/command/config.json')
    vi.resetModules()
  })

  it('旗舰真实入口容纳12舰，预算或数量失败不修改偏好与库存', () => {
    const { state, ids } = world(13)
    const now = Date.now()
    state.weekendEvent = { seq: 1, startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], family: 'H', contributed: {} }
    weekendNoteContribution(state.weekendEvent, 'galaxy-redring', 1)
    weekendNoteContribution(state.weekendEvent, 'galaxy-kor', 1)
    const before = structuredClone(state)
    expect(weekendStartFlagshipBattle(state, ctx, now, ids)).toBeNull()
    expect(state).toEqual(before)
    state.skills.trained = {}
    const low = structuredClone(state)
    expect(weekendStartFlagshipBattle(state, ctx, now, ids.slice(0, 3))).toBeNull()
    expect(state).toEqual(low)
    for (const id of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration']) state.skills.trained[id] = 5
    expect(weekendStartFlagshipBattle(state, ctx, now, ids.slice(0, 12))!.myFleet).toHaveLength(12)
  })
})

describe('12对12几何与敌方候补', () => {
  it('12舰矩阵无左右越界，敌我锚点均完整', () => {
    for (const W of [1200, 1280, 1600, 1920]) {
      const sizes = Array(12).fill(170)
      const lay = denseBattleLayout({ W, H: 430, meW: 170, foeW: 170 }, sizes, sizes, 5000, 10000, 200)
      expect(lay.my).toHaveLength(12)
      expect(lay.foe).toHaveLength(12)
      for (const [points, actual] of [[lay.my, lay.mySizes], [lay.foe, lay.sizes]] as const) points.forEach((point, index) => {
        expect(point.x - actual[index]! / 2).toBeGreaterThanOrEqual(0)
        expect(point.x + actual[index]! / 2).toBeLessThanOrEqual(W)
      })
    }
  })

  it('13敌初始只入场12，第13艘候补，不提前判胜，读档后仍等待', () => {
    const { state, ids } = world()
    const model = ctx.foeShips!.get('foe-alien-hiveback')!
    const card: AnomalyDef = { ...ctx.anomalies.get('ano-training')!, id: 'thirteen-test', waves: undefined,
      ships: [{ count: 13, ship: { ...model, hp: 1e6, shotDmg: 0, mounts: [], drones: undefined } }] }
    const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card) }
    const battle = startFleetBattleFor(state, local, ids, card.id)!
    expect(Object.values(battle.units).filter(unit => unit.side === 'foe')).toHaveLength(12)
    expect(enemyFleetRoom(battle)).toBe(0)
    state.expedition = { ...state.expedition, active: true, anomalyId: card.id, phase: 'battle', battle }
    const saved = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(enemyFleetRoom(saved)).toBe(0)
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    state.gameMs = 100
    advanceBattleFor(state, local, battle, ids[0]!, card.id)
    expect(battle.ended).toBeNull()
    expect(Object.values(battle.units).filter(unit => unit.side === 'foe')).toHaveLength(13)
    expect(createPlayerSpec(state, ctx, ids[0]!)).toBeTruthy()
    const tags = Object.values(battle.units).filter(unit => unit.side === 'foe').map(unit => unit.tag)
    const dead = new Set(tags.filter(tag => battle.units[tag]!.hp.h <= 0))
    const visible = visibleEnemyTags(battle, tags, dead, new Set())
    expect(visible).toHaveLength(12)
    expect(visible).toContain(tags[12])
  })
})
