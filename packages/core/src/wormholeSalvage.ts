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
import { RARE_BOX_DRONE_UNITS } from './salvage'
import { addWare } from './inventory'
import { nextInt, nextRandom } from './rng'
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
  cargoBlockArea,
  cargoShapeFits,
  cargoShapesFor,
  bestCargoPlacement,
  findCargoSpot,
  findFreeSpot,
  holdAdd,
  holdCellsUsed,
  holdRemove,
  holdTransferTo,
  makeHoldState,
  WORMHOLE_CARGO_PIECE,
  wormholeShapeOf,
  placementCellsCount,
  wormholeIsShapedItem,
} from './wormholeHold'
import type { WormholeHoldPlacement, WormholeHoldState } from './wormholeHold'
// F3c 谜质装置：效果一律从货仓现算（本文件用到容量 / 打捞·采集堆数 / 母矿产量 / 回合同步）
import { wormholeMatterBuffs, wormholeMatterDiscardHint } from './wormholeMatter'
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
  wormholeCardIdOfFamily,
  wormholeLayerRewardMul,
  wormholeNodePiles,
  mergeIntoBag,
  wormholeTrimBag,
  wormholeUnitsPerSlot,
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
} from './wormhole'
import type { WormholeBagSlot, WormholePile, WormholeTempSlot } from './wormhole'
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
  /**
   * **族专属无人机**（`drone-wh-<族>-`；2026-09-13 二号接线单 · 专属稿 §6.1）。
   *
   * C/E 两族的第 6 件由**无人机掉落替换**（C 移除「活性甲壳层」、E 移除「巨构稳态器」）⇒
   * 它**只有 C/E 两族有**，是**选择性替换物**：**不进"五族齐备"判据**（`wormholeFamilyPoolGaps` 不查它），
   * 只做**归属 / 孤儿检查**（`content:check` 按 `drone-wh-` 前缀查孤儿——族标记写错一个字母就永远掉不出来）。
   * 一次到手几架见 `wormholePoolGrantUnitsOf`（复用窝点稀有箱口径 `RARE_BOX_DRONE_UNITS` = 10）。
   */
  drones: string[]
}

/**
 * **某族的专属池**（装备本体 / 装备图纸 / 舰船图纸 / 族专属无人机）。
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
    drones: pick(ctx.items.keys(), 'drone'),
  }
}

/**
 * **池内一件东西"一次到手几个"**（船长口径：专属无人机一次 **×10 架**，与窝点稀有箱同款）。
 *
 * 用途：`wormholeDeliverRelics` 把池内容物（货柜 / 无人机 / 将来的拆解产出）送进仓库时按它计数。
 * ⚠ 洞内专属掉落的**内容物本身**仍留待拆解批次（船长「暂时不用拆解」）——这里先把"几件"的口径收成一份，
 * 免得将来拆解、入库两处各写一个 10。
 */
export function wormholePoolGrantUnitsOf(itemId: string): number {
  return itemId.startsWith('drone-wh-') ? RARE_BOX_DRONE_UNITS : 1
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

/* ═══════════ 二之二、**稀释池**（船长 2026-09-13：「将新增的一次性蓝图放入虫洞的专属奖池内作为稀释」）═══
 *
 * 口径（船长三条裁定）：
 * - **比例 70 : 30** ⇒ 拆解抽取时**族专属池 70% / 稀释池 30%**（稀释池就是"占位"，让族专属变稀）；
 * - **按层分档**（船长：「T4 降到 3 层，T5 降到 5 层」）：
 *   **T3 十张从层 2 起 · T4 四张从层 3 起 · T5（皇带鱼）从层 5 起**；
 * - 池内容 = 市场在售的 **T3/T4/T5 一次性舰船蓝图**（`sbp-once-*`，`singleUse === true`）——
 *   从 `ctx.shipBlueprints` **按 id 前缀派生**（与族池同款"不手抄清单"纪律：内容加了自动进池）。
 *
 * ⚠ **本批只落"池定义 + 权重常量 + 契约 + 用例"**：货柜内容物仍留待**拆解批次**（船长「暂时不用拆解」）
 * ⇒ **运行时零行为变化**；拆解批次按 `wormholeLootShares()` 与 `wormholeDilutionPoolOf()` 抽即可。 */

/**
 * 稀释池占抽取的比例（族专属池 = 1 − 本值）；船长 2026-09-13：「按 70:30」。
 *
 * ⚠ **2026-09-14 起停用（保留常量，仿 `foeChargeMaxHoldMs` 的"停用但留档"惯例）**：
 * 船长当日新增**图纸货柜**并裁定「与安全货柜并列」⇒ 安全货柜改 **100% 族专属池**、
 * 一次性图纸完全改由图纸货柜承载，本比例**不再被任何运行时路径读取**。留档是为了让
 * "70:30 曾经是什么"可查；`once-ship-blueprints.test.ts` 与 `content:check` 里的断言已改按"停用"口径。
 */
export const WORMHOLE_DILUTION_SHARE = 0.3

/** 各档一次性蓝图**进池的最低层**（船长 2026-09-13：「T4 降到 3 层，T5 降到 5 层」；T3 沿用层 2 起） */
export const WORMHOLE_DILUTION_MIN_DEPTH: Readonly<Record<3 | 4 | 5, number>> = { 3: 2, 4: 3, 5: 5 }
/**
 * **拆解货柜时用的层档**（F4d · 船长 2026-09-13 定：「货柜不记层，一律最低档」）：
 * 稀释池按**最低那一档**（层 2 ⇒ T3 那批一次性舰船蓝图 10 张）取，深层带回来的箱子与浅层开出的一样。
 */
export const WORMHOLE_DILUTION_MIN_DEPTH_FLOOR = 2

/** 抽取权重（**2026-09-14 起停用**，见 `WORMHOLE_DILUTION_SHARE` 的说明；保留仅作文档留档） */
export function wormholeLootShares(): { family: number; dilution: number } {
  return { family: 1 - WORMHOLE_DILUTION_SHARE, dilution: WORMHOLE_DILUTION_SHARE }
}

/**
 * **某层的稀释池**（按上方层分档过滤）。
 *
 * 判据链：蓝图 id 前缀 `sbp-once-` → `singleUse === true` → 它的**舰体档位**（`shipId` → `ctx.ships`）
 * ≤ 本层允许的最高档（层 2~3 只放 T3；层 3~4 加 T4；层 5+ 加 T5）。
 * 找不到舰体的（配置错误）**不进池**——宁可稀释少一点，也不放一张抽出来不知道给什么的图纸。
 */
export function wormholeDilutionPoolOf(ctx: SimContext, depth: number): string[] {
  const d = Math.max(1, Math.floor(depth))
  const allowed = (Object.keys(WORMHOLE_DILUTION_MIN_DEPTH) as unknown as string[])
    .map((k) => Number(k) as 3 | 4 | 5)
    .filter((tier) => d >= WORMHOLE_DILUTION_MIN_DEPTH[tier])
  const out: string[] = []
  for (const id of ctx.shipBlueprints.keys()) {
    if (!id.startsWith('sbp-once-')) continue
    const bp = ctx.shipBlueprints.get(id)
    if (!bp || bp.singleUse !== true) continue
    const tier = ctx.ships.get(bp.shipId)?.tier
    if (tier === undefined || !allowed.includes(tier as 3 | 4 | 5)) continue
    out.push(id)
  }
  return out.sort()
}

/* ═══════════ 二之二、图纸货柜（2026-09-14 船长定：虫洞遗迹打捞新增） ═══════════ */

/**
 * **图纸货柜三种 = 层档**（船长 2026-09-14：「给虫洞的遗迹打捞新增图纸货柜。占 2 格大小。
 * 内部是随机 T3T4T5 舰船的一次性图纸。有较低概率出 T3 或 T4 的永久图纸。」）。
 *
 * ⚠ **层档为什么写进物品 id**：拆解读的是精炼炉产线记录里的 `itemId`（`industry.ts` 的
 * `wormholeUnboxRoll(state, ctx, r.itemId)`），而货柜撤离后进仓库只剩「物品 id + 数量」
 * ⇒ 层信息无处可挂。好在稀释池的层门槛是 **2 / 3 / 5**，**三段精确等价**：
 *   浅层 = 层 2 ⇒ 池只有 T3×10 · 中层 = 层 3~4 ⇒ T3×10 + T4×4 · 深层 = 层 5+ ⇒ 全池 15 张。
 */
export const WORMHOLE_BP_BOX_SHALLOW = 'box-bp-shallow'
export const WORMHOLE_BP_BOX_MID = 'box-bp-mid'
export const WORMHOLE_BP_BOX_DEEP = 'box-bp-deep'
/** 三种图纸货柜的 id（顺序 = 由浅到深；形状表与契约三处同序） */
export const WORMHOLE_BP_BOX_IDS = [WORMHOLE_BP_BOX_SHALLOW, WORMHOLE_BP_BOX_MID, WORMHOLE_BP_BOX_DEEP] as const
/**
 * 各层档对应的**代表层**（喂 `wormholeDilutionPoolOf` 做过滤，复用同一套门槛常量）：
 * 浅层取 2 · 中层取 3（T4 门槛）· 深层取 5（T5 门槛）。
 */
export const WORMHOLE_BP_BOX_DEPTH: Readonly<Record<string, number>> = {
  [WORMHOLE_BP_BOX_SHALLOW]: 2,
  [WORMHOLE_BP_BOX_MID]: 3,
  [WORMHOLE_BP_BOX_DEEP]: 5,
}
/** 遗迹专属掉落命中后，**安全货柜 : 图纸货柜 = 50 : 50**（船长 2026-09-14 定） */
export const WORMHOLE_BPBOX_SHARE = 0.5
/** 图纸货柜开出**永久图纸**的概率（船长 2026-09-14：「有较低概率出 T3 或 T4 的永久图纸」⇒ 5%） */
export const WORMHOLE_BPBOX_PERMANENT_CHANCE = 0.05
/** 永久图纸池的**档位门槛**（与一次性同口径：T3 层 2 起 · T4 层 3 起；**不含 T5**——船长只点了 T3/T4） */
export const WORMHOLE_PERMANENT_MIN_DEPTH: Readonly<Record<3 | 4, number>> = { 3: 2, 4: 3 }

/** 层数 ⇒ 该带哪一种图纸货柜（层 1 由 `wormholeRollRelicBox` 的入口闸挡掉，故从层 2 起） */
export function wormholeBpBoxIdOf(depth: number): string {
  const d = Math.max(1, Math.floor(depth))
  if (d <= 2) return WORMHOLE_BP_BOX_SHALLOW
  if (d <= 4) return WORMHOLE_BP_BOX_MID
  return WORMHOLE_BP_BOX_DEEP
}

/** 图纸货柜 id ⇒ 代表层（不是图纸货柜 ⇒ null） */
export function wormholeBpBoxDepthOf(boxItemId: string): number | null {
  return WORMHOLE_BP_BOX_DEPTH[boxItemId] ?? null
}

/* ═══════════ 二之三、AI 核心（2026-09-14 船长定：虫洞遗迹打捞新增掉落） ═══════════ */

/**
 * **三种 AI 核心（伽马 / 贝塔 / 阿尔法）**（船长 2026-09-14 原话：「在遗迹的打捞内，添加阿尔法、
 * 贝塔、伽马 AI 核心的掉落。AI 核心单独占 1 格。出率为 10%，**不挤占旧有出率**。
 * 三种核心根据稀有度区分出货权重」）。
 *
 * 五条已确认口径（同批船长四答）：
 * - **不进仓库、直接入核心账**（`state.aiCores`）——AI 核心在游戏里是一本账（市场买卖 / 技能上限 /
 *   副船与产线占用），洞内这一层只是"占 1 格的实物形态"⇒ 撤离成功即入账，避免两本账；
 * - **层 1 也给 10%**（船长答「层 1 也给 10%」）⇒ **没有层门槛**，与遗迹专属货柜那条（层 2 起）不同；
 * - **权重 60 / 30 / 10**（按稀有度：伽马最常见、阿尔法最金贵）；
 * - **自动探索同口径折算 ×40%**（`WORMHOLE_AUTO_MANUAL.cores`）；
 * - **结算单另加一格「AI 核心 N 枚」**。
 *
 * **"不挤占旧有出率"怎么保证**：本掉落走**自己的一条每格独立流**（种子含 `q/r`，盐值与货柜那条
 * `runSeed*53 + depth*911 + …`、收尾战那条 `runSeed*17 + depth*613 + …` 都不同）
 * ⇒ **旧掷骰的随机数消费一格不动**，货柜/稀有残骸的读数逐字不变（用例钉死）。
 */
export const WORMHOLE_CORE_GAMMA = 'ai-core-gamma'
export const WORMHOLE_CORE_BETA = 'ai-core-beta'
export const WORMHOLE_CORE_ALPHA = 'ai-core-alpha'
/** 三种核心的物品 id（顺序 = 由常见到稀有；形状表、图标色调、契约四处同序） */
export const WORMHOLE_CORE_ITEM_IDS = [WORMHOLE_CORE_GAMMA, WORMHOLE_CORE_BETA, WORMHOLE_CORE_ALPHA] as const
/** 物品 id ⇒ 核心账本的键（不是核心 ⇒ null）。命名两套（物品 `ai-core-*` / 账本 `core-*` 的 `refId`）是历史：见 items.ts 注释 */
export const WORMHOLE_CORE_TYPE: Readonly<Record<string, 'gamma' | 'beta' | 'alpha'>> = {
  [WORMHOLE_CORE_GAMMA]: 'gamma',
  [WORMHOLE_CORE_BETA]: 'beta',
  [WORMHOLE_CORE_ALPHA]: 'alpha',
}
/** 遗迹打捞结束时的**核心出货率**（船长 2026-09-14：「出率为 10%」；不看层数） */
export const WORMHOLE_CORE_SHARE = 0.1
/** 命中后三种核心的**相对权重**（船长 2026-09-14：「三种核心根据稀有度区分出货权重」⇒ 60 / 30 / 10） */
export const WORMHOLE_CORE_WEIGHTS: Readonly<Record<'gamma' | 'beta' | 'alpha', number>> = {
  gamma: 60,
  beta: 30,
  alpha: 10,
}

/** 核心账本键 ⇒ 洞内实物物品 id（发实物时用） */
export function wormholeCoreItemIdOf(type: 'gamma' | 'beta' | 'alpha'): string {
  return `ai-core-${type}`
}

/** 物品 id ⇒ 核心账本键（不是核心物品 ⇒ null） */
export function wormholeCoreTypeOfItemId(itemId: string): 'gamma' | 'beta' | 'alpha' | null {
  return WORMHOLE_CORE_TYPE[itemId] ?? null
}

/**
 * **掷遗迹打捞的 AI 核心掉落**（独立流；返回核心物品 id 或 undefined）。
 *
 * 顺序 = ① 10% 命中 ② 命中后按 60/30/10 抽一种。两个随机数都取自**本条独立流**
 * （`runSeed*71 + depth*733 + (q*31 + r*37)*17 + 13`）⇒ 不占用旧掷骰的序列。
 * **无层门槛**（船长答「层 1 也给 10%」）⇒ 层 1 的遗迹格同样有机会。
 */
export function wormholeRollCore(state: GameState, cell: WormholeGridCell): string | undefined {
  const run = state.wormhole.run
  if (!run?.grid) return undefined
  const rng = wormholeStream(runSeedOf(state) * 71 + run.depth * 733 + (cell.q * 31 + cell.r * 37) * 17 + 13)
  if (rng() >= WORMHOLE_CORE_SHARE) return undefined
  const total = WORMHOLE_CORE_WEIGHTS.gamma + WORMHOLE_CORE_WEIGHTS.beta + WORMHOLE_CORE_WEIGHTS.alpha
  let pick = rng() * total
  for (const type of ['gamma', 'beta', 'alpha'] as const) {
    pick -= WORMHOLE_CORE_WEIGHTS[type]
    if (pick < 0) return wormholeCoreItemIdOf(type)
  }
  // 浮点兜底：理论到不了（权重和 > 0），落到最常见的那一档
  return WORMHOLE_CORE_GAMMA
}

/**
 * **某层的永久图纸池**（图纸货柜的 5% 档）。
 *
 * 判据链：id 前缀 `sbp-` → **排除** `sbp-once-`（一次性，走另一半）与 `sbp-wh-`（虫洞族专属舰，
 * 走族池）→ `singleUse !== true` → 舰体档位 ∈ **{3,4}**（船长只点 T3/T4）且 ≥ 本档门槛。
 * 与稀释池同款"**按前缀 + 字段从目录派生**"纪律：以后补一张 T3/T4 永久图纸会自动进池。
 */
export function wormholePermanentPoolOf(ctx: SimContext, depth: number): string[] {
  const d = Math.max(1, Math.floor(depth))
  const out: string[] = []
  for (const id of ctx.shipBlueprints.keys()) {
    if (!id.startsWith('sbp-')) continue
    if (id.startsWith('sbp-once-') || id.startsWith('sbp-wh-')) continue
    const bp = ctx.shipBlueprints.get(id)
    if (!bp || bp.singleUse === true) continue
    const tier = ctx.ships.get(bp.shipId)?.tier
    if (tier !== 3 && tier !== 4) continue
    if (d < WORMHOLE_PERMANENT_MIN_DEPTH[tier]) continue
    out.push(id)
  }
  return out.sort()
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

/**
 * 本格的产出跟着**哪张敌卡**走（残骸物品与专属池都按它取族）。
 *
 * 2026-09-14 船长定案（丁 · 族徽）：**一处虫洞锁一族** ⇒ 整趟所有格都用该族的卡
 * （`WORMHOLE_FAMILY_CARD` 1:1）；`run.family` 缺省（老档/调试入口）按 `run.seed` 现算 ⇒ 零迁移。
 */
export function wormholeCellCardIdOf(run: WormholeRunState, cell: WormholeGridCell): string {
  void cell
  return wormholeCardIdOfFamily(run.family, run.seed)
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
  // 谜质「舱段扩展器」：货仓有效格数 +8/台（现算；物理上不越过货仓真实容量——它只是加格子）
  return wormholeBagSlotsOfFleet(state, ctx, run.fleet) + wormholeMatterBuffs(run.hold).holdCells
}

/** 一条散货占几格（数量 ÷ 每格单位数，向上取整；认不出物品 ⇒ 按 1 格兜底） */
export function wormholeCargoCellsOf(ctx: SimContext, itemId: string, units: number): number {
  const per = wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  return Math.max(1, Math.ceil(Math.max(0, units) / Math.max(1, per)))
}

/**
 * 一条散货**规范后的占格数**（= 那块**矩形**的面积；船长 2026-09-13「必须是矩形」）。
 * 全仓只此一份：容量判据、占用读数、临时空间、界面文案都走它，免得"物理格数"与"占格"两套尺打架。
 */
export function wormholeCargoSlotsOf(ctx: SimContext, itemId: string, units: number): number {
  return cargoBlockArea(wormholeCargoCellsOf(ctx, itemId, units))
}

/**
 * **一条散货拆成几件**（船长 2026-09-13 深夜：「**残骸和母矿不应该合并超过 500 立方米，当超过时，
 * 分作 2 个单独的物品格并允许单独丢弃或者移动**」）。
 *
 * 口径：一件散货**最多一格**（= 每格 `per` 单位 ≈ 500 m³），超过就**再起一件**：
 * 6 格母矿 = 6 件（每件 ≤ 2500 单位），每件都能单独拖、单独丢。
 * ⇒ 从此**不再有跨格形状**（"矩形块 / 末行补齐"那套对散货作废，只留给 2×2 货柜这类形状件）。
 * 边界：最后一件可以不满（余数），件数 = `⌈单位 ÷ 每格单位⌉`。
 */
export function wormholeCargoPieceUnitsOf(ctx: SimContext, itemId: string, units: number): number[] {
  const per = Math.max(1, wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0))
  const total = Math.max(0, Math.floor(units))
  const out: number[] = []
  let left = total
  while (left > 0) {
    const take = Math.min(per, left)
    out.push(take)
    left -= take
  }
  return out
}

/**
 * **把散货与**两块格板**对齐**（船长 2026-09-13：「散货也在货仓背包内，并允许玩家拖拽移动」
 * ＋ 同日晚「每件不超过 500 m³，超过就分件，各自可丢可拖」；**2026-09-14 扩到临时空间**）。
 *
 * 口径：`run.bag` 是**数量账本**（一种物品一条 = 总单位数），
 * `run.hold.placements` 与 `run.tempGrid.placements` 是**位置账本**（`kind:'cargo'` = **一件一格**）。
 * 本函数把三者对齐：
 * - 两块板上背包里已经没有的散货件 ⇒ 删掉；
 * - 件数与每件单位对不上（多了/少了/单件超一格）⇒ **先按原位重排**（保住玩家摆好的位置：**两块板各自的原位都算**），
 *   多出来的件先找**货仓**的空位、再找**临时空间**的空位；两边都装不下 ⇒ 记进 `unplaced`
 *   （调用方据此**拒绝这次装货**或报超载）。
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
  const temp = (run.tempGrid = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS))
  const boards: Array<{ board: WormholeHoldState; capacity: number }> = [
    { board: hold, capacity },
    { board: temp, capacity: WORMHOLE_TEMP_CELLS },
  ]
  const unplaced: string[] = []
  let moved = 0
  // ① 删掉背包里已经没有的散货件（两块板都清）
  const inBag = new Set(run.bag.map((s) => s.itemId))
  for (const { board } of boards) {
    board.placements = board.placements.filter((p) => p.kind !== 'cargo' || inBag.has(p.itemId))
  }
  // ② 逐种物品对齐：目标 = 一串"每件 ≤ 一格"的件
  for (const slot of run.bag) {
    const want = wormholeCargoPieceUnitsOf(ctx, slot.itemId, slot.units)
    /** 两块板上的现有件（**按板序**：货仓优先，临时空间在后） */
    const existing = boards.flatMap(({ board }) =>
      board.placements.filter((p) => p.kind === 'cargo' && p.itemId === slot.itemId).map((p) => ({ p, board })),
    )
    // 位置池：玩家现有位置优先（先按 y/x 排，保住"摆在哪儿"的意图 —— 货仓的位次在前）
    const spots = existing
      .map(({ p, board }) => ({ x: p.x, y: p.y, board }))
      .sort((a, b) => (a.board === b.board ? a.y - b.y || a.x - b.x : a.board === hold ? -1 : 1))
    for (const { board } of boards) {
      board.placements = board.placements.filter((q) => !(q.kind === 'cargo' && q.itemId === slot.itemId))
    }
    let kept = 0
    for (const units of want) {
      const id = `${slot.itemId}#${kept}`
      const prev = spots[kept]
      // 先试原位（同一格大小，通常原样保留）
      if (prev && canPlace(prev.board, prev.x, prev.y, WORMHOLE_CARGO_PIECE, prev.board === hold ? capacity : WORMHOLE_TEMP_CELLS)) {
        prev.board.placements.push({ id, itemId: slot.itemId, kind: 'cargo', units, x: prev.x, y: prev.y, w: 1, h: 1 })
        if (existing[kept]?.p.units !== units) moved += 1
        kept += 1
        continue
      }
      // 再找空位：货仓 → 临时空间
      let placed: { x: number; y: number; board: WormholeHoldState } | null = null
      for (const { board, capacity: cap } of boards) {
        const spot = findCargoSpot(board, WORMHOLE_CARGO_PIECE, undefined, cap)
        if (spot) {
          placed = { x: spot.x, y: spot.y, board }
          break
        }
      }
      if (!placed) break // 两边都装不下：剩下的记进 unplaced（调用方回滚或报超载）
      placed.board.placements.push({ id, itemId: slot.itemId, kind: 'cargo', units, x: placed.x, y: placed.y, w: 1, h: 1 })
      moved += 1
      kept += 1
    }
    if (kept < want.length) unplaced.push(slot.itemId)
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
  // 背包里有、**两块板**上都没摆下的（沉船缩容 / 坏档 / 老档大件）⇒ 也算超载。
  // ⚠ 散货是**一件一格**（船长 2026-09-13 深夜）⇒ 按"**该物品已占的格数** vs 需要格数"算：
  //   老档里那种 8×1 大件算 8 格（不是 1 件），否则会把老档误报成"凭空少了 21 格"（实测踩过）。
  // ⚠ 2026-09-14：**临时空间里的散货件也算"已摆下"**（否则把货挪进临时空间会被误报成超载）。
  let unplacedCells = 0
  const cargoBoards = [run.hold, run.tempGrid]
  for (const slot of run.bag) {
    const want = wormholeCargoPieceUnitsOf(ctx, slot.itemId, slot.units).length
    let haveCells = 0
    for (const board of cargoBoards) {
      haveCells += (board?.placements ?? [])
        .filter((p) => p.kind === 'cargo' && p.itemId === slot.itemId)
        .reduce((n, p) => n + placementCellsCount(p), 0)
    }
    unplacedCells += Math.max(0, want - haveCells)
  }
  const used = cargoCells + shapeCells + unplacedCells
  return { used, capacity, cargoCells, shapeCells, unplacedCells, overload: used > capacity }
}

/** **超载**判据（沉船后格数变小 ⇒ 玩家必须手动抛货；船长 2026-09-13 裁定 8） */
export function wormholeHoldOverloaded(state: GameState, ctx: SimContext): boolean {
  return wormholeHoldUsage(state, ctx).overload
}

/* ═══════════ 三之三之二、临时空间（4 列 × 8 行 = 32 格 · 船长 2026-09-14 定案） ═══════════ */

/**
 * **临时空间**（船长 2026-09-13：「大件货先进临时空间，让玩家协调」→ 2026-09-14：
 * 「背包格宽度是 8 格，那么可以在背包格右边添加一个用于丢弃和调整位置的『小背包』…
 * **正式名：临时空间**」）：**4 列 × 8 行 = 32 格**的格子区，挂在货仓 8 列右侧。
 *
 * 三条口径（船长 2026-09-14 确认）：
 * - **不占货仓容量、不算超载** ⇒ 超载时也能用它腾位置；
 * - **能放形状件与散货件**（与货仓同一套格几何、同一套拖拽/整理/不重叠判据）；
 * - **离开背包页前必须清空**（「强制二选一：丢掉 或 放回」；撤离前同样必须先清空）。
 *
 * ⚠ **谜质储存器放进来即失效**（船长：「谜质储存器拖进小背包会失效」）：增益只从 `run.hold` 现算。
 */

/** 临时空间的格板（**懒建**：老档没有 = 空的，零迁移） */
export function wormholeTempBoard(run: WormholeRunState): WormholeHoldState {
  return (run.tempGrid = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS))
}

/** 临时空间当前占用（按格算；容量固定 `WORMHOLE_TEMP_CELLS = 32`） */
export function wormholeTempUsage(
  state: GameState,
  ctx: SimContext,
): { cells: number; capacity: number; placements: WormholeHoldPlacement[]; full: boolean } {
  void ctx
  const run = state.wormhole.run
  const placements = run?.tempGrid?.placements ?? []
  let cells = 0
  for (const p of placements) cells += placementCellsCount(p)
  return { cells, capacity: WORMHOLE_TEMP_CELLS, placements, full: cells >= WORMHOLE_TEMP_CELLS }
}

/** 临时空间里还有多少件要处理（**离页/撤离前必须清零**：船长 2026-09-14「强制二选一」） */
export function wormholeTempPending(
  state: GameState,
  ctx: SimContext,
): { count: number; cells: number; placements: WormholeHoldPlacement[] } {
  const u = wormholeTempUsage(state, ctx)
  return { count: u.placements.length, cells: u.cells, placements: u.placements }
}

/**
 * **往临时空间放一件形状件**（收货阶梯第二层；放不下 ⇒ false，调用方让货留在原地）。
 */
export function wormholeTempAddShape(
  state: GameState,
  ctx: SimContext,
  itemId: string,
): { ok: boolean; cells?: number; error?: string } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  if (!wormholeIsShapedItem(itemId)) return { ok: false, error: '这件东西不是形状件。' }
  const board = wormholeTempBoard(run)
  const r = holdAdd(board, itemId, WORMHOLE_TEMP_CELLS)
  if (!r.ok) {
    const shape = wormholeShapeOf(itemId)
    const cur = wormholeTempUsage(state, ctx)
    return {
      ok: false,
      error: `临时空间也放不下（${cur.cells}/${cur.capacity} 格，这件要 ${shape.w * shape.h} 格）。`,
    }
  }
  const need = wormholeShapeOf(itemId).w * wormholeShapeOf(itemId).h
  const name = ctx.items.get(itemId)?.name ?? itemId
  addLog(
    state,
    'info',
    `🕳 放进临时空间：${name}（占 ${need} 格）——到「背包」页整理进货仓或丢弃（**离开背包页前必须处理**）。`,
  )
  return { ok: true, cells: need }
}

/**
 * **把临时空间里的件放进货仓**（一件；放不下 ⇒ 原样留在临时空间）。
 * 形状件与散货件走同一条路：`holdTransferTo`（货仓按容量判、形状/实占格原样带过去）。
 */
export function wormholeTempStowPiece(
  state: GameState,
  ctx: SimContext,
  id: string,
): { ok: boolean; error?: string } {
  const run = state.wormhole.run
  if (!run?.tempGrid) return { ok: false, error: '临时空间是空的。' }
  const p = run.tempGrid.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '临时空间里没有这件东西。' }
  run.hold = run.hold ?? makeHoldState()
  const capacity = wormholeHoldCapacityOf(state, ctx)
  // 形状件先按容量拦一道（与 `wormholeHoldStow` 同一把尺：别把玩家当场顶成超载）
  if (p.kind === 'box') {
    const before = wormholeHoldUsage(state, ctx)
    const need = placementCellsCount(p)
    if (before.used + need - before.unplacedCells > capacity && before.used + need > capacity) {
      return { ok: false, error: `货仓放不下：这件要占 ${need} 格（现在 ${before.used}/${capacity} 格）。` }
    }
  }
  const r = holdTransferTo(run.tempGrid, run.hold, id, capacity)
  if (!r.ok) return { ok: false, error: r.error }
  wormholeSyncMatterTurns(state) // 谜质装置进货仓 ⇒ 实时派生（时序核心 +10）；从货仓拿出 ⇒ 夹紧
  const name = ctx.items.get(p.itemId)?.name ?? p.itemId
  addLog(state, 'info', `🕳 整理：${name} 从临时空间进货仓。`)
  return { ok: true }
}

/** **丢弃临时空间里的一件**（手动；与货仓的抛货同一把尺。谜质装置 ⇒ 同步夹紧回合） */
export function wormholeTempDiscardPiece(
  state: GameState,
  ctx: SimContext,
  id: string,
): { ok: boolean; error?: string } {
  const run = state.wormhole.run
  if (!run?.tempGrid) return { ok: false, error: '临时空间是空的。' }
  const p = run.tempGrid.placements.find((q) => q.id === id)
  if (!p) return { ok: false, error: '临时空间里没有这件东西。' }
  run.tempGrid.placements = run.tempGrid.placements.filter((q) => q.id !== id)
  // 散货：数量账本也要跟着减（否则下次 sync 会把它重新铺出来）
  if (p.kind === 'cargo') {
    const cut = Math.max(1, Math.floor(p.units ?? 0))
    const slot = run.bag.find((s) => s.itemId === p.itemId)
    if (slot) {
      slot.units = Math.max(0, slot.units - cut)
      if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== p.itemId)
    }
  }
  wormholeSyncMatterTurns(state)
  const name = ctx.items.get(p.itemId)?.name ?? p.itemId
  addLog(state, 'warn', `🕳 丢弃（临时空间）：${name}${(p.units ?? 0) > 1 ? `×${Math.floor(p.units ?? 0)}` : ''}。`)
  return { ok: true }
}

/** **临时空间里的件全部放回货仓**（逐件尝试；放不下的留下，界面据此再提示） */
export function wormholeTempStowAll(state: GameState, ctx: SimContext): { moved: number; stuck: string[] } {
  const run = state.wormhole.run
  const stuck: string[] = []
  let moved = 0
  for (const p of [...(run?.tempGrid?.placements ?? [])]) {
    const r = wormholeTempStowPiece(state, ctx, p.id)
    if (r.ok) moved += 1
    else stuck.push(p.id)
  }
  return { moved, stuck }
}

/** **临时空间里的件全部丢弃**（离页确认条的「丢掉这些」；逐件走同一条丢弃路径） */
export function wormholeTempDiscardAll(state: GameState, ctx: SimContext): { moved: number } {
  const run = state.wormhole.run
  let moved = 0
  for (const p of [...(run?.tempGrid?.placements ?? [])]) {
    const r = wormholeTempDiscardPiece(state, ctx, p.id)
    if (r.ok) moved += 1
  }
  return { moved }
}

/**
 * **老档换算**（施工期一次）：旧的 `run.temp`（一种物品一条的列表 · 8 格上限）
 * → 新的 `run.tempGrid`（4×8 = 32 格格子账本）。
 *
 * 为什么一定装得下：旧容量 8 格 ≤ 新容量 32 格，且散货按"一件一格"、形状件 2×2 —— 任何旧组合都排得进。
 * 散货并进 `run.bag`（**唯一数量账本**）后由 `wormholeHoldSyncCargo` 铺到两板上。
 */
export function wormholeNormalizeLegacyTemp(
  state: GameState,
  ctx: SimContext,
): { moved: number } {
  const run = state.wormhole.run
  if (!run?.temp?.length) {
    if (run) run.temp = undefined
    return { moved: 0 }
  }
  const legacy = [...run.temp]
  run.temp = undefined
  const board = wormholeTempBoard(run)
  let moved = 0
  for (const slot of legacy) {
    if (wormholeIsShapedItem(slot.itemId)) {
      if (holdAdd(board, slot.itemId, WORMHOLE_TEMP_CELLS).ok) moved += 1
      continue
    }
    const hit = run.bag.find((s) => s.itemId === slot.itemId)
    if (hit) hit.units += slot.units
    else run.bag.push({ itemId: slot.itemId, units: slot.units })
    moved += 1
  }
  wormholeHoldSyncCargo(state, ctx)
  return { moved }
}

/**
 * **收货阶梯**（船长 2026-09-13：「打捞出了大件货时应该放进一个临时空间或者临时背包，让玩家进行协调」）：
 * ① 先试**货仓格**（形状件 2×2 / 散货对齐网格）；② 放不下 ⇒ 试**临时空间（32 格）**；
 * ③ 两边都放不下 ⇒ 失败（调用方让货留在原地，别静默丢）。
 *
 * 这是"大件落地"的唯一入口：遗迹打捞出安全货柜、玩家拾取货柜都走它 —— 判据只有一份。
 */
export function wormholeStowOrTemp(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  units = 1,
): { ok: boolean; where?: 'hold' | 'temp'; error?: string } {
  if (wormholeIsShapedItem(itemId)) {
    const stowed = wormholeHoldStow(state, ctx, itemId)
    if (stowed.ok) {
      wormholeSyncMatterTurns(state) // 谜质装置落进货仓 ⇒ 实时派生（时序核心 +10）
      return { ok: true, where: 'hold' }
    }
    const temp = wormholeTempAddShape(state, ctx, itemId)
    if (temp.ok) return { ok: true, where: 'temp' }
    return { ok: false, error: `${stowed.error ?? '货仓放不下'} ${temp.error ?? ''}`.trim() }
  }
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  if (tryMergeIntoBag(state, ctx, run, { itemId, units })) return { ok: true, where: 'hold' }
  return { ok: false, error: '货仓与临时空间都放不下（先整理或丢弃腾位置）。' }
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

/**
 * **抛弃一件**（手动抛货 · 船长裁定 8）。
 * 给 `units` ⇒ **只丢这一件里的一部分**（船长 2026-09-13 深夜：「玩家抛弃时，添加一个让玩家
 * 选择抛弃多少的拖动条并允许输入数量」）：件是**一件一格**，部分抛弃后件仍占那一格（余量留在原格），
 * 数量账本 `run.bag` 同步扣减；扣到 0 就整件消失。
 * 形状件（货柜）没有"部分抛弃"这回事（它是一件整体）⇒ 只认整件丢。
 */
export function wormholeHoldDiscard(
  state: GameState,
  ctx: SimContext,
  placementId: string,
  units?: number,
): { ok: boolean; error?: string; dropped?: number } {
  const run = state.wormhole.run
  if (!run?.hold) return { ok: false, error: '货仓里没有可抛弃的件。' }
  const target = run.hold.placements.find((p) => p.id === placementId)
  if (!target) return { ok: false, error: '没有这个件。' }
  const name = ctx.items.get(target.itemId)?.name ?? target.itemId
  // 形状件：只认整件
  if (target.kind === 'box' || units === undefined) {
    const gone = holdRemove(run.hold, placementId)
    if (!gone) return { ok: false, error: '没有这个件。' }
    // 谜质装置被抛掉 ⇒ 回合同步（**夹紧**：上限变小、剩余夹到新上限），并把代价写进事件日志
    wormholeSyncMatterTurns(state)
    const hint = wormholeMatterDiscardHint(gone.itemId)
    if (hint) addLog(state, 'warn', `🕳 ${hint}`)
    if (gone.kind === 'cargo') {
      const slot = run.bag.find((s) => s.itemId === gone.itemId)
      if (slot) {
        slot.units -= gone.units ?? 0
        if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== gone.itemId)
      }
      wormholeHoldSyncCargo(state, ctx)
    }
    addLog(
      state,
      'warn',
      `🕳 抛弃：${name}${gone.kind === 'cargo' ? ` ×${Math.floor(gone.units ?? 0)}` : ''}` +
        `（货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格）。`,
    )
    return { ok: true, dropped: Math.floor(gone.units ?? 0) }
  }
  // 散货件：按数量部分抛弃（至少 1，最多这件全部）
  const have = Math.max(0, Math.floor(target.units ?? 0))
  const cut = Math.max(1, Math.min(have, Math.floor(units)))
  target.units = have - cut
  const slot = run.bag.find((s) => s.itemId === target.itemId)
  if (slot) {
    slot.units -= cut
    if (slot.units <= 0) run.bag = run.bag.filter((s) => s.itemId !== target.itemId)
  }
  if ((target.units ?? 0) <= 0) holdRemove(run.hold, placementId)
  wormholeHoldSyncCargo(state, ctx)
  wormholeSyncMatterTurns(state)
  addLog(
    state,
    'warn',
    `🕳 抛弃：${name} ×${cut.toLocaleString('zh-CN')}（这一件还剩 ${Math.max(0, target.units ?? 0).toLocaleString('zh-CN')}）·` +
      ` 货仓 ${wormholeHoldUsage(state, ctx).used}/${wormholeHoldCapacityOf(state, ctx)} 格。`,
  )
  return { ok: true, dropped: cut }
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
 * **超载判据**（只看货仓；临时空间那一条见 `wormholeTempBlockReason`）：
 * 沉船缩水后 `used > capacity` 就是超载 —— 玩家必须先抛货。
 */
export function wormholeOverloadBlockReason(state: GameState, ctx: SimContext): string | null {
  const u = wormholeHoldUsage(state, ctx)
  if (!u.overload) return null
  return `货仓超载（${u.used}/${u.capacity} 格）：先抛货再继续（货仓页可以抛弃）。`
}

/**
 * **临时空间未完待理**的封锁理由（船长 2026-09-14：「**临时空间内有物品就不允许进行其他操作，
 * 和之前的超载类似**」）。
 *
 * 为什么要有它：临时空间是"落地缓冲 + 待丢区"，**不是第二个仓位** —— 一旦里面有东西，
 * 玩家必须先在背包页把它处理掉（**放回货仓** 或 **丢弃**，强制二选一）才能继续探索。
 * 这条同时把上一版"沉船缩水后可以先继续搜打撤"的口径收回：现在**立刻封锁**，与超载同款。
 * ⚠ 仍然**不软锁**：丢弃/放回都在背包页做得到，且丢弃永远可用。
 */
export function wormholeTempBlockReason(state: GameState, ctx: SimContext): string | null {
  const pending = wormholeTempPending(state, ctx)
  if (pending.count <= 0) return null
  return (
    `临时空间里有 ${pending.count} 件没处理（${pending.cells}/${WORMHOLE_TEMP_CELLS} 格）：` +
    `先到「背包」页把它们**放回货仓**或**丢弃**，再继续。`
  )
}

/**
 * **动作闸（唯一入口）**：能装货/移动的动作都要先过它 ——
 * ① 临时空间有东西（必须先去背包页处理）② 货仓超载（必须抛货）。
 *
 * ⚠ 顺序有意为之：临时空间那条更"卡脖子"（处理它就得进背包页，抛货也在那一页），故优先报它。
 */
export function wormholeActionBlockReason(state: GameState, ctx: SimContext): string | null {
  return wormholeTempBlockReason(state, ctx) ?? wormholeOverloadBlockReason(state, ctx)
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
  /**
   * ⚠ **只把形状件（安全货柜）从额度里扣掉**：散货是"一件一格"、本来就该按容量裁 ——
   * 这里若用 `holdCellsUsed(run.hold)`（它把**所有**摆放件都算上，含散货件），
   * 缩容后刚摆下的那几件散货会把额度吃到 0 ⇒ 一键抛货会把**贵货也一起丢光**
   * （2026-09-13 深夜实测：`cargoCap` 算成 0、两种货全被丢）。
   */
  const shapeCells = wormholeHoldUsage(state, ctx).shapeCells
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
/**
 * **把一堆搬上船**（玩家入口 = 超载闸 + 形状件分流 + 装舱判据）。
 *
 * ⚠ **网格层的残骸/母矿没有"逐堆拾取"**（船长 2026-09-13 裁定 A）：那两类走「**打捞**」/「**采集**」，
 * 都要对应装备（打捞器 / 采集器）、回合口径都是 ⌈堆数 ÷ 台数⌉ —— 判据只有一份。
 *
 * ⚠⚠ **但「遗迹安全货柜」必须走这条路**（2026-09-13 修的真 BUG）：它是**形状件**（2×2 = 4 格、
 * 放不下**整件拒收**），F4 裁定要求它靠玩家拾取装舱；若把"网格层一律拒绝"放在形状件分支之前，
 * 货柜就**再也捡不起来**（唯一入口被自己堵死），而「打捞」那条路会把它当普通散货塞进背包
 * —— 2000 m³ 的单位体积使 `wormholeUnitsPerSlot` = 0，回退成 **1 单位/格** ⇒ 货柜只占 **1 格**
 * 且失去方块形状（探针实测：`hold=[box-relic-a 1x1 cargo]`）。故**形状件分支提到网格判定之前**。
 *
 * 为什么不把它放进 `wormhole.ts`：① 超载闸要 `ctx`；② 形状件要走货仓格（`wormholeHoldStow`）；
 * ③ `wormhole.ts` 不许 import 本文件（`state.ts` → `wormhole.ts`，而本文件 import `state.ts` ⇒ 会成环）。
 */
export function wormholeTakePileAt(
  state: GameState,
  ctx: SimContext,
  pileIndex: number,
): { ok: boolean; error?: string; taken?: WormholePile; used?: number; capacity?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  const blocked = wormholeActionBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const grid = run.grid
  const holder: { piles?: WormholePile[] } | undefined = grid
    ? gridCellAt(grid, grid.pos)
    : (run.pendingNode ?? undefined)
  const pile = holder?.piles?.[pileIndex]
  if (!pile) return { ok: false, error: '这里没有可拾取的东西。' }
  if (wormholeIsShapedItem(pile.itemId)) {
    /**
     * **形状件**（遗迹安全货柜）：走**收货阶梯** —— 先货仓格、放不下进**临时空间**、
     * 两边都满才拒收（船长 2026-09-13：「大件货先进临时空间，让玩家协调」）。
     */
    const landed = wormholeStowOrTemp(state, ctx, pile.itemId, pile.units)
    if (!landed.ok) return { ok: false, error: landed.error }
    holder!.piles!.splice(pileIndex, 1)
    const u = wormholeHoldUsage(state, ctx)
    return { ok: true, taken: pile, used: u.used, capacity: u.capacity }
  }
  // 网格层：普通堆（残骸 / 母矿）不许逐堆拾取 —— 走打捞 / 采集
  if (grid) {
    return { ok: false, error: '网格层不能逐堆拾取：残骸用「打捞」、母矿用「采集」（都要对应装备）。' }
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
  const blocked = wormholeActionBlockReason(state, ctx)
  if (blocked) return { ok: false, error: blocked }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。' }
  if (cell.place !== 'vein') return { ok: false, error: '这个地点没有可采集的矿脉。' }
  const baseMiners = wormholeMinersOf(state, ctx)
  if (baseMiners <= 0) return { ok: false, error: '编队里没有采集器：矿脉挖不动（至少装 1 台）。' }
  // 谜质「采集钻机」：每次采集 +1 堆/台（门槛仍看真采集器）
  const miners = baseMiners + wormholeMatterBuffs(run.hold).collectPiles
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
  /** 打捞结束时掷中的 **AI 核心**（2026-09-14 船长定；已装进货仓/临时空间/散落该格，撤离成功才入核心账） */
  cores?: string[]
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
  const baseRigs = wormholeSalvagersOf(state, ctx)
  if (baseRigs <= 0) {
    return { ok: false, error: '编队里没有打捞器：打捞作业干不了（至少装 1 台）。' }
  }
  // 谜质「打捞起重机」：每次打捞 +1 堆/台（**门槛仍看真打捞器**——装置不替代装备）
  const rigs = baseRigs + wormholeMatterBuffs(run.hold).salvagePiles
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
  let boxLeft = 0
  for (let i = 0; i < rigs && piles.length > 0; i++) {
    const pile = piles[0]!
    /**
     * ⚠ **形状件（遗迹安全货柜）不参与"打捞回收"**（2026-09-13 修的真 BUG）：
     * 它必须由玩家**拾取装舱**（占 2×2 = 4 格、放不下整件拒收 —— 船长 F4 裁定）；
     * 若让它走 `tryMergeIntoBag`，它会被当普通散货塞进背包，而 2000 m³ 的单位体积使
     * `wormholeUnitsPerSlot` = 0（回退 1 单位/格）⇒ 货柜只占 **1 格**、方块形状也丢了。
     * 这里就地停下（**不吞、不挡后面的普通堆**：货柜是"捞空之后才散落"的，永远排在最后）。
     */
    if (wormholeIsShapedItem(pile.itemId)) {
      boxLeft = piles.filter((p) => wormholeIsShapedItem(p.itemId)).length
      break
    }
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
  // 形状件留在原地时点明"要自己拾取"（不然玩家会以为漏拿了）
  if (boxLeft > 0) {
    addLog(
      state,
      'warn',
      `🕳 这一格还有 ${boxLeft} 件货柜：**它不是散货、打捞器搬不动**——` +
        `点堆位自己拾取装舱（形状件按占地占货仓格；货仓腾不出会先进临时空间）。`,
    )
  }
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
    /**
     * **遗迹专属掉落 = 一个「遗迹安全货柜」**（F4）。落地走**收货阶梯**
     * （船长 2026-09-13：「**打捞出了大件货时应该放进一个临时空间或者临时背包，让玩家进行协调**」）：
     * ① 货仓腾得出该形状 ⇒ 直接装进货仓格；② 腾不出 ⇒ **放进临时空间**（玩家到货仓页整理）；
     * ③ 两边都满 ⇒ 才散落在该格（并提示"腾出空间后回来拾取"）。
     * ⚠ 占格数**按形状现算**（安全货柜 2×2 = 4 格 / 图纸货柜 2×1 = 2 格），不写死。
     */
    const boxId = wormholeRollRelicBox(state, ctx, cell)
    if (boxId) {
      const name = ctx.items.get(boxId)?.name ?? boxId
      const shp = wormholeShapeOf(boxId)
      const landed = wormholeStowOrTemp(state, ctx, boxId, 1)
      if (landed.where === 'hold') {
        addLog(state, 'info', `🕳 遗迹深处发现${name}：已装进货仓（占 ${shp.w}×${shp.h} = ${shp.w * shp.h} 格）。`)
      } else if (landed.where === 'temp') {
        addLog(
          state,
          'info',
          `🕳 遗迹深处发现${name}：货仓腾不出 ${shp.w}×${shp.h} ⇒ **先放进临时空间**（到「货仓」页整理进货仓）。`,
        )
      } else {
        cell.piles = [...(cell.piles ?? []), { itemId: boxId, units: 1 }]
        addLog(
          state,
          'warn',
          `🕳 遗迹深处发现${name}：**货仓与临时空间都放不下** ⇒ 先散落在该地点（腾出空间后回来拾取）。`,
        )
      }
      result.relics = [boxId]
    }
    /**
     * **AI 核心**（2026-09-14 船长定「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的掉落。
     * AI 核心单独占 1 格。出率为 10%，不挤占旧有出率」）：走**与上面货柜完全独立的一条流**
     * （`wormholeRollCore` 自带盐值）⇒ 上面那次掷骰的随机数消费不受影响，旧读数逐字不变。
     * 落格走**与货柜同一套收货阶梯**（货仓 → 临时空间 → 散落该格）——它是**形状件**（1×1 = 1 格）。
     */
    const coreId = wormholeRollCore(state, cell)
    if (coreId) {
      const name = ctx.items.get(coreId)?.name ?? coreId
      const landed = wormholeStowOrTemp(state, ctx, coreId, 1)
      if (landed.where === 'hold') {
        addLog(state, 'info', `🕳 遗迹深处发现${name}：已装进货仓（占 1 格）。`)
      } else if (landed.where === 'temp') {
        addLog(state, 'info', `🕳 遗迹深处发现${name}：货仓腾不出 1 格 ⇒ **先放进临时空间**（到「货仓」页整理进货仓）。`)
      } else {
        cell.piles = [...(cell.piles ?? []), { itemId: coreId, units: 1 }]
        addLog(state, 'warn', `🕳 遗迹深处发现${name}：**货仓与临时空间都放不下** ⇒ 先散落在该地点（腾出空间后回来拾取）。`)
      }
      result.cores = [coreId]
    }
    const rng = wormholeStream(runSeedOf(state) * 17 + run.depth * 613 + (cell.q * 41 + cell.r * 53) * 11 + 5)
    if (rng() < WORMHOLE_RUINS_BATTLE_CHANCE) {
      result.effect = { kind: 'ruinsBattle', key: cell.key }
    // **记「待迎战」标记**（船长 2026-09-13）：界面据此弹确认条；玩家点「迎战」之前别的动作一律被拦
    run.pendingRuinsBattle = true
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
 * **掷遗迹专属掉落 = 一个货柜**（F4 · 船长 2026-09-13：「装备和蓝图的产出加一个中间件：
 * 玩家从遗迹获得『遗迹安全货柜』…将安全货柜带回后在精炼炉拆解」）。
 *
 * 口径：
 * - **概率随层上升**（`wormholeRelicChanceOf`；层 1 恒不出）；
 * - **命中后再掷一次分种类**（2026-09-14 船长定「与安全货柜并列」）：
 *   **安全货柜 50 : 图纸货柜 50**（`WORMHOLE_BPBOX_SHARE`）——图纸货柜按层档取三种之一；
 * - **族 = 本格敌卡的族**（保住「专属掉落按种族库走」这条裁定：内容物等拆解时才揭，族不能丢）；
 * - **不直接入库**：调用方把货柜**散落到该格**，玩家自己拾取（占货仓格数按形状现算；放不下整件拒收）；
 * - 内容物（装备本体 / 装备图纸 / 舰船图纸 / 永久图纸）留待拆解。
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
  // 2026-09-14：命中后再掷一次分种类（安全货柜 / 图纸货柜）。⚠ 这条流是**每格独立**的
  // （种子含 q/r），多抽一个随机数不会影响别的格子"出不出货"。
  if (rng() >= 1 - WORMHOLE_BPBOX_SHARE) return wormholeBpBoxIdOf(run.depth)
  const family = familyOfCard(ctx, wormholeCellCardIdOf(run, cell))
  return wormholeRelicBoxIdOf(family)
}

/**
 * **撤离成功后把随行战利品入库**：
 * - 装备本体（`mod-*`）⇒ 装备库（`addModule`）；
 * - 一次性图纸（`bp-*` / `sbp-*`）⇒ 蓝图书架（组装机用掉）；
 * - **物品**（`ctx.items`：遗迹安全货柜、池里的族专属无人机…）⇒ 仓库，
 *   数量按 `wormholePoolGrantUnitsOf`（无人机一次 10 架，其余 1 件）。
 *
 * 由 `settleWormholeBattle` 在撤离战胜利那一支调用；**半路全损 ⇒ 一起丢**（本函数根本不跑）。
 * ⚠ 2026-09-13 修：F4 把遗迹掉落改成「安全货柜」= **物品**（`ctx.items`）后，这里原先只认模块/图纸
 * ⇒ 货柜走到这一步会被**静默丢掉**（"带回后精炼炉拆解"永远发生不了）。物品分支就是补这个洞。
 */
/** 拆解一件货柜的抽取结果（`source` = 来源池，日志按它加后缀） */
export interface WormholeUnboxDraw {
  itemId: string
  units: number
  /** 族专属池 / 一次性图纸池 / 永久图纸池 */
  source: 'family' | 'once' | 'permanent'
}

/**
 * **拆解一件货柜抽 1 件**（F4d · 船长 2026-09-13 定：精炼炉拆解 · 90 秒/件 · 抽出后走
 * `wormholeDeliverRelics` 同一条入库路径）。
 *
 * **2026-09-14 船长改判（新增图纸货柜）后两台口径分岔**：
 * - **图纸货柜**（`box-bp-*`）：**5% 永久图纸池 / 95% 一次性图纸池**，两者都按**该货柜的层档**过滤
 *   （浅层 → T3 · 中层 → T3+T4 · 深层 → T3+T4+T5）；
 * - **安全货柜**（`box-relic-*`）：**100% 族专属池**——原「族池 0.7 : 稀释池 0.3」的稀释池**已收回**
 *   （一次性图纸改由图纸货柜专出，否则同一批图纸会有两条渠道）。
 *
 * 族由货柜 id 反推（`box-relic-a` ⇒ A 族）；族池内部再按 `wormholeRelicWeightsOf` 的
 * 装备 / 装备图纸 / 舰船图纸 权重抽一类，然后在类内均匀抽一件；件数走 `wormholePoolGrantUnitsOf`
 * （族专属无人机 ×10，其余 1 件）。随机数走 `state.rng`（与回收炉开箱同源 ⇒ 随档、可复现）。
 * 抽取池为空（内容缺失）⇒ 返回 null（调用方记账后停这一批，不静默丢）。
 */
export function wormholeUnboxRoll(
  state: GameState,
  ctx: SimContext,
  boxItemId: string,
): WormholeUnboxDraw | null {
  // ① 图纸货柜：按层档过滤的两个池（先掷永久 / 一次性）
  const bpDepth = wormholeBpBoxDepthOf(boxItemId)
  if (bpDepth !== null) {
    const permanent = nextRandom(state.rng) < WORMHOLE_BPBOX_PERMANENT_CHANCE
    const pool = permanent ? wormholePermanentPoolOf(ctx, bpDepth) : wormholeDilutionPoolOf(ctx, bpDepth)
    if (pool.length === 0) return null
    const id = pool[nextInt(state.rng, pool.length)]!
    return { itemId: id, units: wormholePoolGrantUnitsOf(id), source: permanent ? 'permanent' : 'once' }
  }
  // ② 安全货柜：100% 族专属池
  const family = wormholeFamilyOfBox(boxItemId)
  if (!family) return null
  const pool = wormholeFamilyPoolOf(ctx, family)
  const w = wormholeRelicWeightsOf(WORMHOLE_DILUTION_MIN_DEPTH_FLOOR)
  const buckets: Array<{ ids: string[]; weight: number }> = [
    { ids: pool.modules, weight: w.modules },
    { ids: pool.moduleBlueprints, weight: w.moduleBlueprints },
    { ids: pool.shipBlueprints, weight: w.shipBlueprints },
    { ids: pool.drones ?? [], weight: Math.max(1, Math.min(w.modules, w.moduleBlueprints, w.shipBlueprints)) },
  ].filter((b) => b.ids.length > 0 && b.weight > 0)
  if (buckets.length === 0) return null
  const total = buckets.reduce((s, b) => s + b.weight, 0)
  let roll = nextRandom(state.rng) * total
  let hit = buckets[buckets.length - 1]!
  for (const b of buckets) {
    roll -= b.weight
    if (roll <= 0) {
      hit = b
      break
    }
  }
  const id = hit.ids[nextInt(state.rng, hit.ids.length)]!
  return { itemId: id, units: wormholePoolGrantUnitsOf(id), source: 'family' }
}

/** 货柜 id ⇒ 族（ox-relic-a ⇒ A；不是货柜 ⇒ null） */
export function wormholeFamilyOfBox(boxItemId: string): string | null {
  const m = /^box-relic-([a-g])$/i.exec(boxItemId)
  return m ? m[1]!.toUpperCase() : null
}
export function wormholeDeliverRelics(state: GameState, ctx: SimContext, relics: readonly string[]): string[] {
  const done: string[] = []
  for (const id of relics) {
    if (ctx.modules.has(id)) {
      addModule(state, id)
      done.push(ctx.modules.get(id)?.name ?? id)
    } else if (ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)) {
      state.blueprintStock[id] = (state.blueprintStock[id] ?? 0) + 1
      done.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    } else if (ctx.items.has(id)) {
      const units = wormholePoolGrantUnitsOf(id)
      addWare(state, id, units)
      done.push(`${ctx.items.get(id)?.name ?? id}×${units}`)
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
  const piles = wormholeNodePilesFor(state, cell, count)
  /**
   * 谜质「母矿富集器」：**铺堆那一刻**按倍率放大（+25%/台）。
   * 铺在"到达那一刻"（`wormholeEnsureArrivalPiles`）⇒ 装置是**到那儿之前**背上才吃得到，
   * 这与"放在货仓里就生效"一致：堆一旦铺好就不再回头改（免得同一格进进出出反复变数）。
   */
  const mul = wormholeMatterBuffs(run.hold).oreYieldMul
  cell.piles = mul === 1 ? piles : piles.map((p) => ({ ...p, units: Math.max(1, Math.round(p.units * mul)) }))
}

/**
 * **谜质·回合上限同步**（F3c · 船长 2026-09-13 裁定「实时派生 + 夹紧」，本函数**幂等**）。
 *
 * 本趟上限 = `turnsBase`（入场预算）＋ 10 × **货仓里**的「时序核心」台数。
 * 为什么用"每次货仓变动后重算一遍"而不是"捡一处 +10、抛一处 −10"：装置会在
 * 货仓 / 临时空间 / 丢弃三条路上来回走，逐处加减迟早漏一处；重算永远收敛到同一个答案。
 *
 * 夹紧口径：
 * - 上限**变大** ⇒ 剩余**同样多给这么多**（捡到就真能多走几步）；
 * - 上限**变小**（丢掉了装置）⇒ 剩余**夹到新上限**、**永不为负**；**不追缴**已经花掉的回合
 *   —— 这也是船长问的那条：「丢弃回合相关谜质导致回合数不够」时，玩家只是走不动了，
 *   **撤离永远可用**（`wormholeExtract` 不看回合），不会软锁。
 */
export function wormholeSyncMatterTurns(state: GameState): void {
  const run = state.wormhole.run
  if (!run) return
  const bonus = wormholeMatterBuffs(run.hold).turnBonus
  // 老档没有 `turnsBase` ⇒ 用"当前上限 − 当前加成"反推（老档本来没有装置 ⇒ 等于 turnsTotal）
  const base = run.turnsBase ?? run.turnsTotal - bonus
  run.turnsBase = base
  const want = Math.max(0, Math.round(base + bonus))
  const delta = want - run.turnsTotal
  run.turnsTotal = want
  if (delta > 0) run.turnsLeft = Math.min(want, run.turnsLeft + delta)
  else if (run.turnsLeft > want) run.turnsLeft = want
  if (run.turnsLeft < 0) run.turnsLeft = 0
}

/** 矿脉堆的具体生成（`wormholeNodePiles` 的薄包装：序号按格坐标散列，保证同格同结果） */
function wormholeNodePilesFor(state: GameState, cell: WormholeGridCell, count: number): WormholeCellPile[] {
  const run = state.wormhole.run!
  const index = Math.abs(cell.q * 13 + cell.r * 29) % 97
  return wormholeNodePiles(runSeedOf(state), run.depth, index, count)
}

