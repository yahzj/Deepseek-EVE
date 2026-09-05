/**
 * T8/T9 位置模型（多空间站版）：
 * - 舰船空闲时的"野外停留" = awayGalaxy；否则停靠空间站 = 母港（dockedSite=null）
 *   或已建成的副空间站（dockedSite = 站点 id）；
 * - 一切作业的"出发地" = awayGalaxy ?? 停靠站所在星系；
 * - 空间站清单 = 母港 ⊕ 已建成副站（stage>=3）；"最近空间站"解析供采矿返航/显式返航使用；
 * - 显式"返航最近空间站" = transit 作业（出发锁定；到站后按目标站设置停靠）。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { shortestTravelMinutes, travelLegMs } from './travel'

/** 已建成的空间站星系清单（母港 + 副站建成者），顺序 = 母港优先 */
export function stationGalaxyIds(state: GameState, ctx: SimContext): string[] {
  const out = [HOME_GALAXY_ID]
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length) out.push(site.galaxyId)
  }
  return out
}

/** 最近空间站（相对某星系的航线分钟）；返回空间站星系 id */
export function nearestStationGalaxyId(state: GameState, ctx: SimContext, fromGalaxy: string): string {
  let best = HOME_GALAXY_ID
  let bestMin = shortestTravelMinutes(ctx, fromGalaxy, HOME_GALAXY_ID)
  if (!Number.isFinite(bestMin)) bestMin = Number.POSITIVE_INFINITY
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (!prog || prog.stage < site.tiers.length) continue
    const m = shortestTravelMinutes(ctx, fromGalaxy, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site.galaxyId
    }
  }
  return best
}

/**
 * 采矿"返航/出航基准腿"（与 mining.oneLegMs 同口径的站解析版，供 shipyard 等不引 mining 的场景使用）：
 * = 本地进出港基准 + 矿带星系与"最近空间站"的实际航程。
 */
export function miningReturnLegMs(state: GameState, ctx: SimContext, beltId: string | null | undefined): number {
  if (state.debugQuick) return 1000
  const belt = beltId ? ctx.belts.get(beltId) : undefined
  const stGal = belt?.galaxyId ? nearestStationGalaxyId(state, ctx, belt.galaxyId) : HOME_GALAXY_ID
  const mins = belt && belt.galaxyId ? shortestTravelMinutes(ctx, stGal, belt.galaxyId) : 0
  const travel = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) : 0
  return Math.max(1, ctx.balance.mining.localLegMs + travel)
}

/** 当前停靠的空间站（null = 在野外；{siteId:null}=母港） */
export function dockedStation(state: GameState): { siteId: string | null; galaxyId: string } {
  if (state.awayGalaxy !== null) return { siteId: null, galaxyId: '' } // 野外（无停靠站）
  return { siteId: state.dockedSite, galaxyId: state.dockedSite ? '' : HOME_GALAXY_ID }
}

/** 船当前是否停靠在空间站（站内才可装卸/维修/换船/补给等） */
export function isAtStation(state: GameState): boolean {
  return state.awayGalaxy === null
}

/** 是否在母港（出售/市场/制造等母港专属动作的前提） */
export function isAtHome(state: GameState): boolean {
  return state.awayGalaxy === null && state.dockedSite === null
}

/** 出发地星系：野外停留点，否则当前停靠站所在星系 */
export function originGalaxyOf(state: GameState, ctx: SimContext): string {
  if (state.awayGalaxy !== null) return state.awayGalaxy
  if (state.dockedSite !== null) {
    const site = ctx.stations.get(state.dockedSite)
    if (site) return site.galaxyId
  }
  return HOME_GALAXY_ID
}

/** 野外空闲中（非站内且无任何进行中作业） */
export function isIdleField(state: GameState): boolean {
  return (
    state.awayGalaxy !== null &&
    !state.transit.active &&
    !state.expedition.active &&
    !state.mining.active &&
    !state.scanning.active &&
    !state.standby.active &&
    !state.salvaging.active
  )
}

/**
 * 玩家指令：从野外返航**最近空间站**（母港或已建成副站）。
 * 前置：在野外且无任何进行中作业；时长按当前船跃迁/技能、出发时锁定。
 */
export function startTransitHome(state: GameState, ctx: SimContext): CommandResult {
  if (state.awayGalaxy === null) return { ok: false, error: '舰船已停靠空间站，无需返航。' }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  if (state.transit.active) return { ok: false, error: '返航行程进行中。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先处理远征。' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船会自动返航）。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。' }
  if (state.scanning.active) return { ok: false, error: '扫描作业中：请先终止扫描。' }
  const from = state.awayGalaxy
  const target = nearestStationGalaxyId(state, ctx, from)
  const mins = shortestTravelMinutes(ctx, from, target)
  if (!Number.isFinite(mins)) return { ok: false, error: '最近空间站不在已知航路内，无法返航。' }
  const legMs = state.debugQuick ? 1000 : Math.max(1, travelLegMs(state, ctx, mins))
  const t = state.transit
  t.active = true
  t.fromGalaxy = from
  t.toGalaxy = target
  t.finishAtGameMs = state.gameMs + legMs
  t.legMs = legMs
  const fromName = ctx.galaxies.get(from)?.name ?? from
  const toName = ctx.galaxies.get(target)?.name ?? '空间站'
  addLog(
    state,
    'info',
    state.debugQuick
      ? `已命令返航：从「${fromName}」返回空间站（${toName}）。`
      : `返航空间站（${toName}）：从「${fromName}」出发，约 ${Math.round(legMs / 1000)} 秒后到站（可卸货/维修/换船）。`,
  )
  return { ok: true }
}

/** 引擎内部：推进返航行程；到站按目标设置停靠（副站或母港） */
export function advanceTransit(state: GameState, ctx: SimContext): void {
  const t = state.transit
  if (!t.active) return
  if (state.gameMs < t.finishAtGameMs) return
  t.active = false
  t.fromGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  const toGalaxy = t.toGalaxy
  const toName = toGalaxy ? ctx.galaxies.get(toGalaxy)?.name ?? toGalaxy : '空间站'
  t.toGalaxy = null
  state.awayGalaxy = null
  // 目标若是已建成副站 → 停靠该站；否则回母港
  state.dockedSite = null
  if (toGalaxy) {
    for (const site of ctx.stations.values()) {
      const prog = state.stationSites[site.id]
      if (prog && prog.stage >= site.tiers.length && site.galaxyId === toGalaxy) {
        state.dockedSite = site.id
        addLog(state, 'info', `返航完成：舰船已停靠「${site.name}」（副空间站）。`)
        return
      }
    }
  }
  addLog(state, 'info', `返航完成：舰船已停靠「${toName}」。`)
}

/** 返航行程只读视图（活动栏/星图页用） */
export interface TransitView {
  active: boolean
  fromGalaxy: string | null
  fromName: string
  toGalaxy: string | null
  toName: string
  remainingMs: number
  percent: number
}

export function transitStatus(state: GameState, ctx: SimContext): TransitView {
  const t = state.transit
  const fromName = t.fromGalaxy ? ctx.galaxies.get(t.fromGalaxy)?.name ?? t.fromGalaxy : ''
  const toName = t.toGalaxy ? ctx.galaxies.get(t.toGalaxy)?.name ?? t.toGalaxy : '空间站'
  const remainingMs = t.active ? Math.max(0, t.finishAtGameMs - state.gameMs) : 0
  const percent = t.legMs > 0 ? Math.min(100, Math.max(0, ((t.legMs - remainingMs) / t.legMs) * 100)) : 0
  return {
    active: t.active,
    fromGalaxy: t.fromGalaxy,
    fromName,
    toGalaxy: t.toGalaxy,
    toName,
    remainingMs,
    percent,
  }
}

/* ═══════════ B1.5 主动"前往星系待命"（主控） ═══════════ */

/**
 * 玩家指令：前往指定星系待命（飞抵后野外停留 awayGalaxy=目标——采矿/悬赏/返航皆可从停留点继续；
 * 低安星系的停留船会进入 B1 遭遇暴露）。
 * 前置：舰船空闲（不在采矿/远征/扫描/返航/途中待命）；目标星系必须已探索且不在当前停靠点。
 */
export function goStandbyAt(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const target = ctx.galaxies.get(galaxyId)
  if (!target) return { ok: false, error: `未知星系：${galaxyId}。` }
  const s = state.standby
  if (s.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  if (state.transit.active) return { ok: false, error: '返航空间站途中：到站后再安排。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先召回远征。' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船自动返航）。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。' }
  if (state.scanning.active) return { ok: false, error: '扫描作业中：请先终止扫描。' }
  if (state.refineRun.active && state.refineRun.worker === 'pilot') {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能离港。' }
  }
  if (isExploredOf(state, galaxyId) === false) return { ok: false, error: `「${target.name}」尚未探明——先对其执行扫描探索。` }
  const from = originGalaxyOf(state, ctx)
  if (from === galaxyId && state.awayGalaxy === null && !state.standby.active) {
    return { ok: false, error: `舰船已停靠「${target.name}」，无需前往。` }
  }
  if (state.awayGalaxy === galaxyId && isIdleField(state)) {
    return { ok: false, error: `舰船已在「${target.name}」待命。` }
  }
  const mins = shortestTravelMinutes(ctx, from, galaxyId)
  if (!Number.isFinite(mins)) return { ok: false, error: `「${target.name}」不在已知航路内。` }
  const legMs = state.debugQuick ? 1000 : Math.max(1, travelLegMs(state, ctx, mins))
  s.active = true
  s.galaxyId = galaxyId
  s.finishAtGameMs = state.gameMs + legMs
  s.legMs = legMs
  const fromName = ctx.galaxies.get(from)?.name ?? from
  addLog(
    state,
    'info',
    `⛳ 前往「${target.name}」待命：从「${fromName}」启程，约 ${Math.round(legMs / 1000)} 秒后抵达并留守（低安星系可能遭遇巡逻/伏击，可随时取消或从该处继续采矿/出击）。`,
  )
  return { ok: true }
}

/** 引擎内部：推进待命去程；到点 → 野外停留目标星系（awayGalaxy，目标出发时已验证已探索） */
export function advanceStandby(state: GameState, ctx: SimContext): void {
  const s = state.standby
  if (!s.active) return
  if (state.gameMs < s.finishAtGameMs) return
  const galaxyId = s.galaxyId
  const name = galaxyId ? ctx.galaxies.get(galaxyId)?.name ?? galaxyId : ''
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = galaxyId // 目标星系野外停留（低安遭遇暴露即生效）
  addLog(
    state,
    'info',
    galaxyId === null
      ? '待命行程结束。'
      : `⛳ 已抵达「${name}」并进入待命：留守该星系（可采矿/出击/返航空间站；低安星系留意巡逻与伏击）。`,
  )
}

/** 玩家指令：取消待命去程（召回口径：立即回到母港/空间站，无耗时） */
export function cancelStandby(state: GameState, ctx: SimContext): CommandResult {
  const s = state.standby
  if (!s.active || s.galaxyId === null) return { ok: false, error: '当前没有进行中的待命行程。' }
  const name = ctx.galaxies.get(s.galaxyId)?.name ?? s.galaxyId
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = null // 召回口径：回母港（与远征召回一致）
  addLog(state, 'warn', `待命行程已取消：舰船返回母港（未抵达「${name}」）。`)
  return { ok: true }
}

/** 待命去程只读视图（活动栏用） */
export interface StandbyView {
  active: boolean
  galaxyId: string | null
  targetName: string
  remainingMs: number
  percent: number
}

export function standbyStatus(state: GameState, ctx: SimContext): StandbyView {
  const s = state.standby
  const remainingMs = s.active ? Math.max(0, s.finishAtGameMs - state.gameMs) : 0
  const percent = s.legMs > 0 ? Math.min(100, Math.max(0, ((s.legMs - remainingMs) / s.legMs) * 100)) : 0
  return {
    active: s.active,
    galaxyId: s.galaxyId,
    targetName: s.galaxyId ? ctx.galaxies.get(s.galaxyId)?.name ?? s.galaxyId : '',
    remainingMs,
    percent,
  }
}

/** 星系是否已探明（standby 前置用；避免引 explore 造成环） */
function isExploredOf(state: GameState, galaxyId: string): boolean {
  return state.exploredGalaxies.includes(galaxyId)
}
