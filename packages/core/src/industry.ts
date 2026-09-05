/**
 * 精炼炉运转 / 市场出售（V9：卖出并入市场订单簿）/ 舰船购买。
 *
 * 精炼模型（工业细化，2026-09-04 船长定稿：运转周期制）：
 * - 精炼 = 母港精炼炉的"循环运转"：单工位，每次只运转一种资源（矿石/气体/冰矿）；
 *   劳动者 = 主控亲自运转（占主控工作位）或一枚 AI 核心驱动（核心出库占用，不占副船名额）；
 * - 固定批量运转：每种资源有"单批单位 × 单批周期"（5~10 秒节奏，items.ts refineBatchUnits/
 *   refineCycleMs；缺失兜底 10 单位/6 秒）；启动即把全部库存锁定入炉（货仓优先取用），
 *   每批到点按收率出矿物入物品仓库并自动续批，直到料尽自动停炉（核心归还）；
 * - 停止即止：已完成批已出货，剩余锁定原料全额退回物品仓库；
 * - 收率 = 基础 50% + 精炼学 8%/级 + 高级回收 4%/级，上限 95%；每批结算按当时技能取值；
 * - AI 核心驱动：单批周期 ÷核心效率（核心只提速不减产，与副船任务同口径）。
 * - 卖出（V9 起）不再有"固定价卖给空间站"：货先锁定进市场 escrow，按 NPC 收购簿
 *   即时市价成交（吃穿簿的剩余自动转限价卖单）；池商品在均衡时收购价 = 基准价，
 *   与旧版空间站收购价一致（波动来自池淤积与冲击动量）；
 * - 舰船购买（V9）：市场有现货立即购得；无现货自动挂收购单（市场有货时自动成交）。
 */
import { addLog, EMPTY_REFINE_RUN } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { AiCoreType, ItemDef, SimContext } from './types'
import { addItem, addWare, countItem, countWare, removeItem, removeWare } from './inventory'
import { aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { isAtHome } from './location'
import { formatDurationMs } from './time'
import { DSI_FACTION_ID, standingOf } from './expedition'
import { buyAtMarket, goodLockedReason, marketGoodOf, marketQuote, placeBuyOrder, sellAtMarket } from './market'
import { shipDisplayName } from './instances'
import {
  RECYCLE_BATCH_UNITS,
  RECYCLE_CYCLE_MS,
  FRAGMENT_RECIPES,
  fragmentItemIdOf,
  recycleProfileOf,
  rollRecycleGuarantee,
  rollRecycleLoot,
} from './salvage'

/**
 * M4：协会声望贸易加成——声望每 1 点，空间站收购价 +1%，上限 +15%。
 */
export function sellPriceMultiplier(state: GameState): number {
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

/** 按当前技能计算精炼收率（0~1） */
export function refineRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.refining
  const level1 = state.skills.trained[bal.rateSkillId] ?? 0
  const level2 = state.skills.trained[bal.secondRateSkillId] ?? 0
  const rate = bal.baseRate + bal.ratePerLevel * level1 + bal.secondRatePerLevel * level2
  return Math.min(bal.maxRate, Math.max(0, rate))
}

/** 矿石在"货仓+仓库"的合计数量 */
export function oreAvailable(state: GameState, oreId: string): number {
  return countItem(state, oreId) + countWare(state, oreId)
}

/** 兜底运转参数（资源数据未给显式单批参数时；测试用小批量快周期） */
const FALLBACK_BATCH_UNITS = 10
const FALLBACK_CYCLE_MS = 6_000

/** 某资源的运转参数：单批单位 / 单批周期毫秒 */
function refineParamsOf(def: ItemDef): { batchUnits: number; cycleMs: number } {
  const batchUnits =
    def.refineBatchUnits !== undefined && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : FALLBACK_BATCH_UNITS
  const cycleMs =
    def.refineCycleMs !== undefined && def.refineCycleMs > 0 ? Math.floor(def.refineCycleMs) : FALLBACK_CYCLE_MS
  return { batchUnits, cycleMs }
}

/** 精炼炉此刻是否在运转 */
export function refineRunActive(state: GameState): boolean {
  return state.refineRun.active
}

/** 精炼炉运转是否占用了主控（主控忙判定；AI 核心驱动不占主控） */
export function refineManualActive(state: GameState): boolean {
  return state.refineRun.active && state.refineRun.worker === 'pilot'
}

/** 精炼炉运行视图（工业页 / 顶部活动栏共用） */
export interface RefineRunView {
  active: boolean
  itemId: string | null
  itemName: string
  /** 劳动者：pilot = 主控 / AI 核心类型 */
  worker: 'pilot' | AiCoreType
  workerLabel: string
  /** 当前收率（每批结算按当时技能取值） */
  rate: number
  /** 单批单位（开工锁定） */
  batchUnits: number
  /** 单批周期毫秒（已按核心效率拉长） */
  cycleMs: number
  /** 剩余待炼单位（含当前批；停炉全额退回） */
  lockedQty: number
  /** 已完成批数 */
  batchesDone: number
  /** 当前批进度 0~100 */
  percent: number
  /** 整炉剩余毫秒（当前批 + 后续批） */
  remainingMs: number
}

/** 精炼炉运行状态（工业页/活动栏共用） */
export function refineRunStatus(state: GameState, ctx: SimContext): RefineRunView {
  const r = state.refineRun
  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const base = {
    active: r.active,
    itemId: r.itemId,
    itemName: def?.name ?? '—',
    worker: r.worker,
    workerLabel: r.worker === 'pilot' ? '主控' : aiCoreName(r.worker),
    rate: refineRate(state, ctx),
    batchUnits: r.batchUnits,
    cycleMs: r.cycleMs,
    lockedQty: r.lockedQty,
    batchesDone: r.batchesDone,
  }
  if (!r.active || r.itemId === null || r.cycleMs <= 0) {
    return { ...base, percent: 0, remainingMs: 0 }
  }
  const remainCur = Math.max(0, r.finishAtGameMs - state.gameMs)
  const qtyNow = Math.min(r.batchUnits, r.lockedQty)
  const afterNow = Math.max(0, r.lockedQty - qtyNow)
  const remainNext = afterNow > 0 ? Math.ceil(afterNow / r.batchUnits) * r.cycleMs : 0
  const percent = Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainCur) / r.cycleMs) * 100)))
  return { ...base, percent, remainingMs: remainCur + remainNext }
}

/**
 * 玩家指令：启动精炼炉运转（循环运转：每批到点按收率出货并自动续批，直到料尽自动停）。
 * worker = 'pilot'（主控亲自运转，占主控工作位）或 AI 核心类型（一枚核心驱动精炼炉，
 * 核心出库占用、不占副船名额；停炉/料尽自动归还）。原料 = 货仓+仓库当前全部库存，锁定入炉。
 */
export function startRefineRun(
  state: GameState,
  itemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  if (state.refineRun.active) {
    return { ok: false, error: '精炼炉正在运转：先停炉才能换资源或换劳动者。' }
  }
  if (!isAtHome(state)) {
    return { ok: false, error: '精炼炉在母港：回到母港才能启动运转。' }
  }
  const def = ctx.items.get(itemId)
  if (!def) {
    return { ok: false, error: `未知物品：${itemId}。` }
  }
  if (!def.refine || def.refine.length === 0) {
    return { ok: false, error: `「${def.name}」没有精炼配方（只支持矿石/气体/冰矿）。` }
  }
  const available = oreAvailable(state, itemId)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。` }
  }
  if (worker === 'pilot') {
    // 主控亲自运转 = 占主控工作位：与其它主控作业互斥
    if (state.mining.active) return { ok: false, error: '采矿作业中：先停止开采。' }
    if (state.expedition.active) return { ok: false, error: '远征作业中：先召回或等待结束。' }
    if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
    if (state.standby.active) return { ok: false, error: '待命行程中：先召回。' }
    if (state.transit.active) return { ok: false, error: '返航行程中：先等抵达。' }
  } else if (countAiCore(state, worker) <= 0) {
    return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入精炼炉。` }
  }
  const { batchUnits, cycleMs } = refineParamsOf(def)
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let cycleEff = Math.max(1, Math.round(cycleMs / eff))
  let batchEff = batchUnits
  if (worker !== 'pilot') {
    // 工业自动化（industrial-automation，2026-09-04 补全）：AI 驱动精炼炉每级再 −5% 周期（至少保留 60%）
    const autoLv = Math.min(5, state.skills.trained['industrial-automation'] ?? 0)
    if (autoLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0.6, 1 - 0.05 * autoLv)))
  } else {
    // 主控手动精炼双技能（P1）：炉心熔炼学 −4% 周期/级、炉膛扩容学 +6% 批容/级（AI 驱动不受影响）
    const smeltLv = Math.min(5, state.skills.trained['core-smelting'] ?? 0)
    if (smeltLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0.6, 1 - 0.04 * smeltLv)))
    const expLv = Math.min(5, state.skills.trained['furnace-expansion'] ?? 0)
    if (expLv > 0) batchEff = Math.max(1, Math.round(batchUnits * (1 + 0.06 * expLv)))
  }
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。` }
  }
  // 锁定全部现有库存入炉（货仓优先，余下取仓库）
  let toTake = available
  const fromCargo = Math.min(countItem(state, itemId), toTake)
  if (fromCargo > 0) {
    removeItem(state, itemId, fromCargo)
    toTake -= fromCargo
  }
  if (toTake > 0) removeWare(state, itemId, toTake)
  state.refineRun = {
    active: true,
    worker,
    recipe: 'refine',
    itemId,
    batchUnits: batchEff,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    lockedQty: available,
    batchesDone: 0,
  }
  const who = worker === 'pilot' ? '由你亲自运转' : `由 ${aiCoreName(worker)} 驱动（效率 ${Math.round(eff * 100)}%）`
  addLog(
    state,
    'info',
    `精炼炉启动：${def.name}×${available} 入炉（${who}；每批 ${batchEff} 单位 / ${formatDurationMs(cycleEff)}，到点自动续批，料尽自动停炉）。`,
  )
  return { ok: true }
}

/**
 * 玩家指令：启动"残骸回收"（B3 开箱批，2026-09-05 船长定稿）：同一精炼炉位，
 * 批 = 10 具 / 25 秒（劳动者 100%；AI 核心按效率拉长周期），每批开箱 = 保底矿物
 * （按残骸敌群星系危险度三档池 + 体积当量）+ 彩头（基础件直出 / 低安 MK2 / 蓝图碎片）。
 * 原料 = 货仓+仓库的该型号残骸全部锁定入炉；料尽自动停炉（核心归还）。
 */
export function startRecycleRun(
  state: GameState,
  wreckItemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
  if (state.refineRun.active) {
    return { ok: false, error: '精炼炉正在运转：先停炉才能换资源或换劳动者。' }
  }
  if (!isAtHome(state)) {
    return { ok: false, error: '精炼炉在母港：回到母港才能启动残骸回收。' }
  }
  const def = ctx.items.get(wreckItemId)
  if (!def) return { ok: false, error: `未知物品：${wreckItemId}。` }
  if (def.kind !== 'wreck') {
    return { ok: false, error: `「${def.name}」不是残骸——残骸回收只接受打捞到的残骸。` }
  }
  const profile = recycleProfileOf(ctx, wreckItemId)
  if (!profile) {
    return { ok: false, error: `「${def.name}」来源数据缺失，无法回收。` }
  }
  const available = oreAvailable(state, wreckItemId)
  if (available <= 0) {
    return { ok: false, error: `货仓与仓库里都没有 ${def.name}。` }
  }
  if (worker === 'pilot') {
    if (state.mining.active) return { ok: false, error: '采矿作业中：先停止开采。' }
    if (state.expedition.active) return { ok: false, error: '远征作业中：先召回或等待结束。' }
    if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
    if (state.standby.active) return { ok: false, error: '待命行程中：先召回。' }
    if (state.transit.active) return { ok: false, error: '返航行程中：先等抵达。' }
  } else if (countAiCore(state, worker) <= 0) {
    return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入精炼炉。` }
  }
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  const cycleEff = Math.max(1, Math.round(RECYCLE_CYCLE_MS / eff))
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。` }
  }
  // 锁定全部现有库存入炉（货仓优先，余下取仓库）
  let toTake = available
  const fromCargo = Math.min(countItem(state, wreckItemId), toTake)
  if (fromCargo > 0) {
    removeItem(state, wreckItemId, fromCargo)
    toTake -= fromCargo
  }
  if (toTake > 0) removeWare(state, wreckItemId, toTake)
  state.refineRun = {
    active: true,
    worker,
    recipe: 'recycle',
    itemId: wreckItemId,
    batchUnits: RECYCLE_BATCH_UNITS,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    lockedQty: available,
    batchesDone: 0,
  }
  const who = worker === 'pilot' ? '由你亲自运转' : `由 ${aiCoreName(worker)} 驱动（效率 ${Math.round(eff * 100)}%）`
  addLog(
    state,
    'info',
    `残骸回收启动：${def.name}×${available} 入炉开箱（${who}；每批 ${RECYCLE_BATCH_UNITS} 具 / ${formatDurationMs(cycleEff)}，保底矿物按「${def.name}」来源危险度池，料尽自动停炉）。`,
  )
  return { ok: true }
}

/**
 * 玩家指令：停炉。已完成批已出货；剩余锁定原料全额退回物品仓库；
 * AI 核心驱动时核心自动归还。返回退回单位数（0 = 当前批刚开始）。
 */
export function stopRefineRun(state: GameState, ctx: SimContext): CommandResult {
  const r = state.refineRun
  if (!r.active) return { ok: false, error: '精炼炉没有在运转。' }
  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const refund = r.lockedQty
  if (refund > 0 && r.itemId) addWare(state, r.itemId, refund)
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
  const coreNote = r.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''
  state.refineRun = { ...EMPTY_REFINE_RUN }
  addLog(
    state,
    'info',
    `精炼炉已停炉：${def?.name ?? '未知资源'} 已完成 ${r.batchesDone} 批，剩余 ×${refund} 已退回物品仓库${coreNote}。`,
  )
  return { ok: true }
}

/**
 * 引擎内部：推进精炼炉运转（每次时间推进后调用）。
 * 到点即结算当前批（按当时收率，产物入仓库）并自动续批；料尽自动停炉并归还 AI 核心。
 */
export function advanceRefining(state: GameState, ctx: SimContext): void {
  const r = state.refineRun
  if (!r.active || r.itemId === null) return
  const def = ctx.items.get(r.itemId)
  if (!def) {
    // 数据异常：停炉并把剩余料退回（核心归还）
    if (r.lockedQty > 0) addWare(state, r.itemId, r.lockedQty)
    if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
    state.refineRun = { ...EMPTY_REFINE_RUN }
    addLog(state, 'warn', '精炼炉运转异常：资源数据缺失，剩余原料已退回物品仓库（AI 核心已归还）。')
    return
  }
  let guard = 0
  const isRecycle = r.recipe === 'recycle'
  const profile = isRecycle ? recycleProfileOf(ctx, r.itemId) : null
  if (isRecycle && !profile) {
    // 残骸来源数据异常：退回并停炉
    if (r.lockedQty > 0) addWare(state, r.itemId, r.lockedQty)
    if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
    state.refineRun = { ...EMPTY_REFINE_RUN }
    addLog(state, 'warn', '残骸回收运转异常：残骸来源数据缺失，剩余已退回物品仓库（AI 核心已归还）。')
    return
  }
  while (r.active && r.lockedQty > 0 && state.gameMs >= r.finishAtGameMs) {
    if (++guard > 100_000) break // 防失控循环
    const qty = Math.min(r.batchUnits, r.lockedQty)
    if (isRecycle && profile) {
      // B3 残骸回收批：保底矿物（体积当量 × 危险度池） + 彩头（基础件/低安 MK2/蓝图碎片）
      const volumeM3 = qty * def.unitM3
      const out = rollRecycleGuarantee(state, ctx, profile, volumeM3)
      for (const row of out) addWare(state, row.mineralId, row.units)
      const loot = rollRecycleLoot(state, ctx, profile, qty)
      for (const modId of loot.modules) state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
      const fragUnits = new Map<string, number>()
      for (const m of loot.fragments) fragUnits.set(m, (fragUnits.get(m) ?? 0) + 1)
      for (const [m, n] of fragUnits) addWare(state, fragmentItemIdOf(m), n)
    } else {
      const rate = refineRate(state, ctx)
      for (const row of def.refine ?? []) {
        const mineral = ctx.items.get(row.mineralId)
        if (!mineral || mineral.kind !== 'mineral') continue
        const units = Math.floor(qty * row.perOre * rate)
        if (units > 0) addWare(state, row.mineralId, units)
      }
    }
    r.lockedQty -= qty
    r.batchesDone += 1
    if (r.lockedQty <= 0) {
      // 料尽：自动停炉
      const doneBatches = r.batchesDone
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      const wasCore = r.worker !== 'pilot'
      state.refineRun = { ...EMPTY_REFINE_RUN }
      const doneText = isRecycle
        ? `残骸回收完成：${def.name} 共 ${doneBatches} 批全部拆解完，矿物与彩头已入物品仓库${wasCore ? '；AI 核心已归还核心库' : ''}。`
        : `精炼炉运转完成：${def.name} 共 ${doneBatches} 批全部炼完，产物已入物品仓库（收率 ${Math.round(refineRate(state, ctx) * 100)}%）${wasCore ? '；AI 核心已归还核心库' : ''}。`
      addLog(state, 'info', doneText)
      break
    }
    r.finishAtGameMs += r.cycleMs
  }
}

/** 出售结果 */
export interface SellResult {
  ok: boolean
  error?: string
  soldUnits: number
  gainedIsk: number
}

/** 从当前船货仓按市价卖出（矿石主要在此；吃穿簿的剩余自动转限价卖单） */
export function sellCargoItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countItem(state, itemId), (units) => removeItem(state, itemId, units), ctx, '货仓')
}

/** 从物品仓库按市价卖出（矿物/存仓矿石在此） */
export function sellWareItem(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellItemFrom(state, itemId, countWare(state, itemId), (units) => removeWare(state, itemId, units), ctx, '仓库')
}

function sellItemFrom(
  state: GameState,
  itemId: string,
  available: number,
  remove: (units: number) => boolean,
  ctx: SimContext,
  sourceName: string,
): SellResult {
  const def = ctx.items.get(itemId)
  if (!def) return { ok: false, error: `未知物品：${itemId}`, soldUnits: 0, gainedIsk: 0 }
  if (available <= 0) {
    return { ok: false, error: `${sourceName}里没有 ${def.name}。`, soldUnits: 0, gainedIsk: 0 }
  }
  const good = marketGoodOf(ctx, 'item', itemId)
  if (!good) return { ok: false, error: `${def.name} 不在市场流通目录中，无法出售。`, soldUnits: 0, gainedIsk: 0 }
  if (good.playerSellable === false) {
    return { ok: false, error: `${def.name} 暂不支持玩家出售。`, soldUnits: 0, gainedIsk: 0 }
  }
  if (!remove(available)) return { ok: false, error: '取出物品失败。', soldUnits: 0, gainedIsk: 0 }
  // 货先锁定进 escrow，再按市场收购簿即时成交（剩余部分由引擎自动转限价挂单）
  state.escrowItems[good.key] = (state.escrowItems[good.key] ?? 0) + available
  const res = sellAtMarket(state, ctx, good.key, available)
  return { ok: true, soldUnits: res.sold, gainedIsk: res.total }
}

/**
 * 玩家指令：购买新舰船（V9 市场版；v17 允许同型多艘）。
 * 市场有现货 → 立即购入入机库（驾驶船空闲时自动登舰；忙时先入机库不登舰）；
 * 无现货 → 自动按市场均衡价挂收购单（到货自动入机库，可撤单）。
 */
export function buyShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const ship = ctx.ships.get(shipId)
  if (!ship) return { ok: false, error: `未知舰船：${shipId}。` }
  const good = marketGoodOf(ctx, 'ship', shipId)
  if (!good) return { ok: false, error: `${ship.name} 不通过市场流通（仅可制造）。` }
  const lock = goodLockedReason(state, good)
  if (lock) return { ok: false, error: `${ship.name} 暂不可购买：${lock}。` }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell
  if (ask !== undefined) {
    if (state.wallet.isk < ask) {
      return { ok: false, error: `ISK 不足：${ship.name} 市场价约 ${ask.toLocaleString('zh-CN')} ISK（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。` }
    }
    const res = buyAtMarket(state, ctx, good.key, 1)
    const uid = res.bought > 0 ? res.shipUid : null
    if (uid) {
      // v17：登舰前检查驾驶船是否空闲（忙时先入机库，改舰船页切换，避免打断作业）
      const pilotFree =
        state.awayGalaxy === null &&
        !state.transit.active &&
        !state.expedition.active &&
        !state.scanning.active &&
        !state.mining.active
      if (pilotFree) {
        state.shipId = uid
        addLog(state, 'trade', `已购入 ${shipDisplayName(state, ctx, uid)}（市场价 ${res.total.toLocaleString('zh-CN')} ISK）并登舰。`)
      } else {
        addLog(state, 'trade', `已购入 ${shipDisplayName(state, ctx, uid)}（市场价 ${res.total.toLocaleString('zh-CN')} ISK）——驾驶船正在作业，新船已入机库待命（可稍后在舰船页切换驾驶）。`)
      }
      return { ok: true }
    }
  }
  // 市场暂无现货：挂收购单（均衡供应价 ×1.1 保证到货即成交优先）
  const est = estimateShipBid(state, ctx, good.key)
  if (state.wallet.isk < est) {
    return { ok: false, error: `ISK 不足：${ship.name} 收购挂单约 ${est.toLocaleString('zh-CN')} ISK。` }
  }
  const order = placeBuyOrder(state, ctx, good.key, est, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包或参数异常）。' }
  addLog(state, 'trade', `${ship.name} 市场暂无现货——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} ISK，到货自动停入机库（可随时撤销）。`)
  return { ok: true }
}

/** 舰船收购估价：簿上有价用簿价 ×1.02；否则按均衡供应价 */
function estimateShipBid(state: GameState, ctx: SimContext, goodKey: string): number {
  const quote = marketQuote(state, ctx, goodKey)
  if (quote.sell !== undefined) return Math.round(quote.sell * 1.02)
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return Math.round(1e9)
  return Math.round(def.basePrice * 1.06 * 1.02)
}

/** 兼容旧导出名：旧版单源卖（全部从货仓卖） */
export function sellAll(state: GameState, itemId: string, ctx: SimContext): SellResult {
  return sellCargoItem(state, itemId, ctx)
}

/**
 * 逆向研究（B3 蓝图碎片兑换，2026-09-05 船长定稿）：消耗指定装备的蓝图碎片
 * （货仓+仓库），把对应蓝图**永久**加入 learnedRecipes（一次掌握，之后可无限自制，
 * 无需再经市场购图）。母港操作。
 */
export function redeemFragments(state: GameState, ctx: SimContext, moduleId: string): CommandResult {
  const recipe = FRAGMENT_RECIPES[moduleId]
  if (!recipe) return { ok: false, error: `「${moduleId}」没有对应的逆向研究蓝图。` }
  if (!isAtHome(state)) {
    return { ok: false, error: '逆向研究在母港进行：回到母港后再操作。' }
  }
  if (state.learnedRecipes.includes(recipe.blueprintId)) {
    return { ok: false, error: '该蓝图已掌握（learnedRecipes 永久生效），无需重复逆向。' }
  }
  const def = ctx.modules.get(moduleId)
  const bpDef = ctx.blueprints.get(recipe.blueprintId)
  const fragId = fragmentItemIdOf(moduleId)
  const fragDef = ctx.items.get(fragId)
  const have = countItem(state, fragId) + countWare(state, fragId)
  if (have < recipe.need) {
    return {
      ok: false,
      error: `碎片不足：${fragDef?.name ?? fragId} 现有 ${have}/${recipe.need} 片（还需 ${recipe.need - have} 片）。`,
    }
  }
  let need = recipe.need
  const fromCargo = Math.min(countItem(state, fragId), need)
  if (fromCargo > 0) {
    removeItem(state, fragId, fromCargo)
    need -= fromCargo
  }
  if (need > 0) removeWare(state, fragId, need)
  state.learnedRecipes.push(recipe.blueprintId)
  addLog(
    state,
    'info',
    `逆向研究完成：${fragDef?.name ?? fragId} ×${recipe.need} → 已解锁「${bpDef?.name ?? recipe.blueprintId}」蓝图（${def?.name ?? moduleId} 可自制备；无需市场购图）。`,
  )
  return { ok: true }
}
