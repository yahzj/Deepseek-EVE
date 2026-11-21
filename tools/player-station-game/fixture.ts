import { buildSimContext, ANNOUNCEMENTS } from '../../packages/data/src/index'
import { createInitialState } from '../../packages/core/src/state'
import { addShipToFleet } from '../../packages/core/src/fleetBook'
import { addModule, fitModule } from '../../packages/core/src/equipment'
import { loadSaveFile, serializeSaveFile } from '../../packages/core/src/save'
import { createPlayerStationGame } from '../../packages/core/src/playerStation/gameSave'
import { PLAYER_STATION_BODY_BILL } from '../../packages/core/src/playerStation/rules'
import { STATION_RESEARCH_CATALOG } from '../../packages/core/src/playerStation/research'

/** 独立生成，不读个人档；物资仅存在于明确标注的验收夹具。 */
export function gameFixture(mode: 'unexplored' | 'discovered' | 'ready' | 'source') {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: Date.now(), seed: 20261121 })
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  if (mode === 'unexplored') state.exploredGalaxies = state.exploredGalaxies.filter(id => id !== 'galaxy-vault')
  const shipId = addShipToFleet(state, 'sh-falconet')
  const minerId = addShipToFleet(state, 'sandcat')
  addModule(state, 'mod-miner-1', 1)
  if (!fitModule(state, 'mod-miner-1', ctx, { shipId: minerId }).ok) throw new Error('合成矿船装配失败')
  Object.assign(state.warehouse.items, PLAYER_STATION_BODY_BILL)
  if (mode === 'ready' || mode === 'source') {
    const game = createPlayerStationGame()
    game.discovered = true; game.active = true; game.station.built = true
    game.station.cells = [
      { cellIndex: 0, kind: 'power', enabled: true },
      { cellIndex: 1, kind: 'life-support', enabled: true },
      { cellIndex: 2, kind: 'service', enabled: true },
      { cellIndex: 3, kind: 'refinery', enabled: true },
      { cellIndex: 4, kind: 'research', enabled: true },
      { cellIndex: 5, kind: 'manufacturing', enabled: true },
      { cellIndex: 6, kind: 'training', enabled: true },
      { cellIndex: 7, kind: 'warning', enabled: true },
      { cellIndex: 8, kind: 'power', enabled: true },
    ]
    game.population.people = game.population.people.map(() => ({ status: 'resident', receiveMs: 120_000 }))
    for (const project of STATION_RESEARCH_CATALOG.filter(project => ['station-manufacturing', 'station-training', 'station-warning'].includes(project.id))) {
      game.research.archives[project.id] = { progressMs: project.durationMs, completed: true }
    }
    if (mode === 'source') {
      game.population.people[0] = { status: 'protected', receiveMs: 0 }
      game.sourceShips = [shipId]
      game.shipLocks[shipId] = 'population'
      game.population.plan = { shipId, remaining: 1, stopped: false }
      // 保护返送的设施等待态，避免正常时钟在点击前自动续运。
      game.station.cells.find(cell => cell.kind === 'life-support')!.enabled = false
    }
    state.playerStation = game
  }
  const save = serializeSaveFile(state, Date.now())
  loadSaveFile(save)
  return { state, shipId, minerId, save, announcement: ANNOUNCEMENTS[0]?.id ?? '' }
}
