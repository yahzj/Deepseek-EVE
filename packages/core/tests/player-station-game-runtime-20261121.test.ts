import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, shipLockedReason } from '../src/state'
import { advanceGame } from '../src/engine'
import { addShipToFleet } from '../src/fleetBook'
import { addModule, fitModule } from '../src/equipment'
import { PlayerStationGameRuntime } from '../src/playerStation/gameRuntime'
import { createPlayerStationGame } from '../src/playerStation/gameSave'
import { PLAYER_FACILITIES, PLAYER_STATION_BODY_BILL } from '../src/playerStation/rules'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { shipOperationBlockReason } from '../src/shipActionPolicy'
import { stationCrewShip } from '../src/playerStation/gameShips'

function world() {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 20261121 })
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  const shipId = addShipToFleet(state, 'sh-falconet')
  const miner = addShipToFleet(state, 'sandcat')
  addModule(state, 'mod-miner-1', 1); expect(fitModule(state, 'mod-miner-1', ctx, { shipId: miner }).ok).toBe(true)
  state.playerStation = createPlayerStationGame()
  const runtime = new PlayerStationGameRuntime(state, ctx)
  const command = (domain: string, action: unknown) => runtime.command(domain, action)
  const advance = (minutes: number) => runtime.advance(minutes * 60_000)
  return { ctx, state, runtime, shipId, miner, command, advance }
}
function built() {
  const w = world(); w.command('activate', {}); w.command('station', { kind: 'approve' })
  w.state.playerStation!.station.built = true
  w.state.playerStation!.station.bodyApproved = false
  delete w.state.playerStation!.station.project
  w.state.playerStation!.station.bodyMaterials = {}
  return w
}
function ready() {
  const w = built()
  for (const kind of ['power', 'life-support', 'service'] as const) {
    Object.assign(w.state.warehouse.items, PLAYER_FACILITIES[kind].bill)
    expect(w.command('station', { kind: 'build', facility: kind, cellIndex: w.runtime.g.station.cells.length }).ok).toBe(true)
    w.advance(PLAYER_FACILITIES[kind].durationMs / 60_000)
  }
  return w
}
describe('第二阶段正式游戏宿主', () => {
  it('全星图才可发现并激活，不赠材料/人口/舰船；空旧档自动发现只建空账', () => {
    const w = world(), inventory = structuredClone(w.state.warehouse.items), fleet = structuredClone(w.state.fleet)
    w.state.exploredGalaxies.pop()
    expect(w.command('activate', {})).toEqual({ ok: false, reason: 'undiscovered' })
    w.state.exploredGalaxies = [...w.ctx.galaxies.keys()]
    expect(w.command('activate', {})).toEqual({ ok: true })
    expect(w.state.warehouse.items).toEqual(inventory); expect(w.state.fleet).toEqual(fleet)
    expect(w.runtime.populationView().residents).toBe(0)
    const other = createInitialState({ nowWallMs: 0 }); other.exploredGalaxies = [...w.ctx.galaxies.keys()]
    advanceGame(other, 1, w.ctx)
    expect(other.playerStation?.discovered).toBe(true); expect(other.playerStation?.active).toBe(false)
  })
  it('最后一次真实扫描结束当拍发现古站，不需要重载也不倒补站内工时', () => {
    const w = world(); delete w.state.playerStation
    w.state.exploredGalaxies = w.state.exploredGalaxies.filter(id => id !== 'galaxy-vault')
    w.state.scanning = { ...w.state.scanning, active: true, galaxyId: 'galaxy-vault', startedAtGameMs: w.state.gameMs,
      finishAtGameMs: w.state.gameMs + 1000, returning: false, originGalaxy: null }
    advanceGame(w.state, 999, w.ctx)
    expect(w.state.playerStation).toBeUndefined()
    advanceGame(w.state, 1, w.ctx)
    expect(w.state.exploredGalaxies).toContain('galaxy-vault')
    expect(w.state.playerStation).toMatchObject({ discovered: true, active: false, station: { clockMs: 0, built: false } })
  })
  it('主体真实副船分趟扣料与锁船，途中共仓不持有材料，到货才开工，拒收原物只退一次', () => {
    const w = world(); w.command('activate', {}); w.command('station', { kind: 'approve' })
    Object.assign(w.state.warehouse.items, PLAYER_STATION_BODY_BILL)
    const before = w.state.warehouse.items['min-tritanium']
    expect(w.command('delivery', { shipId: w.shipId, target: 'body' })).toEqual({ ok: true })
    const delivery = w.runtime.g.delivery!
    expect(w.state.warehouse.items['min-tritanium']).toBe(before - delivery.cargo['min-tritanium'])
    expect(w.runtime.g.station.bodyMaterials).toEqual({})
    expect(shipLockedReason(w.state, w.shipId)).toContain('空间站')
    expect(shipOperationBlockReason(w.state, w.ctx, w.shipId, 'configure')).not.toBeNull()
    expect(w.command('delivery', { shipId: w.shipId, target: 'body' }).ok).toBe(false)
    expect(loadSaveFile(serializeSaveFile(w.state, 0)).state.playerStation?.delivery).toEqual(delivery)
    w.runtime.advance(delivery.durationMs)
    expect(w.runtime.g.delivery).toBeUndefined(); expect(w.runtime.g.shipLocks[w.shipId]).toBeUndefined()
    expect(w.runtime.g.station.bodyMaterials['min-tritanium']).toBeGreaterThan(0)
    expect(w.runtime.g.station.built).toBe(false)
  })
  it('原仓材料不足时拒绝设施建设，不改变真实仓库；完工能力不提前生效', () => {
    const w = built(), before = structuredClone(w.state.warehouse.items)
    expect(w.command('station', { kind: 'build', facility: 'power', cellIndex: 0 })).toMatchObject({ ok: false, reason: 'materials' })
    expect(w.state.warehouse.items).toEqual(before)
    Object.assign(w.state.warehouse.items, PLAYER_FACILITIES.power.bill)
    expect(w.command('station', { kind: 'build', facility: 'power', cellIndex: 0 }).ok).toBe(true)
    w.advance(44); expect(w.runtime.view().power.supply).toBe(0)
    w.advance(1); expect(w.runtime.view().power.supply).toBe(24)
  })
  it('撤销主体后的材料必须由真实副船分趟回收，到港只退一次', () => {
    const w = world(); w.command('activate', {}); w.command('station', { kind: 'approve' })
    Object.assign(w.state.warehouse.items, PLAYER_STATION_BODY_BILL)
    expect(w.command('delivery', { shipId: w.shipId, target: 'body' }).ok).toBe(true)
    w.runtime.advance(w.runtime.g.delivery!.durationMs)
    const delivered = { ...w.runtime.g.station.bodyMaterials }
    expect(w.command('station', { kind: 'cancel' }).ok).toBe(true)
    const old = { ...w.state.warehouse.items }
    expect(w.runtime.g.station.recoveryMaterials).toEqual(delivered)
    expect(w.command('recover', {}).ok).toBe(false)
    expect(w.command('recover', { shipId: w.shipId }).ok).toBe(true)
    const delivery = structuredClone(w.runtime.g.delivery!)
    expect(delivery.target).toBe('recovery')
    expect(w.state.warehouse.items).toEqual(old)
    expect(loadSaveFile(serializeSaveFile(w.state, 0)).state.playerStation?.delivery).toEqual(delivery)
    w.runtime.advance(delivery.durationMs)
    for (const [id, n] of Object.entries(delivery.cargo)) expect(w.state.warehouse.items[id]).toBe((old[id] ?? 0) + n)
    const arrived = { ...w.state.warehouse.items }
    w.advance(1); expect(w.state.warehouse.items).toEqual(arrived)
    expect(w.runtime.g.shipLocks[w.shipId]).toBeUndefined()
  })
  it('人口运输实际占副船及原仓组件，到站后才给同一人口；课程不发免费居民', () => {
    const w = ready()
    Object.assign(w.state.warehouse.items, { 'repairkit-civ': 4, 'part-coolant': 20, 'part-circuit': 10 })
    expect(w.command('population', { kind: 'start', shipId: w.shipId, count: 1 }).ok).toBe(true)
    expect(w.runtime.g.shipLocks[w.shipId]).toBe('population'); expect(w.runtime.populationView().residents).toBe(0)
    w.advance(17); expect(w.runtime.populationView().residents).toBe(0)
    w.advance(1); expect(w.runtime.populationView().residents).toBe(1)
    expect(w.runtime.g.shipLocks[w.shipId]).toBeUndefined()
    expect(w.command('training', { kind: 'enqueue', course: 'engineer' }).ok).toBe(true); w.advance(30)
    expect(w.runtime.g.training.qualifications[0]).toBe('engineer'); expect(w.runtime.populationView().residents).toBe(1)
    expect(loadSaveFile(serializeSaveFile(w.state, 0)).state.playerStation).toEqual(w.runtime.g)
  })
  it('保护返送后的真实船停在来源，空返两分钟后才可重新用于原游戏任务', () => {
    const w = ready()
    Object.assign(w.state.warehouse.items, { 'repairkit-civ': 4, 'part-coolant': 20, 'part-circuit': 10 })
    expect(w.command('population', { kind: 'start', shipId: w.shipId, count: 1 }).ok).toBe(true)
    w.advance(6)
    expect(w.command('station', { kind: 'toggle', cellIndex: 0 }).ok).toBe(true)
    w.advance(7)
    expect(w.runtime.populationView().protected).toBe(1)
    expect(w.runtime.g.sourceShips).toEqual([w.shipId])
    expect(w.runtime.g.shipLocks[w.shipId]).toBe('population')
    expect(shipOperationBlockReason(w.state, w.ctx, w.shipId, 'configure')).not.toBeNull()
    expect(w.runtime.shipsView().find(ship => ship.id === w.shipId)?.location).toBe('source')
    expect(loadSaveFile(serializeSaveFile(w.state, 0)).state.playerStation).toEqual(w.runtime.g)
    expect(w.command('population', { kind: 'stop' }).ok).toBe(true)
    expect(w.command('population-return', { shipId: w.shipId }).ok).toBe(true)
    w.advance(1); expect(w.runtime.g.shipLocks[w.shipId]).toBe('population')
    expect(loadSaveFile(serializeSaveFile(w.state, 0)).state.playerStation?.delivery?.target).toBe('return')
    w.advance(1)
    expect(w.runtime.g.sourceShips).toBeUndefined(); expect(w.runtime.g.shipLocks[w.shipId]).toBeUndefined()
    expect(w.runtime.populationView().protected).toBe(1)
    expect(w.runtime.shipsView().find(ship => ship.id === w.shipId)?.location).toBe('home')
  })
  it('真实矿船/装配与人类采矿锁互斥，到港卸货只入原仓，不赠新矿船', () => {
    const w = ready()
    w.runtime.g.population.people[0] = { status: 'resident', receiveMs: 120000 }
    const belt = w.runtime.belts()[0].id, count = Object.keys(w.state.fleet).length
    expect(w.command('mining', { kind: 'assign', shipId: w.miner, personIndex: 0, beltId: belt }).ok).toBe(true)
    w.advance(1)
    const run = w.runtime.g.mining.runs[0]
    expect(Object.values(run.cargo).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0)
    expect(w.command('mining', { kind: 'stop', shipId: w.miner }).ok).toBe(true)
    const cargo = { ...run.cargo }, old = { ...w.state.warehouse.items }
    w.runtime.advance(run.durationMs - run.progressMs)
    for (const [id, n] of Object.entries(cargo)) expect(w.state.warehouse.items[id]).toBe((old[id] ?? 0) + n)
    expect(w.runtime.g.shipLocks[w.miner]).toBeUndefined(); expect(Object.keys(w.state.fleet)).toHaveLength(count)
  })
  it('生产/科研/工程同一时间轴，大步小步资源状态一致', () => {
    const w = ready(), other = loadSaveFile(serializeSaveFile(w.state, 0)).state
    w.advance(120)
    const runtime = new PlayerStationGameRuntime(other, w.ctx)
    for (let n = 0; n < 120; n++) runtime.advance(60_000)
    expect(other.playerStation).toEqual(w.runtime.g)
    const positive = (items: Record<string, number>) => Object.fromEntries(Object.entries(items).filter(([, n]) => n > 0))
    expect(positive(other.warehouse.items)).toEqual(positive(w.state.warehouse.items))
  })
  it('正式引擎的大步跨完工边界与逐秒推进一致，完工前不借新设施能力', () => {
    const w = built()
    Object.assign(w.state.warehouse.items, PLAYER_FACILITIES.power.bill)
    expect(w.command('station', { kind: 'build', facility: 'power', cellIndex: 0 }).ok).toBe(true)
    const other = loadSaveFile(serializeSaveFile(w.state, 0)).state
    advanceGame(w.state, 46 * 60_000, w.ctx)
    for (let n = 0; n < 46 * 60; n++) advanceGame(other, 1000, w.ctx)
    expect(other.playerStation).toEqual(w.state.playerStation)
    expect(w.runtime.view().power.supply).toBe(24)
  })
  it('结算异常回滚正式库存/人口/船锁，未取走半单产物', () => {
    const w = ready(); w.runtime.g.population.people[0] = { status: 'resident', receiveMs: 120000 }
    w.runtime.g.station.cells.push({ kind: 'refinery', cellIndex: 3, enabled: true })
    w.state.warehouse.items['ore-veldspar'] = 100
    expect(w.command('refining', { kind: 'assign', cellIndex: 3, personIndex: 0, itemId: 'ore-veldspar' }).ok).toBe(true)
    const before = structuredClone({ g: w.runtime.g, inventory: w.state.warehouse.items, fleet: w.state.fleet })
    const spy = vi.spyOn(w.runtime.refiningHost, 'settle').mockImplementationOnce(() => { throw new Error('host fail') })
    expect(() => w.advance(1)).toThrow('host fail'); spy.mockRestore()
    expect(w.runtime.g).toEqual(before.g); expect(w.state.warehouse.items).toEqual(before.inventory); expect(w.state.fleet).toEqual(before.fleet)
  })
  it('正式船只资格读取现有船型与装配，不回退到合成配置', () => {
    const w = world(), ship = stationCrewShip(w.state, w.ctx, w.shipId)!
    expect(ship.available).toBe(true); expect(ship.tier).toBe(1)
    expect(stationCrewShip(w.state, w.ctx, w.state.shipId)).toMatchObject({ available: false, home: false })
  })
})
