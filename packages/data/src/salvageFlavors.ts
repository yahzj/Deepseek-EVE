/**
 * 卡级回收特色表（2026-09-08 船长定稿；**2026-09-19 残骸合并后退役为"构建依据与体检输入"**）。
 *
 * ⚠ **运行时不再读取本文件的任何字段**：残骸回收画像（保底矿物池 / 产出倾向说明 / 主题追加件 / 档位）
 * 一律走 `core/wreckGroups.ts` 的 **13 组表**（船长 2026-09-19「残骸按来源种族 × 来源地区合并」）。
 * 本文件留下的是**合并的原料与审计依据**，`tools/content-check.ts` 的「残骸组契约」拿它复核三件事：
 * ① 组池均价 = 保值目标 ±3%（目标由本表的卡级池按威胁加权反推）；
 * ② 组池的矿物集合 ⊆ 该组成员卡原池的并集（不凭空出现新矿物）；
 * ③ 组主题件 = 该组成员卡主题件的并集（且仍守"武器不入主题件"的旧规矩，仅守墓者·低安组例外）。
 * 卡上的 `recyclePool` / `recycleNote` / `recycleLoot` 三个字段已随本次合并从 `AnomalyDef` 删除。
 *
 * 规则（原样留档）：
 * - recycleLoot.modules = 中安主题追加件（加到"直出基础池"上；每卡 ≤1 件、非火力增幅件）；
 * - recycleLoot.mk2 = 低安主题追加件（加到"低安门槛 MK2 池"上；默认 7 件一件不少，仅 sec<0 掷）；
 * - 主题件不得含武器；唯一例外 = 关底穹顶守卫 追加三把 MK3 武器（动能/激光/导弹架）；
 * - 有追加件时引擎整池按均价反比缩放（EV 守恒）。
 */
export type RecycleFlavor = {
  recyclePool?: ReadonlyArray<readonly [string, number]>
  recycleNote?: string
  recycleLoot?: { modules?: readonly string[]; mk2?: readonly string[] }
}

/** 卡级**主题追加件**（构建依据 · 体检输入：组主题件必须是本表在该组内的并集） */
export const RECYCLE_LOOT_PILOT: Record<string, RecycleFlavor['recycleLoot']> = {
  // ── 中安（**0 < sec < 0.5**；2026-09-12 船长「0也算低安」后，0.0 的两个星系已移入下段低安档）：直出基础池追加 1 件非火力增幅件 ──
  'ano-lantern-saboteurs': { modules: ['mod-cargo-2'] }, // 信标猎手：长途货舱
  'ano-haze-ambush': { modules: ['mod-shield-kin-2'] }, // 灰霾伏击：动能护盾增强
  'ano-shard-bandits': { modules: ['mod-miner-2'] }, // 碎晶劫匪：掠夺采集器
  'ano-redring-raiders': { modules: ['mod-armor-plate-2'] }, // 赤潮舰队：装甲增厚
  'ano-ghost-signal': { modules: ['mod-shield-pla-2'] }, // 幽灵舰：能量护盾残影
  'ano-mirage-hijackers': { mk2: ['mod-gyro-2', 'mod-armor-pla-2'] }, // 蜃影劫持：姿态陀螺（机动）+ 能量甲（2026-09-11 换区：中安→低安，故由 modules 改为 mk2）
  // ── 低安（**sec ≤ 0，含 0**）：低安门槛 MK2 池追加增幅件（默认 7 件保留）──
  'ano-echo-haunt': { mk2: ['mod-shield-ext-2'] }, // 回音残舰：护盾扩展（2026-09-12 船长「0也算低安」⇒ 0.0 的回音荒区归低安档，由 modules 改为 mk2）
  'ano-auro-raiders': { mk2: ['mod-armor-exp-2', 'mod-stab-exp-2'] }, // 奥罗盗匪：高爆甲+高爆稳定
  'ano-abyss-guard': { mk2: ['mod-shield-exp-2', 'mod-armor-plate-2'] }, // 深渊卫队：高爆盾+增厚
  'ano-titan-wreck': { mk2: ['mod-shield-ext-2', 'mod-armor-plate-2'] }, // 泰坦：巨构扩展+增厚（武器清出）
  // 巨构核心（E 族代表卡）：机群导控 + 增厚——"接近完好"＝炮台仍可用，但主力仍是警戒机群
  'ano-core-section': { mk2: ['mod-drone-tac-2', 'mod-armor-plate-2'] },
  'ano-cinder-siege': { mk2: ['mod-armor-pla-2'] }, // 烬火围攻：能量甲增厚（2026-09-12 船长「0也算低安」⇒ 0.0 的烬火星区归低安档，由 modules 改回 mk2）
  'ano-chasm-aberrations': { mk2: ['mod-stab-kin-2', 'mod-armor-exp-2'] }, // 裂谷畸变：动能稳定+高爆甲
  'ano-nadir-static': { mk2: ['mod-rof-2', 'mod-track-2'] }, // 天底封锁：射速+索敌
  'ano-starcore-boss': { mk2: ['mod-drone-tac-2', 'mod-drone-rack-2'] }, // 星髓虫群：战术导控+甲板扩展（武器清出）
  'ano-maw-hunt': { mk2: ['mod-prop-2', 'mod-gyro-2'] }, // 噬口猎杀：矢量推进+陀螺
  'ano-voidedge-warden': { mk2: ['mod-shield-pla-2', 'mod-rof-2'] }, // 虚海守望：能量盾+射速
  'ano-gravekeeper': { mk2: ['mod-shield-pla-2', 'mod-armor-plate-2'] }, // 坟场守墓：能量盾+增厚
  // ── 穹顶守卫（关底唯一武器直出点）：门槛池追加三把 MK3 武器（动能/激光/导弹架；不追加装甲——默认池已有）──
  'ano-vault-sentinel': { mk2: ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3'] },
  /* ── H 族（墨潮帮）四张入侵卡：2026-09-26 船长令「**H族已经添加势力装备，可以放入残骸内**」+「甲2」
   *    ⇒ 三件 H 势力装备挂成主题件（`h-hi` 组的 `theme.modules` 就是本表这四行的并集）。
   *    ⚠ 契约特别处：它们锚在展示用的 `galaxy-hub`（sec 1.0，高安）⇒ 读 `content:check` 的
   *    「主题彩头仅限 sec<0.5 星系」得走**入侵卡例外**（判据 = 卡级 `region` 覆写为 `inv`），
   *    与洞内/中安/低安卡的 `modules`（中安档）/`mk2`（低安档）分区检查是两条独立的线。 ── */
  'ink-harass': { modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'] },
  'ink-raid': { modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'] },
  'ink-main': { modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'] },
  'ink-flagship': { modules: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'] },
}

/** 卡级特色池与产出倾向（**构建依据 · 体检输入**；运行时见 `@whale/core` 的 `WRECK_GROUPS`） */
export const RECYCLE_FLAVOR: Record<string, RecycleFlavor> = {
  'ano-harbor-escort': {
    recyclePool: [['min-pyerite', 55], ['min-tritanium', 45]],
    recycleNote: '商路护航队残骸：银纹超金属为主，夹少量钛钢结构料',
  },
  'ano-pirate-post': {
    recyclePool: [['min-pyerite', 57], ['min-tritanium', 43]],
    recycleNote: '边境海盗前哨残骸：银纹超金属为主',
  },
  'ano-abandoned-platform': {
    recyclePool: [['min-mexallon', 20], ['min-tritanium', 80]],
    recycleNote: '旧工业平台残骸：晶态胶体偏多',
  },
  'ano-lantern-saboteurs': {
    recyclePool: [['min-mexallon', 22], ['min-tritanium', 78]],
    recycleNote: '信标猎手残骸：晶态胶体与钛钢结构料',
  },
  'ano-haze-ambush': {
    recyclePool: [['min-mexallon', 24], ['min-tritanium', 76]],
    recycleNote: '灰霾伏击团残骸：晶态胶体偏多',
  },
  'ano-shard-bandits': {
    // 2026-09-10 重校（基础密度口径变更致本卡档位 险→常：均价须回到 m×常档基数 9.8 = 10.58）
    // 2026-09-14 第二批（船长「提高钛钢占比到 40~60」⇒ 只提不降 · 统一 40% · 均价不变）：
    // 钛钢 35.5% → 40%，补入**晶态胶体**（银纹 12 单独撑不到 10.58 的目标均价）
    recyclePool: [['min-tritanium', 40], ['min-pyerite', 58], ['min-mexallon', 2]], // 10.58 → 10.56（−0.20%）
    recycleNote: '碎晶带劫匪残骸：钛钢结构料与银纹装甲板',
  },
  'ano-redring-raiders': {
    // 2026-09-10 重校（本卡档位 险→危：均价须回到 m×危档基数 92.4 = 104.97）
    recyclePool: [['min-tritanium', 40], ['min-starcore', 31], ['min-nocxium', 29]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 104.60 → 105.25（+0.62%）
    recycleNote: '赤潮劫掠舰队残骸：星髓晶髓材与重钨合金甲',
  },
  'ano-ghost-signal': {
    // 2026-09-10 重校（本卡档位 险→危：均价须回到 m×危档基数 92.4 = 109.40）
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 109.25 → 109.90（+0.59%）
    recycleNote: '幽灵舰残骸：星髓晶含量飙升',
  },
  'ano-echo-haunt': {
    // 2026-09-26 船长令「将G族和H族残骸价格提高到和D族差不多的位置」⇒ 本卡（G 低安组）对标 **D 族低安组**
    // 卡级池 `ano-gravekeeper`（钛钢 40 · 冥铁合金 19 · 同位聚晶 41，均价 173.95）；配合卡级 `wreckTier: 'dire'`
    // ⇒ 卡级价值 0.62 × 173.95 = **107.85 ISK/m³**（改前 33.40 × 2.06 = 68.80）。
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]], // 均价 33.40 → 173.95（船长令提价）
    recycleNote: '回音残舰残骸：冥铁合金与同位聚晶为主',
  },
  'ano-mirage-hijackers': {
    // 2026-09-11 重校（同上：蜃影星系 0.0 → -0.7，本卡由中安升为**低安**，危险度档位 → 险：
    // 均价须回到 m×险档基数 27.6 = 43.249）——**这是海盗进低安的收益面**：残骸更值钱。
    // 2026-09-14 第二批：钛钢 20% → 40%；主题矿物（同位 55 / 晶态 20）撑不到 43.15 的目标均价
    // ⇒ 补入**重钨合金**（90）——晶态出池，卡面说明同步（不再提晶态）
    recyclePool: [['min-tritanium', 40], ['min-isotope', 40], ['min-nocxium', 20]], // 均价 43.15 → 43.20（+0.12%）
    recycleNote: '蜃影劫持者残骸：同位聚晶富集',
  },
  'ano-auro-raiders': {
    // 2026-09-12 重校（同一批）：目标 m = (1+0.45×0.2)×(1+0.004×62) = **1.360** ⇒ 目标均价 = **125.7**。
    // ⚠ 原池（重钨合金 25 : 银纹 75 = 37.5）是为**旧档基数**定的；三张巨构卡集中到奥罗后本星系档基数变为 92.4
    // ⇒ 按规则重定价，并补入**星髓晶**（呼应"**所有巨构都在奥罗荒环**"的设定）。
    // 取 银纹 28 : 同位聚晶 30 : 星髓晶 42 ⇒ (20×28+55×30+245×42)/100 = **125.0**（−0.5%，落 ±3% 内）
    recyclePool: [['min-tritanium', 40], ['min-mexallon', 4], ['min-isotope', 9], ['min-starcore', 47]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 123.95 → 124.10（+0.12%）；重钨出池（改由星髓/同位撑价）
    recycleNote: '奥罗武装残骸：巨构残片里的星髓晶与同位聚晶',
  },
  'ano-abyss-guard': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 56], ['min-nocxium', 4]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 143.35 → 144.00（+0.45%）
    recycleNote: '深渊守卫残骸：星髓晶髓材为主，夹少量重钨合金',
  },
  'ano-titan-wreck': {
    // 2026-09-12 重校（船长「将所有巨构移动到奥罗荒环」）：目标 m = (1+0.45×0.2)×(1+0.004×60) = **1.352**
    // ⇒ 目标均价 = 1.352 × 档基数 92.4 = **124.9**；取 星髓晶 37 : 同位聚晶 63 ⇒ (245×37+55×63)/100 = **125.3**（+0.3%）
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 13]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 125.40 → 125.50（+0.08%）
    recycleNote: '泰坦残骸：星髓晶浓度极高',
  },
  'ano-core-section': {
    // 2026-09-12 新增（E 族「核心舱段级」代表卡）：深渊之门密度 1,368 ⇒ **危档**（基数 92.4）、
    // m = sec(−0.7)→1.315 × 威胁84→1.336 = **1.7095** ⇒ 均价须回到 **m×92.4 = 157.96**。
    // 矿物按设计稿主题规则「深渊/裂谷 → **星髓 + 同位**」；本卡是"接近完好的巨构"，星髓晶占比最高。
    // 2026-09-12 重校（同上）：目标 m = 1.417 ⇒ 目标均价 = 130.9；取 同位聚晶 60 : 星髓晶 40 ⇒ (55×60+245×40)/100 = **131.0**（+0.1%）
    recyclePool: [['min-tritanium', 40], ['min-isotope', 10], ['min-starcore', 50]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 131.10 → 131.20（+0.08%）
    recycleNote: '巨构核心残骸：星髓晶整块未裂，同位聚晶成脉',
  },
  'ano-cinder-siege': {
    // 2026-09-11 重校（船长「低安至少要有一个海盗族」→ 烬火星区与蜃影星系**互换安全等级**：
    // 本卡所在星系 -0.7 → 0.0，危险度档位随之 危 → **常**：均价须回到 m×常档基数 9.8 = 11.446）
    // 2026-09-14 第二批：钛钢 14% → 40%，补入**晶态胶体**（银纹 12 单独撑不到 11.44 的目标均价）
    // 2026-09-26 船长令「将G族和H族残骸价格提高到和D族差不多的位置」⇒ 本卡（G 低安组）对标
    // **D 族低安组**卡级池（钛钢 40 · 冥铁合金 19 · 同位聚晶 41，均价 173.95）+ 卡级 `wreckTier: 'dire'`
    // ⇒ 卡级价值 107.85 ISK/m³（改前 11.44 × 5.8 = 66.35）。
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]], // 均价 11.44 → 173.95（船长令提价）
    recycleNote: '烬火围攻残骸：冥铁合金与同位聚晶为主',
  },
  'ano-chasm-aberrations': {
    // 2026-09-12 重校（船长「**重定价池子**」）：本卡档位口径 = **危档**——裂谷深带残骸基础密度
    // **1,206** ≥ 危线 642 ⇒ 档基数 **92.4**（不是 2026-09-10 那次重校认定的险档 27.6），
    // 故均价须回到 **m×92.4 = 144.57**（m = sec(−0.6)→1.27 × 威胁58→1.232 = 1.56464）。
    // 矿物按设计稿主题规则选（`b3-flavor-content.md` §权重生成规则：「深渊/裂谷→**星髓+同位**」）。
    recyclePool: [['min-tritanium', 40], ['min-isotope', 3], ['min-starcore', 57]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 144.40 → 144.50（+0.07%）
    recycleNote: '裂谷畸变体残骸：星髓晶富集，夹少量同位聚晶',
  },
  'ano-nadir-static': {
    // 2026-09-10 重校（本卡档位 危→险：均价须回到 m×险档基数 27.6 = 42.74）
    // 2026-09-14 第二批：钛钢 20% → 40%；主题矿物（同位 55 / 晶态 20）撑不到 42.80 的目标均价
    // ⇒ 补入**重钨合金**（90）——晶态出池，卡面说明同步改为「同位聚晶与重钨合金」
    // 2026-09-26 船长令「将G族和H族残骸价格提高到和D族差不多的位置」⇒ 本卡（G 低安组）对标
    // **D 族低安组**卡级池（钛钢 40 · 冥铁合金 19 · 同位聚晶 41，均价 173.95）+ 卡级 `wreckTier: 'dire'`
    // ⇒ 卡级价值 107.85 ISK/m³（改前 42.85 × 2.06 = 88.27）。
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]], // 均价 42.85 → 173.95（船长令提价）
    recycleNote: '天底封锁残骸：冥铁合金与同位聚晶为主',
  },
  'ano-starcore-boss': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 58], ['min-isotope', 2]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 146.30 → 146.40（+0.07%）
    recycleNote: '星髓虫群残骸：星髓晶为主——名副其实',
  },
  'ano-maw-hunt': {
    // 2026-09-14 第二批：钛钢 20% → 40%；同位+星髓（最高 245）撑不到 169.10 的目标均价
    // ⇒ 补入**冥铁合金**（780）
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 7], ['min-darkiron', 6]], // 均价 169.10 → 169.00（−0.06%）
    recycleNote: '噬口猎杀残骸：星髓晶重富集，夹冥铁合金',
  },
  'ano-voidedge-warden': {
    // 2026-09-14 第二批：钛钢 20% → 40%；同位+星髓（最高 245）撑不到 169.10 的目标均价
    // ⇒ 补入**冥铁合金**（780）
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 7], ['min-darkiron', 6]], // 均价 169.10 → 169.00（−0.06%）
    recycleNote: '虚海守望者残骸：星髓晶重富集，夹冥铁合金',
  },
  'ano-gravekeeper': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 176.10 → 173.95（−1.22%；冥铁/同位二元池 + 整数权重下的最近解）
    recycleNote: '坟场守墓舰残骸：冥铁合金残片',
  },
  'ano-vault-sentinel': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]], // 2026-09-14 第二批：钛钢 20% → 40%，均价 176.10 → 173.95（−1.22%；冥铁/同位二元池 + 整数权重下的最近解）
    recycleNote: '穹顶守卫残骸：冥铁合金残片',
  },
  /* ── H 族（墨潮帮）四张入侵卡：2026-09-26 船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」
   *    ⇒ 卡级池对标 **D 族高安组**（`ano-ghost-signal` 同款：钛钢 40 · 星髓晶 34 · 重钨合金 26 · 均价 109.90），
   *    配合四张卡的 `wreckTier: 'dire'` ⇒ 卡级价值 0.62 × 109.90 = **68.14 ISK/m³**（改前 5.8 × 9.8 = 56.84）。
   *    为什么必须写卡级池：这四张卡锚在展示用的 `galaxy-hub`（密度 58）⇒ 缺省池 = 常档基础池 9.8，
   *    组池也就上不去（B3.1「保值」：组池均价 = 卡级加权目标 ±3%）。 ── */
  'ink-harass': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], // 均价 9.80 → 109.90（船长令提价）
    recycleNote: '墨潮帮骚扰舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-raid': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮帮袭击舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-main': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮帮主力舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-flagship': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮旗舰部队残骸：星髓晶与重钨合金为主',
  },
}

/** ⚠ **2026-09-19 已删除 `withRecycleFlavor`**：卡级特色不再并进 `AnomalyDef`（字段已删），
 *  运行时一律查 `WRECK_GROUPS`；本文件只剩"合并的原料"这一职责。 */
