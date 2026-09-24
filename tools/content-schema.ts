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
 *
 * 表头字符纪律：表头只用 ASCII 与 GBK 可表示的字符（m3 不用 m³、不用 ⟦⟧ 等生僻符号）——
 * Excel 以 ANSI(GBK) 保存 CSV 会把不可表示字符写成 '?'，导致表头失配/内容损坏（2026-09-05 实证）。
 *
 * **枚举值域纪律（2026-09-12 加，修卡关 ②）**：凡是**引擎已有的联合类型**（槽位 / 槽类 / 伤害系…），
 * 这里**不许再手写一份**——一律从引擎单点（`MODULE_SLOTS` / `RACK_SLOTS` / `SLOT_LABELS` 等）派生；
 * 体检 `content-check` 另有「内容工作台契约」守**schema 枚举 ⊆ 引擎值域**，防再漂。
 *
 * **表头改名与新词口径（2026-09-15 船长：「按照新名词改名」）**：表头里的中文说明词一律跟随现行术语
 * （`ore` = **原矿**、`mineral` = **原材料**，2026-09-12 定；货币 = **信用点**，2026-09-13 定，`ISK` 退场）。
 * ⚠ 表头文字是**两端契约**（`content:import` 按表头匹配列）⇒ 改名会让**手上那份旧文件**的那几列
 * 变成"未知表头"被跳过 ⇒ 故本文件同时维护 **`HEAD_ALIASES`（旧表头 → 现行表头）**，
 * 导入端先归一化再匹配（用到即打印提示），旧文件照常可导；**下一次编辑前仍建议先重跑
 * `npm run content:export`**（导出件才是干净的现行表头）。
 */
import { ITEM_KIND_LABELS, MODULE_SLOTS, RACK_SLOTS, SLOT_LABELS } from '@whale/core'

/** 物品类别：**引擎单点**（`ITEM_KIND_LABELS` 的键序即表头顺序，不再手抄） */
const ITEM_KINDS = Object.keys(ITEM_KIND_LABELS) as Array<keyof typeof ITEM_KIND_LABELS>
/** items 表 `kind` 列表头全文（`ore原矿/mineral原材料/…`，由单点派生 ⇒ 加类别自动跟随） */
const ITEM_KIND_HEAD = `kind(${ITEM_KINDS.map((k) => `${k}${ITEM_KIND_LABELS[k]}`).join('/')})`

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
  /**
   * **源 TS 文件（可多个）**。一张表的数据可能横跨多份文件——典型是 `anomalies`：
   * `ANOMALIES` 在 `anomalies.ts`，但它摊进了 5 张 `wh-*` 洞内敌卡（住 `wormholeFoes.ts`）
   * ⇒ 导入端要**逐个文件收集对象块**才能回写（2026-09-15 修：旧版单文件 ⇒ 敌情表整表导不回去）。
   */
  files: readonly string[]
  idProp: 'id' | 'key'
  cols: readonly ColSpec[]
}

const col = (
  head: string,
  p: string,
  k: ColSpec['k'],
  extra: Partial<ColSpec> = {},
): ColSpec => ({ head, p, k, ...extra })

/**
 * **旧表头 → 现行表头**（2026-09-15 加）。用途：`content:import` 读到的文件若是**改名之前**导出的
 * （表头里还写着「矿石 / 矿物 / ISK」），先按本表归一化再匹配列 —— 免得那几列被判成"未知表头"而**静默不回写**。
 * 只在真的用到时打印一句提示，引导重新 export。
 */
export const HEAD_ALIASES: Readonly<Record<string, string>> = {
  'kind(ore矿石/mineral矿物/gas气体/ice冰矿/ammo弹药/drone无人机)': ITEM_KIND_HEAD,
  'kind(ore原矿/mineral原材料/gas气体/ice冰矿/ammo弹药/drone无人机)': ITEM_KIND_HEAD,
  空间站收购价ISK: '空间站收购价信用点',
  '空间站售价ISK(0=自带/仅制造)': '空间站售价信用点(0=自带/仅制造)',
  奖励ISK: '奖励信用点',
}

/** 把（可能是改名前的）表头归一到现行写法；未登记的原样返回 */
export const normalizeHead = (head: string): string => HEAD_ALIASES[head.trim()] ?? head.trim()

export const TABLES: readonly TableSpec[] = [
  {
    name: 'skills',
    files: ['packages/data/src/skills.ts'],
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('组', 'group', 'str'),
      col('rank(难度系数)', 'rank', 'num', { min: 1, int: true }),
      col('描述(高亮数值段须与引擎接线一致，改动后需人工复核)', 'description', 'str'),
    ],
  },
  {
    name: 'items',
    files: ['packages/data/src/items.ts'],
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      // ⚠ 枚举与表头**一律从引擎单点 `ITEM_KIND_LABELS` 派生**（2026-09-15 修：此处曾手写 7 类，
      //   而引擎有 12 类 ⇒ 洞内新增的 `container` / `matter` / `aicore` / `wreck` / `fragment`
      //   在导出件里成了"非法枚举"⇒ **items 表整个导不回去**（实测 dry-run 直接校验不过）。
      col(ITEM_KIND_HEAD, 'kind', 'enum', { vals: ITEM_KINDS }),
      col('单位体积m3', 'unitM3', 'num', { min: 0.0001 }),
      col('空间站收购价信用点', 'baseSellPriceIsk', 'num', { min: 0 }),
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
      col('修理恢复repairRestore(0~1)', 'repairRestore', 'num', { min: 0, max: 100 }),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'modules',
    files: ['packages/data/src/modules.ts'],
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      // ⚠ **表头文字 = 两端契约**（`content:import` 按表头匹配列，见 content-import.ts 的 known 集合），
      //   故表头与 `vals` **一起由引擎单点派生**：2026-09-12 修卡关 ②——此处曾**手写 12 个槽位**，
      //   而引擎 `ModuleSlot` 有 **15** 个（缺 `cpu` / `drone-relay` / `target-lock`）⇒
      //   `content:import modules` 对那 10 行报「非法枚举」并**整表拒绝写入**（一个字都回不去）。
      //   ⚠ 表头文字本次有变（改为引擎官方中文名）⇒ 旧 CSV/xlsx 的该列表头会失配（导入会提示
      //   「忽略未知表头列」）——**改完请先 `npm run content:export` 重新生成文件再导入**。
      col(
        `家族slot(${MODULE_SLOTS.map((s) => `${s}${SLOT_LABELS[s]}`).join('/')})`,
        'slot',
        'enum',
        { vals: MODULE_SLOTS },
      ),
      col('物理槽rack(high/mid/low)', 'rack', 'enum', { vals: RACK_SLOTS }),
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
      col('无人机甲板扩容m3', 'droneBayBonusM3', 'num', { min: 0 }),
      col('无人机伤害加成droneDmgBonus', 'droneDmgBonus', 'num', { min: 0, max: 5 }),
      col('按系伤害加成动能damageTypeBonusPct.kinetic', 'damageTypeBonusPct.kinetic', 'obj', { min: 0, max: 5 }),
      col('按系伤害加成高爆damageTypeBonusPct.explosive', 'damageTypeBonusPct.explosive', 'obj', { min: 0, max: 5 }),
      col('按系伤害加成功量damageTypeBonusPct.plasma', 'damageTypeBonusPct.plasma', 'obj', { min: 0, max: 5 }),
      col('射速缩短reloadCutPct(0.05=装填÷1.05)', 'reloadCutPct', 'num', { min: 0, max: 5 }),
      col('命中提升hitBonusPct(0.08=命中×1.08)', 'hitBonusPct', 'num', { min: 0, max: 5 }),
      col('闪避缺口削减evasionGapPct(0.1=被命中×0.9)', 'evasionGapPct', 'num', { min: 0, max: 5 }),
      // 2026-09-14 跃迁计算机（低槽支援件；只缩短星系际航行时间，多装递减）
      col('跃迁速度加成warpSpeedBonusPct(0.2=+20%；多装递减)', 'warpSpeedBonusPct', 'num', { min: 0, max: 2 }),
      /* ══ 2026-09-13 补全（船长「输出到 excel 给我审阅」）══
       * 此前本表**漏了 9 类已在用的模块字段**（结构容量/结构抗性/锁定加深/CPU 扩容/防空/备弹/
       * 机动代价/修复系/无人机中继射程）⇒ 虫洞专属装备里近一半加成在审阅表上**看不见**。
       * 表头文字 = 两端契约，故 `content:import` 端同步认得这些列（老文件请先重新 export）。 */
      col('结构容量加成hullHpBonus(0.6=+60%)', 'hullHpBonus', 'num', { min: 0, max: 2 }),
      col('结构抗性动能hullResistAdd.kinetic', 'hullResistAdd.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('结构抗性高爆hullResistAdd.explosive', 'hullResistAdd.explosive', 'obj', { min: 0, max: 0.9 }),
      col('结构抗性能量hullResistAdd.plasma', 'hullResistAdd.plasma', 'obj', { min: 0, max: 0.9 }),
      col('锁定加深lockDmgBonus(0.08=被锁目标受击×1.08)', 'lockDmgBonus', 'num', { min: 0, max: 2 }),
      col('CPU扩容cpuBonus(协处理器：+45=装配上限+45)', 'cpuBonus', 'num', { min: 0, max: 500, int: true }),
      col('防空antiDrone(能打机群+对机群伤害×本值)', 'antiDrone', 'num', { min: 0, max: 10 }),
      col('每战备弹ammoPerEngagement(展示用)', 'ammoPerEngagement', 'num', { min: 0, int: true }),
      col('机动代价speedPenaltyPct(装甲件；0.25=速度×0.75)', 'speedPenaltyPct', 'num', { min: 0, max: 0.9 }),
      col('修复装甲/脉冲repairArmorHp', 'repairArmorHp', 'num', { min: 0, max: 100 }),
      col('修复结构/脉冲repairHullHp', 'repairHullHp', 'num', { min: 0, max: 100 }),
      col('修复脉冲间隔ms', 'repairIntervalMs', 'num', { min: 2000, max: 60000, int: true }),
      col('修复消耗组件(repairkit-civ/mil)', 'repairKit', 'str'),
      col('无消耗自愈repairFree(是/空)', 'repairFree', 'bool'),
      col('无人机射程加成droneRangeBonusPct(中继天线)', 'droneRangeBonusPct', 'num', { min: 0, max: 2 }),
      col('未上线闸门unreleased(是=施工期对玩家不可见；勿手改)', 'unreleased', 'bool'),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'ships',
    files: ['packages/data/src/ships.ts'],
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('档次tier(1~5)', 'tier', 'num', { min: 1, max: 5, int: true }), // 2026-09-09 舰船尺寸分级：新增旗舰 T5（皇带鱼级）
      col('角色role(industrial工业/armed武装/armored重装/hauler航运)', 'role', 'enum', {
        vals: ['industrial', 'armed', 'armored', 'hauler'],
      }),
      col('货舱m3', 'cargoM3', 'num', { min: 1 }),
      col('采集循环s', 'cycleSeconds', 'num', { min: 1 }),
      col('每循环产量', 'oreUnitsPerCycle', 'num', { min: 0.0001 }),
      col('空间站售价信用点(0=自带/仅制造)', 'priceIsk', 'num', { min: 0 }),
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
      /* ══ 2026-09-13 补全（船长「输出到 excel 给我审阅」）══ 此前漏了这 5 项：
       * 命中加成 / 船体武器族加成三系 / 船体无人机加成 / 未上线闸门 —— 虫洞专属舰船正靠它们立族签名。 */
      col('命中加成hitBonus(0~0.5)', 'hitBonus', 'num', { min: 0, max: 0.5 }),
      col('船体武器族加成功能weaponFamilyBonus.kinetic', 'weaponFamilyBonus.kinetic', 'obj', { min: 0, max: 1 }),
      col('船体武器族加成高爆weaponFamilyBonus.explosive', 'weaponFamilyBonus.explosive', 'obj', { min: 0, max: 1 }),
      col('船体武器族加成功量weaponFamilyBonus.plasma', 'weaponFamilyBonus.plasma', 'obj', { min: 0, max: 1 }),
      col('船体无人机加成droneDmgBonus(只喂放飞无人机)', 'droneDmgBonus', 'num', { min: 0, max: 1 }),
      col('未上线闸门unreleased(是=施工期对玩家不可见；勿手改)', 'unreleased', 'bool'),
      col('CPU总量', 'cpu', 'num', { min: 0 }),
      col('高槽数', 'slots.high', 'obj', { min: 0, int: true }),
      col('中槽数', 'slots.mid', 'obj', { min: 0, int: true }),
      col('低槽数', 'slots.low', 'obj', { min: 0, int: true }),
      col('无人机舱m3', 'droneBayM3', 'num', { min: 0 }),
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
    files: ['packages/data/src/anomalies.ts', 'packages/data/src/wormholeFoes.ts'],
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
      col('奖励信用点', 'rewardIsk', 'num', { min: 0, int: true }),
      col('战利品(itemId×单位数|…)', 'loot', 'list', { itemKey: 'itemId', valKey: 'units', valMin: 1, valInt: true, ref: 'items' }),
      col('交火展示时长s', 'combatSeconds', 'num', { min: 1, int: true }),
      col('僚机数escorts(0~2)', 'escorts', 'num', { min: 0, max: 2, int: true }),
      col('伤害权重·动能', 'dmgMix.kinetic', 'obj', { min: 0, max: 100 }),
      col('伤害权重·高爆', 'dmgMix.explosive', 'obj', { min: 0, max: 100 }),
      col('伤害权重·能量', 'dmgMix.plasma', 'obj', { min: 0, max: 100 }),
      col('敌速m/sfoeSpeedMps(空=按体积缺省)', 'foeSpeedMps', 'num', { min: 1 }),
      // ══ 战斗调参列（2026-09-10 船长「将所有敌人输出成表格，我进行审核和调整吧」）══
      col('敌族foeFamily(A~G；F 已废弃=空置字母位（2026-09-11 并入 A 族）；每张敌军卡必须显式登记)', 'foeFamily', 'enum', { vals: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }),
      col('总血foeHpOverride(空=按威胁曲线)', 'foeHpOverride', 'num', { min: 1 }),
      col('命中覆写foeHitRate(只对动能/爆炸；空=0.85)', 'foeHitRate', 'num', { min: 0, max: 1 }),
      col('基础单发直写foeShotDmg(空=按推导；写了短路威胁链)', 'foeShotDmg', 'num', { min: 1 }),
      col('远端衰减foeFalloff(空=0.3；能量=威力衰减、值越大越轻)', 'foeFalloff', 'num', { min: 0, max: 1 }),
      col('近盲带伤害blindDmgMul(空=0.3)', 'blindDmgMul', 'num', { min: 0, max: 1 }),
      col('隐藏模板hidden(低安遭遇用，非悬赏)', 'hidden', 'bool'),
      col('描述', 'description', 'str'),
    ],
  },
  {
    name: 'belts',
    files: ['packages/data/src/belts.ts'],
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
    files: ['packages/data/src/marketCatalog.ts'],
    idProp: 'key',
    cols: [
      col('key(=refId；与其它表id对应)', 'key', 'id'),
      col('kind(item物品/module装备/ship舰船/blueprint蓝图/aicore核心)', 'kind', 'enum', {
        vals: ['item', 'module', 'ship', 'blueprint', 'aicore'],
      }),
      col('rarity(common常驻/rare稀有/exotic限定)', 'rarity', 'enum', { vals: ['common', 'rare', 'exotic'] }),
      col('基准价basePrice(池商品=均衡价；单件=供应价)', 'basePrice', 'num', { min: 0.0001 }),
      col('常驻·目标库存poolTarget', 'poolTarget', 'num', { min: 0, int: true }),
      col('常驻·供应流量supplyFlow', 'supplyFlow', 'num', { min: 0 }),
      col('稀有/限定·供应倍数supplyMultiplier', 'supplyMultiplier', 'num', { min: 0 }),
      col('收购档位demandMultiplier（2026-09-08：单件 common 0.6/rare 0.65/exotic 1.0，池商品留空=原料平价、池耗材 0.6）', 'demandMultiplier', 'num', { min: 0 }),
      col('可否卖出playerSellable(空=默认可)', 'playerSellable', 'bool'),
      col('可否买入playerBuyable(空=默认可)', 'playerBuyable', 'bool'),
      col('声望要求standingReq', 'standingReq', 'num', { min: 0, int: true }),
    ],
  },
  /**
   * **敌舰级表**（**2026-09-24 船长令**：「**同步数据我，我直接修改 excel 表来调整敌人**」）——
   * 让敌舰数值也进内容工作台的"导出 → 船长在 Excel 里改 → `content:import` 回写"回路，
   * 口径与其余 7 张表完全一致（主键只读 · 逐列校验 · 空单元格 = 不改该字段 · 可选字段填 `-` = 删除）。
   *
   * 列 = **舰级裸值**（`FoeShipDef` 里可手调的字段）；**派生量与卡级覆写不在此表**：
   * 三层血（= 总血 × 占比）、名义 DPS、实速（= 舰种基准 × 倍率）都是算出来的，
   * 卡上条目级 `hpMul`/`dmgMul`/`rangeMul` 是每卡实算 ⇒ 看 `foe-csv/enemy-ships.xlsx`（56 列明细表）
   * 与 `npm run bounty:stats`。
   *
   * ⚠ **v1 不含 `mounts`（挂载件 id 列表）与 `drones`（机群）**——它们是结构字段（字符串列表 / 对象列表），
   * 要新增两种列类型才能回写；本批先交"数值可调"的部分，需要时再扩（在那之前挂载件仍走代码改动）。
   */
  {
    name: 'foeShips',
    files: ['packages/data/src/foe-ships.ts'],
    idProp: 'id',
    cols: [
      col('id', 'id', 'id'),
      col('名称', 'name', 'str'),
      col('敌族family(A/B/C/D/E/F/G)', 'family', 'enum', { vals: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }),
      col('舰种档hullClassTier(1护卫/2驱逐/3巡洋/4战列/5旗舰)', 'hullClassTier', 'num', { min: 1, max: 5, int: true }),
      col('精锐elite(是=显示名加「精锐」前缀)', 'elite', 'bool'),
      col('战术tactic(brawl贴身/orbit环绕/kite风筝)', 'tactic', 'enum', { vals: ['brawl', 'orbit', 'kite'] }),
      col('总血hp(绝对值)', 'hp', 'num', { min: 1 }),
      col('结构占比split.s', 'split.s', 'obj', { min: 0, max: 1 }),
      col('装甲占比split.a', 'split.a', 'obj', { min: 0, max: 1 }),
      col('护盾占比split.h', 'split.h', 'obj', { min: 0, max: 1 }),
      col('盾抗动能shieldResist.kinetic', 'shieldResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('盾抗高爆shieldResist.explosive', 'shieldResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('盾抗能量shieldResist.plasma', 'shieldResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('甲抗动能armorResist.kinetic', 'armorResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('甲抗高爆armorResist.explosive', 'armorResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('甲抗能量armorResist.plasma', 'armorResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('结构抗动能hullResist.kinetic', 'hullResist.kinetic', 'obj', { min: 0, max: 0.9 }),
      col('结构抗高爆hullResist.explosive', 'hullResist.explosive', 'obj', { min: 0, max: 0.9 }),
      col('结构抗能量hullResist.plasma', 'hullResist.plasma', 'obj', { min: 0, max: 0.9 }),
      col('单发shotDmg(绝对值)', 'shotDmg', 'num', { min: 0 }),
      col('装填毫秒reloadMs', 'reloadMs', 'num', { min: 1, int: true }),
      col('命中率hitRate(0~1；光束必中时不消费)', 'hitRate', 'num', { min: 0, max: 1 }),
      col('射程下限rangeMinM', 'rangeMinM', 'num', { min: 0 }),
      col('射程上限rangeMaxM', 'rangeMaxM', 'num', { min: 0 }),
      col('期望交距覆写desireRangeM(留空=按战术推导)', 'desireRangeM', 'num', { min: 0 }),
      col('远端衰减falloff(光束=威力衰减；其余=命中衰减)', 'falloff', 'num', { min: 0, max: 1 }),
      col('近盲倍率blindDmgMul(玩家进敌近盲带时敌伤害×本值)', 'blindDmgMul', 'num', { min: 0, max: 1 }),
      col('伤害构成·动能dmgMix.kinetic(相对权重)', 'dmgMix.kinetic', 'obj', { min: 0, max: 10 }),
      col('伤害构成·高爆dmgMix.explosive(相对权重)', 'dmgMix.explosive', 'obj', { min: 0, max: 10 }),
      col('伤害构成·能量dmgMix.plasma(相对权重)', 'dmgMix.plasma', 'obj', { min: 0, max: 10 }),
      col('能量形态energyForm(beam光束必中/spit掷命中)', 'energyForm', 'enum', { vals: ['beam', 'spit'] }),
      col('后勤修理repairPct(留空=无)', 'repairPct', 'num', { min: 0, max: 1 }),
      col('闪避evasion(0~0.9；留空=0.12)', 'evasion', 'num', { min: 0, max: 0.9 }),
      col('速度倍率speedRatio(实速=舰种基准×本值后取整)', 'speedRatio', 'num', { min: 0, max: 3 }),
      col('冲锋资格foeCanCharge(旧字段；新写法走挂载件)', 'foeCanCharge', 'bool'),
      col('冲锋倍率foeChargeMul(旧字段)', 'foeChargeMul', 'num', { min: 0, max: 5 }),
    ],
  },
]

export function tableOf(name: string): TableSpec | undefined {
  return TABLES.find((t) => t.name === name)
}
