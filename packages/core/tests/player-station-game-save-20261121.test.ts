import { describe, expect, it } from 'vitest'
import { createInitialState, CURRENT_STATE_VERSION, shipLockedReason } from '../src/state'
import { loadSaveFile, MIN_SUPPORTED_SAVE_VERSION, SaveError, serializeSaveFile } from '../src/save'
import { cleanPlayerStationGame, createPlayerStationGame, validatePlayerStationFleet } from '../src/playerStation/gameSave'
import type { PlayerStationGame } from '../src/playerStation/gameTypes'
import { POPULATION_RECEIVE_MS } from '../src/playerStation/population'
import { STATION_RESEARCH_CATALOG } from '../src/playerStation/research'
import { DEVELOPMENT_RULES } from '../src/playerStation/development'
import { stationCrewCommand, CREW_QUALIFICATION_MS } from '../src/playerStation/crew'

function settled(): PlayerStationGame {
  const game = createPlayerStationGame()
  game.discovered = true; game.active = true; game.station.built = true
  game.station.clockMs = game.crew.clockMs = game.security.clockMs = 120_000
  game.station.cells = [{ cellIndex: 0, kind: 'power', enabled: true }, { cellIndex: 1, kind: 'life-support', enabled: true },
    { cellIndex: 2, kind: 'service', enabled: true }, { cellIndex: 3, kind: 'refinery', enabled: true },
    { cellIndex: 4, kind: 'research', enabled: true }, { cellIndex: 5, kind: 'training', enabled: true },
    { cellIndex: 6, kind: 'manufacturing', enabled: true }]
  game.population.people.forEach(person => { person.status = 'resident'; person.receiveMs = POPULATION_RECEIVE_MS })
  for (const project of STATION_RESEARCH_CATALOG) if (project.id !== game.research.projectId) {
    game.research.archives[project.id] = { completed: true, progressMs: project.durationMs }
  }
  return game
}
function withCrew(activity: 'qualifying' | 'idle' | 'training' | 'guard' | 'mission' = 'training'): PlayerStationGame {
  const game = settled()
  expect(stationCrewCommand(game.crew, {
    residents: () => [0, 1, 2, 3, 4, 5], personAvailable: () => true,
    ship: () => ({ tier: 1, home: true, available: true, trainingTags: ['fire-control'] }),
    claimShip: () => true, releaseShip: () => {}, ready: () => true, trainingReady: () => true, teamAvailable: () => true,
  }, { kind: 'create', shipId: 'ship-crew', members: [0] }).ok).toBe(true)
  const team = game.crew.teams[0]
  team.activity = activity; team.qualificationMs = activity === 'qualifying' ? 0 : CREW_QUALIFICATION_MS
  team.planned = activity === 'training'
  if (activity === 'training') game.shipLocks[team.shipId!] = 'training'
  if (activity === 'guard' || activity === 'mission') {
    game.shipLocks[team.shipId!] = 'security'
    const deployment = { teamIds: [team.id], shipIds: [team.shipId!], paused: false }
    if (activity === 'guard') game.security.guard = deployment
    else {
      game.security.sequence = game.rewardedReportId = 1
      game.security.mission = { ...deployment, id: 1, kind: 'escort', phase: 'outbound', durationMs: 300_000,
        progressMs: 1_000, stopped: false, completed: false }
    }
  }
  return game
}
function delivery(target: 'body' | 'source' = 'body'): PlayerStationGame {
  const game = target === 'body' ? createPlayerStationGame() : settled()
  game.active = game.discovered = true; game.station.clockMs = 1_000
  game.crew.clockMs = game.security.clockMs = 1_000
  game.delivery = { shipId: 'ship-delivery', target, cargo: target === 'body' ? { 'part-frame': 100 } : { 'repairkit-civ': 4 },
    progressMs: 100, durationMs: 240_000 }
  game.shipLocks['ship-delivery'] = 'population'
  return game
}
function roundtrip(game: PlayerStationGame) {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const ids = [...Object.keys(game.shipLocks), ...game.crew.teams.flatMap(team => team.shipId ? [team.shipId] : []), ...(game.population.plan ? [game.population.plan.shipId] : [])]
  for (const id of ids) state.fleet[id] = structuredClone(state.fleet[state.shipId])
  state.playerStation = game
  return loadSaveFile(serializeSaveFile(state, 0)).state.playerStation
}
function rejects(game: unknown): void {
  const before = structuredClone(game)
  expect(() => cleanPlayerStationGame(game)).toThrow()
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const file = JSON.parse(serializeSaveFile(state, 0))
  file.state.playerStation = game
  try {
    loadSaveFile(JSON.stringify(file))
    expect.unreachable('非法第二阶段账不得清空后继续读档')
  } catch (error) {
    expect(error).toBeInstanceOf(SaveError)
    expect((error as SaveError).code).toBe('FORMAT')
    expect((error as Error).message).toContain('第二阶段空间站数据无效')
  }
  expect(game).toEqual(before)
}

describe('正式第二阶段随档 v31 → v32', () => {
  it('结构写 v32、下限 v31；不恢复低版本迁移，也不接受区间内小数版本', () => {
    expect(CURRENT_STATE_VERSION).toBe(32); expect(MIN_SUPPORTED_SAVE_VERSION).toBe(31)
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    expect(state.version).toBe(32)
    const file = JSON.parse(serializeSaveFile(state, 0))
    expect(file.version).toBe(32)
    for (const version of [...Array.from({ length: 31 }, (_, i) => i), 31.5, 33]) {
      file.version = version
      expect(() => loadSaveFile(JSON.stringify(file))).toThrowError(SaveError)
    }
  })
  it.each([31, 32] as const)('v%s 缺省字段保持缺省；既有舰队、仓库、声望、任务、随机种子完全保留', version => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    state.version = version; state.wallet.isk = 123_456
    state.warehouse.items['part-frame'] = 42; state.fleet[state.shipId].cargo['ore-veldspar'] = 7
    state.standings = { dsi: 41 }; state.standingsEarned = { dsi: 56 }
    state.importantTasks['first-scan'] = { done: true }
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back).toEqual({ ...state, version: 32 })
    expect(back).not.toHaveProperty('playerStation')
    const text = serializeSaveFile(back, 0)
    expect(JSON.parse(text).version).toBe(32)
    expect(loadSaveFile(text).state).toEqual(back)
  })
  it('空状态无赠送，工厂每次独立，v31 已有空字段保留并往返 v32', () => {
    expect(cleanPlayerStationGame(undefined)).toBeUndefined()
    const game = createPlayerStationGame(), state = createInitialState({ nowWallMs: 0, seed: 21 })
    expect(game.population.people.every(person => person.status === 'dormant')).toBe(true)
    expect(game).toMatchObject({ discovered: false, active: false, station: { built: false, cells: [], projects: [], bodyMaterials: {} },
      shipLocks: {}, crew: { teams: [] }, history: { refiningPeak: 0, manufacturingPeak: 0, crewGrowthPeak: 0, escortsReturned: 0, defensesWon: 0 } })
    expect(game).not.toHaveProperty('inventory'); expect(game).not.toHaveProperty('fleet'); expect(game).not.toHaveProperty('ships')
    state.version = 31; state.playerStation = game
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back).toEqual({ ...state, version: 32 })
    expect(back.fleet).toEqual(state.fleet); expect(back.warehouse).toEqual(state.warehouse)
    game.station.bodyMaterials['part-frame'] = 1
    expect(createPlayerStationGame().station.bodyMaterials).toEqual({})
  })
  it.each(['qualifying', 'idle', 'training', 'guard', 'mission'] as const)('%s 团队及任务、锁和时间账完整往返，无合成舰船', activity => {
    const game = withCrew(activity)
    expect(roundtrip(game)).toEqual(game)
    expect(cleanPlayerStationGame(JSON.parse(JSON.stringify(game)))).toEqual(game)
  })
  it('有效发展工程、工程师、技术和已投入料单往返', () => {
    const game = settled(), spec = DEVELOPMENT_RULES['power-upgrade']
    game.training.qualifications[0] = 'engineer'
    game.development.projects.push({ kind: 'power-upgrade', cellIndex: 0, engineerIndices: [0], durationMs: spec.durationMs,
      progressMs: 1_000, paused: true, spent: { ...spec.bill } })
    expect(roundtrip(game)).toEqual(game)
    game.training.qualifications[0] = null; rejects(game)
    game.training.qualifications[0] = 'engineer'; delete game.research.archives['station-power-2']; rejects(game)
  })
  it('纯 state 船锁拒因优先，不引入 runtime 依赖', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    expect(shipLockedReason(state, state.shipId)).toBeNull()
    state.playerStation = createPlayerStationGame(); state.playerStation.shipLocks[state.shipId] = 'population'
    expect(shipLockedReason(state, state.shipId)).toBe('该舰正在执行空间站任务，结束或返航后才能操作。')
  })
})

describe('第二阶段字段存在时非法整档拒读', () => {
  it.each([null, false, 0, [], {}, { version: 999 }, { version: 1 }])('拒绝不完整或非法字段 %j', value => rejects(value))
  it.each(['inventory', 'fleet', 'ships', 'combatShips', 'sourceKnown'])('拒绝预览额外字段 %s，不导入实验资产', key => {
    rejects({ ...createPlayerStationGame(), [key]: {} })
  })
  it.each(['station', 'population', 'training', 'refining', 'mining', 'research', 'development', 'academy', 'manufacturing', 'crew', 'security', 'campaign', 'history', 'shipLocks'] as const)('拒绝缺少 %s 的半份账', key => {
    const game = createPlayerStationGame(); delete (game as unknown as Record<string, unknown>)[key]; rejects(game)
  })
  it('拒绝虚构科研、团队内容、设施、人物资格和训练席位冲突', () => {
    const cases: Array<(game: PlayerStationGame) => void> = [
      game => { game.research.queue.push('unknown' as never) },
      game => { game.crew.teams[0].traits.push('unknown') },
      game => { game.station.cells[0].kind = 'unknown' as never },
      game => { game.training.qualifications[0] = 'engineer' },
      game => { game.station.cells = game.station.cells.filter(cell => cell.kind !== 'training') },
      game => { game.academy.active = { cellIndex: 5, personIndex: 1, course: 'engineer', progressMs: 0, paused: true } },
      game => { game.training.active = { personIndex: 0, course: 'engineer', progressMs: 0, paused: true } },
      game => { delete game.research.archives['station-training'] },
      game => { (game.station as unknown as Record<string, unknown>).fleet = {} },
    ]
    for (const mutate of cases) { const game = withCrew(); mutate(game); rejects(game) }
  })
  it('精炼/制造/采矿/科研人员和设施逐一验证；暂停不释放占用', () => {
    const game = settled()
    game.refining.runs.push({ cellIndex: 3, personIndex: 0, itemId: 'ore-veldspar', batchUnits: 100,
      cycleMs: 60_000, progressMs: 1_000, batchesDone: 0, paused: true })
    expect(roundtrip(game)).toEqual(game)
    game.training.active = { personIndex: 0, course: 'engineer', progressMs: 0, paused: false }; rejects(game)
    delete game.training.active; game.refining.runs[0].cellIndex = 2; rejects(game)
    game.refining.runs = []; game.research.assignment = { cellIndex: 4, personIndex: 0, paused: true }; rejects(game)
    game.training.qualifications[0] = 'researcher'; expect(roundtrip(game)).toEqual(game)
  })
  it('不接受孤锁、漏锁、错类锁、任务与团队活动不一致', () => {
    const cases: Array<(game: PlayerStationGame) => void> = [
      game => { delete game.shipLocks['ship-crew'] },
      game => { game.shipLocks['ship-crew'] = 'population' },
      game => { game.shipLocks.ghost = 'security' },
      game => { game.crew.teams[0].activity = 'guard'; game.crew.teams[0].planned = false },
    ]
    for (const mutate of cases) { const game = withCrew(); mutate(game); rejects(game) }
    const guard = withCrew('guard'); guard.security.guard!.shipIds = ['wrong-ship']; rejects(guard)
  })
  it('时间、安全报告结算及历史成果不一致一律拒绝', () => {
    for (const mutate of [
      (game: PlayerStationGame) => { game.crew.clockMs++ },
      (game: PlayerStationGame) => { game.crew.clockMs = game.security.clockMs = game.station.clockMs + 1 },
      (game: PlayerStationGame) => { game.guardServiceMs = game.security.clockMs + 1 },
      (game: PlayerStationGame) => { game.rewardedReportId = 1 },
      (game: PlayerStationGame) => { game.history.crewGrowthPeak = 73 },
      (game: PlayerStationGame) => { game.history.escortsReturned = 1 },
    ]) { const game = withCrew(); mutate(game); rejects(game) }
  })
  it('嵌套实验资产、额外字段与稀疏资格数组不能静默清空', () => {
    const game = settled()
    ;(game.population.people[0] as unknown as Record<string, unknown>).inventory = { 'part-frame': 999 }
    rejects(game)
    delete (game.population.people[0] as unknown as Record<string, unknown>).inventory
    game.refining.runs.push({ cellIndex: 3, itemId: 'ore-veldspar', batchUnits: 100, cycleMs: 60_000, progressMs: 0, batchesDone: 0, paused: false })
    ;(game.refining.runs[0] as unknown as Record<string, unknown>).fleet = {}
    rejects(game)
    const sparse = createPlayerStationGame(); delete sparse.training.qualifications[0]
    expect(() => cleanPlayerStationGame(sparse)).toThrow()
  })
  it.each(['industry', 'research', 'expansion', 'crew', 'logistics', 'security', 'defense'] as const)('阶段目标 %s 必须有实际成果凭据', goal => {
    const game = settled(); game.campaign.achieved.push(goal); rejects(game)
  })
  it('有凭据的阶段成果正常往返，不重新发任何奖励', () => {
    const game = settled(); game.campaign.achieved = ['settlement']
    expect(roundtrip(game)).toEqual(game)
  })
  it('资格期无船锁，可等待培训设施；实际 training 才要求培训设施', () => {
    const game = withCrew('qualifying')
    game.station.cells = game.station.cells.filter(cell => cell.kind !== 'training')
    expect(roundtrip(game)).toEqual(game)
  })
  it('制造、采矿已占岗位均不得复用人口或锁，未指派制造行允许保留', () => {
    const game = settled()
    game.manufacturing.runs.push({ cellIndex: 6, personIndex: 0, blueprintId: 'bp-test', batches: 2, batchesDone: 0,
      cycleMs: 60_000, progressMs: 100, paused: true, input: { 'part-frame': 1 }, output: { 'part-circuit': 1 } })
    expect(roundtrip(game)).toEqual(game)
    game.mining.sequence = 1
    game.mining.runs.push({ shipId: 'ship-miner', beltId: 'belt-fortune', personIndex: 0, phase: 'departure', progressMs: 100,
      durationMs: 60_000, stopping: false, paused: true, cargo: {}, cyclesDone: 0, tripsDone: 0, rvLeft: 0, rng: { seed: 1, count: 0 } })
    game.shipLocks['ship-miner'] = 'mining'; rejects(game)
    game.mining.runs[0].personIndex = 1
    expect(roundtrip(game)).toEqual(game)
    delete game.shipLocks['ship-miner']; rejects(game)
    game.mining.runs = []; game.manufacturing.runs[0].personIndex = undefined
    game.manufacturing.runs[0].progressMs = 0; game.manufacturing.runs[0].paused = false
    expect(roundtrip(game)).toEqual(game)
  })
})

describe('真实副船 delivery 航单', () => {
  it.each(['body', 'source'] as const)('%s 运单只存原货，不带舰队/库存；进度原样往返', target => {
    const game = delivery(target)
    expect(roundtrip(game)).toEqual(game)
    expect(game.delivery!.cargo).toEqual(target === 'body' ? { 'part-frame': 100 } : { 'repairkit-civ': 4 })
  })
  it('允许不同船人口 trip 和 delivery 并行，但同船或其他 run 重叠拒绝', () => {
    const game = delivery('source')
    game.population.people[0] = { status: 'dormant', receiveMs: 0 }
    game.population.plan = { shipId: 'ship-population', remaining: 1, stopped: false }
    game.population.trip = { shipId: 'ship-population', phase: 'loading', progressMs: 100, positionMs: 0, slots: 1,
      people: [], protectedQueue: [], cargo: {}, safety: false }
    game.shipLocks['ship-population'] = 'population'
    expect(roundtrip(game)).toEqual(game)
    game.delivery!.shipId = 'ship-population'; delete game.shipLocks['ship-delivery']; rejects(game)
    const other = withCrew(); other.delivery = { ...delivery('source').delivery!, shipId: 'ship-crew' }; rejects(other)
  })
  it.each(['target', 'ship', 'cargo-empty', 'cargo-id', 'cargo-negative', 'cargo-fraction', 'cargo-overflow', 'cargo-cross-target',
    'progress-negative', 'progress-fraction', 'progress-end', 'progress-future', 'duration-zero', 'duration-fraction', 'duration-long', 'duration-unsafe', 'missing-lock', 'wrong-lock'] as const)('非法运输 %s 整档拒读', defect => {
    const game = delivery(), run = game.delivery!
    switch (defect) {
      case 'target': run.target = 'unknown' as never; break
      case 'ship': run.shipId = '__proto__'; break
      case 'cargo-empty': run.cargo = {}; break
      case 'cargo-id': run.cargo = { unknown: 1 }; break
      case 'cargo-negative': run.cargo = { 'part-frame': -1 }; break
      case 'cargo-fraction': run.cargo = { 'part-frame': 0.5 }; break
      case 'cargo-overflow': run.cargo = { 'part-frame': Number.MAX_SAFE_INTEGER + 1 }; break
      case 'cargo-cross-target': run.cargo = { 'repairkit-civ': 1 }; break
      case 'progress-negative': run.progressMs = -1; break
      case 'progress-fraction': run.progressMs = 0.5; break
      case 'progress-end': run.progressMs = run.durationMs; break
      case 'progress-future': run.progressMs = game.station.clockMs + 1; break
      case 'duration-zero': run.durationMs = 0; break
      case 'duration-fraction': run.durationMs = 1.5; break
      case 'duration-long': run.durationMs = 8 * 24 * 60 * 60_000 + 1; break
      case 'duration-unsafe': run.durationMs = Number.MAX_SAFE_INTEGER + 1; break
      case 'missing-lock': delete game.shipLocks[run.shipId]; break
      case 'wrong-lock': game.shipLocks[run.shipId] = 'mining'; break
    }
    rejects(game)
  })
  it('8 天整数时长边界可读，来源运单不接受主体专用料', () => {
    const game = delivery('source'); game.delivery!.durationMs = 8 * 24 * 60 * 60_000
    expect(roundtrip(game)).toEqual(game)
    game.delivery!.cargo = { 'part-frame': 1 }; rejects(game)
  })
})

describe('第二阶段真实舰队与外部占用的读档交叉检查', () => {
  function fileFor(game = withCrew('idle')) {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    state.playerStation = game
    state.fleet['ship-crew'] = structuredClone(state.fleet[state.shipId])
    state.fleet['ship-delivery'] = structuredClone(state.fleet[state.shipId])
    state.fleet['ship-population'] = structuredClone(state.fleet[state.shipId])
    state.fleet['ship-miner'] = structuredClone(state.fleet[state.shipId])
    return JSON.parse(serializeSaveFile(state, 0))
  }
  it.each(['crew', 'mining', 'plan', 'trip', 'delivery', 'guard', 'mission'] as const)('%s 的引用船缺失整档拒读，不洗成幻影船或丢锁', kind => {
    let game = withCrew('idle'), uid = 'ship-crew'
    if (kind === 'guard' || kind === 'mission') game = withCrew(kind)
    if (kind === 'delivery') { game = delivery(); uid = 'ship-delivery' }
    if (kind === 'plan' || kind === 'trip') {
      game = settled(); uid = 'ship-population'
      game.population.people[0] = { status: 'dormant', receiveMs: 0 }
      game.population.plan = { shipId: uid, remaining: 1, stopped: kind === 'plan' }
      if (kind === 'trip') {
        game.population.trip = { shipId: uid, phase: 'loading', progressMs: 0, positionMs: 0, slots: 1,
          people: [], protectedQueue: [], cargo: {}, safety: false }
        game.shipLocks[uid] = 'population'
      }
    }
    if (kind === 'mining') {
      game = settled(); uid = 'ship-miner'; game.mining.sequence = 1
      game.mining.runs.push({ shipId: uid, personIndex: 0, beltId: 'belt-fortune', phase: 'departure', progressMs: 0, durationMs: 60_000,
        stopping: false, paused: false, cargo: {}, cyclesDone: 0, tripsDone: 0, rvLeft: 0, rng: { seed: 1, count: 0 } })
      game.shipLocks[uid] = 'mining'
    }
    const file = fileFor(game)
    expect(loadSaveFile(JSON.stringify(file)).state.playerStation).toEqual(game)
    delete file.state.fleet[uid]
    expect(() => loadSaveFile(JSON.stringify(file))).toThrowError(/第二阶段空间站舰船引用或占用冲突/)
  })
  it('纯校验只对实际锁船拒绝主控/外部占用，所有引用仍须为真实自有舰船', () => {
    const game = withCrew('idle'), fleet = { 'ship-crew': {} }, before = structuredClone(fleet)
    expect(() => validatePlayerStationFleet(game, fleet, 'sandcat', new Set())).not.toThrow()
    expect(fleet).toEqual(before)
    expect(() => validatePlayerStationFleet(game, fleet, 'ship-crew', new Set())).not.toThrow()
    expect(() => validatePlayerStationFleet(game, Object.create(fleet), 'sandcat', new Set())).toThrow()
    expect(() => validatePlayerStationFleet(game, fleet, 'sandcat', new Set(['ship-crew']))).not.toThrow()
    const training = withCrew('training')
    expect(() => validatePlayerStationFleet(training, fleet, 'ship-crew', new Set())).toThrow()
    expect(() => validatePlayerStationFleet(training, fleet, 'sandcat', new Set(['ship-crew']))).toThrow()
    for (const value of [null, false, 1, 'ship', []]) {
      expect(() => validatePlayerStationFleet(game, { 'ship-crew': value }, 'sandcat', new Set())).toThrow()
      const bad = fileFor(); bad.state.fleet['ship-crew'] = value
      expect(() => loadSaveFile(JSON.stringify(bad))).toThrowError(SaveError)
    }
    const file = fileFor(); file.state.shipId = 'ship-crew'
    expect(loadSaveFile(JSON.stringify(file)).state.playerStation).toEqual(game)
  })
  it.each(['ai', 'ai-malformed', 'return', 'return-malformed', 'legacy-lock', 'wormhole', 'wormhole-auto', 'planet-delivery', 'escort'] as const)('外部 %s 冲突拒读，不借旧域清洗掉冲突', domain => {
    const file = fileFor(withCrew('training')), state = file.state, uid = 'ship-crew'
    switch (domain) {
      case 'ai': state.aiAssignments[uid] = { coreType: 'basic', startedAtGameMs: 0,
        task: { kind: 'mining', beltId: 'belt-fortune', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, autoCycle: true, stopAfterTrip: false, originGalaxy: null, rvLeft: 0 } }; break
      case 'ai-malformed': state.aiAssignments[uid] = { coreType: 'unknown' }; break
      case 'return': state.shipReturns[uid] = { beltId: 'belt-fortune', legMs: 60_000, phaseAccMs: 100 }; break
      case 'return-malformed': state.shipReturns[uid] = null; break
      case 'legacy-lock': state.shipLocks[uid] = true; break
      case 'wormhole': state.wormhole.run = { fleet: [uid] }; break
      case 'wormhole-auto': state.wormholeAuto = [{ shipIds: [uid] }]; break
      case 'planet-delivery': state.planetary = { deliveries: [{ shipUid: uid }] }; break
      case 'escort':
        state.combatEscort = { version: 1, leaderShipId: state.shipId, shipIds: [state.shipId, uid] }
        state.awayGalaxy = 'galaxy-grave'; break
    }
    expect(() => loadSaveFile(JSON.stringify(file))).toThrowError(SaveError)
    expect(file.state.playerStation.crew.teams[0].shipId).toBe(uid)
  })
})
