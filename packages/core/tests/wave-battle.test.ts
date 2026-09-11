/**
 * 多波次战斗（2026-09-09，docs/design/wave-battles-20260909.md）：
 * AnomalyDef.waves 分批续刷（同场清空 → 下一波；无喘息）；零迁移（无 waves = 单波现行为）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { startBattleFor, advanceBattleFor, createFoeSpecs } from '../src/combat'
import { anomaly, makeTestCtx } from './helpers'

function world(waves: { units: number; hpShare: number }[] | undefined) {
  // 2026-09-11 敌方远端衰减 0.3 → 0.5（敌人远距离更准）后，裸初始船（沙猫，无武器）扛不住威胁 10 的
  // brawl 卡；本文件测的是**波次机制**不是平衡，故把该卡的伤害压到 0.2（血/波表/战术全部照旧）。
  const ctx: SimContext = makeTestCtx({
    anomalies: [
      {
        ...anomaly('ano-wave', 'galaxy-hub', { threat: 10, tactic: 'brawl' }),
        foeDmgMul: 0.2,
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
    expect(battle.units['w1-foe-0']!.hpMax).toBeDefined() // 血条分母随单位写入
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
    // hpMax = 初始满血（UI 血条分母；此前缺失致波次单位血条为空）
    expect(b1.units['foe-0']!.hpMax).toEqual(b1.units['foe-0']!.hp)
    expect(b2.units['foe-0']!.hpMax).toEqual(b2.units['foe-0']!.hp)
  })

  it('多小队 tag 唯一（2026-09-09 修复）：首波 units=2 生成 foe-0 + w0-foe-1（不与 legacy 僚机撞名）', () => {
    const { ctx } = world(undefined)
    const bal = ctx.balance.battle
    const specs = createFoeSpecs(
      { ...anomaly('ano-wave', 'galaxy-hub', { threat: 10 }), waves: [{ units: 2, hpShare: 1 }] },
      bal,
      { units: 2 },
    )
    const tags = specs.map((s) => s.tag)
    expect(tags).toContain('foe-0')
    expect(tags).toContain('w0-foe-1')
    expect(new Set(tags).size).toBe(tags.length) // 无重复 tag
  })

  it('演出窗口（2026-09-09 船长反馈二轮）：波全灭后战斗时钟冻结等 waveEnterGapMs，窗口结束才刷下一波', () => {
    const { state, ctx } = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    const gap = Math.max(0, ctx.balance.battle.waveEnterGapMs ?? 0)
    expect(gap).toBeGreaterThan(0)
    // 白盒：把首波单位打成尸体 → 下一拍推进即应开窗口（战斗时钟冻结于 0，未步进过）
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.waveClearAt).toBe(battle.lastTickGameMs + gap)
    expect(battle.units['w1-foe-0']).toBeUndefined() // 窗口未走完：不刷下一波
    expect(state.logs.some((l) => l.text.includes('第 1/2 波已全灭'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(false)
    // 窗口内继续推进：仍不刷、战斗时钟不推进（演出时间不计 maxBattleMs 超时）
    state.gameMs = battle.waveClearAt! - 1
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.units['w1-foe-0']).toBeUndefined()
    expect(battle.ended).toBeNull()
    expect(battle.lastTickGameMs).toBe(0)
    // 越过窗口：立即补刷并清标记
    state.gameMs = battle.waveClearAt! + 100
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.waveIdx).toBe(1)
    expect(battle.waveClearAt).toBeUndefined()
    expect(battle.units['w1-foe-0']).toBeDefined()
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(true)
  })
})
