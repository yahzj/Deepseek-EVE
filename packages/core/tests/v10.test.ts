/**
 * V10 单元测试：资源通用化（气体/冰矿采集与精炼）、采集点声望门槛（主控+AI）、
 * 市场声望门槛、新占位槽位装配、迁移 v9→v10 的行为面。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { countItem, countWare } from '../src/inventory'
import { startMining, stopMining } from '../src/mining'
import { buyShip, startRefineRun } from '../src/industry'
import { assignAiMining } from '../src/ai'
import { addModule, countModule, fitModule, unfitSlot, fittedBonuses } from '../src/equipment'
import { changeShip } from '../src/shipyard'
import { buyAtMarket, ensureMarket, marketSellHolding, placeBuyOrder, shipSellable } from '../src/market'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import type { BeltDef, ItemDef, MarketGoodDef, ModuleDef, ShipDef, SimContext } from '../src/types'
import { belt, fittedOf, makeTestCtx, moduleDef, ship } from './helpers'

/** 测试用气体（可采集可精炼 → 矿粉甲） */
const GAS_X: ItemDef = {
  id: 'gas-x',
  name: '试制气体',
  kind: 'gas',
  unitM3: 1,
  baseSellPriceIsk: 40,
  description: '测试用气体',
  refine: [{ mineralId: 'min-a', perOre: 2 }],
}

/** 测试用冰矿（可采集可精炼 → 矿粉乙） */
const ICE_X: ItemDef = {
  id: 'ice-x',
  name: '试制冰矿',
  kind: 'ice',
  unitM3: 1,
  baseSellPriceIsk: 60,
  description: '测试用冰矿',
  refine: [{ mineralId: 'min-b', perOre: 1.5 }],
}

/** 测试用弹药（占位：无精炼配方） */
const AMMO_X: ItemDef = {
  id: 'ammo-x',
  name: '试制弹药',
  kind: 'ammo',
  unitM3: 0.02,
  baseSellPriceIsk: 5,
  description: '测试用弹药（占位）',
}

/** 测试用占位护盾装备 */
const SHIELD_MOD: ModuleDef = moduleDef('mod-shield-x', 'shield', 0.2)

/** 测试上下文：默认物品外加气体/冰/弹药 */
function ctxWithExtras(extra?: { items?: ItemDef[]; belts?: BeltDef[]; ships?: ShipDef[]; marketGoods?: MarketGoodDef[] }): SimContext {
  return makeTestCtx({
    items: [GAS_X, ICE_X, AMMO_X, ...(extra?.items ?? [])],
    belts: extra?.belts ?? [],
    ships: extra?.ships ?? [],
    marketGoods: extra?.marketGoods,
  })
}

describe('V10：气体/冰矿接入采集与精炼循环', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    ctx = ctxWithExtras()
  })

  it('矿船可以开采气体（kind=gas）并产出入舱', () => {
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    // 把 belt-a 改指向气体：直接验证"矿带产物类型无关"路径
    stopMining(state, ctx)
    const gasCtx = ctxWithExtras({ belts: [belt('belt-gasx', 'gas-x')] })
    expect(startMining(state, 'belt-gasx', gasCtx).ok).toBe(true)
    advanceGame(state, 60_000 + 12_000, gasCtx) // 空船出航 60s + 1 个循环
    expect(countItem(state, 'gas-x')).toBe(10)
  })

  it('矿船可以开采冰矿（kind=ice）', () => {
    const iceCtx = ctxWithExtras({ belts: [belt('belt-icex', 'ice-x')] })
    expect(startMining(state, 'belt-icex', iceCtx).ok).toBe(true)
    advanceGame(state, 60_000 + 12_000, iceCtx) // 空船出航 60s + 1 个循环
    expect(countItem(state, 'ice-x')).toBe(10)
  })

  it('弹药等占位物品不能作为采集点产物', () => {
    const ammoCtx = ctxWithExtras({ belts: [belt('belt-ammox', 'ammo-x')] })
    const r = startMining(state, 'belt-ammox', ammoCtx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有对应的可采集资源')
  })

  it('精炼炉接受气体/冰矿（循环运转：10 单位/批、6 秒兜底批参），产物入仓库；收率公式不变', () => {
    state.warehouse.items['gas-x'] = 100
    expect(startRefineRun(state, 'gas-x', 'pilot', ctx).ok).toBe(true)
    advanceGame(state, 61_000, ctx) // 10 批 × 6s → 料尽自动停
    expect(countWare(state, 'min-a')).toBe(100) // floor(10×2×0.5)=10/批 ×10
    state.warehouse.items['ice-x'] = 100
    expect(startRefineRun(state, 'ice-x', 'pilot', ctx).ok).toBe(true)
    advanceGame(state, 61_000, ctx)
    expect(countWare(state, 'min-b')).toBe(70) // floor(10×1.5×0.5)=7/批 ×10
  })

  it('弹药/矿物无配方不能精炼', () => {
    state.warehouse.items['ammo-x'] = 10
    expect(startRefineRun(state, 'ammo-x', 'pilot', ctx).ok).toBe(false)
    state.warehouse.items['min-a'] = 10
    expect(startRefineRun(state, 'min-a', 'pilot', ctx).ok).toBe(false)
  })
})

describe('V10：采集点声望门槛（主控 + AI）', () => {
  let state: GameState

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
  })

  it('主控：声望不足拒绝开采，达标后放行', () => {
    const glow: ItemDef = {
      id: 'ore-glow',
      name: '辉岩',
      kind: 'ore',
      unitM3: 1,
      baseSellPriceIsk: 80,
      description: '测试用高档矿',
      refine: [{ mineralId: 'min-a', perOre: 1 }],
    }
    const ctx = ctxWithExtras({ items: [glow], belts: [{ ...belt('belt-gate1', 'ore-glow'), standingReq: 3 }] })
    const r1 = startMining(state, 'belt-gate1', ctx)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('声望')
    state.standings['dsi'] = 3
    expect(startMining(state, 'belt-gate1', ctx).ok).toBe(true)
  })

  it('AI 指派同样受采集点声望门槛约束', () => {
    const ctx = ctxWithExtras({ belts: [{ ...belt('belt-gate2', 'ore-a'), standingReq: 5 }] })
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    state.aiCores['basic'] = 1
    const r = assignAiMining(state, 'sandcat2', 'basic', 'belt-gate2', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('声望')
    state.standings['dsi'] = 5
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-gate2', ctx).ok).toBe(true)
  })
})

describe('V10：市场声望门槛', () => {
  let state: GameState
  let ctx: SimContext
  const GATED_SHIP: ShipDef = { ...ship('warship', { price: 500_000 }), name: '门槛战舰' }
  const GATED_GOOD: MarketGoodDef = {
    key: 'ship-warship',
    kind: 'ship',
    refId: 'warship',
    rarity: 'exotic',
    basePrice: 500_000,
    demandMultiplier: 0.3,
    standingReq: 6,
  }
  const GATED_ITEM: ItemDef = {
    id: 'mat-x',
    name: '门槛材料',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 10,
    description: '测试用',
    refine: [{ mineralId: 'min-a', perOre: 1 }],
  }
  const GATED_ITEM_GOOD: MarketGoodDef = {
    key: 'mat-x',
    kind: 'item',
    refId: 'mat-x',
    rarity: 'common',
    basePrice: 10,
    poolTarget: 1_000,
    supplyFlow: 50,
    standingReq: 6,
  }

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    state.wallet.isk = 10_000_000
    ctx = ctxWithExtras({
      items: [GATED_ITEM],
      ships: [GATED_SHIP],
      marketGoods: [GATED_GOOD, GATED_ITEM_GOOD],
    })
    ensureMarket(state, ctx)
  })

  it('门槛商品：市价买入/挂买单被拒，卖出不受限', () => {
    const buy = buyAtMarket(state, ctx, 'ship-warship', 1)
    expect(buy.bought).toBe(0)
    expect(placeBuyOrder(state, ctx, 'ship-warship', 500_000, 1)).toBeNull()
    // 卖出（门槛材料堆进仓库）不受购买门槛影响
    state.warehouse.items['mat-x'] = 50
    const sell = marketSellHolding(state, ctx, 'mat-x')
    expect(sell.ok).toBe(true)
    expect(sell.sold).toBe(50)
  })

  it('buyShip 对门槛船给出明确报错；声望达标且有现货时购入登舰', () => {
    const r1 = buyShip(state, 'warship', ctx)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('声望')
    state.standings['dsi'] = 6
    // 手动放一张现货（声望已达标后应直接成交）
    state.market.npcSell['ship-warship']!.push({
      price: 500_000,
      qty: 1,
      expiresAtGameMs: state.gameMs + 60 * 60_000,
    })
    const r2 = buyShip(state, 'warship', ctx)
    expect(r2.ok).toBe(true)
    expect(state.shipId).toBe('warship')
  })
})

describe('V10：占位槽位（shield/armor/propulsion）装配', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx({ modules: [SHIELD_MOD] })
  })

  it('可装配/卸下占位模块；加成写入但无行为消费者；装满模块的船不可出售', () => {
    addModule(state, 'mod-shield-x', 1)
    expect(fitModule(state, 'mod-shield-x', ctx).ok).toBe(true)
    expect(state.fleet[state.shipId]!.fitted.mid[0]).toBe('mod-shield-x')
    const bonuses = fittedBonuses(state, ctx)
    expect(bonuses.shield).toBeCloseTo(0.2, 5)
    expect(bonuses.miner).toBe(0)
    // 采矿参数不受护盾模块影响
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    stopMining(state, ctx)
    // 装着模块的船不能挂卖（先切到另一艘船，避免"驾驶中"拦截）
    state.fleet['sandcat2'] = { durability: 1, cargo: {}, fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }) }
    expect(changeShip(state, 'sandcat2', ctx).ok).toBe(true)
    expect(shipSellable(state, 'sandcat')).toEqual({ ok: false, reason: '还装着模块，请先卸下。' })
    // 切回并卸下：退回装备库
    expect(changeShip(state, 'sandcat', ctx).ok).toBe(true)
    expect(unfitSlot(state, 'shield')).toBe(true)
    expect(state.fleet['sandcat']!.fitted.mid[0]).toBeNull()
    expect(countModule(state, 'mod-shield-x')).toBe(1)
  })
})

describe('V10：存档 v9→v10 迁移（fitted 补三个空槽）', () => {
  it('v9 档（三槽 fitted）读入后六槽齐全，已装模块保留', () => {
    const v9 = {
      version: 9,
      gameMs: 1_000,
      savedAtWallMs: 100,
      logCap: 300,
      character: { name: '老矿工', startedAtWallMs: 1 },
      rng: { seed: 3, count: 0 },
      skills: { trained: {}, queue: [] },
      wallet: { isk: 50_000 },
      shipId: 'sandcat',
      fleet: {
        sandcat: { durability: 0.8, cargo: { 'ore-a': 60 }, fitted: { miner: 'mod-miner-x', cargo: null, turret: null } },
      },
      warehouse: { items: {} },
      moduleBay: {},
      aiCores: { basic: 0, gamma: 0, beta: 0, alpha: 0 },
      aiAssignments: {},
      market: { pools: {}, npcBuy: {}, npcSell: {}, digest: {}, lastTickGameMs: 0, orderSeq: 0, priceHistory: {} },
      orders: [],
      escrowItems: {},
      escrowShips: {},
      learnedRecipes: [],
      blueprintStock: {},
      mining: { active: false, beltId: null, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0, autoCycle: true, stopAfterTrip: false },
      manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
      standings: {},
      expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0, eventId: null, eventFired: false },
      logs: [],
    }
    const text = JSON.stringify({ format: SAVE_FORMAT, version: 9, savedAtWallMs: 100, state: v9 })
    const loaded = loadSaveFile(text)
    expect(loaded.state.version).toBe(19)
    const fitted = loaded.state.fleet['sandcat']!.fitted
    // v9 六槽 → V18 位数组：turret→high[0]、miner→high[1]、shield→mid[0]、
    // propulsion→mid[1]、armor→low[0]、cargo→low[1]（v9 档 fitted 只含 miner/cargo/turret）
    expect(fitted.high[1]).toBe('mod-miner-x')
    expect(fitted.high[0]).toBeNull()
    expect(fitted.mid[0]).toBeNull()
    expect(fitted.mid[1]).toBeNull()
    expect(fitted.low[0]).toBeNull()
    expect(fitted.low[1]).toBeNull()
  })

  it('v10 档往返保存不丢位', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const text = serializeSaveFile(state, 0)
    const loaded = loadSaveFile(text)
    expect(loaded.state.version).toBe(19)
    expect(Object.keys(loaded.state.fleet[loaded.state.shipId]!.fitted).sort()).toEqual(
      ['high', 'mid', 'low'].sort(),
    )
  })
})
