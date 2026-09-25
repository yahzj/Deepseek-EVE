/**
 * **稀有订单的「数字稀有度 → 刷新权重」四档阶梯**（⟪**2026-09-25 船长令**⟫：
 * 「**2~5稀有度的稀有订单，权重调整为 1/0.5/0.2/0.05**」）。
 *
 * 本文件钉两件事：
 * (a) **四个默认值**（`DEFAULT_BALANCE.market.rareTier3/4/5Weight` = 0.5 / 0.2 / 0.05，
 *     档 2 隐含 ×1）——**含「档 5 首次有系数」这条修复**；
 * (b) **映射与单调性**：档 2 > 3 > 4 > 5（`rareTierWeight` 把档次正确接到 `balance` 上）。
 *
 * ⚠ **为什么单开一个文件**（而不是写进 `market.test.ts`）：那边的两个档位用例会
 * `ctx.balance.market.rareTier3Weight = w` 直接改值，而 `makeTestCtx` 的 `balance` **就是
 * `DEFAULT_BALANCE` 本人（无深拷贝）** ⇒ 改的是**模块级共享对象**、会**跨用例泄漏**。
 * 我第一版把本用例写进那个文件，读到的是被上一个用例改成 1 的权重（命中数 150 vs 162，与
 * 0.5 > 0.2 相反）——查了一轮才发现是污染。vitest 默认**按文件隔离** ⇒ 本文件读到的是干净默认值。
 * （顺带记一笔：`makeTestCtx` 不深拷贝 balance 是个**全局隐患**，建议单独立项收口。）
 *
 * 背景：立此阶梯之前，`rareTierWeight` 只特判档 3/档 4，**档 5 落 `else` 拿 ×1**（与大众档同频）
 * ⇒ 实测 `bp-shieldfield-3`（档 5）**68 窗 ≈11.4h** 反而比 `bp-shieldfield-2`（档 4，**214 窗 ≈35.7h**）
 * 常见 3 倍：档位越高越常见，与"稀有度"语义相反，而**此前没有任何用例盯着档 5**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { DEFAULT_BALANCE } from '../src/balance'
import { createInitialState } from '../src/state'
import { ensureMarket, slowSupplyDraw } from '../src/market'
import { makeTestCtx, moduleDef } from './helpers'

const TIERS = [2, 3, 4, 5] as const

describe('稀有订单 · 数字稀有度四档权重（2026-09-25 船长令）', () => {
  it('**默认值 = 1 / 0.5 / 0.2 / 0.05**（档 5 首次有系数；档 2 隐含 ×1）', () => {
    expect(DEFAULT_BALANCE.market.rareTier3Weight, '档 3').toBe(0.5)
    expect(DEFAULT_BALANCE.market.rareTier4Weight, '档 4').toBe(0.2)
    expect(DEFAULT_BALANCE.market.rareTier5Weight, '档 5').toBe(0.05)
    // 数据侧上下文拿到的也必须是同一组数（市场与界面同源）
    const bal = buildSimContext().balance.market
    expect([bal.rareTier3Weight, bal.rareTier4Weight, bal.rareTier5Weight]).toEqual([0.5, 0.2, 0.05])
  })

  it('映射与单调性：档 2 > 档 3 > 档 4 > 档 5（命中数随权重严格递减）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 20260925 })
    const ctx = makeTestCtx({
      marketGoods: TIERS.map((t) => ({
        key: `mod-t${t}`,
        kind: 'module' as const,
        refId: `mod-t${t}`,
        rarity: 'rare' as const,
        basePrice: 10_000,
        demandMultiplier: 0.65,
        rarityTier: t,
      })),
      modules: TIERS.map((t) => moduleDef(`mod-t${t}`, 'turret', 0)),
    })
    /**
     * ⚠ 这里**显式写死四个权重**（而不吃默认值）：本文件虽然隔离，但显式设定能让本用例
     * 只测「映射 + 单调性」这一件事，将来调数不会连带红（默认值由上面那条用例单独钉）。
     */
    ctx.balance.market.rareTier3Weight = 0.5
    ctx.balance.market.rareTier4Weight = 0.2
    ctx.balance.market.rareTier5Weight = 0.05
    ensureMarket(state, ctx)
    const hits: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 }
    for (let i = 0; i < 500; i++) {
      /** ⚠ **两面簿都要清**：只清卖盘的话，上一窗的买盘还在 ⇒ 新卖单若低于买盘最高价会被
       *  `npcPushSell` 转进"内部消化队列"（不入簿）⇒ 计数被那条旁路污染。 */
      for (const t of TIERS) {
        state.market.npcSell[`mod-t${t}`] = []
        state.market.npcBuy[`mod-t${t}`] = []
      }
      slowSupplyDraw(state, ctx, i * 600_000)
      for (const t of TIERS) hits[t] += state.market.npcSell[`mod-t${t}`]!.length
    }
    expect(hits[2], '档 2 应当常出').toBeGreaterThan(0)
    expect(hits[5], '**档 5 现在有自己的系数 ⇒ 必须出得来**（改前它是 ×1、与档 2 同频）').toBeGreaterThan(0)
    expect(hits[2], `档 2 > 档 3（${hits[2]} vs ${hits[3]}）`).toBeGreaterThan(hits[3]!)
    expect(hits[3], `档 3 > 档 4（${hits[3]} vs ${hits[4]}）`).toBeGreaterThan(hits[4]!)
    expect(hits[4], `档 4 > 档 5（${hits[4]} vs ${hits[5]}）`).toBeGreaterThan(hits[5]!)
    // 与理论占比同量级（1/0.5/0.2/0.05，Σ=1.75 ⇒ 57.1% / 28.6% / 11.4% / 2.9%），宽界防噪声
    const total = hits[2]! + hits[3]! + hits[4]! + hits[5]!
    expect(hits[2]! / total).toBeGreaterThan(0.45)
    expect(hits[2]! / total).toBeLessThan(0.7)
    expect(hits[5]! / total, '档 5 占不到 1 成就对').toBeLessThan(0.1)
  })
})
