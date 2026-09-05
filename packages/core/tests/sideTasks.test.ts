/**
 * v24 任务中心·时效任务（资源 / 快递）测试——2026-09-05 船长拍板；2026-09-06 修订：
 * 刷新节奏改为市场「补给刷新」周期（orderLifeMs.common = 20 分钟，与常驻订单寿命一致）——
 * 每个 20 分钟整点整板替换、每条任务只存活一轮；候选池按星图进度过滤
 * （未探索星系矿带产物不出现在候选，仓库已有/探索后放行）。
 * 2026-09-06 增量修订：奖励改"税前锚定"（资源 need×收购价×1.04 整百且 < need×供应价；
 * 快递 need×收购价×1.30 整百、无买货守卫）；快递真实航行投送（出发投送两步 + 到站自动结算）。
 *
 * 覆盖：20 分钟整点刷出 2 条（与常驻订单寿命同周期）、不足一周期不刷/跨过整点整板换 2 条、
 * 到期整板替换、同 seed 双跑确定性、刷出时的市场影响（npcSell 削减 30% / pool.q 同扣 /
 * shock +0.05 → 报价升高）、离线大步长只按末窗结算一次、仓库足量完成扣货入账
 * （其余任务不受影响）、库存不足拒绝、快递解锁前后、探索门槛（远处矿带星系未探索 → 不出候选）、
 * 无声望变化、税前锚定奖励公式与资源钳制、快递"出发投送"全流程（锁定扣货/投送中互斥/
 * 到站自动结算/整板刷新不影响/存档往返保真/老档无字段读入）、v23→v24 迁移与老档读入。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import {
  COURIER_TASK_MARGIN,
  DEFAULT_BALANCE,
  RESOURCE_TASK_MARGIN,
  advanceGame,
  advanceSideTasks,
  completeSideTask,
  courierDelivering,
  courierTaskUnlocked,
  createInitialState,
  levelOf,
  loadSaveFile,
  markExplored,
  marketQuote,
  serializeSaveFile,
  sideTaskBoard,
  sideTaskCandidateGoods,
  startCourierDelivery,
  startExpedition,
  startMining,
  travelLegMs,
  shortestTravelMinutes,
} from '../src/index'
import { belt, makeTestCtx, ore } from './helpers'

/** 本板周期 = 市场常驻订单寿命（20 分钟；与 ctx.balance.market.orderLifeMs.common 同源） */
const PERIOD = DEFAULT_BALANCE.market.orderLifeMs.common
/** 越过首个 20 分钟整点后多推进 1 秒（市场末窗 = PERIOD、gameMs = PERIOD + 1_000） */
const FIRST_OPEN_MS = PERIOD + 1_000

/** 测试市场：恰好 2 种常驻池商品（item/poolTarget>0）——候选池=2 时每次必同时抽中两者，确定性最强 */
const ORE_GOOD = { key: 'it-ore-a', kind: 'item' as const, refId: 'ore-a', rarity: 'common' as const, basePrice: 12, poolTarget: 2_000, supplyFlow: 100 }
const MIN_GOOD = { key: 'it-min-a', kind: 'item' as const, refId: 'min-a', rarity: 'common' as const, basePrice: 8, poolTarget: 2_000, supplyFlow: 100 }

/** 快速造一座 3 档副站（siteId/galaxyId 可配；测试里直接置 stage=3 视为已建成） */
function stationSite(id: string, galaxyId: string, name: string) {
  return {
    id,
    name,
    galaxyId,
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
}

function quietBalance(): typeof DEFAULT_BALANCE {
  return { ...DEFAULT_BALANCE, market: { ...DEFAULT_BALANCE.market, noiseStep: 0 } }
}

function makeWorld(): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed: 2024 })
  // 噪声关停（noiseStep=0）+ 随机事件关闭：市场窗口内各价格完全确定，便于公式断言
  const ctx = makeTestCtx({
    quietEvents: true,
    marketGoods: [ORE_GOOD, MIN_GOOD],
    balance: quietBalance(),
  })
  return { state, ctx }
}

/** 任务板的资源任务内容快照（测试比较用） */
function boardOf(state: GameState) {
  return state.sideTasks
}

/** 资源任务期望奖励（与 sideTasks.rewardIskFor 同口径）：need×收购价×1.04 整百、至少 100，
 *  有供应价时强制 < need×sell（溢出钳到 floor((need×sell−1)/100)×100） */
function expectResourceReward(need: number, buy: number, sell?: number): number {
  let r = Math.max(100, Math.floor((need * buy * RESOURCE_TASK_MARGIN) / 100) * 100)
  if (sell !== undefined && r >= need * sell) r = Math.min(r, Math.floor((need * sell - 1) / 100) * 100)
  return r
}

/** 快递任务期望奖励：need×收购价×1.30 整百、至少 100（无买货守卫） */
function expectCourierReward(need: number, buy: number): number {
  return Math.max(100, Math.floor((need * buy * COURIER_TASK_MARGIN) / 100) * 100)
}

describe('v24 时效任务：20 分钟补给周期整板刷新（与常驻订单寿命同周期）', () => {
  it('同 seed 双跑：整板内容（id/need/reward）+ 市场副作用完全一致', () => {
    const a = makeWorld()
    const b = makeWorld()
    advanceGame(a.state, FIRST_OPEN_MS, a.ctx)
    advanceGame(b.state, FIRST_OPEN_MS, b.ctx)
    expect(boardOf(a.state)).toEqual(boardOf(b.state))
    expect(a.state.market.pools).toEqual(b.state.market.pools)
    expect(a.state.market.npcSell).toEqual(b.state.market.npcSell)
    expect(a.state.rng).toEqual(b.state.rng)
  })

  it('首个 20 分钟整点后刷出 2 条资源任务：need 是 10 的倍数且 ≥10，reward = need×收购价×1.04 整百且 < need×供应价', () => {
    const { state, ctx } = makeWorld()
    expect(boardOf(state).resource).toHaveLength(0)
    expect(boardOf(state).window).toBe(0)
    marketQuote(state, ctx, 'it-ore-a') // 开盘（lastTick=0，首个整点在 20 分钟边界）
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = boardOf(state)
    expect(board.window).toBe(PERIOD)
    expect(board.resource).toHaveLength(2)
    const refIds = board.resource.map((t) => t.refId).sort()
    expect(refIds).toEqual(['min-a', 'ore-a']) // 候选池恰好 2 种 → 全部出现
    for (const t of board.resource) {
      expect(t.kind).toBe('resource')
      expect(t.id).toBeGreaterThan(0)
      expect(t.need).toBeGreaterThanOrEqual(10)
      expect(t.need % 10).toBe(0)
      // 奖励 = 刷出瞬间收购价（池商品 = 均衡价 base；noise=0 下稳定）锚定
      const q = marketQuote(state, ctx, t.goodKey)
      const buy = q.buy!
      expect(buy).toBeGreaterThan(0)
      expect(t.rewardIsk).toBe(expectResourceReward(t.need, buy, q.sell))
      expect(t.rewardIsk).toBeGreaterThanOrEqual(100)
      expect(t.rewardIsk % 100).toBe(0)
      // 市价买入交付必亏：reward < need×供应价
      if (q.sell !== undefined) expect(t.rewardIsk).toBeLessThan(t.need * q.sell)
    }
    expect(board.courier).toHaveLength(0)
  })

  it('刷新周期 = orderLifeMs.common：不足一个周期不刷；跨过整点整板换 2 条（倒计时=距下一 20 分钟点）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    const period = ctx.balance.market.orderLifeMs.common
    expect(period).toBe(PERIOD)
    // 推进不足一个周期（还差 1ms）：不开盘
    advanceGame(state, period - 1, ctx)
    expect(boardOf(state).window).toBe(0)
    expect(boardOf(state).resource).toHaveLength(0)
    // 倒计时口径 = 距下一 20 分钟整点（gameMs = period−1 → 剩 1ms）
    expect(sideTaskBoard(state, ctx).remainingMs).toBe(1)
    // 恰好越过首个整点：整板刷 2 条
    advanceGame(state, 1, ctx)
    expect(boardOf(state).window).toBe(period)
    expect(boardOf(state).resource).toHaveLength(2)
    expect(sideTaskBoard(state, ctx).remainingMs).toBe(period) // 刚开盘 → 离整板到期整一周期
    const first = boardOf(state).resource.map((t) => ({ ...t }))
    // 本轮中段（+半个周期）：不部分刷新
    advanceGame(state, period / 2, ctx)
    expect(boardOf(state).resource).toEqual(first)
    // 再推进半个周期 → 跨过下一整点：整板换 2 条新任务
    advanceGame(state, period / 2, ctx)
    expect(boardOf(state).window).toBe(2 * period)
    const second = boardOf(state).resource
    expect(second).toHaveLength(2)
    expect(second.every((t) => t.id > first[0]!.id)).toBe(true)
    expect(second.map((t) => t.refId).sort()).toEqual(['min-a', 'ore-a'])
  })

  it('到期整板替换：下个 20 分钟整点旧任务全部清空、重新刷出两条（新 id），同轮内不做部分刷新', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx) // 首轮 → 首批
    const first = boardOf(state).resource.map((t) => ({ ...t }))
    expect(first).toHaveLength(2)
    // 同轮内（本周期中段）：板不变（无部分刷新/清空）
    advanceGame(state, 30_000, ctx)
    expect(boardOf(state).resource).toEqual(first)
    // 越过下一整点（到 2×PERIOD+1s）：整板替换为新任务
    advanceGame(state, PERIOD - 30_000 + 1_000, ctx)
    const second = boardOf(state).resource
    expect(second).toHaveLength(2)
    expect(boardOf(state).window).toBe(2 * PERIOD)
    expect(second.every((t) => t.id > first[0]!.id)).toBe(true) // id 单调递增（seq 不复用）
    expect(second.map((t) => t.refId).sort()).toEqual(['min-a', 'ore-a'])
  })

  it('快递任务：未建成副站不刷（分类空）；建成后下一整点同刷 2 条（同池机制 + 刷出即绑定目标站）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const site = stationSite('site-x', 'galaxy-hub', '测试站')
    const ctx = makeTestCtx({
      quietEvents: true,
      stations: [site],
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: quietBalance(),
    })
    expect(courierTaskUnlocked(state, ctx)).toBe(false)
    marketQuote(state, ctx, 'it-ore-a')
    state.market.lastTickGameMs = PERIOD // 假想已越过首个 20 分钟整点
    advanceSideTasks(state, ctx) // 首轮：仅资源任务（副站未建成）
    expect(boardOf(state).window).toBe(PERIOD)
    expect(boardOf(state).resource).toHaveLength(2)
    expect(boardOf(state).courier).toHaveLength(0)
    // 建成一座副站（stage ≥ tiers.length）
    state.stationSites['site-x'] = { stage: 3, delivered: {} }
    expect(courierTaskUnlocked(state, ctx)).toBe(true)
    // 锁死供应簿最低价 = 15（屏蔽首轮市场影响/池回归对第二轮报价的扰动，确定性断言公式）
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.lastTickGameMs = 2 * PERIOD // 越过下一整点：快递开刷（收购簿 npcBuy 仍为开盘均衡价 12/8）
    advanceSideTasks(state, ctx)
    expect(boardOf(state).courier).toHaveLength(2)
    for (const t of boardOf(state).courier) {
      expect(t.kind).toBe('courier')
      expect(t.need).toBeGreaterThanOrEqual(10)
      expect(t.need % 10).toBe(0)
      // 刷出即绑定一座已建成副站
      expect(t.stationId).toBe('site-x')
      expect(t.galaxyId).toBe('galaxy-hub')
      const q = marketQuote(state, ctx, t.goodKey)
      expect(t.rewardIsk).toBe(expectCourierReward(t.need, q.buy!))
      expect(t.rewardIsk % 100).toBe(0)
    }
    // 同轮资源任务同样按"收购价×1.04"计价
    for (const t of boardOf(state).resource) {
      const q = marketQuote(state, ctx, t.goodKey)
      expect(t.rewardIsk).toBe(expectResourceReward(t.need, q.buy!, q.sell))
    }
  })
})

describe('v24 时效任务：完成 / 拒绝 / 声望', () => {
  it('仓库足量完成：扣货、现金入账、该条下板；同轮其余任务不受影响；不给声望', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
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
    advanceGame(state, FIRST_OPEN_MS, ctx)
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

  it('已下板/已过期任务拒绝完成（整板刷新后被替换的任务不存在）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const task = boardOf(state).resource[0]!
    advanceGame(state, PERIOD, ctx) // 下一整点 → 整板替换
    const r = completeSideTask(state, ctx, 'resource', task.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })

  it('快递任务不走"直接完成"：completeSideTask(courier) 被拒（需先出发投送）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const site = stationSite('site-x', 'galaxy-hub', '测试站')
    const ctx = makeTestCtx({
      quietEvents: true,
      stations: [site],
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: quietBalance(),
    })
    marketQuote(state, ctx, 'it-ore-a')
    state.stationSites['site-x'] = { stage: 3, delivered: {} }
    state.market.lastTickGameMs = PERIOD
    advanceSideTasks(state, ctx)
    const courierTask = boardOf(state).courier[0]!
    const r = completeSideTask(state, ctx, 'courier', courierTask.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('出发投送')
    // 任务未被扣货/下板
    expect(boardOf(state).courier.some((t) => t.id === courierTask.id)).toBe(true)
  })
})

describe('v24 时效任务：税前锚定奖励（资源钳制 / 快递无守卫）', () => {
  it('资源奖励：need×收购价×1.04 整百且 < need×供应价；收购价=供应价（1.04 边沿）时钳到 floor((need×sell−1)/100)×100', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a') // 开盘（池 q = 2000、shock = 0）
    // 收购与供应同时锁 15：1.04×15 > 15 → 必然触发买货守卫钳制
    state.market.npcBuy['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcBuy['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.lastTickGameMs = PERIOD
    advanceSideTasks(state, ctx)
    expect(boardOf(state).resource).toHaveLength(2)
    for (const t of boardOf(state).resource) {
      // buy == sell == 15：无钳制时 1.04 计算值 ≥ need×15 → 必被钳到严格小于 need×sell 的最大整百
      expect(t.rewardIsk).toBe(Math.floor((t.need * 15 - 1) / 100) * 100)
      expect(t.rewardIsk).toBeLessThan(t.need * 15)
      expect(t.rewardIsk % 100).toBe(0)
    }
  })

  it('快递奖励：need×收购价×1.30 整百；即便 reward ≥ need×供应价也不设买货守卫（运费补偿型）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 31 })
    const site = stationSite('site-x', 'galaxy-hub', '测试站')
    const ctx = makeTestCtx({
      quietEvents: true,
      stations: [site],
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: quietBalance(),
    })
    state.stationSites['site-x'] = { stage: 3, delivered: {} } // 已建成 → 同轮同刷快递
    marketQuote(state, ctx, 'it-ore-a')
    state.market.npcBuy['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcBuy['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.lastTickGameMs = PERIOD
    advanceSideTasks(state, ctx)
    expect(boardOf(state).courier).toHaveLength(2)
    for (const t of boardOf(state).courier) {
      expect(t.rewardIsk).toBe(expectCourierReward(t.need, 15))
      expect(t.rewardIsk % 100).toBe(0)
      // 无守卫：1.30 的整百结果允许 ≥ need×15（若套资源守卫会被钳到 floor((need×15−1)/100)×100）
      expect(t.rewardIsk).toBeGreaterThanOrEqual(Math.floor((t.need * 15 - 1) / 100) * 100)
    }
  })
})

describe('v24 时效任务：刷出时的市场影响（防"买来秒交"）', () => {
  it('削减 npcSell 合计 30%（逐单从尾扣至 0）、pool.q 同扣、shock +0.05（上限 0.4）；reward 按刷出时收购价×1.04 锚定', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a') // 开盘（池 q = 2000、shock = 0）
    // 手工簿面：收购保持开盘均衡价（12/8）；单一供应单（qty 1000）→ 削减 300；直接调用推进器不跨整点
    state.market.npcSell['it-ore-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    state.market.npcSell['it-min-a'] = [{ price: 15, qty: 1_000, expiresAtGameMs: 9_999_999_999 }]
    const qBefore = state.market.pools['it-ore-a']!.q
    const levelBefore = levelOf(state, ctx, 'it-ore-a')
    state.market.lastTickGameMs = PERIOD // 假想已越过一个 20 分钟整点
    advanceSideTasks(state, ctx)
    // 板已开：两条资源任务（候选池 = 2）
    expect(boardOf(state).window).toBe(PERIOD)
    expect(boardOf(state).resource).toHaveLength(2)
    for (const t of boardOf(state).resource) {
      const q = marketQuote(state, ctx, t.goodKey)
      expect(t.rewardIsk).toBe(expectResourceReward(t.need, q.buy!, q.sell)) // 按刷出时收购价×1.04 计（sell=15 不触发钳制）
    }
    // 削减：1000 → 700（从尾单扣至 0 移除）；pool.q 同步扣 300；shock +0.05
    const sellTotal = state.market.npcSell['it-ore-a']!.reduce((s, o) => s + o.qty, 0)
    expect(sellTotal).toBe(700)
    expect(state.market.pools['it-ore-a']!.q).toBe(qBefore - 300)
    expect(state.market.pools['it-ore-a']!.shock).toBeCloseTo(0.05, 9)
    // 冲击上限：连刷 20 个整点不越过 0.4
    for (let i = 0; i < 20; i++) {
      state.market.lastTickGameMs += PERIOD
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
    state.market.lastTickGameMs = PERIOD
    advanceSideTasks(state, ctx)
    expect(state.market.npcBuy['it-ore-a']).toEqual(buyBefore)
    expect(state.orders).toHaveLength(0)
  })

  it('离线大步长跨多个周期只按"末窗"结算一次：窗口号跳到最后一个整点、任务只重刷一次（id 只 +2）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx) // 首轮（window = PERIOD；seq 已用 2）
    const firstIds = boardOf(state).resource.map((t) => t.id)
    expect(firstIds).toHaveLength(2)
    const maxFirstId = Math.max(...firstIds)
    // 离线 8 小时（跨 24 个周期）：引擎只推进一次 → 只按末窗刷一次，中间周期不重复扣量/抬价
    advanceGame(state, 8 * PERIOD, ctx)
    const board = boardOf(state)
    expect(board.window).toBe(9 * PERIOD) // window 一次性推进到"最后一个已越过的整点"
    expect(board.resource).toHaveLength(2)
    // 若中间周期都刷，seq 会多出 23×2 次分配；实际只多一次整板（+2 id）
    expect(board.resource.every((t) => t.id <= maxFirstId + 2)).toBe(true)
    // 刷出市场影响也只执行一次（每个被抽商品 shock 恰好 +0.05，而非累计多次冲击）
    for (const t of board.resource) {
      expect(state.market.pools[t.goodKey]!.shock).toBeCloseTo(0.05, 6)
    }
  })
})

describe('v24 时效任务：候选池按星图进度过滤（sideTaskCandidateGoods）', () => {
  it('未探索星系矿带的产物不出现在候选：只刷 home/无依赖物资；仓库已有或探索该星系后放行', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    // 远处矿带产出 ore-far（星系 galaxy-far 未探索）；ammo-kinetic-l = NPC 直供无矿带依赖
    const farOre = ore('ore-far', { name: '远矿', price: 30 })
    const FAR_GOOD = { key: 'it-ore-far', kind: 'item' as const, refId: 'ore-far', rarity: 'common' as const, basePrice: 30, poolTarget: 2_000, supplyFlow: 100 }
    const AMMO_GOOD = { key: 'it-ammo', kind: 'item' as const, refId: 'ammo-kinetic-l', rarity: 'common' as const, basePrice: 6, poolTarget: 4_000, supplyFlow: 150 }
    const ctx = makeTestCtx({
      quietEvents: true,
      items: [farOre], // 默认世界另有 ore-a（母港矿带产出）/min-a 等
      belts: [belt('belt-far', 'ore-far', '远矿带', { galaxyId: 'galaxy-far' })], // 默认另含 belt-a(ore-a,母港)
      marketGoods: [ORE_GOOD, FAR_GOOD, AMMO_GOOD],
      balance: quietBalance(),
    })
    const keysOf = (): string[] => sideTaskCandidateGoods(state, ctx).map((g) => g.key).sort()
    // 新档：home 星系（galaxy-hub）已探索、galaxy-far 未探索 → 只留 home 矿 ore-a 与直供弹药
    expect(keysOf()).toEqual(['it-ammo', 'it-ore-a'])
    // 仓库已有该货（玩家已接触）→ 恒放行（未探索也出现）
    state.warehouse.items['ore-far'] = 7
    expect(keysOf()).toEqual(['it-ammo', 'it-ore-a', 'it-ore-far'])
    // 清掉仓库但探索该星系 → 同样放行
    delete state.warehouse.items['ore-far']
    markExplored(state, 'galaxy-far')
    expect(keysOf()).toEqual(['it-ammo', 'it-ore-a', 'it-ore-far'])
  })

  it('整板刷出同样只取放行候选：未探索远矿不出现在任务，探索后下一整点候选池扩大', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    const farOre = ore('ore-far', { name: '远矿', price: 30 })
    const FAR_GOOD = { key: 'it-ore-far', kind: 'item' as const, refId: 'ore-far', rarity: 'common' as const, basePrice: 30, poolTarget: 2_000, supplyFlow: 100 }
    const AMMO_GOOD = { key: 'it-ammo', kind: 'item' as const, refId: 'ammo-kinetic-l', rarity: 'common' as const, basePrice: 6, poolTarget: 4_000, supplyFlow: 150 }
    const ctx = makeTestCtx({
      quietEvents: true,
      items: [farOre],
      belts: [belt('belt-far', 'ore-far', '远矿带', { galaxyId: 'galaxy-far' })],
      marketGoods: [ORE_GOOD, FAR_GOOD, AMMO_GOOD],
      balance: quietBalance(),
    })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx) // 首轮：候选 = ore-a + 弹药 → 恰好 2 条全部刷出
    const firstRefIds = boardOf(state).resource.map((t) => t.refId).sort()
    expect(firstRefIds).toEqual(['ammo-kinetic-l', 'ore-a'])
    expect(boardOf(state).resource.every((t) => t.refId !== 'ore-far')).toBe(true)
    // 探索 galaxy-far → 下一整点候选池扩大为 3（远矿可入池）
    markExplored(state, 'galaxy-far')
    advanceGame(state, PERIOD, ctx)
    const allowed = new Set(['ore-a', 'ammo-kinetic-l', 'ore-far'])
    expect(boardOf(state).resource).toHaveLength(2)
    expect(boardOf(state).resource.every((t) => allowed.has(t.refId))).toBe(true)
    expect(sideTaskCandidateGoods(state, ctx)).toHaveLength(3)
  })
})

/* ─────────────── 快递真实航行投送（2026-09-06 增量） ─────────────── */

/** 快递测试世界：一座已建成副站挂在 galaxy-far（默认航线 hub↔far 2 分钟），首次刷新即同刷资源+快递 */
function makeCourierWorld(seed = 21): { state: GameState; ctx: SimContext } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const site = stationSite('site-far', 'galaxy-far', '远郊站')
  const ctx = makeTestCtx({
    quietEvents: true,
    stations: [site],
    marketGoods: [ORE_GOOD, MIN_GOOD],
    balance: quietBalance(),
  })
  state.stationSites['site-far'] = { stage: 3, delivered: {} } // 已建成 → 快递解锁
  marketQuote(state, ctx, 'it-ore-a')
  state.market.lastTickGameMs = PERIOD
  advanceSideTasks(state, ctx) // 首个整点：window = PERIOD，资源 2 + 快递 2（绑定 site-far）
  expect(boardOf(state).courier).toHaveLength(2)
  return { state, ctx }
}

/** 真实航程毫秒：母港 galaxy-hub → 目标星系（默认 2 分钟 × 60000） */
function courierLegMs(state: GameState, ctx: SimContext, targetGalaxy: string): number {
  return travelLegMs(state, ctx, shortestTravelMinutes(ctx, 'galaxy-hub', targetGalaxy))
}

describe('v24.1 快递真实航行投送：出发投送（两步）', () => {
  it('仓库不足拒绝出发：提示差量、不扣货、不入投送态、任务仍在板（快递不做"直接完成"）', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    state.warehouse.items['ore-a'] = task.need - 1 // 差 1
    const beforeWare = state.warehouse.items['ore-a']
    const r = startCourierDelivery(state, ctx, task.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不足')
    expect(state.warehouse.items['ore-a']).toBe(beforeWare)
    expect(boardOf(state).deliver).toBeNull()
    expect(boardOf(state).courier.some((t) => t.id === task.id)).toBe(true)
  })

  it('仓库足量出发：锁定扣货（need 离开仓库挂入在途）、挂入 deliver、任务暂留板上；重复/他单出发被拒', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    const other = boardOf(state).courier.find((t) => t.refId !== 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000
    state.warehouse.items['min-a'] = 10_000
    state.wallet.isk = 0
    const r = startCourierDelivery(state, ctx, task.id)
    expect(r.ok).toBe(true)
    // 仓库已锁定扣出 need；现金未提前入账（酬金到站结算）
    expect(state.warehouse.items['ore-a']).toBe(10_000 - task.need)
    expect(state.wallet.isk).toBe(0)
    // 在途挂账：目标绑定 site-far + 出发/到站时刻 = 当前 + 真实航程
    const d = boardOf(state).deliver!
    expect(d.taskId).toBe(task.id)
    expect(d.refId).toBe('ore-a')
    expect(d.need).toBe(task.need)
    expect(d.stationId).toBe('site-far')
    expect(d.galaxyId).toBe('galaxy-far')
    expect(d.departAtGameMs).toBe(0)
    expect(d.arriveAtGameMs).toBe(courierLegMs(state, ctx, 'galaxy-far'))
    expect(d.rewardIsk).toBe(task.rewardIsk)
    expect(courierDelivering(state)).toBe(true)
    // 原单仍留在板上（显示"投送中"态；到站才下板）
    expect(boardOf(state).courier.some((t) => t.id === task.id)).toBe(true)
    // 投送中再出发（他单 / 同单）：一律拒绝
    const r2 = startCourierDelivery(state, ctx, other.id)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('一笔')
    expect(state.warehouse.items['min-a']).toBe(10_000) // 未扣他单货
    const r3 = startCourierDelivery(state, ctx, task.id)
    expect(r3.ok).toBe(false)
    expect(boardOf(state).deliver!.taskId).toBe(task.id) // 在途不变
  })

  it('投送在途：开矿 / 远征被拒（措辞"快递投送途中"），任务板视图给出投送剩余', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000
    expect(startCourierDelivery(state, ctx, task.id).ok).toBe(true)
    // 开矿
    const mine = startMining(state, 'belt-a', ctx)
    expect(mine.ok).toBe(false)
    expect(mine.error).toContain('快递投送途中')
    // 远征（核心 expeditionPreflight 守卫）
    const exp = startExpedition(state, 'ano-a', ctx)
    expect(exp.ok).toBe(false)
    expect(exp.error).toContain('快递投送途中')
    // 只读视图：投送中 + 剩余毫秒 = 到站 − 当前
    const view = sideTaskBoard(state, ctx)
    expect(view.deliver).not.toBeNull()
    expect(view.deliver!.taskId).toBe(task.id)
    expect(view.deliver!.stationName).toBe('远郊站')
    expect(view.deliver!.remainingMs).toBe(boardOf(state).deliver!.arriveAtGameMs)
  })

  it('同站/同星系零航程：出发即到站结算（不入在途挂账）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 23 })
    const site = stationSite('site-home', 'galaxy-hub', '母港侧站')
    const ctx = makeTestCtx({
      quietEvents: true,
      stations: [site],
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: quietBalance(),
    })
    state.stationSites['site-home'] = { stage: 3, delivered: {} }
    marketQuote(state, ctx, 'it-ore-a')
    state.market.lastTickGameMs = PERIOD
    advanceSideTasks(state, ctx)
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    expect(task.stationId).toBe('site-home')
    state.warehouse.items['ore-a'] = 10_000
    state.wallet.isk = 0
    const r = startCourierDelivery(state, ctx, task.id)
    expect(r.ok).toBe(true)
    // 零航程：立即结算——不入在途，酬金即时入账、任务下板、停靠该副站
    expect(boardOf(state).deliver).toBeNull()
    expect(state.wallet.isk).toBe(task.rewardIsk)
    expect(state.warehouse.items['ore-a']).toBe(10_000 - task.need)
    expect(boardOf(state).courier.some((t) => t.id === task.id)).toBe(false)
    expect(state.dockedSite).toBe('site-home')
  })
})

describe('v24.1 快递真实航行投送：到站自动结算', () => {
  it('推进到 arriveAt：停靠目标副站、奖励入账（不二次扣货）、任务下板、投送清空、日志"投送完成"', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    const other = boardOf(state).courier.find((t) => t.refId !== 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000
    state.warehouse.items['min-a'] = 10_000
    const reward = task.rewardIsk
    state.wallet.isk = 0
    expect(startCourierDelivery(state, ctx, task.id).ok).toBe(true)
    const leg = boardOf(state).deliver!.arriveAtGameMs
    expect(leg).toBeGreaterThan(0)
    // 到站：多推进 1 秒越过 arriveAt
    advanceGame(state, leg + 1_000, ctx)
    expect(boardOf(state).deliver).toBeNull()
    expect(state.wallet.isk).toBe(reward)
    expect(state.warehouse.items['ore-a']).toBe(10_000 - task.need) // 到站不再扣
    expect(boardOf(state).courier.some((t) => t.id === task.id)).toBe(false) // 任务下板
    expect(boardOf(state).courier.some((t) => t.id === other.id)).toBe(true) // 他单不受影响
    expect(state.dockedSite).toBe('site-far') // 停靠目标副站
    expect(state.awayGalaxy).toBeNull()
    expect(state.logs.some((l) => l.text.includes('快递投送完成'))).toBe(true)
  })

  it('投送中遇整板刷新：在途照常、原任务被换下仍按原 id/原酬金到站结算', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000
    const reward = task.rewardIsk
    // 把出发时刻挪到本轮到点前 100 秒：航程 2 分钟 → 到站越过下一整板刷新点
    state.gameMs = 2 * PERIOD - 100_000
    expect(startCourierDelivery(state, ctx, task.id).ok).toBe(true)
    const d0 = boardOf(state).deliver!
    expect(d0.arriveAtGameMs).toBeGreaterThan(2 * PERIOD) // 到站确实落在刷新点之后
    // 第一段：越过 20 分钟整点 → 整板刷新，在途仍在（未到 arriveAt）
    advanceGame(state, 110_000, ctx)
    expect(boardOf(state).deliver).not.toBeNull()
    expect(boardOf(state).deliver!.taskId).toBe(task.id)
    expect(boardOf(state).courier.some((t) => t.id === task.id)).toBe(false) // 原任务已被整板换下
    expect(boardOf(state).courier.length).toBeGreaterThanOrEqual(1) // 新一批已上板
    expect(boardOf(state).window).toBe(2 * PERIOD)
    // 第二段：推进到站 → 仍按原任务酬金结算
    state.wallet.isk = 0
    advanceGame(state, 30_000, ctx)
    expect(boardOf(state).deliver).toBeNull()
    expect(state.wallet.isk).toBe(reward)
    expect(state.dockedSite).toBe('site-far')
    expect(state.logs.some((l) => l.text.includes('快递投送完成'))).toBe(true)
  })

  it('投送中途存档往返（重进）：deliver 与在途任务保真，读档推进后照常到站结算', () => {
    const { state, ctx } = makeCourierWorld()
    const task = boardOf(state).courier.find((t) => t.refId === 'ore-a')!
    state.warehouse.items['ore-a'] = 10_000
    state.wallet.isk = 0
    expect(startCourierDelivery(state, ctx, task.id).ok).toBe(true)
    const reward = task.rewardIsk
    const deliverSnapshot = boardOf(state).deliver
    // 中段推进一点（在途）→ 往返保存/读档
    advanceGame(state, 30_000, ctx)
    expect(boardOf(state).deliver).not.toBeNull()
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.sideTasks.deliver).toEqual(deliverSnapshot) // 在途挂账保真
    expect(loaded.state.warehouse.items['ore-a']).toBe(10_000 - task.need) // 扣货保真
    expect(loaded.state.sideTasks.courier.some((t) => t.id === task.id)).toBe(true) // 在途任务仍上板
    // 读档后推进剩余航程 → 到站结算
    const remaining = loaded.state.sideTasks.deliver!.arriveAtGameMs - loaded.state.gameMs
    advanceGame(loaded.state, remaining + 1_000, ctx)
    expect(loaded.state.sideTasks.deliver).toBeNull()
    expect(loaded.state.wallet.isk).toBe(reward)
    expect(loaded.state.dockedSite).toBe('site-far')
    expect(loaded.state.sideTasks.courier.some((t) => t.id === task.id)).toBe(false)
    expect(loaded.state.logs.some((l) => l.text.includes('快递投送完成'))).toBe(true)
  })

  it('老档：sideTasks 无 deliver / 快递任务无绑定字段读入正常（deliver=null；出发按最近已建成副站兜底）', () => {
    const { state, ctx } = makeCourierWorld(27)
    // 手工剥掉新字段：deliver 字段、快递任务绑定（模拟本次增量前的 v24 存档）
    const file = JSON.parse(serializeSaveFile(state, 0)) as Record<string, unknown>
    const raw = file.state as Record<string, unknown>
    const st = raw.sideTasks as Record<string, unknown>
    delete st.deliver
    for (const t of (st.courier as Array<Record<string, unknown>>) ?? []) {
      delete t.stationId
      delete t.galaxyId
    }
    const loaded = loadSaveFile(JSON.stringify(file))
    expect(loaded.state.sideTasks.deliver).toBeNull()
    const legacyTask = loaded.state.sideTasks.courier.find((t) => t.refId === 'ore-a')!
    expect(legacyTask.stationId).toBeUndefined()
    expect(legacyTask.galaxyId).toBeUndefined()
    // 出发：无绑定 → 兜底"最近已建成副站"（唯一 site-far）照常投送
    loaded.state.warehouse.items['ore-a'] = 10_000
    const r = startCourierDelivery(loaded.state, ctx, legacyTask.id)
    expect(r.ok).toBe(true)
    expect(loaded.state.sideTasks.deliver!.stationId).toBe('site-far')
    expect(loaded.state.sideTasks.deliver!.galaxyId).toBe('galaxy-far')
  })
})

describe('v24 时效任务：存档 v23→v24 迁移 / 老档读入 / 往返', () => {
  it('v23 老档（无 sideTasks 字段）读入：版本升 24、补空板（含 deliver=null）；随后正常按整点刷出', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const raw = state as unknown as Record<string, unknown>
    delete raw.sideTasks
    raw.version = 23
    const loaded = loadSaveFile(serializeSaveFile(raw as unknown as GameState, 0))
    expect(loaded.state.version).toBe(24)
    expect(loaded.state.sideTasks).toEqual({ seq: 1, window: 0, resource: [], courier: [], deliver: null })
    expect(loaded.state.wallet.isk).toBe(10_000) // 其余字段无损
    const ctx = makeTestCtx({
      quietEvents: true,
      marketGoods: [ORE_GOOD, MIN_GOOD],
      balance: quietBalance(),
    })
    marketQuote(loaded.state, ctx, 'it-ore-a')
    advanceGame(loaded.state, FIRST_OPEN_MS, ctx)
    expect(loaded.state.sideTasks.resource).toHaveLength(2)
  })

  it('已刷出任务板的往返保存：seq/window/任务/deliver 完整保留', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const expectBoard = boardOf(state)
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.sideTasks).toEqual(expectBoard)
    // 往返后仍可完成（同轮内）
    const task = loaded.state.sideTasks.resource[0]!
    loaded.state.warehouse.items[task.refId] = 10_000
    expect(completeSideTask(loaded.state, ctx, 'resource', task.id).ok).toBe(true)
  })
})
