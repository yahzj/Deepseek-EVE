/**
 * **舰船仓库**（2026-09-14 船长 · 三号 · verify）
 *
 * 船长原话（照抄）：「接下来实现舰船出售，建议先将舰队页面中的舰船市场换成舰船仓库，所有组装机生产的
 * 舰船都放进舰船仓库内，并允许堆叠数量。舰船仓库内添加筛选：全部/已拥有/未拥有。以及和我的舰队页面
 * 相同的类别，级别筛选。玩家可以从舰船仓库中将船转移到我的舰队内。而我的舰队内的无装配满耐久的舰船
 * 也可以转移到舰船仓库。之后移除我的舰队内舰船的出售按钮。」
 * ＋（用途补充）「**舰船仓库是用于方便市场出售舰船的**」。
 *
 * 本件钉八件事：
 * ① 入仓 = 舰队 -1、仓库 +1（同型**堆叠计数**，不建新键）；
 * ② 入仓逐档拒因：驾驶中 / AI 任务中 / 返航善后 / 已锁定 / 货仓不空 / 有装配 / 非满耐久（结构或装甲）；
 * ③ **自定义名不静默丢**：不带 `clearName` ⇒ 拒并标 `named`；带 `clearName` ⇒ 入仓且名字消失，
 *    出仓取回的是**全新船**（名字不回来）；
 * ④ 出仓 = 生成全新实例（满耐久 / 无装配 / 无名），仓库计数递减、为 0 删键；
 * ⑤ **组装机产出进仓库、不进舰队**（船长点名）；
 * ⑥ 仓库出售：有人收购 ⇒ 即时成交（`total` = 税后净入账）、仓库 -1、不留挂单；
 * ⑦ 无人收购 ⇒ 转限价卖单（escrow 标 `from: 'store'`），**撤单退回舰船仓库**（不进机库）；
 * ⑧ 老档零迁移：无 `shipStore` 字段 = 空仓；`escrowShips` 无 `from` 的托管船撤单**仍退回机库**；
 *    非法艘数（负数/小数/非数值/0）在存档归一里被丢弃或取整。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState, CURRENT_STATE_VERSION } from '../src/state'
import { advanceGame } from '../src/engine'
import { startManufacturing } from '../src/manufacturing'
import {
  addShipToFleet,
  lockShip,
  shipOwnedCount,
  shipStorable,
  shipStoredCount,
  storeShip,
  unstoreShip,
} from '../src/shipyard'
import { cancelOrder, sellShipAtMarket, sellStoredShipAtMarket } from '../src/market'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, ship } from './helpers'

/** 测试世界：沙猫（开局驾驶）+ 白鲨（开局闲置、空仓、满耐久）+ 一艘可入仓的「big」+ 它的市场行
 *  ⚠ 必须把开局那艘 `sh-falconet` 也放进 `ctx.ships`——`unstoreShip` 要按船型查定义
 *  （缺定义时'未知舰船'会被拒，那是**测试替身缺失**而不是仓库逻辑问题）。 */
function world(): { state: GameState; ctx: SimContext } {
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-falconet'), ship('big', { price: 500_000 })],
    marketGoods: [
      { key: 'ship-big', kind: 'ship', refId: 'big', rarity: 'rare', basePrice: 500_000, demandMultiplier: 0.65 },
      { key: 'it-min-a', kind: 'item', refId: 'min-a', rarity: 'common', basePrice: 8, poolTarget: 3_000, supplyFlow: 10 },
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  advanceGame(state, 61_000, ctx) // 开盘（与市场用例同款）
  return { state, ctx }
}

describe('舰船仓库（2026-09-14 船长）', () => {
  it('① 入仓：舰队 -1、仓库 +1，同型堆叠计数（不建新键）', () => {
    const { state, ctx } = world()
    expect(state.fleet['sh-falconet']).toBeDefined()
    expect(storeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(state.fleet['sh-falconet']).toBeUndefined()
    expect(shipStoredCount(state, 'sh-falconet')).toBe(1)
    expect(state.logs.some((l) => l.text.includes('已移入舰船仓库'))).toBe(true)
    // 同型再来一艘 ⇒ 堆叠 +1
    const uid2 = addShipToFleet(state, 'sh-falconet')
    expect(storeShip(state, uid2, ctx).ok).toBe(true)
    expect(shipStoredCount(state, 'sh-falconet')).toBe(2)
    expect(Object.keys(state.shipStore ?? {})).toEqual(['sh-falconet'])
  })

  it('② 入仓逐档拒因：驾驶中 / AI 任务 / 返航善后 / 锁定 / 有货 / 有装配 / 非满耐久', () => {
    const { state, ctx } = world()
    // 驾驶中
    expect(storeShip(state, 'sandcat', ctx).error).toContain('正在驾驶')
    // AI 任务执行中
    state.aiAssignments['sh-falconet'] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: 'belt-a', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    } as never
    expect(shipStorable(state, 'sh-falconet').reason).toContain('AI 任务')
    delete state.aiAssignments['sh-falconet']
    // 换驾驶善后返航中
    state.shipReturns['sh-falconet'] = { beltId: 'belt-a', arriveAtGameMs: state.gameMs + 1_000 } as never
    expect(shipStorable(state, 'sh-falconet').reason).toContain('返航')
    delete state.shipReturns['sh-falconet']
    // 已锁定（防误操作）
    expect(lockShip(state, 'sh-falconet', true, ctx).ok).toBe(true)
    expect(shipStorable(state, 'sh-falconet').reason).toContain('锁定')
    expect(storeShip(state, 'sh-falconet', ctx).ok).toBe(false)
    expect(lockShip(state, 'sh-falconet', false, ctx).ok).toBe(true)
    // 货仓不空
    state.fleet['sh-falconet']!.cargo = { 'ore-a': 3 }
    expect(shipStorable(state, 'sh-falconet').reason).toContain('货仓')
    state.fleet['sh-falconet']!.cargo = {}
    // 有装配
    state.fleet['sh-falconet']!.fitted.high[0] = 'mod-any'
    expect(shipStorable(state, 'sh-falconet').reason).toContain('模块')
    state.fleet['sh-falconet']!.fitted.high[0] = null
    // 非满耐久：结构一档、装甲一档
    state.fleet['sh-falconet']!.durability = 0.9
    expect(shipStorable(state, 'sh-falconet').reason).toContain('满耐久')
    state.fleet['sh-falconet']!.durability = 1
    state.fleet['sh-falconet']!.armorPct = 0.9
    expect(shipStorable(state, 'sh-falconet').reason).toContain('满耐久')
    state.fleet['sh-falconet']!.armorPct = 1
    // 全清 ⇒ 可以入仓
    expect(shipStorable(state, 'sh-falconet').ok).toBe(true)
  })

  it('③ 自定义名：不带 clearName 拒（标 named），带了才入仓并清名（不静默丢名）', () => {
    const { state, ctx } = world()
    state.fleet['sh-falconet']!.customName = '老伙计'
    const check = shipStorable(state, 'sh-falconet')
    expect(check.ok).toBe(false)
    expect(check.named).toBe(true)
    expect(storeShip(state, 'sh-falconet', ctx).ok).toBe(false)
    expect(state.fleet['sh-falconet']).toBeDefined() // 被拒 ⇒ 一点没动
    expect(storeShip(state, 'sh-falconet', ctx, { clearName: true }).ok).toBe(true)
    expect(shipStoredCount(state, 'sh-falconet')).toBe(1)
    // 出仓取回的是**全新船**：名字不会回来
    expect(unstoreShip(state, 'sh-falconet', ctx).ok).toBe(true)
    const back = state.fleet['sh-falconet']!
    expect(back.customName).toBeNull()
  })

  it('④ 出仓：生成全新实例（满耐久 / 无装配 / 无名）；仓空时拒绝；为 0 时删键', () => {
    const { state, ctx } = world()
    expect(unstoreShip(state, 'sandcat2', ctx).ok).toBe(false) // 仓里没有 ⇒ 拒
    expect(unstoreShip(state, '不存在的船', ctx).ok).toBe(false) // 未知船型 ⇒ 拒
    expect(storeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(unstoreShip(state, 'sh-falconet', ctx).ok).toBe(true)
    const uid = 'sh-falconet' // 同型一艘不剩 ⇒ 重新用船型 id 当实例键
    const fresh = state.fleet[uid]!
    expect(fresh).toBeDefined()
    expect(fresh.defId).toBe('sh-falconet')
    expect(fresh.durability).toBe(1)
    expect(fresh.armorPct).toBe(1)
    expect(fresh.customName).toBeNull()
    expect(fresh.cargo).toEqual({})
    expect(Object.values(fresh.fitted).flat().filter(Boolean)).toHaveLength(0)
    expect(state.shipStore?.['sh-falconet']).toBeUndefined() // 计数归零即删键
  })

  it('⑤ 组装机产出：造完的船进**舰船仓库**，舰队一艘不多（船长点名）', () => {
    const { state, ctx } = world()
    state.learnedRecipes.push('sbp-a') // 测试世界里的舰船蓝图：造 sandcat2（60 秒）
    state.warehouse.items['min-a'] = 5
    const fleetBefore = Object.keys(state.fleet).sort()
    expect(startManufacturing(state, 'sbp-a', 'pilot', ctx).ok).toBe(true)
    advanceGame(state, 61_000, ctx)
    expect(shipStoredCount(state, 'sandcat2')).toBe(1)
    expect(Object.keys(state.fleet).sort()).toEqual(fleetBefore) // 舰队不变：没有自动入列
    expect(state.logs.some((l) => l.text.includes('已入舰船仓库'))).toBe(true)
  })

  it('⑥ 仓库出售·有人收购：即时成交（total = 税后净入账）、仓库 -1、不留挂单', () => {
    const { state, ctx } = world()
    const uid = addShipToFleet(state, 'big')
    expect(storeShip(state, uid, ctx).ok).toBe(true)
    expect(shipStoredCount(state, 'big')).toBe(1)
    state.market.npcBuy['ship-big'] = [{ price: 600_000, qty: 1, expiresAtGameMs: state.gameMs + 1_000_000 }]
    const wallet0 = state.wallet.isk
    const res = sellStoredShipAtMarket(state, ctx, 'big')
    expect(res.ok).toBe(true)
    expect(res.total).toBeGreaterThan(0)
    expect(state.wallet.isk).toBe(wallet0 + (res.total ?? 0)) // total 已是税后
    expect(shipStoredCount(state, 'big')).toBe(0)
    expect(state.shipStore?.['big']).toBeUndefined()
    expect(state.orders).toHaveLength(0) // 即时成交：不留单
    expect(Object.values(state.escrowShips)).toHaveLength(0)
  })

  it('⑦ 仓库出售·无人收购：转限价卖单（escrow 标 store），撤单**退回舰船仓库**而不是机库', () => {
    const { state, ctx } = world()
    const uid = addShipToFleet(state, 'big')
    expect(storeShip(state, uid, ctx).ok).toBe(true)
    state.market.npcBuy['ship-big'] = [] // 清空收购簿 ⇒ 走挂单分支
    const res = sellStoredShipAtMarket(state, ctx, 'big')
    expect(res.ok).toBe(true)
    const order = state.orders[0]!
    expect(order.side).toBe('sell')
    expect(order.qty).toBe(1)
    expect(state.escrowShips[order.id]?.from).toBe('store')
    // 存档往返：托管来源标记必须活着（否则撤单会退错地方）
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.escrowShips[order.id]?.from).toBe('store')
    expect(shipStoredCount(state, 'big')).toBe(0) // 已离仓
    // 撤单 ⇒ 退回仓库（不进机库）
    expect(cancelOrder(state, ctx, order.id)).toBe(true)
    expect(shipStoredCount(state, 'big')).toBe(1)
    expect(state.escrowShips[order.id]).toBeUndefined()
    expect(Object.values(state.fleet).some((s) => s.defId === 'big')).toBe(false)
    expect(state.logs.some((l) => l.text.includes('退回舰船仓库'))).toBe(true)
  })

  it('⑧ 老档零迁移：无 shipStore = 空仓；无 from 的托管船撤单仍退回机库（原实例原样）', () => {
    const { state, ctx } = world()
    const uid = addShipToFleet(state, 'big')
    state.fleet[uid]!.customName = '待售旧船'
    state.market.npcBuy['ship-big'] = []
    // 舰队实例版出售（老口径，界面已无入口）：escrow **不写 from**（缺省 = 舰队）
    expect(sellShipAtMarket(state, ctx, uid).ok).toBe(true)
    const order = state.orders[0]!
    expect(state.escrowShips[order.id]?.from).toBeUndefined()
    // 补一个显式 'store' 之外的非法值 ⇒ 归一后仍按舰队退回
    state.escrowShips[order.id]!.from = 'weird' as never
    expect(cancelOrder(state, ctx, order.id)).toBe(true)
    expect(state.fleet['big']).toBeDefined()
    expect(state.fleet['big']!.customName).toBe('待售旧船')
    // 存档往返：有货时保留；缺省 = 空；非法值丢弃/取整
    const w2 = world()
    expect(storeShip(w2.state, 'sh-falconet', w2.ctx).ok).toBe(true)
    expect(loadSaveFile(serializeSaveFile(w2.state, 0)).state.shipStore).toEqual({ 'sh-falconet': 1 })
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.shipStore ?? {}).toEqual({})
    const rawText = JSON.stringify({
      format: SAVE_FORMAT,
      version: CURRENT_STATE_VERSION,
      savedAtWallMs: 0,
      state: { shipStore: { 'sh-falconet': 2, neg: -1, frac: 1.7, str: 'x', zero: 0 } },
    })
    expect(loadSaveFile(rawText).state.shipStore).toEqual({ 'sh-falconet': 2, frac: 1 })
  })

  it('⑨ 计数单点：`shipStoredCount` 只看仓库、`shipOwnedCount` = 仓库 ＋ 在役舰队', () => {
    const { state, ctx } = world()
    expect(shipStoredCount(state, 'sh-falconet')).toBe(0)
    expect(shipOwnedCount(state, 'sh-falconet')).toBe(1) // 在役 1
    expect(storeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(shipStoredCount(state, 'sh-falconet')).toBe(1)
    expect(shipOwnedCount(state, 'sh-falconet')).toBe(1) // 移库不改总数
    addShipToFleet(state, 'sh-falconet')
    expect(shipStoredCount(state, 'sh-falconet')).toBe(1)
    expect(shipOwnedCount(state, 'sh-falconet')).toBe(2)
    // 非法值一律当 0（负数/NaN 不炸）
    expect(shipStoredCount({ ...state, shipStore: { x: -3 } } as never, 'x')).toBe(0)
  })
})
