import { ceilFinalQuantity } from '../../quantity'
import { refundOneTimeBookOf } from '../../state'
import type { GameState } from '../../state'
import type { BlueprintDef, ShipBlueprintDef, SimContext } from '../../types'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeManufacturingUnlocked } from '../../probeManufacturing'

/** 制造类蓝图的公共形状（装备蓝图与舰船蓝图共有的字段） */
export interface BuildSpec {
  materials: BlueprintDef['materials']
  buildSeconds: number
  buildCostIsk: number
  /** 零件档位（2026-09-20 零件体系：basic = 吃「零件成型工艺学」· advanced = 吃「精密装配学」） */
  partTier?: 'basic' | 'advanced'
  /** 隐式蓝图（2026-09-20 零件体系：基础零件无需学习即可开工） */
  learnless?: boolean
}

/** 按 id 解析一张可制造蓝图（先查装备/物品类蓝图，再查舰船蓝图；
 * 2026-09-05：弹药等物品类 = moduleId 缺省但带 itemId/outputUnits 的普通蓝图） */
export function findBuildable(
  ctx: SimContext,
  blueprintId: string,
): { kind: 'module' | 'ship' | 'item'; spec: BuildSpec; moduleId?: string; shipId?: string; itemId?: string; outputUnits?: number } | null {
  const bp = ctx.blueprints.get(blueprintId)
  if (bp) {
    if (bp.itemId !== undefined) {
      return { kind: 'item', spec: bp, itemId: bp.itemId, outputUnits: ceilFinalQuantity(bp.outputUnits ?? 1) }
    }
    return { kind: 'module', spec: bp, moduleId: bp.moduleId }
  }
  const shipBp = ctx.shipBlueprints.get(blueprintId)
  if (shipBp) {
    return { kind: 'ship', spec: shipBp, shipId: shipBp.shipId }
  }
  return null
}

/** 商店/界面用：蓝图的单次可用性（普通蓝图恒 `ok`；一次性蓝图按"名下名额 + 书架那本书"判定） */
export interface RecipeCapability {
  /** ok = 可以开工；learned = 已永久学会（无需书）；consumeBook = 本次开工要吃掉一本一次性书 */
  kind: 'ok' | 'learned' | 'need-book' | 'exhausted' | 'no-book'
  /** 本次开工是否要吃一本一次性书 */
  consumeBook: boolean
}

/** 是否临时占驻某个正开着的制造线（取消/完成即释放）——写进蓝图书架文案 */
export function oneTimeBookInUse(state: GameState, blueprintId: string): boolean {
  return state.manufacturingRuns.some((r) => r.active && r.blueprintId === blueprintId)
}

/**
 * **一次性图纸的可用性**（2026-09-12 船长裁定；普通蓝图恒 `ok`：
 * 只由 `startManufacturing` 的"是否已学会"把关，本函数不改旧行为）。
 *
 * 口径（逐条对应船长裁定）：
 * - **已永久学会** ⇒ `learned`：一次性书**不消耗也不用**（2乙：不作"学习"用，也不当材料吞）；
 * - **名额未用尽 且 书架有这本书** ⇒ `ok` + `consumeBook`（1甲：学了才能造一次，书当场吃掉）；
 * - **名额已用尽** ⇒ `exhausted`（要再造就**再有一本**）；
 * - **书架没有** ⇒ `no-book`。
 */
export function recipeCapability(state: GameState, blueprintId: string, singleUse: boolean): RecipeCapability {
  if (!singleUse) return { kind: 'ok', consumeBook: false }
  if (state.learnedRecipes.includes(blueprintId)) return { kind: 'learned', consumeBook: false }
  // ⚠ **书在架上就是可用**（名额用完只表示"上一张已吃掉"；再获得一张 = 又能造一次）——
  // 所以"有书"必须优先于"名单已用尽"判定，否则重复获得的图纸会被误拒（本批用例抓到过）。
  const stock = state.blueprintStock[blueprintId] ?? 0
  if (stock > 0) return { kind: 'ok', consumeBook: true }
  if ((state.spentOneTimeRecipes ?? []).includes(blueprintId)) return { kind: 'exhausted', consumeBook: false }
  return { kind: 'no-book', consumeBook: false }
}

/** 玩家是否已学会某配方（学习蓝图书后永久可造；两类通用） */
export function ownsBlueprint(state: GameState, blueprintId: string): boolean {
  return state.learnedRecipes.includes(blueprintId)
}

/** 蓝图**定义**（两类通用；找不到返回 undefined） */
export function blueprintDefOf(
  ctx: SimContext,
  blueprintId: string,
): BlueprintDef | ShipBlueprintDef | undefined {
  return ctx.blueprints.get(blueprintId) ?? ctx.shipBlueprints.get(blueprintId)
}

/**
 * **产物 → 蓝图的反查索引**（**2026-09-22 船长令**：「**组装机和造船厂需要零件时，提示不是去组装机，
 * 而是去市场**」⇒「**希望提示玩家去组装机生产零件，不要提示去市场**」＋「**高级零件依旧去相应的组装机**」）。
 *
 * 干什么：给定一个**物品 id**，回答"它能不能在这台组装机/造船厂里造出来、用哪张图造"——
 * 界面据此把缺料提示从「🛒 去市场」改成「🏭 去组装机」并**直接跳到那张零件卡**（零件不是炼出来的，
 * 是造出来的；指去市场等于把玩家支错地方）。
 *
 * 覆盖：**零件 14 种（基础 7 + 高级 7）** 以及任何"产物是物品"的蓝图（如弹药蓝图）。
 * **不影响**矿物/原材料（它们没有产出蓝图 ⇒ 走原来的「⚒ 去精炼」/「🛒 去市场」两支）。
 *
 * ⚠ **索引按 `ctx` 缓存**（`WeakMap`，与 §十四 性能纪律一致）：工业页一次要渲染上百张卡 × 每卡数行材料，
 * 逐行扫全表会变成 O(卡 × 行 × 蓝图) —— 缓存后每个 ctx 只建一次表，之后是 O(1) 查表。
 */
const productIndexCache = new WeakMap<SimContext, ReadonlyMap<string, BlueprintDef>>()

export function blueprintProducingItem(ctx: SimContext, itemId: string): BlueprintDef | null {
  let index = productIndexCache.get(ctx)
  if (index === undefined) {
    const map = new Map<string, BlueprintDef>()
    for (const bp of ctx.blueprints.values()) {
      // 一张图只产一种物品；同产物多图时**先登记的那张为准**（数据表顺序 = 稳定顺序，够用且可复现）
      if (bp.itemId !== undefined && bp.itemId.length > 0 && !map.has(bp.itemId)) map.set(bp.itemId, bp)
    }
    index = map
    productIndexCache.set(ctx, index)
  }
  return index.get(itemId) ?? null
}

/** 该蓝图是否一次性图纸（2026-09-12 船长定；缺省 false = 普通蓝图） */
export function isSingleUseBlueprint(ctx: SimContext, blueprintId: string): boolean {
  return blueprintDefOf(ctx, blueprintId)?.singleUse === true
}

/**
 * 该蓝图当前能否开工（界面按钮可用性用；**与 `startManufacturing` 同源判定**）。
 *
 * ⚠ **2026-09-14 修（船长报障「组装机原先没有图纸时会跳转到市场求购的按钮怎么没了」）**：
 * 原先写成 `ownsBlueprint || recipeCapability(state, id, isSingleUse).kind === 'ok'`，而
 * `recipeCapability(..., singleUse=false)` 对**普通图纸恒返回 `ok`**（那是"配方可用"、不是"现在能开工"）
 * ⇒ 未学会的普通图纸也返回 true ⇒ 组装机卡片永远走"能造/手动制造"那一支，
 * **「市场求购蓝图书」按钮整个轮不到**（实测 181 张里 123 张普通图纸全被吃掉）。
 * 现在逐条对齐 `startManufacturing` 的把关：**已学会 ⇒ true；一次性图纸 ⇒ 书架有书且名额未用尽；
 * 其余（未学会的普通图纸）⇒ false**。
 */
export function canStartBlueprint(state: GameState, ctx: SimContext, blueprintId: string): boolean {
  if (blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID && !probeManufacturingUnlocked(state)) return false
  if (ownsBlueprint(state, blueprintId)) return true
  // 2026-09-20 零件体系：隐式蓝图（基础零件）无需学习即可开工
  if (ctx.blueprints.get(blueprintId)?.learnless === true) return true
  if (!isSingleUseBlueprint(ctx, blueprintId)) return false
  return recipeCapability(state, blueprintId, true).kind === 'ok'
}

/**
 * **吃掉一本一次性书**并把名额记为已用尽（开工那一刻调用，与材料扣除同源）。
 * 返回 false = 书架已无书（调用方应视为开工失败）。
 *
 * ⚠ **取消时会原样还回来**（2026-09-20 船长：「一次性蓝图的制造取消后返还玩家蓝图」）
 * ⇒ 退书必须走 `refundOneTimeBook`，把"书"与"名额标记"**一起**恢复，否则书回来了仍判 `exhausted`。
 */
export function spendOneTimeBook(state: GameState, blueprintId: string): boolean {
  const c = state.blueprintStock[blueprintId] ?? 0
  if (c <= 0) return false
  if (c - 1 <= 0) delete state.blueprintStock[blueprintId]
  else state.blueprintStock[blueprintId] = c - 1
  const spent = (state.spentOneTimeRecipes ??= [])
  if (!spent.includes(blueprintId)) spent.push(blueprintId)
  return true
}

/**
 * **退还一本一次性书**（取消制造 / 自动停机共用）。
 *
 * ⚠ **实现已上移到 `state.refundOneTimeBookOf`**（2026-09-24）：自动停机那条路
 * （`state.haltActivityForSwitch`）**没有 ctx**，而退书只需要 state ⇒ 让两条路共用一份逻辑，
 * 免得"取消退书、停机不退书"这种不对称再次出现（玩家报障的正是它）。本函数只保留名字与调用点，
 * 语义逐字不变（书 +1、名额标记按"还有同名线在跑"决定是否摘除）。
 */
export function refundOneTimeBook(state: GameState, blueprintId: string): boolean {
  return refundOneTimeBookOf(state, blueprintId)
}

/** 蓝图显示名 */
export function blueprintName(ctx: SimContext, blueprintId: string): string {
  return ctx.blueprints.get(blueprintId)?.name ?? ctx.shipBlueprints.get(blueprintId)?.name ?? blueprintId
}

/** 产物显示名（module=装备 / ship=舰船 / item=弹药等物品；记录缺失回退 fallback） */
export function productNameOf(ctx: SimContext, b: NonNullable<ReturnType<typeof findBuildable>>, fallback: string): string {
  if (b.kind === 'item') return ctx.items.get(b.itemId ?? '')?.name ?? fallback
  if (b.kind === 'module') return ctx.modules.get(b.moduleId ?? '')?.name ?? fallback
  return ctx.ships.get(b.shipId ?? '')?.name ?? fallback
}
