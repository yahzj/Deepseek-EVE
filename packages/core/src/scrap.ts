import { ceilFinalQuantity } from './quantity'
import type { GameState } from './state'
import { addLog, shipLockedReason } from './state'
import type { SimContext } from './types'
import { addModule } from './equipment'
import { addWare, unloadCargoOfShipToWarehouse } from './inventory'
import { plugModulesOf, plugsOf } from './plugs'

export const SHIP_SCRAP_MATERIAL_SHARE = 0.5

export interface ShipScrapPreview {
  ok: boolean
  blockId?: string
  block?: string
  materials: Array<{ itemId: string; count: number }>
  moduleCount: number
  plugCount: number
  droneCount: number
  cargoKinds: number
}

function shipBlueprintMaterialsOf(
  ctx: SimContext,
  defId: string,
): readonly { itemId: string; count: number }[] {
  const direct = ctx.shipBlueprints.get(defId)
  if (direct !== undefined) return direct.materials
  for (const bp of ctx.shipBlueprints.values()) {
    if (bp.shipId === defId) return bp.materials
  }
  return []
}

function scrapBlockReasonOf(state: GameState, shipId: string): { id: string; text: string } | null {
  if (state.fleet[shipId] === undefined) {
    return { id: 'core.scrap.002', text: '舰队里找不到这艘舰船。' }
  }
  if (state.shipId === shipId) {
    return { id: 'core.scrap.002', text: '正在驾驶的舰船不能回收：先换一艘驾驶再来。' }
  }
  const lock = shipLockedReason(state, shipId, '回收它')
  if (lock !== null && lock !== undefined) {
    return { id: 'core.scrap.002', text: lock }
  }
  return null
}

export function shipScrapPreviewOf(state: GameState, ctx: SimContext, shipId: string): ShipScrapPreview {
  const ship = state.fleet[shipId]
  const defId = ship?.defId ?? ''
  const materials = shipBlueprintMaterialsOf(ctx, defId)
    .map((m) => ({ itemId: m.itemId, count: ceilFinalQuantity(m.count * SHIP_SCRAP_MATERIAL_SHARE) }))
    .filter((m) => m.count > 0)
  const fitted = ship?.fitted
  const moduleCount = fitted === undefined ? 0 : [...fitted.high, ...fitted.mid, ...fitted.low].filter((x) => x !== null).length
  const plugCount = plugsOf(state, shipId).length
  const droneCount = Object.values(ship?.droneLoad ?? {}).reduce((n, x) => n + Math.max(0, Math.round(x)), 0)
  const cargoKinds = Object.values(ship?.cargo ?? {}).filter((x) => Math.round(x) > 0).length
  const block = scrapBlockReasonOf(state, shipId)
  return {
    ok: block === null,
    ...(block !== null ? { blockId: block.id, block: block.text } : {}),
    materials,
    moduleCount,
    plugCount,
    droneCount,
    cargoKinds,
  }
}

export function scrapShip(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { ok: true; materials: Array<{ itemId: string; count: number }>; modules: number; plugs: number; drones: number } | { ok: false; errorId: string; error: string } {
  const preview = shipScrapPreviewOf(state, ctx, shipId)
  if (!preview.ok) {
    return { ok: false, errorId: preview.blockId ?? 'core.scrap.002', error: preview.block ?? '这艘舰船现在不能回收。' }
  }
  const ship = state.fleet[shipId]!
  const defId = ship.defId ?? ''
  unloadCargoOfShipToWarehouse(state, ctx, shipId)
  for (const m of preview.materials) addWare(state, m.itemId, m.count)
  let modules = 0
  for (const id of [...(ship.fitted?.high ?? []), ...(ship.fitted?.mid ?? []), ...(ship.fitted?.low ?? [])]) {
    if (id === null || id === undefined) continue
    addModule(state, id, 1)
    modules += 1
  }
  for (const def of plugModulesOf(state, ctx, shipId)) {
    addModule(state, def.id, 1)
  }
  const plugs = plugsOf(state, shipId).length
  let drones = 0
  for (const [artId, n] of Object.entries(ship.droneLoad ?? {})) {
    const k = Math.max(0, Math.round(n))
    if (k <= 0) continue
    addWare(state, artId, k)
    drones += k
  }
  void defId
  delete state.fleet[shipId]
  addLog(
    state,
    'trade',
    `拆船回收：${ctx.ships.get(defId)?.name ?? shipId} 已拆解 —— 回收材料 ${preview.materials.length} 种（制造料单的 50%），` +
      `装备 ×${modules} · 插件 ×${plugs} · 无人机 ×${drones} 已入装备库，货舱已入物品仓库。`,
    'core.scrap.001',
    { p1: preview.materials.length, p2: modules, p3: plugs, p4: drones },
  )
  return { ok: true, materials: preview.materials, modules, plugs, drones }
}
