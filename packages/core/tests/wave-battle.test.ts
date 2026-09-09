/**
 * 多波次战斗（2026-09-09，docs/design/wave-battles-20260909.md）：
 * AnomalyDef.waves 分批续刷（同场清空 → 下一波；无喘息）；零迁移（无 waves = 单波现行为）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { startBattleFor, advanceBattleFor } from '../src/combat'
import { anomaly, makeTestCtx } from './helpers'

function world(waves: { units: number; hpShare: number }[] | undefined) {
  const ctx: SimContext = makeTestCtx({
    anomalies: [
      {
        ...anomaly('ano-wave', 'galaxy-hub', { threat: 10, tactic: 'brawl' }),
        ...(waves ? { waves } : {}),
      },
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  return { state, ctx }
}

describe('多波次战斗（2026-09-09）', () => {
  it('两波：首波清空后续刷第二波（无喘息）→ 末波清空判胜；日志提示波次', () => {
    const { state, ctx } = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    expect(battle).not.toBeNull()
    expect(battle.waveIdx ?? 0).toBe(0)
    expect(battle.units['foe-0']).toBeDefined() // 首波沿用旧命名
    expect(battle.units['w1-foe-0']).toBeUndefined() // 第二波尚未生成
    // 大步推进：时间给足 → 波 1 清空 → 切波（battle.waveIdx=1、补刷 w1-*）→ 末波清空判胜
    state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.ended).toBe('me')
    expect(battle.waveIdx).toBe(1)
    expect(battle.units['w1-foe-0']).toBeDefined()
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(true)
  })

  it('零迁移：无 waves 的悬赏维持单波（不切波、无波次日志、tag 不变）', () => {
    const { state, ctx } = world(undefined)
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.ended).toBe('me')
    expect(battle.waveIdx).toBeUndefined()
    expect(battle.units['w1-foe-0']).toBeUndefined()
    expect(state.logs.some((l) => l.text.includes('波来袭'))).toBe(false)
  })

  it('波表分血：首波单位血 ≈ 单波全量 × hpShare（总预算不变）', () => {
    // 单波对照：threat 10 无覆写 → foeHpOfThreat 全量
    const one = world(undefined)
    const b1 = startBattleFor(one.state, one.ctx, one.state.shipId, 'ano-wave', 0)!
    const fullHp = b1.units['foe-0']!.hp.s + b1.units['foe-0']!.hp.a + b1.units['foe-0']!.hp.h
    // 两波 × 0.5：首波主舰 = 全量 × 0.5（威胁份额不变）
    const two = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const b2 = startBattleFor(two.state, two.ctx, two.state.shipId, 'ano-wave', 0)!
    const firstHp = b2.units['foe-0']!.hp.s + b2.units['foe-0']!.hp.a + b2.units['foe-0']!.hp.h
    expect(firstHp).toBeCloseTo(fullHp * 0.5, 6)
  })
})
