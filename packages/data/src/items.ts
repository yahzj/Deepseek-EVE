/**
 * 物品表（M1 + V10 扩容）：矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机。
 *
 * 数值设计（中文说明）：
 * - 矿石/气体/冰矿 1 单位占 1 m³ 货舱，矿物精炼后体积骤减（0.01 m³/单位）；
 * - 精炼配方 = 「产出倍率基准下每 1 单位资源的矿物产出」（玩家口径：产出倍率，旧称收率；
 *   balance.refining 基础倍率 1.2（无技能净率 ≈+20%）、精炼学 +6%/级、高级回收处理 +3%/级、
 *   满级倍率 1.65（技能本身每级加成较原值下调约 20%）。2026-09-08 工业工位收益体检再定
 *   （配方仍按倍率 1.0 时代的 perOre 值，由引擎倍率驱动产值；perOre 取整允许 ±2pp 漂移）；
 * - 新矿物只由新资源产出 → 不稀释旧矿价值；V10 起高价值采集点需协会声望（见 belts.ts）；
 * - 弹药/无人机为占位消耗品：市场流通、可囤可回卖，战斗系统开放后启用消耗。
 */

import type { ItemDef } from '@whale/core'

/** 矿石（可精炼） */
export const ORES: readonly ItemDef[] = [
  {
    id: 'ore-veldspar',
    name: '富凡晶石',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 13,
    description: '最常见的低品位矿石，遍布新手星域，是起步的第一桶金。',
    refine: [
      { mineralId: 'min-tritanium', perOre: 1.175 },
      { mineralId: 'min-pyerite', perOre: 0.34 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 10_000,
  },
  {
    id: 'ore-scorched',
    name: '灼烧岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 18,
    description: '熔岩包裹的致密矿石，类银与类晶体的重要来源。',
    refine: [
      { mineralId: 'min-pyerite', perOre: 0.985 },
      { mineralId: 'min-mexallon', perOre: 0.35 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 12_000,
  },
  {
    id: 'ore-hemorphite',
    name: '希莫非特',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 55,
    description: '红色星环内的高价值矿石，航线更长，回报也更丰厚。',
    refine: [
      { mineralId: 'min-nocxium', perOre: 0.53 },
      { mineralId: 'min-tritanium', perOre: 1.445 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 14_000,
  },
  {
    id: 'ore-glowstone',
    name: '辉云岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 150,
    description: '泛着幽光的致密岩层，同位聚晶的主要载体——环心矿区的高纯产出。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.64 },
      { mineralId: 'min-tritanium', perOre: 2.15 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 26_000,
  },
  {
    id: 'ore-sunshard',
    name: '曦棱晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 115,
    description: '棱面折射晨光的晶体矿石，高纯度同位聚晶的富矿层。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.075 },
      { mineralId: 'min-pyerite', perOre: 0.77 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 30_000,
  },
  {
    id: 'ore-voidshard',
    name: '玄晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 340,
    description: '深空裂隙中凝结的黑色晶体，孕育冥铁合金的母矿。',
    refine: [
      { mineralId: 'min-starcore', perOre: 1.185 },
      { mineralId: 'min-darkiron', perOre: 0.095 },
      { mineralId: 'min-nocxium', perOre: 0.24 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 45_000,
  },
  {
    id: 'ore-nebulite',
    name: '星幽矿',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 490,
    description: '只有星云深处的矿脉才出产的传说级矿石，一舱就能换一艘船。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.5 },
      { mineralId: 'min-starcore', perOre: 0.685 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 50_000,
  },
]

/** 矿物（精炼产物，可出售；制造原料） */
export const MINERALS: readonly ItemDef[] = [
  {
    id: 'min-tritanium',
    name: '三钛合金',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 8,
    description: '舰船装甲的基本原料，量大价稳。',
  },
  {
    id: 'min-pyerite',
    name: '类银超金属',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 12,
    description: '结构与电子组件的常用材料。',
  },
  {
    id: 'min-mexallon',
    name: '类晶体胶体',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 20,
    description: '高端设备与护盾模组的原料。',
  },
  {
    id: 'min-nocxium',
    name: '超噬矿',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 90,
    description: '稀有矿物，制造旗舰级部件的核心。',
  },
  {
    id: 'min-isotope',
    name: '同位聚晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 55,
    description: '辉云/曦棱层系的精炼核心，高端工业的入门级新材料。',
  },
  {
    id: 'min-starcore',
    name: '星髓晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 245,
    description: '星髓凝晶，MK3 级装备与旗舰舰船骨架的必需材料。',
  },
  {
    id: 'min-darkiron',
    name: '冥铁合金',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 780,
    description: '玄晶与暗星冰才炼得出的重合金，顶级工业的象征。',
  },
  {
    id: 'min-voidcrystal',
    name: '虚空晶',
    kind: 'mineral',
    unitM3: 0.01,
    baseSellPriceIsk: 1800,
    description: '全宇宙最稀有的矿物，只有传说级制造项目才用得起。',
  },
]

/** 气体（可采集可精炼；V10 新资源类） */
export const GASES: readonly ItemDef[] = [
  {
    id: 'gas-neon',
    name: '氖云气',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 85,
    description: '低重力气田的氖氦混合云，采集容易，同位聚晶的重要来源。',
    refine: [
      { mineralId: 'min-isotope', perOre: 1.43 },
      { mineralId: 'min-tritanium', perOre: 0.92 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 18_000,
  },
  {
    id: 'gas-phosphor',
    name: '磷光霾',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '坟场深处沉淀的腐蚀性磷光霾云——提炼价值极高的稀有气藏。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.29 },
      { mineralId: 'min-starcore', perOre: 0.81 },
      { mineralId: 'min-mexallon', perOre: 0.63 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 24_000,
  },
  {
    id: 'gas-ionstorm',
    name: '离子风暴云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '狂暴离子流内部反而凝集着纯净的星髓晶——敢进去的人才拿得到。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.77 },
      { mineralId: 'min-darkiron', perOre: 0.065 },
      { mineralId: 'min-isotope', perOre: 0.315 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 20_000,
  },
  {
    id: 'gas-aurora',
    name: '极光云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '极光粒子云团，传说其中沉淀着冥铁与星髓的混合物。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.735 },
      { mineralId: 'min-darkiron', perOre: 0.25 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 28_000,
  },
]

/** 冰矿（可采集可精炼；V10 新资源类） */
export const ICES: readonly ItemDef[] = [
  {
    id: 'ice-frost',
    name: '蓝霜冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 150,
    description: '蓝白色寒冰星环的碎块，冰层里封存着高纯度同位聚晶。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.475 },
      { mineralId: 'min-mexallon', perOre: 0.73 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 33_000,
  },
  {
    id: 'ice-marrow',
    name: '寒髓冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '冰核深处呈现髓质纹理的古老冰层，星髓晶藏量可观。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.66 },
      { mineralId: 'min-isotope', perOre: 1.21 },
      { mineralId: 'min-mexallon', perOre: 0.44 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 48_000,
  },
  {
    id: 'ice-darkstar',
    name: '暗星冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 360,
    description: '吸收光线的黑色冰晶，暗星冰环深处才有的珍品。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.295 },
      { mineralId: 'min-starcore', perOre: 0.55 },
      { mineralId: 'min-isotope', perOre: 0.915 },
    ],
    // 2026-09-09 顶阶档校准：58/8s 会使 120% 产出倍率净率 135.9% 超护栏(≤135%)——取 42/5.8s
    // （吞吐 ≈26,069/h，净率 132.7% 带内；min-darkiron 高价使 floor 阶梯敏感）
    refineBatchUnits: 100,
    refineCycleMs: 60_000,
  },
]

/** 弹药（V10.5 战斗数值契约就位：克制体系见 docs/design/v10b-combat-data.md；
 * 动能弹对护盾 ×1.5 对装甲 ×0.5、爆破导弹（爆炸）反之、能量弹药（能量系）对护盾 ×0.75 其余 ×1.0；
 * V18 口径取消：每型只留单档通用弹；V18B-1/2：高爆弹更名"爆破导弹"（导弹架专用）、
 * 等离子弹更名"能量弹药"（激光炮专用）——武器形态与弹药一一对应） */
export const AMMO: readonly ItemDef[] = [
  {
    id: 'ammo-kinetic-l',
    name: '动能弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 6,
    description: '动能弹：实心高速弹，破盾专精（对护盾 ×1.5、对装甲 ×0.5）。',
    damageType: 'kinetic',
    dmg: 6,
  },
  {
    id: 'ammo-explosive-l',
    name: '爆破导弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 7,
    description: '爆破导弹：导弹架专用弹药，拆甲专精（对装甲 ×1.5、对护盾 ×0.5）。导弹无视近盲、命中不随距离衰减。',
    damageType: 'explosive',
    dmg: 7,
  },
  {
    id: 'ammo-plasma-l',
    name: '能量弹药',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 8,
    description: '能量弹药：激光炮专用高能电池弹——光束必中、对护盾 ×1.25、对甲/结构 ×1。',
    damageType: 'plasma',
    dmg: 9,
  },
  /* ═══ 弹药 MK2（2026-09-09 船长拍板：三族各出一档高级版——纯数值上级、克制表同基础；
   * dmg 8/9/12、市场 45/60/80、蓝图书稀有可造；装配页按族选档、连打消耗当前配置弹） ═══ */
  {
    id: 'ammo-kinetic-2',
    name: '动能弹 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 45,
    description: '动能弹 MK2：高密度穿甲弹芯的实心高速弹，破盾专精（对护盾 ×1.5、对装甲 ×0.5）。攻坚用高级弹药。',
    damageType: 'kinetic',
    dmg: 8,
  },
  {
    id: 'ammo-explosive-2',
    name: '爆破导弹 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 60,
    description: '爆破导弹 MK2：双级聚能装药的导弹架专用弹，拆甲专精（对装甲 ×1.5、对护盾 ×0.5）。导弹无视近盲、命中不随距离衰减。',
    damageType: 'explosive',
    dmg: 9,
  },
  {
    id: 'ammo-plasma-2',
    name: '能量弹药 MK2',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 80,
    description: '能量弹药 MK2：高密度充能电池弹——光束必中、对护盾 ×1.25、对甲/结构 ×1。激光炮攻坚专用。',
    damageType: 'plasma',
    dmg: 12,
  },
]

/** 无人机（V10.5 战斗数值契约就位：自带伤害源不耗弹；放飞占用船体 CPU——V10.5b 带宽并入；
 * 携带上限受无人机舱容积（ship.droneBayM3）与 CPU 双约束；defense（V11）= 三层血量/回避契约，
 * v1 并入主船火力不单独承伤，"可被击落"机制启用时零迁移）
 * 体积档（2026-09-09 船长拍板）：unitM3 按机种大小分 5/10/20/40 四档——机巢能装几架由体积主导
 * （小护卫带蜂鸟/赤鸢、炮舰带猎鹰、母舰带雷鸥；甲板扩展 +m³ 恢复意义），每架 CPU 不变 */
export const DRONES: readonly ItemDef[] = [
  {
    id: 'drone-scout',
    name: '蜂鸟侦察无人机',
    kind: 'drone',
    unitM3: 5, // 体积档 1/4：轻型侦察机（2026-09-09 船长：体积 5/10/20/40 四档，机巢架数由体积主导）
    baseSellPriceIsk: 900,
    description: '轻型侦察无人机：动能点射（破盾）。机体轻快——闪避最高、装甲最薄。',
    damageType: 'kinetic',
    dmg: 3,
    cpuUse: 4,
    maxRangeM: 2500, // 射程分类 1/4：近身护航（2026-09-10 船长：前三型大幅缩减、哨戒独享远程）
    droneClass: 'scout', // 2026-09-10 分类入本体：「种类」显示 无人机 · 侦察机
    hitRate: 0.75, // 2026-09-10 船长：轻型机群命中 0.6→0.75
    falloff: 1, // 2026-09-10 船长：侦察/战斗/攻坚三型**命中不随距离衰减**（射程带内恒定）
    defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 },
  },
  {
    id: 'drone-assault',
    name: '赤鸢战斗无人机',
    kind: 'drone',
    unitM3: 10, // 体积档 2/4：轻型战斗（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 2200,
    description: '轻型战斗无人机：高爆打击（拆甲）。属性均衡——机群的主力机型。',
    damageType: 'explosive',
    dmg: 6,
    cpuUse: 7,
    maxRangeM: 3000, // 射程分类 2/4：中近缠斗（2026-09-10 船长）
    droneClass: 'combat', // 2026-09-10：无人机 · 战斗机
    hitRate: 0.75, // 2026-09-10 船长
    falloff: 1, // 命中不随距离衰减
    // 2026-09-10 定位调整：属性平均档（闪避 25%、血居中）
    defense: { shieldHp: 12, armorHp: 8, hullHp: 20, shieldResist: { kinetic: 0.1 }, evasion: 0.25 },
  },
  {
    id: 'drone-heavy',
    name: '猎鹰攻坚无人机',
    kind: 'drone',
    unitM3: 20, // 体积档 3/4：重型攻坚（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 5000,
    description: '重型攻坚无人机：能量脉冲（通用）。厚甲重击——血量最厚、闪避最低。',
    damageType: 'plasma',
    dmg: 12,
    cpuUse: 11,
    maxRangeM: 3500, // 射程分类 3/4：攻坚中程（2026-09-10 船长）
    droneClass: 'assault', // 2026-09-10：无人机 · 攻坚机
    hitRate: 0.75, // 2026-09-10 船长
    falloff: 1, // 命中不随距离衰减
    // 2026-09-10 定位调整：血量最厚（97）+ 闪避最低（10%）+ 装甲向抗性（抗拆甲）
    defense: { shieldHp: 30, armorHp: 22, hullHp: 45, armorResist: { explosive: 0.15 }, hullResist: { kinetic: 0.05 }, evasion: 0.1 },
  },
  {
    id: 'drone-sentry',
    name: '雷鸥哨戒无人机',
    kind: 'drone',
    unitM3: 40, // 体积档 4/4：重型哨戒（2026-09-09 船长：体积 5/10/20/40 四档）
    baseSellPriceIsk: 9500,
    description: '哨戒无人机：重型能量炮组，航程极远——但距离越远越难命中；机体轻薄，生存与侦察机相仿。',
    damageType: 'plasma',
    dmg: 20,
    cpuUse: 16,
    maxRangeM: 5000, // 射程分类 4/4：远程哨戒（2026-09-10 船长——哨戒独享远程，兑现"航程极远"）
    droneClass: 'sentry', // 2026-09-10：无人机 · 哨戒机
    hitRate: 1.1, // 2026-09-10 船长：哨戒基础命中 110%（近距被 100% 上限截断，用于抵消回避）
    falloff: 0.35, // 2026-09-10 船长：哨戒**保留正常命中衰减**（射程端点 ×0.35）——独有代价
    // 2026-09-10 定位调整：血量与侦察机相仿（23）+ 闪避次低（18%）——狙击平台靠距离活命
    defense: { shieldHp: 8, armorHp: 5, hullHp: 10, shieldResist: { kinetic: 0.1 }, evasion: 0.18 },
  },
]

/** 修理组件（P2 定稿 2026-09-05：固定回复 × 装甲量增幅——不用“上限百分比”语言；
 * 民用基础 30 HP、军用基础 70 HP（甲、结构各按此值×该层容量增幅）；厚甲船绝对回复更大=甲抗流特征） */
export const REPAIR_KITS: readonly ItemDef[] = [
  {
    id: 'repairkit-civ',
    name: '民用修理组件',
    kind: 'kit',
    unitM3: 1,
    baseSellPriceIsk: 3_000,
    repairRestore: 30,
    description: '纳米修理组件：基础回复 30 HP（结构/装甲各按此值×容量增幅——甲板/技能越厚回得越多）。野外/回港前应急可用。',
  },
  {
    id: 'repairkit-mil',
    name: '军用修理组件',
    kind: 'kit',
    unitM3: 1,
    baseSellPriceIsk: 21_000,
    repairRestore: 70,
    description: '军用级纳米修理组件：基础回复 70 HP×容量增幅。远征深空长线作战的标准补给。',
  },
]

/** 全部物品（矿石/矿物在前为兼容旧展示顺序，其后气体/冰/弹药/无人机/修理组件） */
export const ITEMS: readonly ItemDef[] = [...ORES, ...MINERALS, ...GASES, ...ICES, ...AMMO, ...DRONES, ...REPAIR_KITS]

/** 构建"物品 id → 定义"目录 */
export function buildItemCatalog(): ReadonlyMap<string, ItemDef> {
  return new Map(ITEMS.map((item) => [item.id, item]))
}
