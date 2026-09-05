/**
 * 市场系统（V9）单元测试：开盘簿、市价买卖、剩余转挂单、撤单退回、冲击动量、
 * 内部消化、池库存、声望加成、蓝图学习/回卖、舰船市场出售。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { countWare } from '../src/inventory'
import { sellAll, sellWareItem } from '../src/industry'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  buyAtMarket,
  cancelOrder,
  learnBlueprint,
  listSellHolding,
  marketQuote,
  marketSellHolding,
  salesTaxRate,
  sellShipAtMarket,
} from '../src/market'
import { makeTestCtx, mineral, ship } from './helpers'

const MIN_A = mineral('min-a') // basePrice 8

describe('市场开盘与市价单', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 }) // 初始 10_000 ISK
    ctx = makeTestCtx() // ore-a 池商品 base 12（target 10 万）；min-a/base 8 同样
  })

  it('查询触发开盘：常驻池商品有价有量（收购平价 12、供应微溢）', () => {
    const q = marketQuote(state, ctx, 'it-ore-a')
    expect(q.buy).toBe(12) // 均衡收购价 = 基准价（与旧版空间站收购价一致）
    expect(q.sell).toBe(13) // 12 × 1.06 = 12.72 → round 13
    expect(q.buyQty).toBeGreaterThan(0)
    expect(q.sellQty).toBeGreaterThan(0)
    expect(state.market.pools['it-ore-a']!.q).toBe(100_000) // 开盘池 = 目标
  })

  it('市价卖：吃簿入账（扣 5% 贸易税）；小额即时全部成交，不产生挂单', () => {
    state.fleet[state.shipId].cargo['ore-a'] = 100
    const r = sellAll(state, 'ore-a', ctx)
    expect(r.ok).toBe(true)
    expect(r.soldUnits).toBe(100)
    expect(r.gainedIsk).toBe(1_200 - Math.round(1_200 * 0.05)) // 税后 1140
    expect(state.orders).toHaveLength(0)
    expect(state.escrowItems['it-ore-a'] ?? 0).toBe(0)
  })

  it('超大单：吃穿簿后剩余自动转限价卖单（escrow 锁货），撤单退回物品仓库', () => {
    state.warehouse.items['ore-a'] = 3_000 // 开盘簿容量 1000+1250
    const r = sellWareItem(state, 'ore-a', ctx)
    expect(r.ok).toBe(true)
    expect(r.soldUnits).toBe(2_250)
    const gross = 1_000 * 12 + 1_250 * 12 // 两档收购价都是 12（±1% 档四舍五入后同价）
    expect(r.gainedIsk).toBe(gross - Math.round(gross * 0.05)) // 税后 25650
    // 剩余 750 自动转限价卖单并锁 escrow
    expect(state.orders).toHaveLength(1)
    expect(state.orders[0]!.qty).toBe(750)
    expect(state.escrowItems['it-ore-a'] ?? 0).toBe(750)
    // 撤单：escrow 释放，退回"物品仓库"（750 件）
    expect(cancelOrder(state, ctx, state.orders[0]!.id)).toBe(true)
    expect(state.orders).toHaveLength(0)
    expect(state.escrowItems['it-ore-a'] ?? 0).toBe(0)
    expect(countWare(state, 'ore-a')).toBe(750)
  })

  it('协会声望加成：加成计入毛额后扣贸易税', () => {
    state.standings['dsi'] = 5
    state.warehouse.items['ore-a'] = 100
    const r = sellWareItem(state, 'ore-a', ctx)
    const gross = Math.round(1_200 * 1.05)
    expect(r.gainedIsk).toBe(gross - Math.round(gross * 0.05)) // 1197
  })

  it('市价买：吃供应簿并扣款；簿吃穿后剩余留提示（不打折、不入 escrow）', () => {
    state.wallet.isk = 1_000_000
    const res = buyAtMarket(state, ctx, 'it-min-a', 1_000)
    // 开盘供应簿 1 档：qty = flow×0.8 = 800 @ 9（8×1.06=8.48 → 取整保价差 → 9）
    expect(res.bought).toBe(800)
    expect(res.remaining).toBe(200)
    expect(countWare(state, 'min-a')).toBe(800)
    expect(state.wallet.isk).toBe(1_000_000 - 800 * 9)
    expect(state.orders).toHaveLength(0) // 买单不足不自动挂单
    expect(state.escrowItems['it-min-a'] ?? 0).toBe(0)
    expect(state.market.pools['it-min-a']!.q).toBe(100_000 - 800) // 池库存同步减少
  })
})

describe('市场动态：冲击 / 池压力 / 内部消化', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 5 })
    // 只放一种池商品，让窗口内行为可精确断言
    ctx = makeTestCtx({ items: [MIN_A], marketGoods: [{ key: 'min-a', kind: 'item', refId: 'min-a', rarity: 'common', basePrice: 8, poolTarget: 3_000, supplyFlow: 500 }] })
  })

  it('窗口净成交量超阈值（>2×参考量）→ 冲击动量 +5% 且可叠加、随后衰减', () => {
    marketQuote(state, ctx, 'min-a') // 开盘
    state.wallet.isk = 10_000_000
    // 等 3 个窗口积累供应簿（每窗口簿薄就补单，约 2~4 档 × 500）
    advanceGame(state, 180_000, ctx)
    const sellQty = state.market.npcSell['min-a']!.reduce((a, o) => a + o.qty, 0)
    expect(sellQty).toBeGreaterThan(0)
    const before = state.market.pools['min-a']!.q
    buyAtMarket(state, ctx, 'min-a', sellQty) // 一口气吃穿积累的簿（净买 > 500/窗口阈值）
    advanceGame(state, 60_000, ctx) // 窗口结算冲击
    expect(state.market.pools['min-a']!.shock).toBeGreaterThan(0) // 净买量远超阈值 → +冲击
    // 池库存大幅下降（压力上涨 → 后续补单涨价）
    expect(state.market.pools['min-a']!.q).toBeLessThan(before * 0.8)
    // 随时间推移冲击衰减（半程 6 分钟 → 18 窗口后 <1%）
    advanceGame(state, 18 * 60_000, ctx)
    expect(state.market.pools['min-a']!.shock).toBeLessThan(0.01)
  })

  it('内部消化：收购新单撞上更便宜的陈旧供应单 → 不瞬时入簿，排队随时间消化', () => {
    marketQuote(state, ctx, 'min-a') // 开盘
    const mk = state.market
    // 人为制造"陈旧低价供应单"（收购价 > 供应价 → 冲突）
    mk.npcBuy['min-a']!.splice(0, mk.npcBuy['min-a']!.length)
    mk.npcSell['min-a']!.splice(0, mk.npcSell['min-a']!.length)
    mk.npcSell['min-a']!.push({ price: 6, qty: 1_000, expiresAtGameMs: state.gameMs + 30 * 60_000 })
    mk.digest['min-a'] = { qty: 0, price: 0, perWindow: 0 }

    advanceGame(state, 60_000, ctx) // 一个窗口：收购阶梯(≈8/7/6) 撞上陈旧供应单(6)
    expect(mk.digest['min-a']!.qty).toBeGreaterThan(0) // 冲突档被消化队列吞下（不是瞬消）
    // 簿面上不应出现"高于陈旧供应单(6)"的收购单（越档不瞬时成交）；等于/低于 6 的低档可留簿面
    for (const o of mk.npcBuy['min-a']!) expect(o.price).toBeLessThanOrEqual(6)
    // 消化随时间推进（陈旧供应单仍在 → 持续有冲突进队列，但每窗口先按 perWindow 消化）
    advanceGame(state, 60_000, ctx)
    expect(mk.digest['min-a']!.qty).toBeGreaterThan(0)
    // 陈旧供应单消失后：市场恢复收购单入簿（不再全部进消化）
    mk.npcSell['min-a']!.splice(0, mk.npcSell['min-a']!.length)
    mk.digest['min-a']!.qty = 0
    advanceGame(state, 60_000, ctx)
    expect(mk.npcBuy['min-a']!.length).toBeGreaterThan(0)
    // 无陈旧低价单后，正常的收购阶梯应落在簿面（非消化）
    const crossed = mk.npcBuy['min-a']!.some((o) => o.price > 6)
    expect(crossed).toBe(true)
  })
})

describe('蓝图书：市场买入 → 学习 → 重复书回卖', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx() // bp-bp-a：base 1000（bp-a priceIsk）
  })

  it('市场买蓝图书入书架 → 学习消耗一本；书架上无书不能学', () => {
    expect(state.blueprintStock['bp-a'] ?? 0).toBe(0)
    const res = buyAtMarket(state, ctx, 'bp-bp-a', 1) // 开盘供应 1000 ISK
    expect(res.bought).toBe(1)
    expect(state.blueprintStock['bp-a']).toBe(1)
    expect(learnBlueprint(state, ctx, 'bp-a').ok).toBe(true)
    expect(state.learnedRecipes).toContain('bp-a')
    expect(state.blueprintStock['bp-a'] ?? 0).toBe(0)
    expect(learnBlueprint(state, ctx, 'bp-a').ok).toBe(false) // 没有书
  })

  it('重复蓝图书可市价回卖（半价收购线，扣贸易税），学会的配方不受影响', () => {
    state.blueprintStock['bp-a'] = 1
    const walletBefore = state.wallet.isk
    const r = marketSellHolding(state, ctx, 'bp-bp-a') // 全卖（1 本）
    expect(r.ok).toBe(true)
    expect(r.sold).toBe(1)
    const gross = 500 // demand 0.5 × 1000
    expect(r.total).toBe(gross - Math.round(gross * 0.05)) // 税后 475
    expect(state.wallet.isk).toBe(walletBefore + 475)
    expect(state.blueprintStock['bp-a'] ?? 0).toBe(0)
    expect(state.orders).toHaveLength(0)
  })
})

describe('市场存档往返（回归：零值 digest 读档后不丢键）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx() // ore-a/min-a… 池商品
  })

  it('跑窗口 → 序列化 → 读档 → 再跨窗口推进，不崩溃且消化队列完好', () => {
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 61_000, ctx) // 至少一个市场窗口（产生/维持 digest 键）
    expect(state.market.digest['it-ore-a']).toBeDefined()

    // 人为制造一条未消化完的冲突（验证非零值也能过往返）
    state.market.digest['it-ore-a']!.qty = 5
    state.market.digest['it-ore-a']!.price = 12
    state.market.digest['it-ore-a']!.perWindow = 3

    const text = serializeSaveFile(state, 123_456)
    const loaded = loadSaveFile(text)
    expect(loaded.state.market.digest['it-ore-a']!.qty).toBe(5) // 非零保留
    // 关键回归：零值条目（其它商品）读档后也必须存在，窗口推进不得崩溃
    expect(loaded.state.market.digest['it-min-a']).toBeDefined()
    expect(() => advanceGame(loaded.state, 61_000, ctx)).not.toThrow()
  })
})

describe('舰船市场：出售需满足条件，成交入账', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    const bigShip = ship('big', { cargo: 2_000, price: 120_000 })
    ctx = makeTestCtx({ ships: [bigShip] })
  })

  it('驾驶中的船不能卖；停靠+空仓可市价卖出（税后入账）', () => {
    addShipToFleet(state, 'big') // 停在机库（默认驾驶沙猫）
    const res = sellShipAtMarket(state, ctx, 'big')
    expect(res.ok).toBe(true)
    const gross = 48_000 // 120k × 0.4（单件商品 收购价 = demandMultiplier×L）
    expect(res.total).toBe(gross - Math.round(gross * 0.05)) // 税后 45600
    expect(state.fleet['big']).toBeUndefined()
    expect(state.orders).toHaveLength(0) // 整船一次成交
    expect(state.escrowShips).toEqual({})
  })

  it('驾驶中的船拒绝出售', () => {
    state.shipId = 'sandcat'
    const res = sellShipAtMarket(state, ctx, 'sandcat') // 初始船不在市场目录 + 驾驶中
    expect(res.ok).toBe(false)
    expect(state.fleet['sandcat']).toBeDefined()
  })

  it('货仓有货不能卖', () => {
    addShipToFleet(state, 'big')
    state.fleet['big']!.cargo['ore-a'] = 10
    const res = sellShipAtMarket(state, ctx, 'big')
    expect(res.ok).toBe(false)
    expect(state.fleet['big']).toBeDefined() // 船还在
  })
})

describe('贸易税（V9+：5% 销售税 + 减免技能）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx()
  })

  it('默认税率 5%；税率函数只随技能等级变化', () => {
    expect(salesTaxRate(state, ctx)).toBe(0.05)
    expect(state.logs.length).toBeGreaterThan(0) // 确定 state 已初始化
  })

  it('会计学满级 −40% → 税率 3%；双技能满级合计减免 80% → 1%', () => {
    state.skills.trained['accounting'] = 5
    expect(salesTaxRate(state, ctx)).toBeCloseTo(0.03, 6)
    state.skills.trained['trade-negotiation'] = 5
    expect(salesTaxRate(state, ctx)).toBeCloseTo(0.01, 6)
    // 线性相加：两技能各 2 级 → 减免 32% → 3.4%
    const s2 = createInitialState({ nowWallMs: 0, seed: 1 })
    s2.skills.trained['accounting'] = 2
    s2.skills.trained['trade-negotiation'] = 2
    expect(salesTaxRate(s2, ctx)).toBeCloseTo(0.05 * (1 - 0.08 * 4), 6)
  })

  it('卖出 100 单位矿石：基础税 1140 净入账；双满级技能 → 1188', () => {
    state.warehouse.items['ore-a'] = 100
    expect(sellWareItem(state, 'ore-a', ctx).gainedIsk).toBe(1_140)
    state.warehouse.items['ore-a'] = 100
    state.skills.trained['accounting'] = 5
    state.skills.trained['trade-negotiation'] = 5
    const r = sellWareItem(state, 'ore-a', ctx)
    expect(r.gainedIsk).toBe(1_200 - Math.round(1_200 * 0.01)) // 1188
    // 日志注明贸易税
    expect(state.logs.some((l) => l.text.includes('税后入账'))).toBe(true)
  })

  it('限价卖单成交同样扣税（与市价路径一致）；挂单与买入不收费', () => {
    // 买入不受税影响
    state.wallet.isk = 100_000
    const buy = buyAtMarket(state, ctx, 'it-min-a', 1)
    expect(buy.total).toBe(9) // 供应价 9，无税
    // 手动挂卖单（免费）→ 窗口撮合成交 → 税后入账
    state.warehouse.items['ore-a'] = 50
    expect(listSellHolding(state, ctx, 'it-ore-a', 12, 50).ok).toBe(true)
    expect(state.orders).toHaveLength(1)
    expect(state.escrowItems['it-ore-a'] ?? 0).toBe(50)
    const walletBefore = state.wallet.isk
    advanceGame(state, 60_000, ctx) // 挂单价 12 = 开盘收购价 12 → 全成交
    expect(state.orders).toHaveLength(0)
    expect(state.wallet.isk).toBe(walletBefore + (600 - Math.round(600 * 0.05))) // 税后 570
    expect(state.logs.some((l) => l.text.includes('贸易税'))).toBe(true)
  })
})

describe('离线窗口推进（A1：未开市档在离线起点开盘，整段离线按窗口推进）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 }) // market 全空（模拟迁移/新档）
    ctx = makeTestCtx()
  })

  it('一次性大离线：开盘簿从起点生效，价格小史与池随窗口推进', () => {
    advanceGame(state, 60 * 60_000, ctx) // 离线 1 小时
    const mk = state.market
    expect(mk.lastTickGameMs).toBeGreaterThan(0)
    expect(state.gameMs - mk.lastTickGameMs).toBeLessThan(ctx.balance.market.tickMs) // 窗口补到当前
    expect(mk.pools['it-ore-a']).toBeDefined()
    expect(mk.npcBuy['it-ore-a']!.length).toBeGreaterThan(0) // 开盘 + 逐窗口补单
    expect((mk.priceHistory['it-ore-a'] ?? []).length).toBeGreaterThan(0) // 整段离线都有价格采样
  })

  it('离线期间我的挂单照常撮合（税后入账、escrow 扣减、订单清理）', () => {
    // 模拟"旧档里已挂着卖单"：开盘簿在离线起点生成 → 首窗口即成交
    state.market.orderSeq = 1
    state.orders = [
      { id: 1, side: 'sell', good: 'it-ore-a', price: 12, qty: 100, filled: 0, placedAtGameMs: 0 },
    ]
    state.escrowItems['it-ore-a'] = 100
    const walletBefore = state.wallet.isk
    advanceGame(state, 5 * 60_000, ctx) // 离线 5 分钟
    expect(state.orders).toHaveLength(0)
    expect(state.escrowItems['it-ore-a'] ?? 0).toBe(0)
    expect(state.wallet.isk).toBe(walletBefore + (1_200 - Math.round(1_200 * 0.05))) // 税后 1140
    expect(state.logs.some((l) => l.text.includes('税后入账'))).toBe(true)
    // 市场簿与价格小史已随离线推进
    expect((state.market.priceHistory['it-ore-a'] ?? []).length).toBeGreaterThan(0)
  })
})

describe('A3 回归：v8→v9 迁移后直接 8 小时长离线（市场开市 + 窗口推进 + 配方保留）', () => {
  let ctx: SimContext

  beforeEach(() => {
    ctx = makeTestCtx({ quietEvents: true }) // 本用例回归市场离线推进，关闭随机事件隔离干扰
  })

  it('老档（blueprints 在案）迁移后跑满 8 小时离线上限：不崩溃、市场全程推进', () => {
    const v8Raw = {
      version: 8,
      gameMs: 1_000,
      savedAtWallMs: 100,
      logCap: 300,
      character: { name: '老矿工', startedAtWallMs: 1 },
      rng: { seed: 2024, count: 3 },
      skills: { trained: { mining: 3 }, queue: [] },
      wallet: { isk: 55_000 },
      shipId: 'sandcat',
      fleet: {
        sandcat: { durability: 0.9, cargo: { 'ore-a': 60 }, fitted: { miner: null, cargo: null, turret: null } },
      },
      warehouse: { items: { 'ore-a': 300 } },
      moduleBay: { 'mod-a': 1 },
      blueprints: ['bp-a', 'bp-b'],
      aiCores: { basic: 1, gamma: 0, beta: 0, alpha: 0 },
      aiAssignments: {},
      mining: { active: false, beltId: null, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, autoCycle: true, stopAfterTrip: false },
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: {},
      expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0, eventId: null, eventFired: false },
      logs: [],
    }
    const loaded = loadSaveFile(JSON.stringify({ format: 'whale-idle-save', version: 8, savedAtWallMs: 100, state: v8Raw }))
    const state = loaded.state
    expect(state.version).toBe(24)
    expect(state.learnedRecipes).toEqual(['bp-a', 'bp-b']) // 蓝图无损平移

    // 直接 8 小时大离线（480 窗口）
    advanceGame(state, 8 * 60 * 60_000, ctx)
    const mk = state.market
    expect(state.gameMs - mk.lastTickGameMs).toBeLessThan(ctx.balance.market.tickMs) // 窗口补到当前
    expect(Object.keys(mk.pools).length).toBe(ctx.marketGoods.size) // 全目录开市
    expect((mk.priceHistory['it-ore-a'] ?? []).length).toBeGreaterThan(0) // 整段离线都有价格采样
    expect(state.learnedRecipes).toEqual(['bp-a', 'bp-b']) // 配方不受离线影响
  })
})
