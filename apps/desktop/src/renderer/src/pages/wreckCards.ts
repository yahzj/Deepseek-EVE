/**
 * **打捞页卡片序列**（**2026-09-26 船长报障与建议**：「**之前残留的手动选择残骸的卡片还遗留在残骸打捞
 * 页面内**」＋「**建议在残骸打捞页面内，有玩家舰船残骸的卡片置顶，其次是有入侵残骸的**」）。
 *
 * ## 为什么单独一个文件
 * 这条顺序是本次改动的**验收点**，而经办人看不到船长的屏 ⇒ 必须让它**可被工具/用例直接断言**。
 * 但 `pages/MapPage.tsx` 会连带拉进整套 UI（含 `packages/ui` 的 CSS）⇒ `tsx` 里 import 它就崩
 * （`SyntaxError: Unexpected token ':'` on `.css`）。所以把这枚**纯函数**挪到本文件：
 * 无任何 UI 依赖、谁都能 import。
 *
 * ## 三条规则（顺序即优先级）
 * 1. **玩家舰船残骸卡**（该星系有有效残骸才出）——四级序最高优先，压过稀有池与普通池；
 * 2. **入侵残骸卡**（独立残骸场 > 0 才出）——48h 衰减、先捞它最划算；
 * 3. **星系残骸（全部）卡**——恒出，带 AI 指派条与各组存量读数。
 *
 * ⚠ **每组的"手动选择"卡不再出**：打捞对象自 2026-09-26 起由 core 自动判定
 * （船长原话「分组后不要再让玩家手动选择打捞对象了……优先打捞入侵残骸」）⇒
 * 那些卡上的「开始打捞」本来就是同一个动作、纯属残留；各组存量改成"全部"卡上的一行**只读读数**。
 */
export type WreckCardKind = 'ship-wrecks' | 'invasion' | 'all'

/** 该星系要出哪几张卡、按什么顺序（纯函数；渲染处只消费它的返回值） */
export function wreckCardSequenceOf(input: {
  shipWreckCount: number
  invasionWreckM3: number
}): WreckCardKind[] {
  const out: WreckCardKind[] = []
  if (input.shipWreckCount > 0) out.push('ship-wrecks')
  if (input.invasionWreckM3 > 0) out.push('invasion')
  out.push('all')
  return out
}
