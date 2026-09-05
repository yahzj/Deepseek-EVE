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

/** 精炼配方一行：每 1 单位矿石，在 100% 收率下产出多少单位该矿物 */
export interface RefineRow {
  mineralId: string
  /** 每单位矿石产出的矿物单位数（可为小数，实际产量按收率折算后向下取整） */
  perOre: number
}

/** 物品大类（V10）：矿石/矿物为既有体系；气体/冰矿可采集可精炼（接入现有循环）；
 * 弹药/无人机为占位消耗品（市场流通、可囤可回卖，战斗系统开放后启用消耗） */
export type ItemKind = 'ore' | 'mineral' | 'gas' | 'ice' | 'ammo' | 'drone'

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
  /**
   * T8 修理组件 seam（内容后续添加，如"纳米修理组件"）：单件可修复的船体耐久比例（0~1）。
   * 连续出击等自动流程会优先消耗货仓内这类物品修复耐久（按耐久 < 0.5 阈值判定），
   * 用完仍不足才停下提示返港维修。
   */
  repairRestore?: number
}

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
  /** 稀有/限定：NPC 供应单的倍数（basePrice × 该值 = 刷出售价） */
  supplyMultiplier?: number
  /** 玩家卖出此类商品时 NPC 需求单的出价倍数（低于供应价，防套利） */
  demandMultiplier?: number
  /** 玩家可否卖出（默认 true） */
  playerSellable?: boolean
  /** 玩家可否买入（默认 true） */
  playerBuyable?: boolean
  /** 需要的协会声望（V10：部分高端商品声望解锁；买入时校验，卖出不限） */
  standingReq?: number
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
  /** 稀有商品每个窗口刷新供应单的概率 */
  rareWindowChance: number
  /** 限定商品每个窗口刷新供应单的概率 */
  exoticWindowChance: number
  /** 窗口净成交量超过该比例（相对参考量）时触发冲击 */
  shockTriggerRatio: number
  /** 每次冲击的价格偏移（比例，可正可负；叠加无上限） */
  shockPerTrigger: number
  /** 冲击衰减半程（毫秒） */
  shockDecayHalfMs: number
  /** 价格输出下限/上限（相对 basePrice），防归零/溢出 */
  minPriceRatio: number
  maxPriceRatio: number
  /** 内部消化队列每窗口消化比例（冲突订单随时间推进消化） */
  digestPerWindow: number
  /** 参考成交量（用于冲击归一化）：默认 = poolTarget 的该比例 */
  referenceVolRatio: number
  /** 贸易税（销售税）：玩家卖出成交按此比例征税（ISK 回收阀） */
  salesTaxRate: number
  /** 贸易税减免技能 A（会计学）与技能 B（贸易谈判学）：每级各减免该比例（线性相加） */
  taxSkillAId: string
  taxSkillBId: string
  /** 每个技能每级的税率减免比例（两个技能满级合计减免 80% = 2×5×8%） */
  taxCutPerLevel: number
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
    /** 循环时间最短只能缩到原值的多少（防无限加速） */
    minTimeRatio: number
    /**
     * 采矿显式行程的"满载/返航单程"进出港基础时长（毫秒；T4，船长定稿 120 秒）：
     * 本地/无星系归属矿带单程 = 该值；远处矿带单程 = 航程 + 该值。
     * 出航（空船出门）时跃迁速度×2 → 出航单程 = 该基础腿的一半（见 mining.ts oneOutboundLegMs）。
     */
    localLegMs: number
  }
  refining: {
    /** 基础收率（如 0.5 = 50%） */
    baseRate: number
    /** 主收率技能 id（"精炼学"） */
    rateSkillId: string
    /** 每级收率提升 */
    ratePerLevel: number
    /** 次级收率技能 id（"高级回收处理"） */
    secondRateSkillId: string
    /** 每级收率提升 */
    secondRatePerLevel: number
    /** 收率上限 */
    maxRate: number
  }
  manufacturing: {
    /** 制造时间缩减技能 id（"工业理论"） */
    timeSkillId: string
    /** 该技能每级制造时间缩减比例（如 0.05 = 5%） */
    timePerLevel: number
    /** 制造时间最短只能缩到原值的多少 */
    minTimeRatio: number
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
    /** 决定可同时指挥副船数的技能 id（"人工智能专家"） */
    skillId: string
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
    /** 舰船维修费单价：ISK / m³ / 每单位缺失耐久 */
    perM3Cost: number
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
  }
  /** 每次采集循环遇到"富矿脉"（产量翻倍）的概率 */
  richVeinChance: number
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
  /** 受损档：耐久扣损区间（底 clamp 5% 绝不弃船） */
  duraLossMin: number
  duraLossMax: number
  /** 被抢：至多损失船上货物比例（无货则抢钱包） */
  lootTakenMaxPct: number
  /** 被抢（无货时）：至多损失钱包 ISK 比例 */
  iskTakenMaxPct: number
  /** 遭遇强度：承担船火力 × [foePowerMin..foePowerMax] */
  foePowerMin: number
  foePowerMax: number
  /** 击退 / 胜利缴获：ISK ≈ 威胁 × [lootIskMin..lootIskMax] */
  lootIskMin: number
  lootIskMax: number
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
  /** 炮术学每级单发伤害加成（0.05 = +5%/级） */
  gunneryDmgPerLevel: number
  /** V18B 武器族技能（2026-09-05 一号按交接底稿接入）：模块槽族 → 专精技能 id；
   * 每级单发伤害加成 = familySkillPerLevel（与 gunnery 乘算；构建期折算进各条目） */
  familySkillIds: Record<'turret' | 'missile' | 'laser', string>
  familySkillPerLevel: number
  /** 距离动力学：距离下限（贴脸极限）与开战距离 = 双方最远武器射程×openRangeFactor + openRangePadM（取小加成的近距开局） */
  minDistanceM: number
  openRangeFactor: number
  openRangePadM: number
  /** 舰船 maxSpeedMps 参与距离收敛的比例（战斗机动速度 = speed × speedFactor ×(1±agilitySpeedBonus)） */
  speedFactor: number
  agilitySpeedBonus: number
  /** 敌方换算（threat → 血/火力/速度） */
  foeHpPerThreat: number
  foeEscortThreatFrac: number
  foeDpsPerThreat: number
  foeHitRate: number
  foeReloadMs: number
  foeFalloff: number
  foeSpeedBaseMps: number
  /** C4 校准轮：敌方武器射程随威胁成长的线性起点（threat ≤ floor = 基础战术带不放大） */
  foeRangeThreatFloor: number
  /** C4 校准轮：射程放大 span——scale = 1 + (threat−floor)/span（threat = floor+span → ×2） */
  foeRangeThreatSpan: number
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
  | 'shield'
  | 'armor'
  | 'propulsion'
  | 'drone-rack'
  | 'drone-tac'
  | 'support'

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
  /* ═══ V18 无人机装置位（远行星号式高槽装置；家族以字段判别：有 droneBayBonusM3 = 甲板扩展，
     有 droneDmgBonus = 战术导控；归槽 rack = high，见 labels.rackOf） ═══ */
  /** 无人机甲板扩展：+droneBayM3（携带/放飞上限扩容；线性可叠件） */
  droneBayBonusM3?: number
  /** 战术导控阵列：放飞无人机单发伤害加成（0.12 = +12%；线性求和乘入；线性可叠件） */
  droneDmgBonus?: number
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
  /** 制造费（ISK） */
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

/** 蓝图定义（买下后永久可造，每次制造消耗材料 + 制造费 + 时间） */
export interface BlueprintDef {
  id: string
  name: string
  /** 制造出的装备 id（须在装备表里存在） */
  moduleId: string
  /** 材料需求（矿物），开工时一次性扣除 */
  materials: readonly MaterialNeed[]
  /** 基础制造耗时（秒），受工业理论缩短 */
  buildSeconds: number
  /** 制造费（ISK，开工即扣，失败不退还——但制造不会失败） */
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
  /** 敌方单位速度 m/s（缺省用 battle.foeSpeedBaseMps 按体积修正） */
  foeSpeedMps?: number
  description: string
  /** B1 遭遇战斗模板：不出现在悬赏目录/星图徽标（供低安遭遇战使用） */
  hidden?: boolean
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

/** 建站分档（分批提交、边交边生效） */
export interface StationTierDef {
  /** 档位名（如 奠基/完善/建成） */
  name: string
  /** 本档缴交总单位数（接受该站 acceptItemIds 中的任意混合） */
  count: number
  /** 本档交付完成后解锁的能力描述（展示 + 语义见 core station.ts） */
  unlockDesc: string
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
  /** 收料物（该星系常见产出；提交接受其中任意组合） */
  acceptItemIds: readonly string[]
  /** 分档要求（顺序推进） */
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
