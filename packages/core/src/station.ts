import { addLog, HOME_GALAXY_ID, isSiteBuilt, siteProgress } from './state'
import type { GameState, StationSiteProgress } from './state'
import type { CommandResult } from './engine'
import type { SimContext, StationSiteDef } from './types'
import { cargoOfShip } from './inventory'
import { peakFirst } from './firstTasks'
import { deliverDialogueToComms } from './commsDelivery'

export function stationSiteAtGalaxy(ctx: SimContext, galaxyId: string): StationSiteDef | undefined {
  for (const s of ctx.stations.values()) if (s.galaxyId === galaxyId) return s
  return undefined
}

export function isGalaxyStationBuilt(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  const site = stationSiteAtGalaxy(ctx, galaxyId)
  return site !== undefined && isSiteBuilt(state, site)
}

export function tierBillOf(site: StationSiteDef, tierIndex: number): ReadonlyArray<{ itemId: string; count: number }> {
  const tier = site.tiers[tierIndex]
  return tier ? tier.bill : []
}

function engFactor(state: GameState): number {
  const engLv = Math.min(5, state.skills.trained['station-engineering'] ?? 0)
  return 1 - 0.08 * engLv
}

export function billNeedOf(state: GameState, site: StationSiteDef, tierIndex: number, itemId: string): number {
  const bill = tierBillOf(site, tierIndex)
  const item = bill.find((b) => b.itemId === itemId)
  if (!item) return 0
  const factor = engFactor(state)
  const baseNeed = Math.max(1, Math.ceil(item.count * factor))
  const credit = site.tiers[tierIndex]?.legacyDeliveredCredit
  const prog = siteProgress(state, site.id)
  if (!credit || prog.stage !== tierIndex) return baseNeed

  let value = 0
  for (const [id, unitValue] of Object.entries(credit.previousUnitValues)) {
    if (bill.some(row => row.itemId === id) || !Number.isFinite(unitValue) || unitValue <= 0) continue
    const delivered = prog.delivered[id] ?? 0
    if (Number.isSafeInteger(delivered) && delivered > 0) value += delivered * unitValue
  }
  if (!Number.isSafeInteger(value) || value <= 0) return baseNeed
  for (const row of bill) {
    const need = Math.max(1, Math.ceil(row.count * factor))
    const missing = Math.max(0, need - (prog.delivered[row.itemId] ?? 0))
    const unitValue = credit.currentUnitValues[row.itemId] ?? 0
    const covered = unitValue > 0 && Number.isFinite(unitValue) ? Math.min(missing, Math.ceil(value / unitValue)) : 0
    if (row.itemId === itemId) return need - covered
    value = Math.max(0, value - covered * unitValue)
  }
  return baseNeed
}

export function tierNeedOf(state: GameState, site: StationSiteDef, tierIndex: number): number {
  let total = 0
  for (const item of tierBillOf(site, tierIndex)) total += billNeedOf(state, site, tierIndex, item.itemId)
  return total
}

export function billDeliveredOf(prog: StationSiteProgress, site: StationSiteDef, tierIndex: number, itemId: string): number {
  if (!tierBillOf(site, tierIndex).some((b) => b.itemId === itemId)) return 0
  return prog.delivered[itemId] ?? 0
}

export function billRemainingOf(state: GameState, site: StationSiteDef, tierIndex: number, itemId: string): number {
  return Math.max(0, billNeedOf(state, site, tierIndex, itemId) - billDeliveredOf(siteProgress(state, site.id), site, tierIndex, itemId))
}

export function playerAtSite(state: GameState, site: StationSiteDef): boolean {
  if (state.awayGalaxy === null) {
    return state.dockedSite === site.id || (state.dockedSite === null && site.galaxyId === HOME_GALAXY_ID)
  }
  return state.awayGalaxy === site.galaxyId
}

export function tierRemaining(state: GameState, site: StationSiteDef): number {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return 0
  let total = 0
  for (const item of tierBillOf(site, prog.stage)) {
    total += billRemainingOf(state, site, prog.stage, item.itemId)
  }
  return total
}

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

export function stationBillText(state: GameState, ctx: SimContext, site: StationSiteDef): string {
  return stationBillView(state, ctx, site)
    .map((r) => `${r.itemName}×${r.need.toLocaleString('zh-CN')}`)
    .join('、')
}

export function tierFulfilled(state: GameState, site: StationSiteDef): boolean {
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return true
  for (const item of tierBillOf(site, prog.stage)) {
    if (billRemainingOf(state, site, prog.stage, item.itemId) > 0) return false
  }
  return true
}

function advanceTierIfFull(state: GameState, ctx: SimContext, site: StationSiteDef, prog: StationSiteProgress): void {
  let guard = 0
  while (prog.stage < site.tiers.length && guard++ < 6 && tierFulfilled(state, site)) {
    const doneTier = site.tiers[prog.stage]!
    prog.stage += 1
    prog.delivered = {}
    if (prog.stage >= site.tiers.length) {
      let built = 0
      for (const s of ctx.stations.values()) {
        const p = state.stationSites[s.id]
        if (p && p.stage >= s.tiers.length) built += 1
      }
      peakFirst(state, 'sitesBuilt', built)
      if (built === 1) {
        addLog(
          state,
          'system',
          '⌂ 首座空间站并网：工业页「实验室」已解锁 —— 可合成超空间折跃燃料；舰船页「跃迁燃料」页可设置哪些活动使用燃料。',
          'core.station.014',
        )
      }
      addLog(
        state,
        'trade',
        `⌂ 「${site.name}」建成并网！已并入空间站网络（卸货/维修/补给/换驾驶可用，采矿返航按最近空间站解析）。`,
      )
      if (site.doneDialogueId && !state.dialogueSeen[site.doneDialogueId]) {
        state.pendingDialogue = site.doneDialogueId
        deliverDialogueToComms(state, ctx, site.doneDialogueId)
      }
    } else {
      const next = site.tiers[prog.stage]!
      addLog(
        state,
        'fleet',
        `「${site.name}」档位完成「${doneTier.name}」：${doneTier.unlockDesc ?? '施工推进'}。下一档「${next.name}」材料单：${stationBillText(state, ctx, site)}。`,
      )
    }
  }
}

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
  if (!site) {
    return { ok: false, error: `未知建站点：${siteId}。`, errorId: 'core.station.001', errorParams: { p1: siteId } }
  }
  let prog = state.stationSites[siteId]
  if (!prog) {
    prog = { stage: 0, delivered: {} }
    state.stationSites[siteId] = prog
  }
  if (prog.stage >= site.tiers.length) {
    return {
      ok: false,
      error: `「${site.name}」已建成，无需再提交。`,
      errorId: 'core.station.002',
      errorParams: { p1: site.name },
    }
  }
  advanceTierIfFull(state, ctx, site, prog)
  if (prog.stage >= site.tiers.length) {
    return {
      ok: false,
      error: `「${site.name}」已建成，无需再提交。`,
      errorId: 'core.station.002',
      errorParams: { p1: site.name },
    }
  }
  const itemName = ctx.items.get(itemId)?.name ?? itemId
  if (billRemainingOf(state, site, prog.stage, itemId) <= 0) {
    return {
      ok: false,
      error: `「${site.name}」当前档不收这种材料或已收齐——本档材料单：${stationBillText(state, ctx, site)}。`,
      errorId: 'core.station.003',
      errorParams: { p1: site.name, p2: stationBillText(state, ctx, site) },
    }
  }
  const want = Math.floor(units)
  if (!Number.isFinite(want) || want <= 0) {
    return { ok: false, error: '提交数量必须是正整数。', errorId: 'core.station.004' }
  }
  if (!playerAtSite(state, site)) {
    const g = ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId
    return {
      ok: false,
      error: `需抵达「${site.name}」工地（${g}）才能提交建材——掩护巡逻/作业到场即可，无需停靠。`,
      errorId: 'core.station.005',
      errorParams: { p1: site.name, p2: g },
    }
  }
  const need = Math.min(want, billRemainingOf(state, site, prog.stage, itemId))
  if (need <= 0) {
    return {
      ok: false,
      error: '该材料当前档已收齐（整档未满前可继续提交材料单上其它项）。',
      errorId: 'core.station.006',
    }
  }

  let took = 0
  if (!cargoOnly) {
    const ware = state.warehouse.items
    const fromWare = Math.min(need, ware[itemId] ?? 0)
    if (fromWare > 0) {
      ware[itemId] = (ware[itemId] ?? 0) - fromWare
      if (ware[itemId] <= 0) delete ware[itemId]
      took += fromWare
    }
  }
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
      errorId: cargoOnly ? 'core.station.007' : 'core.station.008',
      errorParams: { p1: itemName },
    }
  }
  prog.delivered[itemId] = (prog.delivered[itemId] ?? 0) + took
  const tier = site.tiers[prog.stage]!
  addLog(
    state,
    'fleet',
    `「${site.name}」已接收 ${itemName}×${took.toLocaleString('zh-CN')}（档位「${tier.name}」：${stationBillText(state, ctx, site)} 中「${itemName}」还差 ${billRemainingOf(state, site, prog.stage, itemId).toLocaleString('zh-CN')}）。`,
    'core.station.009',
    {
      p1: site.name,
      p2: itemName,
      p3: took.toLocaleString('zh-CN'),
      p4: tier.name,
      p5: stationBillText(state, ctx, site),
      p6: billRemainingOf(state, site, prog.stage, itemId).toLocaleString('zh-CN'),
    },
  )
  advanceTierIfFull(state, ctx, site, prog)
  return { ok: true }
}

export function onArriveAtGalaxy(state: GameState, ctx: SimContext, galaxyId: string): void {
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === galaxyId)
  if (site && isSiteBuilt(state, site)) {
    state.awayGalaxy = null
    state.dockedSite = site.id
    addLog(state, 'fleet', `已停靠「${site.name}」（${galaxyName}）。`, 'core.station.010', { p1: site.name, p2: galaxyName })
  } else {
    state.awayGalaxy = galaxyId
    addLog(state, 'fleet', `抵达「${galaxyName}」——协会的建站工地就在这里。`, 'core.station.011', { p1: galaxyName })
  }
  if (site && !isSiteBuilt(state, site) && site.introDialogueId && !state.dialogueSeen[site.introDialogueId]) {
    state.pendingDialogue = site.introDialogueId
    deliverDialogueToComms(state, ctx, site.introDialogueId)
  }
}

export function playDialogue(state: GameState, scriptId: string, ctx: SimContext, lines: readonly { speaker: string; text: string }[]): void {
  for (const line of lines) {
    addLog(state, 'info', `[通讯] ${line.speaker}：${line.text}`, 'core.station.012', { p1: line.speaker, p2: line.text })
  }
  state.dialogueSeen[scriptId] = true
  if (state.pendingDialogue === scriptId) state.pendingDialogue = null
  deliverDialogueToComms(state, ctx, scriptId)
}

export function noteStationSiteAt(state: GameState, ctx: SimContext, galaxyId: string): void {
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === galaxyId)
  if (!site) return
  const prog = siteProgress(state, site.id)
  if (prog.stage >= site.tiers.length) return
  if (site.introDialogueId && !state.dialogueSeen[site.introDialogueId]) {
    state.pendingDialogue = site.introDialogueId
    deliverDialogueToComms(state, ctx, site.introDialogueId)
    const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
    addLog(
      state,
      'fleet',
      `舰船已抵达「${galaxyName}」——协会的建站工地就在这里。可现场提交建材；也可停靠空间站后一键「前往工地交付」。副站建成前不提供停靠与站内功能，建成后并入基地网络并开放泊位与全部服务。`,
      'core.station.013',
      { p1: galaxyName },
    )
  }
}
