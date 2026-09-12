/**
 * 舰船表（M1 + V10 + V10.5 + V10.5b + V18 无人机舱大改 + 2026-09-09 尺寸分级重构：25 艘）。
 *
 * 世界观（2026-09-09 船长定）：全部舰船出自「深空工业协会」官方派系下的分支部门——
 * 鲸盟（采矿）/ 掠食者（武装，含无人机）/ 甲壳（重装）/ 蜃楼（航运）；造船统归协会，海鲜命名统一。
 * 尺寸分级（船长 2026-09-09 定）：大分类 = 护卫 T1 / 驱逐 T2 / 巡洋 T3 / 主力 T4 / 旗舰 T5，
 * 由等效质量落档（等效质量 = massKg×(armored?0.65:1)；区间 0.4~2.4M / 2.4~5.8M / 5.8~13M /
 * 13~29M / ≥29M）；船名内旧规格词（武装艇/护卫舰/驱逐舰/炮舰/巡舰/母舰/艇…）= 子分类称号；
 * 稀有度同尺寸型内上调不改档（如大白鲨 = T2 驱逐·炮舰型·奇货精装）；武装巡洋级内容 = 奇货渠道。
 *
 * 数值设计（中文说明）：
 * - 鲸盟采矿线（industrial）：沙猫（白送）→ 掘洞 → 鲸吞 → 开拓/鲸王 → 座头鲸（图纸制造/稀有现货）；
 *   全采矿艇（2026-09-09 船长定：大型货舰蝠鲼/皇带鱼从工业线分出，改归航运族、型号不再用鲸名防误导）
 * - 掠食者武装线（armed）：盾厚炮强（护盾层血量与火力最高），机动高、锁定强、有无人机舱；
 *   V18 无人机舱大改：梭鱼级/王鲭级（armed）＝无人机平台延伸——大机舱 + 高槽多为甲板扩展/导控阵列位；
 *   2026-09-09 巡洋舰线：长尾鲨（导弹）/ 电鳐（激光）/ 锤头鲨（炮击）/ 牛鲨（突击），全 T3·奇货
 * - 甲壳重装线（armored）：装甲/结构最厚 + 装甲层高抗（全系），离线长作业 + 未来坦克位
 * - 蜃楼航运线（hauler）：特大货舱 + 高结构量，壳大皮薄、无战斗无人机舱；
 *   2026-09-09 起含鲸盟制造的两艘超大型货舰（蝠鲼级/皇带鱼级：护盾抗动能同鲸盟）
 * - V10.5：shieldHp/armorHp/hullHp = roleBase × tierScale（t1×1.0/t2×1.8/t3×2.9/t4×4.2，取整）
 * - V16.1：基础抗性简化（整数主抗制）——每族只有一个主抗，便于心算：
 *   鲸盟(industrial)＝护盾抗动能 25%｜掠食者(armed)＝护盾抗动能 50%｜甲壳(armored)＝装甲抗高爆 50%｜
 *   蜃楼(hauler)＝结构抗能量 25%；其余层/型一律 0（省略键）；装备抗性插件仍可在此基础上叠加；
 *   （鲸盟出品的蝠鲼/皇带鱼沿用鲸盟护盾抗动能，不随航运族改结构抗）
 * - V16.1：删除已废弃展示字段（锁定目标数 maxTargets、起跳时间 alignSec——起跳语义反转由
 *   "跃迁充能"派生属性取代：跃迁充能速率 = 动力(agility)×200%，动力越高充能越快，仅展示挂钩）；
 * - V10.5b：cpu = 模块装配与无人机放飞共用资源（带宽并入 CPU）；无人机舱 droneBayM3；
 *   间接属性（速度/跃迁/质量/锁定/信号）为 EVE 参考值——显示优先级低（仅装配界面），
 *   数值为按族×tier 的直觉占位，战斗作用与校准留战斗系统阶段（本表数值皆为占位契约）。
 */

import type { ShipDef } from '@whale/core'

export const SHIPS: readonly ShipDef[] = [
  // ══════════ 鲸盟采矿线（薄盾薄甲结构凑合：只负责挖矿；段尾蝠鲼/皇带鱼 = 鲸盟出品的航运货舰，
  //  2026-09-09 船长定归 hauler 族——见各自 role 注） ══════════
  {
    id: 'sandcat',
    name: '沙猫级采矿艇',
    role: 'industrial',
    slots: { high: 2, mid: 1, low: 1 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 1,
    cargoM3: 800,
    cycleSeconds: 12,
    oreUnitsPerCycle: 10,
    priceIsk: 0,
    agility: 0.6,
    evasion: 0.1,
    hitBonus: 0.1,
    shieldHp: 18,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 15,
    hullHp: 36,
    cpu: 60,
    droneBayM3: 0,
    maxSpeedMps: 300,
    warpSpeedAus: 3.5,
    massKg: 1_200_000,
    lockRangeM: 18_000,
    signatureM: 42,
    scanResMm: 620,
    description: '新手标配矿船：基础货舱 + 单管采集器。你的第一艘船，也是你唯一的船（暂时）。',
  },
  {
    id: 'burrower',
    name: '掘洞级采矿艇',
    role: 'industrial',
    slots: { high: 2, mid: 2, low: 1 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 1,
    cargoM3: 1800,
    cycleSeconds: 11,
    oreUnitsPerCycle: 18,
    priceIsk: 120_000,
    agility: 0.5,
    evasion: 0.1,
    hitBonus: 0.1,
    shieldHp: 33,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 27,
    hullHp: 66,
    cpu: 90,
    droneBayM3: 0,
    maxSpeedMps: 280,
    warpSpeedAus: 3.4,
    massKg: 2_200_000,
    lockRangeM: 19_000,
    signatureM: 55,
    scanResMm: 560,
    description: '更大的货舱与双管采集器，采矿效率接近翻倍，新手村毕业的标志。',
  },
  {
    id: 'whale',
    name: '鲸吞级采矿艇',
    role: 'industrial',
    slots: { high: 2, mid: 2, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 4500,
    cycleSeconds: 10,
    oreUnitsPerCycle: 34,
    priceIsk: 900_000,
    agility: 0.35,
    evasion: 0.1,
    hitBonus: 0.1,
    shieldHp: 51,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 45,
    hullHp: 105,
    cpu: 130,
    droneBayM3: 0,
    maxSpeedMps: 240,
    warpSpeedAus: 3.2,
    massKg: 5_000_000,
    lockRangeM: 20_000,
    signatureM: 90,
    scanResMm: 480,
    description: '深空工业巨兽：四管采集器一次啃掉半块小行星。鲸吞之名，名副其实。',
  },
  {
    id: 'pioneer',
    name: '开拓级采矿艇',
    role: 'industrial',
    slots: { high: 3, mid: 2, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 5200,
    cycleSeconds: 9,
    oreUnitsPerCycle: 38,
    priceIsk: 0, // 商店买不到：只能靠舰船蓝图制造
    agility: 0.4,
    evasion: 0.15,
    hitBonus: 0.1,
    shieldHp: 54,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 48,
    hullHp: 108,
    cpu: 150,
    droneBayM3: 0,
    maxSpeedMps: 250,
    warpSpeedAus: 3.5,
    massKg: 5_500_000,
    lockRangeM: 20_000,
    signatureM: 95,
    scanResMm: 470,
    description: '协会造船厂的定制艇：不对外出售，用矿物在自家船台上敲出来。比鲸吞级再快一档。',
  },
  {
    id: 'whale-king',
    name: '鲸王级采矿艇',
    role: 'industrial',
    slots: { high: 3, mid: 3, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 7_000,
    cycleSeconds: 8,
    oreUnitsPerCycle: 58,
    priceIsk: 0, // 商店买不到：只能靠舰船蓝图制造
    agility: 0.25,
    evasion: 0.15,
    hitBonus: 0.12,
    shieldHp: 75,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 63,
    hullHp: 150,
    cpu: 190,
    droneBayM3: 0,
    maxSpeedMps: 210,
    warpSpeedAus: 2.8,
    massKg: 12_000_000,
    lockRangeM: 21_000,
    signatureM: 140,
    scanResMm: 400,
    description: '深空工业的顶点：双倍于鲸吞级的产能。超噬矿吞金兽，全游戏最长远的攒料目标。',
  },
  {
    id: 'sh-humpback',
    name: '座头鲸级矿舰',
    role: 'industrial',
    slots: { high: 3, mid: 2, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 19_000,
    cycleSeconds: 30,
    oreUnitsPerCycle: 140,
    priceIsk: 1_350_000,
    agility: 0.3,
    evasion: 0,
    hitBonus: 0.1,
    shieldHp: 51,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 145,
    hullHp: 210,
    cpu: 140,
    droneBayM3: 0,
    maxSpeedMps: 230,
    warpSpeedAus: 3.5,
    massKg: 9_000_000,
    lockRangeM: 21_000,
    signatureM: 120,
    scanResMm: 430,
    description: '鲸盟第三代量产矿舰：拥有货舰级的货舱，产量再上一档（稀有现货或蓝图自造）。',
  },
  {
    id: 'sh-bowhead',
    name: '蝠鲼级重载货舰',
    role: 'hauler', // 2026-09-09 船长定：货舰与矿船分族（原归 industrial 名称易误导），鲸盟制造、航运编列
    slots: { high: 3, mid: 2, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 4,
    cargoM3: 26_000,
    cycleSeconds: 36,
    oreUnitsPerCycle: 110,
    priceIsk: 1_900_000,
    agility: 0.28,
    evasion: 0,
    hitBonus: 0.1,
    shieldHp: 45,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 139,
    hullHp: 228, // 货舰：结构占比略高
    cpu: 160,
    droneBayM3: 0,
    maxSpeedMps: 180,
    warpSpeedAus: 3.5,
    massKg: 18_000_000,
    lockRangeM: 22_000,
    signatureM: 190,
    scanResMm: 360,
    description: '鲸盟总装的重载货舰：超两万六立方货舱，离线囤货与长途运输的中坚。',
  },
  {
    id: 'sh-colossal',
    name: '皇带鱼级旗舰货舰',
    role: 'hauler', // 2026-09-09 船长定：货舰与矿船分族（原归 industrial 名称易误导），鲸盟制造、航运编列
    slots: { high: 2, mid: 3, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 5,
    cargoM3: 36_000,
    cycleSeconds: 33,
    oreUnitsPerCycle: 129,
    priceIsk: 0, // 仅制造（蓝图为限定奇货）
    agility: 0.22,
    evasion: 0,
    hitBonus: 0.12,
    shieldHp: 72,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 160,
    hullHp: 354, // 旗舰大壳
    cpu: 230,
    droneBayM3: 0,
    maxSpeedMps: 160,
    warpSpeedAus: 2.8,
    massKg: 30_000_000,
    lockRangeM: 23_000,
    signatureM: 260,
    scanResMm: 320,
    description: '鲸盟总装的旗舰货舰：三万六千立方货舱，深空物流的移动要塞（仅可制造）。',
  },

  // ══════════ 掠食者武装线（盾厚炮强；带无人机舱；锁定强） ══════════
  {
    id: 'sh-falconet',
    name: '鲣鱼级护卫舰', // 2026-09-09 海鲜命名统一:原名 隼枭级武装艇
    role: 'armed',
    slots: { high: 3, mid: 2, low: 1 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 1,
    cargoM3: 650,
    cycleSeconds: 16,
    oreUnitsPerCycle: 6,
    priceIsk: 42_000,
    agility: 0.8,
    evasion: 0.2,
    hitBonus: 0.12,
    powerBonus: 0.15,
    shieldHp: 60,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 30,
    hullHp: 36,
    cpu: 110,
    droneBayM3: 0,
    maxSpeedMps: 360,
    warpSpeedAus: 3.9,
    massKg: 900_000,
    lockRangeM: 30_000,
    signatureM: 40,
    scanResMm: 680,
    description: '协会训练武装艇：不擅长挖矿，但动力惊人——当前就能当低风险远征的轻快座驾。',
  },
  {
    id: 'sh-shrike',
    name: '马鲛级护卫舰', // 2026-09-09 海鲜命名统一:原名 伯劳级武装护卫舰
    role: 'armed',
    slots: { high: 3, mid: 2, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 1,
    cargoM3: 1050,
    cycleSeconds: 15,
    oreUnitsPerCycle: 8,
    priceIsk: 110_000,
    agility: 0.74,
    evasion: 0.14,
    hitBonus: 0.14,
    powerBonus: 0.25,
    shieldHp: 108,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 54,
    hullHp: 66,
    cpu: 150,
    droneBayM3: 10,
    maxSpeedMps: 340,
    warpSpeedAus: 3.8,
    massKg: 1_400_000,
    lockRangeM: 32_000,
    signatureM: 48,
    scanResMm: 650,
    description: '掠食者武装部门的制式护卫舰：高机动低产量，护送 AI 副船行动的好手。',
  },
  {
    id: 'sh-tigershark',
    name: '虎鲨级武装护卫舰',
    role: 'armed',
    slots: { high: 4, mid: 2, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 1,
    cargoM3: 1500,
    cycleSeconds: 14,
    oreUnitsPerCycle: 11,
    priceIsk: 240_000,
    agility: 0.68,
    evasion: 0.15,
    hitBonus: 0.15,
    powerBonus: 0.3,
    shieldHp: 114,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 57,
    hullHp: 72,
    cpu: 165,
    droneBayM3: 10,
    maxSpeedMps: 320,
    warpSpeedAus: 3.7,
    massKg: 1_900_000,
    lockRangeM: 33_000,
    signatureM: 56,
    scanResMm: 620,
    description: '更厚重的武装护卫舰：火力骨架更强，深空护航的常客。',
  },
  {
    id: 'sh-mako',
    name: '灰鲭鲨级驱逐舰',
    role: 'armed',
    slots: { high: 4, mid: 3, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 2300,
    cycleSeconds: 13,
    oreUnitsPerCycle: 15,
    priceIsk: 480_000,
    agility: 0.62,
    evasion: 0.1,
    hitBonus: 0.17,
    powerBonus: 0.45,
    shieldHp: 174,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 87,
    hullHp: 105,
    cpu: 195,
    droneBayM3: 30,
    maxSpeedMps: 300,
    warpSpeedAus: 3.6,
    massKg: 3_600_000,
    lockRangeM: 36_000,
    signatureM: 75,
    scanResMm: 560,
    description: '大型驱逐舰：协会武装力量的中坚船型，静待战斗系统为其装上獠牙。',
  },
  {
    id: 'sh-whiteshark',
    name: '大白鲨级炮舰',
    role: 'armed',
    slots: { high: 5, mid: 3, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 3200,
    cycleSeconds: 13,
    oreUnitsPerCycle: 18,
    priceIsk: 1_100_000,
    agility: 0.56,
    evasion: 0.1,
    hitBonus: 0.2,
    powerBonus: 0.6,
    shieldHp: 186,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 96,
    hullHp: 114,
    cpu: 225,
    droneBayM3: 20,
    maxSpeedMps: 285,
    warpSpeedAus: 3.5,
    massKg: 4_500_000,
    lockRangeM: 38_000,
    signatureM: 88,
    scanResMm: 520,
    description: '顶级武装炮舰：市场限量现货，声誉与实力的双重象征（限定奇货）。',
  },

  // ══════════ 无人机平台延伸（掠食者同系：大机舱 + 高槽多为甲板扩展/导控阵列位） ══════════
  {
    id: 'sh-swarm',
    name: '梭鱼级无人机护卫', // 2026-09-09 海鲜命名统一:原名 蜂群级无人机护卫
    role: 'armed',
    slots: { high: 3, mid: 3, low: 2 }, // V18 槽位布局；2026-09-10 船长：无人机专用舰高槽 −2（5→3）
    tier: 2,
    cargoM3: 2600,
    cycleSeconds: 13,
    oreUnitsPerCycle: 16,
    priceIsk: 620_000,
    agility: 0.6,
    evasion: 0.12,
    hitBonus: 0.16,
    powerBonus: 0.25, // 2026-09-10 船长：无人机舰火力加成削弱（0.45→0.25）——该笔加成只喂炮台
    droneDmgBonus: 0.08, // 2026-09-10 船长：改为无人机专属加成 +8%（T2 档，对称于巡洋舰族加成）
    shieldHp: 180,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 90,
    hullHp: 108,
    cpu: 235,
    droneBayM3: 160,
    maxSpeedMps: 295,
    warpSpeedAus: 3.5,
    massKg: 4_000_000,
    lockRangeM: 35_000,
    signatureM: 92,
    scanResMm: 540,
    description: '掠食者武装部门的无人机护卫：大型机巢加身，放飞机群替火力不够的炮位撑腰。',
  },
  {
    id: 'sh-sentinel',
    name: '王鲭级无人机母舰', // 2026-09-09 海鲜命名统一:原名 哨兵级无人机母舰
    role: 'armed',
    slots: { high: 4, mid: 2, low: 2 }, // V18 槽位布局；2026-09-10 船长：无人机专用舰高槽 −2（6→4）
    tier: 3,
    cargoM3: 3600,
    cycleSeconds: 13,
    oreUnitsPerCycle: 15,
    priceIsk: 2_600_000,
    agility: 0.52,
    evasion: 0.08,
    hitBonus: 0.16,
    powerBonus: 0.3, // 2026-09-10 船长：无人机母舰火力加成削弱（0.6→0.3）——原来与长尾鲨同级，但只喂炮台
    droneDmgBonus: 0.12, // 2026-09-10 船长：改为无人机专属加成 +12%（与其它巡洋舰的族加成同档）
    shieldHp: 310,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 155,
    hullHp: 187,
    cpu: 320,
    droneBayM3: 320,
    maxSpeedMps: 275,
    warpSpeedAus: 3.3,
    massKg: 6_500_000,
    lockRangeM: 38_000,
    signatureM: 110,
    scanResMm: 500,
    description: '掠食者武装部门定制的无人机母舰：翻倍的机巢与充裕的装配位，无人机战力的巅峰载体（限定奇货）。',
  },

  // ══════════ 掠食者巡洋舰线（2026-09-09 尺寸分级：T3 巡洋,等效质量 5.8~13M；主力级以上本批不入场） ══════════
  {
    id: 'sh-thresher',
    name: '长尾鲨级导弹巡洋舰',
    role: 'armed',
    slots: { high: 5, mid: 4, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 2600,
    cycleSeconds: 14,
    oreUnitsPerCycle: 10,
    priceIsk: 9_000_000, // 巡洋价位定档（2026-09-09 船长拍板，战力序 9/11/13/15M）；2026-09-11 对齐市场行（此前只落到市场行）
    agility: 0.54,
    evasion: 0.12,
    hitBonus: 0.17,
    powerBonus: 0.6,
    shieldHp: 325,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 148,
    hullHp: 175,
    cpu: 345,
    droneBayM3: 0,
    maxSpeedMps: 272,
    warpSpeedAus: 3.3,
    massKg: 7_000_000,
    lockRangeM: 41_000,
    signatureM: 96,
    scanResMm: 520,
    weaponFamilyBonus: { explosive: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族爆破导弹 +12%）
    description: '掠食者武装部门的新锐导弹巡洋舰：以长尾为名的远距猎手，齐射导弹先声夺人——舰体为导弹阵列特调，爆破导弹威力额外加成（限定奇货）。',
  },
  {
    id: 'sh-electricray',
    name: '电鳐级激光巡洋舰',
    role: 'armed',
    slots: { high: 5, mid: 3, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 2500,
    cycleSeconds: 14,
    oreUnitsPerCycle: 10,
    priceIsk: 15_000_000, // 巡洋价位定档（2026-09-09 船长拍板，战力序 9/11/13/15M）；2026-09-11 对齐市场行（此前只落到市场行）
    agility: 0.5,
    evasion: 0.1,
    hitBonus: 0.16,
    powerBonus: 0.62,
    shieldHp: 340,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 154,
    hullHp: 181,
    cpu: 355,
    droneBayM3: 0,
    maxSpeedMps: 265,
    warpSpeedAus: 3.2,
    massKg: 7_500_000,
    lockRangeM: 40_000,
    signatureM: 100,
    scanResMm: 510,
    weaponFamilyBonus: { plasma: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族能量激光 +12%）
    description: '掠食者武装部门的光束巡洋舰：高压电弧般的激光炮阵列，接敌即烧穿护盾——舰体光束聚焦阵列特调，能量武器威力额外加成（限定奇货）。',
  },
  {
    id: 'sh-hammerhead',
    name: '锤头鲨级炮击巡洋舰',
    role: 'armed',
    slots: { high: 5, mid: 4, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 2800,
    cycleSeconds: 13,
    oreUnitsPerCycle: 12,
    priceIsk: 11_000_000, // 巡洋价位定档（2026-09-09 船长拍板，战力序 9/11/13/15M）；2026-09-11 对齐市场行（此前只落到市场行）
    agility: 0.5,
    evasion: 0.1,
    hitBonus: 0.18,
    powerBonus: 0.65,
    shieldHp: 355,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 160,
    hullHp: 186,
    cpu: 360,
    droneBayM3: 0,
    maxSpeedMps: 268,
    warpSpeedAus: 3.2,
    massKg: 8_000_000,
    lockRangeM: 39_000,
    signatureM: 105,
    scanResMm: 500,
    weaponFamilyBonus: { kinetic: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族动能炮 +12%）
    description: '掠食者武装部门的炮击主力：重炮动能阵列齐射的中坚，深空讨伐的舰队长矛——舰体动能炮组特调，动能武器威力额外加成（限定奇货）。',
  },
  {
    id: 'sh-bullshark',
    name: '牛鲨级突击巡洋舰',
    role: 'armed',
    slots: { high: 5, mid: 3, low: 4 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 3000,
    cycleSeconds: 13,
    oreUnitsPerCycle: 12,
    priceIsk: 13_000_000, // 巡洋价位定档（2026-09-09 船长拍板，战力序 9/11/13/15M）；2026-09-11 对齐市场行（此前只落到市场行）
    agility: 0.46,
    evasion: 0.08,
    hitBonus: 0.19,
    powerBonus: 0.7,
    shieldHp: 400,
    shieldResist: { kinetic: 0.5 }, // 掠食者：重盾抗动能（整数主抗制）
    armorHp: 163,
    hullHp: 192,
    cpu: 390,
    droneBayM3: 0,
    maxSpeedMps: 258,
    warpSpeedAus: 3.1,
    massKg: 9_000_000,
    lockRangeM: 40_000,
    signatureM: 118,
    scanResMm: 480,
    weaponFamilyBonus: { kinetic: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族动能炮 +12%）
    description: '掠食者武装部门最凶悍的咬合者：厚盾重炮的突击巡洋舰，专为贴脸近战而生——舰体动能炮组特调，动能武器威力额外加成（限定奇货）。',
  },

  // ══════════ 甲壳重装线（装甲/结构最厚 + 装甲层高抗） ══════════
  {
    id: 'sh-tortoise',
    name: '陆龟级重装艇',
    role: 'armored',
    slots: { high: 2, mid: 2, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 7000,
    cycleSeconds: 13,
    oreUnitsPerCycle: 24,
    priceIsk: 330_000,
    agility: 0.5,
    evasion: 0.05,
    hitBonus: 0.05,
    shieldHp: 42,
    armorHp: 129,
    armorResist: { explosive: 0.5 }, // 甲壳：装甲抗高爆（整数主抗制）
    hullHp: 162,
    cpu: 145,
    droneBayM3: 40,
    maxSpeedMps: 200,
    warpSpeedAus: 3.0,
    massKg: 6_000_000,
    lockRangeM: 22_000,
    signatureM: 130,
    scanResMm: 420,
    description: '慢而稳的重甲运输艇：货舱大、皮糙肉厚。',
  },
  {
    id: 'sh-hawksbill',
    name: '玳瑁级重装巡舰',
    role: 'armored',
    slots: { high: 2, mid: 3, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 12000,
    cycleSeconds: 13,
    oreUnitsPerCycle: 22,
    priceIsk: 760_000,
    agility: 0.46,
    evasion: 0.05,
    hitBonus: 0.05,
    shieldHp: 102,
    armorHp: 311,
    armorResist: { explosive: 0.5 }, // 甲壳：装甲抗高爆（整数主抗制）
    hullHp: 386,
    cpu: 185,
    droneBayM3: 50,
    maxSpeedMps: 185,
    warpSpeedAus: 2.9,
    massKg: 11_000_000,
    lockRangeM: 23_000,
    signatureM: 180,
    scanResMm: 370,
    description: '重装巡舰：厚壳加身的移动仓库，离线长时间作业的可靠伙伴。',
  },
  {
    id: 'sh-xuanwu',
    name: '玄武级重装旗舰',
    role: 'armored',
    slots: { high: 3, mid: 4, low: 5 }, // 12 槽（2026-09-12 船长「修正下玄武」：原 2/3/4=9 竟少于 T3 巡洋的 11~12；**守契约上限 12**）
    tier: 4,
    cargoM3: 19000,
    cycleSeconds: 14,
    oreUnitsPerCycle: 26,
    priceIsk: 2_200_000,
    agility: 0.4,
    evasion: 0.05,
    hitBonus: 0.05,
    shieldHp: 166,
    armorHp: 493,
    armorResist: { explosive: 0.5 }, // 甲壳：装甲抗高爆（整数主抗制）
    hullHp: 614,
    cpu: 490,
    droneBayM3: 60,
    maxSpeedMps: 170,
    warpSpeedAus: 2.8,
    massKg: 20_000_000,
    lockRangeM: 24_000,
    signatureM: 250,
    scanResMm: 330,
    description: '重装线的顶点：传闻用整颗小行星的岩壳锻造（限定奇货，需高声望）。',
  },

  // ══════════ T4/T5 主战船「模子」（2026-09-12 船长「T4,T5 可以先立个模子」）══════════════
  // ⚠ **状态 = 壳体/模子**：只登记**舰体**（档位/槽位/CPU/血量按档位口径外推），
  //   **暂不上市场、不接蓝图、不接任何卡** ⇒ `priceIsk` 必须为 **0**（定制船口径，
  //   `content:check`「舰船价格口径」据此判定）。数值**待船长定案**后再决定上架与定价。
  //   外推口径：槽位 T1 7 / T2 9 / T3 11 ⇒ **+2/档（T4 = 13 / T5 = 15）**；CPU T3 = 350 ⇒ **×1.4/档**；
  //   血量 = 档位阶梯（锚 T2 = 372、**×1.85/档** ⇒ **T4 = 1,273 / T5 = 2,355**）；
  //   质量取所在档区间内、与既有邻舰同量级（T4 22M，介于玄武 20M 与皇带鱼 30M 之间；T5 35M）。
  //   背景：玩家侧此前**根本没有 T4/T5 主战船**（T4 只有玄武、T5 只有货舰），而敌人有 T4 泰坦 /
  //   T5 核心舱段 ⇒ 这是"E 段换大船不解决生存"的结构原因之一（2026-09-12 实测）。
  {
    id: 'sh-megalodon',
    name: '巨齿鲨级战列舰',
    role: 'armed',
    slots: { high: 5, mid: 4, low: 3 }, // 12 槽（**守「总槽位 3~12」契约上限**；T4 不能在槽位上再压 T3）
    tier: 4,
    cargoM3: 4000,
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 0, // 模子：未上架（定制船口径）
    agility: 0.35,
    evasion: 0.06,
    hitBonus: 0.06,
    powerBonus: 0.85, // 模子待定（武装舰必填；阶梯 牛鲨 0.7 → T4 0.85）
    shieldHp: 675,
    armorHp: 280,
    hullHp: 318, // 三层共 1,273（T4 档位目标）；武装族定位 = 盾 > 结构 > 甲
    cpu: 490, // T3 350 × 1.4
    droneBayM3: 60,
    maxSpeedMps: 175,
    warpSpeedAus: 2.7,
    massKg: 22_000_000,
    lockRangeM: 26_000,
    signatureM: 300,
    scanResMm: 300,
    description: '战列舰壳体（模子）：正面承伤与火力平台，数值待定案。',
  },
  {
    id: 'sh-dunkleosteus',
    name: '邓氏鱼级旗舰',
    role: 'armed',
    slots: { high: 6, mid: 3, low: 3 }, // 12 槽（同上；T5 的差异落在**高槽更多**＋CPU/血量，不在总槽数）
    tier: 5,
    cargoM3: 4500,
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 0, // 模子：未上架（定制船口径）
    agility: 0.3,
    evasion: 0.05,
    hitBonus: 0.07,
    powerBonus: 1.0, // 模子待定（阶梯续 0.85 → T5 1.0；契约上限 2）
    shieldHp: 1248,
    armorHp: 518,
    hullHp: 589, // 三层共 2,355（T5 档位目标）
    cpu: 690, // T4 490 × 1.4
    droneBayM3: 80,
    maxSpeedMps: 155,
    warpSpeedAus: 2.6,
    massKg: 35_000_000,
    lockRangeM: 28_000,
    signatureM: 350,
    scanResMm: 280,
    description: '旗舰壳体（模子）：舰队的顶点，数值待定案。',
  },

  // ══════════ 蜃楼航运线（壳大皮薄：结构量高、盾甲低） ══════════
  {
    id: 'sh-flyingfish',
    name: '飞鱼级快运舰',
    role: 'hauler',
    slots: { high: 1, mid: 2, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 5000,
    cycleSeconds: 11,
    oreUnitsPerCycle: 20,
    priceIsk: 210_000,
    agility: 0.62,
    evasion: 0.3,
    hitBonus: 0.08,
    shieldHp: 33,
    armorHp: 42,
    hullHp: 120,
    hullResist: { plasma: 0.25 }, // 蜃楼：结构抗能量（整数主抗制）
    cpu: 105,
    droneBayM3: 40,
    maxSpeedMps: 430,
    warpSpeedAus: 7.4,
    massKg: 4_000_000,
    lockRangeM: 24_000,
    signatureM: 95,
    scanResMm: 480,
    description: '快运舰：牺牲了货仓和战斗能力换来的高速跃迁性能，小型囤货流的入门选择。',
  },
  {
    id: 'sh-sailfish',
    name: '旗鱼级高速货舰',
    role: 'hauler',
    slots: { high: 1, mid: 3, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 3,
    cargoM3: 8500,
    cycleSeconds: 11,
    oreUnitsPerCycle: 18,
    priceIsk: 480_000,
    agility: 0.56,
    evasion: 0.3,
    hitBonus: 0.08,
    shieldHp: 51,
    armorHp: 69,
    hullHp: 192,
    hullResist: { plasma: 0.25 }, // 蜃楼：结构抗能量（整数主抗制）
    cpu: 135,
    droneBayM3: 50,
    maxSpeedMps: 415,
    warpSpeedAus: 6.3,
    massKg: 8_000_000,
    lockRangeM: 25_000,
    signatureM: 130,
    scanResMm: 430,
    description: '高速货舰：八千五百立方货舱仍能保持高速跃迁。',
  },
  {
    id: 'sh-swordfish',
    name: '剑鱼级大型货舰',
    role: 'hauler',
    slots: { high: 2, mid: 2, low: 3 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 4,
    cargoM3: 14000,
    cycleSeconds: 12,
    oreUnitsPerCycle: 16,
    priceIsk: 1_250_000,
    agility: 0.5,
    evasion: 0.28,
    hitBonus: 0.08,
    shieldHp: 54,
    armorHp: 72,
    hullHp: 198,
    hullResist: { plasma: 0.25 }, // 蜃楼：结构抗能量（整数主抗制）
    cpu: 175,
    droneBayM3: 60,
    maxSpeedMps: 400,
    warpSpeedAus: 6.2,
    massKg: 13_000_000,
    lockRangeM: 26_000,
    signatureM: 170,
    scanResMm: 390,
    description: '蜃楼航运的旗舰货舰：一万四立方的运力，跑商人的终极梦想（限定奇货）。',
  },
]

/** 构建"舰船 id → 定义"目录 */
export function buildShipCatalog(): ReadonlyMap<string, ShipDef> {
  return new Map(SHIPS.map((ship) => [ship.id, ship]))
}
