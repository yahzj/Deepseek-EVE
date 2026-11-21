import { describe, expect, it } from 'vitest'
import { advanceStationPopulation, cleanStationPopulation, createStationPopulation, POPULATION_REVIVAL_BILL,
  reconcileStationPopulation, stationPopulationCommand, stationPopulationView } from '../src/playerStation/index'
import type { PopulationHost } from '../src/playerStation/index'

const MIN = 60_000
function world() {
  const state = createStationPopulation()
  const inventory = Object.fromEntries(Object.entries(POPULATION_REVIVAL_BILL).map(([id, n]) => [id, n * 6]))
  const ship = { available: true, auxiliary: true, location: 'home' as 'home' | 'source' | 'elsewhere', freeM3: 600 }
  let ready = true, capacity = 6, known = true, claims = 0, releases = 0
  const host: PopulationHost = {
    sourceKnown: () => known, reception: () => ({ ready, capacity }), ship: id => id === 'ship' ? ship : undefined,
    claimShip: () => { if (!ship.available) return false; ship.available = false; claims++; return true },
    releaseShip: (_id, location) => { ship.available = true; ship.location = location; releases++ },
    available: id => inventory[id] ?? 0,
    take: bill => { if (Object.entries(bill).some(([id, n]) => (inventory[id] ?? 0) < n)) return false; for (const [id, n] of Object.entries(bill)) inventory[id] -= n; return true },
    give: bill => { for (const [id, n] of Object.entries(bill)) inventory[id] = (inventory[id] ?? 0) + n },
  }
  return { state, host, inventory, ship, start: (count = 1) => stationPopulationCommand(state, host, { kind: 'start', shipId: 'ship', count }),
    stop: () => stationPopulationCommand(state, host, { kind: 'stop' }), advance: (minutes: number) => advanceStationPopulation(state, host, minutes * MIN),
    view: () => stationPopulationView(state, host), setReady: (value: boolean) => { ready = value; reconcileStationPopulation(state, host) },
    setCapacity: (value: number) => { capacity = value }, setKnown: (value: boolean) => { known = value }, getClaims: () => claims, getReleases: () => releases }
}
function conserved(w: ReturnType<typeof world>) {
  expect(w.state.people).toHaveLength(6)
  const view = w.view()
  expect(view.dormant + view.reserved + view.residents).toBe(6)
  expect(cleanStationPopulation(w.state)).toEqual(w.state)
}

describe('独立玩家站：复苏、运力与逐单位人口账', () => {
  it('首人18分钟，仅完成接收后才成为居民', () => {
    const w = world()
    expect(w.start()).toEqual({ ok: true })
    w.advance(3)
    expect(w.view()).toMatchObject({ dormant: 5, reserved: 1, residents: 0 })
    w.advance(10)
    expect(w.state.people[0].status).toBe('waiting')
    w.advance(4.999)
    expect(w.view().residents).toBe(0)
    w.advance(0.001)
    expect(w.view()).toMatchObject({ residents: 1, reserved: 0, dormant: 5 })
    expect(w.ship).toMatchObject({ available: true, location: 'home' })
    expect(w.getClaims()).toBe(w.getReleases())
    conserved(w)
  })
  it('首趟限一人，剩余五人一趟66分钟，合计84分钟', () => {
    const w = world()
    w.start(6)
    expect(w.state.trip?.slots).toBe(1)
    w.advance(18)
    expect(w.state.trip?.slots).toBe(5)
    w.advance(65)
    expect(w.view().residents).toBe(5)
    w.advance(1)
    expect(w.view()).toMatchObject({ residents: 6, dormant: 0, reserved: 0 })
    expect(w.state.plan).toBeUndefined()
    expect(w.inventory).toEqual(Object.fromEntries(Object.keys(POPULATION_REVIVAL_BILL).map(id => [id, 0])))
    conserved(w)
  })
  it('排队不占名额，逐单位开始才消费来源和本单位耗材', () => {
    const w = world()
    w.setReady(false)
    const inventory = { ...w.inventory }
    w.start(6)
    w.advance(60)
    expect(w.view()).toMatchObject({ dormant: 6, reserved: 0, residents: 0 })
    expect(w.inventory).toEqual(inventory)
    w.setReady(true)
    w.advance(3)
    expect(w.view().reserved).toBe(1)
    conserved(w)
  })
  it('不足100立方、忙船、主船与未发现来源不能开始运输', () => {
    for (const mutate of [(w: ReturnType<typeof world>) => { w.ship.freeM3 = 99 }, (w: ReturnType<typeof world>) => { w.ship.available = false },
      (w: ReturnType<typeof world>) => { w.ship.auxiliary = false }, (w: ReturnType<typeof world>) => { w.setKnown(false) }]) {
      const w = world(); mutate(w); w.start(); w.advance(60)
      expect(w.view().residents).toBe(0)
      expect(w.view().reserved).toBe(0)
    }
  })
  it('材料不足不扣半单、不占船；补足自动续行', () => {
    const w = world(); w.inventory['repairkit-civ'] = 0
    const before = { ...w.inventory }
    w.start(); w.advance(60)
    expect(w.inventory).toEqual(before)
    expect(w.ship.available).toBe(true)
    w.inventory['repairkit-civ'] = 4
    w.advance(18)
    expect(w.view().residents).toBe(1)
  })
  it('停止未开始人口原物返还，当前复苏者继续安全接收', () => {
    const before = world(); const stock = { ...before.inventory }
    before.start(); before.advance(2); before.stop(); before.advance(2)
    expect(before.inventory).toEqual(stock)
    expect(before.view().dormant).toBe(6)
    const w = world(); w.start(6); w.advance(6); w.stop(); w.advance(60)
    expect(w.view()).toMatchObject({ residents: 1, dormant: 5, reserved: 0 })
    expect(w.state.plan).toBeUndefined()
    conserved(w)
  })
  it('来源处理停电，完成必要处理后原舱保护，恢复不再收耗材', () => {
    const w = world(); w.start(); w.advance(6); const spent = { ...w.inventory }
    w.setReady(false); w.advance(7)
    expect(w.view()).toMatchObject({ protected: 1, reserved: 1, residents: 0, dormant: 5 })
    expect(w.ship).toMatchObject({ available: true, location: 'source' })
    w.advance(100)
    expect(w.inventory).toEqual(spent)
    w.setReady(true); w.advance(15)
    expect(w.view().residents).toBe(1)
    expect(w.inventory).toEqual(spent)
    conserved(w)
  })
  it('返程中断沿原航段返回，不传送、不重新收复苏材料', () => {
    const w = world(); w.start(); w.advance(15)
    expect(w.state.trip?.positionMs).toBe(MIN)
    w.setReady(false)
    expect(w.state.trip?.phase).toBe('safety-return')
    w.advance(0.5)
    expect(w.ship.available).toBe(false)
    w.advance(0.5)
    expect(w.view().protected).toBe(1)
    expect(w.ship.available).toBe(true)
    conserved(w)
  })
  it('接收部分进度保存，保护期间不工作，接回不重复加人', () => {
    const w = world(); w.start(); w.advance(17)
    expect(w.state.people[0].receiveMs).toBe(MIN)
    w.setReady(false); w.advance(2); w.stop(); w.setReady(true); w.advance(60)
    expect(w.view()).toMatchObject({ protected: 1, residents: 0, reserved: 1 })
    expect(w.start()).toEqual({ ok: true }); w.advance(14)
    expect(w.view()).toMatchObject({ residents: 1, reserved: 0, dormant: 5 })
    conserved(w)
  })
  it('容量缩小不解冻超额人口，已预留者不消失', () => {
    const w = world(); w.start(6); w.advance(18); w.advance(3)
    w.setCapacity(1); reconcileStationPopulation(w.state, w.host); w.advance(60)
    expect(w.view().residents).toBe(1)
    expect(w.view().protected).toBe(1)
    expect(w.view().dormant).toBe(4)
    conserved(w)
  })
  it('大步/小步和逐阶段快照恢复结果相同', () => {
    const large = world(), small = world()
    large.start(6); small.start(6); large.advance(84)
    for (let i = 0; i < 336; i++) { small.advance(0.25); conserved(small) }
    expect(small.state).toEqual(large.state)
    expect(small.inventory).toEqual(large.inventory)
  })
  it('停止和断电覆盖各阶段，反复协调不复制材料、名额或船只释放', () => {
    for (const at of [0, 0.5, 1, 2, 3, 5, 13, 13.5, 14, 15, 16, 17, 18, 21, 25, 40, 70]) {
      const w = world(); w.start(6); w.advance(at); conserved(w)
      w.setReady(false)
      if (w.state.plan) w.stop()
      for (let i = 0; i < 50; i++) { w.advance(0.5); conserved(w) }
      expect(w.ship.available).toBe(true)
      expect(w.getClaims()).toBe(w.getReleases())
      const snapshot = structuredClone(w.state), inventory = { ...w.inventory }
      w.setReady(true); w.advance(100)
      expect(w.state).toEqual(snapshot)
      expect(w.inventory).toEqual(inventory)
      if (w.view().protected > 0) {
        w.start(w.view().protected); w.advance(100); conserved(w)
        expect(w.view().protected).toBe(0)
        expect(w.inventory).toEqual(inventory)
      }
    }
  })
  it('来源站剩余未用材料继续使用，不在下一计划重复扣共仓', () => {
    const w = world(); w.start(6); w.advance(18 + 4); w.stop(); w.advance(60)
    expect(w.view()).toMatchObject({ residents: 2, dormant: 4 })
    const inventory = { ...w.inventory }
    expect(w.state.sourceMaterials['repairkit-civ']).toBe(16)
    w.start(4); w.advance(60)
    expect(w.view().residents).toBe(6)
    expect(w.inventory).toEqual(inventory)
    expect(w.state.sourceMaterials).toEqual({})
    conserved(w)
  })
  it('只读视图不抢船、不启动计划，也不暴露可写人口与料账', () => {
    const w = world(); w.setReady(false); w.start(2)
    const snapshot = structuredClone(w.state), inventory = { ...w.inventory }
    const view = w.view()
    view.people[0].status = 'resident'
    view.sourceMaterials['repairkit-civ'] = 100
    view.revivalBill[0].need = 999
    expect(w.state).toEqual(snapshot)
    expect(w.inventory).toEqual(inventory)
    expect(w.getClaims()).toBe(0)
    w.setReady(true); w.advance(5)
    const tripView = w.view()
    tripView.trip!.people.push(5)
    tripView.trip!.cargo.unknown = 1
    expect(w.state.trip?.people).toEqual([0])
    expect(w.state.trip?.cargo).toEqual({})
  })
  it('无效数量、重复安排与负时间均不损伤当前人口账', () => {
    const w = world()
    for (const count of [0, -1, 1.5, 7, NaN, Infinity]) expect(w.start(count)).toEqual({ ok: false, reason: 'invalid-count' })
    expect(w.stop()).toEqual({ ok: false, reason: 'no-plan' })
    w.start(); const before = structuredClone(w.state)
    expect(w.start()).toEqual({ ok: false, reason: 'busy' })
    expect(() => w.advance(-1)).toThrow()
    expect(w.state).toEqual(before)
  })
  it('拒绝重复身份、孤立在途者、错误预留与不完整快照', () => {
    const w = world(); w.start(); w.advance(5)
    for (const mutate of [(s: typeof w.state) => { s.people.pop() }, (s: typeof w.state) => { s.trip!.people.push(0) },
      (s: typeof w.state) => { delete s.trip }, (s: typeof w.state) => { s.people[0].receiveMs = -1 },
      (s: typeof w.state) => { s.trip!.active = 5 }, (s: typeof w.state) => { s.sourceMaterials.unknown = 1 }]) {
      const state = structuredClone(w.state); mutate(state); expect(() => cleanStationPopulation(state)).toThrow()
    }
  })
})
