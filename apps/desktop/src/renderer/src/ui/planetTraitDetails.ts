import type { PlanetCatalog, PlanetSurveyView } from '@whale/core'
import { pt } from './planetText'
import { fmtNum } from '../i18n/fmt'

/** 只接公开勘探视图，单特性增减与整星环境倍率分开。 */
export function planetTraitDetails(view: PlanetSurveyView, id: string, catalog: PlanetCatalog) {
  if (!view.traitIds.includes(id)) return undefined
  const trait = catalog.traits.get(id)
  if (!trait) return undefined
  const lines: { k: string; v: string }[] = []
  const signed = (value: number) => (value > 0 ? '+' : '') + fmtNum(value, 0)
  if (trait.hazard) lines.push({ k: pt('hazard'), v: signed(trait.hazard) })
  if (trait.habitability) lines.push({ k: pt('habitability'), v: signed(trait.habitability) })
  if (trait.obstacle) lines.push({ k: pt('obstacle'), v: pt('obstacle.' + trait.obstacle) })
  if (trait.deposit) lines.push({ k: pt('resource'), v: pt('resource.' + trait.deposit.resource) },
    { k: pt('depositBonus'), v: '+' + fmtNum(trait.deposit.bonus * 100, 0) + '%' })
  for (const project of catalog.projects?.values() ?? []) if (project.fromTraitId === id || project.removeTraitId === id) {
    lines.push({ k: pt('projects'), v: pt('project.' + project.id) })
  }
  const tone = trait.kind === 'resource' ? 'resource' : trait.kind === 'special' ? 'special'
    : (trait.hazard ?? 0) > 0 || (trait.habitability ?? 0) < 0 ? 'adverse' : 'beneficial'
  return { name: pt('trait.' + id), lines, tone }
}
