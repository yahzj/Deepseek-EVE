/**
 * 任务中心·时效任务（资源 / 快递）——2026-09-05 船长拍板（v24）。
 *
 * 规则（中文说明）：
 * - 刷新节奏与市场同源：以 ctx.balance.market.tickMs（60 秒窗口）为周期；每次市场窗口
 *   边界推进时"整板刷新"——旧任务全部过期清空，重刷 2 条资源任务（快递在已建成副站后同刷 2 条）；
 *   任务只存活一个窗口期（window → window+tick），到下一个窗口点自动被替换；
 * - 任务池：市场常驻（rarity=common）且 poolTarget>0 的 item 类商品（矿石/矿物/气体/冰/弹药…
 *   从 ctx.marketGoods 过滤）；每次用 rng 抽 2 个不重复商品，需要量 need = round(poolTarget ×
 *   (0.01 + rng×0.02))，再取整到 10、至少 10；
 * - 刷出时的市场影响（防"买来秒交"）：对含某物品 X 的任务，从 npcSell 簿合计削减 30% 在售量
 *   （逐单从尾扣减至 0 移除），并把 pool.q 扣掉同等数量（模拟 NPC 买走一部分），同时
 *   pool.shock += 0.05（上限 0.4）——使随后补单/报价变贵；
 * - 奖励：rewardIsk = need × 刷出时 bestSell（marketQuote().sell，取不到用 levelOf×1.06）×0.96，
 *   向下取整到整百——市价买来交付≈亏损，自产/库存交付略优于税后直销；不给声望；
 * - 完成条件：仅当物品仓库（state.warehouse.items）中该 refId ≥ need 时完成（不接受货仓/不提前接单）；
 *   完成即从仓库扣 need、现金入账、该条移出当前窗口板，同窗口其余任务不受影响；
 * - 离线大步长（一次跨 N 个窗口）：按船长拍板"仅末窗执行刷新与市场影响"——中间窗口只推进
 *   window 号、不重复扣量/抬价（防 8 小时 480 次冲击把市场打穿）；见 advanceSideTasks 注释。
 */
import { addLog } from './state'
import type { GameState, SideTask, SideTasksState } from './state'
import type { CommandResult } from './engine'
import type { MarketGoodDef, SimContext } from './types'
import { nextInt, nextRandom } from './rng'
import { marketQuote, levelOf } from './market'
import { isSiteBuilt } from './station'
import { countWare, removeWare } from './inventory'

/** 任务商品池：市场常驻（common）且带 poolTarget>0 的 item 类商品 */
function taskGoodPool(ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity === 'common' && def.kind === 'item' && (def.poolTarget ?? 0) > 0) out.push(def)
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

/** 奖励：need × 刷出时 bestSell × 0.96，向下取整到整百（bestSell 取不到用 levelOf×1.06） */
function rewardIskFor(state: GameState, ctx: SimContext, goodKey: string, need: number): number {
  const quote = marketQuote(state, ctx, goodKey)
  const sell = quote.sell ?? Math.max(1, Math.round(levelOf(state, ctx, goodKey) * 1.06))
  const raw = need * sell * 0.96
  return Math.max(0, Math.floor(raw / 100) * 100)
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

/** 整板刷新：清空两族 → 抽 2 条资源任务（快递解锁则同抽 2 条）→ 奖励锁定 → 一次性市场影响
 *  （同商品在资源/快递各出现一次时市场影响只执行一次）。windowMs = 本次刷出边界（市场 lastTick）。 */
function refreshBoard(state: GameState, ctx: SimContext, windowMs: number): void {
  const board = state.sideTasks
  board.window = windowMs
  board.resource = []
  board.courier = []
  const pool = taskGoodPool(ctx)
  // 候选不足 2 种（无法抽满"2 条不重复"）的窗口不刷——真实数据目录 30+ 商品，正常窗口照常
  if (pool.length < 2) return

  const affected = new Set<string>()
  const spawnOne = (def: MarketGoodDef, kind: SideTask['kind']): SideTask | null => {
    const target = def.poolTarget ?? 0
    if (target <= 0) return null
    const need = rollNeed(state, target)
    const rewardIsk = rewardIskFor(state, ctx, def.key, need)
    board.seq += 1
    affected.add(def.key)
    return { id: board.seq, kind, goodKey: def.key, refId: def.refId, need, rewardIsk }
  }

  for (const def of drawTaskGoods(state, pool, 2)) {
    const t = spawnOne(def, 'resource')
    if (t) board.resource.push(t)
  }
  if (courierTaskUnlocked(state, ctx)) {
    for (const def of drawTaskGoods(state, pool, 2)) {
      const t = spawnOne(def, 'courier')
      if (t) board.courier.push(t)
    }
  }
  for (const key of affected) {
    const def = ctx.marketGoods.get(key)
    if (def) applySpawnMarketImpact(state, def)
  }
}

/**
 * 任务板推进（引擎在 gameMs 前移、市场窗口已推进后调用）：
 * 仅当"窗口号变化"（板 window 落后于市场 lastTick = 已越过至少一个市场窗口边界）才执行一次刷新。
 * 离线大步长只结算一次：中间窗口只推进 window 号、不重复扣量/抬价；市场影响一律按末窗
 * 现行簿面一次性执行（船长 2026-09-05 拍板取"仅末窗执行"，防 8 小时 480 次冲击/扣量过度影响市场）。
 */
export function advanceSideTasks(state: GameState, ctx: SimContext): void {
  const board = state.sideTasks
  const lastBoundary = state.market.lastTickGameMs
  if (lastBoundary <= board.window) return
  refreshBoard(state, ctx, lastBoundary)
}

/** 任务板只读视图（UI 直接渲染用；remainingMs 随 gameMs 自然缩短，每秒刷新） */
export interface SideTaskBoardView {
  /** 资源任务（当前窗口；未开盘/未到首个边界 = 空） */
  resource: readonly SideTask[]
  /** 快递任务（当前窗口；副站建成解锁后才有） */
  courier: readonly SideTask[]
  /** 快递任务当前是否解锁（已建成任一副空间站） */
  courierUnlocked: boolean
  /** 本板已开盘（首个市场窗口边界已刷出过任务）；false = 等首个窗口 */
  opened: boolean
  /** 距整板到期替换（下一市场窗口边界）的剩余毫秒；未开盘为 0 */
  remainingMs: number
}

/** 只读查询：任务板 + 到期倒计时（UI 展示资源/快递时效任务区用） */
export function sideTaskBoard(state: GameState, ctx: SimContext): SideTaskBoardView {
  const board = state.sideTasks
  const tick = ctx.balance.market.tickMs
  const opened = board.window > 0
  const base = opened ? board.window : state.market.lastTickGameMs
  const remainingMs = base > 0 ? Math.max(0, base + tick - state.gameMs) : 0
  return {
    resource: board.resource,
    courier: board.courier,
    courierUnlocked: courierTaskUnlocked(state, ctx),
    opened,
    remainingMs,
  }
}

/** 任务族标签（快递 = 投送） */
const KIND_ACTION: Record<SideTask['kind'], string> = { resource: '交付', courier: '投送' }

/**
 * 玩家指令：完成任务板上一族的一条任务。
 * - 条件：该条仍在当前窗口板（未过期/未刷新替换）；物品仓库持有 ≥ need；
 * - 动作：仓库扣除 need → 现金入账 rewardIsk → 该条移出本窗口板（同窗口其余任务不受影响）；
 * - 不给声望。
 */
export function completeSideTask(
  state: GameState,
  ctx: SimContext,
  kind: SideTask['kind'],
  id: number,
): CommandResult {
  const board = state.sideTasks
  const list = kind === 'courier' ? board.courier : board.resource
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随窗口刷新被替换。' }
  }
  const task = list[idx]!
  // 到期护栏：游戏时间已越过本窗口边界（引擎尚未推进刷新）时拒绝，防"卡点结算过期任务"
  if (state.gameMs >= board.window + ctx.balance.market.tickMs) {
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
  const verb = KIND_ACTION[kind]
  addLog(
    state,
    'trade',
    kind === 'courier'
      ? `快递投送完成：向已建成副站投送 ${name}×${task.need.toLocaleString('zh-CN')}，酬金 ${task.rewardIsk.toLocaleString('zh-CN')} ISK 已入账。`
      : `资源任务完成：协会收购 ${name}×${task.need.toLocaleString('zh-CN')}（自仓库${verb}），奖励 ${task.rewardIsk.toLocaleString('zh-CN')} ISK 已入账。`,
  )
  return { ok: true }
}

/** 供测试/存档往返核对用：读取任务板原始状态（不重新计算任何东西） */
export function sideTasksStateOf(state: GameState): SideTasksState {
  return state.sideTasks
}
