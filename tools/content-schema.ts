/**
 * 内容工作台 · 共享列契约（content-export.ts / content-import.ts 同源，2026-09-05）。
 *
 * 每个表定义：
 * - file: 源 TS 文件（相对仓库根）
 * - idProp: 对象主键属性名（skills 等 = 'id'；market = 'key'）
 * - cols: 列清单（head = 导出 CSV 表头全文【两端契约，勿手改漂移】；p = 数据路径）
 *
 * 列 kind：
 * - 'id'     主键（只读，存在性校验）
 * - 'str'    字符串（name/description/group…）
 * - 'enum'   枚举（vals 集合）
 * - 'ref'    引用 id（写回同字符串；校验目标表存在：items/galaxies）
 * - 'num'    数值（min/max/int 可选；空 = 该字段不改）
 * - 'bool'   布尔（CSV 是/否；空 = 不改）
 * - 'obj'    p = 'root.key'：对象内数值键（抗性/权重/槽位——按键合并，只写差异键）
 * - 'list'   p 为元素数组（refine/loot/outputs）：紧凑串 `id×值|…` 整体替换
 *
 * 空单元格语义（两端一致）：空 = 该字段不改；列表/可选字段填 '-' = 删除该字段。
 * 所有数值 = 引擎原值（0.2 = 20%），枚举 = 英文原值。
 */
export interface ColSpec {
  head: string
  p: string
  k: 'id' | 'str' | 'enum' | 'num' | 'bool' | 'obj' | 'list' | 'ref'
  vals?: readonly string[]
  min?: number
  max?: number
  int?: boolean
  /** list 子键：id 键名 / 值键名 / 值下限 / 值整数 */
  itemKey?: string
  valKey?: string
  valMin?: number
  valInt?: boolean
  /** 引用校验目标表：'items' | 'galaxies'（list 的 itemKey / 普通 ref 字段） */
  ref?: 'items' | 'galaxies'
  /** bool/列表的默认 CSV 头说明用（无运行时作用） */
}

export interface TableSpec {
  name: string
  file: string
  idProp: 'id' | 'key'
  cols: readonly ColSpec[]
}

const col = (
  head: string,
  p: string,
  k: ColSpec['k'],
  extra: Partial<ColSpec> = {},
): ColSpec => ({ head, p, k, ...extra })

export const TABLES: readonly TableSpec[] = [
  {
    name: 'skills',
    file: 'packages/data/src/skills.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('组', 'group', 'str'),
      col('rank(难度系数)', 'rank', 'num', { min: 1, int: true }),
      col('描述(⟦⟧高亮段须与引擎接线一致，改动后需人工复核)', 'description', 'str'),
    ],
  },
  {
    name: 'items',
    file: 'packages/data/src/items.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('kind(ore矿石/mineral矿物/gas气体/ice冰矿/ammo弹药/drone无人机)', 'kind', 'enum', {
        vals: ['ore', 'mineral', 'gas', 'ice', 'ammo', 'drone'],
      }),
      col('单位体积m³', 'unitM3', 'num', { min: 0.0001 }),
      col('空间站收购价ISK', 'baseSellPriceIsk', 'num', { min: 0 }),
      col('精炼配方(mineralId×每单位产出|…)', 'refine', 'list', {
        itemKey: 'mineralId', valKey: 'perOre', valMin: 0.0001, ref: 'items',
      }),
      col('精炼批量(单位/批)', 'refineBatchUnits', 'num', { min: 1, int: true }),
      col('精炼周期ms', 'refineCycleMs', 'num', { min: 1, int: true }),
      col('伤害类型(kinetic动能/explosive高爆/plasma能量)', 'damageType', 'enum', {
        vals: ['kinetic', 'explosive', 'plasma'],
      }),
      col('伤害基数dmg', 'dmg', 'num', { min: 0.0001 }),
      col('CPU占用cpuUse(无人机)', 'cpuUse', 'num', { min: 0 }),
      col('修理恢复repairRestore(0~1)', 'repairRestore', 'num', { min: 0, max: 1 }),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'modules',
    file: 'packages/data/src/modules.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('家族slot(miner采矿/cargo货舱/turret动能炮/missile导弹架/laser激光炮/shield护盾/armor装甲/propulsion推进/drone-rack甲板扩展/drone-tac战术导控/support支援)', 'slot', 'enum', {
        vals: ['miner', 'cargo', 'turret', 'missile', 'laser', 'shield', 'armor', 'propulsion', 'drone-rack', 'drone-tac', 'support'],
      }),
      col('物理槽rack(high/mid/low)', 'rack', 'enum', { vals: ['high', 'mid', 'low'] }),
      col('bonus原值(采矿产量/货舱容量加成；0.2=+20%)', 'bonus', 'num', { min: -1, max: 5 }),
      col('护盾容量加成shieldHpBonus(0.15=+15%)', 'shieldHpBonus', 'num', { min: 0, max: 5 }),
      col('护盾抗性动能shieldResistAdd.kinetic', 'shieldResistAdd.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('护盾抗性高爆shieldResistAdd.explosive', 'shieldResistAdd.explosive', 'obj', { min: 0, max: 0.9 }),
      col('护盾抗性能量shieldResistAdd.plasma', 'shieldResistAdd.plasma', 'obj', { min: 0, max: 0.9 }),
      col('装甲容量加成armorHpBonus', 'armorHpBonus', 'num', { min: 0, max: 5 }),
      col('装甲抗性动能armorResistAdd.kinetic', 'armorResistAdd.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('装甲抗性高爆armorResistAdd.explosive', 'armorResistAdd.explosive', 'obj', { min: 0, max: 0.9 }),
      col('装甲抗性能量armorResistAdd.plasma', 'armorResistAdd.plasma', 'obj', { min: 0, max: 0.9 }),
      col('速度加成speedBonusPct(推进)', 'speedBonusPct', 'num', { min: 0, max: 5 }),
      col('开火失稳命中削减hitPenalty(0~0.5)', 'hitPenalty', 'num', { min: 0, max: 0.5 }),
      col('弹种damageType(kinetic/explosive/plasma)', 'damageType', 'enum', { vals: ['kinetic', 'explosive', 'plasma'] }),
      col('最大射程m', 'maxRangeM', 'num', { min: 1 }),
      col('最小射程m(近盲)', 'minRangeM', 'num', { min: 0 }),
      col('基础命中率hitRate(0~1)', 'hitRate', 'num', { min: 0, max: 1 }),
      col('命中衰减falloff(0~1)', 'falloff', 'num', { min: 0, max: 1 }),
      col('装填时间ms', 'reloadMs', 'num', { min: 1, int: true }),
      col('单发倍率dmgMult', 'dmgMult', 'num', { min: 0.0001, max: 100 }),
      col('CPU占用cpuUse', 'cpuUse', 'num', { min: 0 }),
      col('无人机甲板扩容m³', 'droneBayBonusM3', 'num', { min: 0 }),
      col('无人机伤害加成droneDmgBonus', 'droneDmgBonus', 'num', { min: 0, max: 5 }),
      col('按系伤害加成动能damageTypeBonusPct.kinetic', 'damageTypeBonusPct.kinetic', 'obj', { min: 0, max: 5 }),
      col('按系伤害加成高爆damageTypeBonusPct.explosive', 'damageTypeBonusPct.explosive', 'obj', { min: 0, max: 5 }),
      col('按系伤害加成功量damageTypeBonusPct.plasma', 'damageTypeBonusPct.plasma', 'obj', { min: 0, max: 5 }),
      col('射速缩短reloadCutPct(0.05=装填÷1.05)', 'reloadCutPct', 'num', { min: 0, max: 5 }),
      col('命中提升hitBonusPct(0.08=命中×1.08)', 'hitBonusPct', 'num', { min: 0, max: 5 }),
      col('闪避缺口削减evasionGapPct(0.1=被命中×0.9)', 'evasionGapPct', 'num', { min: 0, max: 5 }),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'ships',
    file: 'packages/data/src/ships.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('档次tier(1~4)', 'tier', 'num', { min: 1, max: 4, int: true }),
      col('角色role(industrial工业/armed武装/armored重装/hauler航运)', 'role', 'enum', {
        vals: ['industrial', 'armed', 'armored', 'hauler'],
      }),
      col('货舱m³', 'cargoM3', 'num', { min: 1 }),
      col('采集循环s', 'cycleSeconds', 'num', { min: 1 }),
      col('每循环产量', 'oreUnitsPerCycle', 'num', { min: 0.0001 }),
      col('空间站售价ISK(0=自带/仅制造)', 'priceIsk', 'num', { min: 0 }),
      col('动力agility(0~1，逃生/跃迁充能)', 'agility', 'num', { min: 0, max: 1 }),
      col('火力加成powerBonus', 'powerBonus', 'num', { min: 0, max: 5 }),
      col('护盾量', 'shieldHp', 'num', { min: 0 }),
      col('装甲量', 'armorHp', 'num', { min: 0 }),
      col('结构量', 'hullHp', 'num', { min: 0 }),
      col('盾抗动能', 'shieldResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('盾抗高爆', 'shieldResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('盾抗能量', 'shieldResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('甲抗动能', 'armorResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('甲抗高爆', 'armorResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('甲抗能量', 'armorResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('结构抗动能', 'hullResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('结构抗高爆', 'hullResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('结构抗能量', 'hullResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('CPU总量', 'cpu', 'num', { min: 0 }),
      col('高槽数', 'slots.high', 'obj', { min: 0, int: true }),
      col('中槽数', 'slots.mid', 'obj', { min: 0, int: true }),
      col('低槽数', 'slots.low', 'obj', { min: 0, int: true }),
      col('无人机舱m³', 'droneBayM3', 'num', { min: 0 }),
      col('速度m/s', 'maxSpeedMps', 'num', { min: 0 }),
      col('跃迁AU/s', 'warpSpeedAus', 'num', { min: 0 }),
      col('质量kg', 'massKg', 'num', { min: 0 }),
      col('锁定范围m', 'lockRangeM', 'num', { min: 0 }),
      col('信号半径m', 'signatureM', 'num', { min: 0 }),
      col('扫描分辨率mm', 'scanResMm', 'num', { min: 0 }),
      col('回避evasion(0~0.9)', 'evasion', 'num', { min: 0, max: 0.9 }),
      col('命中加成hitBonus(0~0.5)', 'hitBonus', 'num', { min: 0, max: 0.5 }),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'anomalies',
    file: 'packages/data/src/anomalies.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('星系galaxyId', 'galaxyId', 'ref', { ref: 'galaxies' }),
      col('威胁threat(总战力标尺；涉C4平衡)', 'threat', 'num', { min: 1 }),
      col('战术tactic(brawl贴脸/orbit环绕/kite风筝)', 'tactic', 'enum', { vals: ['brawl', 'orbit', 'kite'] }),
      col('血型defProfile(shield盾/armor甲/balanced均衡)', 'defProfile', 'enum', { vals: ['shield', 'armor', 'balanced'] }),
      col('声望要求', 'standingReq', 'num', { min: 0, int: true }),
      col('胜利声望增长', 'standingGain', 'num', { min: 0, int: true }),
      col('奖励ISK', 'rewardIsk', 'num', { min: 0, int: true }),
      col('战利品(itemId×单位数|…)', 'loot', 'list', { itemKey: 'itemId', valKey: 'units', valMin: 1, valInt: true, ref: 'items' }),
      col('交火展示时长s', 'combatSeconds', 'num', { min: 1, int: true }),
      col('僚机数escorts(0~2)', 'escorts', 'num', { min: 0, max: 2, int: true }),
      col('伤害权重·动能', 'dmgMix.kinetic', 'obj', { min: 0, max: 100 }),
      col('伤害权重·高爆', 'dmgMix.explosive', 'obj', { min: 0, max: 100 }),
      col('伤害权重·能量', 'dmgMix.plasma', 'obj', { min: 0, max: 100 }),
      col('敌速m/sfoeSpeedMps(空=按体积缺省)', 'foeSpeedMps', 'num', { min: 1 }),
      col('隐藏模板hidden(低安遭遇用，非悬赏)', 'hidden', 'bool'),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'belts',
    file: 'packages/data/src/belts.ts',
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('星系galaxyId(空=母港本地)', 'galaxyId', 'ref', { ref: 'galaxies' }),
      col('主产物oreId', 'oreId', 'ref', { ref: 'items' }),
      col('复合产出池outputs(itemId×权重|…)', 'outputs', 'list', { itemKey: 'itemId', valKey: 'weight', valMin: 1, valInt: true, ref: 'items' }),
      col('声望要求standingReq', 'standingReq', 'num', { min: 0, int: true }),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'market',
    file: 'packages/data/src/marketCatalog.ts',
    idProp: 'key',
    cols: [
      col('key(=refId；与其它表id对应)', 'key', 'id'),
      col('kind(item物品/module装备/ship舰船/blueprint蓝图/aicore核心)', 'kind', 'enum', {
        vals: ['item', 'module', 'ship', 'blueprint', 'aicore'],
      }),
      col('rarity(common常驻/rare稀有/exotic限定)', 'rarity', 'enum', { vals: ['common', 'rare', 'exotic'] }),
      col('基准价basePrice(池商品=均衡价；单件=供应价)', 'basePrice', 'num', { min: 0.0001 }),
      col('常驻·目标库存poolTarget', 'poolTarget', 'num', { min: 0, int: true }),
      col('常驻·供应流量supplyFlow', 'supplyFlow', 'num', { min: 0, int: true }),
      col('稀有/限定·供应倍数supplyMultiplier', 'supplyMultiplier', 'num', { min: 0 }),
      col('收购出价倍数demandMultiplier(空=平价)', 'demandMultiplier', 'num', { min: 0 }),
      col('可否卖出playerSellable(空=默认可)', 'playerSellable', 'bool'),
      col('可否买入playerBuyable(空=默认可)', 'playerBuyable', 'bool'),
      col('声望要求standingReq', 'standingReq', 'num', { min: 0, int: true }),
    ],
  },
]

export function tableOf(name: string): TableSpec | undefined {
  return TABLES.find((t) => t.name === name)
}
