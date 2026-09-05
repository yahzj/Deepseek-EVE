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

/** 当前档还差多少单位（0 = 本档已满，等待推进结算） */
export function tierRemaining(state: GameState, site: StationSiteDef): number {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return 0
  const tier = site.tiers[prog.stage]!
  return Math.max(0, tier.count - tierDeliveredTotal(prog, site))
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
  if (!site.acceptItemIds.includes(itemId)) {
    return { ok: false, error: `「${site.name}」不收这种材料——需要：${site.acceptItemIds.map((i) => ctx.items.get(i)?.name ?? i).join(' / ')}。` }
  }
  const want = Math.floor(units)
  if (!Number.isFinite(want) || want <= 0) return { ok: false, error: '提交数量必须是正整数。' }
  // 前置：停靠在该站点（副站工地施工需船在场）
  const dockedHere =
    state.awayGalaxy === null && (state.dockedSite === siteId || (state.dockedSite === null && site.galaxyId === HOME_GALAXY_ID))
  if (!dockedHere) {
    return { ok: false, error: `需停靠在「${site.name}」（${ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId}）才能提交建材。` }
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
  // 建筑工程学（station-engineering）：本次交付进度 +8%/级（等价减少所需物资；只放大本次，防历史复合膨胀）
  const engLv = Math.min(5, state.skills.trained['station-engineering'] ?? 0)
  const credited = engLv > 0 ? Math.floor(took * (1 + 0.08 * engLv)) : took
  prog.delivered[itemId] = (prog.delivered[itemId] ?? 0) + credited
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
    addLog(state, 'info', `舰船已抵达「${galaxyName}」——协会的建站工地就在这里（未建成，可「返航空间站」停靠施工/卸料）。`)
  }
}
