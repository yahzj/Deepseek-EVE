import type { SimContext } from '../../types'
import { type LogSeg } from '../../logParts'

interface YieldNote {
  text: string
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
  const nameOf = (id: string): string =>
    ctx.modules.get(id)?.name ??
    ctx.items.get(id)?.name ??
    ctx.blueprints.get(id)?.name ??
    ctx.shipBlueprints.get(id)?.name ??
    id
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
    parts.push(isRecycle ? typeSeg('保底原材料 ', 'core.industry.058', m) : typeSeg('', 'core.industry.044', m))
  }
  if (isRecycle) {
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
