/**
 * 任务中心·时效任务（资源 / 快递）——2026-09-05 船长拍板（v24），2026-09-06 修订节奏与候选池，
 * 2026-09-06 增量修订：奖励改"税前锚定" + 快递真实航行投送（主控"去程取消"的快递专项例外）。
 *
 * 规则（中文说明）：
 * - 刷新节奏 = 市场「补给刷新」周期 ctx.balance.market.orderLifeMs.common（20 分钟，
 *   与常驻订单寿命一致）：任务整板每 20 分钟换一轮——每个 20 分钟整点旧任务全部过期清空、
 *   重刷 2 条资源任务（快递在已建成副站后同刷 2 条）；每条任务只存活一轮
 *   （window → window + 20 分钟），到下一个 20 分钟整点整板替换；
 * - 任务池 = 市场常驻（common）且 poolTarget>0 的 item 商品 ∩ 玩家当前星图进度可获取的货
 *   （见 sideTaskCandidateGoods：矿石/气体/冰需其产出矿带所在星系已探索；矿物需任一产出它的
 *   矿石/气体/冰（均有精炼配方）的矿带星系已探索；弹药/修理组件/无人机等 NPC 直供无矿带依赖
 *   恒可刷；物品仓库已有该货恒放行）；每次用 rng 抽 2 个不重复商品，需要量
 *   need = round(poolTarget × (0.01 + rng×0.02)) 取整到 10、至少 10；
 * - 刷出时的市场影响（防"买来秒交"）：对含某物品 X 的任务，从 npcSell 簿合计削减 30% 在售量
 *   （逐单从尾扣减至 0 移除），并把 pool.q 扣掉同等数量（模拟 NPC 买走一部分），同时
 *   pool.shock += 0.05（上限 0.4）——使随后补单/报价变贵；
 * - 奖励（税前锚定，2026-09-06 船长拍板）：基准单价 = 刷出瞬间该商品收购价
 *   （marketQuote().buy，池商品收购价 = 均衡价 levelOf；簿面无收购单时回落 levelOf），
 *   再按任务族乘系数并向下取整到整百（至少 100）——
 *   资源任务 rewardIsk = need × 收购价 × RESOURCE_TASK_MARGIN(1.04)，附加守卫：刷出时有供应价
 *   sell 时强制 reward < need×sell（1.04 边沿溢出则钳到 floor((need×sell−1)/100)×100），
 *   保证"市价买入即交"必亏；快递任务 rewardIsk = need × 收购价 × COURIER_TASK_MARGIN(1.30)
 *   （运费补偿型利润：快递含真实航行耗时，不设买货守卫）；不给声望；
 * - 快递（2026-09-06 真实航行投送）：刷出时把目标绑定到一座已建成副站（stationId/galaxyId）；
 *   玩家两步操作——"出发投送"（仓库需足量）把 need 从物品仓库锁定扣出并转入
 *   state.sideTasks.deliver 在途挂账，到站时刻 = 出发时刻 + travelLegMs(shortestTravelMinutes(
 *   当前位置→目标副站星系))；同一时刻只允许一笔投送，投送在途期间禁止并发开矿/远征/扫描/打捞/
 *   掩护巡逻/换港返航（各 start* 守卫以 courierDelivering 判定，措辞"快递投送途中"）；
 *   引擎推进到 gameMs ≥ arriveAtGameMs 自动到站：停靠目标副站、按原任务 id 结算（奖励入账、
 *   任务下板、挂账清空）——整板刷新不清除在途投送（完成仍按刷出时锁定酬金结算）；
 * - 完成条件（资源）：仅当物品仓库（state.warehouse.items）中该 refId ≥ need 时完成（不接受
 *   货仓/不提前接单）；完成即从仓库扣 need、现金入账、该条移出当前轮板，同轮其余任务不受影响；
 * - 离线大步长（一次跨 N 个 20 分钟周期）：按船长拍板"仅末窗执行刷新与市场影响"——中间周期只
 *   推进 window 号、不重复扣量/抬价（防 8 小时 24 轮冲击把市场打穿）；投送在途跨大步长按真实
 *   时间推进，越过 arriveAtGameMs 即到站结算。见 advanceSideTasks 注释。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { CourierDeliveryState, GameState, SideTask, SideTasksState } from './state'
import type { CommandResult } from './engine'
import type { BeltDef, MarketGoodDef, SimContext, StationSiteDef } from './types'
import { nextInt, nextRandom } from './rng'
import { marketQuote, levelOf } from './market'
import { isSiteBuilt } from './station'
import { isExplored } from './explore'
import { countWare, removeWare } from './inventory'
import { shortestTravelMinutes, travelLegMs, travelMinutesEff } from './travel'
import { originGalaxyOf } from './location'

/**
 * 资源任务奖励系数（2026-09-06 船长拍板）：need × 刷出时收购价（税前）× 1.04 → 整百。
 * 仍 < 刷出时供应价（sell ≈ L×1.06），配买货守卫保证"市价买入交付"必亏。
 */
export const RESOURCE_TASK_MARGIN = 1.04

/**
 * 快递任务奖励系数：need × 刷出时收购价（税前）× 1.30 → 整百。
 * 快递含真实航行耗时（运费补偿型利润），不设买货守卫。
 */
export const COURIER_TASK_MARGIN = 1.3

/** 本板刷新周期毫秒 = 市场「补给刷新」节奏（与常驻订单寿命一致，默认 20 分钟） */
function boardPeriodMs(ctx: SimContext): number {
  return ctx.balance.market.orderLifeMs.common
}

/** 任务商品基池：市场常驻（common）且带 poolTarget>0 的 item 类商品（未做星图门槛过滤） */
function taskGoodBasePool(ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity === 'common' && def.kind === 'item' && (def.poolTarget ?? 0) > 0) out.push(def)
  }
  return out
}

/** 某矿带是否产出该资源（主产物 oreId 或复合产出池 outputs 命中） */
function beltProduces(belt: BeltDef, itemId: string): boolean {
  if (belt.oreId === itemId) return true
  const outputs = belt.outputs
  if (outputs) {
    for (const o of outputs) if (o.itemId === itemId) return true
  }
  return false
}

/** 是否已有任一产出 itemId 的矿带、且其所在星系已探索（无 galaxyId = 母港，恒已探索） */
function anyProducingBeltExplored(state: GameState, ctx: SimContext, itemId: string): boolean {
  for (const belt of ctx.belts.values()) {
    if (!beltProduces(belt, itemId)) continue
    if (isExplored(state, belt.galaxyId ?? HOME_GALAXY_ID)) return true
  }
  return false
}

/**
 * 玩家在当前星图进度下是否"已可获取"该货（纯函数；任务候选门槛）：
 * - 物品仓库已有该货（玩家已接触）→ 恒放行；
 * - 矿石/气体/冰（矿带直采）：要求至少一个产出它的矿带所在星系已探索；
 * - 矿物（精炼产物，如 min-*）：凡某矿石/气体/冰的精炼配方产出它（item.refine 指向），
 *   则任一产出源的矿带星系已探索即可放行（能采到源头即可炼出）；无精炼来源的矿物
 *   无矿带依赖，按 NPC 直供恒放行；
 * - 弹药/修理组件/无人机等 NPC 常驻直供商品（无矿带依赖）：恒可刷；
 * - 不在物品数据目录里的未知商品不设门槛（保留候选，防内容缺失时任务板空转）。
 */
export function sideTaskCandidateGoods(state: GameState, ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'common' || def.kind !== 'item' || (def.poolTarget ?? 0) <= 0) continue
    const itemId = def.refId
    if ((state.warehouse.items[itemId] ?? 0) > 0) {
      out.push(def) // 仓库已有 → 玩家已接触，恒放行
      continue
    }
    const item = ctx.items.get(itemId)
    if (!item) {
      out.push(def) // 未知商品：不设门槛
      continue
    }
    if (item.kind === 'ore' || item.kind === 'gas' || item.kind === 'ice') {
      // 矿带直采资源：需任一产出矿带所在星系已探索（无任何矿带产出 = 星图上采不到，不放行）
      if (anyProducingBeltExplored(state, ctx, itemId)) out.push(def)
      continue
    }
    if (item.kind === 'mineral') {
      // 精炼产物：任一产出源（矿石/气体/冰均有精炼配方）的矿带星系已探索即可炼出
      let sourceFound = false
      for (const src of ctx.items.values()) {
        if (src.kind !== 'ore' && src.kind !== 'gas' && src.kind !== 'ice') continue
        const refine = src.refine
        if (!refine) continue
        let produces = false
        for (const row of refine) {
          if (row.mineralId === itemId) {
            produces = true
            break
          }
        }
        if (produces) {
          sourceFound = true
          if (anyProducingBeltExplored(state, ctx, src.id)) {
            out.push(def)
            break
          }
        }
      }
      if (!sourceFound) out.push(def) // 无精炼来源（如远征稀有掉落物）：无矿带依赖，恒放行
      continue
    }
    // 弹药/修理组件/无人机/残骸/碎片等 NPC 常驻直供（无矿带依赖）：恒可刷
    out.push(def)
  }
  return out
}

/** 快递任务是否解锁：存在任一"已建成"副空间站（stage ≥ tiers.length；复用 station.isSiteBuilt 判定） */
export function courierTaskUnlocked(state: GameState, ctx: SimContext): boolean {
  for (const site of ctx.stations.values()) {
    if (isSiteBuilt(state, site)) return true
  }
  return false
}

/** 已建成且星系合法的副站（快递目标候选；站点所在星系必须存在于星图目录） */
function builtStationTargets(state: GameState, ctx: SimContext): Array<{ site: StationSiteDef }> {
  const out: Array<{ site: StationSiteDef }> = []
  for (const site of ctx.stations.values()) {
    if (!isSiteBuilt(state, site)) continue
    if (!ctx.galaxies.has(site.galaxyId)) continue
    out.push({ site })
  }
  return out
}

/** 解析某快递任务的目标副站：任务自带绑定（刷出时锁定）→ 校验仍建成合法；否则（老档无绑定）
 *  兜底 = 距当前位置最近的已建成副站 */
function resolveCourierTarget(state: GameState, ctx: SimContext, task: SideTask): StationSiteDef | null {
  if (task.stationId) {
    const site = ctx.stations.get(task.stationId)
    if (site && isSiteBuilt(state, site) && ctx.galaxies.has(site.galaxyId)) return site
  }
  let best: StationSiteDef | null = null
  let bestMin = Number.POSITIVE_INFINITY
  const from = originGalaxyOf(state, ctx)
  for (const { site } of builtStationTargets(state, ctx)) {
    const m = shortestTravelMinutes(ctx, from, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site
    }
  }
  return best
}

/** 从候选池抽 count 个互不重复的商品（rng 固定顺序：先抽首位再抽次位，保证可复现） */
function drawTaskGoods(state: GameState, pool: MarketGoodDef[], count: number): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  if (pool.length <= 0) return out
  const n = Math.min(count, pool.length)
  const i1 = nextInt(state.rng, pool.length)
  out.push(pool[i1]!)
  if (n >= 2) {
    const i2 = nextInt(state.rng, pool.length - 1)
    out.push(pool[i2 >= i1 ? i2 + 1 : i2]!)
  }
  return out
}

/** 需要量：round(poolTarget×(0.01 + rng×0.02))，取整到 10、至少 10 */
function rollNeed(state: GameState, poolTarget: number): number {
  const raw = poolTarget * (0.01 + nextRandom(state.rng) * 0.02)
  return Math.max(10, Math.round(raw / 10) * 10)
}

/**
 * 奖励（税前锚定，2026-09-06 船长拍板）：
 * 基准单价 = 刷出瞬间该商品收购价 marketQuote().buy（池商品收购价 = 均衡价 L；簿面无收购单时
 * 回落 levelOf）；reward = need × 基准单价 × 系数（资源 1.04 / 快递 1.30），向下取整到整百、
 * 至少 100。资源任务附加守卫：刷出时有供应价 sell 时强制 reward < need×sell（若 1.04 边沿溢出
 * 则把 reward 钳到 floor((need×sell−1)/100)×100）——市价买入交付必亏；快递为运费补偿型（真实
 * 航行耗时换运费利润），不设买货守卫。
 */
function rewardIskFor(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  need: number,
  kind: SideTask['kind'],
): number {
  const quote = marketQuote(state, ctx, goodKey)
  const base = quote.buy !== undefined && quote.buy > 0 ? quote.buy : Math.max(1, levelOf(state, ctx, goodKey))
  const margin = kind === 'courier' ? COURIER_TASK_MARGIN : RESOURCE_TASK_MARGIN
  let reward = Math.max(100, Math.floor((need * base * margin) / 100) * 100)
  if (kind === 'resource' && quote.sell !== undefined && reward >= need * quote.sell) {
    reward = Math.min(reward, Math.floor((need * quote.sell - 1) / 100) * 100)
  }
  return reward
}

/** 刷出市场影响（对单个商品一次）：npcSell 合计削减 30% 在售量（逐单从尾扣减至 0 移除），
 *  pool.q 扣掉同等数量，pool.shock += 0.05（上限 0.4） */
function applySpawnMarketImpact(state: GameState, def: MarketGoodDef): void {
  const pool = state.market.pools[def.key]
  if (!pool) return
  const sellList = state.market.npcSell[def.key]
  if (sellList) {
    let total = 0
    for (const o of sellList) total += o.qty
    if (total > 0) {
      const removeQty = Math.round(total * 0.3)
      let rem = removeQty
      for (let i = sellList.length - 1; i >= 0 && rem > 0; i--) {
        const o = sellList[i]!
        const take = Math.min(o.qty, rem)
        o.qty -= take
        rem -= take
        if (o.qty <= 0) sellList.splice(i, 1)
      }
      pool.q = Math.max(0, pool.q - removeQty)
    }
  }
  pool.shock = Math.min(0.4, (pool.shock ?? 0) + 0.05)
}

/** 整板刷新：清空两族 → 抽 2 条资源任务（快递解锁且存在合法目标站则同抽 2 条、各绑定一座
 *  已建成副站）→ 奖励锁定 → 一次性市场影响（同商品在资源/快递各出现一次时市场影响只执行一次）。
 *  boundaryMs = 本次刷出的 20 分钟整点（= 该轮任务起点；下一 20 分钟整点 boundaryMs + 周期
 *  到点时整板替换）。在途投送（deliver）不被整板清掉。 */
function refreshBoard(state: GameState, ctx: SimContext, boundaryMs: number): void {
  const board = state.sideTasks
  board.window = boundaryMs
  board.resource = []
  board.courier = []
  const pool = sideTaskCandidateGoods(state, ctx)
  // 候选不足 2 种（无法抽满"2 条不重复"）的整点不刷——真实数据目录 30+ 商品，正常整点照常
  if (pool.length < 2) return

  const affected = new Set<string>()
  const spawnTask = (def: MarketGoodDef, kind: SideTask['kind']): SideTask | null => {
    const target = def.poolTarget ?? 0
    if (target <= 0) return null
    const need = rollNeed(state, target)
    const rewardIsk = rewardIskFor(state, ctx, def.key, need, kind)
    board.seq += 1
    affected.add(def.key)
    return { id: board.seq, kind, goodKey: def.key, refId: def.refId, need, rewardIsk }
  }

  for (const def of drawTaskGoods(state, pool, 2)) {
    const t = spawnTask(def, 'resource')
    if (t) board.resource.push(t)
  }
  // 快递：副站建成解锁且至少存在一座"星系合法"的目标站才刷（刷出即绑定目标副站）
  const courierTargets = builtStationTargets(state, ctx)
  if (courierTargets.length > 0) {
    for (const def of drawTaskGoods(state, pool, 2)) {
      const t = spawnTask(def, 'courier')
      if (t) {
        const picked = courierTargets[nextInt(state.rng, courierTargets.length)]!
        t.stationId = picked.site.id
        t.galaxyId = picked.site.galaxyId
        board.courier.push(t)
      }
    }
  }
  for (const key of affected) {
    const def = ctx.marketGoods.get(key)
    if (def) applySpawnMarketImpact(state, def)
  }
}

/** 引擎推进：快递投送到站结算——gameMs ≥ arriveAtGameMs 即到站：停靠目标副站（dockedSite =
 *  目标站 id、awayGalaxy = null）、完成原任务（仍在板上则下板；酬金按刷出时锁定值结算）、
 *  清空在途挂账。整板刷新不清除在途投送：完成始终按原任务 id/锁定酬金结算。 */
function advanceCourierDeliveries(state: GameState, ctx: SimContext): void {
  const d = state.sideTasks.deliver
  if (!d) return
  if (state.gameMs < d.arriveAtGameMs) return
  settleCourierDelivery(state, ctx, d)
}

/**
 * 任务板推进（引擎在 gameMs 前移、市场窗口已推进后调用）：
 * 1) 先结算已到站的快递投送（跨过整板刷新边界的投送先结算，原任务仍在板则顺带下板）；
 * 2) 本板周期 = orderLifeMs.common（20 分钟）。仅当市场已越过下一个 20 分钟整点
 *    （state.market.lastTickGameMs ≥ board.window + 周期）才执行一次刷新。
 * 离线大步长只结算一次：跨过 N 个周期时 window 一次性推进到"最后一个已越过的整点"、
 * 只在那一点刷一次（中间周期只推进窗口号、不重复扣量/抬价；船长 2026-09-05 拍板取
 * "仅末窗执行"，防 8 小时 24 轮冲击/扣量过度影响市场）。在途投送按真实时间推进照常结算。
 */
export function advanceSideTasks(state: GameState, ctx: SimContext): void {
  advanceCourierDeliveries(state, ctx)
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const nowBoundary = state.market.lastTickGameMs
  if (nowBoundary < board.window + period) return
  // 末个已越过的 20 分钟整点（board.window 为 0 = 未开盘，首个整点 = 开盘后第一个 20 分钟点）
  const targetBoundary = board.window + Math.floor((nowBoundary - board.window) / period) * period
  refreshBoard(state, ctx, targetBoundary)
}

/** 快递在途投送只读视图（UI 渲染用；remainingMs 随 gameMs 自然缩短） */
export interface SideTaskDeliveryView {
  /** 原任务稳定 id（整板刷新后任务不在板仍按它结算） */
  taskId: number
  refId: string
  need: number
  stationId: string
  galaxyId: string
  stationName: string
  galaxyName: string
  /** 距到站剩余毫秒（0 = 已到站待引擎结算瞬间） */
  remainingMs: number
}

/** 任务板只读视图（UI 直接渲染用；remainingMs 随 gameMs 自然缩短，每秒刷新） */
export interface SideTaskBoardView {
  /** 资源任务（当前轮；未到首个 20 分钟整点 = 空） */
  resource: readonly SideTask[]
  /** 快递任务（当前轮；副站建成解锁后才有） */
  courier: readonly SideTask[]
  /** 快递任务当前是否解锁（已建成任一副空间站） */
  courierUnlocked: boolean
  /** 快递投送在途挂账视图（一次一笔；null = 无） */
  deliver: SideTaskDeliveryView | null
  /** 本板已开盘（首个 20 分钟整点已刷出过任务）；false = 等首个整点 */
  opened: boolean
  /** 距下一个 20 分钟整点（本轮到点整板替换）的剩余毫秒；未开盘 = 距首个整点 */
  remainingMs: number
}

/** 只读查询：任务板 + 到期倒计时 + 快递在途投送（UI 展示资源/快递时效任务区用） */
export function sideTaskBoard(state: GameState, ctx: SimContext): SideTaskBoardView {
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const opened = board.window > 0
  let remainingMs: number
  if (opened) {
    // 已开盘：距"本轮到点（下一 20 分钟整点）"的剩余
    remainingMs = Math.max(0, board.window + period - state.gameMs)
  } else {
    // 未开盘：距首个 20 分钟整点的剩余（口径 = 距下一 20 分钟点）
    const nextPoint = (Math.floor(state.gameMs / period) + 1) * period
    remainingMs = Math.max(0, nextPoint - state.gameMs)
  }
  const d = board.deliver
  return {
    resource: board.resource,
    courier: board.courier,
    courierUnlocked: courierTaskUnlocked(state, ctx),
    deliver: d
      ? {
          taskId: d.taskId,
          refId: d.refId,
          need: d.need,
          stationId: d.stationId,
          galaxyId: d.galaxyId,
          stationName: ctx.stations.get(d.stationId)?.name ?? d.stationId,
          galaxyName: ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId,
          remainingMs: Math.max(0, d.arriveAtGameMs - state.gameMs),
        }
      : null,
    opened,
    remainingMs,
  }
}

/** 是否正在快递投送（在途；一次一笔）。其余出航作业的 start* 守卫据此拒绝并发 */
export function courierDelivering(state: GameState): boolean {
  return state.sideTasks.deliver !== null
}

/**
 * 玩家指令：完成一条资源时效任务（仓库足量扣货交付 → 现金入账 → 该条移出本轮板）。
 * 快递任务不在此完成：需先「出发投送」（真实航程到站后引擎自动结算）。
 * - 条件：该条仍在当前轮板（未过期/未到 20 分钟整点被替换）；物品仓库持有 ≥ need；
 * - 动作：仓库扣除 need → 现金入账 rewardIsk → 该条移出本轮板（同轮其余任务不受影响）；
 * - 不给声望。
 */
export function completeSideTask(
  state: GameState,
  ctx: SimContext,
  kind: SideTask['kind'],
  id: number,
): CommandResult {
  if (kind === 'courier') {
    return { ok: false, error: '快递任务需先「出发投送」——货物由出发时从仓库锁定扣出，按真实航程到站后自动结算。' }
  }
  const board = state.sideTasks
  const list = board.resource
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。' }
  }
  const task = list[idx]!
  // 到期护栏：游戏时间已越过本轮到点（下一 20 分钟整点，引擎尚未推进刷新）时拒绝，防"卡点结算过期任务"
  if (state.gameMs >= board.window + boardPeriodMs(ctx)) {
    return { ok: false, error: '该任务已到期——新一批任务即将刷新。' }
  }
  const name = ctx.items.get(task.refId)?.name ?? task.refId
  const have = countWare(state, task.refId)
  if (have < task.need) {
    return {
      ok: false,
      error: `物品仓库中的 ${name} 不足：还差 ${(task.need - have).toLocaleString('zh-CN')} 单位（任务需 ${task.need.toLocaleString('zh-CN')}，现有 ${have.toLocaleString('zh-CN')}）。`,
    }
  }
  if (!removeWare(state, task.refId, task.need)) {
    return { ok: false, error: `${name} 出库失败（库存不足）。` }
  }
  list.splice(idx, 1)
  state.wallet.isk += task.rewardIsk
  addLog(
    state,
    'trade',
    `资源任务完成：协会收购 ${name}×${task.need.toLocaleString('zh-CN')}（自仓库交付），奖励 ${task.rewardIsk.toLocaleString('zh-CN')} ISK 已入账。`,
  )
  return { ok: true }
}

/**
 * 快递到站结算（引擎到点调用 / 零航程出发即时调用共用）：
 * 置停靠目标副站（dockedSite = 目标站 id、awayGalaxy = null）→ 原任务仍在板则按 taskId 下板
 * → 奖励入账（按刷出时锁定酬金，整板刷新后仍照付）→ 清空在途挂账 → 日志"投送完成"。
 */
function settleCourierDelivery(state: GameState, ctx: SimContext, d: CourierDeliveryState): void {
  const board = state.sideTasks
  // 到站：停靠目标副站（该站若已不再是建成站点/星系未知——数据异常兜底回母港）
  state.awayGalaxy = null
  const site = ctx.stations.get(d.stationId)
  if (site && isSiteBuilt(state, site) && ctx.galaxies.has(d.galaxyId)) {
    state.dockedSite = site.id
  } else {
    state.dockedSite = null
  }
  const idx = board.courier.findIndex((t) => t.id === d.taskId)
  if (idx >= 0) board.courier.splice(idx, 1)
  state.wallet.isk += d.rewardIsk
  board.deliver = null
  const itemName = ctx.items.get(d.refId)?.name ?? d.refId
  const siteName = ctx.stations.get(d.stationId)?.name ?? d.stationId
  const galaxyName = ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId
  addLog(
    state,
    'trade',
    `快递投送完成：${itemName}×${d.need.toLocaleString('zh-CN')} 已送达「${siteName}」（${galaxyName}），酬金 ${d.rewardIsk.toLocaleString('zh-CN')} ISK 已入账。`,
  )
}

/**
 * 玩家指令：快递「出发投送」（真实航行投送，主控"去程取消"的快递专项例外）。
 * - 条件：该条快递仍在当前轮板（未过期）；同一时刻只允许一笔投送（无其他在途）；
 *   舰船空闲（不在采矿/远征/扫描/打捞/掩护巡逻/返航中）；物品仓库持有 ≥ need；
 *   目标副站 = 刷出时绑定的已建成副站（老档无绑定兜底解析最近建成站）；
 * - 动作：仓库锁定扣出 need（到站不再扣）→ 按"当前位置 → 目标副站星系"真实航程锁定
 *   arriveAtGameMs = 出发时刻 + travelLegMs(shortestTravelMinutes(...)) → 挂入在途账 deliver；
 *   同星系零航程时立即到站结算；航程 > 0 时由引擎推进到点自动结算（奖励入账、任务下板）。
 */
export function startCourierDelivery(state: GameState, ctx: SimContext, id: number): CommandResult {
  const board = state.sideTasks
  if (board.deliver !== null) {
    return { ok: false, error: '快递投送途中：同一时间只能投送一笔——请先等当前投送到站结算，再出发下一单。' }
  }
  const task = board.courier.find((t) => t.id === id)
  if (!task) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。' }
  }
  // 到期护栏：游戏时间已越过本轮到点（下一 20 分钟整点）时拒绝，防"卡点出发过期任务"
  if (state.gameMs >= board.window + boardPeriodMs(ctx)) {
    return { ok: false, error: '该任务已到期——新一批任务即将刷新。' }
  }
  // 舰船空闲互斥（快递出发 = 主控携货真实航行；与其余出航作业互为前置）
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：请先停止开采，舰船才能出发投送。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业进行中：请先停止打捞，舰船才能出发投送。' }
  if (state.scanning.active) return { ok: false, error: '扫描探索进行中：请先终止扫描，舰船才能出发投送。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先处理远征，舰船才能出发投送。' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：请先取消（顶部活动栏），舰船才能出发投送。' }
  if (state.transit.active) return { ok: false, error: '返航行程中：到站后再出发投送。' }
  const targetSite = resolveCourierTarget(state, ctx, task)
  if (!targetSite) {
    return { ok: false, error: '目标副站不可用（未建成或星系未知）——暂时无法投送该单。' }
  }
  const itemName = ctx.items.get(task.refId)?.name ?? task.refId
  const have = countWare(state, task.refId)
  if (have < task.need) {
    return {
      ok: false,
      error: `物品仓库中的 ${itemName} 不足：还差 ${(task.need - have).toLocaleString('zh-CN')} 单位（任务需 ${task.need.toLocaleString('zh-CN')}，现有 ${have.toLocaleString('zh-CN')}）。`,
    }
  }
  // 真实航程：当前所在星系 → 目标副站所在星系（出发时锁定；同站/同星系 = 0）
  const from = originGalaxyOf(state, ctx)
  const travelMin = shortestTravelMinutes(ctx, from, targetSite.galaxyId)
  if (!Number.isFinite(travelMin)) {
    return { ok: false, error: `「${ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId}」不在当前可达航路内，无法出发投送。` }
  }
  // 出发：仓库锁定扣出 need（转入在途挂账；到站不再扣）
  if (!removeWare(state, task.refId, task.need)) {
    return { ok: false, error: `${itemName} 出库失败（库存不足）。` }
  }
  const departAt = state.gameMs
  const arriveAt = departAt + travelLegMs(state, ctx, travelMin)
  const d: CourierDeliveryState = {
    taskId: task.id,
    goodKey: task.goodKey,
    refId: task.refId,
    need: task.need,
    stationId: targetSite.id,
    galaxyId: targetSite.galaxyId,
    departAtGameMs: departAt,
    arriveAtGameMs: arriveAt,
    rewardIsk: task.rewardIsk,
  }
  const siteName = ctx.stations.get(targetSite.id)?.name ?? targetSite.id
  const galaxyName = ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId
  if (arriveAt <= departAt) {
    // 零航程（已停靠目标副站所在星系）：立即到站结算
    board.deliver = d
    settleCourierDelivery(state, ctx, d)
    return { ok: true }
  }
  board.deliver = d
  addLog(
    state,
    'info',
    `快递投送出发：携 ${itemName}×${task.need.toLocaleString('zh-CN')} 驶往「${siteName}」（${galaxyName}），预计航行约 ${Math.max(1, travelMinutesEff(state, ctx, travelMin))} 分钟——到站自动结算酬金。`,
  )
  return { ok: true }
}

/** 供测试/存档往返核对用：读取任务板原始状态（不重新计算任何东西） */
export function sideTasksStateOf(state: GameState): SideTasksState {
  return state.sideTasks
}
