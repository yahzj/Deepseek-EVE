import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  advancePlayerStation, cleanPlayerStation, createPlayerStation, loadPlayerStation, PLAYER_FACILITIES,
  PLAYER_STATION_BODY_BILL, PLAYER_STATION_BODY_MS, playerStationBill, playerStationCommand,
  playerStationView, receivePlayerStationMaterials, reconcilePlayerStation, serializePlayerStation,
  takePlayerStationRecovery,
} from '../src/playerStation'
import type { PlayerStationBill, PlayerStationHost, PlayerStationState } from '../src/playerStation'

function world() {
  const state = createPlayerStation()
  let level = 0
  const inventory: Record<string, number> = {}
  let takes = 0, gives = 0
  const host: PlayerStationHost = {
    engineeringLevel: () => level, available: id => inventory[id] ?? 0, itemName: id => id,
    take: bill => {
      if (Object.entries(bill).some(([id, n]) => (inventory[id] ?? 0) < n)) return false
      for (const [id, n] of Object.entries(bill)) inventory[id] -= n
      takes += 1
      return true
    },
    give: bill => {
      gives += 1
      for (const [id, n] of Object.entries(bill)) inventory[id] = (inventory[id] ?? 0) + n
    },
  }
  const stock = (bill: PlayerStationBill) => { for (const [id, n] of Object.entries(bill)) inventory[id] = (inventory[id] ?? 0) + n }
  const approve = () => expect(playerStationCommand(state, host, { kind: 'approve' }).ok).toBe(true)
  const completeBody = () => {
    approve()
    receivePlayerStationMaterials(state, host, playerStationBill(host))
    advancePlayerStation(state, host, PLAYER_STATION_BODY_MS)
  }
  return { state, host, inventory, stock, approve, completeBody, setLevel: (n: number) => { level = n },
    counts: () => ({ takes, gives }) }
}

function poweredWorld() {
  const w = world()
  w.completeBody()
  w.stock(PLAYER_FACILITIES.power.bill)
  expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: true })
  advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.power.durationMs)
  return w
}

function loadedWorld() {
  const w = poweredWorld()
  for (const [facility, cellIndex] of [['power', 1], ['life-support', 2], ['life-support', 3], ['life-support', 4], ['service', 5]] as const) {
    w.stock(PLAYER_FACILITIES[facility].bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex })).toEqual({ ok: true })
  }
  advancePlayerStation(w.state, w.host, PLAYER_FACILITIES['life-support'].durationMs)
  expect(w.state.projects).toEqual([])
  expect(playerStationView(w.state, w.host).power).toMatchObject({ supply: 48, runningDemand: 20 })
  return w
}

describe('独立玩家站A批：工程与物料', () => {
  it('保留主体120分钟、发电45分钟、生命维持60分钟和服务30分钟的测试基准', () => {
    expect(PLAYER_STATION_BODY_MS).toBe(120 * 60_000)
    expect(PLAYER_FACILITIES.power.durationMs).toBe(45 * 60_000)
    expect(PLAYER_FACILITIES['life-support'].durationMs).toBe(60 * 60_000)
    expect(PLAYER_FACILITIES.service.durationMs).toBe(30 * 60_000)
  })

  it('未批准不收材料；批准本身不扣库存、不赠站体', () => {
    const w = world()
    expect(receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL)).toEqual({ accepted: {}, rejected: PLAYER_STATION_BODY_BILL })
    w.approve()
    expect(w.state.built).toBe(false)
    expect(w.state.cells).toEqual([])
    expect(w.counts()).toEqual({ takes: 0, gives: 0 })
    expect(playerStationCommand(w.state, w.host, { kind: 'approve' })).toEqual({ ok: false, reason: 'busy' })
  })

  it('多趟到货各项齐全才开工；不把运料时间当施工进度', () => {
    const w = world()
    w.approve()
    const partial = { ...PLAYER_STATION_BODY_BILL, 'part-lens': PLAYER_STATION_BODY_BILL['part-lens'] - 1 }
    receivePlayerStationMaterials(w.state, w.host, partial)
    advancePlayerStation(w.state, w.host, 3600_000)
    expect(w.state.project).toBeUndefined()
    receivePlayerStationMaterials(w.state, w.host, { 'part-lens': 2, 'unrelated-item': 7 })
    expect(w.state.project?.progressMs).toBe(0)
    expect(w.state.project?.spent).toEqual(PLAYER_STATION_BODY_BILL)
    expect(w.state.bodyMaterials).toEqual({})
    expect(w.state.built).toBe(false)
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS - 1)
    expect(w.state.built).toBe(false)
    advancePlayerStation(w.state, w.host, 1)
    expect(w.state.built).toBe(true)
    expect(w.state.project).toBeUndefined()
    expect(w.state.cells).toEqual([])
  })

  it('运输中技能升级立即减少未开工需量；开工后锁料不追溯', () => {
    const w = world()
    w.approve()
    const partial = Object.fromEntries(Object.entries(PLAYER_STATION_BODY_BILL).map(([id, n]) => [id, n * 7 / 10]))
    receivePlayerStationMaterials(w.state, w.host, partial)
    expect(w.state.project).toBeUndefined()
    w.setLevel(5)
    reconcilePlayerStation(w.state, w.host)
    const locked = structuredClone(w.state.project!.spent)
    expect(locked).toEqual(playerStationBill(w.host))
    expect(w.state.project!.progressMs).toBe(0)
    w.setLevel(0)
    reconcilePlayerStation(w.state, w.host)
    expect(w.state.project!.spent).toEqual(locked)
    expect(receivePlayerStationMaterials(w.state, w.host, { 'part-lens': 900 })).toEqual({ accepted: {}, rejected: { 'part-lens': 900 } })
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS)
    for (const [id, n] of Object.entries(PLAYER_STATION_BODY_BILL)) expect(w.inventory[id]).toBe(n / 10)
    expect(w.counts().gives).toBe(1)
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS)
    expect(w.counts().gives).toBe(1)
  })

  it('主动暂停不因满料或升技能自行重启，恢复前不计时', () => {
    const w = world()
    w.approve()
    playerStationCommand(w.state, w.host, { kind: 'pause' })
    receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL)
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS)
    expect(w.state.project).toBeUndefined()
    playerStationCommand(w.state, w.host, { kind: 'resume' })
    advancePlayerStation(w.state, w.host, 1000)
    playerStationCommand(w.state, w.host, { kind: 'pause' })
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS)
    expect(w.state.project!.progressMs).toBe(1000)
    playerStationCommand(w.state, w.host, { kind: 'resume' })
    expect(w.state.project!.progressMs).toBe(1000)
  })

  it('主体取消材料只留现场；重复取消/回收/重开不生成物资', () => {
    const w = world()
    w.approve()
    receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL)
    advancePlayerStation(w.state, w.host, PLAYER_STATION_BODY_MS * 2 / 5)
    expect(playerStationCommand(w.state, w.host, { kind: 'cancel' }).ok).toBe(true)
    const recover = structuredClone(w.state.recoveryMaterials)
    for (const [id, n] of Object.entries(PLAYER_STATION_BODY_BILL)) expect(recover[id]).toBe(n * .6)
    expect(w.counts().gives).toBe(0)
    expect(playerStationCommand(w.state, w.host, { kind: 'cancel' })).toEqual({ ok: false, reason: 'no-project' })
    w.approve()
    reconcilePlayerStation(w.state, w.host)
    expect(w.state.project).toBeUndefined()
    expect(w.state.recoveryMaterials).toEqual(recover)
    const one = takePlayerStationRecovery(w.state, { 'part-frame': 1 })
    expect(one).toEqual({ 'part-frame': 1 })
    expect(w.state.recoveryMaterials['part-frame']).toBe(recover['part-frame'] - 1)
    const rest = takePlayerStationRecovery(w.state, recover)
    expect(rest['part-frame'] + one['part-frame']).toBe(recover['part-frame'])
    expect(takePlayerStationRecovery(w.state, recover)).toEqual({})
  })

  it('取消备料期也必须回收，未确认的材料不能直接进入新项目', () => {
    const w = world()
    w.approve()
    receivePlayerStationMaterials(w.state, w.host, { 'part-frame': 50 })
    playerStationCommand(w.state, w.host, { kind: 'cancel' })
    expect(w.state.bodyMaterials).toEqual({})
    expect(w.state.recoveryMaterials).toEqual({ 'part-frame': 50 })
    w.approve()
    expect(playerStationView(w.state, w.host).bill.find(r => r.itemId === 'part-frame')?.delivered).toBe(0)
  })

  it('多次取消的不同批现场材料可以累计，快照不误判为超额', () => {
    const w = world()
    for (let i = 0; i < 3; i++) {
      w.approve()
      receivePlayerStationMaterials(w.state, w.host, { 'part-frame': PLAYER_STATION_BODY_BILL['part-frame'] })
      playerStationCommand(w.state, w.host, { kind: 'cancel' })
    }
    expect(w.state.recoveryMaterials['part-frame']).toBe(PLAYER_STATION_BODY_BILL['part-frame'] * 3)
    expect(loadPlayerStation(serializePlayerStation(w.state))).toEqual(w.state)
  })

  it('到货拒收未知物品且不污染对象原型', () => {
    const w = world()
    w.approve()
    const incoming = JSON.parse('{"__proto__":2,"toString":3,"part-frame":1}')
    const result = receivePlayerStationMaterials(w.state, w.host, incoming)
    expect(result.accepted).toEqual({ 'part-frame': 1 })
    expect(Object.hasOwn(result.rejected, '__proto__')).toBe(true)
    expect(result.rejected.toString).toBe(3)
    expect(Object.getPrototypeOf(result.rejected)).toBe(Object.prototype)
  })

  it('设施扣料原子；首座发电独占零电启动能力，重复点击不丢料', () => {
    const w = world()
    w.completeBody()
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: false, reason: 'materials' })
    expect(w.inventory).toEqual({})
    w.stock(PLAYER_FACILITIES.power.bill)
    w.stock(PLAYER_FACILITIES.power.bill)
    expect(playerStationView(w.state, w.host).facilityOptions.power.constructionPower).toBe(0)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 }).ok).toBe(true)
    expect(w.state.project).toBeUndefined()
    expect(w.state.projects).toHaveLength(1)
    expect(w.state.projects[0]).toMatchObject({ kind: 'power', cellIndex: 0, startup: true })
    const before = structuredClone(w.state), inventory = { ...w.inventory }
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: false, reason: 'invalid-cell' })
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 1 })).toEqual({ ok: false, reason: 'power' })
    expect(w.state).toEqual(before)
    expect(w.inventory).toEqual(inventory)
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 0, runningDemand: 0,
      constructionDemand: 0, constructionRequested: 0, demand: 0, populationCapacity: 0 })
    expect(playerStationView(w.state, w.host).facilityOptions.power).toMatchObject({ constructionPower: 4, canBuild: false, reason: 'power' })
    expect(playerStationCommand(w.state, w.host, { kind: 'pause', cellIndex: 0 })).toEqual({ ok: true })
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 1 })).toEqual({ ok: false, reason: 'power' })
    expect(playerStationCommand(w.state, w.host, { kind: 'resume', cellIndex: 0 })).toEqual({ ok: true })
    expect(w.counts().takes).toBe(1)
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.power.durationMs)
    expect(w.state.cells).toEqual([{ kind: 'power', cellIndex: 0, enabled: true }])
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: false, reason: 'invalid-cell' })
  })

  it('首座发电无人启动；后续设施缺电保进度，暂停不累计', () => {
    const w = world()
    w.completeBody()
    for (const kind of ['power', 'life-support', 'service'] as const) w.stock(PLAYER_FACILITIES[kind].bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'life-support', cellIndex: 1 })).toEqual({ ok: false, reason: 'power' })
    playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.power.durationMs)
    playerStationCommand(w.state, w.host, { kind: 'build', facility: 'life-support', cellIndex: 1 })
    advancePlayerStation(w.state, w.host, 1000)
    playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 0 })
    expect(playerStationView(w.state, w.host).projects[0]).toMatchObject({ cellIndex: 1, blocked: true })
    advancePlayerStation(w.state, w.host, 1000_000)
    expect(w.state.projects[0].progressMs).toBe(1000)
    playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 0 })
    expect(playerStationCommand(w.state, w.host, { kind: 'pause', cellIndex: 1 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 1000)
    expect(w.state.projects[0].progressMs).toBe(1000)
    expect(playerStationCommand(w.state, w.host, { kind: 'resume', cellIndex: 1 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES['life-support'].durationMs - 1000)
    playerStationCommand(w.state, w.host, { kind: 'build', facility: 'service', cellIndex: 2 })
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.service.durationMs)
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 24, runningDemand: 8,
      constructionDemand: 0, constructionRequested: 0, demand: 8, populationCapacity: 6 })
  })

  it('并网后取消设施退回原投入未使用部分，不按新技能退款', () => {
    const w = world()
    w.completeBody()
    w.stock(PLAYER_FACILITIES.power.bill)
    playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.power.durationMs / 3)
    w.setLevel(5)
    expect(playerStationCommand(w.state, w.host, { kind: 'cancel', cellIndex: 0 })).toEqual({ ok: true })
    for (const [id, n] of Object.entries(PLAYER_FACILITIES.power.bill)) expect(w.inventory[id]).toBe(Math.floor(n * 2 / 3))
    expect(w.state.cells).toEqual([])
    expect(w.counts().gives).toBe(1)
  })

  it('大步与分步推进结果一致，视图读取不触发开工/扣料', () => {
    const a = world(), b = world()
    for (const w of [a, b]) { w.approve(); receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL) }
    const before = structuredClone(a.state)
    playerStationView(a.state, a.host)
    expect(a.state).toEqual(before)
    advancePlayerStation(a.state, a.host, PLAYER_STATION_BODY_MS + 1000)
    for (let i = 0; i < 121; i++) advancePlayerStation(b.state, b.host, i === 120 ? 1000 : 60_000)
    expect(a.state).toEqual(b.state)
  })

  it('技能事件先推进旧时间再变级，现场足量才开工，不补算等待', () => {
    const w = world()
    w.approve()
    const arrived = Object.fromEntries(Object.entries(PLAYER_STATION_BODY_BILL).map(([id, n]) => [id, n * 4 / 5]))
    receivePlayerStationMaterials(w.state, w.host, arrived)
    advancePlayerStation(w.state, w.host, 30_000)
    expect(w.state.project).toBeUndefined()
    w.setLevel(3)
    reconcilePlayerStation(w.state, w.host)
    expect(w.state.project!.progressMs).toBe(0)
    advancePlayerStation(w.state, w.host, 5000)
    expect(w.state.project!.progressMs).toBe(5000)
    expect(w.state.clockMs).toBe(35_000)
  })

  it('六档工程学和多组有效进度的取消/回收数量守恒', () => {
    for (let level = 0; level <= 5; level++) for (const progress of [0, 1, 1 / 3, 17, 499, 999]) {
      const w = world()
      w.setLevel(level)
      const needed = playerStationBill(w.host)
      w.approve()
      receivePlayerStationMaterials(w.state, w.host, needed)
      const elapsed = Math.floor(PLAYER_STATION_BODY_MS * progress / 1000)
      advancePlayerStation(w.state, w.host, elapsed)
      playerStationCommand(w.state, w.host, { kind: 'cancel' })
      for (const [id, n] of Object.entries(needed)) {
        const expected = Number(BigInt(n) * BigInt(PLAYER_STATION_BODY_MS - elapsed) / BigInt(PLAYER_STATION_BODY_MS))
        expect(w.state.recoveryMaterials[id] ?? 0).toBe(expected)
        expect((n - expected) + expected).toBe(n)
      }
      expect(loadPlayerStation(serializePlayerStation(w.state))).toEqual(w.state)
    }
  })

  it('读视图不会开放设施；非法到货/回收整项拒绝不改前半单', () => {
    const w = world()
    w.approve()
    const before = structuredClone(w.state)
    expect(() => receivePlayerStationMaterials(w.state, w.host, { 'part-frame': 5, 'part-lens': .5 })).toThrow()
    expect(w.state).toEqual(before)
    expect(() => takePlayerStationRecovery(w.state, { 'part-frame': 1, 'part-lens': -1 })).toThrow()
    expect(w.state).toEqual(before)
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 0, runningDemand: 0,
      constructionDemand: 0, constructionRequested: 0, demand: 0, populationCapacity: 0 })
  })

  it('展示对象不泄露工程账与设施的可写引用', () => {
    const w = world()
    w.completeBody()
    w.stock(PLAYER_FACILITIES.power.bill)
    playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })
    const view = playerStationView(w.state, w.host)
    expect(view.project).toBeUndefined()
    expect(view).not.toHaveProperty('projectBlocked')
    view.projects[0].spent['part-frame'] = 1
    view.projects[0].paused = true
    view.projects[0].blocked = true
    expect(w.state.projects[0].spent['part-frame']).toBe(2000)
    expect(w.state.projects[0].paused).toBe(false)
    expect(w.state.projects[0]).not.toHaveProperty('blocked')
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.power.durationMs)
    const built = playerStationView(w.state, w.host)
    built.cells[0].enabled = false
    expect(w.state.cells[0].enabled).toBe(true)
  })

  it.each([NaN, Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1])('非法时间%s不改变状态', delta => {
    const w = world(), before = structuredClone(w.state)
    expect(() => advancePlayerStation(w.state, w.host, delta)).toThrow()
    expect(w.state).toEqual(before)
  })
})

describe('多地块并行施工与分电边界', () => {
  it('跨格两项按开工顺序保存，各扣一单、各计工时；同格拒绝不扣料', () => {
    const w = poweredWorld()
    for (const facility of ['life-support', 'service'] as const) w.stock(PLAYER_FACILITIES[facility].bill)
    const inventory = { ...w.inventory }
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'life-support', cellIndex: 7 })).toEqual({ ok: true })
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'service', cellIndex: 2 })).toEqual({ ok: true })
    expect(w.state.project).toBeUndefined()
    expect(w.state.projects.map(p => [p.kind, p.cellIndex, p.progressMs])).toEqual([['life-support', 7, 0], ['service', 2, 0]])
    for (const [id, n] of Object.entries(inventory)) {
      expect(w.inventory[id]).toBe(n - (PLAYER_FACILITIES['life-support'].bill[id] ?? 0) - (PLAYER_FACILITIES.service.bill[id] ?? 0))
    }
    const before = structuredClone(w.state), afterTake = { ...w.inventory }
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 7 })).toEqual({ ok: false, reason: 'invalid-cell' })
    expect(w.state).toEqual(before)
    expect(w.inventory).toEqual(afterTake)
    expect(w.counts()).toEqual({ takes: 3, gives: 0 })
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 24, runningDemand: 0,
      constructionDemand: 8, constructionRequested: 8, demand: 8, populationCapacity: 0 })
    advancePlayerStation(w.state, w.host, PLAYER_FACILITIES.service.durationMs - 1)
    expect(w.state.projects.map(p => p.progressMs)).toEqual([30 * 60_000 - 1, 30 * 60_000 - 1])
    advancePlayerStation(w.state, w.host, 1)
    expect(w.state.projects).toHaveLength(1)
    expect(w.state.projects[0]).toMatchObject({ kind: 'life-support', cellIndex: 7, progressMs: 30 * 60_000 })
    expect(w.state.cells).toContainEqual({ kind: 'service', cellIndex: 2, enabled: true })
    advancePlayerStation(w.state, w.host, 30 * 60_000)
    expect(w.state.projects).toEqual([])
    expect(w.state.cells).toContainEqual({ kind: 'life-support', cellIndex: 7, enabled: true })
  })

  it.each(['pause', 'resume', 'cancel'] as const)('设施%s必须逐格指定；主体不接受cellIndex', kind => {
    const body = world()
    body.approve()
    receivePlayerStationMaterials(body.state, body.host, PLAYER_STATION_BODY_BILL)
    const bodyBefore = structuredClone(body.state)
    expect(playerStationCommand(body.state, body.host, { kind, cellIndex: 0 })).toEqual({ ok: false, reason: 'no-project' })
    expect(body.state).toEqual(bodyBefore)
    expect(playerStationCommand(body.state, body.host, { kind })).toEqual({ ok: true })

    const w = poweredWorld()
    for (const [facility, cellIndex] of [['life-support', 7], ['service', 2]] as const) {
      w.stock(PLAYER_FACILITIES[facility].bill)
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex })).toEqual({ ok: true })
    }
    const before = structuredClone(w.state), inventory = { ...w.inventory }, counts = w.counts()
    expect(playerStationCommand(w.state, w.host, { kind })).toEqual({ ok: false, reason: 'no-project' })
    expect(playerStationCommand(w.state, w.host, { kind, cellIndex: 8 })).toEqual({ ok: false, reason: 'no-project' })
    expect(w.state).toEqual(before)
    expect(w.inventory).toEqual(inventory)
    expect(w.counts()).toEqual(counts)
  })

  it('逐格暂停、恢复和取消只影响目标，退款分别按锁定料单及各自工时计算', () => {
    const w = poweredWorld()
    w.stock(PLAYER_FACILITIES['life-support'].bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'life-support', cellIndex: 7 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 15 * 60_000)
    expect(playerStationCommand(w.state, w.host, { kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    w.setLevel(5)
    w.stock(playerStationBill(w.host, PLAYER_FACILITIES.service.bill))
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'service', cellIndex: 2 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 15 * 60_000)
    expect(w.state.projects.map(p => [p.cellIndex, p.progressMs, p.paused])).toEqual([[7, 15 * 60_000, true], [2, 15 * 60_000, false]])
    expect(playerStationView(w.state, w.host).power).toMatchObject({ constructionDemand: 4, constructionRequested: 4 })
    expect(playerStationCommand(w.state, w.host, { kind: 'resume', cellIndex: 7 })).toEqual({ ok: true })
    expect(w.state.projects[1].paused).toBe(false)
    expect(playerStationView(w.state, w.host).power).toMatchObject({ constructionDemand: 8, constructionRequested: 8 })
    w.setLevel(2)
    for (const cellIndex of [7, 2]) {
      const project = structuredClone(w.state.projects.find(p => p.cellIndex === cellIndex)!)
      const others = structuredClone(w.state.projects.filter(p => p.cellIndex !== cellIndex))
      const inventory = { ...w.inventory }, gives = w.counts().gives
      expect(playerStationCommand(w.state, w.host, { kind: 'cancel', cellIndex })).toEqual({ ok: true })
      for (const [id, n] of Object.entries(project.spent)) {
        const refund = Number(BigInt(n) * BigInt(project.durationMs - project.progressMs) / BigInt(project.durationMs))
        expect(w.inventory[id]).toBe((inventory[id] ?? 0) + refund)
      }
      expect(w.state.projects).toEqual(others)
      expect(w.counts().gives).toBe(gives + 1)
      expect(playerStationCommand(w.state, w.host, { kind: 'cancel', cellIndex })).toEqual({ ok: false, reason: 'no-project' })
      expect(w.counts().gives).toBe(gives + 1)
    }
    expect(w.state.recoveryMaterials).toEqual({})
    expect(w.counts().takes).toBe(3)
  })

  it('施工每项累加4电；运行优先、余电不足拒绝新工程且不扣料', () => {
    const w = loadedWorld()
    for (const [facility, cellIndex] of [['life-support', 7], ['service', 6]] as const) {
      w.stock(PLAYER_FACILITIES[facility].bill)
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex })).toEqual({ ok: true })
    }
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 48, runningDemand: 20,
      constructionDemand: 8, constructionRequested: 8, demand: 28, populationCapacity: 18 })
    expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 1 })).toEqual({ ok: true })
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 24, runningDemand: 20,
      constructionDemand: 4, constructionRequested: 8, demand: 24, populationCapacity: 18 })
    expect(playerStationView(w.state, w.host).projects.map(p => [p.cellIndex, p.blocked])).toEqual([[7, false], [6, true]])
    w.stock(PLAYER_FACILITIES.service.bill)
    const before = structuredClone(w.state), inventory = { ...w.inventory }, counts = w.counts()
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'service', cellIndex: 8 })).toEqual({ ok: false, reason: 'power' })
    expect(w.state).toEqual(before)
    expect(w.inventory).toEqual(inventory)
    expect(w.counts()).toEqual(counts)
    advancePlayerStation(w.state, w.host, 1000)
    expect(w.state.projects.map(p => p.progressMs)).toEqual([1000, 0])
    expect(playerStationCommand(w.state, w.host, { kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    expect(playerStationView(w.state, w.host).projects.map(p => [p.cellIndex, p.blocked])).toEqual([[7, false], [6, false]])
    expect(playerStationView(w.state, w.host).power).toMatchObject({ constructionDemand: 4, constructionRequested: 4 })
    advancePlayerStation(w.state, w.host, 1000)
    expect(w.state.projects.map(p => p.progressMs)).toEqual([1000, 1000])
    expect(playerStationCommand(w.state, w.host, { kind: 'resume', cellIndex: 7 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 1000)
    expect(w.state.projects.map(p => p.progressMs)).toEqual([2000, 1000])
  })

  it('先完工的设施立即占运行负荷，较晚工程在同一大步剩余时间内阻塞', () => {
    const w = loadedWorld()
    for (const [facility, cellIndex] of [['service', 7], ['life-support', 6]] as const) {
      w.stock(PLAYER_FACILITIES[facility].bill)
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex })).toEqual({ ok: true })
    }
    expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 1 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 60 * 60_000)
    expect(w.state.cells).toContainEqual({ kind: 'service', cellIndex: 7, enabled: true })
    expect(w.state.projects).toHaveLength(1)
    expect(w.state.projects[0]).toMatchObject({ cellIndex: 6, progressMs: 0 })
    expect(playerStationView(w.state, w.host).projects[0].blocked).toBe(true)
    expect(playerStationView(w.state, w.host).power).toEqual({ supply: 24, runningDemand: 22,
      constructionDemand: 0, constructionRequested: 4, demand: 22, populationCapacity: 18 })
    expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 1 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 60 * 60_000)
    expect(w.state.projects).toEqual([])
  })

  it.each(['新增运行负荷', '新增供电'] as const)('跨完工边界%s的大步与分步推进一致', scenario => {
    const a = loadedWorld(), b = loadedWorld()
    for (const w of [a, b]) {
      const facility = scenario === '新增供电' ? 'power' : 'service'
      w.stock(PLAYER_FACILITIES[facility].bill)
      w.stock(PLAYER_FACILITIES['life-support'].bill)
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex: 7 })).toEqual({ ok: true })
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'life-support', cellIndex: 6 })).toEqual({ ok: true })
      expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 1 })).toEqual({ ok: true })
    }
    advancePlayerStation(a.state, a.host, 105 * 60_000 + 1)
    for (const step of [30 * 60_000 - 1, 1, 15 * 60_000, 1, 60 * 60_000 - 1, 1]) advancePlayerStation(b.state, b.host, step)
    expect(a.state).toEqual(b.state)
    expect(a.inventory).toEqual(b.inventory)
    expect(a.counts()).toEqual(b.counts())
    expect(playerStationView(a.state, a.host)).toEqual(playerStationView(b.state, b.host))
    if (scenario === '新增供电') {
      expect(a.state.projects).toEqual([])
      expect(a.state.cells).toContainEqual({ kind: 'life-support', cellIndex: 6, enabled: true })
    } else {
      expect(a.state.projects).toHaveLength(1)
      expect(a.state.projects[0]).toMatchObject({ cellIndex: 6, progressMs: 0 })
    }
  })
})

describe('独立模块快照与依赖边界', () => {
  it('独立格式往返保留工程、暂停与物料，拒绝正式游戏存档', () => {
    const w = world()
    w.approve()
    receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL)
    advancePlayerStation(w.state, w.host, 1234)
    playerStationCommand(w.state, w.host, { kind: 'pause' })
    const back = loadPlayerStation(serializePlayerStation(w.state))
    expect(back).toEqual(w.state)
    expect(loadPlayerStation(serializePlayerStation(back))).toEqual(back)
    expect(() => loadPlayerStation('{"format":"whale-idle-save","version":31,"state":{}}')).toThrow()
  })

  it('v3快照往返保留多工程顺序、独立进度、暂停和缺电状态', () => {
    const w = loadedWorld()
    for (const [facility, cellIndex] of [['life-support', 7], ['service', 6]] as const) {
      w.stock(PLAYER_FACILITIES[facility].bill)
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility, cellIndex })).toEqual({ ok: true })
    }
    advancePlayerStation(w.state, w.host, 1234)
    expect(playerStationCommand(w.state, w.host, { kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 5678)
    for (const cellIndex of [0, 1]) expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex })).toEqual({ ok: true })
    const text = serializePlayerStation(w.state), file = JSON.parse(text)
    expect(file).toMatchObject({ format: 'whale-player-station-lab', version: 3, state: { runtimeVersion: 3 } })
    const back = loadPlayerStation(text)
    expect(back).toEqual(w.state)
    expect(back.project).toBeUndefined()
    expect(back.projects.map(p => [p.cellIndex, p.progressMs, p.paused])).toEqual([[7, 1234, true], [6, 6912, false]])
    expect(playerStationView(back, w.host).projects.map(p => p.blocked)).toEqual([false, true])
    expect(serializePlayerStation(back)).toBe(text)
    back.projects[0].spent['part-frame'] = 1
    expect(w.state.projects[0].spent['part-frame']).toBe(3000)
  })

  it('v2拒读工程重复地块、与完工设施重叠、设施旧字段以及缺失projects', () => {
    const w = poweredWorld()
    w.stock(PLAYER_FACILITIES.service.bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'service', cellIndex: 2 })).toEqual({ ok: true })
    for (const mutate of [
      (s: PlayerStationState) => { s.projects.push(structuredClone(s.projects[0])) },
      (s: PlayerStationState) => { s.projects[0].cellIndex = 0 },
      (s: PlayerStationState) => { s.project = s.projects[0]; s.projects = [] },
      (s: PlayerStationState) => { Reflect.deleteProperty(s, 'projects') },
    ]) {
      const bad = structuredClone(w.state)
      mutate(bad)
      expect(() => cleanPlayerStation(bad)).toThrow()
      expect(() => loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 2, state: bad }))).toThrow()
    }
  })

  it('v2拒读两项startup、首电源未标startup及已有电源仍标startup', () => {
    const w = world()
    w.completeBody()
    w.stock(PLAYER_FACILITIES.power.bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 0 })).toEqual({ ok: true })
    expect(loadPlayerStation(serializePlayerStation(w.state))).toEqual(w.state)
    for (const mutate of [
      (s: PlayerStationState) => { s.projects.push({ ...structuredClone(s.projects[0]), cellIndex: 1 }) },
      (s: PlayerStationState) => { delete s.projects[0].startup },
      (s: PlayerStationState) => { s.cells.push({ kind: 'power', cellIndex: 1, enabled: false }) },
    ]) {
      const bad = structuredClone(w.state)
      mutate(bad)
      expect(() => cleanPlayerStation(bad)).toThrow()
      expect(() => loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 2, state: bad }))).toThrow()
    }
  })

  it.each(['body', 'power', 'life-support', 'service'] as const)('v1单工程%s经load迁移；材料、暂停和有效工时原样保留', kind => {
    const w = kind === 'body' || kind === 'power' ? world() : poweredWorld()
    w.setLevel(3)
    if (kind === 'body') {
      w.approve()
      receivePlayerStationMaterials(w.state, w.host, playerStationBill(w.host))
    } else {
      if (kind === 'power') w.completeBody()
      w.stock(playerStationBill(w.host, PLAYER_FACILITIES[kind].bill))
      expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: kind, cellIndex: 7 })).toEqual({ ok: true })
    }
    advancePlayerStation(w.state, w.host, 12345)
    expect(playerStationCommand(w.state, w.host, kind === 'body' ? { kind: 'pause' } : { kind: 'pause', cellIndex: 7 })).toEqual({ ok: true })
    const expected = structuredClone(w.state)
    const legacy: Record<string, unknown> = { ...structuredClone(w.state), runtimeVersion: 1 }
    const oldProject = structuredClone(kind === 'body' ? w.state.project! : w.state.projects[0])
    delete oldProject.startup
    legacy.project = oldProject
    delete legacy.projects
    expect(() => cleanPlayerStation(legacy)).toThrow()
    expect(() => loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 2, state: legacy }))).toThrow()
    const migrated = loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 1, state: legacy }))
    expect(migrated).toEqual(expected)
    expect(migrated.runtimeVersion).toBe(3)
    expect(migrated.clockMs).toBe(w.state.clockMs)
    if (kind === 'body') {
      expect(migrated.project).toEqual(oldProject)
      expect(migrated.projects).toEqual([])
    } else {
      expect(migrated.project).toBeUndefined()
      expect(migrated.projects).toEqual([{ ...oldProject, ...(kind === 'power' ? { startup: true } : {}) }])
    }
    expect(loadPlayerStation(serializePlayerStation(migrated))).toEqual(expected)
  })

  it('v1后续发电工程在已有停用电源时迁移不授予startup', () => {
    const w = poweredWorld()
    w.stock(PLAYER_FACILITIES.power.bill)
    expect(playerStationCommand(w.state, w.host, { kind: 'build', facility: 'power', cellIndex: 7 })).toEqual({ ok: true })
    advancePlayerStation(w.state, w.host, 4321)
    expect(playerStationCommand(w.state, w.host, { kind: 'toggle', cellIndex: 0 })).toEqual({ ok: true })
    const legacy: Record<string, unknown> = { ...structuredClone(w.state), runtimeVersion: 1, project: structuredClone(w.state.projects[0]) }
    delete legacy.projects
    const back = loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 1, state: legacy }))
    expect(back).toEqual(w.state)
    expect(back.projects[0]).not.toHaveProperty('startup')
    expect(playerStationView(back, w.host).projects[0].blocked).toBe(true)
  })

  it('所有模块状态键都有快照处理，未知字段不透传', () => {
    const state = createPlayerStation()
    const expected: Record<keyof PlayerStationState, true> = { runtimeVersion: true, clockMs: true, built: true,
      bodyApproved: true, bodyPaused: true, bodyMaterials: true, recoveryMaterials: true, cells: true, project: true, projects: true }
    expect(Object.keys(cleanPlayerStation({ ...state, garbage: true })).sort()).toEqual(Object.keys(expected).filter(k => k !== 'project').sort())
    expect(serializePlayerStation(state)).not.toContain('garbage')
  })

  it('结构错误和不完整材料账拒绝，不静默丢弃已投材料', () => {
    const w = world()
    w.approve()
    receivePlayerStationMaterials(w.state, w.host, PLAYER_STATION_BODY_BILL)
    for (const mutate of [
      (s: PlayerStationState) => { s.runtimeVersion = 99 as 3 },
      (s: PlayerStationState) => { delete s.project!.spent['part-lens'] },
      (s: PlayerStationState) => { s.project!.progressMs = Infinity },
      (s: PlayerStationState) => { s.cells.push({ kind: 'power', cellIndex: 0, enabled: true }) },
    ]) {
      const bad = structuredClone(w.state)
      mutate(bad)
      expect(() => cleanPlayerStation(bad)).toThrow()
    }
  })

  it('玩家站通过正式宿主接入，开发预览不成为游戏依赖', () => {
    const root = new URL('../../../', import.meta.url)
    for (const file of ['packages/core/src/state.ts', 'packages/core/src/engine.ts', 'packages/core/src/save.ts',
      'apps/desktop/src/renderer/src/App.tsx']) {
      const text = readFileSync(new URL(file, root), 'utf8')
      expect(text).not.toMatch(/tools\/player-station-lab|LabModel|StageTwoSession|SECURITY_SHIPS/)
    }
    expect(readFileSync(new URL('packages/core/src/state.ts', root), 'utf8')).toContain('CURRENT_STATE_VERSION = 32')
    expect(readFileSync(new URL('packages/core/src/engine.ts', root), 'utf8')).toContain('advancePlayerStationGame')
    for (const file of ['types.ts', 'rules.ts', 'runtime.ts', 'save.ts', 'index.ts']) {
      expect(readFileSync(new URL(`packages/core/src/playerStation/${file}`, root), 'utf8')).not.toMatch(/from ['"]\.\.\/|GameState|SimContext/)
    }
  })
})
