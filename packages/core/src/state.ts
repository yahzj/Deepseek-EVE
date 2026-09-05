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

import type { AiCoreType, FittedModules, ModuleSlot } from './types'
import { emptyFitted } from './labels'

export type { FittedModules } from './types'

/** 当前存档结构版本号：结构一变就 +1，并写对应的迁移函数（见 save.ts） */
export const CURRENT_STATE_VERSION = 18
/** 母港星系 id（内容层约定；探索系统以它为初始点亮点） */
export const HOME_GALAXY_ID = 'galaxy-hub'
/** 技能最高等级（EVE 惯例 5 级） */
export const MAX_SKILL_LEVEL = 5
/** 事件日志最多保留条数（防止存档无限膨胀） */
export const DEFAULT_LOG_CAP = 300
/** 新飞行员默认名字 */
export const DEFAULT_PILOT_NAME = '深空学徒'
/** 初始资金（ISK），够买得起第一艘船但买不起第二艘——先挖矿赚第一桶金 */
export const DEFAULT_START_ISK = 10_000
/** 初始自带舰船 id（须存在于舰船数据表） */
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
  /** 耐久 0~1（1 = 完好）；每次远征失利扣减，归零即弃船 */
  durability: number
  /** 船上货仓：itemId -> 单位数（随船，弃船即遗失） */
  cargo: Record<string, number>
  /** 装在这艘船上的装备（随船，弃船即遗失） */
  fitted: FittedModules
}

/** 采矿作业状态（v7 状态机：采掘 → 返航 → 出航 的自动循环） */
export interface MiningState {
  active: boolean
  beltId: string | null
  /** 作业阶段：mining=正在采掘；returning=满舱返航；outbound=卸货后出航 */
  phase: 'mining' | 'returning' | 'outbound'
  /** 采掘循环计时器累计（毫秒），满一个循环结算一次产出 */
  cycleAccMs: number
  /** 返航/出航阶段计时器（毫秒） */
  phaseAccMs: number
  /** 本次作业累计采得单位数（日志用） */
  tripUnits: number
  /** 全自动循环（满舱自动返航→卸货→再出航） */
  autoCycle: boolean
  /** 完成本次返航卸货后停止（配合全自动循环使用） */
  stopAfterTrip: boolean
  /** T8 兼容字段：本次作业的出发星系（null = 从空间站/母港出发）；
   *  首次到带后清空，此后自动循环腿一律以"空间站"为卸货/出发基准 */
  originGalaxy: string | null
}

/** T4 换船善后：旧船自动返航到港的记录（key = 船 id，独立于主控采矿推进） */
export interface ShipReturnState {
  /** 原矿带 id（日志/语义用；null = 未知） */
  beltId: string | null
  /** 返航单程总长（毫秒，换船时按旧船行程锁定） */
  legMs: number
  /** 已走毫秒（≤ legMs；到港条件 = 累计 ≥ legMs） */
  phaseAccMs: number
}

/** T8 显式"返航空间站"行程（野外停留 → 空间站；出发锁定总时长） */
export interface ShipTransitState {
  active: boolean
  /** 出发星系（显示用；null = 未知） */
  fromGalaxy: string | null
  /** 目的空间站所在星系（当前只有母港；T9 副站就绪后可为副站星系） */
  toGalaxy: string | null
  /** 到站时刻（游戏内毫秒，出发锁定） */
  finishAtGameMs: number
  /** 本次行程总毫秒（显示用） */
  legMs: number
}

/** B1.5 主动"前往星系待命"（主控）：飞去目标星系 → 野外停留（awayGalaxy）；去程可召回 */
export interface StandbyState {
  active: boolean
  /** 目标星系 id */
  galaxyId: string | null
  /** 到达时刻（游戏内毫秒，出发锁定） */
  finishAtGameMs: number
  /** 去程总毫秒（显示用） */
  legMs: number
}

/** 制造作业状态（限时批次：时间到自动完成出装备/船） */
export interface ManufacturingState {
  active: boolean
  blueprintId: string | null
  /** 完成的游戏内时刻（毫秒） */
  finishAtGameMs: number
  /** 本次作业总耗时（毫秒，开工时按当时技能锁定，中途升技能不影响） */
  durationMs: number
}

/**
 * 精炼炉运转状态（工业细化，2026-09-04 船长确认）：单工位循环运转——
 * 固定批量周期自动续批（5~10 秒节奏），原料开工时按全部库存锁定入炉；
 * 产物只在每批到点时按收率结算入仓；停止即止：已完成批已出货、剩余锁定料全额退回。
 * worker：'pilot' = 主控亲自运转（占主控工作位，期间不可离港作业）/
 * AiCoreType = 接入一枚 AI 核心驱动（核心出库占用、不占副船名额，停止/料尽自动归还）。
 */
export interface RefineRunState {
  active: boolean
  /** 劳动者：主控亲自运转 / AI 核心类型 */
  worker: 'pilot' | AiCoreType
  /** 正在运转的资源 id（矿石/气体/冰矿） */
  itemId: string | null
  /** 单批单位（开工锁定） */
  batchUnits: number
  /** 单批周期毫秒（已按 AI 核心效率拉长；开工锁定） */
  cycleMs: number
  /** 当前批到点时刻（游戏内毫秒） */
  finishAtGameMs: number
  /** 剩余待炼单位（含当前批未炼部分；停炉时全额退回仓库） */
  lockedQty: number
  /** 已完成批数（展示用） */
  batchesDone: number
}

/** 精炼炉空态（新档 / 停炉后） */
export const EMPTY_REFINE_RUN: RefineRunState = {
  active: false,
  worker: 'pilot',
  itemId: null,
  batchUnits: 0,
  cycleMs: 0,
  finishAtGameMs: 0,
  lockedQty: 0,
  batchesDone: 0,
}

/** 远征作业状态（V12 两阶段：去程 out → 交火 battle → 返航 back；battle 为实时状态机） */
export interface ExpeditionState {
  active: boolean
  /** 目标异常点 id */
  anomalyId: string | null
  /** 当前阶段结束的游戏内时刻（毫秒）——V12 起语义随 phase：到港开战/战斗结束/返航到家 */
  finishAtGameMs: number
  /** 本次作业总耗时（毫秒，出发时锁定；展示用） */
  durationMs: number
  /** 单程航程耗时（毫秒，锁定） */
  outMs: number
  /** 交火参考耗时（毫秒，展示用；实际由战斗推演决定） */
  combatMs: number
  /** 出发时火力（锁定；展示/旧式兼容） */
  power: number
  /** 出发时抽中的途中事件 id（null = 本次平安无事） */
  eventId: string | null
  /** 途中事件是否已触发 */
  eventFired: boolean
  /* ═══ V12：阶段与战斗状态 ═══ */
  /** 当前阶段：去程 / 交火 / 返航（未出航时 = 'out'） */
  phase: 'out' | 'battle' | 'back'
  /** 实时战斗状态（phase='battle' 时非空；只存动态量，静态由 ship/anomaly 定义重建） */
  battle: BattleState | null
  /** 玩家期望距离偏好（米；战斗内拖动/战术选择写入，下次出发自动沿用；未设则用有效射程中点） */
  desirePrefM?: number
}

/** V12 战斗单位运行状态（动态量：三层当前血量 + 每武器装填倒计时） */
export interface BattleUnitRt {
  /** 单位标识：我方 'player'；敌方 'foe-0'（主力）/ 'foe-1..n'（僚机） */
  tag: string
  side: 'me' | 'foe'
  name: string
  /** 三层当前血量（盾/甲/结构） */
  hp: { s: number; a: number; h: number }
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
  /** 是否命中目标 */
  hit: boolean
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
  /** 战斗累计统计（战报/小剧场用） */
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  /** 可视化开火事件环（最新 48 条；战斗画面动画回放用，不影响结算） */
  fx: BattleFx[]
  /** 下一条开火事件的序号（pushFx 自增分配；环裁剪后消费端按序号续播） */
  fxSeq: number
  /** 结束标记：'me' = 我方胜（敌编队全灭）；'foe' = 我方结构归零；null = 进行中（超时也在步进内判定） */
  ended: 'me' | 'foe' | null
}

/* ═══════════════ V9：市场状态 ═══════════════ */

/** 单个商品的池与冲击状态 */
export interface MarketPoolState {
  /** 池库存（常驻商品；相对 poolTarget 影响订单价格与流量） */
  q: number
  /** 冲击动量（价格偏移比例，有符号、无叠加上限；随时间衰减） */
  shock: number
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

/** AI 副船任务：前往指定星系驻留待命（占名额；out 去程 → stand 驻留；可取消召回） */
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

/** AI 副船任务（采矿 / 远征 / 待命） */
export type AiTask = AiMiningTask | AiExpeditionTask | AiStandbyTask

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
  manufacturing: ManufacturingState
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

/** 扫描探索作业状态（V13：前往剪影星系 → 就地扫描 → 返航；完成回港时点亮该星系）
 * T8：作业 = 去程 + 就地窗口；窗口完成即"停留该星系"（不再自动返航）。
 * originGalaxy（T8 兼容字段）：本次扫描出发星系（null = 空间站/母港） */
export interface ScanningState {
  active: boolean
  /** 目标星系 id（扫描对象永远是"已探索星系的一跳邻居"，即星图剪影） */
  galaxyId: string | null
  /** 作业完成的游戏内时刻（毫秒，出发时锁定） */
  finishAtGameMs: number
  /** 出发时刻（毫秒，展示用） */
  startedAtGameMs: number
  /** T8：本次扫描的出发星系（null = 空间站/母港） */
  originGalaxy: string | null
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
 * - T9：stationSites 建站进度 / dockedSite 停靠副站 / dialogueSeen 剧本已读 / pendingDialogue 待播通讯 */
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
  /** T8 连续出击：当前自动循环的悬赏 id（null = 关闭） */
  autoLoopAnomalyId: string | null
  /** T9 建站进度：站点 id -> 进度（档位 stage 从 0 起；delivered 已缴物品单位） */
  stationSites: Record<string, StationSiteProgress>
  /** T9 当前停靠的副站 id（null = 母港；awayGalaxy=null 且有值时表示停副站） */
  dockedSite: string | null
  /** T9 通讯剧本已读标记：剧本 id -> true */
  dialogueSeen: Record<string, boolean>
  /** T9 待自动播放的通讯剧本 id（首次抵达等触发；null = 无） */
  pendingDialogue: string | null
}

/** T9 一个建站点的建造进度 */
export interface StationSiteProgress {
  /** 已完成的档位数（0/1/2/3；3 = 建成并入空间站清单） */
  stage: number
  /** 当前档已缴单位数（按 acceptItemIds 任意混合累计；跨档清零重计） */
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
  /** 事件展示名（文案池按低安深度选） */
  name: string
  /** 遭遇强度（编队总战力 ≈ 承担船火力 × 0.6~1.05） */
  threat: number
  /** 来源说明：主控采矿/停留/远征途中 或 副船任务 */
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
 * rare = 稀有残骸计数（预留，暂不实现）。 */
export interface WreckGalaxyRecord {
  density: number
  rare: number
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
  /** B3 星系残骸密度（2026-09-05：兼容字段无版本号；星系 → 密度记录，无记录 = 基础密度） */
  galaxyWrecks: Record<string, WreckGalaxyRecord>
}

/** 对外统一称呼：当前版本状态 */
export type GameState = GameStateV18

/** 向状态里追加一条日志（自动编号、自动裁剪超出 logCap 的旧日志） */
export function addLog(state: GameState, kind: LogKind, text: string): void {
  const lastId = state.logs.length > 0 ? state.logs[state.logs.length - 1]!.id : 0
  state.logs.push({ id: lastId + 1, atGameMs: state.gameMs, kind, text })
  const cap = state.logCap > 0 ? state.logCap : DEFAULT_LOG_CAP
  if (state.logs.length > cap) {
    state.logs.splice(0, state.logs.length - cap)
  }
}

/** 创建一份全新的初始存档（一个新飞行员） */
export function createInitialState(opts?: { name?: string; seed?: number; nowWallMs?: number }): GameStateV18 {
  const nowWall = opts?.nowWallMs ?? Date.now()
  const state: GameStateV18 = {
    version: 18,
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
    wallet: { isk: DEFAULT_START_ISK },
    shipId: DEFAULT_START_SHIP_ID,
    fleet: {
      [DEFAULT_START_SHIP_ID]: {
        defId: DEFAULT_START_SHIP_ID,
        customName: null,
        durability: 1,
        cargo: {},
        fitted: emptyFitted(),
      },
      // V12 测试友好：初始另送一艘武装艇（船坞待命）+ 基础战斗装备（见下）
      'sh-falconet': {
        defId: 'sh-falconet',
        customName: null,
        durability: 1,
        cargo: {},
        fitted: emptyFitted(),
      },
    },
    warehouse: {
      items: {
        // V12：三型通用弹药各 60 发（配合武装艇 MK1 炮，方便上手即测战斗；V18 口径取消后无轻/重档）
        'ammo-kinetic-l': 60,
        'ammo-explosive-l': 60,
        'ammo-plasma-l': 60,
      },
    },
    moduleBay: {
      // V12：基础战斗装备（动能炮台 MK1 一件；2026-09-05 全流程模拟发现：
      // 旧 id 'mod-turret-1' 已在 V17.2 退役，新档默认直接写旧 id = 幽灵装备）
      'mod-turret-kin-1': 1,
    },
    aiCores: { basic: 0, gamma: 0, beta: 0, alpha: 0 },
    aiAssignments: {},
    shipReturns: {},
    shipLocks: {},
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
    },
    manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
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
    scanning: { active: false, galaxyId: null, finishAtGameMs: 0, startedAtGameMs: 0, originGalaxy: null },
    scanProgress: {},
    awayGalaxy: null,
    transit: { active: false, fromGalaxy: null, toGalaxy: null, finishAtGameMs: 0, legMs: 0 },
    bountyCooldowns: {},
    autoLoopAnomalyId: null,
    stationSites: {},
    dockedSite: null,
    dialogueSeen: {},
    pendingDialogue: null,
    debugQuick: false,
    completedBounties: [],
    encounter: {
      active: false,
      shipId: null,
      galaxyId: null,
      name: '',
      threat: 0,
      origin: '',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle: null,
    },
    lowSecNotified: false,
    encounterZoneCooldown: {},
    lowSecPresence: {},
    standby: { active: false, galaxyId: null, finishAtGameMs: 0, legMs: 0 },
    refineRun: { ...EMPTY_REFINE_RUN },
    galaxyWrecks: {},
    logs: [],
  }
  addLog(state, 'system', '欢迎加入「大鲸鱼深空工业」。')
  addLog(state, 'info', 'V12：实时战斗引擎上线——远征交火带距离机动/即时射击/命中回避（随 V10.5 数值契约启用）。V11 随机事件、V10 市场扩容已随版本就绪。')
  addLog(state, 'info', `初始资金 ${DEFAULT_START_ISK} ISK 已到账；沙猫级采矿艇已停靠机库，另有隼枭级武装艇待命（装备库含轻型炮台 MK1，仓库配三型通用弹各 60 发，可直接体验远征战斗）。`)
  addLog(state, 'info', '星图迷雾已开启：母港已探明，周边星系等待扫描探索——去悬赏列表接任务，或对星图上的「未知信号」执行扫描。')
  return state
}
