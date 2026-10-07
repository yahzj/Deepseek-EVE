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

/* ═══════════ 地区（船长口径：高安 / 低安 / 虫洞 / 入侵） ═══════════ */

/**
 * 残骸来源地区：`hi` 高安（sec > 0）· `lo` 低安（sec ≤ 0，含 0）· `wh` 虫洞（`wh-*` 敌卡与洞内打捞）
 * · **`inv` 入侵**（2026-09-26 船长令「**H族残骸不分高安低安，统一为入侵残骸**（原先的是高安，低安，
 * 虫洞。新增一个类别）」⇒ 周末入侵族的残骸自成一类，不再借用高安/低安的展示口径）。
 */
export type WreckRegion = 'hi' | 'lo' | 'wh' | 'inv'
export const WRECK_REGION_LABELS: Readonly<Record<WreckRegion, string>> = {
  hi: '高安',
  lo: '低安',
  // ⟪文案调整2026-10-06⟫ 旧残骸来源改名，地区枚举不动。
  wh: '信号空间',
  inv: '入侵',
}

/** 族称**完整名**（船长 2026-09-19：「种族名称要完整，不要用2字缩写」；A 族照船长指示用「海盗」） */
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
  /**
   * **组代表威胁** = 组内产残骸卡**回收口径体量**（`AnomalyDef.wreckThreat` ?? `threat`，取整）的算术平均；
   * 驱动**蓝图碎片门槛**（≥17 出 T2 / ≥41 出 T3）与**完好舰体彩头层**。
   *
   * ⚠ **2026-09-25 船长令「冻结残骸经济」**：本字段跟的是**回收口径**（`wreckThreat`），
   * 与卡的 `threat`（战力标签）**已脱钩** ⇒ 威胁重定标不再牵动碎片门槛；
   * 体检契约同步按 `wreckInjectThreatOf` 核对（见 `tools/content-check.ts`）。
   */
  threat: number
  /** 主题追加件并集（`modules` = 直出基础池追加；`mk2` = 低安门槛池追加；洞内 5 组为空） */
  theme: { modules?: readonly string[]; mk2?: readonly string[] }
  /** 稀有箱未出专属时的独立兜底池；不扩张普通残骸主题池。 */
  rareTheme?: readonly string[]
  /** 隶属该组的**全部卡 id**（含隐藏遭遇模板与洞内卡；存档迁移的映射依据） */
  members: readonly string[]
}

/**
 * 13 组定表。成员卡数 = 产残骸卡 / 全部隶属卡（隐藏模板永不产出，但旧档里可能有它们的残骸 ⇒ 仍列进 members）。
 * ⚠ **组的 `threat` 是"回收口径"**（= 成员卡 `wreckThreat` 的平均，2026-09-25 起与战力标签 `threat` 脱钩）。
 * 池均价与「每 m³ 保底价值」的实测对照见 `docs/design/wreck-groups-20260919.md` §二。
 */
export const WRECK_GROUPS: readonly WreckGroupDef[] = [
  {
    key: 'c-inv', family: 'C', region: 'inv', name: '异形生物残骸（入侵）', rareName: '异形生物稀有残骸（入侵）',
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
    name: '鱿鱼亡军残骸（低安）',
    rareName: '鱿鱼亡军稀有残骸（低安）',
    // 2026-09-26 船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」⇒ 本组对标 **D 族低安组**
    // （`d-lo` 池 = 钛钢 40 · 冥铁合金 19 · 同位聚晶 41，池均价 173.95）；三张成员卡同步写
    // `wreckTier: 'dire'`（单点 `salvage.wreckCardTierOf`）⇒ 卡级价值 107.85 ISK/m³ = D 低安组同款。
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    note: '鱿鱼亡军残骸（低安）：冥铁合金与同位聚晶为主，夹结构与装甲料',
    threat: 53,
    theme: { mk2: ['mod-armor-pla-2', 'mod-shield-ext-2', 'mod-rof-2', 'mod-track-2'] },
    members: ['ano-cinder-siege', 'ano-echo-haunt', 'ano-nadir-static'],
  },
  /* ── 洞内 5 组（**2026-09-30 船长令：升危档**）──
   * 船长原话（照抄）：「**虫洞残骸也调整到危级别**」；口径三答：**甲** = 档位与池子一起升
   * （每 m³ 28.62 → 85 上下，×3）· **乙** = 按族给 5 张不同特色池 · **甲** = 稀有箱参数跟随危档。
   *
   * 沿革：2026-09-19 合并时这 15 张洞内卡的回收画像**完全一致**（同走常档基础池 `RECYCLE_POOLS.common`、
   * 无特色池、无主题件）⇒ 当时五组同池；本次按船长令改成**按族分池**的危档口径。
   *
   * 契约口径（`content:check` 残骸组契约逐条核）：钛钢权重占比 **40%** · 组池均价 = 危档基准 92.55 **±3%** ·
   * 组池矿物 ⊆ 成员卡池并集（15 张卡同步写 `wreckTier: 'dire'` ⇒ 卡池 = `RECYCLE_POOLS.dire` 六矿物）。
   * ⚠ **出量梯度不动**：`WRECK_YIELD_TIER_MUL` 按**打捞星系的密度**取、不按残骸身份取 ⇒ 洞内每轮捞到的 m³
   * 与改动前一致，本次**只涨价不增量**。
   * ⚠ 稀有残骸的两处参数（保底矿物单位数 / 专属件概率）**按档位读**，随本次升档自动生效，无代码改动。 ── */
  {
    key: 'a-wh',
    family: 'A',
    region: 'wh',
    // ⟪文案调整2026-10-06⟫ 仅改来源显示，组标识与回收画像不动。
    name: '海盗残骸（信号空间）',
    rareName: '海盗稀有残骸（信号空间）',
    // 2026-09-30 船长令「虫洞残骸也调整到危级别」⇒ 档位升危、池子按族特色给（均价 91.75 · 偏差 −0.86%）
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-nocxium', 23], ['min-starcore', 25], ['min-isotope', 12]],
    // ⟪文案调整2026-10-06⟫ 产出倾向只改来源名。
    note: '海盗残骸（信号空间）：重钨合金甲与星髓晶髓材为主，夹同位聚晶',
    threat: 45,
    theme: {},
    members: ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband'],
  },
  {
    key: 'c-wh',
    family: 'C',
    region: 'wh',
    // ⟪文案调整2026-10-06⟫ 仅改来源显示，组标识与回收画像不动。
    name: '异形生物残骸（信号空间）',
    rareName: '异形生物稀有残骸（信号空间）',
    // 2026-09-30 船长令：升危档 + 按族特色池（均价 93.60 · 偏差 +1.13%）
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 28], ['min-isotope', 20], ['min-nocxium', 12]],
    // ⟪文案调整2026-10-06⟫ 产出倾向只改来源名。
    note: '异形生物残骸（信号空间）：星髓晶髓材为主，夹同位聚晶与重钨',
    threat: 45,
    theme: {},
    members: ['wh-alien-swarm', 'wh-alien-brood', 'wh-alien-hive'],
  },
  {
    key: 'd-wh',
    family: 'D',
    region: 'wh',
    // ⟪文案调整2026-10-06⟫ 仅改来源显示，组标识与回收画像不动。
    name: '守墓者残骸（信号空间）',
    rareName: '守墓者稀有残骸（信号空间）',
    // 2026-09-30 船长令：升危档 + 按族特色池（均价 92.60 · 偏差 +0.05%）
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 4], ['min-nocxium', 24], ['min-starcore', 10], ['min-isotope', 22]],
    // ⟪文案调整2026-10-06⟫ 产出倾向只改来源名。
    note: '守墓者残骸（信号空间）：冥铁合金残片与重钨合金甲为主，夹星髓晶髓材',
    threat: 45,
    theme: {},
    members: ['wh-grave-watch', 'wh-grave-sentry', 'wh-grave-throne'],
  },
  {
    key: 'e-wh',
    family: 'E',
    region: 'wh',
    // ⟪文案调整2026-10-06⟫ 仅改来源显示，组标识与回收画像不动。
    name: '泰坦巨构残骸（信号空间）',
    rareName: '泰坦巨构稀有残骸（信号空间）',
    // 2026-09-30 船长令：升危档 + 按族特色池（均价 93.50 · 偏差 +1.03%）
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-isotope', 26], ['min-darkiron', 2], ['min-starcore', 24], ['min-mexallon', 8]],
    // ⟪文案调整2026-10-06⟫ 产出倾向只改来源名。
    note: '泰坦巨构残骸（信号空间）：同位聚晶为主，夹冥铁合金与星髓晶髓材',
    threat: 45,
    theme: {},
    members: ['wh-titan-echo', 'wh-titan-missile', 'wh-titan-hulk'],
  },
  {
    key: 'g-wh',
    family: 'G',
    region: 'wh',
    // ⟪文案调整2026-10-06⟫ 仅改来源显示，组标识与回收画像不动。
    name: '鱿鱼亡军残骸（信号空间）',
    rareName: '鱿鱼亡军稀有残骸（信号空间）',
    // 2026-09-30 船长令：升危档 + 按族特色池（均价 93.80 · 偏差 +1.35%）
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-darkiron', 8], ['min-starcore', 2], ['min-isotope', 38], ['min-mexallon', 12]],
    // ⟪文案调整2026-10-06⟫ 产出倾向只改来源名。
    note: '鱿鱼亡军残骸（信号空间）：冥铁合金与同位聚晶为主，夹晶态胶体',
    threat: 45,
    theme: {},
    members: ['wh-exile-blockade', 'wh-exile-swarm', 'wh-exile-line'],
  },
  /* ── H 族（墨潮帮 · 2026-09-26 船长令「**统一为入侵残骸**（新增一个类别）」）：**入侵族的独立残骸组** ──
   * 沿革：2026-09-24 先按洞内口径登记为 `h-wh`（当时四张卡都 `hidden`、实际产不出，只为满足"每张卡都要有组"）。
   * 2026-09-25 船长问「入侵敌人的不产生残骸吗」后裁定 ② ⇒ 改成洞外组（残骸不该挂"虫洞"名，也该能进市场收购行）。
   * 2026-09-26 船长再裁「不分高安低安，统一为入侵残骸」⇒ 地区由 `hi` 改**新类别 `inv`**、档位随提价令升危档。
   * - 旧 `h-wh` **退役**：它此前没有任何产出路径 ⇒ 任何存档都不可能持有 `wreck-h-wh` ⇒ 改名零迁移风险；
   * - **产出链路**：被占星系的**打捞型号池**在占领期间并入"驻留的那支入侵舰队"（与遇袭取池
   *   `localBountyPoolOf` 同款做法）⇒ 在该星系打捞就能出本组残骸；
   * - **高级箱**：H 族专属池 = `FOE_LAIR_GEAR.H` 三件（2026-09-26 船长定：射程压制 / 捕获网 / 重袭机）
   *   ⇒ **只在专属支（绝境档 10%）出**；未命中时由**本组主题件**（= 通用 MK2，照 D 高安组同款）兜底
   *   ⇒ **混池**（2026-09-26 船长令「**将H族稀有残骸按照其他族那样混池**」，见下方 `theme` 的注释）；
   * - 组代表威胁 = **124**（= 四张卡回收口径体量 (90+108+129+170)÷4；旗舰卡同日按 170 重标后随动）。 ── */
  {
    key: 'h-hi',
    family: 'H',
    // 2026-09-26 船长令「**H族残骸不分高安低安，统一为入侵残骸**（原先的是高安，低安，虫洞。新增一个类别）」
    // ⇒ 地区由 `hi` 改新类别 **`inv`（入侵）**；组名随之改（组名契约 `<族称>残骸（<地区标签>）` 由测试守）。
    // ⚠ **组 key 故意不改**（`h-hi`）：物品 id `wreck-h-hi` / `wreck-rare-h-hi` 已进玩家档，改 key 要另做存档迁移；
    //    地区语义一律看 `region`，不看 key 后缀。
    region: 'inv',
    name: '墨潮帮残骸（入侵）',
    rareName: '墨潮帮稀有残骸（入侵）',
    // 2026-09-26 船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」⇒ 本组对标 **D 族高安组**
    // （`d-hi` 池 = 钛钢 40 · 星髓晶 34 · 重钨合金 26，池均价 109.90）；四张入侵卡同步写
    // `wreckTier: 'dire'`（单点 `salvage.wreckCardTierOf`）⇒ 卡级价值 68.14 ISK/m³ = D 高安组同款。
    tier: 'dire',
    pool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    note: '墨潮帮残骸（入侵）：星髓晶与重钨合金为主，夹结构料',
    threat: 124,
    /**
     * 🔴 **2026-09-26 船长令（本组第三次改动）**：「**将H族稀有残骸按照其他族那样混池**」——
     * 主题件由「H 三件」改为**通用 MK2 一件**（照 **D 高安组**同款：H 组本就按 D 高安组对标地区/价位/档位）。
     *
     * 为什么必须改：高级箱是两段式（① 专属支按档位掷 `FOE_LAIR_GEAR`；② 未命中 ⇒ 出**主题件**一件）。
     * 原先主题件与专属池是**同一组三件** ⇒ 两条支路指向同一池 ⇒ H 稀有箱**必出 H 件**，与其他族
     * （专属只占 5~10%、其余给通用件）不一致。
     *
     * 改后口径（与其他族同构）：**10%（绝境档）出 H 三件 ＋ 90% 出通用主题件 ＋ 保底矿物**。
     * ⚠ **代价（船长知情）**：H 三件只剩"稀有箱专属支"这一条路 ⇒ 每件期望 ~10 件稀有残骸、集齐 ~30 件
     * （改前 ≈ 3 件）；普通 H 残骸的直出池与「完好舰体直发」也随之不再出 H 件（改出通用主题件）。
     *
     * 契约来源 = 四张成员卡在 `data/src/salvageFlavors.ts` 的 `RECYCLE_LOOT_PILOT` 并集（逐项相等）。
     */
    // ⟪2026-10-04 回调⟫ 普通残骸恢复通用主题件，势力装备只走稀有专属池。
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'],
  },
  /* ── R 族（光环 · Corona Systems · 2026-10-01 船长令「是新势力：余晖」）：**第二个入侵族的独立残骸组** ──
   * 与 H 族组（`h-hi`）同构，一次到位（不像 H 那样经过 `h-wh → h-hi` 两轮迁移）：
   * - **地区 `inv`**（入侵类）· **档位 `dire`**（危档）· 组名契约 `<族称>残骸（<地区标签>）`；
   * - **卡级池对标 D 族高安组**（钛钢 40 · 星髓晶 34 · 重钨合金 26 · 均价 109.90）——
   *   与 H 族同款（船长 2026-09-26 令「G/H 残骸价提到 D 族水平」的口径延伸到本族）；
   * - **产出链路**：与 H 族同款 —— 被占星系的**打捞型号池**在占领期间并入"驻留的那支入侵舰队"；
   * - **高级箱**：R 族专属池 = `FOE_LAIR_GEAR.R` —— ✅ **现已有货（四件）**：叠光激光炮 · 跃迁规避装置 ·
   *   三叉戟光束炮 · PD激光（2026-10-01 两件 ＋ 2026-10-02 两件）。档位 `dire` ⇒ 专属命中率 **10%/箱**、
   *   未命中走第 ② 支**主题件**兜底（通用 MK2 一件）。⚠ 本行 2026-10-01 写作「P0 阶段恒空 ⇒ 全走主题件」，
   *   那是当时四件还没落地时的状态，**2026-10-02 已订正**（实测 400 箱：专属命中 40 次 = 10.0%，
   *   四件都能开出来 —— 用例 `tests/corona-invasion-recycle-20261002.test.ts`）。
   * - 组代表威胁 = **124**（= 四张卡回收口径体量 (90+108+129+170)÷4，与 H 族同一算式）。 ── */
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
    // ⟪2026-10-04 回调⟫ 普通残骸恢复通用主题件，势力装备只走稀有专属池。
    theme: { modules: ['mod-shield-pla-2'] },
    members: ['corona-drift', 'corona-split', 'corona-converge', 'corona-nexus'],
    rareTheme: ['mod-shield-pla-2', 'mod-shield-ext-2', 'mod-shieldchg-2', 'mod-track-2'],
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
