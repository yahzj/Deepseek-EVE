import { describe, expect, it, vi } from 'vitest'
import { DEVELOPMENT_RULES, researchCompleted } from '../../packages/core/src/playerStation/index'
import { developmentFixture } from './development-fixture'
import { LabModel, importSnapshot } from './model'
import { manufacturingRecipe } from './manufacturing-baseline'

function expanded() {
  const model = developmentFixture()
  expect(model.developmentCommand({ kind: 'expand' }).ok).toBe(true)
  model.advance(240)
  return model
}
describe('空间站独立经营预设完整流程', () => {
  it('六项研究按计划完成且只解锁资格，原人口/建筑不增加', () => {
    const model = developmentFixture()
    expect(model.researchView().catalog.every(project => project.completed)).toBe(true)
    expect(model.station.cells).toHaveLength(5); expect(model.populationView().residents).toBe(6)
    expect(model.view().cellCount).toBe(9); expect(model.development.projects).toHaveLength(0)
    expect(researchCompleted(model.research, 'station-manufacturing')).toBe(true)
  })
  it('无研究不能解锁建筑或升级，失败不扣料', () => {
    const model = new LabModel(), before = model.inventoryView()
    expect(model.host.unlocked!('manufacturing')).toBe(false)
    expect(model.developmentCommand({ kind: 'expand' }).ok).toBe(false)
    expect(model.inventoryView()).toEqual(before)
  })
  it('扩站需两名不同工程师与6点电，暂停保占用，完工只增7格并保持旧格身份', () => {
    const model = developmentFixture(), cells = structuredClone(model.station.cells)
    const inventory = model.inventoryView()
    expect(model.developmentCommand({ kind: 'expand' })).toEqual({ ok: true })
    expect(model.development.projects[0].engineerIndices).toEqual([0, 2])
    expect(model.view().power.constructionDemand).toBe(6)
    model.advance(60); model.developmentCommand({ kind: 'pause', projectIndex: 0 }); model.advance(240)
    expect(model.development.projects[0].progressMs).toBe(60 * 60_000)
    expect(model.command({ kind: 'build', facility: 'warning', cellIndex: 5 })).toMatchObject({ ok: false, reason: 'engineer' })
    model.developmentCommand({ kind: 'resume', projectIndex: 0 }); model.advance(180)
    expect(model.view().cellCount).toBe(16); expect(model.station.cells).toEqual(cells)
    expect(model.populationView().residents).toBe(6)
    expect(model.host.available('part-frame')).toBe(inventory['part-frame'] - DEVELOPMENT_RULES.expand.bill['part-frame'])
    expect(importSnapshot(model.snapshot()).snapshot()).toBe(model.snapshot())
  })
  it('扩站允许满9格开工，原三行三列不重编号', () => {
    const model = developmentFixture()
    for (let cellIndex = 5; cellIndex < 9; cellIndex++) {
      expect(model.command({ kind: 'build', facility: 'power', cellIndex }).ok).toBe(true); model.advance(45)
    }
    const cells = structuredClone(model.station.cells)
    expect(model.developmentCommand({ kind: 'expand' }).ok).toBe(true); model.advance(240)
    expect(model.station.cells).toEqual(cells)
    expect(model.command({ kind: 'build', facility: 'warning', cellIndex: 9 }).ok).toBe(true)
    model.advance(60); expect(importSnapshot(model.snapshot()).station.cells).toHaveLength(10)
  })
  it('升级时旧24点与6人口保留，完工后才切36点/10人口与8点负荷', () => {
    const model = developmentFixture()
    expect(model.developmentCommand({ kind: 'power-upgrade', cellIndex: 0 }).ok).toBe(true)
    model.advance(59); expect(model.view().power.supply).toBe(24)
    model.advance(1); expect(model.view().power.supply).toBe(36)
    expect(model.developmentCommand({ kind: 'life-upgrade', cellIndex: 1 }).ok).toBe(true)
    model.advance(89); expect(model.view().power.populationCapacity).toBe(6)
    model.advance(1); expect(model.view().power.populationCapacity).toBe(10)
    expect(model.view().power.runningDemand).toBe(12)
    expect(model.developmentCommand({ kind: 'life-upgrade', cellIndex: 1 }).ok).toBe(false)
  })
  it('断电后基础维修不需人或额外电力，修复不遗忘升级和已获技术', () => {
    const model = developmentFixture()
    model.developmentCommand({ kind: 'power-upgrade', cellIndex: 0 }); model.advance(60)
    model.damageFacility(0); expect(model.view().power.supply).toBe(0)
    expect(model.developmentCommand({ kind: 'repair', cellIndex: 0 })).toEqual({ ok: true })
    expect(model.development.projects[0].engineerIndices).toEqual([])
    model.advance(14); expect(model.view().power.supply).toBe(0)
    model.advance(1); expect(model.view().power.supply).toBe(36)
    expect(model.researchView().catalog.every(project => project.completed)).toBe(true)
  })
  it('取消按原投入及剩余工时退款，不能重复领取，技能变化不改锁料', () => {
    const model = developmentFixture(), before = model.inventoryView()
    model.developmentCommand({ kind: 'expand' }); model.advance(120); model.setEngineering(5)
    expect(model.developmentCommand({ kind: 'cancel', projectIndex: 0 }).ok).toBe(true)
    expect(model.host.available('part-frame')).toBe(before['part-frame'] - DEVELOPMENT_RULES.expand.bill['part-frame'] / 2)
    const saved = model.snapshot(); expect(model.developmentCommand({ kind: 'cancel', projectIndex: 0 }).ok).toBe(false)
    expect(model.snapshot()).toBe(saved)
  })
  it('新增三设施科研门禁/工程/快照保持，制造只消费真实配方有限批量', () => {
    const model = expanded()
    for (const [facility, cellIndex, minutes] of [['manufacturing', 9, 90], ['training', 10, 90], ['warning', 11, 60]] as const) {
      expect(model.command({ kind: 'build', facility, cellIndex }).ok).toBe(true); model.advance(minutes)
    }
    const recipe = manufacturingRecipe('bp-part-circuit', 0)!
    for (const [id, n] of Object.entries(recipe.input)) model.setInventory(id, n * 2)
    const inventory = model.inventoryView()
    expect(model.manufacturingCommand({ kind: 'assign', cellIndex: 9, personIndex: 3, blueprintId: 'bp-part-circuit', batches: 2 }).ok).toBe(true)
    expect(model.miningCommand({ kind: 'assign', personIndex: 3, shipId: 'lab-miner', beltId: 'belt-gas-phosphor' }).ok).toBe(false)
    model.advance(recipe.cycleMs * 2 / 60_000)
    expect(model.manufacturing.runs[0].batchesDone).toBe(2); expect(model.manufacturing.runs[0].personIndex).toBeUndefined()
    expect(model.host.available('part-circuit')).toBe(inventory['part-circuit'] + recipe.output['part-circuit'] * 2)
    expect(model.warningView().online).toBe(true)
    expect(importSnapshot(model.snapshot()).snapshot()).toBe(model.snapshot())
  })
  it('培训中心与服务中心并行不同普通居民，暂停不释放、不重复授资格', () => {
    const model = expanded(); model.command({ kind: 'build', facility: 'training', cellIndex: 9 }); model.advance(90)
    expect(model.academyCommand({ kind: 'assign', cellIndex: 9, personIndex: 3, course: 'researcher' }).ok).toBe(true)
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    expect(model.training.active?.personIndex).toBe(4)
    model.academyCommand({ kind: 'pause' }); model.advance(30)
    expect(model.training.qualifications[4]).toBe('engineer'); expect(model.training.qualifications[3]).toBeNull()
    model.academyCommand({ kind: 'resume' }); model.advance(30)
    expect(model.training.qualifications[3]).toBe('researcher'); expect(model.academy.active).toBeUndefined()
    expect(model.populationView().residents).toBe(6)
  })
  it('经营大步小步完全一致，快照拒绝伪造技术、缺账、重复工程师与非法升级', () => {
    const large = developmentFixture(), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) { model.developmentCommand({ kind: 'expand' }); model.command({ kind: 'build', facility: 'power', cellIndex: 5 }) }
    large.advance(240); for (let i = 0; i < 240; i++) small.advance(1)
    expect(small.snapshot()).toBe(large.snapshot())
    const model = developmentFixture(); model.developmentCommand({ kind: 'expand' })
    for (const change of [(file: any) => { delete file.development }, (file: any) => { file.development.projects[0].engineerIndices = [0, 0] },
      (file: any) => { file.development.levels['4'] = 2 }, (file: any) => { file.development.projects[0].spent['part-frame']++ },
      (file: any) => { file.research.archives['station-expansion-1'].completed = false }, (file: any) => { delete file.manufacturing }]) {
      const file = JSON.parse(model.snapshot()); change(file); expect(() => importSnapshot(JSON.stringify(file))).toThrow()
    }
  })
  it('发展与制造交接异常整体回滚，包含课程/科研和工程资源', () => {
    const model = expanded(); model.command({ kind: 'build', facility: 'manufacturing', cellIndex: 9 }); model.advance(90)
    const recipe = manufacturingRecipe('bp-part-circuit', 0)!
    for (const [id, n] of Object.entries(recipe.input)) model.setInventory(id, n)
    model.manufacturingCommand({ kind: 'assign', cellIndex: 9, personIndex: 3, blueprintId: 'bp-part-circuit', batches: 1 })
    model.developmentCommand({ kind: 'power-upgrade', cellIndex: 0 })
    const before = model.snapshot(), spy = vi.spyOn(model.manufacturingHost, 'settle').mockImplementationOnce(() => { throw new Error('rollback') })
    expect(() => model.advance(60)).toThrow('rollback'); spy.mockRestore(); expect(model.snapshot()).toBe(before)
  })
  it('旧v1到v7不可夹带新经营设施，不能通过早返回绕过科研门禁', () => {
    const model = developmentFixture()
    model.command({ kind: 'build', facility: 'warning', cellIndex: 5 }); model.advance(60)
    model.station.cells = model.station.cells.filter(cell => cell.kind !== 'refinery' && cell.kind !== 'research')
    const file = JSON.parse(model.snapshot())
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      expect(() => importSnapshot(JSON.stringify({ format: file.format, version, station: file.station,
        inventory: file.inventory, engineering: file.engineering }))).toThrow('旧快照不应包含新经营设施')
    }
  })
  it('两个课程入口共用有限人口计划上限，不在完课后留下超额队列', () => {
    const model = expanded(); model.command({ kind: 'build', facility: 'training', cellIndex: 9 }); model.advance(90)
    model.academyCommand({ kind: 'assign', cellIndex: 9, personIndex: 3, course: 'researcher' })
    expect(model.trainingCommand({ kind: 'enqueue', course: 'engineer' }).ok).toBe(true)
    expect(model.trainingCommand({ kind: 'enqueue', course: 'engineer' }).ok).toBe(true)
    expect(model.trainingCommand({ kind: 'enqueue', course: 'engineer' })).toMatchObject({ ok: false, reason: 'queue-full' })
    model.advance(60)
    expect(model.training.qualifications.filter(Boolean)).toHaveLength(6)
    expect(model.training.queue).toEqual([])
    expect(importSnapshot(model.snapshot()).snapshot()).toBe(model.snapshot())
  })
  it('警戒阵列只识别真实返航，停电隐藏信号但不改船货或抵达时间', () => {
    const model = expanded(); model.command({ kind: 'build', facility: 'warning', cellIndex: 9 }); model.advance(60)
    expect(model.warningView()).toEqual({ online: true, arrivals: [] })
    model.miningCommand({ kind: 'assign', personIndex: 3, shipId: 'lab-miner', beltId: 'belt-gas-phosphor' })
    model.advance(1); model.miningCommand({ kind: 'stop', shipId: 'lab-miner' })
    const run = model.mining.runs[0]
    expect(model.warningView().arrivals).toEqual([{ shipId: 'lab-miner', remainingMs: run.durationMs - run.progressMs }])
    const before = structuredClone(run)
    model.command({ kind: 'toggle', cellIndex: 9 })
    expect(model.warningView()).toEqual({ online: false, arrivals: [] })
    expect(model.mining.runs[0]).toEqual(before)
    model.command({ kind: 'toggle', cellIndex: 9 }); model.advance(run.durationMs / 60_000)
    expect(model.warningView().arrivals).toEqual([])
  })
  it('旧v7只补空发展/制造/额外课程账，保留原技术、人口和库存', () => {
    const model = developmentFixture(), old = JSON.parse(model.snapshot())
    old.version = 7; delete old.development; delete old.manufacturing; delete old.academy
    const restored = importSnapshot(JSON.stringify(old))
    expect(restored.development).toEqual({ version: 1, expanded: false, levels: {}, damaged: [], projects: [] })
    expect(restored.manufacturing.runs).toEqual([]); expect(restored.academy.active).toBeUndefined()
    expect(restored.inventoryView()).toEqual(model.inventoryView()); expect(restored.population).toEqual(model.population)
    expect(restored.research).toEqual(model.research)
  })
})
