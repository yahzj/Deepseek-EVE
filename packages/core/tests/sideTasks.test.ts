/**
 * v24 任务中心·时效任务（资源 / 快递）测试——2026-09-05 船长拍板。
 *
 * 覆盖：窗口边界刷出 2 条（与市场同源）、到期整板替换、同 seed 双跑确定性、
 * 刷出时的市场影响（npcSell 削减 30% / pool.q 同扣 / shock +0.05 → 报价升高）、
 * 仓库足量完成扣货入账（其余任务不受影响）、库存不足拒绝、快递解锁前后、
 * 无声望变化、v23→v24 迁移与老档读入。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import {
  DEFAULT_BALANCE,
  advanceGame,
  advanceSideTasks,
  completeSideTask,
  courierTaskUnlocked,
  createInitialState,
  levelOf,
  loadSaveFile,
  marketQuote,
  serializeSaveFile,
} from '../src/index'
import { makeTestCtx } from './helpers'

/** 测试市场：恰好 2 种常驻池商品（item/poolTarget>0）——候选池=2 时每次必同时抽中两者，确定性最强 */
const ORE_GOOD = { key: 'it-ore-a', kind: 'item' as const, refId: 'ore-a', rarity: 'common' as const, basePrice: 12, poolTarget: 2_000, supplyFlow: 100 }
const MIN_GOOD = { key: 'it-min-a', kind: 'item' as const, refId: 'min-a', rarity: 'common' as const, basePrice: 8, poolTarget: 2_000, supplyFlow: 100 }

function makeWorld(): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed: 2024 })
  // 噪声关停（noiseStep=0）+ 随机事件关闭：市场窗口内各价格完全确定，便于公式断言
  const ctx = makeTestCtx({
    quietEvents: true,
    marketGoods: [ORE_GOOD, MIN_GOOD],
    balance: { ...DEFAULT_BALANCE, market: { ...DEFAULT_BALANCE.market, noiseStep: 0 } },
  })
  return { state, ctx }
}

/** 任务板的资源任务内容快照（测试比较用） */
function boardOf(state: GameState) {
  return state.sideTasks
}

/** 池商品在开盘/无扰动窗口下的最低供应价（base×1.06 取整，防与收购价同价；noiseStep=0 下确定） */
const SELL: Record<string, number> = { 'it-ore-a': 13, 'it-min-a': 9 }

describe('v24 时效任务：窗口刷新（与市场同源）', () => {
  it('同 seed 双跑：整板内容（id/need/reward）+ 市场副作用完全一致', () => {
    const a = makeWorld()
    const b = makeWorld()
    advanceGame(a.state, 61_000, a.ctx)
    advanceGame(b.state, 61_000, b.ctx)
    expect(boardOf(a.state)).toEqual(boardOf(b.state))
    expect(a.state.market.pools).toEqual(b.state.market.pools)
    expect(a.state.market.npcSell).toEqual(b.state.market.npcSell)
    expect(a.state.rng).toEqual(b.state.rng)
  })

  it('首个市场窗口边界后刷出 2 条资源任务：need 是 10 的倍数且 ≥10，reward 取整到整百并满足公式', () => {
    const { state, ctx } = makeWorld()
    expect(boardOf(state).resource).toHaveLength(0)
    expect(boardOf(state).window).toBe(0)
    marketQuote(state, ctx, 'it-ore-a') // 开盘（lastTick=0，首个窗口在 60s 边界）
    advanceGame(state, 61_000, ctx)
    const board = boardOf(state)
    expect(board.window).toBe(60_000)
    expect(board.resource).toHaveLength(2)
    const refIds = board.resource.map((t) => t.refId).sort()
    expect(refIds).toEqual(['min-a', 'ore-a']) // 候选池恰好 2 种 → 全部出现
    for (const t of board.resource) {
      expect(t.kind).toBe('resource')
      expect(t.id).toBeGreaterThan(0)
      expect(t.need).toBeGreaterThanOrEqual(10)
      expect(t.need % 10).toBe(0)
      const sell = SELL[t.goodKey]!
      expect(sell).toBeGreaterThan(0)
      expect(t.rewardIsk).toBe(Math.floor((t.need * sell * 0.96) / 100) * 100)
      expect(t.rewardIsk % 100).toBe(0)
    }
    // 未刷出前的占位语义：剩余时间 > 0（距下一窗口 120s）
    expect(board.courier).toHaveLength(0)
  })

  it('到期整板替换：下一边界旧任务全部清空、重新刷出两条（新 id），同窗口内不做部分刷新', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx) // 窗口 1 → 首批
    const first = boardOf(state).resource.map((t) => ({ ...t }))
    expect(first).toHaveLength(2)
    // 同窗口内（未到 120s）：板不变（无部分刷新/清空）
    advanceGame(state, 30_000, ctx)
    expect(boardOf(state).resource).toEqual(first)
    // 越过下一边界（到 120s+）：整板替换为新任务
    advanceGame(state, 30_000, ctx)
    const second = boardOf(state).resource
    expect(second).toHaveLength(2)
    expect(boardOf(state).window).toBe(120_000)
    expect(second.every((t) => t.id > first[0]!.id)).toBe(true) // id 单调递增（seq 不复用）
    expect(second.map((t) => t.refId).sort()).toEqual(['min-a', 'ore-a'])
  })

  it('快递任务：未建成副站不刷（分类空）；建成后下一窗口同刷 2 条（同池机制）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const site = {
      id: 'site-x',
      name: '测试站',
      galaxyId: 'galaxy-hub',
      standingReq: 0,
      acceptItemIds: ['ore-a'],
      tiers: [
        { name: '奠基', count: 10, unlockDesc: 'x' },
        { name: '完善', count: 10, unlockDesc: 'x' },
        { name: '建成', count: 10, unlockDesc: 'x' },
      ],
      introDialogueId: null,
      doneDialogueId: null,
      description: '测试建站点',
    }
    const ctx = makeTestCtx({
      quietEvents: true,
      stations: [site],
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: { ...DEFAULT_BALANCE, market: { ...DEFAULT_BALANCE.market, noiseStep: 0 } },
    })
    expect(courierTaskUnlocked(state, ctx)).toBe(false)
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx) // 首窗：仅资源任务
    expect(boardOf(state).resource).toHaveLength(2)
    expect(boardOf(state).courier).toHaveLength(0)
    // 建成一座副站（stage ≥ tiers.length）
    state.stationSites['site-x'] = { stage: 3, delivered: {} }
    expect(courierTaskUnlocked(state, ctx)).toBe(true)
    advanceGame(state, 60_000, ctx) // 下一窗口：快递开刷
    expect(boardOf(state).courier).toHaveLength(2)
    for (const t of boardOf(state).courier) {
      expect(t.kind).toBe('courier')
      expect(t.need).toBeGreaterThanOrEqual(10)
      expect(t.need % 10).toBe(0)
      expect(t.rewardIsk).toBe(Math.floor((t.need * SELL[t.goodKey]! * 0.96) / 100) * 100)
    }
  })
})

describe('v24 时效任务：完成 / 拒绝 / 声望', () => {
  it('仓库足量完成：扣货、现金入账、该条下板；同窗口其余任务不受影响；不给声望', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx)
    const task = boardOf(state).resource.find((t) => t.refId === 'ore-a')!
    const other = boardOf(state).resource.find((t) => t.refId !== 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000 // 必然足量（need ≤ 60）
    state.wallet.isk = 0
    state.standings['dsi'] = 3
    const beforeIsk = state.wallet.isk
    const r = completeSideTask(state, ctx, 'resource', task.id)
    expect(r.ok).toBe(true)
    expect(state.warehouse.items['ore-a']).toBe(10_000 - task.need)
    expect(state.wallet.isk).toBe(beforeIsk + task.rewardIsk)
    expect(state.standings).toEqual({ dsi: 3 }) // 不给声望
    expect(boardOf(state).resource.some((t) => t.id === task.id)).toBe(false)
    expect(boardOf(state).resource.some((t) => t.id === other.id)).toBe(true) // 其余不受影响
  })

  it('库存不足拒绝完成：提示还差多少，不扣货、不入账、任务仍在板上', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx)
    const task = boardOf(state).resource.find((t) => t.refId === 'min-a')!
    state.warehouse.items['min-a'] = task.need - 1 // 差 1
    state.wallet.isk = 0
    const before = { ware: state.warehouse.items['min-a'], isk: state.wallet.isk }
    const r = completeSideTask(state, ctx, 'resource', task.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('还差 1')
    expect(state.warehouse.items['min-a']).toBe(before.ware)
    expect(state.wallet.isk).toBe(before.isk)
    expect(boardOf(state).resource.some((t) => t.id === task.id)).toBe(true)
  })

  it('已下板/已过期任务拒绝完成（窗口刷新后被替换的任务不存在）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx)
    const task = boardOf(state).resource[0]!
    advanceGame(state, 60_000, ctx) // 下一边界 → 整板替换
    const r = completeSideTask(state, ctx, 'resource', task.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})

describe('v24 时效任务：刷出时的市场影响（防"买来秒交"）', () => {
  it('削减 npcSell 合计 30%（逐单从尾扣至 0）、pool.q 同扣、shock +0.05（上限 0.4）；reward 按刷出时 bestSell×0.96', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a') // 开盘（池 q = 2000、shock = 0）
    // 手工簿面：单一供应单（qty 1000）→ 削减 300；屏蔽窗口补单干扰（直接调用推进器，不跨窗口）
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    const qBefore = state.market.pools['it-ore-a']!.q
    const levelBefore = levelOf(state, ctx, 'it-ore-a')
    state.market.lastTickGameMs = ctx.balance.market.tickMs // 假想已越过一个窗口边界
    advanceSideTasks(state, ctx)
    // 板已开：两条资源任务（候选池 = 2）
    expect(boardOf(state).window).toBe(60_000)
    expect(boardOf(state).resource).toHaveLength(2)
    for (const t of boardOf(state).resource) {
      expect(t.rewardIsk).toBe(Math.floor((t.need * 15 * 0.96) / 100) * 100) // 按刷出时 bestSell=15 计
    }
    // 削减：1000 → 700（从尾单扣至 0 移除）；pool.q 同步扣 300；shock +0.05
    const sellTotal = state.market.npcSell['it-ore-a']!.reduce((s, o) => s + o.qty, 0)
    expect(sellTotal).toBe(700)
    expect(state.market.pools['it-ore-a']!.q).toBe(qBefore - 300)
    expect(state.market.pools['it-ore-a']!.shock).toBeCloseTo(0.05, 9)
    // 冲击上限：连刷 20 次不越过 0.4
    for (let i = 0; i < 20; i++) {
      state.market.lastTickGameMs += ctx.balance.market.tickMs
      advanceSideTasks(state, ctx)
    }
    expect(state.market.pools['it-ore-a']!.shock).toBeLessThanOrEqual(0.4)
    // 报价升高：池被扣 + 冲击抬价 → levelOf 高于刷出前
    expect(levelOf(state, ctx, 'it-ore-a')).toBeGreaterThan(levelBefore)
  })

  it('不触碰玩家收购簿 npcBuy 与订单簿 orders（只模拟 NPC 买走供应侧）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    const buyBefore = state.market.npcBuy['it-ore-a']!.map((o) => ({ ...o }))
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.lastTickGameMs = ctx.balance.market.tickMs
    advanceSideTasks(state, ctx)
    expect(state.market.npcBuy['it-ore-a']).toEqual(buyBefore)
    expect(state.orders).toHaveLength(0)
  })
})

describe('v24 时效任务：存档 v23→v24 迁移 / 老档读入 / 往返', () => {
  it('v23 老档（无 sideTasks 字段）读入：版本升 24、补空板；随后正常按窗口刷出', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const raw = state as unknown as Record<string, unknown>
    delete raw.sideTasks
    raw.version = 23
    const loaded = loadSaveFile(serializeSaveFile(raw as unknown as GameState, 0))
    expect(loaded.state.version).toBe(24)
    expect(loaded.state.sideTasks).toEqual({ seq: 1, window: 0, resource: [], courier: [] })
    expect(loaded.state.wallet.isk).toBe(10_000) // 其余字段无损
    const ctx = makeTestCtx({
      quietEvents: true,
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: { ...DEFAULT_BALANCE, market: { ...DEFAULT_BALANCE.market, noiseStep: 0 } },
    })
    marketQuote(loaded.state, ctx, 'it-ore-a')
    advanceGame(loaded.state, 61_000, ctx)
    expect(loaded.state.sideTasks.resource).toHaveLength(2)
  })

  it('已刷出任务板的往返保存：seq/window/任务完整保留', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx)
    const expectBoard = boardOf(state)
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.sideTasks).toEqual(expectBoard)
    // 往返后仍可完成（同窗口内）
    const task = loaded.state.sideTasks.resource[0]!
    loaded.state.warehouse.items[task.refId] = 10_000
    expect(completeSideTask(loaded.state, ctx, 'resource', task.id).ok).toBe(true)
  })
})
