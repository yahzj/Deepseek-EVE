import { describe, expect, it, vi } from 'vitest'
import { createPlayerStation, PLAYER_FACILITIES, serializePlayerStation } from '../../packages/core/src/playerStation/index'
import { LabModel, MATERIAL_IDS, SNAPSHOT_FORMAT, importSnapshot, initialInventory, materialInfo } from './model'
import { refiningOutput, refiningRecipe } from './refining-baseline'
import { MINER_ID, miningParams, miningReturnMs } from './mining-baseline'

function bodyBill(model: LabModel): Record<string, number> {
  return Object.fromEntries(model.view().bill.map((row) => [row.itemId, row.remaining]))
}
function removeMiningFields(file: any) {
  delete file.research
  delete file.development; delete file.academy; delete file.manufacturing
  delete file.mining; delete file.miningLevel; delete file.shipCargo
  if (file.ships) file.ships = file.ships.filter((ship: any) => ship.id === 'lab-shuttle')
}

function approved() {
  const model = new LabModel()
  expect(model.command({ kind: 'approve' }).ok).toBe(true)
  return model
}

function built() {
  const model = approved()
  expect(model.deliver(bodyBill(model)).ok).toBe(true)
  model.advance(60)
  model.advance(60)
  expect(model.station.built).toBe(true)
  return model
}

function powered() {
  const model = built()
  expect(model.command({ kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: true })
  model.advance(60)
  expect(model.station.projects).toEqual([])
  return model
}

describe('玩家站预览宿主：库存与到货', () => {
  it('新会话使用runtime3，主体与设施工程分别保存', () => {
    const model = new LabModel()
    expect(model.station.runtimeVersion).toBe(3)
    expect(model.station.project).toBeUndefined()
    expect(model.station.projects).toEqual([])
    expect(model.view().projects).toEqual([])
    expect(model.view()).not.toHaveProperty('projectBlocked')
  })

  it('take 先核整单，任一物料不足时其余物料也不扣除', () => {
    const model = new LabModel()
    model.setInventory('part-frame', 1)
    const before = model.inventoryView()
    expect(model.host.take({ 'min-tritanium': 1, 'part-frame': 2 })).toBe(false)
    expect(model.inventoryView()).toEqual(before)
  })

  it('模拟到货库存不足时库存与模块都保持不变', () => {
    const model = approved()
    const bill = bodyBill(model)
    model.setInventory('part-lens', 0)
    const before = model.snapshot()
    expect(model.deliver(bill)).toEqual({ ok: false, accepted: {}, rejected: {} })
    expect(model.snapshot()).toBe(before)
  })

  it('部分到货过滤零项，仅扣实际接收物品', () => {
    const model = approved()
    const before = model.inventoryView()
    expect(model.deliver({ 'min-tritanium': 15, 'part-frame': 0 })).toEqual({
      ok: true, accepted: { 'min-tritanium': 15 }, rejected: {},
    })
    expect(model.station.bodyMaterials).toEqual({ 'min-tritanium': 15 })
    expect(model.host.available('min-tritanium')).toBe(before['min-tritanium'] - 15)
    expect(model.host.available('part-frame')).toBe(before['part-frame'])
  })

  it('全零到货与空单都是无副作用操作', () => {
    const model = approved()
    const before = model.snapshot()
    expect(model.deliver({ 'min-tritanium': 0, 'part-frame': 0 })).toEqual({ ok: true, accepted: {}, rejected: {} })
    expect(model.deliver({})).toEqual({ ok: true, accepted: {}, rejected: {} })
    expect(model.snapshot()).toBe(before)
  })

  it('未批准时拒收原物留在预览库存', () => {
    const model = new LabModel()
    const before = model.inventoryView()
    expect(model.deliver({ 'min-tritanium': 15 })).toEqual({ ok: true, accepted: {}, rejected: { 'min-tritanium': 15 } })
    expect(model.inventoryView()).toEqual(before)
    expect(model.station.bodyMaterials).toEqual({})
  })

  it('超过主体缺口的部分原物退回，库存只减少接收量', () => {
    const model = approved()
    const bill = bodyBill(model)
    const before = model.inventoryView()
    const result = model.deliver({ ...bill, 'min-tritanium': bill['min-tritanium'] + 5 })
    expect(result.accepted).toEqual(bill)
    expect(result.rejected).toEqual({ 'min-tritanium': 5 })
    for (const id of MATERIAL_IDS) expect(model.host.available(id)).toBe(before[id] - (bill[id] ?? 0))
    expect(model.station.project?.kind).toBe('body')
  })

  it('交接后的返还意外抛错时同时恢复库存、现场材料与工程', () => {
    const model = approved()
    const before = model.snapshot()
    const give = vi.spyOn(model.host, 'give').mockImplementationOnce(() => { throw new Error('交接探针') })
    expect(() => model.deliver(bodyBill(model))).toThrow('交接探针')
    give.mockRestore()
    expect(model.snapshot()).toBe(before)
    expect(model.station.project).toBeUndefined()
  })

  it('非法到货在扣料前拒绝', () => {
    const model = approved()
    const before = model.snapshot()
    expect(() => model.deliver({ 'min-tritanium': -1 })).toThrow()
    expect(() => model.deliver({ 'min-tritanium': 1.5 })).toThrow()
    expect(() => model.deliver({ unknown: 1 })).toThrow()
    expect(model.snapshot()).toBe(before)
  })

  it('无效模块状态在扣料前拒绝', () => {
    const model = approved()
    model.station.clockMs = -1
    const before = model.inventoryView()
    expect(() => model.deliver({ 'min-tritanium': 1 })).toThrow()
    expect(model.inventoryView()).toEqual(before)
  })

  it('主体取消后回收只给预览库存一次', () => {
    const model = approved()
    const before = model.inventoryView()
    model.deliver({ 'min-tritanium': 15 })
    model.command({ kind: 'cancel' })
    expect(model.recover()).toEqual({ 'min-tritanium': 15 })
    expect(model.inventoryView()).toEqual(before)
    expect(model.recover()).toEqual({})
    expect(model.inventoryView()).toEqual(before)
  })

  it('设施取消的 host.give 只退款一次，不再进入回收清单', () => {
    const model = built()
    const before = model.inventoryView()
    expect(model.command({ kind: 'build', facility: 'power', cellIndex: 0 }).ok).toBe(true)
    expect(model.station.project).toBeUndefined()
    expect(model.station.projects[0]).toMatchObject({ kind: 'power', cellIndex: 0, startup: true })
    const beforeCancel = model.snapshot()
    expect(model.command({ kind: 'cancel' })).toEqual({ ok: false, reason: 'no-project' })
    expect(model.snapshot()).toBe(beforeCancel)
    expect(model.command({ kind: 'cancel', cellIndex: 0 }).ok).toBe(true)
    expect(model.station.projects).toEqual([])
    expect(model.inventoryView()).toEqual(before)
    expect(model.command({ kind: 'cancel', cellIndex: 0 }).ok).toBe(false)
    expect(model.recover()).toEqual({})
    expect(model.inventoryView()).toEqual(before)
  })

  it('预览宿主支持跨格并行，逐格暂停及取消仅退目标工程的剩余投入', () => {
    const model = powered()
    const inventory = model.inventoryView()
    expect(model.command({ kind: 'build', facility: 'life-support', cellIndex: 7 })).toEqual({ ok: true })
    expect(model.command({ kind: 'build', facility: 'service', cellIndex: 2 })).toEqual({ ok: true })
    expect(model.station.projects.map(p => p.cellIndex)).toEqual([7, 2])
    expect(model.station.project).toBeUndefined()
    for (const id of MATERIAL_IDS) {
      expect(model.host.available(id)).toBe(inventory[id] - (PLAYER_FACILITIES['life-support'].bill[id] ?? 0) - (PLAYER_FACILITIES.service.bill[id] ?? 0))
    }
    const beforeDuplicate = model.snapshot()
    expect(model.command({ kind: 'build', facility: 'power', cellIndex: 7 })).toEqual({ ok: false, reason: 'invalid-cell' })
    expect(model.snapshot()).toBe(beforeDuplicate)
    model.advance(15)
    expect(model.command({ kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    expect(model.view().power).toMatchObject({ runningDemand: 0, constructionDemand: 4, constructionRequested: 4, demand: 4 })
    const remaining = structuredClone(model.station.projects[0])
    expect(model.command({ kind: 'cancel', cellIndex: 2 })).toEqual({ ok: true })
    expect(model.station.projects).toEqual([remaining])
    for (const id of MATERIAL_IDS) {
      expect(model.host.available(id)).toBe(inventory[id] - (PLAYER_FACILITIES['life-support'].bill[id] ?? 0) - (PLAYER_FACILITIES.service.bill[id] ?? 0) / 2)
    }
    model.advance(15)
    expect(model.station.projects[0].progressMs).toBe(15 * 60_000)
    expect(model.command({ kind: 'resume', cellIndex: 7 })).toEqual({ ok: true })
    model.advance(15)
    expect(model.station.projects[0].progressMs).toBe(30 * 60_000)
    expect(model.recover()).toEqual({})
  })

  it('静态物品价格和体积是有效数字，库存读数不暴露可写引用', () => {
    const model = new LabModel()
    for (const id of MATERIAL_IDS) {
      const item = materialInfo(id)
      expect(Number.isFinite(item.price)).toBe(true)
      expect(Number.isFinite(item.unitM3)).toBe(true)
    }
    const stock = model.inventoryView()
    stock['min-tritanium'] = 0
    expect(model.host.available('min-tritanium')).toBe(initialInventory()['min-tritanium'])
  })
})

describe('玩家站预览宿主：工程学与独立快照', () => {
  it('升级事件当刻协调：现场已满足新料单时立即开工且不消耗时间', () => {
    const model = approved()
    const reference = new LabModel()
    reference.setEngineering(5)
    const discountedBill = bodyBill(reference)
    model.deliver(discountedBill)
    expect(model.station.project).toBeUndefined()
    const before = model.inventoryView()
    model.setEngineering(5)
    expect(model.station.project?.kind).toBe('body')
    expect(model.station.project?.spent).toEqual(discountedBill)
    expect(model.station.project?.progressMs).toBe(0)
    expect(model.station.clockMs).toBe(0)
    expect(model.inventoryView()).toEqual(before)
  })

  it('已开工再升级不改写原投入账', () => {
    const model = approved()
    model.deliver(bodyBill(model))
    const before = structuredClone(model.station.project)
    model.setEngineering(5)
    expect(model.station.project).toEqual(before)
    expect(() => model.setEngineering(6)).toThrow()
    expect(model.engineering).toBe(5)
  })

  it('库存、模块工程、暂停和工程学整体往返恢复，且新旧实例互不影响', () => {
    const model = approved()
    model.setEngineering(3)
    model.deliver(bodyBill(model))
    model.advance(15)
    model.command({ kind: 'pause' })
    model.setInventory('part-lens', 123)
    const output = model.snapshot()
    const restored = importSnapshot(output)
    expect(restored.snapshot()).toBe(output)
    expect(restored.station).toEqual(model.station)
    expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(restored.engineering).toBe(3)
    restored.setInventory('part-lens', 0)
    restored.command({ kind: 'resume' })
    expect(model.host.available('part-lens')).toBe(123)
    expect(model.station.project?.paused).toBe(true)
  })

  it('会话内嵌v2模块快照，多工程、逐格暂停和缺电均可往返', () => {
    const model = powered()
    expect(model.command({ kind: 'build', facility: 'service', cellIndex: 7 })).toEqual({ ok: true })
    expect(model.command({ kind: 'build', facility: 'life-support', cellIndex: 2 })).toEqual({ ok: true })
    model.advance(15)
    expect(model.command({ kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    expect(model.command({ kind: 'toggle', cellIndex: 0 })).toEqual({ ok: true })
    model.setEngineering(3)
    const output = model.snapshot(), session = JSON.parse(output)
    expect(JSON.parse(session.station)).toMatchObject({ format: 'whale-player-station-lab', version: 3, state: { runtimeVersion: 3 } })
    const restored = importSnapshot(output)
    expect(restored.snapshot()).toBe(output)
    expect(restored.station).toEqual(model.station)
    expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(restored.view().projects.map(p => [p.cellIndex, p.paused, p.blocked])).toEqual([[7, true, false], [2, false, true]])
    expect(restored.view().power).toMatchObject({ supply: 0, runningDemand: 0, constructionDemand: 0, constructionRequested: 4, demand: 0 })
    expect(restored.command({ kind: 'toggle', cellIndex: 0 })).toEqual({ ok: true })
    expect(restored.command({ kind: 'resume', cellIndex: 7 })).toEqual({ ok: true })
    restored.advance(15)
    expect(restored.station.cells).toContainEqual({ kind: 'service', cellIndex: 7, enabled: true })
    expect(model.station.projects).toHaveLength(2)
    expect(model.station.projects[0].paused).toBe(true)
    expect(model.station.cells[0].enabled).toBe(false)
  })

  it('预览会话仍可导入旧v1模块单工程，并重新导出v2设施数组', () => {
    const model = built()
    expect(model.command({ kind: 'build', facility: 'power', cellIndex: 7 })).toEqual({ ok: true })
    model.advance(15)
    expect(model.command({ kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    const session = JSON.parse(model.snapshot())
    const station = JSON.parse(session.station)
    station.version = 1
    station.state.runtimeVersion = 1
    station.state.project = station.state.projects[0]
    delete station.state.project.startup
    delete station.state.projects
    session.station = JSON.stringify(station)
    const restored = importSnapshot(JSON.stringify(session))
    expect(restored.station).toEqual(model.station)
    expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(restored.station.project).toBeUndefined()
    expect(restored.station.projects[0]).toMatchObject({ cellIndex: 7, startup: true, progressMs: 15 * 60_000, paused: true })
    expect(JSON.parse(JSON.parse(restored.snapshot()).station).version).toBe(3)
  })

  it('正式游戏存档与裸模块快照均不作为预览会话读取', () => {
    expect(() => importSnapshot(JSON.stringify({ version: 31, state: {} }))).toThrow('不接受正式游戏存档')
    expect(() => importSnapshot(serializePlayerStation(createPlayerStation()))).toThrow('不接受正式游戏存档')
  })

  it('库存或模块损坏时整份拒绝，不影响当前预览', () => {
    const model = approved()
    const before = model.snapshot()
    const badInventory = JSON.parse(before)
    badInventory.inventory['min-tritanium'] = -1
    expect(() => importSnapshot(JSON.stringify(badInventory))).toThrow()
    const badStation = JSON.parse(before)
    badStation.station = JSON.stringify({ invalid: true })
    expect(() => importSnapshot(JSON.stringify(badStation))).toThrow()
    expect(model.snapshot()).toBe(before)
    expect(JSON.parse(before).format).toBe(SNAPSHOT_FORMAT)
  })
})

function reception() {
  const model = powered()
  model.command({ kind: 'build', facility: 'life-support', cellIndex: 1 })
  model.command({ kind: 'build', facility: 'service', cellIndex: 2 })
  model.advance(60)
  model.sourceKnown = true
  expect(model.view().receptionReady).toBe(true)
  return model
}

describe('玩家站预览宿主：人口、设施时间轴与副船快照', () => {
  it('来源未发现不会自动领人；发现和排计划不额外收费', () => {
    const model = powered()
    const inventory = model.inventoryView()
    expect(model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })).toEqual({ ok: false, reason: 'source' })
    expect(model.inventoryView()).toEqual(inventory)
    expect(model.populationView().residents).toBe(0)
  })

  it('设施完工边界前不提前处理，完成保障后才开始18分钟运输', () => {
    const model = powered()
    model.sourceKnown = true
    model.command({ kind: 'build', facility: 'life-support', cellIndex: 1 })
    model.command({ kind: 'build', facility: 'service', cellIndex: 2 })
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(60)
    expect(model.populationView().residents).toBe(0)
    expect(model.population.trip?.phase).toBe('loading')
    expect(model.population.trip?.progressMs).toBe(0)
    model.advance(17)
    expect(model.populationView().residents).toBe(0)
    model.advance(1)
    expect(model.populationView().residents).toBe(1)
  })

  it('人口/副船/合成库存整体保存，半途恢复不重复扣料或抢船', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 6 })
    for (let i = 0; i < 84; i++) {
      model.advance(1)
      const snapshot = model.snapshot()
      const restored = importSnapshot(snapshot)
      expect(restored.snapshot()).toBe(snapshot)
      if (i === 9) {
        const inventory = restored.inventoryView()
        restored.advance(8)
        expect(restored.populationView().residents).toBe(1)
        // 剩余目标下一趟开始会取新物资，但不会重扣第一人的已投入耗材。
        expect(restored.host.available('repairkit-civ')).toBe(inventory['repairkit-civ'] - 20)
      }
    }
    expect(model.populationView().residents).toBe(6)
    expect(model.ships[0].available).toBe(true)
  })

  it('停用中心立即安全转向；原预留与接收进度保存，再接回不多扣材料', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(17)
    const inventory = model.inventoryView()
    model.command({ kind: 'toggle', cellIndex: 2 })
    expect(model.population.trip?.phase).toBe('safety-return')
    expect(model.view().receptionReady).toBe(false)
    model.advance(2)
    expect(model.populationView()).toMatchObject({ protected: 1, reserved: 1, residents: 0 })
    const restored = importSnapshot(model.snapshot())
    restored.command({ kind: 'toggle', cellIndex: 2 })
    restored.advance(14)
    expect(restored.populationView()).toMatchObject({ residents: 1, reserved: 0 })
    expect(restored.inventoryView()).toEqual(inventory)
  })

  it('拒绝人口任务与副船错账、删人口字段和未知版本', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(5)
    for (const mutate of [(file: Record<string, any>) => { file.ships[0].available = true },
      (file: Record<string, any>) => { file.ships[0].freeM3 = 99 },
      (file: Record<string, any>) => { delete file.population },
      (file: Record<string, any>) => { file.version = 999 },
      (file: Record<string, any>) => { file.sourceKnown = false }]) {
      const file = JSON.parse(model.snapshot()); mutate(file)
      expect(() => importSnapshot(JSON.stringify(file))).toThrow()
    }
  })
  it('恰在出港/返程起点断电，零距离交接不会卡住宿主时间推进', () => {
    for (const at of [1, 14]) {
      const model = reception()
      model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
      model.advance(at)
      model.command({ kind: 'toggle', cellIndex: 2 })
      expect(model.population.trip).toBeUndefined()
      expect(model.ships[0].available).toBe(true)
      model.advance(60)
      expect(model.populationView().residents).toBe(0)
      expect(model.populationView().protected).toBe(at === 14 ? 1 : 0)
      expect(() => importSnapshot(model.snapshot())).not.toThrow()
    }
  })
  it('同刻设施完工挤掉中心供电，不用旧条件多解冻下一人', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 6 })
    model.advance(18)
    model.command({ kind: 'build', facility: 'life-support', cellIndex: 3 })
    model.command({ kind: 'build', facility: 'life-support', cellIndex: 4 })
    model.command({ kind: 'build', facility: 'life-support', cellIndex: 5 })
    // 三项工程在第二趟第一单位完成的时刻同时完工，生命维持优先令服务中心失去供电。
    for (const project of model.station.projects) project.progressMs = project.durationMs - 13 * 60_000
    model.advance(13)
    expect(model.view().receptionReady).toBe(false)
    expect(model.populationView()).toMatchObject({ residents: 1, protected: 1, dormant: 4, reserved: 1 })
    expect(model.population.sourceMaterials['repairkit-civ']).toBe(16)
    expect(() => importSnapshot(model.snapshot())).not.toThrow()
  })

  it('旧v1预览迁移只初始化未发现人口和测试副船，不追加库存', () => {
    const model = powered()
    const file = JSON.parse(model.snapshot())
    file.version = 1
    removeMiningFields(file)
    delete file.population; delete file.sourceKnown; delete file.ships
    delete file.training
    delete file.refining; delete file.refiningLevel
    delete file.inventory['repairkit-civ']
    const restored = importSnapshot(JSON.stringify(file))
    expect(restored.host.available('repairkit-civ')).toBe(0)
    expect(restored.populationView()).toMatchObject({ sourceKnown: false, dormant: 6, residents: 0, reserved: 0 })
    expect(restored.station).toEqual(model.station)
    expect(JSON.parse(restored.snapshot()).version).toBe(8)
  })
})

describe('玩家站预览宿主：课程与跨模块时间边界', () => {
  it('已排课程等首人18分钟接收，再真实受训30分钟，工程学不缩短课程', () => {
    const model = reception(), inventory = model.inventoryView()
    model.setEngineering(5)
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(18)
    expect(model.training.active).toMatchObject({ personIndex: 0, progressMs: 0 })
    const afterRevival = model.inventoryView()
    model.advance(29)
    expect(model.trainingView().engineers).toBe(0)
    model.advance(1)
    expect(model.trainingView()).toMatchObject({ engineers: 1, residents: 1, seatUsed: 0 })
    expect(model.populationView()).toMatchObject({ residents: 1, reserved: 0 })
    expect(model.inventoryView()).toEqual(afterRevival)
    expect(inventory['repairkit-civ'] - afterRevival['repairkit-civ']).toBe(4)
  })
  it('两类资格用不同居民，课程队列与转运可并行，不凭空生成第二工种', () => {
    const model = reception()
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' })
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(60)
    expect(model.trainingView()).toMatchObject({ engineers: 1, researchers: 0, wait: 'person' })
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    model.advance(18)
    expect(model.training.active).toMatchObject({ personIndex: 1, course: 'researcher', progressMs: 0 })
    model.advance(30)
    expect(model.trainingView()).toMatchObject({ engineers: 1, researchers: 1, residents: 2 })
  })
  it('停用中心时课程保进度/占用，恢复后只算新增时间', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 }); model.advance(18)
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' }); model.advance(15)
    model.command({ kind: 'toggle', cellIndex: 2 }); model.advance(60)
    expect(model.trainingView()).toMatchObject({ seatUsed: 1, ordinary: 0, active: { progressMs: 15 * 60_000, blocked: 'facilities' } })
    const restored = importSnapshot(model.snapshot())
    expect(restored.snapshot()).toBe(model.snapshot())
    restored.command({ kind: 'toggle', cellIndex: 2 }); restored.advance(15)
    expect(restored.trainingView().engineers).toBe(1)
    expect(model.trainingView().engineers).toBe(0)
  })
  it('手动暂停与队列整体恢复，取消排队不影响正在受训人口', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 2 }); model.advance(36)
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' })
    model.advance(15); model.trainingCommand({ kind: 'pause' })
    const before = model.snapshot(), restored = importSnapshot(before)
    expect(restored.snapshot()).toBe(before)
    restored.advance(60)
    expect(restored.training.active).toMatchObject({ personIndex: 0, progressMs: 15 * 60_000, paused: true })
    restored.trainingCommand({ kind: 'remove', index: 0 })
    expect(restored.training.active).toEqual(model.training.active)
    restored.trainingCommand({ kind: 'resume' }); restored.advance(15)
    expect(restored.trainingView()).toMatchObject({ engineers: 1, researchers: 0, ordinary: 1, seatUsed: 0 })
  })
  it('人口/课程/施工大步与分步结果一致，课程不重复消费材料', () => {
    const large = reception(), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) {
      model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 6 })
      model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
      model.trainingCommand({ kind: 'enqueue', course: 'researcher' })
      model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    }
    large.advance(136)
    for (let i = 0; i < 136; i++) small.advance(1)
    expect(small.snapshot()).toBe(large.snapshot())
    expect(large.trainingView()).toMatchObject({ engineers: 2, researchers: 1, residents: 6 })
  })
  it('课程完成同刻保障失效不再开下一门，已完成资格保留', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 2 }); model.advance(36)
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' })
    for (const cellIndex of [3, 4, 5]) {
      model.command({ kind: 'build', facility: 'life-support', cellIndex })
      model.station.projects.find(project => project.cellIndex === cellIndex)!.progressMs = 30 * 60_000
    }
    model.advance(30)
    expect(model.trainingView()).toMatchObject({ engineers: 1, researchers: 0, seatUsed: 0, queue: ['researcher'], wait: 'facilities' })
  })
  it('v2快照迁移只补空课程账，不发资格；v3缺课账、字符串版本或孤立资格整份拒绝', () => {
    const model = reception()
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 }); model.advance(18)
    const old = JSON.parse(model.snapshot()); old.version = 2; delete old.training
    removeMiningFields(old)
    delete old.refining; delete old.refiningLevel
    const restored = importSnapshot(JSON.stringify(old))
    expect(restored.trainingView()).toMatchObject({ residents: 1, ordinary: 1, engineers: 0, researchers: 0 })
    expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(restored.population).toEqual(model.population)
    for (const mutate of [(file: any) => { delete file.training }, (file: any) => { file.version = '3' },
      (file: any) => { file.training.qualifications[5] = 'engineer' }, (file: any) => { file.training.version = 2 }]) {
      const bad = JSON.parse(model.snapshot()); mutate(bad)
      expect(() => importSnapshot(JSON.stringify(bad))).toThrow()
    }
  })
})

function qualifiedEngineers(count = 1) {
  const model = reception()
  model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count })
  model.advance(count === 1 ? 18 : 84)
  for (let i = 0; i < count; i++) model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
  model.advance(count * 30)
  expect(model.trainingView().engineers).toBe(count)
  return model
}

describe('玩家站预览宿主：工程师施工与五种设施', () => {
  it('五设施可见，未培训或只有研究员时不能开人类工程，也不扣材料', () => {
    const model = reception()
    expect(Object.keys(model.view().facilityOptions)).toEqual(['power', 'life-support', 'service', 'refinery', 'research', 'manufacturing', 'training', 'warning'])
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 }); model.advance(18)
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' }); model.advance(30)
    const inventory = model.inventoryView()
    expect(model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })).toEqual({ ok: false, reason: 'engineer' })
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    expect(model.inventoryView()).toEqual(inventory)
    expect(model.view().facilityOptions.refinery).toMatchObject({ engineers: 1, availableEngineers: 0, reason: 'engineer' })
  })
  it('工程师开工真实占用，暂停仍不能双派，取消后原人可建另一设施', () => {
    const model = qualifiedEngineers()
    expect(model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })).toEqual({ ok: true })
    model.advance(15); model.command({ kind: 'pause', cellIndex: 3 })
    expect(model.station.projects[0]).toMatchObject({ engineerIndex: 0, paused: true, progressMs: 15 * 60_000 })
    expect(model.view().facilityOptions.research.availableEngineers).toBe(0)
    expect(model.trainingHost.available(0)).toBe(false)
    const before = model.snapshot()
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    expect(model.snapshot()).toBe(before)
    model.command({ kind: 'cancel', cellIndex: 3 })
    expect(model.trainingHost.available(0)).toBe(true)
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: true })
    expect(model.station.projects[0].engineerIndex).toBe(0)
  })
  it('两工程师跨格并行，同步保留人口/课程资格，完工不自动工作', () => {
    const model = qualifiedEngineers(2)
    model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })
    model.command({ kind: 'build', facility: 'research', cellIndex: 4 })
    model.advance(60)
    expect(model.populationView().residents).toBe(2)
    expect(model.trainingView().engineers).toBe(2)
    expect(model.station.projects[0]).toMatchObject({ kind: 'research', engineerIndex: 1, progressMs: 60 * 60_000 })
    model.advance(30)
    expect(model.view().power).toMatchObject({ runningDemand: 10, constructionDemand: 0 })
    expect(model.station.projects).toEqual([])
    const inventory = model.inventoryView(); model.advance(60)
    expect(model.inventoryView()).toEqual(inventory)
    expect(model.populationView().residents).toBe(2)
  })
  it('断电保留工程师占用与工时，恢复只推进剩余时间', () => {
    const model = qualifiedEngineers()
    model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); model.advance(15)
    model.command({ kind: 'toggle', cellIndex: 0 }); model.advance(60)
    expect(model.station.projects[0]).toMatchObject({ engineerIndex: 0, progressMs: 15 * 60_000 })
    expect(model.trainingHost.available(0)).toBe(false)
    const restored = importSnapshot(model.snapshot())
    expect(restored.snapshot()).toBe(model.snapshot())
    restored.command({ kind: 'toggle', cellIndex: 0 }); restored.advance(45)
    expect(restored.station.projects).toEqual([])
    expect(restored.trainingHost.available(0)).toBe(true)
  })
  it('新快照保留工程与原人，拒绝非居民、非工程师、受训者及重复占用', () => {
    const model = qualifiedEngineers(2)
    model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })
    model.command({ kind: 'build', facility: 'research', cellIndex: 4 }); model.advance(15)
    expect(importSnapshot(model.snapshot()).snapshot()).toBe(model.snapshot())
    for (const mutate of [(file: any) => { file.training.qualifications[0] = 'researcher' },
      (file: any) => { file.training.qualifications[0] = null },
      (file: any) => { file.population.people[0].status = 'dormant'; file.population.people[0].receiveMs = 0 },
      (file: any) => { const state = JSON.parse(file.station); state.state.projects[1].engineerIndex = 0; file.station = JSON.stringify(state) },
      (file: any) => { file.version = 3 }]) {
      const bad = JSON.parse(model.snapshot()); mutate(bad)
      expect(() => importSnapshot(JSON.stringify(bad))).toThrow()
    }
  })
  it('旧v3会话和v2设施迁移不增建筑/资格/材料，重新导出新版本', () => {
    const model = qualifiedEngineers(), file = JSON.parse(model.snapshot())
    file.version = 3
    removeMiningFields(file)
    delete file.refining; delete file.refiningLevel
    const station = JSON.parse(file.station); station.version = 2; station.state.runtimeVersion = 2
    file.station = JSON.stringify(station)
    const restored = importSnapshot(JSON.stringify(file))
    expect(restored.station).toEqual(model.station)
    expect(restored.training).toEqual(model.training)
    expect(restored.population).toEqual(model.population)
    expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(JSON.parse(restored.snapshot()).version).toBe(8)
    expect(JSON.parse(JSON.parse(restored.snapshot()).station).version).toBe(3)
  })
  it('同一时刻课程结束不让已在施工的人员换工，分步和大步一致', () => {
    const large = qualifiedEngineers(2), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) {
      model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })
      model.command({ kind: 'build', facility: 'research', cellIndex: 4 })
      model.trainingCommand({ kind: 'enqueue', course: 'researcher' })
    }
    large.advance(90); for (let i = 0; i < 90; i++) small.advance(1)
    expect(small.snapshot()).toBe(large.snapshot())
    expect(large.trainingView()).toMatchObject({ engineers: 2, researchers: 0, wait: 'person' })
  })
})

function refineryModel() {
  const model = qualifiedEngineers()
  model.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); model.advance(60)
  model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 }); model.advance(18)
  return model
}
const assignRefining = (model: LabModel, personIndex = 1, cellIndex = 3) => model.refiningCommand({ kind: 'assign', personIndex, cellIndex, itemId: 'ore-veldspar' })

describe('玩家站预览宿主：基础派工与精炼', () => {
  it('普通居民无课程可精炼，产出和周期取真实主控基准，同仓整批结算', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    expect(model.training.qualifications[1]).toBeNull()
    model.setInventory('ore-veldspar', recipe.batchUnits * 2)
    const before = model.inventoryView()
    expect(assignRefining(model)).toEqual({ ok: true })
    expect(model.inventoryView()).toEqual(before)
    expect(model.view().power.runningDemand).toBe(14)
    model.advance(recipe.cycleMs / 60_000)
    expect(model.host.available('ore-veldspar')).toBe(recipe.batchUnits)
    for (const [id, n] of Object.entries(refiningOutput('ore-veldspar', recipe.batchUnits, 0))) expect(model.host.available(id)).toBe((before[id] ?? 0) + n)
    expect(model.populationView().residents).toBe(2)
    expect(model.refining.runs[0].batchesDone).toBe(1)
  })
  it('精炼/课程/施工三方互斥，暂停精炼保留占人，停止后不自动重启', () => {
    const model = refineryModel(); model.setInventory('ore-veldspar', 1000)
    assignRefining(model, 0)
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    model.refiningCommand({ kind: 'pause', cellIndex: 3 })
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    expect(model.view().power.runningDemand).toBe(9)
    model.refiningCommand({ kind: 'stop', cellIndex: 3 })
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: true })
    expect(assignRefining(model, 0)).toEqual({ ok: false, reason: 'person' })
    model.trainingCommand({ kind: 'enqueue', course: 'engineer' })
    expect(model.training.active?.personIndex).toBe(1)
    expect(assignRefining(model, 1)).toEqual({ ok: false, reason: 'person' })
    model.advance(90)
    expect(model.refining.runs[0].personIndex).toBeUndefined()
    expect(model.refining.runs[0].batchesDone).toBe(0)
  })
  it('普通居民在精炼中不会被排课强抽，停止后明确恢复课程', () => {
    const model = refineryModel(); model.setInventory('ore-veldspar', 0)
    assignRefining(model)
    model.trainingCommand({ kind: 'enqueue', course: 'researcher' }); model.advance(60)
    expect(model.training.active).toBeUndefined()
    expect(model.trainingView().wait).toBe('person')
    expect(model.refining.runs[0].personIndex).toBe(1)
    model.refiningCommand({ kind: 'stop', cellIndex: 3 })
    expect(model.training.active).toMatchObject({ personIndex: 1, course: 'researcher', progressMs: 0 })
  })
  it('缺料/缺电保进度，补料/恢复无倒算；停止清半批不退未扣材料', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    model.setInventory('ore-veldspar', recipe.batchUnits * 3); assignRefining(model)
    model.advance(recipe.cycleMs / 120_000)
    expect(model.refining.runs[0].progressMs).toBe(recipe.cycleMs / 2)
    model.setInventory('ore-veldspar', recipe.batchUnits - 1); model.advance(15)
    expect(model.refining.runs[0].progressMs).toBe(recipe.cycleMs / 2)
    model.setInventory('ore-veldspar', recipe.batchUnits * 2)
    model.command({ kind: 'toggle', cellIndex: 0 }); model.advance(15)
    expect(model.refining.runs[0].progressMs).toBe(recipe.cycleMs / 2)
    model.command({ kind: 'toggle', cellIndex: 0 }); model.advance(recipe.cycleMs / 120_000)
    expect(model.refining.runs[0].batchesDone).toBe(1)
    const before = model.inventoryView(); model.refiningCommand({ kind: 'stop', cellIndex: 3 }); model.advance(60)
    expect(model.inventoryView()).toEqual(before)
    expect(model.refining.runs[0].personIndex).toBeUndefined()
  })
  it('最后一批结束同刻完工工程不能借已释放精炼负荷倒算工时', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    model.setInventory('ore-veldspar', recipe.batchUnits)
    for (const cellIndex of [4, 5, 6]) model.command({ kind: 'build', facility: 'service', cellIndex })
    // 9点待机+5点精炼额外负荷时仅剩10点，三个工程只能推进前两个。
    assignRefining(model)
    model.advance(recipe.cycleMs / 60_000)
    expect(model.station.projects.map(project => project.progressMs)).toEqual([recipe.cycleMs, recipe.cycleMs, 0])
    expect(model.view().power.runningDemand).toBe(9)
    model.advance(recipe.cycleMs / 60_000)
    expect(model.station.projects.map(project => project.progressMs)).toEqual([recipe.cycleMs * 2, recipe.cycleMs * 2, recipe.cycleMs])
  })
  it('整体快照保存半批/人员/物料，技能改变只影响新开炉参数与当前产出单点', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    model.setInventory('ore-veldspar', recipe.batchUnits * 20); assignRefining(model)
    model.advance(recipe.cycleMs / 120_000); model.setRefiningLevel(5)
    const restored = importSnapshot(model.snapshot())
    expect(restored.snapshot()).toBe(model.snapshot())
    const before = restored.inventoryView()
    restored.advance(recipe.cycleMs / 120_000)
    for (const [id, n] of Object.entries(refiningOutput('ore-veldspar', recipe.batchUnits, 5))) expect(restored.host.available(id)).toBe((before[id] ?? 0) + n)
    expect(restored.refining.runs[0].cycleMs).toBe(recipe.cycleMs)
    expect(model.refining.runs[0].batchesDone).toBe(0)
  })
  it('多模块大步/小步一致，完成后原料不足停进度而非退人口', () => {
    const large = refineryModel(), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) { model.setInventory('ore-veldspar', 250); assignRefining(model) }
    large.advance(1); for (let i = 0; i < 60; i++) small.advance(1 / 60)
    expect(small.snapshot()).toBe(large.snapshot())
    expect(large.refining.runs[0]).toMatchObject({ batchesDone: 2, progressMs: 0, personIndex: 1 })
    expect(large.host.available('ore-veldspar')).toBe(50)
  })
  it('拒绝丢失精炼账、重复人员、孤立设备或伪造批量，旧v4不补原矿/产出', () => {
    const model = refineryModel(); model.setInventory('ore-veldspar', 1000); assignRefining(model)
    for (const mutate of [(file: any) => { delete file.refining }, (file: any) => { file.refining.runs[0].cellIndex = 8 },
      (file: any) => { file.refining.runs[0].personIndex = 5 }, (file: any) => { file.refining.runs[0].batchUnits = 1 },
      (file: any) => { file.refining.runs[0].personIndex = 0; const state = JSON.parse(file.station); state.state.projects.push({ kind: 'research', cellIndex: 4, engineerIndex: 0,
        durationMs: 90 * 60_000, progressMs: 0, paused: false, spent: PLAYER_FACILITIES.research.bill }); file.station = JSON.stringify(state) }]) {
      const bad = JSON.parse(model.snapshot()); mutate(bad); expect(() => importSnapshot(JSON.stringify(bad))).toThrow()
    }
    model.refiningCommand({ kind: 'stop', cellIndex: 3 })
    const old = JSON.parse(model.snapshot()); old.version = 4; delete old.refining; delete old.refiningLevel
    removeMiningFields(old)
    const restored = importSnapshot(JSON.stringify(old))
    expect(restored.refining.runs).toEqual([]); expect(restored.inventoryView()).toEqual(model.inventoryView())
    expect(restored.population).toEqual(model.population)
    expect(JSON.parse(restored.snapshot()).version).toBe(8)
  })
  it('本批新产出到边界后才能供等待中的人口计划使用，不倒算航程', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    model.setInventory('ore-veldspar', recipe.batchUnits)
    model.setInventory('part-circuit', 0)
    model.populationCommand({ kind: 'start', shipId: 'lab-shuttle', count: 1 })
    expect(model.population.trip).toBeUndefined()
    // 只替换测试宿主的产物交接，模拟本批为等待计划补齐材料，不修改真实精炼公式。
    model.refiningHost.output = () => ({ 'part-circuit': 10 })
    assignRefining(model)
    model.advance(recipe.cycleMs / 60_000)
    expect(model.population.trip).toMatchObject({ phase: 'loading', progressMs: 0 })
    expect(model.populationView().residents).toBe(2)
  })
  it('产物超出库存上限时原子结算失败，不能先扣原料或发一半产物', () => {
    const model = refineryModel(), recipe = refiningRecipe('ore-veldspar', 0)!
    model.setInventory('ore-veldspar', recipe.batchUnits)
    model.setInventory('min-tritanium', Number.MAX_SAFE_INTEGER)
    assignRefining(model)
    const before = model.inventoryView()
    const snapshot = model.snapshot()
    expect(() => model.advance(recipe.cycleMs / 60_000)).toThrow('精炼产物超出库存')
    expect(model.inventoryView()).toEqual(before)
    expect(model.snapshot()).toBe(snapshot)
    expect(model.refining.runs[0]).toMatchObject({ batchesDone: 0, progressMs: 0, personIndex: 1 })
    model.setInventory('min-tritanium', 0)
    model.advance(recipe.cycleMs / 60_000)
    expect(model.refining.runs[0].batchesDone).toBe(1)
    expect(model.host.available('ore-veldspar')).toBe(0)
  })
})

const assignMining = (model: LabModel, personIndex = 1) => model.miningCommand({ kind: 'assign', personIndex, shipId: MINER_ID, beltId: 'belt-gas-phosphor' })
function miners() {
  const model = refineryModel()
  return model
}
function toReturn(model: LabModel) {
  for (let step = 0; step < 1000; step++) {
    const run = model.mining.runs[0]
    if (run.phase === 'returning') return
    model.advance((run.durationMs - run.progressMs) / 60_000)
  }
  throw new Error('合成采矿未在合理循环内返航')
}

describe('玩家站预览宿主：人类采矿与精炼闭环', () => {
  it('无课程居民可派矿船，富矿/满舱沿真实函数，原矿返航前不进仓', () => {
    const model = miners(), params = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    const before = model.inventoryView()
    expect(assignMining(model)).toEqual({ ok: true })
    expect(model.ships[1]).toMatchObject({ available: false, location: 'elsewhere' })
    model.advance((params.departureMs + params.cycleMs) / 60_000)
    expect(model.mining.runs[0].cargo['gas-phosphor']).toBeGreaterThan(0)
    expect(model.inventoryView()).toEqual(before)
    toReturn(model)
    const run = model.mining.runs[0], cargo = { ...run.cargo }
    model.advance((run.durationMs - 1) / 60_000)
    expect(model.host.available('gas-phosphor')).toBe(0)
    model.advance(1 / 60_000)
    expect(model.host.available('gas-phosphor')).toBe(cargo['gas-phosphor'])
    expect(model.mining.runs[0]).toMatchObject({ phase: 'departure', tripsDone: 1, cargo: {} })
    expect(model.training.qualifications[1]).toBeNull()
  })
  it('矿船被人口转运占用不抢船，采矿及返航中人口转运不抢船', () => {
    const model = miners()
    model.populationCommand({ kind: 'start', shipId: MINER_ID, count: 1 })
    expect(assignMining(model)).toEqual({ ok: false, reason: 'ship' })
    model.populationCommand({ kind: 'stop' })
    expect(assignMining(model)).toEqual({ ok: true })
    model.populationCommand({ kind: 'start', shipId: MINER_ID, count: 1 })
    expect(model.population.trip).toBeUndefined()
    expect(model.populationView().wait).toBe('ship')
    const p = model.mining.runs[0]; model.advance((p.durationMs + miningParams(MINER_ID, p.beltId, 0)!.cycleMs) / 60_000)
    model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(model.population.trip).toBeUndefined()
    const r = model.mining.runs[0]; model.advance(r.durationMs / 60_000)
    expect(model.mining.runs).toEqual([])
    expect(model.population.trip).toMatchObject({ shipId: MINER_ID, phase: 'loading', progressMs: 0 })
  })
  it('同一居民不能采矿兼精炼/受训/施工，停止返航完成后才释放', () => {
    const model = miners(); assignMining(model, 0)
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    expect(assignRefining(model, 0)).toEqual({ ok: false, reason: 'person' })
    const p = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    model.advance((p.departureMs + p.cycleMs) / 60_000)
    model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    model.advance(model.mining.runs[0].durationMs / 60_000)
    expect(model.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: true })
    expect(assignMining(model, 0)).toEqual({ ok: false, reason: 'person' })
  })
  it('卸货才触发精炼，刚到原矿不借用此前返航时间，下一批才产矿物', () => {
    const model = miners()
    model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 0, itemId: 'gas-phosphor' })
    assignMining(model)
    toReturn(model)
    const before = model.inventoryView(), run = model.mining.runs[0]
    model.advance(run.durationMs / 60_000)
    expect(model.refining.runs[0]).toMatchObject({ progressMs: 0, batchesDone: 0 })
    expect(model.host.available('gas-phosphor')).toBeGreaterThan(0)
    const recipe = refiningRecipe('gas-phosphor', 0)!
    model.advance(recipe.cycleMs / 60_000)
    expect(model.refining.runs[0].batchesDone).toBe(1)
    for (const [id, n] of Object.entries(refiningOutput('gas-phosphor', recipe.batchUnits, 0))) expect(model.host.available(id)).toBe((before[id] ?? 0) + n)
  })
  it('暂停采掘保人/船/工时，停电后停止仍能安全返航，不无限锁在野外', () => {
    const model = miners(), p = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    assignMining(model); model.advance((p.departureMs + p.cycleMs / 2) / 60_000)
    model.miningCommand({ kind: 'pause', shipId: MINER_ID }); model.advance(60)
    expect(model.mining.runs[0]).toMatchObject({ paused: true, progressMs: p.cycleMs / 2 })
    const snapshot = model.snapshot(), restored = importSnapshot(snapshot)
    expect(restored.snapshot()).toBe(snapshot)
    restored.command({ kind: 'toggle', cellIndex: 0 }); restored.miningCommand({ kind: 'stop', shipId: MINER_ID })
    restored.advance(restored.mining.runs[0].durationMs / 60_000)
    expect(restored.mining.runs).toEqual([]); expect(restored.ships[1]).toMatchObject({ available: true, location: 'home' })
  })
  it('原货物占舱且只在真实卸货时入库，离港前撤回不复制，禁止在途改技能', () => {
    const model = miners(); model.shipCargo[MINER_ID] = { 'min-tritanium': 10 }
    const before = model.host.available('min-tritanium'); assignMining(model)
    expect(model.mining.runs[0].cargo).toEqual({ 'min-tritanium': 10 })
    expect(() => model.setMiningLevel(5)).toThrow()
    model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(model.shipCargo[MINER_ID]).toEqual({ 'min-tritanium': 10 })
    expect(model.host.available('min-tritanium')).toBe(before)
    assignMining(model); const p = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    model.advance((p.departureMs + p.cycleMs) / 60_000); model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(model.host.available('min-tritanium')).toBe(before)
    model.advance(model.mining.runs[0].durationMs / 60_000)
    expect(model.host.available('min-tritanium')).toBe(before + 10)
    expect(model.shipCargo[MINER_ID]).toEqual({})
  })
  it('采矿/精炼/其他模块大步分步和随机状态一致，往返各阶段整体快照', () => {
    const large = miners(), small = importSnapshot(large.snapshot())
    for (const model of [large, small]) { assignMining(model); model.refiningCommand({ kind: 'assign', cellIndex: 3, personIndex: 0, itemId: 'gas-phosphor' }) }
    large.advance(30)
    for (let i = 0; i < 120; i++) { small.advance(0.25); expect(importSnapshot(small.snapshot()).snapshot()).toBe(small.snapshot()) }
    expect(small.snapshot()).toBe(large.snapshot())
  })
  it('拒绝缺采矿账、错误船只占用、重复货物/人员及伪造返航，旧v5不补原矿产物', () => {
    const model = miners(); assignMining(model)
    const p = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    model.advance((p.departureMs + p.cycleMs) / 60_000); model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(model.mining.runs[0].durationMs).toBe(miningReturnMs(model.mining.runs[0], 0))
    for (const mutate of [(f: any) => { delete f.mining }, (f: any) => { f.ships[1].available = true },
      (f: any) => { f.shipCargo[MINER_ID] = { 'gas-phosphor': 1 } }, (f: any) => { f.mining.runs[0].personIndex = 5 },
      (f: any) => { f.mining.runs[0].durationMs++ }, (f: any) => { f.mining.runs[0].cargo.unknown = 1 }]) {
      const bad = JSON.parse(model.snapshot()); mutate(bad); expect(() => importSnapshot(JSON.stringify(bad))).toThrow()
    }
    const old = JSON.parse(miners().snapshot()); old.version = 5; removeMiningFields(old)
    const restored = importSnapshot(JSON.stringify(old))
    expect(restored.mining.runs).toEqual([]); expect(restored.inventoryView()).toEqual(old.inventory)
    expect(restored.population.people).toEqual(old.population.people)
    expect(JSON.parse(restored.snapshot()).version).toBe(8)
  })
  it('到港卸货失败时五模块/库存/船货整体回滚，不丢货不早放人或重发', () => {
    const model = miners(), p = miningParams(MINER_ID, 'belt-gas-phosphor', 0)!
    assignMining(model); model.advance((p.departureMs + p.cycleMs) / 60_000)
    model.miningCommand({ kind: 'stop', shipId: MINER_ID })
    const run = model.mining.runs[0], cargo = run.cargo['gas-phosphor']
    model.setInventory('gas-phosphor', Number.MAX_SAFE_INTEGER)
    const before = model.snapshot()
    expect(() => model.advance(run.durationMs / 60_000)).toThrow('预览库存溢出')
    expect(model.snapshot()).toBe(before)
    expect(model.ships[1].available).toBe(false)
    model.setInventory('gas-phosphor', 0)
    model.advance(model.mining.runs[0].durationMs / 60_000)
    expect(model.host.available('gas-phosphor')).toBe(cargo)
    expect(model.mining.runs).toEqual([])
    expect(model.ships[1].available).toBe(true)
    model.advance(60); expect(model.host.available('gas-phosphor')).toBe(cargo)
  })
  it('读档后中途停止保留已走航程和原货物，未入库货不能同时留在船外账', () => {
    const model = miners(); assignMining(model); toReturn(model)
    model.advance(model.mining.runs[0].durationMs / 120_000)
    const restored = importSnapshot(model.snapshot()), before = structuredClone(restored.mining.runs[0])
    restored.miningCommand({ kind: 'stop', shipId: MINER_ID })
    expect(restored.mining.runs[0]).toMatchObject({ progressMs: before.progressMs, durationMs: before.durationMs, cargo: before.cargo })
    restored.advance((before.durationMs - before.progressMs) / 60_000)
    expect(restored.host.available('gas-phosphor')).toBe(before.cargo['gas-phosphor'])
    expect(restored.mining.runs).toEqual([])
    expect(model.mining.runs[0].stopping).toBe(false)
  })
})
