/**
 * **属性表「同名两行」体检**（2026-09-26 · 船长报障「无人机舱有2个重复的」＋
 * 「用机动速度替换所有动力的位置」）。
 *
 * 为什么需要：装配页 / 图鉴详情窗的属性表是**拼装**出来的——`shipInfoLines` 给船体静态行，
 * 页面再追加装后合成行、合计行、右栏区块。拼装口径一变（新增字段、挪行、改名）就会出现
 * **同名两行并列两个数字**，代码里看不出来（两处各自正确），只有真机截图或本工具能发现。
 * 本工具把三处拼装口径按**真实顺序**复算一遍，按「同一张表内 label 唯一」判定。
 *
 * 覆盖：
 *   ① 装配页主属性表（`shipInfoLines` 过滤两张隐藏表 ＋ 机动速度 ＋ 无人机舱合计 ＋ 装后行）
 *   ② 手册·舰船图鉴详情窗（`shipInfoLines`＋`shipIndirectLines`，与 ① 同源但不过滤）
 *   ③ 手册·舰船蓝图产物（同上）
 *   ④ 舰队页悬停卡 = **当前属性**（`shipCurrentRowKeys`：基础行被装后行逐条顶替 ＋ 追加间接属性）
 *
 * 口径来源必须与实现同源（直接 import，不许抄一份）：`FIT_MAIN_HIDDEN_KEYS` /
 * `COMBAT_BASE_KEYS` 定义在 `ui/shipInfo.tsx`；页面追加行若改名，这里会跟着红——这正是护栏的目的。
 *
 * ⚠ 工具跑在 Node 里：tsx 走 classic JSX 运行时 ⇒ 先垫一个全局 `React.createElement` 再加载
 *   `shipInfo.tsx`（该模块的返回行里有 JSX 节点）。
 */
;(globalThis as unknown as { React: unknown }).React = {
  createElement: (...args: unknown[]) => ({ args }),
}

import { COMBAT_BASE_KEYS, FIT_MAIN_HIDDEN_KEYS, shipCurrentLayout, shipIndirectLines, shipInfoLines } from '../apps/desktop/src/renderer/src/ui/shipInfo'
import { tr } from '../apps/desktop/src/renderer/src/i18n/locale'
import { SHIPS } from '@whale/data'

/** 装配页在基础行之后追加的行（顺序与 `pages/FitPage.tsx` 主表一致；只取名，不看值） */
const FIT_APPENDED_KEYS: readonly string[] = [
  tr('ui.FitPage.049'), // 机动速度（装后口径：航行技能 / 重甲机动代价）
  tr('ui.FitPage.035'), // 无人机舱（含甲板扩展）合计
  tr('ui.FitPage.039'), // 船体维修装置·运转消耗
  tr('ui.FitPage.042'), // 无消耗自愈件
  tr('ui.FitPage.045'), // 护盾抗性（装后）
  tr('ui.FitPage.046'), // 装甲抗性（装后）
  tr('ui.FitPage.005'), // 结构抗性（装后）
  tr('ui.FitPage.047'), // 命中率（装后）
  tr('ui.FitPage.048'), // 回避率（装后）
  tr('ui.FitPage.050'), // 跃迁速度（装后）
]

/** 同一序列里第 2 次及以后出现的 label */
function dupOf(keys: readonly string[]): string[] {
  const seen = new Set<string>()
  return keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)))
}

const problems: string[] = []
for (const ship of SHIPS) {
  // ① 装配页主表：基础行过滤两张隐藏表 ⇒ 再接追加行（顺序与 FitPage 一致）
  const fitMain = [
    ...shipInfoLines(ship)
      .filter((l) => !FIT_MAIN_HIDDEN_KEYS.includes(l.k) && !COMBAT_BASE_KEYS.has(l.k))
      .map((l) => l.k),
    ...FIT_APPENDED_KEYS,
  ]
  const dupFit = dupOf(fitMain)
  if (dupFit.length > 0) problems.push(`${ship.id}（装配页主表）重复：${[...new Set(dupFit)].join(' / ')}`)

  // ② 手册图鉴详情窗 / ③ 蓝图产物：不隐藏，两张表首尾相接
  const codex = [...shipInfoLines(ship).map((l) => l.k), ...shipIndirectLines(ship).map((l) => l.k)]
  const dupCodex = dupOf(codex)
  if (dupCodex.length > 0) problems.push(`${ship.id}（图鉴档案 / 蓝图产物）重复：${[...new Set(dupCodex)].join(' / ')}`)

  // ④ 舰队页悬停卡（当前属性，2026-09-26 船长令）：基础行被装后行**逐条顶替**（位置不变、值换掉）
  //    ＋ 追加间接属性。这里除"不重名"外，还要钉住两条结构性不变量——单看"不重名"抓不到退化：
  //    a) 行一个都不许凭空多出来（否则两张卡重复计入）；b) 被顶替的键必须**真在**基础行里生效，
  //    且不许出现在"移走"名单里（否则玩家看到的是基础值，不是当前值）。
  const hasBay = (ship.droneBayM3 ?? 0) > 0
  const hover = shipCurrentLayout(ship, hasBay)
  const dupHover = dupOf(hover.keys)
  if (dupHover.length > 0) problems.push(`${ship.id}（舰队页悬停卡）重复：${[...new Set(dupHover)].join(' / ')}`)
  // 行数守恒：卡的最终行 = 基础行 ＋ 间接属性，逐个扣掉被"移走"的键（被顶替的键仍在原位，不扣）
  const hiddenSet = new Set(hover.hidden)
  const expected = [
    ...shipInfoLines(ship).map((l) => l.k),
    ...shipIndirectLines(ship).map((l) => l.k),
  ].filter((k) => !hiddenSet.has(k)).length
  if (hover.keys.length !== expected) {
    problems.push(`${ship.id}（舰队页悬停卡）行数 ${hover.keys.length} ≠ 应显示 ${expected}（装后行必须逐条顶替、不许增删）`)
  }
  const baseKeys = new Set(shipInfoLines(ship).map((l) => l.k))
  const finalKeys = new Set(hover.keys)
  for (const k of hover.replaced) {
    if (!baseKeys.has(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」被登记为装后顶替，但基础行里没有这个键 —— 玩家看到的仍会是基础值`)
    else if (!finalKeys.has(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」被登记为装后顶替，却没出现在最终行里（装后值被吞掉）`)
  }
  for (const k of hover.hidden) {
    if (hover.replaced.includes(k)) problems.push(`${ship.id}（舰队页悬停卡）「${k}」同时进了顶替与移走两张名单（拼装口径自相矛盾）`)
  }
  if (hasBay && !hover.replaced.includes(tr('ui.FitPage.010'))) {
    problems.push(`${ship.id}（舰队页悬停卡）有机舱却没把「无人机舱」换成装后合计行`)
  }
}

console.log(`属性表同名体检：${SHIPS.length} 艘 × 4 处拼装口径（装配页主表 / 图鉴档案 / 蓝图产物 / 舰队页悬停卡）`)
if (problems.length > 0) {
  for (const p of problems.slice(0, 20)) console.log(`  ✗ ${p}`)
  console.log(`\n❌ 属性表同名体检未过：${problems.length} 处同名两行（同一张表里 label 必须唯一）`)
  console.log('   修法：多半是"页面追加行"与 `shipInfoLines` 的基础行撞名——把基础行登记进 `FIT_MAIN_HIDDEN_KEYS`，')
  console.log('   或把追加行改名（两条同名行会并列两个数字，玩家会认为是重复条目）。')
  process.exit(1)
}
console.log('✅ 属性表同名体检通过：四处拼装口径均无同名两行')
