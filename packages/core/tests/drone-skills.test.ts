/**
 * 无人机线新技能（2026-09-10 船长拍板）：
 * - 无人机打击学（rank4）：单发 +4%/级（与作战学乘算）
 * - 无人机耐久学（rank2）：三层血 +4%/级（满级 +20%，"全血条"）
 * - 无人机强化学（rank4）：三层血再 +6%/级（满级再 +30%，与耐久学**乘算** → 双满 ×1.56）
 * - 无人机回收学（rank3）：战后损坏回收率 20% → 最高 50%（2026-09-10 船长：基础 10%→20%）
 * - 无人机规避学（rank4）：闪避 +2%/级（满级 +10%，相对乘算，封顶 90%）
 * 数值接线在 core/combat.ts（DRONE_SKILL 常量），文案 ⟦…⟧ 在 data/skills.ts。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { advanceBattleFor, createPlayerSpec, droneRecoveryRate, startBattleFor, waveGapTotalMs } from '../src/combat'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-sentinel'
const HIGH = 'ano-vault-sentinel'

function makeState(seed = 3, load: Record<string, number> = { 'drone-heavy': 4, 'drone-sentry': 6 }): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const entry = state.fleet[uid]!
  entry.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    mid: ['mod-shield-kin-2', 'mod-gyro-2'],
    low: ['mod-armor-kin-2', 'mod-armor-plate-2'],
  }
  entry.droneLoad = { ...load }
  return state
}

function specOf(state: GameState) {
  return createPlayerSpec(state, ctx, state.shipId)!
}

describe('无人机线新技能（2026-09-10 船长）', () => {
  it('打击学：单发 +4%/级，与作战学乘算（满级两者 = ×1.25 ×1.20）', () => {
    // 本局高槽 = 甲板×2 + 导控×2（Σ导控 +0.8 → ×1.8）；船体专属加成 王鲭 +12%
    const base = makeState()
    expect(specOf(base).weapons.find((w) => w.src === 'drone')!.shotDmg).toBe(Math.round(12 * 2 * 1.8 * 1.12))
    const mid = makeState()
    mid.skills.trained['drone-warfare'] = 5 // ×1.25
    mid.skills.trained['drone-strike'] = 3 // ×1.12
    expect(specOf(mid).weapons.find((w) => w.src === 'drone')!.shotDmg).toBe(
      Math.round(12 * 2 * 1.8 * 1.12 * 1.25 * 1.12),
    )
    const full = makeState()
    full.skills.trained['drone-warfare'] = 5
    full.skills.trained['drone-strike'] = 5 // ×1.20
    expect(specOf(full).weapons.find((w) => w.src === 'drone')!.shotDmg).toBe(
      Math.round(12 * 2 * 1.8 * 1.12 * 1.25 * 1.2),
    )
  })

  it('耐久学（rank2）：三层血 +4%/级，满级 +20%（全血条）', () => {
    const base = makeState()
    const b0 = startBattleFor(base, ctx, base.shipId, HIGH, 0)!
    const heavyPool0 = Object.values(b0.dronePools!).find((p) => p.artId === 'drone-heavy')!
    expect(heavyPool0.h).toBe(45) // 猎鹰结构 45（四型定位档）

    const trained = makeState()
    trained.skills.trained['drone-durability'] = 5
    const b1 = startBattleFor(trained, ctx, trained.shipId, HIGH, 0)!
    const heavyPool1 = Object.values(b1.dronePools!).find((p) => p.artId === 'drone-heavy')!
    expect(heavyPool1.h).toBe(Math.round(45 * 1.2))
    expect(heavyPool1.s).toBe(Math.round(30 * 1.2))
    expect(heavyPool1.a).toBe(Math.round(22 * 1.2)) // 全血条三层一起放大
  })

  it('强化学（rank4）：再 +6%/级、满级再 +30%，与耐久学乘算（双满 = ×1.56）', () => {
    const both = makeState()
    both.skills.trained['drone-durability'] = 5
    both.skills.trained['drone-reinforce'] = 5
    const b = startBattleFor(both, ctx, both.shipId, HIGH, 0)!
    const pool = Object.values(b.dronePools!).find((p) => p.artId === 'drone-heavy')!
    expect(pool.h).toBe(Math.round(45 * 1.2 * 1.3)) // 乘算口径：1.2 × 1.3 = 1.56
    const onlyReinforce = makeState()
    onlyReinforce.skills.trained['drone-reinforce'] = 5
    const b2 = startBattleFor(onlyReinforce, ctx, onlyReinforce.shipId, HIGH, 0)!
    expect(Object.values(b2.dronePools!).find((p) => p.artId === 'drone-heavy')!.h).toBe(Math.round(45 * 1.3))
  })

  it('规避学：闪避 +2%/级，满级 +10%（相对乘算，封顶 0.9）', () => {
    const base = makeState()
    const b0 = startBattleFor(base, ctx, base.shipId, HIGH, 0)!
    const heavy0 = Object.values(b0.dronePools!).find((p) => p.artId === 'drone-heavy')!
    expect(heavy0.evasion).toBeCloseTo(0.1, 6)

    const trained = makeState()
    trained.skills.trained['drone-evasion'] = 5
    const b1 = startBattleFor(trained, ctx, trained.shipId, HIGH, 0)!
    const heavy1 = Object.values(b1.dronePools!).find((p) => p.artId === 'drone-heavy')!
    expect(heavy1.evasion).toBeCloseTo(0.11, 6) // 0.10 × 1.10
  })

  it('回收学：回收率 20% → 每级 +6% → 满级封顶 50%', () => {
    const s0 = makeState()
    expect(droneRecoveryRate(s0)).toBeCloseTo(0.2, 6)
    const s1 = makeState()
    s1.skills.trained['drone-recovery'] = 3
    expect(droneRecoveryRate(s1)).toBeCloseTo(0.38, 6) // 0.20 + 0.18
    const s5 = makeState()
    s5.skills.trained['drone-recovery'] = 5
    expect(droneRecoveryRate(s5)).toBeCloseTo(0.5, 6)
  })

  it('耐久学显著减少战斗内损坏：同种子满级耐久 vs 无技能', () => {
    const run = (durLv: number): number => {
      const state = makeState(7)
      state.skills.trained['drone-durability'] = durLv
      const b = startBattleFor(state, ctx, state.shipId, HIGH, 0)!
      state.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(HIGH), ctx.balance.battle)
      advanceBattleFor(state, ctx, b, state.shipId, HIGH)
      return Object.values(b.droneLost ?? {}).reduce((s, n) => s + n, 0)
    }
    expect(run(5)).toBeLessThanOrEqual(run(0))
  })
})
