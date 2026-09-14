/**
 * 标题后的「圆形感叹号」提示标记（2026-09-13 船长定）。
 *
 * 船长原话：「将各个界面的说明，比如精炼炉的『你亲自运转限 1 台…』。隐藏起来，只在标题名字的后面
 * 显示一个圆形感叹号图标，当玩家悬停时才显示这些说明。」
 * 集中提问后口径：① 成段说明（`.app-note`）全收；② 空态里**常驻引导**也收、**动作/状态反馈**
 * （搜索无果 / 筛选后空 / 没有可精炼的资源…）**保持常显**（否则会变成"点了没反应"）；
 * ③ 图标一律**紧跟标题文字后面**；④ 图标画成圆形感叹号（`ico-hint`）。
 *
 * 机制（**不新增任何悬停机制**）：本体就是一个带 `title` 的小图标 —— 悬停由 `ui/Tooltip.tsx` 里那条
 * 「原生 title → 自绘提示」全局接管负责（限宽 300px ＋ 多行 ＋ 悬停 200ms；触屏点一下即看）。
 * 颜色不写死：Glyph 走 `currentColor`，由 `.app-hint-ico` 给暗色、`:hover` 提亮（同 `.app-btn` 的改法，
 * 不用 filter —— 约定第十四章）。
 */
import type { ReactNode } from 'react'
import { Glyph } from './Glyphs'

/** tip 用**字符串**（可含模板变量与 \n）：自绘提示按 `pre-line` 渲染，换行照原样显示 */
export function HintIcon({ tip, size = 12 }: { tip: string; size?: number }): ReactNode {
  if (!tip) return null
  return (
    <span className="app-hint-ico" title={tip}>
      <Glyph name="ico-hint" size={size} />
    </span>
  )
}
