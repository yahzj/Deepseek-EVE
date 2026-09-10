/**
 * 玩家标记（收藏）：2026-09-10 船长定。
 *
 * 玩家可给四类界面的条目打标记——市场商品行 / 精炼炉（含残骸回收）卡 / 组装机蓝图卡 /
 * 舰队船卡；被标记项在**默认排序**下置顶（有排序下拉的列表只在「默认排序」生效，
 * 其余排序键一律按原规则，不受标记影响）。
 *
 * 存档：`GameState.marks` 为兼容字段（v24 无版本号变化），老档读入 = 四类全空；
 * 由 `save.ts` 的 normalizeState 白名单重建（先例：slowDrawLastGameMs 被丢的教训）并剪枝：
 * - 舰船标记：只保留仍在舰队里的船实例（卖船/战损后自动清掉）；
 * - 其余三类：只保留能被目录解析出的 id（商品 key / 可炼资源 id / 蓝图 id）。
 *
 * 标记是纯偏好数据：不改数值、不改经济、不影响任何自动作业，只在界面上影响排列与高亮。
 */
import type { GameState, MarksState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { emptyMarks } from './state'

/** 四类可标记界面（与 MarksState 字段一一对应） */
export type MarkKind = 'goods' | 'recipes' | 'blueprints' | 'ships'

/** 标记项的中文说法（报错文案与界面提示共用） */
export const MARK_KIND_TEXT: Record<MarkKind, string> = {
  goods: '市场商品',
  recipes: '精炼资源',
  blueprints: '蓝图',
  ships: '舰船',
}

/** 标记清单（老档/手工构造的档缺字段时返回空表，调用方无需判空） */
export function markedIds(state: GameState, kind: MarkKind): readonly string[] {
  const marks = state.marks as MarksState | undefined
  const list = marks?.[kind]
  return Array.isArray(list) ? list : []
}

/** 该条目是否已被标记 */
export function isMarked(state: GameState, kind: MarkKind, id: string): boolean {
  return markedIds(state, kind).includes(id)
}

/**
 * 标记 id 是否可在当前存档/目录里解析（防止界面残留或坏档写进不存在的条目）。
 * 舰船按实例（state.fleet 键）、市场商品按 ctx.marketGoods 键、精炼资源按可精炼/可回收的物品、
 * 蓝图按装备弹药蓝图 + 舰船蓝图。
 */
export function markTargetExists(state: GameState, ctx: SimContext, kind: MarkKind, id: string): boolean {
  if (kind === 'ships') return id in state.fleet
  if (kind === 'goods') return ctx.marketGoods.has(id)
  if (kind === 'blueprints') {
    return ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)
  }
  const def = ctx.items.get(id)
  if (!def) return false
  return (def.refine !== undefined && def.refine.length > 0) || def.kind === 'wreck'
}

/** 确认 marks 字段存在（老档/手工构造的档兜底补空表） */
function ensureMarks(state: GameState): MarksState {
  const marks = state.marks as MarksState | undefined
  if (!marks || typeof marks !== 'object') {
    state.marks = emptyMarks()
    return state.marks
  }
  for (const kind of ['goods', 'recipes', 'blueprints', 'ships'] as const) {
    if (!Array.isArray(marks[kind])) marks[kind] = []
  }
  return marks
}

/**
 * 玩家指令：切换一条标记（已标记 → 取消；未标记 → 标记）。
 * 不写游戏日志（打标记是高频界面操作，写日志会刷屏；船长 2026-09-10 确认）。
 */
export function toggleMark(state: GameState, ctx: SimContext, kind: MarkKind, id: string): CommandResult {
  if (!markTargetExists(state, ctx, kind, id)) {
    return { ok: false, error: `没有可标记的${MARK_KIND_TEXT[kind]}（${id}）。` }
  }
  const marks = ensureMarks(state)
  const list = marks[kind]
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
  else list.push(id)
  return { ok: true }
}

/** 清空某一类标记（界面「取消全部标记」用；当前 UI 未接入，留作指令面） */
export function clearMarks(state: GameState, kind: MarkKind): void {
  const marks = ensureMarks(state)
  marks[kind] = []
}

/**
 * 读档归一化剪枝：清掉坏数据并去掉重复项。
 * - 舰船标记：只保留仍在舰队里的实例（卖船/战损后自动失效）；
 * - 其余三类：只保留非空字符串（去重）；目录校验由界面与 toggleMark 指令负责
 *   （遗留的旧 id 无害：条目重新出现时标记随之恢复）。
 * 由 save.ts 的 normalizeState 调用。
 */
export function pruneMarks(state: GameState): MarksState {
  const marks = ensureMarks(state)
  const seen = new Set<string>()
  marks.ships = marks.ships.filter((uid) => {
    if (typeof uid !== 'string' || uid.length === 0) return false
    if (!(uid in state.fleet)) return false
    if (seen.has(uid)) return false
    seen.add(uid)
    return true
  })
  for (const kind of ['goods', 'recipes', 'blueprints'] as const) {
    const uniq = new Set<string>()
    for (const id of marks[kind]) {
      if (typeof id === 'string' && id.length > 0) uniq.add(id)
    }
    marks[kind] = [...uniq]
  }
  return marks
}
