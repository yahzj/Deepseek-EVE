/**
 * **残骸合并表：按「来源种族 × 来源地区」**（2026-09-19 船长定 · 见 `docs/design/wreck-groups-20260919.md`）。
 *
 * 背景（船长原话）：「希望将各个卡片来源的残骸进行合并，目前因为卡片过多导致残骸种类过多。
 * 残骸应该按照来源种族，来源地区（高安，低安，虫洞）进行合并。」
 * ⇒ 残骸物品从**每卡一种**（普通 42 + 稀有 37 = 79 种）并为 **13 组**（普通 13 + 稀有 13 = 26 种）。
 *
 * 三条已确认口径（2026-09-19 船长逐条选定）：
 * ① **保值合并**——组池均价 = 组目标均价，其中
 *    `组目标均价 = 组内各产残骸卡（卡档位当量 × 卡池均价）按威胁加权平均 ÷ 组档位当量`；
 *    构造法：钛钢权重取组内各卡的平均（天然 ≥40%）、其余矿物取成员原池并集、
 *    权重按 `(单价)^α` 指数倾斜 + 二分求 α 命中目标（收口后必须落 ±3% 内，体检复核）。
 * ② **档位按组内主流档**（按产残骸卡数多数决；危档卡并进常档组是有意为之，
 *    船长 2026-09-19 追加「为了平衡价值，可以提高更危险地区的残骸出量」⇒ 见 `WRECK_YIELD_TIER_MUL`）。
 * ③ **命名族称取完整名**（船长：「种族名称要完整，不要用2字缩写」；A 族按船长指示用「海盗」）。
 *    ⚠ 与 `wormholeFoes.WORMHOLE_FAMILY_ETHNIC`（星图/洞内用的**短名**：海盗/异形/守墓/巨构/亡军）
 *    是**两样东西**，别互相替换。
 *
 * ⚠ **为什么这张表住在 core 而不是 data**：存档迁移（`save.ts` 的 v28 段）是**纯函数**、拿不到
 * `SimContext`，而旧 id（`wreck-<卡 id>`）→ 新 id（`wreck-<组 key>`）的映射必须现场可用。
 * ⇒ 表放 core，data 侧 `buildSimContext` 只负责**按表注册物品**；卡与组的对应关系由 `content:check`
 * 的「残骸组契约」对着真卡表双向核对（成员不漏、不多、族/地区对得上、保值目标对得上），防止两边漂移。
 */
import type { FoeFamily } from './types'
import type { RecycleTier } from './salvage'

/* ═══════════ 地区（船长口径：高安 / 低安 / 虫洞） ═══════════ */

/** 残骸来源地区：`hi` 高安（sec > 0）· `lo` 低安（sec ≤ 0，含 0）· `wh` 虫洞（`wh-*` 敌卡与洞内打捞） */
export type WreckRegion = 'hi' | 'lo' | 'wh'
export const WRECK_REGION_LABELS: Readonly<Record<WreckRegion, string>> = {
  hi: '高安',
  lo: '低安',
  wh: '虫洞',
}

/** 族称**完整名**（船长 2026-09-19：「种族名称要完整，不要用2字缩写」；A 族照船长指示用「海盗」） */
export const WRECK_FAMILY_NAMES: Readonly<Record<string, string>> = {
  A: '海盗',
  B: '武装拾荒者',
  C: '异形生物',
  D: '守墓者',
  E: '泰坦巨构',
  G: '鱿烬亡军',
}

/** 组定义（一条 = 一种普通残骸 + 对应的稀有残骸） */
export interface WreckGroupDef {
  /** 组 key（`a-hi`）：物品 id = `wreck-<key>`、稀有 = `wreck-rare-<key>` */
  key: string
  family: FoeFamily
  region: WreckRegion
  /** 普通残骸物品名（`<族称>残骸（<地区>）`） */
  name: string
  /** 稀有残骸物品名（`<族称>稀有残骸（<地区>）`） */
  rareName: string
  /** 回收档位（组内主流档；驱动拆解当量、市场收价、高级箱命中率） */
  tier: RecycleTier
  /** 保底矿物池（权重表；权重即价值占比） */
  pool: ReadonlyArray<readonly [string, number]>
  /** 玩家可见"残骸产出倾向"（洞内 5 组无特色池 ⇒ 空） */
  note: string
  /** 组代表威胁 = 组内产残骸卡威胁的算术平均（取整；驱动蓝图碎片门槛与完好舰体彩头层） */
  threat: number
  /** 主题追加件并集（`modules` = 直出基础池追加；`mk2` = 低安门槛池追加；洞内 5 组为空） */
  theme: { modules?: readonly string[]; mk2?: readonly string[] }
  /** 隶属该组的**全部卡 id**（含隐藏遭遇模板与洞内卡；存档迁移的映射依据） */
  members: readonly string[]
}

/**
 * 13 组定表。成员卡数 = 产残骸卡 / 全部隶属卡（隐藏模板永不产出，但旧档里可能有它们的残骸 ⇒ 仍列进 members）。
 * 池均价与「每 m³ 保底价值」的实测对照见 `docs/design/wreck-groups-20260919.md` §二。
 */
export const WRECK_GROUPS: readonly WreckGroupDef[] = [
  {
    key: 'a-hi',
    family: 'A',
    region: 'hi',
    name: '海盗残骸（高安）',
    rareName: '海盗稀有残骸（高安）',
    tier: 'common',
    // 成员池并集：银纹为主（边境/前哨/碎晶/信标/灰霾）+ 赤潮（危档）的星髓/重钨并进常档
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
    // B 族（武装拾荒者）无窝点、不出稀有残骸（2026-09-10 船长定）⇒ 本组稀有残骸**只为旧档兼容保留登记**
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
      // 穹顶守卫（关底唯一武器直出点）三把 MK3 武器随卡并入本组：白名单从"卡"改指"组"
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
    name: '鱿烬亡军残骸（低安）',
    rareName: '鱿烬亡军稀有残骸（低安）',
    tier: 'risky',
    pool: [['min-tritanium', 40], ['min-isotope', 37], ['min-nocxium', 13], ['min-mexallon', 7], ['min-pyerite', 3]],
    note: '鱿烬亡军残骸（低安）：同位聚晶与重钨合金，夹少量晶态胶体',
    threat: 53,
    theme: { mk2: ['mod-armor-pla-2', 'mod-shield-ext-2', 'mod-rof-2', 'mod-track-2'] },
    members: ['ano-cinder-siege', 'ano-echo-haunt', 'ano-nadir-static'],
  },
  /* ── 洞内 5 组：15 张洞内卡的回收画像本来就完全一致（同走常档基础池、无特色池、无主题件）
   *    ⇒ 合并**零变化**，池即 `RECYCLE_POOLS.common`；出量乘数也因常档 = 1.00 而不动洞内堆量。 ── */
  {
    key: 'a-wh',
    family: 'A',
    region: 'wh',
    name: '海盗残骸（虫洞）',
    rareName: '海盗稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband'],
  },
  {
    key: 'c-wh',
    family: 'C',
    region: 'wh',
    name: '异形生物残骸（虫洞）',
    rareName: '异形生物稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['wh-alien-swarm', 'wh-alien-brood', 'wh-alien-hive'],
  },
  {
    key: 'd-wh',
    family: 'D',
    region: 'wh',
    name: '守墓者残骸（虫洞）',
    rareName: '守墓者稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['wh-grave-watch', 'wh-grave-sentry', 'wh-grave-throne'],
  },
  {
    key: 'e-wh',
    family: 'E',
    region: 'wh',
    name: '泰坦巨构残骸（虫洞）',
    rareName: '泰坦巨构稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['wh-titan-echo', 'wh-titan-missile', 'wh-titan-hulk'],
  },
  {
    key: 'g-wh',
    family: 'G',
    region: 'wh',
    name: '鱿烬亡军残骸（虫洞）',
    rareName: '鱿烬亡军稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['wh-exile-blockade', 'wh-exile-swarm', 'wh-exile-line'],
  },
  /* ── H 族（墨潮帮 · 2026-09-24）：**周末入侵**的独立敌卡也必须有残骸组归属
   *    （契约要求每张敌卡都登记进某一组；两张卡都 `hidden`，按 `wh` 地区计 ⇒ 与本组"会产出"判据相容，
   *    实际产出仍由入侵的奖励结算走，不依赖这条链路）。族 = **新族 H**，回收画像取常档基础池。 ── */
  {
    key: 'h-wh',
    family: 'H',
    region: 'wh',
    name: '墨潮帮残骸（虫洞）',
    rareName: '墨潮帮稀有残骸（虫洞）',
    tier: 'common',
    pool: [['min-tritanium', 65], ['min-pyerite', 30], ['min-mexallon', 5]],
    note: '',
    threat: 45,
    theme: {},
    members: ['ink-flagship', 'ink-assault'],
  },
]

/** 卡 id → 组 key（由 `WRECK_GROUPS.members` 现算；旧档迁移与新产出共用一张索引） */
export const WRECK_GROUP_OF_MEMBER: ReadonlyMap<string, string> = new Map(
  WRECK_GROUPS.flatMap((g) => g.members.map((m) => [m, g.key] as const)),
)

/** 组 key → 组定义 */
export const WRECK_GROUP_BY_KEY: ReadonlyMap<string, WreckGroupDef> = new Map(WRECK_GROUPS.map((g) => [g.key, g]))

/** 普通残骸物品 id / 稀有残骸物品 id（组 key） */
export function wreckItemIdOfKey(key: string): string {
  return `wreck-${key}`
}
export function rareWreckItemIdOfKey(key: string): string {
  return `wreck-rare-${key}`
}

/** 敌卡 id → 该卡所属组（查不到 = 合成/未知卡，返回 null） */
export function wreckGroupKeyOfAnomaly(anomalyId: string): string | null {
  return WRECK_GROUP_OF_MEMBER.get(anomalyId) ?? null
}

/** 该卡所属组定义（查不到 = null） */
export function wreckGroupOfAnomaly(anomalyId: string): WreckGroupDef | null {
  const key = wreckGroupKeyOfAnomaly(anomalyId)
  return key === null ? null : (WRECK_GROUP_BY_KEY.get(key) ?? null)
}

/**
 * 残骸物品 id → 组定义。接受**四种**写法：
 * ① 新 id（`wreck-a-hi` / `wreck-rare-a-hi`）；② 旧 id（`wreck-ano-gravekeeper` / `wreck-rare-wh-grave-throne`，
 * 走 `members` 索引 ⇒ **存档迁移与旧档兼容共用这一条**）；③ 非残骸 id = null。
 */
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

/** 旧残骸 id → 新残骸 id（存档迁移单点；非残骸 id 或未知卡 ⇒ null，调用方原样保留） */
export function migratedWreckItemId(oldItemId: string): string | null {
  const rare = oldItemId.startsWith('wreck-rare-')
  if (!rare && !oldItemId.startsWith('wreck-')) return null
  const cardId = oldItemId.slice(rare ? 'wreck-rare-'.length : 'wreck-'.length)
  const key = WRECK_GROUP_OF_MEMBER.get(cardId)
  if (key === undefined) return null
  return rare ? rareWreckItemIdOfKey(key) : wreckItemIdOfKey(key)
}

/* ═══════════ 出量梯度（2026-09-19 船长：「为了平衡价值，可以提高更危险地区的残骸出量」） ═══════════ */

/**
 * **每轮残骸出量乘数**（按**打捞星系的回收档**取，不是按残骸身份取）：
 * 合并把"同一组内各卡的每 m³ 价值"拉平到 ±3%（保值口径），危险度差异改由**出量**承担
 * ——越危险的星系，每轮捞到的 m³ 越多（与"同一件残骸在不同星系卖一样的价"并存，不冲突）。
 *
 * 取值（船长 2026-09-19 选**甲案**「只补回归」）：常 1.00 / 险 1.15 / 危 1.20。
 * 读数（无技能单台每轮 · 20 星系等权）：合并本身 −0.9%；加本梯度后 **+17.9%**，
 * 唯一明显回归的星系（天底静区 −13.6%）补到 −1%。
 * 契约（`content:check`）：常档恒等于 1.00 且 **常 ≤ 险 ≤ 危**（单调不降）。
 */
export const WRECK_YIELD_TIER_MUL: Readonly<Record<RecycleTier, number>> = {
  common: 1.0,
  risky: 1.15,
  dire: 1.2,
}

/** 该回收档的出量乘数（缺省 1） */
export function wreckYieldMultiplierOf(tier: RecycleTier): number {
  return WRECK_YIELD_TIER_MUL[tier] ?? 1
}
