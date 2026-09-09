/**
 * T9 副空间站引擎：建造进度、资源交付（分档施工；2026-09-08 船长定：功能统一在"建成"档后开放——
 * 未建成不视为任何站点，不提供停靠）、"抵达站点星系"挂点（野外工地现场 + 通讯剧本自动触发）。
 * 2026-09-09（船长定）：各档改为**逐档材料单**（tier.bill = 物品×数量，逐项交齐才升档；
 * 建材仅精炼矿物，不含原矿）。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState, StationSiteProgress } from './state'
import type { CommandResult } from './engine'
import type { SimContext, StationSiteDef, StationTierDef } from './types'
import { cargoOfShip } from './inventory'

/** 读取站点进度（容错默认档 0） */
export function siteProgress(state: GameState, siteId: string): StationSiteProgress {
  const p = state.stationSites[siteId]
  if (p) return p
  return { stage: 0, delivered: {} }
}

/** 是否已建成（= 全部档位完成） */
export function isSiteBuilt(state: GameState, site: StationSiteDef): boolean {
  return siteProgress(state, site.id).stage >= site.tiers.length
}

/** 档位材料单（越界 = 空表） */
export function tierBillOf(site: StationSiteDef, tierIndex: number): ReadonlyArray<{ itemId: string; count: number }> {
  const tier = site.tiers[tierIndex]
  return tier ? tier.bill : []
}

/** 建筑工程学（station-engineering，2026-09-08 船长定）：需求直减 ×(1 − 8%/级)，满级 −40%，最少 1 单位 */
function engFactor(state: GameState): number {
  const engLv = Math.min(5, state.skills.trained['station-engineering'] ?? 0)
  return 1 - 0.08 * engLv
}

/** 某档某材料的实际需求（逐档材料单逐项换算） */
export function billNeedOf(state: GameState, site: StationSiteDef, tierIndex: number, itemId: string): number {
  const item = tierBillOf(site, tierIndex).find((b) => b.itemId === itemId)
  if (!item) return 0
  return Math.max(1, Math.ceil(item.count * engFactor(state)))
}

/** 某档建材总需求（材料单各项合计；兼容旧调用口径） */
export function tierNeedOf(state: GameState, site: StationSiteDef, tierIndex: number): number {
  let total = 0
  for (const item of tierBillOf(site, tierIndex)) total += billNeedOf(state, site, tierIndex, item.itemId)
  return total
}

/** 当前档某材料已缴 */
export function billDeliveredOf(prog: StationSiteProgress, site: StationSiteDef, tierIndex: number, itemId: string): number {
  if (!tierBillOf(site, tierIndex).some((b) => b.itemId === itemId)) return 0
  return prog.delivered[itemId] ?? 0
}

/** 当前档某材料还差多少（不在材料单 = 0） */
export function billRemainingOf(state: GameState, site: StationSiteDef, tierIndex: number, itemId: string): number {
  return Math.max(0, billNeedOf(state, site, tierIndex, itemId) - billDeliveredOf(siteProgress(state, site.id), site, tierIndex, itemId))
}

/** 玩家是否在该建站点"工地现场"（可提交建材，2026-09-06 紧急修复——玩家反馈无法提交）：
 * - 停靠该站（仅已建成的副站可停靠，2026-09-08 起未建成不视为站点）；
 * - 野外停留于站点所在星系（掩护巡逻/作业/交付航线到场即工地现场——未建成时现场即可交付，
 *   不需要停靠；建成前「返航空间站」只去已建成站/母港）；
 * 母港特例：站点若设在母港星系，停靠母港即可（保留历史口径）。 */
export function playerAtSite(state: GameState, site: StationSiteDef): boolean {
  if (state.awayGalaxy === null) {
    return state.dockedSite === site.id || (state.dockedSite === null && site.galaxyId === HOME_GALAXY_ID)
  }
  return state.awayGalaxy === site.galaxyId
}

/** 当前档整体还差多少单位（逐项剩余求和；0 = 本档已满，等待推进结算） */
export function tierRemaining(state: GameState, site: StationSiteDef): number {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return 0
  let total = 0
  for (const item of tierBillOf(site, prog.stage)) {
    total += billRemainingOf(state, site, prog.stage, item.itemId)
  }
  return total
}

/** 当前档材料单的只读视图（UI/日志/交付循环共用；含工程学换算后的逐项需求与剩余） */
export interface StationBillRow {
  itemId: string
  itemName: string
  need: number
  delivered: number
  remaining: number
}

export function stationBillView(state: GameState, ctx: SimContext, site: StationSiteDef): StationBillRow[] {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return []
  const rows: StationBillRow[] = []
  for (const item of tierBillOf(site, prog.stage)) {
    rows.push({
      itemId: item.itemId,
      itemName: ctx.items.get(item.itemId)?.name ?? item.itemId,
      need: billNeedOf(state, site, prog.stage, item.itemId),
      delivered: billDeliveredOf(prog, site, prog.stage, item.itemId),
      remaining: billRemainingOf(state, site, prog.stage, item.itemId),
    })
  }
  return rows
}

/** 当前档材料单文案（如「三钛合金×5000 / 超噬矿×1000」） */
export function stationBillText(state: GameState, ctx: SimContext, site: StationSiteDef): string {
  return stationBillView(state, ctx, site)
    .map((r) => `${r.itemName}×${r.need.toLocaleString('zh-CN')}`)
    .join('、')
}

/** 当前档是否已满（逐项全部交齐） */
export function tierFulfilled(state: GameState, site: StationSiteDef): boolean {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return true
  for (const item of tierBillOf(site, prog.stage)) {
    if (billRemainingOf(state, site, prog.stage, item.itemId) > 0) return false
  }
  return true
}

/** 内部：当前档已满 → 升档（delivered 清空重计；返回是否升档） */
function advanceTierIfFull(state: GameState, ctx: SimContext, site: StationSiteDef, prog: StationSiteProgress): void {
  let guard = 0
  while (prog.stage < site.tiers.length && guard++ < 6 && tierFulfilled(state, site)) {
    const doneTier = site.tiers[prog.stage]!
    prog.stage += 1
    prog.delivered = {}
    if (prog.stage >= site.tiers.length) {
      addLog(
        state,
        'trade',
        `⌂ 「${site.name}」建成并网！已并入空间站网络（卸货/维修/补给/换驾驶可用，采矿返航按最近空间站解析）。`,
      )
      if (site.doneDialogueId && !state.dialogueSeen[site.doneDialogueId]) {
        state.pendingDialogue = site.doneDialogueId
      }
    } else {
      const next = site.tiers[prog.stage]!
      addLog(
        state,
        'info',
        `「${site.name}」档位完成「${doneTier.name}」：${doneTier.unlockDesc ?? '施工推进'}。下一档「${next.name}」材料单：${stationBillText(state, ctx, site)}。`,
      )
    }
  }
}

/**
 * 玩家指令：在目标副站提交资源（只收**当前档材料单**上的物品；默认从物品仓库 + 驾驶船货仓扣取）。
 * 前置：舰船停靠在该站点（母港/别处仓库无法"跨航区施工"）。
 * 2026-09-08（交付航线 v2）：opts.cargoOnly = true 时只从驾驶船货仓扣（到点清空本趟装载，
 * 不触碰仓库——物理载货模型用；其余校验/推进/日志同口径）。
 */
export function deliverStationResources(
  state: GameState,
  ctx: SimContext,
  siteId: string,
  itemId: string,
  units: number,
  opts?: { cargoOnly?: boolean },
): CommandResult {
  const cargoOnly = opts?.cargoOnly === true
  const site = ctx.stations.get(siteId)
  if (!site) return { ok: false, error: `未知建站点：${siteId}。` }
  let prog = state.stationSites[siteId]
  if (!prog) {
    prog = { stage: 0, delivered: {} }
    state.stationSites[siteId] = prog // 落库，避免只改临时默认对象
  }
  if (prog.stage >= site.tiers.length) return { ok: false, error: `「${site.name}」已建成，无需再提交。` }
  // 旧档/旧口径残留：已交材料恰好满足当前档 → 自动结算推进（最多顺推 6 档防御环）
  advanceTierIfFull(state, ctx, site, prog)
  if (prog.stage >= site.tiers.length) return { ok: false, error: `「${site.name}」已建成，无需再提交。` }
  const itemName = ctx.items.get(itemId)?.name ?? itemId
  if (billRemainingOf(state, site, prog.stage, itemId) <= 0) {
    return {
      ok: false,
      error: `「${site.name}」当前档不收这种材料或已收齐——本档材料单：${stationBillText(state, ctx, site)}。`,
    }
  }
  const want = Math.floor(units)
  if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '提交数量必须是正整数。' }
  // 前置：在工地现场（停靠该站或野外停留于站点星系——母港仓库无法"跨航区施工"，但船在现场即可卸料）
  if (!playerAtSite(state, site)) {
    const g = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
    return { ok: false, error: `需抵达「${site.name}」工地（${g}）才能提交建材——掩护巡逻/作业到场即可，无需停靠。` }
  }
  const need = Math.min(want, billRemainingOf(state, site, prog.stage, itemId))
  if (need <= 0) return { ok: false, error: '该材料当前档已收齐（整档未满前可继续提交材料单上其它项）。' }

  let took = 0
  // 1) 物品仓库（cargoOnly 模式跳过：到点只清本趟装载，不补扣仓库）
  if (!cargoOnly) {
    const ware = state.warehouse.items
    const fromWare = Math.min(need, ware[itemId] ?? 0)
    if (fromWare > 0) {
      ware[itemId] = (ware[itemId] ?? 0) - fromWare
      if (ware[itemId] <= 0) delete ware[itemId]
      took += fromWare
    }
  }
  // 2) 驾驶船货仓
  if (took < need) {
    const cargo = cargoOfShip(state, state.shipId)
    const fromCargo = Math.min(need - took, cargo[itemId] ?? 0)
    if (fromCargo > 0) {
      cargo[itemId] = (cargo[itemId] ?? 0) - fromCargo
      if (cargo[itemId] <= 0) delete cargo[itemId]
      took += fromCargo
    }
  }
  if (took <= 0) {
    return {
      ok: false,
      error: cargoOnly ? `本趟货仓没有可提交的 ${itemName}（清仓交付只动本趟装载，不扣仓库）。` : `没有可提交的 ${itemName}（仓库与货仓都为空）。`,
    }
  }
  prog.delivered[itemId] = (prog.delivered[itemId] ?? 0) + took
  const tier = site.tiers[prog.stage]!
  addLog(state, 'info', `「${site.name}」已接收 ${itemName}×${took.toLocaleString('zh-CN')}（档位「${tier.name}」：${stationBillText(state, ctx, site)} 中「${itemName}」还差 ${billRemainingOf(state, site, prog.stage, itemId).toLocaleString('zh-CN')}）。`)
  advanceTierIfFull(state, ctx, site, prog)
  return { ok: true }
}

/**
 * 抵达挂点（历史调用方：悬赏胜利停留/扫描完成停留——2026-09-06 起两处均改为自动返航，
 * 本挂点仅由旧路径/历史代码触发；新到站入口 = 掩护巡逻到位 noteStationSiteAt + 手动返航）。
 * 2026-09-08（船长定）：未建成建站点不视为任何站点——星系内有**已建成**副站才停靠，
 * 否则一律作为工地现场野外停留；通讯挂起仅对未建成且介绍剧本未读生效。
 */
export function onArriveAtGalaxy(state: GameState, ctx: SimContext, galaxyId: string): void {
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === galaxyId)
  if (site && isSiteBuilt(state, site)) {
    state.awayGalaxy = null
    state.dockedSite = site.id
    addLog(state, 'info', `已停靠「${site.name}」（${galaxyName}）。`)
  } else {
    state.awayGalaxy = galaxyId
    addLog(state, 'info', `抵达「${galaxyName}」——协会的建站工地就在这里。`)
  }
  // 通讯：未建成 + 介绍剧本未读 → 自动挂起一次
  if (site && !isSiteBuilt(state, site) && site.introDialogueId && !state.dialogueSeen[site.introDialogueId]) {
    state.pendingDialogue = site.introDialogueId
  }
}

/** 通讯播放登记（UI 播放时调用）：逐句镜像进事件日志 + 标记已读 + 清待播 */
export function playDialogue(state: GameState, scriptId: string, ctx: SimContext, lines: readonly { speaker: string; text: string }[]): void {
  for (const line of lines) {
    addLog(state, 'info', `[通讯] ${line.speaker}：${line.text}`)
  }
  state.dialogueSeen[scriptId] = true
  if (state.pendingDialogue === scriptId) state.pendingDialogue = null
}

/**
 * 2026-09-06 轻量到位挂点（掩护巡逻即时驻留到建站星系时调用；悬赏胜利/扫描完成已不再停留，
 * 建站叙事入口改由这里承接）：星系有未建成建站点且介绍剧本未读 → 挂起待播通讯。
 * 驻留不自动停靠（工地/副站停靠仍走手动「返航空间站」）。
 */
export function noteStationSiteAt(state: GameState, ctx: SimContext, galaxyId: string): void {
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === galaxyId)
  if (!site) return
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return // 已建成：停靠走「返航空间站」，无需介绍
  if (site.introDialogueId && !state.dialogueSeen[site.introDialogueId]) {
    state.pendingDialogue = site.introDialogueId
    const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
    addLog(state, 'info', `舰船已抵达「${galaxyName}」——协会的建站工地就在这里。可现场提交建材；也可停靠空间站后一键「前往工地交付」。副站建成前不提供停靠与站内功能，建成后并入基地网络并开放泊位与全部服务。`)
  }
}
