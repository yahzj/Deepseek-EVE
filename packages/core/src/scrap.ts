/**
 * **拆船回收**（**2026-09-27 船长令**）。
 *
 * 船长原话（照抄）：「**在舰船插件处加入一个回收按钮，点击后警告玩家，想要回收插件需要将舰船拆解回收，
 * 确认后弹出二次警告，告诉玩家当前舰船能回收多少材料并且无法回收蓝图（回收材料占比为制造材料的50%）。
 * 回收后，当前舰船的装备全部拆卸入库，将舰船转化成材料，舰船插件也入库。**」
 *
 * 三条追问的裁定（船长当日确认）：货**一并入物品仓库** · 50% **逐项向下取整** ·
 * 船上无人机**一并入装备库** · 入口**只做在插件槽区**。
 *
 * 口径：
 * - **回收材料 = 该舰船蓝图料单 × 50%，每种向下取整**；取整后为 0 的项不发放也不列出；
 * - **蓝图书不返还**（界面二次警告里明写）；
 * - 高/中/低槽的**装备全部卸下进装备库**（`moduleBay`）· **插件进装备库** · **船上无人机进装备库**（`addWare` 的无人机物品）·
 *   **货舱货物进物品仓库**（复用 `unloadCargoOfShipToWarehouse` 单点）；
 * - **船只锁**：主控船（正在驾驶）与 AI 执勤 / 在途 / 洞内的船一律不许回收
 *   （判据 = `state.shipLockedReason` ＋ `state.shipId` 主控判定，与装配/入仓同一把尺）。
 *
 * ⚠ **不是战损那条路**：本模块**不调** `shipyard.loseShip`（那条会留残骸快照、记战损），
 * 回收是"玩家主动把船化成料"⇒ 只摘 `state.fleet` 条目 ＋ 发料 ＋ 记一条 `trade` 日志。
 */
import type { GameState } from './state'
import { addLog, shipLockedReason } from './state'
import type { SimContext } from './types'
import { addModule } from './equipment'
import { addWare, unloadCargoOfShipToWarehouse } from './inventory'
import { plugModulesOf, plugsOf } from './plugs'

/** **回收材料占比**（船长：「**回收材料占比为制造材料的50%**」） */
export const SHIP_SCRAP_MATERIAL_SHARE = 0.5

/** 可回收材料预览（界面二次警告用；逐项向下取整后仍 > 0 的才列） */
export interface ShipScrapPreview {
  /** 能不能回收（false ⇒ 看 `block` 的文案） */
  ok: boolean
  /** 不许回收的原因（本地化 id ＋ 中文原文） */
  blockId?: string
  block?: string
  /** 逐项可回收材料（数量已按 50% 向下取整） */
  materials: Array<{ itemId: string; count: number }>
  /** 随船一并入库的件数：装备（高/中/低槽）· 插件 · 无人机架数 · 货舱物品种类 */
  moduleCount: number
  plugCount: number
  droneCount: number
  cargoKinds: number
}

/** 该舰船的**制造料单**（船蓝图缺省按空表 ⇒ 回收不出料，只有装备/插件/货能救回来） */
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

/** 能不能回收这艘船（不许的原因走这里；`null` = 可以） */
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

/**
 * **回收预览**（唯一取数口：界面两次警告里的数字与真正发放**同一份算术**）。
 *
 * ⚠ 界面**不许自己算** 50%（否则警告里写的数与实际到手会飘）。
 */
export function shipScrapPreviewOf(state: GameState, ctx: SimContext, shipId: string): ShipScrapPreview {
  const ship = state.fleet[shipId]
  const defId = ship?.defId ?? ''
  const materials = shipBlueprintMaterialsOf(ctx, defId)
    .map((m) => ({ itemId: m.itemId, count: Math.floor(m.count * SHIP_SCRAP_MATERIAL_SHARE) }))
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

/**
 * **执行回收**（唯一入口；界面二次确认后调它）。
 *
 * 顺序：① 再判一次闸门（界面停留期间船可能被派走）⇒ ② 卸货入物品仓库 ⇒ ③ 发材料 ⇒
 * ④ 装备/插件/无人机入装备库 ⇒ ⑤ 摘掉 `state.fleet` 条目 ⇒ ⑥ 记一条 `trade` 日志。
 * 返回实发清单（供界面提示与用例断言）。
 */
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
  /** ② 货舱入物品仓库（单点；返回件数，本函数不用，但保持与卸货同一条路） */
  unloadCargoOfShipToWarehouse(state, ctx, shipId)
  /** ③ 材料（预览那份算术：同一份数，界面写多少就发多少） */
  for (const m of preview.materials) addWare(state, m.itemId, m.count)
  /** ④ 装备 / 插件 / 无人机入装备库 */
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
  /** ⑤ 摘掉舰队条目（**不走 `loseShip`**：回收不留残骸、不计战损） */
  delete state.fleet[shipId]
  /** ⑥ 台账 */
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
