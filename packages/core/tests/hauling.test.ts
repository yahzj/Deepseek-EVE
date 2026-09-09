/**
 * 运输任务（2026-09-09 船长定稿）：两站间真实航程往返循环、虚拟满载不产真实货物。
 * 覆盖：开始前置（建成/停靠/互斥）、自动清仓、真实航程两段结算与自动续段、到站即停、
 * 换驾驶终止、各作业互斥、存档往返与旧档缺字段默认。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startHauling, stopHauling, haulLegReward } from '../src/hauling'
import { cargoCapacityM3Of } from '../src/inventory'
import { startMining } from '../src/mining'
import { startExpedition } from '../src/expedition'
import { changeShip, addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { makeTestCtx } from './helpers'
import type { StationSiteDef } from '../src/types'

/** 迷你建成副站：挂在 galaxy-far，两档（100 / 150），收 ore-a */
function siteDef(): StationSiteDef {
  return {
    id: 'site-test',
    name: '测试前哨站',
    galaxyId: 'galaxy-far',
    standingReq: 0,
    acceptItemIds: ['ore-a'],
    tiers: [
      { name: '奠基', count: 100, unlockDesc: '施工推进' },
      { name: '建成', count: 150, unlockDesc: '建成并入空间站清单' },
    ],
    introDialogueId: 'dlg-intro',
    doneDialogueId: null,
    description: '测试站点',
  }
}

function world() {
  const ctx: SimContext = makeTestCtx({ stations: [siteDef()], quietEvents: true })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  state.stationSites['site-test'] = { stage: 2, delivered: {} } // 建成
  return { state, ctx }
}

/** 本测试世界的单段报酬（hub⇄far 标称 2 分钟） */
function legReward(state: GameState, ctx: SimContext): number {
  return haulLegReward(cargoCapacityM3Of(state, ctx, state.shipId), 2)
}

describe('运输任务（2026-09-09）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    const w = world()
    state = w.state
    ctx = w.ctx
  })

  it('开始前置：目标未建成 / 同站 / 野外 / 作业中 → 拒绝', () => {
    state.stationSites['site-test'] = { stage: 1, delivered: {} } // 修建中
    expect(startHauling(state, 'site-test', ctx).ok).toBe(false)
    state.stationSites['site-test'] = { stage: 2, delivered: {} }
    // 目标 = 出发站
    expect(startHauling(state, null, ctx).ok).toBe(false) // 母港出发、目标母港
    // 野外不能接
    state.awayGalaxy = 'galaxy-far'
    expect(startHauling(state, 'site-test', ctx).ok).toBe(false)
    state.awayGalaxy = null
    // 作业中不能接（先开一场远征再尝试接运输）
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(startHauling(state, 'site-test', ctx).ok).toBe(false)
  })

  it('开始成功：船上货物自动卸入仓库；虚拟满载出发（真实航程 = 2 分钟段）', () => {
    state.fleet[state.shipId]!.cargo['ore-a'] = 50
    const cap = cargoCapacityM3Of(state, ctx, state.shipId)
    const r = startHauling(state, 'site-test', ctx)
    expect(r.ok).toBe(true)
    expect(state.hauling.active).toBe(true)
    expect(state.hauling.toSiteId).toBe('site-test')
    expect(state.hauling.legMinutes).toBe(2)
    expect(state.hauling.legMs).toBeGreaterThan(0)
    // 货仓清空 → 仓库（真实货物不随虚拟任务走）
    expect(Object.keys(state.fleet[state.shipId]!.cargo)).toHaveLength(0)
    expect(state.warehouse.items['ore-a'] ?? 0).toBe(50)
    expect(state.dockedSite).toBeNull() // 出发：离开停靠
    expect(state.awayGalaxy).toBe('galaxy-hub')
    expect(state.hauling.phaseAccMs).toBe(0)
    expect(cap).toBeGreaterThan(0)
    expect(legReward(state, ctx)).toBeGreaterThan(0)
  })

  it('真实航程往返：每段到站结算报酬并立即续下一段（2 分钟一段、两向都结）', () => {
    startHauling(state, 'site-test', ctx)
    const reward = legReward(state, ctx)
    const w0 = state.wallet.isk
    advanceGame(state, 120_000, ctx) // 第一段到站（母港 → 前哨站）→ 立即装载返程
    expect(state.hauling.active).toBe(true)
    expect(state.hauling.toSiteId).toBeNull() // 已换向驶回母港
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.wallet.isk - w0).toBe(reward)
    advanceGame(state, 120_000, ctx) // 第二段到站（前哨站 → 母港）→ 再驶往前哨站
    expect(state.hauling.toSiteId).toBe('site-test')
    expect(state.awayGalaxy).toBe('galaxy-hub')
    expect(state.wallet.isk - w0).toBe(reward * 2)
    expect(state.logs.filter((l) => l.text.includes('运输任务 · 已运抵')).length).toBe(2)
  })

  it('停止 = 完成当前段到站即止（停在到站），不再续段；重复停止拒绝', () => {
    startHauling(state, 'site-test', ctx)
    advanceGame(state, 60_000, ctx) // 航行中
    expect(stopHauling(state).ok).toBe(true)
    expect(stopHauling(state).ok).toBe(false) // 已安排在到站停
    const w0 = state.wallet.isk
    advanceGame(state, 120_000, ctx)
    expect(state.hauling.active).toBe(false)
    expect(state.dockedSite).toBe('site-test') // 停在到站点
    expect(state.wallet.isk - w0).toBe(legReward(state, ctx)) // 本段照常结算
    const w1 = state.wallet.isk
    advanceGame(state, 240_000, ctx)
    expect(state.wallet.isk).toBe(w1) // 不再有后续报酬
  })

  it('换驾驶 = 立即终止（无惩罚）；任务中不可开采/出击', () => {
    startHauling(state, 'site-test', ctx)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(false)
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(false)
    state.fleet[state.shipId]!.cargo['ore-a'] = 3 // 换船终止时虚拟货无残留语义：旧船货物不动
    const other = addShipToFleet(state, 'sandcat2')
    expect(changeShip(state, other, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    expect(state.shipId).toBe(other)
  })

  it('存档往返保留任务；旧档缺 hauling 字段 → 默认空态（零迁移）', () => {
    startHauling(state, 'site-test', ctx)
    advanceGame(state, 30_000, ctx)
    const text = serializeSaveFile(state, 1000)
    const back = loadSaveFile(text)
    expect(back.state.hauling).toEqual(state.hauling)
    // 旧档：无 hauling 字段
    const raw = JSON.parse(text) as { state: Record<string, unknown> }
    delete raw.state.hauling
    const legacy = loadSaveFile(JSON.stringify(raw))
    expect(legacy.state.hauling.active).toBe(false)
    expect(legacy.state.hauling.legMs).toBe(0)
  })
})
