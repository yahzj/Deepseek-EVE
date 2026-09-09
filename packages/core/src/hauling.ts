/**
 * 运输任务（2026-09-09 船长定稿：docs/design/announcement-draft-20260909 之外的新玩法）：
 * 玩家驾驶船在两座「已建成」站点（母港 ⇄ 副站 / 副站 ⇄ 副站）之间做真实航程的往返运输，
 * 循环自动续跑（与悬赏「重复清剿」同款体验），可随时"到站即停"。
 *
 * - 航行 = 真实航程：每段都按 travelLegMs 实际飞行（吃航行技能；调试模式 1 秒/段），
 *   不做"去程并入返程"式折算（船长定）。
 * - 货物为**虚拟满载**：开始任务时把驾驶船货仓自动卸空入仓库，任务期间货仓容量被"运输货物"
 *   全部占用（不产生任何真实物品，杜绝货物入库类 bug）；到站结算报酬后自动续下一段。
 * - 报酬 = 货仓容量 × 费率 × 本段标称航程分钟（R=HAUL_RATE_PER_M3_MIN，费率常量可调）：
 *   与航程线性挂钩 → 任意航线每小时收益 ≈ 容量×费率×60，不存在"挑最短线刷钱"。
 * - 互斥：任务中驾驶船忙碌（等同远征），各出港/站内手动作业入口拒绝；换驾驶 = 立即终止
 *   （虚拟货无残留、无惩罚）；AI 副船本版不支持。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { CommandResult } from './engine'
import type { GameState, HaulingState } from './state'
import type { SimContext } from './types'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { cargoCapacityM3Of, unloadCargoOfShipToWarehouse } from './inventory'
import { siteProgress } from './station'
import { shipDisplayName } from './instances'

/** 运输报酬费率：ISK / (m³ × 标称航程分钟)。0.6 = 与同船采矿大致同量级（船长选"与现有作业相当"档） */
export const HAUL_RATE_PER_M3_MIN = 0.6

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
  h.legMinutes = Math.max(1, Math.round(minutes))
  h.legMs = Math.max(1, travelLegMs(state, ctx, h.legMinutes))
  h.phaseAccMs = 0
  state.dockedSite = null
  state.awayGalaxy = endpointGalaxy(ctx, fromId)
  return true
}

/**
 * 玩家指令：开始运输任务（在所选航线的两个端点间往返循环）。
 * 2026-09-09 改（船长定）：**不要求停靠在航线端点**——停靠在任意协会站点即可接单；
 * 若当前停靠不在端点，先飞一段"就位航段"到较近端点（真实航程、按段计酬），随后按
 * A⇄B 循环。须停靠空间站（母港或已建成副站；野外不能接）。
 */
export function startHauling(state: GameState, aSiteId: string | null, bSiteId: string | null, ctx: SimContext): CommandResult {
  if (state.hauling.active) return { ok: false, error: '运输任务进行中：先停止（顶部活动栏）再换线。' }
  // 前置：停靠在空间站（母港或已建成副站）
  if (state.awayGalaxy !== null) return { ok: false, error: '舰船在野外：先返航到空间站再安排运输任务。' }
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
    `运输任务开始：${shipName} 承运「${a.name} ⇄ ${b.name}」（货仓 ${cap.toLocaleString('zh-CN')} m³ 满载虚拟货物）` +
      (isPos ? `——先就位驶往「${haulEndpointName(ctx, firstTo)}」` : `——单段航程约 ${h.legMinutes} 分钟`) +
      `，到站结算报酬约 ${perLeg.toLocaleString('zh-CN')} ISK${unloaded > 0 ? `；船上原有货物已卸入仓库（${unloaded} 单位）` : ''}。`,
  )
  return { ok: true }
}

/** 玩家指令：停止运输任务（立即停止：中止当前航段并返航出发站；无惩罚、无战利品残留） */
export function stopHauling(state: GameState, ctx: SimContext): CommandResult {
  const h = state.hauling
  if (!h.active) return { ok: false, error: '没有进行中的运输任务。' }
  const originName = haulEndpointName(ctx, h.fromSiteId)
  const originGalaxy = endpointGalaxy(ctx, h.fromSiteId)
  // 返航所需时间 = 本段已飞时间（回程掉头折返；至少 1 秒）
  const backMs = Math.max(1_000, h.phaseAccMs)
  h.active = false
  h.routeA = null
  h.routeB = null
  h.fromSiteId = null
  h.toSiteId = null
  h.legMinutes = 0
  h.legMs = 0
  h.phaseAccMs = 0
  // 折返航程交给返航行程推进（真实航程，到港自动停靠/卸货语义沿用）
  const t = state.transit
  t.active = true
  t.fromGalaxy = null
  t.toGalaxy = originGalaxy
  t.finishAtGameMs = state.gameMs + backMs
  t.legMs = backMs
  t.delivery = null
  state.awayGalaxy = null
  const mins = Math.max(1, Math.round(backMs / 60_000))
  addLog(state, 'info', `运输任务已停止：舰船立即返航「${originName}」（约 ${mins} 分钟到站，无惩罚）。`)
  return { ok: true }
}

/** 引擎内部：推进运输任务（真实航程腿逐段飞行 → 到站结算 → 按所选航线自动续段） */
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
        `运输任务 · 已运抵「${arrived}」：报酬 ${reward.toLocaleString('zh-CN')} ISK 已入账（货仓 ${cap.toLocaleString('zh-CN')} m³ · 航程约 ${Math.max(1, Math.round(h.legMinutes))} 分钟）。`,
      )
      // 到站（母港 = dockedSite null；随后立即续下一段）
      state.awayGalaxy = null
      state.dockedSite = h.toSiteId === null ? null : h.toSiteId
      const at = h.toSiteId
      const nextTo = at === h.routeA ? h.routeB : h.routeA
      if (!setLeg(state, ctx, at, nextTo)) {
        // 航线异常（端点不可达等防御）：就地结束并提示
        h.active = false
        addLog(state, 'warn', `运输任务异常终止：舰船停靠在「${arrived}」（航线端点不可达）。`)
        break
      }
      const departTo = haulEndpointName(ctx, h.toSiteId)
      addLog(state, 'info', `运输任务继续：已装载前往「${departTo}」（虚拟货物，货仓占满）。`)
    }
  }
}

/** 引擎内部：换驾驶时终止运输任务（虚拟货无残留、无惩罚；不额外安排返航——旧船停靠位置即结束） */
export function cancelHaulingOnSwitch(state: GameState, ctx: SimContext): void {
  if (!state.hauling.active) return
  const wasTo = haulEndpointName(ctx, state.hauling.toSiteId)
  state.hauling = emptyHauling()
  state.dockedSite = null
  state.awayGalaxy = null
  addLog(state, 'info', `运输任务已随切换驾驶终止（原航线「… → ${wasTo}」；虚拟货物无残留、无惩罚）。`)
}

/** 引擎内部：运输任务期间驾驶船被虚拟货物占用的货仓容积（其余时刻 0；UI 展示"已用/剩余"用） */
export function haulingOccupiedM3(state: GameState, ctx: SimContext): number {
  if (!state.hauling.active) return 0
  return cargoCapacityM3Of(state, ctx, state.shipId)
}
