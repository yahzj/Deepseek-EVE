import { ceilFinalQuantity } from '../../quantity'
import { matterTechVoidYield } from '../../matterTech'
import type { GameState } from '../../state'
import type { ItemDef, SimContext } from '../../types'
import { countItem, countWare } from '../../inventory'
import { stationActivityStartState } from '../../location'
import { shipActuallyDocked } from '../../shipActionPolicy'
import { RECYCLE_BATCH_M3, isRareWreck, RARE_WRECK_VOLUME_M3 } from '../../salvage'

/** 按当前技能计算精炼产出倍率（玩家口径：1.2 = 120%（无技能，净率 ≈+20%）、满级 1.65 = 165%）。
 * 2026-09-08 船长再定（工业工位收益体检）：基础 100%→120%（无技能净率抬到约两成）、
 * 技能每级加成下调约 20%（精炼学 +6%、高级回收 +3%），满级倍率 165% */
export function refineRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.refining
  const level1 = state.skills.trained[bal.rateSkillId] ?? 0
  const level2 = state.skills.trained[bal.secondRateSkillId] ?? 0
  // 2026-09-27 船长令（R4/R5 上位技能批）：熔炉精通学 +1%/级——与高级回收处理一样**相加**计入产出倍率
  const smeltUpLv = Math.min(5, state.skills.trained['smelting-mastery'] ?? 0)
  const rate = bal.baseRate + bal.ratePerLevel * level1 + bal.secondRatePerLevel * level2 + 0.01 * smeltUpLv
  return Math.max(0, rate)
}

/**
 * **精炼产出倍率的真实上限**（满技能时的那一格）——**2026-09-30 三号接手批新增**。
 *
 * 为什么要有它（读数）：HUD 页原先在环旁边写「满产基准 = 当前倍率 × 120%」（实测 184%），
 * 而真实上限是 `baseRate + 5×精炼学 + 5×高级回收 + 5×熔炉精通`（该档应为 170%）——
 * 那个 120 没有任何出处、还会超过真实满级 ⇒ 改成从 `ctx.balance` **现算**，页面不再自造刻度。
 *
 * 口径 = 三个加成技能的**封顶等级都取 5**（`SMELT_MASTERY_MAX_LEVEL` 等三支各自的 5 级；
 * 与 `refineRate` 的算式逐项同源，改一支不会漏改另一支）。
 */
export const REFINE_SKILL_MAX_LEVEL = 5

export function refineRateMax(ctx: SimContext): number {
  const bal = ctx.balance.refining
  const perLevel = bal.ratePerLevel + bal.secondRatePerLevel + 0.01 // 精炼学 ＋ 高级回收 ＋ 熔炉精通学
  return Math.max(0, bal.baseRate + perLevel * REFINE_SKILL_MAX_LEVEL)
}

/** 精炼一批的**逐项产出**（矿物种 id → 件数；结算与界面读数共用这一把尺） */
export interface RefineOutputRow {
  mineralId: string
  units: number
}

/**
 * **一批精炼的产出（唯一实现）**——**2026-09-30 三号接手批抽出**。
 *
 * 算式与结算逐字同源：`floor(每批件数 × 该矿物 perOre × 当前产出倍率 × 该矿专属倍率)`
 * （虚空晶那一支额外吃「虚空精炼技术」加成，见 `matterTechVoidYield`；其余矿种不动）。
 * 抽出来的理由：HUD 页的"生产项悬停卡"要显示**真实产出**，而渲染层没有测试运行器、
 * 自己乘一遍必然与结算漂移（本仓 F2 单点纪律）。
 *
 * ⚠ 只认 `kind === 'mineral'` 的产出项（与结算的跳过条件一致）；件数为 0 的行**不返回**
 * （与结算"units > 0 才入库"一致）。
 */
export function refineBatchOutputOf(
  state: GameState,
  ctx: SimContext,
  def: ItemDef,
  perBatchUnits: number,
): RefineOutputRow[] {
  const rate = refineRate(state, ctx)
  const out: RefineOutputRow[] = []
  for (const row of def.refine ?? []) {
    const mineral = ctx.items.get(row.mineralId)
    if (!mineral || mineral.kind !== 'mineral') continue
    const rowMul = row.mineralId === 'min-voidcrystal' ? 1 + matterTechVoidYield(state, ctx) : 1
    const units = ceilFinalQuantity(perBatchUnits * row.perOre * rate * rowMul)
    if (units > 0) out.push({ mineralId: row.mineralId, units })
  }
  return out
}

/** 矿石在"货仓+仓库"的合计数量 */
export function oreAvailable(state: GameState, oreId: string): number {
  return countItem(state, oreId) + countWare(state, oreId)
}

/** 公共原料仅取安全仓库和实际停靠的驾驶船货仓。 */
export function industryAvailable(state: GameState, ctx: SimContext, itemId: string, worker?: 'pilot'): number {
  const readable = worker === 'pilot' ? stationActivityStartState(state, 'refine', ctx) : state
  return countWare(state, itemId) + (shipActuallyDocked(readable, ctx) ? countItem(state, itemId) : 0)
}

/** 兜底运转参数（资源数据未给显式单批参数时；测试用小批量快周期） */
const FALLBACK_BATCH_UNITS = 10

const FALLBACK_CYCLE_MS = 6_000

/**
 * 某资源的**基准运转参数**：单批单位 / 单批周期毫秒（吃技能与核心效率之前的规格值）。
 *
 * ⚠ **导出理由**（2026-09-30）：HUD 页的「投料悬停卡」要显示**还没起炉**的那味料的
 * "每批 X 件 / 每批 Y 秒"——那时没有 run 可读（run 上的 `batchUnits/cycleMs` 是结算后的真值），
 * 唯一不改口径的来源就是物品自己的规格 ⇒ 与 `startRefineRun` **同一函数**（单点，禁止 UI 自己乘）。
 */
export function refineBaseParamsOf(def: ItemDef): { batchUnits: number; cycleMs: number } {
  const batchUnits =
    def.refineBatchUnits !== undefined && def.refineBatchUnits > 0 ? ceilFinalQuantity(def.refineBatchUnits) : FALLBACK_BATCH_UNITS
  const cycleMs =
    def.refineCycleMs !== undefined && def.refineCycleMs > 0 ? Math.floor(def.refineCycleMs) : FALLBACK_CYCLE_MS
  return { batchUnits, cycleMs }
}

/**
 * 某残骸的**单批体积（m³）**：普通残骸 = `RECYCLE_BATCH_M3`、稀有残骸 = 一件的体积（`RARE_UNIT_M3`）。
 *
 * ⚠ **单点**（2026-09-30）：原先这条三元判断只写在 `startRecycleRun` 里，HUD 页要显示
 * "还没起炉的残骸每批多少 m³"就得自己再写一遍（口径一漂移，卡面与拒绝开工的提示就会说两种话）
 * ⇒ 抽成函数，起炉与卡面共用。
 */
export function recycleBatchM3Of(wreckItemId: string): number {
  return isRareWreck(wreckItemId) ? RARE_UNIT_M3 : RECYCLE_BATCH_M3
}

/** 一个**回收单元**的体积（m³）：稀有残骸每烧掉这么多，开一箱 */
export const RARE_UNIT_M3 = RARE_WRECK_VOLUME_M3

/**
 * 玩家指令：启动"残骸回收"（B3 开箱批，2026-09-05 船长定稿；v20：同一型号残骸允许多台
 * 并行、原料不锁定）：批 = 10 m³ / 25 秒（劳动者 100%；AI 核心按效率拉长周期；残骸计数 =
 * 体积），每批开箱 = 保底矿物（按残骸敌群星系危险度三档池 + 体积当量）+ 彩头（基础件直出 /
 * 低安 MK2 / 蓝图碎片）。每批到点从仓库实时扣取残骸；耗尽自动停炉（核心归还）。
 */
/** **拆解一件安全货柜**的周期（F4d · 船长 2026-09-13 定：**90 秒/件**） */
export const UNBOX_CYCLE_MS = 90_000
