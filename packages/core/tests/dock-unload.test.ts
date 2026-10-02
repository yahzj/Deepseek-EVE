/**
 * 进港自动卸货（2026-09-08 船长定：任何舰船进港即自动整仓卸货入仓库）+ 指定船卸货工具。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext, StationSiteDef } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { advanceGame } from '../src/engine'
import { startExpedition } from '../src/expedition'
import { unloadCargoOfShipToWarehouse, countWare, cargoOfShip } from '../src/inventory'
import { advanceTransit, startTransitHome } from '../src/location'
import { anomaly, makeTestCtx, moduleDef } from './helpers'

/** 可稳胜的武装磷虾 + 带缴获的本地目标 */
function armedHome(): { state: GameState; ctx: SimContext } {
  const tur = moduleDef('tur-b', 'turret', 0.5, {
    maxRangeM: 4000,
    minRangeM: 0,
    hitRate: 0.9,
    falloff: 0.3,
    reloadMs: 1200,
    dmgMult: 4,
  })
  const ctx: SimContext = makeTestCtx({
    modules: [tur],
    anomalies: [anomaly('ano-w', 'galaxy-hub', { threat: 1, reward: 1_000, loot: [{ itemId: 'min-a', units: 10 }] })],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 11 })
  state.wallet.isk = 200_000
  state.warehouse.items['ammo-kinetic-l'] = 2_000
  addModule(state, 'tur-b', 1)
  expect(fitModule(state, 'tur-b', ctx).ok).toBe(true)
  return { state, ctx }
}

describe('进港自动卸货', () => {
  it('悬赏胜利自动返航到港：缴获自动卸入物品仓库', () => {
    const { state, ctx } = armedHome()
    expect(startExpedition(state, 'ano-w', ctx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, ctx) // 打赢（结算在 chunk 末尾）
    advanceGame(state, 125_000, ctx) // 本地悬赏返港段 120s
    expect(state.expedition.active).toBe(false)
    expect(cargoOfShip(state, state.shipId)['min-a'] ?? 0).toBe(0) // 已自动卸货
    expect(countWare(state, 'min-a')).toBeGreaterThanOrEqual(10)
    expect(state.logs.some((l) => l.text.includes('自动卸入物品仓库'))).toBe(true)
  })

  it('显式返航（野外回港）：到港即自动整仓卸货', () => {
    const { state, ctx } = armedHome()
    state.awayGalaxy = 'galaxy-far'
    state.fleet[state.shipId]!.cargo['ore-a'] = 30
    expect(startTransitHome(state, ctx).ok).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(cargoOfShip(state, state.shipId)['ore-a'] ?? 0).toBe(0)
    expect(countWare(state, 'ore-a')).toBe(30)
    /** 母港那条（`.040`）同样是「槽译文 ＋ 槽内参数」两步渲染：本槽是 `{p3}` ⇒ 要 `p3p1`（2026-10-02 修） */
    const log = state.logs.find((l) => l.textId === 'core.location.040')
    expect(log, '没有已建成副站 ⇒ 走「自『X』归来」那条').toBeDefined()
    expect(log!.textParams?.p3Id).toBe('core.location.037')
    expect(log!.textParams?.p3p1).toBe((30).toLocaleString('zh-CN'))
  })

  it('指定船整仓卸货工具：只动该船货仓', () => {
    const { state, ctx } = armedHome()
    const other = Object.keys(state.fleet).find((id) => id !== state.shipId)!
    state.fleet[other]!.cargo['ore-b'] = 12
    const moved = unloadCargoOfShipToWarehouse(state, ctx, other)
    expect(moved).toBe(12)
    expect(cargoOfShip(state, other)['ore-b'] ?? 0).toBe(0)
    expect(countWare(state, 'ore-b')).toBe(12)
    expect(cargoOfShip(state, state.shipId)).toEqual({}) // 驾驶船不受影响
  })
})

/**
 * **两条玩家可见漏出的回归门**（**2026-10-02 船长转玩家报障**）——都出自 `bbdc41ac`：
 * 它把 `dockUnloadNote()` 的返回从字符串改成对象（两步渲染），**没把调用点跟全** ⇒
 * ① 给了槽译文 `p2Id`/`p3Id` 的两处**漏喂槽内参数** ⇒ 玩家看到 `（{p1} 单位）`；
 * ② 另外 4 处还在 `${unloadNote}` 插值对象 ⇒ 玩家看到 `[object Object]`。
 */
describe('进港日志的参数供给（防漏出回归）', () => {
  /** 一座「已建成」的副站（galaxyId = 母港 ⇒ 返航目标就是它） */
  const station: StationSiteDef = {
    id: 'st-dock',
    name: '红环前哨站',
    galaxyId: 'galaxy-hub',
    standingReq: 0,
    tiers: [{ name: '档1', bill: [{ itemId: 'min-a', count: 100 }], unlockDesc: '测试' }],
    introDialogueId: null,
    doneDialogueId: null,
    description: '测试建站点',
  }

  it('副站停靠那条（core.location.039）带齐槽内参数 —— 漏了玩家就看到原样的 {p1}', () => {
    const ctx: SimContext = makeTestCtx({ stations: [station] })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 11 })
    state.stationSites['st-dock'] = { stage: 1, delivered: {} } // stage ≥ tiers.length ⇒ 已建成
    state.awayGalaxy = 'galaxy-far'
    state.fleet[state.shipId]!.cargo['ore-a'] = 30
    expect(startTransitHome(state, ctx).ok).toBe(true)
    const log = state.logs.find((l) => l.textId === 'core.location.039')
    expect(log, '应当走「已即时停靠副站」那一支').toBeDefined()
    expect(log!.textParams?.p2Id).toBe('core.location.037')
    /**
     * 渲染层按「**槽号 ＋ 占位符名**」取槽内值：本槽是 `{p2}`，它的槽译文自己带 `{p1}`
     * ⇒ 必须由 `p2p1` 供给（同族写法 = `events.ts` 的 `p2Id` + `p2p1`）。
     */
    expect(log!.textParams?.p2p1, '槽内参数漏喂 ⇒ 中文界面原样显示「（{p1} 单位）」').toBe((30).toLocaleString('zh-CN'))
    expect(log!.text, '正文是 core 记的中文原串，本来就不该有占位符').not.toContain('{p1}')
    expect(log!.text).toContain('货仓已自动卸入物品仓库')
  })

  it('在途到港那条日志不得把对象插进正文（同类漏出的另一面：[object Object]）', () => {
    const { state, ctx } = armedHome()
    state.awayGalaxy = 'galaxy-far'
    state.fleet[state.shipId]!.cargo['ore-a'] = 12
    const t = state.transit
    t.active = true
    t.fromGalaxy = 'galaxy-far'
    t.toGalaxy = 'galaxy-hub'
    t.legMs = 1_000
    t.finishAtGameMs = state.gameMs // 已到点 ⇒ 本拍到站
    t.delivery = null
    advanceTransit(state, ctx)
    const all = state.logs.map((l) => l.text).join('\n')
    expect(all, '`${unloadNote}` 插值对象会印成 [object Object]').not.toContain('[object Object]')
    expect(all).toContain('货仓已自动卸入物品仓库')
  })
})
