/**
 * 精炼炉运转 / 市场出售（V9：卖出并入市场订单簿）/ 舰船购买。
 *
 * 精炼模型（工业细化，2026-09-04 船长定稿：运转周期制；2026-09-05 船长拍板多工位并行）：
 * - 精炼 = 母港精炼炉的"循环运转"：多工位并行（refineRuns 表），每个资源（矿石/气体/冰矿）
 *   或残骸型号至多一台炉；主控亲自运转限 1 台（占主控工作位），其余工位可各由一枚闲置
 *   AI 核心驱动（核心出库占用，不占副船名额；核心库存即并行上限）；
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
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState, RefineRunState } from './state'
import type { AiCoreType, ItemDef, SimContext } from './types'
import { addItem, addWare, countItem, countWare, removeItem, removeWare } from './inventory'
import { aiCoreName, aiEfficiency, countAiCore, occupyAiCore, releaseAiCore } from './ai'
import { isAtHome } from './location'
import { formatDurationMs } from './time'
import { DSI_FACTION_ID, standingOf } from './expedition'
import { buyAtMarket, goodLockedReason, marketGoodOf, marketQuote, placeBuyOrder, sellAtMarket } from './market'
import { shipDisplayName } from './instances'
import {
  RECYCLE_BATCH_M3,
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

/** 精炼炉此刻是否有炉在运转（任一工位） */
export function refineRunActive(state: GameState): boolean {
  return state.refineRuns.length > 0
}

/** 主控亲自运转的炉是否占用着主控（主控忙判定；AI 核心驱动不占主控；多工位下至多一台 pilot 炉） */
export function refineManualActive(state: GameState): boolean {
  return state.refineRuns.some((r) => r.active && r.worker === 'pilot')
}

/** 精炼炉运行视图（工业页 / 顶部活动栏共用） */
export interface RefineRunView {
  active: boolean
  /** 稳定台号（停炉定位） */
  id: number
  itemId: string | null
  itemName: string
  /** 劳动者：pilot = 主控 / AI 核心类型 */
  worker: 'pilot' | AiCoreType
  workerLabel: string
  /** 当前收率（每批结算按当时技能取值） */
  rate: number
  /** 单批单位（开工时按技能现算） */
  batchUnits: number
  /** 单批周期毫秒（已按核心效率拉长） */
  cycleMs: number
  /** 已完成批数 */
  batchesDone: number
  /** 当前批进度 0~100 */
  percent: number
  /** 当前批剩余毫秒（v20 原料不锁定，整炉剩余 = 仓库余量决定，不再预估） */
  remainingMs: number
}

/** 单台炉的当前进度视图（percent/remainingMs 按当前时间现算；v20 原料不锁定，
 * remainingMs 只含当前批——余量看仓库实时库存） */
function refineRunViewOf(state: GameState, ctx: SimContext, r: RefineRunState): RefineRunView {
  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const base = {
    active: r.active,
    id: r.id,
    itemId: r.itemId,
    itemName: def?.name ?? '—',
    worker: r.worker,
    workerLabel: r.worker === 'pilot' ? '主控' : aiCoreName(r.worker),
    rate: refineRate(state, ctx),
    batchUnits: r.batchUnits,
    cycleMs: r.cycleMs,
    batchesDone: r.batchesDone,
  }
  if (!r.active || r.itemId === null || r.cycleMs <= 0) {
    return { ...base, percent: 0, remainingMs: 0 }
  }
  const remainCur = Math.max(0, r.finishAtGameMs - state.gameMs)
  const percent = Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainCur) / r.cycleMs) * 100)))
  return { ...base, percent, remainingMs: remainCur }
}

/** 全部精炼炉工位运行视图（v19 多工位：工业页卡片 / 顶部活动栏共用，逐台一条） */
export function refineRunViews(state: GameState, ctx: SimContext): RefineRunView[] {
  return state.refineRuns.map((r) => refineRunViewOf(state, ctx, r))
}

/**
 * 玩家指令：启动一台精炼炉（v20：同资源允许多台同时运转、原料不锁定——每批到点从仓库
 * 实时扣取，耗尽自动停；worker = 'pilot'（主控亲自运转，全局限 1 台、占主控工作位）或
 * AI 核心类型（每台需一枚闲置核心，核心库存即并行上限；核心出库占用、不占副船名额，
 * 停炉/料尽自动归还）。
 */
export function startRefineRun(
  state: GameState,
  itemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
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
    // 主控亲自运转 = 全局限 1 台 + 占主控工作位：与其它主控作业互斥
    if (state.refineRuns.some((r) => r.worker === 'pilot')) {
      return { ok: false, error: '你已亲自运转着一台精炼炉：先停掉它才能再亲自开一台（AI 核心不受此限）。' }
    }
    if (state.mining.active) return { ok: false, error: '采矿作业中：先停止开采。' }
    if (state.salvaging.active) return { ok: false, error: '打捞作业中：先停止打捞（或等满仓自动返航）。' }
    if (state.expedition.active) return { ok: false, error: '远征作业中：先召回或等待结束。' }
    if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
    if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：先召回。' }
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
  // v20：原料不预锁定——仓库/货仓余量即炉料，每批到点实时扣取
  state.refineRuns.push({
    active: true,
    id: state.refineSeq++,
    worker,
    recipe: 'refine',
    itemId,
    batchUnits: batchEff,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    batchesDone: 0,
  })
  const who = worker === 'pilot' ? '由你亲自运转' : `由 ${aiCoreName(worker)} 驱动（效率 ${Math.round(eff * 100)}%）`
  addLog(
    state,
    'info',
    `精炼炉开工：${def.name}（仓库现有 ×${available}）由${who}炼（每批 ${batchEff} 单位 / ${formatDurationMs(cycleEff)}，每批到点实时扣料，耗尽自动停炉；可多台同时炼同一种资源）。`,
  )
  return { ok: true }
}

/**
 * 玩家指令：启动"残骸回收"（B3 开箱批，2026-09-05 船长定稿；v20：同一型号残骸允许多台
 * 并行、原料不锁定）：批 = 10 m³ / 25 秒（劳动者 100%；AI 核心按效率拉长周期；残骸计数 =
 * 体积），每批开箱 = 保底矿物（按残骸敌群星系危险度三档池 + 体积当量）+ 彩头（基础件直出 /
 * 低安 MK2 / 蓝图碎片）。每批到点从仓库实时扣取残骸；耗尽自动停炉（核心归还）。
 */
export function startRecycleRun(
  state: GameState,
  wreckItemId: string,
  worker: 'pilot' | AiCoreType,
  ctx: SimContext,
): CommandResult {
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
    // 主控亲自回收：全局限 1 台 + 占主控工作位
    if (state.refineRuns.some((r) => r.worker === 'pilot')) {
      return { ok: false, error: '你已亲自运转着一台炉子：先停掉它才能再亲自开一台（AI 核心不受此限）。' }
    }
    if (state.mining.active) return { ok: false, error: '采矿作业中：先停止开采。' }
    if (state.salvaging.active) return { ok: false, error: '打捞作业中：先停止打捞（或等满仓自动返航）。' }
    if (state.expedition.active) return { ok: false, error: '远征作业中：先召回或等待结束。' }
    if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
    if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：先召回。' }
    if (state.transit.active) return { ok: false, error: '返航行程中：先等抵达。' }
  } else if (countAiCore(state, worker) <= 0) {
    return { ok: false, error: `${aiCoreName(worker)} 库存不足，无法接入精炼炉。` }
  }
  const eff = worker === 'pilot' ? 1 : aiEfficiency(state, ctx, worker)
  let cycleEff = Math.max(1, Math.round(RECYCLE_CYCLE_MS / eff))
  // 残骸回收学（salvage-recycling，2026-09-05）：回收批周期每级 −4%（手动与 AI 同享，至少保留 60%）
  const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
  if (recLv > 0) cycleEff = Math.max(1, Math.round(cycleEff * Math.max(0.6, 1 - 0.04 * recLv)))
  if (worker !== 'pilot' && !occupyAiCore(state, worker)) {
    return { ok: false, error: `${aiCoreName(worker)} 占用失败（库存异常）。` }
  }
  // v20：原料不预锁定——仓库/货仓余量即炉料，每批到点实时扣取
  state.refineRuns.push({
    active: true,
    id: state.refineSeq++,
    worker,
    recipe: 'recycle',
    itemId: wreckItemId,
    batchUnits: RECYCLE_BATCH_M3,
    cycleMs: cycleEff,
    finishAtGameMs: state.gameMs + cycleEff,
    batchesDone: 0,
    recAcc: { min: {}, mod: {}, frag: {} }, // 回收所得累计（停炉/料尽/自然结束时写明细日志）
  })
  const who = worker === 'pilot' ? '由你亲自运转' : `由 ${aiCoreName(worker)} 驱动（效率 ${Math.round(eff * 100)}%）`
  addLog(
    state,
    'info',
    `残骸回收开工：${def.name}（可拆 ${Math.round(available * 100) / 100} m³，货仓+仓库合计）${who}开箱——每批 ${RECYCLE_BATCH_M3} m³ / ${formatDurationMs(cycleEff)}，到点实时扣料；保底矿物按残骸来源星系危险度池抽取，耗尽自动停炉；同种残骸可多台同时开箱。`,
  )
  return { ok: true }
}

/** 回收所得明细文本（停炉/料尽/自然结束时附在日志里；2026-09-06 玩家上报"结果不显示"） */
function recycleResultNote(
  state: GameState,
  ctx: SimContext,
  rec: { min: Record<string, number>; mod: Record<string, number>; frag: Record<string, number> },
): string {
  const nameOf = (id: string): string => ctx.items.get(id)?.name ?? id
  const fmt = (m: Record<string, number>, cap = 6): string => {
    const es = Object.entries(m).sort((a, b) => b[1]! - a[1]!)
    const head = es
      .slice(0, cap)
      .map(([id, n]) => `${nameOf(id)}×${n}`)
      .join('、')
    return es.length > cap ? `${head} 等${es.length}种` : head
  }
  const parts: string[] = []
  if (Object.keys(rec.min).length > 0) parts.push(`保底矿物 ${fmt(rec.min)}`)
  const loot: string[] = []
  if (Object.keys(rec.mod).length > 0) loot.push(`装备 ${fmt(rec.mod)}`)
  if (Object.keys(rec.frag).length > 0) loot.push(`蓝图碎片 ${fmt(rec.frag)}`)
  if (loot.length > 0) parts.push(`彩头：${loot.join('；')}`)
  return parts.length > 0 ? parts.join('；') : ''
}

/**
 * 玩家指令：停指定的某一台炉（v20 按台号 id 定位，同资源多台互不影响）。
 * 已完成批已出货；v20 原料不锁定故无退料；AI 核心驱动时核心自动归还。
 */
export function stopRefineRun(state: GameState, ctx: SimContext, runId: number): CommandResult {
  const idx = state.refineRuns.findIndex((r) => r.id === runId)
  if (idx < 0) return { ok: false, error: '没有找到该台炉（已停或未启动）。' }
  const [r] = state.refineRuns.splice(idx, 1)
  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
  const coreNote = r.worker !== 'pilot' ? '；AI 核心已归还核心库' : ''
  const accNote = r.recipe === 'recycle' && r.recAcc ? recycleResultNote(state, ctx, r.recAcc) : ''
  addLog(
    state,
    'info',
    `${def?.kind === 'wreck' ? '残骸回收炉' : '精炼炉'}已停：${def?.name ?? '未知资源'}（已完成 ${r.batchesDone} 批）${coreNote}` +
      (accNote ? `；回收所得：${accNote}` : '') +
      '。原料未锁定无需退回，余料仍留在货仓/仓库。',
  )
  return { ok: true }
}

/**
 * 引擎内部：推进全部精炼炉工位（每次时间推进后调用；v20：原料不锁定，
 * 每批到点从仓库实时扣取 min(单批, 仓库余量)——余量不足自然成尾批，耗尽自动停炉并归还核心。
 * 同资源多台并行时按数组顺序各自扣料，公平近似。
 */
export function advanceRefining(state: GameState, ctx: SimContext): void {
  // 倒序遍历：异常/料尽时从数组移除元素不影响尚未推进的其它工位
  for (let i = state.refineRuns.length - 1; i >= 0; i--) {
    const r = state.refineRuns[i]!
    if (!r.active || r.itemId === null) {
      state.refineRuns.splice(i, 1)
      continue
    }
    const def = ctx.items.get(r.itemId)
    if (!def) {
      // 数据异常：停炉（无锁定料可退；核心归还）
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'warn', '精炼炉运转异常：资源数据缺失，该台已停（AI 核心已归还）。')
      continue
    }
    let guard = 0
    const isRecycle = r.recipe === 'recycle'
    const profile = isRecycle ? recycleProfileOf(ctx, r.itemId) : null
    if (isRecycle && !profile) {
      // 残骸来源数据异常：停炉
      if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
      state.refineRuns.splice(i, 1)
      addLog(state, 'warn', '残骸回收运转异常：残骸来源数据缺失，该台已停（AI 核心已归还）。')
      continue
    }
    while (r.active && state.gameMs >= r.finishAtGameMs) {
      if (++guard > 100_000) break // 防失控循环
      // v20 实时扣料：仓库/货仓余量决定本批能炼多少
      const avail = oreAvailable(state, r.itemId)
      if (avail <= 0) {
        // 原料耗尽：自动停炉（含被卖光/被并行台抢先的情况）
        const doneBatches = r.batchesDone
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = isRecycle && r.recAcc ? recycleResultNote(state, ctx, r.recAcc) : ''
        state.refineRuns.splice(i, 1)
        addLog(
          state,
          'info',
          `${isRecycle ? `残骸回收炉停：${def.name}` : `精炼炉停：${def.name}`} 原料耗尽（共 ${doneBatches} 批）` +
            (accNote ? `；回收所得：${accNote}` : '') +
            (wasCore ? '；AI 核心已归还核心库' : '') +
            '。',
        )
        break
      }
      const qty = Math.min(r.batchUnits, avail)
      // 从货仓优先扣料，余下取仓库
      const fromCargo = Math.min(countItem(state, r.itemId), qty)
      if (fromCargo > 0) removeItem(state, r.itemId, fromCargo)
      const fromWare = qty - fromCargo
      if (fromWare > 0) removeWare(state, r.itemId, fromWare)
      if (isRecycle && profile) {
        // B3 残骸回收批：保底矿物（体积当量 × 危险度池） + 彩头（基础件/低安 MK2/蓝图碎片）；
        // 所得同时累计进 r.recAcc（停炉/结束日志出明细）
        const volumeM3 = qty * def.unitM3
        const out = rollRecycleGuarantee(state, ctx, profile, volumeM3)
        for (const row of out) addWare(state, row.mineralId, row.units)
        const loot = rollRecycleLoot(state, ctx, profile, qty)
        for (const modId of loot.modules) state.moduleBay[modId] = (state.moduleBay[modId] ?? 0) + 1
        const fragUnits = new Map<string, number>()
        for (const m of loot.fragments) fragUnits.set(m, (fragUnits.get(m) ?? 0) + 1)
        for (const [m, n] of fragUnits) addWare(state, fragmentItemIdOf(m), n)
        const acc = r.recAcc ?? { min: {}, mod: {}, frag: {} }
        for (const row of out) acc.min[row.mineralId] = (acc.min[row.mineralId] ?? 0) + row.units
        for (const modId of loot.modules) acc.mod[modId] = (acc.mod[modId] ?? 0) + 1
        for (const [m, n] of fragUnits) acc.frag[m] = (acc.frag[m] ?? 0) + n
        r.recAcc = acc
      } else {
        const rate = refineRate(state, ctx)
        for (const row of def.refine ?? []) {
          const mineral = ctx.items.get(row.mineralId)
          if (!mineral || mineral.kind !== 'mineral') continue
          const units = Math.floor(qty * row.perOre * rate)
          if (units > 0) addWare(state, row.mineralId, units)
        }
      }
      r.batchesDone += 1
      if (qty < r.batchUnits || oreAvailable(state, r.itemId) <= 0) {
        // 尾批（余量不足一批）或本批把库存清空 → 炼完即停，防止空转与抢料
        const doneBatches = r.batchesDone
        if (r.worker !== 'pilot') releaseAiCore(state, r.worker)
        const wasCore = r.worker !== 'pilot'
        const accNote = isRecycle && r.recAcc ? recycleResultNote(state, ctx, r.recAcc) : ''
        state.refineRuns.splice(i, 1)
        addLog(
          state,
          'info',
          `${isRecycle ? `残骸回收完成：${def.name}` : `精炼炉运转完成：${def.name}`} 共 ${doneBatches} 批` +
            (accNote ? `；回收所得：${accNote}` : '') +
            `，产物已入物品仓库${wasCore ? '；AI 核心已归还核心库' : ''}。`,
        )
        break
      }
      r.finishAtGameMs += r.cycleMs
    }
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

/** 从当前船货仓按市价**卖出指定数量**（船长 2026-09-05：出售支持只卖一部分；其余语义同 sellCargoItem） */
export function sellCargoItemQty(state: GameState, itemId: string, qty: number, ctx: SimContext): SellResult {
  const have = countItem(state, itemId)
  const want = Math.max(0, Math.floor(qty))
  if (want <= 0) return { ok: false, error: '出售数量需大于 0。', soldUnits: 0, gainedIsk: 0 }
  if (want > have) {
    const def = ctx.items.get(itemId)
    return {
      ok: false,
      error: `货仓里只有 ${have} 单位${def ? ` ${def.name}` : ''}，无法卖 ${want} 单位。`,
      soldUnits: 0,
      gainedIsk: 0,
    }
  }
  return sellItemFrom(state, itemId, want, (units) => removeItem(state, itemId, units), ctx, '货仓')
}

/** 从物品仓库按市价**卖出指定数量**（同 sellWareItem 其余语义） */
export function sellWareItemQty(state: GameState, itemId: string, qty: number, ctx: SimContext): SellResult {
  const have = countWare(state, itemId)
  const want = Math.max(0, Math.floor(qty))
  if (want <= 0) return { ok: false, error: '出售数量需大于 0。', soldUnits: 0, gainedIsk: 0 }
  if (want > have) {
    const def = ctx.items.get(itemId)
    return {
      ok: false,
      error: `仓库里只有 ${have} 单位${def ? ` ${def.name}` : ''}，无法卖 ${want} 单位。`,
      soldUnits: 0,
      gainedIsk: 0,
    }
  }
  return sellItemFrom(state, itemId, want, (units) => removeWare(state, itemId, units), ctx, '仓库')
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
        !state.mining.active &&
        !state.salvaging.active
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
