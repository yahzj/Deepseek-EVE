/**
 * **货柜开箱的随机种子口径**（2026-09-22 船长令：「所有货柜的开启，能否采用随机数种子固定？」
 * ＋「**允许玩家通过改变开箱顺序来微调**」）。
 *
 * 口径：种子 = `hash(存档种子, 第 N 次货柜拆解)`（`N` = 全局货柜拆解计数，四种货柜混算、存存档）；
 *   拆解**不消费 `state.rng`** ⇒
 *   ① 开箱前去干别的（跑商/打架/事件）**不影响**本箱结果（防刷）；
 *   ② 读档重开 ⇒ `N` 回到同一值 ⇒ 同一箱结果相同（**刷不了**）；
 *   ③ **先开哪一箱由玩家决定** ⇒ 顺序仍能微调结果（船长要的）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import {
  wormholeFamilyPoolOf,
  wormholeUnboxRoll,
  WORMHOLE_MILITARY_BOX_ID,
  WORMHOLE_VALUABLES_BOX_ID,
} from '../src/wormholeSalvage'

const ctx = buildSimContext()
/** 一箱的签名（内容 + 件数 + 来源池），用于"同 N 同结果"的逐字比对 */
const sigOf = (state: ReturnType<typeof createInitialState>, box: string): string => JSON.stringify(wormholeUnboxRoll(state, ctx, box))

describe('货柜开箱 · 种子固定（存档种子 + 第 N 次拆解）', () => {
  it('同一 (存档种子, N) ⇒ 逐字同结果（读档重开也一致）', () => {
    const a = createInitialState({ nowWallMs: 0, seed: 42 })
    const b = createInitialState({ nowWallMs: 0, seed: 42 })
    expect(a.rng.seed).toBe(b.rng.seed)
    for (let i = 0; i < 12; i++) {
      expect(sigOf(a, 'box-relic-a'), `第 ${i} 抽应逐字一致`).toBe(sigOf(b, 'box-relic-a'))
    }
    // "读档重开"：克隆一份回到同一 N，再抽一次 ⇒ 与原来那次相同
    const c = createInitialState({ nowWallMs: 0, seed: 42 })
    const first = sigOf(c, 'box-relic-a')
    const reloaded = createInitialState({ nowWallMs: 0, seed: 42 })
    expect(sigOf(reloaded, 'box-relic-a')).toBe(first)
  })

  it('不同 N ⇒ 结果会变（顺序可微调：序位不同，开出的东西不同）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 99 })
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(sigOf(state, 'box-relic-a'))
    expect(seen.size, '60 个不同序位不该给出同一种结果').toBeGreaterThan(3)
    // 同一个 seed + 同一个 N、但"中间先开了别的货柜"⇒ 落在不同 N 上 ⇒ 可微调
    const s1 = createInitialState({ nowWallMs: 0, seed: 99 })
    const s2 = createInitialState({ nowWallMs: 0, seed: 99 })
    sigOf(s2, WORMHOLE_VALUABLES_BOX_ID) // s2 先开一箱别的 ⇒ 序位前进一格
    expect(sigOf(s1, 'box-relic-a')).not.toBe(sigOf(s2, 'box-relic-a'))
  })

  it('拆解**不消费全局随机流**（开箱前去干别的，不影响本箱）', () => {
    const a = createInitialState({ nowWallMs: 0, seed: 5 })
    const b = createInitialState({ nowWallMs: 0, seed: 5 })
    // b 先"干点别的"：把全局流推进 100 次（模拟跑商 / 事件 / 战斗）
    for (let i = 0; i < 100; i++) b.rng.count += 1
    expect(a.rng.count).not.toBe(b.rng.count)
    // 两边都还没开过箱 ⇒ N 都是 0 ⇒ 结果必须一致
    expect(sigOf(a, 'box-relic-a')).toBe(sigOf(b, 'box-relic-a'))
    // 且开箱本身不推进全局流
    const before = a.rng.count
    sigOf(a, 'box-relic-a')
    expect(a.rng.count, '开箱不许动 count（防刷的关键）').toBe(before)
    // 但拆解计数前进（本用例先后抽了两次 ⇒ N = 2）
    expect(a.rng.box).toBe(2)
  })

  it('四种货柜混算同一条拆解计数（安全 / 图纸 / 贵重品 / 军用）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 8 })
    expect(state.rng.box ?? 0).toBe(0)
    sigOf(state, 'box-relic-a')
    sigOf(state, WORMHOLE_VALUABLES_BOX_ID)
    sigOf(state, WORMHOLE_MILITARY_BOX_ID)
    sigOf(state, 'box-bp-shallow')
    expect(state.rng.box, '四条拆解 ⇒ N = 4（混算一条序列）').toBe(4)
  })

  it('抽取池与权重一字不动（结果仍必须落在该池里）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 2024 })
    const pool = wormholeFamilyPoolOf(ctx, 'A')
    const inPool = new Set<string>([...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints, ...(pool.drones ?? [])])
    for (let i = 0; i < 120; i++) {
      const r = wormholeUnboxRoll(state, ctx, 'box-relic-a')
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      expect(inPool.has(r!.itemId), `第 ${i} 抽落到了族池外：${r!.itemId}`).toBe(true)
    }
  })
})
