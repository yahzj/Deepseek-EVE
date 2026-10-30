import { ceilFinalQuantity } from '../../quantity'
import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { addWare, countWare, removeWare } from '../../inventory'
import { DEEP_SPACE_PROBE_BLUEPRINT_ID, probeMaterialFactor } from '../../probeManufacturing'
import type { BuildSpec } from './blueprints'

/** 材料学（materials）−1.5%/级 × 组件标准化（component-standardization）−0.8%/级（2026-09-08 技能加成下调约 20%）：乘算折扣（下限 70%） */
export function materialFactor(state: GameState): number {
  const lv1 = Math.min(5, state.skills.trained['materials'] ?? 0)
  const lv2 = Math.min(5, state.skills.trained['component-standardization'] ?? 0)
  return Math.max(0.7, (1 - 0.015 * lv1) * (1 - 0.008 * lv2))
}

/** 实际材料需求（探测机专属折扣与通用折扣相乘后统一取整；预览/扣料/退款同源） */
export function matNeedCount(state: GameState, count: number, blueprintId?: string): number {
  const probeFactor = blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID ? probeMaterialFactor(state) : 1
  return Math.max(1, ceilFinalQuantity(count * materialFactor(state) * probeFactor))
}

/**
 * **扣一件所需的材料**（**开工**与**循环续做**共用这一把尺 —— **2026-10-01 收口**）。
 *
 * 为什么必须收成一处：原先"续做下一件"那处自己写了一句
 * `removeWare(state, need.itemId, matNeedCount(…))` ⇒ ① **不走等价组**（玩家手上是通用黑匣、
 * 配方写墨潮黑匣时**扣不动**）② **不记退料账** ③ **忽略返回值**（扣不到也照做）
 * —— 实测结果 = **循环续做的那几件白造**（2026-10-01 船长报障「玩家又反应了一些早就修好的BUG」后普查发现）。
 *
 * 语义（与开工处逐字同款）：**等价组按组序取够** · 逐笔记**实际扣的那种**进 `spent` ·
 * **任一项凑不齐 ⇒ 整体回滚并返回 false**（绝不留半扣状态，也绝不"扣不到照做"）。
 */
export function spendMaterialsFor(
  state: GameState,
  materials: readonly { itemId: string; count: number }[],
  spent: { itemId: string; count: number }[],
  blueprintId: string,
): boolean {
  const taken: { itemId: string; count: number }[] = []
  const rollback = (): void => {
    for (const t of taken) addWare(state, t.itemId, t.count)
  }
  for (const need of materials) {
    let left = matNeedCount(state, need.count, blueprintId)
    for (const id of materialGroupIdsOf(need.itemId)) {
      if (left <= 0) break
      const take = Math.min(countWare(state, id), left)
      if (take <= 0) continue
      if (!removeWare(state, id, take)) {
        rollback()
        return false
      }
      taken.push({ itemId: id, count: take })
      left -= take
    }
    if (left > 0) {
      rollback()
      return false
    }
  }
  spent.push(...taken)
  return true
}

/**
 * **材料等价组**（**2026-09-27 船长令**：「**在章鱼人声望商店加入购买通用黑匣的卡片，玩家可以用30声望换一个
 * 通用黑匣。（现有的舰船插件蓝图都只要使用任意类型黑匣就可以制作）**」）。
 *
 * 口径：
 * - **组内任意一种都能顶同一项料**（配方数据**一个字不用改**：插件图纸照旧写 `blackbox-h`）；
 * - **组序 = 优先扣除序** ⇒ 先扣**通用黑匣**（声望换来的），把能卖 8,000 万的族匣留给市场；
 * - **退料按实际扣的那种退**：`spentMaterials` 记的就是实际扣的 id（见开工处那段），天然成立；
 * - 不进任何组 = 一对一（既有全部配方零行为变化）。
 *
 * ⚠ **族匣陆续加入**：黑匣按族登记（H 墨潮 / R 光环 / C 异形 / D 守墓），而插件图纸照旧只认
 * 「任意黑匣」⇒ 登记的族匣与通用匣互为替代，图纸数据一个字不改。组序即扣料优先序：先通用，
 * 再按登记顺序取族匣；因此已有 H/R/C 顺序保持，新增 D 匣排在最后。
 */
export const MATERIAL_GROUPS: readonly (readonly string[])[] = [
  ['blackbox-universal', 'blackbox-h', 'blackbox-r', 'blackbox-c', 'blackbox-d'],
]

/** 该材料 id 所属的等价组（不在任何组里 ⇒ 只返回它自己） */
export function materialGroupIdsOf(itemId: string): readonly string[] {
  for (const g of MATERIAL_GROUPS) {
    if (g.includes(itemId)) return g
  }
  return [itemId]
}

/**
 * **这一项料该用哪个 id "报名字"**（**2026-09-29 船长报障**：「**组装机中，舰船插件材料消耗列表中还是
 * 显示了墨潮黑匣（应该显示通用黑匣）**」）。
 *
 * 口径（与 `MATERIAL_GROUPS` 的**组序**同一把尺）：**优先报玩家手上有的那一种**；
 * 都没有 ⇒ 报**组内第一种**（＝ 优先扣除序的第一种，也就是"该去弄哪一种"的那一种）。
 *
 * 为什么必须收成 core 单点：这句话在两处出现——**组装机卡的材料行**（界面）与
 * `missingMaterials()` 的缺口提示（引擎）——两处各判一次就会漂（一个说通用、一个说旗舰）。
 * 配方数据里写的仍是 `blackbox-h`（**数据一字不改**，见 `MATERIAL_GROUPS` 头注）。
 */
export function materialDisplayIdOf(state: GameState, itemId: string): string {
  const ids = materialGroupIdsOf(itemId)
  if (ids.length === 1) return itemId
  for (const id of ids) {
    if (countWare(state, id) > 0) return id
  }
  return ids[0]!
}

/** 材料缺口说明（界面提示用；材料从物品仓库取用；数量已按材料学折扣折算） */
export function missingMaterials(state: GameState, ctx: SimContext, spec: BuildSpec, blueprintId?: string): string[] {
  const missing: string[] = []
  for (const need of spec.materials) {
    const needCount = matNeedCount(state, need.count, blueprintId)
    /** **等价组按组内合计**（2026-09-27）：通用黑匣 ＋ 旗舰黑匣凑够数就行 */
    const ids = materialGroupIdsOf(need.itemId)
    const have = ids.reduce((sum, id) => sum + countWare(state, id), 0)
    if (have < needCount) {
      /** 报名字也走 `materialDisplayIdOf`（与界面材料行同一把尺） */
      const displayId = materialDisplayIdOf(state, need.itemId)
      const name = ctx.items.get(displayId)?.name ?? displayId
      missing.push(`${name} 还差 ${(needCount - have).toLocaleString('zh-CN')} 单位`)
    }
  }
  return missing
}
