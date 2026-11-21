import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { addModule, fitModule } from '../src/equipment'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { createPlayerStationGame } from '../src/playerStation/gameSave'
import { PlayerStationGameRuntime } from '../src/playerStation/gameRuntime'
import { STATION_RESEARCH_CATALOG } from '../src/playerStation/research'
import { PLAYER_FACILITIES } from '../src/playerStation/rules'

describe('正式空间站连续经营流程', () => {
  it('真实仓库生产、六项科研、扩建升级、舰员护航与守备可以接续且随档不丢账', () => {
    const ctx = buildSimContext(), state = createInitialState({ nowWallMs: 0, seed: 20261121 })
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    const uid = addShipToFleet(state, 'sh-falconet')
    addModule(state, 'mod-turret-kin-1', 1)
    expect(fitModule(state, 'mod-turret-kin-1', ctx, { shipId: uid }).ok).toBe(true)
    // 合成门槛只省去已覆盖的主体/首批人口筹备；后续全部通过正式命令。
    const game = createPlayerStationGame()
    game.active = game.discovered = true; game.station.built = true
    game.station.cells = [
      { cellIndex: 0, kind: 'power', enabled: true }, { cellIndex: 1, kind: 'life-support', enabled: true },
      { cellIndex: 2, kind: 'service', enabled: true }, { cellIndex: 3, kind: 'refinery', enabled: true },
      { cellIndex: 4, kind: 'research', enabled: true },
    ]
    game.population.people.forEach(person => { person.status = 'resident'; person.receiveMs = 120_000 })
    game.training.qualifications = ['engineer', 'engineer', 'researcher', null, null, null]
    state.playerStation = game
    for (const id of ctx.items.keys()) state.warehouse.items[id] = 10_000_000
    const runtime = new PlayerStationGameRuntime(state, ctx)
    const command = (domain: string, action: unknown) => expect(runtime.command(domain, action)).toEqual({ ok: true })
    const advance = (minutes: number) => runtime.advance(minutes * 60_000)
    const roundtrip = () => expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)

    command('refining', { kind: 'assign', cellIndex: 3, personIndex: 3, itemId: 'ore-veldspar' })
    advance(2); command('refining', { kind: 'stop', cellIndex: 3 })
    expect(game.history.refiningPeak).toBeGreaterThan(0)
    for (const project of STATION_RESEARCH_CATALOG) {
      command('research', { kind: 'assign', cellIndex: 4, personIndex: 2, projectId: project.id })
      runtime.advance(project.durationMs)
    }
    expect(runtime.researchView().catalog.every(project => project.completed)).toBe(true)
    roundtrip()

    command('development', { kind: 'expand' }); advance(240)
    command('development', { kind: 'power-upgrade', cellIndex: 0 }); advance(60)
    command('development', { kind: 'life-upgrade', cellIndex: 1 }); advance(90)
    expect(runtime.view()).toMatchObject({ cellCount: 16, power: { supply: 36, populationCapacity: 10 } })
    for (const [kind, cellIndex] of [['manufacturing', 9], ['training', 10], ['warning', 11]] as const) {
      command('station', { kind: 'build', facility: kind, cellIndex })
      runtime.advance(PLAYER_FACILITIES[kind].durationMs)
    }
    command('manufacturing', { kind: 'assign', cellIndex: 9, personIndex: 3, blueprintId: 'bp-part-circuit', batches: 1 })
    const before = state.warehouse.items['part-circuit']
    runtime.advance(game.manufacturing.runs[0].cycleMs)
    expect(state.warehouse.items['part-circuit']).toBeGreaterThan(before)
    expect(game.history.manufacturingPeak).toBe(1)
    expect(game.manufacturing.runs[0].personIndex).toBeUndefined(); roundtrip()

    expect(runtime.command('crew', { kind: 'create', shipId: uid, members: [3], name: '正式测试队' }).ok).toBe(true)
    advance(30)
    const team = game.crew.teams[0]
    expect(team.activity).toBe('idle')
    command('crew', { kind: 'plan', teamId: team.id, course: 'fire-control' }); advance(10)
    command('crew', { kind: 'idle', teamId: team.id }); roundtrip()
    command('security', { kind: 'start', missionKind: 'escort', teamIds: [team.id] })
    advance(5); expect(game.shipLocks[uid]).toBe('security'); roundtrip()
    advance(25)
    expect(game.history.escortsReturned).toBe(1); expect(game.shipLocks[uid]).toBeUndefined()
    command('security', { kind: 'guard', teamIds: [team.id] }); advance(30)
    expect(game.guardServiceMs).toBe(30 * 60_000)
    command('security', { kind: 'unguard' }); roundtrip()
    expect(game.campaign.achieved).toEqual(expect.arrayContaining(['settlement', 'industry', 'research', 'expansion', 'crew', 'logistics', 'defense']))
    expect(state.fleet[uid]).toBeDefined()
    expect(game.population.people.filter(person => person.status === 'resident')).toHaveLength(6)
  })
})
