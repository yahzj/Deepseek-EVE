/**
 * 舰船表（M1 + V10 + V10.5 + V10.5b + V18 无人机舱大改 + 2026-09-09 尺寸分级重构：25 艘）。
 *
 * 世界观（2026-09-09 船长定）：全部舰船出自「深空工业协会」官方派系下的分支部门——
 * 鲸盟（采矿）/ 掠食者（武装，含无人机）/ 甲壳（**装甲**，2026-09-16 船长改名）/ 蜃楼（航运）；造船统归协会，海鲜命名统一。
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
 * - 甲壳装甲线（armored）：装甲/结构最厚 + 装甲层高抗（全系），离线长作业 + 未来坦克位；
 *   **2026-09-16 船长**：① 类别名「重装舰」→「**装甲舰**」（展示层，`SHIP_ROLE_LABELS`）；② 三艘加子分类「武装货舰」；
 *   ③ 牛鲨级 + E 族专属舰**盾/甲互换** ⇒ 按「武装舰里装甲占比 > 护盾占比」归入装甲舰（丙案，role 不动）
 * - 蜃楼航运线（hauler）：特大货舱 + 高结构量，壳大皮薄、无战斗无人机舱；
 *   2026-09-09 起含鲸盟制造的两艘超大型货舰（蝠鲼级/皇带鱼级：护盾抗动能同鲸盟）
 * - V10.5：shieldHp/armorHp/hullHp = roleBase × tierScale（t1×1.0/t2×1.8/t3×2.9/t4×4.2，取整）
 * - **2026-09-15 船长定：非战斗舰（industrial / hauler）血量 = 同档官方战斗舰「总血中位」× 0.8**
 *   —— 起因＝船长「提高所有非战斗舰船的血量，使其约等于同级官方战斗舰船血量的 0.8」；
 *   四问四答（全取推荐）：**参考值 = 同档中位**（不被鲣鱼 126 / 玳瑁 910 这类极端值带偏）·
 *   **按原比例放大三层**（盾/甲/结构的占比一字不动，取整余数记入结构层 ⇒ 总血恰为目标）·
 *   **含 T1 新手船沙猫** · **价格/舱位/产能一律不动**。
 *   **档位目标总血**：T1 **182** · T2 **307** · T3 **540** · T4 **1018** · T5 **1884**。
 *   **"官方战斗舰"判据** = 官方目录里 role 为 `armed` / `armored` 的船（含侦察/电子/装甲子分类；
 *   **不含**虫洞专属 `sh-wh-*`——那些是专属掠夺舰，不是"官方同级"）⇒ 各档参考中位：
 *   T1 228（鲣鱼 126 / 马鲛 228 / 虎鲨 243）· T2 384（灰鲭鲨 366 / 大白鲨 396 / 梭鱼 378 / 陆龟 390）·
 *   T3 675（鹦鹉螺 610 / 长尾鲨 648 / 王鲭 652 / 电鳐 675 / 锤头鲨 701 / 牛鲨 755 / 玳瑁 910）·
 *   T4 1273（巨齿鲨 / 玄武）· T5 2355（邓氏鱼）。
 *   护栏 = `content:check`「非战斗舰血量契约」（11 艘总血必须等于上表目标）；读数表 =
 *   `npm run ship:hp`。⚠ 改动波及：低安遇袭/战斗的生存线（一口伤害是绝对值）与战力/胜率预估（按血量算）；
 *   存档零迁移（档里只存耐久**比例**，上限由定义现算 ⇒ 老档"比例不变、绝对血变多"）。
 * - V16.1：基础抗性简化（整数主抗制）——每族一个主抗，便于心算：
 *   鲸盟(industrial)＝护盾抗动能 25%｜甲壳(armored)＝装甲抗高爆 50%｜蜃楼(hauler)＝结构抗能量 25%；
 *   其余层/型一律 0（省略键）；装备抗性插件仍可在此基础上叠加；
 *   （鲸盟出品的蝠鲼/皇带鱼沿用鲸盟护盾抗动能，不随航运族改结构抗）
 * - **2026-09-17 船长「武装舰 / 装甲舰的额外加成」重排（本表最新口径，前面各族的"主抗"注以本条为准）**：
 *   ① **武装舰（类别）按档位给伤害加成**：T1/T2/T3/T4/T5 = **+15/20/25/35/50%** ⇒ 写 `powerBonus`；
 *      **无人机船**（主力输出是机群的梭鱼级 / 王鲭级）**改为同等数值的 `droneDmgBonus`**（不再有 powerBonus）。
 *   ② **装甲舰（类别）按档位给甲层抗性**：**动能与能量各 +30/30/35/35/35%**（写 `armorResist`），
 *      且**移除先前获得的单发加成**（牛鲨 0.7 / 构件鱼雷舰 0.5 / 机库 0.4 / 巨构 0.6 已清）。
 *   ③ **移除每条船的"50 动能抗"**：掠食者线（官方 8 艘）＋ A 族 2 艘 ＋ G 族 3 艘 ＋ 甲壳截击舰之外的
 *      C 族 —— 共 **21 艘**的 `kinetic: 0.5` 已删；**0.25 的动能抗（鲸盟/蜃楼/鹦鹉螺/C 族壳层）不动**。
 *   ④ **子分类与种族给的额外属性原则上不动**：E 三艘的壳层能量 0.25 · E/C/G/A 各族的族武与命中/回避强增
 *      —— 保留；**例外 = 下面 ⑥~⑨ 四条抗性**（船长同日逐条点名改）。
 *   ⑤ **D 族三艘（哨戒电子舰 / 陵卫指挥舰 / 陵寝巡洋舰）由 `armored` 转入 `armed`**（船长同日
 *      「D 族移动到武装舰，吃武装舰技能」）⇒ 它们吃「武装舰操作」（+3%/级 单发）并按 ① 拿档位加成；
 *      槽位仍按 2026-09-13 的子分类口径（电子舰 2/3/3 · 指挥舰 2/4/4 · 陵寝 4/4/4）**不动**。
 *   ⑥ **甲壳线爆炸抗性 0.5 → 0.25**（船长：「**陆龟级，玳瑁级，玄武级，爆炸抗性削弱到0.25**」）。
 *   ⑦ **C 族甲层高爆 0.5 → 0.3**（船长：「**装甲船的C族高爆抗性改为0.3**」）；巢群重型突击巡洋舰
 *      的盾层/结构 0.25×3 保留。
 *   ⑧ **C 族前两艘移除能量抗**（船长：「**幼虫截击舰甲壳截击舰移除能量抗性**」）⇒ 甲层只留 高爆 0.3 + 动能档位。
 *   ⑨ **D 族移除甲层爆炸与结构全部抗性**（船长：「**D族船，装甲爆炸抗性和结构所有抗性移除**」）
 *      ⇒ 三艘只留盾层 0.25×3。
 *   护栏 = `content:check`「加成与抗性新口径」四条（阶梯 ±0.05 · 盾层零抗 · 全局无 50 动能抗 · 不变量）。
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
    shieldHp: 47,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 40,
    hullHp: 95,
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
    shieldHp: 48,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 39,
    hullHp: 95,
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
    shieldHp: 78,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 69,
    hullHp: 160,
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
    shieldHp: 79,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 70,
    hullHp: 158,
    cpu: 150,
    droneBayM3: 0,
    maxSpeedMps: 250,
    warpSpeedAus: 3.5,
    massKg: 5_500_000,
    lockRangeM: 20_000,
    signatureM: 95,
    scanResMm: 470,
    description: '协会造船厂的定制艇：不对外出售，用原材料在自家船台上敲出来。比鲸吞级再快一档。',
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
    shieldHp: 141,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 118,
    hullHp: 281,
    cpu: 190,
    droneBayM3: 0,
    maxSpeedMps: 210,
    warpSpeedAus: 2.8,
    massKg: 12_000_000,
    lockRangeM: 21_000,
    signatureM: 140,
    scanResMm: 400,
    description: '深空工业的顶点：双倍于鲸吞级的产能。重钨合金吞金兽，全游戏最长远的攒料目标。',
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
    priceIsk: 9_000_000, // 2026-09-13 价位重排：T3 工业（鲸吞 0.9M ×10；原 1.35M）
    agility: 0.3,
    evasion: 0,
    hitBonus: 0.1,
    shieldHp: 68,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 193,
    hullHp: 279,
    cpu: 140,
    droneBayM3: 0,
    maxSpeedMps: 230,
    warpSpeedAus: 3.5,
    massKg: 9_000_000,
    lockRangeM: 21_000,
    signatureM: 120,
    scanResMm: 430,
    description: '鲸盟第三代量产矿舰：拥有货舰级的货舱，产量再上一档。',
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
    priceIsk: 67_500_000, // 2026-09-13 价位重排：T4 货舰（剑鱼 24M ×2.81，保持同档比；原锚矿舰的算法作废；原 13.5M）
    agility: 0.28,
    evasion: 0,
    hitBonus: 0.1,
    shieldHp: 111,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 343,
    hullHp: 564, // 货舰：结构占比略高
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
    cargoM3: 108_000, // 2026-09-14 船长：「将皇带鱼的货仓容量提高到300%」⇒ 36,000 → 108,000（×3）
    cycleSeconds: 33,
    oreUnitsPerCycle: 129,
    priceIsk: 0, // 仅制造（蓝图为限定奇货）
    agility: 0.22,
    evasion: 0,
    hitBonus: 0.12,
    shieldHp: 231,
    shieldResist: { kinetic: 0.25 }, // 鲸盟：护盾抗动能（整数主抗制）
    armorHp: 514,
    hullHp: 1139, // 旗舰大壳
    cpu: 230,
    droneBayM3: 0,
    maxSpeedMps: 160,
    warpSpeedAus: 2.8,
    massKg: 30_000_000,
    lockRangeM: 23_000,
    signatureM: 260,
    scanResMm: 320,
    description: '鲸盟总装的旗舰货舰：十万八千立方货舱，深空物流的移动要塞。',
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
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 60,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 108,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 114,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    powerBonus: 0.2, // 2026-09-17 船长：武装舰按档位给单发加成（T2 = +20%）
    shieldHp: 174,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    // 2026-09-17 船长：「**给予大白鲨级炮舰舰船子分类炮舰**」、「**所有炮舰伤害倍率额外+0.15**」
    subClass: '炮舰',
    slots: { high: 5, mid: 3, low: 2 }, // V18 槽位布局（草案表 v18-slots.md）
    tier: 2,
    cargoM3: 3200,
    cycleSeconds: 13,
    oreUnitsPerCycle: 18,
    priceIsk: 1_100_000,
    agility: 0.56,
    evasion: 0.1,
    hitBonus: 0.2,
    powerBonus: 0.35, // 2026-09-17：档位 T2 +20% ＋ 子分类炮舰 +15% = +35%
    shieldHp: 186,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    description: '顶级武装炮舰：声誉与实力的双重象征。',
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
    // 2026-09-17 船长：本舰按档位给加成后**移除**原 powerBonus（改为同等数值的无人机伤害加成）
    droneDmgBonus: 0.2, // 2026-09-17 船长：无人机船按档位给**无人机伤害**加成（T2 = +20%）
    shieldHp: 180,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    /**
     * V18 槽位布局。沿革（**以本行为准**）：
     * - 2026-09-10 船长：无人机专用舰**高槽 −2**（6→4；中/低不动）；
     * - **2026-09-21 船长报障「王鲭级无人机母舰槽位数量不对」⇒ 选定「高 4 / 中 5 / 低 2 = 11 槽」**：
     *   原值 4/2/2 只有 **8 槽**（比 T2 大白鲨 10 少、与 T1 虎鲨 4/2/2 相同），而同为 T3 巡洋的
     *   长尾鲨/电鳐/牛鲨/鹦鹉螺都是 11（2026-09-14 船长定过「对齐 T3 默认线 11」）⇒ 补齐到 11，
     *   增量全给**中槽**（这一档的母舰形态：护盾/推进/电子位厚一点，靠机群输出）。
     * ⚠ 老档由 `equipment.repairDeprecatedModules` 的「位对齐」自动补空位（不丢装备、无需迁移）。
     */
    slots: { high: 4, mid: 5, low: 2 },
    tier: 3,
    cargoM3: 3600,
    cycleSeconds: 13,
    oreUnitsPerCycle: 15,
    priceIsk: 2_600_000,
    agility: 0.52,
    evasion: 0.08,
    hitBonus: 0.16,
    // 2026-09-17 船长：本舰按档位给加成后**移除**原 powerBonus（改为同等数值的无人机伤害加成）
    droneDmgBonus: 0.25, // 2026-09-17 船长：无人机船按档位给**无人机伤害**加成（T3 = +25%）
    shieldHp: 310,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    description: '掠食者武装部门定制的无人机母舰：翻倍的机巢与充裕的装配位，无人机战力的巅峰载体。',
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
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    shieldHp: 325,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    armorHp: 148,
    hullHp: 175,
    cpu: 345,
    droneBayM3: 50,
    maxSpeedMps: 272,
    warpSpeedAus: 3.3,
    massKg: 7_000_000,
    lockRangeM: 41_000,
    signatureM: 96,
    scanResMm: 520,
    weaponFamilyBonus: { explosive: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族爆破弹药 +12%）
    description: '掠食者武装部门的新锐导弹巡洋舰：以长尾为名的远距猎手，齐射导弹先声夺人——舰体为导弹阵列特调，爆破弹药威力额外加成。',
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
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    shieldHp: 340,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    armorHp: 154,
    hullHp: 181,
    cpu: 355,
    droneBayM3: 50,
    maxSpeedMps: 265,
    warpSpeedAus: 3.2,
    massKg: 7_500_000,
    lockRangeM: 40_000,
    signatureM: 100,
    scanResMm: 510,
    weaponFamilyBonus: { plasma: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族能量激光 +12%）
    description: '掠食者武装部门的光束巡洋舰：高压电弧般的激光炮阵列，接敌即烧穿护盾——舰体光束聚焦阵列特调，能量武器威力额外加成。',
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
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    shieldHp: 355,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    armorHp: 160,
    hullHp: 186,
    cpu: 360,
    droneBayM3: 50,
    maxSpeedMps: 268,
    warpSpeedAus: 3.2,
    massKg: 8_000_000,
    lockRangeM: 39_000,
    signatureM: 105,
    scanResMm: 500,
    weaponFamilyBonus: { kinetic: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族动能炮 +12%）
    description: '掠食者武装部门的炮击主力：重炮动能阵列齐射的中坚，深空讨伐的舰队长矛——舰体动能炮组特调，动能武器威力额外加成。',
  },
  {
    id: 'sh-bullshark',
    name: '牛鲨级突击巡洋舰',
    role: 'armed',
    slots: { high: 5, mid: 2, low: 4 }, // **11 槽**（2026-09-14 船长：「牛鲨-1槽位」⇒ **中槽 −1**、对齐 T3 默认线 11；
    //   保住「厚甲重炮」那一排低槽：低槽 = 装甲/货舱 + 伤害/射速支援件）；原布局 5/3/4 见 v18-slots.md 草案表
    tier: 3,
    cargoM3: 3000,
    cycleSeconds: 13,
    oreUnitsPerCycle: 12,
    priceIsk: 13_000_000, // 巡洋价位定档（2026-09-09 船长拍板，战力序 9/11/13/15M）；2026-09-11 对齐市场行（此前只落到市场行）
    agility: 0.46,
    evasion: 0.08,
    hitBonus: 0.19,
    // 2026-09-17 船长：本舰按档位给加成后**移除**原 powerBonus（装甲舰改为按档位给甲层抗性）
    // 2026-09-16 船长：「将牛鲨级突击舰和E族专属舰的护盾和装甲互换」⇒ 盾/甲 400↔163（总血 755 不变）；
    // 换后**装甲占比 > 护盾占比** ⇒ 按同日丙案归入「装甲舰」类别（role 仍 `armed`）；
    // 两个「舰操作」按**类别**判（同日追裁）⇒ 本舰吃「装甲舰操作」、不吃「武装舰操作」。
    // **2026-09-17 船长：抗性也一并调整**——「**不用护盾了，所以不要给护盾任何抗性，只给装甲抗性**」
    // ⇒ 盾层清零、动能抗 0.5 搬到**甲层**（读数：对动能 EHP 943 → 1367，对爆炸/能量不变）。
    shieldHp: 163,
    armorHp: 400,
    armorResist: { kinetic: 0.35, plasma: 0.35 }, // 2026-09-17 船长：装甲舰按档位给**甲层动能+能量**抗性（T3 = 35%）
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    hullHp: 192,
    cpu: 390,
    droneBayM3: 50,
    maxSpeedMps: 258,
    warpSpeedAus: 3.1,
    massKg: 9_000_000,
    lockRangeM: 40_000,
    signatureM: 118,
    scanResMm: 480,
    weaponFamilyBonus: { kinetic: 0.12 }, // 船体族加成（2026-09-09 船长拍板：四族巡洋分型——本族动能炮 +12%）
    description: '掠食者武装部门最凶悍的咬合者：厚盾重炮的突击巡洋舰，专为贴脸近战而生——舰体动能炮组特调，动能武器威力额外加成。',
  },

  // ══════════ 协会测绘处 · 测量线（2026-09-13 船长：「添加一艘新的巡洋舰，子分类为侦查舰。所属为
  //   深空工业协会 · 测绘处。最主要的效果就是虫洞扫码范围+1.槽位合计为10个。无人机舱稍大。」
  //   ＋追加：「货仓可以乘*3」「采矿提高到39单位」「船和蓝图放入奇货」「跟虫洞挂 unreleased」）══════════
  {
    id: 'sh-nautilus',
    name: '鹦鹉螺级测绘巡洋舰',
    role: 'armed',
    subClass: '侦察舰', // 2026-09-13 船长：**协会功能舰也写子分类**（`content:check` 同步放宽为"白名单 + 非虫洞登记表"）
    slots: { high: 3, mid: 4, low: 4 }, // **11 槽**（2026-09-14 船长：「鹦鹉螺+1槽位」⇒ 中槽 +1、对齐 T3 默认线 11；
    //   ⚠ **2026-09-18 船长：「鹦鹉螺的槽位改成3/4/4」** ⇒ 高 4→3、低 3→4，**总数仍 11**（基准线不破）；
    //   与同子分类「侦察舰」的幽影侦察舰（3/4/1）「中槽最多」同形——中槽 = 命中/闪避支援，正是它吃的那两项。
    //   ⇒ 高槽偏少会撞「官方武装舰 高槽 ≥ 低槽+1」那条弱断言，已按船长裁定在 `content:check` 加白名单豁免）
    tier: 3,
    cargoM3: 5600, // 2026-09-26 船长令「鹦鹉螺货仓减少1000」⇒ 6,600 → 5,600（虫洞背包 ⌊5,600÷500⌋ = 11 格）；原沿革：船长「货仓可以乘*3」（原案 2,200 ×3 = 6,600）
    cycleSeconds: 14,
    oreUnitsPerCycle: 39, // 船长：「采矿提高到39单位」
    priceIsk: 9_000_000, // 船长定：贴长尾鲨级（同档同价）
    // ✅ 2026-09-14 虫洞上线：「跟随虫洞挂 unreleased」的闸门**已按设计稿『与虫洞同批』删除**
    //   （`docs/design/scout-cruiser-20260913.md` §2.3「上线动作 = 删这四个字段」）⇒ 图鉴可见、市场可买。
    agility: 0.56,
    evasion: 0.16,
    hitBonus: 0.14,
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    droneDmgBonus: 0.10, // 机群是它的次要输出（介于梭鱼 0.08 与王鲭 0.12）——2026-09-20 机舱 80→160 时**维持不动**（船长裁定）
    /** **主效果**：虫洞扫码范围 +1 圈——对编队**求和**（多艘可叠加），入洞与深入下层都生效 */
    wormholeScanRadiusBonus: 1,
    // **侦察舰特性**（船长 2026-09-16：「侦查舰添加特性，隐秘行动装置所需CPU降低50%，且移除推进器失效惩罚」）：
    //   ① 隐秘行动装置 CPU **×0.5 向上取整**（MK2 55 → **28** · MK3 80 → 40）；
    //   ② 装推进器族也**照常隐身**（旧口径「有推进器即解除隐身」对它作废）。
    stealthCpuMul: 0.5,
    stealthIgnoresPropulsion: true,
    shieldHp: 300,
    shieldResist: { kinetic: 0.25 }, // 协会通用口径（不占掠食者线签名——它靠机动与视野吃饭）
    armorHp: 145,
    hullHp: 165, // 三层共 610（T3 目标 648~755 的偏下沿：少 1~2 槽、机舱与货舱都大）
    cpu: 340,
    droneBayM3: 160, // 2026-09-20 船长：「鹦鹉螺的无人机舱扩大到 160」（原 80 ⇒ **翻倍**；同级巡洋 50、母舰 320 那一档未动）
    //   ⇒ 载机量四档同步翻倍：侦察 16→**32** 架 · 战斗 8→**16** · 攻坚 4→**8** · 哨戒 2→**4**（四型均仍是"舱位限制"：
    //   CPU 340 足够养 48 架战斗机，不构成瓶颈）。`droneDmgBonus` 按船长同批裁定**维持 +10%**。
    maxSpeedMps: 280, // 同级最快（同级 258~275；侦察定位）
    warpSpeedAus: 3.4,
    massKg: 6_800_000, // 非装甲 ⇒ 等效质量落 T3 带（5.8~13M）
    lockRangeM: 42_000,
    signatureM: 92,
    scanResMm: 560, // 同级最高分辨率（测绘）
    description: '协会测绘巡洋舰：编入虫洞队伍即扩大扫描范围一圈（多艘可叠加）。',
  },

  // ══════════ 甲壳装甲线（装甲/结构最厚 + 装甲层高抗） ══════════
  // 2026-09-15 船长：「下调重装船的货仓20%」⇒ 全线三艘（陆龟/玳瑁/玄武）货舱 ×0.8，其余数值一律不动。
  // 2026-09-16 船长：① 类别名「重装舰」→「**装甲舰**」（展示层）；② 三艘加子分类「**武装货舰**」。
  {
    id: 'sh-tortoise',
    name: '陆龟级重装艇',
    role: 'armored',
    // 子分类「武装货舰」（船长 2026-09-16：「原先将非专属的三条乌龟船添加舰船的子分类：武装货舰」）
    subClass: '武装货舰',
    slots: { high: 3, mid: 3, low: 4 }, // 2026-09-13 船长：旧重装舰对齐同级（2/2/3 → **3/3/4 = 10 槽**）
    tier: 2,
    cargoM3: 5600, // 2026-09-15 船长：「下调重装船的货仓20%」＋「只保留基础的3艘重装船，货舱修改的也是它们」（7000 ×0.8）
    cycleSeconds: 13,
    oreUnitsPerCycle: 24,
    priceIsk: 450_000, // 2026-09-13 船长：旧重装舰对齐同级后价格跟涨（330k → 450k）
    agility: 0.5,
    evasion: 0.08,
    hitBonus: 0.12,
    shieldHp: 60,
    armorHp: 150,
    armorResist: { explosive: 0.25, kinetic: 0.3, plasma: 0.3 }, // 2026-09-17 船长：「陆龟级，玳瑁级，玄武级，爆炸抗性削弱到0.25」（其余两层为装甲舰 T2 档位 30%）
    hullHp: 180,
    cpu: 205,
    droneBayM3: 40,
    maxSpeedMps: 120, // ⟪2026-09-25 船长令⟫「陆龟级速度减半」：240 → **120**（原沿革：2026-09-13 旧重装舰对齐同级 200 → 240）
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
    // 子分类「武装货舰」（船长 2026-09-16，同陆龟级）
    subClass: '武装货舰',
    slots: { high: 4, mid: 4, low: 5 }, // 2026-09-13 船长：旧重装舰对齐同级（2/3/3 → **4/4/5 = 13 槽**）
    tier: 3,
    cargoM3: 9600, // 2026-09-15 船长：重装线货舱 −20%（12000 ×0.8）
    cycleSeconds: 13,
    oreUnitsPerCycle: 22,
    priceIsk: 6_000_000, // 2026-09-13 价位重排：T3 装甲（陆龟 0.45M ×13.3；原 1.1M）
    agility: 0.46,
    evasion: 0.08,
    hitBonus: 0.12,
    shieldHp: 120,
    armorHp: 360,
    armorResist: { explosive: 0.25, kinetic: 0.35, plasma: 0.35 }, // 2026-09-17 船长：「陆龟级，玳瑁级，玄武级，爆炸抗性削弱到0.25」（其余两层为装甲舰 T3 档位 35%）
    hullHp: 430,
    cpu: 330,
    droneBayM3: 50,
    maxSpeedMps: 80, // ⟪2026-09-25 船长令⟫「玳瑁级速度降低到80」：230 → **80**（原沿革：2026-09-13 旧重装舰对齐同级 185 → 230）
    warpSpeedAus: 2.9,
    massKg: 11_000_000,
    lockRangeM: 23_000,
    signatureM: 180,
    scanResMm: 370,
    description: '重装巡舰：厚壳加身的移动仓库，离线长时间作业的可靠伙伴。',
  },
  {
    id: 'sh-xuanwu',
    name: '玄武级重装战列舰',
    role: 'armored',
    // 子分类「武装货舰」（船长 2026-09-16，同陆龟级）
    subClass: '武装货舰',
    slots: { high: 4, mid: 4, low: 6 }, // **14 槽**（船长「修正下玄武」＋同日废除 3~12 契约、T4 战列舰按**平均值 14**）
    tier: 4,
    cargoM3: 15200, // 2026-09-15 船长：重装线货舱 −20%（19000 ×0.8）
    cycleSeconds: 14,
    oreUnitsPerCycle: 26,
    priceIsk: 90_000_000, // 2026-09-13 价位重排：T4 装甲（玳瑁 6M ×15；原 16.5M）
    agility: 0.4,
    evasion: 0.05,
    hitBonus: 0.05,
    shieldHp: 166,
    armorHp: 493,
    armorResist: { explosive: 0.25, kinetic: 0.35, plasma: 0.35 }, // 2026-09-17 船长：「陆龟级，玳瑁级，玄武级，爆炸抗性削弱到0.25」（其余两层为装甲舰 T4 档位 35%）
    hullHp: 614,
    cpu: 490,
    droneBayM3: 60,
    maxSpeedMps: 100, // ⟪2026-09-25 船长令⟫「玄武级速度降低到100」：170 → **100**
    warpSpeedAus: 2.8,
    massKg: 20_000_000,
    lockRangeM: 24_000,
    signatureM: 250,
    scanResMm: 330,
    description: '重装线的顶点：传闻用整颗小行星的岩壳锻造。',
  },

  // ══════════ T4/T5 主战船（2026-09-12 船长「T4,T5 可以先立个模子」）══════════════
  // ⚠ **状态（2026-09-13 船长四条裁定后分写）**：
  //   · **巨齿鲨级战列舰（T4）= 已定案**：数值照用 2026-09-12 外推值（档位/槽位/CPU/血量/火力加成
  //     均落在阶梯上）+ 补掠食者线抗性签名；走**仅图纸制造**（市场行 `playerBuyable: false` 只收不卖
  //     ⇒ 本字段 `priceIsk` 仍必须为 **0**，`content:check`「舰船价格口径」据此判定）；
  //     蓝图 `sbp-megalodon` 上市场奇货（900M · 声望 11）。
  //   · **邓氏鱼级旗舰（T5）= 仍是壳体/模子**：**不上市场、不接蓝图、不接任何卡**，数值待定案。
  //   外推口径（2026-09-12 船长修订）：**槽位 T4 战列舰 = 14（平均值）· T5 旗舰 = 18**
//   （旧的「总槽位 3~12」契约同日废除——它当初是为驱逐舰设的）；CPU T3 = 350 ⇒ **×1.4/档**；
  //   血量 = 档位阶梯（锚 T2 = 372、**×1.85/档** ⇒ **T4 = 1,273 / T5 = 2,355**）；
  //   质量取所在档区间内、与既有邻舰同量级（T4 22M，介于玄武 20M 与皇带鱼 30M 之间；T5 35M）。
  //   背景：玩家侧此前**根本没有 T4/T5 主战船**（T4 只有玄武、T5 只有货舰），而敌人有 T4 泰坦 /
  //   T5 核心舱段 ⇒ 这是"E 段换大船不解决生存"的结构原因之一（2026-09-12 实测）。
  {
    id: 'sh-megalodon',
    name: '巨齿鲨级战列舰',
    role: 'armed',
    slots: { high: 6, mid: 5, low: 3 }, // **14 槽**（船长 2026-09-12：T4 战列舰按平均值 14（旧「总槽位 3~12」契约同日废除））
    tier: 4,
    cargoM3: 4000,
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 0, // 模子：未上架（定制船口径）
    agility: 0.35,
    evasion: 0.06,
    hitBonus: 0.06,
    powerBonus: 0.35, // 2026-09-17 船长：武装舰按档位给单发加成（T4 = +35%）
    /**
     * **船体固有射程加成 +20%**（船长 2026-09-24：「**给战列舰添加一个+20%的射程加成**」）。
     * 与模块的 `rangeTypeBonusPct` **同链加算**（`combat.createPlayerSpec` 的 `rangeOf`：
     * 实际射程 = 基础 × (1 − 全局削减) × (1 + 本系加成)）⇒ 三系都给 20%，不偏科。
     * 口径与船体固有加成一致（先例：炮艇「动能武器射程 +30%」）。
     */
    weaponRangeBonusPct: { kinetic: 0.2, explosive: 0.2, plasma: 0.2 },
    shieldHp: 675,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
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
    description: '以史前巨齿为名的战列舰：正面承伤与火力平台。三层血厚实、装配位宽裕，敢站在编队最前面——代价是转身慢、起步慢。',
  },
  /* ══════════ 2026-09-26 船长令：两艘新官方战列舰 ══════════
   * 原话：「**我需要新增2艘官方战列舰，需要和巨齿鲨做区分**」→「**一艘指挥战列舰…一艘装甲舰，
   * 命名还是以鲨系为主可以往古代种或者奇幻种走**」→「**指挥战列舰降级为战列巡洋舰，名字叫虎鲸级指挥舰。
   * 槽位调整为454，其他也进行调整**」→「**这是之前设定文档里有的内容，依旧属于战列舰级别（= 不可见的大小类
   * 「战列巡洋舰」），但是速度更快，其他属性全面落后战列舰**」。
   *
   * **虎鲸级 = 战列巡洋舰**（设定里的不可见说法）：**T4 档**、比巨齿鲨**快得多**（245 vs 175），
   * 其余**全面落后**（13 槽 vs 14 · 总血 1,050 vs 1,273 · CPU 420 vs 490 · 质量 16M vs 22M · 货 2,400 vs 4,000），
   * 换来**全队单发光环 +20%**（子分类「指挥舰」）。
   * ⚠ 槽位 **4/5/4** 会撞「官方武装舰 高槽 ≥ 低槽+1」弱断言 ⇒ 按船长 2026-09-18 给鹦鹉螺级（中槽型功能舰）
   *   的同款白名单豁免处理（`content-check` 的 `OFFICIAL_HIGH_SLOT_EXEMPT`）。
   * **旋齿鲨级 = 装甲线新战列舰**：守 T4 阶梯（14 槽 · 总血 1,273 · CPU 490 · 质量 21M），
   * 与玄武（4/4/6 · 甲 493/结构 614 · 速度 100 · 货 15,200 的堡垒货舰）区分 = **甲向 700 + 速度 150 + 货小**。
   * 两艘的渠道：虎鲸级照**巨齿鲨**（仅图纸制造）；旋齿鲨级照**玄武**（现货 + 图纸）。 */
  {
    id: 'sh-orca',
    name: '虎鲸级指挥舰',
    role: 'armed',
    subClass: '指挥舰',
    slots: { high: 4, mid: 5, low: 4 }, // **13 槽**（船长 2026-09-26：「槽位调整为454」）⇒ 比巨齿鲨少 1 格
    tier: 4,
    cargoM3: 4700, // 2026-09-26 船长令：「虎鲸级货仓提高到4700」⇒ 2,400 → 4,700
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 0, // 仅图纸制造（照巨齿鲨口径：只收不卖 ⇒ 本字段必须为 0）
    agility: 0.3, // 比巨齿鲨（0.35）更灵
    evasion: 0.07, // 7%（巨齿鲨 6%）——战巡的活法是"跑得掉"
    hitBonus: 0.05,
    powerBonus: 0.35, // T4 武装舰档位阶梯（契约：0.15/0.20/0.25/0.35/0.50）
    /**
     * **全队单发光环 +20%**（`fleetDamageBonusPct`；船长 2026-09-26 定本舰为**指挥舰**）。
     * 先例：陵寝巡洋舰 T3 = +15% ⇒ 本舰按档位抬到 +20%。**只对同队生效、不加自己**（引擎口径）。
     */
    fleetDamageBonusPct: 0.2,
    shieldHp: 480,
    armorHp: 240,
    hullHp: 330, // 三层共 1,050（低于 T4 战斗舰中位 1,273 ⇒ 「其他属性全面落后战列舰」）
    cpu: 420, // T4 阶梯 490 之下（战巡口径）
    droneBayM3: 60,
    maxSpeedMps: 245, // ⟪'战列巡洋舰'的核心差异：比巨齿鲨 175 快 40%⟫
    warpSpeedAus: 3.2,
    massKg: 16_000_000, // T4 落档带 13M~29M 内偏轻
    lockRangeM: 26_000,
    signatureM: 260,
    scanResMm: 320,
    description: '指挥舰：把编队拧成一股的那艘。速度是它的立身之本，代价是装配位、血量与货舱都比战列舰薄一档。',
  },
  {
    id: 'sh-helicoprion',
    name: '旋齿鲨级装甲战列舰',
    role: 'armored',
    slots: { high: 5, mid: 3, low: 6 }, // **14 槽**（T4 基准；高槽比玄武多 1 门炮）
    tier: 4,
    cargoM3: 3600, // 战列舰口径（不做货舰 ⇒ 与玄武 15,200 明确分工）
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 90_000_000, // 照玄武口径：现货在售（市场行同值，契约「舰船价格口径」守）
    agility: 0.4,
    evasion: 0.05,
    hitBonus: 0.05,
    shieldHp: 200,
    armorHp: 700, // 甲向 55%（玄武是结构向 48%）⇒ 两艘装甲战列舰分工：玄武堡垒 / 旋齿鲨前压
    armorResist: { explosive: 0.25, kinetic: 0.35, plasma: 0.35 }, // 装甲线 T4 档位（与玄武同族签名）
    hullHp: 373, // 三层共 1,273（T4 战斗舰中位；不牵动非战斗舰目标表 1,018）
    cpu: 490,
    droneBayM3: 60,
    maxSpeedMps: 150, // 玄武 100 ⇒ 本舰是"跟得上编队的甲向突击舰"
    warpSpeedAus: 2.7,
    massKg: 21_000_000,
    lockRangeM: 24_000,
    signatureM: 250,
    scanResMm: 330,
    description: '以史前旋齿为名的装甲战列舰：装甲层厚到能顶住第一轮齐射，速度也还跟得上编队——代价是货舱小、中槽少。',
  },
  {
    id: 'sh-dunkleosteus',
    name: '邓氏鱼级旗舰',    role: 'armed',
    slots: { high: 7, mid: 7, low: 4 }, // **18 槽**（船长 2026-09-12：旗舰 18 ⇒ 单类上限放宽到 7 后的 7/7/4，且高槽多于低槽）
    tier: 5,
    cargoM3: 4500,
    cycleSeconds: 12,
    oreUnitsPerCycle: 20,
    priceIsk: 0, // 模子：未上架（定制船口径）
    agility: 0.3,
    evasion: 0.05,
    hitBonus: 0.07,
    powerBonus: 0.5, // 2026-09-17 船长：武装舰按档位给单发加成（T5 = +50%）
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
    description: '舰队的顶点：承伤、火力与装配位都在同代船之上，造价与工期同样如此。整支编队的节奏由它定——它慢，别人就得等。',
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
    shieldHp: 52,
    armorHp: 66,
    hullHp: 189,
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
    priceIsk: 2_400_000, // 2026-09-13 价位重排：T3 货舰（飞鱼 0.21M ×11.4；原 480k）
    agility: 0.56,
    evasion: 0.3,
    hitBonus: 0.08,
    shieldHp: 88,
    armorHp: 119,
    hullHp: 333,
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
    priceIsk: 24_000_000, // 2026-09-13 价位重排：T4 货舰（旗鱼 2.4M ×10；原 4.8M）
    agility: 0.5,
    evasion: 0.28,
    hitBonus: 0.08,
    shieldHp: 170,
    armorHp: 226,
    hullHp: 622,
    hullResist: { plasma: 0.25 }, // 蜃楼：结构抗能量（整数主抗制）
    cpu: 175,
    droneBayM3: 60,
    maxSpeedMps: 400,
    warpSpeedAus: 6.2,
    massKg: 13_000_000,
    lockRangeM: 26_000,
    signatureM: 170,
    scanResMm: 390,
    description: '蜃楼航运的旗舰货舰：一万四立方的运力，跑商人的终极梦想。',
  },

  /* ══════════════ 虫洞专属舰船（2026-09-13 船长「护卫，驱逐，巡洋都可以有，你干脆都安排设计吧」＋
   * 「所有舰船不掉成品，只掉一次性图纸」；设计稿 `docs/design/wormhole-exclusive-20260913.md` §4）
   * 五族（A/C/D/E/G）各 3 艘 = **护卫（T1）・驱逐（T2）・巡洋（T3）**，共 15 艘。
   * 档位阶梯**从既有 27 艘船实测反推**（槽位 / CPU / 三层血 / 质量 / 速度逐档对齐）；
   * 族签名走**非武器维度**（三层血配比、槽位配比、CPU、机库、信号/扫描、速度、货舱），
   * 以免与既有四艘 T3 巡洋的「族加成 +12%」撞车。
   * C 族与 D 族走 `armored`（等效质量 ×0.65，可挂更大绝对质量而不越档）。
   *
   * ✅ **2026-09-14 虫洞上线**：当年「全部标 `unreleased: true`（手册舰船图鉴遍历 SHIPS 全目录）；上线时删字段」
   * 那条**已执行完毕** ⇒ 本块 15 艘的 `unreleased` 字段**全部删除**（图鉴可见、只由一次性图纸制造）。
   * ⚠ **定制船口径**：无市场行 ⇒ `priceIsk` 必须为 0；唯一来源 = 各自的**一次性舰船图纸**。 */
  {
    id: 'sh-wh-a-frigate',
    name: '掠袭电子舰',
    role: 'armed',
    subClass: '电子舰',
    // 子分类「电子舰」（船长 2026-09-13）：**命中 +0.10 · 回避 +20%**（真吃战斗）· **虫洞扫码 +1 圈（编队即生效、可叠加）** · 分辨率 +50%（经济向）· 锁定 +50%（纯展示）｜ 货舱 −30% · 结构血占比 −25% · 机动 −10%
    // 槽位对齐基准线（船长 2026-09-14：专属舰 = 该档默认 7/9/11/14/18「+1 槽」⇒ T1 8 / T2 10 / T3 12）：本舰创建只有 6 槽（比 T1 默认 7 还少 1）⇒ 补 1 格中槽（3/3/1 → 3/4/1，与「电子舰 = 中槽」定槽口径一致）
    slots: { high: 3, mid: 4, low: 1 },
    /**
     * **电子舰特性 · 压制敌舰武器射程**（船长 2026-09-18：「电子舰新增特性，削减敌人15%的武器射程…」）——
     * 编队内多艘**乘法合成**（`r = 1 − Π(1 − vᵢ)`），再与敌方"射程增加"**做加法**（净倍率 = 1 + 加成 − r）；
     * **基础射程 < 3000m 的不削**、削后**下限 3000m**；只动最远射程。
     * 落点见 `core/types.ts` 的字段注释与 `combat` 的 `foeGunMaxRangeOf` / `foeDroneRangeOf`。
     */
    foeRangeDebuffPct: 0.15,
    tier: 1,
    cargoM3: 1260,
    cycleSeconds: 14,
    oreUnitsPerCycle: 8,
    priceIsk: 0, // 定制船：无市场行
    agility: 0.675,
    evasion: 0.316,
    hitBonus: 0.25,
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 130,
    armorHp: 60,
    hullHp: 55,
    // 2026-09-16 船长：「**提高电子舰的CPU，提高100**」⇒ **165 → 265**（只动本字段：槽位/三层血/
    // 命中/回避/分辨率/速度/机动/货舱/价格一律不动）。动机 = 电子舰"高火控 + 设备位多（中槽 4 格）"，
    // 但原 CPU 连"三门炮 + 一件设备"都装不满；+100 后能同时带武器与整套设备（余量读数见
    // `docs/design/ew-ship-cpu-20260916.md` §四）。
    cpu: 265,
    droneBayM3: 10,
    maxSpeedMps: 350,
    warpSpeedAus: 3.8,
    massKg: 1_300_000,
    lockRangeM: 46500,
    signatureM: 44,
    scanResMm: 990,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    wormholeScanRadiusBonus: 1,
    description: '海盗的电子战艇：长项在火控与回避——先锁上、先打中，也更难被咬住；编入虫洞队伍即扩大扫描范围一圈（多艘可叠加）。',
  },
  {
    id: 'sh-wh-a-destroyer',
    name: '掠袭炮舰', // 2026-09-17 船长：「**掠袭炮艇改名掠袭炮舰**」（id 不变 ⇒ 存档零迁移）
    role: 'armed',
    subClass: '炮舰', // 2026-09-17：子分类「炮艇」随改名 → 「炮舰」
    // 子分类「炮舰」（船长 2026-09-13 原名炮艇 · 2026-09-17 改名）：**族武 动能 +0.15 · 动能武器射程 +30%** · 命中 +0.03 ｜ 货舱 −30% · 护盾血占比 −20% · 分辨率 −20%
    slots: { high: 5, mid: 3, low: 2 },
    tier: 2,
    cargoM3: 3080,
    cycleSeconds: 13,
    oreUnitsPerCycle: 14,
    priceIsk: 0,
    agility: 0.62,
    evasion: 0.22,
    hitBonus: 0.2,
    powerBonus: 0.35, // 2026-09-17：档位 T2 +20% ＋ 子分类炮舰 +15% = +35%
    shieldHp: 175,
    armorHp: 130,
    hullHp: 130,
    cpu: 250,
    droneBayM3: 30,
    maxSpeedMps: 300,
    warpSpeedAus: 3.6,
    massKg: 4_200_000,
    lockRangeM: 36000,
    signatureM: 72,
    scanResMm: 456,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    weaponFamilyBonus: { kinetic: 0.15 },
    weaponRangeBonusPct: { kinetic: 0.3 },
    description: '海盗的炮舰：动能炮阵加持，动能武器射程再拉长三成——先在射程外开火；舱位很窄、护盾让位给装甲。',
  },
  {
    id: 'sh-wh-a-cruiser',
    name: '掠袭重型突击巡洋舰',
    role: 'armed',
    subClass: '重型突击巡洋舰',
    // 子分类「重型突击巡洋舰」（船长 2026-09-13）：**三层抗性：0 抗一律 → 0.25** · **三层血 ×1.1 = 855** · **移除族武 +0.15**（船长 2026-09-13）｜ 机动 −30% · 货舱 −30% · 信号 +20%
    // （2026-09-17：护盾那一条动能 0.5 已按船长「移除每条船的 50 动能抗性」删除）
    slots: { high: 6, mid: 3, low: 3 },
    tier: 3,
    cargoM3: 3640,
    cycleSeconds: 14,
    oreUnitsPerCycle: 10,
    priceIsk: 0,
    agility: 0.385,
    evasion: 0.12,
    hitBonus: 0.17,
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    shieldHp: 375,
    armorHp: 225,
    hullHp: 255,
    cpu: 390,
    droneBayM3: 50,
    maxSpeedMps: 265,
    warpSpeedAus: 3.3,
    massKg: 8_500_000,
    lockRangeM: 40000,
    signatureM: 110,
    scanResMm: 525,
    shieldResist: {"explosive":0.25,"plasma":0.25}, // 船长 2026-09-17「移除每条船的 50 动能抗性」
    armorResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    hullResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    description: '海盗的重型突击巡洋舰：三层抗性齐备、血量再厚一成，专啃硬目标；没有额外火力加成，代价是转身慢、舱位小。',
  },
  // ⚠ 下面 C 族 3 艘的 role **维持 'armored'**（船长 2026-09-15 裁定「保持现状」）。
  //   **D 族 3 艘已于 2026-09-17 按船长「D 族移动到武装舰，吃武装舰技能」转入 'armed'**（见各自 role 注）；
  //   为完成这次转移，「武装舰 高槽 ≥ 低槽 + 1」这条**弱断言**的适用范围收窄为**官方船**
  //   （虫洞专属舰的槽位是 2026-09-13 按子分类定的：电子舰/指挥舰＝中槽型），
  //   实际布局由 core/tests/wh-ship-baseline.test.ts「D 族三艘的实际布局逐一钉住」守着。
  //   口径见 docs/glossary.md 词条「**装甲（armored）· 类别边界**」（词典待归档时同步，§8）。
  {
    id: 'sh-wh-c-frigate',
    name: '幼虫截击舰',
    role: 'armored',
    subClass: '截击舰',
    // 子分类「截击舰」（船长 2026-09-13）：速度 +35% · 机动 +35% · 命中 +0.04 ｜ 货舱 −30% · 护盾血占比 −30% · 信号 +15%
    slots: { high: 2, mid: 3, low: 3 },
    tier: 1,
    cargoM3: 630,
    cycleSeconds: 14,
    oreUnitsPerCycle: 8,
    priceIsk: 0,
    agility: 0.837,
    evasion: 0.38,
    hitBonus: 0.1,
    shieldHp: 35,
    armorHp: 90,
    hullHp: 130,
    cpu: 170,
    droneBayM3: 10,
    maxSpeedMps: 432,
    warpSpeedAus: 3.6,
    massKg: 2_100_000,
    lockRangeM: 26000,
    signatureM: 71,
    scanResMm: 600,
    // 2026-09-17 船长：「装甲船的C族高爆抗性改为0.3」＋「幼虫截击舰甲壳截击舰移除能量抗性」
    armorResist: {"explosive":0.3,"kinetic":0.3}, // 甲层：高爆 0.3（族）＋ 动能 0.3（装甲舰 T1 档位）；能量抗已按船长移除
    hullResist: {"kinetic":0.25},
    description: '巢群的活体截击舰：快得不像话，专咬落单的；护盾几乎不设防，靠一层甲壳与一副骨架撑住。',
  },
  {
    id: 'sh-wh-c-destroyer',
    name: '甲壳截击舰',
    role: 'armored',
    subClass: '截击舰',
    // 子分类「截击舰」（船长 2026-09-13）：同上（C 族两艘同子分类）
    slots: { high: 2, mid: 4, low: 4 },
    tier: 2,
    cargoM3: 1330,
    cycleSeconds: 13,
    oreUnitsPerCycle: 16,
    priceIsk: 0,
    agility: 0.675,
    evasion: 0.31,
    hitBonus: 0.09,
    shieldHp: 30,
    armorHp: 150,
    hullHp: 220,
    cpu: 215,
    droneBayM3: 30,
    maxSpeedMps: 331,
    warpSpeedAus: 3.2,
    massKg: 5_400_000,
    lockRangeM: 24000,
    signatureM: 138,
    scanResMm: 460,
    // 2026-09-17 船长：「装甲船的C族高爆抗性改为0.3」＋「幼虫截击舰甲壳截击舰移除能量抗性」
    armorResist: {"explosive":0.3,"kinetic":0.3}, // 甲层：高爆 0.3（族）＋ 动能 0.3（装甲舰 T2 档位）；能量抗已按船长移除
    hullResist: {"kinetic":0.25},
    description: '巢群的活体截击舰：速度与机动拉满，切入切出；护盾极薄，伤害全由甲与结构承担。',
  },
  {
    id: 'sh-wh-c-cruiser',
    name: '巢群重型突击巡洋舰',
    role: 'armored',
    subClass: '重型突击巡洋舰',
    // 子分类「重型突击巡洋舰」（船长 2026-09-13）：**三层抗性：0 抗一律 → 0.25**（甲爆炸原 0.5 ⇒ **2026-09-17 船长改为 0.3**）· **三层血 ×1.1 = 1055** · **移除族武 +0.15** · 低槽 +1 ｜ 机动 −30% · 货舱 −30% · 信号 +20%
    slots: { high: 4, mid: 3, low: 5 },
    tier: 3,
    cargoM3: 2940,
    cycleSeconds: 13,
    oreUnitsPerCycle: 20,
    priceIsk: 0,
    agility: 0.294,
    evasion: 0.04,
    hitBonus: 0.05,
    shieldHp: 85,
    armorHp: 455,
    hullHp: 515,
    cpu: 280,
    droneBayM3: 50,
    maxSpeedMps: 206,
    warpSpeedAus: 2.9,
    massKg: 12_200_000,
    lockRangeM: 25000,
    signatureM: 204,
    scanResMm: 400,
    shieldResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    // 2026-09-17 船长：「装甲船的C族高爆抗性改为0.3」⇒ 甲层高爆 0.5 → 0.3（动能/能量维持装甲舰 T3 档位 0.35）
    armorResist: {"explosive":0.3,"kinetic":0.35,"plasma":0.35},
    hullResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    description: '巢群的重型突击巡洋舰：三层抗性齐备、甲壳再厚一成，正面硬碰硬；没有额外火力加成，转身极慢。',
  },
  {
    id: 'sh-wh-d-frigate',
    name: '哨戒电子舰',
    role: 'armed', // 2026-09-17 船长：「D 族移动到武装舰，吃武装舰技能」⇒ 由 armored 转入
    subClass: '电子舰',
    // 子分类「电子舰」（船长 2026-09-13）：**D 族特色 = 高护盾比（护盾 65%）** · **三层盾抗 0.25**
    // （原「+ 甲爆炸 0.5」已按船长 2026-09-17「D族船，装甲爆炸抗性和结构所有抗性移除」清掉）· **命中 +0.12 · 回避 +55%** · **虫洞扫码 +1 圈（编队即生效、可叠加）** · 分辨率 +50%（经济向）｜ 货舱 −30% · 机动 −10%
    slots: { high: 2, mid: 3, low: 3 },
    /** **电子舰特性 · 压制敌舰武器射程**（船长 2026-09-18；口径见 `core/types.ts`，与掠袭电子舰同款） */
    foeRangeDebuffPct: 0.15,
    tier: 1,
    cargoM3: 770,
    cycleSeconds: 14,
    oreUnitsPerCycle: 8,
    priceIsk: 0,
    agility: 0.495,
    evasion: 0.109,
    hitBonus: 0.22,
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 170,
    armorHp: 35,
    hullHp: 55,
    // 2026-09-16 船长：「**提高电子舰的CPU，提高100**」⇒ **165 → 265**（与掠袭电子舰同批同值；
    // 只动本字段）。D 族本舰盾比 65% 最高、中槽 3 格，加 CPU 后"盾 + 设备"能一起带满。
    cpu: 265,
    droneBayM3: 10,
    maxSpeedMps: 300,
    warpSpeedAus: 3.4,
    massKg: 2_300_000,
    lockRangeM: 51000,
    signatureM: 70,
    scanResMm: 840,
    shieldResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    // 2026-09-17 船长：「D族船，装甲爆炸抗性和结构所有抗性移除」⇒ 本舰只留盾层抗性（0.25×3）
    wormholeScanRadiusBonus: 1,
    description: '陵墓的电子哨戒舰：盾厚甲薄、火控与回避一并拉高，替全队先敌开火；编入虫洞队伍即扩大扫描范围一圈（多艘可叠加）。',
  },
  {
    id: 'sh-wh-d-destroyer',
    name: '陵卫指挥舰',
    role: 'armed', // 2026-09-17 船长：「D 族移动到武装舰，吃武装舰技能」⇒ 由 armored 转入
    subClass: '指挥舰',
    // 子分类「指挥舰」（船长 2026-09-13）：**D 族特色 = 高护盾比（护盾 60%）** · **全舰单发伤害 +15%（取最高、不叠加）** · 机巢 +50% · 无人机伤害 +0.08 · 命中 +0.05 ｜ **速度/机动不再削**（2026-09-13 船长：D 组已非重装族，种族级削弱移除）· 货舱 −25%（子分类级）· 代价 = 甲/壳薄
    slots: { high: 2, mid: 4, low: 4 },
    tier: 2,
    cargoM3: 2700,
    cycleSeconds: 13,
    oreUnitsPerCycle: 16,
    priceIsk: 0,
    agility: 0.45,
    evasion: 0.045,
    hitBonus: 0.11,
    powerBonus: 0.2, // 2026-09-17 船长：武装舰按档位给单发加成（T2 = +20%）
    shieldHp: 230,
    armorHp: 75,
    hullHp: 80,
    cpu: 220,
    droneBayM3: 45,
    maxSpeedMps: 220,
    warpSpeedAus: 3.0,
    massKg: 5_600_000,
    lockRangeM: 46500,
    signatureM: 140,
    scanResMm: 651,
    shieldResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    // 2026-09-17 船长：「D族船，装甲爆炸抗性和结构所有抗性移除」⇒ 本舰只留盾层抗性（0.25×3）
    droneDmgBonus: 0.08,
    fleetDamageBonusPct: 0.2, // 2026-09-26 船长令：「另外一艘指挥舰是陵卫指挥舰，将其效果提高到20%」⇒ 0.15 → 0.20
    description: '陵墓的指挥舰：护盾占比高、并给全编队的单发伤害加两成——多艘指挥舰只取最高、不叠加。代价是甲/壳薄：盾一破就很脆。',
  },
  {
    id: 'sh-wh-d-cruiser',
    name: '陵寝巡洋舰',
    role: 'armed', // 2026-09-17 船长：「D 族移动到武装舰，吃武装舰技能」⇒ 由 armored 转入
    slots: { high: 4, mid: 4, low: 4 },
    tier: 3,
    cargoM3: 9000,
    cycleSeconds: 13,
    oreUnitsPerCycle: 22,
    priceIsk: 0,
    agility: 0.4,
    evasion: 0.04,
    hitBonus: 0.05,
    powerBonus: 0.25, // 2026-09-17 船长：武装舰按档位给单发加成（T3 = +25%）
    shieldHp: 510,
    armorHp: 155,
    hullHp: 255,
    cpu: 300,
    droneBayM3: 50,
    maxSpeedMps: 175,
    warpSpeedAus: 2.7,
    massKg: 12_800_000,
    lockRangeM: 28000,
    signatureM: 200,
    scanResMm: 350,
    shieldResist: {"kinetic":0.25,"explosive":0.25,"plasma":0.25},
    // 2026-09-17 船长：「D族船，装甲爆炸抗性和结构所有抗性移除」⇒ 本舰只留盾层抗性（0.25×3）
    description: '陵墓的重装巡洋舰：盾厚甲薄、炮位最多、舱容最大——靠盾与抗性站在阵线中央。',
  },
  {
    id: 'sh-wh-e-frigate',
    name: '构件鱼雷舰',
    role: 'armed',
    subClass: '鱼雷舰',
    // 子分类「鱼雷舰」（船长 2026-09-13）：族武 爆炸 +0.15 · 命中 +0.03 · 结构血占比提高 ｜ 回避 −25% · 信号 +30% · 机动 −15%
    // 2026-09-14 船长追补（鱼雷舰强化批）：**火力加成 +25 点**（0.25 → 0.50，只喂炮台、不含无人机）｜ 槽位 4/2/2 不动（已在专属 T1 = 8 槽线上）
    slots: { high: 4, mid: 2, low: 2 },
    tier: 1,
    cargoM3: 1000,
    cycleSeconds: 14,
    oreUnitsPerCycle: 8,
    priceIsk: 0,
    agility: 0.7,
    evasion: 0.105,
    hitBonus: 0.17,
    powerBonus: 0.35, // 2026-09-17 船长：「鱼雷舰获得伤害倍率+0.2」⇒ 装甲舰例外：这笔是**子分类**给的（船长：「移除不会影响子类型给予的属性」）
    // ⚠ 2026-09-24 船长裁决：「**鱼雷舰排除出装甲舰不得带档位单发加成的范围内。**」
    // ⇒ 本舰＝档位 T1 +15% ＋ 鱼雷舰子分类 +20% = **+35%**（契约 `content:check` 里鱼雷舰按武装舰口径校验）
    // 2026-09-16 船长：E 族专属舰 盾/甲互换（115↔60，总血 255 不变）⇒ 装甲占比更高 ⇒ 归入「装甲舰」（role 仍 armed）
    // 2026-09-17 船长：抗性一并调整（「不用护盾了…只给装甲抗性」）⇒ 盾层清零、动能抗 0.5 移到甲层；
    // **壳等离子抗 0.25 保留**（船长选甲案：E 族「结构吃等离子轻」的族格与用不用盾无关）。
    shieldHp: 60,
    armorHp: 115,
    armorResist: { kinetic: 0.3, plasma: 0.3 }, // 2026-09-17 船长：装甲舰按档位给**甲层动能+能量**抗性（T1 = 30%）
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    hullHp: 80,
    cpu: 200,
    droneBayM3: 30,
    maxSpeedMps: 315,
    warpSpeedAus: 3.6,
    massKg: 1_600_000,
    lockRangeM: 32000,
    signatureM: 68,
    scanResMm: 640,
    hullResist: {"plasma":0.25},
    weaponFamilyBonus: { explosive: 0.2 },
    description: '巨构的鱼雷舰：爆破弹头拆甲，命中扎实；信号大、转身笨，得靠队友挡在前面。',
  },
  {
    id: 'sh-wh-e-destroyer',
    name: '机库无人机作战舰',
    role: 'armed',
    subClass: '无人机作战舰',
    // 子分类「无人机作战舰」（船长 2026-09-13）：无人机伤害 +0.10 · 机巢 +50% · CPU +15% ｜ 货舱 −30% · 命中 −0.02
    // 槽位对齐基准线（船长 2026-09-14）：专属 T2 = 10 槽；本舰创建即 10（比默认 9 多 1）⇒ 撤销 09-13 批次加的中槽（4/4/3 → 4/3/3）
    slots: { high: 4, mid: 3, low: 3 },
    tier: 2,
    cargoM3: 1960,
    cycleSeconds: 13,
    oreUnitsPerCycle: 12,
    priceIsk: 0,
    agility: 0.6,
    evasion: 0.1,
    hitBonus: 0.14,
    // 2026-09-17 船长：本舰按档位给加成后**移除**原 powerBonus（装甲舰改为按档位给甲层抗性）
    // 2026-09-16 船长：E 族专属舰 盾/甲互换（230↔90，总血 435 不变）⇒ 装甲占比更高 ⇒ 归入「装甲舰」（role 仍 armed）
    // 2026-09-17 船长：抗性一并调整（「不用护盾了…只给装甲抗性」）⇒ 盾层清零、动能抗 0.5 移到甲层；壳等离子抗保留。
    shieldHp: 90,
    armorHp: 230,
    armorResist: { kinetic: 0.3, plasma: 0.3 }, // 2026-09-17 船长：装甲舰按档位给**甲层动能+能量**抗性（T2 = 30%）
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    hullHp: 115,
    cpu: 290,
    // ⟪2026-09-23 船长令⟫ 同上（乙案一并上调）：机舱 105 → **170**（T2「移动机库」定位，按档比例跟抬）
    droneBayM3: 170,
    maxSpeedMps: 275,
    warpSpeedAus: 3.4,
    massKg: 4_600_000,
    lockRangeM: 37000,
    signatureM: 80,
    scanResMm: 540,
    hullResist: {"plasma":0.25},
    droneDmgBonus: 0.1,
    description: '巨构的无人机作战舰：机巢大、机群强，是长时间放飞机群的移动机库；舱位与自射火力都让位给机群。',
  },
  {
    id: 'sh-wh-e-carrier',
    name: '巨构无人机作战舰',
    role: 'armed',
    subClass: '无人机作战舰',
    // 子分类「无人机作战舰」（船长 2026-09-13）：无人机伤害 +0.14 · 机巢 +50% · CPU +15% ｜ 货舱 −30% · 命中 −0.02
    // 槽位对齐基准线（船长 2026-09-14）：专属 T3（巡洋）= 12 槽；本舰创建即 12（比默认 11 多 1）⇒ 撤销 09-13 批次加的中槽（5/5/3 → 5/4/3）
    slots: { high: 5, mid: 4, low: 3 },
    tier: 3,
    cargoM3: 2660,
    cycleSeconds: 14,
    oreUnitsPerCycle: 10,
    priceIsk: 0,
    agility: 0.5,
    evasion: 0.1,
    hitBonus: 0.14,
    // 2026-09-17 船长：本舰按档位给加成后**移除**原 powerBonus（装甲舰改为按档位给甲层抗性）
    // 2026-09-16 船长：E 族专属舰 盾/甲互换（410↔160，总血 770 不变）⇒ 装甲占比更高 ⇒ 归入「装甲舰」（role 仍 armed）
    // 2026-09-17 船长：抗性一并调整（「不用护盾了…只给装甲抗性」）⇒ 盾层清零、动能抗 0.5 移到甲层；壳等离子抗保留。
    shieldHp: 160,
    armorHp: 410,
    armorResist: { kinetic: 0.35, plasma: 0.35 }, // 2026-09-17 船长：装甲舰按档位给**甲层动能+能量**抗性（T3 = 35%）
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    hullHp: 200,
    cpu: 440,
    // ⟪2026-09-23 船长令⟫「巨构无人机作战舰的机舱明显低于王鲭级无人机母舰，不符合设定」⇒ 选**乙**：
    // 机舱 145 → **420**（王鲭级 T3 = 320 ⇒ 专属舰在本项上高约 31%，与说明文「本舰机巢最大」对齐）
    droneBayM3: 420,
    maxSpeedMps: 250,
    warpSpeedAus: 3.1,
    massKg: 9_200_000,
    lockRangeM: 42000,
    signatureM: 105,
    scanResMm: 500,
    hullResist: {"plasma":0.25},
    droneDmgBonus: 0.14,
    description: '巨构的无人机作战舰：本舰机巢最大、无人机伤害最高，放飞即是主武器；舱位让给机库，本舰火力偏辅助。',
  },
  {
    id: 'sh-wh-g-frigate',
    name: '幽影侦察舰',
    role: 'armed',
    subClass: '侦察舰',
    // 子分类「侦察舰」（船长 2026-09-13）：**回避 +35% · 命中 +0.06**（真吃战斗）· **虫洞扫码 +1 圈（编队即生效、可叠加）** · 信号 −35% · 锁定 +25%（纯展示，叙事用）｜ 货舱 −30% · 甲/壳血占比 −25%
    // **侦察舰特性**（船长 2026-09-16）：隐秘行动装置 CPU **×0.5 向上取整**（55 → **28** · 80 → 40）＋
    //   **免推进器失效**（装推进器族也照常隐身）——与鹦鹉螺级测绘巡洋舰同一条特性（数据字段驱动）。
    stealthCpuMul: 0.5,
    stealthIgnoresPropulsion: true,
    slots: { high: 3, mid: 4, low: 1 },
    tier: 1,
    cargoM3: 490,
    cycleSeconds: 14,
    oreUnitsPerCycle: 8,
    priceIsk: 0,
    agility: 0.82,
    evasion: 0.27,
    hitBonus: 0.2,
    powerBonus: 0.15, // 2026-09-17 船长：武装舰按档位给单发加成（T1 = +15%）
    shieldHp: 140,
    armorHp: 45,
    hullHp: 65,
    cpu: 175,
    droneDmgBonus: 0.06, // 亡军系：无人机伤害线（王鲭级 = 0.12）
    droneBayM3: 10,
    maxSpeedMps: 383,
    warpSpeedAus: 4.0,
    massKg: 1_000_000,
    lockRangeM: 47500,
    signatureM: 22,
    scanResMm: 700,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    wormholeScanRadiusBonus: 1,
    description: '亡军的侦察舰：回避极高、火控不弱——编入虫洞队伍即扩大扫描范围一圈（多艘可叠加），它负责先看见别人。',
  },
  {
    id: 'sh-wh-g-destroyer',
    name: '亡军后勤舰',
    role: 'armed',
    subClass: '后勤舰',
    // 子分类「后勤舰」（船长 2026-09-13）：货舱 +45% · 机巢 +50% · 回避 +5% ｜ 命中 −0.03 · 甲血占比 −20%
    // 槽位对齐基准线（船长 2026-09-14）：专属 T2 = 10 槽；本舰创建即 10（比默认 9 多 1）⇒ 撤销 09-13 批次加的低槽（4/4/3 → 4/4/2）
    slots: { high: 4, mid: 4, low: 2 },
    tier: 2,
    cargoM3: 3480,
    cycleSeconds: 13,
    oreUnitsPerCycle: 12,
    priceIsk: 0,
    agility: 0.68,
    evasion: 0.147,
    hitBonus: 0.15,
    powerBonus: 0.2, // 2026-09-17 船长：武装舰按档位给单发加成（T2 = +20%）
    shieldHp: 230,
    armorHp: 75,
    hullHp: 115,
    cpu: 260,
    droneDmgBonus: 0.1,
    droneBayM3: 45,
    maxSpeedMps: 310,
    warpSpeedAus: 3.8,
    massKg: 3_400_000,
    lockRangeM: 44000,
    signatureM: 58,
    scanResMm: 620,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    // **后勤舰特性**（船长 2026-09-16）：「维修装置可以修理血量最少的队友」⇒ 进界面的「船体特性」栏
    repairPulseTargetsFleet: true,
    description: '亡军的后勤舰：货舱与机巢最大，跟着编队补给、换机；火力只求自保。',
  },
  {
    id: 'sh-wh-g-cruiser',
    name: '亡军鱼雷舰',
    role: 'armed',
    subClass: '鱼雷舰',
    // 子分类「鱼雷舰」（船长 2026-09-13）：族武 爆炸 +0.15 · 命中 +0.03 · 结构血占比提高 ｜ 回避 −25% · 信号 +30% · 机动 −15%
    // 2026-09-14 船长追补（鱼雷舰强化批）：**火力加成 +20 点**（0.62 → 0.82）＋ **中槽→高槽**（5/5/3 → 6/4/2，守「专属巡洋 = 12 槽」）；
    //   代价：**命中 −0.10**（0.21 → 0.11）· **回避 −0.10**（0.105 → 0.005，界面显示 1%）⇒ 高单发、低命中、几乎不闪的明牌重锤
    slots: { high: 6, mid: 4, low: 2 },
    tier: 3,
    cargoM3: 3200,
    cycleSeconds: 14,
    oreUnitsPerCycle: 10,
    priceIsk: 0,
    agility: 0.493,
    evasion: 0.005,
    hitBonus: 0.11,
    powerBonus: 0.45, // 2026-09-17：档位 T3 +25% ＋ 子分类鱼雷舰 +20% = +45%（船长：「鱼雷舰获得伤害倍率+0.2」）
    shieldHp: 345,
    armorHp: 185,
    hullHp: 225,
    cpu: 410,
    droneDmgBonus: 0.14, // 比王鲭级（0.12）高一档：亡军的机群是练出来的
    droneBayM3: 60,
    maxSpeedMps: 275,
    warpSpeedAus: 3.5,
    massKg: 7_400_000,
    lockRangeM: 48000,
    signatureM: 101,
    scanResMm: 580,
    // 2026-09-17 船长：本舰的 50 动能抗性已移除（船长 2026-09-17「移除每条船的 50 动能抗性」）
    weaponFamilyBonus: { explosive: 0.2 },
    description: '亡军的鱼雷舰：爆破弹头配扎实命中，专挑大目标的装甲；信号大、转身慢，是明牌重锤。',
  },
]

/** 构建"舰船 id → 定义"目录 */
export function buildShipCatalog(): ReadonlyMap<string, ShipDef> {
  return new Map(SHIPS.map((ship) => [ship.id, ship]))
}
