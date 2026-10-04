import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { FIRST_TASKS, claimableFirstTasks, visibleFirstTasks } from '../src/firstTasks'
import { claimFirstTask, grantStartRewardsForCurrent } from '../src/firstRewards'
import { createInitialState } from '../src/state'
import { advanceComms } from '../src/comms'
import { advanceHauling, startHauling, stopHauling } from '../src/hauling'
import { deliverStationResources, billNeedOf } from '../src/station'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
function tailState() {
  const state = createInitialState({ nowWallMs: 0, seed: 7, prologue: true })
  state.onboarding.step = 99
  state.modeChosen = true
  for (const def of FIRST_TASKS.slice(0, 11)) state.importantTasks[def.id] = { done: true }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  grantStartRewardsForCurrent(state, ctx)
  return state
}

describe('教程末段真实入口与存档往返', () => {
  it('运输：未建站不放行，实际交齐红环材料后往返一趟可领', () => {
    const state = tailState()
    expect(startHauling(state, null, 'site-redring', ctx).ok).toBe(false)
    const site = ctx.stations.get('site-redring')!
    // 隔离夹具只提供建材与在场位置，施工、运输和点领均走真实入口。
    state.awayGalaxy = site.galaxyId
    for (let tier = 0; tier < site.tiers.length; tier++) {
      for (const item of site.tiers[tier]!.bill) {
        const need = billNeedOf(state, site, tier, item.itemId)
        state.warehouse.items[item.itemId] = need
        expect(deliverStationResources(state, ctx, site.id, item.itemId, need).ok).toBe(true)
      }
    }
    expect(state.stationSites[site.id]!.stage).toBe(site.tiers.length)
    state.awayGalaxy = null
    state.dockedSite = null
    expect(startHauling(state, null, site.id, ctx).ok).toBe(true)
    expect(claimableFirstTasks(state, ctx).some((d) => d.id === 'first-haul')).toBe(false)
    advanceHauling(state, state.hauling.legMs, ctx)
    expect(claimableFirstTasks(state, ctx).some((d) => d.id === 'first-haul')).toBe(false)
    advanceHauling(state, state.hauling.legMs, ctx)
    expect(state.firstStats?.haulTrips).toBe(1)
    expect(claimFirstTask(state, ctx, 'first-haul').ok).toBe(true)
    advanceComms(state, ctx)
    expect(state.commsDelivered?.['first-haul']).toBeDefined()
    expect(Object.values(state.fleet).some((ship) => ship.defId === 'sh-flyingfish')).toBe(true)
    expect(state.hauling.active).toBe(true)
    expect(stopHauling(state, ctx).ok).toBe(true)
  })

  it('虫洞：累计 39 不放行，累计 40 即可领取，未进洞也满足', () => {
    const state = tailState()
    state.standings.dsi = 0
    state.standingsEarned = { dsi: 39 }
    expect(claimFirstTask(state, ctx, 'first-wormhole').ok).toBe(false)
    state.standingsEarned.dsi = 40
    expect(state.wormhole.run).toBeNull()
    expect(state.firstStats?.wormholeRuns ?? 0).toBe(0)
    expect(claimFirstTask(state, ctx, 'first-wormhole').ok).toBe(true)
    expect(state.wormholeStock).toHaveLength(2)
    advanceComms(state, ctx)
    expect(state.commsDelivered?.['first-wormhole']).toBeDefined()
    expect(visibleFirstTasks(state).map((d) => d.id)).toEqual(['first-haul'])
    const loaded = loadSaveFile(serializeSaveFile(state, 1))
    expect(loaded).not.toBeNull()
    if (!loaded) throw new Error('合成任务档读取失败')
    const restored = loaded.state
    expect(restored.importantTasks['first-wormhole']?.done).toBe(true)
    expect(claimFirstTask(restored, ctx, 'first-wormhole').ok).toBe(false)
    expect(restored.wormholeStock).toHaveLength(2)
    expect(restored.commsDelivered?.['first-wormhole']).toBeDefined()
  })
})
