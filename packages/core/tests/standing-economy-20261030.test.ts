import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { HIGH_SEC_PENALTY, INVASION_BEACON_TYPES, useInvasionBeacon } from '../src/consumables'
import {
  WEEKEND_MIN_STANDING, WEEKEND_STANDING_MAX, WEEKEND_STANDING_BEACON,
  ensureWeekendEvent, weekendTick, weekendStandingGainOf, type WeekendEventState,
} from '../src/weekendEvent'
import { weekendSettleAndGrant } from '../src/weekendBattle'
import { weekendSettleCommsOf } from '../src/weekendComms'
import {
  PLUG_BLUEPRINT_COST, UNIVERSAL_BLACKBOX_COST, UNIVERSAL_BLACKBOX_ITEM_ID,
  exchangePlugBlueprint, exchangeUniversalBlackBox, plugExchangeRowsOf,
} from '../src/plugs'
import { standingOf, spendableStandingOf } from '../src/standing'
import { securityZoneOf } from '../src/securityZone'
import { WORMHOLE_SCAN_UNLOCK_STANDING } from '../src/wormholeScan'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { setStanding } from './helpers'

const ctx = buildSimContext()
const now = new Date(2026, 9, 30, 20).getTime()
const target = 'galaxy-vault'

function ready(earned = 60, spendable = 0) {
  const state = createInitialState({ nowWallMs: now, seed: 30 })
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  setStanding(state, 'dsi', earned)
  state.standings.dsi = spendable
  for (const { itemId } of INVASION_BEACON_TYPES) addWare(state, itemId, 1)
  return state
}

function event(): WeekendEventState {
  return { seq: 1, startedAtWallMs: now, coreId: target, peripheryIds: ['galaxy-redring'], family: 'H',
    contributed: { [target]: 1, 'galaxy-redring': 1 }, flagshipHpMax: 100, flagshipHpDone: 100 }
}

describe('声望经济 · 入侵累计门槛', () => {
  it('本批数值60/30/10/20/60；信号空间扫描仍为40', () => {
    expect([WEEKEND_MIN_STANDING, WEEKEND_STANDING_MAX, WEEKEND_STANDING_BEACON,
      PLUG_BLUEPRINT_COST, UNIVERSAL_BLACKBOX_COST]).toEqual([60, 30, 10, 20, 60])
    expect(WORMHOLE_SCAN_UNLOCK_STANDING).toBe(40)
  })

  it('自然入侵59不开、60即开，余额为零也能开；不足不取消已有局面', () => {
    const low = ready(59)
    expect(ensureWeekendEvent(low, ctx, now)).toBe(false)
    expect(low.weekendEvent).toBeUndefined()
    const met = ready()
    expect(ensureWeekendEvent(met, ctx, now)).toBe(true)
    const active = met.weekendEvent!
    setStanding(met, 'dsi', 0)
    expect(ensureWeekendEvent(met, ctx, now + 1000)).toBe(false)
    weekendTick(met, ctx, now + 1000, now)
    expect(met.weekendEvent).toBe(active)
    expect(active.endedAtWallMs).toBeUndefined()
  })

  for (const { itemId, familyId } of INVASION_BEACON_TYPES) {
    it.each([undefined, target])(`${itemId}，目标%s：59拒绝且旧账/库存/随机状态不动，60余额零成功`, galaxyId => {
      const low = ready(59)
      low.weekendEvent = { ...event(), endedAtWallMs: now }
      const before = structuredClone(low)
      expect(useInvasionBeacon(low, ctx, { itemId, galaxyId })).toMatchObject({ ok: false,
        errorId: 'core.market.039', errorParams: { p1: 60, p2: 59 } })
      expect(low).toEqual(before)
      const met = ready()
      expect(useInvasionBeacon(met, ctx, { itemId, galaxyId }).ok).toBe(true)
      expect(countWare(met, itemId)).toBe(0)
      expect(standingOf(met, 'dsi')).toBe(60)
      expect(spendableStandingOf(met, 'dsi')).toBe(0)
      expect(met.weekendEvent?.beaconLit).toBe(true)
      if (galaxyId) expect(met.weekendEvent?.coreId).toBe(galaxyId)
      if (familyId) expect(met.weekendEvent?.family).toBe(familyId)
    })
  }

  it('调试豁免累计门槛，但自然自动开场继续暂停', () => {
    const state = ready(0)
    state.debugQuick = true
    expect(ensureWeekendEvent(state, ctx, now)).toBe(false)
    expect(useInvasionBeacon(state, ctx, { galaxyId: target }).ok).toBe(true)
  })

  it('高安仍需可支配10：9拒绝、10成功，结束奖10使余额复原而累计增10', () => {
    const galaxyId = [...ctx.galaxies.keys()].find(id => id !== HOME_GALAXY_ID && securityZoneOf(ctx, id) === '高安')!
    expect(galaxyId).toBeTruthy()
    const state = ready(60, 9)
    const before = structuredClone(state)
    expect(useInvasionBeacon(state, ctx, { galaxyId })).toMatchObject({ ok: false, errorId: 'core.consumable.011' })
    expect(state).toEqual(before)
    state.standings.dsi = HIGH_SEC_PENALTY
    expect(useInvasionBeacon(state, ctx, { galaxyId }).ok).toBe(true)
    expect([spendableStandingOf(state, 'dsi'), standingOf(state, 'dsi')]).toEqual([0, 60])
    state.weekendEvent!.endedAtWallMs = now
    expect(weekendSettleAndGrant(state, ctx, now)).not.toBeNull()
    expect([spendableStandingOf(state, 'dsi'), standingOf(state, 'dsi')]).toEqual([10, 70])
  })
})

describe('声望经济 · 发奖与兑换', () => {
  it.each([[0, 0], [0.001, 1], [0.1, 3], [0.5, 15], [1, 30]])('自然贡献%s发%s，召唤仍固定10', (share, reward) => {
    expect(weekendStandingGainOf({}, share)).toBe(reward)
    expect(weekendStandingGainOf({ beaconLit: true }, share)).toBe(10)
  })

  it.each([false, true])('召唤=%s：结束实发、双账、快照、通讯相同，重复与读档不重发', beaconLit => {
    const state = ready()
    const reward = beaconLit ? 10 : 30
    state.weekendEvent = { ...event(), beaconLit, endedAtWallMs: now }
    expect(weekendSettleAndGrant(state, ctx, now)).not.toBeNull()
    expect([spendableStandingOf(state, 'dsi'), standingOf(state, 'dsi')]).toEqual([reward, 60 + reward])
    expect(state.weekendLastResult?.standing).toBe(reward)
    expect(weekendSettleCommsOf(state, ctx, state.weekendLastResult!).params?.p4).toBe(String(reward))
    const before = structuredClone(state)
    expect(weekendSettleAndGrant(state, ctx, now + 1)).toBeNull()
    expect(state).toEqual(before)
    const back = loadSaveFile(serializeSaveFile(state, now)).state
    const loaded = structuredClone(back)
    expect(weekendSettleAndGrant(back, ctx, now + 2)).toBeNull()
    expect(back).toEqual(loaded)
    // 已结算旧快照只保存原到账记录，不按新数值改写或追补。
    back.weekendLastResult!.standing = 15
    const old = loadSaveFile(serializeSaveFile(back, now)).state
    expect(weekendSettleAndGrant(old, ctx, now + 3)).toBeNull()
    expect(old.weekendLastResult?.standing).toBe(15)
    expect(standingOf(old, 'dsi')).toBe(60 + reward)
  })

  it('插件图纸19拒绝、20兑换即学会；展示价与命令同源，累计与既有物品保留', () => {
    const state = ready(60, 19)
    const row = plugExchangeRowsOf(state, ctx).find(row => !row.learned)!
    expect(row).toMatchObject({ cost: 20, affordable: false })
    const before = structuredClone(state)
    expect(exchangePlugBlueprint(state, ctx, row.moduleId)).toMatchObject({ ok: false, errorParams: { p2: 20, p3: 19 } })
    expect(state).toEqual(before)
    state.standings.dsi = 20
    expect(plugExchangeRowsOf(state, ctx).find(r => r.moduleId === row.moduleId)?.affordable).toBe(true)
    const inventory = structuredClone(state.warehouse)
    expect(exchangePlugBlueprint(state, ctx, row.moduleId).ok).toBe(true)
    expect(state.learnedRecipes).toContain(row.blueprintId)
    expect(state.warehouse).toEqual(inventory)
    expect([spendableStandingOf(state, 'dsi'), standingOf(state, 'dsi')]).toEqual([0, 60])
    const learned = structuredClone(state)
    expect(exchangePlugBlueprint(state, ctx, row.moduleId).ok).toBe(false)
    expect(state).toEqual(learned)
  })

  it.each([1, 2])('通用黑匣批量%s件：差1拒绝，按60逐件扣可支配，累计与原库存保留', count => {
    const price = 60 * count
    const state = ready(200, price - 1)
    addWare(state, UNIVERSAL_BLACKBOX_ITEM_ID, 2)
    const before = structuredClone(state)
    expect(exchangeUniversalBlackBox(state, count)).toMatchObject({ ok: false, errorParams: { p1: count, p2: price, p3: price - 1 } })
    expect(state).toEqual(before)
    state.standings.dsi = price
    expect(exchangeUniversalBlackBox(state, count)).toEqual({ ok: true, count })
    expect(countWare(state, UNIVERSAL_BLACKBOX_ITEM_ID)).toBe(2 + count)
    expect([spendableStandingOf(state, 'dsi'), standingOf(state, 'dsi')]).toEqual([0, 200])
  })
})
