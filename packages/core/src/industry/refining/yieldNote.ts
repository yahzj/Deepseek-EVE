import type { SimContext } from '../../types'
import { type LogSeg } from '../../logParts'

/**
 * 炉所得明细（停炉/料尽/自然结束时附在日志；2026-09-06 精炼与回收统一：
 *  精炼 = 矿物产物列表；回收 = 保底矿物 + 额外掉落（基础件/低安 MK2/蓝图碎片）。超 6 种折叠。
 *
 * 甲案（2026-09-20）：本函数**自带中文小词**（「保底原材料」「额外掉落」「无人机…架」），
 * 只给外层日志配一个 id 是不够的（那些词会留在中文）⇒ 一并产出**分段 id 链**：
 * `text` 仍是逐字不变的中文原串（老档/未改造路径回退用），`parts` 交给调用方按段挂 `p{n}Id`。
 */
interface YieldNote {
  /** 中文原串（行为与改造前逐字一致） */
  text: string
  /** 分段：`text` 恒为该段中文，`id`/`params`/`subs` 供调用方挂成段 id 链 */
  parts: LogSeg[]
}

export function yieldNoteFor(
  ctx: SimContext,
  rec: {
    min: Record<string, number>
    mod: Record<string, number>
    frag: Record<string, number>
    drone?: Record<string, number>
    blueprint?: Record<string, number>
  },
  kind: 'refine' | 'recycle',
): YieldNote {
  // 2026-09-11 修复（船长实测反馈「回收残骸出货时的事件日志内显示的额外掉落为装备ID」）：
  // 名表必须**先查装备、再查物品**——旧实现只看 `ctx.items`，而「额外掉落」段里的装备是**模块 id**
  // （如 mod-lair-turret-a），查不到就回落到裸 id，玩家看到的是 `装备 mod-lair-turret-a×1`。
  // 2026-09-14：补**蓝图**一支（高级箱新增专属无人机一次性图纸后，漏了它就会把图纸 id 念给玩家听）
  const nameOf = (id: string): string =>
    ctx.modules.get(id)?.name ??
    ctx.items.get(id)?.name ??
    ctx.blueprints.get(id)?.name ??
    ctx.shipBlueprints.get(id)?.name ??
    id
  /** 名字清单（按数量降序、超 6 种折叠） */
  const listOf = (m: Record<string, number>): { list: string; capped: boolean; total: number } => {
    const es = Object.entries(m).sort((a, b) => b[1]! - a[1]!)
    return {
      list: es
        .slice(0, 6)
        .map(([id, n]) => `${nameOf(id)}×${n}`)
        .join('、'),
      capped: es.length > 6,
      total: es.length,
    }
  }
  const parts: YieldNote['parts'] = []
  const isRecycle = kind === 'recycle'
  /**
   * 类目模板已经包含清单与尾注两个槽，不在清单上再套一次同款模板。
   * 未折叠时显式传空尾注；只有折叠时才挂「等N种」模板及其种数。
   */
  const typeSeg = (label: string, labelId: string, m: { list: string; capped: boolean; total: number }): LogSeg => {
    const capTxt = m.capped ? ` 等${m.total}种` : ''
    const text = `${label}${m.list}${capTxt}`
    const params: Record<string, string | number> = {
      p1: m.list,
      p2: capTxt,
      ...(m.capped ? { p2p1: m.total, p2Id: 'core.industry.048' } : {}),
    }
    return {
      text,
      id: labelId,
      params,
    }
  }

  if (Object.keys(rec.min).length > 0) {
    const m = listOf(rec.min)
    // 回收 = 「保底原材料 」+ 清单（.058）；精炼 = 光清单（.044）
    // 注：段的 `text` 必须非空（`composeLog` 按各段文本拼中文原串，空文本的段会被整段丢掉）
    parts.push(isRecycle ? typeSeg('保底原材料 ', 'core.industry.058', m) : typeSeg('', 'core.industry.044', m))
  }
  if (isRecycle) {
    // 2026-09-11：日志文案禁用开发用词「彩头」（玩家反馈"不符合游戏设定的名词"）——统一写「额外掉落」
    const lootText: string[] = []
    const lootSubs: LogSeg[] = []
    if (Object.keys(rec.mod).length > 0) {
      const m = listOf(rec.mod)
      lootText.push(`装备 ${m.list}${m.capped ? ` 等${m.total}种` : ''}`)
      lootSubs.push(typeSeg('装备 ', 'core.industry.059', m))
    }
    const dr = rec.drone ?? {}
    if (Object.keys(dr).length > 0) {
      const m = listOf(dr)
      lootText.push(`无人机 ${m.list} 架${m.capped ? ` 等${m.total}种` : ''}`)
      lootSubs.push(typeSeg('无人机 ', 'core.industry.060', m))
    }
    const bpAcc = rec.blueprint ?? {}
    if (Object.keys(bpAcc).length > 0) {
      const m = listOf(bpAcc)
      lootText.push(`图纸 ${m.list} 张${m.capped ? ` 等${m.total}种` : ''}`)
      lootSubs.push(typeSeg('图纸 ', 'core.industry.061', m))
    }
    if (Object.keys(rec.frag).length > 0) {
      const m = listOf(rec.frag)
      lootText.push(`蓝图碎片 ${m.list}${m.capped ? ` 等${m.total}种` : ''}`)
      lootSubs.push(typeSeg('蓝图碎片 ', 'core.industry.062', m))
    }
    if (lootText.length > 0) parts.push({ text: `额外掉落：${lootText.join('；')}`, id: 'core.industry.057', subs: lootSubs })
  }
  return { text: parts.map((p) => p.text).join('；'), parts }
}
