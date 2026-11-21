import type { GameState } from './state'
import type { ModuleDef, ShipSlots, SimContext } from './types'
import { addLog, shipLockedReason } from './state'
import { shipOperationBlockReason } from './shipActionPolicy'
import { addWare } from './inventory'
import { shipSlotsOf } from './labels'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'
import { cpuBudgetOf, fittedCpuUsed, droneCpuUsed } from './equipmentCpu'
import { plugEffectPartsOf } from './plugEffects'

export function isPlugOf(def: Pick<ModuleDef, 'slot'> | undefined): boolean {
  return def?.slot === 'plug'
}

export function plugSlotsOf(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]
  const defId = ship?.defId
  if (defId === undefined) return 0
  return Math.max(0, ctx.ships.get(defId)?.plugSlots ?? 0)
}

export function plugsOf(state: GameState, shipId: string): string[] {
  return state.fleet[shipId]?.plugs ?? []
}

export function plugModulesOf(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const out: ModuleDef[] = []
  for (const id of plugsOf(state, shipId)) {
    const def = ctx.modules.get(id)
    if (def && isPlugOf(def)) out.push(def)
  }
  return out
}

export function plugEffectsOf(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  return plugEffectPartsOf(plugsOf(state, shipId), ctx).map(part => part.effective)
}

export type PlugSlotExpansionKind = 'mid' | 'low'

export function plugSlotExpansionKindOf(def: Pick<ModuleDef, 'slot' | 'midSlotsAdd' | 'lowSlotsAdd'> | undefined): PlugSlotExpansionKind | null {
  if (!isPlugOf(def)) return null
  if ((def?.midSlotsAdd ?? 0) > 0) return 'mid'
  if ((def?.lowSlotsAdd ?? 0) > 0) return 'low'
  return null
}

export function plugSlotExpansionBlockedOf(state: GameState, ctx: SimContext, shipId: string, def: ModuleDef): boolean {
  const kind = plugSlotExpansionKindOf(def)
  return kind !== null && plugModulesOf(state, ctx, shipId).some(existing => plugSlotExpansionKindOf(existing) === kind)
}

export function normalizePlugSlotExpansions(state: GameState, ctx: SimContext): string[] {
  let returned = 0
  const changedShips: string[] = []
  for (const [shipId, ship] of Object.entries(state.fleet)) {
    const plugs = ship?.plugs
    if (!plugs || plugs.length < 2) continue
    if (shipLockedReason(state, shipId) || state.aiAssignments[shipId]) continue
    if (state.shipReturns[shipId] || shipId === state.shipId &&
      (state.mining.active || state.salvaging.active || state.transit.active || state.standby.active ||
        state.hauling.active || state.expedition.active || state.sideTasks?.deliver)) continue
    const inBattle = [{ battle: state.expedition.battle, active: state.expedition.active, leader: state.shipId },
      { battle: state.encounter?.battle, active: state.encounter?.active, leader: state.encounter?.shipId ?? state.shipId }]
      .some(({ battle, active, leader }) => active && battle &&
        (battle.myFleet?.some(entry => entry.shipId === shipId) || !battle.myFleet?.length && leader === shipId))
    if (inBattle) continue
    const seen = new Set<PlugSlotExpansionKind>()
    const kept: string[] = []
    for (const id of plugs) {
      const kind = plugSlotExpansionKindOf(ctx.modules.get(id))
      if (kind !== null && seen.has(kind)) {
        state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
        returned++
        continue
      }
      if (kind !== null) seen.add(kind)
      kept.push(id)
    }
    if (kept.length === plugs.length) continue
    ship.plugs = kept
    changedShips.push(shipId)
    if (fleetDefOf(state, ctx, shipId)) {
      const slots = shipSlotsWithPlugsOf(state, ctx, shipId)
      for (const rack of ['mid', 'low'] as const) {
        const bays = ship.fitted[rack]
        for (const id of bays.slice(slots[rack])) if (id) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
        if (bays.length > slots[rack]) bays.length = slots[rack]
      }
    }
  }
  if (returned > 0) addLog(state, 'fleet', `插件整理：同类型扩槽插件超出限制，已免费退回装备库 ${returned} 件。`, 'core.plug.015', { p1: returned })
  return changedShips
}

export function plugInfoOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { slots: number; installed: ModuleDef[] } {
  return { slots: plugSlotsOf(state, ctx, shipId), installed: plugModulesOf(state, ctx, shipId) }
}

export function plugSlotAddsOf(state: GameState, ctx: SimContext, shipId: string): { mid: number; low: number } {
  let mid = 0
  let low = 0
  for (const p of plugModulesOf(state, ctx, shipId)) {
    mid += p.midSlotsAdd ?? 0
    low += p.lowSlotsAdd ?? 0
  }
  return { mid, low }
}

export function shipSlotsWithPlugsOf(state: GameState, ctx: SimContext, shipId: string): ShipSlots {
  const base = shipSlotsOf(fleetDefOf(state, ctx, shipId) ?? {})
  const add = plugSlotAddsOf(state, ctx, shipId)
  return { high: base.high, mid: base.mid + add.mid, low: base.low + add.low }
}

export function installPlug(
  state: GameState,
  ctx: SimContext,
  moduleId: string,
  shipId: string = state.shipId,
): { ok: true } | { ok: false; errorId?: string; error?: string; errorParams?: Readonly<Record<string, string | number>> } {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。`, errorId: 'core.equipment.001', errorParams: { p1: moduleId } }
  if (!isPlugOf(def)) {
    return { ok: false, error: `「${def.name}」不是舰船插件。`, errorId: 'core.plug.002', errorParams: { p1: def.name } }
  }
  const ship = state.fleet[shipId]
  if (!ship) return { ok: false, error: '舰队里找不到这艘舰船。', errorId: 'core.plug.003' }
  const blocked = shipOperationBlockReason(state, ctx, shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const lock = shipLockedReason(state, shipId, '安装舰船插件')
  if (lock) return { ok: false, error: lock }
  if (!moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), def)) {
    return { ok: false, errorId: 'core.equipment.033', error: '该货舰不支持武器、战斗机群、进攻电子或全队护盾装备。' }
  }
  const have = plugsOf(state, shipId)
  if (plugSlotExpansionBlockedOf(state, ctx, shipId, def)) {
    return { ok: false, errorId: 'core.plug.014', error: '同类型扩槽插件每舰只能安装一件。' }
  }
  const cap = plugSlotsOf(state, ctx, shipId)
  if (cap <= 0) {
    return { ok: false, error: `「${ctx.ships.get(ship.defId ?? '')?.name ?? shipId}」没有舰船插件槽。`, errorId: 'core.plug.004', errorParams: { p1: ctx.ships.get(ship.defId ?? '')?.name ?? shipId } }
  }
  if (have.length >= cap) {
    return { ok: false, error: `插件槽已满：本舰 ${cap} 格，且插件装上去就拆不下来。`, errorId: 'core.plug.005', errorParams: { p1: cap } }
  }
  if ((state.moduleBay[moduleId] ?? 0) < 1) {
    return { ok: false, error: `装备库里没有「${def.name}」，先去组装机造一件。`, errorId: 'core.equipment.002', errorParams: { p1: def.name } }
  }
  if ((def.cpuPenalty ?? 0) > 0) {
    const budget = cpuBudgetOf(state, ctx, shipId, undefined, [...have, moduleId])
    const used = fittedCpuUsed(ship.fitted, ctx, fleetDefOf(state, ctx, shipId)) + droneCpuUsed(ship.droneLoad, ctx)
    if (used > budget) return { ok: false, errorId: 'core.equipment.032', errorParams: { p1: used, p2: budget } }
  }
  const rest = (state.moduleBay[moduleId] ?? 0) - 1
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  ship.plugs = [...have, moduleId]
  const wantSlots = shipSlotsWithPlugsOf(state, ctx, shipId)
  for (const rack of ['mid', 'low'] as const) {
    const bays = ship.fitted?.[rack]
    if (!bays) continue
    while (bays.length < wantSlots[rack]) bays.push(null)
  }
  const shipName = state.fleet[shipId]?.customName ?? ctx.ships.get(ship.defId ?? '')?.name ?? shipId
  addLog(
    state,
    'fleet',
    `已为 ${shipName} 装上插件：${def.name}。插件装上后无法拆下。`,
    'core.plug.001',
    { p1: shipName, p2: def.name },
  )
  return { ok: true }
}

export interface ShipPlugBlock {
  textId: string
  params?: Record<string, string | number>
  text: string
}

export function plugBlockReasonOf(state: GameState, shipId: string): ShipPlugBlock | null {
  if (state.fleet[shipId]?.damagePlugs?.length) {
    return { textId: 'core.shipRecovery.003', text: '这艘船带有战损插件，不能放入舰船仓库或挂卖。' }
  }
  const plugs = plugsOf(state, shipId)
  if (plugs.length === 0) return null
  return {
    textId: 'core.plug.007',
    params: { p1: plugs.length },
    text: `这艘船装有 ${plugs.length} 件舰船插件，插件装上去就拆不下来——不能放入舰船仓库，也不能挂卖。`,
  }
}

export function plugsToBlackBoxesOf(plugIds: readonly string[]): number {
  return Math.max(0, plugIds.filter((id) => id.length > 0).length)
}


export const PLUG_BLUEPRINT_COST = 20

export const UNIVERSAL_BLACKBOX_COST = 60

export const UNIVERSAL_BLACKBOX_ITEM_ID = 'blackbox-universal'

export function exchangeUniversalBlackBox(
  state: GameState,
  count = 1,
): { ok: true; count: number } | { ok: false; errorId: string; error: string; errorParams?: Readonly<Record<string, string | number>> } {
  const n = Math.max(1, Math.floor(count))
  const price = UNIVERSAL_BLACKBOX_COST * n
  const have = spendableStandingOf(state)
  if (have < price) {
    return {
      ok: false,
      errorId: 'core.plug.013',
      errorParams: { p1: n, p2: price, p3: have },
      error: `声望不足：换通用黑匣 ×${n} 要 ${price} 点，当前可支配 ${have} 点。`,
    }
  }
  spendStanding(state, price)
  addWare(state, UNIVERSAL_BLACKBOX_ITEM_ID, n)
  addLog(
    state,
    'trade',
    `章鱼人兑换：花掉 ${price} 点协会声望，换到通用黑匣 ×${n}，已存入物品仓库。`,
    'core.plug.012',
    { p1: price, p2: n },
  )
  return { ok: true, count: n }
}

export function plugBlueprintIdOf(moduleId: string): string {
  return `bp-${moduleId}`
}

export function exchangePlugBlueprint(
  state: GameState,
  ctx: SimContext,
  moduleId: string,
): { ok: true; blueprintId: string } | { ok: false; errorId: string; error: string; errorParams?: Readonly<Record<string, string | number>> } {
  const def = ctx.modules.get(moduleId)
  if (!def || !isPlugOf(def)) {
    return { ok: false, errorId: 'core.plug.002', error: `「${moduleId}」不是舰船插件。`, errorParams: { p1: moduleId } }
  }
  if (def.blueprintExchangeDisabled === true) {
    return { ok: false, errorId: 'core.plug.016', error: '该势力插件图纸暂不可获得。' }
  }
  const bpId = plugBlueprintIdOf(moduleId)
  const bp = ctx.blueprints.get(bpId)
  if (!bp) {
    return { ok: false, errorId: 'core.plug.008', error: `图纸目录里没有「${bpId}」。` }
  }
  if ((state.learnedRecipes ?? []).includes(bpId)) {
    return { ok: false, errorId: 'core.plug.009', error: `已经学会「${bp.name}」了，不用再换。`, errorParams: { p1: bp.name } }
  }
  const have = spendableStandingOf(state)
  if (have < PLUG_BLUEPRINT_COST) {
    return {
      ok: false,
      errorId: 'core.plug.010',
      errorParams: { p1: bp.name, p2: PLUG_BLUEPRINT_COST, p3: have },
      error: `声望不足：换「${bp.name}」要 ${PLUG_BLUEPRINT_COST} 点，当前可支配 ${have} 点。`,
    }
  }
  spendStanding(state, PLUG_BLUEPRINT_COST)
  state.learnedRecipes.push(bpId)
  addLog(
    state,
    'trade',
    `章鱼人兑换：花掉 ${PLUG_BLUEPRINT_COST} 点协会声望，换到并学会 ${bp.name}，可直接在组装机无限次制造。`,
    'core.plug.011',
    { p1: PLUG_BLUEPRINT_COST, p2: bp.name },
  )
  return { ok: true, blueprintId: bpId }
}

export interface PlugExchangeRow {
  moduleId: string
  blueprintId: string
  name: string
  blueprintName: string
  cost: number
  learned: boolean
  affordable: boolean
}

export function plugExchangeRowsOf(state: GameState, ctx: SimContext): PlugExchangeRow[] {
  const have = spendableStandingOf(state)
  const rows: PlugExchangeRow[] = []
  for (const def of ctx.modules.values()) {
    if (!isPlugOf(def) || def.blueprintExchangeDisabled === true) continue
    const blueprintId = plugBlueprintIdOf(def.id)
    const bp = ctx.blueprints.get(blueprintId)
    if (!bp) continue
    rows.push({
      moduleId: def.id,
      blueprintId,
      name: def.name,
      blueprintName: bp.name,
      cost: PLUG_BLUEPRINT_COST,
      learned: (state.learnedRecipes ?? []).includes(blueprintId),
      affordable: have >= PLUG_BLUEPRINT_COST,
    })
  }
  return rows
}

function spendableStandingOf(state: GameState): number {
  return state.standings['dsi'] ?? 0
}

function spendStanding(state: GameState, v: number): boolean {
  const have = state.standings['dsi'] ?? 0
  if (have < v) return false
  state.standings['dsi'] = have - v
  return true
}
