/**
 * T9 副空间站引擎：建造进度、资源交付（分档边交边生效）、
 * "抵达站点星系"挂点（停靠副站/野外工地 + 通讯剧本自动触发）。
 * 空间站并入 stationGalaxyIds 由 stage>=tiers.length 表达（见 location.ts）。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState, StationSiteProgress } from './state'
import type { CommandResult } from './engine'
import type { SimContext, StationSiteDef } from './types'
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

/** 当前档已缴合计（接受名单内条目求和；档间切换时清零重计） */
export function tierDeliveredTotal(prog: StationSiteProgress, site: StationSiteDef): number {
  let total = 0
  for (const id of site.acceptItemIds) total += prog.delivered[id] ?? 0
  return total
}

/**
 * 某档建材需求（建筑工程学 station-engineering 改版，2026-09-08 船长定）：
 * 从"交付计件放大 ×(1+8%/级)"改为"需求直减"——每档需求 ×(1 − 8%/级)，满级 −40%，最少 1 单位。
 */
export function tierNeedOf(state: GameState, site: StationSiteDef, tierIndex: number): number {
  const tiers = site.tiers
  if (tierIndex < 0 || tierIndex >= tiers.length) return 0
  const engLv = Math.min(5, state.skills.trained['station-engineering'] ?? 0)
  return Math.max(1, Math.ceil(tiers[tierIndex]!.count * (1 - 0.08 * engLv)))
}

/** 玩家是否在该建站点"工地现场"（可提交建材，2026-09-06 紧急修复——玩家反馈无法提交）：
 * - 停靠该站（已停靠工地/建成站）；
 * - 野外停留于站点所在星系（掩护巡逻/作业到场即工地现场——首档『奠基』本就需先到工地
 *   交付才能解锁泊位，不能再要求"先停靠"；建成前「返航空间站」只去已建成站/母港）；
 * 母港特例：站点若设在母港星系，停靠母港即可（保留历史口径）。 */
export function playerAtSite(state: GameState, site: StationSiteDef): boolean {
  if (state.awayGalaxy === null) {
    return state.dockedSite === site.id || (state.dockedSite === null && site.galaxyId === HOME_GALAXY_ID)
  }
  return state.awayGalaxy === site.galaxyId
}

/** 当前档还差多少单位（0 = 本档已满，等待推进结算） */
export function tierRemaining(state: GameState, site: StationSiteDef): number {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return 0
  return Math.max(0, tierNeedOf(state, site, prog.stage) - tierDeliveredTotal(prog, site))
}

/**
 * 玩家指令：在目标副站提交资源（任意接受名单组合；从物品仓库 + 驾驶船货仓扣取）。
 * 前置：舰船停靠在该站点（母港/别处仓库无法"跨航区施工"）。
 */
export function deliverStationResources(
  state: GameState,
  ctx: SimContext,
  siteId: string,
  itemId: string,
  units: number,
): CommandResult {
  const site = ctx.stations.get(siteId)
  if (!site) return { ok: false, error: `未知建站点：${siteId}。` }
  let prog = state.stationSites[siteId]
  if (!prog) {
    prog = { stage: 0, delivered: {} }
    state.stationSites[siteId] = prog // 落库，避免只改临时默认对象
  }
  if (prog.stage >= site.tiers.length) return { ok: false, error: `「${site.name}」已建成，无需再提交。` }
  // 兼容旧档（旧"计件放大"口径会把虚高已缴写进 delivered）：需求直减后已缴可能 ≥ 需求而未推进 →
  // 先自动结算推进（最多顺推 6 档防御环）；顺推后整站建成按建成处理。
  let compatAdvanced = 0
  while (
    prog.stage < site.tiers.length &&
    compatAdvanced < 6 &&
    tierDeliveredTotal(prog, site) > 0 &&
    tierRemaining(state, site) <= 0
  ) {
    const doneTier = site.tiers[prog.stage]!
    prog.stage += 1
    prog.delivered = {}
    compatAdvanced++
    if (prog.stage < site.tiers.length) {
      addLog(state, 'info', `「${site.name}」档位「${doneTier.name}」自动结算（需求口径改版）：下一档「${site.tiers[prog.stage]!.name}」开始。`)
    }
  }
  if (prog.stage >= site.tiers.length) {
    if (compatAdvanced > 0) {
      addLog(state, 'trade', `⌂ 「${site.name}」建成并网（需求口径改版后自动结算）！已并入空间站网络。`)
    }
    return { ok: false, error: `「${site.name}」已建成，无需再提交。` }
  }
  if (!site.acceptItemIds.includes(itemId)) {
    return { ok: false, error: `「${site.name}」不收这种材料——需要：${site.acceptItemIds.map((i) => ctx.items.get(i)?.name ?? i).join(' / ')}。` }
  }
  const want = Math.floor(units)
  if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '提交数量必须是正整数。' }
  // 前置：在工地现场（停靠该站或野外停留于站点星系——母港仓库无法"跨航区施工"，但船在现场即可卸料）
  if (!playerAtSite(state, site)) {
    const g = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
    return { ok: false, error: `需抵达「${site.name}」工地（${g}）才能提交建材——掩护巡逻/作业到场即可，无需停靠。` }
  }
  const need = Math.min(want, tierRemaining(state, site))
  if (need <= 0) return { ok: false, error: '当前档位的建材需求已满足，先提交更多即可结算该档。' }

  const itemName = ctx.items.get(itemId)?.name ?? itemId
  let took = 0
  // 1) 物品仓库
  const ware = state.warehouse.items
  const fromWare = Math.min(need, ware[itemId] ?? 0)
  if (fromWare > 0) {
    ware[itemId] = (ware[itemId] ?? 0) - fromWare
    if (ware[itemId] <= 0) delete ware[itemId]
    took += fromWare
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
    return { ok: false, error: `没有可提交的 ${itemName}（仓库与货仓都为空）。` }
  }
  // 需求直减见 tierNeedOf（建筑工程学 −8%/级）：交付一律按实收计件
  prog.delivered[itemId] = (prog.delivered[itemId] ?? 0) + took
  const tier = site.tiers[prog.stage]!
  const remain = tierRemaining(state, site)
  addLog(
    state,
    'info',
    `「${site.name}」已接收 ${itemName}×${took.toLocaleString('zh-CN')}（档位「${tier.name}」还差 ${remain.toLocaleString('zh-CN')} 单位）。`,
  )
  // 本档凑齐 → 推进档位（边交边生效）
  if (remain <= 0) {
    prog.stage += 1
    prog.delivered = {}
    if (prog.stage >= site.tiers.length) {
      // 建成：并入空间站清单 + 庆贺通讯
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
      addLog(state, 'info', `「${site.name}」档位完成「${tier.name}」：${tier.unlockDesc}。下一档「${next.name}」需 ${next.count.toLocaleString('zh-CN')} 单位。`)
    }
  }
  return { ok: true }
}

/**
 * 抵达挂点（历史调用方：悬赏胜利停留/扫描完成停留——2026-09-06 起两处均改为自动返航，
 * 本挂点仅由旧路径/历史代码触发；新到站入口 = 掩护巡逻到位 noteStationSiteAt + 手动返航）：
 * 1) 该星系有建站点：已奠基（stage≥1）→ 直接停靠该站；未奠基 → 作为野外工地停留；
 * 2) 通讯触发：站点未建成且介绍剧本未读 → 挂起待播。
 */
export function onArriveAtGalaxy(state: GameState, ctx: SimContext, galaxyId: string): void {
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === galaxyId)
  if (!site) {
    state.awayGalaxy = galaxyId
    return
  }
  const prog = siteProgress(state, site.id)
  if (prog.stage >= 1) {
    // 已奠基：可停靠（随档位开放服务由外部系统按 stage 判断）
    state.awayGalaxy = null
    state.dockedSite = site.id
    addLog(state, 'info', `已停靠「${site.name}」（${galaxyName}）。`)
  } else {
    state.awayGalaxy = galaxyId
    addLog(state, 'info', `抵达「${galaxyName}」——协会的建站工地就在这里。`)
  }
  // 通讯：未建成 + 介绍剧本未读 → 自动挂起一次
  if (prog.stage < site.tiers.length && site.introDialogueId && !state.dialogueSeen[site.introDialogueId]) {
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
    addLog(state, 'info', `舰船已抵达「${galaxyName}」——协会的建站工地就在这里。任务中心·建站卡可直接提交建材（现场交付，无需停靠）；首档完成后解锁泊位。`)
  }
}
