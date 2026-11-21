import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { PlayerStationGame } from '../src/playerStation/gameTypes'
import {
  ANCIENT_STATION_GALAXY_ID,
  ANCIENT_STATION_ID,
  ancientStationDiscovered,
  reconcileAncientStationDiscovery,
} from '../src/playerStation/discovery'
import {
  createPlayerStation, createStationPopulation, createStationTraining, createStationRefining,
  createStationMining, createStationResearch, createStationDevelopment, createStationAcademy,
  createStationManufacturing, createStationCrew, createStationSecurity, createStationCampaign,
} from '../src/playerStation/index'
import { galaxy, makeTestCtx } from './helpers'

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  const ctx = makeTestCtx({ galaxies: [galaxy(ANCIENT_STATION_GALAXY_ID)] })
  return { state, ctx }
}

function attachStation(state: GameState): PlayerStationGame {
  const station: PlayerStationGame = {
    version: 1, discovered: false, active: false,
    station: createPlayerStation(), population: createStationPopulation(), training: createStationTraining(),
    refining: createStationRefining(), mining: createStationMining(), research: createStationResearch(),
    development: createStationDevelopment(), academy: createStationAcademy(), manufacturing: createStationManufacturing(),
    crew: createStationCrew(), security: createStationSecurity(), campaign: createStationCampaign(),
    shipLocks: {}, rewardedReportId: 0, guardServiceMs: 0,
    history: { refiningPeak: 0, manufacturingPeak: 0, crewGrowthPeak: 0, escortsReturned: 0, defensesWon: 0 },
  }
  state.playerStation = station
  return station
}

describe('古代休眠站发现', () => {
  it('站点标识与所在星系固定', () => {
    expect(ANCIENT_STATION_GALAXY_ID).toBe('galaxy-vault')
    expect(buildSimContext().galaxies.get(ANCIENT_STATION_GALAXY_ID)?.name).toBe('穹顶墓园')
    expect(ANCIENT_STATION_ID).toBe('ancient-hibernation-station')
  })

  it('图未全探索时不出现，只探索休眠站所在星系也不算发现', () => {
    const { state, ctx } = world()
    const station = attachStation(state)
    expect(ancientStationDiscovered(state, ctx)).toBe(false)
    state.exploredGalaxies = [ANCIENT_STATION_GALAXY_ID]
    reconcileAncientStationDiscovery(state, ctx)
    expect(ancientStationDiscovered(state, ctx)).toBe(false)
    expect(station.discovered).toBe(false)
  })

  it('当前全图探索后立即可见，视图不写状态，协调只置位已有站点', () => {
    const { state, ctx } = world()
    const station = attachStation(state)
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    const before = structuredClone(state)
    expect(ancientStationDiscovered(state, ctx)).toBe(true)
    expect(state).toEqual(before)
    reconcileAncientStationDiscovery(state, ctx)
    expect(state).toEqual({ ...before, playerStation: { ...before.playerStation, discovered: true } })
    expect(station.discovered).toBe(true)
    const after = structuredClone(state)
    reconcileAncientStationDiscovery(state, ctx)
    expect(state).toEqual(after)
  })

  it('无站点对象时可反推发现，但协调不初始化、不改变其他状态', () => {
    const { state, ctx } = world()
    delete state.playerStation
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    const before = structuredClone(state)
    expect(ancientStationDiscovered(state, ctx)).toBe(true)
    reconcileAncientStationDiscovery(state, ctx)
    expect(state.playerStation).toBeUndefined()
    expect(state).toEqual(before)
  })

  it('重复探索和未知星系即使凑足数量也不能绕过缺失星系', () => {
    const { state, ctx } = world()
    state.exploredGalaxies = Array.from({ length: ctx.galaxies.size + 2 }, () => ANCIENT_STATION_GALAXY_ID)
    state.exploredGalaxies.push('unknown-galaxy')
    expect(ancientStationDiscovered(state, ctx)).toBe(false)
    state.exploredGalaxies = [...ctx.galaxies.keys(), ANCIENT_STATION_GALAXY_ID, 'unknown-galaxy']
    expect(ancientStationDiscovered(state, ctx)).toBe(true)
  })

  it('未持久发现前扩充当前星图，新增星系也必须探索', () => {
    const { state, ctx } = world()
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    expect(ancientStationDiscovered(state, ctx)).toBe(true)
    const expanded = { ...ctx, galaxies: new Map([...ctx.galaxies, ['galaxy-new', galaxy('galaxy-new')]]) }
    expect(ancientStationDiscovered(state, expanded)).toBe(false)
    state.exploredGalaxies.push('galaxy-new')
    expect(ancientStationDiscovered(state, expanded)).toBe(true)
  })

  it('按当前星图键逐一核对，不依赖固定星系列表或休眠站所在星系', () => {
    const { state, ctx } = world()
    const custom = { ...ctx, galaxies: new Map([['custom-a', galaxy('value-a')], ['custom-b', galaxy('value-b')]]) }
    state.exploredGalaxies = ['value-a', 'value-b', ANCIENT_STATION_GALAXY_ID]
    expect(ancientStationDiscovered(state, custom)).toBe(false)
    state.exploredGalaxies = ['custom-a', 'custom-b']
    expect(ancientStationDiscovered(state, custom)).toBe(true)
  })

  it('空星图不触发发现', () => {
    const { state, ctx } = world()
    const station = attachStation(state)
    const empty = { ...ctx, galaxies: new Map() }
    state.exploredGalaxies = [ANCIENT_STATION_GALAXY_ID, 'unknown-galaxy']
    reconcileAncientStationDiscovery(state, empty)
    expect(ancientStationDiscovered(state, empty)).toBe(false)
    expect(station.discovered).toBe(false)
  })

  it('已发现状态持久，扩图、探索记录变化和空上下文均不隐藏', () => {
    const { state, ctx } = world()
    attachStation(state)
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    reconcileAncientStationDiscovery(state, ctx)
    state.exploredGalaxies = []
    const expanded = { ...ctx, galaxies: new Map([...ctx.galaxies, ['galaxy-new', galaxy('galaxy-new')]]) }
    for (const current of [ctx, expanded, { ...ctx, galaxies: new Map() }]) {
      reconcileAncientStationDiscovery(state, current)
      expect(ancientStationDiscovered(state, current)).toBe(true)
      expect(state.playerStation?.discovered).toBe(true)
    }
  })
})
