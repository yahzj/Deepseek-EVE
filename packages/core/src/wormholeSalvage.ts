/**
 * **终局玩法「虫洞」· 层内地点的产出与打捞**（F3b · 2026-09-13 船长裁定）。
 *
 * 口径（船长原话与落档见 `docs/design/wormhole-extraction-endgame-20260912.md` §11.5/§11.6）：
 * - **打捞要打捞器**：「打捞需要玩家舰船至少有一个打捞器，每个打捞器每次能回收 1 堆残骸」
 *   ⇒ 一次打捞动作（1 回合）回收 = **编队打捞器台数** 的堆，总回合 = **⌈堆数 ÷ 台数⌉**；
 * - **优先稀有残骸**：堆按"稀有在前"生成，回收从头拿 ⇒ 回合不够时留下的是普通残骸；
 * - **墓场**：普通残骸 **3~10 堆** + 「**每 3 堆普通，进行一次稀有残骸出现判断**」（单次 35%）
 *   ⇒ 稀有堆数 ≤ ⌊普通堆数 ÷ 3⌋；
 * - **遗迹**：**稀有残骸 2~3 堆**（船长：「新规则只针对墓场。遗迹不影响。」）+ 小概率专属掉落
 *   + **打捞结束大概率触发一场恶战**（70% / 本层威胁 ×1.3）；
 * - **舰船信号**：打赢固定给残骸 2 堆 + 稀有残骸 1 堆；**矿脉**：虚空母矿 1~3 堆。
 *
 * **按族**（船长：「虫洞专属掉落按种族库走，蓝图也是按种族库」）：残骸物品与专属掉落都跟着
 * **本格的敌卡族**走（`wormholeCardIdFor(depth, 格序号)`；五族 A/C/D/E/G 各有一张洞内卡）。
 *
 * ⚠ **依赖方向**：`wormholeBattle → wormholeSalvage → { wormhole, wormholeGrid, wormholeFoes,
 * salvaging, equipment }`；**`wormhole.ts` 不许 import 本文件**（它被 `state.ts` 顶层引用，
 * 而本文件经 `salvaging` 回头吃 `state` ⇒ 会成环，与 D/F 批两次踩过的坑同款）。
 */
import type { GameState } from './state'
import { addLog } from './state'
import type { AnomalyDef, SimContext } from './types'
import { salvagerCyclesOf } from './salvaging'
import { allFittedModules } from './equipment'
import { addModule } from './equipment'
import {
  RARE_WRECK_VOLUME_M3,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_YIELD_PER_M3,
  isRareWreck,
  rareWreckItemIdOf,
  recycleProfileOf,
  wreckItemIdOf,
} from './salvage'
import {
  canPlace,
  cargoShapesFor,
  findFreeSpot,
  holdAdd,
  holdCellsUsed,
  holdRemove,
  makeHoldState,
  wormholeShapeOf,
  placementCellsCount,
  wormholeIsShapedItem,
} from './wormholeHold'
import {
  WORMHOLE_TURN_PER_ACTIVATE,
  WORMHOLE_TURN_PER_PICK,
  gridCellAt,
  gridContentIndex,
  wormholeRng,
  wormholeStream,
} from './wormholeGrid'
import type { WormholeCellPile, WormholeGridCell } from './wormholeGrid'
import {
  wormholeBagSlotsOfFleet,
  wormholeBagUsage,
  wormholeCardIdFor,
  wormholeLayerRewardMul,
  wormholeNodePiles,
  mergeIntoBag,
  wormholeTrimBag,
  wormholeUnitsPerSlot,
} from './wormhole'
import type { WormholeBagSlot, WormholePile } from './wormhole'
import type { WormholeActivateEffect, WormholeRunState } from './wormhole'

/* ═══════════ 一、口径常量（F3c 配平的旋钮都在这里） ═══════════ */

/** 普通残骸**每堆基准体积**（m³；数量即 m³、背包每格 500 ⇒ 与虚空母矿堆同一把尺） */
export const WORMHOLE_WRECK_PILE_M3_BASE = 200
/** 墓场：普通残骸堆数范围（船长 2026-09-13：「墓场给的堆数随机范围上调 3~10」） */
export const WORMHOLE_GRAVEYARD_COMMONS_MIN = 3
export const WORMHOLE_GRAVEYARD_COMMONS_MAX = 10
/** 稀有残骸判断：**每几堆普通判一次** + 单次概率（船长：「每 3 堆普通，进行一次稀有残骸出现判断」） */
export const WORMHOLE_RARE_JUDGE_PER_COMMONS = 3
export const WORMHOLE_RARE_JUDGE_CHANCE = 0.35
/** 遗迹：稀有残骸堆数范围（**不受墓场那条新规则影响** —— 船长 2026-09-13 明示） */
export const WORMHOLE_RUINS_RARES_MIN = 2
export const WORMHOLE_RUINS_RARES_MAX = 3
/**
 * 遗迹专属掉落：**起效层 + 随层上升的概率**（船长 2026-09-13：「**将遗迹打捞出专属的几率也和层数挂钩，
 * 从第二层开始就有几率打捞到。**」）。曲线口径：
 * `概率 = min(50%, 12% × 1.3^(层-2))` ⇒ 层 2 = 12.0% · 层 3 = 15.6% · 层 4 = 20.3% · 层 5 = 26.4% ·
 * 层 6 = 34.3% · 层 7 = 44.6% · 层 8 起封顶 **50%**。**层 1 恒不出**。
 * ⚠ 四个常数都是 F3c 配平的旋钮（改基准=整体平移，改增速=换斜率，改封顶=控上限）。
 */
export const WORMHOLE_RELIC_MIN_DEPTH = 2
export const WORMHOLE_RELIC_CHANCE_BASE = 0.12
export const WORMHOLE_RELIC_CHANCE_GROWTH = 0.3
export const WORMHOLE_RELIC_CHANCE_CAP = 0.5

/** 第 `depth` 层遗迹打捞出专属的**单次概率**（层 1 = 0；层 2 起按上式上升，封顶 50%） */
export function wormholeRelicChanceOf(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_RELIC_MIN_DEPTH) return 0
  const raw = WORMHOLE_RELIC_CHANCE_BASE * Math.pow(1 + WORMHOLE_RELIC_CHANCE_GROWTH, d - WORMHOLE_RELIC_MIN_DEPTH)
  return Math.min(WORMHOLE_RELIC_CHANCE_CAP, raw)
}
/** 遗迹收尾战：概率 + 威胁系数（船长 2026-09-13 确认「除了 5 其他没问题」） */
export const WORMHOLE_RUINS_BATTLE_CHANCE = 0.7
/** 舰船信号战果（打赢固定给） */
export const WORMHOLE_SHIP_SPOIL_COMMONS = 2
export const WORMHOLE_SHIP_SPOIL_RARES = 1
/** 矿脉堆数范围 */
export const WORMHOLE_VEIN_PILES_MIN = 1
export const WORMHOLE_VEIN_PILES_MAX = 3

/**
 * 遗迹专属掉落的**按深度权重**（专属稿 §6.2；同一层里三类的相对权重）。
 * ⚠ 「层 1~2 不出专属」那半句自 2026-09-13 起**只对层 1 成立**（船长令层 2 起有几率）⇒
 * 层 2 归入最浅那一档（装备为主、图纸少）。
 */
export function wormholeRelicWeightsOf(depth: number): { modules: number; moduleBlueprints: number; shipBlueprints: number } {
  const d = Math.max(1, Math.floor(depth))
  if (d < WORMHOLE_RELIC_MIN_DEPTH) return { modules: 0, moduleBlueprints: 0, shipBlueprints: 0 }
  if (d <= 4) return { modules: 60, moduleBlueprints: 25, shipBlueprints: 15 }
  if (d <= 6) return { modules: 45, moduleBlueprints: 30, shipBlueprints: 25 }
  return { modules: 30, moduleBlueprints: 35, shipBlueprints: 35 }
}

/* ═══════════ 二、按族池（从 ctx 目录按 id 前缀派生，不手抄清单） ═══════════ */

/** 洞内五族（与 `packages/data/src/wormholeFoes.ts` 的卡一一对应；E 族卡 2026-09-13 补） */
export const WORMHOLE_FAMILIES = ['A', 'C', 'D', 'E', 'G'] as const

export interface WormholeFamilyPool {
  /** 装备本体（`mod-wh-<族>-`） */
  modules: string[]
  /** 装备图纸（`bp-wh-<族>-`） */
  moduleBlueprints: string[]
  /** 舰船图纸（`sbp-wh-<族>-`） */
  shipBlueprints: string[]
}

/**
 * **某族的专属池**（装备本体 / 装备图纸 / 舰船图纸）。
 *
 * 为什么从 `ctx` 目录**按 id 前缀派生**而不是在数据层手抄清单：抄一份就会漂——
 * 内容加一件、改一次族，清单不会自己跟上；而 id 前缀（`-wh-<族>-`）是内容侧的既有约定，
 * 派生出来的池永远与目录一致。`content:check` 另有契约钉住"五族池非空、无孤儿内容"。
 */
export function wormholeFamilyPoolOf(ctx: SimContext, family: string): WormholeFamilyPool {
  const tag = `-wh-${family.toLowerCase()}-`
  const pick = (ids: Iterable<string>, head: string): string[] =>
    [...ids].filter((id) => id.startsWith(head) && id.includes(tag)).sort()
  return {
    modules: pick(ctx.modules.keys(), 'mod'),
    moduleBlueprints: pick(ctx.blueprints.keys(), 'bp'),
    shipBlueprints: pick(ctx.shipBlueprints.keys(), 'sbp'),
  }
}

/** 五族池齐不齐（`content:check` 与用例共用；缺哪族就说哪族） */
export function wormholeFamilyPoolGaps(ctx: SimContext): string[] {
  const gaps: string[] = []
  for (const f of WORMHOLE_FAMILIES) {
    const p = wormholeFamilyPoolOf(ctx, f)
    if (p.modules.length === 0) gaps.push(`${f} 族没有专属装备`)
    if (p.moduleBlueprints.length === 0) gaps.push(`${f} 族没有专属装备图纸`)
    if (p.shipBlueprints.length === 0) gaps.push(`${f} 族没有专属舰船图纸`)
  }
  return gaps
}

/* ═══════════ 三、打捞器与堆的生成 ═══════════ */

/** **编队打捞器总台数**（各船 `salvagerCyclesOf` 的长度之和；0 = 干不了打捞） */
export function wormholeSalvagersOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  let n = 0
  for (const uid of run.fleet) n += salvagerCyclesOf(state, ctx, uid).length
  return n
}

/** 本趟的确定性种子（`run.seed`；老档没有就退到全局 rng 种子） */
function runSeedOf(state: GameState): number {
  return state.wormhole.run?.seed ?? state.rng.seed
}

/** 本格的产出跟着**哪张敌卡**走（残骸物品与专属池都按它取族） */
export function wormholeCellCardIdOf(run: WormholeRunState, cell: WormholeGridCell): string {
  const grid = run.grid!
  return wormholeCardIdFor(run.depth, gridContentIndex(grid, { q: cell.q, r: cell.r }))
}

/** 某格的产出族（从敌卡 id 反查：`wh-*` 卡都带 `foeFamily`，取不到就当 A 族兜底） */
function familyOfCard(ctx: SimContext, cardId: string): string {
  const card: AnomalyDef | undefined = ctx.anomalies.get(cardId)
  const f = String(card?.foeFamily ?? 'A')
  return (WORMHOLE_FAMILIES as readonly string[]).includes(f) ? f : 'A'
}

/**
 * **生成某格的打捞堆**（**只生成一次**：已有 `piles` 就原样返回）。
 * 确定性 = `(本趟种子, 层, 格坐标, 地点类型)` ⇒ 同一趟里反复进出该格结果不变；
 * 与存档一致（堆随档保存，捡走即从数组里删）。
 */
export function wormholeEnsureSalvagePiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if ((cell.piles ?? []).length > 0) return
  if (cell.place !== 'graveyard' && cell.place !== 'ruins') return
  const cardId = wormholeCellCardIdOf(run, cell)
  const common = wreckItemIdOf(cardId)
  const rare = rareWreckItemIdOf(cardId)
  const mul = wormholeLayerRewardMul(run.depth)
  const rng = wormholeStream(runSeedOf(state) * 31 + run.depth * 7919 + (cell.q * 131 + cell.r * 17) * 7)
  const piles: WormholeCellPile[] = []
  if (cell.place === 'graveyard') {
    const span = WORMHOLE_GRAVEYARD_COMMONS_MAX - WORMHOLE_GRAVEYARD_COMMONS_MIN + 1
    const commons = WORMHOLE_GRAVEYARD_COMMONS_MIN + Math.floor(rng() * span)
    // **每 3 堆普通判一次稀有**（船长口径）⇒ 上限 = ⌊普通 ÷ 3⌋
    const rolls = Math.floor(commons / WORMHOLE_RARE_JUDGE_PER_COMMONS)
    for (let i = 0; i < rolls; i++) {
      if (rng() < WORMHOLE_RARE_JUDGE_CHANCE) piles.push({ itemId: rare, units: RARE_WRECK_VOLUME_M3 })
    }
    for (let i = 0; i < commons; i++) {
      piles.push({ itemId: common, units: Math.max(1, Math.round(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
    }
  } else {
    const span = WORMHOLE_RUINS_RARES_MAX - WORMHOLE_RUINS_RARES_MIN + 1
    const rares = WORMHOLE_RUINS_RARES_MIN + Math.floor(rng() * span)
    for (let i = 0; i < rares; i++) piles.push({ itemId: rare, units: RARE_WRECK_VOLUME_M3 })
  }
  // **稀有在前**：回收按数组顺序取 ⇒ "优先打捞稀有残骸"天然成立
  cell.piles = piles
}

/* ═══════════ 三之二、收益口径（残骸的真价值在回收炉，不在市场） ═══════════ */

/** 稀有残骸的**名义价值加成**（一个高级箱的期望量级；只用于排序与提示，不进结算） */
export const WORMHOLE_RARE_CHEST_NOMINAL_ISK = 1_000_000

/**
 * **残骸的拆解价值**（ISK/m³；非残骸 / 无回收档案 ⇒ 0）。
 *
 * 为什么单开这一条（2026-09-13 F3c 抓到的真问题）：残骸物品的 `baseSellPriceIsk = 1`
 * （市场一律按废料价收），**真价值在回收炉拆解**（保底矿物 + 概率特色掉落）。
 * 而"沉船丢货"的排序与撤离结算的报账原来都只看基础卖价 ⇒ **稀有残骸（30 m³、30 ISK）会被
 * 当成最不值钱的东西第一个丢掉**，一格虚空母矿（457,500 ISK）反而留着。
 * 口径 = 该残骸**回收档位**的保底产出（`RECYCLE_YIELD_PER_M3 × RECYCLE_POOL_AVG_ISK`），
 * 与工业页/星图打捞页展示的"保底 ≈ X ISK/h"同源；**不含**高级箱/特色掉落那部分。
 */
export function wormholeWreckRecycleIskPerM3(ctx: SimContext, itemId: string): number {
  const p = recycleProfileOf(ctx, itemId)
  if (!p) return 0
  return RECYCLE_YIELD_PER_M3[p.tier] * RECYCLE_POOL_AVG_ISK[p.tier]
}

/**
 * 背包里一件物品的**收益估值**（残骸走拆解、其余走基础卖价）——报账、排序与读数共用这一把尺。
 *
 * `opts.rareChestNominal`：稀有残骸是否计入**高级箱的名义价值**。
 * - **默认不计**：给"这趟赚了多少 ISK"的读数用——高级箱出的是装备/图纸而不是 ISK，
 *   混进收益会把数字撑爆（实测：层收益表里的"毛收益"会被这个名义值主导）。
 * - **丢货排序要计**：否则稀有残骸（30 m³、回收价值约 1,700 ISK）会排在原矿前面被丢掉。
 */
export function wormholeLootValueIsk(
  ctx: SimContext,
  itemId: string,
  units: number,
  opts?: { rareChestNominal?: boolean },
): number {
  const n = Math.max(0, units)
  if (itemId.startsWith('wreck-')) {
    const base = n * wormholeWreckRecycleIskPerM3(ctx, itemId)
    return isRareWreck(itemId) && opts?.rareChestNominal === true ? base + WORMHOLE_RARE_CHEST_NOMINAL_ISK : base
  }
  return n * (ctx.items.get(itemId)?.baseSellPriceIsk ?? 0)
}

/**
 * **丢货排序档位**（0 = 先丢）：普通残骸 → 其它可售物 → 稀有残骸。
 * 为什么要有档位而不是纯按 ISK：残骸与矿的价值量纲不同（一个要拆解、一个直接卖），
 * 纯比数字会让**稀有残骸（高级箱的载体）排在原矿前面被丢掉**——那是玩家最不能接受的一种丢法。
 */
export function wormholeLootTierOf(itemId: string): 0 | 1 | 2 {
  if (isRareWreck(itemId)) return 2
  if (itemId.startsWith('wreck-')) return 0
  return 1
}

/* ═══════════ 三之三、货仓格（F4 · 船长 2026-09-13：货仓直接代表背包大小） ═══════════ */

/** 货仓**总格数**（散货 + 形状件共用一本账）= ⌊编队合计货仓 ÷ 500⌋（现算 ⇒ 沉船后变小） */
export function wormholeHoldCapacityOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  return wormholeBagSlotsOfFleet(state, ctx, run.fleet)
}

/** 一条散货占几格（数量 ÷ 每格单位数，向上取整；认不出物品 ⇒ 按 1 格兜底） */
export function wormholeCargoCellsOf(ctx: SimContext, itemId: string, units: number): number {
  const per = wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  return Math.max(1, Math.ceil(Math.max(0, units) / Math.max(1, per)))
}

/**
 * **把散货与网格对齐**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」）。
 *
 * 口径：`run.bag` 是**数量账本**（一种物品一条），`run.hold.placements` 是**位置账本**（每条散货 = 一条 1×N 横条）。
 * 本函数把两者对齐：
 * - 背包里没有的物品 ⇒ 删掉它的散货条；
 * - 有物品没条 / 条的格数变了 ⇒ 就地重放（**先试原位**，放不下再找空位；横竖都试）；
 * - 放不进网格的条目记进 `unplaced`（调用方据此**拒绝这次装货**或报超载）。
 * ⚠ 每条散货**各自一条 placement**（不是一格一条），所以玩家拖的是"整条货"。
 */
export function wormholeHoldSyncCargo(
  state: GameState,
  ctx: SimContext,
): { unplaced: string[]; moved: number } {
  const run = state.wormhole.run
  if (!run) return { unplaced: [], moved: 0 }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  run.hold = run.hold ?? makeHoldState()
  const hold = run.hold
  const unplaced: string[] = []
  let moved = 0
  // ① 删掉背包里已经没有的散货条
  const inBag = new Set(run.bag.map((s) => s.itemId))
  hold.placements = hold.placements.filter((p) => p.kind !== 'cargo' || inBag.has(p.itemId))
  // ② 逐条对齐
  for (const slot of run.bag) {
    const cells = wormholeCargoCellsOf(ctx, slot.itemId, slot.units)
    const current = hold.placements.find((p) => p.kind === 'cargo' && p.itemId === slot.itemId)
    if (current && current.w * current.h === cells) {
      current.units = Math.floor(slot.units)
      continue
    }
    // 先把旧的摘掉（换尺寸重放）
    if (current) hold.placements = hold.placements.filter((p) => p.id !== current.id)
    let placed = false
    const shapes = cargoShapesFor(cells)
    // **先试原位**（保持玩家手动摆好的位置）
    if (current) {
      for (const shape of shapes) {
        if (canPlace(hold, current.x, current.y, shape, capacity)) {
          hold.placements.push({ ...current, w: shape.w, h: shape.h, units: Math.floor(slot.units) })
          placed = true
          moved += 1
          break
        }
      }
    }
    if (!placed) {
      for (const shape of shapes) {
        const spot = findFreeSpot(hold, shape, capacity, true)
        if (spot) {
          hold.placements.push({
            id: `${slot.itemId}#${cells}`,
            itemId: slot.itemId,
            kind: 'cargo',
            units: Math.floor(slot.units),
            x: spot.x,
            y: spot.y,
            w: shape.w,
            h: shape.h,
          })
          placed = true
          moved += 1
          break
        }
      }
    }
    if (!placed) unplaced.push(slot.itemId)
  }
  return { unplaced, moved }
}

/**
 * 货仓当前**占用**（F5 起：**一切占格的东西都在 placements 里** —— 散货条 + 货柜）。
 * `unplacedCells` = 背包里有货、但网格里没位置的格数（正常流程下恒 0：装不下会在入口被拒）。
 */
export function wormholeHoldUsage(
  state: GameState,
  ctx: SimContext,
): {
  used: number
  capacity: number
  cargoCells: number
  shapeCells: number
  unplacedCells: number
  overload: boolean
} {
  const run = state.wormhole.run
  if (!run) return { used: 0, capacity: 0, cargoCells: 0, shapeCells: 0, unplacedCells: 0, overload: false }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  let cargoCells = 0
  let shapeCells = 0
  for (const p of run.hold?.placements ?? []) {
    if (p.kind === 'cargo') cargoCells += placementCellsCount(p)
    else shapeCells += placementCellsCount(p)
  }
  // 背包里有、网格里没有的（只可能来自"沉船缩容"或坏档）⇒ 也算超载
  const placed = new Set((run.hold?.placements ?? []).filter((p) => p.kind === 'cargo').map((p) => p.itemId))
  let unplacedCells = 0
  for (const slot of run.bag) {
    if (!placed.has(slot.itemId)) unplacedCells += wormholeCargoCellsOf(ctx, slot.itemId, slot.units)
  }
  const used = cargoCells + shapeCells + unplacedCells
  return { used, capacity, cargoCells, shapeCells, unplacedCells, overload: used > capacity }
}

/** **超载**判据（沉船后格数变小 ⇒ 玩家必须手动抛货；船长 2026-09-13 裁定 8） */
export function wormholeHoldOverloaded(state: GameState, ctx: SimContext): boolean {
  return wormholeHoldUsage(state, ctx).overload
}

/** **把一件形状件装进货仓**（船长口径：**整件拒收** ⇒ 放不下就不装、状态不变） */
export function wormholeHoldStow(
  state: GameState,
  ctx: SimContext,
  itemId: string,
): { ok: boolean; error?: string; placementId?: string } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  if (!wormholeIsShapedItem(itemId)) return { ok: false, error: '这件东西不占形状格。' }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  run.hold = run.hold ?? makeHoldState()
  // **先按容量拦一道**：几何上也许塞得进缝里，但那会当场把自己顶成"超载"——
  // 船长口径是"放不下整件拒收"，不是"先装进去再逼你抛货"。
  const shape = wormholeShapeOf(itemId)
  const before = wormholeHoldUsage(state, ctx)
  if (before.used + shape.w * shape.h > capacity) {
    const left = Math.max(0, capacity - before.used)
    return { ok: false, error: `货仓只剩 ${left} 格，装不下这件（${shape.w}×${shape.h} = ${shape.w * shape.h} 格）。` }
  }
  const r = holdAdd(run.hold, itemId, capacity)
  if (!r.ok) return { ok: false, error: r.error }
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'info',
    `🕳 装舱：${name}（占 ${r.placement!.w}×${r.placement!.h} 格）· 货仓 ${wormholeHoldUsage(state, ctx).used}/${capacity} 格。`,
  )
  return { ok: true, placementId: r.placement!.id }
}

/** **抛弃一件形状件**（手动抛货 · 船长裁定 8） */
export function wormholeHoldDiscard(
  state: GameState,
  ctx: SimContext,
  placementId: string,
): { ok: boolean; error?: string } {
  const run = state.wormhole.run
  if (!run?.hold) return { ok: false, error: '货仓里没有形状件。' }
  const gone = holdRemove(run.hold, placementId)
  if (!gone) return { ok: false, error: '没有这个件。' }
  const name = ctx.items.get(gone.itemId)?.name ?? gone.itemId
  addLog(
    state,
    'warn',
    `🕳 抛弃：${name}（货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格）。`,
  )
  return { ok: true }
}

/**
 * **抛弃散货**（手动抛货；给数量 ⇒ 可只丢一部分）。
 * 为什么给数量：沉船后经常只差一两格，整条记录丢太狠（船长口径是"手动抛"，不是"丢光"）。
 */
export function wormholeDiscardCargo(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  units?: number,
): { ok: boolean; error?: string; dropped?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  const slot = run.bag.find((s) => s.itemId === itemId)
  if (!slot) return { ok: false, error: '货仓里没有这种货。' }
  const cut = Math.max(1, Math.min(slot.units, Math.floor(units ?? slot.units)))
  slot.units -= cut
  if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== itemId)
  wormholeHoldSyncCargo(state, ctx)
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'warn',
    `🕳 抛弃：${name} ×${cut}（货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格）。`,
  )
  return { ok: true, dropped: cut }
}

/**
 * **超载封锁**：超载时能做什么、不能做什么（船长裁定 8 的落地口径）。
 * - 不许：扫描 / 前往 / 激活（打捞·挖矿·开战）/ 拾取（**不能再装新东西**）；
 * - 允许：**抛货**（随时）、看地图、撤离/深入（但撤离与深入前必须先把货抛到容量内）；
 * - **不软锁**：抛货永远可用 ⇒ 任何超载态都有出路。
 */
export function wormholeOverloadBlockReason(state: GameState, ctx: SimContext): string | null {
  const u = wormholeHoldUsage(state, ctx)
  if (!u.overload) return null
  return `货仓超载（${u.used}/${u.capacity} 格）：先抛货再继续（货仓页可以抛弃）。`
}

/**
 * **一键抛到容量内**（玩家点按钮才执行 · 顺序 = 每格价值从低到高，复用 `wormholeTrimBag` 的口径）。
 * ⚠ 这不是"自动丢货"（船长裁定 8 要的是**手动**抛）：它只在玩家点的时候跑一次，且**只动散货**、
 * 形状件（安全货柜）一律不碰——货柜是专门带回来的战利品，要丢得玩家自己点。
 */
export function wormholeDiscardToFit(state: GameState, ctx: SimContext): { ok: boolean; dropped: WormholeBagSlot[] } {
  const run = state.wormhole.run
  if (!run) return { ok: false, dropped: [] }
  const capacity = wormholeHoldCapacityOf(state, ctx)
  const shapeCells = holdCellsUsed(run.hold)
  const cargoCap = Math.max(0, capacity - shapeCells) // 形状件不参与裁包
  const trimmed = wormholeTrimBag(ctx, run.bag, cargoCap, (slot) => {
    const def = ctx.items.get(slot.itemId)
    const per = Math.max(1, wormholeUnitsPerSlot(def?.unitM3 ?? 0))
    return {
      tier: wormholeLootTierOf(slot.itemId),
      iskPerSlot: wormholeLootValueIsk(ctx, slot.itemId, per, { rareChestNominal: true }),
    }
  })
  if (trimmed.dropped.length === 0) return { ok: false, dropped: [] }
  run.bag = trimmed.bag
  wormholeHoldSyncCargo(state, ctx)
  const names = trimmed.dropped
    .map((s) => `${ctx.items.get(s.itemId)?.name ?? s.itemId}×${Math.floor(s.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(state, 'warn', `🕳 抛货（按每格价值从低到高）：${names}。`)
  return { ok: true, dropped: trimmed.dropped }
}
/**
 * **把一堆搬上船**（玩家入口 = 超载闸 + 形状件分流 + 装舱判据）。
 *
 * ⚠ **网格层没有"逐堆拾取"**（船长 2026-09-13 裁定 A）：网格层的残骸走「**打捞**」、母矿走「**采集**」，
 * 两条路都要对应装备（打捞器 / 采集器）、回合口径都是 ⌈堆数 ÷ 台数⌉ —— 判据只有一份，
 * 不再留"能绕开装备门槛的第二条路"。本函数因此**只服务老档线性层**（`run.pendingNode.piles`；
 * 那代存档的回合已算进节点 `cost`，故这里不扣回合）。
 *
 * 为什么不把它放进 `wormhole.ts`：① 超载闸要 `ctx`；② **形状件**（遗迹安全货柜）不能进散货槽位，
 * 得走货仓格（`wormholeHoldStow`：占 4 格、放不下整件拒收）；③ `wormhole.ts` 不许 import 本文件
 * （`state.ts` → `wormhole.ts`，而本文件 import `state.ts` ⇒ 会成环）。故入口住在这一侧。
 */
export function wormholeTakePileAt(
  state: GameState,
  ctx: SimContext,
  pileIndex: number,
): { ok: boolean; error?: string; taken?: WormholePile; used?: number; capacity?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  if (run.grid) {
    return { ok: false, error: '网格层不能逐堆拾取：残骸用「打捞」、母矿用「采集」（都要对应装备）。' }
  }
  const blocked = wormholeOverloadBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const holder: { piles?: WormholePile[] } | undefined = run.pendingNode ?? undefined
  const pile = holder?.piles?.[pileIndex]
  if (!pile) return { ok: false, error: '这里没有可拾取的东西。' }
  if (wormholeIsShapedItem(pile.itemId)) {
    // **形状件**：整件装舱（放不下就不装、堆留在原地）
    const stowed = wormholeHoldStow(state, ctx, pile.itemId)
    if (!stowed.ok) return { ok: false, error: stowed.error }
    holder!.piles!.splice(pileIndex, 1)
    const u = wormholeHoldUsage(state, ctx)
    return { ok: true, taken: pile, used: u.used, capacity: u.capacity }
  }
  /**
   * **老档线性层：装舱判据与打捞/采集同一份**（`tryMergeIntoBag`）——
   * 合并 → 对齐货仓格（`wormholeHoldSyncCargo`）→ 有摆不下的条目就整条回滚（**不静默丢货**）。
   * 回合：不扣（这代存档的"每堆 +1 回合"已在节点 `cost` 里一次扣过，见 `wormholeAdvanceNode`）。
   */
  if (!tryMergeIntoBag(state, ctx, run, pile)) {
    const cap = wormholeHoldCapacityOf(state, ctx)
    const used = wormholeHoldUsage(state, ctx).used
    return { ok: false, error: `背包放不下：已占 ${used} / 共 ${cap} 格。` }
  }
  holder!.piles!.splice(pileIndex, 1)
  const u = wormholeHoldUsage(state, ctx)
  const name = ctx.items.get(pile.itemId)?.name ?? pile.itemId
  addLog(state, 'info', `🕳 拾取：${name} ×${pile.units}（货仓 ${u.used}/${u.capacity} 格）。`)
  return { ok: true, taken: pile, used: u.used, capacity: u.capacity }
}
/* ═══════════ 三之四、采集器与"到达即铺堆"（F5 · 船长 2026-09-13） ═══════════
 *
 * 船长两条口径：
 * ①「**资源点和墓场遗迹改为不用激活**」⇒ 走到那一格就**自动铺好产出**（堆），玩家直接打捞/采集；
 * ②「**虚空母矿要求玩家携带采集器。规则同虫洞打捞**」⇒ 矿脉按**采集器台数**分批回收，
 *    每台每次 1 堆、总回合 = ⌈堆数 ÷ 台数⌉（与残骸打捞完全同构，只是"打捞器"换成"采集器"）。
 */

/** **编队采集器台数**（`slot === 'miner'`；0 = 挖不动矿脉） */
export function wormholeMinersOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  let n = 0
  for (const uid of run.fleet) {
    const ship = state.fleet[uid]
    if (!ship) continue
    n += allFittedModules(ship.fitted, ctx).filter((m) => m.slot === 'miner').length
  }
  return n
}

/**
 * **到达即铺堆**（船长：「资源点和墓场遗迹改为不用激活」）：由 `wormholeBattle.wormholeTravelTo`
 * 在**移动成功后**调用（那里有 ctx，且不会走回滚路径）——只铺"该地点该有的产出"，**不扣回合**。
 */
export function wormholeEnsureArrivalPiles(state: GameState, ctx: SimContext): void {
  void ctx
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return
  if (cell.place === 'graveyard' || cell.place === 'ruins') wormholeEnsureSalvagePiles(state, cell)
  else if (cell.place === 'vein') wormholeEnsureVeinPiles(state, cell)
}

export interface WormholeCollectResult {
  ok: boolean
  error?: string
  spent?: number
  taken?: WormholeCellPile[]
  left?: number
  finished?: boolean
  mustExtract?: boolean
}

/**
 * **采集一批原矿**（矿脉 · F5）：一次动作 1 回合，回收 = `min(采集器台数, 剩余堆数)` 堆。
 * 没有采集器 ⇒ 拒绝（船长：「虚空母矿要求玩家携带采集器」），**不扣回合**。
 */
export function wormholeCollectOreAt(state: GameState, ctx: SimContext): WormholeCollectResult {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { ok: false, error: '本层没有网格：无法采集。' }
  if (run.battle) return { ok: false, error: '战斗中：先打完这一场。' }
  const blocked = wormholeOverloadBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。' }
  if (cell.place !== 'vein') return { ok: false, error: '这个地点没有可采集的矿脉。' }
  const miners = wormholeMinersOf(state, ctx)
  if (miners <= 0) return { ok: false, error: '编队里没有采集器：矿脉挖不动（至少装 1 台）。' }
  wormholeEnsureVeinPiles(state, cell)
  const piles = cell.piles ?? []
  if (piles.length === 0) return { ok: false, error: '这条矿脉已经采空了。' }
  if (run.turnsLeft < WORMHOLE_TURN_PER_ACTIVATE) return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  run.turnsLeft -= WORMHOLE_TURN_PER_ACTIVATE
  const taken: WormholeCellPile[] = []
  let full = false
  for (let i = 0; i < miners && piles.length > 0; i++) {
    const pile = piles[0]!
    if (!tryMergeIntoBag(state, ctx, run, pile)) {
      full = true
      break
    }
    piles.shift()
    taken.push(pile)
  }
  const names = taken
    .map((p) => `${ctx.items.get(p.itemId)?.name ?? p.itemId}×${Math.floor(p.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(
    state,
    'info',
    `🕳 采集（${miners} 台采集器）：回收 ${taken.length} 堆${names.length > 0 ? `——${names}` : ''}` +
      ` · 剩 ${piles.length} 堆 · 剩 ${run.turnsLeft} 回合。`,
  )
  if (full) addLog(state, 'warn', `🕳 货仓放不下：这一批只回收了 ${taken.length} 堆，剩下的仍留在原处。`)
  const finished = piles.length === 0
  if (finished && !grid.activated.includes(cell.key)) grid.activated.push(cell.key)
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_ACTIVATE,
    taken,
    left: piles.length,
    finished,
    mustExtract: run.turnsLeft <= 0,
  }
}
/* ═══════════ 四、打捞动作（1 回合 = 回收台数 的堆） ═══════════ */

export interface WormholeSalvageResult {
  ok: boolean
  error?: string
  /** 本回合花掉几回合（恒 1） */
  spent?: number
  /** 本回合回收的堆 */
  taken?: WormholeCellPile[]
  /** 堆没捞完（背包放不下 / 回合不够）时留下几堆 */
  left?: number
  /** 本格打捞是否已完成（堆空了） */
  finished?: boolean
  /** 打捞结束时的专属掉落（撤离成功后入库；见 `run.relics`） */
  relics?: string[]
  /** 需要接着开战（遗迹收尾战） */
  effect?: WormholeActivateEffect
  mustExtract?: boolean
}

/**
 * 把一堆并进背包（**放不下就原样退回**——不静默丢，交给界面提示）。
 * F5 起"放得下"的判据 = **网格里真能摆下这条散货**（散货也占格、也能被拖动），
 * 不再只是"格数够"：合并 → 对齐网格 → 有摆不下的条目就整条回滚。
 */
function tryMergeIntoBag(state: GameState, ctx: SimContext, run: WormholeRunState, pile: WormholeCellPile): boolean {
  const before = run.bag.map((s) => ({ ...s }))
  // 合并只认 `wormhole.mergeIntoBag`（全仓唯一一份"同类并格"实现）
  run.bag = mergeIntoBag(run.bag, pile)
  const sync = wormholeHoldSyncCargo(state, ctx)
  if (sync.unplaced.length > 0) {
    run.bag = before
    wormholeHoldSyncCargo(state, ctx) // 把网格也还原
    return false
  }
  return true
}

/**
 * **打捞一批**（网格层的"打捞"入口；界面点「打捞/继续打捞」都走它）。
 *
 * 一次动作 = 1 回合，回收 = `min(台数, 剩余堆数)` 堆（**优先稀有**：堆数组稀有在前）。
 * 背包放不下 ⇒ 当场停下，剩下的留在格上（本回合照扣——打捞器已经开工了）。
 * 堆捞空 ⇒ 记 `activated`（该格完成）；**遗迹**另掷专属掉落与收尾战。
 */
export function wormholeSalvageAt(state: GameState, ctx: SimContext): WormholeSalvageResult {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { ok: false, error: '本层没有网格：无法打捞。' }
  if (run.battle) return { ok: false, error: '战斗中：先打完这一场。' }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。' }
  if (cell.place !== 'graveyard' && cell.place !== 'ruins') return { ok: false, error: '这个地点没有可打捞的残骸。' }
  const rigs = wormholeSalvagersOf(state, ctx)
  if (rigs <= 0) {
    return { ok: false, error: '编队里没有打捞器：打捞作业干不了（至少装 1 台）。' }
  }
  wormholeEnsureSalvagePiles(state, cell)
  const piles = cell.piles ?? []
  if (piles.length === 0) {
    if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
    return { ok: false, error: '这个地点已经捞空了。' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_ACTIVATE) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_ACTIVATE
  const taken: WormholeCellPile[] = []
  let full = false
  for (let i = 0; i < rigs && piles.length > 0; i++) {
    const pile = piles[0]!
    if (!tryMergeIntoBag(state, ctx, run, pile)) {
      full = true
      break
    }
    piles.shift()
    taken.push(pile)
  }
  const names = taken
    .map((p) => `${ctx.items.get(p.itemId)?.name ?? p.itemId}×${Math.floor(p.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(
    state,
    'info',
    `🕳 打捞（${rigs} 台打捞器）：回收 ${taken.length} 堆${names.length > 0 ? `——${names}` : ''}` +
      ` · 剩 ${piles.length} 堆 · 剩 ${run.turnsLeft} 回合。`,
  )
  if (full) addLog(state, 'warn', `🕳 背包放不下：这一批只回收了 ${taken.length} 堆，剩下的仍留在原处。`)
  const finished = piles.length === 0
  if (!finished) {
    return { ok: true, spent: WORMHOLE_TURN_PER_ACTIVATE, taken, left: piles.length, finished: false, mustExtract: run.turnsLeft <= 0 }
  }
  // ── 打捞结束：记完成；遗迹另掷专属掉落与收尾战 ──
  if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
  const result: WormholeSalvageResult = {
    ok: true,
    spent: WORMHOLE_TURN_PER_ACTIVATE,
    taken,
    left: 0,
    finished: true,
    mustExtract: run.turnsLeft <= 0,
  }
  if (cell.place === 'ruins') {
    // **F4：专属掉落 = 一个「遗迹安全货柜」，散落在该格**（不直接入库：要占 4 格、由玩家拾取）
    const boxId = wormholeRollRelicBox(state, ctx, cell)
    if (boxId) {
      cell.piles = [...(cell.piles ?? []), { itemId: boxId, units: 1 }]
      const name = ctx.items.get(boxId)?.name ?? boxId
      addLog(
        state,
        'info',
        `🕳 遗迹深处发现${name}：**散落在该地点**——拾取要占货仓 2×2 = 4 格（放不下就先腾地方）。`,
      )
      result.relics = [boxId]
    }
    const rng = wormholeStream(runSeedOf(state) * 17 + run.depth * 613 + (cell.q * 41 + cell.r * 53) * 11 + 5)
    if (rng() < WORMHOLE_RUINS_BATTLE_CHANCE) {
      result.effect = { kind: 'ruinsBattle', key: cell.key }
      addLog(state, 'warn', '🕳 遗迹深处的守备被惊动了：交火在即——这一场必须打完。')
    }
  }
  return result
}

/**
 * **族 → 安全货柜物品 id**（`box-relic-<族小写>`；形状表里已登记这 5 个 id）
 */
export function wormholeRelicBoxIdOf(family: string): string {
  return `box-relic-${family.toLowerCase()}`
}

/**
 * **掷遗迹专属掉落 = 一个「遗迹安全货柜」**（F4 · 船长 2026-09-13：「装备和蓝图的产出加一个中间件：
 * 玩家从遗迹获得『遗迹安全货柜』…将安全货柜带回后在精炼炉拆解」）。
 *
 * 口径：
 * - **概率随层上升**（`wormholeRelicChanceOf`；层 1 恒不出）；
 * - **族 = 本格敌卡的族**（保住「专属掉落按种族库走」这条裁定：内容物等拆解时才揭，族不能丢）；
 * - **不直接入库**：调用方把货柜**散落到该格**，玩家自己拾取（占货仓 2×2 = 4 格；放不下整件拒收）；
 * - 内容物（装备本体 / 装备图纸 / 舰船图纸）留待**拆解批次**——本批船长明示「暂时不用拆解」。
 */
export function wormholeRollRelicBox(
  state: GameState,
  ctx: SimContext,
  cell: WormholeGridCell,
): string | undefined {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return undefined
  if (run.depth < WORMHOLE_RELIC_MIN_DEPTH) return undefined
  const rng = wormholeStream(runSeedOf(state) * 53 + run.depth * 911 + (cell.q * 23 + cell.r * 29) * 13 + 7)
  if (rng() >= wormholeRelicChanceOf(run.depth)) return undefined
  const family = familyOfCard(ctx, wormholeCellCardIdOf(run, cell))
  return wormholeRelicBoxIdOf(family)
}

/**
 * **撤离成功后把随行战利品入库**（图纸/装备这类不进背包格子的东西）：
 * 一次性图纸进蓝图书架（组装机用掉）、装备本体进装备库。
 * 由 `settleWormholeBattle` 在撤离战胜利那一支调用。
 */
export function wormholeDeliverRelics(state: GameState, ctx: SimContext, relics: readonly string[]): string[] {
  const done: string[] = []
  for (const id of relics) {
    if (ctx.modules.has(id)) {
      addModule(state, id)
      done.push(ctx.modules.get(id)?.name ?? id)
    } else if (ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)) {
      state.blueprintStock[id] = (state.blueprintStock[id] ?? 0) + 1
      done.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    }
  }
  if (done.length > 0) addLog(state, 'info', `🕳 随行战利品入库：${done.join('、')}。`)
  return done
}

/* ═══════════ 五、舰船信号战果（打赢固定给） ═══════════ */

/**
 * **舰船信号地点的战果**（船长：「战斗结束后固定获得一定量残骸和稀有残骸」）：
 * 残骸 2 堆 + 稀有残骸 1 堆，**直接进包**（这是打出来的，不是打捞作业，不需要打捞器）；
 * 背包放不下的部分**留在该格成堆**（不静默丢，之后可以照打捞规则回收）。
 */
export function wormholeGrantShipSpoils(state: GameState, ctx: SimContext): { bagged: number; leftOnCell: number } {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { bagged: 0, leftOnCell: 0 }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { bagged: 0, leftOnCell: 0 }
  const cardId = wormholeCellCardIdOf(run, cell)
  const mul = wormholeLayerRewardMul(run.depth)
  const rng = wormholeStream(runSeedOf(state) * 7 + run.depth * 331 + (cell.q * 61 + cell.r * 67) * 3 + 11)
  const spoils: WormholeCellPile[] = []
  for (let i = 0; i < WORMHOLE_SHIP_SPOIL_COMMONS; i++) {
    spoils.push({ itemId: wreckItemIdOf(cardId), units: Math.max(1, Math.round(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
  }
  for (let i = 0; i < WORMHOLE_SHIP_SPOIL_RARES; i++) spoils.push({ itemId: rareWreckItemIdOf(cardId), units: RARE_WRECK_VOLUME_M3 })
  let bagged = 0
  const leftovers: WormholeCellPile[] = []
  for (const s of spoils) {
    if (bagged < spoils.length && tryMergeIntoBag(state, ctx, run, s)) bagged += 1
    else leftovers.push(s)
  }
  if (leftovers.length > 0) {
    cell.piles = [...(cell.piles ?? []), ...leftovers]
    addLog(state, 'warn', `🕳 战果里有 ${leftovers.length} 堆装不下：先散落在该地点，可以照打捞规则回收。`)
  }
  if (bagged > 0) addLog(state, 'info', `🕳 战果入库：${bagged} 堆残骸（含稀有）。`)
  return { bagged, leftOnCell: leftovers.length }
}

/* ═══════════ 六、矿脉（虚空母矿 1~3 堆；走到就铺、按采集器台数成批回收） ═══════════ */

/**
 * **给矿脉格铺原矿堆**（只铺一次）。堆的生成器沿用 `wormholeNodePiles`（虚空母矿、确定性、
 * 数量随层收益系数）；回收走 `wormholeCollectOreAt`（一次动作 1 回合 = 台数 堆，⌈堆数 ÷ 台数⌉ 回合）。
 */
export function wormholeEnsureVeinPiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if ((cell.piles ?? []).length > 0) return
  if (cell.place !== 'vein') return
  const rng = wormholeStream(runSeedOf(state) * 97 + run.depth * 577 + (cell.q * 89 + cell.r * 71) * 19)
  const span = WORMHOLE_VEIN_PILES_MAX - WORMHOLE_VEIN_PILES_MIN + 1
  const count = WORMHOLE_VEIN_PILES_MIN + Math.floor(rng() * span)
  cell.piles = wormholeNodePilesFor(state, cell, count)
}

/** 矿脉堆的具体生成（`wormholeNodePiles` 的薄包装：序号按格坐标散列，保证同格同结果） */
function wormholeNodePilesFor(state: GameState, cell: WormholeGridCell, count: number): WormholeCellPile[] {
  const run = state.wormhole.run!
  const index = Math.abs(cell.q * 13 + cell.r * 29) % 97
  return wormholeNodePiles(runSeedOf(state), run.depth, index, count)
}

