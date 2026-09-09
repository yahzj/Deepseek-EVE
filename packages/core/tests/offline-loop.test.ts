/**
 * 离线结算 · 重复清剿（重复清剿）离线续跑（2026-09-08 玩家反馈：清剿期间离线无战斗无收益）。
 * 在线自动再出发由心跳驱动，离线原为大推进不触发——现按分片推进并在片边界同条件尝试再出发。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { simulateOffline } from '../src/simulation'
import { anomaly, makeTestCtx, moduleDef } from './helpers'

describe('离线结算：重复清剿续跑', () => {
  it('清剿开启且空闲时离线按分片自动再出发：多轮战斗有战果入账，开关保持', () => {
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
      anomalies: [anomaly('ano-w', 'galaxy-hub', { threat: 1, reward: 1_000 })],
    })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 11 })
    state.wallet.isk = 200_000
    state.warehouse.items['ammo-kinetic-l'] = 2_000
    addModule(state, 'tur-b', 1)
    expect(fitModule(state, 'tur-b', ctx).ok).toBe(true)
    state.autoLoopAnomalyId = 'ano-w' // 开启重复清剿（本地目标）
    const walletBefore = state.wallet.isk

    // 离线 20 分钟：应自动打多轮（本地目标：战斗 + 120s 返港 + 冷却后自动再出发）
    simulateOffline(state, 5_000_000, 5_000_000 + 20 * 60_000, ctx)

    expect(state.wallet.isk).toBeGreaterThan(walletBefore + 2_000) // ≥3 轮战果入账
    expect(state.autoLoopAnomalyId).toBe('ano-w') // 未因耐久/货仓/弹药耗尽停环
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })
})
