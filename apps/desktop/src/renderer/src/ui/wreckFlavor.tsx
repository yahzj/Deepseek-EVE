/**
 * B3.1 残骸回收「产出倾向 / 低出率掉落」展示零件（2026-09-08 收尾：星图打捞页星系卡与工业页回收卡共用）。
 * - 产出倾向 = recycleNote（敌群特色一句话说明）；
 * - 低出率掉落 = 主题追加件（敌群增幅装备；无主题卡回落 基础件/MK2 默认池）+ 高威胁蓝图碎片（阈值同回收引擎）。
 * 文案与类名对齐工业页回收卡 WreckFlavorRow 既有行（同族最小差异，不另起样式）。
 */
import { FRAGMENT_RECIPES, RECYCLE_BASE_MODULES, RECYCLE_MK2_MODULES } from '@whale/core'

/** 一件低出率掉落的文本（模块名 / 低安专属 MK2 / 蓝图碎片（集 N 片）），可直接 join('；') */
export function recycleFlavorParts(
  src: {
    lowSec: boolean
    threat: number
    loot?: { modules?: readonly string[]; mk2?: readonly string[] }
    /** 只列"主题追加件"：无主题件时不回落全图默认池（星系汇总行用；回收卡不传保持既有口径） */
    themedOnly?: boolean
  },
  mods: ReadonlyMap<string, { name?: string }>,
): string[] {
  const moduleName = (id: string): string => mods.get(id)?.name ?? id
  const namesOf = (ids: readonly string[] | undefined, fallback: readonly string[]): string[] => {
    if (ids !== undefined && ids.length > 0) return ids.filter((id) => mods.has(id)).map(moduleName)
    return src.themedOnly ? [] : fallback.filter((id) => mods.has(id)).map(moduleName)
  }
  const parts: string[] = []
  const base = namesOf(src.loot?.modules, RECYCLE_BASE_MODULES)
  if (base.length > 0) parts.push(base.join('、'))
  if (src.lowSec) {
    const mk2 = namesOf(src.loot?.mk2, RECYCLE_MK2_MODULES)
    if (mk2.length > 0) parts.push(`低安专属：${mk2.join('、')}`)
  }
  // 高威胁出蓝图碎片（集片门槛与回收开箱引擎同款：T2 100 片 / T3 1000 片）
  const frags: string[] = []
  for (const m of Object.keys(FRAGMENT_RECIPES)) {
    const r = FRAGMENT_RECIPES[m]!
    const eligible = r.need === 100 ? src.threat >= 17 : r.need === 1000 ? src.threat >= 41 : false
    if (eligible && mods.has(m)) frags.push(`${moduleName(m)}蓝图碎片（集 ${r.need} 片）`)
  }
  if (frags.length > 0) {
    parts.push(frags.slice(0, 4).join('、') + (frags.length > 4 ? ` 等${frags.length}种` : ''))
  }
  return parts
}

/** 提示行组件：产出倾向 / 低出率掉落（无内容返回 null）——工业页回收卡与星图打捞页星系卡共用 */
export function FlavorTip({ note, parts }: { note?: string; parts: string[] }) {
  if (!note && parts.length === 0) return null
  return (
    <div className="app-belt-desc is-tip">
      {note ? <div className="app-dim">产出倾向：{note}</div> : null}
      {parts.length > 0 ? <div className="app-dim">低出率掉落：{parts.join('；')}</div> : null}
    </div>
  )
}
