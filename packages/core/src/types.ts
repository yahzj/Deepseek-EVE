/**
 * 内容数据的通用类型定义。
 *
 * 说明：引擎（core）不直接认识任何具体技能，只认识"技能这种形状"。
 * 具体内容（采矿学、导航学…）由数据包（@whale/data）提供，这样以后加内容 = 加数据，不用改引擎。
 */

// 只借类型（`wreckGroups.ts` 反向也只借 `FoeFamily` / `RecycleTier` 类型）⇒ 运行期零循环
import type { WreckGroupDef } from './wreckGroups'

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
  /**
   * **技能书**（技能树页的分支归属）——**2026-09-22 船长令**「**将现有的技能再进行细分**」。
   * 取值见 `packages/data/src/skills.ts` 的 `SKILL_BRANCHES`（23 本）；缺省 ⇒ 树页落到兜底本
   * （`content:check` 会点名，属漏登记）。
   */
  readonly branch?: string
  /**
   * **前置技能**（**真前置**）——**2026-09-22 船长令**：「**将同类效果的技能做成上下级关系**」
   * ＋「**有前置的技能效果是否相关？如果不相关最好单开一条线。**」
   *
   * 口径：**数组**（保留"汇合"能力——多条线可以交汇在同一个节点上；2026-09-22 的那批连线里
   * 暂时没有汇合点：`repair-engineering` 与 `station-protocol` 那一对因 rank 调整已翻成单线）；
   * **全部前置都达到 `PREREQ_MIN_LEVEL` 才可入队**。空/缺省 = 根技能。
   *
   * ⚠ 只填**效果同族**的：判据 = 二者的说明里互相点名「与 X 乘算叠加 / 同效果 / 同享」＝**同一乘区**；
   * 效果不同轴的**一律不填**（树上就是并列的独立点，不画连线）。
   */
  readonly prereq?: readonly string[]
  /**
   * **前置的「最低等级」**（缺省 = `PREREQ_MIN_LEVEL` ⇒ Lv1）——**2026-09-23 船长令**：
   * 「训练队列内取消一个技能的同时会取消所有依赖其前置的后续技能的训练。（但是假设前置是 LV1，
   *  你取消的是 LV2 并不会移除后续的其他技能训练。）」
   * ⇒ 前置判据与**取消级联**都要**按等级**算；同日口径「**逻辑按等级实现，数据侧本轮不标具体等级**」
   * ⇒ 本字段**留空即可**（现有 43 处前置仍只要求 Lv1，行为与今天完全一致）。
   * 将来要给某个技能加高等级前置，只在这里补 `{ 前置id: 等级 }`，判据/级联/界面文案都无需再动。
   *
   * ⚠ 只对本表列出的前置生效；未列出的一律回落 `PREREQ_MIN_LEVEL`（非法值同样回落，
   *   数据体检（悬空 / 成环 / 父比子深）在 `content:check`）。
   */
  readonly prereqLevel?: Readonly<Record<string, number>>
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
 * 各按层容量增幅 × 舰体快修学——2026-09-08 船长纠正：不是百分比；
 * **2026-09-13 船长两条指令**：① 基础值对齐「船体维修装置每跳」口径（民用 30→**5**、军用 70→**10**）；
 * ② 装置每跳也吃舰体快修学 ⇒ **两条用件路径同一套系数与技能**，见 `repair.quickRepairFactor`） */
export type ItemKind =
  | 'ore'
  | 'mineral'
  /**
   * **零件**（2026-09-20 船长「组装机内新增零件分页」）：工业中间件——基础零件组装机直接可造
   * （隐式蓝图、无需学习），高级零件需学习蓝图后制造；供专属装备/专属舰船/旗舰/空间站建材消耗，
   * 同时可作商品在市场买卖。
   */
  | 'part'
  | 'gas'
  | 'ice'
  | 'ammo'
  | 'drone'
  | 'wreck'
  /** **货柜**（F4 · 船长 2026-09-13「遗迹安全货柜」）：占形状格（2×2 = 4 格）、带回后拆解 */
  | 'container'
  /**
   * **谜质储存器**（F3c · 船长 2026-09-13）：虫洞谜质取回后的装置，同样占 2×2 = 4 格，
   * 但**只在本趟虫洞内生效、随趟消失**（不进仓库、不拆解）。效果表见 `wormholeMatter.ts`。
   */
  | 'matter'
  | 'fragment'
  | 'kit'
  /**
   * **AI 核心（洞内实物形态）**（船长 2026-09-14：「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的
   * 掉落。AI 核心单独占 1 格」）：洞内货仓里占 1 格的实物件，**撤离成功即自动接入核心库、不进仓库**
   * （核心账本 = `state.aiCores`；实物形态只为"占格 + 拖拽 + 临时空间 + 散落 + 结算"这一串现成规则存在）。
   * 与 `container` **必须分开**：拆解台的资格判据是 `kind === 'container'`（核心不该上拆解台）。
   */
  | 'aicore'
  /**
   * **虫洞谜质（精华形态）**（船长 2026-09-15：「**谜质在虫洞结束时不再删除，而是转化成虫洞谜质存入仓库。
   * 介绍是虫洞内存在的奇幻物资，具备研究价值。该物品只收不卖。且具备较高价值，目前纯粹作为虫洞的金钱收益。**」）：
   * 与装置形态（`matter`）**必须分开**——装置只在本趟洞内生效、随趟消失且占 2×2 格；
   * 精华是**撤离成功时按台数换算入仓库的可售物资**（`baseSellPriceIsk` 有真价、**只收不卖**、不占形状格）。
   * ⚠ 分开的第二个理由：体检「洞内非商品契约」按 `matter` 判"谜质不进市场目录"⇒ 精华若挂 `matter`
   * 会被那条契约误拦（它**就是要**有市场行）。
   */
  | 'essence'
  /** **奢侈品**（船长 2026-09-15：「新增贵重品货柜…精炼炉拆解后获得随机数量的'奢侈品'，奢侈品纯粹用来卖钱，市场正常交易」）：
   *  纯贸易品（**可买可卖**、不参与拆解/精炼/制造链），来源 = 贵重品货柜拆解。 */
  | 'luxury'

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
  /** 中文名：橄榄岩、钛钢合金…… */
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
  maxRangeM?: number;
  /**
   * **机型级装填周期（毫秒）**（2026-09-11 船长：「哨卫将攻击周期翻倍」）——缺省 = 无人机基准 4400ms。
   * 哨戒机（雷鸥）写 **8800**（攻击周期翻倍）：它不再会被攻击 ⇒ 用装填而非单发削 DPS
   * （单发被'侦察机 6~7.5×'的定位档钉住，动它会撑破四型定位）。
   */
  reloadMs?: number;
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
  /**
   * **专属型号**（2026-09-10 船长：G 族「鱿蜂无人机」引出）：只能从敌族窝点·高级箱产出——
   * 无蓝图（不可造）、不上市场、不入常规掉落池。护栏据此断言渠道唯一；
   * 无人机定位契约（data/droneRoles.ts）对专属型号**豁免四型区间校验**（仍受硬边界约束），
   * 于是"专属强化型 + 制式型"可以同类共存，而不破坏四型本身的定位口径。
   */
  exclusive?: boolean
  /**
   * **未上线闸门（施工期）**（2026-09-13 补：铁律「数据走 `unreleased` 闸门」）。
   *
   * 语义与 `MarketGoodDef.unreleased` 一致，但**管的是"物品目录级"的可见性**：市场闸门只管
   * `ctx.marketGoods`（市场页/图鉴/挂单/任务/事件），而工业页「可精炼资源」网格、舰船页
   * AI 精炼炉下拉、组装机材料提示、手册物品图鉴都是**直接扫 `ctx.items` 全目录**的
   * ——只标市场卡会漏（2026-09-13 实测：虚空母矿连卡带"虫洞"描述一起挂在工业页上）。
   *
   * 口径：标了 ⇒ 不进任何"给玩家看的全目录枚举"（走 `visibleItemDefs` / `itemReleased`）；
   * **内部玩法逻辑仍用 `ctx.items` 全目录**（虫洞背包按体积换算等照常）。
   * **上线动作 = 删掉这一个字段**（与市场卡同步）。
   */
  unreleased?: boolean
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

/**
 * **敌方挂载件 id**（2026-09-16 船长：「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」
 * ＋「**除了C族，将D族和E族的射程增加也迁成挂载件**」）——目录表在 `core/foeMounts.ts`（`FOE_MOUNTS`）。
 * 写成字面量联合 = 数据侧写错 id 会**当场编译不过**（比字符串松类型更能防手滑）。
 */
export type FoeMountId =
  | 'foe-mount-charge-pirate'
  | 'foe-mount-charge-swarm-t1'
  | 'foe-mount-charge-swarm-t2'
  | 'foe-mount-charge-swarm-t3'
  | 'foe-mount-charge-swarm-t4'
  | 'foe-mount-drone-range-x4'
  | 'foe-mount-gun-range-x1-5'
  /**
   * **巨构齐射观瞄**（船长 2026-09-19）：E 族导弹残段专属的炮台受击增程件。
   * ⚠ 与 `foe-mount-gun-range-x1-5`（D 族「守墓远距观瞄」）**效果同档、各是一件**——
   * 船长：「只是采用类似的效果的挂载件，并不是真的是静滞卫舰的挂载件（因此名字要不同）」。
   */
  | 'foe-mount-titan-range-x1-5'
  /** 劫掠捕获网（船长 2026-09-16）：首次开火即钉住目标——减速 90% + 关推进器 + 闪避归零 + 射程 −500m */
  | 'foe-mount-capture-web'
  /** **支援呼叫装置**（船长 2026-09-19）：开战 20 秒后按距离呼叫一支支援军（延迟到场 ⇒ 实际威胁 ×1.1） */
  | 'foe-mount-support-call'
  /**
   * **姿态陀螺仪**（**船长 2026-09-24**）：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」
   * ＋「**电子舰也要挂**」⇒ A 族洞内卡条目专属：该舰战斗中 **闪避 +0.10 加算**（上限 0.9 由消费方夹）。
   */
  | 'foe-mount-gyro-stabilizer'
  /**
   * **船体修理装置**（**船长 2026-09-24**）：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，
   * 会吃威胁的加成」⇒ G 族洞内卡条目专属：每 5 秒自修 **15 装甲 + 15 结构** × **层威胁倍率 k**
   * （基数经船长同日二次令**由 5/5 上调至 15/15**；`k = 该层本次实际威胁 ÷ 45`；见 `FoeMountDef.repairPulse`）。
   */
  | 'foe-mount-hull-repair'
  /**
   * **支援舰船召唤装置**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，只不过改为
   * **复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，**每次随机复活一艘**」）。
   *
   * ⇒ **通用件**（将来别的卡/族也能挂），**先只装到 H 族入侵母舰**（`ink-flagship` 的母舰条目）：
   * 每 `everyMs`（60 秒）从**当前这一波编成里已阵亡的敌舰**中随机抽一艘，以**支援舰**身份**满血入场**
   * （新 tag `supN-<原tag>` ⇒ 界面 = 新的一艘支援舰飞进来，带入场动画与装填窗口）。
   * 见 `FoeMountDef.reviveEscort`。
   */
  | 'foe-mount-revive-escort'
  /**
   * **墨潮干扰阵列**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」⇒ 选甲）：
   * H 族「墨潮干扰舰」原先写在**舰级字段**上的 `foeRangeDebuffPct = 0.5` 迁成具名件（数值不变）。
   * 与我方那件「墨潮电子舱」（`mod-lair-ecm-h`）是**敌我同源的一对**。见 `FoeMountDef.rangeDebuff`。
   */
  | 'foe-mount-ink-range-debuff'

/**
 * **敌方挂载件定义**（船长 2026-09-16 三句合一的落点）：
 * - 「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」；
 * - 「**除了C族，将D族和E族的射程增加也迁成挂载件**」；
 * - 「**要：敌舰悬停/战报展示挂载件**」⇒ `name` 是**玩家可见**文案，进敌舰悬停与战报。
 *
 * 语义 = 挂在敌舰（**舰级 `FoeShipDef.mounts`** 或**卡条目 `FoeShipSlot.mounts`**，条目优先）上的装置，
 * 由 `foeMounts.resolveFoeMounts` **单点**解析成运行时字段（`UnitSpec.foeCanCharge` / `foeChargeMul` /
 * `foeChargeCooldownMs` / `foeDroneRangeMulOnHit` / `foeGunRangeMulOnHit` / `foeMountNames`）。
 * 一件**可以同时带多类效果**（如 A 族洞内的「劫掠冲锋推进器 ＋ 劫掠捕获网」同挂一件条目上；
 * 「一件一类效果」那条只约束**我方支援件** `ModuleDef`，见 §十四——此处 2026-09-24 更正旧注）。
 * 多件同类效果相撞时按 `resolveFoeMounts` 的"后写覆盖先写"聚合；`note` 写设计备注。
 */
export interface FoeMountDef {
  id: FoeMountId
  /** 玩家可见名（敌舰悬停 / 战报里逐件列出） */
  name: string
  /**
   * **英文名**（2026-09-24 加；`l10n-overlay` 的 `overlayCardFoeMounts` 用它做英文界面的覆盖）。
   * 口径 = `docs/glossary-en.md`（术语与专名权威）：`姿态陀螺` = `Attitude Gyro`、
   * `船体维修装置` = `Hull Repair Unit`（`mod-hullrep-*` 同词）、`挂载件` = `Mount`。
   * ⚠ **缺省不写 ⇒ 英文界面回退中文名**（既有八件现状，待船长拍板译名后逐件补）。
   */
  en?: string
  /**
   * **冲锋装置**：触发后**本单位自己的机动 ×`mul`**（不外溢），解除后 `cooldownMs` 内不能再冲。
   * `triggerMarginM` 缺省 = 走全局 `BattleBalance.foeChargeTriggerMarginM`。
   */
  charge?: { mul: number; cooldownMs: number; triggerMarginM?: number }
  /**
   * **机群受击增程**：本体被命中一次 ⇒ **整支敌队的机群**射程 ×`mul`（整队标量 `foeDroneRangeBuff`，
   * 口径与迁移前**逐字一致**：任一挂件舰挨打即盖章、此后全队机群都吃）。
   */
  droneRangeOnHit?: { mul: number }
  /** **炮台受击增程**：**从它射程之外**被命中 ⇒ **本舰**炮台射程 ×`mul`（只对挂了本件的舰生效）。 */
  gunRangeOnHit?: { mul: number }
  /**
   * **劫掠捕获网**（船长 2026-09-16：「劫掠捕获网：**降低目标90%移动速度，并关闭所有类型推进器**。
   * **在自身第一次开火时发动**。动画效果为一根蓝色的光速连着命中舰船」＋补充「**还会让目标闪避强制为0，
   * 射程降低500米**」）：本舰**第一次开火那一刻**（不看命中）钉住**它这一发的目标**，本场永久。
   *
   * 四层效果（全部只作用于被钉的那一艘我方舰）：
   * - `slowMul`：战斗机动 ×本值（0.1 = 降低 90%）；
   * - `noThruster`：**关闭所有类型推进器**（点火期不再加成，微型跃迁引擎同样失效）；
   * - `noEvasion`：**闪避强制为 0**（敌方命中率 = 敌武器命中 + 加成 − 0）；
   * - `rangeDownM`：**武器射程 −本值**（两端各减，近界下限 1m）。
   *
   * **解除 = 击杀发动者**（发动者阵亡即清账）；**多艘不叠加**（同一目标只生效一次）。
   * ⚠ 只影响**战斗**机动/射程，不影响星图航行。
   */
  web?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /**
   * **射程压制阵列**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」⇒ 选甲：
   * 把 H 族墨潮干扰舰的**舰级字段** `foeRangeDebuffPct = 0.5` **迁成具名挂载件**「墨潮干扰阵列」，
   * 数值一字不变）。
   *
   * 迁移的意义：① 它有了名字（玩家可见）；② 进**敌舰悬停 / 战报**的挂载件清单；
   * ③ 进 `foe:export` 的「H 族 · 挂载件」表；④ 与我方那件「墨潮电子舱」形成敌我同源的一对。
   * 解析后仍是**同一个运行时字段** `UnitSpec.foeRangeDebuffPct`（消费方 `meJammerNetOf` 一行不改）。
   */
  rangeDebuff?: { pct: number }
  /**
   * **支援呼叫装置**（船长 2026-09-19：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程
   * 之外时，增援2艘静滞卫舰。**」＋「因为延迟到场，所以需要一定补偿。**卡计算的实际威胁要*1.1**」）。
   *
   * 口径：
   * - **呼叫者** = 挂本件的单位（本卡里 = 守墓王座舰），且必须在**开战即在**的编成里
   *   （体检会拦"挂在带 `enterAt` 的条目上"）；
   * - `delaySec`：**开战满 N 秒**判定一次——玩家在呼叫者**当时有效的炮台最远射程**内 ⇒ 到场的是
   *   `inside` 那一支；在射程外 ⇒ `outside` 那一支。**判完锁死**（另一支本场不再出现），
   *   锁存不占存档字段（由"哪一支已入场"反推，含尸体）；
   * - 两支由卡的编成条目声明（`FoeShipSlot.enterBranch` ＋ `enterAt`），**必须成对且账面总量相等**
   *   （体检守恒契约）；
   * - `threatMul`：**延迟到场的补偿**——本卡在洞内派生时的**实际威胁 ×本值**（该链上血与火力
   *   同乘约 ×1.16），卡面 `threat`（缩放锚点）不动。
   */
  supportCall?: { delaySec: number; threatMul: number }
  /**
   * **姿态陀螺仪**（**船长 2026-09-24**：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」
   * ＋「**电子舰也要挂**」＋追问裁定「**陀螺仪 = 加算 +10 个百分点**（甲）」）。
   *
   * 语义 = **本舰战斗闪避 +`add`（加算的百分点，不是乘子）**，命中判定处生效
   * （我方武器对它的命中率 = `(武器命中 + 加成 − 闪避) × 距离折减`）⇒ 加了它就更难被打中。
   * `0.10` 即 22%（A 族 2026-09-24 提档后的舰级值）→ **32%**；劫掠电子舰 30% → **40%**（「电子舰也要挂」）。
   * **上限 0.9 由消费方夹紧**（与 `FoeShipDef.evasion` 同一把尺，字段只给加数）；
   * **多件相撞取加和**（见 `foeMounts.resolveFoeMounts`）。只挂**虫洞卡的条目**（星图侧不引用 ⇒ 零影响）。
   */
  evasionBonus?: { add: number }
  /**
   * **船体修理装置**（**船长 2026-09-24**：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，
   * 会吃威胁的加成」＋追问裁定「**修理量 = 乘层威胁倍率**（甲，归一基准"不改动"）」）。
   *
   * 语义 = **本舰自己**每 `everyMs`（5 秒）回 `armor` 装甲 ＋ `hull` 结构 **× k**，各层夹到自己的满值
   * （满血不回超）。**基数 = 15/15**（船长 2026-09-24 同日二次令「基础数值上调至15装甲15结构」；
   * 原令是 5/5）。`k = 该层本次实际威胁 ÷ 45`（45 = 第 1 层基准威胁 `WORMHOLE_THREAT_BASE`，
   * 层 1 的 k 恰为 1.00 = 船长说的归一基准）⇒ 层 1 = 15/15 · 层 7 ≈ 30/30 · 层 10 ≈ 42/42
   * （层末守卫另吃 ×1.2 的威胁倍率）。
   *
   * ⚠ **字段只给基数与节拍**：k 由消费方按"本场是哪张卡、哪一层、什么用途"现算
   * （`combat.createFoeSpecsFromShips` → `UnitSpec.foeRepairPulse.k`）——与「吃威胁加成」同源，
   * 且**不写进存档**（每拍按本场同一份派生重算，读档不会算出别的层）。
   * 与"敌方后勤舰"（`FoeShipDef.repairPct`：把自己的 DPS 折成修理值去修队友）是**两套机制**：
   * 本件**只修自己、不折自己的火力**，同节拍（5 秒）但各按各的计时器。只写**虫洞卡的条目**。
   */
  repairPulse?: { everyMs: number; armor: number; hull: number }
  /**
   * **支援舰船召唤装置**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，只不过改为
   * **复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，**每次随机复活一艘**」）。
   *
   * 语义 = 挂件单位（入侵母舰）**每 `everyMs` 拍一次召唤**，把**当前波编成里已阵亡**的一艘敌舰
   * 以**支援舰**身份**满血**重新送进场：
   * - **表现** = 敌方支援舰船入场（新 tag `supN-<原tag>` ＋ `enteredAtMs` 入场窗口：动画演完才开火），
   *   与波次转场/单波增援**同一套演出与窗口口径**；
   * - **池子 = 当前波**（船长选定「只复活当前波已死的」）⇒ 母舰在第 4 波时只补第 4 波的僚舰；
   * - **上限 = 不超本波原编成**（死一个补一个；同型反复阵亡也照样能再入场 ⇒ 持续支援压力，
   *   但不会把战场堆成一团）；
   * - **母舰自己不在池内**（它死了这一场就结束）；
   * - 随机走 `state.rng`，但**只在挂了本件的战斗里消费** ⇒ 没挂件的战斗随机序列逐字不变；
   * - 受总开关 `BattleBalance.foeReviveEnabled` 约束（缺省关 ⇒ 零行为变化，与其余总开关同款形态）。
   */
  reviveEscort?: { everyMs: number }
  /** 设计备注（不进玩家视野） */
  note?: string
}

/** **支援呼叫装置的两支到场分支**（2026-09-19 船长批；见 `FoeMountDef.supportCall`）：
 *  `inside` = 判定时玩家**在呼叫者射程内**；`outside` = 在射程外。 */
export type FoeSupportBranch = 'inside' | 'outside'

/**
 * **舰种子分类**（2026-09-13 船长定：虫洞专属舰船按子分类重排数值并进界面）。
 * 与 `role` 并列：`role` 管战斗曲线口径，`subClass` 管"这艘船是干什么的"——
 * 只作**展示 + 设计口径**（数值差异已直接落在各字段上，引擎不读本字段做判定）。
 * **最初只有虫洞专属舰船写**；2026-09-13 船长放宽为「协会功能舰也可写」，2026-09-16 船长
 * 「**原先将非专属的三条乌龟船添加舰船的子分类：武装货舰**」⇒ 甲壳装甲线三艘也写（见 `content-check` 的
 * 白名单 + 非虫洞登记表）；D 族巡洋舰按船长裁定**不设子分类**。
 */
export type ShipSubClass =
  | '电子舰'
  | '炮舰'
  | '重型突击巡洋舰'
  | '截击舰'
  | '指挥舰'
  | '鱼雷舰'
  | '无人机作战舰'
  | '侦察舰'
  | '后勤舰'
  /** 甲壳装甲线三艘（陆龟级重装艇 / 玳瑁级重装巡舰 / 玄武级重装战列舰）——船长 2026-09-16 定名；
   *  玄武级的「旗舰」二字于 **2026-09-21 船长纠正**（「玄武级是战列，不是旗舰」）⇒ 改「战列舰」，
   *  与 `SHIP_SIZE_CLASS[4] = 战列舰` 对齐（「旗舰」是 T5 档名）。 */
  | '武装货舰'

/** 舰船定义 */
export interface ShipDef {
  id: string
  name: string
  /** 档次 1/2/3/4，仅用于展示排序 */
  tier: number
  /** 船型角色（V10：舰船细分系统的占位字段，本轮仅 UI 徽标展示） */
  role: ShipRole
  /** **舰种子分类**（仅虫洞专属舰船写；见 `ShipSubClass` 注释） */
  subClass?: ShipSubClass
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
  /* ═══ 2026-09-13 船长：虫洞族专属舰船的"船体固有新机制"（三项都由船长点名） ═══ */
  /**
   * **按系武器射程加成**（如炮艇「动能武器射程 +30%」）——与模块的 `rangeTypeBonusPct` **同链加算**：
   * 实际射程 = 基础 × (1 − 全局削减) × (1 + 本系加成)（`combat.createPlayerSpec` 的 `rangeOf`）。
   */
  weaponRangeBonusPct?: Partial<Record<DamageType, number>>
  /**
   * **全舰（编队）单发伤害光环**（如指挥舰「全舰单发伤害 +15%」）——对**全队每艘船**的每条武器统一乘
   * `(1 + 本值)`；**多艘同类**只取**最高**、不叠加（与"同项取优"惯例一致）；单舰场景 = 对自己生效。
   *
   * **落点（2026-09-17 修）**：由 `combat.applyFleetDamageAura` 施加，**每拍重建规格处
   * （`buildMyUnitSpecs`）与开战建档处（`startFleetBattleFor`）各调一次**。
   * ⚠ 修前它只在 `startFleetBattleFor` 里乘一次，而开火读的是每拍重建后的规格 ⇒ **光环从未生效**
   * （真 BUG：真引擎 A/B 每发均值 91.640 vs 91.640、比值 1.000，生效应 ≈1.15）。新加同类光环时，
   * **一律走"每拍重建处施加"这条纪律**（谜质增益 / 捕获网 / 教学战加成 / 锁定阵列全队光环同款）。
   */
  fleetDamageBonusPct?: number
  /**
   * **虫洞扫描半径加成（圈）**（如侦察舰/电子舰「虫洞扫码范围 +1 圈」）——进洞建档时
   * `scanRadius = WORMHOLE_SCAN_RADIUS_BASE + Σ(本值 over 编队)`；**编入队伍即生效、可叠加**（船长 2026-09-13）。
   */
  wormholeScanRadiusBonus?: number
  /**
   * **后勤舰：维修脉冲改为在编队里挑目标**（船长 2026-09-16：「**后勤舰添加特性，维修装置可以修理
   * 血量最少的队友。**」＋同日「**我发现之前给后勤舰的维修特性并添加到船体特性属性中？**」⇒
   * 从"`subClass === '后勤舰'` 代码硬判据"改为**本字段驱动**，从而能进界面的「船体特性」栏）。
   *
   * 口径：装了维修装置时，脉冲目标 = **全编队三层剩余比例最低的舰船（含自己）**；缺省 ⇒ 只修自己（旧口径）。
   * 落点：`combat.createPlayerSpec` 写入 `spec.logistics` ⇒ `pulseAllyRepair` 的选靶分支。
   */
  repairPulseTargetsFleet?: boolean
  /**
   * **侦察舰特性 · 隐秘行动装置 CPU 减半**（船长 2026-09-16：「**侦查舰添加特性，隐秘行动装置所需
   * CPU 降低50%**」；口径四答取「**乙：向上取整**」⇒ MK2 55 → **28**、MK3 80 → 40）。
   *
   * 值 = 倍率（`0.5`）；**只作用于带 `stealthMs` 的装置**（本船其它件的 CPU 一律不折）；
   * 引擎按 `ceil(cpuUse × 本值)` 折算 ⇒ 单点 = `equipment.cpuUseOf`（装配校验 / 面板 / 战斗建档三处同源）。
   * 缺省 = 1（非侦察舰一字不变）。**数据字段驱动**（照 2026-09-16「后勤舰」先例），界面「船体特性」栏同源。
   */
  stealthCpuMul?: number
  /**
   * **侦察舰特性 · 免推进器失效**（船长 2026-09-16：「**且移除推进器失效惩罚**」，口径四答取
   * 「甲：**完全移除**」）：本船装着推进器族（`slot: 'propulsion'`，含微型跃迁引擎那 8 件）也
   * **照常隐身**（开火立即现形、超时现形这两条照旧）。
   *
   * 缺省 / 非本船 ⇒ 旧口径（船长 2026-09-15「有推进器类的时候直接解除隐身」）＝**任一推进器在装即判 0**。
   * 落点 = `combat.createPlayerSpec` 的隐形窗口段；界面「船体特性」栏同源。
   */
  stealthIgnoresPropulsion?: boolean
  /**
   * **电子舰特性 · 压制敌舰武器射程**（船长 2026-09-18：「**电子舰新增特性，削减敌人15%的武器射程，
   * 可以乘法叠加，与敌人的射程增加效果做加法处理。（比如10000m射程，我方一艘电子舰，对方拥有射程+50%，
   * 那么对方实际射程为13500.）射程最短只能削弱到3000m（不足3000m的无法被削弱）。**」）
   *
   * **值 = 本船自己的削减比例**（电子舰 = `0.15`）。编队口径（船长裁定甲）：
   * **多艘先乘法合成** `r = 1 − Π(1 − vᵢ)`（1 艘 15% · 2 艘 27.75% · 3 艘 38.6%…），
   * **再与敌方"射程增加"做加法**：**净倍率 = `1 + 敌方加成 − r`**（不是乘法）。
   * **地板**：敌方**基础**射程 < `FOE_RANGE_DEBUFF_FLOOR_M`（3000m）⇒ **完全不削**（只吃它自己的增程）；
   * 否则削后结果**下限 3000m**。**只动最远射程**，近界不动（与既有「受击增程」口径一致）。
   *
   * **落点（两处既有单一真相源，开火门/距离衰减/界面射程标签自动跟随）**：
   * `combat.foeGunMaxRangeOf`（舰体武器）与 `combat.foeDroneRangeOf`（敌方机群放飞射程）；
   * 编队削减率每拍重算进运行态 `BattleState.meFoeRangeDebuff`（**不随档** ⇒ 读档/换编队都不陈旧）。
   * 全仓现只有两艘「电子舰」带此字段（`sh-wh-a-frigate` / `sh-wh-d-frigate`），
   * 契约见 `tools/content-check.ts`「电子舰特性契约」。**数据字段驱动**（照 2026-09-16「后勤舰」先例），
   * 界面「船体特性」栏同源。缺省 = 不削（零行为变化）。
   */
  foeRangeDebuffPct?: number
  description: string
  /**
   * **未上线闸门（施工期）**——语义与口径**完全同 `ItemDef.unreleased`**（2026-09-13 船长铁律
   * 「虫洞完成之前，对玩家不可见」）：标了 ⇒ 不进任何"给玩家看的全目录枚举"
   * （首例 = 手册**舰船图鉴**，它直接遍历 `SHIPS` 全目录）。
   *
   * 为什么舰船也要这一道：未上线的船一旦登记进 `SHIPS`，舰船图鉴 / 组装机舰船下拉就会
   * 连名字带描述一起露出去——与 2026-09-13 物品那次（虚空母矿挂上工业页）是同一个坑。
   * **引擎内部照用 `SHIPS` 全目录**（舰种契约、战斗建档、价格口径都不受影响）。
   * **上线动作 = 删掉这一个字段**。
   */
  unreleased?: boolean
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
  /**
   * **稀有渠道 · 消耗品批量档**（**2026-09-20 船长令**：「3 种 MK2 弹药供应量和收购太少了，起码要足够玩家
   * 消耗和交易出售」⇒ 船长选**乙案**：留在稀有订单渠道，给消耗品开批量档）。
   *
   * 稀有订单渠道是为"一件一件的稀罕货"设计的：每 10 分钟抽 `8%~15% × 已解锁稀罕货件数`、**每张单 1~3 件**
   * ⇒ 单看一系 MK2 弹药每天只买得到 30~80 发，而一场 4 舰战斗就要烧 ~3,000 发（差 50~100 倍）。
   * 本字段让**消耗品**在稀有渠道里按批量出单：单张件数 = 稀有单基础件数（1~3）× 本值
   * （**供货与收购两侧同乘**；缺省 1 = 与其它稀有货完全一致）。
   * ⚠ 与 `rareWeightMul` 配对用，且**必须同时写明 `absorbQtyPerWindow`**（见 `content:check` 的
   * 「稀有批量档契约」）：只放大单张件数会让"买得到、卖不掉"（或反之）两头不对称。
   */
  rareQtyMul?: number
  /**
   * **稀有渠道 · 权重乘子**（同批船长令）：稀有抽取（`slowSupplyDraw`）与簿面收购单概率各乘本值。
   * 用途 = 让"消耗品"在稀有池里**更常出现**（例 ×3 ⇒ 每系每天约 3 万发供货，够 ~10 场战斗）；
   * 值不宜过大：rare 池是 167 件共用一次抽取，权重太高会把别的稀罕货挤出场。
   */
  rareWeightMul?: number
  /** 收购档位（2026-09-08 船长定：收购价 = 该倍率 × L；单件缺省按 rarity = common 0.6 /
   * rare 0.65 / exotic 1.0；池商品留空 = 原料平价 1.0L，池耗材显式 0.6。防套利：
   * 收购恒低于供应价，倒买倒卖恒亏税） */
  demandMultiplier?: number
  /** 玩家可否卖出（默认 true） */
  playerSellable?: boolean
  /** 玩家可否买入（默认 true） */
  playerBuyable?: boolean
  /**
   * **未上线商品**（2026-09-12 船长定：「所有虫洞相关的内容需要等虫洞落地后才统一对玩家可见」）。
   *
   * 语义 = **数据齐备、玩家可见面为零**：`buildSimContext` 把它挡在 `ctx.marketGoods` **之外**，
   * 于是市场页/图鉴/挂单/订单/任务/事件/工具**一律看不到也交易不到**；但它在**目录表**里，
   * `content:check` 的"每种物品必须有市场卡""价格口径"等契约**照样核得到**。
   *
   * 用法：新内容先按正式数值写卡并标 `unreleased: true`，**上线时删掉这一个字段**即可开卖
   * （不要把整张卡注释掉——那会让契约漏检）。
   */
  unreleased?: boolean
  /** 需要的协会声望（V10：部分高端商品声望解锁；买入时校验，卖出不限） */
  standingReq?: number
  /** 暗市双通道声望闸（P2 2026-09-06 船长定：rare 抽取节拍 + 暗市单可绕过）：
   * 声望低于本值 → 该商品为"闸内"：不占常驻供给线，以 RARE_LOCKED_WEIGHT 低权重参与每
   * RARE_DRAW_PERIOD_MS（10 分钟）的加权有放回抽取，命中即暗市单：价 ×4、标记 bm、
   * 可绕过常驻拦截买入；常驻挂单不开放。达标后整批解锁：恢复正常权重/正常价（不转为常驻商品）。
   * 与 standingReq 正交：standingReq = 纯硬拦（现役顶船维持，不加暗市）。 */
  bmStanding?: number
  /** 数字稀有度（2026-09-09 船长拍板：稀有度入物品本体——data 层 RARITY_TIER 表，
   * 构建 SimContext 时按 refId 填充；市场/图鉴/未来掉落统一查）。档位与允许带
   * （**2026-09-16 船长改判**：「**修正契约，rate现在允许2~4，exotic拓展到3~5**」）：
   * 1 常驻层（common 必 1）· **2/3/4 可走稀有订单**（2 大众 / 3 高阶；4 目前只有当日挪进
   * 稀有订单的 5 艘官方巡洋舰）· **3/4/5 可走奇货**（5 暂无商品，为将来更高档预留）。
   * 与 rarity 渠道分离：**只驱动稀有订单渠道的刷新权重**（卖单抽取 + NPC 收购窗；
   * `rareTierWeight` = ⟪**2026-09-25 船长令**⟫ **档 2 ×1 · 档 3 ×0.5 · 档 4 ×0.2 · 档 5 ×0.05**），
   * 奇货渠道出率与数字不挂钩 */
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
  /** 限定商品每个抽取窗（10 分钟）独立掷骰的出单概率：**1%**×现货抢购学（约每件每 16.7 小时一轮；
   *  ⟪2026-09-25 船长令⟫ 0.8% → 1%，旧值约 20.8 小时一轮） */
  exoticWindowChance: number
  /** 数字稀有度 3 档权重（稀有订单渠道按数字分层的刷新权重乘子；2 档（大众）= 1；
   *  作用于 rare 卖单抽取与 NPC 收购窗）。沿革：2026-09-09 立表 0.25 → 2026-09-10 定 0.15
   *  → ⟪**2026-09-25 船长令**⟫ 现行四档阶梯 **1 / 0.5 / 0.2 / 0.05** ⇒ 本档 **0.5** */
  rareTier3Weight: number
  /** **数字稀有度 4 档权重**（2026-09-16 船长选「选项 B」补的单独系数 0.05
   *  → ⟪**2026-09-25 船长令**⟫ 四档阶梯 `1 / 0.5 / 0.2 / 0.05` ⇒ 本档 **0.2**） */
  rareTier4Weight: number
  /** **数字稀有度 5 档权重**（⟪**2026-09-25 船长令**⟫ 首次设立 = **0.05**）。
   *  ⚠ 立此字段之前档 5 **没有系数**、走 `else` 拿 ×1（与大众档同频）⇒ 实测 `bp-shieldfield-3`（档 5）
   *  反而比档 4 的 `bp-shieldfield-2` 常见 3 倍；本次一并修好（见 `balance.ts` 该组字段的沿革）。 */
  rareTier5Weight: number
  /** 蓝图书权重乘子（2026-09-10 船长定：**50% → 5%**，稀有抽取与奇货掷骰**两个渠道都乘此值**） */
  blueprintWeight: number
  /** **一次性舰船蓝图**的权重乘子（2026-09-13 船长：「还是有惩罚吧，按50%算」）——
   *  判定 = 市场行的 `refId` 在 `ctx.shipBlueprints` 里是 `singleUse` ⇒ 用本值替代 `blueprintWeight`
   *  （普通蓝图仍 ×`blueprintWeight`）；两个渠道（rare 抽取 / 奇货掷骰）同口径。 */
  singleUseBlueprintWeight: number
  /** 蓝图书在稀有渠道的订单寿命（毫秒；2026-09-10 船长定 6 小时）——
   *  权重降到 5% 后书出现得稀，若仍只挂 36 分钟玩家基本只会错过；
   *  奇货渠道的蓝图原本就走 exotic 档 6 小时，与此一致。 */
  blueprintLifeMs: number
  /** 窗口净成交量超过该比例（相对参考量）时触发冲击 */
  shockTriggerRatio: number
  /** 每次冲击的价格偏移（比例，可正可负；**叠加无上限**，靠衰减半程兜底） */
  shockPerTrigger: number
  /**
   * **倾销惩罚层数 → 买单量放大**（2026-09-11 船长：「提高倾销惩罚，同时每层惩罚还会提高系数一半的订单量」
   * → 追问后定「**修改为每层提高 8% 买单数量**」「**所有商品都适用**」；
   * **2026-09-17 船长改判**：「分别改为 **+40%/−40% 每层，并且是乘法叠加**」）：
   * 每累计一层未衰减的惩罚，**NPC 收购单（买单）的挂单量**放大 `(1+本值)^层数`（**乘幂，不是线性**）。
   * 层数 = `|shock| ÷ shockPerTrigger`（未衰减的净层数，随时间自然回落）；
   * **只在砸盘方向生效**（`shock < 0`）——玩家买入推高价格时不放大买单量。
   * ⚠ 量级：8.2 层 ⇒ ×15.8；9.2 层 ⇒ ×21.9。
   */
  dumpBuyVolumePerLayer: number
  /**
   * **砸盘时 NPC 挂卖单量的同步削减**（2026-09-11 船长：「**砸盘时，挂卖单的量进行同步削减**」；
   * **2026-09-17 船长改判**：「改为 **−40% 每层，并且是乘法叠加**」）：
   * 每累计一层未衰减惩罚，**供应单（挂卖）挂单量** ×`(1−本值)^层数`（**乘幂**）；**下限 10%**；
   * 只在砸盘方向生效。与 `dumpBuyVolumePerLayer` 对称 ⇒ 砸得越狠：接货的越多、出货的越少。
   * 只作用于**池商品供应阶梯**（单件/稀有/奇货的供应单恒 1 张，不适用）。
   * ⚠ 0.6^层数 在 ~4.5 层即撞 10% 下限。
   */
  dumpSellVolumePerLayer: number
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
    /** 循环时间缩减技能 id（技能表里是「采矿舰入门学」；2026-09-22 由「采集器入门学」再改名） */
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
    /** 每次远征**失利**扣耐久区间（0~1）——战败口径，未改 */
    durabilityLossMin: number
    durabilityLossMax: number
    /**
     * **撤退那一口的暴露秒数**（2026-09-11 船长定 K = 1 秒、手动/自动/超时三档同一 K；钱包维修费不变）。
     * 一口 = 敌群火力（威胁 × `foeDpsPerThreat`）× 本值，**先扣装甲、吸完再进结构**，结构底线 5%
     * （算法单点 `hullDamage.ts`，与低安遇袭受损档同一套；取代旧「结构 −7.5%~15% 固定骰、装甲不动」）。
     * ⚠ **2026-09-14 船长改判「玩家撤离战斗按照 10 秒算」⇒ 1 秒作废**，且范围扩到**四档同一 K**
     * （主动撤退 / 结构<50% 自动脱离 / 超时 / 无法交战）；虫洞撤离战不吃本值。
     */
    retreatHitFirepowerSec: number
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
    /** 2026-09-08 立、2026-09-11 船长定改为**按技能记系数**：工业专用扩容技能表——技能 id → 每级新增工位数
     * （只对站内精炼炉/回收炉/制造线生效，不增加 AI 副船任务上限；每个工位仍占用一枚实体 AI 核心） */
    industrySkillSlots: Readonly<Record<string, number>>
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
    /** 「修理组件恢复量」加成技能表（2026-09-13 船长：舰体快修学 + 维修工程学**同效果、按级线性相加**；
     *  **两条用件路径共用**：直接使用与船体维修装置每跳。每级 0.05 ⇒ 两条都满级 = +50%） */
    quickRepairSkills: { id: string; perLevel: number }[]
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
  /** 长途运输报酬（2026-09-12 船长定：安全档收益率 + 距离指数） */
  haul: HaulBalance
}

/** B1 低安遭遇 / 伏击：占用随机事件时机；到达缓冲 + 到点遇袭概率（2026-09-04 定稿） */
export interface EncounterBalance {
  /**
   * **低安上限（含）**：星系安全等级 **≤ 此值** 才掷伏击。
   * 2026-09-12 船长两条裁定（「将伏击掷骰阈值降低为0」＋「0也算低安」）⇒ 现值 **0**：
   * **只有低安（sec ≤ 0，含 0）会遇袭**，中安（0 < sec < 0.5）与高安一律不掷。
   * ⚠ 本值同时是遇袭概率公式的**零风险参考点**（见 `encounters.rollLowSecAmbush`）。
   */
  lowSecMax: number
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
  /**
   * 受损档「被咬一口」的伤害系数（**秒**；船长 2026-09-11 定：伤害按**敌人火力**折算）。
   * 一口伤害 HP = 敌群火力代理（`battle.foeDpsPerThreat` × 威胁 = 敌方总火力/秒）× 本系数，
   * 施加时**先扣装甲、吸完再进结构**（与日志「被咬下一块装甲」同口径）。
   * 取代旧 `duraLossMin/duraLossMax`（结构 −5%~15%，与敌群强度无关，2026-09-11 作废）。
   * ⚠ **2026-09-14 船长改判「遇袭失败损失按照 5 秒算」⇒ 原 0.3 秒作废**；两处一起变
   * （文字结算「受损」档 + 应战失利追加口），「快速脱离」按遇袭口径。
   */
  hitFirepowerSec: number
  /** 撤退线（船长 2026-09-12 改判「**先维修**，组件不足或者修完后结构 <50% 返港」）：遭遇了结后
   *  **先自动用修理组件补耐久**，若**组件耗尽**或**修完后结构仍低于此比例** ⇒ 被袭船停手返港待命
   *  （主控停作业 / 副船中止任务；**不自动再派**，回港等玩家决定）；
   *  同时作为低安遭遇战的自动脱离阈值。⚠ 2026-09-11 的「不自动维修」旧口径已作废。 */
  retreatHullFrac: number
  /** 遇袭自动修理的**目标值**（2026-09-12 船长定；触发线 = 装甲或结构 < `retreatHullFrac`，
   *  修到两者都 ≥ 本值或组件耗尽——与重复清剿的 0.6 同口径） */
  repairTargetFrac: number
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
  // ⚠ 原 `minFactor`（时间因子下限 0.35）**已于 2026-09-12 按船长裁定「删除下限」移除**：
  //   下限只卡快船（航行族 3 级起飞鱼级与剑鱼级单程时间完全相同；满技能时 剑鱼 ÷ 皇带鱼
  //   的时长差从 2.21× 削到 1.41×）⇒ 现**无下限**，`travelTimeFactor` 直接返回乘积。
  /** 航行加速技能族（效果趋同统一）：每级各按 cutPerLevel 缩短星图航行时间（乘算） */
  skillIds: readonly string[]
  /** 每个技能每级的时间缩减比例（如 0.04 = 4%） */
  cutPerLevel: number
}

/**
 * 长途运输报酬（**2026-09-12 船长定：安全档收益率 + 距离指数**）。
 * 取代旧口径「单段报酬 = 货仓 × 0.6 × 标称分钟 × 行情倍率（与航线长短无关、各线时薪相等）」。
 */
export interface HaulBalance {
  /** 安全档收益率（按**逐跳取两端较低档**累加成"有效距离"）：高安 0.5 / 中安 0.75 / 低安 1 */
  securityMul: { 高安: number; 中安: number; 低安: number }
  /** 距离指数 p（>1 ⇒ 超可加：**单段总报酬 ∝ 有效距离^p**，跑完整一段比拆成两段跑更赚） */
  distExp: number
  /** 锚定航线的标称分钟（母港 ⇄ 烬火前哨站 = 10）——报酬标定以该线时薪不变为准 */
  anchorNominalMinutes: number
  /** 锚定航线的**有效距离**（母港 ⇄ 烬火前哨站 = 7.75：3×0.5 + 3×0.75 + 4×1.0） */
  anchorEffectiveMinutes: number
}

/** 敌方战术性格（V11）：brawl 贴脸近战 / orbit 中距绕圈 / kite 拉远吊打 */
export type FoeTactic = 'brawl' | 'orbit' | 'kite'

/** 敌方血型（V11）：盾型 / 甲型 / 均衡（决定敌方三层血量比例） */
export type DefProfile = 'shield' | 'armor' | 'balanced'

/**
 * **虫洞内敌方选靶模式**（船长 2026-09-13 定 · 虫洞专属机制）。
 *
 * 多单位战斗（我方 4 艘同时参战）下，敌人按本模式从**存活我方单位**里挑目标；
 * 并列（同输出 / 同档 / 多艘非战斗船）一律**等权随机**。
 *
 * - `random` 缺省：等权随机（与"每发独立抽敌人"对称）
 * - `top-output`：打**武器名义 DPS 之和**最高的那艘
 * - `smallest` / `largest`：按**舰种档**（T1 护卫舰 … T4 战列舰）取最小 / 最大
 * - `noncombat`：打**非战斗船**（舰种定位 `industrial` 工业/采矿 · `hauler` 货舰；
 *   `armed` 武装 / `armored` 装甲不算）；**编队里没有非战斗船时退回 `random`**
 *
 * ⚠ **只有虫洞内的敌卡会写**（`AnomalyDef.foeTargeting`）——现有 27 张悬赏卡、低安遭遇、
 * 窝点派生卡一律不写 ⇒ 单船路径连选靶函数都不调用，行为与随机数消费顺序**逐字节不变**。
 */
export type FoeTargetingMode = 'random' | 'top-output' | 'smallest' | 'largest' | 'noncombat'

/** 选靶模式的中文名（界面/战报/工具读数用；施工期仅调试面板可见） */
export const FOE_TARGETING_LABELS: Record<FoeTargetingMode, string> = {
  random: '随机抽取',
  'top-output': '打输出最高的',
  smallest: '打最小的',
  largest: '打最大的',
  noncombat: '打非战斗船',
}

/**
 * **能量武器形态**（2026-09-11 船长裁决⑤：「**立「能量·掷命中」档**」；只对能量主系生效）：
 * - `'beam'`（缺省）= 激光式**光束必中**（不掷命中、不消费 `hitRate`、守方回避不生效），远端做**威力**衰减；
 * - `'spit'` = **能量掷命中**（喷吐 / 投射）——掷命中 + 命中随距离衰减、消费 `hitRate` 并吃守方回避，
 *   层位克制仍走等离子行。
 * 详见 `FoeShipDef.energyForm`。
 */
export type EnergyForm = 'beam' | 'spit'

/** V11 战斗平衡常量（唯一调参处；初值在校准脚本阶段核对） */
export interface BattleBalance {
  /** 命中率输出钳制：开放边界 0% / 100%（贴脸高加成场合可必中、极端劣势可完全脱靶） */
  hitMin: number
  hitMax: number
  /** P0 承伤持久化：护盾战中被动回充（每秒回充 = 满盾 × 此比例；0 = 关，初值见 balance） */
  shieldRegenPerSec: number
  /** 多波次转场（2026-09-09 船长建议）：下一波出现时把战斗距离向开战距离回拉的比例
   * （0 = 原地续战；1 = 完整回到开战距离重新接近；默认初值见 balance）
   * ⚠ **本条只在 `waveReopenEnabled === true` 时生效**（2026-09-11 船长：暂时关闭距离后退惩罚）。 */
  waveReopenFrac: number
  /** **多波次转场距离回拉总开关**（2026-09-11 船长：「将敌人增援波次距离会后退的惩罚**暂时关闭**」）。
   * - `false`（**现值**）= **关闭**：下一波在同一交战距离**原地入场**，不再"从远处入场、重新接近"
   *   （玩家不再因波次转场被拉回远距离、重演接近期）；玩家可见日志同步改为中性表述；
   * - `true` = 开启：按 `waveReopenFrac` 向开战距离回拉（2026-09-09 的原始口径）。
   * 与「敌突进」「单波次内增援」同款**总开关**形式：机制整套保留，改这一个布尔即恢复。 */
  waveReopenEnabled: boolean
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
     ⚠ 命中：**2026-09-14 船长改判后不再"乘于船体 hitBonus"**——索敌统合改为乘在
     **炮台/导弹架的基础命中率**上（与火控阵列学同通道、乘算叠加，见下 `hitSkillId`）。 */
  cpuSkillId: string
  cpuPerLevel: number
  speedSkillId: string
  speedPerLevel: number
  evasionSkillId: string
  evasionPerLevel: number
  /** **索敌统合（命中技能）**：**炮台/导弹架的命中率**每级相对乘算（2026-09-14 船长改判：
   *  原为"舰船命中加成 ×(1+5%/级)"，现与「火控阵列学」同口径、每级 2%） */
  hitSkillId: string
  hitPerLevel: number
  /** 距离动力学：距离下限（贴脸极限）与开战距离 = 双方最远武器射程×openRangeFactor
   *  + max(openRangePadM, 最远射程×openRangePadShare)（船长 2026-09-05：缓冲按射程比例拉开） */
  minDistanceM: number
  openRangeFactor: number
  openRangePadM: number
  /** 缓冲比例：开战缓冲 = max(100m 下限 openRangePadM, 双方最远射程×本比例)（默认 0.1 = 10%） */
  openRangePadShare: number
  /**
   * **默认期望交距在主武器有效射程带内的位置**（0 = 最小射程 · 0.5 = 中点 · 1 = 最大射程）。
   * 2026-09-15 船长裁定（玩家报「赏金任务初始距离非常近、对远程武器不利」）：**星图与洞内统一 0.8**
   * （当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
   * 贴脸/风筝两档不受影响。
   */
  desireBandMid: number
  /**
   * **洞内「近战怪开局距离」的档位**（0.5 = 中段）。船长选「乙」：默认期望抬到 0.8 时，
   * 这条 2026-09-13 定的「贴脸怪一开场就在你脸上」**保持不动**（与 `desireBandMid` 分属两处用途）。
   */
  wormholeBrawlOpenBand: number
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
  /**
   * **敌舰体火力「越线折扣」的阈值（DPS）**——2026-09-12 船长「按照 DPS 上限 150 算」定其值，
   * **2026-09-15 船长改判其形态**：「**不是钳制到150，而是超过150的部分进行一个约15%的折扣**」。
   * 舰级路径（`anomaly.ships`）按**整卡每波舰体总 DPS** `D` 判线——Σ（舰级单发 × `dmgMul` ×
   * 多舰补偿 2N/(N+1)）÷ 装填秒；`D ≤ 本值` ⇒ 逐字不动，`D > 本值` ⇒ **只对超出部分打折**
   * （折扣率见 `foeDpsOverCapDiscount`），再把该系数**等比例**施加于全卡舰体单发。
   * - **不含机群**（`src:'drone'`）：机群另有机制（受击增程 · 备用机库 · A5 火力守恒），且您已裁定不吃多舰补偿；
   * - **不含被 `droneFireShare` / `firepowerAnchor` 拆分的条目**（那条链自带总火力锚定，再打折会让锚点失准）；
   * - **未写 / 非正（含 0）⇒ 不折扣**（零行为变化开关）；
   * - ⚠ **口径沿革**：2026-09-12 首落为**硬钳制**（越线一律压到上限），同日按船长「火力钳制也暂时关闭」置 0；
   *   **2026-09-15 改为折扣制并写回 150**（含虫洞——船长「是，都生效」）。
   */
  foeDpsCap?: number
  /**
   * **越线折扣率**（2026-09-15 船长：「超过150的部分进行一个约15%的折扣」）：
   * 越线时目标总 DPS `D′ = foeDpsCap + (D − foeDpsCap) × (1 − 本值)`，缩放系数 `= D′ / D`
   * 施加于**全卡舰体单发**（条目相对权重不变、逐条取整同旧口径）。
   * - 现值 **0.15**（超出部分打 85 折）；「约 15%」⇒ 本值即调校旋钮，验收后要改只动它；
   * - **不封顶**：`D → ∞` 时 `D′ ≈ 0.85 × D`（斜率由 1 降为 0.85，火力仍随威胁继续增长）；
   * - **未写 / 非正（含 0）⇒ 不缩放**（与 `foeDpsCap` 同为开关；⚠ **0 不会退回旧硬钳制语义**）。
   */
  foeDpsOverCapDiscount?: number
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
  /**
   * **舰种基准速度**（m/s，**敌我共用**；2026-09-11 船长给定：1 护卫舰 340 / 2 驱逐舰 295 /
   * 3 巡洋舰 258 / 4 战列舰 205 / 5 旗舰 155）——**敌舰级的实速 = 本表[舰种档] × `FoeShipDef.speedRatio`
   * （再乘编成条目的 `speedMul`，若有）后取整**；旧路径（威胁推导）不读本表。
   * ⚠ **数值字面量只在本表这一处**：core 不能 import data 包，故由 data 包
   * `packages/data/src/hullClass.ts` 的 `HULL_CLASS_BASE_SPEED` **反向读本字段**，避免两包各写一份调参数字而静默漂移。
   * `content:check`「舰种契约」校验取值落在合理值域 100~500。
   */
  hullClassBaseSpeedMps: Record<1 | 2 | 3 | 4 | 5, number>
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
  /** 战斗时长硬上限：打满即判负并按被迫撤退结算（2026-09-10 船长定；旧口径"按剩余血量比判胜"已作废） */
  maxBattleMs: number;
  /** **无法交战的提前脱战阈值**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：
   *  开战满本毫秒数时，若**我方全程一炮未发**（`stats.meShots === 0`）**且当前距离仍在我方最远射程之外**
   *  **且敌人已经开火**（`stats.foeShots > 0`）⇒ 判负并按撤退结算（`escapeReason = 'cannot-engage'`），
   *  不再空转到 `maxBattleMs`。动机 = 远程型（kite）敌把交战距离拉在自己带内时，短射程/无推进器装配
   *  会全程 0 开火、空转 140~600 秒（灰霾打满 600s 触顶；蜃影/赤潮在 140/373s 被击毁）。
   *  `0` = 关闭本判定。 */
  cannotEngageMs: number;
  /* ═══ 推进器周期爆发（2026-09-10 船长定：60 秒爆发 / 60 秒冷却 / 开场即启动）═══ */
  /** 爆发窗口时长（毫秒）；周期由战斗时钟推导，不占存档字段 */
  thrusterBoostMs: number
  /** 冷却窗口时长（毫秒）；冷却期内推进器**不提供任何速度加成** */
  thrusterCooldownMs: number
  /* ═══ 敌冲锋（2026-09-10 船长定；2026-09-11 改判结束条件；**2026-09-14 逐单位 + 命中解除 + 冷却 10 秒**）═══
   * ⚠ 船长 2026-09-10：**暂时先取消实装，仅实现功能** → `foeChargeEnabled` 默认 false，
   *   机制齐备但"老路"（威胁门槛 + brawl）不触发；舰级级 opt-in 不受该开关约束。 */
  /** 冲锋总开关（默认 false = "老路"未实装；舰级级 opt-in 不走这里） */
  foeChargeEnabled: boolean
  /** 冲锋期敌机动倍率（**缺省值**；舰级 `FoeShipDef.foeChargeMul` 可覆写）——2026-09-14 船长定为 **3.0** */
  foeChargeMul: number
  /**
   * **冲锋触发余量**（船长 2026-09-14：「冲锋按乙方案来」）：距离 > 期望交距 + 本值 ⇒ 开始冲锋。
   * 与"够不着（超出自己射程）"**取或**；解除见 `foeChargeCooldownMs` 处的说明（命中解除 + 到达兜底）。
   * 例：噬口巨兽期望交距 543 ⇒ **1,543 m 起冲**（旧口径要 3,713 m 以外）。
   */
  foeChargeTriggerMarginM: number
  /** 进入自己武器射程后再维持多久，随后突进结束 */
  foeChargeMaxHoldMs: number
  /** 冲锋冷却（毫秒）：**解除后**这么久内不能再次冲锋（2026-09-14 船长由 20 秒改判为 **10 秒**） */
  foeChargeCooldownMs: number
  /** 冲锋威胁门槛：只有威胁 ≥ 此值、且战术为近战（brawl）的敌卡会冲锋（与 pdThreatFloor 同口径；只管老路） */
  foeChargeThreatFloor: number
  /* ═══ 单波次内增援（2026-09-11 机制落地 → **2026-09-19 船长批「支援呼叫装置」启用**）═══
   * 启用依据 = 船长 2026-09-19：「战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程之外时，
   * 增援2艘静滞卫舰。」⇒ `foeReinforceEnabled = true`；守卫由 content:check 的
   * 「**支援呼叫装置契约**」接管（只允许挂了该件的卡写 `enterAt`/`enterBranch`、两支成对且守恒）。
   * ⚠ **与多舰补偿系数 `2N/(N+1)` 是结构解法 vs 数值补偿两条路**：洞内派生会把总量归一
   * （补偿只影响血/火力比 `r`）⇒ 不叠加；全局复核仍挂着（见 `docs/design/foe-reinforce-20260911.md`）。 */
  /** 单波次内增援总开关（**2026-09-19 起 = true**；关掉 = 建档期不写 `foeReinforceAt`，零行为变化） */
  foeReinforceEnabled: boolean
  /** 增援入场时的**距离重开比例**（语义同 `waveReopenFrac`：向开战距离回拉这个比例；
   * 0 = 原地入场不重开 = 缺省口径） */
  foeReinforceReopenFrac: number
  /**
   * **「支援舰船召唤装置」总开关**（船长 2026-09-25：「给入侵母舰添加类似D族挂载件的独立挂载件，
   * 只不过改为复活被摧毁的友军（但是表现形式上为敌方支援舰船入场），增援时间是60秒，每次随机复活一艘」）；
   * 见 `FoeMountDef.reviveEscort`。
   *
   * `false`（缺省形态）= 建档期照旧写 `foeReviveEscort`（读数可见），但**战斗中一次都不召唤**
   * ——与 `foeChargeEnabled` / `foeReinforceEnabled` 同款总开关形态；本批随船长令**置 true**
   * （只有挂了该件的单位会召唤 ⇒ 其余战斗零行为变化）。
   */
  foeReviveEnabled: boolean
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
  winPenaltyHullPerFull: number  /* ═══ 敌舰近防炮（2026-09-10 船长拍板「无人机可被击落」，永久损失制）═══ */
  /** 点防起始威胁：威胁 < 此值的敌舰不装近防炮（2026-09-10 船长：60） */
  pdThreatFloor: number
  /** 判定周期（毫秒）：每艘点防舰每 0.5 秒判定一次伤害 */
  pdJudgementMs: number
  /** 判定命中率（直接与机型闪避相减；不叠敌方通用命中加成） */
  pdAcc: number
  /** **命中率下限**（2026-09-12 船长「允许命中下限 10%」）：`命中 = clamp(pdHitFloor, 1, pdAcc − 机型闪避)`
   *  ——防"机型闪避 ≥ pdAcc ⇒ 近防炮永远打不到"（首例 = 专属无人机闪避 0.55）。 */
  pdHitFloor: number
  /** **近防炮舰种档系数**（2026-09-12 船长「敌人防空火力受舰船级别影响。越大的舰船防空火力越强」）：
   *  索引 0 = T1 护卫舰 … 4 = T5 旗舰；每次命中伤害 = `pdDmg × 本系数`。 */
  pdTierMul: readonly number[]
  /** 命中单发伤害（走该机型三层抗性） */
  pdDmg: number
  /**
   * **按族的近防炮覆写**（**船长 2026-09-25 令**：「增强 H 族敌人的近防炮强度：其近防炮伤害增加50%，
   * 命中提高5%」）——`dmgMul` 与 `pdDmg × pdTierMul` **连乘**；`accAdd` 是**百分点**加在 `pdAcc` 上
   * （仍走 `pdHitFloor` 下限与机型闪避那套 clamp）。
   * 缺省/该族没登记 ⇒ 逐字走全局值（零行为变化）。族从 `UnitSpec.family` 取。
   */
  pdFamilyOverride?: Partial<Record<FoeFamily, { dmgMul?: number; accAdd?: number }>>
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
  /** 2026-09-11 船长：协处理器（低槽，装配 CPU 预算扩容；见 ModuleDef.cpuBonus） */
  | 'cpu'
  | 'target-lock'
  /**
   * 2026-09-20 船长：「**新增高槽装备，护盾充能力场装置**」——**护盾族**，但**装在高槽**
   * （见 `ModuleDef.shieldFieldPct`；`rack` 在数据侧显式写 `high`）。
   * ⚠ 与 `shield`（中槽·护盾装置）分开一族：`rackOf` 的缺省推导是一族一槽，
   * 单独成族才能让"族 → 槽"保持一一对应（否则要处处依赖显式 `rack`）。
   */
  | 'shield-field'

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
  /**
   * **虫洞内「打捞/采集效率」**（2026-09-19 船长「谜质科技树」批：「给现有的打捞/采集添加效果，根据采集效率，
   * 有概率额外打捞/采集一堆。如果效率超过100%，溢出部分再计算一次打捞概率」）——
   * 每次打捞/采集动作，按**Σ（编队里各台的效率）**掷额外堆：`floor(效率)` 保底 + `frac(效率)` 再掷一次。
   * 档位值（船长 2026-09-19）：民用 **0** · MK1 **0.2** · MK2 **0.4** · MK3 **0.6** · 异星原型 **0.8**。
   * 只对 `slot: 'salvager' | 'miner'` 有意义（体检有契约）；**本字段不进洞外的采矿/打捞产率公式**
   * （洞外仍走 `bonus` 与打捞周期）。
   */
  workEfficiency?: number
  description: string
  /**
   * **未上线闸门（施工期）**——语义同 `ItemDef.unreleased`（2026-09-13 船长铁律）。
   * 标了 ⇒ 不进手册**装备图鉴**（它直接遍历 `MODULES` 全目录）；引擎内部照用全目录。
   * **上线动作 = 删掉这一个字段**。
   */
  unreleased?: boolean
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
  /**
   * **结构层容量**加成（2026-09-10 船长：E 族巨构骨架——"结构层是全游戏唯一没有容量模块的一层"）：
   * 0.6 = 结构血量 +60%。多件加算求和（与 armorHpBonus 同口径），生效处 = combat.createPlayerSpec
   * 的 hp.h（船体加固理论等技能再乘于其上）；抗性层仍走 hullResistAdd，两者互不替代。
   */
  hullHpBonus?: number
  /**
   * 装甲件**常驻速度代价**（2026-09-10 船长：陵寝装甲层"装甲 +110% 但速度 −25%"）：
   * 0.25 = 战斗机动速度 ×0.75。**多件只取最重一件**（与推进器失稳 hitPenalty 同口径——
   * 重甲不会叠成静止）；生效处 = combat.createPlayerSpec 的 speedMps。
   */
  speedPenaltyPct?: number
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
   * **推进器点火周期覆盖**（2026-09-14 船长新增「微型跃迁引擎」：点火 **10 秒** / 冷却 **60 秒**）。
   * - **不写 = 用全局**（`balance.battle.thrusterBoostMs/thrusterCooldownMs`，三档矢量推进器就是这样）；
   * - 写了 = **本单位**改用这一套窗口（逐单位判定，见 `combat.thrusterPhase` / `unitThrusterCycle`）；
   * - 一船多件推进器时取**点火最短的那件**（`createPlayerSpec` 的 `propCycle` 单点）。
   */
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
  /**
   * **跃迁速度加成**（2026-09-14 船长新增「**跃迁计算机**」MK2/MK3：**+20% / +35%**，低槽支援件）。
   *
   * 语义 = **星系际航行**的有效跃迁速度 ×(1 + 本值)——生效处是 `travel.warpSpeedAus`
   * （所有航行路径的唯一入口：采矿往返 / 悬赏·远征 / 长途运输 / 扫描返航 / 快递 / AI 副船，
   * **逐船**生效）。**不碰战斗机动**——那是 `speedBonusPct`（矢量推进器）与推进器周期的地盘。
   *
   * **多件走 EVE 曲线**（`Π(1+pᵢ·wᵢ)`，与"命中/目标锁定"同一条，见 `equipment.curveMult`）：
   * 多装递减 ⇒ MK2 1/2/3/4 件 = ×1.20 / ×1.41 / ×1.57 / ×1.66；MK3 = ×1.35 / ×1.76 / ×2.11 / ×2.32。
   * ⚠ **战斗机动速度（`speedBonusPct`）自 2026-09-20 起不再走这条曲线**，改「折权加算」（`equipment.weightedSum`）。
   */
  warpSpeedBonusPct?: number
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
  /** **单轮发数**（缺省 1）：单轮总伤 = `dmgMult × shots`。⟪2026-09-22 船长令⟫ 陵卫连装炮 = 4.6 × 2 */
  shots?: number
  /** 装配占用 CPU（V17 起装配校验生效：模块合计不得超过船体 cpu；与无人机放飞共用） */
  cpuUse?: number;
  /**
   * **防空（属性）**（船长 2026-09-11 A1「玩家武器通常**不可打**，**需要带有防空属性的武器**
   * （**为近防炮做铺垫**）」＋ 2026-09-12「**给近防炮系列添加一个属性"防空"，将近防炮的对无人机
   * 伤害 ×2 写到防空属性里**」）。
   *
   * 语义（**一条属性两个含义**）：
   * 1. **能筛到敌方机群**（`WeaponSpec.canHitDrones`）——不带本属性的武器**按构造看不到**机群
   *    （含我方无人机；船长 B1）；
   * 2. **对无人机伤害 ×本值**（`WeaponSpec.antiDroneMul`）——只作用于打机群那一支，
   *    **对舰伤害一字不动**。
   * 玩家侧现只有**近防炮**携带（三档都是 **2**，船长 2026-09-12「那伤害倍率按2倍算」）；
   * 敌方近防炮是**抽象自动系统**，不走本字段（船长 B3/C1）。
   * ⚠ 缺省不写 = 打不到敌机 ⇒ **既有装备零行为变化**。
   */
  antiDrone?: number;
  /* ═══ V18 无人机装置位（远行星号式高槽装置；家族以字段判别：有 droneBayBonusM3 = 甲板扩展、
     有 droneDmgBonus = 战术导控、有 droneRangeBonusPct = 中继天线；归槽 rack = high，见 labels.rackOf） ═══ */
  /** 无人机甲板扩展：+droneBayM3（携带/放飞上限扩容；线性可叠件） */
  droneBayBonusM3?: number
  /** 战术导控阵列：放飞无人机单发伤害加成（0.12 = +12%；线性求和乘入；线性可叠件） */
  droneDmgBonus?: number
  /** 无人机中继天线（2026-09-10 船长拍板百分比制）：放飞无人机射程上限加成
   * （0.2 = +20%；求和后乘入机型基础射程；线性可叠件——MK1/2/3 = 0.2/0.45/0.8） */
  droneRangeBonusPct?: number
  /**
   * **无人机结构层加成**（2026-09-13 船长：G 族「鱿蜂结构层」＝原残兵结构层 —— 「提高无人机 80% 的结构」）：
   * 0.8 = +80%；本舰多件**求和**，只放大机群生存池的**结构层**（`DronePoolEntry.h`），与机型基础结构值同链。
   */
  droneHullHpBonusPct?: number
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
  /** 每脉冲消耗的修理组件 id（民用级 = 民用修理组件；MK1/MK2 = 军用修理组件）。
   * **无消耗件（生体自愈）不填本字段，改填 repairFree** */
  repairKit?: string
  /**
   * 无消耗自动修复（2026-09-10 船长：异形生体件的自愈能力）——与 repairKit 互斥：
   * 脉冲修复**不扣任何组件、永不停机**；修复量在多件同型间按 EVE 曲线收敛
   * （见 combat.preloadRepairFor：权重 100%/87%/57%/28%/11%）。
   */
  repairFree?: boolean
  /**
   * **修复量按平值结算**（**不**吃层容量加成）——2026-09-17 船长两次点名给的口径：
   * 「**生体甲壳板的维修量，我希望不吃装甲容量的加成**」＋「**损管腔也一同修改**」。
   *
   * 背景：2026-09-16 船长定「维修量**统一吃**层容量加成」（额外护甲/结构加成会按同比例抬高每跳修复量，
   * 与修理组件同一把尺）——本字段是那条的**例外**：填 true 的件每跳 = `repairArmorHp/HullHp × 曲线权重`，
   * 不乘 `layerAmpOf` 的 `a/h`。只对**无消耗自愈**类件有意义（耗组件装置照旧吃加成）。
   * 现持有人 = **生体甲壳板（装甲）＋ 生体损管腔（结构）**，2026-09-17 同批落的。
   * ⚠ 再有新件要不要开例外，等船长点名，别自行补齐。
   */
  repairIgnoresCapacityAmp?: boolean
  /* ═══ 2026-09-14 护盾充能装置（船长：「和船体修理装置类似。每 15 秒恢复自身护盾最大值一定比例
     的护盾量。CPU消耗较多」）——中槽；与维修装置**独立计时**，不吃组件 ═══ */
  /**
   * **每脉冲充能比例**（占**自身护盾最大值**的几分之几，如 0.12 = 12%）。
   * 脉冲间隔固定 = `SHIELD_PULSE_MS`（15 秒）；脉冲量按**满盾**的该比例算（不是当前盾）。
   * ⚠ 它是**破盾后唯一的回头路**：被动回充按当前盾比例（盾归零 ⇒ 回充 0），只有本装置能从 0
   * 把盾点起来（点着之后被动回充立刻接管）。只作用于**主控**（与维修装置同边界）。
   * 无消耗件 ⇒ **同族多件**按 EVE 曲线收敛（见 `combat.shieldPulsePctOf`；收敛池键 =
   * `equipment.stackingOf` 的 `'shield-charge'` ⇒ **MK1/2/3 混装同池**，2026-09-21 船长改判）。
   */
  shieldPulsePct?: number
  /* ═══ 2026-09-20 护盾充能力场装置（船长：「新增高槽装备，护盾充能力场装置 MK2……为所有我方舰船
     恢复 10% 护盾，冷却时间 10 秒，MK3 的冷却时间缩短至 8 秒。有叠加惩罚」）——**高槽 · 护盾族**
     ⚠ 与上面的 `shieldPulsePct`（中槽 · 只作用于**本舰** · 固定 15 秒）是**两套独立机制**：
     力场是**全队**补盾、且冷却**按件自带**；两者可同装、各按各的节奏跳。 ═══ */
  /**
   * **力场每跳的补盾比例**（占**每艘被治疗舰自己**的满盾的几分之几，如 0.1 = 10%）。
   * 作用对象 = **我方全队存活单位**（不是只本舰）；按各舰**自身满盾**算（船长裁定
   * 「按携带者自己的满盾」——即每艘船按自己那本账）。
   * **同舰多件**按 EVE 曲线收敛（`stackWeight`；收敛池键 = `equipment.stackingOf` 的 `'shield-field'`
   * ⇒ **MK2/MK3 混装同池**，2026-09-21 船长改判「同族合并计数」）；**多艘船各带一件 ⇒ 各自独立、
   * 可叠加**（船长 2026-09-20 原裁定，未变）。
   */
  shieldFieldPct?: number
  /** **力场脉冲冷却**（ms；MK2 = 10 000 · MK3 = 8 000）。缺省 = 不调度 */
  shieldFieldMs?: number
  /**
   * 结构层（hull）抗性缺口削减（2026-09-10 船长：异形损管件"大幅提高结构抗性"）——
   * 语义与 shieldResistAdd/armorResistAdd 相同（按系缺口复合，上限 0.9）；
   * 此前只有船体自带 hullResist，模块侧无入口，本字段为那处入口。
   */
  hullResistAdd?: DamageResists
  /**
   * **损伤管制装置**（**2026-09-25 船长令**）：「**当舰船第一次结构低于 1 时，将结构恢复到 1（避免一次死亡）**」
   * ＋「**触发损管效果时需要消耗一份**（损管修理组件）」＋ 改判「**1 秒内结构锁定 1**」。
   *
   * 语义：本件**提供免死**，且**启动时消耗哪种组件**（值 = 组件物品 id，如 `'repairkit-dc'`）。
   * - **每场战斗一次**（`BattleState.dcUsed`）；触发即开窗 **1 秒**（`BattleState.dcLockUntilMs`），
   *   窗口内**逐段夹伤**：每发原始伤害夹到"结算后结构 ≥ 1"（`combat.cappedFoeDamage` 的唯一入伤口）；
   * - 窗口到点后恢复正常（不强制撤退）；没组件 ⇒ **不触发**（照常判负）；
   * - 谁装谁有（主控与装了它的 AI 副船各自判定）。
   */
  hullSaveKit?: string
  /**
   * **同舰唯一**（**2026-09-25 船长令**：「**损管只能装备一件**」）——
   * V18.1「取消同类唯一」之后**第一次**重新引入的单件约束，判据按**本标记**（不看型号）：
   * 同舰带多件带本标记的件 ⇒ 装配页禁装第二件、读档/装配预设应用时**裁掉多余**（保留位序最前的一件）。
   */
  unique?: boolean
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
  /**
   * **隐身窗口时长**（ms；2026-09-15 船长定：「隐秘行动装置」——高槽支援件，两档 MK2/MK3 =
   * **20 / 30 秒**，**极度吃 CPU**）。
   *
   * 语义 = **本舰武器开火之前隐身**：敌方**无法锁定、无法攻击**（选靶处排除 ⇒ 敌舰主炮与机群
   * 停火待机），**本舰一开火立即现形**，未开火则到点现形。多件取**最长**一件（不叠加）。
   * ⚠ **推进器禁令**（船长同日追加）：「**有推进器类的时候直接解除隐身**」⇒ 该舰只要装了推进器，
   * 本效果在装配期即判为 0（见 `combat.createPlayerSpec`，不写 `UnitSpec.stealthMs`）。
   */
  stealthMs?: number
  /* ═══ 2026-09-13 虫洞专属装备引出的新字段（船长逐条给定；设计稿 §3.6/§3.8）═══
   * 共同口径：**引擎里此前没有对应旋钮**，本批一次补齐；缺省不写 ⇒ 既有装备零行为变化。 */
  /** **附加伤害段**（掠袭破片炮「额外造成 50% 的动能伤害」）：主段结算之后，再按**主段实收** ×该比例
   *  打一段**固定弹种**的伤害——**与主段弹种/弹药无关**（船长 2026-09-13：「是附加伤害，和弹种无关，
   *  按武器预设，是消耗爆炸弹药」）。副弹种缺省 kinetic。 */
  secondaryDamagePct?: number
  /** 附加伤害段的弹种（缺省 kinetic） */
  secondaryDamageType?: DamageType
  /** **每次攻击消耗的弹药发数**（陵卫连装炮 = 2）：预载量与实战扣弹都按「门数 × 本值」算；
   *  缺省 1 ⇒ 既有武器零变化。 */
  ammoPerShot?: number
  /**
   * **全体攻击**（2026-09-13 船长：C 族「孢子导弹巢」＝「对所有敌方同时攻击」）：
   * `true` = 本武器每轮齐射逐个结算到**全部存活敌舰**（逐目标独立掷命中/各吃各自层克制）。
   */
  hitsAllFoes?: boolean
  /** **全武器射程削减**（掠袭者护盾笼 −25%）：射程 × (1 − 本值)；多件**只取最重一件**
   *  （与推进器失稳、装甲机动代价同口径）。缺省 0。 */
  rangeCutPct?: number
  /** **按其武器射程削减**（幽灵弹道校正器「动能武器射程 +22%」）：射程 × (1 + 该系值)；
   *  多件按系**加算**。缺省不写 = 无加成。 */
  rangeTypeBonusPct?: DamageResists
  /**
   * **敌舰射程压制**（**2026-09-26 船长定：墨潮电子舱 · H 族势力装备**）：
   * 装进**参战编队**即生效——削减**敌方武器射程**的百分比，与船体 `ShipDef.foeRangeDebuffPct`（电子舰 15%）
   * **乘法叠加**（`r = 1 − Π(1 − vᵢ)`，与船长 2026-09-18 定的多艘口径同一条）。
   * 只动最远射程；地板 `FOE_RANGE_DEBUFF_FLOOR_M`（3,000m）等既有口径全部继承。
   * 多件相撞取**加和后再合成**（与船体同一条合成链）。缺省不写 = 无压制。
   */
  foeRangeDebuffPct?: number
  /**
   * **捕获网周期**（**2026-09-26 船长定：墨潮捕获网 · H 族势力装备**）：毫秒。
   *
   * 携带该件的我方舰 = 一台**周期装置**（与武器一样有冷却，见 `combat.advanceMyCaptureWebs`）：
   * 开战即钉住一艘**未被钉住**的敌舰（**独立瞄准 · 不看命中**）；目标被击沉 ⇒ 进入冷却，
   * 冷却结束再选新目标；**携带者被击沉** ⇒ 该网解除。效果 = 目标机动 ×0.1 · 推进器全关 · 闪避归零
   * （⚠ **不含"武器射程下降"**——船长 2026-09-26 明令移除；敌方那件仍保留 −500m）。
   */
  captureWebCycleMs?: number
  /** **通用单发伤害加成**（亡军火控「伤害 +6%」）：与按系 damageTypeBonusPct 同链（**只进炮台/光束**，
   *  不喂无人机——无人机归战术导控）；多件加算。缺省 0。 */
  damageBonusPct?: number
  /** **装填惩罚**（巨构协处理器「装填 +12%」）：装填 × (1 + 本值)（与 eloadCutPct 的
   *  "÷(1+x)"是两件事）；多件**只取最重一件**。缺省 0。 */
  reloadPenaltyPct?: number
  /** **全层抗性削减**（掠袭折射涂层「全抗性 −15」）：盾/甲/结构**三层抗性各减该值**（下限 0）；
   *  多件**只取最重一件**（不叠成"抗性清零"）。缺省 0。 */
  allResistPenaltyPct?: number
  /** **无人机出击周期折减**（掠袭机库「无人机攻击间隔 −8%」= 船长 2026-09-13 澄清的**出击周期**）：
   *  周期 × (1 − 本值)；多件加算、上限 0.9（与 eloadCutPct 同款）。缺省 0。 */
  droneCycleCutPct?: number
  /* ═══ 2026-09-11 协处理器（cpu 家族·低槽；装配 CPU 预算扩容——船长定：本件自身不占 CPU） ═══ */
  /**
   * **CPU 预算扩容**（10 = 该船 CPU 上限 +10）：装配与无人机放飞**共用**这一份预算，
   * 见 `equipment.cpuBudgetOf`（船体 CPU 含「舰船系统工程」×1+5%/级，再加本字段之和）。
   * **本件 `cpuUse` 恒为 0**（船长 2026-09-11 定：自身不占用、单纯加预算）；
   * 多件全额叠加（与容量类同口径），天然上限 = 该船低槽位数。
   * ⚠ **防套利**：预算随件走 ⇒ 卸下本件必须重算（`unfitAt` 双向校验，超载则拒绝卸下），
   * 否则可"装本件涨预算 → 装满其它件 → 卸下本件"白拿预算（见 equipment.ts 说明与设计稿）。
   */
  cpuBonus?: number
}

/** 舰船蓝图（M5：用矿物制造舰船，产物进入船坞） */
export interface ShipBlueprintDef {
  id: string
  name: string
  /** 制造出的舰船 id（须在舰船表存在） */
  shipId: string
  /** **一次性图纸**：口径同 `BlueprintDef.singleUse`（舰船蓝图同样适用；缺省不写 = 普通蓝图） */
  singleUse?: boolean
  /**
   * **未上线闸门（施工期）**——语义同 `ItemDef.unreleased`（2026-09-13 船长铁律）。
   * 标了 ⇒ 不进手册**蓝图图鉴**与组装机的蓝图下拉（两处都遍历全目录）；
   * 引擎内部照用全目录（制造开工按玩家实际持有的书判定，不受影响）。
   * **上线动作 = 删掉这一个字段**。
   */
  unreleased?: boolean
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
  /**
   * **一次性图纸**（2026-09-12 船长：「能否实现一次性图纸？既玩家无法学会，只能制造一次的图纸」）。
   *
   * 口径（船长逐条裁定）：
   * - **仍是"书"**：进蓝图书架，但**不能"学习"**（学习会被拒，见 `market.learnBlueprint`）；
   * - **只能造一次**：开工时**扣掉这本一次性书**（与材料同源、同一时刻），并把该配方记为
   *   "一次性名额已用尽"（`GameState.spentOneTimeRecipes`）⇒ 之后再开工必须**再有一本**；
   * - **已永久学会同名配方时，这本书不能当"学习"用也不用**（会被拒，书留在书架）；
   * - **产出与普通蓝图完全一样**（同属性、可自用可卖），差别只在"这门配方只能用一次"；
   * - **不上市场、不进逆向研究**（`FRAGMENT_RECIPES` 不得收它）。
   *
   * 缺省不写 = 普通蓝图（**现有 94 张装备/物品图零变化**）。
   */
  singleUse?: boolean
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
  /**
   * **未上线闸门（施工期）**——语义同 `ItemDef.unreleased`（2026-09-13 船长铁律）。
   * 标了 ⇒ 不进手册**蓝图图鉴**与组装机的蓝图下拉；引擎内部照用全目录。
   * **上线动作 = 删掉这一个字段**（与一次性图纸的"落地同批"口径一致）。
   */
  unreleased?: boolean
  /**
   * **隐式蓝图**（2026-09-20 零件体系：船长「一些基础零件不用蓝图」）——不需要"学习"即可开工：
   * 蓝图书架不列这类书（没有书），组装机卡面不显示"已学会/未学会"状态；开工判定跳过学习检查。
   * 缺省 false（现有蓝图零变化）。
   */
  learnless?: boolean
  /**
   * **零件档位**（2026-09-20 零件体系）：`basic` = 基础零件（吃「零件成型工艺学」制造时间 −8%/级）·
   * `advanced` = 高级零件（吃「精密装配学」制造时间 −8%/级）。非零件蓝图缺省 undefined。
   */
  partTier?: 'basic' | 'advanced'
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
/**
 * 敌族字母（A 海盗舰系 / B 武装拾荒者 / C 异形生物 / D 守墓古舰 / E 泰坦巨构 / G 鱿烬亡军 /
 * **H 墨潮帮**）。
 *
 * ⚠ **`'F'`（制式巡逻）已于 2026-09-11 废弃**（船长「废弃F族，将F族融合进A族」）：
 * 字母位**永久保留为空位**（不分配给新族；旧内容表/旧导出带 `'F'` 时仍能解析），
 * 但**任何卡不得再登记 `'F'`**（契约「敌族显式登记契约」拦下）；四张旧遭遇模板已显式登记 A 族。
 *
 * ⚠ **`'H'`（墨潮帮 · The Ink Tide）2026-09-24 新增**（船长：「A族变种（其实也可以视作新种族）」
 * ⇒ 追问后定名「**叫'墨潮帮'（The Ink Tide）**」＋ 族格「**H ＋ 中速带 0.90~1.30×**」＋
 * 「配色**依旧红色色系最好**」）——它是 A 族海盗的**变种/叛出分支**：壳体沿用海盗系的性格
 * （快、贴脸、动能为主），但**另立族字母**（不碰 A 族"只用护卫/驱逐/巡洋三档、不配战列级"的族格），
 * 为**周末入侵**提供一族可打 T5 旗舰的对手。原 A 族变种那批壳体与族格**一字未动**。
 */
export type FoeFamily = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

/**
 * **敌舰配置（舰级表）**（2026-09-11 船长：「给敌人单独一套**敌舰的配置表**，敌舰属性按照配置表
 * 再根据实际悬赏等进行修正，这样**不会出现动一艘船，其他跟着动**」；同日裁决「**舰级给绝对值**、
 * 卡上用修正、允许混编、先试点」）。
 *
 * **绝对值口径**：血量 / 单发 / 装填 / 命中 / 射程带 / 远端衰减 / 血层分布 / 伤害构成
 * 全部由舰级写死，不再从"威胁"推导。悬赏卡只负责**编成**（用哪几艘、各几艘、第几波）与**修正**
 * （倍率 / 覆写），见 `AnomalyDef.ships`。
 *
 * **速度例外（2026-09-11 船长追加裁决「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）**：
 * 速度不再写绝对值，改登记**舰种档 + 倍率**——实际速度 = **舰种基准速度 × 倍率**（见 `hullClassTier`
 * 与 `speedRatio`）。这是**表达方式**的改造，四个舰级的实际速度与原绝对值**逐字一致**（零行为变化）。
 *
 * 目的：**改一艘船的影响面一眼可见，且只限引用它的卡**。旧口径下威胁一变、任一全局常量一变
 * 就是全表联动（本仓已发生过三次：推进器提档废掉全表标定、战术默认值静默改 5 张卡、
 * 敌速两种口径混用无人察觉）。
 */
export interface FoeShipDef {
  /** 舰级 id */
  id: string
  /** 舰级名（玩家可见舰种名；舰级路径的卡不再走"战术 × 血型"推导名） */
  name: string
  /** 敌族 */
  family: FoeFamily
  /**
   * **舰种档**：`1` 护卫舰 / `2` 驱逐舰 / `3` 巡洋舰 / `4` 战列舰 / `5` 旗舰
   * （2026-09-11 船长追加裁决「**劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰**」）。
   * ⚠ **档位口径须与 data 包 `packages/data/src/hullClass.ts` 的 `HULL_CLASS_NAME` 档位一致**——
   * core 在 core 包、**不能反向 import data 包**，故此处写**字面量联合类型**、不引 data 的类型。
   * 本档同时决定速度基准：实际速度 = `BattleBalance.hullClassBaseSpeedMps[本档] × speedRatio`。
   * 设定约束：**海盗族（family 'A'）只登记 1~3 档**——「海盗不配战列级（维护成本大，
   * 不符合海盗背景设定）」，由 `content:check`「舰级契约」与 core 测试双重守卫。
   */
  hullClassTier: 1 | 2 | 3 | 4 | 5
  /**
   * **速度倍率** = 实际速度 ÷ 舰种基准速度（基准速度 = `BattleBalance.hullClassBaseSpeedMps`，
   * 与 data 包 `hullClass.ts` 的 `HULL_CLASS_BASE_SPEED` 同源）。
   * **一律写成精确分数**（如 `351 / 340`），不写小数——保证"实际速度"逐字复现原绝对值。
   * 实际速度 = `HULL_CLASS_BASE_SPEED[舰种档] × 本倍率`（编成条目还有 `speedMul` 时再乘）后**取整**。
   */
  speedRatio: number
  /** 总血（绝对值） */
  hp: number
  /** 三层血量比例（结构 / 装甲 / 护盾），Σ = 1 */
  split: { s: number; a: number; h: number }
  /** 基础单发（绝对值） */
  shotDmg: number
  /** 命中率 0~1（**能量主系**是否消费本值取决于 `energyForm`：缺省光束必中 → 不消费；`'spit'` 掷命中 → 消费） */
  hitRate: number
  /** 装填（毫秒） */
  reloadMs: number
  /** 射程带下限 m */
  rangeMinM: number
  /** 射程带上限 m */
  rangeMaxM: number
  /**
   * 远端衰减（缺省 0.3）。两条生效路径：动能/爆炸（fixed）以及**能量掷命中（`energyForm: 'spit'`）**
   * → `distFactor` **命中**衰减；能量光束（缺省必中）→ `beamPowerFactor` **威力**衰减
   * （**此时本值越大衰减越轻**）。
   */
  falloff: number
  /** 近盲带伤害比例（缺省 0.3） */
  blindDmgMul?: number
  /** 伤害构成（缺省纯动能）。主系决定武器形态 / 命中 / 近盲 / 配色，混伤只改伤害构成 */
  dmgMix?: Partial<Record<DamageType, number>>
  /**
   * **能量武器形态**（2026-09-11 船长裁决⑤：「**立「能量·掷命中」档**」）——**只对能量主系
   * （`dmgMix` 主系 = `plasma`）生效**，动能/爆炸主系本来就是掷命中（`fixed`）、不受本字段影响：
   * - 缺省 / `'beam'` = **激光式光束**：`kind: 'beam'`，**开火必中**（不掷命中、不消费 `hitRate`、
   *   守方回避也不生效），远端用 `beamPowerFactor` 做**威力**衰减（`falloff` 越小越衰减）；
   * - `'spit'` = **能量掷命中（喷吐/投射）**：`kind: 'fixed'` —— **掷命中 + 命中随距离衰减**
   *   （`distFactor`：近端 1 → 最远端 = `falloff`）、**消费 `hitRate` 且吃守方回避**，
   *   层位克制**仍按等离子行**（对盾 ×1.25 / 对甲 ×1 / 结构 ×1）——与光束同系不同形态。
   * 用途：把"酸液喷吐 / 等离子投射"这类**能量投射物**与"激光/光束"明确分开（C 族族签名）。
   * ⚠ **缺省 = 现状**（能量必中光束），故不写本字段的既有舰级**零行为变化**。
   */
  energyForm?: EnergyForm
  /** 战术性格 */
  tactic: FoeTactic
  /**
   * **敌方后勤舰：把自身多少比例的名义 DPS 转成修理值**（船长 2026-09-16：「**敌人后勤舰则是将
   * 50% 的自身DPS转换为修理值**」＋补充裁定「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）。
   *
   * 口径（`repairPct = 0.5` 时）：
   * - **开火伤害 ×(1 − repairPct)**（打出去的火力减半）；被扣掉的这半**按秒**转成修理量；
   * - 战斗中**每 5 秒一跳**（`REPAIR_PULSE_MS`，与玩家维修装置同节拍）：每跳 = `名义 DPS × repairPct × 5 秒`；
   *   名义 DPS = 该单位**战斗中武器面板**的 `Σ 单发 × 1000 ÷ 装填`（不含命中与距离衰减，固定可预测）；
   * - 目标 = 敌方阵容里**三层剩余比例最低者**，但**永不以任何后勤舰（`repairPct > 0`）为目标，含自己**；
   * - **不超过目标满血**、**不耗组件**（敌方没有组件账）。
   *
   * ⚠ **缺省不写 ⇒ 该敌舰零行为变化**（现有全部敌舰都不写本字段）。
   */
  repairPct?: number
  /** 头目档：显示名加「精锐」前缀（2026-09-11 船长裁决实装；旧 `FOE_LIGHT_WORD` 的预留位） */
  elite?: boolean;
  /**
   * **舰级闪避覆写**（船长 2026-09-16 新舰「劫掠电子舰」：「**护卫舰档位，闪避提高，血量降低**」）——
   * 我方武器对它的命中率 = `(武器命中 + 加成 − 本值) × 距离折减`（见 `combat.hitChance`）。
   * **缺省不写 = 0.12**（既有全部敌舰的原值 ⇒ 老卡零行为变化）；值域 0~0.9（`content:check` 护栏）。
   */
  evasion?: number;
  /**
   * **舰级级「射程压制」**（船长 2026-09-24：「**拥有和我方电子舰同款降低敌人射程的效果，
   * 降低效果为降低50%射程，可以和我方电子舰的效果相互抵消**」）——H 族「墨潮干扰舰」专属。
   *
   * 语义 = **本舰压制"我方武器"的最远射程**，与我方电子舰那套（`ShipDef.foeRangeDebuffPct`）
   * **镜像同构、方向相反**：
   * - **多艘乘法合成**：`r_e = 1 − Π(1 − vᵢ)`（2 艘干扰舰 = 1 − 0.5² = **75%**）；
   * - **与"我方削减敌舰射程"做加法**：净削减率 = `r_player + r_enemy`（**互相抵消**）；
   * - **净倍率 = 1 − 净削减率**，带**与我方那套同一道地板**（基础射程 < `FOE_RANGE_DEBUFF_FLOOR_M`
   *   3000m ⇒ 完全不削；削后下限 3000m）；**只动最远射程**，近界不动。
   *
   * 验算（船长给的例子）：我方 1 艘电子舰（15%）＋ 敌方 1 艘干扰舰（50%）
   * ⇒ 敌方净削减 **0.50 − 0.15 = 0.35** ⇒ 我方射程 **×0.65**（**-35%**）✓。
   *
   * ⚠ 缺省不写 = 不压制（既有全部敌舰零行为变化）；落点见 `combat.meRangeWithDebuff` 一族。
   */
  foeRangeDebuffPct?: number
  /**
   * **舰级级「敌冲锋」开关**（2026-09-11 船长：「**给巨兽开启之前做过的冲锋能力**」；
   * **2026-09-14 船长扩到 C 族三种小虫**：「给小虫子添加冲锋，倍率为1.5」）。
   *
   * 语义 = **无条件给本舰级单位挂 `foeCanCharge`**，与总开关 `BattleBalance.foeChargeEnabled`
   * （默认 `false`，管'按威胁门槛 + brawl 自动放行'那条路）**互相独立**：
   * 写 `true` 的舰级**总是**具备冲锋资格，**不受**总开关与威胁门槛约束。
   *
   * 实况（机制本体 2026-09-10 建，见 `combat.updateFoeCharge`）：触发后**该单位自己**的机动
   * **×`foeChargeMul`**（舰级覆写 ?? 全局）；**解除 = 自身炮台命中我方**（2026-09-14 船长：
   * 「冲锋解除机制为自身攻击命中后解除冲锋状态，并进入 10 秒冷却」）或**压到期望交距**（兜底），
   * 随后进 `foeChargeCooldownMs` 冷却（2026-09-14 起 **10 秒**）。
   * ⚠ **逐单位状态**（`BattleState.foeCharges[tag]`，互不顶替）、**只在有该单位的波次生效**。
   *
   * 用途：慢而硬的重型单位（C 族**噬口巨兽**，实速 297）与虫群小虫（544 / 398）用冲锋补偿"追不上"。
   *
   * ⚠ **2026-09-16 起改走「挂载件」**（船长：「将冲锋设置成类似舰船装备的挂载物」）：C 族四条舰级
   * 改为 `mounts: ['foe-mount-charge-swarm-tN']`，本字段**保留为兼容回退**（没写 `mounts` 的卡照旧读它）。
   */
  foeCanCharge?: boolean;
  /**
   * **本舰级的冲锋倍率覆写**（2026-09-14 船长：「**大虫子的冲锋倍率改为 3，给小虫子添加冲锋，
   * 倍率为 1.5**」）——缺省不写 ⇒ 用全局 `BattleBalance.foeChargeMul`（**旧读数逐字不变**）。
   * ⚠ 编队接近速度 = "逐单位乘各自倍率 → 取平均"（`combat.stepBattle`），故倍率**不外溢**。
   * ⚠ **2026-09-16 起优先读挂载件**（`mounts`），本字段保留为兼容回退。
   */
  foeChargeMul?: number;
  /**
   * **本舰级的挂载件**（船长 2026-09-16：「**这样只要给敌人装配就行了**」）：写 id 列表，
   * 引擎在建档时解析成运行时字段（见 `FoeMountDef`）。**卡条目 `FoeShipSlot.mounts` 覆写本字段**。
   * ⚠ 缺省不写 = 无挂载、零行为变化（旧字段照旧读）。
   */
  mounts?: readonly FoeMountId[];
  /**
   * **期望作战距离覆写（米）**（2026-09-11 E 族：船长「**战术进行调整，但期望距离不改**，
   * 因为射程未定」）：给了本字段就**直接采纳**，不再按「战术 × 射程带」推导
   * （`foeDesiredRange` 优先读它）⇒ 可以'改战法标签、作战距离原地不动'。
   * ⚠ 缺省不写 = 现有推导口径，**零行为变化**。
   */
  desireRangeM?: number;
  /**
   * **舰载机群登记**（2026-09-11 船长：「**我记得巨构需要制作敌方无人机系统**」· 设计稿
   * `docs/design/foe-drone-system-20260911.md`）。语义 = **本舰级自带机群**（'巨构的第二套火力'，
   * E 族据点词「警戒机群」的落点）：机库存量、分批放飞、**打光为止不补充**。
   *
   * 玩家武器**默认打不到**它们；只有带**防空属性**（`WeaponSpec.canHitDrones`）的武器能打
   * （船长 A1：「玩家武器通常不可打，需要带有防空属性的武器」）。
   * ⚠ **缺省不写 = 无机群、零行为变化**（既有舰级一字不动）。
   */
  drones?: readonly FoeDroneSlot[]
  /**
   * **受击增程倍率**（2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）。
   *
   * 语义 = **本舰本体被命中一次** ⇒ 该舰**全部**机群的射程 ×本倍率（E 族三条舰级写 **4**：
   * 警戒机 5,000 → **20,000m**，**本场永久**、**不封顶**）——即"巨构挨打之后，警戒机群才把长臂伸出来"，
   * 也是族格「**依靠无人机攻击炮台射程外的敌人**」的兑现方式（平时 5km 警戒幕 / 触发后全图追猎）。
   *
   * ⚠ **触发口径（船长逐项裁定）**：①**只有母舰本体被命中**才算（**打机群不触发**、未命中不触发）；
   * ②覆盖该舰**全部**机群、**本场永久**（一次触发即保持，不做限时窗口）；③**不封顶**。
   * ⚠ **缺省不写 = 无此机制、零行为变化**；`content:check` 只允许**带机群的 E 族舰级**写它。
   * ⚠ **2026-09-16 起改走挂载件**（`mounts: ['foe-mount-drone-range-x4']`），本字段保留为兼容回退。
   */
  droneRangeMulOnHit?: number
  /** **受击增程（炮台）**（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
   *  不过**仅影响所有静滞卫舰**。挨打后射程增加 50%」）。
   *
   *  与 `droneRangeMulOnHit` **同款触发、不同作用面**：任一**带本字段的敌舰**被命中一次 ⇒
   *  `BattleState.foeGunRangeBuff` 盖一次章（本场永久、只提示一条）；**生效面只有带本字段的舰**
   *  （即"所有静滞卫舰"），同场的其它舰级**不受影响**（E 族那条是"整支敌队的机群"，两者不共用状态）。
   *  **口径（船长选乙）**：只延长**最远射程**、近界不动；**原射程内的命中/伤害折减一字不变**，
   *  延长段按**同斜率**继续线性衰减。
   *  ⚠ **2026-09-16 起改走挂载件**（`mounts: ['foe-mount-gun-range-x1-5']`），本字段保留为兼容回退。 */
  gunRangeMulOnHit?: number
  /**
   * **机群火力占比（舰级缺省）**（0~1；2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。
   * 这个要根据每个悬赏卡制定**」）——**条目级写的那份优先**（`FoeShipSlot.droneFireShare`），
   * 本字段只是"这条船平常用多少"的缺省；卡上逐条覆写即"**根据每个悬赏卡制定**"。
   *
   * 语义 = **守恒拆分**（详见 `FoeShipSlot.droneFireShare`）：条目实收总单发不变，机群与炮台此消彼长。
   * ⚠ **不写 = 旧算法**（机群与炮台同吃 `dmgMul`，比例由机型 `dmg`÷舰级 `shotDmg` 隐式决定）。
   */
  droneFireShare?: number
  /**
   * **单次出击上限（分批放飞）**（2026-09-12 船长：「能否**限制敌机单次出击数量**…」）：
   * `maxAloft` = **同一时刻最多几架在空中**（可开火）；其余在机库待命，按**批次窗口**轮换
   * （每 `cycleMs` 换一批，缺省 = 机型装填时长）。
   * - **`keepDps: true`**（推荐）⇒ 在空架次的**有效装填 ×(k ÷ 在场架数)** ⇒ **平均 DPS 守恒**，
   *   表现 = "少数机高频出击"（限制的是**同时出现的机体数**，不是总输出）；
   * - 缺省 `false` ⇒ 装填不动 ⇒ 机群持续输出**按 k/N 下降**（真削弱）。
   * ⚠ 缺省不写 = 现状（全群同时开火、零行为变化）。
   */
  droneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  /**
   * **备用机库（损坏后补充敌机）**（2026-09-12 船长：「…**或者**给敌机添加**备用机库**（损坏后补充敌机）」）：
   * `count` = 备用架数（与 `drones` 同机型，建档时展开成**额外的待命条目**）、
   * `respawnMs` = 前线战损后**多久补位**（从机库放出、**满血**、按同一条轮换窗口参战）。
   * ⚠ 与 2026-09-11 的 A3 裁定「**打光为止不补充**」**相反 = 一次改判**（新裁定优先）。
   * 母舰阵亡 ⇒ 机群照旧整群停（备用机也不再放出）。**缺省不写 = 无备用（零行为变化）**。
   */
  droneReserve?: { count: number; respawnMs: number }
  /**
   * **层位抗性（敌舰级）**（2026-09-15 船长：「我现暂时只打给 **C 族**添加**全血条 25% 爆炸抗性**」）。
   *
   * 三层各自可选（`DamageResists` = 系 → 值）；**缺省不写 = 无抗**（`UnitSpec.resists` 保持空对象）
   * ⇒ 既有舰级**零行为变化**。建档时分别装进 `UnitSpec.resists` 的 `shield` / `armor` / `hull`
   * （与敌机群的 `FoeDroneDef.defense` 同一条装配口径、同一份 `mergeResist` 形状）。
   *
   * ⚠ **抗性只减不减**：`applyDamage` 是 `层伤害 × 克制倍率 × (1 − clamp(0, 0.9, 抗))` ⇒
   * **负数（易伤）不生效**；要表达"某族怕某系"得另立字段（船长 2026-09-15 暂不做）。
   * ⚠ 与"层位克制系数"（`typeLayerMult`，全局三系克制）**叠加**：本字段是**族/舰级自己的**那一层。
   */
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
}

/**
 * **敌机机型**（**绝对值表**，落点 `packages/data/src/foe-drones.ts`）——与舰级表同款纪律：
 * 数值写死在本表，舰级只登记'用哪个机型、几架'（`FoeDroneSlot`）⇒ **改一个机型的影响面一眼可见**。
 *
 * **角色骨架沿用我方四型**（`DroneClass`：侦察/战斗/攻坚/哨戒，决定阵位与演出形制）；
 * 机体外形与配色是**敌族自己的**（船长 A2 裁定）。
 * **节奏照我方**（船长 C3 裁定）：单架装填基准 4,400ms、进入射程即放出、单轮出击时序与我方同款。
 */
export interface FoeDroneDef {
  /** 机型 id（同时是 UI 机体与弹点形制的键，与 `WeaponSpec.artId` 同源） */
  id: string;
  /** 机型名（玩家可见；如「警戒机」） */
  name: string;
  /** 敌族 */
  family: FoeFamily;
  /** 角色骨架（与我方 `DroneClass` 同源：scout / combat / assault / sentry） */
  role: DroneClass;
  /** 三层血 + 抗性 + 回避（与我方 `ItemDef.defense` 同构，复用 `DroneDefense`） */
  defense: DroneDefense;
  /** 单发（绝对值） */
  dmg: number;
  /** 伤害系（G 族据此实现'三系无人机'） */
  damageType: DamageType;
  /** 基础命中（我方制式 0.75；E 族'老化失准'取低值） */
  hitRate: number;
  /** 命中衰减：`1` = 射程带内恒定（我方侦察/战斗/攻坚三型口径）；哨戒机才保留衰减 */
  falloff: number;
  /** 射程上限 m（与角色骨架的档位对齐） */
  maxRangeM: number;
  /** 单架装填周期（毫秒；照我方节奏，基准 4,400ms） */
  reloadMs: number
}

/**
 * 舰级上的**机群登记条目**——舰级只写'**引用哪个机型、几架**'，数值全在机型表里
 * （与 `FoeShipSlot` 引用 `FoeShipDef` 同款写法）。
 */
export interface FoeDroneSlot {
  /** 引用的敌机机型（直接引用机型表对象，保证'改一个机型只有一处'） */
  drone: FoeDroneDef;
  /** **机库存量**（打光为止，不补充）；架数按六组实测标定（船长 C3「架次再定」） */
  count: number
}

/**
 * 悬赏卡上的**编成条目**：引用一个舰级 + 数量 + 波次 + 修正（2026-09-11 舰级表试点）。
 * 允许**混编**——同一张卡可引用多个舰级（例：头目舰 ×1 + 海盗快艇 ×3）。
 */
export interface FoeShipSlot {
  /** 引用的舰级（直接引用配置表里的对象，保证"改一艘船只有一处"） */
  ship: FoeShipDef;
  /** **期望作战距离覆写**（米；条目级优先于舰级，见 `FoeShipDef.desireRangeM`） */
  desireRangeM?: number;
  /**
   * **机群火力占比 s**（0~1；2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。这个要根据每个
   * 悬赏卡制定**」）——**条目级**旋钮：**条目 > 舰级**（见 `FoeShipDef.droneFireShare`）。
   *
   * 语义 = **守恒拆分**：本条目按旧口径的**实收总单发 T**不变，机群拿 `round(T×s)`、炮台拿余额
   * （两侧各保底 1/架、1/单位）；**不写 = 完全走旧算法**（不反推隐含比例）⇒ 零行为变化。
   * 只有"本条目会展开出机群"（舰级 `drones` 非空）时才有意义，`content:check` 会拦。
   */
  droneFireShare?: number;
  /**
   * **条目设计总单发锚点**（2026-09-12 船长：「架数变多、**总火力不动**」）——
   * 写了它（**须与 `droneFireShare` 同时写**）⇒ 本**条目**（该 slot 所有单位合计）的实收总单发
   * **以它为准**，再按占比拆成机群 / 炮台（逐架 / 逐单位摊分，余数补前面的）。
   *
   * 为什么需要它：机群架数是**舰级**属性，而 A5 口径下"每架无人机都是一门炮" ⇒ 架数一变，
   * 由"旧公式逐架取整"推出的总量会跟着变，且**取整步长 = 机群架数**（7 架时总量只能按 7 递增，
   * 216 这类目标**根本取不到**）。锚点把"总量"提升为**卡口径的显式数字** ⇒ 架数 / 单发怎么调，
   * 卡的总火力都钉住。
   * ⚠ 写了锚点 ⇒ 本条目的 `dmgMul` **不再参与总量**（只在没写锚点的条目上生效）；
   * 缺省不写 = 旧口径（零行为变化）。
   */
  firepowerAnchor?: number;
  /** 本条目数量（缺省 1） */
  count?: number
  /**
   * **本条目覆写的挂载件**（2026-09-16 船长：「**这样只要给敌人装配就行了**」）——
   * **写了就整条替换舰级 `FoeShipDef.mounts`**（与 `droneFireShare` / `desireRangeM` 同款"条目 > 舰级"）。
   *
   * 用途（船长同日两次点名）：
   * ① **A 族海盗只在虫洞内冲锋**——那三条舰级洞外（低安遭遇 / 悬赏）也在用，
   *    所以把 `foe-mount-charge-pirate` 挂在**洞内三张卡的条目**上，洞外一字不变；
   * ② 日后"同一舰级在不同卡上装不同件"不必改舰级。
   */
  mounts?: readonly FoeMountId[]
  /**
   * **本条目挂载件的「双语名对」快照**（2026-09-24 加；与 `mounts` 同序、下标对齐）。
   *
   * 为什么要有它：挂载件名是**玩家可见文案**（战报与敌舰悬停里逐件列出），而目录表在 **core**
   * （建档路径拿不到 data 包的译名表，见 `core/foeMounts.ts` 头注）⇒ 双语名随 `resolveFoeMounts`
   * 的 `namePairs` 一起下发，**显示层按当前语言挑一列**（见 `BattleScreen` 的 `mountNamesTextOf`）。
   *
   * ⚠ **派生字段、不进存档**：只在本场真要展示时由**渲染快照**（`battle.foeMounts` /
   * `battleArcsFor` 的 `foeMountNamePairs`）写；**缺省** ⇒ 显示层回退中文名数组
   * （老档在途战斗与任何没走该覆盖的路径都与改动前逐字一致）。
   * 由 `data/l10n.ts` 的 `overlayCardFoeMounts` 按语言生成。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /**
   * **支援呼叫分支**（2026-09-19 船长批「支援呼叫装置」）：本条目属于哪一支援军——
   * `'inside'` = 判定时玩家在**呼叫者射程内**才到场；`'outside'` = 在射程外才到场。
   *
   * ⚠ **必须与 `enterAt` 同写**（判定时点由 `enterAt.sec` 给）、**同卡两支成对**，
   * 且两支的账面总量相等（体检守恒契约）；判定/锁存口径见 `FoeMountDef.supportCall`。
   */
  enterBranch?: FoeSupportBranch
  /** 第几波（0 起；缺省 0 = 第一波） */
  wave?: number
  /**
   * 是否作为僚机（tag 走 `*-e{i}`，与旧"主 + 僚"命名/血条口径一致）。
   *
   * ⚠ **当前无任何卡使用**——船长 2026-09-11 裁决②「**不保留僚机**」：A 族六卡原灰霾/蜃影的僚机条目
   * 已改为「同族杂鱼 ×3 = **主体**」（显示名不再挂「轻装」）。字段与引擎支持**保留**（不为已退休语义动结构），
   * 但**卡上不应再写**；将来若要用，请先过船长口径（会同时改变显示名词缀与血条分组）。
   */
  escort?: boolean
  /** 血量倍率（缺省 1） */
  hpMul?: number
  /** 单发倍率（缺省 1） */
  dmgMul?: number
  /** 速度倍率（缺省 1） */
  speedMul?: number
  /** 射程带倍率（两端同乘后取整；缺省 1） */
  rangeMul?: number
  /**
   * **血型（三层血量比例）覆写**（2026-09-11 船长裁决①：「**头目血型随卡片走**，
   * 其实我们刚刚忘记讨论种族血型了，不过问题不大，**海盗设定鱼龙混杂，那么就什么血型都有**」）。
   *
   * 缺省 = **舰级 `split`**（绝对值口径）；写了则以本条为准（**有效 split = 覆写 ?? 舰级**）。
   * 用途：同一条舰级在**不同卡**上按卡面血型建档——**头目血型随卡走**（A 族六张卡的头目位）；
   * B 族两卡共用「拾荒武装艇」也是同一用法（演习场驱逐令**均衡型**、新港商路护航令**装甲型**）。
   * 卡面 `defProfile` 是**卡**的口径（"这场敌人怎么扛"），血型跟着卡走才不会两张卡两种说法。
   * ⚠ **A 族不做族级血型约束**（船长同日裁决：鱼龙混杂 ⇒ 什么血型都有），
   * 故本字段是**逐卡自定**的旋钮，不存在"A 族统一护盾型"这类族级口径。
   * 取值须为合法血型比例（Σ = 1）；`content:check`「舰级契约」按**有效 split** 与卡面 `defProfile` 对齐。
   */
  split?: { s: number; a: number; h: number }
  /**
   * **战术覆写**（2026-09-11 船长：「头目建议允许多个战术」）——缺省走舰级默认战术。
   * 即**同一条头目舰可配多种打法**（贴脸头目 / 狙击头目是同一条船）："强"由**档位**给
   * （血厚、单发高），"怎么打"由**卡上**定——正落在船长「卡上用修正」的原则里，
   * 也贴合海盗"缴获改装、换套武器换打法"的设定。
   * ⚠ **射程与战术仅"弱相关"，不实时强绑定**（2026-09-11 船长：「射程和战术仅仅的弱相关，
   * 并不实时强绑定」）——舰级路径下射程带是绝对值、不随战术推导，故换战术**不必**跟着改射程；
   * `rangeMinM` / `rangeMaxM` 只是**需要时可用**的独立旋钮，不是配对义务。
   */
  tactic?: FoeTactic
  /** 射程带下限**绝对覆写**（缺省 = 舰级值 × `rangeMul`）；独立旋钮，与战术无绑定关系 */
  rangeMinM?: number
  /** 射程带上限**绝对覆写**（缺省 = 舰级值 × `rangeMul`）；独立旋钮，与战术无绑定关系 */
  rangeMaxM?: number
  /** 主系/伤害构成覆写（缺省走舰级；用于"同一艘船缴获改装了不同弹药"） */
  dmgMix?: Partial<Record<DamageType, number>>
  /** 命中覆写（缺省走舰级） */
  hitRate?: number
  /**
   * **远端威力衰减覆写**（缺省走舰级；2026-09-12 加，与 `hitRate` 同款）。
   *
   * 用途 = **迁移守恒**：同一条舰级在不同卡上按卡面口径建档时，若该卡的衰减与舰级本体不同，
   * 用本字段覆写（首用 = 四张隐藏遭遇模板迁入 A 族舰级：迁移前 `foeFalloff` 取缺省 **0.5**、
   * 而 A 族舰级本体是 **0.3** ⇒ 逐条目覆写回 0.5，**旧档遭遇零漂移**）。
   * ⚠ 缺省不写 = 舰级值 ⇒ 对现有卡**零行为变化**。
   */
  falloff?: number
  /**
   * **能量武器形态覆写**（缺省走舰级；见 `FoeShipDef.energyForm`）——用于"同一条船换装不同弹药/喷口"：
   * 例同一舰级在 A 卡走光束、在 B 卡走掷命中。**只对能量主系生效**。
   */
  energyForm?: EnergyForm
  /**
   * **单波次内增援·入场时机**（2026-09-11 船长裁决：「**先完成相应的系统机制，不使用。用作后续机制。**」）。
   *
   * 语义：**任一条件满足即入场**（三者之间是"或"）。
   * **未写本字段 = 开战即在（= 现状，逐字不变）**；**三个条件一个都没写（空对象/全是无效值）
   * 同样按"未写"处理 = 开战即在**——刻意不产生"永不入场"的沉默副作用（少报一个单位比多报更难查）。
   * - `sec`：**开战满 N 秒**（战斗时钟口径，与推进器相位同源）即入场——"援军赶到"；
   * - `afterKills`：**本场已击毁的敌方单位数 ≥ N**（三层血全归零即计）即入场——"打崩前锋，援军顶上"；
   * - `hpBelow`：**己方（本波敌方编成）存活剩余总血比例 ≤ N** 即入场——"残部呼救"。
   *   ⚠ `hpBelow` 指的是**敌方自己**的残血比（分母 = 本波编成满血总量）；若要"玩家残血才来援"，
   *   **请另加字段**（如 `playerHpBelow`），不要改本字段语义。
   *
   * ⚠ **总开关 2026-09-19 起 = true**（船长批「支援呼叫装置」）；`content:check` 的
   * 「**支援呼叫装置契约**」钉住：**只有挂了该件的卡**能写本字段 / `enterBranch`，两支成对且总量守恒。
   * 存档零迁移：是否已入场**由 `battle.units` 里有没有该 tag 反推**，不占任何新存档字段。
   */
  enterAt?: FoeReinforceTrigger
}

/**
 * **单波次内增援的入场触发条件**（2026-09-11 落地；2026-09-19 随「支援呼叫装置」启用）。
 * 任一条件满足即入场；**全部未写（或都是无效值）= 按"未写"处理 = 开战即在**。
 * 条件应为正数（`sec > 0` / `afterKills > 0` / `0 ≤ hpBelow ≤ 1`），非法值按未写处理。
 * ⚠ **分支到场另由 `FoeShipSlot.enterBranch` ＋ `FoeMountDef.supportCall` 决定**（见两处注释）。
 */
export interface FoeReinforceTrigger {
  /** 开战满 N 秒后入场（战斗时钟，单位：秒；须 > 0） */
  sec?: number
  /** 本场已击毁敌方单位数达到 N 时入场（须 > 0） */
  afterKills?: number
  /** 己方（本波敌方编成）存活剩余总血比例 ≤ N 时入场（0~1） */
  hpBelow?: number
}
export interface AnomalyDef {
  id: string
  name: string
  /** 所在星系 */
  galaxyId: string
  /** 威胁等级（V11 起 = 敌方总战力标尺：血量与火力由 battle 常量换算） */
  threat: number
  /**
   * **回收口径的"体量"（冻结值 · 与 `threat` 解耦）** —— 船长 2026-09-25 令「**冻结残骸经济**」。
   *
   * 残骸链路的两处输入都读本值（见 `salvage.wreckInjectThreatOf`）：**逐场注入量**
   * `bountyWreckInjection`（悬赏胜利 / AI 代打）与**星系基础密度** `wreckBaseDensity`
   * （→ 回收档位 / 出量乘数 / 残骸组威胁 / 蓝图碎片门槛）。
   *
   * **缺省 = `threat`**（新卡不用写）；洞外 23 张常驻悬赏在 2026-09-25 威胁重定标时按船长令
   * 保留**重定标前的旧标签** ⇒ 回收经济与重定标前**逐值不变**，且今后再改 `threat` 也不牵动回收线。
   *
   * ⚠ **只服务残骸经济**：战斗、威胁显示、速度/射程成长一律仍读 `threat`。
   */
  wreckThreat?: number
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
  /**
   * **虫洞内敌方选靶模式**（船长 2026-09-13 定；见 `FoeTargetingMode`）——
   * **只有虫洞内的敌卡会写**，缺省 = `random`（等权随机）。
   * 现有 27 张悬赏卡 / 低安遭遇 / 窝点派生卡一律不写 ⇒ 单船路径零变化。
   */
  foeTargeting?: FoeTargetingMode
  /**
   * **选靶模式的作用概率**（船长 2026-09-14：「**虫洞敌人的攻击倾向，加一个概率**」→
   * 「**目前先挨个定为60%**」）——**每发开火前各掷一次**：掷中 ⇒ 按 `foeTargeting` 挑目标；
   * **没掷中 ⇒ 这一发乱了（退回随机抽取）**。
   *
   * - 缺省 = **1 = 铁律**（不写 = 现状）；只有虫洞内敌卡会写（普通节点 0.6、层末守卫 0.6）。
   * - 模式 = `random` 时本字段**无意义**（照 1 处理、不掷骰）。
   * - 掷骰发生在"只剩一艘我方单位"的早退**之后** ⇒ 单船路径（洞外 27 张卡 / 低安遭遇 / AI 副船）
   *   **一次随机数都不多消费**，标定读数逐字节不变。
   */
  foeTargetingChance?: number
  /** 敌方血型（三层血量比例） */
  defProfile?: DefProfile
  /** 僚机数量 0~2（每架 = threat × foeEscortThreatFrac 的独立单位） */
  escorts?: number
  /**
   * 敌方**伤害构成**（2026-09-10 船长：「给所有赏金任务的敌人添加额外攻击的副伤害类型，
   * 让其攻击造成混伤（主类型占大部分），并需要在任务中告知玩家」→ 同日追定「常驻悬赏也改，
   * 比例约 8:2」）：**正权重键 = 参战系**——
   * - **两个及以上系** → 敌人每次开火按权重**归一化打混伤**（常驻悬赏/低安遇袭 **8:2**、
   *   窝点派生卡 **6:4**，见 `lairs.LAIR_SUB_DMG_SHARE`），各系各自吃自己的层位克制与层抗；
   * - **一个系** → 纯系；**未写/空** → 纯动能（教学卡即此例，不给新手第一场上混伤）。
   * 主系 = 权重最高者，**武器形态（光束必中 / 命中模型）、命中、近盲、衰减与表现层配色
   * 一律按主系口径**，混伤只改"伤害构成"，敌总伤不变。
   * ⚠ 2026-09-10 语义变更：旧口径"没写的系缺省权重 1"作废（那会让只写一系的卡变成三系混伤）。
   */
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
   * 敌方武器**远端衰减覆写**（缺省走 `battle.foeFalloff` = 0.3）。两条不同的生效路径：
   * - **动能/爆炸（fixed）** → `distFactor`（命中衰减）：minRange 端 1.0 → maxRange 端 = 本值；
   * - **能量（plasma 光束）** → `beamPowerFactor`（**威力**衰减）：远端威力 = 1 − (1−本值)×0.8，
   *   故**本值越大衰减越轻**（0.30 → ×0.44；0.35 → ×0.48）。
   * 2026-09-10 船长（深渊之门卫队）：逐卡单独调整。
   */
  foeFalloff?: number
  /**
   * **基础单发直写**（2026-09-10 船长：深渊之门卫队「直接调整基础伤害不行吗」）——写了就**短路**
   * "威胁份额 × `foeDpsPerThreat` × 装填 × 命中补偿"整条推导链，单发即本值。
   * 用途 = 需要逐卡点名伤害的卡（数值一眼可见、可审）；代价 = 脱离威胁曲线，日后调威胁不会自动跟随。
   *
   * 注（2026-09-11 船长裁决「先移除所有逐卡伤害倍率，按照实际算」）：原"逐卡等效回退倍率口"
   * （2026-09-08 为能量光束必中化引入）**已退休、字段已从类型上删除**——单发一律按上式
   * **实际推导值**算，不再有任何等效回退旋钮。
   */
  foeShotDmg?: number
  /**
   * 多波次（2026-09-09 低安顶段悬赏；docs/design/wave-battles-20260909.md）：
   * 敌方分批入场——每波 units 个"主舰+僚机"小队（escorts 随卡），血量 = 总血 × hpShare。
   * 整场仍为一次悬赏（声望/奖金/残骸按原卡整场结算）；缺省 = 单波（现行为）。
   */
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  /**
   * **敌舰编成**（2026-09-11 舰级表试点）：写了就走**舰级路径**（绝对值，见 `FoeShipDef`），
   * 未写则走旧的"威胁推导"路径（`foeHpOverride` / `foeSpeedMps` / `waves` / `escorts` 等）。
   *
   * 舰级路径下：每条的 `count` 个同类单位各自独立建档（**不吃威胁份额均分**），
   * 血量 / 单发 / 速度 / 射程一律按"舰级绝对值 × 本条倍率"算；`wave` 决定第几波入场。
   * **允许混编**（一张卡引用多个舰级）。
   */
  ships?: readonly FoeShipSlot[]
  description: string
  /** B1 遭遇战斗模板：不出现在悬赏目录/星图徽标（供低安遭遇战使用） */
  hidden?: boolean
  /* ═══ B3.1 敌群特色回收（2026-09-06 船长定档）——⚠ **2026-09-19 已退役**：
   *  残骸改按「来源种族 × 来源地区」合并为 13 组，回收画像（池/说明/主题件/档位）一律走
   *  `core/wreckGroups.ts` 的组表；卡级 `recyclePool` / `recycleNote` / `recycleLoot` 三个字段已删除，
   *  卡级池表退居 `data/src/salvageFlavors.ts`（只作**构建依据与体检输入**，运行时不再读取）。 ═══ */
  /* ═══ 赏金任务·敌人窝点（2026-09-10 船长定） ═══ */
  /**
   * **卡级残骸地区覆写**（2026-09-24 加；缺省不写 = 按 id 前缀与星系安全等级推：`wh-*` ⇒ `wh`、
   * 其余按 `galaxyId` 的 `security` 分 `hi` / `lo`）。
   *
   * 为什么需要它：**周末入侵的独立敌卡**（`ink-flagship` / `ink-assault`）既不以 `wh-` 开头、
   * 星系归属又只是展示用的 `galaxy-hub`（会被推成高安）⇒ 残骸组契约会把它当"高安卡"，
   * 与它实际只在入侵里出现的身份不符。显式写 `region: 'wh'` 与洞内卡同口径。
   */
  region?: 'hi' | 'lo' | 'wh'
  /** 敌族（A~G；与美术层 FOE_ART 族字母同源）——决定窝点三档称呼与专属装备分配。
   *  **每张敌军卡必须显式登记**（2026-09-11 船长：F 族废弃后取消缺省兜底，改强制显式登记）；
   *  `'F'` 是已废弃的空位，不得再写。 */
  foeFamily?: FoeFamily
  /** 窝点名的核心词（有值 = 可作为赏金任务的窝点目标；教学卡刻意留空） */
  lairCore?: string
  /** 窝点三档称呼覆盖（缺省走族级词表 FOE_LAIR_TIERS） */
  lairTierNames?: readonly [string, string, string]
  /** 该敌群的专属装备池（2026-09-10 船长定：稀有残骸「高级箱」的额外掉落优先在此掷；
   *  每个敌族至少一件，只从高级箱出、不进市场不设蓝图） */
  lairGear?: readonly string[]
  /**
   * 窝点地图级别（2026-09-10 船长定）：1 = 只能出外围档、2 = 到核心档、3 = 全档。
   * 语义 = 该地图的**档位上限**（硬封顶，非加权）：日板发档时在该卡 `[1..lairLevel]` 内均匀随机，
   * 族内越低级的地图出高档位赏金的概率越低（1 级 = 永远出不了核心/深层）。
   * 缺省 = 3（不限制；缺省值只为"漏标不误伤"，content-check 强制每张窝点候选卡显式标级）。
   * 另有族级下限契约：每个有窝点成员的敌族**至少一张 3 级**（船长 2026-09-10 定）。
   */
  lairLevel?: 1 | 2 | 3
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
  /** 通讯消息表（2026-09-11 通讯系统；data/src/messages.ts） */
  commsMessages: ReadonlyMap<string, CommsMessageDef>
  /** NPC 势力档案（2026-09-11 通讯 v2；data/src/commsFactions.ts）——解析消息/剧本的发件人与立场 */
  commsFactions: ReadonlyMap<string, CommsFactionDef>
  /** 通讯剧本目录（T9 建站介绍/庆贺等；通讯页与剧本共处一个收件箱，见 core/comms.ts） */
  dialogues: ReadonlyMap<string, DialogueScriptDef>
  balance: BalanceConfig
  /**
   * **残骸组覆盖表**（2026-09-19 残骸合并）：正式 13 组住在 `core/wreckGroups.ts`（静态，存档迁移也要用），
   * 这里只放**用例/扩展注入的额外组**——合成敌卡（如 `ano-far`）在生产表里查不到，
   * 用例就把它的组塞进这张表，`wreckGroupOfCard` / `recycleProfileOf` 会**先查它、再回落到静态表**。
   * 生产（`buildSimContext`）不填。
   */
  wreckGroups?: ReadonlyMap<string, WreckGroupDef>
  /**
   * **谜质科技树节点表**（2026-09-19 船长「消耗谜质升级的研究科技树」；`data/src/matterTech.ts`）。
   * 节点（名 / 层 / 级数 / 每级效果值 / 费用 / 前置）住在数据侧，**效果语义与聚合在 core**
   * （`core/matterTech.ts` 按 `effect` 关键字汇总，不认 id）⇒ core 不需要 id 清单。
   */
  matterTech?: ReadonlyMap<string, MatterTechNodeDef>
  /**
   * **成就徽章表**（2026-09-20 船长「继续之前的成就系统」；`data/src/achievements.ts`）。
   *
   * 徽章（名 / 说明 / 图案 / 配色 / 来源）住在数据侧，**判定与发放在 core**
   * （`core/achievements.ts` 按 `source` 认领，不认 id 前缀）⇒ core 不需要 id 清单。
   * 缺省（老档/用例不注入）= 空表 ⇒ **零行为变化**（一枚都不发）。
   */
  achievements?: readonly AchievementDef[]
}

/** 谜质科技树的**效果关键字**（core 只认这张表里的值；数据侧写错 = 体检判红 + 引擎忽略） */
export type MatterTechEffect =
  /** 洞内**最大回合数** +v/级（v = 回合数；永久加成，与本趟装置分开相加） */
  | 'whTurnMax'
  /** 打捞器效率 +v/级（v = 0.2 表示 +20%） */
  | 'whSalvageEff'
  /** 采集器效率 +v/级 */
  | 'whCollectEff'
  /** 洞内货仓有效格 +v/级 */
  | 'whHoldCells'
  /** 扫描虫洞间隔 −v/级（v = 0.05） */
  | 'whScanCut'
  /** **洞内战斗倍速**：v = 每级**倍率底数**（2 ⇒ 1 级 ×2、2 级 ×4）——⚠ 全表**唯一按乘法**算的效果，
   *  取 `v^级`，**不走** `Σ 等级 × v`（见 `matterTechBattleSpeed` 与 `combat` 的倍速时间轴） */
  | 'whBattleSpeed'
  /* ── 洞内战斗增益（与谜质装置同一个增益袋 `WormholeMatterBuffs`） ── */
  | 'whResistShield'
  | 'whResistArmor'
  | 'whResistHull'
  | 'whHit'
  | 'whEvasion'
  | 'whEnemyHitDown'
  | 'whRange'
  | 'whReload'
  | 'whDamage'
  | 'whBlindReduce'
  | 'whThreatNode'
  | 'whThreatBoss'
  | 'whDroneRecovery'
  | 'whFieldRepair'
  /* ── 洞外工业（2026-09-19 船长重做的三件 ＋ 2026-09-20 追加的 T4） ── */
  /** 货柜拆解周期 −v/级（v = 0.25 = −25%，加法口径） */
  | 'unboxTimeCut'
  /** 虚空母矿 → **虚空晶** 回收数量 +v/级（只作用于这一支产出） */
  | 'voidCrystalYield'
  /** 残骸回收的**保底原材料**产出 +v/级 */
  | 'wreckMineralYield'
  /** **站内工业 AI 专用工位上限 +v/级**（v = 1；与技能那两支 `aiCore.industrySkillSlots` **相加**，
   *  不增加 AI 副船任务上限；消费点 = `core/ai.ts` 的 `industryAiBonus`） */
  | 'industryAiSlots'

/** 科技树分支（界面分组 / 契约判据用） */
export type MatterTechBranch = 'explore' | 'battle' | 'industry'

/** **谜质科技树节点定义**（数据表条目；费用与前置由数据侧给，效果语义见 `MatterTechEffect`） */
export interface MatterTechNodeDef {
  id: string
  name: string
  branch: MatterTechBranch
  /** 层级（1~4）：界面按层分行；费用须随层单调上升（体检契约） */
  tier: number
  /** 效果关键字 */
  effect: MatterTechEffect
  /** **每级**的效果值（语义由 `effect` 决定，见 `MatterTechEffect` 的逐条注释） */
  per: number
  /** 最大等级（≥1） */
  maxLevel: number
  /** **每级**的谜质消耗（长度须 = `maxLevel`；长度 1 表示每级同价） */
  essence: readonly number[]
  /** **每级**的信用点消耗（同 `essence` 的口径） */
  isk: readonly number[]
  /**
   * 前置：`{ nodeId: 需要的最低等级 }`（同线低层；体检契约：前置必须存在、必须同线、层更低）。
   * 缺省 = 无前置。
   */
  prereq?: Readonly<Record<string, number>>
  /** 玩家可见说明（一句话规格；不写原因解释，括号只许放规格） */
  note: string
}

/* ═══════════════ 成就徽章（2026-09-20 船长：第一批 = 徽章框架） ═══════════════ */

/**
 * **徽章来源**（发放时唯一的认领依据——core **不认 id 前缀**，只认这里的字段）：
 * - `task`：某条「第一次」任务达成（`importantTasks[taskId].done === true`）；
 * - `chain`：某条次数链的进度达到 `level` 档（`importantTasks['chain-<id>'].delivered ≥ level`）；
 * - `milestone`：某条**终身计数**达到 `target`（`firstStatOf(state, stat) ≥ target`）。
 *
 * ⚠ `milestone.stat` 是 `string` 而**不是** `FirstStatKey`：`firstTasks.ts` 要 import 本文件的类型，
 * 反过来被 import 联合类型会成环。取值仍以 `FirstStatKey` 为准（数据侧写错 ⇒ 读数恒 0、
 * 徽章永不发 —— `content:check` 的「里程碑契约」负责在施工期拦下）。
 */
export type AchievementSource =
  | { kind: 'task'; taskId: string }
  | { kind: 'chain'; chainId: string; level: number }
  | { kind: 'milestone'; stat: string; target: number }
  /** **铁人档徽章**（2026-09-23 船长令）：进入铁人模式即得；**普通档玩家不可见** */
  | { kind: 'ironman' }
  /** **关闭铁人徽章**：关闭那一刻才可见/可得（隐藏徽章） */
  | { kind: 'ironmanClosed' }

/**
 * 徽章分类（界面分组用）：
 * - `first-task`：13 条「第一次」任务的纪念徽章；
 * - `chain`：次数链的档位徽章（船长：1/4/7/10 级各一枚 · 同图案用颜色区分）；
 * - `milestone`：**里程碑成就**（第二批，2026-09-20 落码 —— 内容与阈值见
 *   `data/src/achievements.ts`，展示改版见工作文档 `docs/design/achievement-display-20260920.md`）。
 */
export type AchievementCategory = 'first-task' | 'chain' | 'milestone' | 'ironman'

/**
 * **徽章定义**（数据表条目；发放判定在 `core/achievements.ts`）。
 * ⚠ **纯展示**（船长 2026-09-20）：不含任何奖励字段。
 */
export interface AchievementDef {
  id: string
  name: string
  /** 玩家可见说明（一句话规格；不写原因解释，括号只许放规格） */
  note: string
  category: AchievementCategory
  /** 图案键：同一条链共用一个图案，靠 `tone` 区分档位（渲染层一根线稿一枚底纹） */
  pattern: string
  /** 图案颜色（十六进制；取本仓既有"同造型按档分色"语汇，不新造颜色） */
  tone: string
  /** **隐藏徽章**（船长 2026-09-23）：未达成前**不出现在成就页**（铁人两枚专用） */
  hidden?: boolean
  source: AchievementSource
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
  /** 发件势力 id（可选：未挂靠时收件箱回落 `title` 原文，立场小片不出现） */
  commsFactionId?: string
  /** 发件部门 id（可选；给了部门就必须给势力） */
  commsDeptId?: string
  /** 具名联系人（可选；悬停说明用） */
  commsSigner?: string
  /** 标题（通讯器称呼栏，如 协会 · 基建部） */
  title: string
  /** 通讯页收件箱里的主题（2026-09-11 通讯系统合并：缺省回落 title；剧本与消息同处一个收件箱） */
  subject?: string
  lines: readonly DialogueLineDef[]
}

/* ═══════════════ NPC 势力档案（2026-09-11 通讯 v2 船长定：官方 = 章鱼人；其他 NPC 同为章鱼人、同族不同行会） ═══════════════ */

/**
 * 势力立场（界面「立场小片」按此着色分档）。
 * 口径：协会是章鱼人的官方行业组织；打捞队工会等民间行会同族不同行；
 * **「系统」= 船自己的舰载系统**（2026-09-11 船长定：教程与简报从「信息库」发来），不是 NPC、无物种。
 */
export type CommsFactionAlignment = '官方' | '民间' | '中立' | '系统'

/** 通讯内容类型（消息的「内容类型小片」；必须落在发件势力的 `kinds` 白名单里） */
export type CommsKind = '剧情' | '提示' | '委托' | '教程'

/** 势力下的部门（协会 8 部门、打捞队工会 1 队；部门是发件人写法的后半截） */
export interface CommsDeptDef {
  /** 部门 id（势力内唯一；消息用 `deptId` 引用） */
  id: string
  /** 部门名（发件人写法：`势力名 · 部门名`） */
  name: string
  /** 部门一句话（悬停说明"这是谁"） */
  brief: string
  /** 本部门允许发的内容类型白名单（契约强制） */
  kinds: readonly CommsKind[]
}

/**
 * NPC 势力 / 舰载系统（data/src/commsFactions.ts 维护）。
 * 铁律：**所有 NPC 势力都是章鱼人**（契约强制，防设定漂移）；**船内系统（`alignment: '系统'`）不是 NPC**、无物种。
 * 章鱼人不追问船里是谁，把玩家当普通承包舰船——NPC 文案不得出现指涉玩家本质的词。
 */
export interface CommsFactionDef {
  /** 稳定 id（消息/剧本按它引用） */
  id: string
  /** 名称（玩家可见；协会对外自称「协会」，全名用于发件人与档案） */
  name: string
  /** 物种：NPC 恒为「章鱼人」（契约强制）；船内系统写「舰载系统」 */
  species: string
  /** 立场：官方 / 民间 / 中立 / 系统（系统 = 船自己的舰载系统，不是 NPC） */
  alignment: CommsFactionAlignment
  /** 主题色（与既有系统同源取色；界面小片与图标着色用） */
  tone: string
  /** 图标（复用既有 SVG 线稿图标名；NPC 用章鱼头 `faction-octopus`，船内系统用核心 `nav-ai`） */
  glyph: string
  /** 势力一句话（界面 tooltip「这是谁」） */
  brief: string
  /** 该势力可发内容类型白名单（消息 `kind` 必须落在其中） */
  kinds: readonly CommsKind[]
  /** 部门表（通讯发件人的来源；至少一个） */
  departments: readonly CommsDeptDef[]
}

/* ═══════════════ 通讯（2026-09-11 船长定：NPC 以"发消息"补充剧情与任务提示） ═══════════════ */

/** 通讯跳转目标页（裁决③：消息只给提示 + 跳转，不在通讯页里接任务）。`comms` = 回本页 */
/**
 * 通讯消息的**跳转目标页**。
 *
 * ⚠ 2026-09-14 起新增 `'task'`：**任务中心已从星图页的一个选项卡搬成独立一级页**
 * （船长：「将任务中心界面移出星图，放入左侧导航栏，通讯的上方」）⇒ 指向任务中心的跳转
 * 从 `{ page: 'map', tab: 'task' }` 改成 `{ page: 'task' }`（内层标签仍走 `taskTab`）。
 */
export type CommsJumpPage = 'map' | 'ship' | 'fit' | 'items' | 'market' | 'industry' | 'skills' | 'comms' | 'task'

/**
 * 通讯消息触发条件（core 每帧廉价判定；**幂等**——条件满足一次即送达，之后重复推进不再送）。
 * 新增触发器时：`packages/core/src/comms.ts` 的 `triggerMet` 与 `tools/content-check.ts` 的
 * 「通讯消息契约」两处必须同步（漏一处体检会报错）。
 */
export type CommsTrigger =
  | { kind: 'start' }
  /** **「第一次」任务已完成**（2026-09-17 教程重做批）：读 importantTasks[taskId].done */
  | { kind: 'firstTask'; taskId: string }
  | { kind: 'day'; days: number }
  | { kind: 'explored'; count: number }
  | { kind: 'galaxy'; galaxyId: string }
  | { kind: 'skill'; skillId: string; level: number }
  | { kind: 'isk'; amount: number }
  | { kind: 'siteBuilt'; siteId: string }

  /**
   * **低安空域**（2026-09-12 船长定：探索到带特殊机制的星系后，发一封通讯讲解对应机制）。
   *
   * 判定 = 已点亮的星系里存在**低安**。低安口径 = **安全等级 ≤ 0（含 0）**——船长同日两条裁定
   * 「将伏击掷骰阈值降低为0」＋「0也算低安」⇒ 与伏击掷骰**同一条线**
   * （`balance.encounter.lowSecMax` / `encounters.collectExposures`），安全等级被改判时自动跟随，
   * 不必回来改星系 id 清单。missing security 一律按高安（`?? 1`，与 `encounters.secOf` 同口径）。
   */
  | { kind: 'lowSec' }
  /**
   * **某族敌人所在的星系**（同一批次）：判定 = 已点亮的星系里，有**任意一张该族敌卡**
   * （`AnomalyDef.foeFamily`）⇒ 敌卡搬家时本触发器**自动跟随**，不必维护星系 id 清单。
   * 窝点派生卡与主题悬赏同族同域，不另判。
   */
  | { kind: 'foeFamily'; family: FoeFamily }
  /**
   * **遭遇过某个敌方舰级**（船长 2026-09-16：「**在玩家第一次遭遇劫掠电子舰之后**…发一封通讯」）。
   * 判定 = `state.foeShipSeen[shipId] === true`；置位点 = 开战扫描该场敌卡编成（`combat.noteFoeShipsSeen`）。
   * **缺失 = 老档** ⇒ 没遇过（该舰级是本功能上线时才加的新舰，老档不可能遇过）⇒ 不补发。
   * ⚠ 若想让通讯"等玩家出了洞/回到主界面再送"，配合消息级 `holdWhenBusy`。
   */
  | { kind: 'foeShipSeen'; shipId: string }
  /**
   * **虫洞围剿（第 7 层起）**（2026-09-23 船长：「当玩家第一次进入七层是，给玩家发一则通讯讲清楚
   * 敌人开始围剿玩家了，并介绍机制」）。
   *
   * 判定 = `state.wormhole.siegeHintShown === true`（**第一次下到第 7 层**时由 `wormholeDescend`
   * 的 `maybeHintSiege` 置位）⇒ 跨趟/跨会话只送一次；老档首次下到 7 层补送。
   */
  | { kind: 'wormholeSiege' }
  /**
   * **虫洞星云带**（2026-09-13 船长定：「**除了一次性事件，通讯内也发一条相关的讯息给玩家**」）。
   *
   * 判定 = `state.wormhole.nebulaHintShown === true`（玩家**第一次下到第 4 层**时由
   * `wormholeDescend` 置位）⇒ 与那条一次性提示**同一个触发点**，不会各说各的。
   * 通讯是**留档**的（一次性提示会消失），玩家事后还能回看这条说明。
   */
  | { kind: 'wormholeNebula' }
  /**
   * **第一次因低安袭击自动撤离**（2026-09-14 船长：「添加新的通讯，当玩家第一次因为低安袭击导致
   * 舰船自动撤离时触发」）。
   *
   * 判定 = 随档三态标记 `state.ambushRetreatSeen`：`true` ⇒ 发；**`false` = 新档 ⇒ 只等真撤离**（不补发）；
   * **缺失 = 老档** ⇒ 船长裁定「老档补发，但**要判断玩家是否触发过**」，故按可查痕迹判定：
   * `encounterZoneCooldown` 非空（只在伏击真的命中时写入、写后不删）⇒ 确实被伏击过才补发。
   * 置位点两处（船长裁定「也算自动脱离交火」）：`encounters.retreatEncounterShip`（收手返港待命）
   * 与 `encounters.settleEscape`（应战中途结构过半自动脱离交火）。主控与副船同口径。
   */
  | { kind: 'ambushRetreat' }
  /**
   * **势力声望达标**（2026-09-14 船长：「**扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家**」）。
   *
   * 判定 = `state.standings[factionId] >= min`。⚠ 这里的 `factionId` 是**声望口径**的势力 id
   * （协会 = `DSI_FACTION_ID` / `'dsi'`，见 `expedition.ts`），与**通讯发件势力** id
   * （`commsFactions` 里的 `'dshi'`）**不是同一套命名空间**——触发器按前者、发件人按后者。
   */
  | { kind: 'standing'; factionId: string; min: number }
  /**
   * **造出第一艘自造船**（2026-09-15 船长：「新增通讯发送的节点：当玩家造好第一条船后，弹出通讯
   * 祝贺玩家，并告诉玩家新建造的舰船在舰船仓库页面」）。
   *
   * 判定 = 随档标记 `state.firstShipBuilt === true`（**只认 true**）：`false` = 新档（`createInitialState`
   * 显式写入）· **缺失 = 老档（本功能上线前开的档）** —— 两者一律**不发**，老档第一次真造船时照常送达。
   * **置位点唯一** = `manufacturing.ts` 的 `settlePiece()` 造船分支——主控亲手开线与 AI 核心代造
   * （含离线期间造的）共用这一处出水口，故船长选定的「都算」不需要额外判据。
   *
   * ⚠ **2026-09-16 船长报障后收窄**（「购买舰船也会触发第一艘自造船的通讯，这不对」；取「甲：造过才发」）：
   * 原第三态「缺失 = 老档 ⇒ 读档即补发」（2026-09-15 三问裁决「丙」）**已作废**——它把"字段缺失"
   * 当成了"造过船"，任何 9-15 前开的档都会在读档那一拍收到这封信（看起来就像"买船触发了它"）。
   */
  | { kind: 'shipBuilt' }

/** 回复选项（**预留接口：2026-09-11 船长定"预留但不启用"**，见 core COMMS_REPLIES_ENABLED） */
export interface CommsReplyDef {
  id: string
  label: string
}


/** 通讯消息（NPC → 玩家；data/src/messages.ts 维护，core 按 trigger 送达） */
export interface CommsMessageDef {
  /** 稳定 id（已送达/已读都按它记账） */
  id: string
  /**
   * 发件势力 id（data/src/commsFactions.ts）。
   * **玩家看到的发件人写法由势力 + 部门拼出**（`势力名 · 部门名`），不再在消息里写自由文本；
   * 解析不到势力时降级显示原文 id（界面不崩，见 core/comms.ts）。
   */
  factionId: string
  /** 发件部门 id（势力内唯一；缺省 = 势力本部，发件人只显示势力名） */
  deptId?: string
  /** 具名联系人（可选；作为悬停说明，不写进发件人栏——保持既有发件人写法不变） */
  signer?: string
  /** 内容类型（必须落在发件势力/部门的 `kinds` 白名单里） */
  kind: CommsKind
  /** 主题（列表主行） */
  subject: string
  /** 正文（逐段） */
  body: readonly string[]
  /**
   * 需要**强调显示**的正文段落（可选；**预留字段**——原使用者「训前简报」的任务链已随教程退场，
   * 2026-09-17 起暂无消息填它）。
   * 取值必须与 `body` 里某一段**逐字相等**才生效（`content:check` 有契约盯着），
   * 界面按它给该段加既有强调样式（离线报告那套 `.app-report-highlight`），其余段落照旧。
   */
  highlight?: readonly string[]
  /**
   * **忙时不投递**（船长 2026-09-16：「**结束虫洞或回到主界面时**，给玩家发送一封通讯」）：
   * `true` ⇒ 洞内（`state.wormhole.run` 在场）或交战中一律压着，等回到星图/主界面那一拍再送。
   * 用途 = 战斗内出现的机制说明信（例：首次遭遇劫掠电子舰的捕获网介绍）。
   */
  holdWhenBusy?: boolean
  /** 送达条件 */
  trigger: CommsTrigger
  /**
   * 顺带提示（一句提示 + 跳转目标页；裁决③）。`tab` 用于星图页内标签，`shipTab` 用于舰船页内标签，
   * `taskTab` 用于星图「任务中心」的**内层**标签（2026-09-11 船长：步骤 2 跳转必须切到「重要任务」——
   * 内层标签会记住玩家上次的选择，只切到任务中心不够）。
   */
  hint?: { text: string; page: CommsJumpPage; tab?: string; taskTab?: string; shipTab?: string }
  /** 预留回复选项（本期不启用） */
  replies?: readonly CommsReplyDef[]
  /**
   * **送达时同时直接弹窗**（2026-09-14 船长：「解锁时发送通讯给玩家（**同时也要直接弹窗**）」）。
   * 语义：消息照常进收件箱；送达那一刻把 id 记进 `state.commsPopups`，界面弹一次卡片、
   * 玩家点「知道了」即清（`dismissCommsPopup`）——**关掉不丢信**，收件箱里还有。
   */
  popup?: boolean
  /**
   * **未上线闸门（施工期铁律）**：语义同 `ItemDef.unreleased` —— `true` 时**不送达**。
   * 用途：虫洞解锁信这类"随虫洞一起上线"的消息先按正式文案写好，上线时删掉这一个字段即可开送。
   */
  unreleased?: boolean
}

/** 收件箱条目视图（界面用；消息与剧本镜像共用一种结构，见 core/comms.ts） */
export interface CommsEntryView {
  /** 稳定键：数据消息 = 消息 id；剧本镜像 = `dlg:<剧本 id>` */
  id: string
  /** 来源：数据消息 / T9 剧本镜像 */
  source: 'message' | 'dialogue'
  /** 发件人（玩家可见写法：`势力名 · 部门名`；未挂靠/解析失败时降级为原文，见 core/comms.ts） */
  from: string
  /** 发件势力名（界面「立场小片」旁的主名；未挂靠时为空串） */
  factionName: string
  /** 立场（官方 / 民间 / 中立；未挂靠时为空串） */
  alignment: CommsFactionAlignment | ''
  /** 内容类型（剧情 / 提示 / 委托；未挂靠时为空串） */
  kind: CommsKind | ''
  /** 具名联系人（可选；悬停说明用） */
  signer?: string
  /** 发件方说明「这是谁」（势力 brief + 部门 brief；悬停用） */
  fromBrief?: string
  /** 发件势力主题色（未挂靠时为空串，界面回落到默认色） */
  tone: string
  /** 发件势力图标名（未挂靠时为空串） */
  glyph: string
  /** 主题 */
  subject: string
  /** 正文逐段（剧本镜像 = 各发言句 `发言人：内容`） */
  paragraphs: readonly string[]
  /** 强调显示的段落（与 `paragraphs` 逐字相等的那些；界面加既有强调样式，见 `CommsMessageDef.highlight`） */
  highlight?: readonly string[]
  /** 送达时的游戏内毫秒 */
  deliveredAtGameMs: number
  /** 是否已读 */
  read: boolean
  /**
   * 顺带提示 + 跳转目标页（可选；`tab` = 星图页内标签、`taskTab` = 任务中心内层标签、`shipTab` = 舰船页内标签）。
   * ⚠ **实例通讯**可以只给 `action`（点开一个面板、不跳页）⇒ 那种条目 `page` 缺省。
   */
  hint?: { text: string; page?: CommsJumpPage; tab?: string; taskTab?: string; shipTab?: string }
  /** 预留回复选项（`COMMS_REPLIES_ENABLED = false` 时界面不渲染） */
  replies?: readonly CommsReplyDef[]
  /* ─── 实例通讯专用（`state.commsInstance`；表消息恒缺省） ─── */
  /**
   * 主题 / 正文段落的**文案 id**（`l10n/table.ts`）。有它 ⇒ 界面按**当前语言**重新渲染
   * （`tr(subjectId, textParams)` / 逐段 `tr(bodyIds[i], textParams)`），实现"中英各自成句"；
   * 缺省 ⇒ 用上面的 `subject` / `paragraphs` 原文（表消息就是这条路径）。
   */
  subjectId?: string
  bodyIds?: readonly string[]
  /** 文案参数（喂给 `subjectId` / `bodyIds` 的 `{pN}`；`pNId` = 参数本身也是一条文案，界面走 `paramText`） */
  textParams?: Readonly<Record<string, string | number>>
  /** **点击跳转的动作名**（非空 ⇒ 弹面板而不是跳页；例：`'weekendSummary'`） */
  action?: string
  /** **结构化奖励清单**（界面按当前语言拼串 ⇒ 不在引擎里拼中文；见 `CommsRewardLine`） */
  rewards?: readonly CommsRewardLine[]
}

/**
 * **实例通讯条目**（2026-09-25 加 · 周末入侵两封）：静态表（`CommsMessageDef`）装不下的信——
 * 正文里带**本场数字**，且**每场重写同一个 id**（船长令：「每场都发，但是覆盖上一次的」）。
 * 存在 `state.commsInstance`（随档可选字段 · 零迁移）；收件箱把它与表消息合并渲染，其余机制
 * （已读 / 未读计数 / 弹窗队列 / 送达记账）全部复用既有那一套。
 */
export interface CommsInstanceEntry {
  /** 稳定 id：**同一 id 再次投递 = 整条覆盖**（旧的正文与清单一起换成新一场的） */
  id: string
  /** 发件势力 / 部门（与表消息同口径，界面拼 `势力名 · 部门名`） */
  factionId: string
  deptId?: string
  kind?: CommsKind
  /** 送达时刻（**游戏内毫秒**，与表消息同一时间列口径；投递时由 core 盖章） */
  atGameMs: number
  /** 主题：中文原文（core 侧兜底）＋ 文案 id（界面按语言渲染） */
  subject: string
  subjectId: string
  /** 正文逐段：中文原文（core 侧兜底）＋ 文案 id 列表 */
  paragraphs: readonly string[]
  bodyIds: readonly string[]
  /** 文案参数（`{pN}`；`pNId` 形式见 `CommsEntryView.textParams`） */
  params?: Readonly<Record<string, string | number>>
  /** 跳转按钮：`action` 非空 = 弹面板；否则按 `page` 跳页 */
  hint?: { text: string; page?: CommsJumpPage; action?: string }
  /** 结构化奖励清单（界面拼串用；与实发逐值一致） */
  rewards?: readonly CommsRewardLine[]
}

/** 实例通讯里的一条奖励：**物品** 或 **信用点**（二选一；界面按当前语言拼成人话） */
export interface CommsRewardLine {
  /** 物品 id（与 `isk` 二选一） */
  itemId?: string
  /** 信用点数额（与 `itemId` 二选一） */
  isk?: number
  /** 数量（物品用；信用点行缺省） */
  qty?: number
}
