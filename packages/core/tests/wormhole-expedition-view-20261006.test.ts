import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnterPrepared, wormholePreparationPlan } from '../src/wormholePreparation'
import { gridCellAt } from '../src/wormholeGrid'
import { wormholeGridTravel } from '../src/wormhole'
import { wormholeEventView, wormholeAlertView, wormholeEncounterView, wormholeChangeExpeditionGoal } from '../src/wormholeExpeditionView'
import { wormholeEventPreview } from '../src/wormholeExpedition'
import { wormholeRaiseAlert } from '../src/wormholePatrol'
import { wormholeStartBattle, battleFoeAnomaly } from '../src/wormholeBattle'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
function setup() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const fleet = [addShipToFleet(state, 'sh-nautilus')]
  state.shipId = fleet[0]!
  state.warehouse.items['repairkit-mil'] = 10
  const plan = wormholePreparationPlan(state, ctx, fleet, { targets: { 'repairkit-mil': 10 }, unload: [] })
  expect(wormholeEnterPrepared(state, ctx, fleet, 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
  return state
}

describe('虫洞新界面同源信息投影', () => {
  it('新信标首次读取标出口及事件线索，不揭露求援身份，不可重复计线索', () => {
    const state = setup(), run = state.wormhole.run!
    const grid = run.grid!, beacon = grid.cells.find(c => c.place === 'beacon')!
    for (const cell of grid.cells) if (cell.place === 'ship') cell.combatCleared = true
    expect(wormholeGridTravel(state, beacon, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true }).ok).toBe(true)
    expect(grid.exitKnown).toBe(true)
    const event = grid.cells.find(c => c.eventKey)!
    expect(grid.scanned.includes(event.key)).toBe(true)
    expect(event.event?.verified).not.toBe(true)
    expect(run.expeditionProgress!.clues).toBe(1)
    const target = grid.cells.find(c => c.key !== beacon.key && c.place === 'empty' && !c.eventKey)!
    expect(wormholeGridTravel(state, target, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true }).ok).toBe(true)
    expect(wormholeGridTravel(state, beacon, { confirmUnknown: true, confirmIntercept: true, confirmLeaveCargo: true }).ok).toBe(true)
    expect(run.expeditionProgress!.clues).toBe(1)
  })
  it('事件预览不改物资/地图，费用与事务相同，缺料/0回合拒因与免费离开可见', () => {
    const state = setup(), run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.eventKey = 'maintenance'; cell.event = { supply: { 'repairkit-mil': 20 } }
    run.pendingEvent = { key: 'maintenance', cellKey: cell.key }
    const before = structuredClone(state)
    const view = wormholeEventView(state, ctx)!
    expect(state).toEqual(before)
    expect(view.choices.find(c => c.action === 'repair')!.plan).toEqual(wormholeEventPreview(state, ctx, 'repair'))
    expect(view.choices.find(c => c.action === 'repair')!.rejection?.id).toBe('ui.whExpedition.065')
    run.turnsLeft = 0
    expect(wormholeEventView(state, ctx)!.choices.find(c => c.action === 'search')!.rejection?.id).toBe('ui.whExpedition.064')
    expect(wormholeEventView(state, ctx)!.choices.find(c => c.action === 'bypass')!.plan.ok).toBe(true)
  })

  it('核验前不泄露求援身份，核验后可见真实/伪装且战斗预警确定', () => {
    const state = setup(), run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.eventKey = 'distress'; cell.event = { identity: 'ambush' }; run.pendingEvent = { key: 'distress', cellKey: cell.key }
    expect(wormholeEventView(state, ctx)!.identityId).toBeUndefined()
    expect(wormholeEventView(state, ctx)!.choices.find(c => c.action === 'respond')!.notices.some(n => n.id === 'ui.whExpedition.068')).toBe(true)
    cell.event.verified = true
    const verified = wormholeEventView(state, ctx)!
    expect(verified.identityId).toBe('ui.whExpedition.088')
    expect(verified.choices.find(c => c.action === 'respond')!.plan.battle).toBe('certain')
  })

  it('未知精英无情报，扫描后情报同真实开战卡，已解除守卫与精英不混用', () => {
    const state = setup(), run = state.wormhole.run!
    run.family = 'G'; run.depth = 7; run.guardSupportDisabled = true
    const elite = run.grid!.cells.find(c => !run.grid!.scanned.includes(c.key))!
    elite.place = 'ship'; elite.elite = true; delete elite.nebula
    expect(wormholeEncounterView(state, ctx, elite.key)).toBeNull()
    run.grid!.scanned.push(elite.key)
    const view = wormholeEncounterView(state, ctx, elite.key)!
    expect(view.role).toBe('elite')
    expect(view.supportDisabled).toBe(false)
    expect(view.ships.length).toBe(2)
    run.grid!.pos = elite
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(view.threat).toBe(battleFoeAnomaly(state, ctx)!.threat)
  })

  it('警戒预兆与动作窗口随档，目标切换只改目标不退款/换地图/补回合', () => {
    const state = setup(), run = state.wormhole.run!
    wormholeRaiseAlert(state, 4)
    expect(wormholeAlertView(state)!.patrols.map(p => p.actions)).toEqual([2, 2])
    const before = structuredClone(state)
    expect(wormholeChangeExpeditionGoal(state, 'survey')).toBe(true)
    const expected = structuredClone(before); expected.wormhole.run!.expeditionGoal = 'survey'
    expect(state).toEqual(expected)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.wormhole.run!.expeditionGoal).toBe('survey')
    expect(wormholeAlertView(loaded)).toEqual(wormholeAlertView(state))
    run.attending = false
    expect(wormholeChangeExpeditionGoal(state, 'deep')).toBe(false)
  })
})
