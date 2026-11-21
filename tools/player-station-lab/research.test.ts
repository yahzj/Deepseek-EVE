import { describe, expect, it, vi } from 'vitest'
import { STATION_FIRST_RESEARCH } from '../../packages/core/src/playerStation/index'
import { LabModel, importSnapshot } from './model'

function ready() {
  const model = new LabModel()
  model.command({ kind: 'approve' })
  model.deliver(Object.fromEntries(model.view().bill.map(row => [row.itemId, row.remaining]))); model.advance(120)
  for (const [facility, cellIndex, minutes] of [['power', 0, 45], ['life-support', 1, 60], ['service', 2, 30]] as const) {
    expect(model.command({ kind: 'build', facility, cellIndex }).ok).toBe(true); model.advance(minutes)
  }
  model.sourceKnown = true
  model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 3 }); model.advance(120)
  model.trainingCommand({ kind: 'enqueue', course: 'engineer' }); model.trainingCommand({ kind: 'enqueue', course: 'researcher' }); model.advance(60)
  model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); model.advance(60)
  model.command({ kind: 'build', facility: 'research', cellIndex: 4 }); model.advance(90)
  return model
}
const assign = (model: LabModel) => model.researchCommand({ kind: 'assign', cellIndex: 4, personIndex: 1 })

describe('玩家站预览宿主：科研与六模块边界', () => {
  it('研究占1名合格人口及4点总功率，完成只登记技术不改材料/设施/人口', () => {
    const model = ready(), before = model.inventoryView(), cells = structuredClone(model.station.cells)
    expect(model.view().power.runningDemand).toBe(10)
    expect(assign(model)).toEqual({ ok: true }); expect(model.view().power.runningDemand).toBe(13)
    model.advance(60)
    expect(model.research.completed).toBe(true); expect(model.research.assignment).toBeUndefined()
    expect(model.inventoryView()).toEqual(before); expect(model.station.cells).toEqual(cells)
    expect(model.populationView().residents).toBe(3); expect(model.view().power.runningDemand).toBe(10)
  })
  it('暂停仍占人，精炼与采矿不能抢研究员，撤出后不自动重启', () => {
    const model = ready(); assign(model); model.advance(15); model.researchCommand({ kind: 'pause' })
    expect(model.trainingHost.available(1)).toBe(false)
    expect(model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 1, itemId: 'ore-veldspar' })).toMatchObject({ ok: false, reason: 'person' })
    expect(model.miningCommand({ kind: 'assign', personIndex: 1, shipId: 'lab-miner', beltId: 'belt-gas-phosphor' })).toMatchObject({ ok: false, reason: 'person' })
    model.advance(60); expect(model.research.progressMs).toBe(15 * 60_000)
    model.researchCommand({ kind: 'release' }); expect(model.trainingHost.available(1)).toBe(true)
    model.advance(60); expect(model.research.progressMs).toBe(15 * 60_000)
    assign(model); model.advance(45); expect(model.research.completed).toBe(true)
  })
  it('缺电/生命维持/研究室停用保留进度，恢复不倒算', () => {
    const model = ready(); assign(model); model.advance(15)
    for (const cellIndex of [0, 1, 2, 4]) {
      model.command({ kind: 'toggle', cellIndex }); model.advance(60)
      expect(model.research.progressMs).toBe(15 * 60_000)
      model.command({ kind: 'toggle', cellIndex })
    }
    model.advance(45); expect(model.research.completed).toBe(true)
  })
  it('研究员正在精炼或采矿时不能反向双派', () => {
    const model = ready()
    model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 1, itemId: 'ore-veldspar' })
    expect(assign(model)).toMatchObject({ ok: false, reason: 'person' })
    model.refiningCommand({ kind: 'stop', cellIndex: 3 })
    model.miningCommand({ kind: 'assign', personIndex: 1, shipId: 'lab-miner', beltId: 'belt-gas-phosphor' })
    expect(assign(model)).toMatchObject({ ok: false, reason: 'person' })
  })
  it('科研/采矿/精炼并行时六模块大步小步一致', () => {
    const large = ready(), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) {
      assign(model); model.setInventory('ore-veldspar', 10000)
      model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 0, itemId: 'ore-veldspar' })
      model.miningCommand({ kind: 'assign', personIndex: 2, shipId: 'lab-miner', beltId: 'belt-gas-phosphor' })
    }
    large.advance(61); for (let i = 0; i < 61; i++) small.advance(1)
    expect(small.snapshot()).toBe(large.snapshot()); expect(large.research.completed).toBe(true)
  })
  it('研究室刚完工或研究员刚结课时不补此前工时，未派工不自动开始', () => {
    const model = ready()
    model.command({ kind: 'build', facility: 'research', cellIndex: 5 })
    expect(model.researchCommand({ kind: 'assign', personIndex: 1, cellIndex: 5 })).toMatchObject({ ok: false, reason: 'facility' })
    model.advance(90); expect(model.research.progressMs).toBe(0)
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' }); model.advance(30)
    expect(model.training.qualifications[2]).toBe('researcher'); expect(model.research.progressMs).toBe(0)
    model.researchCommand({ kind: 'assign', cellIndex: 5, personIndex: 2 }); model.advance(1)
    expect(model.research.progressMs).toBe(60_000)
  })
  it('进度与完成态整体往返，旧v6只补空科研账，拒绝缺字段与多岗快照', () => {
    const model = ready(); assign(model); model.advance(15)
    expect(importSnapshot(model.snapshot()).snapshot()).toBe(model.snapshot())
    for (const mutate of [(file: any) => { delete file.research }, (file: any) => { file.research.assignment.personIndex = 0 },
      (file: any) => { file.research.assignment.cellIndex = 3 }, (file: any) => { file.research.completed = true },
      (file: any) => { file.refining.runs.push({ cellIndex: 3, personIndex: 1, itemId: 'ore-veldspar', batchUnits: 100, cycleMs: 10000, progressMs: 0, batchesDone: 0, paused: false }) }]) {
      const file = JSON.parse(model.snapshot()); mutate(file); expect(() => importSnapshot(JSON.stringify(file))).toThrow()
    }
    const old = JSON.parse(model.snapshot()); old.version = 6; delete old.research
    delete old.development; delete old.academy; delete old.manufacturing
    const restored = importSnapshot(JSON.stringify(old))
    expect(restored.research.progressMs).toBe(0); expect(restored.research.completed).toBe(false)
    expect(restored.inventoryView()).toEqual(model.inventoryView()); expect(restored.population).toEqual(model.population)
    model.advance(45); expect(importSnapshot(model.snapshot()).research.completed).toBe(true)
  })
  it('其他模块交接失败时连同已完成科研与释放岗位一起回滚', () => {
    const model = ready(); assign(model); model.setInventory('ore-veldspar', 100)
    model.advance(60 - 10 / 60)
    model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 2, itemId: 'ore-veldspar' })
    const before = model.snapshot(), settle = vi.spyOn(model.refiningHost, 'settle').mockImplementation(() => { throw new Error('research rollback') })
    expect(() => model.advance(60)).toThrow('research rollback'); settle.mockRestore()
    expect(model.snapshot()).toBe(before)
  })
  it('研究结束释放3点负荷只供后续施工时间，不倒补此前被阻塞工程', () => {
    const model = ready()
    model.command({ kind: 'build', facility: 'service', cellIndex: 5 }); model.advance(30)
    model.command({ kind: 'build', facility: 'refinery', cellIndex: 6 }); model.advance(60)
    model.command({ kind: 'build', facility: 'power', cellIndex: 7 })
    model.setInventory('ore-veldspar', 100000)
    model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 2, itemId: 'ore-veldspar' })
    assign(model); model.advance(STATION_FIRST_RESEARCH.durationMs / 60_000)
    expect(model.research.completed).toBe(true)
    expect(model.station.projects[0].progressMs).toBe(0)
    model.advance(1)
    expect(model.station.projects[0].progressMs).toBe(60_000)
  })
})
