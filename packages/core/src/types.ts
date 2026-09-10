/**
 * 内容数据的通用类型定义。
 *
 * 说明：引擎（core）不直接认识任何具体技能，只认识"技能这种形状"。
 * 具体内容（采矿学、导航学…）由数据包（@whale/data）提供，这样以后加内容 = 加数据，不用改引擎。
 */

/** 一条技能的定义（数据表里每条记录的格式） */
export interface SkillDef {
  /** 唯一编号，存进存档用的是它（例如 "mining"），改名不影响存档 */
  readonly id: string
  /** 中文显示名，例如 "采矿技术" */
  readonly name: string
  /** 技能组，例如 "工业"、"舰船"（以后按组分类显示/解锁） */
  readonly group: string
  /** EVE 风格难度系数：数值越大每级学得越慢（常见 1~8） */
  readonly rank: number
  /** 单独覆盖基础训练时长（毫秒），不填则用引擎默认 60 秒 */
  readonly baseMs?: number
  /** 一句话说明这个技能以后有什么用 */
  readonly description: string
}

/** 引擎在运行期使用的技能目录（id 快速查表用），由调用方把数据包灌进来 */
export type SkillCatalog = ReadonlyMap<string, SkillDef>

/* ═══════════════════════ M1：物品 / 矿带 / 舰船 ═══════════════════════ */

/** 精炼配方一行：每 1 单位矿石，在产出倍率 100% 下产出多少单位该矿物
 * （2026-09-08 术语：玩家口径「产出倍率」= 引擎 refineRate；2026-09-08 工业收益体检再定：基础 120%、技能最高 165%） */
export interface RefineRow {
  mineralId: string
  /** 每单位矿石产出的矿物单位数（可为小数，实际产量按产出倍率折算后向下取整） */
  perOre: number
}

/** 物品大类（V10）：矿石/矿物为既有体系；气体/冰矿可采集可精炼（接入现有循环）；
 * 弹药/无人机为占位消耗品（市场流通、可囤可回卖，战斗系统开放后启用消耗）；
 * B3（2026-09-05）：wreck = 残骸（打捞回收原料）、fragment = 蓝图碎片（逆向研究素材）；
 * kit（2026-09-05）：修理组件（消耗品，repairRestore = 基础回复 HP 固定值，结构/装甲
 * 各按层容量增幅——2026-09-08 船长纠正：不是百分比） */
export type ItemKind = 'ore' | 'mineral' | 'gas' | 'ice' | 'ammo' | 'drone' | 'wreck' | 'fragment' | 'kit'

/** 伤害类型（V10.5 战斗数值契约：远行星号体系——动能/高爆/能量三系） */
export type DamageType = 'kinetic' | 'explosive' | 'plasma'

/** 一层装甲/护盾对三系伤害的减伤（V10.5b：EVE 式"每层多抗"的 3 类型版；0~0.9，缺省 0） */
export type DamageResists = Partial<Record<DamageType, number>>

/** 无人机等小型作战单位的生存包（V11 补：三层血量/抗性/回避；
 * v1 无人机并入主船火力不单独承伤，数据为"可被击落"机制的零迁移契约） */
export interface DroneDefense {
  shieldHp: number
  armorHp: number
  hullHp: number
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
  /** 基础回避 0~0.9（小体积无人机应偏高） */
  evasion?: number
}

/** 物品定义（矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机都属于物品） */
export interface ItemDef {
  id: string
  /** 中文名：富凡晶石、三钛合金…… */
  name: string
  kind: ItemKind
  /** 每单位占用货舱体积（立方米），矿石 1 m³，矿物很小 */
  unitM3: number
  /** 空间站收购单价（ISK/单位，展示/兜底用；市场权威价见 marketCatalog.basePrice） */
  baseSellPriceIsk: number
  /** 一句话介绍（哪里产出、有什么用） */
  description: string
  /** 精炼配方：矿石/气体/冰矿带配方（产物必须是矿物） */
  refine?: readonly RefineRow[]
  /** 精炼运转周期（工业细化）：单批单位（该资源每批入炉单位数） */
  refineBatchUnits?: number
  /** 精炼运转周期（工业细化）：单批周期毫秒（5~10 秒节奏；缺失时 core 兜底默认） */
  refineCycleMs?: number
  /* ═══ V10.5 战斗数值契约（弹药/无人机用；引擎战斗实现后启用） ═══ */
  /** 伤害类型（弹药/无人机） */
  damageType?: DamageType
  /** 单发/单架伤害基数（弹药/无人机；抽象战斗单位） */
  dmg?: number
  /** 放飞占用 CPU（仅无人机；V10.5b：带宽并入 CPU——装备与无人机共用船体 CPU） */
  cpuUse?: number
  /** 生存包（仅无人机；V11：三层血量/抗性/回避契约） */
  defense?: DroneDefense
  /** 武器射程上限（仅无人机；2026-09-10 船长拍板按机型分类——蜂鸟 2500/赤鸢 3000/
   * 猎鹰 3500/雷鸥哨戒 5000；combat 读此值，缺省兜底 2600；射程扩展装置在此基础上叠加） */
  maxRangeM?: number
  /** 无人机分类（2026-09-10 船长拍板：显式字段——侦察机/战斗机/攻坚机/哨戒机，与射程分类
   * 一一对应；界面「种类」显示为「无人机 · 侦察机」，未来筛选/排序/掉落复用同一权威来源） */
  droneClass?: DroneClass
  /* ═══ 无人机命中（2026-09-10 船长拍板：命中/衰减下放到机型本体，不再由引擎硬编码） ═══ */
  /** 放飞基础命中率 0~1（命中 = (hitRate + 攻方命中加成) × 距离衰减 − 守方回避）；
   * 侦察/战斗/攻坚三型 = 0.75 且**命中不随距离衰减**（见 falloff）；哨戒 = 1.10（保留衰减） */
  hitRate?: number
  /** 命中衰减系数 0~1：射程端点命中倍率（越接近射程上限线性跌落至此）。
   * **1 = 不随距离衰减**（射程带内命中恒定）；哨戒 0.35 = 正常衰减 */
  falloff?: number
  /**
   * T8 修理组件 seam（内容后续添加，如"纳米修理组件"）：单件可修复的船体耐久比例（0~1）。
   * 重复清剿等自动流程会优先消耗货仓内这类物品修复耐久（按耐久 < 0.5 阈值判定），
   * 用完仍不足才停下提示返港维修。
   */
  repairRestore?: number
}

/** 无人机分类（2026-09-10 船长拍板；与射程分类一一对应：侦察机 2500 / 战斗机 3000 /
 * 攻坚机 3500 / 哨戒机 5000） */
export type DroneClass = 'scout' | 'combat' | 'assault' | 'sentry'

/** 矿带/采集点定义：可采集资源（矿石/气体/冰矿）。V16 起支持复合产出池 */
export interface BeltDef {
  id: string
  name: string
  /** 主产物资源 id（须在物品表里存在且 kind ∈ ore/gas/ice）；单产带 = 唯一产物 */
  oreId: string
  /**
   * V16 复合产出池（可选）：多个候选资源按权重抽取——每个采掘循环掷一次决定本循环产物
   * （长期平均分布 = 权重）。缺省 = 只产 oreId（不掷权，既有确定性/rng 完全不变）。
   */
  outputs?: ReadonlyArray<{ itemId: string; weight: number }>
  /** 需要的协会声望（V10：高价值矿带按声望阶梯解锁；缺省 0 = 无门槛） */
  standingReq?: number
  /**
   * 所在星系（星图拓展版）：缺省 = 母港本地（周转不额外计航程）。
   * 填写后：单程周转 = 基础 4 分钟 + 该星系距母港的最短航程分钟。
   */
  galaxyId?: string
  description: string
}

/** 舰船角色（V10 展示用；战斗系统落地后决定各角色的战斗数值曲线） */
export type ShipRole = 'industrial' | 'armed' | 'armored' | 'hauler'

/** 舰船定义 */
export interface ShipDef {
  id: string
  name: string
  /** 档次 1/2/3/4，仅用于展示排序 */
  tier: number
  /** 船型角色（V10：舰船细分系统的占位字段，本轮仅 UI 徽标展示） */
  role: ShipRole
  /** 货舱容量（立方米） */
  cargoM3: number
  /** 单个采集循环耗时（秒），受技能缩短 */
  cycleSeconds: number
  /** 每个循环的基础产量（单位资源），受技能加成 */
  oreUnitsPerCycle: number
  /** 空间站售价（ISK），0 = 初始自带或仅可制造 */
  priceIsk: number
  /** 动力/机动性 0~1（v7）：越高越容易在交火失利时脱离，降低弃船率 */
  agility: number
  /** 基础火力加成（V10.5 契约：战斗系统启用；本轮引擎不读取） */
  powerBonus?: number
  /** 船体武器族加成（EVE 式族加成，2026-09-09 船长拍板：四族巡洋分型——只作用于对应弹型的
   *  三族武器条目单发，装别族武器无加成但仍可用；无人机/基础舰炮不受；值 = 比例，如 0.12 = +12%） */
  weaponFamilyBonus?: Partial<Record<DamageType, number>>
  /** 船体无人机专属加成（2026-09-10 船长拍板：无人机舰的加成改成"专属"——原来那笔 powerBonus
   *  只喂炮台、对机群无效，等于把母舰往炮舰方向推）。只乘入**放飞无人机单发**，与战术导控
   *  与无人机作战学**乘算**；对称于武器族加成。现挂：王鲭级 +12%、梭鱼级 +8% */
  droneDmgBonus?: number
  /* ═══ V10.5 战斗数值契约（三层血量；引擎战斗实现后启用） ═══ */
  /** 护盾层基础量（抽象战斗单位） */
  shieldHp?: number
  /** 装甲层基础量 */
  armorHp?: number
  /** 结构层基础量（V10 占位字段 hull 已由本字段取代） */
  hullHp?: number
  /** 护盾层对三系伤害的基础抗性（简化规则：每层至多一个主抗型、取值整数档 0.25/0.5，其余键省略 = 0） */
  shieldResist?: DamageResists
  /** 装甲层对三系伤害的基础抗性（同上：整数主抗制） */
  armorResist?: DamageResists
  /** 结构层对三系伤害的基础抗性（同上：整数主抗制） */
  hullResist?: DamageResists
  /* ═══ V10.5b：装配资源与间接属性（契约占位；CPU=装备与无人机共用，带宽已并入） ═══ */
  /** CPU 总量（抽象单位：装配模块与放飞无人机共同消耗；引擎战斗期校验） */
  cpu?: number
  /**
   * V18 高/中/低槽布局（每类槽的安装位数量；复数安装·数量制——缺省 {1,1,1}，
   * 正式内容全部显式标注；19 船草案表见 docs/design/v18-slots.md §四）。
   */
  slots?: ShipSlots
  /** 无人机舱容量（m³，携带上限之一；0 = 无无人机舱） */
  droneBayM3?: number
  /** 无人机放飞所需的 CPU 占位资源已在 ItemDef.cpuUse；此处不重复定义 */
  /* ── 间接属性（EVE 参考；显示优先级低：仅装配界面展示；数值占位、战斗作用待战斗系统定） ── */
  /** 最大速度 m/s */
  maxSpeedMps?: number
  /** 跃迁速度 AU/s */
  warpSpeedAus?: number
  /** 质量 kg */
  massKg?: number
  /** 锁定范围 m */
  lockRangeM?: number
  /** 信号半径 m */
  signatureM?: number
  /** 扫描分辨率 mm */
  scanResMm?: number
  /* ── 已移除（V16.1 简化）：锁定目标数 maxTargets（引擎无引用，纯展示冗余）；起跳时间 alignSec（语义反直觉，
     由派生属性"跃迁充能"取代：跃迁充能速率 = 动力(agility)×200%，动力越高充能越快，仅展示挂钩） ── */
  /* ═══ V11 战斗：命中/回避（与信号/锁定挂钩，见命中公式） ═══ */
  /** 基础回避率 0~0.9（被命中减算；受自身信号半径修正：小信号更难打中） */
  evasion?: number
  /** 命中率加成 0~0.5（打敌方时加到武器命中率上；受自身扫描分辨率修正） */
  hitBonus?: number
  description: string
}

/** AI 核心类型（v8：玩家的"分身"，效率决定副船工作速度；效率不影响奖励） */
export type AiCoreType = 'basic' | 'gamma' | 'beta' | 'alpha'

/* ═══════════════ V9：市场 ═══════════════ */

/** 商品稀有度：常驻（库存池 + 稳定订单）/ 稀有（低频供应、溢价）/ 限定（极低频、天价） */
export type MarketRarity = 'common' | 'rare' | 'exotic'

/** 商品大类 */
export type MarketGoodKind = 'item' | 'module' | 'ship' | 'blueprint' | 'aicore'

/** 市场目录条目（data 提供；价格量纲 = ISK/单位，蓝图/船/核心为单件） */
export interface MarketGoodDef {
  /** 唯一键：'ore-veldspar' / 'mod-miner-1' / 'ship-whale' / 'bp-miner-1' / 'core-gamma' */
  key: string
  kind: MarketGoodKind
  refId: string
  rarity: MarketRarity
  /** 基准价（池/订单价格围绕它演化） */
  basePrice: number
  /** 常驻商品：NPC 目标库存（池模型，单位数） */
  poolTarget?: number
  /** 常驻商品：NPC 供应单的稳态流量（玩家买入侧保障量级） */
  supplyFlow?: number
  /** 站内让利吸收：每窗基础吸收额覆写（2026-09-08 船长定，缺省按类别推导：
   * 池商品 = supplyFlow（或 poolTarget/120）、common 单件 = 1、rare = 0.3、奇货 = 0.1 件/窗） */
  absorbQtyPerWindow?: number
  /** 稀有/限定：NPC 供应单的倍数（basePrice × 该值 = 刷出售价） */
  supplyMultiplier?: number
  /** 收购档位（2026-09-08 船长定：收购价 = 该倍率 × L；单件缺省按 rarity = common 0.6 /
   * rare 0.65 / exotic 1.0；池商品留空 = 原料平价 1.0L，池耗材显式 0.6。防套利：
   * 收购恒低于供应价，倒买倒卖恒亏税） */
  demandMultiplier?: number
  /** 玩家可否卖出（默认 true） */
  playerSellable?: boolean
  /** 玩家可否买入（默认 true） */
  playerBuyable?: boolean
  /** 需要的协会声望（V10：部分高端商品声望解锁；买入时校验，卖出不限） */
  standingReq?: number
  /** 暗市双通道声望闸（P2 2026-09-06 船长定：rare 抽取节拍 + 暗市单可绕过）：
   * 声望低于本值 → 该商品为"闸内"：不占常驻供给线，以 RARE_LOCKED_WEIGHT 低权重参与每
   * RARE_DRAW_PERIOD_MS（10 分钟）的加权有放回抽取，命中即暗市单：价 ×4、标记 bm、
   * 可绕过常驻拦截买入；常驻挂单不开放。达标后整批解锁：恢复正常权重/正常价（不转为常驻商品）。
   * 与 standingReq 正交：standingReq = 纯硬拦（现役顶船维持，不加暗市）。 */
  bmStanding?: number
  /** 数字稀有度（2026-09-09 船长拍板：稀有度入物品本体——data 层 RARITY_TIER 表，
   * 构建 SimContext 时按 refId 填充；市场/图鉴/未来掉落统一查）。档位：1 常驻层、
   * 2/3 稀有订单层（2 大众/3 高阶）、4 奇货层。与 rarity 渠道分离：**只驱动稀有订单渠道
   * 的刷新权重**（卖单抽取 + NPC 收购窗），奇货渠道出率与数字不挂钩 */
  rarityTier?: number
}

/** 市场平衡参数 */
export interface MarketBalance {
  /** 撮合/刷单窗口（毫秒） */
  tickMs: number
  /** 订单寿命（按稀有度，毫秒） */
  orderLifeMs: Record<MarketRarity, number>
  /** 池向目标回归的半程时长（毫秒） */
  poolRegenHalfMs: number
  /** 每窗口 NPC 常驻供需单刷新数量 */
  commonFlowPerWindow: number
  /** 稀有商品每 60s 窗刷新供应单的概率（P2 节拍制 2026-09-06 起 unused——rare 改为百分比
   * 抽取，见 market.ts RARE_PCT_* 与 RARE_DRAW_PERIOD_MS；字段保留以兼容数据/档） */
  rareWindowChance: number
  /** 限定商品每个抽取窗（10 分钟）独立掷骰的出单概率：0.8%×现货抢购学（约每件每 20.8 小时一轮） */
  exoticWindowChance: number
  /** 数字稀有度 3 档权重（2026-09-09 船长拍板：稀有订单渠道按数字分层——3 档（高阶）刷新
   * 权重乘子，2 档（大众）= 1；作用于 rare 卖单抽取与 NPC 收购窗；系数经 market-rarity-sim 校准） */
  rareTier3Weight: number
  /** 窗口净成交量超过该比例（相对参考量）时触发冲击 */
  shockTriggerRatio: number
  /** 每次冲击的价格偏移（比例，可正可负；叠加无上限） */
  shockPerTrigger: number
  /** 冲击衰减半程（毫秒） */
  shockDecayHalfMs: number
  /** 慢速均值回归噪声：均值回归半程（毫秒）——让常驻行情即使无人交易也温和起伏 */
  noiseHalfLifeMs: number
  /** 慢速均值回归噪声：每窗口随机游走增量半幅（价格比例；叠加冲击/压力后形成真实曲线） */
  noiseStep: number
  /** 价格输出下限/上限（相对 basePrice），防归零/溢出 */
  minPriceRatio: number
  maxPriceRatio: number
  /** 内部消化队列每窗口消化比例（冲突订单随时间推进消化） */
  digestPerWindow: number
  /** 站内让利吸收（2026-09-08 船长定：吸收量与价格挂钩）：
   * 卖单挂价每低于买盘价 1 个百分点，该单每窗站内吸收额放大该倍率（线性，乘吸收 MaxMul 封顶） */
  absorbPerPoint: number
  /** 站内让利吸收：折价放大上限（默认 5×；折价 10% 即封顶） */
  absorbMaxMul: number
  /** 建站收购网络扩容（2026-09-09 船长定：每建成一座副站，玩家"单件商品"卖出吞吐 ×本值，
   * 乘法叠加无封顶：boost = builtSellMulPerSite^N（N = 已建成副站数）。只作用于单件商品
   * （装备/蓝图/船等件货的 NPC 收购单与站内吸收配额），池商品不受影响。 */
  builtSellMulPerSite: number
  /** 参考成交量（用于冲击归一化）：默认 = poolTarget 的该比例 */
  referenceVolRatio: number
  /** 贸易税（销售税）：玩家卖出成交按此比例征税（ISK 回收阀） */
  salesTaxRate: number
  /** 贸易税减免技能 A（会计学）与技能 B（贸易谈判学）：每级各减免该比例（线性相加） */
  taxSkillAId: string
  taxSkillBId: string
  /** 每个技能每级的税率减免比例（两个技能满级合计减免 80% = 2×5×8%） */
  taxCutPerLevel: number
  /** 两侧"抢单"（2026-09-08 船长定：越线挂单每 60s 窗小概率成交，见 market.ts matchPlayerOrders）：
   * 卖单挂价 > 收购价线时命中概率 = snatchSellChance × e^(−snatchSellDecay × r)，
   * r = 挂价超出收购价线的比例；每窗每单一次掷骰，命中成交 1 件 @ 挂单价 */
  snatchSellChance: number
  /** 卖出侧抢单衰减系数（r 越大命中越低；高挂 = 赌小概率好价） */
  snatchSellDecay: number
  /** 买单挂价 < 供应价线时命中概率 = snatchBuyChance × e^(−snatchBuyDecay × s)，
   * s = 挂价低于供应价线的比例 */
  snatchBuyChance: number
  /** 买入侧抢单衰减系数 */
  snatchBuyDecay: number
}

/**
 * 数值平衡配置：采矿/精炼/制造/远征/AI/市场的公式系数与加成技能。
 * （系数放 core 只为单点调参；技能 id 是内容层约定，改技能 id 时须同步 data。）
 */
export interface BalanceConfig {
  mining: {
    /** 产量加成技能 id（技能表里是"采矿技术"） */
    yieldSkillId: string
    /** 该技能每级产量加成（如 0.06 = 6%） */
    yieldPerLevel: number
    /** 循环时间缩减技能 id（技能表里是"采矿护卫舰操作"） */
    timeSkillId: string
    /** 该技能每级循环时间缩减比例（如 0.03 = 3%） */
    timePerLevel: number
    /**
     * 采矿显式行程的"满载/返航单程"进出港基础时长（毫秒；T4，船长定稿 120 秒）：
     * 本地/无星系归属矿带单程 = 该值；远处矿带单程 = 航程 + 该值。
     * 出航（空船出门）时跃迁速度×2 → 出航单程 = 该基础腿的一半（见 mining.ts oneOutboundLegMs）。
     */
    localLegMs: number
  }
  refining: {
    /** 基础产出倍率（1.0 = 100%；2026-09-08 起基础即满额，配方已 ÷2 等价迁移） */
    baseRate: number
    /** 主产出倍率技能 id（"精炼学"） */
    rateSkillId: string
    /** 产出倍率每级提升（精炼学 +8%） */
    ratePerLevel: number
    /** 次级产出倍率技能 id（"高级回收处理"） */
    secondRateSkillId: string
    /** 产出倍率每级提升（高级回收处理 +4%） */
    secondRatePerLevel: number
  }
  manufacturing: {
    /** 制造时间缩减技能 id（"工业理论"） */
    timeSkillId: string
    /** 该技能每级制造时间缩减比例（如 0.05 = 5%） */
    timePerLevel: number
  }
  combat: {
    /** 基础火力（初始舰炮） */
    basePower: number
    /** 火力加成技能 id（"炮术学"） */
    gunnerySkillId: string
    /** 每级火力加成 */
    powerPerLevel: number
    /** 胜率下限/上限 */
    minWinChance: number
    maxWinChance: number
    /** 失败修理费 = 期望奖励 × 该比例（ISK） */
    defeatCostRatio: number
    /** 每次远征失利扣耐久区间（0~1） */
    durabilityLossMin: number
    durabilityLossMax: number
    /** 弃船率下限/上限 */
    minAbandonChance: number
    maxAbandonChance: number
    /** 动力减免系数：弃船率 ×(1 - 该系数×agility) */
    agilityEscapeFactor: number
    /** 耐久惩罚：弃船率 ×(该系数 + (1-该系数)×durability)，耐久越低越危险 */
    durabilityFactor: number
  }
  aiCore: {
    /** 提升「同时启用 AI 核心上限」的技能 id（共用上限 = AI 副船任务 + 站内 AI 设施；多技能叠加见 ai.ts aiCoreCap） */
    skillId: string
    /** 2026-09-08 船长定：工业专用扩容技能表——表内技能每级 +industrySlotsPerLevel 枚
     * 「工业专用 AI 工位」（只对站内精炼炉/回收炉/制造线生效，不增加 AI 副船任务上限） */
    industrySkillIds: readonly string[]
    /** 工业专用扩容：每级新增工位枚数 */
    industrySlotsPerLevel: number
    /** 卷B3⑩（2026-09-08 船长定）：AI 核心调度学 id——核心驱动的全部作业效率在核心档位之上
     *  每级 +2 个百分点累加（如基础核心 40% → 满级 50%；封顶 100%；返航腿不参与，卷B2⑥ 口径） */
    dispatchSkillId: string
    /** 卷B3⑩：调度学每级效率累加（默认 0.02 = +2 个百分点/级，满级 40% → 50%） */
    dispatchPerLevel: number
    /** 基础 AI 核心单价（ISK，空间站直购；更高级核心由远征掉落） */
    basicPriceIsk: number
    /** 各类型核心的效率（速度系数：1 = 玩家手操速度；只影响速度，不影响奖励） */
    efficiency: Record<AiCoreType, number>
    /** 远征胜利后的核心掉落规则：按目标威胁匹配（取最高的 minThreat），逐条掷骰 */
    drops: readonly {
      minThreat: number
      rewards: readonly { type: AiCoreType; chance: number }[]
    }[]
  }
  repair: {
    /** P2 定稿：港内维修单价 = ISK / 1 HP（甲+结构缺失按各自满值池折算）× 舰船科技档权重 */
    perHpCost: number
  }
  market: MarketBalance
  /** V11 战斗引擎常量（命中/距离动力学/敌方换算/战术/弹药预载） */
  battle: BattleBalance
  /** B1 低安遭遇 / 伏击（sec<0 星系活动的风险涟漪） */
  encounter: EncounterBalance
  /** 随机事件节奏（V11）：到达式触发，间隔 10~30 分钟、越接近上限越可能到期 */
  events: {
    /** 总开关（测试等场景可关闭事件流，避免干扰确定性断言） */
    enabled: boolean
    /** 最短间隔：此之前不会触发 */
    minGapMs: number
    /** 最大间隔：到点 100% 触发 */
    maxGapMs: number
    /** 间隔分布幂（1 = 均匀；越大间隔越偏向后段、短间隔概率越低） */
    gapPower: number
    /** 四大类相对权重：宇宙奇遇 / 航行叙事 / 市场行情突变动 / 市场奇货（稀有单/高价收购） */
    miscWeight: number
    voyageWeight: number
    marketShockWeight: number
    marketOrderWeight: number
    /** 扫描探索作业进行期间，事件倒计时按 (1 + exploreBoost) 倍速推进（如 1.0 = ×2，事件来得更快） */
    exploreBoost: number
    /** 随机事件现金奖励 · 已探索星系加成（2026-09-10 船长：探索越多事件奖金越高——
     *  奖励 ×(1 + min(cap, 已探索星系数 × 本值))；cap 1 = 封顶 ×2） */
    exploreBonusPerGalaxy: number
    exploreBonusCap: number
  }
  /** 富矿脉基础触发率（每分钟，卷B2⑥ 2026-09-08 船长定稿：掷点按"该循环占用分钟数"缩放后判定；
   *  命中 = 连续 2 循环 ×3；0 = 禁用，测试用它关富矿保 rng 时序） */
  richVeinChance: number
  /** 完好舰体命中率（每分钟，卷B3⑨ 2026-09-08 船长定稿：掷点按"该打捞轮占用的分钟数"缩放；
   *  命中 = 当场直发敌群回收彩头；0 = 禁用，测试用它关完好舰体保 rng 时序） */
  intactHullRatePerMin: number
  /** 完好舰体命中后的低安 MK2 层概率（仅 sec<0 星系掷；价值 ≈25 万级大奖，频率压低） */
  intactMk2Chance: number
  /** 远征出发时遇到"途中事件"的概率（M5） */
  travelEventChance: number
  /** 远征胜利奖金浮动范围（×0.85 ~ ×1.15 之类） */
  rewardJitter: number
  /** 星图航行（V12.1）：飞船跃迁速度 + 航行加速技能族共同决定星系间实际耗时 */
  travel: TravelBalance
}

/** B1 低安遭遇 / 伏击：占用随机事件时机；到达缓冲 + 到点遇袭概率（2026-09-04 定稿） */
export interface EncounterBalance {
  /** 高安阈值：星系安全等级 ≥ 此值不掷 */
  highSecSafe: number
  /** 遭遇后同一星系的冷却毫秒（区域事件不叠加） */
  zoneCooldownMs: number
  /** 在线「伏击待决」邀约等待毫秒（超时未响应 → 自动按文字结算） */
  inviteWaitMs: number
  /** 到达低安地点后的缓冲毫秒（期间绝不遇袭） */
  entryBufferMs: number
  /** 事件到点遇袭率基线（sec = 0） */
  ambushChanceAtZero: number
  /** sec 每降 1.0 的遇袭率增量（线性，封顶约 0.9） */
  ambushChancePerSec: number
  /** 低安扫描中遇袭率乘数（船长 2026-09-05 定：×1.5，封顶 0.9；扫描即暴露、无入场缓冲） */
  scanAmbushMul: number
  /** 受损档：耐久扣损区间（底 clamp 5% 绝不弃船） */
  duraLossMin: number
  duraLossMax: number
  /** 被抢：至多损失船上货物比例（无货则抢钱包） */
  lootTakenMaxPct: number
  /** 被抢（无货时）：至多损失钱包 ISK 比例 */
  iskTakenMaxPct: number
  /** 击退 / 胜利缴获（2026-09-09 船长定）：= 伏击敌群（当地可见悬赏敌群）赏金 × 本系数（0.5 = 五折）；
   *  旧档遗留无 anomalyId 的遭遇按 威胁 × 1 兜底；缴获不计首胜/声望 */
  lootFracOfBounty: number
}

/** V12.1 星图航行平衡常量 */
export interface TravelBalance {
  /** 基准跃迁速度（AU/s）：warp = 该值时航程 = 标称分钟；高于它则更快、低于则更慢（反比） */
  warpRefAus: number
  /** 时间因子下限（防极端组合把航程压没） */
  minFactor: number
  /** 航行加速技能族（效果趋同统一）：每级各按 cutPerLevel 缩短星图航行时间（乘算） */
  skillIds: readonly string[]
  /** 每个技能每级的时间缩减比例（如 0.04 = 4%） */
  cutPerLevel: number
}

/** 敌方战术性格（V11）：brawl 贴脸近战 / orbit 中距绕圈 / kite 拉远吊打 */
export type FoeTactic = 'brawl' | 'orbit' | 'kite'

/** 敌方血型（V11）：盾型 / 甲型 / 均衡（决定敌方三层血量比例） */
export type DefProfile = 'shield' | 'armor' | 'balanced'

/** V11 战斗平衡常量（唯一调参处；初值在校准脚本阶段核对） */
export interface BattleBalance {
  /** 命中率输出钳制：开放边界 0% / 100%（贴脸高加成场合可必中、极端劣势可完全脱靶） */
  hitMin: number
  hitMax: number
  /** P0 承伤持久化：护盾战中被动回充（每秒回充 = 满盾 × 此比例；0 = 关，初值见 balance） */
  shieldRegenPerSec: number
  /** 多波次转场（2026-09-09 船长建议）：下一波出现时把战斗距离向开战距离回拉的比例
   * （0 = 原地续战；1 = 完整回到开战距离重新接近；默认初值见 balance） */
  waveReopenFrac: number
  /** 多波次演出间隔（2026-09-09 船长反馈）：一波全灭后空转等待该时长（爆炸/残骸演出播完）
   * 再刷下一波；0 = 立即续刷（旧行为） */
  waveEnterGapMs: number
  /** 炮术学每级单发伤害加成（0.05 = +5%/级） */
  gunneryDmgPerLevel: number
  /** V18B 武器族技能（2026-09-05 一号按交接底稿接入）：模块槽族 → 专精技能 id；
   * 每级单发伤害加成 = familySkillPerLevel（与 gunnery 乘算；构建期折算进各条目） */
  familySkillIds: Record<'turret' | 'missile' | 'laser', string>
  familySkillPerLevel: number
  /* ═══ 舰船属性成长技能（2026-09-05 一号按盘点补；数值 C4 复核）═════════════
     CPU：只提高船体 CPU 总量（装配+无人机放飞共用预算），不改单件成本；
     机动速度：乘于 船速×推进器 之上；回避：缺口收窄（与姿态陀螺缺口复合）；
     命中：乘于 船体 hitBonus，作用于打敌命中加成。 */
  cpuSkillId: string
  cpuPerLevel: number
  speedSkillId: string
  speedPerLevel: number
  evasionSkillId: string
  evasionPerLevel: number
  hitSkillId: string
  hitPerLevel: number
  /** 距离动力学：距离下限（贴脸极限）与开战距离 = 双方最远武器射程×openRangeFactor
   *  + max(openRangePadM, 最远射程×openRangePadShare)（船长 2026-09-05：缓冲按射程比例拉开） */
  minDistanceM: number
  openRangeFactor: number
  openRangePadM: number
  /** 缓冲比例：开战缓冲 = max(100m 下限 openRangePadM, 双方最远射程×本比例)（默认 0.1 = 10%） */
  openRangePadShare: number
  /** 舰船 maxSpeedMps 参与距离收敛的比例（战斗机动速度 = speed × speedFactor ×(1±agilitySpeedBonus)） */
  speedFactor: number
  agilitySpeedBonus: number
  /** C4 血量曲线（2026-09-05）：D = DMin + DSpan×((T−floor)/span)^exp；敌血 = 参考火力×D */
  foeHpCurveDMin: number
  foeHpCurveDSpan: number
  foeHpCurveExp: number
  foeHpCurveFloorThreat: number
  foeHpCurveSpanThreat: number
  /** 参考火力段表（无技能解析对射 DPS：威胁上界 → dps）——血量反推基准，可微调 */
  foeRefFire: ReadonlyArray<{ upToThreat: number; dps: number }>
  foeDpsPerThreat: number
  foeHitRate: number
  /**
   * 动能/爆炸高命中等效补偿（2026-09-08 船长方案 A）：命中提高 + 单发按 1/命中 等比降后，
   * 守方回避 >0 时期望承伤仍会上升——本系数对非能量敌单发再乘（锚点 ≈ 典型回避 0.22 ×
   * 中距衰减 0.7 的旧 0.55 模型折算 ≈0.62，可迭代校准）；能量光束（effHit=1）不消费。
   */
  foeHitCompMul: number
  foeReloadMs: number
  foeFalloff: number
  /* C4-#3 敌方"虚拟装配"模板（2026-09-05 船长拍板：威胁越高全属性越高，侧重随战术风格） */
  /** 参考船速分段表（threat 上界 → 等效船体 maxSpeed m/s；与玩家船速同池，无推进口径） */
  foeRefSpeedTable: ReadonlyArray<{ upToThreat: number; maxSpeedMps: number }>
  /** 敌速基数端点：threat 10 → 玩家参考 ×lo；threat 100 → ×hi（无推进玩家多数持平/略快） */
  foeSpeedAtThreat10: number
  foeSpeedAtThreat100: number
  /** 战术风格速度系数（brawl 贴脸再高 10~20%，见船长指示） */
  foeSpeedTacticMul: Record<FoeTactic, number>
  /** 敌速绝对上限 = 参考船速 × 此值（留"推进可甩/脱战"窗口） */
  foeSpeedCapMul: number
  /** 射程成长侧重系数：scale = 1 + 系数×(threat−10)/90（brawl 少增、kite 多增） */
  foeRangeGrowMul: Record<FoeTactic, number>
  /** 敌最远射程封顶（玩家射程天花板 + 余量；压制穿越时间目标 ≤12s） */
  foeRangeCapM: number
  /** 敌期望交战距离系数 = 自身武器带内站位（0.2 贴脸近端 / 0.55 环绕 / 0.85 风筝远端；值域 [0.05,0.95]） */
  tacticDesireFactor: Record<FoeTactic, number>
  /** 弹药预载：估计交战时长上限 ms 与余量系数（出发按射速预载，结束退回） */
  ammoTimeCapMs: number
  ammoMargin: number
  /** 战斗时长硬上限：超时按双方剩余血量比判胜（未分出胜负的保险） */
  maxBattleMs: number
  /** 预估胜率扩散（logit 拉伸倍数，0.5 为不动点）：越高胜率加成越高、越低胜率惩罚越重——
   * 作用于悬赏展示与 AI 接单门槛（实际战斗结算不变） */
  winSpread: number
  /** AI 远征 favor 强度：开战按该船对此目标的模型胜率算优势 adv=(raw−0.5)×2，
   * 整场 AI 方命中 ×(1+k·adv)（上限 100%）、敌方 ×(1−k·adv)（上限保留 97%）——
   * 保证已过门槛的简单局接近必胜；仅 AI 远征生效，玩家手动战斗不受影响 */
  aiFavorStrength: number
  /** 击杀慢镜：战斗分出胜负后延迟结算的毫秒数（给最后一击动画与战败演出留时间；
   * 仅主控远征生效，AI 后台任务即时结算） */
  killcamMs: number
  /** 带伤预警扣分（2026-09-08 船长定：只作用于悬赏展示胜率——预计装甲全损扣 winPenaltyArmorPerFull、
   * 预计结构损耗额外按 winPenaltyHullPerFull；实际结算与 AI/模拟预估一律不变） */
  winPenaltyArmorPerFull: number
  /** 结构损耗预警扣分系数（结构伤比装甲伤扣得更重 = 船长的"更大幅度下调"） */
  winPenaltyHullPerFull: number
  /* ═══ 敌舰近防炮（2026-09-10 船长拍板「无人机可被击落」，永久损失制）═══ */
  /** 点防起始威胁：威胁 < 此值的敌舰不装近防炮（2026-09-10 船长：60） */
  pdThreatFloor: number
  /** 判定周期（毫秒）：每艘点防舰每 0.5 秒判定一次伤害 */
  pdJudgementMs: number
  /** 判定命中率（直接与机型闪避相减；不叠敌方通用命中加成） */
  pdAcc: number
  /** 命中单发伤害（走该机型三层抗性） */
  pdDmg: number
  /** 单场最多击落比例（相对本场放飞总数；防止一次团灭） */
  pdMaxLossFrac: number
}

/**
 * 装备家族（V10 六值 + V18 无人机装置两值 + V18.1 支援件一值 + V18B-1 导弹架一值：
 * 家族语义是引擎构建与 UI 徽标依据，不是物理槽；V18.1 起无"同类唯一"——多件收敛
 * 靠合成机制，见 equipment.stackingOf）。V18 起物理槽由 RackSlot（高/中/低 × 数量制）
 * 表达——归槽见 ModuleDef.rack / labels.rackOf。
 * 武器形态映射（V18B 起按伤害系分形态，取代"同 MK 同参只换弹种"的临时炮数据）：
 * 动能 = 质量炮（turret）、爆炸 = 导弹架（missile）、能量 = 激光炮（laser）——
 * 激光：必中（不掷命中）+ 距离衰减作用于威力（幅度为命中衰减的 50%）+ 消耗能量弹药。
 */
export type ModuleSlot =
  | 'miner'
  | 'cargo'
  | 'turret'
  | 'missile'
  | 'laser'
  | 'salvager'
  | 'shield'
  | 'armor'
  | 'propulsion'
  | 'drone-rack'
  | 'drone-tac'
  | 'drone-relay'
  | 'support'
  | 'target-lock'

/** V18 槽类（高/中/低；数量制无尺寸位）。舰船槽位布局 = ShipDef.slots 数量 */
export type RackSlot = 'high' | 'mid' | 'low'

/** 舰船三类槽位布局（V18：每类槽的安装位数量；复数安装 = 每槽位可装一件该类的模块） */
export interface ShipSlots {
  high: number
  mid: number
  low: number
}

/**
 * V18 已装配模块：三类位数组（每数组长度 = 船对应槽类数量，元素 = 模块 id 或 null）。
 * v17 六槽 Record（miner/cargo/turret/shield/armor/propulsion）于存档迁移 17→18 转为
 * 位数组：turret→high[0]、miner→high[1]、shield→mid[0]、propulsion→mid[1]、
 * armor→low[0]、cargo→low[1]（位不足的溢出件退回装备库）。
 */
export type FittedModules = {
  high: Array<string | null>
  mid: Array<string | null>
  low: Array<string | null>
}

/** 装备定义（造出来装到船上的模块） */
export interface ModuleDef {
  id: string
  name: string
  /** 家族（装配/引擎构建/UI 徽标用；V18.1 起无唯一约束，多件收敛靠合成机制） */
  slot: ModuleSlot
  /**
   * V18 槽类归属（装到哪类物理槽：high/mid/low）。
   * 缺省按家族推导（labels.rackOf）：turret・miner → high；shield・propulsion → mid；
   * armor・cargo → low；数据层全部件将显式标注本字段（Q3 映射集中落数据）。
   */
  rack?: RackSlot
  /**
   * V17 起效果系数仅限工业槽：miner = 每循环产量加成；cargo = 货舱容量加成（0.2 = +20%）。
   * 战斗槽不再使用本字段——炮台走武器参数（maxRangeM…dmgMult），护盾/装甲走
   * shieldHpBonus/armorHpBonus 与抗性缺口（shieldResistAdd/armorResistAdd），推进器走
   * speedBonusPct：每件装备以"自己的参数进战斗公式的具体环节"，而非笼统百分比。
   */
  bonus?: number
  description: string
  /* ═══ V17/V17.1 战斗装备参数（EVE 式：字段各自进公式环节；抗性件与容量件拆族；
       V18.1 起取消同类唯一——多件按 equipment 收敛组合成：抗性/闪避缺口复合 1−Π(1−x)、
       命中/速度 EVE 曲线 Π(1+pᵢ·wᵢ)、伤害/射速/容量加算 Σ） ═══ */
  /** 容量件（护盾扩展器）：护盾层容量加成（+15% = 0.15）——抗性件不携带本字段；
   * V18.1：多件允许、加算求和 */
  shieldHpBonus?: number
  /**
   * 抗性件（护盾增强器·X型）：按系"缺口削减"抗性（0.5 = 对该系未抗部分再减半）。
   * 实际抗性 = 1 − (1−船体基础抗) × Π(1−各件值)，上限 0.9（见 combat.mergeResist）——
   * V18.1：同系多件允许（缺口复合天然收敛）——
   * 船体基础抗越高模块收益越低（EVE 面板观感）；键缺省 = 0；专精件只给一个系。
   */
  shieldResistAdd?: DamageResists
  /** 容量件（装甲增厚板）：装甲层容量加成——抗性件不携带本字段；V18.1 多件加算 */
  armorHpBonus?: number
  /** 抗性件（装甲镀层·X型）：按系缺口削减抗性（语义同上 shieldResistAdd） */
  armorResistAdd?: DamageResists
  /**
   * 矢量推进器（加力推进）：战斗机动速度加成（0.15 = +15%）。
   * 直接乘入 UnitSpec.speedMps → combatSpeed：拉高接近/脱离/距离操纵力；
   * 弃船逃生率与跃迁充能仍只随船体动力（agility）——V17 起模块不再碰船体间接属性。
   * V18.1：多件推进器速度加成走 EVE 曲线（Π(1+pᵢ·wᵢ)）。
   */
  speedBonusPct?: number
  /** 推进器开火失稳：命中削减量（0.05 = 我方武器命中 ×0.95；界 [0, 0.5]，缺省 0；
   * 常驻生效并进胜率预估同源口径，见 combat.hitChance 的 hitMul）。
   * V18.1：多件推进器时命中代价只取最重（削减最大）一件。 */
  hitPenalty?: number
  /**
   * 炮台固定弹种（V17.2 炮族制：每门炮只打一种伤害——换炮 = 换弹种）。
   * 缺失视为 kinetic（兼容旧数据/测试）；消耗弹药 = damageType 对应型。
   */
  damageType?: DamageType
  /** 炮台：历史"每远征耗弹基数"（V11 起由出发预载制替代，字段保留仅展示） */
  ammoPerEngagement?: number
  /* ═══ V11 武器（炮台家族）：射程带 / 命中 / 装填 / 伤害倍率 ═══ */
  /** 最大射程 m（距离 > maxRange 不开火） */
  maxRangeM?: number
  /** 最小射程 m（距离 < minRange 不开火：过近盲区） */
  minRangeM?: number
  /** 基础命中率 0~1（命中 = (hitRate + 攻方命中加成×锁定修正) × 距离衰减 − 守方有效回避） */
  hitRate?: number
  /** 命中衰减系数 0~1：maxRange 端点命中率倍率（越接近 maxRange 线性跌落至此） */
  falloff?: number
  /** 装填时间 ms（开火后冷却；即时制射击节奏） */
  reloadMs?: number
  /** 单发伤害倍率（实际单发伤害 = 弹 dmg × dmgMult × (1+5%/级炮术) × (1+船 powerBonus)） */
  dmgMult?: number
  /** 装配占用 CPU（V17 起装配校验生效：模块合计不得超过船体 cpu；与无人机放飞共用） */
  cpuUse?: number
  /* ═══ V18 无人机装置位（远行星号式高槽装置；家族以字段判别：有 droneBayBonusM3 = 甲板扩展、
     有 droneDmgBonus = 战术导控、有 droneRangeBonusPct = 中继天线；归槽 rack = high，见 labels.rackOf） ═══ */
  /** 无人机甲板扩展：+droneBayM3（携带/放飞上限扩容；线性可叠件） */
  droneBayBonusM3?: number
  /** 战术导控阵列：放飞无人机单发伤害加成（0.12 = +12%；线性求和乘入；线性可叠件） */
  droneDmgBonus?: number
  /** 无人机中继天线（2026-09-10 船长拍板百分比制）：放飞无人机射程上限加成
   * （0.2 = +20%；求和后乘入机型基础射程；线性可叠件——MK1/2/3 = 0.2/0.45/0.8） */
  droneRangeBonusPct?: number
  /* ═══ B3 打捞器（salvager 家族：高槽无伤害件；升级只缩短周期） ═══ */
  /** 打捞器单轮周期毫秒（每台每轮捞 1 具残骸；MK1/2/3 = 10s/8s/6s） */
  salvageCycleMs?: number
  /* ═══ 2026-09-09 船体维修装置（支援件族·中槽；战斗中自动修复装甲/结构，每脉冲消耗一枚修理组件） ═══ */
  /** 每脉冲修复装甲 HP（受损优先；单层满则全额给另一层） */
  repairArmorHp?: number
  /** 每脉冲修复结构 HP */
  repairHullHp?: number
  /** 脉冲间隔毫秒（缺省 = REPAIR_PULSE_DEFAULT_MS 5000 = 5 秒一跳） */
  repairIntervalMs?: number
  /** 每脉冲消耗的修理组件 id（民用级 = 民用修理组件；MK1/MK2 = 军用修理组件） */
  repairKit?: string
  /* ═══ V18.1 支援件（support 家族：效果字段判别；多件收敛见 equipment.stackingOf） ═══ */
  /** 伤害稳定器（按系）：该系炮台单发伤害加成（0.06 = +6%；多件加算 Σ；只作用于炮台，
   * 不叠加到无人机——无人机归战术导控管） */
  damageTypeBonusPct?: DamageResists
  /** 射速计算机：炮台装填间隔缩短（0.05 = reload ÷ (1+0.05)；多件加算；只作用于炮台） */
  reloadCutPct?: number
  /** 索敌阵列（命中）：炮台命中整体提升（0.08 = 命中项 ×1.08；多件 EVE 曲线收敛；
   * 与推进器开火失稳同走 UnitSpec.hitMul，见 combat.hitChance；只作用于炮台） */
  hitBonusPct?: number
  /** 姿态陀螺（闪避）：被命中缺口削减（0.1 = 被命中率再 ×0.9）；全船生效；
   * 多件缺口复合 1−Π(1−xᵢ)，见 equipment.gapCombine */
  evasionGapPct?: number
  /* ═══ 2026-09-09 锁定装置（target-lock 家族·高槽；集火 + 被锁目标受击加深） ═══ */
  /** 锁定加深（0.08 = 被锁定目标受本舰伤害 ×1.08；多件 EVE 曲线收敛见 stackingOf/curveMult；
   *  装上任意一件即触发集火：本舰全部武器不再随机分散，改打存活编队首位（主舰优先、击毁自动接力） */
  lockDmgBonus?: number
}

/** 舰船蓝图（M5：用矿物制造舰船，产物进入船坞） */
export interface ShipBlueprintDef {
  id: string
  name: string
  /** 制造出的舰船 id（须在舰船表存在） */
  shipId: string
  /** 材料需求（矿物），开工时一次性扣除 */
  materials: readonly MaterialNeed[]
  /** 基础制造耗时（秒），受工业理论缩短 */
  buildSeconds: number
  /** 制造费（ISK）——2026-09-08 船长定取消收取，字段保留为历史遗留数据 */
  buildCostIsk: number
  /** 购买蓝图价格（ISK） */
  priceIsk: number
  description: string
}

/** 途中遭遇事件效果：趣闻（无事发生）/ 捡到 ISK / 捞到矿物 */
export type TravelEventEffect =
  | { kind: 'none' }
  | { kind: 'isk'; min: number; max: number }
  | { kind: 'mineral'; itemId: string; units: number }

/** 远征航行途中事件定义（M5：文字叙事的随机调味） */
export interface TravelEventDef {
  id: string
  name: string
  /** 事件文案（触发后写入日志的正文） */
  text: string
  /** 抽取权重（相对其它事件） */
  weight: number
  effect: TravelEventEffect
}

/** 制造材料需求一行 */
export interface MaterialNeed {
  itemId: string
  count: number
}

/** 蓝图定义（买下后永久可造，每次制造消耗材料 + 时间；制造费已取消） */
export interface BlueprintDef {
  id: string
  name: string
  /** 制造出的装备 id（须在装备表里存在）；弹药等物品类蓝图不填（改用 itemId+outputUnits） */
  moduleId?: string
  /** 制造出的物品 id（2026-09-05 弹药蓝图：产物 = 弹药等物品，每次产 outputUnits 单位入仓库） */
  itemId?: string
  /** 单次制造产出单位数（物品类蓝图；缺省 1） */
  outputUnits?: number
  /** 材料需求（矿物），开工时一次性扣除 */
  materials: readonly MaterialNeed[]
  /** 基础制造耗时（秒），受工业理论缩短 */
  buildSeconds: number
  /** 制造费（ISK）——2026-09-08 船长定取消收取，字段保留为历史遗留数据 */
  buildCostIsk: number
  /** 购买蓝图价格（ISK） */
  priceIsk: number
  description: string
}

/** 星系定义（星图节点；坐标仅用于界面 SVG 布局） */
export interface GalaxyDef {
  id: string
  name: string
  /** 星图坐标（SVG viewBox 手工布点） */
  x: number
  y: number
  /**
   * V16.1 安全等级（EVE 式，−1.0 ~ +1.0，0.1 精度；+1 = 母港级安全，−1 = 深渊级高危）。
   * 基线：星图中央 ≈ 0.0；修正因素 = 悬赏强度 + 空间结构（环心/死路/辐射区上调危险）。
   * 纯展示与叙事数值（可选字段；测试/工具星系可缺省）。
   */
  security?: number
  description: string
}

/** 星系间航线（星图边；单程航程分钟） */
export interface GalaxyEdgeDef {
  from: string
  to: string
  /** 单程航程（分钟） */
  travelMinutes: number
}

/** 战利品一行（固定数量） */
export interface LootRow {
  itemId: string
  /** 产出单位数 */
  units: number
}

/** 异常空间/悬赏目标（远征目的地） */
/** 敌族字母（A 海盗舰系 / B 武装拾荒者 / C 异形生物 / D 守墓古舰 / E 泰坦巨构 / F 制式巡逻 / G 烬火流亡） */
export type FoeFamily = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
export interface AnomalyDef {
  id: string
  name: string
  /** 所在星系 */
  galaxyId: string
  /** 威胁等级（V11 起 = 敌方总战力标尺：血量与火力由 battle 常量换算） */
  threat: number
  /** 需要的势力声望 */
  standingReq: number
  /** 胜利声望增长 */
  standingGain: number
  /** 胜利固定 ISK 奖励 */
  rewardIsk: number
  /** 胜利固定战利品（矿物/矿石，直接入舱） */
  loot: readonly LootRow[]
  /** 交火阶段耗时（秒）（V11 起仅作"最短交火展示时长"参考，实际由战斗推演决定） */
  combatSeconds: number
  /* ═══ V11 敌方编队字段（缺省有默认：orbit / balanced / 无僚机 / 伤害均分） ═══ */
  /** 敌方战术性格 */
  tactic?: FoeTactic
  /** 敌方血型（三层血量比例） */
  defProfile?: DefProfile
  /** 僚机数量 0~2（每架 = threat × foeEscortThreatFrac 的独立单位） */
  escorts?: number
  /** 敌方伤害类型权重（缺省三系均分） */
  dmgMix?: Partial<Record<DamageType, number>>
  /** 敌方单位速度 m/s（缺省按虚拟装配模板：参考船速 × m_base × tactic 系数） */
  foeSpeedMps?: number
  /** P1（2026-09-06）：悬赏级编队总血覆写（脱离全局威胁曲线，按单卡标定）——
   * 演习场/新港 = 战斗引入单，独立设计；单位 HP 仍按威胁份额/僚机规则切分。缺省 = 曲线值 */
  foeHpOverride?: number
  /**
   * V18B 近盲带伤害比例（2026-09-05 船长拍板）：玩家进入敌近盲带（dist < minRange）时
   * 敌**不停火**，伤害 × 本值——与玩家（近盲带内完全打不了）区分。0~1，缺省 0.3
   * （现有怪物全部按 0.3；未来单卡可覆盖，如更怕贴脸的给 0.1）。
   */
  blindDmgMul?: number
  /**
   * 敌武器基础命中覆写（2026-09-08 船长定：普遍高命中 0.85、个别低命中特例做"乱射重火力"个性）。
   * 只对动能/爆炸（fixed 命中模型）生效——能量（plasma）为光束必中，不消费本字段。
   * 缺省 = balance.battle.foeHitRate（默认 0.85）。
   */
  foeHitRate?: number
  /**
   * 敌伤害乘子（2026-09-08 等效回退口）：能量光束必中化后逐卡校准用（如赤潮类 plasma 卡）。
   * 缺省 1。命中侧不变——只缩放 shotDmg；时长/HP 验收带以 battle-calibrate 矩阵为准。
   */
  foeDmgMul?: number
  /**
   * 多波次（2026-09-09 低安顶段悬赏；docs/design/wave-battles-20260909.md）：
   * 敌方分批入场——每波 units 个"主舰+僚机"小队（escorts 随卡），血量 = 总血 × hpShare。
   * 整场仍为一次悬赏（声望/奖金/残骸按原卡整场结算）；缺省 = 单波（现行为）。
   */
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  description: string
  /** B1 遭遇战斗模板：不出现在悬赏目录/星图徽标（供低安遭遇战使用） */
  hidden?: boolean
  /* ═══ B3.1 敌群特色回收（2026-09-06 船长定档；可缺省 → 三档基础池/三层彩头默认） ═══ */
  /** 保底矿物权重池（同档矿物）；池均价 ≈ 档基数 × m（m = 危险度溢价 × 威胁线性，content-check 断言） */
  recyclePool?: ReadonlyArray<readonly [string, number]>
  /* ═══ 赏金任务·敌人窝点（2026-09-10 船长定） ═══ */
  /** 敌族（A~G；与美术层 FOE_ART 族字母同源）——决定窝点三档称呼与专属装备分配 */
  foeFamily?: FoeFamily
  /** 窝点名的核心词（有值 = 可作为赏金任务的窝点目标；教学卡刻意留空） */
  lairCore?: string
  /** 窝点三档称呼覆盖（缺省走族级词表 FOE_LAIR_TIERS） */
  lairTierNames?: readonly [string, string, string]
  /** 该敌群的专属装备池（2026-09-10 船长定：稀有残骸「高级箱」的额外掉落优先在此掷；
   *  每个敌族至少一件，只从高级箱出、不进市场不设蓝图） */
  lairGear?: readonly string[]
  /** 玩家可见的"残骸产出倾向"一句话 */
  recycleNote?: string
  /** 主题追加件集（2026-09-08"追加"语义：只在默认池上追加，默认池一件不少；武器不入主题，
   *  穹顶守卫三把 MK3 武器为唯一白名单） */
  recycleLoot?: { modules?: readonly string[]; mk2?: readonly string[] }
}

/** 模拟需要的全部静态内容（由数据包构建后一次性传入） */
export interface SimContext {
  skills: SkillCatalog
  ships: ReadonlyMap<string, ShipDef>
  belts: ReadonlyMap<string, BeltDef>
  items: ReadonlyMap<string, ItemDef>
  modules: ReadonlyMap<string, ModuleDef>
  blueprints: ReadonlyMap<string, BlueprintDef>
  shipBlueprints: ReadonlyMap<string, ShipBlueprintDef>
  galaxies: ReadonlyMap<string, GalaxyDef>
  galaxyEdges: readonly GalaxyEdgeDef[]
  anomalies: ReadonlyMap<string, AnomalyDef>
  travelEvents: readonly TravelEventDef[]
  /** 副空间站建站点（T9） */
  stations: ReadonlyMap<string, StationSiteDef>
  /** 市场商品目录（v9） */
  marketGoods: ReadonlyMap<string, MarketGoodDef>
  balance: BalanceConfig
}

/* ═══════════════ T9：副空间站建站点与通讯对话（静态内容） ═══════════════ */

/** 建站分档（分批提交推进施工；站内功能统一在"建成"档后开放——2026-09-08 船长定） */
export interface StationTierDef {
  /** 档位名（如 奠基/完善/建成） */
  name: string
  /** 2026-09-09（船长定）本档材料单：物品 × 数量，逐项交齐才升档（建材 = 精炼矿物，排除原矿） */
  bill: ReadonlyArray<{ itemId: string; count: number }>
  /** 本档交付完成后解锁的能力描述（展示 + 语义见 core station.ts） */
  unlockDesc?: string
}

/** 副空间站建站点定义（T9；位于既有星系，见 data/src/stations.ts） */
export interface StationSiteDef {
  id: string
  /** 站点名称（如 红环前哨站） */
  name: string
  /** 所在星系 id */
  galaxyId: string
  /** 建站任务接取的声望门槛（0 = 探索点亮即可） */
  standingReq: number
  /** 分档要求（顺序推进；2026-09-09 起每档自带材料单，不再有整站收料清单） */
  tiers: readonly StationTierDef[]
  /** 首次抵达介绍剧本 id（data dialogues.ts；null = 无） */
  introDialogueId: string | null
  /** 建成庆贺剧本 id（null = 无） */
  doneDialogueId: string | null
  /** 站点简介（任务卡文案） */
  description: string
}

/** 通讯对话一句 */
export interface DialogueLineDef {
  speaker: string
  text: string
}

/** 通讯剧本（线性文本流；一次完整呈现，逐句镜像进事件日志） */
export interface DialogueScriptDef {
  id: string
  /** 标题（通讯器称呼栏，如 协会 · 基建部） */
  title: string
  lines: readonly DialogueLineDef[]
}
