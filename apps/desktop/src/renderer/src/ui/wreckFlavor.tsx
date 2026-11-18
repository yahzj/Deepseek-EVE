import { FRAGMENT_RECIPES, recycleBatchValueFromYield, recyclePoolMeanIsk } from '@whale/core'
import { tr } from '../i18n/locale'

type NameMaps = {
  mods: ReadonlyMap<string, { name?: string }>
  items?: ReadonlyMap<string, { name?: string; kind?: string }>
  droneUnits?: number
}

export type RecycleFeatureSrc = {
  lowSec: boolean
  threat: number
  loot?: { modules?: readonly string[]; mk2?: readonly string[] }
  lairGear?: readonly string[]
}

export type RecycleFeature = {
  label: string
  named: string[]
  generic: string[]
  tone: 'strong' | 'normal'
}

const FRAG_THREAT: Record<2 | 3, number> = { 2: 17, 3: 41 }

function fragNeed(tier: 2 | 3): number {
  const rows = Object.values(FRAGMENT_RECIPES).filter((r) => r.tier === tier)
  return rows[0]?.need ?? 0
}

function fragClause(threat: number): string | null {
  if (threat >= FRAG_THREAT[3]) {
    return tr('ui.wreckFlavor.004', { p1: fragNeed(2), p2: fragNeed(3) })
  }
  if (threat >= FRAG_THREAT[2]) return tr('ui.wreckFlavor.005', { p1: fragNeed(2) })
  return null
}

export function recycleFeatureOf(src: RecycleFeatureSrc, maps: NameMaps): RecycleFeature {
  const moduleName = (id: string): string => maps.mods.get(id)?.name ?? maps.items?.get(id)?.name ?? id
  const named: string[] = []
  const gear = (src.lairGear ?? []).filter((id) => maps.mods.has(id) || maps.items?.has(id) === true)
  if (gear.length > 0) {
    const names = gear.map((id) => {
      const item = maps.items?.get(id)
      const suffix = item?.kind === 'drone' && maps.droneUnits ? tr('ui.wreckFlavor.006', { p1: maps.droneUnits }) : ''
      return `${moduleName(id)}${suffix}`
    })
    named.push(names.join(tr("ui.MatterTechTab.017")))
    return { label: tr("ui.MapPage.058"), named, generic: [], tone: 'strong' }
  }
  const themed = [...(src.loot?.modules ?? []), ...(src.loot?.mk2 ?? [])]
  for (const id of themed) {
    if (!maps.mods.has(id)) continue
    const name = moduleName(id)
    if (!named.includes(name)) named.push(name)
  }
  const generic: string[] = []
  const series = [tr('ui.wreckFlavor.001')]
  if (src.lowSec) series.push(tr('ui.wreckFlavor.002'))
  generic.push(`${named.length > 0 ? tr("ui.FitPage.072") : ''}${series.join(tr("ui.MatterTechTab.017"))}`)
  const frag = fragClause(src.threat)
  if (frag) generic.push(frag)
  return { label: named.length > 0 ? tr("ui.MapPage.058") : tr("ui.MapPage.059"), named, generic, tone: 'normal' }
}

export function mineralRowsOf(
  pool: ReadonlyArray<readonly [string, number]>,
  opts: { batchM3: number; yieldPerM3: number; refiningMultiplier: number; priceOf: (id: string) => number },
  mineralName: (id: string) => string,
): Array<{ id: string; name: string; units: string; isk: number; share: number }> {
  const totalW = pool.reduce((s, [, w]) => s + w, 0)
  if (totalW <= 0) return []
  const mean = recyclePoolMeanIsk(pool, opts.priceOf)
  const batchValue = recycleBatchValueFromYield(opts.yieldPerM3, mean, opts.batchM3, opts.refiningMultiplier)
  return pool.map(([id, w]) => {
    const share = w / totalW
    const isk = batchValue * share
    const u = isk / (opts.priceOf(id) || 1)
    const units = u >= 10 ? String(Math.round(u)) : u >= 1 ? u.toFixed(1) : u.toFixed(2)
    return { id, name: mineralName(id), units, isk, share }
  })
}

export function FlavorTip({
  note,
  featureLabel = tr('ui.MapPage.058'),
  named = [],
  generic = [],
  tone = 'normal',
}: {
  note?: string
  featureLabel?: string
  named?: string[]
  generic?: string[]
  tone?: 'strong' | 'normal'
}) {
  if (!note && named.length === 0 && generic.length === 0) return null
  return (
    <div className="app-belt-desc is-tip">
      {note ? <div className="app-dim">{tr("ui.wreckFlavor.003")}{note}</div> : null}
      {named.length > 0 || generic.length > 0 ? (
        <div className={`app-belt-feat${tone === 'strong' ? ' is-strong' : ''}`}>
          {featureLabel}：{named.join('；')}
          {generic.length > 0 ? (
            <span className="app-dim">
              {named.length > 0 ? '；' : ''}
              {generic.join('；')}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
