import { DAMAGE_TYPE_LABEL_IDS, WORMHOLE_FAMILY_ETHNIC_IDS } from '@whale/core'
import type { WormholeFamily } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

const TIER_IDS: Readonly<Record<string, string>> = {
  shallow: 'core.wormholeFoes.001',
  mid: 'core.wormholeFoes.002',
  deep: 'core.wormholeFoes.003',
}

function partsText(parts: ReadonlyArray<{ type: 'kinetic' | 'explosive' | 'plasma'; share: number }>): string {
  const typeId = (t: 'kinetic' | 'explosive' | 'plasma'): string => tr(DAMAGE_TYPE_LABEL_IDS[t])
  if (parts.length <= 1) return tr('core.wormholeFoes.012', { p1: typeId(parts[0]?.type ?? 'kinetic') })
  return parts.map((p) => tr('core.wormholeFoes.013', { p1: typeId(p.type), p2: Math.round(p.share * 100) })).join(' · ')
}

function primaryTextOf(it: {
  primaryKind: 'pure' | 'main' | 'mixed'
  primaryTypeA: 'kinetic' | 'explosive' | 'plasma'
  primaryTypeB?: 'kinetic' | 'explosive' | 'plasma'
}): string {
  const a = tr(DAMAGE_TYPE_LABEL_IDS[it.primaryTypeA])
  if (it.primaryKind === 'pure') return tr('core.wormholeFoes.012', { p1: a })
  if (it.primaryKind === 'main') return tr('core.wormholeFoes.014', { p1: a })
  return tr('core.wormholeFoes.015', { p1: a, p2: tr(DAMAGE_TYPE_LABEL_IDS[it.primaryTypeB ?? 'kinetic']) })
}

export function wormholeIntelLine(engine: GameEngine, family: WormholeFamily): string {
  const it = engine.wormholeFamilyIntel(family)
  return tr('core.wormholeFoes.016', {
    p1: it.firstCardName,
    p2: tr(WORMHOLE_FAMILY_ETHNIC_IDS[it.family]),
    p4: primaryTextOf(it),
  })
}

export function wormholeIntelTip(engine: GameEngine, family: WormholeFamily, archName?: string): string {
  const it = engine.wormholeFamilyIntel(family)
  const lines = [
    tr('core.wormholeFoes.017', { p1: it.firstCardName, p2: tr(WORMHOLE_FAMILY_ETHNIC_IDS[it.family]) }),
    tr('core.wormholeFoes.018'),
    ...it.tiers.map((t) =>
      tr('core.wormholeFoes.019', { p1: tr(TIER_IDS[t.tier] ?? t.tier), p2: t.cardName, p3: partsText(t.parts) }),
    ),
  ]
  if (archName) lines.push(tr('core.wormholeFoes.020', { p1: archName }))
  return lines.join('\n')
}
