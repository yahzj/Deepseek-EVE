/**
 * 长途运输（2026-09-09 船长定稿：docs/design/announcement-draft-20260909 之外的新玩法）：
 * 玩家驾驶船在两座「已建成」站点（母港 ⇄ 副站 / 副站 ⇄ 副站）之间做真实航程的往返运输，
 * 循环自动续跑（与悬赏「重复清剿」同款体验），可随时"到站即停"。
 *
 * - 航行 = 真实航程：每段都按 travelLegMs 实际飞行（吃航行技能；调试模式 1 秒/段），
 *   不做"去程并入返程"式折算（船长定）。
 * - 货物为**虚拟满载**：开始任务时把驾驶船货仓自动卸空入仓库，任务期间货仓容量被"运输货物"
 *   全部占用（不产生任何真实物品，杜绝货物入库类 bug）；到站结算报酬后自动续下一段。
 * - 报酬 = 货仓容量 × 费率 × 本段航程分钟（R=HAUL_RATE_PER_M3_MIN，费率常量可调）：
 *   与航程线性挂钩 → 任意航线每小时收益 ≈ 容量×费率×60，不存在"挑最短线刷钱"。
 * - **2026-09-11 船长改口径（「在跑长途运输时候，所需时间提高，收益也提高」）**：
 *   ① 航段分钟 **×15**（`HAUL_LEG_TIME_MUL`，含"就位段"）——真实飞行时长随之 ×15，玩家看到的面板时间/日志一并变；
 *   ② 费率 0.6 → **0.4**，使**单段收益 = 改前的 ×10**（`容量×0.4×新分钟 = 10 × 容量×0.6×旧分钟`）。
 *   推论：**时薪由 36×容量 降为 24×容量（= 改前的 2/3）**；"与航程线性挂钩、不存在挑短线刷钱"仍成立，
 *   但旧口径"费率 0.6 = 与同船采矿大致同量级"**已作废**——按新费率实测（母港丰饶之环·富凡晶石 13 ISK/单位）：
 *   沙猫级 采矿 ≈ 3.9 万 ISK/时 vs 运输 ≈ 1.92 万（≈0.5×）；蝠鲼级重载货舰 采矿 ≈ 14.3 万 vs 运输 ≈ 62.4 万（≈4.4×）。
 *   航行技能照旧缩短实际时长（`travelMinutesEff`；现下限系数 0.35 ⇒ 105 分钟的实际下限约 37 分钟）。
 * - 互斥：任务中驾驶船忙碌（等同远征），各出港/站内手动作业入口拒绝；换驾驶 = 立即终止
 *   （虚拟货无残留、无惩罚）；AI 副船本版不支持。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { CommandResult } from './engine'
import type { GameState, HaulingState } from './state'
import type { SimContext } from './types'
import { shortestTravelMinutes, travelLegMs, travelMinutesEff } from './travel'
import { cargoCapacityM3Of, unloadCargoOfShipToWarehouse } from './inventory'
import { siteProgress } from './station'
import { shipDisplayName } from './instances'

/**
 * 运输报酬费率：ISK / (m³ × 航程分钟)。
 * 2026-09-11 船长改口径：航段时间 ×15（见 `HAUL_LEG_TIME_MUL`）、单段收益 ×10 ⇒ 费率 0.6 → **0.4**
 * （0.6 × 10/15 = 0.4，正好把"收益 ×10"落在新航时上）。旧注"0.6 = 与同船采矿大致同量级"已作废。
 */
export const HAUL_RATE_PER_M3_MIN = 0.4

/**
 * 航段时间倍率（2026-09-11 船长：「所需时间提高」）——标称航程分钟 ×本值 = 实际航段分钟。
 * 与费率（0.6→0.4）配套：单段收益 = 改前 ×10，时薪 = 改前 ×(10/15) = 2/3。
 */
export const HAUL_LEG_TIME_MUL = 15

/** 标称航程分钟 → 运输航段分钟（×`HAUL_LEG_TIME_MUL`，至少 1 分钟；面板/引擎同用这一处口径） */
export function haulLegMinutesOf(nominalMinutes: number): number {
  return Math.max(1, Math.round(nominalMinutes * HAUL_LEG_TIME_MUL))
}

/** 站点端点（id = null 表示母港） */
export interface HaulEndpoint {
  siteId: string | null
  name: string
  galaxyId: string
}

/** 母港端点 */
const HOME_ENDPOINT: HaulEndpoint = { siteId: null, name: '母港', galaxyId: HOME_GALAXY_ID }

/** 全部"已建成"站点端点（母港 + 已建成副站；未建成不参与，沿用收口口径） */
export function haulEndpoints(state: GameState, ctx: SimContext): HaulEndpoint[] {
  const out: HaulEndpoint[] = [HOME_ENDPOINT]
  for (const site of ctx.stations.values()) {
    const prog = siteProgress(state, site.id)
    if (!prog || prog.stage < site.tiers.length) continue
    out.push({ siteId: site.id, name: site.name, galaxyId: site.galaxyId })
  }
  return out
}

/** 端点显示名（null = 母港） */
export function haulEndpointName(ctx: SimContext, siteId: string | null): string {
  if (siteId === null) return '母港'
  return ctx.stations.get(siteId)?.name ?? '空间站'
}

/** 端点所在星系 */
function endpointGalaxy(ctx: SimContext, siteId: string | null): string {
  if (siteId === null) return HOME_GALAXY_ID
  return ctx.stations.get(siteId)?.galaxyId ?? HOME_GALAXY_ID
}

/** 当前停靠的端点（未停靠任何空间站 = null） */
export function dockedHaulEndpoint(state: GameState): string | null {
  if (state.awayGalaxy !== null) return null // 野外
  return state.dockedSite // null = 母港；否则副站 id
}

/** 单段报酬估算（容量 × 费率 × 标称分钟；floor 取整） */
export function haulLegReward(capacityM3: number, legMinutes: number): number {
  return Math.floor(capacityM3 * HAUL_RATE_PER_M3_MIN * legMinutes)
}

/** 展示/日志用的实际航程分钟（吃航行技能与调试快进；四舍五入 ≥1） */
function effMinutesOf(state: GameState, ctx: SimContext, nominalMinutes: number): number {
  return Math.max(1, Math.round(travelMinutesEff(state, ctx, nominalMinutes)))
}

/** 空态 */
function emptyHauling(): HaulingState {
  return { active: false, routeA: null, routeB: null, fromSiteId: null, toSiteId: null, legMinutes: 0, legMs: 0, phaseAccMs: 0 }
}

/** 端点所在星系（null = 母港） */


/** 两站间标称航程分钟（不可达/同点 = 0） */
function minutesBetween(ctx: SimContext, aId: string | null, bId: string | null): number {
  const m = shortestTravelMinutes(ctx, endpointGalaxy(ctx, aId), endpointGalaxy(ctx, bId))
  return Number.isFinite(m) ? m : 0
}

/** 设定当前航段（from → to）：锁分钟与真实毫秒 */
function setLeg(state: GameState, ctx: SimContext, fromId: string | null, toId: string | null): boolean {
  const minutes = minutesBetween(ctx, fromId, toId)
  if (!(minutes > 0)) return false
  const h = state.hauling
  h.fromSiteId = fromId
  h.toSiteId = toId
  h.legMinutes = haulLegMinutesOf(minutes)
  h.legMs = Math.max(1, travelLegMs(state, ctx, h.legMinutes))
  h.phaseAccMs = 0
  state.dockedSite = null
  state.awayGalaxy = endpointGalaxy(ctx, fromId)
  return true
}

/**
 * 玩家指令：开始长途运输（在所选航线的两个端点间往返循环）。
 * 2026-09-09 改（船长定）：**不要求停靠在航线端点**——停靠在任意协会站点即可接单；
 * 若当前停靠不在端点，先飞一段"就位航段"到较近端点（真实航程、按段计酬），随后按
 * A⇄B 循环。须停靠空间站（母港或已建成副站；野外不能接）。
 */
export function startHauling(state: GameState, aSiteId: string | null, bSiteId: string | null, ctx: SimContext): CommandResult {
  if (state.hauling.active) return { ok: false, error: '长途运输进行中：先停止（顶部活动栏）再换线。' }
  // 前置：停靠在空间站（母港或已建成副站）
  if (state.awayGalaxy !== null) return { ok: false, error: '舰船在野外：先返航到空间站再安排长途运输。' }
  const endpoints = haulEndpoints(state, ctx)
  const a = endpoints.find((e) => e.siteId === aSiteId)
  const b = endpoints.find((e) => e.siteId === bSiteId)
  if (!a || !b) return { ok: false, error: '航线端点缺失或尚未建成——请选择两座已建成站点之间的航线。' }
  if (a.siteId === b.siteId) return { ok: false, error: '航线两端相同——请选两座不同的站点。' }
  if (minutesBetween(ctx, a.siteId, b.siteId) <= 0) {
    return { ok: false, error: '这两座站点之间没有可用航路（或同处一星系），无法运输。' }
  }
  // 忙碌互斥（与远征同级）
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：先停止开采。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业进行中：先停止打捞。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中：先召回或等待结束。' }
  if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：先取消。' }
  if (state.transit.active) return { ok: false, error: '返航行程中：到站后再安排。' }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：到站结算后再安排。' }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出航。' }
  }
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '制造作业正由你亲自开线：先取消它才能出航。' }
  }
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  if (cap <= 0) return { ok: false, error: '当前舰船没有可用货仓，无法承运。' }
  // 自动清仓：真实货物卸入仓库（虚拟货物占满货仓，语义干净）
  const unloaded = unloadCargoOfShipToWarehouse(state, state.shipId)
  const dockHere = dockedHaulEndpoint(state) // 接单时的停靠端点（可能是航线端点，也可能不是）
  // 第一段目标：停靠即端点 → 直接对开；否则飞往较近的端点（就位段）
  let firstTo: string | null
  if (dockHere === a.siteId || dockHere === b.siteId) {
    firstTo = dockHere === a.siteId ? b.siteId : a.siteId
  } else {
    const toA = minutesBetween(ctx, dockHere, a.siteId)
    const toB = minutesBetween(ctx, dockHere, b.siteId)
    if (!(toA > 0) && !(toB > 0)) return { ok: false, error: '当前停靠点不在协会航线网内，无法接单。' }
    firstTo = toB > 0 && (toA <= 0 || toB < toA) ? b.siteId : a.siteId
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const h = state.hauling
  h.active = true
  h.routeA = a.siteId
  h.routeB = b.siteId
  if (!setLeg(state, ctx, dockHere, firstTo)) {
    h.active = false
    return { ok: false, error: '无法从当前位置就位到该航线——航路不可达。' }
  }
  const perLeg = haulLegReward(cap, h.legMinutes)
  const isPos = dockHere !== a.siteId && dockHere !== b.siteId
  addLog(
    state,
    'info',
    `长途运输开始：${shipName} 承运「${a.name} ⇄ ${b.name}」（货仓 ${cap.toLocaleString('zh-CN')} m³ 满载虚拟货物）` +
      (isPos ? `——先就位驶往「${haulEndpointName(ctx, firstTo)}」` : `——单段航程约 ${effMinutesOf(state, ctx, h.legMinutes)} 分钟`) +
      `，到站结算报酬约 ${perLeg.toLocaleString('zh-CN')} ISK${unloaded > 0 ? `；船上原有货物已卸入仓库（${unloaded} 单位）` : ''}。`,
  )
  return { ok: true }
}

/** 玩家指令：停止长途运输（立即响应：中止当前航段并**即时返港停靠出发站**，无需返程时间；无惩罚） */
export function stopHauling(state: GameState, ctx: SimContext): CommandResult {
  const h = state.hauling
  if (!h.active) return { ok: false, error: '没有进行中的长途运输。' }
  const originId = h.fromSiteId // 本段出发站（null = 母港）
  const originName = haulEndpointName(ctx, originId)
  h.active = false
  h.routeA = null
  h.routeB = null
  h.fromSiteId = null
  h.toSiteId = null
  h.legMinutes = 0
  h.legMs = 0
  h.phaseAccMs = 0
  // 2026-09-09（船长定）：终止即瞬时返港——不再安排真实折返航程，船直接停靠回出发站
  state.awayGalaxy = null
  state.dockedSite = originId === null ? null : originId
  addLog(state, 'info', `长途运输已停止：舰船已即时返港停靠「${originName}」（无惩罚）。`)
  return { ok: true }
}

/** 引擎内部：推进长途运输（真实航程腿逐段飞行 → 到站结算 → 按所选航线自动续段） */
export function advanceHauling(state: GameState, deltaMs: number, ctx: SimContext): void {
  const h = state.hauling
  if (!h.active || deltaMs <= 0) return
  let remaining = deltaMs
  while (h.active && remaining > 0) {
    const need = Math.max(1, h.legMs - h.phaseAccMs)
    const step = Math.min(remaining, need)
    h.phaseAccMs += step
    remaining -= step
    if (h.phaseAccMs >= h.legMs) {
      const arrived = haulEndpointName(ctx, h.toSiteId)
      const cap = cargoCapacityM3Of(state, ctx, state.shipId)
      const reward = haulLegReward(cap, h.legMinutes)
      state.wallet.isk += reward
      addLog(
        state,
        'trade',
        `长途运输 · 已运抵「${arrived}」：报酬 ${reward.toLocaleString('zh-CN')} ISK 已入账（货仓 ${cap.toLocaleString('zh-CN')} m³ · 实际航程约 ${effMinutesOf(state, ctx, h.legMinutes)} 分钟）。`,
      )
      // 到站（母港 = dockedSite null；随后立即续下一段）
      state.awayGalaxy = null
      state.dockedSite = h.toSiteId === null ? null : h.toSiteId
      const at = h.toSiteId
      const nextTo = at === h.routeA ? h.routeB : h.routeA
      if (!setLeg(state, ctx, at, nextTo)) {
        // 航线异常（端点不可达等防御）：就地结束并提示
        h.active = false
        addLog(state, 'warn', `长途运输异常终止：舰船停靠在「${arrived}」（航线端点不可达）。`)
        break
      }
      const departTo = haulEndpointName(ctx, h.toSiteId)
      addLog(state, 'info', `长途运输继续：已装载前往「${departTo}」（虚拟货物，货仓占满）。`)
    }
  }
}

/** 引擎内部：换驾驶时终止长途运输（虚拟货无残留、无惩罚；不额外安排返航——旧船停靠位置即结束） */
export function cancelHaulingOnSwitch(state: GameState, ctx: SimContext): void {
  if (!state.hauling.active) return
  const wasTo = haulEndpointName(ctx, state.hauling.toSiteId)
  state.hauling = emptyHauling()
  state.dockedSite = null
  state.awayGalaxy = null
  addLog(state, 'info', `长途运输已随切换驾驶终止（原航线「… → ${wasTo}」；虚拟货物无残留、无惩罚）。`)
}

/** 引擎内部：长途运输期间驾驶船被虚拟货物占用的货仓容积（其余时刻 0；UI 展示"已用/剩余"用） */
export function haulingOccupiedM3(state: GameState, ctx: SimContext): number {
  if (!state.hauling.active) return 0
  return cargoCapacityM3Of(state, ctx, state.shipId)
}
