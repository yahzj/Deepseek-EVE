import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholePreparationPlan, wormholeEnterPrepared } from '../src/wormholePreparation'
import { wormholeDescend, wormholeEnter, wormholeExtract, wormholeGridScan, wormholeLeave, wormholeResume } from '../src/wormhole'
import { advanceWormhole, wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import { wormholeGroundBoard, wormholeGroundKey } from '../src/wormholeGround'
import {
  wormholeHoldStow, wormholeLeaveHoldPiece, wormholeLeaveSupply, wormholeStowOrTemp,
  wormholeTempAddShape, wormholeTempStowPiece, wormholeHoldUsage, wormholeCollectOreAt, wormholeHoldSyncCargo,
} from '../src/wormholeSalvage'
import { wormholeExtractionPlan, wormholeConfirmExtraction } from '../src/wormholeExtraction'
import { wormholeEventPreview, wormholeResolveEvent } from '../src/wormholeExpedition'
import { wormholeMakeGrid, gridTally } from '../src/wormholeGrid'
import { wormholePatrolAfterAction, wormholeRaiseAlert } from '../src/wormholePatrol'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const BASE = 'ammo-kinetic-l'
const emptySelection = { leavePieces: [], leaveSupplies: {}, takeGround: [] }

function setup(targets: Record<string, number> = {}, count = 2, old = false, rules?: 2) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const fleet = Array.from({ length: count }, () => addShipToFleet(state, 'sh-thresher'))
  state.shipId = fleet[0]!
  for (const id of fleet) state.fleet[id]!.fitted = { high: ['mod-miner-1'], mid: [], low: [] }
  for (const [id, n] of Object.entries(targets)) state.warehouse.items[id] = n + 100
  if (old) expect(wormholeEnter(state, ctx, fleet, 7).ok).toBe(true)
  else {
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets, unload: [] })
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan, undefined, rules ? { expeditionRules: rules } : undefined).ok).toBe(true)
  }
  const run = state.wormhole.run!
  for (const cell of run.grid!.cells) { cell.place = 'empty'; delete cell.foe }
  return { state, run, fleet }
}

function currentCell(run: ReturnType<typeof setup>['run']) {
  return run.grid!.cells.find((cell) => cell.key === wormholeGroundKey(run))!
}

function anotherCell(run: ReturnType<typeof setup>['run']) {
  return run.grid!.cells.find((cell) => cell.key !== wormholeGroundKey(run) && cell.key !== `${run.grid!.exit.q},${run.grid!.exit.r}`)!
}

describe('虫洞新趟 · 地点待装载', () => {
  it('第二批事件规则锁定后，事件等待选择、费用守恒且可读档继续', () => {
    const { state, run } = setup({ 'repairkit-mil': 100 })
    run.expeditionRules = 2
    const cell = currentCell(run)
    cell.eventKey = 'maintenance'
    run.pendingEvent = { key: 'maintenance', cellKey: cell.key }
    const before = structuredClone(state)
    const preview = wormholeEventPreview(state, ctx, 'repair')
    expect(preview.ok).toBe(true)
    expect(preview.turns).toBe(1)
    expect(preview.supply).toEqual({ 'repairkit-mil': 20 })
    expect(state).toEqual(before)
    const resolved = wormholeResolveEvent(state, ctx, 'repair')
    expect(resolved.resolved).toBe(true)
    expect(state.wormhole.run!.pendingEvent).toBeUndefined()
    expect(state.wormhole.run!.turnsLeft).toBe(before.wormhole.run!.turnsLeft - 1)
    expect(state.wormhole.run!.supplies!.items['repairkit-mil']).toBe(80)
    expect(state.fleet[run.fleet[0]!]!.armorPct).toBeGreaterThanOrEqual(before.fleet[run.fleet[0]!]!.armorPct ?? 1)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.wormhole.run!.expeditionRules).toBe(2)
    expect(loaded.wormhole.run!.pendingEvent).toBeUndefined()
  })

  it('事件选择缺料/缺回合不扣账，旧趟不产生第二批事件行为', () => {
    const { state, run } = setup({ 'repairkit-mil': 10 })
    run.expeditionRules = 2
    const cell = currentCell(run); cell.eventKey = 'maintenance'; run.pendingEvent = { key: 'maintenance', cellKey: cell.key }
    const before = structuredClone(state)
    expect(wormholeResolveEvent(state, ctx, 'repair').error).toBe('insufficient-supplies')
    expect(state).toEqual(before)
    run.turnsLeft = 0
    expect(wormholeResolveEvent(state, ctx, 'search').error).toBe('insufficient-turns')
    const old = setup().state
    expect(wormholeEventPreview(old, ctx, 'search').ok).toBe(false)
  })

  it('第二批网格确定性生成事件并限制普通信号/遗迹盘面，不改变旧盘', () => {
    const old = wormholeMakeGrid(11, 10)
    const fresh = wormholeMakeGrid(11, 10, 0, 1, 2)
    const freshAgain = wormholeMakeGrid(11, 10, 0, 1, 2)
    expect(fresh).toEqual(freshAgain)
    expect(fresh.cells.filter(c => c.eventKey).length).toBe(2)
    expect(fresh.cells.filter(c => c.place === 'ship' && !c.elite).length).toBeLessThanOrEqual(4)
    expect(fresh.cells.filter(c => c.place === 'ruins').length).toBeGreaterThanOrEqual(5)
    expect(old.cells.some(c => c.eventKey !== undefined)).toBe(false)
    expect(gridTally(fresh).total).toBe(61)
  })

  it('整备入场锁定第二批规则并生成事件盘，旧入场不生成事件规则', () => {
    const fresh = setup({}, 2, false, 2).run
    expect(fresh.expeditionRules).toBe(2)
    expect(fresh.grid!.cells.some(c => c.eventKey !== undefined)).toBe(true)
    const oldState = createInitialState({ nowWallMs: 0, seed: 7 })
    const oldFleet = [addShipToFleet(oldState, 'sh-thresher')]
    expect(wormholeEnter(oldState, ctx, oldFleet, 7).ok).toBe(true)
    expect(oldState.wormhole.run!.expeditionRules).toBeUndefined()
    expect(oldState.wormhole.run!.grid!.cells.some(c => c.eventKey !== undefined)).toBe(false)
  })

  it('第二批警戒达到门槛后每层最多生成两支巡逻且不刷当前位置/出口', () => {
    const { state, run } = setup()
    run.expeditionRules = 2
    run.grid!.scanned = run.grid!.cells.map(c => c.key)
    wormholeRaiseAlert(state, 4)
    expect(wormholePatrolAfterAction(state).spawned).toBe(false)
    expect(wormholePatrolAfterAction(state).spawned).toBe(true)
    expect(wormholePatrolAfterAction(state).spawned).toBe(false)
    expect(run.patrolsSpawned).toBe(2)
    const foes = run.grid!.cells.filter(c => c.foe && c.foe.cleared !== true)
    expect(foes.every(c => c.key !== `${run.grid!.pos.q},${run.grid!.pos.r}` && c.key !== `${run.grid!.exit.q},${run.grid!.exit.r}`)).toBe(true)
  })
  it('形状货跨格板采用指定落点与抓取偏移，失败不改实物', () => {
    const { state, run } = setup({}, 4)
    expect(wormholeHoldStow(state, ctx, 'box-bp-shallow').ok).toBe(true)
    const id = run.hold!.placements[0]!.id
    expect(wormholeLeaveHoldPiece(state, ctx, id, 3, 4, { dx: 1, dy: 1 }).ok).toBe(true)
    expect(wormholeGroundBoard(run)!.placements[0]).toMatchObject({ id, x: 2, y: 3 })
    expect(wormholeTempStowPiece(state, ctx, id, 7, 1, { dx: 1, dy: 1 }).ok).toBe(true)
    expect(run.hold!.placements[0]).toMatchObject({ id, x: 6, y: 0 })
    expect(wormholeGroundBoard(run)!.placements).toEqual([])
    expect(wormholeHoldStow(state, ctx, 'box-bp-shallow').ok).toBe(true)
    const second = run.hold!.placements.find((p) => p.id !== id)!.id
    expect(wormholeLeaveHoldPiece(state, ctx, id, 1, 1, { dx: 0, dy: 0 }).ok).toBe(true)
    const before = structuredClone(state)
    expect(wormholeLeaveHoldPiece(state, ctx, second, 1, 1, { dx: 0, dy: 0 }).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('散货跨格板采用落点，重复留地不会因随行重编编号撞号或丢数量', () => {
    const { state, run } = setup({}, 4)
    expect(wormholeStowOrTemp(state, ctx, 'ore-voidmother', 1200).ok).toBe(true)
    for (let n = 0; n < 2; n++) {
      const piece = run.hold!.placements.find((p) => p.itemId === 'ore-voidmother')!
      expect(wormholeLeaveHoldPiece(state, ctx, piece.id, n, 3).ok).toBe(true)
      // 真实整理/战后同步会给剩下的随行散货重新编号。
      wormholeHoldSyncCargo(state, ctx)
    }
    const ground = wormholeGroundBoard(run)!
    expect(new Set(ground.placements.map((p) => p.id)).size).toBe(2)
    expect(ground.placements.map((p) => [p.x, p.y])).toEqual([[0, 3], [1, 3]])
    const piece = ground.placements[0]!
    expect(wormholeTempStowPiece(state, ctx, piece.id, 7, 1).ok).toBe(true)
    expect(run.hold!.placements.some((p) => p.x === 7 && p.y === 1)).toBe(true)
    expect(run.bag[0]!.units + ground.placements.reduce((n, p) => n + (p.units ?? 0), 0)).toBe(1200)
    const blocked = structuredClone(state)
    expect(wormholeTempStowPiece(state, ctx, ground.placements[0]!.id, 7, 1).ok).toBe(false)
    expect(state).toEqual(blocked)
  })

  it('扫描与暂停不要求清空待装载，移动前需明确确认留地', () => {
    const { state, run } = setup()
    expect(wormholeTempAddShape(state, ctx, 'box-bp-shallow').ok).toBe(true)
    const origin = { ...run.grid!.pos }
    const piece = wormholeGroundBoard(run)!.placements[0]!
    const beforeTurns = run.turnsLeft
    expect(wormholeGridScan(state).ok).toBe(true)
    expect(run.turnsLeft).toBe(beforeTurns - 1)
    const target = anotherCell(run)
    const stopped = structuredClone(state)
    expect(wormholeTravelTo(state, ctx, target, { confirmUnknown: true }).code).toBe('cargo-pending')
    expect(state).toEqual(stopped)
    expect(wormholeTravelTo(state, ctx, target, { confirmUnknown: true, confirmLeaveCargo: true }).ok).toBe(true)
    expect(wormholeGroundBoard(run)?.placements ?? []).toEqual([])
    expect(run.groundCargo![`${origin.q},${origin.r}`]!.placements[0]!.id).toBe(piece.id)
    expect(wormholeTravelTo(state, ctx, origin, { confirmUnknown: true }).ok).toBe(true)
    wormholeLeave(state)
    expect(wormholeResume(state, ctx).ok).toBe(true)
    expect(wormholeGroundBoard(run)!.placements[0]!.id).toBe(piece.id)
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(true)
    expect(wormholeGroundBoard(run)!.placements).toEqual([])
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(false)
    expect(run.hold!.placements.filter((p) => p.itemId === piece.itemId)).toHaveLength(1)
  })

  it('满仓采集的散货留在地点，不进随行数量账，刷新与返回不重新生成', () => {
    const { state, run } = setup({ 'repairkit-mil': 2500 }, 1)
    const cell = currentCell(run)
    cell.place = 'vein'
    cell.piles = [{ itemId: 'ore-voidmother', units: 600 }]
    const result = wormholeCollectOreAt(state, ctx)
    expect(result.ok).toBe(true)
    expect(result.taken).toHaveLength(1)
    expect(cell.piles).toEqual([])
    expect(run.bag).toEqual([])
    expect(wormholeHoldUsage(state, ctx)).toMatchObject({ used: 5, capacity: 5, overload: false })
    const ground = wormholeGroundBoard(run)!
    expect(ground.placements.map((p) => p.units)).toEqual([500, 100])
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    const twice = loadSaveFile(serializeSaveFile(loaded, 0)).state
    expect(twice.wormhole.run!.groundCargo).toEqual(run.groundCargo)
    expect(wormholeTempStowPiece(state, ctx, ground.placements[0]!.id).ok).toBe(false)
    expect(run.bag).toEqual([])
    const plan = wormholeExtractionPlan(state, ctx, emptySelection)
    expect(plan.left['ore-voidmother']).toBe(600)
    expect(plan.loot).toEqual({})
  })

  it('形状件超过32格仍保留地点实物，不能成为免费随行空间', () => {
    const { state, run } = setup()
    for (let n = 0; n < 20; n++) expect(wormholeTempAddShape(state, ctx, 'box-relic-a').ok).toBe(true)
    expect(wormholeGroundBoard(run)!.placements).toHaveLength(20)
    expect(wormholeHoldUsage(state, ctx).used).toBe(0)
    const plan = wormholeExtractionPlan(state, ctx, emptySelection)
    expect(plan.left['box-relic-a']).toBe(20)
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(true)
    expect(state.warehouse.items['box-relic-a']).toBeUndefined()
  })

  it('补给放到地面不能用于战斗，取回后保持来源且不记战利品', () => {
    const { state, run } = setup({ [BASE]: 20 })
    expect(wormholeLeaveSupply(state, ctx, BASE, 20).ok).toBe(true)
    const piece = wormholeGroundBoard(run)!.placements[0]!
    expect(piece.supply).toBe(true)
    currentCell(run).place = 'ship'
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(run.battle!.ammo.kin).toBe(0)
    run.battle!.ended = 'me'
    state.gameMs += 60_000
    advanceWormhole(state, ctx)
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(true)
    expect(run.supplies!.items[BASE]).toBe(20)
    expect(run.supplies!.leftBehind).toEqual({})
    expect(run.supplies!.found).toEqual({})
    expect(run.bag.some((slot) => slot.itemId === BASE)).toBe(false)
  })

  it('洞内取得的弹药装舱后才变成可用补给，取回只入账一次', () => {
    const { state, run } = setup({ 'repairkit-mil': 5000 })
    expect(wormholeStowOrTemp(state, ctx, BASE, 10)).toMatchObject({ ok: true, where: 'temp' })
    expect(run.supplies!.items[BASE]).toBeUndefined()
    expect(wormholeLeaveSupply(state, ctx, 'repairkit-mil', 500).ok).toBe(true)
    const piece = wormholeGroundBoard(run)!.placements.find((p) => p.itemId === BASE)!
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(true)
    expect(run.supplies!.items[BASE]).toBe(10)
    expect(run.supplies!.found[BASE]).toBe(10)
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(false)
    expect(run.supplies!.items[BASE]).toBe(10)
  })

  it('随行散货与谜质可留地并取回，重复来回不刷回合', () => {
    const { state, run } = setup()
    expect(wormholeStowOrTemp(state, ctx, 'ore-voidmother', 100).ok).toBe(true)
    const cargo = run.hold!.placements.find((p) => p.kind === 'cargo')!
    expect(wormholeLeaveHoldPiece(state, ctx, cargo.id).ok).toBe(true)
    expect(run.bag).toEqual([])
    const onGround = wormholeGroundBoard(run)!.placements[0]!
    expect(wormholeTempStowPiece(state, ctx, onGround.id).ok).toBe(true)
    expect(run.bag).toEqual([{ itemId: 'ore-voidmother', units: 100 }])
    expect(wormholeStowOrTemp(state, ctx, 'mat-chrono').ok).toBe(true)
    const before = run.turnsLeft
    for (let n = 0; n < 3; n++) {
      const matter = run.hold!.placements.find((p) => p.itemId === 'mat-chrono')!
      expect(wormholeLeaveHoldPiece(state, ctx, matter.id).ok).toBe(true)
      const grounded = wormholeGroundBoard(run)!.placements.find((p) => p.itemId === 'mat-chrono')!
      expect(wormholeTempStowPiece(state, ctx, grounded.id).ok).toBe(true)
    }
    expect(run.turnsLeft).toBe(before)
  })

  it('深入需要确认丢下本层所有地点货，未确认不改层或删货', () => {
    const { state, run } = setup()
    expect(wormholeTempAddShape(state, ctx, 'ai-core-gamma').ok).toBe(true)
    run.grid!.pos = { ...run.grid!.exit }
    run.bossCleared = run.depth
    const before = structuredClone(state)
    expect(wormholeDescend(state, 9).code).toBe('cargo-pending')
    expect(state).toEqual(before)
    expect(wormholeDescend(state, 9, 0, { confirmLeaveCargo: true }).ok).toBe(true)
    expect(run.depth).toBe(2)
    expect(run.groundCargo).toBeUndefined()
  })

  it('旧趟临时货依然阻拦扫描，不因新代码变地点货', () => {
    const { state, run } = setup({}, 2, true)
    expect(wormholeTempAddShape(state, ctx, 'ai-core-gamma').ok).toBe(true)
    expect(wormholeGridScan(state).ok).toBe(false)
    expect(run.tempGrid!.placements).toHaveLength(1)
    expect(run.groundCargo).toBeUndefined()
    expect(wormholeExtractionPlan(state, ctx, emptySelection).code).toBe('unavailable')
  })

  it('新趟满仓散货的收货回执是待装载，不伪报已装舱', () => {
    const { state, run } = setup({ 'repairkit-mil': 5000 })
    expect(wormholeStowOrTemp(state, ctx, 'ore-voidmother', 600)).toMatchObject({ ok: true, where: 'temp' })
    expect(run.bag).toEqual([])
    expect(wormholeGroundBoard(run)!.placements.map((p) => p.units)).toEqual([500, 100])
  })

  it('取回补给不让现有大件越界，失败数量与位置都不动', () => {
    const { state, run } = setup({ 'repairkit-mil': 1000 })
    expect(wormholeLeaveSupply(state, ctx, 'repairkit-mil', 1000).ok).toBe(true)
    expect(wormholeHoldStow(state, ctx, 'box-valuables').ok).toBe(true)
    const supply = wormholeGroundBoard(run)!.placements[0]!
    const before = structuredClone(state)
    expect(wormholeTempStowPiece(state, ctx, supply.id).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('待迎战期间不得把地面补给取入或把机群弹药留出', () => {
    const { state, run } = setup({ [BASE]: 20 })
    expect(wormholeLeaveSupply(state, ctx, BASE, 10).ok).toBe(true)
    expect(wormholeHoldStow(state, ctx, 'ai-core-gamma').ok).toBe(true)
    run.pendingNodeBattle = true
    const before = structuredClone(state)
    expect(wormholeTempStowPiece(state, ctx, wormholeGroundBoard(run)!.placements[0]!.id).ok).toBe(false)
    expect(wormholeLeaveSupply(state, ctx, BASE, 10).ok).toBe(false)
    expect(wormholeLeaveHoldPiece(state, ctx, run.hold!.placements[0]!.id).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('新版收货拒绝非法数量或形状件多件请求，不生成或吞掉实物', () => {
    const { state } = setup()
    const before = structuredClone(state)
    for (const n of [-1, 0, NaN, Infinity, 0.5]) expect(wormholeStowOrTemp(state, ctx, 'ore-voidmother', n).ok).toBe(false)
    expect(wormholeStowOrTemp(state, ctx, 'box-bp-shallow', 2).ok).toBe(false)
    expect(wormholeStowOrTemp(state, ctx, 'missing-item', 1).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('新版待迎战即使层末守卫已清也不能深入绕战', () => {
    const { state, run } = setup()
    run.grid!.pos = { ...run.grid!.exit }
    run.bossCleared = run.depth
    run.pendingRuinsBattle = true
    const before = structuredClone(state)
    expect(wormholeDescend(state, 9, 0, { confirmLeaveCargo: true }).ok).toBe(false)
    expect(state).toEqual(before)
  })
})

describe('虫洞新趟 · 一次性撤离取舍', () => {
  it('只有游戏时钟推进不会令撤离预览过期', () => {
    const { state } = setup()
    const plan = wormholeExtractionPlan(state, ctx, emptySelection)
    state.gameMs += 60_000
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(true)
  })
  it('预览及取消不改状态，留地货不会随补给入港', () => {
    const { state, run } = setup({ [BASE]: 10 })
    expect(wormholeTempAddShape(state, ctx, 'box-bp-shallow').ok).toBe(true)
    const before = structuredClone(state)
    const plan = wormholeExtractionPlan(state, ctx, emptySelection)
    expect(state).toEqual(before)
    expect(plan).toMatchObject({ ok: true, supplies: { [BASE]: 10 }, left: { 'box-bp-shallow': 1 }, loot: {} })
    expect(wormholeExtract(run).code).toBe('cargo-pending')
    expect(state).toEqual(before)
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(true)
    expect(state.warehouse.items[BASE]).toBe(110)
    expect(state.warehouse.items['box-bp-shallow']).toBeUndefined()
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(false)
    expect(state.warehouse.items[BASE]).toBe(110)
  })

  it('超载明确选留补给后可撤离，预览时不先扣物资', () => {
    const { state, run, fleet } = setup({ 'repairkit-mil': 3000 })
    run.fleet = [fleet[0]!]
    const before = structuredClone(state)
    expect(wormholeExtractionPlan(state, ctx, emptySelection)).toMatchObject({ ok: false, code: 'capacity', used: 6, capacity: 5 })
    const plan = wormholeExtractionPlan(state, ctx, { ...emptySelection, leaveSupplies: { 'repairkit-mil': 500 } })
    expect(plan).toMatchObject({ ok: true, used: 5, left: { 'repairkit-mil': 500 }, supplies: { 'repairkit-mil': 2500 } })
    expect(state).toEqual(before)
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(true)
    expect(state.warehouse.items['repairkit-mil']).toBe(2600)
  })

  it('明确选装地点货后才能带回，无自动免费装舱', () => {
    const { state, run } = setup()
    expect(wormholeTempAddShape(state, ctx, 'box-bp-shallow').ok).toBe(true)
    const id = wormholeGroundBoard(run)!.placements[0]!.id
    const plan = wormholeExtractionPlan(state, ctx, { ...emptySelection, takeGround: [id] })
    expect(plan).toMatchObject({ ok: true, left: {}, loot: { 'box-bp-shallow': 1 } })
    expect(run.hold?.placements ?? []).toEqual([])
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(true)
    expect(state.warehouse.items['box-bp-shallow']).toBe(1)
  })

  it('货仓/请求改变使预览过期，失败保留所有货', () => {
    const { state, run } = setup()
    const plan = wormholeExtractionPlan(state, ctx, emptySelection)
    expect(wormholeHoldStow(state, ctx, 'ai-core-gamma').ok).toBe(true)
    const before = structuredClone(state)
    expect(wormholeConfirmExtraction(state, ctx, plan).code).toBe('stale')
    expect(state).toEqual(before)
    const another = wormholeExtractionPlan(state, ctx, emptySelection)
    another.request.leavePieces = [run.hold!.placements[0]!.id]
    expect(wormholeConfirmExtraction(state, ctx, another).code).toBe('stale')
    expect(state).toEqual(before)
  })

  it('非法部分取舍整体拒绝，不先放弃前面合法选择', () => {
    const { state, run } = setup({ [BASE]: 10 })
    expect(wormholeHoldStow(state, ctx, 'ai-core-gamma').ok).toBe(true)
    const before = structuredClone(state)
    const plan = wormholeExtractionPlan(state, ctx, { ...emptySelection, leavePieces: [run.hold!.placements[0]!.id], leaveSupplies: { [BASE]: 20 } })
    expect(plan).toMatchObject({ ok: false, code: 'invalid-selection' })
    expect(wormholeConfirmExtraction(state, ctx, plan).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('移走扩仓谜质会重新校验容量，不允许旧容量蒙混带货', () => {
    const { state, run } = setup({}, 2)
    expect(wormholeHoldStow(state, ctx, 'mat-expander').ok).toBe(true)
    for (let n = 0; n < 11; n++) expect(wormholeHoldStow(state, ctx, 'ai-core-gamma').ok).toBe(true)
    const device = run.hold!.placements.find((p) => p.itemId === 'mat-expander')!
    const plan = wormholeExtractionPlan(state, ctx, { ...emptySelection, leavePieces: [device.id] })
    expect(plan.ok).toBe(false)
    expect(plan.code).toBe('capacity')
    expect(run.hold!.placements).toContainEqual(device)
  })

  it('回合耗尽可以撤离，必须迎战和无存活编队不能走结算事务', () => {
    const { state, run } = setup()
    run.turnsLeft = 0
    expect(wormholeExtractionPlan(state, ctx, emptySelection).ok).toBe(true)
    run.pendingNodeBattle = true
    expect(wormholeExtractionPlan(state, ctx, emptySelection).code).toBe('battle-required')
    expect(wormholeExtract(run).ok).toBe(false)
    delete run.pendingNodeBattle
    run.fleet = []
    expect(wormholeExtractionPlan(state, ctx, emptySelection).code).toBe('unavailable')
  })

  it('直接撤离相位也不能绕过新趟超载检查', () => {
    const { state, run, fleet } = setup({ 'repairkit-mil': 3000 })
    run.fleet = [fleet[0]!]
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(run.phase).toBe('inside')
    expect(run.supplies!.items['repairkit-mil']).toBe(3000)
    expect(state.warehouse.items['repairkit-mil']).toBe(100)
  })

  it('超载时必须迎战仍可建档，不被货仓闸锁死', () => {
    const { state, run, fleet } = setup({ 'repairkit-mil': 3000 })
    run.fleet = [fleet[0]!]
    currentCell(run).place = 'ship'
    expect(wormholeActivateAt(state, ctx).ok).toBe(true)
    expect(run.battle).toBeTruthy()
    expect(wormholeExtractionPlan(state, ctx, emptySelection).code).toBe('battle-required')
  })

  it('脚下已有围剿者时底层撤离入口也拒绝，未开战不等于安全', () => {
    const { state, run } = setup()
    currentCell(run).foe = { card: 'wh-pirate-scout', seq: 0 }
    const before = structuredClone(state)
    expect(wormholeExtract(run, { confirmLeaveCargo: true }).ok).toBe(false)
    expect(wormholeExtractionPlan(state, ctx, emptySelection).code).toBe('battle-required')
    expect(state).toEqual(before)
  })
})
