/**
 * 打捞作业（B3，2026-09-05 船长定稿：采矿式作业；docs/design/b3-salvage.md）。
 *
 * 模型：
 * - 采矿式**自动循环**（2026-09-09 船长定稿，玩家反馈"打捞只一趟"）：下达即视为已抵达目标星系，
 *   立即自动持续打捞（去程已取消）（船内每台打捞器按各自周期结算，每轮按 salvageRoundPull 的
 *   "体积当量系数"捞取该星系敌群型号池随机一只残骸入货仓）→ **满仓自动返航** → 到港整仓卸入
 *   物品仓库 → autoCycle（默认开）时同星系自动续捞（去程时间并入返航腿，总行程时间不变）；
 *   勾 stopAfterTrip / 关闭自动循环 = 卸货后收工；手动停止任何时刻可停（偏好跨趟保留，同采矿）；
 * - 满仓判定 = 货仓放不下下一轮捞取量时转返航（残骸 = 重货）；
 * - 打捞期间该星系密度漂移**双向挂起**（engine 每拍把正在打捞的星系传给
 *   advanceWreckDrift）；低安星系打捞"作业中"暴露（出航/返航移动段不暴露，
 *   见 encounters.collectExposures；2026-09-06 船长口径：移动不暴露）；
 * - 工作位守卫：与采矿/远征/扫描/待命/返航/主控精炼互斥（入口拒绝）；
 * - 出发要求：船上装有 ≥1 台打捞器（slot='salvager'）。
 */
import { tuningMul } from './tuning'
import { addLog, salvageHalt } from './state'
import { applyActivityGate } from './activityGate'
import { pilotUnavailableReason } from './shipyard'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { AnomalyDef, SimContext } from './types'
import { addItem, freeCargoM3, unloadCargoToWarehouse } from './inventory'
import { HOME_GALAXY_ID, shortestTravelMinutes } from './expedition'
import { travelLegMs } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { bumpFirst } from './firstTasks'
import { fleetDefOf, shipDisplayName } from './instances'
import { allFittedModules } from './equipment'
import { nextRandom, pickWeighted } from './rng'
import {
  pullRareWreck,
  RARE_WRECK_VOLUME_M3,
  recycleTierOf,
  salvageRoundMulOf,
  salvageRoundPull,
  rollIntactHullLoot,
  wreckBaseDensity,
  WRECK_VOLUME_PER_THREAT,
  wreckDensityOf,
  wreckGroupOfCard,
  wreckItemIdOf,
  wreckYieldMultiplierOf,
  // 2026-09-26（玩家报障）：残骸场带来源族 ⇒ 有场就并入那一族的独立入侵卡
  weekendWreckDensityOf,
  weekendWreckFamilyOf,
  // 2026-09-26（船长令）：打捞对象（选组 / 选入侵残骸）与分组存量
  WEEKEND_WRECK_TARGET,
  wreckGroupStockOf,
  wreckGroupStocksOf,
} from './salvage'
import { weekendBountyCardsOf } from './weekendBounty'
import { scaledReturnMs } from './trips'

/** 出航/返航共用腿（星系航程）：进出港基准（同采矿 localLegMs）+ 星系间航程（按船速换算） */
export function legMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
  const travel = Number.isFinite(mins) ? mins : 0
  return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, travel, shipId))
}

/** 出航腿（空船出门跃迁×2 → 约返航一半；调试模式固定 1 秒） */
export function outboundLegMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(legMsFor(state, ctx, galaxyId, shipId) / 2))
}

/** 该船装配的打捞器周期表（每台周期毫秒；无打捞器 = 空表）。
 * 打捞装置整备学（salvage-rigging）：单轮周期每级 −3%（2026-09-08 船长定：移除「最多 −40%」
 * 护栏；主控与 AI 同源——主控作业与 AI 任务都经本函数取周期）。 */
export function salvagerCyclesOf(state: GameState, ctx: SimContext, shipId: string): number[] {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return []
  const rigLv = Math.min(5, state.skills.trained['salvage-rigging'] ?? 0)
  const rigFactor = rigLv > 0 ? Math.max(0, 1 - 0.03 * rigLv) : 1
  const cycles: number[] = []
  for (const def of allFittedModules(fleetShip.fitted, ctx)) {
    if (def.slot === 'salvager') cycles.push(Math.max(100, Math.round((def.salvageCycleMs ?? 10_000) * rigFactor)))
  }
  return cycles
}

/**
 * 目标星系可打捞的敌群型号池（该星系悬赏群；2026-09-09 修复：按威胁加权抽型号）。
 * B1 低安遭遇模板（hidden: true，galaxyId 仅占位）**不入池**——遭遇群残骸只在击杀发生星系
 * 按注入路径成立；抽池与悬赏目录/打捞列表同口径（此前把 enc-pirate 模板算进母港池，
 * 导致在母港能捞出从未在母港出现的「狂徒巡逻编队/深空屠夫舰队」残骸）。
 *
 * ⚠ **2026-09-25 追加：被占星系要连"驻留的那支入侵舰队"一起入池**（船长令「修，②」）。
 * 入侵独立卡（H 族四张）是 `hidden` ⇒ 只按静态表遍历永远进不了池，于是"入侵敌人不产自己的残骸"。
 * 现按 `weekendBountyCardsOf`（= 悬赏替换的同一取法：外围 {骚扰, 袭击} · 核心 {袭击, 主力} 抽一支、
 * 威胁 = 卡面自身）把它们并进来 ⇒ 在该星系打捞就能出「墨潮帮残骸（高安）」。
 * 传 `state`/`nowWallMs` 才生效（缺省 = 老口径，纯函数区与既有用例逐字不变）；夺回/活动结束后自动回落。
 */
function wreckPoolOf(
  ctx: SimContext,
  galaxyId: string,
  state?: GameState,
  nowWallMs?: number,
  /** **打捞对象**（2026-09-26 船长令）：缺省 = 全部 · 组 key = 只留该组 · `WEEKEND_WRECK_TARGET` = 只留入侵独立卡 */
  target?: string,
): Array<{ anomalyId: string; threat: number }> {
  const pool: Array<{ anomalyId: string; threat: number }> = []
  const seen = new Set<string>()
  for (const a of ctx.anomalies.values()) {
    if (a.hidden) continue // B1 遭遇模板不进打捞池（悬赏目录同口径）
    if (a.galaxyId !== galaxyId) continue
    pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
    seen.add(a.id)
  }
  if (state && nowWallMs !== undefined && pool.length > 0) {
    const base = pool.map((p) => ctx.anomalies.get(p.anomalyId)).filter((a): a is AnomalyDef => a !== undefined)
    for (const c of weekendBountyCardsOf(state, ctx, base, galaxyId, nowWallMs)) {
      if (seen.has(c.id)) continue
      // 只并"独立入侵卡"（它们在静态表里是 hidden）；A/C/G 的占位派生卡 id 与原卡相同 ⇒ 上面已收
      if (ctx.anomalies.get(c.id)?.hidden !== true) continue
      seen.add(c.id)
      pool.push({ anomalyId: c.id, threat: Math.max(1, c.threat) })
    }
  }
  /**
   * 🔴 **2026-09-26 补的第二刀（玩家报障：「打捞残骸捞不到 H 族残骸，只能捞到该星系默认的」）**。
   *
   * 病根：**残骸场比"占领"活得久** —— 入侵残骸 48 小时自然衰减、活动结束也不清空；而上面那一刀只在
   * 「此刻仍在占领名单里」时才并入入侵舰队 ⇒ 下面三种星系会「残骸条写着入侵残骸、捞出来全是默认残骸」：
   * ① **旗舰期的核心**（核心夺回后旗舰才现身，玩家正是在这里打旗舰、注入最大的一笔残骸）；
   * ② **夺回后的外围**（打赢即夺回，残骸留在那儿慢慢衰减）；③ **上一场的遗留场**。
   *
   * 修法：**只要该星系还有入侵残骸场（有效密度 > 0），就把来源族的独立入侵卡并进池** ——
   * 族取 `weekendWreckFamilyOf`（记录里的来源族；老档没记 ⇒ 回落当前事件族）。
   * 池子只决定"能捞出什么型号"，**不额外造残骸**：能捞的总量仍是残骸场那一份（扣减口径一字未改）。
   */
  if (state && nowWallMs !== undefined) {
    const family = weekendWreckFamilyOf(state, galaxyId)
    if (family !== undefined && weekendWreckDensityOf(state, galaxyId) > 0) {
      for (const a of ctx.anomalies.values()) {
        if (a.hidden !== true) continue
        if (a.foeFamily !== family) continue
        if (seen.has(a.id)) continue
        seen.add(a.id)
        pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
      }
    }
  }
  /**
   * **按打捞对象过滤**（**2026-09-26 船长令**：「让玩家选择打捞对象，包括多族悬赏混合的星系」）：
   * - 缺省 = 全部（现状：按威胁加权抽，池子一个字不变）；
   * - 组 key ⇒ 只留该组的卡（选什么捞什么）；
   * - `WEEKEND_WRECK_TARGET` ⇒ 只留**入侵独立卡**（`hidden` 的那些）。
   */
  if (target === undefined) return pool
  return pool.filter((p) => {
    if (target === WEEKEND_WRECK_TARGET) return ctx.anomalies.get(p.anomalyId)?.hidden === true
    return wreckGroupOfCard(p.anomalyId, ctx)?.key === target
  })
}

/**
 * **自动判定本轮打捞对象**（**2026-09-26 船长令**：「**分组后不要再让玩家手动选择打捞对象了，
 * 这有些太过繁琐。改为自动判断：优先打捞入侵残骸，没有入侵残骸则是根据两种残骸的数量比同步打捞。**」）。
 *
 * 三条（按序判定；`target` 有值 = 旧的手选口径，核心能力与用例保留、**界面已无入口**）：
 * 1. **入侵残骸有存量 ⇒ 只从入侵独立卡里抽**（"同池内，入侵残骸优先"——普通池内部的第一档）；
 * 2. 否则 ⇒ **按各组存量的数量比**先抽组、再在该组内按威胁加权抽卡（"同步捞" = 按比例分摊，
 *    不偏向任何一组；扣减也按同一比例回调，见 `salvage.salvageRoundPull`）；
 * 3. 没有分组账（老档 / 池底来自安全等级）⇒ 返回 `null`（调用方回落改前的"整池按威胁加权"）。
 *
 * ⚠ 本函数只管**普通池内部**；**稀有池在它之前**（`pullOneWreck` 第 1 支，捞完为止、不参与组比）——
 * 三级序全文见 `pullOneWreck` 的头注（来源 = 2026-09-26 船长裁定原话）。
 */
function autoTargetPickOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  pool: ReadonlyArray<{ anomalyId: string; threat: number }>,
): { anomalyId: string; threat: number } | null {
  // ① 入侵残骸优先
  if (weekendWreckDensityOf(state, galaxyId) > 0) {
    const hidden = pool.filter((p) => ctx.anomalies.get(p.anomalyId)?.hidden === true)
    if (hidden.length > 0) return pickWeighted(state.rng, hidden, (p) => p.threat, { bound: 'lte' }) ?? hidden[0]!
  }
  // ② 按各组存量的数量比抽组
  const shares = wreckGroupStocksOf(state, ctx, galaxyId).filter(
    (r) => r.groupKey !== WEEKEND_WRECK_TARGET && r.stockM3 > 0,
  )
  if (shares.length === 0) return null
  const byGroup = pickWeighted(state.rng, shares, (r) => r.stockM3, { bound: 'lte' }) ?? shares[0]!
  const inGroup = pool.filter((p) => wreckGroupOfCard(p.anomalyId, ctx)?.key === byGroup.groupKey)
  if (inGroup.length === 0) return null
  return pickWeighted(state.rng, inGroup, (p) => p.threat, { bound: 'lte' }) ?? inGroup[0]!
}

/**
 * **该对象在这个星系是否可用**（有存量才算）：`undefined`（全部）恒真；`WEEKEND_WRECK_TARGET` 看入侵残骸；
 * 组 key 看该组份额。给的对象不可用 ⇒ 回落"全部"（不拒开工）。
 */
function salvageTargetOkOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  target: string | undefined,
): boolean {
  if (target === undefined) return true
  return wreckGroupStockOf(state, ctx, galaxyId, target) > 0.05
}

/**
 * **该星系当前可选的打捞对象与存量**（界面下拉与用例共用）：星系池各组 ＋（若有）入侵残骸那一行。
 * ⚠ 只在作业星系上调用（读的是该星系的账）。
 */
export function wreckTargetsOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): Array<{ groupKey: string; stockM3: number }> {
  return wreckGroupStocksOf(state, ctx, galaxyId)
}

/**
 * **中途换打捞对象**（**2026-09-26 船长令**）：作业不停、只换对象；给的对象不可用 ⇒ 回落"全部"。
 * 返回真正生效的对象（`undefined` = 全部），供界面回显。
 */
export function setSalvageTarget(
  state: GameState,
  ctx: SimContext,
  target: string | undefined,
): string | undefined {
  const s = state.salvaging
  if (!s.active || s.galaxyId === null) return s.targetGroup
  s.targetGroup = salvageTargetOkOf(state, ctx, s.galaxyId, target) ? target : undefined
  return s.targetGroup
}

/**
 * 玩家指令：开始打捞作业（目标星系需可达、已探索、有敌群型号池；船需装打捞器）。
 *
 * ⚠ **2026-09-26 船长令加 `targetGroup`**：「**玩家打捞时，让玩家选择打捞对象，包括多族悬赏混合的星系，
 * 之后残骸也要分开算。**」——`undefined` = 全部（现状）· 组 key = 只捞该组 · `WEEKEND_WRECK_TARGET` = 只捞入侵残骸。
 * 给的对象在该星系**没有存量**（或不是合法对象）⇒ **回落"全部"**（不拒开工：老档/AI 调用零影响）。
 */
export function startSalvageOp(
  state: GameState,
  galaxyId: string,
  ctx: SimContext,
  targetGroup?: string,
): CommandResult {
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.salvaging.001', errorParams: { p1: galaxyId } }
  /**
   * **换星系打捞 = 允许直接切**（与「换矿带」同款；船长 2026-09-21 答 2「**允许切换**」的同一把尺）：
   * 先把本趟停掉（`salvageHalt` 单点——本趟残骸留在船上），再按新星系开工。
   * ⚠ 原先这里是硬拒（「打捞作业进行中：请先停止当前打捞」）。
   */
  if (state.salvaging.active) {
    const prevGalaxy = state.salvaging.galaxyId ? ctx.galaxies.get(state.salvaging.galaxyId) : undefined
    const prevName = prevGalaxy?.name ?? '原星系'
    const info = salvageHalt(state)
    addLog(
      state,
      'warn',
      `已切换打捞点：停掉「${prevName}」的打捞（本趟约 ${Math.round((info?.tripM3 ?? 0) * 100) / 100} m³ 当量留在船上），改去「${galaxy.name}」。`,
      'core.salvaging.020',
      { p1: prevName, p2: galaxy.name, p3: Math.round((info?.tripM3 ?? 0) * 100) / 100 },
    )
  }
  /** ⚠ `wormholePilotHoldReason` 已撤（2026-09-21 统一批）：扫描虫洞 = 可自动停、人在洞里 = 拒，都归 `activityGate` */
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  if (salvagerCyclesOf(state, ctx, state.shipId).length === 0) {
    // 2026-09-20 船长令：提示里要**指明去处**（「添加让玩家去装配的提示」）⇒ 文案点到「装配」页
    return { ok: false, error: '打捞需要打捞器：先到「装配」页给驾驶船的高槽装一台（MK1/2/3）再出发。', errorId: 'core.salvaging.003' }
  }
  /**
   * V13 探索封锁：**目标星系未点亮 ⇒ 拒绝开工**。
   * ⚠ **2026-09-17 船长改口径**（与采集同批）：原先这条只作用于**非母港**（母港当时恒为已探索），
   * 现对**所有**星系生效——「初始将母港星系设置为和其他星系一样的未知状态，需要扫描才有悬赏和挖矿」。
   */
  const exploreBlock = actionBlockReason(state, galaxyId)
  if (exploreBlock) return { ok: false, error: exploreBlock }
  // 外系星系还必须能从母港到达（无航路 → 拒绝）
  if (galaxyId !== HOME_GALAXY_ID) {
    const travel = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
    if (!Number.isFinite(travel)) {
      return {
        ok: false,
        error: `「${galaxy.name}」没有从母港可达的航线，无法前往打捞。`,
        errorId: 'core.salvaging.010',
        errorParams: { p1: galaxy.name },
      }
    }
  }
  if (wreckPoolOf(ctx, galaxyId, state, Date.now()).length === 0) {
    return {
      ok: false,
      error: `「${galaxy.name}」没有可打捞的敌群残骸（该星系无悬赏目标）。`,
      errorId: 'core.salvaging.011',
      errorParams: { p1: galaxy.name },
    }
  }
  /**
   * **其余主控活动 ⇒ 走统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，只有长途运输
   * 那一档先警告；远征/快递/战斗中/洞里/返航途中一律拒）——原先这里散着 8 条硬拒，现已收进
   * `activityGate.applyActivityGate`。⚠ 放在**本入口自己的前置校验之后**（打捞器/探索/航路/残骸池）。
   */
  const gateSkip = applyActivityGate(state, 'salvaging')
  if (gateSkip) return gateSkip
  const s = state.salvaging
  s.active = true
  s.galaxyId = galaxyId
  s.phase = 'salvaging' // 去程取消：指令即视为已抵达，立即开始打捞
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  /** **打捞对象**（2026-09-26）：非法/无存量的对象一律回落"全部"（不拒开工） */
  s.targetGroup = salvageTargetOkOf(state, ctx, galaxyId, targetGroup) ? targetGroup : undefined
  s.autoCycle = s.autoCycle !== false // 偏好持久：默认开，除非玩家关过（旧档缺省 = 开）
  s.stopAfterTrip = s.stopAfterTrip === true
  // 船即时到目标星系：点亮探索（与采矿同口径；目标本就要求已探索，此处兜底）
  markExplored(state, galaxyId)
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const density = wreckDensityOf(state, galaxyId, ctx)
  const salvagers = salvagerCyclesOf(state, ctx, state.shipId).length
  const outSec = Math.max(1, Math.round(outboundLegMsFor(state, ctx, galaxyId) / 1000))
  const retSec = Math.max(1, Math.round(legMsFor(state, ctx, galaxyId) / 1000))
  const loopNote = s.stopAfterTrip
    ? ' 已勾选「本次返航卸货后停止」：卸完这一趟即收工。'
    : s.autoCycle
      ? ' 已启用自动循环：满舱自动返航卸货，卸完自动开始下一趟（可随时手动停止）。'
      : ' 自动循环已关闭：卸完这一趟即收工。'
  const loopNoteId = s.stopAfterTrip ? 'core.salvaging.012' : s.autoCycle ? 'core.salvaging.013' : 'core.salvaging.014'
  /**
   * 甲案·两步渲染：`loopNote` 是"自带 id 的派生串"⇒ 用 `p6Id` 把它的 id 一并交给渲染层
   * （`logText` 会先渲染 `p6Id` 再喂进外层文案的 `{p6}`）；`p6` 照传中文，作未改造路径的兜底。
   */
  addLog(
    state,
    'info',
    `开始打捞：${galaxy.name}（残骸密度 ${density.toFixed(1)}）。${shipName} 已抵达目标空域，立即开始持续打捞` +
      `（${salvagers} 台打捞器；满载返航约 ${retSec + outSec} 秒，去程时间已并入返航）。${loopNote}`,
    'core.salvaging.015',
    {
      p1: galaxy.name,
      p2: density.toFixed(1),
      p3: shipName,
      p4: salvagers,
      p5: retSec + outSec,
      p6: loopNote,
      p6Id: loopNoteId,
    },
  )
  /**
   * 甲案：`loopNote` 自带 id（三条互斥）⇒ 它**作为参数**喂给外层文案的 `{p6}`。
   * ⚠ 目前参数里塞的是**中文原串**（渲染层对参数不会再翻）⇒ 英文界面下这一小段仍是中文，
   * 这是**已知的过渡态**：等渲染层的 `cmdText/logText` 支持"参数里塞 id 再解析一次"后统一收口
   * （届时只需把这里换成 id，不动文案）。
   */
  void loopNoteId
  return { ok: true }
}

/** 打捞循环偏好 setter（UI 复选框用；联动与采矿同款） */
export function setSalvageAutoCycle(state: GameState, autoCycle: boolean): void {
  state.salvaging.autoCycle = autoCycle
  if (!autoCycle) state.salvaging.stopAfterTrip = false
}

export function setSalvageStopAfterTrip(state: GameState, stopAfterTrip: boolean): void {
  state.salvaging.stopAfterTrip = stopAfterTrip
  if (stopAfterTrip) state.salvaging.autoCycle = true
}

/** 手动停止（任何阶段；未返航的货物留在船上） */
export function stopSalvageOp(state: GameState, ctx: SimContext): boolean {
  /** 状态改动走 `state.ts` 的单点 `salvageHalt`（**进洞前自动停捞**也用它）⇒ 两条停捞路径不会各写一份 */
  const info = salvageHalt(state)
  if (info === null) return false
  const galaxy = info.galaxyId ? ctx.galaxies.get(info.galaxyId) : undefined
  const phaseNote =
    info.phase === 'returning' ? '（返航途中，货物留在船上）' : info.phase === 'outbound' ? '（出航途中）' : ''
  const phaseNoteId =
    info.phase === 'returning' ? 'core.mining.019' : info.phase === 'outbound' ? 'core.mining.020' : undefined
  addLog(
    state,
    'info',
    `已停止打捞（${galaxy?.name ?? ''}）。本趟共捞约 ${Math.round(info.tripM3 * 100) / 100} m³ 当量${phaseNote}。`,
    'core.salvaging.016',
    {
      p1: galaxy?.name ?? '',
      p2: Math.round(info.tripM3 * 100) / 100,
      p3: phaseNote,
      ...(phaseNoteId !== undefined ? { p3Id: phaseNoteId } : {}),
    },
  )
  return true
}

/** 打捞善后（换驾驶时引擎内部调用，2026-09-09 与采矿 retireMiningShip 同构）：
 * 把当前驾驶船正在进行的打捞转成"自动返航账本"（shipReturns，reason='salvage'）——
 * 打捞中 = 按货仓占比缩放的满载返航全长（去程并入）；返航中 = 继续剩余；
 * 旧档遗留出航相位按空船腿折算折返。到港由 advanceShipReturns 自动整仓卸货，
 * 打捞作业随之结束（autoCycle/stopAfterTrip 偏好跨趟保留，同采矿）。 */
export function retireSalvageShip(state: GameState, ctx: SimContext): boolean {
  const s = state.salvaging
  if (!s.active || !s.galaxyId) return false
  const galaxyId = s.galaxyId
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  // 打捞返航腿 = 满载返航 + 空船去程（去程并入返航，与 advanceSalvageOp 返航腿同口径）
  const fullLeg = legMsFor(state, ctx, galaxyId) + outboundLegMsFor(state, ctx, galaxyId)
  const legMs = scaledReturnMs(fullLeg, state, ctx, state.shipId)
  const phaseAccMs =
    s.phase === 'outbound'
      ? Math.min(legMs, s.phaseAccMs * 2) // 旧档遗留出航腿为空船半程：折返按 2×折算已走（同采矿）
      : s.phase === 'returning'
        ? s.phaseAccMs
        : 0
  const oldShip = state.fleet[state.shipId]
  const haveCargo = oldShip ? Object.keys(oldShip.cargo).some((k) => (oldShip.cargo[k] ?? 0) > 0) : false
  state.shipReturns[state.shipId] = {
    beltId: null,
    legMs: Math.max(1, legMs),
    phaseAccMs: Math.min(legMs, Math.max(0, phaseAccMs)),
    reason: 'salvage',
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const remainSec = Math.max(0, Math.round((legMs - phaseAccMs) / 1000))
  // 结束作业（偏好字段 autoCycle/stopAfterTrip 保留，供下次作业沿用）
  resetOp(state)
  addLog(
    state,
    'info',
    `打捞已随换船结束：${shipName} 从「${galaxyName}」自动返航空间站${haveCargo ? '（到港整仓卸货）' : ''}——约 ${remainSec} 秒后到港。`,
    'core.salvaging.017',
    {
      p1: shipName,
      p2: galaxyName,
      p3: haveCargo ? '（到港整仓卸货）' : '',
      ...(haveCargo ? { p3Id: 'core.salvaging.018' } : {}),
      p4: remainSec,
    },
  )
  return true
}

/**
 * 完好舰体命中率（卷B3⑨，2026-09-08 船长定稿：概率按"该打捞轮占用的分钟数"换算——
 * 与富矿脉⑥同哲学：以分钟为纲，掷点节奏不受打捞器数量/周期与 AI 效率影响）：
 * p = min(1, 轮占分钟 × balance.intactHullRatePerMin × 1.2^级)。
 * 命中 = 当场直发敌群回收彩头（rollIntactHullLoot；旧"当轮体积 ×2"已移除）。
 * 0 = 禁用（测试用它关完好舰体保 rng 时序）。
 */
export function assayChanceOf(state: GameState, ctx: SimContext, cycleMsReal: number): number {
  const lv = Math.min(5, state.skills.trained['wreck-assaying'] ?? 0)
  return Math.min(1, (Math.max(0, cycleMsReal) / 60_000) * ctx.balance.intactHullRatePerMin * Math.pow(1.2, lv))
}

/**
 * **打捞一轮出什么**：抽该星系敌群型号池一只（威胁加权）→ 体积当量系数（含放干扣减）
 * → 返回 `{ itemId, volumeM3 }`；星系无型号池返回 null。放货入舱由调用方按剩余舱容裁决
 * （放不下 = 满仓返航）。`cycleMsReal`：该台打捞器本轮真实周期毫秒（完好舰体命中率按分钟语义换算用）。
 * 主控作业与 AI 任务共用本函数。
 *
 * **优先级 = 三级序**（**2026-09-26 船长裁定原话**：「**优先捞稀有池，稀有池捞完后开始普通池。
 * 同池内，入侵残骸优先。**」）：
 *
 * 1. **稀有池**（`state.galaxyWrecks[星系].rare / rareBy`）：有存量 ⇒ **本轮必出一件稀有残骸**
 *    （固定 `RARE_WRECK_VOLUME_M3` = 30 m³ × 倍率，**不吃 `mul`**，且**两池一个都不扣**——见下面那支的长注）；
 * 2. **普通池**（星系密度 `density` ＋ 入侵残骸场 `weekendWrecks`）：
 *    ⓐ **同池内入侵残骸优先** —— 入侵残骸场有效密度 > 0 ⇒ 只从**入侵独立卡**（`hidden` 的那批）里抽
 *      （`autoTargetPickOf` 第 ① 条；"入侵残骸"= 夺回奖励/旗舰战利品落在该星系的那本账，48h 线性衰减）；
 *    ⓑ 否则 ⇒ **按各组存量的数量比同步抽** —— 先按 `byGroup` 份额抽组、再在该组内按威胁加权抽卡
 *      （`autoTargetPickOf` 第 ② 条；无分组账的老档 ⇒ 回落整池按威胁加权）；
 * 3. 两池皆空 ⇒ 本轮**不出货**（作业空转，不报错）。
 *
 * ⚠ **"入侵残骸"有两个同名不同物的概念，别串**（2026-09-26 记）：
 * - **本文所说的"入侵残骸"= 入侵残骸场那本账**（`state.weekendWrecks`，夺回奖励与旗舰战利品落在该星系，
 *   48h 线性衰减，池内 = `hidden` 的入侵独立卡）⇒ 有存量时**优先、且不参与组比**；
 * - **另一个是残骸的「入侵」地区类别**（`WreckRegion` 的 `inv`，2026-09-26 船长令「H 族残骸不分高安低安，
 *   统一为入侵残骸」）⇒ 那是**组的一个地区档**，走**本函数第 ⓑ 条**（按各组数量比），与上面那本账无关。
 *
 * ⚠ **稀有池不参与"组比"**：它是"捞完为止"的**必得池**，不是按比例分摊的一档——这正是船长这条裁定的要点
 * （改前那版曾把稀有残骸当成"跟着打捞对象走"的一档，现口径以本条为准）。
 * ⚠ **船长的三级序与实现逐字相同**（本轮只做口径注释 ＋ 用例名对齐，**零行为改动**）；
 * 日后若有人要动这里，先读本段。
 */
export function pullOneWreck(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  cycleMsReal: number,
): { itemId: string; mul: number; volumeM3: number } | null {
  /**
   * **打捞对象**（**2026-09-26 船长令**）：作业上带着它（`SalvageOpState.targetGroup`）。
   * - 选了某一组而**该组已捞干** ⇒ **本轮不出**（不自动换组——手动选的语义就是"只捞它"）；
   * - 缺省 = 全部（现状：按威胁加权抽、先扣入侵池）。
   */
  const target = state.salvaging.targetGroup
  if (target !== undefined && wreckGroupStockOf(state, ctx, galaxyId, target) <= 0.05) return null
  // ① **稀有池优先**（三级序第 1 档；2026-09-10 船长定"窝点战利品必捞"· 2026-09-26 复述
  //    「优先捞稀有池，稀有池捞完后开始普通池」）：稀有池有存量 ⇒ 本轮必出稀有，**捞干后**才轮到普通池。
  //    ⚠ **打捞对象只管普通池内部**（手选组 / 手选入侵都不影响稀有池——稀有残骸是窝点与派系活跃的战利品，
  //    与所选组无关；该分支里的 `target` 只为"按组归族"取像，不改变"稀有必出"）。
  const rareId = pullRareWreck(state, galaxyId, ctx, target)
  if (rareId) {
    /**
     * **稀有轮不吃普通池放干**（**2026-09-25 玩家报障修复**）。
     *
     * 船长转述：「**当星系的残骸里有稀有残骸时，打捞稀有残骸会同时消耗普通残骸，
     * 但是没有回收普通残骸**」——原实现这一支照样调了 `salvageRoundPull`：它按"本轮出普通残骸"
     * 的口径扣了 2% 放干（并顺带扣了入侵池），可这一轮的产出被替换成稀有残骸（固定 30 m³ × 倍率，
     * 不吃 mul）⇒ **扣了不给**，普通池白掉一截。
     *
     * 现按**甲案**修：稀有轮只取读数（`salvageRoundMulOf`，纯读），**两池一个都不扣**；
     * 稀有捞完、回常规池的那一轮起，放干照旧（口径见 `salvage.salvageRoundPull`）。
     */
    const mulRare = salvageRoundMulOf(state, ctx, galaxyId)
    return { itemId: rareId, mul: mulRare, volumeM3: RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume') }
  }
  const pool = wreckPoolOf(ctx, galaxyId, state, Date.now(), target) // 同源池 ＋ **按打捞对象过滤**（2026-09-26）
  if (pool.length === 0) return null
  // 2026-09-12 审计 B3：改走单点 `pickWeighted`（按威胁加权；原累加循环 `roll <= acc` 即 `lte` 口径）；
  // 无中选兜底 = 池首（与改前 `chosen = pool[0]` 初值一致）
  /** **自动判定对象**（2026-09-26 船长令）：手选入口已撤，缺省这一支就是主路径 */
  const chosen =
    (target === undefined ? autoTargetPickOf(state, ctx, galaxyId, pool) : null) ??
    pickWeighted(state.rng, pool, (p) => p.threat, { bound: 'lte' }) ??
    pool[0]!
  // 2026-09-19 合并：产出物 = 该卡**所属组**的残骸（`wreck-<组 key>`）；组查不到 = 未知卡 ⇒ 不产出
  const group = wreckGroupOfCard(chosen.anomalyId, ctx)
  if (!group) return null
  const mul = salvageRoundPull(state, ctx, galaxyId, target)
  const wreckId = wreckItemIdOf(group.key)
  // 乙案（2026-09-05）：残骸计数 = 体积（m³）——型号威胁决定单份体积量级（威胁×0.06），
  // 本轮入舱 m³ = 单份 × 密度系数；item unitM3 = 1，数量即体积。
  const baseM3 = Math.max(0.1, Math.round(Math.max(1, chosen.threat) * WRECK_VOLUME_PER_THREAT * 100) / 100)
  // 残骸富集识别学（wreck-assaying，卷B3⑨）：完好舰体命中 → 当场直发该**组**回收彩头
  // （不再折算体积）；判定恒消耗一次随机数保 rng 时序（rate=0 时也掷）
  if (nextRandom(state.rng) < assayChanceOf(state, ctx, cycleMsReal)) {
    const gains = rollIntactHullLoot(state, ctx, chosen.anomalyId)
    if (gains) addLog(state, 'info', `完好舰体！${gains}。`, 'core.salvaging.019', { p1: gains })
  }
  // 漂流物打捞学（salvage-diving，2026-09-05）：残骸打捞量每级 +12%（主控与 AI 同享）
  const diveLv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  /**
   * 2026-09-19 船长：「为了平衡价值，可以提高更危险地区的残骸出量。」
   * ⇒ **出量梯度**按**打捞星系的回收档**乘（不是按残骸身份）——合并把同组各卡的每 m³ 价值拉平后，
   * 危险度差异由"每轮捞多少 m³"承担（常量 `WRECK_YIELD_TIER_MUL`：常 1.00 / 险 1.15 / 危 1.20）。
   */
  const yieldMul = wreckYieldMultiplierOf(recycleTierOf(wreckBaseDensity(galaxyId, ctx)))
  const volumeM3 = baseM3 * mul * (1 + 0.12 * diveLv) * yieldMul
  return { itemId: wreckId, mul, volumeM3 }
}

/**
 * 引擎内部：按流逝时间推进打捞状态机（即时打捞 → 满仓返航（去程并入）→ 到港卸货结束）。
 * 剩余时间管理器与采矿同构：时间按阶段逐段消费，一次大推进可完整穿越全程。
 */
export function advanceSalvageOp(state: GameState, deltaMs: number, ctx: SimContext): void {
  const s = state.salvaging
  if (!s.active || deltaMs <= 0) return
  if (!state.fleet[state.shipId]) {
    resetOp(state)
    addLog(state, 'warn', '找不到当前舰船，打捞作业已停止。', 'core.salvaging.020')
    return
  }
  let remaining = deltaMs
  let guard = 0
  while (s.active && remaining > 0) {
    if (++guard > 100_000) break // 防失控（离线大步长多循环）
    const galaxyId = s.galaxyId
    if (!galaxyId) {
      resetOp(state)
      addLog(state, 'warn', '找不到打捞目标星系，作业已停止。', 'core.salvaging.021')
      return
    }
    // ── 返航阶段（去程并入返航；返航腿按货仓占比缩放——空仓快、满仓=原时长，船长 2026-09-05）──
    if (s.phase === 'outbound' || s.phase === 'returning') {
      const outFull = outboundLegMsFor(state, ctx, galaxyId)
      const leg =
        s.phase === 'outbound'
          ? outFull
          : scaledReturnMs(legMsFor(state, ctx, galaxyId) + outFull, state, ctx, state.shipId)
      const need = leg - s.phaseAccMs
      if (remaining < need) {
        s.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      s.phaseAccMs = 0
      if (s.phase === 'returning') {
        const moved = unloadCargoToWarehouse(state)
        const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
        addLog(
          state,
          'info',
          `打捞自动返港：${galaxyName} 残骸已卸入物品仓库（共 ${moved.toLocaleString('zh-CN')} m³ 当量）。`,
          'core.salvaging.022',
          { p1: galaxyName, p2: moved.toLocaleString('zh-CN') },
        )
        // 按设定收工（勾了「本次返航卸货后停止」/ 关闭自动循环）；否则卸完直接同星系续捞
        if (s.stopAfterTrip || s.autoCycle === false) {
          addLog(
            state,
            'info',
            s.stopAfterTrip ? '自动循环已结束（按设定返港后停止）。' : '本次打捞结束（未开启自动循环）。',
            s.stopAfterTrip ? 'core.salvaging.023' : 'core.salvaging.024',
          )
          resetOp(state)
          break
        }
        // 自动循环：去程已并入刚完成的返航腿 → 卸完直接恢复打捞（无出航相位，与采矿同构）
        s.phase = 'salvaging'
        s.cycleAccMs = 0
        s.tripM3 = 0
        s.deviceAccMs = {}
        continue
      }
      // 旧档遗留的出航相位到点：抵达目标星系（点亮探索）后直接打捞
      markExplored(state, galaxyId)
      s.phase = 'salvaging'
      s.cycleAccMs = 0
      continue
    }

    // ── 打捞阶段：逐台打捞器按各自周期结算 ──
    if (wreckPoolOf(ctx, galaxyId, state, Date.now()).length === 0) {
      resetOp(state)
      addLog(state, 'warn', '该星系的敌群情报缺失，打捞作业已停止。', 'core.salvaging.025')
    }
    const cycles = salvagerCyclesOf(state, ctx, state.shipId)
    if (cycles.length === 0) {
      resetOp(state)
      addLog(state, 'warn', '未找到可用的打捞器，打捞作业已停止。', 'core.salvaging.026')
      return
    }
    // 最短周期为统一推进步（多台各自维护相位）
    const stepMs = Math.min(...cycles)
    if (s.cycleAccMs < stepMs) {
      const need = stepMs - s.cycleAccMs
      const take = Math.min(remaining, need)
      s.cycleAccMs += take
      remaining -= take
      if (s.cycleAccMs < stepMs) break
    }
    s.cycleAccMs = 0
    for (const cycleMs of cycles) {
      const key = String(cycleMs)
      s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) + stepMs
      while ((s.deviceAccMs[key] ?? 0) >= cycleMs) {
        s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) - cycleMs
        const pulled = pullOneWreck(state, ctx, galaxyId, cycleMs)
      if (pulled) bumpFirst(state, 'salvageRuns') // 第一次任务/链：打捞次数
        if (!pulled) {
          resetOp(state)
          addLog(state, 'warn', '该星系的敌群情报缺失，打捞作业已停止。', 'core.salvaging.025')
          return
        }
        const freeM3 = freeCargoM3(state, ctx)
        if (pulled.volumeM3 > freeM3) {
          // 满仓（下一轮放不下）：自动返航（去程并入返航，总行程时间不变）
          s.phase = 'returning'
          s.phaseAccMs = 0
          const mergedSec = Math.round((legMsFor(state, ctx, galaxyId) + outboundLegMsFor(state, ctx, galaxyId)) / 1000)
          addLog(
            state,
            'info',
            `货仓装不下下一轮打捞（余 ${Math.round(freeM3)} m³ ／ 每轮 ${Math.round(pulled.volumeM3)} m³）：自动返航卸货（本趟约 ${Math.round(s.tripM3 * 100) / 100} m³，约 ${mergedSec} 秒，去程已并入返航）。`,
            'core.salvaging.027',
            {
              p1: Math.round(freeM3),
              p2: Math.round(pulled.volumeM3),
              p3: Math.round(s.tripM3 * 100) / 100,
              p4: mergedSec,
            },
          )
          break
        }
        addItem(state, pulled.itemId, pulled.volumeM3) // 计数 = 体积（m³）
        s.tripM3 += pulled.volumeM3
      }
      if (s.phase === 'returning') break
    }
  }
}

function resetOp(state: GameState): void {
  const s = state.salvaging
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  s.targetGroup = undefined
}
