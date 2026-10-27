import type { DamageType, DamageResists, DroneDefense, DroneClass, FoeTactic, FoeTargetingMode, FoeFamily } from './combat/types/damage'
import type { BattleBalance } from './combat/types/balance'
import type { FoeShipDef, FoeShipSlot } from './combat/types/foes'
/**
 * 内容数据的通用类型定义。
 *
 * 说明：引擎（core）不直接认识任何具体技能，只认识"技能这种形状"。
 * 具体内容（采矿学、导航学…）由数据包（@whale/data）提供，这样以后加内容 = 加数据，不用改引擎。
 */

// 只借类型（`wreckGroups.ts` 反向也只借 `FoeFamily` / `RecycleTier` 类型）⇒ 运行期零循环
import type { WreckGroupDef } from './wreckGroups'
// 只借类型（`salvage.ts` 反向也只借 `AnomalyDef` 等类型）⇒ 运行期零循环
import type { RecycleTier } from './salvage'

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
  /**
   * **黑匣**（**船长 2026-09-26**：「**入侵获得的黑匣在仓库内查看不到，需要新增分类**」）。
   *
   * 由来：墨潮旗舰黑匣（`blackbox-h`）在 2026-09-25「黑匣先做壳」那批**临时借了 `kit` 档**
   * （当时的理由：`kit` 是"无配方消耗品豁免"档，最省事）⇒ 仓库/货仓/手册/市场**全按 kind 分类**，
   * 于是它被塞进「修理组件」里，玩家按名字找「黑匣」永远找不到（船长报障的正是这一条）。
   *
   * 现独立成档：**仓库分类 · 货仓分组 · 手册物品图鉴 · 市场一级类型**四处各多出「黑匣」一档
   * （前两处按 `ITEM_KIND_ORDER` 渲染 ⇒ 自动生效；市场那档另在类型下拉里显式登记）。
   * ⚠ 与 `kit`（修理组件）**必须分开**：黑匣是**战利品/生产原料**（组装机造舰船插件每件吃 1 个），
   * 不是修理消耗品；体检侧的"无配方豁免"由 `content:check` 按**登记在册的黑匣 id** 守。
   */
  | 'blackbox'
  /**
   * **道具**（**2026-09-29 船长令 · 跃迁燃料批**）：工业产出、**按单位数扣减**的活动增益件。
   *
   * 与 `kit`（修理组件）分开的理由：`kit` 是战斗里按次吃的修船件，本档是"仓库里的储备量"——
   * 跃迁燃料每趟返航按**原返航秒数**扣几百~几千单位（见 `core/jumpFuel.ts`）。
   * 仓库分类 / 货仓分组 / 手册图鉴 / 市场一级类型四处共用本档（本地化名见 `labels.ts`
   * 与渲染层 `ui/labelsText.ts` 的 `KIND_ID`）。
   */
  | 'consumable'






/** 物品定义（矿石 / 矿物 / 气体 / 冰矿 / 弹药 / 无人机都属于物品） */
export interface ItemDef {
  id: string
  /** 中文名：橄榄岩、钛钢合金…… */
  name: string
  kind: ItemKind
  /** 每单位占用货舱体积（立方米），矿石 1 m³，矿物很小 */
  unitM3: number
  /**
   * **普通舰船货仓装不进去**（**2026-09-30 船长令**：「每单位燃料体积为1m³，但是普通舰船的货仓无法装入」）。
   *
   * 判据**只此一处**（数据表声明），装船入口一律读它 ⇒ core 里不写物品 id 名单（见 `inventory.ts`
   * 的 `cargoHoldForbidden`）。这类物品只存在于物品仓库；老档里残留在货仓的那份由读档迁移归仓
   * （`save.ts`，不销毁）。
   */
  holdForbidden?: boolean
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
  /** 船体固有首次无人机队列等待缩短；不作用于复活入队或攻击装填。 */
  droneLaunchCutPct?: number
  id: string
  name: string
  /** 档次 1/2/3/4，仅用于展示排序 */
  tier: number
  /** 船型角色（V10：舰船细分系统的占位字段，本轮仅 UI 徽标展示） */
  role: ShipRole
  /** 纯货舰装配：只允许自身防御、航运与作业装备；旧虫洞趟由实例查询保留旧规格。 */
  civilianFittingOnly?: boolean
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
  /**
   * **舰船插件槽数**（**2026-09-26 船长令**：「**改为越低级的船插槽越多。T1~T5分别为5/4/3/2/1个插槽**」）。
   *
   * 插件的专用槽位：与高/中/低槽**互不相干**（不进 `FittedModules`，走 `FleetShipState.plugs`），
   * 上限 = 本值。**越低级的船越多** ⇒ T1 小船 5 格、T5 旗舰 1 格。
   * ⚠ **只有 T1~T5 有**：无档船（采矿艇 / 货舰等 `tier` 不在 1~5 的）**一律无插件槽**。
   * 缺省不写 = 0（不装插件）。
   */
  plugSlots?: number
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
   * 编队扫描半径加成（圈）：侦察舰与电子舰各取最高值、两类相加（2026-10-17船长确认）。
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
  /**
   * **截击舰特性 · 不会被网子选为目标**（**船长 2026-09-30**：「**给拦截舰添加效果，不会被网子选为目标**」）。
   *
   * 语义：敌方「劫掠捕获网」（`FoeMountDef.web`——A 族劫掠电子舰 / H 族突击舰与干扰舰）在**首次开火**
   * 选靶时**跳过本船** ⇒ 本船既不会被钉住、也不吃那四层减益（机动骤降 / 推进器熄火 / 闪避归零 / 射程缩短）。
   * ⚠ 只豁免**那四层减益**：普通炮火的选靶、命中判定与伤害**一字不改**（照旧会被打）。
   *
   * 实现口径 = **数据字段驱动**（照 2026-09-16「后勤舰」先例，**不硬判 `subClass === '截击舰'`**）：
   * `combat.createPlayerSpec` 带出 `spec.interceptorImmuneToWeb`，**消费单点** =
   * `combat.fireFoeCaptureWeb` 的入口守卫；被跳过时敌方那张网**保留待发**（与"目标已被别的网钉住"
   * 同一处置，见该函数头注第 3 条），等它这一发/下一发打到合法目标再发。
   *
   * 全仓现只有两艘截击舰写它（`sh-wh-c-frigate` / `sh-wh-c-destroyer`），
   * 契约见 `tools/content-check.ts`「截击舰特性契约」。缺省 ⇒ 旧口径（零行为变化）。
   */
  interceptorImmuneToWeb?: boolean
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
  /** 限额慢补货：常驻NPC出售额度上限，与经济库存池独立；不配置则沿用原供货。 */
  limitedSupplyCap?: number
  /** 限额慢补货周期（游戏毫秒）；满额时不积攒进度。 */
  limitedSupplyEveryMs?: number
  /** 每周期增加的出售数量，缺省1；不受技能/铁人/建站倍率影响。 */
  limitedSupplyUnits?: number
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
  /** 黑市专用供货白名单；不放开普通市场的playerBuyable限制。 */
  blackMarketBuyable?: boolean
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
     * ⚠ **2026-09-26 船长再改判「甲：单纯削减时间」⇒ 10 → 5 秒**（与低安遇袭那口同口径）；
     * **不计玩家抗性**（船长令「之前没有抗性就算了」）。现值 5，详见 `balance.ts` 那条注释。
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
  /** 被抢：至多损失船上货物比例（**只抢货**；2026-09-28 船长令后不再有"无货则抢钱包"） */
  lootTakenMaxPct: number
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



/** 敌方血型（V11）：盾型 / 甲型 / 均衡（决定敌方三层血量比例） */
export type DefProfile = 'shield' | 'armor' | 'balanced'



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
  | 'drone-launch'
  /**
   * **无人机储备甲板**（**2026-09-27 船长令**：高槽件 —— 无人机被击落后按周期从库存补回一架，
   * 补回的那架立刻重新加入战斗；见 `ModuleDef.droneReviveCycleMs`）。
   * ⚠ 与 `drone-rack`（甲板扩展，**低槽**）分开：船长 2026-09-27 令「将扩大无人机舱的装备从高槽移动到低槽」，
   * 而本件是新需求里明确的"**高槽**装备" ⇒ 单开一族，与 `drone-tac` / `drone-relay` 同槽竞争。
   */
  | 'drone-deck'
  /**
   * **无人机护盾投射仪**（**2026-09-27 船长令**：「添加新的中槽装备…增加无人机的护盾值」）：
   * 第四支无人机装置家族，归**中槽**；效果字段见 ModuleDef.droneShieldHpBonusPct。
   */
  | 'drone-shield'
  | 'support'
  /** 2026-09-11 船长：协处理器（低槽，装配 CPU 预算扩容；见 ModuleDef.cpuBonus） */
  | 'cpu'
  /**
   * **舰船插件**（**2026-09-26 船长令**，见 `docs/design/ship-plug-20260926.md`）：
   * 装得上去、**拆不下来**的固定件，走**独立插件槽**（`ShipDef.plugSlots`，按船型档 5/4/3/2/1）。
   * ⚠ **与 `RackSlot` 无关**：插件不进高/中/低那三类槽位数组，改走 `FleetShipState.plugs`；
   * 本值只用于"这是一件插件"的判别与装配页分支，`rackOf()` 对它的回落值**从不被消费**。
   */
  | 'plug'
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
  /** 新出击加速器首次等待削减，跨型号折权乘算；旧机库字段保持独立。 */
  droneLaunchCutPct?: number
  /** 激光远端威力保留增量，跨型号折权加算，实际falloff不超过1。 */
  laserFalloffBonus?: number
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
   * 0.25 = 战斗机动速度 ×0.75。多件负面继承收益权重后逐件相乘；保留速度安全下限。
   */
  speedPenaltyPct?: number
  /* ═══════════ 舰船插件（2026-09-26 船长令 · 见 docs/design/ship-plug-20260926.md）═══════════
   * 插件 = 装得上去、**拆不下来**的固定件，走**独立插件槽**（`ShipDef.plugSlots`，按船型档 5/4/3/2/1）。
   * 下面这七条是本批为它新开的字段；另有几件**复用既有字段**：
   * `cpuBonus`（协处理插件 +80，与协处理器 MK1/2/3 的 25/35/45 同一入口）、
   * `damageBonusPct`（火力强化）、命中乘区（瞄具）、`weaponRangeBonusPct`（射程）、
   * `speedPenaltyPct` 的**绝对值版** = `speedPenaltyMps`（装甲强化插板的代价）。
   * ⚠ **多件不递减**（船长裁决：不可拆的固定件，装 5 件就是 5 件全额）⇒ 加算/乘算，不走 EVE 曲线。
   */
  /** **固定值加护盾**（护盾强化插板）：绝对值，多件加算。与百分比版 `shieldHpBonus` 并列、互不替代 */
  shieldHpAdd?: number
  /** **固定值加装甲**（装甲强化插板）：绝对值，多件加算 */
  armorHpAdd?: number
  /** **固定值加结构**（结构强化插板）：绝对值，多件加算 */
  hullHpAdd?: number
  /** **固定值加速度**（推进插件 +40 m/s）：多件加算；与百分比版 `speedBonusPct` 相乘关系由建档侧定序 */
  speedAddMps?: number
  /** **固定值减速度**（装甲强化插板 −20 m/s）：绝对值；与百分比版 `speedPenaltyPct` 并列、互不替代 */
  speedPenaltyMps?: number
  /** 势力船插：整件效果只计一次，仍可重复安装占格。 */
  plugNonStacking?: boolean
  stealthWithPropulsion?: boolean
  shieldArmorConversionPct?: number
  shieldPassiveBonusPct?: number
  cargoCapacityBonusPct?: number
  cpuPenalty?: number
  /** 打印机体仅回收原编制，不生成永久库存。 */
  dronePrinting?: { hpMul: number; damageMul: number; launchMul: number; deckCycleMul: number }
  /** 临时内容门禁：图纸定义保留，但不进入势力声望兑换。 */
  blueprintExchangeDisabled?: boolean
  /** **插件加中槽**（中层舱段插件 +1）：多件加算；插件槽专属，普通装备不写本字段 */
  midSlotsAdd?: number
  /** **插件加低槽**（下层舱段插件 +1）：多件加算；插件槽专属 */
  lowSlotsAdd?: number
  /**
   * **被选中权重乘数**（船长 2026-09-26：「**增加被选中的权重**」/「**减少被攻击的权重的插件**」）：
   * 靶标插件 ×2（更常被敌方选靶）· 隐匿插件 ×0.4（更少被选靶）。**多件相乘**。
   * ⚠ 与**闪避**是两回事：闪避管"打中不命中"，本条管"敌方先挑谁打"——落点在选靶单点。
   */
  targetWeightMul?: number
  /**
   * **全武器射程加成**（射程插件；**2026-09-27 船长令改正向字段**）。
   *
   * 历史：原先借用 `rangeCutPct`（"射程 ×(1−本值)"的**削减**语义）写 **负值** 表达加成
   * （`rangeCutPct: -0.2`）⇒ 数据与工作台都得写负数、体检的"说明数字要能被真实数值解释"也认不出
   * ⇒ 船长问「**射程加成为什么负值才是加成**」后按**乙案**改为本字段：**正数即加成**（0.2 = +20%）。
   * ⚠ 与 `rangeCutPct` **互不替代**：后者留给"代价件"（削减，多件取最重一件）；本字段**多件加算、不吃递减**。
   */
  plugRangeBonusPct?: number
  /** 抗性件（装甲镀层·X型）：按系缺口削减抗性（语义同上 shieldResistAdd） */
  armorResistAdd?: DamageResists
  /**
   * 矢量推进器（加力推进）：战斗机动速度加成（0.15 = +15%）。
   * 直接乘入 UnitSpec.speedMps → combatSpeed：拉高接近/脱离/距离操纵力；
   * 弃船逃生率与跃迁充能仍只随船体动力（agility）——V17 起模块不再碰船体间接属性。
   * V18.1：多件推进器速度加成走 EVE 曲线（Π(1+pᵢ·wᵢ)）。
   */
  speedBonusPct?: number
  /** 本舰战斗速度收益线性爬升；与静态速度件同池折权。 */
  speedRamp?: { rampMs: number; maxBonusPct: number }
  /** 逐次命中敌舰后降低装甲抗性，各酸蚀层独立到期。 */
  acidOnHit?: { cutPct: number; durationMs: number }
  blindDmgMul?: number
  /** 推进器开火失稳：命中削减量（0.05 = 我方武器命中 ×0.95；界 [0, 0.5]，缺省 0；
   * 常驻生效并进胜率预估同源口径，见 combat.hitChance 的 hitMul）。
   * 多件命中代价沿用速度收益权重，逐件乘保留比例；只在点火期生效。 */
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
   * **【我方】叠光同款 · 装填自加速**（**船长 2026-10-01 令**：「**添加一件激光武器…为叠光同款叠加攻速的，
   * 基础伤害偏低，需要玩家叠满才威力较强**」）—— R 族势力特色**激光炮**（`mod-lair-laser-r`）专属。
   *
   * 口径与敌方「叠光装置」（`FoeMountDef.overlayDrive`）**逐字同款**：本门武器每**开火**一次 ⇒
   * 装填间隔 `−stepMs`、下限 `floorMs`（船长 2026-10-01 定：**−300ms / 下限 600ms**）。
   * ⚠ 我方这版**不乘伤害倍率**（船长令只说了"基础伤害偏低、叠满才强" ⇒ 由 `dmgMult` 本身低来表达，
   * 不再叠一层折减）。
   *
   * 当前间隔记在 `BattleState.meOverlayReload[tag + '#' + 炮位]`（`kind: 'runtime'`，与敌方同口径）。
   */
  overlayDrive?: { stepMs: number; floorMs: number }
  /** 磁轨炮开火后按层加法增加能量附伤与装填，每场各武器组独立。 */
  railCharge?: { damageStepPct: number; reloadStepPct: number; maxStacks: number }
  /** 空盾后本场启用，同舰多件正负效果使用相同衰减权重。 */
  crisisOverload?: { rangeBonusPct: number; damageBonusPct: number; speedPenaltyPct: number; droneInitialCutPct: number; droneCycleCutPct: number }
  /** 损管触发后的限额持续维修，不增加结构抗性。 */
  rebirthRepair?: { repairMs: number; armorTotalPct: number; hullTotalPct: number }
  /**
   * **【我方】三连射**（**船长 2026-10-03 令**：「**添加一个旗舰同款的势力能量武器（三连射），DPS比MK3要高一些，
   * 射速为3000MS，CPU占用根据DPS的比例同等提高。**」＋定名「**三叉戟光束炮**」＋「**单发伤害再上调20%**」）——
   * R 族势力特色**激光炮**（`mod-lair-beam-r`）专属，**高槽**。
   *
   * 口径与**敌方旗舰那把**（`FoeShipDef.burst` → `WeaponSpec.burst`）**逐字同款**：
   * 一轮装填打 `shots` 发、**发间隔 `gapMs`**（本件 = **3 发 × 100ms**）——前两发之后装填计时重置为
   * `gapMs`、**最后一发打完才回到 `reloadMs`**；每发各走一遍选靶 / 扣弹（`ammoPerShot` 逐发扣）/
   * 命中与演出。⚠ 与「叠光同款装填自加速」（`overlayDrive`）**互斥**：挂了连发的门只在**本轮最后一发**
   * 推进那一格（本仓两件不会同装一件上，写成"每发都推"会让两条机制互相污染）。
   *
   * 连发状态记在 `BattleState.meBurstFired[tag + '#' + 炮位]`（`kind: 'runtime'`，与 `meOverlayReload` 同口径）。
   * 缺省不写 ⇒ **全部既有装备零行为变化**（一门一次）。
   */
  burst?: { shots: number; gapMs: number }
  /**
   * **【我方】闪现跃迁**（**船长 2026-10-01 令**：「**和R族同款，挨打触发闪现。但是冷却时间延长到12秒**」）——
   * R族势力特色**中槽战斗支援件**（`mod-lair-blink-r`）专属。
   *
   * 口径：**本舰被敌方舰炮命中**时（打我方无人机不算、未命中不算）朝自身期望交距跃迁，
   * 单次最多 `distanceM`，随后进入装备规定的 `cooldownMs` 冷却；敌方挂载件独立取参。
   * 冷却态记在 `BattleState.meBlinks`（`kind: 'runtime'`）。
   */
  blink?: { distanceM: number; cooldownMs: number }
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
  /** 近盲边界m；玩家舰载武器在边界内仍开火，伤害倍率0.3。 */
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
  /* ═══ V18 无人机装置位（远行星号式；家族以字段判别：有 droneBayBonusM3 = 甲板扩展、
     有 droneDmgBonus = 战术导控、有 droneRangeBonusPct = 中继天线；**归槽见 labels.rackOf** ——
     2026-09-27 船长令：甲板扩展（drone-rack）改归**低槽**，战术导控与中继天线仍归高槽） ═══ */
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
  /**
   * **无人机储备甲板**（**2026-09-27 船长令**：「添加无人机高槽装备，无人机储备甲板，效果是有无人机被摧毁时
   * 开始运转周期，满了之后立刻补充（复活）被摧毁一架无人机（从仓库补充）。复活的无人机可以重新加入战斗」）
   * ＝ **复位周期毫秒**（MK1/2/3 = 15000 / 10000 / 6000）。落法见 `core/droneRevive.ts`。
   *
   * 船长同日七答的落地口径：
   * - 本舰有机组被击落 **且** 队列里还有有货的型别 ⇒ 起一条周期；到点从**本舰货舱 → 物品仓库**
   *   扣**同型 1 架**补回一架：三层血按 `maxS/maxA/maxH` **满血**、`alive` 翻回 true ⇒ **立刻重新加入战斗**。
   * - **单件内串行**：同一天被打掉多架时一格一格补，不并行。
   * - **多件按需启动**：周期条数 = `min(装了几件, 待补架数)`，优先**周期最短**的件
   *   ⇒ 只损失 1 架时另一件**不空跑**。
   * - **不改战损账**：`droneLost` 照记（战后回收率要用），只在战后"净损失扣清单"里减去已复活的架数。
   */
  droneReviveCycleMs?: number
  /**
   * **无人机护盾层加成**（**2026-09-27 船长令**：无人机护盾投射仪「增加无人机的护盾值」）：
   * 0.7 = +70%（MK2）/ 1.0 = +100%（MK3）；本舰多件**求和**（线性相加、**不设上限**，与「鱿蜂结构层」同款），
   * 只放大机群生存池的**护盾层**（`DronePoolEntry.s`），与机型基础护盾值、耐久学/强化学同链。
   */
  droneShieldHpBonusPct?: number
  /**
   * **对方对机群的命中收窄**（**2026-09-29 船长令**：「巨构导控塔效果改为，对方对无人机的命中收窄 5%」）：
   * 0.05 = 打机群的命中 **×0.95**。本职 = **战术导控族（`drone-tac`）**，本次携带件 = 巨构导控塔。
   *
   * 落法（船长同日裁定「路径①」——与回避/抗性缺口同一条链）：
   * 收窄作用在**被减数**上，综合闪避 = 机型闪避 × (1 − 本值)，再进 `droneHitChance` 的
   * `(基础命中 + 命中加成 − 综合闪避)`；数值上等价于"命中 ×0.95"，不另开 clamp 外的乘子。
   *
   * ⚠ **只作用于"打机群"这一支**（`combat.droneHitChance`）：打舰的 `hitChance` 一字不动；
   * 敌方近防炮打我方机群的公式（`clamp(pdHitFloor, 1, pdAcc − 闪避)`）也**不**吃本字段
   * ⇒ 本字段的语义是"**对方（敌机群）更难被我方打中**"，不是"我方机群更难被打中"。
   * 收敛分组见 `equipment.stackingOf`（`gap` / `drone-hit`：多件复合、界面标「多装递减」）。
   */
  droneHitGapPct?: number
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
     力场为其他队友补盾、且冷却按件自带；两者可同装、各按各的节奏跳。 ═══ */
  /**
   * 力场每路恢复比例，以施放者最大护盾为基准（2026-09-25船长澄清）。
   * 2026-10-07船长确认：只恢复其他存活队友，有有效目标且能支付最大护盾代价时才发动。
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
   *   窗口内**逐段夹伤**：每发结算后结构≥1；实战入伤统一走`combat.applyPlayerUnitDamage`，只记实际掉血。
   * - 窗口到点后恢复正常（不强制撤退）；没组件 ⇒ **不触发**（照常判负）；
   * - 谁装谁有（主控与装了它的 AI 副船各自判定）。
   */
  hullSaveKit?: string
  /**
   * **加固结构插件 · 整船回收率**（**2026-09-26 船长令**：「**留一个接口，给之后舰船插件的。
   * 之后会添加一个加固结构的舰船插件，有加固结构的插件，玩家有概率能够回收该舰船。**」）。
   *
   * 语义：**带本字段的件 = 加固结构插件**（0~1 的整船回收率）。玩家舰船被摧毁后留下的
   * 「舰船残骸」首次打捞时与基础率和工程技能加算，夹到shipWrecks.HULL_RECOVERY_MAX。
   * 缺少新规则标记的历史残骸仍只读插件快照及历史上限；正式目录暂未启用本字段。
   */
  hullRecoveryChance?: number
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
  /** 舰载武器射程代价：负面按对应收益权重折减后逐件乘保留比例，保留射程下限。 */
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
   * **交战距离 ≤ 3800 米**（`combat.MY_WEB_RANGE_M`，船长 2026-09-26「**我方网子的射程是3800米**」）时
   * 钉住一艘**未被钉住**的敌舰（**独立瞄准 · 不看命中**）—— ⚠ **不是"开战即钉"**；
   * **目标被击沉**或**交战距离超过 4500 米断开**（`combat.WEB_BREAK_DIST_M`，敌我通用）
   * ⇒ 都算**用掉一次**、进入冷却，冷却结束再选新目标；**携带者被击沉** ⇒ 该网解除。
   * 效果 = 目标机动 ×0.5（减速 50%）· 推进器全关 · 闪避归零
   * （⚠ **不含"武器射程下降"**——船长 2026-09-26 明令移除；敌方那件仍保留 −500m）。
   */
  captureWebCycleMs?: number
  /**
   * **捕获网投网射程**（米；**2026-09-29 船长令**：「将一些关键属性（比如射程，减速幅度）放进属性里」）。
   *
   * 由来：这三个数（投网射程 3800 · 断开距离 4500 · 减速 ×0.5）原先**只写在件说明里**、另在引擎里当常量
   * （`combat.MY_WEB_RANGE_M` / `WEB_BREAK_DIST_M` / 写死的 `slowMul: 0.5`）⇒ 卡面**属性栏看不到任何一项**。
   * 现在落成数据字段：**引擎读字段、卡面渲染字段**（甲案：数值由卡面参数行渲染，说明不手写数字）。
   * ⚠ 缺省不写 ⇒ 沿用同名的引擎常量（既有件与老档行为零变化）。
   */
  captureWebRangeM?: number
  /** **捕获网断开距离**（米）：交战距离超过它 ⇒ 网断开、算用掉一次（缺省 = `WEB_BREAK_DIST_M`） */
  captureWebBreakM?: number
  /** **捕获网减速倍率**（0.5 = 机动 ×0.5 / 减速 50%；缺省 = 0.5）。与"推进器全关 · 闪避归零"同族。 */
  captureWebSlowMul?: number
  /** **通用单发伤害加成**（亡军火控「伤害 +6%」）：与按系 damageTypeBonusPct 同链（**只进炮台/光束**，
   *  不喂无人机——无人机归战术导控）；多件加算。缺省 0。 */
  damageBonusPct?: number
  /** 装填及战斗主动周期代价：逐件按收益权重折减后乘(1+值)，数值读取装备参数。缺省0。 */
  reloadPenaltyPct?: number
  /** 全层抗性代价：按收益权重折减后逐件减百分点，允许负抗性，受核心抗性下限约束。 */
  allResistPenaltyPct?: number
  /** 首次出击等待缩短率，多件逐件乘算；不修改攻击装填。 */
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
  /**
   * **引擎内部判据用的威胁**（**2026-10-02 船长令取「乙」**）——**缺省 = `threat`**。
   *
   * 为什么要单开一格：`threat` 现在**同时**是"给玩家看的价目表"与"引擎判据的输入"，而两处口径在
   * 两次"只重锚标签"的定价批次里分叉了：
   * - **2026-09-25**「单舰 ×3」定价式重定标（**属性零改动**、只重锚标签）；
   * - **2026-10-02** 窝点（每日赏金任务）威胁改"相对重锚"（同样只改数字）。
   *
   * 威胁喂着两个**非属性**判据：① `pdEnabledFor`（**威胁 ≥ 60 的敌舰装近防炮**）·
   * ② 敌「船体修理装置」强度 `k = max(1, 威胁 ÷ 45)`。只重锚标签却让这两处跟着动 = "只改数字"
   * 不成立（实测：窝点那批翻 5 处、09-25 那批也翻 5 处）⇒ 船长裁定：**这两处按"重锚前的旧标签"判**。
   *
   * 落法：`foeJudgedThreatOf(anomaly)`（`foePower` 的单点）= `threatJudged ?? threat`；
   * - **洞外常驻悬赏**（09-25 那批）：逐张回钉成**重定标前**的旧标签（那 5 张翻了门槛的必须写，
   *   写的就是当年冻在 `wreckThreat` 里的同一个数）；
   * - **窝点派生卡**：`lairAnomalyOf` 显式写 `round(判据威胁(主题卡) × 强度倍率)`（= 那批重锚前的线性标签）。
   * ⚠ **不显示给玩家**：界面一律读 `threat`（价目表）。
   */
  threatJudged?: number
  /** 仅新虫洞派生卡写入：修理与近防资格独立于展示威胁。 */
  wormholeRepairScale?: number
  wormholePdTags?: readonly string[]
  /**
   * **打赢这张卡掉落几件稀有残骸**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」＋
   * 追问落点答「**进残骸场**」）。
   *
   * 落点 = **该星系的入侵残骸场**（`state.weekendWrecks[galaxyId].rare/rareBy`，与常驻残骸场的
   * `galaxyWrecks.rare/rareBy` 同义不同账）⇒ 打捞时**稀有池优先、本轮必出一件**（物品 = 该卡所属组的
   * 稀有残骸，主力舰队即 `wreck-rare-h-hi`）。
   *
   * 触发口径（本次同时定的）：**只在战斗里打赢**（主动出击全歼 ⇒ `win`、遇袭击退 ⇒ `repel`）；
   * 离线 / 无人应答的**文字结算**（`offlineRepel`）与失利**不算**。**不设每场上限**（船长令）。
   * 缺省 = 不掉（既有卡逐字零变化）。
   */
  rareWreckDrop?: number
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
   * 敌不停火，伤害×本值。玩家舰载武器统一近盲倍率0.3。0~1，缺省0.3
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
   *
   * ⚠ **2026-09-26 船长令**：「**H族残骸不分高安低安，统一为入侵残骸**（原先的是高安，低安，虫洞。
   * 新增一个类别）」⇒ 入侵族卡改显式写 **`region: 'inv'`**（新类别，见 `WreckRegion`）；
   * 洞内卡仍是 `'wh'`，两者不再混用同一口径。
   */
  region?: 'hi' | 'lo' | 'wh' | 'inv'
  /**
   * **卡级回收档覆写**（2026-09-26 加 · 船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」）。
   *
   * 缺省不写 = 按该卡所在星系的**基础密度**现算（`recycleTierOf(wreckBaseDensity(galaxyId))`，
   * 与 2026-09-19 合并后的既有口径逐值一致）；写了则**卡级优先**。
   *
   * 为什么需要它：残骸的「保底收益 = 档位当量 × 组池均价」，而档位当量由卡的回收档决定；
   * 入侵族的卡锚在展示用的 `galaxy-hub`（密度 58 ⇒ 常档）、G 族低安三卡的星系密度也不足危档阈值
   * ⇒ 若只改组池，B3.1 的「保值」与「组档 = 成员卡多数档」两条契约会判红。
   * 单点出口 = `salvage.wreckCardTierOf`（引擎侧与 `content:check` 同源）。
   */
  wreckTier?: RecycleTier
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
  /** 星球实验目录，只有显式runtimeVersion测试世界推进，不自动生成。 */
  planetary?: import('./planetTypes').PlanetCatalog
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
  /** 新虫洞独立编成可取未进入旧卡的已登记舰级；合成上下文可省略。 */
  foeShips?: ReadonlyMap<string, FoeShipDef>
  travelEvents: readonly TravelEventDef[]
  /** 副空间站建站点（T9） */
  stations: ReadonlyMap<string, StationSiteDef>
  /**
   * **实验室配方表**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料」）。
   * 数据在 `packages/data/src/labRecipes.ts`；核心只认形状（`LabRecipeDef`）。
   */
  labRecipes: ReadonlyMap<string, LabRecipeDef>
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
  /** 信号空间扫描半径 +v 圈/级。 */
  | 'whScanRadius'
  /** 信号空间自动探索解锁；收益在50%基础上每级增加v，三级最高80%。 */
  | 'signalAutoYield'
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
  /* ── 2026-09-30 船长令追加（T5 层首批 ＋ 精炼提速两支） ── */
  /** **虚空母矿精炼周期 −v/级**（v = 0.10 / 0.05，**加法口径**、封顶 0.9；只作用于
   *  `WORMHOLE_ORE_ITEM_ID`（虚空母矿）那一支——消费点 = `core/industry.ts` 起炉时的周期折算） */
  | 'voidRefineSpeed'
  /** **每小时自动获得虚空母矿 v 枚/级**（v = 100 ⇒ 满级 300 枚/时；只进物品仓库，
   *  离线照算；消费点 = `core/matterTech.ts` 的 `advanceMatterOreDrip`） */
  | 'voidOreDrip'
  /** **解锁实验室的高级燃料配方**（v 无意义、只看"有没有点过一级"；判据单点 =
   *  `core/lab.ts` 的 `labRecipeUnlocked`，配方侧用 `LabRecipeDef.requiresTech` 声明要哪一条） */
  | 'fuelRecipeAdvanced'

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
 *   `data/src/achievements.ts`，展示改版见归档设计稿 `docs/design/archive/achievement-display-20260920.md`）。
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
  /** 本档材料单：精炼矿物/零件 × 数量，逐项交齐才升档，不含原矿。 */
  bill: ReadonlyArray<{ itemId: string; count: number }>
  /** 旧已交、现档不再收取的材料按原单价抵扣；当前材料价格由内容目录派生。 */
  legacyDeliveredCredit?: {
    previousUnitValues: Readonly<Record<string, number>>
    currentUnitValues: Readonly<Record<string, number>>
  }
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

/**
 * **实验室配方**（**2026-09-29 船长令 · 跃迁燃料批**）。
 *
 * 与蓝图的差别：蓝图是"按产物 1 件扣料"的制造，实验室是**按批**的综合合成（一份 BOM 出一批产物，
 * 可连续跑到料尽），第一版只有「超空间折跃燃料」这一张（`packages/data/src/labRecipes.ts`）。
 */
export interface LabRecipeDef {
  /** 实验室筛选领域；缺省兼容旧配方。 */
  category?: 'fuel' | 'beacon' | 'accelerant'
  id: string
  /** 配方名（工业页实验线卡片标题） */
  name: string
  /** 产物物品 id（`items.ts`） */
  outputItemId: string
  /** **每批产出单位**（基准值；起线时按工业技能现算放大） */
  outputUnits: number
  /** **每批周期毫秒**（基准值；起线时按 AI 核心效率与工业技能现算缩短） */
  cycleMs: number
  /** 每批投料（一括扣齐才出料；缺任一料 ⇒ 该批不跑、线停） */
  materials: readonly { itemId: string; units: number }[]
  /**
   * **施工期未上线闸门**（**2026-09-30 加**，与物品/市场卡的 `unreleased` 同口径）：
   * 数据先就位、**玩家看不到也开不了工** —— `buildLabRecipeCatalog()` 会滤掉它，
   * 于是界面列不出、`startLabRun` 也拿不到配方（`ctx.labRecipes` 查不到 ⇒ 直接拒）。
   * 效果与界面接完后摘掉本字段即上线。
   */
  unreleased?: boolean
  /**
   * **谜质科技门槛**（**2026-09-30 船长令**：「再添加一个 T5 是解锁新的燃料配方」）：
   * 填了 = 该配方要**对应效果关键字**至少点过一级才开得了工（判据单点 = `core/lab.ts`
   * 的 `labRecipeUnlocked`，走 `matterTechSum(state, ctx, 本值) > 0`——**core 不认节点 id**，
   * 与谜质树"按效果关键字汇总"的既有口径一致）。
   *
   * ⚠ 配方仍**列在目录里**（`buildLabRecipeCatalog` 不过滤它）⇒ 界面能显示"锁着、要点哪棵树"，
   * 起线动作与界面按钮同读 `labRecipeUnlocked`。缺省 = 无门槛（老配方零变化）。
   */
  requiresTech?: MatterTechEffect
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
   * **第一次进实验室页面**（**2026-09-30 船长令**：「当玩家第一次进入实验室页面时，给玩家发送一封通讯」）——
   * 读随档标记 `state.labOpened`（置位点唯一 = `engine.noteLabOpened()`，两个实验室入口都调它）。
   */
  | { kind: 'labOpened' }

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
   * **拿到第一个黑匣**（**2026-09-26 船长令**：「**玩家获取第一个黑匣后，才解锁组装机的插件选项，
   * 并且弹出相关通讯，通讯内跳转。**」）。
   *
   * 判定 = `blackbox.blackboxSeenOf(state)`（置位点 = 黑匣入库的唯一入口；老档按"仓库/货仓里有没有黑匣"回填）。
   * ⚠ **送达即幂等**（`commsDelivered` 记账）：即便玩家后来把黑匣卖光、`blackboxSeen` 又被回填成 false，
   * 这封信也不会再发第二遍。落地与跳转见 `data/messages.ts` 那条 `msg-blackbox-plug-unlock`。
   */
  | { kind: 'blackboxSeen' }
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
  hint?: { text: string; page: CommsJumpPage; tab?: string; taskTab?: string; shipTab?: string; action?: string }
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

export { type DamageType, type DamageResists, type DroneDefense, type DroneClass, type FoeTactic, type FoeTargetingMode, type FoeFamily } from './combat/types/damage'
export { type FoeMountId, type FoeMountDef, type FoeSupportBranch } from './combat/types/mounts'
export { type BattleBalance } from './combat/types/balance'
export { type FoeShipDef, type FoeDroneDef, type FoeDroneSlot, type FoeShipSlot, type FoeReinforceTrigger } from './combat/types/foes'
