/**
 * T8/T9 位置模型（多空间站版）：
 * - 舰船空闲时的"野外停留" = awayGalaxy；否则停靠空间站 = 母港（dockedSite=null）
 *   或已建成的副空间站（dockedSite = 站点 id）；
 * - 2026-09-08（船长定）：未建成的建站点**不视为任何站点**——不停靠、无泊位、无站内功能，
 *   只作为"工地现场"（野外停留，可现场交付建材）；旧档残留的未建成停靠自动纠正为现场停留；
 * - 一切作业的"出发地" = awayGalaxy ?? 停靠站所在星系；
 * - 空间站清单 = 母港 ⊕ 已建成副站（stage>=3）；"最近空间站"解析供采矿返航/显式返航使用；
 * - 显式"返航最近空间站" = transit 作业（出发锁定；到站后按目标站设置停靠）。
 * - 2026-09-08 建站交付航线：transit.delivery 非空 = 主船从停靠空间站出发，按真实航程驶往
 *   建设工地星系（to-site）→ 到点野外停留自动交付建材 → 自动返航最近空间站（to-station）；
 *   行程随时可取消（无惩罚，取消即立即返航停靠最近已建成站）。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { SimContext, StationSiteDef } from './types'
import { shortestTravelMinutes, travelLegMs } from './travel'
import { deliverStationResources, noteStationSiteAt, siteProgress, tierNeedOf, tierRemaining } from './station'
import { cargoCapacityM3Of, cargoOfShip, cargoUsedM3Of, unloadCargoOfShipToWarehouse } from './inventory'

/** 进港卸货附注（2026-09-08 船长定：任何进港时刻自动整仓卸货；返回 >0 单位的附注文本） */
function dockUnloadNote(state: GameState, shipId: string): string {
  const moved = unloadCargoOfShipToWarehouse(state, shipId)
  return moved > 0 ? `货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : ''
}

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

/** 某星系内是否停有"已建成"副站：返回站点 id（2026-09-08 镜像/返航落点用；无则 null） */
export function builtSiteAtGalaxy(state: GameState, ctx: SimContext, galaxyId: string): string | null {
  for (const site of ctx.stations.values()) {
    if (site.galaxyId !== galaxyId) continue
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length) return site.id
  }
  return null
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

/** 是否停靠"协会基地网络"（2026-09-08 船长定：已建成副站 = 母港镜像——母港或已建成副站）：
 * 市场/精炼炉/残骸回收/组装机等站内功能在母港与已建成副站同样可用（设施与仓库全局共享，
 * 空间站只是入口）；野外/航行中/修建中工地不视为基地。 */
export function isAtHomeLike(state: GameState, ctx: SimContext): boolean {
  if (state.awayGalaxy !== null) return false
  if (state.dockedSite === null) return true
  const site = ctx.stations.get(state.dockedSite)
  return !!site && siteProgress(state, site.id).stage >= site.tiers.length
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
 * 前置：在野外且无任何进行中作业。
 * 换港返航即时到站（定稿：去程取消）：下达即停靠目标站（finishAtGameMs = 当前时刻，无航行等待）。
 */
export function startTransitHome(state: GameState, ctx: SimContext): CommandResult {
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：舰船正在执行投送航行，到站后再返航。' }
  if (state.awayGalaxy === null) return { ok: false, error: '舰船已停靠空间站，无需返航。' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中——请先取消（顶部活动栏）。' }
  if (state.transit.active) return { ok: false, error: '返航行程进行中。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先处理远征。' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船会自动返航）。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。' }
  if (state.scanning.active) return { ok: false, error: '扫描作业中：请先终止扫描。' }
  const from = state.awayGalaxy
  const target = nearestStationGalaxyId(state, ctx, from)
  const mins = shortestTravelMinutes(ctx, from, target)
  if (!Number.isFinite(mins)) return { ok: false, error: '最近空间站不在已知航路内，无法返航。' }
  const t = state.transit
  const fromName = ctx.galaxies.get(from)?.name ?? from
  const toName = ctx.galaxies.get(target)?.name ?? '空间站'
  // 换港返航即时到站（去程取消）：不保留行程状态，直接停靠目标站
  t.active = false
  t.fromGalaxy = null
  t.toGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.delivery = null
  state.awayGalaxy = null
  // 目标若是已建成副站 → 停靠该站；否则回母港（2026-09-08：到港即自动卸货）
  state.dockedSite = null
  const unloadNote = dockUnloadNote(state, state.shipId)
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites[site.id]
    if (prog && prog.stage >= site.tiers.length && site.galaxyId === target) {
      state.dockedSite = site.id
      addLog(state, 'info', `返航完成：舰船已即时停靠「${site.name}」（副空间站）。${unloadNote}`)
      return { ok: true }
    }
  }
  addLog(state, 'info', `返航完成：舰船已即时停靠「${toName}」（自「${fromName}」归来）。${unloadNote}`)
  return { ok: true }
}

/** 引擎内部：推进返航/交付航线行程（仅旧档/遗留在途行程与交付航线：finishAt 在未来；
 * 新指令"返航"即时到站不留行程）。交付航线到点分支 = 工地到达自动交付 + 链返程腿。 */
export function advanceTransit(state: GameState, ctx: SimContext): void {
  const t = state.transit
  if (!t.active) return
  if (state.gameMs < t.finishAtGameMs) return
  const d = t.delivery
  const toGalaxy = t.toGalaxy
  const toName = toGalaxy ? ctx.galaxies.get(toGalaxy)?.name ?? toGalaxy : '空间站'
  t.active = false
  t.fromGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.toGalaxy = null
  t.delivery = null
  if (d && d.phase === 'to-site') {
    arriveDeliverSite(state, ctx, d.siteId, d.loaded)
    return
  }
  // 普通返航 / 交付航线返程腿：到站按目标设置停靠（副站或母港）
  state.awayGalaxy = null
  state.dockedSite = null
  const unloadNote = dockUnloadNote(state, state.shipId)
  let dockedName: string | null = null
  if (toGalaxy) {
    for (const site of ctx.stations.values()) {
      const prog = state.stationSites[site.id]
      if (prog && prog.stage >= site.tiers.length && site.galaxyId === toGalaxy) {
        state.dockedSite = site.id
        dockedName = site.name
        break
      }
    }
  }
  if (d && d.phase === 'to-station') {
    addLog(state, 'info', `交付任务收尾：舰船已返航停靠「${dockedName ?? toName}」${dockedName ? '（副空间站）' : ''}。${unloadNote}`)
    // 2026-09-08 v2 自动循环：工地还有缺口且仓库有料 → 同一引擎推进内立即续趟出发
    continueDeliverLoop(state, ctx, d.siteId)
    return
  }
  addLog(state, 'info', `返航完成：舰船已停靠「${dockedName ?? toName}」${dockedName ? '（副空间站）' : ''}。${unloadNote}`)
}

/* ─────────── 2026-09-08 建站交付航线 v2（船长定稿：物理载货模型 + 自动多趟循环） ─────────── */

/** 从当前档到全部建成的剩余总需求（单位）：∑各剩余档需求 − 当前档已缴 */
function totalSiteRemaining(state: GameState, site: StationSiteDef): number {
  const prog = siteProgress(state, site.id)
  let total = 0
  for (let k = prog.stage; k < site.tiers.length; k += 1) total += tierNeedOf(state, site, k)
  for (const id of site.acceptItemIds) total -= prog.delivered[id] ?? 0
  return Math.max(0, total)
}

/**
 * 出发装载（2026-09-08 船长定：出发时把货仓装满建材，到点清空货仓——不再到点从仓库扣缴，
 * 途中任何仓库变动都不会造成白跑）：
 * - 只搬「该工地接受名单」的建材，按名单顺序装满货仓空闲空间，保留船上原有货物；
 * - 装载上限 = min(货仓空闲容积, 全站剩余需求)，超出需量不装（避免运回来又卸回去的空转）；
 * - 返回本次装载明细（空对象 = 无货可装）。
 */
function loadDeliverCargo(state: GameState, ctx: SimContext, site: StationSiteDef): Record<string, number> {
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  const used = cargoUsedM3Of(state, ctx, state.shipId)
  let freeM3 = Math.max(0, Math.floor(cap - used))
  let needUnits = totalSiteRemaining(state, site)
  if (freeM3 <= 0 || needUnits <= 0) return {}
  const ware = state.warehouse.items
  const cargo = cargoOfShip(state, state.shipId)
  const loaded: Record<string, number> = {}
  for (const id of site.acceptItemIds) {
    if (freeM3 <= 0 || needUnits <= 0) break
    const unitM3 = Math.max(0.01, ctx.items.get(id)?.unitM3 ?? 1)
    const take = Math.max(0, Math.min(ware[id] ?? 0, Math.floor(freeM3 / unitM3), needUnits))
    if (take <= 0) continue
    ware[id] = (ware[id] ?? 0) - take
    if (ware[id] <= 0) delete ware[id]
    cargo[id] = (cargo[id] ?? 0) + take
    loaded[id] = take
    freeM3 -= Math.round(take * unitM3)
    needUnits -= take
  }
  return loaded
}

/**
 * 玩家指令：一键「前往工地交付」＝**交付循环**（2026-09-08 船长定）——
 * 出发时装满货仓 → 真实航程 → 到点只清空本趟装载 → 自动返航 → 仓库还有建材就自动续趟，
 * 直到①全部档位建成（就地停靠新站）或②仓库建材耗尽（终止并提示）。
 * 前置：驾驶船空闲且停靠在空间站（母港或已建成副站）；工地未建成且所在星系已探明；
 * 仓库里得有可装载的建材。
 */
export function startSiteDeliverTrip(state: GameState, ctx: SimContext, siteId: string): CommandResult {
  const site = ctx.stations.get(siteId)
  if (!site) return { ok: false, error: `未知建站点：${siteId}。` }
  const prog = siteProgress(state, siteId)
  if (prog.stage >= site.tiers.length) return { ok: false, error: `「${site.name}」已建成并网，无需再交付建材。` }
  if (state.awayGalaxy !== null) {
    return { ok: false, error: '舰船在野外：请先「返航空间站」（母港或已建成副站），再从空间站下达「前往工地交付」。' }
  }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：舰船正在执行投送航行，到站后再安排交付航线。' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中——请先取消（顶部活动栏）。' }
  if (state.transit.active) return { ok: false, error: '已有进行中的行程（返航/交付航线）。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先召回远征。' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船会自动返航）。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。' }
  if (state.scanning.active) return { ok: false, error: '扫描作业中：请先终止扫描。' }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能离港。' }
  }
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '制造作业正由你亲自开线：先取消它才能离港（想自动制造可改用 AI 核心驱动）。' }
  }
  if (!state.exploredGalaxies.includes(site.galaxyId)) {
    const g = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
    return { ok: false, error: `「${g}」尚未探明——先对其执行扫描探索，才能规划交付航线。` }
  }
  const from = originGalaxyOf(state, ctx)
  const mins = shortestTravelMinutes(ctx, from, site.galaxyId)
  if (!Number.isFinite(mins)) return { ok: false, error: `「${site.galaxyId}」不在已知航路内，无法规划航线。` }
  // 出发装载（物理载货模型）：货仓没空位 / 仓库没建材 = 无法启程（点按侧弹窗提示原因）
  const capV = cargoCapacityM3Of(state, ctx, state.shipId)
  const usedV = cargoUsedM3Of(state, ctx, state.shipId)
  const freeV = Math.max(0, Math.floor(capV - usedV))
  if (freeV <= 0) {
    return { ok: false, error: '货仓没有空闲空间：先卸货入仓库腾出位置，再安排交付循环。' }
  }
  const loaded = loadDeliverCargo(state, ctx, site)
  const loadedTotal = Object.values(loaded).reduce((s, n) => s + n, 0)
  if (loadedTotal <= 0) {
    return {
      ok: false,
      error: `仓库没有可装载的建材（需要：${site.acceptItemIds.map((i) => ctx.items.get(i)?.name ?? i).join(' / ')}）——备料后再一键出发。`,
    }
  }
  const fromName = ctx.galaxies.get(from)?.name ?? '空间站'
  const toGalaxyName = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
  const legMs = travelLegMs(state, ctx, mins)
  // 出发：驶离泊位进入航线（野外标记 = 出发星系，防航行中误用站内功能）
  state.dockedSite = null
  state.awayGalaxy = from
  const t = state.transit
  t.active = true
  t.fromGalaxy = from
  t.toGalaxy = site.galaxyId
  t.finishAtGameMs = state.gameMs + legMs
  t.legMs = legMs
  t.delivery = { siteId: site.id, phase: 'to-site', loaded }
  const durTxt = legMs <= 1000 ? '约片刻' : `约 ${Math.max(1, Math.round(legMs / 60_000))} 分钟`
  addLog(
    state,
    'info',
    `⚑ 建站交付航线：舰船自「${fromName}」启程，驶往「${toGalaxyName}」的「${site.name}」工地（${durTxt}航程）——本趟装载建材 ${loadedTotal.toLocaleString('zh-CN')} 单位随船（货仓 ${usedV.toLocaleString('zh-CN')}/${capV.toLocaleString('zh-CN')} m³）；到点自动清仓交付，仓库还有建材就自动续趟，全部建完或建材耗尽自动终止。可随时取消（= 停止整个循环）。`,
  )
  return { ok: true }
}

/** 玩家指令：取消进行中的建站交付航线（无惩罚；取消即立即返航停靠最近已建成空间站） */
export function cancelSiteDeliverTrip(state: GameState, ctx: SimContext): CommandResult {
  const t = state.transit
  if (!t.active || !t.delivery) return { ok: false, error: '当前没有进行中的建站交付航线。' }
  const phase = t.delivery.phase
  const site = ctx.stations.get(t.delivery.siteId)
  // 取消落点 = 最近已建成空间站（相对本次航线所在位置）
  const baseFrom = phase === 'to-site' ? (t.fromGalaxy ?? site?.galaxyId ?? HOME_GALAXY_ID) : (t.toGalaxy ?? HOME_GALAXY_ID)
  const base = nearestStationGalaxyId(state, ctx, baseFrom)
  t.active = false
  t.fromGalaxy = null
  t.toGalaxy = null
  t.finishAtGameMs = 0
  t.legMs = 0
  t.delivery = null
  state.awayGalaxy = null
  state.dockedSite = null
  let dockedName: string | null = null
  for (const s of ctx.stations.values()) {
    const prog = state.stationSites[s.id]
    if (prog && prog.stage >= s.tiers.length && s.galaxyId === base) {
      state.dockedSite = s.id
      dockedName = s.name
      break
    }
  }
  const moved = unloadCargoOfShipToWarehouse(state, state.shipId)
  addLog(
    state,
    'warn',
    `交付航线已取消（无惩罚）：已停止交付循环，舰船立即返航，已停靠「${dockedName ?? (ctx.galaxies.get(base)?.name ?? '母港')}」${dockedName ? '（副空间站）' : ''}${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`,
  )
  return { ok: true }
}

/** 自动续趟：返航停靠后，工地还有缺口且仓库能装上建材 → 立即再出发一趟；
 * 装不上（仓库建材耗尽）→ 终止交付循环并写一次性系统提示（渲染层弹窗 + 事件日志）。 */
function continueDeliverLoop(state: GameState, ctx: SimContext, siteId: string): void {
  const site = ctx.stations.get(siteId)
  if (!site) return
  const prog = siteProgress(state, siteId)
  if (prog.stage >= site.tiers.length) return
  const remain = tierRemaining(state, site)
  if (remain <= 0) return
  const r = startSiteDeliverTrip(state, ctx, siteId)
  if (r.ok) return // 下一趟已出发（循环继续）
  const remainTxt = remain.toLocaleString('zh-CN')
  const note =
    r.error && r.error.includes('仓库没有可装载的建材')
      ? `「${site.name}」交付循环已结束：仓库建材已运完，工地还差 ${remainTxt} 单位——备料后再一键出发即可续建。`
      : `「${site.name}」交付循环已中断：${r.error ?? '无法续运'}`.slice(0, 200)
  addLog(state, 'warn', note)
  state.deliveryNotice = note
}

/**
 * 到达工地星系：野外停留 → **只清空本趟装载**（deliverStationResources cargo-only 逐笔扣缴、
 * 逐档推进）→ 自动返航最近空间站（仓库有料则由 advanceTransit 到站后自动续趟）。
 * loaded 缺省（旧版在途档兼容）：按货仓现存接受建材视为装载，不碰仓库。
 */
function arriveDeliverSite(
  state: GameState,
  ctx: SimContext,
  siteId: string,
  loaded?: Record<string, number>,
): void {
  const site = ctx.stations.get(siteId)
  if (!site) {
    state.awayGalaxy = null
    state.dockedSite = null
    addLog(state, 'warn', '交付航线异常：工地数据缺失，舰船已直接返航母港。')
    return
  }
  const galaxyName = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
  state.awayGalaxy = site.galaxyId
  state.dockedSite = null
  addLog(state, 'info', `⚑ 交付航线：舰船已抵达「${galaxyName}」——「${site.name}」工地，本趟装载的建材自动清仓交付中。`)
  noteStationSiteAt(state, ctx, site.galaxyId)
  // 本趟装载账本（旧版在途档无 loaded → 以货仓现存接受建材为账本，只清货仓、不碰仓库）
  const ledger: Record<string, number> = {}
  const cargo = cargoOfShip(state, state.shipId)
  if (loaded && Object.keys(loaded).length > 0) {
    for (const id of site.acceptItemIds) ledger[id] = loaded[id] ?? 0
  } else {
    for (const id of site.acceptItemIds) ledger[id] = cargo[id] ?? 0
  }
  let delivered = 0
  let guard = 0
  while (guard++ < 60) {
    const need = tierRemaining(state, site)
    if (need <= 0) break
    let any = false
    for (const id of site.acceptItemIds) {
      const needNow = tierRemaining(state, site)
      if (needNow <= 0) break
      const onHand = Math.max(0, Math.min(ledger[id] ?? 0, cargo[id] ?? 0, needNow))
      if (onHand <= 0) continue
      const r = deliverStationResources(state, ctx, site.id, id, onHand, { cargoOnly: true })
      if (r.ok) {
        ledger[id] = (ledger[id] ?? 0) - onHand
        any = true
        delivered += onHand
      }
    }
    if (!any) break
  }
  const progAfter = siteProgress(state, site.id)
  if (progAfter.stage >= site.tiers.length) {
    // 全部档位完成：就地停靠刚建成的新副站（货仓余量随进港自动卸回仓库）
    state.awayGalaxy = null
    state.dockedSite = site.id
    const unloadNote = dockUnloadNote(state, state.shipId)
    addLog(state, 'info', `本次交付达成「建成」档：舰船已停靠新落成的「${site.name}」（副空间站）。${unloadNote}`)
    return
  }
  const remain = tierRemaining(state, site)
  if (delivered > 0) {
    addLog(
      state,
      'info',
      `本次清仓交付建材 ${delivered.toLocaleString('zh-CN')} 单位，当前档还差 ${remain.toLocaleString('zh-CN')} 单位（仓库有料将自动续趟）。`,
    )
  } else {
    addLog(state, 'info', `本趟未交付任何建材（工地当前需求与货仓装载不匹配）——自动返航。`)
  }
  // 自动返航最近空间站（真实航程；最近站随本次建成情况实时解析）
  const baseGal = nearestStationGalaxyId(state, ctx, site.galaxyId)
  const mins = shortestTravelMinutes(ctx, site.galaxyId, baseGal)
  const legMs = Number.isFinite(mins) ? travelLegMs(state, ctx, mins) : 0
  const baseName = ctx.galaxies.get(baseGal)?.name ?? '母港'
  if (legMs <= 0) {
    state.awayGalaxy = null
    state.dockedSite = null
    let dockedName: string | null = null
    for (const s of ctx.stations.values()) {
      const prog = state.stationSites[s.id]
      if (prog && prog.stage >= s.tiers.length && s.galaxyId === baseGal) {
        state.dockedSite = s.id
        dockedName = s.name
        break
      }
    }
    const unloadNote = dockUnloadNote(state, state.shipId)
    addLog(state, 'info', `交付任务收尾：舰船已返航停靠「${dockedName ?? baseName}」${dockedName ? '（副空间站）' : ''}。${unloadNote}`)
    if (site && progAfter.stage < site.tiers.length) continueDeliverLoop(state, ctx, site.id)
    return
  }
  const t = state.transit
  t.active = true
  t.fromGalaxy = site.galaxyId
  t.toGalaxy = baseGal
  t.finishAtGameMs = state.gameMs + legMs
  t.legMs = legMs
  t.delivery = { siteId: site.id, phase: 'to-station' }
  addLog(
    state,
    'info',
    `交付任务收尾：自动返航「${baseName}」（约 ${Math.max(1, Math.round(legMs / 60_000))} 分钟航程）——到站后如仓库还有建材将自动续趟，可随时取消（= 停止整个循环）。`,
  )
}

/**
 * 引擎内部：停靠位置一致性纠正（2026-09-08 船长定：未建成的建站点不视为任何站点）。
 * 若停靠目标是不存在/未建成的站点（旧档残留等），一律转为该星系"工地现场"野外停留并记日志。
 */
export function reconcileDockSanity(state: GameState, ctx: SimContext): void {
  const ds = state.dockedSite
  if (ds === null) return
  const site = ctx.stations.get(ds)
  if (site && siteProgress(state, ds).stage >= site.tiers.length) return // 已建成副站：合法停靠
  const galaxyId = site?.galaxyId ?? null
  state.dockedSite = null
  state.awayGalaxy = galaxyId ?? HOME_GALAXY_ID
  const galaxyName = galaxyId ? (ctx.galaxies.get(galaxyId)?.name ?? galaxyId) : '母港'
  addLog(
    state,
    'warn',
    site
      ? `「${site.name}」尚未建成：工地不提供停靠——舰船已转为「${galaxyName}」工地现场停留（交付建材可现场提交）。`
      : '停靠的副站数据缺失：舰船已返回母港。',
  )
}

/** 返航/交付航线行程只读视图（活动栏/星图页用） */
export interface TransitView {
  active: boolean
  fromGalaxy: string | null
  fromName: string
  toGalaxy: string | null
  toName: string
  remainingMs: number
  percent: number
  /** 行程类型（2026-09-08）：dock = 普通返航；deliver-to-site = 交付航线·去程；
   * deliver-to-station = 交付航线·返程；null = 无行程 */
  trip: 'dock' | 'deliver-to-site' | 'deliver-to-station' | null
  /** 交付目标工地名（trip 为交付航线时非空，UI 展示用） */
  siteName: string | null
}

export function transitStatus(state: GameState, ctx: SimContext): TransitView {
  const t = state.transit
  const fromName = t.fromGalaxy ? ctx.galaxies.get(t.fromGalaxy)?.name ?? t.fromGalaxy : ''
  const toName = t.toGalaxy ? ctx.galaxies.get(t.toGalaxy)?.name ?? t.toGalaxy : '空间站'
  const remainingMs = t.active ? Math.max(0, t.finishAtGameMs - state.gameMs) : 0
  const percent = t.legMs > 0 ? Math.min(100, Math.max(0, ((t.legMs - remainingMs) / t.legMs) * 100)) : 0
  const site = t.delivery ? ctx.stations.get(t.delivery.siteId) : undefined
  return {
    active: t.active,
    fromGalaxy: t.fromGalaxy,
    fromName,
    toGalaxy: t.toGalaxy,
    toName,
    remainingMs,
    percent,
    trip: t.delivery
      ? t.delivery.phase === 'to-site'
        ? 'deliver-to-site'
        : 'deliver-to-station'
      : t.active
        ? 'dock'
        : null,
    siteName: site ? site.name : null,
  }
}

/* ═══════════ B1.5 主动"前往星系掩护巡逻"（原"待命"，主控） ═══════════ */

/**
 * 玩家指令：前往指定星系**掩护巡逻**（即时就位：去程已取消，无航行等待；
 * 下达即转场该星系野外停留 awayGalaxy=目标——采矿/悬赏/返航皆可从停留点继续；
 * 低安星系的停留船会进入 B1 遭遇暴露）。
 * 前置：舰船空闲（不在采矿/远征/扫描/返航行程中）；目标星系必须已探索且不在当前停靠点。
 */
export function goStandbyAt(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const target = ctx.galaxies.get(galaxyId)
  if (!target) return { ok: false, error: `未知星系：${galaxyId}。` }
  const s = state.standby
  if (s.active) return { ok: false, error: '掩护巡逻进行中：请先取消（顶部活动栏）。' }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：暂不能转场掩护巡逻——到站自动结算后再安排。' }
  if (state.transit.active) return { ok: false, error: '返航空间站途中：到站后再安排。' }
  if (state.expedition.active) return { ok: false, error: '远征作业中：请先召回远征。' }
  if (state.mining.active) return { ok: false, error: '采矿作业中：请先停止开采，或直接换船（旧船自动返航）。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业中：请先停止打捞，或让作业自然结束（满仓自动返航）。' }
  if (state.scanning.active) return { ok: false, error: '扫描作业中：请先终止扫描。' }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能离港。' }
  }
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '制造作业正由你亲自开线：先取消它才能离港（想自动制造可改用 AI 核心驱动）。' }
  }
  if (isExploredOf(state, galaxyId) === false) return { ok: false, error: `「${target.name}」尚未探明——先对其执行扫描探索。` }
  const from = originGalaxyOf(state, ctx)
  if (from === galaxyId && state.awayGalaxy === null) {
    return { ok: false, error: `舰船已停靠「${target.name}」，无需前往。` }
  }
  if (state.awayGalaxy === galaxyId && isIdleField(state)) {
    return { ok: false, error: `舰船已在「${target.name}」掩护巡逻。` }
  }
  const mins = shortestTravelMinutes(ctx, from, galaxyId)
  if (!Number.isFinite(mins)) return { ok: false, error: `「${target.name}」不在已知航路内。` }
  // 去程取消（定稿）：即时就位——到达时刻 = 当前，无去程等待；船即刻转场目标星系留守
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = galaxyId
  // 2026-09-06：建站叙事入口改挂掩护巡逻到位（悬赏胜利/扫描完成不再停留）
  noteStationSiteAt(state, ctx, galaxyId)
  addLog(
    state,
    'info',
    `⚐ 掩护巡逻：舰船已抵达「${target.name}」并留守该星系（低安星系可能遭遇巡逻/伏击；可随时返航空间站，或从该处继续采矿/出击）。`,
  )
  return { ok: true }
}

/** 引擎内部：收尾掩护巡逻状态。新指令即时就位（active=false，无需处理）；
 * 仅旧档/遗留的去程状态（finishAt 在未来）到此仍需等待到点再留守，并兼容清理异常残留。 */
export function advanceStandby(state: GameState, ctx: SimContext): void {
  const s = state.standby
  if (!s.active) return
  if (state.gameMs < s.finishAtGameMs) return // 旧档/遗留：去程仍在路上 → 到点再留守
  const galaxyId = s.galaxyId
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  if (galaxyId === null) return
  if (state.awayGalaxy === galaxyId) return // 已即时就位（不重复写到达日志）
  const name = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  state.awayGalaxy = galaxyId // 目标星系野外停留（低安遭遇暴露即生效）
  noteStationSiteAt(state, ctx, galaxyId) // 2026-09-06：建站叙事入口改挂掩护巡逻到位
  addLog(
    state,
    'info',
    `⚐ 已抵达「${name}」，掩护巡逻就位：留守该星系（可采矿/出击/返航空间站；低安星系留意巡逻与伏击）。`,
  )
}

/** 玩家指令：取消旧的掩护巡逻去程（仅旧档在途状态有意义；召回口径：立即回到母港/空间站，无耗时） */
export function cancelStandby(state: GameState, ctx: SimContext): CommandResult {
  const s = state.standby
  if (!s.active || s.galaxyId === null) return { ok: false, error: '当前没有进行中的掩护巡逻行程。' }
  const name = ctx.galaxies.get(s.galaxyId)?.name ?? s.galaxyId
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.legMs = 0
  state.awayGalaxy = null // 召回口径：回母港（与远征召回一致）
  // 2026-09-08：召回 = 回母港停靠——进港自动整仓卸货
  const moved = unloadCargoOfShipToWarehouse(state, state.shipId)
  addLog(
    state,
    'warn',
    `掩护巡逻行程已取消：舰船返回母港（未抵达「${name}」）${moved > 0 ? `；货仓已自动卸入物品仓库（${moved.toLocaleString('zh-CN')} 单位）。` : '。'}`,
  )
  return { ok: true }
}

/** 掩护巡逻（旧"待命"）只读视图（活动栏用；新指令即时就位后为 inactive） */
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
