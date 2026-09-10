/**
 * 玩家标记（收藏）界面件（2026-09-10 船长定）：星标按钮 + 默认排序置顶。
 *
 * 本文件 = 「标记收藏」样式族的唯一实现，覆盖四处界面（检索入口：grep `MarkStar|pinMarked`，
或渲染层 `grep data-ui-group="mark-star"`）：
 * - 市场页商品行（常驻 / 稀有 / 搜索结果同一套行）——按市场商品 key；
 * - 精炼炉卡与残骸回收卡——按可精炼资源 / 可回收残骸的物品 id；
 * - 组装机蓝图卡——按蓝图 id；
 * - 舰队船卡——按船实例 id（同型多艘各自独立）。
 *
 * 口径（船长 2026-09-10）：
 * - 星标常驻显示在同一位置，未标记 = 暗色空心、已标记 = 金色实心，**不因标记状态改变布局**；
 * - 置顶只在「默认排序」下生效：列表若带用户可选排序（舰队），其余排序键一律按原规则；
 * - 组内保持原有相对顺序（只在前面插一段，不重排其余项）。
 */
import type { GameState, MarkKind } from '@whale/core'
import { isMarked, markedIds } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { Glyph, ICO_TONES } from './Glyphs'

/** 标记星标按钮：点击切换（不触发行/卡自身的点击，如市场行选中、舰船卡按钮组） */
export function MarkStar({
  engine,
  kind,
  id,
  size = 13,
}: {
  engine: GameEngine
  kind: MarkKind
  id: string
  size?: number
}) {
  const on = isMarked(engine.state, kind, id)
  return (
    <button
      type="button"
      className={`app-mark-btn${on ? ' is-on' : ''}`}
      data-ui-group="mark-star"
      aria-pressed={on}
      aria-label={on ? '取消标记' : '标记'}
      title={on ? '已标记：默认排序下置顶显示（点击取消）' : '标记（收藏）：默认排序下置顶显示'}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        engine.toggleMarkAt(kind, id)
      }}
      onKeyDown={(e) => {
        // 行/卡自身有 Enter/Space 键行为（如市场行选中）：拦在这里，只让星标按钮响应
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
    >
      <span className="app-ico">
        <Glyph name="ico-star" size={size} color={on ? ICO_TONES['ico-star'] : undefined} />
      </span>
    </button>
  )
}

/**
 * 默认排序置顶：已标记项排到最前（组内保持原顺序），其余项顺序不变。
 * 只在「默认排序」口径下调用；按名称/耐久等排序键的列表不要包这一层（船长 2026-09-10）。
 */
export function pinMarked<T>(
  state: GameState,
  kind: MarkKind,
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const ids = markedIds(state, kind)
  if (ids.length === 0) return [...rows]
  const set = new Set(ids)
  const pinned: T[] = []
  const rest: T[] = []
  for (const row of rows) {
    if (set.has(keyOf(row))) pinned.push(row)
    else rest.push(row)
  }
  return [...pinned, ...rest]
}
