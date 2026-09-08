/**
 * 进港自动卸货（2026-09-08 船长定：任何舰船进港即自动整仓卸货入仓库）+ 指定船卸货工具。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { advanceGame } from '../src/engine'
import { startExpedition } from '../src/expedition'
import { unloadCargoOfShipToWarehouse, countWare, cargoOfShip } from '../src/inventory'
import { startTransitHome } from '../src/location'
import { anomaly, makeTestCtx, moduleDef } from './helpers'

/** 可稳胜的武装沙猫 + 带缴获的本地目标 */
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
  })

  it('指定船整仓卸货工具：只动该船货仓', () => {
    const { state } = armedHome()
    const other = Object.keys(state.fleet).find((id) => id !== state.shipId)!
    state.fleet[other]!.cargo['ore-b'] = 12
    const moved = unloadCargoOfShipToWarehouse(state, other)
    expect(moved).toBe(12)
    expect(cargoOfShip(state, other)['ore-b'] ?? 0).toBe(0)
    expect(countWare(state, 'ore-b')).toBe(12)
    expect(cargoOfShip(state, state.shipId)).toEqual({}) // 驾驶船不受影响
  })
})
