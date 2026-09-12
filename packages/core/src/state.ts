/**
 * 游戏状态：一份存档里保存的全部内容。
 *
 * 设计要点（中文说明）：
 * 1. 状态是一棵普通的数据树，可以整体序列化成 JSON 存档；
 * 2. 引擎函数"原地修改"传入的状态，由界面层在合适的时机做快照/存档；
 * 3. 游戏内时间用 gameMs（累计毫秒）推进，真实墙钟时间只用于"离线多久"的计算；
 * 4. v7 起：每艘船有自己的 货仓/耐久/已装配装备（fleet），另有独立的"物品仓库"
 *    （无限容量、永不遗失）；采矿支持 AI 核心驱动的自动返航-卸货循环。
 */

import type { AiCoreType, DamageResists, DamageType, FittedModules, ModuleSlot } from './types'
import { emptyFitted } from './labels'

export type { FittedModules } from './types'

/** 当前存档结构版本号：结构一变就 +1，并写对应的迁移函数（见 save.ts） */
export const CURRENT_STATE_VERSION = 24
/** 母港星系 id（内容层约定；探索系统以它为初始点亮点） */
export const HOME_GALAXY_ID = 'galaxy-hub'
/** 技能最高等级（EVE 惯例 5 级） */
export const MAX_SKILL_LEVEL = 5
/** 事件日志最多保留条数（防止存档无限膨胀） */
export const DEFAULT_LOG_CAP = 300
/** 新飞行员默认名字 */
export const DEFAULT_PILOT_NAME = '深空学徒'
/** 初始资金（ISK）——经典开局（测试/模拟基准）：够买船但买不起第二艘。
 * 真实新游戏走序章 prologue 分支（零资金，见 createInitialState） */
export const DEFAULT_START_ISK = 10_000
/** 初始自带舰船 id（经典开局 = 沙猫矿艇；序章 prologue = 鲣鱼武装艇带伤） */
export const DEFAULT_START_SHIP_ID = 'sandcat'
/** AI 核心最高等级 */
export const MAX_AI_CORE_LEVEL = 5

/** 日志类型：显示端按类型配色/筛选 */
export type LogKind = 'system' | 'info' | 'queue' | 'levelup' | 'warn' | 'trade'

/** 一条事件日志 */
export interface LogEntry {
  /** 自增编号，界面当 key 用 */
  id: number
  /** 发生时游戏内时间（毫秒），以后可回看"第几小时发生了什么" */
  atGameMs: number
  kind: LogKind
  text: string
}

/** 随机数状态：存种子与使用次数，保证任何时刻都能复现同一串随机 */
export interface RngState {
  seed: number
  count: number
}

/** 训练队列里的一项（目标：把某个技能练到第几级） */
export interface TrainingItem {
  skillId: string
  targetLevel: number
  /** 当前等级的已训练进度（毫秒）。只记"当前这一级"的进度，升一级清零重计 */
  progressMs: number
}

/** 技能相关的状态 */
export interface SkillsState {
  /** 已学等级：技能编号 -> 等级 */
  trained: Record<string, number>
  /** 训练队列：队首 = 正在训练，后面的按顺序排队 */
  queue: TrainingItem[]
  /**
   * 暂存进度（T2）：取消队首训练时把"本级已练毫秒"存到这里，
   * 之后重新把该技能排为队首（练同一级）时自动续接。
   * 键 = 技能编号，值 = 本级已练毫秒（0 < 值 < 该级总时长）。
   */
  savedProgress: Record<string, number>
}

/** 飞行员基础档案 */
export interface CharacterState {
  name: string
  /** 建立档案时的墙钟时间（毫秒时间戳），纯展示用 */
  startedAtWallMs: number
}

/** 钱包（ISK 星际信用点） */
export interface WalletState {
  isk: number
}

/** 物品仓库（v7）：空间站仓库，无限容量、永不遗失 */
export interface WarehouseState {
  items: Record<string, number>
}

/**
 * 已装配的装备：v17 前 = 六槽 Record；v18 起 = FittedModules 三类位数组
 * （见 ./types.ts 定义与 save.ts 迁移 17→18）。
 */

/** 舰队里一艘船的状态（v7 起：耐久 + 货仓 + 已装配装备都跟船走；
 * v17 实例化：同型可多艘，条目含 defId 船型锚与自定义名。
 * defId/customName 由读档迁移/normalize 与新建路径写入；直构测试与异常旧条目可能缺失，
 * 查询侧一律经 instances.fleetDefOf/shipDisplayName 兜底（defId ?? 按 uid 解析）。 */
export interface FleetShipState {
  /** v17：船型 id（ctx.ships / 市场 / 蓝图的数据键）；同型多艘共用同一 defId */
  defId?: string
  /** v17：玩家自定义船名（缺省/未设 = 用默认名：船型名，同型第 2 艘起自动带「 #N」） */
  customName?: string | null
  /** 耐久 0~1（1 = 完好）；P0 起与「结构层」合并：战斗中结构被打多少，耐久就扣多少（跨场保留），归零即弃船 */
  durability: number
  /** P0 承伤持久化：装甲残余比例 0~1（1 = 完好；缺省=1）。损伤跨场保留，仅港内付费维修/修理套件恢复 */
  armorPct?: number
  /** 船上货仓：itemId -> 单位数（随船，弃船即遗失） */
  cargo: Record<string, number>
  /** 装在这艘船上的装备（随船，弃船即遗失） */
  fitted: FittedModules
  /** 无人机舱装载清单（2026-09-08 无人机舱大改）：droneId -> 架数（0 = 不存）；
   *  战斗只放飞此清单（不再自动从仓库贪心）；CPU 预占计入船体预算；旧档缺省 = 空 = 无无人机 */
  droneLoad?: Record<string, number>
  /** 弹药档位偏好（2026-09-09 弹药 MK2）：damageType -> 弹 itemId（如 'ammo-kinetic-2'）；
   *  缺省 = 基础弹。开战预载按此装载（库存不足整族回退基础 + 日志）；连打/离线同源消耗 */
  ammoPref?: Partial<Record<DamageType, string>>
}

/** 采矿作业状态（自动循环：采掘 → 返航（去程并入）→ 卸货 的自动循环；去程相位仅旧档兼容） */
export interface MiningState {
  active: boolean
  beltId: string | null
  /** 作业阶段：mining=正在采掘；returning=返航（满载返航 + 去程并入）；outbound=旧档遗留相位 */
  phase: 'mining' | 'returning' | 'outbound'
  /** 采掘循环计时器累计（毫秒），满一个循环结算一次产出 */
  cycleAccMs: number
  /** 返航/去程遗留相位计时器（毫秒） */
  phaseAccMs: number
  /** 本次作业累计采得单位数（日志用） */
  tripUnits: number
  /** 全自动循环（满舱自动返航→卸货→再采掘） */
  autoCycle: boolean
  /** 完成本次返航卸货后停止（配合全自动循环使用） */
  stopAfterTrip: boolean
  /** T8 兼容字段：本次作业的出发星系（null = 从空间站/母港出发）；
   *  用于把去程时间并入首次返航腿；首次卸货后清空，此后自动循环一律以空间站为基准 */
  originGalaxy: string | null
  /** 富矿红利窗口剩余循环数（卷B2⑥，2026-09-08 船长定稿）：触发当轮置 1，下一循环消耗至 0；
   *  0/缺省 = 无窗口（旧档零迁移）。窗口与矿带绑定：换带/停止/结束清零；自动循环返航卸货后回原带保留。 */
  rvLeft?: number
}

/** T4 换船善后：旧船自动返航到港的记录（key = 船 id，独立于主控采矿推进） */
export interface ShipReturnState {
  /** 原矿带 id（日志/语义用；null = 未知——远征返航善后无矿带） */
  beltId: string | null
  /** 返航单程总长（毫秒，换船时按旧船行程锁定） */
  legMs: number
  /** 已走毫秒（≤ legMs；到港条件 = 累计 ≥ legMs） */
  phaseAccMs: number
  /** 善后来源（2026-09-08 船长定）：'mining' = 采矿换船（缺省）/ 'expedition' = 返航中换船
   *  把远征返航转为旧船善后账本（到港自动卸货，无其余战果结算）/ 'salvage' = 打捞换船
   *  （2026-09-09：与采矿同构——打捞作业中换船，旧船自动返航到港卸货） */
  reason?: 'mining' | 'expedition' | 'salvage'
}

/**
 * T8 显式"返航空间站"行程（野外停留 → 空间站；出发锁定总时长）。
 * 2026-09-08（船长定）：扩展为"建站交付航线"——主船从停靠空间站出发、按真实航程驶往
 * 建设工地星系，到点自动交付建材并自动返航最近空间站；delivery 非空表示本行程为交付任务。
 */
export interface ShipTransitState {
  active: boolean
  /** 出发星系（显示用；null = 未知） */
  fromGalaxy: string | null
  /** 目的空间站所在星系（当前只有母港；T9 副站就绪后可为副站星系）；
   * 交付航线去程 = 工地星系、返程 = 最近空间站星系 */
  toGalaxy: string | null
  /** 到站时刻（游戏内毫秒，出发锁定） */
  finishAtGameMs: number
  /** 本次行程总毫秒（显示用） */
  legMs: number
  /**
   * 建站交付航线标记（2026-09-08 船长定，v2 物理载货模型）：
   * siteId = 工地；phase = to-site（前往交付）/ to-station（交付后自动返航）；
   * loaded = 本趟出发时装入货仓的建材明细（到点只清空本趟装载，不再从仓库补扣）。
   * null = 普通返航行程。
   */
  delivery: {
    siteId: string
    phase: 'to-site' | 'to-station'
    loaded?: Record<string, number>
  } | null
}

/** B1.5 主控"前往星系掩护巡逻"（原"待命"）：下达即时就位——船转场目标星系野外停留（awayGalaxy）；
 * 字段为旧档兼容保留：旧档在途（finishAt 在未来）仍需等到点再留守；新指令不留 active 状态。 */
export interface StandbyState {
  active: boolean
  /** 目标星系 id */
  galaxyId: string | null
  /** 到达时刻（游戏内毫秒；新指令 = 当前时刻，无去程等待） */
  finishAtGameMs: number
  /** 去程总毫秒（旧档显示用；新指令 = 0） */
  legMs: number
}

/**
 * 一条制造作业（v21 多工位并行：不同蓝图可同时制造、同蓝图可多线，各自限时到点自动出产物/船；
 * 2026-09-08 起劳动者制与精炼炉同款：worker = 'pilot'（主控亲自，全局限 1 条、占主控工作位）/
 * AiCoreType（一枚核心驱动一条线，核心出库占用、完成/取消自动归还，库存即并行上限）。
 * worker 缺省 = 老档遗留的"旧作业"（劳动者制上线前开的无线作业）：豁免继续跑到自然完成/被取消，
 * 不占劳动者位；新开工必须带 worker。）
 */
export interface ManufacturingRunState {
  active: boolean
  /** 稳定线号（state.manufacturingSeq 分配；取消/活动栏按它定位） */
  id: number
  blueprintId: string | null
  /** 劳动者：主控亲自 / AI 核心类型；缺省 = 旧档遗留无线作业（不占劳动者位） */
  worker?: 'pilot' | AiCoreType
  /** 完成的游戏内时刻（毫秒） */
  finishAtGameMs: number
  /** 本次作业总耗时（毫秒，开工时按当时技能锁定，中途升技能不影响） */
  durationMs: number
  /** 【兼容只读·2026-09-10 起停用】旧逐线连续生产字段——循环制造已上移到卡片级
   *  （见 ManufacturingLoopState）；这几个字段只用于读老档时归并，引擎不再写入。 */
  autoRepeat?: boolean
  /** 【兼容只读·2026-09-10 起停用】旧逐线目标件数（读档归并到卡片配置） */
  repeatGoal?: number
  /** 【兼容只读·2026-09-10 起停用】旧逐线累计产出件数（读档归并到卡片合计） */
  produced?: number
}

/**
 * 组装机「循环制造」卡片级配置（2026-09-10 船长定：开关与目标件数从逐条制造线上移到整张生产卡）。
 *
 * 口径（船长逐条确认）：
 * - key = 蓝图 id（一张生产卡一个配置），**该卡全部制造线共用**——含主控亲自那条；
 *   开关打开后新开的线自动继承（判定实时读本配置，不往线上写副本）；
 * - `produced` = **本轮全卡合计**产出件数（自上次「关→开」起算，开关打开期间逐件累加）；
 * - 目标件数 = 全卡合计口径：合计达到目标即不再续做；此刻在跑的那几件跑完再停
 *   （最多超产 = 同时在跑线数 − 1，不砍已扣料的在跑件）；
 * - 自动停线（达成目标 / 材料不足 / 记录缺失）→ `on` 置假并写入 `stopWhy`（卡片上标明停因），
 *   该卡其它线跑完当前件即止；下次「关→开」时 `produced` 与 `stopWhy` 一起清零；
 * - 手动关开关 = 完成当前件后停（不写停因）；缺省/无键 = 不循环。
 */
export interface ManufacturingLoopState {
  /** 开关：true = 本卡全部制造线完成一件后自动续做同一蓝图（劳动者/核心保持占用） */
  on: boolean
  /** 目标件数（>0 达数即停；缺省/0 = 直到材料不足自动停） */
  goal?: number
  /** 本轮全卡合计产出件数（开关打开期间累加） */
  produced?: number
  /** 上一次自动停线原因（界面提示；重新打开开关 / 手动关闭时清空） */
  stopWhy?: string
}

/**
 * 精炼炉运转状态（工业细化 2026-09-04 起循环运转；2026-09-05 船长拍板多单位并行 + 实时扣料）：
 * - v20 起同资源允许多台炉同时运转（worker 各自独立周期循环），原料不预锁定——
 *   每批到点时从仓库/货仓实时扣取 min(单批, 当前余量)，余量不足自然成尾批，耗尽自动停；
 * - 原料未锁定 = 可中途卖出（卖光后到点即停并记日志）；
 * - worker：'pilot' = 主控亲自运转（全局限 1 台、占主控工作位，期间不可离港作业）/
 *   AiCoreType = 一枚 AI 核心驱动一台（核心出库占用、不占副船名额，停止/料尽自动归还）。
 */
export interface RefineRunState {
  active: boolean
  /** 稳定台号（state.refineSeq 分配；停炉/活动栏按它定位单台） */
  id: number
  /** 劳动者：主控亲自运转 / AI 核心类型 */
  worker: 'pilot' | AiCoreType
  /** 运转模式：refine = 资源精炼（矿石/气体/冰矿）；recycle = 残骸回收开箱（B3） */
  recipe: 'refine' | 'recycle'
  /** 正在运转的资源 id（矿石/气体/冰矿/残骸物品） */
  itemId: string | null
  /** 单批单位（开工时按技能现算） */
  batchUnits: number
  /** 单批周期毫秒（已按 AI 核心效率拉长） */
  cycleMs: number
  /** 当前批到点时刻（游戏内毫秒） */
  finishAtGameMs: number
  /** 已完成批数（展示用） */
  batchesDone: number
  /**
   * 本轮锁定的**剩余可投料量**（2026-09-10 船长定：稀有残骸每炉锁死 1 件 = 30 m³）：
   * 起炉时按 `RARE_WRECK_VOLUME_M3` 写入、每批扣减，用尽即走"原料耗尽"同一条路径停炉；
   * **缺省 = 不限制**（普通残骸与精炼炉照旧"整批直到料尽"，老档天然是这个语义 → 零迁移）。
   */
  lockUnits?: number
  /**
   * **本炉私有料账**（2026-09-11 船长定「甲：起炉即预占」修复「一件稀有残骸被多台炉各开一箱」）：
   * 稀有残骸起炉时把这 1 件（30 m³）**从货仓/仓库扣出**存进本字段，每批从私有账扣；
   * 停炉（手动/余量不足/料尽/异常）时未用完的部分**退回仓库**。
   * ⇒ 一件残骸只能被**一台炉**持有，一件 = 一炉 = 一箱，并行台与"跑一批就停再起"都刷不动。
   * **缺省 = 无私有账**（普通残骸与精炼炉照旧"实时扣料直到料尽"；老档天然是这个语义 → 零迁移）。
   */
  claimedUnits?: number
  /**
   * 本炉**具备高级箱开箱资格**（2026-09-11「一件 = 一箱」第二道锁）：起炉时按"该型残骸的未开箱存量 ≥ 一件"
   * 判定并快照；开箱时把本炉预占的整件记入 `state.rareOpenedUnits`（退还的余料据此不再产箱）。
   * 缺省 = 无资格（老档/普通残骸天然如此 → 零迁移）。
   */
  rareBoxEligible?: boolean
  /**
   * 本炉**尚未开箱的回收单元数**（2026-09-11 船长定：「按照每次少 30 立方，自动烧」）。
   * 一个**回收单元** = `RARE_WRECK_VOLUME_M3` = 30 m³；每烧完一个单元（= 3 批 × 10 m³）开一箱。
   * 起炉时把库存里**所有完整单元**预占进本炉（`claimedUnits` = 单元数 × 30），一炉可持多个单元、
   * 一口气烧完（3 个单元 = 90 m³ = 9 批 = 3 箱），不再要求玩家每 30 m³ 重开一次炉。
   * 缺省（老档）= 按旧语义回退"整炉只开一箱"（见 `industry.ts` 的 `unitsLeftOf`）。
   */
  rareUnits?: number
  /** 起炉时固定的"本炉共可开几箱"快照（`rareUnits` 每开一箱递减，故本炉总量必须另存） */
  rareUnitsAtStart?: number
  /** 本炉**自起炉以来已烧掉的体积**（m³）：每满一个回收单元（30 m³）开一箱的判定用 */
  rareBurnedSinceStart?: number
  /** 起炉时的全局快照：该型残骸**累计已烧体积**（m³）与**已开箱数**（见 `GameState.rareBurnUnits`） */
  rareBurnBefore?: number
  rareBoxBefore?: number
  /** 炉内所得累计（2026-09-06 兼容字段：停炉/料尽/自然结束时写明细日志用；
   *  refine 炉只用 min（产物矿物）；recycle 炉 = 保底矿物(min) + 彩头装备(mod) +
   *  **专属无人机(drone，2026-09-10 增：按架数)** + 蓝图碎片(frag)；
   *  normalize 清洗兜底，无版本号） */
  recAcc?: {
    min: Record<string, number>
    mod: Record<string, number>
    frag: Record<string, number>
    /** 专属无人机（物品）所得：id → 架数 */
    drone?: Record<string, number>
  }
}

/** 精炼炉空态（兼容常量；v20 多台炉不用单例空态） */
export const EMPTY_REFINE_RUN: RefineRunState = {
  active: false,
  id: -1,
  worker: 'pilot',
  recipe: 'refine',
  itemId: null,
  batchUnits: 0,
  cycleMs: 0,
  finishAtGameMs: 0,
  batchesDone: 0,
}

/** B3 打捞作业（采矿式自动循环，2026-09-09 船长定：默认自动循环，满舱返航卸货后同星系自动续捞）：
 * 立即打捞 → 满仓自动返航（去程并入）→ 到港整仓卸入仓库 → 自动续捞（stopAfterTrip/关闭循环则收工）。
 * tripM3 = 本趟捞取体积当量累计（展示/日志）；deviceAccMs = 各周期档的打捞器相位（周期 ms → 累计）。
 * autoCycle/stopAfterTrip = 作业偏好，跨趟持久（同采矿 MiningState 语义）；outbound 相位仅旧档遗留兼容。 */
export interface SalvageOpState {
  active: boolean
  /** 目标星系 id（null = 无作业） */
  galaxyId: string | null
  /** 阶段：outbound（出航）/ salvaging（打捞中）/ returning（返航） */
  phase: 'outbound' | 'salvaging' | 'returning'
  phaseAccMs: number
  /** 统一推进步的累计（以最短打捞器周期为步长） */
  cycleAccMs: number
  /** 本趟累计捞取体积当量（m³） */
  tripM3: number
  /** 打捞器相位账：周期 ms → 已累计 ms */
  deviceAccMs: Record<string, number>
  /** 自动循环（默认开）：卸货后同星系自动续捞；关闭 = 本趟收工 */
  autoCycle: boolean
  /** 「本次返航卸货后停止」：勾选后强制自动循环开、卸完这一趟即收工（与采矿同款联动） */
  stopAfterTrip: boolean
}

/** 打捞作业空态（新档 / 作业结束） */
export const EMPTY_SALVAGE_OP: SalvageOpState = {
  active: false,
  galaxyId: null,
  phase: 'salvaging',
  phaseAccMs: 0,
  cycleAccMs: 0,
  tripM3: 0,
  deviceAccMs: {},
  autoCycle: true,
  stopAfterTrip: false,
}

/** 远征作业状态（去程取消 → 交火 battle → 返航 back；battle 为实时状态机；返航 = 2×单程） */
export interface ExpeditionState {
  active: boolean
  /** 目标异常点 id */
  anomalyId: string | null
  /** 当前阶段结束的游戏内时刻（毫秒）——V12 起语义随 phase：开战/战斗结束/返航到家 */
  finishAtGameMs: number
  /** 本次作业总耗时（毫秒，出发时锁定；展示用） */
  durationMs: number
  /** 单程航程耗时（毫秒，锁定；返航腿并入后按 ×2 计） */
  outMs: number
  /** 交火参考耗时（毫秒，展示用；实际由战斗推演决定） */
  combatMs: number
  /** 出发时火力（锁定；展示/旧式兼容） */
  power: number
  /** 出发时抽中的途中事件 id（null = 本次平安无事；去程取消后在出发瞬间触发） */
  eventId: string | null
  /** 途中事件是否已触发 */
  eventFired: boolean
  /* ═══ V12：阶段与战斗状态 ═══ */
  /** 当前阶段：去程（旧档兼容）/ 交火 / 返航（未出航时 = 'out'） */
  phase: 'out' | 'battle' | 'back'
  /** 返航来源（2026-09-06 兼容字段）：victory=悬赏胜利自动返航（不可召回）；
   *  defeat/retreat=失利/撤退返航（可召回）；旧档在途 back 无此字段 = 按失利口径 */
  returnReason?: 'victory' | 'defeat' | 'retreat'
  /** 返航段起点（2026-09-08 兼容字段）：转入 back 的游戏时刻——进度条分母 =
   *  finishAtGameMs − 本值（本地 120s/异星系 2×单程均正确）；旧档在途 back 缺省 → 回退旧口径 */
  returnAtGameMs?: number
  /** 实时战斗状态（phase='battle' 时非空；只存动态量，静态由 ship/anomaly 定义重建） */
  battle: BattleState | null
  /** 玩家期望距离偏好（米；战斗内拖动/战术选择写入，下次出发自动沿用；未设则用有效射程中点） */
  desirePrefM?: number
  /** 赏金任务·窝点档位（2026-09-10 兼容字段）：非空 = 本次远征打的是派生窝点
   *  （威胁/波次/僚机按档位强化，奖金与稀有残骸按窝点口径结算）；旧档与普通悬赏 = 未设 */
  lairTier?: 1 | 2 | 3
  /** 敌对派系活跃（2026-09-10 兼容字段）：true = 本次远征打的是当日派系活跃星系的**常驻悬赏**
   *  （威胁 ×1.1、奖金 ×1.1、胜利有概率掉稀有残骸）；与 lairTier 互斥（派系只针对普通悬赏） */
  factionActive?: boolean
}

/** V12 战斗单位运行状态（动态量：三层当前血量 + 每武器装填倒计时） */
export interface BattleUnitRt {
  /** 单位标识：我方 'player'；敌方 'foe-0'（主力）/ 'foe-1..n'（僚机）/ 多波多小队 w{n}-foe-{k}（2026-09-09） */
  tag: string
  side: 'me' | 'foe'
  name: string
  /** 三层当前血量（盾/甲/结构） */
  hp: { s: number; a: number; h: number }
  /** 三层满血量（血条分母；2026-09-09 多波起写——波次/读档单位 UI 血条以本字段为准，旧档缺省由 UI 兜底） */
  hpMax?: { s: number; a: number; h: number }
  /** 每武器装填倒计时 ms（0 = 可开火；与静态武器卡顺序一一对应） */
  weapons: number[]
}

/** V12 战斗可视化事件：一次实际开火（供战斗画面动画回放；纯展示数据，不影响结算与随机） */
export interface BattleFx {
  /** 单调序号（跨环裁剪仍可续播：UI 消费端记录 lastSeq，只取 seq 更大的新事件） */
  seq: number
  /** 开火时刻（战斗推进中的 gameMs；只保留最近窗口内事件） */
  atMs: number
  side: 'me' | 'foe'
  /** 开火单位 tag：'player' / 'foe-0'（主力）/ 'foe-1..n'（僚机） */
  tag: string
  /**
   * V18B 目标 tag（2026-09-05 船长修复）：本次开火瞄准的目标单位（'player' 或敌方 tag）。
   * 旧事件/测试构造可缺省（UI 回退旧行为）；随机目标下每发可指向不同单位。
   */
  to?: string
  /** 本次开火弹种（炮台 = 当时实际消耗的弹型） */
  type: 'kinetic' | 'explosive' | 'plasma'
  /** 武器来源（2026-09-10 船长批：无人机动画差异化的展示字段；旧事件/测试构造缺省 →
   *  UI 按旧口径回退，不区分来源）。取值同 WeaponSpec.src */
  src?: 'turret' | 'missile' | 'laser' | 'drone' | 'base'
  /** 无人机机型 id（src='drone' 时携带：drone-scout/assault/heavy/sentry） */
  artId?: string
  /** 是否命中目标 */
  hit: boolean
  /** 机群被击落标记（2026-09-10 船长「无人机可被击落」）：本事件表示该架无人机被点防击落
   * （UI 出小爆炸/坠落演出；缺省 = 普通开火事件） */
  droneDown?: boolean;
  /**
   * **打的是敌方机群**（2026-09-11 船长：「**炮在攻击无人机时不显示弹道**（因为之前已经做了一个
   * 攻击动画表示正在攻击无人机）」）——UI 据此**只出炮口闪光、不画弹道**
   * （机群已飞到您舰旁，弹道画向敌舰是错的；攻击感由闪光 + 机群自身的出击动画表达）。
   */
  pd?: boolean
}

/** V12 实时战斗持久状态（确定性事件步进；只存动态量） */
export interface BattleState {
  /** 战斗开始（到港）的游戏内时刻 */
  startedAtGameMs: number
  /** 上次推进时刻（离线大步长切段基准） */
  lastTickGameMs: number
  /** 当前距离 m */
  distanceM: number
  /** 我方期望距离（战术选择/手动拖动；落档离线沿用） */
  myDesireM: number
  /** 双方单位运行状态 */
  units: Record<string, BattleUnitRt>
  /** 我方剩余弹药（出发预载后按开火即时扣减；开火弹型 = 剩余最多型，平局 kin→exp→pla） */
  ammo: { kin: number; exp: number; pla: number }
  /** 弹药 MK2（2026-09-09）：本场实装弹 itemId（damageType → id；开战装载时写，缺货回退也写）。
   * 战斗推进/视图重建我方规格时以此覆盖装配档位偏好（伤害与实际弹种一致）；
   * 缺省 = 无覆盖（按船装配 ammoPref/基础弹），旧档零迁移 */
  ammoIds?: Partial<Record<DamageType, string>>
  /** 战斗累计统计（战报/小剧场用） */
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  /** 可视化开火事件环（最新 48 条；战斗画面动画回放用，不影响结算） */
  fx: BattleFx[]
  /** 下一条开火事件的序号（pushFx 自增分配；环裁剪后消费端按序号续播） */
  fxSeq: number
  /** 结束标记：'me' = 我方胜（敌编队全灭）；'foe' = 我方结构归零，**或打满战斗上限判负**
   * （2026-09-10 船长定：超时不再按剩余血量比判胜——旧口径"平局算我方胜"已作废）；
   * null = 进行中 */
  ended: 'me' | 'foe' | null
  /** 连续作战保险（2026-09-08 船长定，仅巡回场次）：本场结构剩余低于该比例（相对满值结构，
   * 如 0.5 = 损失过半）→ 步进中自动中止并请求撤退（autoEscaped 置位）；非巡回战斗缺省不设 */
  hullEscapeFrac?: number
  /** 多波次（2026-09-09）：当前波索引（0 基；AnomalyDef.waves 缺省/单波不写，读档零迁移） */
  waveIdx?: number
  /** 多波次演出间隔（2026-09-09 船长反馈）：当前波全灭时刻（lastTick 口径），配合 waveEnterGapMs
   * 等爆炸/残骸演出播完再刷下一波（零迁移可选字段） */
  waveClearAt?: number
  /** 已触发撤离请求（步进中止，结构保留当前值；由远征结算走轻损撤退路径——绝不弃船）。
   *  三个来源：连续作战保险（结构损失过半）、**战斗超时判负**（2026-09-10 船长定）、
   *  **无法交战提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）。 */
  autoEscaped?: boolean;
  /** 撤离来源（配合 autoEscaped；缺省 = 'hull'，旧档零迁移）：
   *  'hull' = 结构损失过半自动撤退；'timeout' = 打满战斗上限（判负，按被迫撤退处理）；
   *  'cannot-engage' = **无法交战**（开战满 `bal.cannotEngageMs` 仍'我方一炮未发 + 距离在我方射程外 + 敌已开火'） */
  escapeReason?: 'hull' | 'timeout' | 'cannot-engage';
  /* ═══ 敌突进/冲锋（2026-09-10 船长定；**结束条件 2026-09-11 船长改判**）═══
   * 够不着时机动 ×2；**结束判据已改为「到达目标距离」**（敌方期望交距），冷却 20 秒。
   * 字段都是**可选、零迁移**；`cleanBattle` 白名单未收录（与 hullEscapeFrac 同待遇：
   * 战中重载会重置突进循环）。 */
  /** 当前是否处于突进中 */
  foeChargeOn?: boolean;
  /** ⚠ **已停用**（2026-09-11 改判：结束条件改'到达目标距离'，不再需要'进射程时刻 + 维持时长'）。
   *  旧档里可能留有该值，新码不再读写——保留字段声明只为不动存档形状。 */
  foeChargeEnteredAtMs?: number;
  /** 突进冷却结束时刻（战斗时钟口径） */
  foeChargeCdUntilMs?: number
  /** 船体维修装置运行态（2026-09-09 船长定；零迁移可选——旧档缺省 = 本场无维修装置介入）。
   * 与弹药预载同哲学：开战把货舱（仓库兜底）中的对应修理组件移入 kits 账本，战斗中不可补给；
   * 每 REPAIR_PULSE_MS 一次脉冲，各台未停机装置修复装甲/结构并扣 1 枚组件，耗尽即停机；
   * 战斗结束未用组件退回仓库（见 combat.refundRepairKits）。 */
  repair?: {
    /** 装置运行快照（开战按装配写入；组件耗尽自动停机 stopped = true） */
    units: BattleRepairUnit[]
    /** 预载组件账本（item id → 枚数；脉冲逐枚扣减；余额 0 = 该型装置停机） */
    kits: Record<string, number>
    /** 下一脉冲战斗时刻（开战 = startedAt + 间隔；全部停机后清空 = 停调度） */
    nextPulseAtMs?: number
    /** 累计脉冲次数（战报展示；痊愈空转的脉冲也计数） */
    pulses: number
    /** 累计消耗组件枚数 */
    kitsUsed: number
  }
  /* ═══ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制；零迁移可选） ═══ */
  /** 逐架生存池：键 = 我方武器条目下标（仅 src='drone' 的条目）；开战由 startBattleFor 写入。
   * 缺省 = 本次改动前已在进行的战斗（照旧打完，不折损） */
  dronePools?: Record<number, DronePoolEntry>;
  /** **敌机机群生存池**（2026-09-11 机群批）——键 = **敌单位 tag**，值 = 与该单位 `src:'drone'`
   *  武器条目**同序**的逐架池（每架一条）；三层血/抗性/回避取自机型表（`FoeDroneDef.defense`）。
   *  开战与每次换波由 `combat.initFoeDronePools` 重建。
   *  **缺省 = 本场没有敌机**（无 `FoeShipDef.drones` 的敌舰一律不建池）⇒ 既有战斗零行为变化。 */
  foeDronePools?: Record<string, DronePoolEntry[]>;
  /**
   * **反应式防空**（船长 2026-09-11：「**每轮都是被攻击后才开火**（敌方无人机只有靠近你
   * 你才能反击）」）——记录**最近一次无人机攻击**的战斗时钟（毫秒）：
   * · `me`  = **敌方无人机**打过我方舰的时刻 ⇒ **我方近防炮**据此进入反击窗口；
   * · `foe` = **我方无人机**打过敌舰的时刻 ⇒ **敌方近防炮**据此进入反击窗口。
   * 窗口 = `PD_REACTIVE_WINDOW_MS`（见 `combat.ts`）；**超窗即脱锁**，要等下一轮被打才再开火。
   */
  droneHitAt?: { me?: number; foe?: number };
  /** 本场已击落架数（机型 id → 架数）；结算时按此**永久扣除**无人机舱清单 */
  droneLost?: Record<string, number>
  /** 近防炮调度（当前波）：每舰判定冷却剩余毫秒（与敌编队同序）；缺省 = 无近防炮 */
  pdCd?: number[]
  /** 开战时的机群清单快照（机型 id → 架数；用于战后判定"机群战损过半"→ 停重复清剿） */
  droneLoadAtStart?: Record<string, number>
}

/** 机群战损结算结果（结构化，2026-09-11 船长「在战斗报告中显示」）：
 * 战报弹层据此展示两行——汇总（损坏/回收/净损失）+ 逐型明细（回收名单 ｜ 净损失名单）。
 * rows 按**机型基准价降序**（高价值在前，与"优先回收高价值"的观感一致）。 */
export interface DroneLossReport {
  /** 该场战斗起手时刻（与战报快照配对，避免并行战斗结果串场） */
  battleStartedAtGameMs: number
  /** 本场回收率（0~1） */
  rate: number
  /** 损坏合计架数 */
  total: number
  /** 回收归队合计架数 */
  recovered: number
  /** 净损失合计 = total − recovered */
  gone: number
  /** 逐型明细（按机型价值降序） */
  rows: Array<{ id: string; name: string; value: number; lost: number; back: number; gone: number }>
}

/** 单架无人机的战斗生存池（开战自机型 DroneDefense 写入；被点防打空即击落）
 * 装备模块阻力/回避随池携带——战斗跨会话续算不依赖当时的仓库/装配状态 */
export interface DronePoolEntry {
  s: number
  a: number
  h: number
  alive: boolean
  /** 机型 id（近防炮据此跳过哨戒机——2026-09-10 船长：近防炮不打哨戒无人机） */
  artId?: string
  /** 机型闪避（近防炮命中率 = balance.pdAcc − 本值） */
  evasion: number
  /** 机型三层抗性（近防炮伤害逐层消费用） */
  resists?: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
}

/** 船体维修装置单台运行快照（2026-09-09：开战写入，离线续算不依赖当前装配） */
export interface BattleRepairUnit {
  /** 装置模块 id（战报/UI 引用） */
  moduleId: string
  /** 本台每脉冲消耗的修理组件 id（民用级 = repairkit-civ；MK1/MK2 = repairkit-mil）；
   * **无消耗件（repairFree）不看本字段** */
  kitId: string
  /** 无消耗自愈（2026-09-10 船长：异形生体件）——脉冲不扣组件、永不停机 */
  free?: boolean
  /** 每脉冲修复装甲 HP（0 = 本台不修该层；满则额度转投另一层） */
  armorPerPulse: number
  /** 每脉冲修复结构 HP */
  hullPerPulse: number
  /** 组件耗尽自动停机（不再参与后续脉冲） */
  stopped: boolean
}

/* ═══════════════ V9：市场状态 ═══════════════ */

/** 单个商品的池与冲击状态 */
export interface MarketPoolState {
  /** 池库存（常驻商品；相对 poolTarget 影响订单价格与流量） */
  q: number
  /** 冲击动量（价格偏移比例，有符号、无叠加上限；随时间衰减） */
  shock: number
  /** 慢速均值回归噪声（价格偏移比例，缓慢随机游走并向 0 回归；让常驻行情即使无人交易也温和起伏） */
  noise: number
  /** 窗口内净成交量（正 = 玩家净买入；每个窗口结算后归零） */
  netVol: number
  /** 最近一次历史记录时刻（价格小史采样） */
  lastHistoryGameMs: number
}

/** NPC 订单簿单条 */
export interface NpcMarketOrder {
  price: number
  qty: number
  expiresAtGameMs: number
  /** P2 暗市单标记（2026-09-06）：闸内 rare 商品以低权重命中全局配额时刷出的 ×4 价订单；
   * 可绕过常驻声望拦截买入（外观同普通稀有单，玩家向隐身） */
  bm?: boolean
}

/** 内部消化队列（NPC 冲突订单随时间推进成交，不瞬消） */
export interface MarketDigestEntry {
  qty: number
  /** 平均内部成交价（无实际现金流，仅簿面演化用） */
  price: number
  /** 每窗口消化量（份数），qty 扣减至 0 移除 */
  perWindow: number
}

/** 市场（v9；商品目录与池初始化由引擎按 ctx 惰性完成） */
export interface MarketState {
  /** 商品池：good key -> 池/冲击状态 */
  pools: Record<string, MarketPoolState>
  /** NPC 需求簿：key -> 收购单数组（玩家卖出成交对象） */
  npcBuy: Record<string, NpcMarketOrder[]>
  /** NPC 供应簿：key -> 出售单数组（玩家买入成交对象） */
  npcSell: Record<string, NpcMarketOrder[]>
  /** 内部消化队列（随时间逐步成交的冲突订单） */
  digest: Record<string, MarketDigestEntry>
  /** 最近一次刷单/撮合的游戏时刻 */
  lastTickGameMs: number
  /** P2 抽取节拍（2026-09-06 船长定：rare/奇货出单每 RARE_DRAW_PERIOD_MS 一次）：
   * 上次"慢抽取"执行的游戏时刻；旧档缺省由 ensureMarket 按开盘时刻补齐（零迁移） */
  slowDrawLastGameMs?: number
  /** 我的挂单自增号 */
  orderSeq: number
  /** 价格小史（最近采样，展示趋势用） */
  priceHistory: Record<string, number[]>
}

/** 我的挂单（限价；side='sell' 卖出 / 'buy' 买入） */
export interface PlayerOrder {
  id: number
  side: 'sell' | 'buy'
  good: string
  price: number
  /** 剩余数量（原挂量 - 已成交） */
  qty: number
  filled: number
  placedAtGameMs: number
  /** 站内让利吸收补差结余（件，小数结转；2026-09-08 船长定：仅卖单使用，撤单即弃）。
   * 每窗：若该单吃簿量 < 基础吸收额×折价倍率 → 差额计入结余；整数部分由站内以挂单价吸收。
   * 吃簿量 ≥ 配额（簿厚）时只吃簿不站补；旧档缺省 = 0，零迁移 */
  absorbCredit?: number
  /** 本窗口内簿面成交件数（仅卖单；撮合前置 0，窗口结算后弃值——不序列化） */
  windowFilled?: number
}

/** 第九版存档结构（历史版本；v10 在其字段基础上只扩展了 fitted 槽位形状） */
export interface GameStateV9 extends Omit<GameStateV8, 'version' | 'blueprints'> {
  version: 9
  /** 市场状态（池/簿/冲击/内部消化/挂单） */
  market: MarketState
  /** 我的限价挂单 */
  orders: PlayerOrder[]
  /** 挂单锁仓：good key -> 数量（挂卖时预扣，成交交付/撤单退回） */
  escrowItems: Record<string, number>
  /** 挂卖中的舰船：订单 id -> 船快照（从 fleet 离队进 escrow，撤单原实例恢复；
   *  v17 起含 defId/customName，恢复时不丢船型与自定义名） */
  escrowShips: Record<number, { shipId: string; defId: string; durability: number; customName: string | null }>
  /** 已学会配方（蓝图消耗品：学会后可无限制造） */
  learnedRecipes: string[]
  /** 持有的蓝图书：蓝图 id -> 数量（可学习或挂卖） */
  blueprintStock: Record<string, number>
}

/** AI 副船任务：采矿（自动循环，满舱回港卸货入仓库后自动再出航） */
export interface AiMiningTask {
  kind: 'mining'
  beltId: string
  phase: 'mining' | 'returning' | 'outbound'
  /** 采掘循环累计（真实毫秒；循环周期已按核心效率拉长） */
  cycleAccMs: number
  /** 返航/出航累计（真实毫秒） */
  phaseAccMs: number
  tripUnits: number
  /** 富矿红利窗口剩余循环数（卷B2⑥，与主控 MiningState.rvLeft 同语义；每船独立；
   *  0/缺省 = 无窗口；换带/任务终止清零，自动循环返航卸货回原带保留） */
  rvLeft?: number
}

/** AI 副船任务：打捞（自动循环，2026-09-09 船长定：outbound → salvaging → returning → 同星系再出航，直到取消） */
export interface AiSalvageTask {
  kind: 'salvage'
  /** 目标星系 id（已探索；有敌群型号池） */
  galaxyId: string
  phase: 'outbound' | 'salvaging' | 'returning'
  /** 出航/返航腿累计（真实毫秒；已按核心效率拉长） */
  phaseAccMs: number
  /** 打捞统一推进步累计（真实毫秒；以最短打捞器周期为步） */
  cycleAccMs: number
  /** 各周期档打捞器相位账：周期 ms → 已累计 ms（真实毫秒） */
  deviceAccMs: Record<string, number>
  /** 本趟捞取体积当量累计（m³，展示用） */
  tripM3: number
}

/** AI 副船任务：远征（V12 两阶段：out → battle → back；AI 只接高胜率单，奖励全额） */
export interface AiExpeditionTask {
  kind: 'expedition'
  anomalyId: string
  /** 当前阶段结束时刻（真实毫秒；已按核心效率拉长） */
  finishAtGameMs: number
  /** 等效单程毫秒（已按效率折算，锁定时展示用） */
  outMs: number
  /** 出发时火力（锁定） */
  power: number
  /** 当前阶段（去程/交火/返航） */
  phase: 'out' | 'battle' | 'back'
  /** 实时战斗状态（phase='battle' 时非空；与主控共用 BattleState 形状） */
  battle: BattleState | null
}

/** AI 副船任务：前往指定星系掩护巡逻（占名额；out 去程 → stand 驻留；可取消召回） */
export interface AiStandbyTask {
  kind: 'standby'
  /** 目标星系 id（必须已探索） */
  galaxyId: string
  /** 去程到达时刻（真实毫秒；已按核心效率拉长） */
  finishAtGameMs: number
  /** 等效单程毫秒（已按效率折算，锁定时展示用） */
  outMs: number
  /** 当前阶段：去程 / 驻留 */
  phase: 'out' | 'stand'
}

/** AI 副船任务（采矿 / 打捞 / 远征 / 待命） */
export type AiTask = AiMiningTask | AiSalvageTask | AiExpeditionTask | AiStandbyTask

/** 一艘副船的 AI 指派（key = 副船 id，主控船不可被指派） */
export interface AiAssignment {
  coreType: AiCoreType
  /** 指派时刻（游戏内毫秒，展示用） */
  startedAtGameMs: number
  task: AiTask
}

/** 第七版存档结构（当前版本） */
export interface GameStateV7 {
  version: 7
  /** 游戏内累计时间（毫秒），只增不减 */
  gameMs: number
  /** 最近一次保存的墙钟时间（毫秒时间戳），用来算离线时长 */
  savedAtWallMs: number
  /** 日志最多保留条数 */
  logCap: number
  character: CharacterState
  rng: RngState
  skills: SkillsState
  wallet: WalletState
  /** 当前驾驶的舰船 id（必须是 fleet 的键） */
  shipId: string
  /** 舰队：每艘船独立 货仓/耐久/装备 */
  fleet: Record<string, FleetShipState>
  /** 物品仓库（无限容量、永不遗失；精炼产物与制造材料在此） */
  warehouse: WarehouseState
  /** 装备库（空间站库存：制造产物先入库，装配时取出；不随船丢失） */
  moduleBay: Record<string, number>
  /** 已购买的蓝图 id（一次购买，永久可造；不随船丢失） */
  blueprints: string[]
  /** AI 核心等级 0~5：自动周转许可与效率（未来多船自动执行的前置） */
  aiCoreLevel: number
  /** 采矿作业（自动循环状态机） */
  mining: MiningState
  /** 制造作业 */
  manufacturing: ManufacturingRunState
  /** 势力声望 */
  standings: Record<string, number>
  /** 远征作业 */
  expedition: ExpeditionState
  logs: LogEntry[]
}

/** 历史版本结构（仅供迁移参考，游戏不再直接使用） */
export interface GameStateV1 {
  version: 1
  gameMs: number
  savedAtWallMs: number
  logCap: number
  character: CharacterState
  rng: RngState
  skills: SkillsState
  logs: LogEntry[]
}

export type GameStateV2 = GameStateV1 & {
  version: 2
  wallet: WalletState
  shipId: string
  inventory: { items: Record<string, number> }
  mining: { active: boolean; beltId: string | null; cycleAccMs: number; tripUnits: number }
}

export type GameStateV3 = GameStateV2 & {
  version: 3
  moduleBay: Record<string, number>
  fitted: FittedModules
  blueprints: string[]
  manufacturing: { active: boolean; blueprintId: string | null; finishAtGameMs: number; durationMs: number }
}

export type GameStateV4 = GameStateV3 & {
  version: 4
  standings: Record<string, number>
  expedition: {
    active: boolean
    anomalyId: string | null
    finishAtGameMs: number
    durationMs: number
    outMs: number
    combatMs: number
    power: number
  }
}

export type GameStateV5 = GameStateV4 & { version: 5 }

export type GameStateV6 = GameStateV5 & {
  shipBay: string[]
}

/** 第八版存档结构（当前版本）：v7 之上 AI 核心库与副船任务（废除 aiCoreLevel） */
export interface GameStateV8 extends Omit<GameStateV7, 'version' | 'aiCoreLevel'> {
  version: 8
  /** AI 核心库：类型 -> 持有数量（空间站资产，不随船丢失） */
  aiCores: Record<string, number>
  /** AI 副船指派：副船 id -> 任务（主控船不在此） */
  aiAssignments: Record<string, AiAssignment>
}

/** 第十版存档结构：v10 = v9 + 六槽位模型（fitted 形状扩展，字段同 v9） */
export type GameStateV10 = Omit<GameStateV9, 'version'> & { version: 10 }

/** 随机事件状态（v11）：下一次随机事件的触发时刻（到达式随机间隔 10~30 分钟） */
export interface EventsState {
  /** 下次事件触发时刻（游戏内毫秒）；0 = 未播种，首次推进时初始化 */
  nextAtGameMs: number
}

/** 第十一版存档结构（历史版本；v11 = v10 + 随机事件系统 events） */
export type GameStateV11 = Omit<GameStateV10, 'version'> & {
  version: 11
  events: EventsState
}

/** 扫描探索作业状态（V13：就地深空扫描，去程已取消；窗口完成 → 点亮 + 自动返航（2026-09-06），
 * 不再停留。返回段 scanning 保持 active（returning=true）表达"船在忙"，到港后清空。
 * originGalaxy（T8 兼容字段）：本次扫描出发星系（null = 空间站/母港；用于终止后折返基准） */
export interface ScanningState {
  active: boolean
  /** 目标星系 id（扫描对象永远是"已探索星系的一跳邻居"，即星图剪影） */
  galaxyId: string | null
  /** 当前段完成的游戏内时刻（毫秒，出发时锁定；returning 段 = 到港时刻） */
  finishAtGameMs: number
  /** 当前段开始时刻（毫秒；窗口段 = 出发时刻，returning 段 = 窗口完成时刻） */
  startedAtGameMs: number
  /** T8：本次扫描的出发星系（null = 空间站/母港） */
  originGalaxy: string | null
  /** 2026-09-06 兼容字段：窗口已完成、正在自动返航（2×单程 目标↔母港；不可终止） */
  returning?: boolean
}

/** 第十二版存档结构（历史版本）：v12 = v11 + 实时战斗（远征两阶段 phase/battle 落档） */
export type GameStateV12 = Omit<GameStateV11, 'version'> & { version: 12 }

/** 第十三版存档结构（历史版本）：v13 = v12 + 星图探索（exploredGalaxies + scanning 扫描探索作业） */
export type GameStateV13 = Omit<GameStateV12, 'version'> & {
  version: 13
  /** 已探索星系 id 集（初始 = [母港]；星图迷雾按它推导可见/剪影） */
  exploredGalaxies: string[]
  /** 扫描探索作业（对剪影星系获取完整情报） */
  scanning: ScanningState
}

/** 第十四版存档结构（历史版本）：v14 = v13 + 扫描续扫进度（终止探索时保存就地扫描窗口完成毫秒） */
export type GameStateV14 = Omit<GameStateV13, 'version'> & {
  version: 14
  /** 各星系已完成的就地扫描窗口毫秒（< SCAN_WINDOW_MS；下次扫描该星系只补扫剩余窗口） */
  scanProgress: Record<string, number>
}

/** 第十五版存档结构（历史版本）：v15 = v14 + 调试模式（debugQuick：开发工具，所有作业按 1 秒完成）
 * 附带兼容字段 completedBounties（v15.1，无版本号：声望仅首胜发放，normalize 补默认） */
export type GameStateV15 = Omit<GameStateV14, 'version'> & {
  version: 15
  /** 开发调试：进行中作业剩余时长一律按 1 秒完成（正常玩家恒为 false，不影响数值与确定性） */
  debugQuick: boolean
  /** 已首胜（领取过声望）的悬赏目标 id 清单：重复完成不再获得声望，防低威胁目标被无限白刷声望 */
  completedBounties: string[]
}

/** 第十六版存档结构（当前版本）：v16 = v15 + 矿带空间分层与复合产出池（三种矿石删除的折算迁移，无新字段）
 * 附带兼容字段（v16.1，无版本号，normalize 补默认）：
 * - shipReturns：T4 换船善后返航账本；
 * - shipLocks：T5 船只锁定；
 * - T8：awayGalaxy 野外停留 / transit 返航空间站行程 / bountyCooldowns / autoLoopAnomalyId；
 * - T9：stationSites 建站进度 / dockedSite 停靠副站 / dialogueSeen 剧本已读 / pendingDialogue 待播通讯
 * - 2026-09-10：marks 玩家标记（收藏）四类 id 清单（老档缺省 = 全空） */
export type GameStateV16 = Omit<GameStateV15, 'version'> & {
  version: 16
  /** T4 换驾驶善后：自动返航的旧船：船 id -> 返航记录（到港自动卸货后移除） */
  shipReturns: Record<string, ShipReturnState>
  /** T5 锁定防误售的船：船 id -> true（舰队页可随时解锁） */
  shipLocks: Record<string, boolean>
  /** T8 舰船野外停留：所在星系 id（null = 停靠空间站） */
  awayGalaxy: string | null
  /** T8 显式"返航空间站"行程（野外 → 站） */
  transit: ShipTransitState
  /** T8 悬赏重复冷却：悬赏 id -> 冷却结束的游戏内时刻 */
  bountyCooldowns: Record<string, number>
  /** T8 重复清剿：当前自动循环的悬赏 id（null = 关闭） */
  autoLoopAnomalyId: string | null
  /** T9 建站进度：站点 id -> 进度（档位 stage 从 0 起；delivered 已缴物品单位） */
  stationSites: Record<string, StationSiteProgress>
  /** T9 当前停靠的副站 id（null = 母港；awayGalaxy=null 且有值时表示停副站） */
  dockedSite: string | null
  /** 2026-09-09 长途运输（两座已建成站点间真实航程往返循环；虚拟货物占满货仓、不产生真实物品） */
  hauling: HaulingState
  /** T9 通讯剧本已读标记：剧本 id -> true */
  dialogueSeen: Record<string, boolean>
  /** T9 待自动播放的通讯剧本 id（首次抵达等触发；null = 无） */
  pendingDialogue: string | null
  /**
   * 2026-09-11 通讯（收件箱）：消息 id -> 送达时的游戏内毫秒。
   * 键包含两类来源：`COMMS_MESSAGES` 的数据消息（`msg-*`）与镜像进来的剧本（`dlg:<剧本 id>`）。
   * 送达即记账 ⇒ 触发器重复判定不会重复送（幂等）；可选字段、零迁移。
   */
  commsDelivered?: Record<string, number>
  /** 2026-09-11 通讯：消息 id -> 已读（只记 true；缺失 = 未读） */
  commsRead?: Record<string, boolean>
  /**
   * 2026-09-08 交付循环系统提示（一次性：渲染层读到即清并弹窗；可选字段、零迁移，
   * 不落档——重启后由新触发的终点重新写入）
   */
  deliveryNotice?: string | null
  /**
   * 2026-09-10 重复清剿停环一次性提示（船长定：除事件日志外，玩家在线时弹窗告知）：
   * 文案自带当前 装甲/结构 百分比，便于玩家判断停在哪一层；同 deliveryNotice 模式——
   * 引擎写入 → 心跳读取即清并 toast（不落档、零迁移）
   */
  autoLoopStopNotice?: string | null
  /**
   * 2026-09-10 机群战损一次性提示（船长定「无人机可被击落」+ 永久损失制）：
   * 战斗结算扣掉被击落的无人机后写入（含机型与架数），心跳读取即清并 toast——
   * 同 deliveryNotice 模式（不落档、零迁移）
   */
  droneLossNotice?: string | null
  /**
   * 2026-09-11 船长：「在战斗报告中显示」——机群战损的**结构化**结算结果（谁回收了、谁净损失），
   * 战报弹层读取后展示两行明细（汇总 + 逐型）；同 droneLossNotice 模式：**不落档、零迁移**，
   * 且只在**当前驾驶船**的结算里写入（AI 副船的损失不进战报，避免串场）
   */
  droneLossReport?: DroneLossReport | null
  /**
   * 2026-09-10 玩家标记（收藏）：四类界面各自一份 id 清单，被标记项在**默认排序**下置顶
   * （2026-09-10 船长定：舰队等有排序下拉的列表只在「默认排序」生效）。
   * 兼容字段、零迁移、不升版本号：老档缺省 = 四类全空，由 normalizeState 补默认并剪枝。
   */
  marks: MarksState
}

/** 玩家标记（收藏）四类界面：market 市场商品行 / refine 精炼炉与残骸回收卡 /
 *  blueprint 组装机蓝图卡 / ship 舰队船卡（按船实例，同型多艘各自独立） */
export interface MarksState {
  /** 市场商品 key（ctx.marketGoods 键） */
  goods: string[]
  /** 可精炼资源 / 可回收残骸的物品 id（ctx.items 键） */
  recipes: string[]
  /** 蓝图 id（装备/弹药蓝图 + 舰船蓝图） */
  blueprints: string[]
  /** 舰队船实例 id（state.fleet 键） */
  ships: string[]
}

/** 空标记表（每类一份空清单；注意取新对象，勿共享可变数组） */
export function emptyMarks(): MarksState {
  return { goods: [], recipes: [], blueprints: [], ships: [] }
}

/** 长途运输状态（2026-09-09 船长定稿：任意两座已建成站点间真实航程往返循环；当日改：接单不要求停在端点，
 * 先"就位航段"驶往较近端点，再按所选航线两端点循环） */
export interface HaulingState {
  active: boolean
  /** 玩家所选航线的两个端点（null = 母港；否则为已建成副站 id）——循环只在这两点间往返 */
  routeA: string | null
  routeB: string | null
  /** 当前航段的起点站点 id（就位段 = 接单时的停靠站；其后 = 上一段到站） */
  fromSiteId: string | null
  /** 当前航段的目的站点 id */
  toSiteId: string | null
  /** 本段标称航程分钟（出发时锁定；报酬结算按它 = 货仓容量×费率×分钟） */
  legMinutes: number
  /** 本段真实航程毫秒（出发时锁定；吃航行技能与调试 1 秒快进） */
  legMs: number
  /** 本段已航行毫秒 */
  phaseAccMs: number
}

/** 空态默认值 */
export const EMPTY_HAULING: HaulingState = {
  active: false,
  routeA: null,
  routeB: null,
  fromSiteId: null,
  toSiteId: null,
  legMinutes: 0,
  legMs: 0,
  phaseAccMs: 0,
}

/** T9 一个建站点的建造进度 */
export interface StationSiteProgress {
  /** 已完成的档位数（0/1/2/3；3 = 建成并入空间站清单） */
  stage: number
  /** 当前档已缴（按逐档材料单项累计；升档清零重计，2026-09-09） */
  delivered: Record<string, number>
}

/** B1 低安遭遇（v17.1 兼容字段）：一次"伏击/巡逻"事件（进行中/待决/战斗中） */
export interface EncounterState {
  /** 是否有未了结的遭遇 */
  active: boolean
  /** 承担这艘船的 uid（主控或副船） */
  shipId: string | null
  /** 事发星系（sec<0） */
  galaxyId: string | null
  /** 事件展示名（伏击敌群名；旧档兜底 = 文案池名） */
  name: string
  /** 遭遇强度（2026-09-09 船长定：= 当地星系可见悬赏敌群的威胁，随机抽池；不再随船火力缩放） */
  threat: number
  /** 伏击敌群 = 当地星系可见悬赏敌群 id（2026-09-09；null = 旧档遗留，按威胁就近兜底） */
  anomalyId: string | null
  /** 来源说明：主控采掘/打捞/扫描/驻留 或 副船任务（2026-09-06：移动不暴露） */
  origin: string
  /** 产生时刻（游戏毫秒） */
  invitedAtGameMs: number
  /** 在线邀约超时时刻（超过即自动按文字结算） */
  deadlineGameMs: number
  /** 玩家应战后的实时战斗（null = 未开打） */
  battle: BattleState | null
}

/** B3 星系残骸记录（2026-09-05；密度模型见 docs/design/b3-salvage.md）：
 * density = 当前残骸密度（无记录 = 基础密度，由 security 推导不入档）；
 * rare = 稀有残骸计数（2026-09-10 启用：赏金任务窝点战利品，打捞必出 → 精炼炉开"高级箱"）。 */
export interface WreckGalaxyRecord {
  density: number
  rare: number
  /** 稀有残骸按敌群记账（敌群 id → 存量件数）：窝点战利品继承该敌群的回收特色池与专属装备；
   *  老档缺省 = 无（只认 rare 总数，不产出稀有件，避免张冠李戴） */
  rareBy?: Record<string, number>
}

/** 第十八版存档结构（当前版本）：v18 = v17 + V18 槽位制（fitted 六槽 Record →
 * 高/中/低三类位数组，复数安装；装备 rack 归槽；存档迁移 17→18 原位映射后由
 * repair 链与船布局对齐）。v17 时代全部字段保留（fleet 实例化 defId/customName、
 * B1 低安遭遇、B1.5 待命、refineRun 等）。 */
export type GameStateV18 = Omit<GameStateV16, 'version'> & {
  version: 18
  /** B1 低安遭遇（进行中/待决/战斗中；无 = inactive 空对象） */
  encounter: EncounterState
  /** B1：是否已提示过"进入低安"（首次进低安弹提示 + 手册留档） */
  lowSecNotified: boolean
  /** B1：星系 id → 该星系遭遇冷却结束时刻（区域事件不叠加） */
  encounterZoneCooldown: Record<string, number>
  /** B1：星系 id → 我方在该星系"连续在场起始时刻"（5 分钟入场缓冲计时；运行时维护） */
  lowSecPresence: Record<string, number>
  /** B1.5：主控主动"前往星系待命"（去程；到点转 awayGalaxy 野外停留） */
  standby: StandbyState
  /** 精炼炉运转（2026-09-04 工业细化：单工位循环运转；兼容字段无版本号，旧档载入 = 空态） */
  refineRun: RefineRunState
  /** B3 打捞作业（采矿式自动循环，2026-09-09 起默认循环；autoCycle/stopAfterTrip 偏好字段零迁移，旧档载入 = 空态） */
  salvaging: SalvageOpState
  /** B3 星系残骸密度（2026-09-05：兼容字段无版本号；星系 → 密度记录，无记录 = 基础密度） */
  galaxyWrecks: Record<string, WreckGalaxyRecord>
  /**
   * **已开过高级箱的稀有残骸存量**（2026-09-11 船长定「一件 = 一箱」的第二道锁；
   * 键 = 稀有残骸物品 id，值 = m³）——高级箱按**件**结算而不是按"炉"结算：
   * 某件残骸开过箱后，它剩下的料（停炉退还的那部分）仍能继续精炼出矿物，但**不再产箱**；
   * 起炉时"可开箱资格" = 该型残骸存量 − 本表数量 ≥ 一件体积（30 m³）。
   * 缺省 = 无记录（老档天然如此 → 零迁移、兼容字段无版本号）。
   */
  rareOpenedUnits: Record<string, number>
  /**
   * 该型稀有残骸**累计已开箱数**（2026-09-11 船长定「按照每次少 30 立方，自动烧」）：
   * 与 `rareBurnUnits` 配对使用——**允许的箱数 = ⌊累计已烧体积 ÷ 一个回收单元(30 m³)⌋**，
   * 于是同一批料无论怎么"停炉再起"都刷不出额外的箱（全局单调，不受单炉起停影响）。
   * 缺省 = 无记录（老档天然如此 → 零迁移）。
   */
  rareBoxesOpened: Record<string, number>
  /** 该型稀有残骸**累计已烧体积**（m³；同上，与 `rareBoxesOpened` 配对） */
  rareBurnUnits: Record<string, number>
}

/** 对外统一称呼：当前版本状态（v24 = v23 + 任务中心·时效任务板 sideTasks） */
export type GameState = GameStateV24

/** 第十九版存档结构：v19 = v18 的"精炼炉多工位并行"（2026-09-05 船长拍板：
 * 主控亲自运转限 1 台，其余资源/残骸可各由一枚闲置 AI 核心驱动；refineRun 单例改
 * refineRuns 数组，数组内至多一个 worker='pilot'，itemId 全局唯一）。 */
export type GameStateV19 = Omit<GameStateV18, 'version' | 'refineRun'> & {
  version: 19
  /** 精炼炉运转工位表（v19 多工位；每元素一台炉：资源/残骸 + 劳动者） */
  refineRuns: RefineRunState[]
}

/** 第二十版存档结构（当前版本）：v20 = v19 去掉 RefineRunState.lockedQty（2026-09-05 船长拍板：
 * 同资源允许多单位同时运转，原料不预锁定、每批到点实时扣取仓库余量——在炉锁定料于
 * 19→20 迁移时全额退回仓库）；每台炉带稳定 id（refineSeq 递增分配）。 */
export type GameStateV20 = Omit<GameStateV19, 'version'> & {
  version: 20
  /** 精炼炉运转工位表（v20：同资源可多台；原料不锁定） */
  refineRuns: RefineRunState[]
  /** 精炼炉台号自增分配器（新台启动时取用并 +1） */
  refineSeq: number
}

/** 第二十一版存档结构：v21 = v20 + 蓝图制造多工位并行（2026-09-05 船长拍板：
 * 多张蓝图可同时制造、逐线独立进度与取消；manufacturing 单例 → manufacturingRuns 数组 +
 * manufacturingSeq 线号分配器；不同蓝图不限；2026-09-08 起同蓝图也可开多条线（与精炼炉多炉并线一致）；
 * 2026-09-08 起制造带劳动者（与精炼炉同款机制：主控亲自 1 条占主控 / AI 核心每线一枚，见 ManufacturingRunState）。 */
export type GameStateV21 = Omit<GameStateV20, 'version' | 'manufacturing'> & {
  version: 21
  /** 制造作业线表（v21 多工位；每元素一条线） */
  manufacturingRuns: ManufacturingRunState[]
  /** 制造线号自增分配器 */
  manufacturingSeq: number
}

/** 第二十二版存档结构（当前版本）：v22 = v21 + 承伤持久化（2026-09-05 船长拍板：
 * 护盾场间重置 + 战中被动回充；装甲损伤（fleetShip.armorPct，缺省 1）跨场保留；
 * 结构层与耐久合并为同一属性（战斗中结构受损即扣 durability，跨场保留），
 * 两者仅港内付费维修/修理套件恢复；v21→v22 迁移只补 armorPct 默认值，无结构变化）。 */
export type GameStateV22 = Omit<GameStateV21, 'version'> & {
  version: 22
}

/** 序章/新手引导进度（2026-09-05 序章·苏醒：-1 = 未开始（老档/跳过），0..N = 教程进行中，99 = 已完成） */
export interface OnboardingState {
  step: number
  /** 出售教学（步骤 3）：交付完成时的钱包 ISK 基线——此后钱包超过基线（卖出矿石得款）才达标推进。
   * 用钱包而非仓库余量判定：装船/挪货不动钱包，不会误推进（2026-09-08 船长确认 BUG 修复；零迁移可选字段） */
  sellIskBaseline?: number
}

/** 重要任务状态（任务中心「重要任务」分类；key = 数据目录任务 id） */
export interface ImportantTaskState {
  done: boolean
  /** 可交付任务的累计已交数量（按任务 id 语义使用） */
  delivered?: number
  /** 「寻找人类」阶段目标：已探索全部星系（里程碑只记一次；2026-09-10 船长定） */
  allExplored?: boolean
}

/** 第二十三版存档结构（历史版本）：v23 = v22 + 序章·苏醒（2026-09-05 船长拍板：
 * onboarding 教程进度（老档迁移为 -1 = 不触发）与重要任务状态（importantTasks）。
 * 新档默认调整随 createInitialState：零初始资金、默认驾驶鲣鱼带 80% 损伤、装备库/仓库
 * 不再预置炮台与弹药（炮台与弹药改由教学战斗任务奖励）。v22→v23 迁移只补默认字段，无结构变化。 */
export type GameStateV23 = Omit<GameStateV22, 'version'> & {
  version: 23
  onboarding: OnboardingState
  importantTasks: Record<string, ImportantTaskState>
}

/** 任务中心·时效任务一条（资源/快递；随 20 分钟补给周期整板刷新，任务只存活一轮） */
export interface SideTask {
  /** 稳定 id（state.sideTasks.seq 分配；UI 作 key、完成时定位） */
  id: number
  /** 任务族：resource 资源任务 / courier 快递任务 / bounty 赏金任务（打掉指定星系的高难窝点）
   *  / faction 敌对派系活跃（当天选中星系的**常驻悬赏**加成，逐日重选、不因打赢而下板） */
  kind: 'resource' | 'courier' | 'bounty' | 'faction'
  /** 目标物品的市场商品 key（ctx.marketGoods 键；刷出时锁定的报价来源） */
  goodKey: string
  /** 目标物品 refId（state.warehouse.items 按它计数、出发/完成时扣取） */
  refId: string
  /** 需交付单位数（物品仓库持有 ≥ 该值方可出发/完成；刷出时锁定） */
  need: number
  /** 完成奖励 ISK（刷出时按当时收购价锚定取整到整百锁定；不给声望） */
  rewardIsk: number
  /** 快递目标副站 id（kind='courier' 刷出时绑定；老档缺省时出发按"最近已建成副站"兜底解析） */
  stationId?: string
  /** 快递目标副站所在星系 id（kind='courier' 刷出时绑定）；赏金任务 = 窝点所在星系 */
  galaxyId?: string
  /** 赏金任务：目标主题悬赏 id（窝点由它派生；kind='bounty' 时非空） */
  anomalyId?: string
  /** 赏金任务：窝点档位（刷出时按当时声望定格；1 外围 / 2 核心 / 3 深层） */
  lairTier?: 1 | 2 | 3
  /** 赏金任务：窝点显示名（刷出时定格——含核心词与档位称呼，供界面与日志直显） */
  lairName?: string
  /** 派系活跃：目标星系的**常驻悬赏**名（界面直显；该星系当日所有可见悬赏都吃 +10% 加成） */
  factionAnomalyName?: string
}

/**
 * 快递投送在途（2026-09-06 船长拍板：真实航行投送——主控"去程取消"的快递专项例外）。
 * 出发投送即把 need 从物品仓库锁定扣出并转入本挂账；到站（gameMs ≥ arriveAtGameMs）由引擎
 * 自动结算（奖励入账、任务下板、本挂账清空）。同一时刻只允许一笔投送（null = 无）。
 * 兼容字段（v24 无版本号变化）：老档缺省 null，normalize 补默认。
 */
export interface CourierDeliveryState {
  /** 所投送任务的稳定 id（整板刷新把原任务换下后，到站仍按原任务 id 结算） */
  taskId: number
  /** 目标物品的市场商品 key（出发时复制） */
  goodKey: string
  /** 目标物品 refId */
  refId: string
  /** 在途投送单位数（出发时已从仓库锁定扣出；到站不再扣） */
  need: number
  /** 目标副站 id（出发时校验仍在建成状态） */
  stationId: string
  /** 目标副站所在星系 id */
  galaxyId: string
  /** 出发时刻（游戏内毫秒） */
  departAtGameMs: number
  /** 预计到站时刻（游戏内毫秒 = 出发时刻 + 真实航程 travelLegMs） */
  arriveAtGameMs: number
  /** 刷出时锁定的酬金（整板刷新后到站仍按此结算） */
  rewardIsk: number
}

/** 任务中心·时效任务板（v24：资源/快递定时任务；2026-09-05 船长拍板，2026-09-06 修订节奏：
 * 与市场「补给刷新」周期 orderLifeMs.common（20 分钟）同节奏整板刷新——每个 20 分钟整点旧任务
 * 全部过期清空、重刷 2 条资源任务（快递在已建成副空间站后同刷 2 条）；每条任务只存活一轮
 * （window → window + 20 分钟）；离线大步长只按"末窗"结算一次刷新与其市场影响。
 * v24 兼容字段（无版本号）：courier 任务绑定 stationId/galaxyId、deliver 在途投送挂账——
 * 老档读入 normalize 缺省 null/缺省时按"最近已建成副站"兜底）。 */
export interface SideTasksState {
  /** 任务 id 自增分配器（新任务取用后 +1；读档兜底 ≥ 现存任务最大 id +1） */
  seq: number
  /** 本板任务所属轮次的起点整点（游戏内毫秒 = 20 分钟格点；0 = 未开盘）；
   *  下一 20 分钟整点 window + orderLifeMs.common 到点时整板过期替换 */
  window: number
  /** 资源任务（当前轮，至多 2 条） */
  resource: SideTask[]
  /** 快递任务（当前轮；副站建成解锁后才刷，至多 2 条） */
  courier: SideTask[]
  /** 赏金任务（**当日板**；2026-09-10 船长定：每天 2 张高难窝点，24 小时一轮、
   *  **每天本地 0 点整板替换**，与资源/快递的 20 分钟板彼此独立；老档缺省 = 空数组，零迁移） */
  bounty: SideTask[]
  /** 敌对派系活跃（2026-09-10 船长定：每天一个中安/低安星系，该星系**常驻悬赏** +10% 奖金/+10% 威胁、
   *  胜利有概率掉稀有残骸；逐日重选、打赢不下板 → 当天可反复刷；老档缺省 null） */
  faction: SideTask | null
  /** 赏金板日界（本地 0 点的墙钟毫秒；0 = 未开板）——下一日界到点时整板替换。
   *  兼容字段（无版本号变化）：老档缺省 0，首次拿到有效墙钟即开板。 */
  bountyWindow: number
  /** 快递投送在途挂账（一次一笔；null = 无）。整板刷新不清除在途投送，到站仍按原任务结算 */
  deliver: CourierDeliveryState | null
}

/** 第二十四版存档结构（当前版本）：v24 = v23 + 任务中心·时效任务板 sideTasks
 * （2026-09-05 船长拍板：资源/快递定时任务；2026-09-06 节奏改为市场补给周期 orderLifeMs.common
 * 20 分钟一轮整板刷新；快递真实航行投送——SideTask 绑定 stationId/galaxyId + sideTasks.deliver
 * 在途挂账为兼容字段，无版本号变化，老档 normalize 补 null/兜底解析）；
 * 新档/老档统一迁移补空板默认值，字段纯新增无结构变化。 */
export type GameStateV24 = Omit<GameStateV23, 'version'> & {
  version: 24
  sideTasks: SideTasksState
  /**
   * 组装机「循环制造」卡片级配置（2026-09-10 船长定：开关/目标件数从逐条制造线上移到整张生产卡；
   * 兼容字段、无版本号变化——缺省 {} = 全部不循环，老档的逐线字段在读档时归并到这里，
   * 之后引擎只读写本字段）。key = 蓝图 id，见 ManufacturingLoopState。
   */
  manufacturingLoops: Record<string, ManufacturingLoopState>
}

/** 向状态里追加一条日志（自动编号、自动裁剪超出 logCap 的旧日志） */
export function addLog(state: GameState, kind: LogKind, text: string): void {
  const lastId = state.logs.length > 0 ? state.logs[state.logs.length - 1]!.id : 0
  state.logs.push({ id: lastId + 1, atGameMs: state.gameMs, kind, text })
  const cap = state.logCap > 0 ? state.logCap : DEFAULT_LOG_CAP
  if (state.logs.length > cap) {
    state.logs.splice(0, state.logs.length - cap)
  }
}

/**
 * 创建一份全新的初始存档。
 * - 默认（经典开局，测试/模拟基准）：10,000 ISK、沙猫矿艇默认驾驶、机库另有鲣鱼、
 *   装备库 1×轻型炮台 MK1、仓库三型弹各 60（历史行为，测试大量依赖）；
 * - prologue:true（序章·苏醒 2026-09-05 船长拍板，真实新游戏入口用）：
 *   零初始资金、默认驾驶=鲣鱼（装甲/耐久 80% 供维修教学）、沙猫同在机库、
 *   装备库/仓库无预置炮台弹药（改由教学战斗任务奖励）。
 */
export function createInitialState(opts?: {
  name?: string
  seed?: number
  nowWallMs?: number
  prologue?: boolean
}): GameStateV24 {
  const prologue = opts?.prologue === true
  const nowWall = opts?.nowWallMs ?? Date.now()
  const state: GameStateV24 = {
    version: 24,
    gameMs: 0,
    savedAtWallMs: nowWall,
    logCap: DEFAULT_LOG_CAP,
    character: {
      name: opts?.name ?? DEFAULT_PILOT_NAME,
      startedAtWallMs: nowWall,
    },
    rng: {
      seed: opts?.seed ?? (((nowWall >>> 0) ^ 0x51ab3e7d) >>> 0),
      count: 0,
    },
    skills: {
      trained: {},
      queue: [],
      savedProgress: {},
    },
    wallet: { isk: prologue ? 0 : DEFAULT_START_ISK },
    shipId: prologue ? 'sh-falconet' : DEFAULT_START_SHIP_ID,
    fleet: prologue
      ? {
          // 鲣鱼级护卫舰：默认驾驶，带 80% 装甲/耐久损伤（重要任务奖金→港内维修教学闭环，母港维修费 ≈1,584 ISK）
          'sh-falconet': {
            defId: 'sh-falconet',
            customName: null,
            durability: 0.8,
            armorPct: 0.8,
            cargo: {},
            fitted: emptyFitted(),
          },
          // 沙猫级采矿艇同在机库（S1 教学：切换驾驶到矿船再出击采矿）
          sandcat: {
            defId: 'sandcat',
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
        }
      : {
          [DEFAULT_START_SHIP_ID]: {
            defId: DEFAULT_START_SHIP_ID,
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
          // 经典开局同历史：机库另有鲣鱼武装艇待命
          'sh-falconet': {
            defId: 'sh-falconet',
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
        },
    warehouse: {
      items: prologue
        ? {
            // 序章·苏醒：仓库不预置弹药——动能弹 120 由教学战斗任务（演习场驱逐令）奖励
          }
        : {
            // 经典开局：三型通用弹药各 60 发
            'ammo-kinetic-l': 60,
            'ammo-explosive-l': 60,
            'ammo-plasma-l': 60,
          },
    },
    moduleBay: prologue
      ? {
          // 序章·苏醒：装备库不预置炮台——轻型炮台 MK1 由教学战斗任务奖励
        }
      : {
          // 经典开局：轻型炮台（动能）MK1 一件
          'mod-turret-kin-1': 1,
        },
    aiCores: { basic: 0, gamma: 0, beta: 0, alpha: 0 },
    aiAssignments: {},
    shipReturns: {},
    shipLocks: {},
    marks: emptyMarks(),
    market: {
      pools: {},
      npcBuy: {},
      npcSell: {},
      digest: {},
      lastTickGameMs: 0,
      orderSeq: 0,
      priceHistory: {},
    },
    orders: [],
    escrowItems: {},
    escrowShips: {},
    learnedRecipes: [],
    blueprintStock: {},
    events: { nextAtGameMs: 0 },
    mining: {
      active: false,
      beltId: null,
      phase: 'mining',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 0,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
      rvLeft: 0,
    },
    manufacturingRuns: [],
    manufacturingSeq: 1,
    manufacturingLoops: {},
    standings: {},
    expedition: {
      active: false,
      anomalyId: null,
      finishAtGameMs: 0,
      durationMs: 0,
      outMs: 0,
      combatMs: 0,
      power: 0,
      eventId: null,
      eventFired: false,
      phase: 'out',
      battle: null,
    },
    exploredGalaxies: [HOME_GALAXY_ID],
    scanning: { active: false, galaxyId: null, finishAtGameMs: 0, startedAtGameMs: 0, originGalaxy: null, returning: false },
    scanProgress: {},
    awayGalaxy: null,
    transit: { active: false, fromGalaxy: null, toGalaxy: null, finishAtGameMs: 0, legMs: 0, delivery: null },
    bountyCooldowns: {},
    autoLoopAnomalyId: null,
    stationSites: {},
    dockedSite: null,
    hauling: { ...EMPTY_HAULING },
    dialogueSeen: {},
    pendingDialogue: null,
    commsDelivered: {}, // 2026-09-11 通讯收件箱：送达记账（可选字段、零迁移）
    commsRead: {},
    debugQuick: false,
    completedBounties: [],
    encounter: {
      active: false,
      shipId: null,
      galaxyId: null,
      name: '',
      threat: 0,
      anomalyId: null,
      origin: '',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle: null,
    },
    lowSecNotified: false,
    encounterZoneCooldown: {},
    lowSecPresence: {},
    standby: { active: false, galaxyId: null, finishAtGameMs: 0, legMs: 0 },
    refineRuns: [],
    refineSeq: 1,
    salvaging: { ...EMPTY_SALVAGE_OP },
    galaxyWrecks: {},
    rareOpenedUnits: {}, // 已开过高级箱的稀有残骸存量（m³；2026-09-11「一件 = 一箱」第二道锁）
    rareBoxesOpened: {}, // 该型残骸累计已开箱数（与 rareBurnUnits 配对：允许箱数 = ⌊累计已烧/30⌋）
    rareBurnUnits: {}, // 该型残骸累计已烧体积（m³）
    onboarding: { step: prologue ? 0 : -1 }, // 序章·苏醒：prologue 新档 step 0（待界面开始序章演出），老档/经典 = -1
    importantTasks: {},
    sideTasks: { seq: 1, window: 0, resource: [], courier: [], bounty: [], faction: null, bountyWindow: 0, deliver: null }, // v24：任务中心·时效任务板（资源/快递 20 分钟整点开刷；赏金每天本地 0 点开板；faction = 当日派系活跃；deliver = 快递投送在途挂账，缺省 null）
    logs: [],
  }
  if (prologue) {
    addLog(state, 'system', '舰载系统苏醒：隐秘泊位·母港。')
    addLog(state, 'warn', '自检异常：船体装甲/结构受损（80%），乘员生命信号——无。记忆档案损坏。')
    addLog(state, 'info', '初始资金 0 ISK：一切从采集第一舱矿石开始。鲣鱼级护卫舰（待修）与沙猫级采矿艇同在机库；装备库与弹药库为空——首门炮台与弹药将在完成协会试炼后解锁。')
  } else {
    addLog(state, 'system', '欢迎加入「大鲸鱼深空工业」。')
    addLog(state, 'info', `初始资金 ${DEFAULT_START_ISK} ISK 已到账；沙猫级采矿艇已停靠机库，另有鲣鱼级护卫舰待命（装备库含轻型炮台 MK1，仓库配三型通用弹各 60 发，可直接体验远征战斗）。`)
  }
  addLog(state, 'info', '星图迷雾已开启：母港已探明，周边星系等待扫描探索——去悬赏列表接任务，或对星图上的「未知信号」执行扫描。')
  return state
}
