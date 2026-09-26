/**
 * **常驻悬赏列表的排序键**（**2026-09-26 船长令**：「**入侵的悬赏卡片在常驻悬赏里置顶。**」）。
 *
 * ## 为什么单独一个文件
 * "置顶"是本次改动的**验收点**，而经办人看不到船长的屏 ⇒ 必须能被工具/用例直接断言。
 * 但 `panels/Expedition.tsx` 会连带拉进整套 UI（含 `packages/ui` 的 CSS）⇒ `tsx` 里 import 它就崩。
 * 所以把这枚**纯函数**挪到本文件：无任何 UI 依赖、谁都能 import（与 `pages/wreckCards.ts` 同一手法）。
 *
 * ## 口径
 * - **置顶判据 = `pinned`**（由调用方按 `weekendOccupiedLiveAt` 传入：**仍被占**才算）；
 * - 置顶组**内部**照所选排序走原比较器 ⇒ 置顶只改"谁在前"，不改"同类里怎么排"；
 * - 已夺回的星系**不置顶**：它的常驻悬赏仍在隐藏状态，不占板面。
 */

/** 兵种排序键（与既有 `TaskSort` 同值域；此处只声明本函数需要的那几档） */
export type BountySortKey = 'danger' | 'distance' | 'galaxy' | 'reward' | 'standing' | 'name'

/** 排序用的一行（字段与调用点 `items` 一致） */
export interface BountySortRow {
  /** 这一行是不是当前的入侵卡（**仍被占**才为真） */
  id: string
  name: string
  /** 目标星系安全等级（sec 降序 = 安全在前） */
  security: number
  /** 到目标星系的距离（分钟；∞ = 不可达） */
  dist: number
  /** 卡面赏金 */
  rewardIsk: number
  /** 首胜声望 */
  standingGain: number
  /** 目标星系名 */
  galaxyName: string
}

/** 两行的名称序（与调用点同一把尺：中文名 → id） */
function byNameOf(x: BountySortRow, y: BountySortRow): number {
  return x.name.localeCompare(y.name, 'zh-Hans-CN') || x.id.localeCompare(y.id)
}

/**
 * 造一个比较器：**入侵卡恒在最上**，组内按 `sort` 走原规则。
 * 调用方只需把 `pinnedIds` 填成"仍被占星系的卡 id"。
 */
export function bountyComparatorOf(
  sort: BountySortKey,
  pinnedIds: ReadonlySet<string>,
): (x: BountySortRow, y: BountySortRow) => number {
  return (x, y) => {
    const px = pinnedIds.has(x.id) ? 0 : 1
    const py = pinnedIds.has(y.id) ? 0 : 1
    if (px !== py) return px - py
    if (sort === 'danger') {
      if (x.security !== y.security) return y.security - x.security
      return byNameOf(x, y)
    }
    if (sort === 'distance') {
      if (x.dist !== y.dist) return x.dist - y.dist
      return byNameOf(x, y)
    }
    if (sort === 'galaxy') {
      const g = x.galaxyName.localeCompare(y.galaxyName, 'zh-Hans-CN')
      if (g !== 0) return g
      return byNameOf(x, y)
    }
    if (sort === 'reward') {
      if (x.rewardIsk !== y.rewardIsk) return y.rewardIsk - x.rewardIsk
      return byNameOf(x, y)
    }
    if (sort === 'standing') {
      if (x.standingGain !== y.standingGain) return y.standingGain - x.standingGain
      return byNameOf(x, y)
    }
    return byNameOf(x, y)
  }
}
