/**
 * 残骸回收「保底矿物 / 特色掉落」展示零件（2026-09-08 起工业页回收卡与星图打捞页星系卡共用；
 * 2026-09-10 船长定"说明精简"口径改版）：
 *
 * - **保底矿物**：由卡片自己按 `recycleMineralPoolOf(profile)` 列（引擎同源矿池），
 *   本文件只提供折算好的行数据 `mineralRowsOf`（名称/每批期望量/占比）；
 * - **特色掉落**（原「低出率掉落」更名）：**只讲特色**——该敌群主题追加件具名（稀有残骸 = 该敌群专属装备具名），
 *   其余一律泛化不具名：通用 MK2 池 →「MK2 系列装备」、直出基础池 →「民用与 MK1 系列装备」、
 *   蓝图碎片 →「高威胁另有蓝图碎片」；无特色件时标签退为「其他掉落」。
 *
 * 文案与类名对齐工业页回收卡既有行（同族最小差异，不另起样式）。
 */
import { FRAGMENT_RECIPES } from '@whale/core'

/** 一件掉落物的名字来源（模块或物品；无人机物品按「×N 架」写） */
type NameMaps = {
  mods: ReadonlyMap<string, { name?: string }>
  items?: ReadonlyMap<string, { name?: string; kind?: string }>
  /** 专属无人机一次掉落架数（物品 id 命中时使用；缺省不写数量） */
  droneUnits?: number
}

export type RecycleFeatureSrc = {
  lowSec: boolean
  threat: number
  /** 该敌群主题追加件（中安 = modules 组、低安 = mk2 组；缺省无主题件） */
  loot?: { modules?: readonly string[]; mk2?: readonly string[] }
  /** 稀有残骸：该敌群专属装备池（模块 id 或物品 id），开箱额外掉落 → 具名列特色 */
  lairGear?: readonly string[]
}

export type RecycleFeature = {
  /** 行标签：有具名特色件 = 特色掉落；无 = 其他掉落 */
  label: string
  /** 具名特色件（该敌群主题件 / 专属装备） */
  named: string[]
  /** 泛化兜底（系列装备 + 蓝图碎片），不具名 */
  generic: string[]
}

/** 蓝图碎片门槛文案（与回收引擎同源：tier 2 → 威胁 ≥17、tier 3 → 威胁 ≥41） */
const FRAG_THREAT: Record<2 | 3, number> = { 2: 17, 3: 41 }

/** 该档碎片门槛（集 N 片）——直接读引擎配方，不写字面量 */
function fragNeed(tier: 2 | 3): number {
  const rows = Object.values(FRAGMENT_RECIPES).filter((r) => r.tier === tier)
  return rows[0]?.need ?? 0
}

function fragClause(threat: number): string | null {
  if (threat >= FRAG_THREAT[3]) {
    return `高威胁另有蓝图碎片（MK2 集 ${fragNeed(2)} 片 / MK3 集 ${fragNeed(3)} 片）`
  }
  if (threat >= FRAG_THREAT[2]) return `高威胁另有蓝图碎片（MK2 集 ${fragNeed(2)} 片）`
  return null
}

/**
 * 拆出「特色 / 兜底 / 标签」三段。星图星系卡（多敌群汇总）与工业页回收卡共用。
 * `mods`/`items` 给名字表：模块查 `ctx.modules`、物品查 `ctx.items`（专属无人机是物品）。
 */
export function recycleFeatureOf(src: RecycleFeatureSrc, maps: NameMaps): RecycleFeature {
  const moduleName = (id: string): string => maps.mods.get(id)?.name ?? maps.items?.get(id)?.name ?? id
  const named: string[] = []
  // 稀有残骸：专属装备优先（开箱额外掉落）→ 整句具名并注明来源（不逐件拆开，避免与主题件混淆）
  const gear = (src.lairGear ?? []).filter((id) => maps.mods.has(id) || maps.items?.has(id) === true)
  if (gear.length > 0) {
    const names = gear.map((id) => {
      const item = maps.items?.get(id)
      const suffix = item?.kind === 'drone' && maps.droneUnits ? ` ×${maps.droneUnits} 架` : ''
      return `${moduleName(id)}${suffix}`
    })
    named.push(`${names.join('、')}（该敌群专属装备，每炉必给一件）`)
  }
  // 主题追加件（中安 modules 组、低安 mk2 组）——按敌群特色具名
  const themed = [...(src.loot?.modules ?? []), ...(src.loot?.mk2 ?? [])]
  for (const id of themed) {
    if (!maps.mods.has(id)) continue
    const name = moduleName(id)
    if (!named.includes(name)) named.push(name)
  }
  const generic: string[] = []
  const series = ['民用与 MK1 系列装备']
  if (src.lowSec) series.push('MK2 系列装备')
  // 有具名特色件时用「另有…」；没有（整行退为「其他掉落」）时直接给系列名
  generic.push(`${named.length > 0 ? '另有' : ''}${series.join('、')}`)
  const frag = fragClause(src.threat)
  if (frag) generic.push(frag)
  return { label: named.length > 0 ? '特色掉落' : '其他掉落', named, generic }
}

/** 保底矿物行（工业页回收卡用）：每批期望量 = 批体积 × 档位单方产量 ×(1+8%×提纯学)×池权重占比 */
export function mineralRowsOf(
  pool: ReadonlyArray<readonly [string, number]>,
  opts: { batchM3: number; yieldPerM3: number; refiningLevel: number },
  mineralName: (id: string) => string,
): Array<{ id: string; name: string; units: string; share: number }> {
  const totalW = pool.reduce((s, [, w]) => s + w, 0)
  if (totalW <= 0) return []
  const perBatch = opts.batchM3 * opts.yieldPerM3 * (1 + 0.08 * opts.refiningLevel)
  return pool.map(([id, w]) => {
    const share = w / totalW
    const units = perBatch * share
    // <10 保留一位小数（危档单矿物可能不足 1 单位）；≥10 取整，避免小数噪声
    return { id, name: mineralName(id), share, units: units >= 10 ? String(Math.round(units)) : units.toFixed(1) }
  })
}

/** 提示行组件：产出倾向（星图卡仍显示） / 特色掉落（重命名后可自定义标签）——无内容返回 null */
export function FlavorTip({
  note,
  featureLabel = '特色掉落',
  parts,
}: {
  note?: string
  featureLabel?: string
  parts: string[]
}) {
  if (!note && parts.length === 0) return null
  return (
    <div className="app-belt-desc is-tip">
      {note ? <div className="app-dim">产出倾向：{note}</div> : null}
      {parts.length > 0 ? <div className="app-dim">{featureLabel}：{parts.join('；')}</div> : null}
    </div>
  )
}
