/**
 * **贡献占比的 BOSS 权重**（**2026-09-28 船长令**：
 * 「**贡献权重要进行倾斜，BOSS输出的贡献占总贡献的60%**」）。
 *
 * 公式（单点 `weekendContributionShareAt`）：
 * ```
 * boss  = clamp01(旗舰HpDone ÷ 旗舰HpMax)      // 玩家对母舰的实际输出占比（玩家优先口径）
 * clear = 玩家投入 ÷（玩家投入 ＋ NPC 铺底）     // 清缴那一份（原口径未动）
 * share = 0.6 × boss ＋ 0.4 × clear
 * ```
 *
 * 本文件钉五件事：① 没打 BOSS ⇒ 上限 0.4（船长选了"不为占位族开特例"）· ② 打满 BOSS 的 0.6 与
 * 清缴的 0.4 各是多少 · ③ BOSS 那份按**实际输出**算（不是"击杀了就算满"）· ④ 章鱼人不挤占玩家那份 ·
 * ⑤ **三处同源**（结算计划的占比 ＝ 快照的占比，声望也按同一个数算）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  WEEKEND_CONTRIBUTION_BOSS_WEIGHT,
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendContributionShareAt,
  weekendContributionTier,
} from '../src/weekendEvent'
import { weekendSettleAndGrant, weekendSettlePlanOf } from '../src/weekendBattle'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'

type Ev = NonNullable<GameState['weekendEvent']>

/** 一场刚开局的入侵（`nowWallMs = 0` 时 NPC 还没铺底 ⇒ 清缴那半只由玩家投入决定，读数好算） */
function invaded(hp?: { done: number; max?: number; octopus?: number }): { s: GameState; ev: Ev } {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  s.debugQuick = true
  const ev = {
    seq: 1,
    startedAtWallMs: 0,
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  } as unknown as Ev
  if (hp !== undefined) {
    ev.flagshipHpMax = hp.max ?? WEEKEND_FLAGSHIP_POOL_HP
    ev.flagshipHpDone = hp.done
    if (hp.octopus !== undefined) ev.octopusHpDone = hp.octopus
  }
  s.weekendEvent = ev
  return { s, ev }
}

describe('贡献占比 · BOSS 权重 60%（2026-09-28 船长令）', () => {
  it('权重常量 = 0.6（BOSS 那份），其余 0.4 归清缴', () => {
    expect(WEEKEND_CONTRIBUTION_BOSS_WEIGHT).toBe(0.6)
  })

  it('① 没打 BOSS（或本族没有共享池）⇒ **上限 0.4**，清缴打满也只有 0.4', () => {
    const { s, ev } = invaded()
    ev.contributed[GID] = 1 // 玩家把外围打满 ⇒ clear = 1
    expect(weekendContributionShareAt(s, ev, 0), '0.6×0 ＋ 0.4×1').toBeCloseTo(0.4, 6)
    /** ⚠ 船长当日裁「不管 ACG 族」⇒ 不为"没有池子的族"开特例分支（占位族天生拿不到那 0.6） */
    expect(weekendContributionTier(weekendContributionShareAt(s, ev, 0)).tier, '封在 C 档（0.4 ≥ 0.2）').toBe('C')
  })

  it('② BOSS 打满 ⇒ 那 0.6 到手（清缴为 0 时占比就是 0.6）', () => {
    const { s, ev } = invaded({ done: WEEKEND_FLAGSHIP_POOL_HP })
    expect(weekendContributionShareAt(s, ev, 0), '0.6×1 ＋ 0.4×0').toBeCloseTo(0.6, 6)
    expect(weekendContributionTier(weekendContributionShareAt(s, ev, 0)).tier, '0.6 ≥ 0.5 ⇒ B').toBe('B')
  })

  it('③ BOSS 那份按**实际输出占比**算（打了 70% 就是 0.7，不是"击杀了就算满"）', () => {
    const { s, ev } = invaded({ done: Math.round(WEEKEND_FLAGSHIP_POOL_HP * 0.7) })
    expect(weekendContributionShareAt(s, ev, 0), '0.6×0.7 = 0.42').toBeCloseTo(0.42, 6)
    /** 打满 vs 打七成 ⇒ 差 0.18，正好是 BOSS 那一项的差额 */
    const full = invaded({ done: WEEKEND_FLAGSHIP_POOL_HP })
    expect(weekendContributionShareAt(full.s, full.ev, 0) - weekendContributionShareAt(s, ev, 0)).toBeCloseTo(0.18, 6)
  })

  it('④ 章鱼人不挤占玩家那份（玩家优先口径）：玩家 70% ＋ 章鱼 90% ⇒ 玩家仍算 0.7', () => {
    const { s, ev } = invaded({ done: Math.round(WEEKEND_FLAGSHIP_POOL_HP * 0.7), octopus: Math.round(WEEKEND_FLAGSHIP_POOL_HP * 0.9) })
    expect(weekendContributionShareAt(s, ev, 0), '仍是 0.6×0.7').toBeCloseTo(0.42, 6)
  })

  it('⑤ 三处同源：结算计划的占比 = 快照的占比，声望按同一个数算（round(占比×15)）', () => {
    const { s, ev } = invaded({ done: WEEKEND_FLAGSHIP_POOL_HP })
    ev.contributed[GID] = 1 // clear = 1 ⇒ share = 0.6 + 0.4 = 1.0
    const share = weekendContributionShareAt(s, ev, 0)
    expect(share).toBeCloseTo(1, 6)
    expect(weekendSettlePlanOf(s, ev, 0).share, '结算计划读同一个单点').toBe(share)
    expect(weekendSettlePlanOf(s, ev, 0).tier, '满占比 ⇒ A 档').toBe('A')
    ev.endedAtWallMs = 1_000_000
    expect(weekendSettleAndGrant(s, ctx, 1_000_000)).not.toBeNull()
    const snap = s.weekendLastResult!
    expect(snap.share, '快照的占比 = 同一个数').toBe(share)
    expect(snap.standing, '声望 = round(占比 × 15)').toBe(Math.round(share * 15))
  })
})
