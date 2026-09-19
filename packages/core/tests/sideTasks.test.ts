/**
 * **任务中心·时效任务板**（资源 / 快递）用例 —— 2026-09-18 改版后口径：
 * 「初始每个任务数量提高到4」·「每个建成的空间站让任务数量+2」·「任务划分级别，级别越高收购量/货舱越大、
 * 奖励越高」·「快递改用和长途运输一样的虚拟货物」·「普通快递 / 限时快递（跃迁速度门槛，超时无报酬）」·
 * 「接取的快递任务不会被刷掉」·「资源任务完成时移除涨价部分」。
 *
 * 覆盖：刷新（条数/级别/周期/离线）· 资源完成与市场影响（削 25% / shock ±0.05 / 同商品每轮一次）·
 * 候选池门槛（含残骸排除）· 快递虚拟货物（体积/货舱门槛/跃迁门槛/超时/接单/存档）· 老档兼容。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import {
  COURIER_ACCEPT_MAX,
  COURIER_TASK_BASE_VOLUME_M3,
  COURIER_TASK_LEVEL_RATE,
  COURIER_TIMED_WARP_REQ,
  DEFAULT_BALANCE,
  RESOURCE_TASK_LEVEL_MARGIN,
  SIDE_TASK_BASE_COUNT,
  SIDE_TASK_COUNT_PER_STATION,
  SIDE_TASK_LEVEL_SCALE,
  SPAWN_SHOCK_STEP,
  SPAWN_SUPPLY_CUT,
  abandonAcceptedCourierTask,
  acceptCourierTask,
  addShipToFleet,
  advanceGame,
  advanceSideTasks,
  builtStationCount,
  changeShip,
  completeSideTask,
  courierVolumeFor,
  createInitialState,
  loadSaveFile,
  marketQuote,
  serializeSaveFile,
  sideTaskBoard,
  sideTaskCandidateGoods,
  startCourierDelivery,
  taskCountsFor,
} from '../src/index'
import { belt, makeTestCtx, ore, ship } from './helpers'
import { CURRENT_STATE_VERSION } from '../src/state'

/** 本板周期 = 市场常驻订单寿命（20 分钟；船长 2026-09-18 明确回滚保留） */
const PERIOD = DEFAULT_BALANCE.market.orderLifeMs.common
const FIRST_OPEN_MS = PERIOD + 1_000

/** 测试商品（8 种：4 矿 4 矿物 —— 够铺 L1~L4，也够 8 条席位的用例） */
const GOODS = [
  { key: 'it-ore-a', kind: 'item' as const, refId: 'ore-a', rarity: 'common' as const, basePrice: 12, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-ore-b', kind: 'item' as const, refId: 'ore-b', rarity: 'common' as const, basePrice: 20, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-ore-c', kind: 'item' as const, refId: 'ore-c', rarity: 'common' as const, basePrice: 15, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-ore-d', kind: 'item' as const, refId: 'ore-d', rarity: 'common' as const, basePrice: 18, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-min-a', kind: 'item' as const, refId: 'min-a', rarity: 'common' as const, basePrice: 8, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-min-b', kind: 'item' as const, refId: 'min-b', rarity: 'common' as const, basePrice: 12, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-min-c', kind: 'item' as const, refId: 'min-c', rarity: 'common' as const, basePrice: 10, poolTarget: 2_000, supplyFlow: 100 },
  { key: 'it-min-d', kind: 'item' as const, refId: 'min-d', rarity: 'common' as const, basePrice: 14, poolTarget: 2_000, supplyFlow: 100 },
]

/** 快速造一座 3 档副站（置 stage=3 视为已建成） */
function stationSite(id: string, galaxyId: string, name: string) {
  return {
    id,
    name,
    galaxyId,
    standingReq: 0,
    tiers: [
      { name: '档1', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '施工推进' },
      { name: '档2', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '设备安装' },
      { name: '档3', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '建成并入空间站清单' },
    ],
    introDialogueId: null,
    doneDialogueId: null,
    description: '测试建站点',
  }
}

function quietBalance(): typeof DEFAULT_BALANCE {
  return { ...DEFAULT_BALANCE, market: { ...DEFAULT_BALANCE.market, noiseStep: 0 } }
}

/** 世界：4 种商品 + 可选若干已建成副站 + 快/大两条测试船 */
function makeWorld(opts?: { stations?: ReturnType<typeof stationSite>[]; built?: string[] }): {
  state: GameState
  ctx: SimContext
} {
  const state = createInitialState({ nowWallMs: 0, seed: 2024 })
  const ctx = makeTestCtx({
    quietEvents: true,
    marketGoods: GOODS,
    // 四种矿石各配一条母港矿带 ⇒ 候选池 = 8 种（够"8 条席位"那条用例）
    belts: [belt('belt-b', 'ore-b'), belt('belt-c', 'ore-c'), belt('belt-d', 'ore-d')],
    stations: opts?.stations ?? [],
    ships: [
      // 快船（跃迁 11 AU/s ⇒ 过 L5 门槛 10.92）· 大货舱 6,000 m³
      ship('sh-fast', { cargo: 6000, warpSpeedAus: 11 }),
      // 慢船（跃迁 3.5 ⇒ 任何限时快递都接不了）· 货舱 2,600 m³（能装 L5 体积）
      ship('sh-slow', { cargo: 2600, warpSpeedAus: 3.5 }),
    ],
    balance: quietBalance(),
  })
  for (const id of ['sh-fast', 'sh-slow']) addShipToFleet(state, id)
  for (const id of opts?.built ?? []) state.stationSites[id] = { stage: 3, delivered: {} }
  return { state, ctx }
}


/** 期望的资源奖励（与 sideTasks.resourceRewardIskFor 同口径；钳制 = 必须 < need×供应价） */
function expectResourceReward(need: number, buy: number, level: 1 | 2 | 3 | 4 | 5, sell?: number): number {
  let r = Math.max(100, Math.floor((need * buy * RESOURCE_TASK_LEVEL_MARGIN[level]) / 100) * 100)
  if (sell !== undefined && r >= need * sell) r = Math.min(r, Math.floor((need * sell - 1) / 100) * 100)
  return r
}

/** 期望的快递运费（体积 × 级别单价 × 航程系数[标称分钟/10，下限 0.5、无上限]） */
function expectCourierReward(volumeM3: number, level: 1 | 2 | 3 | 4 | 5, nominalMinutes: number): number {
  const trip = Math.max(0.5, nominalMinutes / 10)
  return Math.max(100, Math.floor((volumeM3 * COURIER_TASK_LEVEL_RATE[level] * trip) / 100) * 100)
}

describe('时效任务板 · 条数与级别（2026-09-18 船长改版）', () => {
  it('基础条数 4/类；每建成一座副站 +2（资源与快递各算）', () => {
    const { state, ctx } = makeWorld()
    expect(taskCountsFor(state, ctx)).toEqual({ resource: SIDE_TASK_BASE_COUNT, courier: SIDE_TASK_BASE_COUNT })
    state.stationSites['site-1'] = { stage: 3, delivered: {} }
    expect(builtStationCount(state, ctx)).toBe(0) // 站点不在 ctx 里 ⇒ 不算建成
    const w2 = makeWorld({ stations: [stationSite('site-1', 'galaxy-hub', '一号站')], built: ['site-1'] })
    expect(taskCountsFor(w2.state, w2.ctx)).toEqual({
      resource: SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION,
      courier: SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION,
    })
  })

  it('首板：资源 4 条且 L1~L4 各一条；need 是 10 的倍数、reward 按级别系数且 < need×供应价', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    expect(board.resource).toHaveLength(4)
    expect(board.courier).toHaveLength(0) // 没有已建成副站 ⇒ 快递不刷
    expect(board.resource.map((t) => t.level).sort()).toEqual([1, 2, 3, 4])
    // 同一商品每轮只出现一次
    expect(new Set(board.resource.map((t) => t.goodKey)).size).toBe(4)
    for (const t of board.resource) {
      expect(t.need % 10).toBe(0)
      expect(t.need).toBeGreaterThanOrEqual(10)
      const q = marketQuote(state, ctx, t.goodKey)
      expect(t.rewardIsk).toBe(expectResourceReward(t.need, q.buy!, t.level!, q.sell))
    }
  })

  it('级别倍率：同一商品的高级别任务需量更大（L1 15 分钟产量 ⇒ L5 8 倍）', () => {
    expect(SIDE_TASK_LEVEL_SCALE[1]).toBe(1)
    expect(SIDE_TASK_LEVEL_SCALE[5]).toBe(8)
    expect(courierVolumeFor(1)).toBe(COURIER_TASK_BASE_VOLUME_M3)
    expect(courierVolumeFor(5)).toBe(COURIER_TASK_BASE_VOLUME_M3 * 8)
  })

  it('副站多 ⇒ 席位多；L1~L4 每个种子都出现，L5 在剩余席位里能掷出（扫多个种子）', () => {
    let sawL5 = false
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createInitialState({ nowWallMs: 0, seed })
      const ctx = makeTestCtx({
        quietEvents: true,
        marketGoods: GOODS,
        belts: [belt('belt-b', 'ore-b'), belt('belt-c', 'ore-c'), belt('belt-d', 'ore-d')],
        stations: [stationSite('s1', 'galaxy-hub', '一号站'), stationSite('s2', 'galaxy-hub', '二号站')],
        balance: quietBalance(),
      })
      state.stationSites['s1'] = { stage: 3, delivered: {} }
      state.stationSites['s2'] = { stage: 3, delivered: {} }
      marketQuote(state, ctx, 'it-ore-a')
      advanceGame(state, FIRST_OPEN_MS, ctx)
      const board = sideTaskBoard(state, ctx)
      expect(board.resource).toHaveLength(8) // 2 座站 ⇒ 4 + 2×2
      expect(board.courier).toHaveLength(8)
      const levels = board.resource.map((t) => t.level!)
      for (const lv of [1, 2, 3, 4]) expect(levels, `seed ${seed} 缺 L${lv}`).toContain(lv)
      if (levels.includes(5)) sawL5 = true
    }
    expect(sawL5, '12 个种子里一次 L5 都没掷出（剩余席位权重可能没生效）').toBe(true)
  })

  it('同 seed 双跑：整板内容与市场副作用完全一致', () => {
    const a = makeWorld()
    const b = makeWorld()
    marketQuote(a.state, a.ctx, 'it-ore-a')
    marketQuote(b.state, b.ctx, 'it-ore-a')
    advanceGame(a.state, FIRST_OPEN_MS, a.ctx)
    advanceGame(b.state, FIRST_OPEN_MS, b.ctx)
    const snap = (s: GameState): string =>
      JSON.stringify(sideTaskBoard(s, a.ctx).resource.map((t) => [t.id, t.level, t.need, t.rewardIsk, t.goodKey]))
    expect(snap(a.state)).toBe(snap(b.state))
    expect(a.state.market.pools['it-ore-a']!.shock).toBe(b.state.market.pools['it-ore-a']!.shock)
  })

  it('周期 20 分钟：不足一周期不刷；跨整点整板换新（新 id）；离线大步长只按末窗刷一次', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 5 * 60_000, ctx)
    expect(sideTaskBoard(state, ctx).resource).toHaveLength(0) // 没到首个整点
    advanceGame(state, FIRST_OPEN_MS - 5 * 60_000, ctx)
    const first = sideTaskBoard(state, ctx).resource.map((t) => t.id)
    expect(first).toHaveLength(4)
    // 离线大步长跨 3 个周期：只按末窗刷一次（id 只 +4）
    advanceGame(state, 3 * PERIOD, ctx)
    const second = sideTaskBoard(state, ctx).resource.map((t) => t.id)
    expect(second).toHaveLength(4)
    expect(Math.max(...second)).toBe(Math.max(...first) + 4)
  })
})

describe('时效任务板 · 完成与市场联动', () => {
  it('资源完成：扣货、入账、下板，并**回退涨价部分**（shock −0.05）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const task = sideTaskBoard(state, ctx).resource[0]!
    const shockAfterSpawn = state.market.pools[task.goodKey]!.shock
    expect(shockAfterSpawn).toBeGreaterThan(0)
    state.warehouse.items[task.refId] = task.need + 50
    const iskBefore = state.wallet.isk
    expect(completeSideTask(state, ctx, 'resource', task.id).ok).toBe(true)
    expect(state.wallet.isk).toBe(iskBefore + task.rewardIsk)
    expect(state.warehouse.items[task.refId]).toBe(50)
    expect(sideTaskBoard(state, ctx).resource.some((t) => t.id === task.id)).toBe(false)
    // 涨价部分已移除（供应削减与池扣不回退）
    expect(state.market.pools[task.goodKey]!.shock).toBeCloseTo(shockAfterSpawn - SPAWN_SHOCK_STEP, 10)
  })

  it('库存不足拒绝完成：提示差量、不扣货、不入账、任务仍在板', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const task = sideTaskBoard(state, ctx).resource[0]!
    state.warehouse.items[task.refId] = task.need - 10
    const isk = state.wallet.isk
    const r = completeSideTask(state, ctx, 'resource', task.id)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.error).toContain('不足')
    expect(state.wallet.isk).toBe(isk)
    expect(sideTaskBoard(state, ctx).resource.some((t) => t.id === task.id)).toBe(true)
  })

  it('刷出市场影响：shock +0.05（完成时回退）；不碰玩家订单簿（削供应的精确量随市场刷新节拍波动，不逐字断言）', () => {
    const { state, ctx } = makeWorld()
    marketQuote(state, ctx, 'it-ore-a')
    expect(SPAWN_SUPPLY_CUT).toBe(0.25) // 条数翻倍后由 0.45 下调（船长 2026-09-18）
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    for (const t of board.resource) {
      // 每条资源任务对它那件商品抬价一步（上限 0.4）
      expect(state.market.pools[t.goodKey]!.shock).toBeCloseTo(SPAWN_SHOCK_STEP, 10)
    }
    expect(state.orders).toHaveLength(0) // 玩家挂单簿不受影响
  })
})

describe('时效任务板 · 候选池', () => {
  const WRECK_ITEM = {
    id: 'wreck-x',
    name: '测试编队残骸',
    kind: 'wreck' as const,
    unitM3: 1,
    baseSellPriceIsk: 1,
    description: '测试用残骸物品。',
  }
  const WRECK_GOOD = { key: 'wreck-x', kind: 'item' as const, refId: 'wreck-x', rarity: 'common' as const, basePrice: 30, poolTarget: 2_000, supplyFlow: 100 }

  it('残骸不进候选池：未持有不放行，仓库已有也不放行（船长 2026-09-18）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const ctx = makeTestCtx({ quietEvents: true, items: [WRECK_ITEM], marketGoods: [...GOODS, WRECK_GOOD], balance: quietBalance() })
    const keysOf = (): string[] => sideTaskCandidateGoods(state, ctx).map((g) => g.key).sort()
    expect(keysOf()).not.toContain('wreck-x')
    state.warehouse.items['wreck-x'] = 500
    expect(keysOf()).not.toContain('wreck-x')
  })

  it('未探索星系矿带的产物不出现在候选；仓库已有或探索该星系后放行', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const farOre = ore('ore-far', { name: '远矿', price: 30 })
    const FAR_GOOD = { key: 'it-ore-far', kind: 'item' as const, refId: 'ore-far', rarity: 'common' as const, basePrice: 30, poolTarget: 2_000, supplyFlow: 100 }
    const ctx = makeTestCtx({
      quietEvents: true,
      items: [farOre],
      belts: [belt('belt-far', 'ore-far', '远矿带', { galaxyId: 'galaxy-far' })],
      marketGoods: [...GOODS, FAR_GOOD],
      balance: quietBalance(),
    })
    const keysOf = (): string[] => sideTaskCandidateGoods(state, ctx).map((g) => g.key).sort()
    expect(keysOf()).not.toContain('it-ore-far')
    state.warehouse.items['ore-far'] = 7
    expect(keysOf()).toContain('it-ore-far')
  })
})

describe('快递 · 虚拟货物（2026-09-18 船长改版）', () => {
  it('未建成副站不刷；建成后 4 条、均绑定目标站、体积按级别、报酬按体积与航程', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    expect(board.courier).toHaveLength(SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION) // 一座站 ⇒ 4+2
    for (const t of board.courier) {
      expect(t.kind).toBe('courier')
      expect(t.stationId).toBe('s1')
      expect(t.galaxyId).toBe('galaxy-far')
      expect(t.volumeM3).toBe(courierVolumeFor(t.level!))
      expect(t.refId).toBe('') // 不再绑商品
      expect(t.need).toBe(0)
      expect(t.rewardIsk).toBe(expectCourierReward(t.volumeM3!, t.level!, 2)) // 母港→远方 = 2 分钟标称
    }
  })

  it('限时快递：L2~L5 门槛 = 剑鱼 4 档（6.20 / 7.44 / 8.37 / 10.92），L1 为普通快递', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    for (const t of sideTaskBoard(state, ctx).courier) {
      if (t.level === 1) {
        expect(t.timed).toBeUndefined()
        expect(t.warpReqAus).toBeUndefined()
      } else {
        expect(t.timed).toBe(true)
        expect(t.warpReqAus).toBe(COURIER_TIMED_WARP_REQ[t.level! - 2])
        expect(t.timeLimitMs).toBeGreaterThan(0)
      }
    }
  })

  it('出发：不扣任何物品（虚拟货物）、卸真实货入仓、挂入在途；货舱不足被拒', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const task = sideTaskBoard(state, ctx).courier.find((t) => t.level === 1)!
    // 小船（沙猫 800 m³）装不下 L1 的 300 m³？能装 ⇒ 用一艘更小的船验证拒绝
    state.warehouse.items['ore-a'] = 123
    expect(startCourierDelivery(state, ctx, task.id).ok).toBe(true)
    const d = state.sideTasks.deliver!
    expect(d.volumeM3).toBe(task.volumeM3)
    expect(state.warehouse.items['ore-a']).toBe(123) // 一件都不扣
    expect(state.warehouse.items['ore-a']).toBeGreaterThan(0)
    expect(sideTaskBoard(state, ctx).deliver?.taskId).toBe(task.id)
  })

  it('限时快递跃迁门槛：慢船被拒、快船放行（门槛 = 剑鱼 4 档之一）', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const timed = sideTaskBoard(state, ctx).courier.find((t) => t.timed === true)!
    expect(timed.warpReqAus).toBeGreaterThan(0)
    // 慢船（3.5 AU/s）：任何限时档都过不了
    expect(changeShip(state, 'sh-slow', ctx).ok).toBe(true)
    const slow = startCourierDelivery(state, ctx, timed.id)
    expect(slow.ok).toBe(false)
    expect(slow.ok ? '' : slow.error).toContain('跃迁速度')
    // 快船（11 AU/s ≥ 最高档 10.92，货舱 6,000 ≥ L5 的 2,400）⇒ 放行
    expect(changeShip(state, 'sh-fast', ctx).ok).toBe(true)
    expect(startCourierDelivery(state, ctx, timed.id).ok).toBe(true)
  })

  it('到站结算：运费入账、任务离场、投送清空；**超时则无报酬、任务作废**（甲案）', () => {
    const a = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(a.state, a.ctx, 'it-ore-a')
    advanceGame(a.state, FIRST_OPEN_MS, a.ctx)
    expect(changeShip(a.state, 'sh-fast', a.ctx).ok).toBe(true)
    const t1 = sideTaskBoard(a.state, a.ctx).courier.find((t) => t.level === 1)!
    expect(startCourierDelivery(a.state, a.ctx, t1.id).ok).toBe(true)
    const iskBefore = a.state.wallet.isk
    advanceGame(a.state, 10 * 60_000, a.ctx)
    expect(a.state.wallet.isk).toBe(iskBefore + t1.rewardIsk)
    expect(a.state.sideTasks.deliver).toBeNull()

    // 超时分支：把截止时刻压到出发之后（模拟晚到）
    const b = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(b.state, b.ctx, 'it-ore-a')
    advanceGame(b.state, FIRST_OPEN_MS, b.ctx)
    expect(changeShip(b.state, 'sh-fast', b.ctx).ok).toBe(true)
    const t2 = sideTaskBoard(b.state, b.ctx).courier.find((t) => t.level === 2)!
    expect(startCourierDelivery(b.state, b.ctx, t2.id).ok).toBe(true)
    b.state.sideTasks.deliver!.deadlineAtGameMs = b.state.gameMs // 立刻过期 ⇒ 到站即超时
    const isk2 = b.state.wallet.isk
    advanceGame(b.state, 10 * 60_000, b.ctx)
    expect(b.state.wallet.isk).toBe(isk2)
    expect(b.state.sideTasks.deliver).toBeNull()
    expect(b.state.logs.some((l) => l.text.includes('限时快递超时'))).toBe(true)
  })

  it('接单：移进"已接单"、跨整板刷新保留、上限 4、可放弃', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    const firstFour = board.courier.slice(0, COURIER_ACCEPT_MAX)
    for (const t of firstFour) expect(acceptCourierTask(state, t.id).ok).toBe(true)
    expect(state.sideTasks.accepted!).toHaveLength(COURIER_ACCEPT_MAX)
    // 上限：第 5 条被拒
    const fifth = board.courier.find((t) => !firstFour.some((f) => f.id === t.id))
    if (fifth) {
      const r = acceptCourierTask(state, fifth.id)
      expect(r.ok).toBe(false)
      expect(r.ok ? '' : r.error).toContain('上限')
    }
    // 跨整板刷新（推进两个周期）：已接单仍在，且**不受 20 分钟到期限制**可出发
    advanceGame(state, 2 * PERIOD, ctx)
    expect(state.sideTasks.accepted!).toHaveLength(COURIER_ACCEPT_MAX)
    expect(changeShip(state, 'sh-fast', ctx).ok).toBe(true)
    const picked = state.sideTasks.accepted![0]!
    expect(startCourierDelivery(state, ctx, picked.id).ok).toBe(true)
    // 放弃另一单：离场
    const other = state.sideTasks.accepted![0]!
    expect(abandonAcceptedCourierTask(state, other.id).ok).toBe(true)
    expect(state.sideTasks.accepted!.some((t) => t.id === other.id)).toBe(false)
  })

  it('存档往返：已接单与在途投送保真（虚拟货物字段带上）', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const t = sideTaskBoard(state, ctx).courier.find((x) => x.level === 1)!
    acceptCourierTask(state, t.id)
    advanceGame(state, 60_000, ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.sideTasks.accepted?.[0]?.volumeM3).toBe(t.volumeM3)
    expect(loaded.sideTasks.accepted?.[0]?.level).toBe(1)
  })

  it('老档兼容：sideTasks 无 accepted 字段照常读入并可接单', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: { sideTasks: Record<string, unknown> } }
    delete raw.state.sideTasks.accepted
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.sideTasks.accepted ?? []).toHaveLength(0)
    const t = sideTaskBoard(loaded, ctx).courier[0]!
    expect(acceptCourierTask(loaded, t.id).ok).toBe(true)
  })

  it('v23 老档（无 sideTasks 字段）读入：版本升到当前、补空板（含 deliver=null）；随后正常按整点刷出', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const raw = state as unknown as Record<string, unknown>
    delete raw.sideTasks
    raw.version = 23
    const loaded = loadSaveFile(serializeSaveFile(raw as unknown as GameState, 0))
    expect(loaded.state.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.state.sideTasks.resource).toHaveLength(0)
    expect(loaded.state.sideTasks.deliver).toBeNull()
    const ctx = makeTestCtx({ quietEvents: true, marketGoods: GOODS, balance: quietBalance() })
    marketQuote(loaded.state, ctx, 'it-ore-a')
    advanceGame(loaded.state, FIRST_OPEN_MS, ctx)
    expect(loaded.state.sideTasks.resource).toHaveLength(SIDE_TASK_BASE_COUNT)
  })

  it('已刷出任务板的往返保存：seq/window/任务（含级别与体积）/deliver 完整保留', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.sideTasks.resource).toEqual(state.sideTasks.resource)
    expect(loaded.sideTasks.courier).toEqual(state.sideTasks.courier)
    // 往返后仍可完成资源任务（同轮内）
    const task = loaded.sideTasks.resource[0]!
    loaded.warehouse.items[task.refId] = 999_999
    expect(completeSideTask(loaded, ctx, 'resource', task.id).ok).toBe(true)
  })
})
