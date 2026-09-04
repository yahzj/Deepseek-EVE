/**
 * V12 性能回归：离线大推进下的战斗结算不卡顿。
 * - 构造 12 场 1v3（带双僚机）战斗连续打完（每场给足时间到 10min 上限附近），
 *   断言总墙钟 < 1500ms（宽松防 CI 抖动）且每场步数在守卫内（40k guard 已有）。
 * - 主控链路含 去程→开战→战斗→结算（含远征状态机），贴近真实离线场景。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startExpedition } from '../src/expedition'
import { anomaly, makeTestCtx, ship } from './helpers'

function bossAnomaly(name: string): ReturnType<typeof anomaly> {
  const a = anomaly(name, 'galaxy-hub', { threat: 60, reward: 500_000 })
  return { ...a, tactic: 'brawl' as const, defProfile: 'armor' as const, escorts: 2 }
}

describe('V12 战斗性能回归', () => {
  it('12 场 1v3 连续离线推进：总墙钟在宽松上限内且全部结束', () => {
    const start = performance.now()
    let finished = 0
    for (let i = 0; i < 12; i++) {
      const ctx = makeTestCtx({
        anomalies: [bossAnomaly(`ano-perf-${i}`)],
        ships: [ship('bulk', { hullHp: 400, shieldHp: 150, armorHp: 200, cpu: 400 })],
      })
      const state = createInitialState({ nowWallMs: 0, seed: 1000 + i })
      state.wallet.isk = 5_000_000
      state.fleet['bulk'] = { durability: 1, cargo: {}, fitted: { miner: null, cargo: null, turret: null, shield: null, armor: null, propulsion: null } }
      state.shipId = 'bulk'
      state.skills.trained['gunnery'] = 5
      expect(startExpedition(state, `ano-perf-${i}`, ctx).ok).toBe(true)
      // 模拟 8 小时离线一次性推进（同帧：去程→开战→打完→返航→到家）
      advanceGame(state, 8 * 60 * 60_000, ctx)
      expect(state.expedition.active).toBe(false)
      finished += 1
    }
    const elapsed = performance.now() - start
    expect(finished).toBe(12)
    expect(elapsed).toBeLessThan(1_500) // 12 场打完总耗时上限（宽松）
  })
})
