import type { GameState, RefineRunState } from '../../state'
import type { AiCoreType, SimContext } from '../../types'
import { aiCoreName } from '../../ai'
import { RARE_UNIT_M3, refineRate } from './params'

/** 精炼炉此刻是否有炉在运转（任一工位） */
export function refineRunActive(state: GameState): boolean {
  return state.refineRuns.length > 0
}

/** 主控亲自运转的炉是否占用着主控（主控忙判定；AI 核心驱动不占主控；多工位下至多一台 pilot 炉） */
export function refineManualActive(state: GameState): boolean {
  return state.refineRuns.some((r) => r.active && r.worker === 'pilot')
}

/** 精炼炉运行视图（工业页 / 顶部活动栏共用） */
export interface RefineRunView {
  active: boolean
  /** 稳定台号（停炉定位） */
  id: number
  itemId: string | null
  itemName: string
  /** 产线类型（F4d：拆解安全货柜 = unbox；界面据此换文案与说明） */
  recipe: 'refine' | 'recycle' | 'unbox'
  /** 劳动者：pilot = 主控 / AI 核心类型 */
  worker: 'pilot' | AiCoreType
  workerLabel: string
  /** 当前产出倍率（玩家口径 %；每批结算按当时技能取值） */
  rate: number
  /** 单批单位（开工时按技能现算） */
  batchUnits: number
  /** 单批周期毫秒（已按核心效率拉长） */
  cycleMs: number
  /** 已完成批数 */
  batchesDone: number
  /**
   * 本炉**私有料账**剩余（单位同物品；2026-09-11 增，界面展示用）。
   * 仅"起炉即预占"的稀有残骸炉有值（起炉时按**回收单元**从其货仓/仓库扣入本炉），普通残骸炉/精炼炉 = undefined。
   * 玩家的货仓+仓库里看不到这批料（已被扣走），界面必须靠这个字段告诉玩家"料在炉里、没丢"。
   */
  claimedUnits?: number
  /** 炉内还剩几个**未开箱的回收单元**（稀有残骸炉才有值；老档按旧语义回退） */
  rareUnitsLeft?: number
  /** 当前批进度 0~100 */
  percent: number
  /** 当前批剩余毫秒（v20 原料不锁定，整炉剩余 = 仓库余量决定，不再预估） */
  remainingMs: number
}

/**
 * 本炉还剩几个**未开箱的回收单元**（2026-09-11）。
 * - 新档：直接用 `rareUnits`；
 * - 老档（无该字段）：按旧的"整炉一件一箱"语义回退 —— `rareBoxEligible !== false` 或 `lockUnits ≥ 一单元` 时记 1 个，
 *   其余记 0。这样旧档进度照常收尾，不会因为升级而白开或漏开。
 */
function unitsLeftOf(r: RefineRunState, batchesPerUnit: number): number {
  void batchesPerUnit
  // 新档：直接按剩余单元数
  if (r.rareUnits !== undefined) return Math.max(0, r.rareUnits)
  // 老档（本特性刚落地时的档）：按旧的"整炉一件一箱"语义回退——资格为真且有预占 ⇒ 还剩 1 个单元
  if (r.claimedUnits === undefined) return 0
  if (r.rareBoxEligible !== false) return 1
  // 资格字段缺失、但确实预占了一整个单元：仍按 1 个算（否则升级后这一炉会白烧不开箱）
  return (r.lockUnits ?? 0) >= RARE_UNIT_M3 ? 1 : 0
}

/** 单台炉的当前进度视图（percent/remainingMs 按当前时间现算；v20 原料不锁定，
 * remainingMs 只含当前批——余量看仓库实时库存） */
function refineRunViewOf(state: GameState, ctx: SimContext, r: RefineRunState): RefineRunView {  const def = r.itemId ? ctx.items.get(r.itemId) : undefined
  const base = {
    active: r.active,
    id: r.id,
    itemId: r.itemId,
    itemName: def?.name ?? '—',
    recipe: r.recipe,
    worker: r.worker,
    workerLabel: r.worker === 'pilot' ? '主控' : aiCoreName(r.worker),
    rate: refineRate(state, ctx),
    batchUnits: r.batchUnits,
    cycleMs: r.cycleMs,
    batchesDone: r.batchesDone,
    claimedUnits: r.claimedUnits,
    // 炉内还剩几个未开箱的**回收单元**（稀有残骸炉：起炉时按完整单元预占，烧完一个开一箱）
    ...(r.claimedUnits !== undefined
      ? { rareUnitsLeft: unitsLeftOf(r, Math.max(1, Math.round(RARE_UNIT_M3 / Math.max(1, r.batchUnits)))) }
      : {}),
  }
  if (!r.active || r.itemId === null || r.cycleMs <= 0) {
    return { ...base, percent: 0, remainingMs: 0 }
  }
  const remainCur = Math.max(0, r.finishAtGameMs - state.gameMs)
  const percent = Math.min(100, Math.max(0, Math.round(((r.cycleMs - remainCur) / r.cycleMs) * 100)))
  return { ...base, percent, remainingMs: remainCur }
}

/** 全部精炼炉工位运行视图（v19 多工位：工业页卡片 / 顶部活动栏共用，逐台一条） */
export function refineRunViews(state: GameState, ctx: SimContext): RefineRunView[] {
  return state.refineRuns.map((r) => refineRunViewOf(state, ctx, r))
}
