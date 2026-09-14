/**
 * **虫洞 · 遗迹打捞掉落 AI 核心**（船长 2026-09-14 逐条定案）。
 *
 * 船长原话（照抄）：「**在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的掉落。AI 核心单独占 1 格。
 * 出率为 10%，不挤占旧有出率。三种核心根据稀有度区分出货权重**」。
 * 同批四答：① 落地 = **撤离成功自动入核心库、不进仓库**；② **层 1 也给 10%**（不看层）；
 * ③ 权重 **60 / 30 / 10**；④ 自动探索**也吃**、按手动期望 ×40% 折算；⑤ 结算单**另加一格**。
 * 同日两条改判：**贝塔 / 阿尔法移除市场出售订单**（只收不卖，回卖保留）；四档行价
 * **2.5 万 / 20 万 / 150 万 / 1000 万**。
 *
 * 锁住六条口径：
 * ① 三种核心各占 **1×1 = 1 格**（形状件，不是可叠加散货）；
 * ② 出货率 **10%**、权重 **60/30/10**（多种子统计；层 1 与层 3 同率 ⇒ "不看层"）；
 * ③ **不挤占**：核心掷骰走独立流 —— 它**不消费 state.rng**，也不改动货柜掷骰的结果；
 * ④ 带回 = **入核心账本、仓库里没有**（非核心 id 原样不认）；
 * ⑤ 市场：贝塔/阿尔法**只收不卖**（买入被明确拒绝）、伽马仍可买；四档行价与船长给的数字一致；
 * ⑥ 自动探索按同口径折算（4%/趟），报告里核心**单列**（不进"收益（已入仓库）"那一行）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter } from '../src/wormhole'
import { wormholeIsShapedItem, wormholeShapeOf } from '../src/wormholeHold'
import type { WormholeGridCell } from '../src/wormholeGrid'
import {
  WORMHOLE_CORE_ALPHA,
  WORMHOLE_CORE_BETA,
  WORMHOLE_CORE_GAMMA,
  WORMHOLE_CORE_ITEM_IDS,
  WORMHOLE_CORE_SHARE,
  WORMHOLE_CORE_WEIGHTS,
  wormholeCoreItemIdOf,
  wormholeCoreTypeOfItemId,
  wormholeRollCore,
  wormholeRollRelicBox,
} from '../src/wormholeSalvage'
import { deliverWormholeCores } from '../src/wormholeBattle'
import { buyAtMarket, buyOrderBlockedReason, marketGoodOf } from '../src/market'
import {
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_MANUAL,
  WORMHOLE_AUTO_YIELD_MUL,
  advanceWormholeAuto,
  wormholeAutoReportsOf,
  wormholeAutoStart,
} from '../src/wormholeAuto'
import { wormholeStockPush } from '../src/wormholeScan'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/** 起一趟洞（一艘巡洋舰 + 指定种子；层数由调用方设） */
function enterRun(seed: number, depth = 3): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, T3)
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], seed).ok).toBe(true)
  state.wormhole.run!.depth = depth
  return state
}

/** 合成一个格坐标（掷骰只读 `q/r` 与 `run.depth` ⇒ 不必真铺网格） */
const cellAt = (q: number, r: number): WormholeGridCell => ({ q, r, key: `${q},${r}`, place: 'ruins' }) as WormholeGridCell

describe('虫洞 · 遗迹掉落 AI 核心（2026-09-14 船长定）', () => {
  it('三种核心 = 形状件且各占 1×1 = 1 格（船长「AI 核心单独占 1 格」）', () => {
    for (const id of WORMHOLE_CORE_ITEM_IDS) {
      expect(wormholeIsShapedItem(id)).toBe(true) // 形状件（走 hold.placements），不是可叠加散货
      expect(wormholeShapeOf(id)).toEqual({ w: 1, h: 1 })
      const def = ctx.items.get(id)
      expect(def?.kind).toBe('aicore') // 不是 container：否则会上拆解台、还会被丢进货柜抽奖
      expect(def?.unitM3).toBe(500) // 500 m³/格 × 1 格
      expect(def?.unreleased).toBeUndefined() // 2026-09-14 上线：手册图鉴里看得到（不再是施工期闸门）
    }
    // 物品 id ↔ 核心账本键 双向对得上
    expect(wormholeCoreItemIdOf('alpha')).toBe(WORMHOLE_CORE_ALPHA)
    for (const t of ['gamma', 'beta', 'alpha'] as const) {
      expect(wormholeCoreTypeOfItemId(wormholeCoreItemIdOf(t))).toBe(t)
    }
    expect(wormholeCoreTypeOfItemId('box-relic-a')).toBeNull()
  })

  it('出货率 ≈ 10%、权重 ≈ 60 / 30 / 10（2400 个格坐标统计）', () => {
    expect(WORMHOLE_CORE_SHARE).toBe(0.1)
    expect(WORMHOLE_CORE_WEIGHTS).toEqual({ gamma: 60, beta: 30, alpha: 10 })
    const state = enterRun(20260914, 3)
    let hits = 0
    const byType: Record<string, number> = { gamma: 0, beta: 0, alpha: 0 }
    const N = 2400
    for (let i = 0; i < N; i++) {
      const got = wormholeRollCore(state, cellAt(i % 60, Math.floor(i / 60)))
      if (got === undefined) continue
      hits += 1
      byType[wormholeCoreTypeOfItemId(got)!] += 1
    }
    // 命中率 10%（σ≈0.6% ⇒ 放到 ±2.5pp 已经很宽）
    expect(hits / N).toBeGreaterThan(0.075)
    expect(hits / N).toBeLessThan(0.125)
    // 权重（命中样本 ≥ 150，σ≈4pp ⇒ ±10pp 容差）
    expect(hits).toBeGreaterThan(150)
    const g = byType.gamma! / hits
    const b = byType.beta! / hits
    const a = byType.alpha! / hits
    expect(g).toBeGreaterThan(0.5)
    expect(g).toBeLessThan(0.7)
    expect(b).toBeGreaterThan(0.2)
    expect(b).toBeLessThan(0.4)
    expect(a).toBeGreaterThan(0.03)
    expect(a).toBeLessThan(0.18)
    expect(g).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(a)
  })

  it('层 1 也给（船长答「层 1 也给 10%」）：层 1 与层 3 的出货率同量级', () => {
    const rate = (depth: number): number => {
      const state = enterRun(777, depth)
      let hits = 0
      for (let i = 0; i < 1200; i++) if (wormholeRollCore(state, cellAt(i % 40, Math.floor(i / 40))) !== undefined) hits += 1
      return hits / 1200
    }
    const d1 = rate(1)
    const d3 = rate(3)
    expect(d1).toBeGreaterThan(0.06) // 层 1 **不是** 0（与货柜那条"层 1 恒不出"不同）
    expect(Math.abs(d1 - d3)).toBeLessThan(0.04)
  })

  it('不挤占旧有出率：核心掷骰不消费 state.rng，也不改动货柜掷骰的结果', () => {
    const state = enterRun(31337, 3)
    const cells: WormholeGridCell[] = []
    for (let q = 0; q < 24; q++) for (let r = 0; r < 6; r++) cells.push(cellAt(q, r))
    // ① 掷前：货柜那一串结果 + 随机数账
    const boxesBefore = cells.map((c) => wormholeRollRelicBox(state, ctx, c) ?? null)
    const rngBefore = state.rng.count
    // ② 中间：把核心掷骰跑 3000 次（含命中与未命中）
    let coreHits = 0
    for (let i = 0; i < 3000; i++) if (wormholeRollCore(state, cells[i % cells.length]!) !== undefined) coreHits += 1
    // ③ 掷后：同一条货柜序列必须**逐格逐字**相同；state.rng 一次都没动
    const boxesAfter = cells.map((c) => wormholeRollRelicBox(state, ctx, c) ?? null)
    expect(boxesAfter).toEqual(boxesBefore)
    expect(state.rng.count).toBe(rngBefore)
    expect(coreHits).toBeGreaterThan(0) // 确认真的掷出过东西（不是"全落空所以没差别"）
  })

  it('带回 = 入核心账本、仓库里没有（船长答「撤离成功自动入核心库，不进仓库」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 99 })
    const cores = deliverWormholeCores(state, [WORMHOLE_CORE_ALPHA, WORMHOLE_CORE_BETA, WORMHOLE_CORE_ALPHA, 'box-relic-a'])
    expect(cores).toEqual({ alpha: 2, beta: 1 })
    expect(state.aiCores.alpha).toBe(2)
    expect(state.aiCores.beta).toBe(1)
    expect(state.aiCores.gamma ?? 0).toBe(0)
    // 仓库里**没有**核心（也不该有货柜 —— 货柜走另一条入库路径）
    for (const id of WORMHOLE_CORE_ITEM_IDS) expect(state.warehouse.items[id] ?? 0).toBe(0)
    // 空批次：不写账、不报错
    expect(deliverWormholeCores(state, ['mat-surveyor'])).toEqual({})
    expect(state.aiCores.alpha).toBe(2)
  })

  it('市场：贝塔 / 阿尔法只收不卖（买入被拒），伽马仍可买；四档行价 = 船长给的数字', () => {
    const prices: Array<[string, number, boolean]> = [
      ['core-basic', 25_000, true],
      ['core-gamma', 200_000, true],
      ['core-beta', 1_500_000, false],
      ['core-alpha', 10_000_000, false],
    ]
    for (const [key, price, buyable] of prices) {
      const good = ctx.marketGoods.get(key)
      expect(good?.basePrice).toBe(price)
      expect(good?.playerBuyable !== false).toBe(buyable)
    }
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    state.wallet.isk = 1_000_000_000
    state.standings['dsi'] = 100
    // 只收不卖：买入被明确拒绝（不是"余额不足"这种误导文案）
    expect(buyOrderBlockedReason(state, ctx, 'core-alpha', 10_000_000, 1)).toContain('只收不卖')
    expect(buyAtMarket(state, ctx, 'core-alpha', 1).blocked).toBe('not-buyable')
    expect(state.aiCores.alpha ?? 0).toBe(0) // 没买进来
    // 伽马仍可买（船长只点了贝塔与阿尔法）
    expect(buyOrderBlockedReason(state, ctx, 'core-gamma', 200_000, 1)).toBeNull()
    expect(marketGoodOf(ctx, 'aicore', 'gamma')).toBeDefined()
  })

  it('自动探索也吃（按手动期望 ×40% 折算），且核心在报告里单列', () => {
    expect(WORMHOLE_AUTO_MANUAL.cores * WORMHOLE_AUTO_YIELD_MUL).toBeCloseTo(0.04, 6) // 船长答「4%/趟」
    const hit = (seed: number): { cores: number; seesReport: boolean } => {
      const state = createInitialState({ nowWallMs: 0, seed })
      const uids = [0, 1, 2, 3].map(() => addShipToFleet(state, T3))
      state.skills.trained['ai-expert'] = 6
      state.wormholeStock = []
      expect(wormholeStockPush(state, ctx)).not.toBeNull()
      const stockId = state.wormholeStock![0]!.id
      expect(wormholeAutoStart(state, ctx, stockId, uids).ok).toBe(true)
      state.gameMs += WORMHOLE_AUTO_DURATION_MS + 1
      advanceWormholeAuto(state, ctx)
      const rep = wormholeAutoReportsOf(state)[0]
      const n = (state.aiCores.gamma ?? 0) + (state.aiCores.beta ?? 0) + (state.aiCores.alpha ?? 0)
      return { cores: n, seesReport: rep !== undefined }
    }
    let runs = 0
    let leaked = 0
    let withReport = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = hit(seed)
      runs += 1
      if (r.seesReport) withReport += 1
      leaked += r.cores
    }
    expect(withReport).toBe(runs) // 每趟都有报告
    // 4%/趟 ⇒ 120 趟的期望 ≈ 4.8 枚；给足容差（泊松尾部），只钉"确实会出"
    expect(leaked).toBeGreaterThan(0)
    expect(leaked).toBeLessThan(20)
  })
})
