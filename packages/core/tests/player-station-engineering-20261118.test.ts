import { describe, expect, it } from 'vitest'
import { advancePlayerStation, cleanPlayerStation, createPlayerStation, loadPlayerStation, PLAYER_FACILITIES,
  playerStationBill, playerStationCommand, playerStationNextEventMs, playerStationView, serializePlayerStation } from '../src/playerStation/index'
import type { PlayerStationAction, PlayerStationHost } from '../src/playerStation/index'

const MIN = 60_000
function world() {
  const state = createPlayerStation()
  state.built = true
  state.cells = [{ kind: 'power', cellIndex: 0, enabled: true }, { kind: 'life-support', cellIndex: 1, enabled: true }, { kind: 'service', cellIndex: 2, enabled: true }]
  const inventory: Record<string, number> = Object.fromEntries(Object.keys(PLAYER_FACILITIES.research.bill).map(id => [id, 10_000_000]))
  const engineers: number[] = []
  let level = 0
  const host: PlayerStationHost = {
    engineeringLevel: () => level, engineers: () => engineers, available: id => inventory[id] ?? 0, itemName: id => id,
    take: bill => {
      if (Object.entries(bill).some(([id, n]) => (inventory[id] ?? 0) < n)) return false
      for (const [id, n] of Object.entries(bill)) inventory[id] -= n
      return true
    },
    give: bill => { for (const [id, n] of Object.entries(bill)) inventory[id] = (inventory[id] ?? 0) + n },
  }
  return { state, host, inventory, engineers, level: (value: number) => { level = value },
    command: (action: PlayerStationAction) => playerStationCommand(state, host, action),
    advance: (minutes: number) => advancePlayerStation(state, host, minutes * MIN), view: () => playerStationView(state, host) }
}

describe('独立玩家站B3：工程师施工与两类基础设施', () => {
  it('保持已确认料单、60/90分钟、施工4点、待机1点及作业6/4点', () => {
    expect(PLAYER_FACILITIES.refinery).toMatchObject({ durationMs: 60 * MIN, engineers: 1, power: 1, workPower: 6,
      bill: { 'min-tritanium': 150_000, 'part-frame': 4000, 'part-armor-plate': 4000, 'part-cable': 3000, 'part-circuit': 2000, 'part-coolant': 8000, 'part-gyro': 1000 } })
    expect(PLAYER_FACILITIES.research).toMatchObject({ durationMs: 90 * MIN, engineers: 1, power: 1, workPower: 4,
      bill: { 'min-tritanium': 50_000, 'part-frame': 3000, 'part-armor-plate': 2000, 'part-cable': 3000, 'part-circuit': 8000, 'part-coolant': 5000, 'part-gyro': 1000, 'part-lens': 2000 } })
    expect(world().view().facilityOptions.refinery).toMatchObject({ constructionPower: 4, engineers: 1, runPower: 1, workPower: 6 })
  })
  it('没有工程师或缺生活保障不扣料；前三项自动装配保持', () => {
    const w = world(), before = { ...w.inventory }
    expect(w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })).toEqual({ ok: false, reason: 'engineer' })
    w.engineers.push(0); w.command({ kind: 'toggle', cellIndex: 1 })
    expect(w.command({ kind: 'build', facility: 'research', cellIndex: 3 })).toEqual({ ok: false, reason: 'engineer' })
    expect(w.inventory).toEqual(before)
    w.engineers.length = 0
    expect(w.command({ kind: 'build', facility: 'service', cellIndex: 3 })).toEqual({ ok: true })
  })
  it('一个工程师不能同时占两块地，暂停仍占人、不占施工电力', () => {
    const w = world(); w.engineers.push(1)
    expect(w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })).toEqual({ ok: true })
    expect(w.state.projects[0].engineerIndex).toBe(1)
    w.advance(15); w.command({ kind: 'pause', cellIndex: 3 })
    const inventory = { ...w.inventory }
    expect(w.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: false, reason: 'engineer' })
    expect(w.inventory).toEqual(inventory)
    expect(w.view().power.constructionDemand).toBe(0)
    w.advance(60); expect(w.state.projects[0].progressMs).toBe(15 * MIN)
    w.command({ kind: 'resume', cellIndex: 3 }); w.advance(45)
    expect(w.view().facilityOptions.research.availableEngineers).toBe(1)
    expect(w.command({ kind: 'build', facility: 'research', cellIndex: 4 })).toEqual({ ok: true })
    expect(w.state.projects[0].engineerIndex).toBe(1)
  })
  it('两名工程师可各负责一格，独立进度和完工释放，建筑不产生人口/产物', () => {
    const w = world(); w.engineers.push(0, 1)
    w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); w.command({ kind: 'build', facility: 'research', cellIndex: 4 })
    expect(w.state.projects.map(p => p.engineerIndex)).toEqual([0, 1])
    expect(w.view().power).toMatchObject({ runningDemand: 8, constructionDemand: 8 })
    w.advance(60)
    expect(w.state.projects).toHaveLength(1)
    expect(w.state.projects[0]).toMatchObject({ kind: 'research', engineerIndex: 1, progressMs: 60 * MIN })
    expect(w.view().power).toMatchObject({ runningDemand: 9, constructionDemand: 4, populationCapacity: 6 })
    const inventory = { ...w.inventory }; w.advance(30)
    expect(w.state.projects).toEqual([])
    expect(w.view().power).toMatchObject({ runningDemand: 10, constructionDemand: 0 })
    expect(w.view().cells.filter(c => c.kind === 'refinery' || c.kind === 'research').every(c => c.operational)).toBe(true)
    w.advance(600); expect(w.inventory).toEqual(inventory)
  })
  it('失去工程师/生活保障或缺电保进度，不借同一人给别的工程', () => {
    const w = world(); w.engineers.push(0); w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); w.advance(15)
    w.engineers.length = 0; w.advance(15)
    expect(w.state.projects[0].progressMs).toBe(15 * MIN)
    expect(w.view().projects[0]).toMatchObject({ blocked: true, blockedReason: 'engineer', engineerIndex: 0 })
    expect(playerStationNextEventMs(w.state, w.host)).toBe(Infinity)
    w.engineers.push(0); w.command({ kind: 'toggle', cellIndex: 0 }); w.advance(15)
    expect(w.state.projects[0].progressMs).toBe(15 * MIN)
    w.command({ kind: 'toggle', cellIndex: 0 }); w.advance(45)
    expect(w.state.projects).toEqual([])
  })
  it('缺料开工失败不占工程师；取消只退目标工程原账未完成部分', () => {
    const w = world(); w.engineers.push(0, 1); w.inventory['part-gyro'] = 0
    const before = { ...w.inventory }
    expect(w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })).toEqual({ ok: false, reason: 'materials' })
    expect(w.view().facilityOptions.refinery.availableEngineers).toBe(2)
    expect(w.inventory).toEqual(before)
    w.inventory['part-gyro'] = 2000
    w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); w.command({ kind: 'build', facility: 'research', cellIndex: 4 }); w.advance(30)
    const remaining = structuredClone(w.state.projects[1]), stock = { ...w.inventory }
    w.level(5); w.command({ kind: 'cancel', cellIndex: 3 })
    expect(w.state.projects).toEqual([remaining])
    for (const [id, n] of Object.entries(PLAYER_FACILITIES.refinery.bill)) expect(w.inventory[id]).toBe(stock[id] + n / 2)
    expect(w.view().facilityOptions.refinery.availableEngineers).toBe(1)
  })
  it('工程学六档只减新项目材料，不改工期、工程师或既有投入', () => {
    for (let level = 0; level <= 5; level++) {
      const w = world(); w.level(level); w.engineers.push(0)
      w.command({ kind: 'build', facility: 'research', cellIndex: 3 })
      expect(w.state.projects[0]).toMatchObject({ durationMs: 90 * MIN, engineerIndex: 0, spent: playerStationBill(w.host, PLAYER_FACILITIES.research.bill) })
      const before = structuredClone(w.state.projects[0]); w.level(5); expect(w.state.projects[0]).toEqual(before)
    }
  })
  it('工程师占用的v3快照往返，拒绝丢失/重复/越界/自动设施夹带用工', () => {
    const w = world(); w.engineers.push(0, 1)
    w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); w.command({ kind: 'build', facility: 'research', cellIndex: 4 }); w.advance(15)
    w.command({ kind: 'pause', cellIndex: 3 })
    expect(loadPlayerStation(serializePlayerStation(w.state))).toEqual(w.state)
    for (const mutate of [(s: typeof w.state) => { delete s.projects[0].engineerIndex },
      (s: typeof w.state) => { s.projects[1].engineerIndex = 0 }, (s: typeof w.state) => { s.projects[0].engineerIndex = 6 },
      (s: typeof w.state) => { s.projects[0].kind = 'service'; s.projects[0].durationMs = PLAYER_FACILITIES.service.durationMs; s.projects[0].spent = { ...PLAYER_FACILITIES.service.bill } }]) {
      const bad = structuredClone(w.state); mutate(bad); expect(() => cleanPlayerStation(bad)).toThrow()
    }
  })
  it('旧v2只迁移旧设施，不可夹带新建筑或工程师字段', () => {
    const w = world(), old = { ...structuredClone(w.state), runtimeVersion: 2 }
    expect(loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 2, state: old }))).toEqual(w.state)
    w.engineers.push(0); w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 })
    const invalid = { ...structuredClone(w.state), runtimeVersion: 2 }
    expect(() => loadPlayerStation(JSON.stringify({ format: 'whale-player-station-lab', version: 2, state: invalid }))).toThrow()
  })
  it('两工程分步与大步相同，五建筑视图只读不暗中占人扣料', () => {
    const large = world(), small = world()
    for (const w of [large, small]) {
      w.engineers.push(0, 1); w.command({ kind: 'build', facility: 'refinery', cellIndex: 3 }); w.command({ kind: 'build', facility: 'research', cellIndex: 4 })
    }
    const state = structuredClone(large.state), stock = { ...large.inventory }
    const view = large.view(); view.projects[0].engineerIndex = 5; view.cells[0].operational = false
    expect(large.state).toEqual(state); expect(large.inventory).toEqual(stock)
    large.advance(90); for (let i = 0; i < 90; i++) small.advance(1)
    expect(small.state).toEqual(large.state); expect(small.inventory).toEqual(large.inventory)
  })
})
