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

/** 两段端点是否同一点 / 是否零航程 */
function routeMinutesOf(ctx: SimContext, a: HaulEndpoint, b: HaulEndpoint): number {
  const m = shortestTravelMinutes(ctx, a.galaxyId, b.galaxyId)
  return Number.isFinite(m) ? m : 0
}

/** 单段报酬估算（容量 × 费率 × 标称分钟；floor 取整） */
export function haulLegReward(capacityM3: number, legMinutes: number): number {
  return Math.floor(capacityM3 * HAUL_RATE_PER_M3_MIN * legMinutes)
}

/** 空态 */
function emptyHauling(): HaulingState {
  return { active: false, fromSiteId: null, toSiteId: null, legMinutes: 0, legMs: 0, phaseAccMs: 0, stopNext: false }
}

/** 玩家指令：开始运输任务（目标端点 = 已建成站；须停靠另一端点上） */
export function startHauling(state: GameState, toSiteId: string | null, ctx: SimContext): CommandResult {
  if (state.hauling.active) return { ok: false, error: '运输任务进行中：先停止（顶部活动栏）或等它到站。' }
  // 前置：停靠在空间站（母港或已建成副站）
  if (state.awayGalaxy !== null) return { ok: false, error: '舰船在野外：先返航到空间站再安排运输任务。' }
  const fromEndpoint = dockedHaulEndpoint(state)
  const targets = haulEndpoints(state, ctx)
  const to = targets.find((e) => e.siteId === toSiteId)
  if (!to) return { ok: false, error: toSiteId === null ? '运输目标缺失。' : '目标站点尚未建成，无法运输。' }
  if (to.siteId === fromEndpoint) return { ok: false, error: '出发站与目的站相同——请选另一座站点。' }
  const from = targets.find((e) => e.siteId === fromEndpoint)
  if (!from) return { ok: false, error: '当前停靠点不在协会基地网络内，无法接运输任务。' }
  const minutes = routeMinutesOf(ctx, from, to)
  if (minutes <= 0) return { ok: false, error: '两站之间没有可用航路（或同处一星系），无法运输。' }
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
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const legMs = travelLegMs(state, ctx, minutes)
  const perLeg = haulLegReward(cap, minutes)
  state.hauling = {
    active: true,
    fromSiteId: from.siteId,
    toSiteId: to.siteId,
    legMinutes: minutes,
    legMs,
    phaseAccMs: 0,
    stopNext: false,
  }
  // 出航：离开停靠（位置交给航段表达——与建站交付同口径：awayGalaxy=出发星系，站内门天然关闭）
  state.dockedSite = null
  state.awayGalaxy = from.galaxyId
  addLog(
    state,
    'info',
    `运输任务开始：${shipName} 承运「${from.name} → ${to.name}」（货仓 ${cap.toLocaleString('zh-CN')} m³ 满载虚拟货物）——` +
      `单段航程约 ${minutes} 分钟，到站结算报酬约 ${perLeg.toLocaleString('zh-CN')} ISK${unloaded > 0 ? `；船上原有货物已卸入仓库（${unloaded} 单位）` : ''}。`,
  )
  return { ok: true }
}

/** 玩家指令：停止运输任务（完成当前航段、到站即止；无惩罚） */
export function stopHauling(state: GameState): CommandResult {
  if (!state.hauling.active) return { ok: false, error: '没有进行中的运输任务。' }
  if (state.hauling.stopNext) return { ok: false, error: '运输任务已安排在到站后停止。' }
  state.hauling.stopNext = true
  addLog(state, 'info', '运输任务将在下一站停靠后停止（当前航段照常结算）。')
  return { ok: true }
}

/** 引擎内部：推进运输任务（真实航程腿逐段飞行 → 到站结算 → 自动续下一段 / 到站即停） */
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
      // 到站停靠（母港 = dockedSite null）
      state.awayGalaxy = null
      state.dockedSite = h.toSiteId === null ? null : h.toSiteId
      if (h.stopNext) {
        h.active = false
        h.phaseAccMs = 0
        addLog(state, 'info', `运输任务已停止：舰船停靠在「${arrived}」。`)
        break
      }
      // 换向续下一段：同一条航线（标称分钟保持出发时锁定值；真实毫秒按当前船重算，吸收航程技能在途变化）
      const nextFrom = h.toSiteId
      h.toSiteId = h.fromSiteId
      h.fromSiteId = nextFrom
      h.legMs = Math.max(1, travelLegMs(state, ctx, h.legMinutes))
      h.phaseAccMs = 0
      state.dockedSite = null
      state.awayGalaxy = endpointGalaxy(ctx, h.fromSiteId)
      const departTo = haulEndpointName(ctx, h.toSiteId)
      addLog(state, 'info', `运输任务继续：已装载前往「${departTo}」（虚拟货物，货仓占满）。`)
    }
  }
}

/** 引擎内部：换驾驶时终止运输任务（虚拟货无残留、无惩罚） */
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
