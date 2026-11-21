import type { FoeFamily } from '@whale/core'
import { FOE_LAIR_GEAR } from '@whale/core'

export interface FactionCodexEntry {
  family: FoeFamily
  nameId: string
  glyph: string
  modules: readonly string[]
  ships: readonly string[]
  blueprints: readonly string[]
}

export const FACTION_CODEX_ORDER: readonly FoeFamily[] = ['A', 'C', 'D', 'E', 'G', 'H', 'R']

export const FACTION_CODEX: Record<string, FactionCodexEntry> = {
  A: {
    family: 'A',
    nameId: 'ui.Handbook.326',
    glyph: 'fam-a',
    modules: ['mod-wh-a-coat', 'mod-wh-a-frag', 'mod-wh-a-hangar', 'mod-wh-a-prop', 'mod-wh-a-scan', 'mod-wh-a-shield', 'plug-pirate-raider', 'plug-pirate-damage-management'],
    ships: ['sh-wh-a-frigate', 'sh-wh-a-destroyer', 'sh-wh-a-cruiser'],
    blueprints: ['bp-wh-a-coat', 'bp-wh-a-frag', 'bp-wh-a-hangar', 'bp-wh-a-prop', 'bp-wh-a-scan', 'bp-wh-a-shield',
      'sbp-wh-a-frigate', 'sbp-wh-a-destroyer', 'sbp-wh-a-cruiser', 'bp-plug-pirate-raider', 'bp-once-plug-pirate-raider',
      'bp-plug-pirate-damage-management', 'bp-once-plug-pirate-damage-management'],
  },
  C: {
    family: 'C',
    nameId: 'ui.Handbook.335',
    glyph: 'fam-c',
    modules: ['mod-wh-c-frame', 'mod-wh-c-laser', 'mod-wh-c-missile', 'mod-wh-c-prism', 'mod-wh-c-pulse', 'drone-wh-c-heavy', 'drone-jawclaw', 'mod-alien-acid-launcher', 'mod-alien-pressure-chamber', 'plug-alien-shield-coating', 'plug-alien-nanobiomass'],
    ships: ['sh-wh-c-frigate', 'sh-wh-c-destroyer', 'sh-wh-c-cruiser'],
    blueprints: ['bp-wh-c-frame', 'bp-wh-c-laser', 'bp-wh-c-missile', 'bp-wh-c-prism', 'bp-wh-c-pulse', 'bp-wh-c-drone',
      'sbp-wh-c-frigate', 'sbp-wh-c-destroyer', 'sbp-wh-c-cruiser', 'bp-faction-drone-hiveguard', 'bp-faction-drone-jawclaw', 'bp-plug-alien-shield-coating', 'bp-once-plug-alien-shield-coating',
      'bp-plug-alien-nanobiomass', 'bp-once-plug-alien-nanobiomass'],
  },
  D: {
    family: 'D',
    nameId: 'ui.Handbook.344',
    glyph: 'fam-d',
    modules: ['mod-wh-d-laser', 'mod-wh-d-loader', 'mod-wh-d-lock', 'mod-wh-d-shield', 'mod-wh-d-steady', 'mod-wh-d-turret', 'mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail', 'plug-gravekeeper-capacitor', 'plug-gravekeeper-charge'],
    ships: ['sh-wh-d-frigate', 'sh-wh-d-destroyer', 'sh-wh-d-cruiser'],
    blueprints: ['bp-wh-d-laser', 'bp-wh-d-loader', 'bp-wh-d-lock', 'bp-wh-d-shield', 'bp-wh-d-steady', 'bp-wh-d-turret',
      'sbp-wh-d-frigate', 'sbp-wh-d-destroyer', 'sbp-wh-d-cruiser', 'bp-plug-gravekeeper-capacitor', 'bp-once-plug-gravekeeper-capacitor',
      'bp-plug-gravekeeper-charge', 'bp-once-plug-gravekeeper-charge'],
  },
  E: {
    family: 'E',
    nameId: 'ui.Handbook.353',
    glyph: 'fam-e',
    modules: ['mod-wh-e-cpu', 'mod-wh-e-dc', 'mod-wh-e-pd', 'mod-wh-e-shield', 'mod-wh-e-tac', 'drone-wh-e-sentry', 'plug-titan-compression', 'plug-titan-drone-command'],
    ships: ['sh-wh-e-frigate', 'sh-wh-e-destroyer', 'sh-wh-e-carrier'],
    blueprints: ['bp-wh-e-cpu', 'bp-wh-e-dc', 'bp-wh-e-pd', 'bp-wh-e-shield', 'bp-wh-e-tac', 'bp-wh-e-drone', 'bp-faction-drone-construct',
      'sbp-wh-e-frigate', 'sbp-wh-e-destroyer', 'sbp-wh-e-carrier', 'bp-plug-titan-compression', 'bp-once-plug-titan-compression',
      'bp-plug-titan-drone-command', 'bp-once-plug-titan-drone-command'],
  },
  G: {
    family: 'G',
    nameId: 'ui.Handbook.362',
    glyph: 'fam-g',
    modules: ['mod-wh-g-ballistic', 'mod-wh-g-fcs', 'mod-wh-g-hangar', 'mod-wh-g-hull', 'mod-wh-g-prop', 'mod-wh-g-turret', 'drone-exile-bee', 'plug-deadarmy-printing', 'plug-deadarmy-reinforced-hull'],
    ships: ['sh-wh-g-frigate', 'sh-wh-g-destroyer', 'sh-wh-g-cruiser'],
    blueprints: ['bp-wh-g-ballistic', 'bp-wh-g-fcs', 'bp-wh-g-hangar', 'bp-wh-g-hull', 'bp-wh-g-prop', 'bp-wh-g-turret', 'bp-faction-drone-bee',
      'sbp-wh-g-frigate', 'sbp-wh-g-destroyer', 'sbp-wh-g-cruiser', 'bp-plug-deadarmy-printing', 'bp-once-plug-deadarmy-printing',
      'bp-plug-deadarmy-reinforced-hull', 'bp-once-plug-deadarmy-reinforced-hull'],
  },
  H: {
    family: 'H',
    nameId: 'ui.Handbook.371',
    glyph: 'fam-h',
    modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'],
    ships: [],
    blueprints: ['bp-faction-drone-ink'],
  },
  R: {
    family: 'R',
    nameId: 'ui.Handbook.381',
    glyph: 'fam-r',
    modules: ['mod-lair-laser-r', 'mod-lair-blink-r', 'mod-lair-beam-r', 'mod-lair-pd-r'],
    ships: [],
    blueprints: [],
  },
}

export const FACTION_CODEX_COUNT = FACTION_CODEX_ORDER.length


export interface FactionEnemy {
  id: string
  seen: boolean
}

export interface FactionCard {
  family: FoeFamily
  nameId: string
  glyph: string
  unlocked: boolean
  seenCount: number
  totalCount: number
  enemies: FactionEnemy[]
  modules: readonly string[]
  ships: readonly string[]
  blueprints: readonly string[]
}

export function buildFactionCards(
  foeShips: readonly { id: string; family: FoeFamily }[],
  foeShipSeen: Readonly<Record<string, true>> | undefined,
): FactionCard[] {
  return FACTION_CODEX_ORDER.map((family) => {
    const entry = FACTION_CODEX[family]!
    const lairGear = FOE_LAIR_GEAR[family]
    const modules = [...new Set([...entry.modules, ...lairGear.filter(id => !id.startsWith('bp-') && !id.startsWith('sbp-'))])]
    const blueprints = [...new Set([...entry.blueprints, ...lairGear.filter(id => id.startsWith('bp-') || id.startsWith('sbp-'))])]
    const enemies: FactionEnemy[] = foeShips
      .filter((s) => s.family === family)
      .map((s) => ({ id: s.id, seen: foeShipSeen?.[s.id] === true }))
    const seenCount = enemies.filter((e) => e.seen).length
    return {
      family,
      nameId: entry.nameId,
      glyph: entry.glyph,
      unlocked: seenCount > 0,
      seenCount,
      totalCount: enemies.length,
      enemies,
      modules,
      ships: entry.ships,
      blueprints,
    }
  })
}

export function factionOfExclusive(id: string): FoeFamily | null {
  const box = /^box-encrypted-([acdeg])$/.exec(id)
  if (box) return box[1]!.toUpperCase() as FoeFamily
  const actualId = id.startsWith('bp-once-plug-') ? id.replace('bp-once-', 'bp-') : id
  for (const family of FACTION_CODEX_ORDER) {
    const e = FACTION_CODEX[family]!
    if (e.modules.includes(actualId) || e.ships.includes(actualId) || e.blueprints.includes(actualId)) return family
  }
  for (const family of FACTION_CODEX_ORDER) {
    if (FOE_LAIR_GEAR[family]?.includes(id) === true) return family
  }
  return null
}

