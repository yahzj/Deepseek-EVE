import { FOE_LAIR_GEAR } from '@whale/core'
import { FACTION_CODEX } from './factionCodex'

export const BLACK_MARKET_EXCLUSIVE_REFS: ReadonlySet<string> = new Set([
  ...Object.values(FOE_LAIR_GEAR).flat(),
  ...Object.values(FACTION_CODEX).flatMap((f) => [...f.modules, ...f.ships, ...f.blueprints]),
  'mat-wh-essence', 'invasion-beacon', 'synaptic-accelerant',
  'gamma', 'beta', 'alpha', 'blackbox-h', 'blackbox-r', 'blackbox-universal',
])
