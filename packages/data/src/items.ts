/**
 * 物品表（M1 + V10 扩容）：矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机。
 *
 * 数值设计（中文说明）：
 * - 矿石/气体/冰矿 1 单位占 1 m³ 货舱，矿物精炼后体积骤减（0.01 m³/单位）；
 * - 精炼配方按"100% 收率价值 ≈ 收购价 ×1.15~1.35"配平：练满精炼赚、初始 50% 收率亏——
 *   逼玩家权衡卖原矿还是练技能精炼（V10 气体/冰矿同规则，只是更高级配方）；
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
    baseSellPriceIsk: 12,
    description: '最常见的低品位矿石，遍布新手星域，是起步的第一桶金。',
    refine: [
      { mineralId: 'min-tritanium', perOre: 2 },
      { mineralId: 'min-pyerite', perOre: 0.6 },
    ],
    refineBatchUnits: 100,
    refineCycleMs: 6_000,
  },
  {
    id: 'ore-scorched',
    name: '灼烧岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 18,
    description: '熔岩包裹的致密矿石，类银与类晶体的重要来源。',
    refine: [
      { mineralId: 'min-pyerite', perOre: 1.6 },
      { mineralId: 'min-mexallon', perOre: 0.5 },
    ],
    refineBatchUnits: 80,
    refineCycleMs: 6_000,
  },
  {
    id: 'ore-hemorphite',
    name: '希莫非特',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 55,
    description: '红色星环内的高价值矿石，航线更长，回报也更丰厚。',
    refine: [
      { mineralId: 'min-nocxium', perOre: 0.55 },
      { mineralId: 'min-tritanium', perOre: 1.5 },
    ],
    refineBatchUnits: 50,
    refineCycleMs: 6_000,
  },
  {
    id: 'ore-glowstone',
    name: '辉云岩',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 150,
    description: '泛着幽光的致密岩层，同位聚晶的主要载体——环心矿区的高纯产出。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.7 },
      { mineralId: 'min-tritanium', perOre: 2.2 },
    ],
    refineBatchUnits: 40,
    refineCycleMs: 7_000,
  },
  {
    id: 'ore-sunshard',
    name: '曦棱晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 115,
    description: '棱面折射晨光的晶体矿石，高纯度同位聚晶的富矿层。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.7 },
      { mineralId: 'min-pyerite', perOre: 1.0 },
    ],
    refineBatchUnits: 40,
    refineCycleMs: 7_000,
  },
  {
    id: 'ore-voidshard',
    name: '玄晶',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 340,
    description: '深空裂隙中凝结的黑色晶体，孕育冥铁合金的母矿。',
    refine: [
      { mineralId: 'min-starcore', perOre: 1.3 },
      { mineralId: 'min-darkiron', perOre: 0.12 },
      { mineralId: 'min-nocxium', perOre: 0.3 },
    ],
    refineBatchUnits: 20,
    refineCycleMs: 8_000,
  },
  {
    id: 'ore-nebulite',
    name: '星幽矿',
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: 490,
    description: '只有星云深处的矿脉才出产的传说级矿石，一舱就能换一艘船。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.55 },
      { mineralId: 'min-starcore', perOre: 0.8 },
    ],
    refineBatchUnits: 12,
    refineCycleMs: 8_000,
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
      { mineralId: 'min-isotope', perOre: 2.2 },
      { mineralId: 'min-tritanium', perOre: 1.2 },
    ],
    refineBatchUnits: 50,
    refineCycleMs: 6_000,
  },
  {
    id: 'gas-phosphor',
    name: '磷光霾',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '坟场深处沉淀的腐蚀性磷光霾云——提炼价值极高的稀有气藏。',
    refine: [
      { mineralId: 'min-isotope', perOre: 2.4 },
      { mineralId: 'min-starcore', perOre: 0.9 },
      { mineralId: 'min-mexallon', perOre: 0.7 },
    ],
    refineBatchUnits: 20,
    refineCycleMs: 8_000,
  },
  {
    id: 'gas-ionstorm',
    name: '离子风暴云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '狂暴离子流内部反而凝集着纯净的星髓晶——敢进去的人才拿得到。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.85 },
      { mineralId: 'min-darkiron', perOre: 0.08 },
      { mineralId: 'min-isotope', perOre: 0.4 },
    ],
    refineBatchUnits: 25,
    refineCycleMs: 7_000,
  },
  {
    id: 'gas-aurora',
    name: '极光云',
    kind: 'gas',
    unitM3: 1,
    baseSellPriceIsk: 330,
    description: '极光粒子云团，传说其中沉淀着冥铁与星髓的混合物。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.7 },
      { mineralId: 'min-darkiron', perOre: 0.28 },
    ],
    refineBatchUnits: 15,
    refineCycleMs: 8_000,
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
      { mineralId: 'min-isotope', perOre: 3.6 },
      { mineralId: 'min-mexallon', perOre: 1.0 },
    ],
    refineBatchUnits: 40,
    refineCycleMs: 6_000,
  },
  {
    id: 'ice-marrow',
    name: '寒髓冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 230,
    description: '冰核深处呈现髓质纹理的古老冰层，星髓晶藏量可观。',
    refine: [
      { mineralId: 'min-starcore', perOre: 0.85 },
      { mineralId: 'min-isotope', perOre: 1.5 },
      { mineralId: 'min-mexallon', perOre: 0.5 },
    ],
    refineBatchUnits: 25,
    refineCycleMs: 7_000,
  },
  {
    id: 'ice-darkstar',
    name: '暗星冰',
    kind: 'ice',
    unitM3: 1,
    baseSellPriceIsk: 360,
    description: '吸收光线的黑色冰晶，暗星冰环深处才有的珍品。',
    refine: [
      { mineralId: 'min-darkiron', perOre: 0.32 },
      { mineralId: 'min-starcore', perOre: 0.6 },
      { mineralId: 'min-isotope', perOre: 1.0 },
    ],
    refineBatchUnits: 12,
    refineCycleMs: 8_000,
  },
]

/** 弹药（V10.5 战斗数值契约就位：克制体系见 docs/design/v10b-combat-data.md；
 * 动能弹对护盾 ×1.5 对装甲 ×0.5、高爆弹反之、等离子弹（能量系）对护盾 ×0.75 其余 ×1.0；
 * V18 口径取消：每型只留单档通用弹，战斗系统开放后由炮台按自身固定弹种消耗） */
export const AMMO: readonly ItemDef[] = [
  {
    id: 'ammo-kinetic-l',
    name: '动能弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 6,
    description: '动能弹：实心高速弹，破盾专精（对护盾 ×1.5、对装甲 ×0.5）。战斗开放后由炮台消耗。',
    damageType: 'kinetic',
    dmg: 6,
  },
  {
    id: 'ammo-explosive-l',
    name: '高爆弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 7,
    description: '高爆弹：拆甲专精（对装甲 ×1.5、对护盾 ×0.5）。战斗开放后由炮台消耗。',
    damageType: 'explosive',
    dmg: 7,
  },
  {
    id: 'ammo-plasma-l',
    name: '等离子弹',
    kind: 'ammo',
    unitM3: 0.02,
    baseSellPriceIsk: 8,
    description: '能量弹（等离子）：全场景中游的通用弹（对护盾 ×0.75、其余 ×1.0），新手备弹首选。战斗开放后由炮台消耗。',
    damageType: 'plasma',
    dmg: 9,
  },
]

/** 无人机（V10.5 战斗数值契约就位：自带伤害源不耗弹；放飞占用船体 CPU——V10.5b 带宽并入；
 * 携带上限受无人机舱容积（ship.droneBayM3）与 CPU 双约束；defense（V11）= 三层血量/回避契约，
 * v1 并入主船火力不单独承伤，"可被击落"机制启用时零迁移） */
export const DRONES: readonly ItemDef[] = [
  {
    id: 'drone-scout',
    name: '蜂鸟侦察无人机',
    kind: 'drone',
    unitM3: 1.5,
    baseSellPriceIsk: 900,
    description: '轻型侦察无人机：动能点射（破盾）。战斗开放后放飞。',
    damageType: 'kinetic',
    dmg: 3,
    cpuUse: 4,
    defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 },
  },
  {
    id: 'drone-assault',
    name: '赤鸢战斗无人机',
    kind: 'drone',
    unitM3: 3,
    baseSellPriceIsk: 2200,
    description: '轻型战斗无人机：高爆打击（拆甲）。战斗开放后放飞。',
    damageType: 'explosive',
    dmg: 6,
    cpuUse: 7,
    defense: { shieldHp: 10, armorHp: 6, hullHp: 18, shieldResist: { kinetic: 0.1 }, evasion: 0.4 },
  },
  {
    id: 'drone-heavy',
    name: '猎鹰攻坚无人机',
    kind: 'drone',
    unitM3: 6,
    baseSellPriceIsk: 5000,
    description: '重型攻坚无人机：能量脉冲（通用）。战斗开放后放飞。',
    damageType: 'plasma',
    dmg: 12,
    cpuUse: 11,
    defense: { shieldHp: 20, armorHp: 12, hullHp: 34, armorResist: { explosive: 0.1, plasma: 0.05 }, evasion: 0.32 },
  },
  {
    id: 'drone-sentry',
    name: '雷鸥哨戒无人机',
    kind: 'drone',
    unitM3: 10,
    baseSellPriceIsk: 9500,
    description: '哨戒无人机：重型能量炮组，航程极远。战斗开放后放飞。',
    damageType: 'plasma',
    dmg: 20,
    cpuUse: 16,
    defense: { shieldHp: 30, armorHp: 20, hullHp: 55, shieldResist: { kinetic: 0.1, explosive: 0.1 }, hullResist: { kinetic: 0.05 }, evasion: 0.25 },
  },
]

/** 全部物品（矿石/矿物在前为兼容旧展示顺序，其后气体/冰/弹药/无人机） */
export const ITEMS: readonly ItemDef[] = [...ORES, ...MINERALS, ...GASES, ...ICES, ...AMMO, ...DRONES]

/** 构建"物品 id → 定义"目录 */
export function buildItemCatalog(): ReadonlyMap<string, ItemDef> {
  return new Map(ITEMS.map((item) => [item.id, item]))
}
