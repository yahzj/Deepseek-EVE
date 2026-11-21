import type { FoeFamily } from './types'
import type { RecycleTier } from './salvage'


export type WreckRegion = 'hi' | 'lo' | 'wh' | 'inv'
export const WRECK_REGION_LABELS: Readonly<Record<WreckRegion, string>> = {
  hi: '高安',
  lo: '低安',
  wh: '信号空间',
  inv: '入侵',
}

export const WRECK_FAMILY_NAMES: Readonly<Record<string, string>> = {
  A: '海盗',
  B: '武装拾荒者',
  C: '异形生物',
  D: '守墓者',
  E: '泰坦巨构',
  G: '鱿鱼亡军',
  H: '墨潮帮',
  R: '光环',
}

export interface WreckGroupDef {
  key: string
  family: FoeFamily
  region: WreckRegion
  name: string
  rareName: string
  tier: RecycleTier
  pool: ReadonlyArray<readonly [string, number]>
  note: string
  threat: number
  theme: { modules?: readonly string[]; mk2?: readonly string[] }
  rareTheme?: readonly string[]
  lairGear?: readonly string[]
  members: readonly string[]
}

export const WRECK_GROUPS: readonly WreckGroupDef[] = [
  {
    key: 'c-inv', family: 'C', region: 'inv', name: '异形生物残骸（入侵）', rareName: '异形生物稀有残骸（入侵）',
    lairGear: ['mod-alien-acid-launcher', 'mod-alien-pressure-chamber', 'drone-jawclaw'],
    tier: 'dire', pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '异形生物残骸（入侵）：星髓晶与重钨合金为主，夹结构料', threat: 124,
    theme: { modules: ['mod-armor-plate-2'] },
    rareTheme: ['mod-armor-plate-2', 'mod-armor-exp-2', 'mod-drone-tac-2', 'mod-drone-rack-2'],
    members: ['alien-vanguard', 'alien-escort', 'alien-main', 'alien-broodmother'],
  },
  {
    key: 'a-hi',
    family: 'A',
    region: 'hi',
    name: '海盗残骸（高安）',
    rareName: '海盗稀有残骸（高安）',
    tier: 'common',
    pool: [['min-tritanium', 55], ['min-pyerite', 41], ['min-mexallon', 3], ['min-nocxium', 1]],
    note: '海盗残骸（高安）：钛钢结构料为主，夹银纹装甲板与晶态胶体',
    threat: 23,
    theme: { modules: ['mod-armor-plate-2', 'mod-miner-2', 'mod-cargo-2', 'mod-shield-kin-2'] },
    members: [
      'ano-pirate-post', 'ano-redring-raiders', 'ano-shard-bandits', 'ano-lantern-saboteurs', 'ano-haze-ambush',
      'enc-pirate-1', 'enc-pirate-2', 'enc-pirate-3', 'enc-pirate-4',
    ],
  },
  {
    key: 'b-hi',
    family: 'B',
    region: 'hi',
    name: '武装拾荒者残骸（高安）',
    rareName: '武装拾荒者稀有残骸（高安）',
    tier: 'common',
    pool: [['min-tritanium', 63], ['min-pyerite', 28], ['min-mexallon', 9]],
    note: '武装拾荒者残骸（高安）：钛钢结构料为主，夹银纹与晶态胶体',
    threat: 11,
    theme: {},
    members: ['ano-training', 'ano-abandoned-platform', 'ano-harbor-escort'],
  },
  {
    key: 'd-hi',
    family: 'D',
    region: 'hi',
    name: '守墓者残骸（高安）',
    rareName: '守墓者稀有残骸（高安）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '守墓者残骸（高安）：星髓晶髓材与重钨合金甲',
    threat: 46,
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['ano-ghost-signal'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-armor-plate-2', 'mod-rof-2'],
  },
  {
    key: 'a-lo',
    family: 'A',
    region: 'lo',
    name: '海盗残骸（低安）',
    rareName: '海盗稀有残骸（低安）',
    tier: 'risky',
    pool: [['min-tritanium', 40], ['min-isotope', 40], ['min-nocxium', 20]],
    note: '海盗残骸（低安）：同位聚晶富集',
    threat: 48,
    theme: { mk2: ['mod-gyro-2', 'mod-armor-pla-2'] },
    members: ['ano-mirage-hijackers'],
  },
  {
    key: 'c-lo',
    family: 'C',
    region: 'lo',
    name: '异形生物残骸（低安）',
    rareName: '异形生物稀有残骸（低安）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 53], ['min-nocxium', 4], ['min-isotope', 1], ['min-darkiron', 2]],
    note: '异形生物残骸（低安）：星髓晶髓材为主，夹重钨与冥铁合金',
    threat: 64,
    theme: {
      mk2: [
        'mod-shield-exp-2', 'mod-armor-plate-2', 'mod-drone-tac-2', 'mod-drone-rack-2',
        'mod-prop-2', 'mod-gyro-2', 'mod-stab-kin-2', 'mod-armor-exp-2',
      ],
    },
    members: ['ano-abyss-guard', 'ano-starcore-boss', 'ano-maw-hunt', 'ano-chasm-aberrations'],
  },
  {
    key: 'd-lo',
    family: 'D',
    region: 'lo',
    name: '守墓者残骸（低安）',
    rareName: '守墓者稀有残骸（低安）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-isotope', 28], ['min-starcore', 18], ['min-darkiron', 14]],
    note: '守墓者残骸（低安）：冥铁合金残片与同位聚晶',
    threat: 91,
    theme: {
      mk2: ['mod-shield-pla-2', 'mod-armor-plate-2', 'mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3', 'mod-rof-2'],
    },
    members: ['ano-gravekeeper', 'ano-vault-sentinel', 'ano-voidedge-warden'],
  },
  {
    key: 'e-lo',
    family: 'E',
    region: 'lo',
    name: '泰坦巨构残骸（低安）',
    rareName: '泰坦巨构稀有残骸（低安）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 48], ['min-isotope', 12]],
    note: '泰坦巨构残骸（低安）：巨构残片里的星髓晶与同位聚晶',
    threat: 69,
    theme: { mk2: ['mod-shield-ext-2', 'mod-armor-plate-2', 'mod-armor-exp-2', 'mod-stab-exp-2', 'mod-drone-tac-2'] },
    members: ['ano-titan-wreck', 'ano-auro-raiders', 'ano-core-section'],
  },
  {
    key: 'g-lo',
    family: 'G',
    region: 'lo',
    name: '鱿鱼亡军残骸（低安）',
    rareName: '鱿鱼亡军稀有残骸（低安）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    note: '鱿鱼亡军残骸（低安）：冥铁合金与同位聚晶为主，夹结构与装甲料',
    threat: 53,
    theme: { mk2: ['mod-armor-pla-2', 'mod-shield-ext-2', 'mod-rof-2', 'mod-track-2'] },
    members: ['ano-cinder-siege', 'ano-echo-haunt', 'ano-nadir-static'],
  },
  {
    key: 'a-wh',
    family: 'A',
    region: 'wh',
    name: '海盗残骸（信号空间）',
    rareName: '海盗稀有残骸（信号空间）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-nocxium', 23], ['min-starcore', 25], ['min-isotope', 12]],
    note: '海盗残骸（信号空间）：重钨合金甲与星髓晶髓材为主，夹同位聚晶',
    threat: 45,
    theme: {},
    members: ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband'],
  },
  {
    key: 'c-wh',
    family: 'C',
    region: 'wh',
    name: '异形生物残骸（信号空间）',
    rareName: '异形生物稀有残骸（信号空间）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 28], ['min-isotope', 20], ['min-nocxium', 12]],
    note: '异形生物残骸（信号空间）：星髓晶髓材为主，夹同位聚晶与重钨',
    threat: 45,
    theme: {},
    members: ['wh-alien-swarm', 'wh-alien-brood', 'wh-alien-hive'],
  },
  {
    key: 'd-wh',
    family: 'D',
    region: 'wh',
    name: '守墓者残骸（信号空间）',
    rareName: '守墓者稀有残骸（信号空间）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 4], ['min-nocxium', 24], ['min-starcore', 10], ['min-isotope', 22]],
    note: '守墓者残骸（信号空间）：冥铁合金残片与重钨合金甲为主，夹星髓晶髓材',
    threat: 45,
    theme: {},
    members: ['wh-grave-watch', 'wh-grave-sentry', 'wh-grave-throne'],
  },
  {
    key: 'e-wh',
    family: 'E',
    region: 'wh',
    name: '泰坦巨构残骸（信号空间）',
    rareName: '泰坦巨构稀有残骸（信号空间）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-isotope', 26], ['min-darkiron', 2], ['min-starcore', 24], ['min-mexallon', 8]],
    note: '泰坦巨构残骸（信号空间）：同位聚晶为主，夹冥铁合金与星髓晶髓材',
    threat: 45,
    theme: {},
    members: ['wh-titan-echo', 'wh-titan-missile', 'wh-titan-hulk'],
  },
  {
    key: 'g-wh',
    family: 'G',
    region: 'wh',
    name: '鱿鱼亡军残骸（信号空间）',
    rareName: '鱿鱼亡军稀有残骸（信号空间）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 8], ['min-starcore', 2], ['min-isotope', 38], ['min-mexallon', 12]],
    note: '鱿鱼亡军残骸（信号空间）：冥铁合金与同位聚晶为主，夹晶态胶体',
    threat: 45,
    theme: {},
    members: ['wh-exile-blockade', 'wh-exile-swarm', 'wh-exile-line'],
  },
  {
    key: 'h-hi',
    family: 'H',
    region: 'inv',
    name: '墨潮帮残骸（入侵）',
    rareName: '墨潮帮稀有残骸（入侵）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '墨潮帮残骸（入侵）：星髓晶与重钨合金为主，夹结构料',
    threat: 124,
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'],
  },
  {
    key: 'r-inv',
    family: 'R',
    region: 'inv',
    name: '光环残骸（入侵）',
    rareName: '光环稀有残骸（入侵）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '光环残骸（入侵）：星髓晶与重钨合金为主，夹结构料',
    threat: 124,
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['corona-drift', 'corona-split', 'corona-converge', 'corona-nexus'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-shieldchg-2', 'mod-track-2'],
  },
  {
    key: 'd-inv',
    lairGear: ['mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail'],
    family: 'D',
    region: 'inv',
    name: '守墓者残骸（入侵）',
    rareName: '守墓者稀有残骸（入侵）',
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '守墓者残骸（入侵）：星髓晶与重钨合金为主，夹结构料',
    threat: 124,
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-armor-plate-2', 'mod-rof-2'],
  },
]

export const WRECK_GROUP_OF_MEMBER: ReadonlyMap<string, string> = new Map(
  WRECK_GROUPS.flatMap((g) => g.members.map((m) => [m, g.key] as const)),
)

export const WRECK_GROUP_BY_KEY: ReadonlyMap<string, WreckGroupDef> = new Map(WRECK_GROUPS.map((g) => [g.key, g]))

export function wreckItemIdOfKey(key: string): string {
  return `wreck-${key}`
}
export function rareWreckItemIdOfKey(key: string): string {
  return `wreck-rare-${key}`
}

export function wreckGroupKeyOfAnomaly(anomalyId: string): string | null {
  return WRECK_GROUP_OF_MEMBER.get(anomalyId) ?? null
}

export function wreckGroupOfAnomaly(anomalyId: string): WreckGroupDef | null {
  const key = wreckGroupKeyOfAnomaly(anomalyId)
  return key === null ? null : (WRECK_GROUP_BY_KEY.get(key) ?? null)
}

export function wreckGroupOfItemId(itemId: string): WreckGroupDef | null {
  const rare = itemId.startsWith('wreck-rare-')
  if (rare) {
    const key = itemId.slice('wreck-rare-'.length)
    const direct = WRECK_GROUP_BY_KEY.get(key)
    if (direct) return direct
    const legacy = WRECK_GROUP_OF_MEMBER.get(key)
    return legacy === undefined ? null : (WRECK_GROUP_BY_KEY.get(legacy) ?? null)
  }
  if (!itemId.startsWith('wreck-')) return null
  const key = itemId.slice('wreck-'.length)
  const direct = WRECK_GROUP_BY_KEY.get(key)
  if (direct) return direct
  const legacy = WRECK_GROUP_OF_MEMBER.get(key)
  return legacy === undefined ? null : (WRECK_GROUP_BY_KEY.get(legacy) ?? null)
}


export const WRECK_YIELD_TIER_MUL: Readonly<Record<RecycleTier, number>> = {
  common: 1.0,
  risky: 1.15,
  dire: 1.2,
}

export function wreckYieldMultiplierOf(tier: RecycleTier): number {
  return WRECK_YIELD_TIER_MUL[tier] ?? 1
}
