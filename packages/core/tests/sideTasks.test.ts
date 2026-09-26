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
  COURIER_TASK_LEVEL_FREIGHT_ISK,
  COURIER_TASK_LEVEL_VOLUME,
  COURIER_TIMED_CHANCE,
  COURIER_TIMED_PREMIUM,
  COURIER_TIMED_VOLUME_RATIO,
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
  /** 快递板周期（120 分钟，2026-09-24 船长令）——倒计时/出发护栏的用例按它算 */
  COURIER_BOARD_PERIOD_MS,
  completeSideTask,
  courierVolumeFor,
  createInitialState,
  loadSaveFile,
  MIN_MIGRATABLE_VERSION,
  marketQuote,
  serializeSaveFile,
  sideTaskBoard,
  sideTaskCandidateGoods,
  startCourierDelivery,
  taskCountsFor,
  HOME_GALAXY_ID,
  shortestTravelMinutes,
  travelLegMs,
  /** 2026-09-26 最高档门槛边界用例：真读数与装配都要走 core 单点 */
  warpSpeedAus,
  addModule,
} from '../src/index'
import { buildSimContext } from '@whale/data'
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
      // 快船（跃迁 11 AU/s ⇒ 过 L5 门槛 10.91）· 大货舱 6,000 m³
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

/** 期望的快递运费（级别运费基准 × 航程系数[标称分钟/10，下限 0.5] × 限时加急 1.5；运费与体积解耦） */
function expectCourierReward(level: 1 | 2 | 3 | 4 | 5, nominalMinutes: number, timed = false): number {
  const trip = Math.max(0.5, nominalMinutes / 10)
  const premium = timed ? COURIER_TIMED_PREMIUM : 1
  return Math.max(100, Math.floor((COURIER_TASK_LEVEL_FREIGHT_ISK[level] * trip * premium) / 100) * 100)
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

  it('级别倍率与体积表：资源需量按 1/1.7/3/5/8 放大；快递体积 L1 1,000 ⇒ L5 20,000、限时减半', () => {
    expect(SIDE_TASK_LEVEL_SCALE[1]).toBe(1)
    expect(SIDE_TASK_LEVEL_SCALE[5]).toBe(8)
    // 船长 2026-09-18：「L5非限时的快递体积提高到2万立方，L1提高到1000，其他等比上调，限时快递体积为非限时的一半」
    expect(COURIER_TASK_LEVEL_VOLUME[1]).toBe(1_000)
    expect(COURIER_TASK_LEVEL_VOLUME[5]).toBe(20_000)
    expect(courierVolumeFor(1)).toBe(1_000)
    expect(courierVolumeFor(5)).toBe(20_000)
    expect(courierVolumeFor(5, true)).toBe(10_000)
    expect(courierVolumeFor(1, true)).toBe(500)
    for (const lv of [2, 3, 4] as const) {
      // 等比：相邻级别比值约 2.1（1,000 → 20,000 四步）
      expect(COURIER_TASK_LEVEL_VOLUME[lv]).toBeGreaterThan(COURIER_TASK_LEVEL_VOLUME[(lv - 1) as 1 | 2 | 3])
      expect(COURIER_TASK_LEVEL_VOLUME[lv]).toBeLessThan(COURIER_TASK_LEVEL_VOLUME[(lv + 1) as 3 | 4 | 5])
    }
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

/**
 * **快递 120 分钟周期**（2026-09-24 船长令：「快递任务的周期和持续时间都为 120 分钟，资源任务不变」＋
 * 澄清「那只改快递任务」＋「2甲」= 每批条数不动）。
 *
 * 行为口径（本组锁住）：资源族照旧**每 20 分钟**整板换；快递族**原样保留**到下一个 **120 分钟整点**
 * ⇒ 存活恰好 120 分钟、到点与下一批**同时**换（整齐一批）。120 = 20 × 6 ⇒ 每第 6 个窗换一次。
 */
describe('时效任务板 · 快递 120 分钟周期（2026-09-24 船长令）', () => {
  /** 快递板周期 = 120 分钟 */
  const COURIER_PERIOD = 120 * 60_000
  /** 世界：一座已建成副站 ⇒ 快递才有目标站可刷（条数 = 基础 4 + 每站 2） */
  const world = (): { state: GameState; ctx: SimContext } =>
    makeWorld({ stations: [stationSite('site-1', 'galaxy-hub', '一号站')], built: ['site-1'] })

  it('资源每 20 分钟换新；快递保留到 120 分钟整点才整批换新（条数不变）', () => {
    const { state, ctx } = world()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const first = sideTaskBoard(state, ctx)
    expect(state.sideTasks.window).toBe(PERIOD) // 首板窗 = 20 分钟整点
    const count = SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION
    expect(first.resource).toHaveLength(count)
    expect(first.courier).toHaveLength(count)
    const res0 = first.resource.map((t) => t.id)
    const cou0 = first.courier.map((t) => t.id)

    // 第二个窗（40 分钟整点）：**资源换新、快递一字不动**
    advanceGame(state, PERIOD, ctx)
    const second = sideTaskBoard(state, ctx)
    expect(state.sideTasks.window).toBe(2 * PERIOD)
    expect(second.resource.map((t) => t.id)).not.toEqual(res0)
    expect(second.courier.map((t) => t.id)).toEqual(cou0)

    // 第三个窗（60 分钟整点）：快递仍旧（只在整 120 分钟点换）
    advanceGame(state, PERIOD, ctx)
    expect(state.sideTasks.window).toBe(3 * PERIOD)
    expect(sideTaskBoard(state, ctx).courier.map((t) => t.id)).toEqual(cou0)

    // 直达 120 分钟整点（第 6 个窗）：**快递整批换新**——旧 id 一条不剩，条数不动
    advanceGame(state, 3 * PERIOD, ctx)
    const sixth = sideTaskBoard(state, ctx)
    expect(state.sideTasks.window).toBe(COURIER_PERIOD)
    expect(sixth.courier).toHaveLength(count)
    expect(sixth.courier.some((t) => cou0.includes(t.id))).toBe(false)
    // 资源侧同拍照常换新（两族节奏互不影响），且仍是每族各自条数
    expect(sixth.resource).toHaveLength(count)
    expect(sixth.resource.some((t) => res0.includes(t.id))).toBe(false)
  })

  it('未到点的一窗不重掷快递：快递条目的 id / 目标站 / 运费逐字不变', () => {
    const { state, ctx } = world()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const cou0 = sideTaskBoard(state, ctx).courier.map((t) => ({ ...t }))
    advanceGame(state, PERIOD, ctx)
    const cou1 = sideTaskBoard(state, ctx).courier
    expect(cou1.map((t) => [t.id, t.stationId, t.rewardIsk, t.volumeM3, t.level])).toEqual(
      cou0.map((t) => [t.id, t.stationId, t.rewardIsk, t.volumeM3, t.level]),
    )
  })

  /**
   * **倒计时与出发护栏也要按 120 分钟**（**2026-09-24 船长报障**：「快递任务现在是 2 小时刷新周期，
   * 但是卡片上和快递任务页面写的还是 20 分钟」）。
   *
   * 根因不止文案：`startCourierDelivery` 的到期护栏原先与资源共用 `boardPeriodMs`（20 分钟）⇒
   * **抽到手超过 20 分钟的单子会被判"已到期"拒发**（板上明明还挂着）；界面那套倒计时也读的
   * 资源那 20 分钟的 `remainingMs`。现分族各报：`courierRemainingMs` = 到下一个 120 分钟整点。
   */
  it('倒计时分族：快递报"到下一个 120 分钟整点"；抽到手 25 分钟后仍可出发（不再按 20 分钟判到期）', () => {
    const { state, ctx } = world()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx) // 首板：窗界 = 20 分钟
    const first = sideTaskBoard(state, ctx)
    const t = first.courier.find((x) => x.timed !== true && (x.volumeM3 ?? 0) <= 1_000)!
    expect(changeShip(state, 'sh-fast', ctx).ok).toBe(true)
    // ① 倒计时分族：资源 = 到 20 分钟整点；快递 = 到 120 分钟整点（首板窗 = 20 分钟 ⇒ 到期 120 分钟）
    expect(first.remainingMs).toBe(PERIOD - 1_000) // 窗界 20 分钟、此刻 20 分钟 +1 秒
    expect(first.courierRemainingMs).toBe(COURIER_BOARD_PERIOD_MS - state.gameMs)
    expect(first.courierRemainingMs).toBeGreaterThan(first.remainingMs)
    // ② 走到 +25 分钟（> 资源一整个周期）：资源换了一轮，**快递原单仍在板上**
    advanceGame(state, 25 * 60_000, ctx)
    const later = sideTaskBoard(state, ctx)
    expect(later.courier.some((x) => x.id === t.id), '快递不该随 20 分钟窗被换掉').toBe(true)
    expect(later.courierRemainingMs).toBe(COURIER_BOARD_PERIOD_MS - state.gameMs)
    // ③ 关键：这张"抽到手 25 分钟"的单子**仍能出发**（修前会被判"该任务已到期"）
    const r = startCourierDelivery(state, ctx, t.id)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
  })

  it('跨过 120 分钟整点：未接单的旧单被换下（在途/已接单不受影响）', () => {
    const { state, ctx } = world()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const old = sideTaskBoard(state, ctx).courier.map((t) => t.id)
    // 走到 120 分钟整点（首个整点窗）⇒ 快递重掷
    advanceGame(state, COURIER_BOARD_PERIOD_MS - FIRST_OPEN_MS + 1_000, ctx)
    const now = sideTaskBoard(state, ctx)
    expect(now.courier.some((t) => old.includes(t.id)), '旧批应被换下').toBe(false)
    expect(now.courierRemainingMs).toBe(COURIER_BOARD_PERIOD_MS - 1_000) // 刚换完 ⇒ 又是满一轮
    // 旧单已不在板上、也没接单 ⇒ 出发被拒
    expect(startCourierDelivery(state, ctx, old[0]!).ok).toBe(false)
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
  it('未建成副站不刷；建成后 4+2 条、均绑定目标站、体积按级别（限时减半）、运费只按级别与航程', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    expect(board.courier).toHaveLength(SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION) // 一座站 ⇒ 4+2
    for (const t of board.courier) {
      expect(t.kind).toBe('courier')
      expect(t.stationId).toBe('s1')
      expect(t.galaxyId).toBe('galaxy-far')
      // 体积：非限时 = 级别表值；限时 = 表值 × 0.5（船长 2026-09-18）
      expect(t.volumeM3).toBe(courierVolumeFor(t.level!, t.timed === true))
      if (t.timed === true) expect(t.volumeM3).toBe(Math.round(COURIER_TASK_LEVEL_VOLUME[t.level!] * COURIER_TIMED_VOLUME_RATIO))
      expect(t.refId).toBe('') // 不再绑商品
      expect(t.need).toBe(0)
      // 运费与体积解耦：只看级别 + 航程（母港→远方 = 2 分钟标称）
      expect(t.rewardIsk).toBe(expectCourierReward(t.level!, 2, t.timed === true))
    }
  })

  it('限时加急 +50%（船长选乙案）：同级别限时运费 = 普通 × 1.5，体积却只有一半', () => {
    expect(COURIER_TIMED_PREMIUM).toBe(1.5)
    for (const lv of [1, 2, 3, 4, 5] as const) {
      const ordinary = expectCourierReward(lv, 7, false)
      const timed = expectCourierReward(lv, 7, true)
      // 取整到百 ⇒ 比值有小误差，按 1 位小数核（精确式已由上面那条整板用例钉住）
      expect(timed / ordinary).toBeCloseTo(COURIER_TIMED_PREMIUM, 1)
      expect(timed).toBeGreaterThan(ordinary)
      expect(courierVolumeFor(lv, true)).toBe(Math.round(courierVolumeFor(lv, false) * 0.5))
    }
  })

  it('每单独立掷「普通 / 限时」；限时带本级别跃迁门槛与时限，普通两者皆无（扫多个种子都能见到限时）', () => {
    let sawTimed = false
    for (let seed = 1; seed <= 6; seed += 1) {
      const state = createInitialState({ nowWallMs: 0, seed })
      const ctx = makeTestCtx({
        quietEvents: true,
        marketGoods: GOODS,
        belts: [belt('belt-b', 'ore-b'), belt('belt-c', 'ore-c'), belt('belt-d', 'ore-d')],
        stations: [stationSite('s1', 'galaxy-far', '远方站')],
        balance: quietBalance(),
      })
      state.stationSites['s1'] = { stage: 3, delivered: {} }
      marketQuote(state, ctx, 'it-ore-a')
      advanceGame(state, FIRST_OPEN_MS, ctx)
      for (const t of sideTaskBoard(state, ctx).courier) {
        if (t.timed === true) {
          sawTimed = true
          expect(t.warpReqAus).toBe(COURIER_TIMED_WARP_REQ[Math.max(0, t.level! - 2)])
          expect(t.timeLimitMs).toBeGreaterThan(0)
        } else {
          expect(t.warpReqAus).toBeUndefined()
          expect(t.timeLimitMs).toBeUndefined()
        }
      }
    }
    expect(sawTimed, `${COURIER_TIMED_CHANCE} 概率下 6 个种子一次限时都没掷出`).toBe(true)
  })

  it('出发：不扣任何物品（虚拟货物）、按体积占舱挂入在途；货舱不足被拒', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    const board = sideTaskBoard(state, ctx)
    // ① 大船（sh-fast 6,000 m³）能装 L1（1,000 m³）
    const small = board.courier.find((t) => t.level === 1 && t.timed !== true && (t.volumeM3 ?? 0) <= 1_000)!
    expect(changeShip(state, 'sh-fast', ctx).ok).toBe(true)
    state.warehouse.items['ore-a'] = 123
    expect(startCourierDelivery(state, ctx, small.id).ok).toBe(true)
    const d = state.sideTasks.deliver!
    expect(d.volumeM3).toBe(small.volumeM3)
    expect(state.warehouse.items['ore-a']).toBe(123) // 一件都不扣
    expect(sideTaskBoard(state, ctx).deliver?.taskId).toBe(small.id)

    // ② 货舱不足被拒：默认船（沙猫 800 m³）装不下 L1 的 1,000 m³
    const b = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(b.state, b.ctx, 'it-ore-a')
    advanceGame(b.state, FIRST_OPEN_MS, b.ctx)
    const big = sideTaskBoard(b.state, b.ctx).courier.find((t) => (t.volumeM3 ?? 0) > 800)!
    const r = startCourierDelivery(b.state, b.ctx, big.id)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.error).toContain('货舱')
  })

  it('**出发地恒为母港：不在母港就自动返航**（船长 2026-09-20「出发不用加守卫，点击出发后自动返回母港」）', () => {
    const { state, ctx } = makeWorld({ stations: [stationSite('s1', 'galaxy-far', '远方站')], built: ['s1'] })
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, FIRST_OPEN_MS, ctx)
    expect(changeShip(state, 'sh-fast', ctx).ok).toBe(true)
    const t = sideTaskBoard(state, ctx).courier.find((x) => x.level === 1)!
    // ① 停靠在副站（到站结算会把玩家留在那儿）⇒ **不拦**，点出发就把船自动送回母港，再按母港航线投送
    state.dockedSite = 's1'
    expect(startCourierDelivery(state, ctx, t.id).ok).toBe(true)
    expect(state.dockedSite).toBeNull() // 已回母港
    expect(state.awayGalaxy).toBeNull()
    expect(state.logs.some((l) => l.text.includes('自动返航母港'))).toBe(true)
    // ② 航程按**母港 → 目标站**算（与报酬/时限的标称航程同源）
    const d = state.sideTasks.deliver!
    const expectMin = shortestTravelMinutes(ctx, HOME_GALAXY_ID, 'galaxy-far')
    expect(d.arriveAtGameMs - d.departAtGameMs).toBe(travelLegMs(state, ctx, expectMin))
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
    // 快船（11 AU/s ≥ 最高档 10.91，货舱 6,000 ≥ L5 的 2,400）⇒ 放行
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

  it('下限那一版的老档（无 sideTasks 字段）读入：版本升到当前、补空板（含 deliver=null）；随后正常按整点刷出', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const raw = state as unknown as Record<string, unknown>
    delete raw.sideTasks
    raw.version = MIN_MIGRATABLE_VERSION // 2026-09-19：迁移链下限（原 v23 已不可迁）
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

/**
 * **限时快递最高档的边界：双 MK3 的显示值必须真的能接**（**2026-09-26 船长报障 + 裁决乙案**）。
 *
 * 玩家报障原话（照抄）：「**限时快递任务要求大于等于10.92的跃迁速度，实际上玩家这边会因为技能等原因
 * 四舍五入显示10.92，但是依旧无法接取任务**」⇒ 船长裁决**乙案**：把门槛表最高档 10.92 落到 **10.91**。
 *
 * ⚠ 本用例**必须用真内容表**（`buildSimContext`）：门槛档位的设计基准是**剑鱼级大型货舰 + 跃迁计算机
 * MK3×2**，合成走 EVE 曲线（多件递减）⇒ 真实读数 **10.916086983754765**（显示 10.92）——
 * 这正是"看着够、实际差 0.0039"的根因。合成船型测不出这个数。
 */
describe('限时快递 · 最高档门槛边界（2026-09-26 船长裁决乙案：10.92 → 10.91）', () => {
  it('门槛表最高档 = 10.91；剑鱼 + 跃迁计算机 MK3×2 的真实读数能过（显示 10.92）', () => {
    expect(COURIER_TIMED_WARP_REQ[COURIER_TIMED_WARP_REQ.length - 1]).toBe(10.91)
    const ctxReal = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const uid = addShipToFleet(state, 'sh-swordfish')
    state.shipId = uid
    addModule(state, 'mod-warpcomp-3', 2)
    state.fleet[uid]!.fitted = { high: [], mid: [], low: ['mod-warpcomp-3', 'mod-warpcomp-3'] }

    const warp = warpSpeedAus(state, ctxReal, uid)
    expect(warp.toFixed(2), '界面显示 = 10.92（与门槛表旧值同字面量，正是报障的由来）').toBe('10.92')
    expect(warp, '真实读数比 10.92 低 0.0039（EVE 曲线倍率 1.760659，不是注释里那个 1.76）').toBeLessThan(10.92)
    // 乙案的落点：门槛落到 10.91 ⇒ 这个真实读数必须过（判定与容差一字未动）
    expect(warp + 1e-9 >= COURIER_TIMED_WARP_REQ[3]!, '双 MK3 应能接最高档限时快递').toBe(true)
    console.log(`  [读数] 剑鱼双 MK3：真实 ${warp} · 显示 ${warp.toFixed(2)} · 门槛 ${COURIER_TIMED_WARP_REQ[3]}`)
  })

  it('对照：少一件 MK3（8.37 那档）接不了最高档——门槛没被这次改动放宽', () => {
    const ctxReal = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const uid = addShipToFleet(state, 'sh-swordfish')
    state.shipId = uid
    addModule(state, 'mod-warpcomp-3', 1)
    state.fleet[uid]!.fitted = { high: [], mid: [], low: ['mod-warpcomp-3'] }
    const warp = warpSpeedAus(state, ctxReal, uid)
    expect(warp.toFixed(2)).toBe('8.37')
    expect(warp + 1e-9 >= COURIER_TIMED_WARP_REQ[3]!, '单件 MK3 仍不达最高档').toBe(false)
    expect(warp + 1e-9 >= COURIER_TIMED_WARP_REQ[2]!, '但达 L4 那档（8.37）').toBe(true)
  })
})
