import { FOE_LAIR_GEAR } from '@whale/core'
import { FACTION_CODEX } from './factionCodex'

/** 已上线势力内容引用原登记表，额外违禁/账本商品明确列举；目录仍负责挡未上线。 */
export const BLACK_MARKET_EXCLUSIVE_REFS: ReadonlySet<string> = new Set([
  ...Object.values(FOE_LAIR_GEAR).flat(),
  ...Object.values(FACTION_CODEX).flatMap((f) => [...f.modules, ...f.ships, ...f.blueprints]),
  'mat-wh-essence', 'invasion-beacon', 'synaptic-accelerant',
  'gamma', 'beta', 'alpha', 'blackbox-h', 'blackbox-r', 'blackbox-universal',
])
