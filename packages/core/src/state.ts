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

import type { AiCoreType, CommsInstanceEntry, DamageResists, DamageType, FittedModules, FoeFamily, ModuleSlot } from './types'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'
import { emptyFitted } from './labels'
import { EMPTY_WORMHOLE_STATE } from './wormhole'
import type { WormholeState } from './wormhole'

/**
 * **新档初始声望 = 40**（**2026-09-26 船长令**：「**声望真扣（就是意味着玩家一开始其实可以买5张）**」）。
 *
 * 值 = 插件图纸单价（`plugs.PLUG_BLUEPRINT_COST = 8`）× 5 ⇒ **开局就能换 5 张**。
 * ⚠ **定义在这里、由 `expedition.ts` 转发**：`expedition` 已经 import 本文件，
 * 反向引会成环（仓内既有的 `HOME_GALAXY_ID` 就是这个处置）。
 * ⚠ 连带后果（已如实登记）：入侵门槛 `WEEKEND_MIN_STANDING = 40` 因此**新档开局即达标**——
 * 门槛数值一字未动，只是这条初始值把它顶到了；老档不受影响。
 */
export const INITIAL_STANDING = 40

export type { FittedModules } from './types'

/** 当前存档结构版本号：结构一变就 +1，并写对应的迁移函数（见 save.ts） */
export const CURRENT_STATE_VERSION = 31
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

/**
 * 日志类型：显示端按类型配色/筛选。
 *
 * **2026-09-26 船长令重新分类**（原话：「现在发送给事件日志的信息十分混乱，大量信息都放进了'信息'里，
 * 而且缺少'战斗'的分类」＋「对事件日志重新分类」＋「队列**合并**」＋「打捞**单独算**」）：
 * - **新增四类**：`combat` 战斗 · `industry` 工业 · `fleet` 舰队 · `salvage` 打捞；
 * - **`queue` 并入 `levelup`**（训练队列与技能升级同属成长线）；
 * - 三条分流口径：① **域优先**（先看属于哪条玩法线）② **战报一律归战斗**（胜/败/撤退/弃船/交战经过，
 *   无论原先记在 info 还是 warn）③ **警告 = 跨域严重度**（只留"异常 / 需要行动"：组件不足、结构濒危、
 *   货仓放不下、作业停止、记录缺失），不再承担"战败"那类域内信息；
 * - 逐类来源清单（全仓 362 处调用点）见 `docs/design/event-log-categories-20260926.md`；
 * - `'queue'` **留在类型里**只为兼容老档/老日志的读取（新代码不得再写它）。
 */
export type LogKind =
  | 'system'
  | 'info'
  | 'levelup'
  | 'queue'
  | 'warn'
  | 'trade'
  | 'event'
  | 'combat'
  | 'industry'
  | 'fleet'
  | 'salvage'

/**
 * **一条"可翻译文案"的 id + 参数**（船长 2026-09-20 定「甲案」）：core 只产出 **文案 id + 参数**，
 * 由渲染层按当前语言渲染；core 自身不碰语言。
 *
 * ⚠ 落法（实测选型）：**加法式可选字段**，不把 `string` 改成 `string | CmdText` 联合——
 * 联合会外溢到全部读取点与用例（首轮实测砸了 30+ 处），而加法式零影响：
 * 日志 = `LogEntry.text`（中文，照写）+ 可选 `textId` / `textParams`；
 * 指令错误 = `CommandResult.error`（中文，照写）+ 可选 `errorId` / `errorParams`。
 */
export interface CmdText {
  /** 唯一表里的 id（新域 `core.<文件短名>.<三位序号>`） */
  readonly id: string
  /** 插值参数：`{ name: '…' }` 对应文案里的 `{name}` */
  readonly params?: Readonly<Record<string, string | number>>
}

/** 一条事件日志 */
export interface LogEntry {
  /** 自增编号，界面当 key 用 */
  id: number
  /** 发生时游戏内时间（毫秒），以后可回看"第几小时发生了什么" */
  atGameMs: number
  kind: LogKind
  /**
   * **中文正文**。甲案改造后它仍照写——三个用途：
   * ① 老档 / 未改造调用点的兜底显示；② 日志检索与工具断言（`tools/playthrough-sim.ts` 等按正文匹配）；
   * ③ 出问题时能直接在存档/控制台看到人话。界面渲染**优先** `textId`。
   */
  text: string
  /** 甲案：文案 id（有 ⇒ 界面按当前语言渲染；无 ⇒ 显示 `text` 中文原串） */
  textId?: string
  /** 甲案：插值参数（`textId` 的 `{…}` 占位符取值） */
  textParams?: Readonly<Record<string, string | number>>
}

/** 随机数状态：存种子与使用次数，保证任何时刻都能复现同一串随机 */
export interface RngState {
  seed: number
  count: number
  /**
   * **货柜拆解计数**（2026-09-22 船长令「所有货柜的开启，能否采用随机数种子固定？」）：
   * 开箱的随机子流种子 = `hash(seed, box)`，四种货柜（安全 / 图纸 / 贵重品 / 军用）**混算**。
   * **可选字段 ⇒ 零迁移**（老档缺省 0，从下一次拆解起即按新口径）；它**不参与 `count` 那条全局流**
   * —— 于是"开箱前去干别的"不会改变本箱结果（防刷），而"先开哪一箱"仍能微调结果（船长要的）。
   */
  box?: number
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
  /**
   * **舰船插件**（**2026-09-26 船长令**，见 `docs/design/ship-plug-20260926.md`）：
   * 装上去就**拆不下来**的固定件，**独立于高/中/低槽**（不是 `fitted` 的第四类，避免动槽位契约）——
   * 长度上限 = 该船型的插件槽数（`ShipDef.plugSlots`：T1=5 / T2=4 / T3=3 / T4=2 / T5=1）。
   *
   * 三条不可逆口径：① **无卸下入口**（装配页不给按钮，core 侧卸下函数也拒绝插件）；
   * ② 装了插件 ⇒ **不许进舰船仓库、不许挂市场卖**；③ **唯一失去途径 = 船被打沉**（随 `fleet` 条目一起消失）。
   * 兼容字段（可选，**零迁移**）：老档缺席 = 没装过插件。
   */
  plugs?: string[]
  /** 无人机舱装载清单（2026-09-08 无人机舱大改）：droneId -> 架数（0 = 不存）；
   *  战斗只放飞此清单（不再自动从仓库贪心）；CPU 预占计入船体预算；旧档缺省 = 空 = 无无人机 */
  droneLoad?: Record<string, number>
  /** 弹药档位偏好（2026-09-09 弹药 MK2）：damageType -> 弹 itemId（如 'ammo-kinetic-2'）；
   *  缺省 = 基础弹。**取档口径 2026-09-16 船长改判**：开战按"同族取能装得最多的一档"装载
   *  （装不满也照装；旧口径「库存不足整族回退基础弹」已作废，见 `combat.resolveAmmoTier`）；
   *  连打/离线同源消耗 */
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
/**
 * **虫洞扫描作业状态**（2026-09-14 船长：新增主控活动「扫描虫洞」）。
 * 进度按游戏时刻累计；遇袭不清零（船长：「遇袭不中断扫描」）。
 */
export interface WormholeScanState {
  active: boolean
  /** 已累计的扫描毫秒（满一个窗口即发现一处虫洞） */
  progressMs: number
  /**
   * **解锁当次那"满一个窗口"的进度是否已发放**（船长 2026-09-14 四步闸门选甲：解锁时进度条初始 100%
   * ⇒ 玩家点「开始扫描」第一拍即得一处）。**可选字段 ⇒ 零迁移**：老档没有 = 尚未发放，
   * 已达标的老档在下一次 tick 由 `reconcileWormholeScanWelcome` 自动补上；**只送一次**。
   */
  welcomed?: boolean
}

/**
 * **虫洞内容原型**（船长 2026-09-14 定案 · 丙）：一处虫洞按种子抽一个原型，只改
 * "非空格里各类信号占多少"——**不动空占比、盘半径、层威胁/层收益曲线**（强度仍只由层决定）。
 */
export type WormholeArchetype = 'balanced' | 'wreck' | 'ruins' | 'vein' | 'combat'

/**
 * **洞内敌族**（船长 2026-09-14 定案 · 丁）：一处虫洞**锁定一族**（整趟所有格都是该族的敌卡），
 * 与数据里的五张洞内卡 **1:1**：`A 劫掠支队` / `C 星髓游猎群` / `D 守墓巡哨` / `E 巨构残响` / `G 亡军封锁`。
 * ⇒ 稀有残骸、遗迹安全货柜、专属装备与图纸**全是这一族**（"挑族刷装备"由此成立）。
 */
export type WormholeFamily = 'A' | 'C' | 'D' | 'E' | 'G'

/** **已发现、未开始探索的虫洞**（种子 + 内容原型 + 敌族；起始层恒 1；上限 `WORMHOLE_STOCK_MAX`） */
export interface WormholeStockItem {
  id: string
  /** 本趟种子（进洞时传给 `wormholeEnter`） */
  seed: number
  /**
   * 起始层：**恒 1**（船长 2026-09-14「所有虫洞都是从1层开始探索」；旧档里的 2/3 载入时归 1）。
   * 字段保留 ⇒ **零迁移**（进洞时仍按它建副本，只是值不再有变化）。
   */
  depth: number
  /**
   * 内容原型（丙 · 2026-09-14）。**可选字段 ⇒ 零迁移**：老档没有就按 `seed` 现算
   * （`wormholeArchetypeOf`）——等价于"它本来就有原型"，不重掷、不改已存盘面。
   */
  archetype?: WormholeArchetype
  /** 敌族（丁 · 2026-09-14）。同样**可选 ⇒ 零迁移**，老档按 `seed` 现算（`wormholeFamilyOfSeed`） */
  family?: WormholeFamily
  /** 发现时刻（游戏内毫秒） */
  foundAtGameMs: number
}

/**
 * **在跑的一趟自动探索**（船长 2026-09-14 定案 · 确认稿 §六）。
 * 与 `wormholeEnter` 的副本状态机无关：这是"抽象的一趟"（不建网格、不打战斗），
 * 到点结算「手动期望 × 40%」的收益与 −40%~−80% 的损伤（绝不丢船）。
 */
export interface WormholeAutoRun {
  id: string
  /** 对应的库存虫洞 id（**开始时即消耗**；中止也不退还） */
  stockId: string
  /** 该处虫洞的种子（产出池与它同源 ⇒ 同一处无论谁去，族池一致） */
  seed: number
  /** 起始层（恒 1；字段保留 ⇒ 零迁移） */
  depth: number
  /** 该处的敌族（丁 · 族徽；缺省按 `seed` 现算 ⇒ 零迁移） */
  family?: WormholeFamily
  /** 该处的内容原型（丙 · 内容原型；缺省按 `seed` 现算 ⇒ 零迁移） */
  archetype?: WormholeArchetype
  /** 参与舰（每条各占 1 枚 AI 核心；任务期间锁定） */
  shipIds: string[]
  startedAtGameMs: number
  finishAtGameMs: number
}

/**
 * **自动探索结算报告**（船长：结算走「日志 + 需要确认的报告」，报告显示在「扫描虫洞」页里）。
 * 收益列表与损伤读数都按"逐项可读"存，确认后 `confirmed = true`（仍留档，超上限丢最旧）。
 */
export interface WormholeAutoReport {
  id: string
  stockId: string
  depth: number
  finishedAtGameMs: number
  /** 参与舰（结算后已解锁） */
  shipIds: string[]
  /** 结算时释放的 AI 核心数 */
  coresReleased: number
  /** 收益清单（已入仓库） */
  gains: Array<{ itemId: string; units: number }>
  /**
   * **本趟带回的 AI 核心**（2026-09-14 船长第四答：自动探索也吃遗迹核心掉落，按手动期望 ×40% 折算）。
   * ⚠ 与 `gains` 分开：核心**不进仓库**（直接进 `state.aiCores` 账本）⇒ 塞进 `gains` 会被入仓循环
   * 写进仓库、变成"仓库里有核心却不能用"的两本账。缺省 = 本趟没捞到。
   */
  cores?: Array<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>
  /** 损伤读数（结构 / 装甲各一项） */
  damage: Array<{
    shipId: string
    name: string
    durabilityLossPct: number
    armorLossPct: number
    durabilityPct: number
    armorPct: number
  }>
  /** 玩家是否已确认（界面「确认」按钮） */
  confirmed: boolean
}
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
  /**
   * **本线开工时确实吃掉了一本一次性图纸**（2026-09-20 船长：「一次性蓝图的制造取消后返还玩家蓝图」）。
   *
   * 为什么**显式记账**而不是取消时现推（`isSingleUseBlueprint` ＋ 查 `spentOneTimeRecipes`）：
   * 那种推断在"同名书存量 > 1、且其中一次已完工"时会**多退**；本字段记的是历史事实（这一线确实扣了书），
   * 退书时据此判、**只退这一本**。
   * ⚠ 缺省/false = 没吃书（普通图纸、已学会、旧档遗留线）⇒ 取消时**不动书架**（老档零行为变化）。
   */
  bookSpent?: boolean
  /**
   * **本线开工时实际扣掉的材料**（`itemId → 数量`，已含当时的材料学折扣）——**2026-09-24 船长令**：
   * 「自动停机**材料一起退**」。
   *
   * 为什么要**在线上记账**而不是停机时按蓝图现算：
   * ① 停机这条路（`haltActivityForSwitch`）**没有 ctx**（整条活动闸门链都是 ctx-free 的），现算拿不到配方；
   * ② 现算会**用现在的技能**去乘旧需求——中途升了「材料学」，退料就会**少于**当初扣的（静默缩水）；
   * ③ 这是历史事实，与 `bookSpent` 同一性质：**扣了多少就退多少**。
   *
   * 缺省（老档在跑的线）= 不写 ⇒ 取消/停机沿用"按蓝图 + 当前技能现算"的旧口径（零迁移、不倒退）。
   */
  spentMaterials?: { itemId: string; count: number }[]
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
  recipe: 'refine' | 'recycle' | 'unbox'
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
    /** 专属无人机的一次性**图纸**所得（2026-09-14 增：id → 张数；进蓝图书架） */
    blueprint?: Record<string, number>
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
  /**
   * **打捞对象**（**2026-09-26 船长令**）：`undefined` = **全部**（按威胁加权，现状口径）；
   * 组 key（如 `h-hi`）= **只捞该组**；`WEEKEND_WRECK_TARGET` = 只捞**入侵残骸**（独立池）。
   * 兼容字段（可选 · 零迁移）：老档缺席 = 全部。
   */
  targetGroup?: string
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
  /**
   * **每个星系各自的玩家目标距离**（米；2026-09-11 船长：「玩家每个星系设定的目标距离独立保存，
   * 预估胜率的战斗按照那个距离决定。如果没有，采用射程中段距离」）。
   * 键 = 星系 id，值 = 该星系的目标距离；战斗内拖距离条/点战术按钮写入**当时所在星系**。
   * 未设该星系 → 回落**默认档**：**星图 = 主武器射程带 0.8 处**、洞内 = 中段 0.5
   * （2026-09-15 船长裁定，见 `balance.battle.desireBand*`；旧"射程中点"是星图旧口径，已作废）。
   * 取代旧的单一全局值 `desirePrefM`（旧档该值不再沿用，一律按新口径回落默认档）。
   */
  desirePrefByGalaxy?: Record<string, number>
  /** ⚠ 遗留字段（2026-09-11 起不再使用，仅存档兼容占位）：原"全局期望距离偏好"。
   *  现行口径见 `desirePrefByGalaxy`；读档时不回填、不回读。 */
  desirePrefM?: number
  /** 赏金任务·窝点档位（2026-09-10 兼容字段）：非空 = 本次远征打的是派生窝点
   *  （威胁/波次/僚机按档位强化，奖金与稀有残骸按窝点口径结算）；旧档与普通悬赏 = 未设 */
  lairTier?: 1 | 2 | 3
  /** 敌对派系活跃（2026-09-10 兼容字段）：true = 本次远征打的是当日派系活跃星系的**常驻悬赏**
   *  （威胁 ×1.1、奖金 ×1.1、胜利有概率掉稀有残骸）；与 lairTier 互斥（派系只针对普通悬赏） */
  factionActive?: boolean
  /**
   * **这一场实际打的是哪个星系**（2026-09-25 加：周末入侵接线）：
   * H 族入侵独立卡自带母港 `galaxyId` ⇒ 战后归属/残骸注入若只看卡就会算到母港（把残骸注错星系）。
   * 引擎在出发那一刻把**界面上那张卡**的星系写进来（被占星系的入侵替换卡带的是**被占星系**），
   * `weekendBattleInvolvedOf` 优先读它。缺省 / 非法 ⇒ 回落老口径（只看卡的 `galaxyId`）⇒ 零迁移、零行为变化。
   */
  foeGalaxyId?: string
  /**
   * **奖励基底覆写**（2026-09-25 加 · 周末入侵"主动出击每场重抽"配套）：入侵的敌舰每场重抽，
   * 但奖励恒 = **该星系原卡 ×1.4** ⇒ 出发时算好写进来，结算时用它替代 `anomaly.rewardIsk`。
   * 可选字段 ⇒ 零迁移（老路径不写它，逐字不变）。
   */
  rewardIskOverride?: number
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
  /**
   * **舰级 id**（2026-09-24 加；只给"舰级路径"建的敌单位写）：旗舰 BOSS 的伤害台账
   * （`combat.flagshipBattleLedger`）靠它认出"哪几个单位是母舰"。缺省 = 旧单位/旧档 ⇒ 零行为变化。
   */
  foeShipId?: string
  /** 每武器装填倒计时 ms（0 = 可开火；与静态武器卡顺序一一对应） */
  weapons: number[]
  /**
   * **入场时刻**（战斗时钟 ms；含逐舰错峰）——**只给"有入场动画"的单位写**（船长 2026-09-14：
   * 「初始不可开火…并且参考①动画没结束不开火」）：
   * - 窗口 = `[enteredAtMs, enteredAtMs + BATTLE_ARRIVAL_FLY_MS)`（见 `combat.ts` 单一出处）；
   * - 窗口内它**不可被我方选中**（`isFoeEngageable`）⇒ 动画没演完打不到它；
   * - 它自己那一侧的首发也在窗口之后（播种时装填取"窗口"与自身装填的较大者）。
   * 缺省 = 无入场窗口（开战即在的常规单位、洞外首波敌舰、老档读入的单位）⇒ 立即可交战。
   */
  enteredAtMs?: number
  /**
   * **隐身窗口截止时刻**（战斗时钟 ms；2026-09-15 船长定：「隐秘行动装置」——高槽，
   * **自身武器开火前隐身 20/30 秒**：不被锁定、不被攻击）。
   *
   * 口径（六问六答：Q1 甲 / Q2 甲 / Q3 甲）：
   * - 开战那一刻按装配写入 `startedAtGameMs + stealthMs`（**只有装了装置的船**，编队内逐舰各算各的）；
   * - 窗口内该舰**不可被敌方选中**（`combat.isMyUnitTargetable`）⇒ 敌舰主炮与机群**停火待机**
   *   （若编队里还有别的可打目标，则改打别的）；窗口内它也**不会挨打**；
   * - **本舰开火即现形**（首门武器打出第一发时清空本字段）；**到点也现形**（没开火同样解除）；
   * - **装上任何推进器类模块 ⇒ 直接解除**（船长 2026-09-15 追加的禁令，装配期即判 ⇒ 不写本字段）。
   * 缺省 = 无隐身（老档、未装装置的船）⇒ 零行为变化。
   */
  stealthUntilMs?: number
}

/**
 * **我方被「劫掠捕获网」钉住的四层效果**（船长 2026-09-16 两句话的落点）：
 * 「降低目标90%移动速度，并关闭所有类型推进器」＋「还会让目标闪避强制为0，射程降低500米」。
 * 只作用于被钉的**那一艘**；本场永久；**击杀发动者即解除**；多艘不叠加。
 */
export interface BattleWebDebuff {
  /** 施放者 tag（它一死 ⇒ 本条清掉） */
  byTag: string
  /** 战斗机动 ×本值（0.1 = 降低 90%） */
  slowMul: number
  /** 关闭所有类型推进器（点火期不再加成；微型跃迁引擎同样失效） */
  noThruster: true
  /** 闪避强制为 0（敌方命中率 = 敌武器命中 + 加成 − 0） */
  noEvasion: true
  /** 武器射程 −本值（两端各减，近界下限 1m） */
  rangeDownM: number
  /** 施放时刻（日志/战报用） */
  atMs: number
}

/**
 * **我方「墨潮捕获网」钉在敌舰上的三层效果**（**船长 2026-09-26**：「**玩家的捕获网和武器一样有冷却周期，
 * 独立瞄准，不看命中，击沉携带者才解除，或者对面被击沉，不选取重复目标。对方被击沉后进入冷却，
 * 冷却结束选择新目标。**」＋「**我方捕获网移除武器射程下降的效果**」）。
 *
 * 与 {@link BattleWebDebuff}（敌方那件）**同源不同面**：少了 `rangeDownM`（船长明令移除），
 * 其余三层逐字相同。只作用于被钉的**那一艘敌舰**；**目标被击沉**或**携带者被击沉**即解除。
 */
export interface BattleFoeWebDebuff {
  /** 施放者（携带网的我方舰）tag —— 它一死 ⇒ 本条清掉 */
  byTag: string
  /** 战斗机动 ×本值（0.1 = 降低 90%） */
  slowMul: number
  /** 关闭所有类型推进器 */
  noThruster: true
  /** 闪避强制为 0 */
  noEvasion: true
  /** 施放时刻（日志/战报用） */
  atMs: number
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
  /**
   * **劫掠捕获网连线**（船长 2026-09-16：「动画效果为一根蓝色的光速连着命中舰船」）——
   * `true` 时本条不是普通开火弹道，而是"发动者 → 被钉舰"的一条**蓝色连线**（持续到效果解除）。
   */
  web?: true
  /** 是否命中目标 */
  hit: boolean
  /**
   * **本发实收伤害**（2026-09-24 船长令「战斗界面，我希望添加战斗伤害的数值动画（包括 MISS）」）——
   * 供战斗画面在**目标旁飘字**显示的数字，口径 = `applyDamage` 的实收（盾→甲→结构真扣掉的血量，
   * 已吃层克制与层抗；含本发附伤段）。与 `stats.meDmg` / `foeHits` 同一来源，逐发加总即当拍伤害。
   * 未命中 / 无伤事件（捕获网连线、机群击落演出）/ 旧事件 ⇒ **不写**（UI 就不出数字，只飘 MISS）。
   * 纯展示数据：不参与结算，也不多消费一个随机数（`dmg` 只读已算出的结算结果）。
   */
  dmg?: number
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
  /**
   * **开战预载量**（F3c B2 · 谜质「弹药回收装置」要用）：开战装完后立刻记一份，
   * 战后按「预载 − 余额」算出这一场打出去多少。
   * **只由洞内多舰开战写**（既有单船 / 远征路径不写 ⇒ 那两边看不到这个加成，零变化）。
   */
  ammoLoaded?: { kin: number; exp: number; pla: number }
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
  /** 连续作战保险（2026-09-08 船长定；2026-09-11 起**低安遭遇战同样挂它**）：
   * 本场结构剩余低于该比例（相对满值结构，如 0.5 = 损失过半）→ 步进中自动中止并请求撤退（autoEscaped 置位）；
   * 悬赏巡回场次在开战时写入，低安遭遇战按 `encounter.retreatHullFrac` 写入 */
  hullEscapeFrac?: number
  /** 多波次（2026-09-09）：当前波索引（0 基；AnomalyDef.waves 缺省/单波不写，读档零迁移） */
  waveIdx?: number
  /**
   * **本场的敌群覆写**（2026-09-25 加）：开战时传进 `startBattleFor`/`startFleetBattleFor` 的
   * `combat.FoeOverride` **原样存一份**——`advanceBattleFor` 每拍从 `ctx` 重建敌卡，
   * 不存的话**只有第 0 波吃到覆写**，多波卡的后续波会回到满强度（H 族遇袭 ×0.75 的 2 波卡首当其冲）。
   * 类型与 `combat.FoeOverride` 同构（此处内联声明以避免 combat ↔ state 循环依赖）。
   * 缺省 = 无覆写（旧档与既有战斗路径零迁移、零行为变化）。
   */
  foeOverride?: {
    threat?: number
    waves?: ReadonlyArray<{ units: number; hpShare: number }>
    keepCardWaves?: boolean
    strengthMul?: number
    /** BOSS 血条覆写（2026-09-25 · 旗舰战）：本场满值 = 开战那一刻的池子剩余（见 `combat.FoeOverride`） */
    bossHp?: number
    /** BOSS 血条的**分母**（池子总量，恒定；只喂界面血条，不改台账） */
    bossHpMax?: number
    /** 母舰**当前三层血**（按 护盾→装甲→结构 顺序扣；见 `weekendEvent.weekendFlagshipLayersOf`） */
    bossHpLayers?: { s: number; a: number; h: number }
    /** 母舰三层血的**容量**（= 池子总量 × 卡面 split）：界面血条三行的分母 */
    bossMaxLayers?: { s: number; a: number; h: number }
    /** 哪一条舰级算母舰（`foeShipId`） */
    bossShipId?: string
  }
  /** 多波次演出间隔（2026-09-09 船长反馈）：当前波全灭时刻（lastTick 口径），配合 waveEnterGapMs
   * 等爆炸/残骸演出播完再刷下一波（零迁移可选字段） */
  waveClearAt?: number
  /**
   * **本场生效倍速**（2026-09-19 船长「时间压缩矩阵」·谜质科技）：1 = 未解锁 / 洞外战斗 / 离线·后台结算。
   * 由 `combat.advanceBattleFor` **每拍**按前台心跳传入的档位刷新（夹在"科技已解锁档位"内），
   * **不落档、老档缺省 = 1**（读档零迁移）。用途：① 战斗时钟按它折算（倍速时间轴）；
   * ② 演出保护窗口（入场动画 / 波次转场 / 击杀慢镜）按它**等比放大**——倍速只压缩战斗进程、
   * **不压缩演出**（船长 2026-09-19 口径）；③ 界面按它同步自己的入场窗口。
   */
  speedX?: number
  /**
   * **倍速时间轴的锚点**（`{ anchor: 全局时钟, clock: 与该全局时刻配对的战斗时钟 }`，2026-09-19）：
   * 由 `advanceBattleFor` **每拍收尾**刷新 ⇒ 倍速按"**从锚点起的增量**"折算，**中途切档不跳变**
   * （若按"开战时刻起算"折算，玩到一半从 ×1 切 ×4 会让战斗瞬间快进掉三倍已过时长）。
   * **不落档、老档缺省**（缺省 ⇒ 折算式退化成"= 全局时钟"，即倍速功能之前的老口径）。
   */
  speedAxis?: { anchor: number; clock: number }
  /** 已触发撤离请求（步进中止，结构保留当前值；由远征结算走轻损撤退路径——绝不弃船）。
   *  三个来源：连续作战保险（结构损失过半）、**战斗超时判负**（2026-09-10 船长定）、
   *  **无法交战提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）。 */
  autoEscaped?: boolean;
  /** 撤离来源（配合 autoEscaped；缺省 = 'hull'，旧档零迁移）：
   *  'hull' = 结构损失过半自动撤退；'timeout' = 打满战斗上限（判负，按被迫撤退处理）；
   *  'cannot-engage' = **无法交战**（开战满 `bal.cannotEngageMs` 仍'我方一炮未发 + 距离在我方射程外 + 敌已开火'） */
  escapeReason?: 'hull' | 'timeout' | 'cannot-engage';
  /**
   * **我方编队**（虫洞 D 批 · 船长 2026-09-13 定：一场战斗最多 4 艘我方同时参战）。
   * **可选、零迁移**：**不写 = 单船路径**（既有 27 张悬赏卡 / 低安遭遇 / AI 副船 /
   * 窝点派生卡全都不写，行为与随机数消费顺序逐字节不变）。
   *
   * 写了 = **多单位路径**：每条 = 一个参战单位（`tag` 为战斗内标识、`shipId` 为船型 id）。
   * 首条 = **主控**（`tag` 恒为 `'player'`，与单船路径同 tag ⇒ 存档/UI/读档口径不变），
   * 其余为僚舰 `'ally-1'..'ally-3'`；`units` 里每条的 hp/装填各自独立。
   */
  myFleet?: Array<{ tag: string; shipId: string }>
  /**
   * **本场是虫洞战斗**（F 批 · 2026-09-13）：只记"哪张敌卡 + 哪一层 + 什么用途 + 几波"，
   * 敌卡的绝对值**每拍按层重建**（静态卡由定义重建，不把整张卡存进档）。
   * **不写 = 普通战斗**（既有 27 张赏金卡 / 低安遭遇 / AI 副船）⇒ 零变化。
   */
  wormhole?: {
    /** 洞内敌卡 id（`wh-*`，见 `packages/data/src/wormholeFoes.ts`） */
    cardId: string
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    /** 本节点打几波（同一编成分波进场；撤离战恒 1 波） */
    waves: number
    /* ── F3c B1：谜质装置在**开战那一刻**的快照（逐拍重建读同一份，不各算各的）── */
    /** 威胁乘数（压制力场 / 守卫解析仪 / 撤离掩护器；三档各自 −50% 封顶） */
    threatMul?: number
    /** 敌队主伤害类型（三张谐振片"单层单系"只对它加抗性） */
    foeMainType?: DamageType
    /** 敌方命中 −（干扰发射器，−0.25 封顶） */
    foeHitDown?: number
    /** 敌方近盲带伤害比例 −（盲区压制器，下限 0） */
    blindReduce?: number
    /** **齐射溢出转移**是否生效（齐射协调仪 · F3c B2：1 台即开） */
    volleyOverflow?: boolean
  }
  /* ═══ 敌冲锋（2026-09-10 船长定；2026-09-11 改判结束条件；**2026-09-14 船长改判"逐单位 · 命中解除"**）═══
   * 触发（两条取或）：① 距离在自己武器射程之外 ② 距离 > 期望交距 + `foeChargeTriggerMarginM`；
   * 期间**该单位自己**的机动 ×(舰级 `FoeShipDef.foeChargeMul` ?? 全局 `BattleBalance.foeChargeMul`)。
   * 解除（两条取或）：① **自身炮台命中我方** ② 压到期望交距（兜底）；
   * 解除后该单位进 `foeChargeCooldownMs` 冷却（**2026-09-14 起 10 秒**）。
   * ⚠ **逐单位**：每个挂 `foeCanCharge` 的单位各有一份「在冲 / 冷却到某时刻」，互不顶替
   *   （2026-09-14 船长：「各自触发冲锋的提速」＋「自身攻击命中后解除冲锋状态，并进入 10 秒冷却」）。
   * 字段是**可选、零迁移**、且**有意不入档**（运行态 ⇒ 战中重载即重置冲锋循环，见 `save.ts` 登记表）。 */
  /**
   * **我方被「劫掠捕获网」钉住的状态**（船长 2026-09-16：A 族新舰「劫掠电子舰」的捕获网）——
   * 键 = 被钉的我方 tag；施放者一死即整条清掉（**击杀发动者 = 唯一解除手段**）。
   * 四层效果施加在"每拍重建的我方规格"上（见 `combat.applyMeWebDebuff`）：减速 / 关推进器 / 闪避归零 / 射程 −500m。
   * **运行期字段、有意不入档**（见 `save.ts` 登记表）。
   */
  meWebDebuffs?: Record<string, BattleWebDebuff>;
  /** **捕获网"已发放"账本**（键 = 施放者 tag）：同一艘舰**整场只发一次**（船长：第一次开火时发动）。
   *  ⚠ **"打空不算用掉"**（⟪2026-09-25 船长报障⟫）：首发若打向**已被别的网钉住**的目标 ⇒ 本舰的网
   *  **保留**、不记本账本，直到它真正钉住一个未被捕获的目标为止（详见 `combat.fireFoeCaptureWeb`）。 */
  foeWebFired?: Record<string, true>;
  /**
   * **我方「墨潮捕获网」钉在敌舰上的状态**（**船长 2026-09-26**，H 族势力装备三件之一）——
   * 键 = 被钉的**敌方 tag**；`byTag` = 携带网的我方舰。
   *
   * 与 `meWebDebuffs` 是一对镜像：效果三层（减速 / 关推进器 / 闪避归零，**不含射程**）、
   * 施加在"每拍重建的敌阵规格"上（`combat.applyFoeWebDebuff`）。
   * **随档**（见 `save.ts` 登记表）：捕获网是**周期装置**，冷却状态丢了会让"重载即刷新网"成为白赚。
   */
  foeWebDebuffs?: Record<string, BattleFoeWebDebuff>;
  /**
   * **我方捕获网的周期账本**（键 = 携带者 tag）：`targetTag` = 当前钉住的目标（无 = 待发/冷却中）、
   * `cooldownUntilMs` = 冷却结束时刻（战斗时钟 `gameMs`）。
   *
   * 口径（船长 2026-09-26）：开战即钉第一个可选目标 → 目标被击沉 ⇒ 记冷却、冷却结束选新目标；
   * **不选重复目标**（已被别的网钉住的跳过）；无目标可选 ⇒ 保持待发、**不空转冷却**。
   * **随档**（同上：冷却丢了就是白赚）。 */
  myWebs?: Record<string, { targetTag?: string; cooldownUntilMs: number }>
  /**
   * **双方当前速度（m/s）· 界面显示口径**（2026-09-16 船长：「在上方的距离条两端的上方分别显示敌我的战斗速度」
   * ＋「战斗中实际速度和面板显示的机动速度不一致」⇒「**只修改战斗显示数值，实际数值不变动**」）：
   * = 单位自身 `speedMps` × 机动倍率（我方推进器爆发 / 敌方冲锋），逐单位取平均 ⇒
   * **与装配页「机动速度 / 加力推进点火期」同一把尺**（不含 `combatSpeed` 的 speedFactor 与敏捷修正）。
   * ⚠ **引擎推进与距离拔河仍用另一对内部值**（`combatSpeed(...)`，含 ×0.6）——两套并存、互不影响；`combat.ts` 的落盘处有完整说明。
   * **运行期字段、有意不入档**（下一拍即重算；见 `save.ts` 登记表）。
   */
  meSpeedMps?: number;
  foeSpeedMps?: number;
  /**
   * **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——
   * `seedUnit` 时累积（开战首波 / 波次转场 / 增援都经那里），供战报渲染。
   * **运行期字段、有意不入档**（战中重载即重建；见 `save.ts` 登记表）。
   */
  foeMounts?: string[];
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMounts` 下标对齐 ⇒ 界面按当前语言挑一列）。
   * 同样由 `seedUnit` 累积、**运行期字段、不入档**（缺省 ⇒ 显示层回退中文名数组）。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>;
  /** 逐单位冲锋运行态（键 = 战斗 tag：`foe-0` / `w0-foe-2` / `w1-foe-0-e1`，同一场内唯一） */
  foeCharges?: Record<string, { on?: boolean; cdUntilMs?: number }>;
  /**
   * **我方"不被一击带走"保险的运行态账本**（船长 2026-09-16：「血量 100%，单次齐射伤害最多只能造成
   * **总血量 80%** 的伤害（**只对我方生效**）」）。
   *
   * 键 = 我方舰 tag（`player` / `ally-N`），值 = **本拍已吃下的敌方伤害**（每拍开头清空）。
   * 语义：同一拍内落在同一艘我方舰上的敌方炮火**合计**不得超过该舰总血 × `PLAYER_VOLLEY_DMG_CAP_SHARE`
   * （0.8）⇒ 满血舰**永不可能被一次齐射带走**（至少留 20%）；敌方承伤**完全不受影响**。
   * **洞内洞外都生效**（这条挂在共用的 `stepBattle` 上，所以悬赏/遭遇/远征/虫洞一律吃保险）。
   * 字段**可选、零迁移、有意不入档**（运行态：跨拍即重置，见 `save.ts` 登记表）。
   */
  meVolleyDmg?: Record<string, number>;
  /**
   * **损伤管制装置 · 免死状态**（**2026-09-25 船长令**：「当舰船第一次结构低于 1 时，将结构恢复到 1
   * （避免一次死亡）」＋「触发损管效果时需要消耗一份」＋改判「**1 秒内结构锁定 1**」）。
   *
   * 键 = 我方舰 tag（`player` / 僚舰 tag）：
   * - `lockUntilMs`：**结构锁定 1 点**的到点时刻（**游戏钟**；`≤ b.lastTickGameMs` = 已出窗）；
   *   窗口内每发入伤都被夹到"结算后结构 ≥ 1"（`combat.applyDcGuard`，逐段 ⇒ 同拍多段破不了）；
   * - `used`：本场是否已启动过（**每场一次**）。
   *
   * ⚠ **必须随档**（`save.ts` 登记表 persist）：本仓有 `hullEscapeFrac` 当年漏登记、
   * 导致"战中重载 ⇒ 保险凭空失效"的先例。
   */
  dc?: Record<string, { lockUntilMs?: number; used?: boolean }>;
  /** 本场损伤管制装置的启动次数（＝消耗的损管修理组件枚数；战报那一行读它） */
  dcKitsUsed?: number;
  /** ⚠ **已停用**（2026-09-11 改判：结束条件改'到达目标距离'，不再需要'进射程时刻 + 维持时长'）。
   *  旧档里可能留有该值，新码不再读写——保留字段声明只为不动存档形状。 */
  foeChargeEnteredAtMs?: number;
  /** 船体维修装置运行态（2026-09-09 船长定；零迁移可选——旧档缺省 = 本场无维修装置介入）。
   * 与弹药预载同哲学：开战把货舱（仓库兜底）中的对应修理组件移入 kits 账本，战斗中不可补给；
   * 每 REPAIR_PULSE_MS 一次脉冲，各台未停机装置修复装甲/结构并扣 1 枚组件，耗尽即停机；
   * 战斗结束未用组件退回仓库（见 combat.refundRepairKits）。
   * ⚠ **2026-09-16 起 = 主控那一份**（多舰战斗的逐舰账本见 `repairBy`；单船路径只有这一份）。 */
  repair?: BattleRepairLedger
  /**
   * **逐舰维修账本**（2026-09-16 船长裁定「甲」：「玩家反应，船体维修装置在虫洞里无效」
   * ⇒ 每艘参战船各自的装置、各自的组件、各自被修）。
   *
   * - 键 = 战斗 tag（含 `player`）；**只写真正装了装置的舰**；
   * - `repair` 仍是**主控那一份**（同对象引用 ⇒ 老读法/老档零迁移）；本字段存在时，
   *   脉冲、退款、战报一律**遍历本表**（旧档在途战斗没有本字段 ⇒ 退化成"只有主控修"，即旧行为）。
   */
  repairBy?: Record<string, BattleRepairLedger>
  /* ═══ 护盾充能装置（2026-09-14 船长：「护盾充能装置，和船体修理装置类似。每 15 秒恢复自身
     护盾最大值一定比例的护盾量。CPU消耗较多」）——与维修装置**独立计时**（30 秒 vs 5 秒）═══ */
  /**
   * 护盾充能快照：开战按装配写入（**2026-09-16 起逐舰**，见 `shieldChargeBy`；本字段 = 主控那一份）。
   * **它是破盾后唯一的回头路**：被动回充按当前盾比例（盾 0 ⇒ 回充 0），只有这里能从 0 把盾点起来。
   * 缺省 = 本场没装该装置（零行为变化）。
   */
  shieldCharge?: BattleShieldChargeLedger
  /**
   * **逐舰护盾充能账本**（2026-09-16：与维修装置同批逐舰化，键 = 战斗 tag、含 `player`）。
   * 缺省（老档在途战斗）⇒ 退化成"只有主控充能"，即旧行为。
   */
  shieldChargeBy?: Record<string, BattleShieldChargeLedger>
  /* ═══ 护盾充能力场装置（2026-09-20 船长：「新增高槽装备，护盾充能力场装置 MK2，为所有我方舰船
     恢复 10% 护盾，冷却时间 10 秒，MK3 的冷却时间缩短至 8 秒。有叠加惩罚」）——高槽 · 护盾族 ═══ */
  /**
   * **逐舰力场账本**（键 = 战斗 tag、含 `player`；与 `shieldChargeBy` 分开：机制不同 ⇒ 两套计时）。
   *
   * 与护盾充能装置的三点区别：① **受益方是全队**（不是只本舰）；② **冷却按件自带**
   * （MK2 = 10 秒 / MK3 = 8 秒，见 `msPerPulse`）；③ 同舰多件仍按 EVE 曲线收敛（"有叠加惩罚"）。
   * 缺省 = 本场没装该族件（零行为变化）。
   */
  shieldFieldBy?: Record<string, BattleShieldFieldLedger>
  /**
   * **敌方后勤账本**（船长 2026-09-16：「**敌人后勤舰则是将 50% 的自身DPS转换为修理值**」＋
   * 「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）。
   *
   * - **只在场上存在敌方后勤舰（`FoeShipDef.repairPct > 0`）时才建**（缺省 ⇒ 零开销、零行为变化）；
   * - 每 `REPAIR_PULSE_MS`（5 秒）一跳：每跳修理量 = `Σ 在场后勤舰(名义 DPS × repairPct × 5 秒)`，
   *   名义 DPS 取该单位**战斗中武器面板**的 `Σ 单发 × 1000 ÷ 装填`（不含命中/距离衰减）；
   * - 目标 = **非后勤**敌舰里三层剩余比例最低者（**永不指向任何 `repairPct > 0` 的敌舰，含自己**），
   *   不超过其满血、不耗组件；
   * - `healed` = 累计实际修好的点数（供战报/读数用）。
   */
  foeRepair?: { nextPulseAtMs?: number; pulses: number; healed: number }
  /**
   * **挂载件「船体修理装置」的逐单位脉冲账本**（船长 2026-09-24：「**给G族添加挂载件：船体修理装置。
   * 每5秒恢复5装甲和5结构**，会吃威胁的加成」；**同日二次令基数升为 15/15**）——键 = **战斗 tag**：
   * `{ nextPulseAtMs, pulses, healed }`，每 `everyMs`（5 秒）给**该单位自己**回
   * `round(15 × k)` 装甲与结构（各层夹满值），`k` = 本层本次实际威胁 ÷ 45（见 `UnitSpec.foeRepairPulse`）。
   *
   * **只在该单位真挂了这件时才建**（缺省不写 ⇒ tick 里那一块直接跳过 ⇒ 零开销、零行为变化）。
   * ⚠ **必须随档**（与 `foeRepair`/`repair`/`shieldCharge` 同款理由）：漏了会让战中重载后
   * 敌方修理计时重置 = **白赚一跳**（2026-09-20 护盾充能力场那次报障的同型坑）。
   */
  foeRepairPulses?: Record<string, { nextPulseAtMs?: number; pulses: number; healed: number }>
  /**
   * **挂载件「支援舰船召唤装置」的召唤计时**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的
   * 独立挂载件，只不过改为**复活被摧毁的友军**（但是表现形式上为**敌方支援舰船入场**），
   * **增援时间是60秒**，**每次随机复活一艘**」）：
   * - `foeReviveAtMs` = **下一次该召唤的战斗时钟**（毫秒；首次基准 = 召唤者入场那一刻，
   *   见 `UnitSpec.foeReviveEscort`）；到点即召唤一艘并推进一格；
   * - `foeReviveCount` = 本场已召唤次数（支援舰 tag 序号 `sup{n}-<原tag>` 与日志"第 N 次支援"都用它）。
   *
   * **只在该单位真挂了这件时才写**（缺省不写 ⇒ 零行为变化、零随机数消费）。
   * ⚠ 与 `foeRepairPulses` 同款理由**必须随档**：漏了会让战中重载后召唤计时重置 = 白赚一次支援。
   */
  foeReviveAtMs?: number
  /** 本场已召唤的支援舰数（见 `foeReviveAtMs`） */
  foeReviveCount?: number
  /* ═══ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制；零迁移可选） ═══ */
  /** 逐架生存池：键 = **`舰tag:武器条目下标`**（仅 src='drone' 的条目）；开战由 startBattleFor /
   *  startFleetBattleFor **逐舰**写入（2026-09-14 船长「逐舰机群」）。
   *  ⚠ 键在 2026-09-14 前是**纯数字**（下标，只有主控）——老档由 `save.ts` 归一成 `player:<下标>`。
   *  缺省 = 本次改动前已在进行的战斗（照旧打完，不折损） */
  dronePools?: Record<string, DronePoolEntry>;
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
   *
   * ⚠ **两侧故意不对称**（船长 2026-09-16 复核定论「**点防没问题**」）：
   * · **我方侧 = 逐舰令牌**（2026-09-16 逐舰版 `droneHitAtMeBy`；本字段的 `me` 只服务"该改动之前开的在途战斗"）；
   * · **敌方侧 = 全队共用**（`foe`：打到**任意一艘**敌舰 ⇒ 全队点防舰在各自冷却就绪时各还手一次）。
   *   ⇒ **不许**照"逐舰"把敌方侧也改过去（那会动玩家无人机在多舰敌卡里的战损口径）。
   */
  droneHitAt?: { me?: number; foe?: number };
  /**
   * **反应式防空 · 我方逐舰令牌**（2026-09-16 船长「将缺少的一并实现」）：
   * 键 = **被打的我方舰 tag**，值 = 该舰最近被敌机打的战斗时钟。
   *
   * 为什么要有它：旧口径 `droneHitAt.me` 是**全队共用一个令牌**，且一次反击就消费掉
   * ⇒ 4 舰编队里**整队每轮只换到一发反击**，僚舰的近防炮基本沉默。逐舰后每艘船**各自**
   * 在"自己挨了机群打"的窗口内还手（与"点防逐舰挨打"同源）。
   * 缺省（本改动之前开的在途战斗）⇒ 回退读旧字段 = 旧的"全队一个令牌"行为（零迁移）。
   */
  droneHitAtMeBy?: Record<string, number>;
  /**
   * **敌机受击增程**（2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）
   * ——值 = 生效的**射程倍率**（E 族三条舰级 = **4**：警戒机 5,000 → 20,000m）。
   *
   * ⚠ **全敌队一次生效**（船长二次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
   * **只触发一次**，**对所有敌舰生效**」）：任一"带该机制的敌舰"被命中 ⇒ 标记**整支敌队**，
   * 此后**所有敌舰的机群**都吃到倍率（不是逐舰各算一份）。故这里是**标量**而非按 tag 的表，
   * 且**只会在 1 → 倍率 时推一条画面提示**（不重复）。
   * 触发 = **舰体被命中一次**（打机群不算）；**本场永久**、**不封顶**；缺省 = 未触发（零行为变化）。
   */
  foeDroneRangeBuff?: number;
  /**
   * **敌舰炮台受击增程**（2026-09-12 船长：「给 D 族静滞卫舰加入类似 E 族挨打加炮台射程的效果，
   * 不过**仅影响所有静滞卫舰**。挨打后射程增加 50%」）——值 = 生效的**射程倍率**（静滞卫舰 = **1.5**：
   * 12,000 → **18,000m**）。
   *
   * ⚠ **与 `foeDroneRangeBuff` 是两套独立状态**（互不覆盖、可同时存在）：
   * - 那条作用于"**整支敌队的机群**"；本条**只作用于带 `foeGunRangeMulOnHit` 的敌舰**（= 所有静滞卫舰），
   *   同场的其它舰级（守墓长舰等）**不受影响** —— 这正是船长「仅影响所有静滞卫舰」的落点；
   * - 触发同为"**舰体被命中一次**"（打机群不算、未命中不算），**只推一条**画面提示、**本场永久**；
   * - 口径（船长选乙）：只延长**最远射程**、近界不动，**原射程内读数一字不变**、延长段按同斜率衰减。
   */
  foeGunRangeBuff?: number;
  /**
   * **我方电子舰对敌舰射程的削减率**（船长 2026-09-18：「电子舰新增特性，**削减敌人15%的武器射程**，
   * 可以乘法叠加，与敌人的射程增加效果做加法处理…射程最短只能削弱到3000m」）。
   *
   * 值 = 编队合成的**削减率** `r = 1 − Π(1 − vᵢ)`（电子舰 1 艘 0.15 · 2 艘 0.2775 …，见
   * `combat.foeRangeDebuffOf`）；与敌方"射程增加"**做加法**：净倍率 = 增程倍率 − r；
   * **基础射程 < 3000m 的不削**、削后**下限 3000m**（`FOE_RANGE_DEBUFF_FLOOR_M`）。
   *
   * ⚠ **运行态、不随档**：战斗建档与**每拍**各重算一次（读档/中途换编队都不会陈旧）。
   * 消费方只有两处（既有单一真相源）：`combat.foeGunMaxRangeOf`（舰体武器）与
   * `combat.foeDroneRangeOf`（敌方机群）——开火门 / 距离衰减 / 界面射程标签全部自动跟随。
   * 缺省 = 不削（没带电子舰的编队逐字不变）。
   */
  meFoeRangeDebuff?: number;
  /**
   * **战斗内提示条**（2026-09-11 船长二次裁定：「**日志内不用显示提示，将该提示放入战斗画面内显示**
   * （和**敌方增援**统一下系统，**显示位置改为战斗窗口正上方**）」）。
   *
   * 与「敌方增援」共用画面顶部那一条提示位：逐条带 `atMs`（战斗时钟）供 UI **限时显示后自动消失**
   * （不像日志那样永久留档）。只保留最近 4 条（`pushBattleNotice`）。
   * 缺省 = 本场没有提示（零行为变化）。
   */
  notices?: Array<{ atMs: number; text: string }>;
  /** 本场已击落架数（机型 id → 架数，**全队合计**）；结算时按此**永久扣除**无人机舱清单 */
  droneLost?: Record<string, number>
  /** **逐舰战损**（2026-09-14 船长「战损按舰归属」）：`舰tag → (机型 id → 架数)`。
   *  `droneLost` 仍是全队合计（老口径不破：战报汇总 / "战损过半"判定都读它）；
   *  本字段供**按舰结算**（各自扣各自的机舱清单）与按舰战报。**可选**：老档没有 ⇒ 全部算主控。 */
  droneLostBy?: Record<string, Record<string, number>>
  /** 近防炮调度（当前波）：每舰判定冷却剩余毫秒（与敌编队同序）；缺省 = 无近防炮 */
  pdCd?: number[]
  /** **近防炮集火锁定**（2026-09-12 船长「改为集火制度」）：每艘点防舰当前锁定的**机群池键**
   *  （与敌编队同序；`undefined` = 未锁定/目标已灭/换了目标舰 ⇒ 下一拍重选）。
   *  ⚠ 2026-09-14「逐舰挨打」起，键 = `舰tag:武器下标`（**锁到的是"哪条舰的第几架"**；
   *  此前是纯数字下标）。**可选字段**：旧档/旧战斗没有它 ⇒ 行为 = 每拍按优先级重选（**零迁移**）。 */
  pdFocus?: Array<string | undefined>
  /**
   * **我方近防炮集火锁定**（2026-09-12 船长「改为集火制度」+ P-40 乙案「我方侧口径对齐」）：
   * 按**我方武器槽**（`wi`）存当前锁定的敌机（`tag` + 该舰机群池下标），锁定到目标被击落才换靶
   * —— 与敌方侧 `pdFocus`（按点防舰同序）**同一口径**，只是索引轴不同。
   * **可选字段**：旧档/旧战斗没有它 ⇒ 行为 = 每拍按优先级重选（**零迁移**）。
   *
   * ⚠ **2026-09-16 起由 `mePdFocusBy` 取代**（逐舰版，见下一条）：本字段只按"武器下标"存，
   * 多舰战斗里各舰的 0 号武器**共用同一个槽位** ⇒ 互相顶锁（僚舰锁定的敌机会把主控的锁顶掉）。
   * 保留声明只为"本改动之前开的在途战斗"读取（运行态字段，不随档）。
   */
  mePdFocus?: Array<{ tag: string; idx: number } | undefined>
  /**
   * **我方近防炮集火锁定（逐舰 · 2026-09-16 船长「将缺少的一并实现」）**：
   * 键 = **`舰tag:武器下标`**（`dronePoolKey`），值 = 该武器当前锁定的敌机（`tag` + 该舰机群池下标）。
   * ⇒ 每艘船的每门近防炮**各锁各的**，不再互相顶锁。缺省 = 每拍按优先级重选（零迁移）。
   */
  mePdFocusBy?: Record<string, { tag: string; idx: number }>
  /**
   * **我方近防炮"这次挨打已经还过手"的逐门记账**（2026-09-17 修玩家报障：「**多个近防炮对无人机的伤害
   * 不叠加，同时装MK2和MK3只有一个开火**」）：
   *
   * 键 = **`舰tag:武器下标`**（`dronePoolKey`，与集火锁同键），值 = 该门武器**已经还过手的那次挨打时刻**
   * （= `droneHitAtMeBy[舰tag]` 的取值）。语义：一次敌机攻击（一枚令牌）⇒ **本舰每门近防炮各还手一次**；
   * 旧口径把整舰令牌"第一门就删掉" ⇒ 同拍其余门全拿到 null（装 3 门与装 1 门开火发数相同）。
   * 窗口过期仍由 `PD_REACTIVE_WINDOW_MS` 判断兜底 ⇒ 不会退回"一直开火"。
   * **运行期字段、有意不入档**（跨拍记账，见 `save.ts` 登记表）。
   */
  mePdAnsweredBy?: Record<string, number>
  /** 开战时的机群清单快照（机型 id → 架数；用于战后判定"机群战损过半"→ 停重复清剿）
   *  ⚠ 2026-09-14 起**只是主控那份**（老字段，兼容保留）；逐舰快照见下一条 */
  droneLoadAtStart?: Record<string, number>
  /** **逐舰机群清单快照**（2026-09-14 船长「逐舰机群」）：`舰tag → (机型 id → 架数)`。
   *  读不到该字段的老档 ⇒ 只有主控那一份（`droneLoadAtStart`）。 */
  droneLoadAtStartBy?: Record<string, Record<string, number>>
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
  /**
   * **补货前的存活架数**（船长 2026-09-20「战斗结束立刻自动补充机群」那一批）——
   * 战后立刻补足会把清单补回本场出发时的编制，故"战损过半停环"的记账与判定必须读这里，
   * 不能读补货后的清单（否则安全阀永远判不出来）。
   */
  survivors?: number
  /** 逐型明细（按机型价值降序） */
  rows: Array<{ id: string; name: string; value: number; lost: number; back: number; gone: number }>
}

/**
 * **战报来源**（2026-09-14 船长定：战报改造）。
 * 只用来给界面选措辞（战场在哪 / 谁打的），**不参与任何数值**。
 */
export type BattleReportSource = 'expedition' | 'encounter' | 'wormhole' | 'ai'

/**
 * **中止原因**（`outcome === 'break'` 时给；四档判定的"脱离"那一档都归它）。
 * 与 `BattleState.escapeReason` 同一套语汇，另加 `'manual'`（玩家主动撤退：
 * 同属"未分胜负就中止"，故判定词仍是「脱离」，只是原因更准）。
 */
export type BattleBreakReason = 'hull' | 'timeout' | 'cannot-engage' | 'manual'

/**
 * **一场战斗的结构化战报**（2026-09-14 船长定 · 战报改造）。
 *
 * ⚠ **为什么要有它**：战报弹层的正文原先靠"在事件日志里找含『战报』二字的那条"取
 * （`battleViewCore.lastBattleReport` 的字符串匹配）—— 而**洞内战斗**写的是
 * 「🕳 第 N 层…交火结束：…」、**低安遭遇**写的是「★ 遭遇战大捷（…）」、**无法交战**写的是
 * 「⚔ 无法交战（…）」，**三条都不含『战报』** ⇒ 那三类战斗的弹层**永远取不到正文**，只剩兜底句。
 * 而且标题只看胜负（`ended === 'me'`）⇒ **沉了船也写「大捷」**、卡片上根本没有"损失"这一行。
 * 现在改为：**引擎在结算时写这一份结构**（唯一构造点 `combat.captureBattleReport`），
 * 弹层直接读它；判定词由纯函数 `combat.battleVerdictOf` 出（**纯函数才进得了用例** —— 渲染层
 * 没有测试运行器，上一轮的弹道 bug 就吃过这个亏）。
 *
 * **不落档、零迁移**（照 `droneLossReport` / `wormhole.lastSettle` 惯例）：老档读到 `undefined`
 * ⇒ 弹层回落成原来那句兜底话，行为安全。
 * **并行战斗不串场**：靠 `battleStartedAtGameMs` 与弹层快照配对（AI 副船的战斗也会写一份）。
 */
export interface BattleReportRecord {
  /** 该场战斗的起手时刻（与弹层快照配对；不匹配 = 不是这一场，弹层回落兜底） */
  battleStartedAtGameMs: number
  /** 来源：悬赏远征 / 低安遭遇 / 虫洞 / AI 副船 */
  source: BattleReportSource
  /** 胜负：`win` 胜 · `lose` 负（我方全灭，含弃船）· `break` 未分胜负就中止 */
  outcome: 'win' | 'lose' | 'break'
  /** 中止原因（仅 `outcome === 'break'`） */
  breakReason?: BattleBreakReason
  /** 交火时长（ms） */
  durMs: number
  /** 双方开火/命中/伤害（与 `battle.stats` 逐字同源） */
  stats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number }
  /** **我方沉没的舰船**（显示名；判「惨胜」的唯一依据之一） */
  shipsLost: string[]
  /** **我方逐单位三层残余**（当前值 + 上限；顺序 = 主控在前、僚舰按编队） */
  myUnits: Array<{ name: string; s: number; a: number; h: number; sMax: number; aMax: number; hMax: number }>
  /** **敌方残余**：存活单位数 / 参战单位总数 / 残余血量比（`hpMax` 为分母） */
  foe: { alive: number; total: number; hpFrac: number }
  /** **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——去重后的展示名列表；
   *  `undefined`/空 = 本场敌人没挂任何件（老档同样缺省 ⇒ 战报回落不显示这一行） */
  foeMounts?: readonly string[]
  /** **同序的「双语名对」**（2026-09-24；与 `foeMounts` 下标对齐）——战报按当前语言挑一列 */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /** **本场弹药消耗**（按弹种；= 开战预载 − 战后余额，四类战斗都算得出） */
  ammoUsed: { kin: number; exp: number; pla: number }
  /** **机群净损失架数**（判「惨胜」的第二个依据；0 = 无损或本场没有机群） */
  dronesGone: number
  /** **本场引擎写的那条日志原文**（弹层正文用它 ⇒ 卡片与日志同源，不再靠字符串匹配） */
  summary: string
  /**
   * 甲案（2026-09-20）：战报正文的**首段文案 id + 参数**（含后续段的 `p{n}Id` 绑定）。
   * 有它 ⇒ 弹层按当前语言渲染；没有（老档 / 未改造来源）⇒ 回退 `summary` 中文原串。
   */
  summaryId?: string
  summaryParams?: Readonly<Record<string, string | number>>
}

/** 单架无人机的战斗生存池（开战自机型 DroneDefense 写入；被点防打空即击落）
 * 装备模块阻力/回避随池携带——战斗跨会话续算不依赖当时的仓库/装配状态 */
export interface DronePoolEntry {
  /** **所属舰的 tag**（`player` / `ally-1`…；2026-09-14 船长「逐舰机群」）——与池键前缀同源，
   *  冗余存一份便于按舰分组（点防选靶 / 战报 / 损失归属）。老档缺省 = `player`。 */
  owner?: string
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
  /**
   * **在库待补**（2026-09-12 船长「给敌机添加备用机库（损坏后补充敌机）」）：
   * `true` = 本架是**备用机**，尚未放飞（不开火、不出战、不算存活架数）；
   * 前线战损后由 `readyAtMs` 到期翻成 `false` 并**满血补位**（`s/a/h` 在翻牌时重置）。
   */
  inHangar?: boolean
  /** 备用机的**补位时刻**（战斗时钟 ms；仅在 `inHangar` 期间有意义） */
  readyAtMs?: number
  /** 本架**满血三层值**（建池时写入；备用机补位时按此**满血**放出——2026-09-12） */
  maxS?: number
  maxA?: number
  maxH?: number
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
  /**
   * **本台装置自己的下一脉冲时刻**（战斗时钟 ms；**2026-09-21 船长令：逐型号独立回转**——
   * 「**哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」）。
   *
   * 逐台一份 ⇒ 同舰装「民用级（5 秒）+ MK2（5 秒）」时**各自按自己的节奏跳、各修各的量**；
   * 若日后给某档定更长的脉冲间隔（本字段就是那个入口），它也只影响那一档。
   * ⚠ **旧档（2026-09-21 之前的在途战斗）没有本字段** ⇒ 那些装置在 `advanceBattleFor` 的
   * 逐台循环里走"借账本那一个 `nextPulseAtMs`"的迁移分支（见那里的注释）。
   */
  nextPulseAtMs?: number
}

/**
 * **一条维修装置账本**（2026-09-16 船长裁定「甲：逐舰维修」）——**每艘参战船各一份**：
 * 键 = 战斗 tag（`player` / `ally-1`..），值 = 本账本。组件从**本舰自己的货舱**优先装载
 * （老口径取的是驾驶船货舱 ⇒ 僚舰的组件来源被记到主控头上，本批一并改正）。
 */
export interface BattleRepairLedger {
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
  /** **逐型**累计消耗（item id → 枚数；2026-09-11 船长「只将消耗组件数量显示到战后总结」）——
   * 战报按此写「消耗 军用修理组件 ×12」；旧档缺省 = 空账本（战报退化为只报总数） */
  kitsUsedByType?: Record<string, number>
}

/**
 * **一条护盾充能账本**（2026-09-16 逐舰化；与维修装置各按各的计时：30 秒 vs 5 秒）。
 *
 * ⚠ **2026-09-21 结构改判**（船长「不同型号就要独立的回转冷却」）：原先是
 * `{ pctPerPulse, nextPulseAtMs, pulses }`（同舰 MK1+MK3 并成一路合计值）⇒ 现改为**逐型号多路**，
 * 与力场账本同形（`BattleShieldFieldStream`；间隔由本族常量 `SHIELD_PULSE_MS` 定，故流里只存型号与比例）。
 */
export interface BattleShieldChargeLedger {
  /** 逐型号的脉冲流（**每路一个计时器**；空数组 = 没装该族件、不调度） */
  streams: BattleShieldFieldStream[]
  /** 累计脉冲次数（各路线求和；战报/读档续战用） */
  pulses: number
}

/**
 * **一路脉冲流**（= **一个型号**的装置）：每路**各自计时**、各按各的间隔跳。
 *
 * **2026-09-21 船长令**：「**哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」⇒ 三类周期脉冲
 * 装置（力场 / 护盾充能 / 船体维修）的"同舰多件"从"一路合计值、取最短间隔"改为**逐型号多路**：
 * MK2 与 MK3 各是一路，各按 10 秒 / 8 秒跳，各补各的比例。
 *
 * 叠加衰减**不受此影响**：收敛池仍按**全族**合并（同一次装配里第 n 件按 EVE 曲线折减，与型号无关，
 * 见 `equipment.stackingOf` 的 `decayGroup`）——所以 `pct` 里已经含了该型号自己被折掉的那部分。
 */
export interface BattleShieldFieldStream {
  /** **型号 id**（= `ModuleDef.id`；逐型号独立计时的键，也是界面/战报的引用） */
  modelId: string
  /** 本路每跳的补盾比例（**各受益舰自己满盾**的几分之几；已含全族衰减） */
  pct: number
  /**
   * **本型号自己的脉冲间隔**（ms；力场 MK2 = 10 000 · MK3 = 8 000；护盾充能 = `SHIELD_PULSE_MS` 15 000）。
   * ⚠ 逐型号自带是**船长 2026-09-21 令**的形状要求（"不同型号独立回转"）——日后给某档定不同间隔
   * 只需改数据侧，本字段与调度逻辑都不用动。
   */
  ms: number
  /**
   * **本路自己的下一脉冲时刻**（战斗时钟 ms；开战 = `startedAtGameMs + 本型号间隔`）；
   * 缺省/坏值 = 不调度（由 `advanceBattleFor` 在首个到期拍按本族间隔现补）。
   */
  nextPulseAtMs?: number
}

/**
 * **力场账本**（2026-09-20 船长「护盾充能力场装置」；与 `BattleShieldChargeLedger` 分开存，
 * 因为**冷却按件**、且受益方是**全队**）。
 *
 * ⚠ **2026-09-21 结构改判**（船长「不同型号就要独立的回转冷却」）：原先是**一台一个账本**：
 * `{ pctPerPulse, msPerPulse, nextPulseAtMs, pulses }` —— 同舰 MK2+MK3 被并成"一路 8 秒合计值"。
 * 现改为**一台多路**：`streams[]` 每路一个型号、各带自己的计时器；`pulses` 为各路线总计数（战报用）。
 */
export interface BattleShieldFieldLedger {
  /** 逐型号的脉冲流（**每路一个计时器**；空数组 = 没装该族件、不调度） */
  streams: BattleShieldFieldStream[]
  /** 累计脉冲次数（各路线求和；战报/读档续战用） */
  pulses: number
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
  /** **买单预扣**（2026-09-11 船长裁决「甲：改成 EVE 式预扣冻结」）：挂单时从钱包扣下的
   *  `挂价 × 剩余数量`，成交时按**实际成交价**结算并把价差退回钱包，撤单全额退回。
   * 仅买单使用；卖单冻结的是货（`escrowItems`/`escrowShips`）。旧档缺省 = 0（历史未预扣的遗留单按旧口径成交） */
  escrowIsk?: number
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
   *  v17 起含 defId/customName，恢复时不丢船型与自定义名）
   *  `from`（2026-09-14 新增，可选）：这单是从哪儿卖出去的——`'fleet'`（舰队实例，缺省，撤单退回机库）
   *  或 `'store'`（舰船仓库的计数船，撤单退回舰船仓库）。老档缺省 = `'fleet'`（零迁移）。 */
  escrowShips: Record<
    number,
    { shipId: string; defId: string; durability: number; customName: string | null; from?: 'fleet' | 'store' }
  >
  /** 已学会配方（蓝图消耗品：学会后可无限制造） */
  learnedRecipes: string[]
  /**
   * **一次性图纸"名额已用尽"**（2026-09-12 船长定）：开工时消耗一本一次性书 ⇒ 该配方进本表，
   * 之后**必须再有一本一次性书**才能再开工（不写 = 还有名额）。
   * 与 `learnedRecipes` 分开存：一次性配方**永不可学习**，只是"这一门只能用一次"。
   * 兼容字段：老档缺省 = 空（零迁移）。
   */
  spentOneTimeRecipes?: string[]
  /**
   * **残骸回收的"不足 1 单位"余额**（2026-09-14 船长改判「按价值比例产出所有矿物」后必需）：
   * 新模型下各矿物的单位数 = `该批保底价值 × 价值占比 ÷ 单价`，**必然出小数**（例：危档冥铁 0.02 单位/批）
   * ⇒ 把不足 1 的部分按矿物累计在本表，够 1 才入库（玩家只看到整数；长期总价值精确、不因取整蒸发）。
   * 兼容字段：老档缺省 = 空（零迁移）。
   */
  recycleCarry?: Record<string, number>
  /** 持有的蓝图书：蓝图 id -> 数量（可学习或挂卖） */
  blueprintStock: Record<string, number>
  /**
   * **舰船仓库**（2026-09-14 船长：舰队页的「舰船市场」换成「舰船仓库」，所有组装机生产的舰船入仓，
   * 允许同型**堆叠计数**；仓里的船一律是"全新"：满耐久 · 无装配 · 货仓空 · 无自定义名）。
   * 用途（船长原话）：「舰船仓库是用于方便市场出售舰船的」⇒ 仓里的船可直接在市场挂卖
   * （`market.sellStoredShipAtMarket`），舰队 ↔ 仓库双向转移见 `shipyard.storeShip` / `unstoreShip`。
   * 兼容字段：老档缺省 = 空（**零迁移**）。
   */
  shipStore?: Record<string, number>
  /**
   * **装配方案（预设）**（2026-09-14 船长：装配页可「保存当前装配 / 套用预设」，入口在「装配目标」栏右侧）。
   * 归口 = **船型 id**（`defId`）：同型号任意一艘都能套用；每型上限 `FIT_PRESET_MAX`（**现 10**，2026-09-17 船长「上限拓展到10套」）。
   * `fitted` 逐位存模块 id（尾部空位已裁），`droneLoad` 与舰船实例同结构；
   * 套用语义（先卸光再装 · 尽力装 + 逐条提示）与结果清单见 `fitPresets.ts`。
   * **兼容字段：老档缺省 = 空 · 零迁移 · 不升版本**（与同日 `shipStore` / `wormholeScan` 同款落法：
   * 可选字段 + 归一化清洗 + 缺省不写键 ⇒ 老档往返逐字一致）。
   */
  fitPresets?: Record<string, ShipFitPreset[]>
}

/** 一套装配方案（存"哪一位装什么 + 无人机舱装载"；套用时按目标船槽位布局对齐，超出位丢弃） */
export interface ShipFitPreset {
  name: string
  fitted: { high: Array<string | null>; mid: Array<string | null>; low: Array<string | null> }
  droneLoad?: Record<string, number>
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
  /** 势力声望（**2026-09-26 起 = 可支配那一本**：只有「章鱼人兑换」扣它） */
  standings: Record<string, number>
  /**
   * **累计获得的势力声望**（**2026-09-26 船长令**：「**其他所有的声望门槛都改为看获得了多少声望总数**」）。
   *
   * - **只增不减**（获得时 +v，兑换扣的是 `standings` 那一本）⇒ 兑换不会把已解锁的门槛重新锁上；
   * - **全仓所有门槛读它**（唯一入口 `expedition.standingOf`）；
   * - 兼容字段无版本号：老档缺省由 `save.normalizeState` 回填成 `max(旧声望, 已清卡面 standingGain 之和)`。
   */
  standingsEarned?: Record<string, number>
  /**
   * **见过黑匣没有**（**2026-09-26 船长令**：「**玩家获取第一个黑匣后，才解锁组装机的插件选项，
   * 并且弹出相关通讯**」）。
   *
   * 三态：`true` = 已经拿到过（组装机插件档解锁、通讯已发）；`false` = 本功能之后开的新档、还没拿到；
   * `undefined` = 老档 ⇒ 读档时按"仓库里有没有黑匣"回填（见 `plugs.blackboxSeenOf`）。
   */
  blackboxSeen?: boolean
  /** 远征作业 */
  expedition: ExpeditionState
  /**
   * **终局玩法「虫洞」副本状态**（v25 = v24 + 本字段；2026-09-13 开工）。
   * ⚠ 施工期铁律（船长）：**虫洞完成前对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），
   * 完成后由船长拍板才上线。老档缺省 = `{ run: null, lastFleetLost: 0 }`（零迁移）。
   */
  wormhole: WormholeState
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

/**
 * 扫描探索作业状态（V13：就地深空扫描，去程已取消；窗口完成 → 点亮并**当场收尾**）。
 *
 * **2026-09-15 船长定案（「玩家扫描星系将不再占用玩家的主控活动」）**：扫描 = 派出一艘**无人深空扫描艇**
 * ⇒ **不占主控、不牵动舰船**：本状态与 `state.awayGalaxy` / `state.dockedSite` / 主控活动互斥**全部脱钩**，
 * 也不再有自己的"返航段"（`returning` 由运行时恒置 false；老档的返航段由 `save.normalizeState` 一次性收口）。
 * 顶部活动栏（`ActivityBar`）不再把它列进"玩家活动"，改为在 AI 徽标右侧显示一条进度条。
 */
export interface ScanningState {
  active: boolean
  /** 目标星系 id（扫描对象永远是"已探索星系的一跳邻居"，即星图剪影） */
  galaxyId: string | null
  /** 当前段完成的游戏内时刻（毫秒，出发时锁定） */
  finishAtGameMs: number
  /** 当前段开始时刻（毫秒） */
  startedAtGameMs: number
  /** T8 兼容字段：扫描的出发星系——2026-09-15 起无人扫描艇不涉及出发地 ⇒ 恒 `null`（读档保留旧值供老档辨认） */
  originGalaxy: string | null
  /** 2026-09-06 兼容字段：窗口已完成、正在自动返航（2×单程）。**2026-09-15 起返航段取消** ⇒ 运行时恒 false */
  returning?: boolean
  /** 2026-09-15 船长：窗口完成 ⇒ `true`（顶部扫描条留格高亮「已完成」）；玩家进「星图」看过即清
   *  （`explore.ts` 的 `acknowledgeScanView`）。可选字段 + `save.ts` 归一 ⇒ **零迁移** */
  awaitingView?: boolean
  /** 本次完成点亮的星系 id（待查看态的提示文案用；清位后保留最后一次，便于提示"查看：XX"） */
  lastGalaxyId?: string | null
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
  /**
   * **实例通讯**（2026-09-25 加 · 周末入侵两封）：静态表装不下的信——正文带**本场数字**、
   * 且**每场重写同一个 id**（船长令：「每场都发，但是覆盖上一次的」）。
   * 键 = 通讯 id（固定）· 值 = 一条完整条目（正文/文案 id/参数/结构化奖励清单都在里面）。
   * 收件箱把它与表消息**合并渲染**；送达记账仍走 `commsDelivered`（同一套幂等与时间列）。
   * 可选字段 ⇒ 零迁移。
   */
  commsInstance?: Record<string, CommsInstanceEntry>
  /**
   * **上一场周末入侵的战果快照**（2026-09-25 加）：结束时写一次、**每场覆盖**。
   * 结算面板（点通讯里的跳转弹出）与结算通讯的正文都读它——下一场开局会把 `weekendEvent` 整条换掉。
   * 可选字段 ⇒ 零迁移（老档 = 没打过入侵 ⇒ 没有面板可看）。
   */
  weekendLastResult?: WeekendResultSnapshot
  /**
   * **旗舰战的参战编队**（2026-09-25 加 · 船长令做「战前准备界面」）：玩家上一次在准备界面选的舰船列表
   * （舰队实例 uid）。下次进准备界面默认勾选它；开战前一律过 `weekendSanitizeFlagshipSquad`
   * （只认在编船只 · 去重 · 截 4 艘）⇒ 旧档残 id 不会把战斗打崩。可选字段、**空数组不落键** ⇒ 零迁移。
   */
  weekendPrepSquad?: string[]
  /**
   * **需要直接弹窗的通讯 id 队列**（2026-09-14 船长：「解锁时发送通讯给玩家（**同时也要直接弹窗**）」）。
   * 送达标了 `popup: true` 的消息时入队；界面弹一次、点「知道了」调 `dismissCommsPopup` 清掉。
   * 兼容字段（可选）⇒ 零迁移；界面只弹队首那一封。
   */
  commsPopups?: string[]
  /**
   * **因低安袭击自动撤离**（2026-09-14 船长定：新通讯 `msg-ambush-retreat` 的触发面）。三态：
   * - `true` = 真发生过（被袭船收手返港待命 / 应战中途结构过半自动脱离交火）⇒ 发信；
   * - `false` = **新档**（本功能之后开的局，由 `createInitialState` 写入）⇒ **只等真撤离**，不补发；
   * - **缺失 = 老档**（本功能上线前写的档）⇒ 船长裁定「老档补发，但**要判断玩家是否触发过**」：
   *   老档没有事件记录可查，故用**可查的最强痕迹**判定 —— `encounterZoneCooldown` 非空
   *   （只在伏击真的命中时写入、写后不删、随档保存）⇒ 该档确实被伏击过才补发。
   * ⇒ 本字段**按三态随档**：`false` 必须落键（省掉它会被读成老档），缺失保持缺失（老档待判）。
   */
  ambushRetreatSeen?: boolean
  /**
   * **造出第一艘自造船**（2026-09-15 船长定：新通讯 `msg-first-ship` 的触发面）。三态：
   * - `true` = 组装机交出过至少一艘自造船（主控亲手开线与 AI 核心代造同算）⇒ 发信；
   * - `false` = **新档**（本功能之后开的局，由 `createInitialState` 写入）⇒ **只等真建造**；
   * - **缺失 = 老档**（本功能上线前写的档）⇒ 船长三问裁决选「**丙**」：**读档即补发**。
   * ⇒ 本字段**按三态随档**：`false` 必须落键（省掉它会被读成老档而错误补发），缺失保持缺失。
   */
  /**
   * **见过的敌方舰级**（键 = `FoeShipDef.id`；船长 2026-09-16：「在玩家第一次遭遇劫掠电子舰之后…发一封通讯」）。
   * 置位点 = 开战扫描该场敌卡的编成（`combat.noteFoeShipsSeen`，洞内洞外同一处出口）⇒ 与"这卡有没有它"同源。
   * **缺失 = 老档** ⇒ 视为没遇过（新舰上线后才可能置位，无需补发逻辑）。
   */
  foeShipSeen?: Record<string, true>
  firstShipBuilt?: boolean
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
   * **再开重复清剿的机群前置**（船长 2026-09-18：「战损/耐久未恢复则先挡住」）：
   * 因「机群战损过半」停环时记下**当时的机群装载架数**；再开时要求当前装载**严格大于**它（确实补过货）。
   * 其余停环原因把它清成 null（不套这条）。随档、可选、零迁移。
   */
  autoLoopDroneFloor?: number | null
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
   * **最近一场战斗的结构化战报**（2026-09-14 船长定 · 战报改造；见 `BattleReportRecord` 的注释）。
   *
   * **不落档、零迁移**（同 `droneLossReport` / `wormhole.lastSettle` 模式）；由四个结算点各写一次
   * （`combat.captureBattleReport` 是**唯一构造点**），弹层用 `battleStartedAtGameMs` 与自己的
   * 快照配对 ⇒ 并行战斗（AI 副船）不会串场。
   */
  battleReport?: BattleReportRecord | null
  /**
   * 2026-09-13 星云机制一次性提示（船长：「这个机制在玩家第一次下到四层时提示玩家」）：
   * 第一次深入第 4 层时由 `wormholeDescend` 写入 ⇒ 心跳读取即清并提示
   * （同 `droneLossNotice` 模式：**不落档、零迁移**）。
   * 跨趟的"只提示一次"由随档的 `wormhole.nebulaHintShown` 保证。
   */
  nebulaHintNotice?: string | null
  /**
   * 2026-09-10 玩家标记（收藏）：四类界面各自一份 id 清单，被标记项在**默认排序**下置顶
   * （2026-09-10 船长定：舰队等有排序下拉的列表只在「默认排序」生效）。
   * 兼容字段、零迁移、不升版本号：老档缺省 = 四类全空，由 normalizeState 补默认并剪枝。
   */
  marks: MarksState
  /**
   * 2026-09-11 稀有残骸保底（船长：「每 20 次必定掉的保底」→ 口径甲：只保底派系活跃掷骰链）：
   * **连续掷骰未出**的次数（0 = 上次出货或尚未开始）。派系活跃胜利时 +1，命中/保底/窝点掉落清零。
   * 可选字段、零迁移：老档缺省 = 0（从零开始攒）。
   */
  rareWreckDryStreak?: number
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
  /** 本段标称航程分钟（出发时锁定）；航段真实分钟 = 本值 × HAUL_LEG_TIME_MUL（15） */
  legMinutes: number
  /** 本段真实航程毫秒（出发时锁定；吃航行技能与调试 1 秒快进） */
  legMs: number
  /** 本段已航行毫秒 */
  phaseAccMs: number
  /** 本趟行情倍率（2026-09-11 船长：每趟掷一次 5~10 倍、两段同价；0 = 旧档未掷，结算按区间下限兜底） */
  tripMul: number
  /** 本趟还剩几段（一趟往返 = 2；就位段自成一趟 = 1；≤0 时下一段起换新行情） */
  tripLegsLeft: number
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
  tripMul: 0,
  tripLegsLeft: 0,
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
  /**
   * **敌群真·强度倍率**（2026-09-25 船长令：周末入侵的遇袭「**遭遇的敌人按强度\*0.75算**」）：
   * 应战时传进 `combat.FoeOverride.strengthMul`（缩放 `hpMul`/`dmgMul`）。
   * 普通低安遭遇 / 旧档 = 缺省 ⇒ 不缩放（**零行为变化**）。
   */
  foeStrengthMul?: number
}
/** B3 星系残骸记录（2026-09-05；密度模型见 docs/design/b3-salvage.md）：
 * density = 当前残骸密度（无记录 = 基础密度，由 security 推导不入档）；
 * rare = 稀有残骸计数（2026-09-10 启用：赏金任务窝点战利品，打捞必出 → 精炼炉开"高级箱"）。 */
export interface WreckGalaxyRecord {
  density: number
  rare: number
  /**
   * **分组份额账**（**2026-09-26 船长令**：「**玩家打捞时，让玩家选择打捞对象，包括多族悬赏混合的
   * 星系，之后残骸也要分开算。**」）——键 = 残骸组 key（族 × 地区，如 `h-hi`），值 = 该组在总池里的
   * **份额 m³**（与 `density` 同尺度）。
   *
   * 不变量：`Σ byGroup ≈ density`（漂移时按总池变化**等比回调**；打捞按选中组扣、总量同步扣）。
   * 兼容字段（可选 · 零迁移）：老档缺席 ⇒ **首次读到时惰性初始化**——把"没有组信息的量"按
   * **该星系各张常驻悬赏卡均分**落组（船长 Q3 口径：「旧的常驻悬赏的残骸按各自均分」）。
   */
  byGroup?: Record<string, number>
  /** 稀有残骸按敌群记账（敌群 id → 存量件数）：窝点战利品继承该敌群的回收特色池与专属装备；
   *  老档缺省 = 无（只认 rare 总数，不产出稀有件，避免张冠李戴） */
  rareBy?: Record<string, number>
}

/**
 * **入侵残骸独立池的一条记录**（2026-09-25 船长令：「入侵残骸不算当地星系密度，因为是独立的。
 * 48 小时线性衰减」；模型见 `salvage.ts`「入侵残骸 · 独立池」那一段）。
 *
 * - `density` = **锚点值**（最后一次注入/打捞扣减时的量）；
 * - `decayAccMs` = 自锚点起**已漂移的时长**；
 * - 当前有效量 = `density × max(0, 1 − decayAccMs / 48h)` ⇒ **48 小时线性衰减到 0**（与推进粒度无关），
 *   到点或有效值见底即删记录（"残骸条"随之消失，不留底、不回升）。
 */
export interface WeekendWreckRecord {
  density: number
  decayAccMs: number
  /**
   * **这批残骸的来源势力**（**2026-09-26 加 · 玩家报障**：「**打捞残骸捞不到H族残骸，只能捞到该星系默认的**」）。
   *
   * 为什么必须有：残骸场**比"占领"活得久**（48 小时自然衰减、活动结束也不清），而打捞型号池原先只在
   * 「此刻仍被占」时才并入入侵舰队 ⇒ 残留场所在星系（夺回后的外围 / **旗舰期的核心** / 上一场的遗留）
   * 会「残骸条写着入侵残骸、捞出来全是默认残骸」。池子改成"**有场就并入入侵卡**"后，得知道并**哪一族**。
   * 兼容字段（可选、零迁移）：老档没记 ⇒ 打捞侧回落**当前事件族**。
   */
  family?: FoeFamily
}

/**
 * **玩家舰船残骸的一具记录**（**2026-09-26 船长令**：「**玩家舰船被摧毁后，如果是在非虫洞的正常星系内，
 * 在该星系生成一个'<被摧毁的舰船名称>的残骸'该残骸存在48小时，玩家如果在该星系打捞，优先打捞该残骸
 * （比稀有残骸优先级还高）。打捞后玩家按照一定概率和比例回收被摧毁舰船的部分装备。除此以外没有其他资源。**」；
 * 模型与全部判定见 `shipWrecks.ts`）。
 *
 * **三本残骸账里的第三本**（另两本 = 星系池 `galaxyWrecks` · 入侵残骸场 `weekendWrecks`）：
 * 本账**逐具记账**（同一星系可同时有多具，各算各的 48h），打捞时**按 `seq` 倒序 = 最新那具优先**。
 *
 * ⚠ **残骸是一条"星系账"，不是物品**：不进市场、不进图鉴、不折算矿物/信用点（船长：「除此以外没有其他资源」）。
 */
export interface ShipWreckRecord {
  /** 记录号（单调递增；打捞"最新那具优先"就靠它排序） */
  seq: number
  /** 所在星系（**只在正常星系生成**；虫洞那两条损毁路径不生成） */
  galaxyId: string
  /** 原舰船 id（键；也是同一艘船不会留两具残骸的保证） */
  shipId: string
  /** 残骸显示名 = 「**`<船名>的残骸`**」（船名取损毁那一刻的显示名，含玩家自定义名） */
  name: string
  /** 来源船型 id（界面画舰船轮廓用） */
  defId?: string
  /** **损毁那一刻的装配快照**（高/中/低槽各装了什么件；打捞逐件掷骰就照它算） */
  fitted?: FittedModules
  /** **损毁那一刻的无人机舱清单**（droneId → 架数；打捞时按"这一型还剩几架"整型给回） */
  droneLoad?: Record<string, number>
  /**
   * **损毁那一刻装着、还没换回黑匣的舰船插件 id 列表**（**2026-09-26 船长令**「**玩家回收按插件数量直接
   * 回收成黑匣**」）。与 `fitted` **是两本账**：插件不进高/中/低槽，打捞时**不逐件掷骰**——
   * 残骸第一次被捞时按件数整批换回黑匣，然后把这个字段清空。
   */
  plugs?: string[]
  /** 损毁那一刻的结构层（= `FleetShipState.durability`）：整船回收后按它 ×0.3 回港 */
  durability?: number
  /** 损毁那一刻的装甲残余比例：整船回收后按它 ×0.5 回港 */
  armorPct?: number
  /**
   * **损毁那一刻**该船装着的「加固结构插件」回收率之和（`ModuleDef.hullRecoveryChance`，已夹到 60%）。
   * 快照存下来的意义 = **日后插件改数值，已生成的残骸口径不变**。无插件 ⇒ 无此字段 ⇒ 整船回收永不触发。
   */
  reinforceChance?: number
  /** 该具残骸是否已掷过「整船回收」（**一具只掷一次**，防反复捞刷概率；无插件时首捞即置位） */
  hullRolled?: boolean
  /** 该具残骸是否已用过「至少给回一件」的保底 */
  pityUsed?: boolean
  /** 残骸量当量（固定 30；**只决定"这具残骸在不在"**，衰减到 0 即消失） */
  density: number
  /** 自锚点起已漂移的时长：有效值 = `density × max(0, 1 − decayAccMs/48h)` ⇒ **48 游戏小时线性到 0** */
  decayAccMs: number
  /** 生成时刻（现实墙钟；仅读数用，不参与衰减） */
  createdAtWallMs: number
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
  /**
   * **主控活动「扫描虫洞」**（2026-09-14 船长：新增主控活动，只能在扫描虫洞界面内开始）。
   * 兼容字段（可选）：旧档没有 ⇒ 视为"没在扫、库存空"，零迁移。
   */
  wormholeScan?: WormholeScanState
  /**
   * **已发现、未开始探索的虫洞**（船长：最多囤积 5 个；每处带种子 + 内容原型 + 敌族，起始层恒 1）。
   * 兼容字段（可选）：旧档没有 ⇒ 空库存，零迁移。
   */
  wormholeStock?: WormholeStockItem[]
  /**
   * **在跑的自动探索**（船长 2026-09-14 定案 · 确认稿 §六「自动探索」）。
   * 兼容字段（可选）：旧档没有 ⇒ 没有在跑的趟，零迁移。参与舰按"每条占 1 枚 AI 核心"并入
   * `aiCoreShipUsed` 的同一本账，并在 `shipLockedReason` 里锁定到返航。
   */
  wormholeAuto?: WormholeAutoRun[]
  /**
   * **自动探索结算报告**（新→旧；需玩家在「扫描虫洞」页确认；上限 `WORMHOLE_AUTO_REPORT_MAX`）。
   * 兼容字段（可选）：旧档没有 ⇒ 空队列，零迁移。
   */
  wormholeAutoReports?: WormholeAutoReport[]
  /**
   * **限时促销的一次性领取记录**（2026-09-16 船长：限时活动「虫洞大量生成」——每人**只发一次**
   * 5 处虫洞，**只给已解锁者**）。键 = `PROMOS[].id`，值恒 `true`。
   *
   * 兼容字段（可选，**零迁移**）：老档缺席 = 未领取 ⇒ 达标后下一次心跳由
   * `reconcileWormholePromoGift` 自动补发一次；促销表里删行不影响本记录（留着无害）。
   */
  promoClaimed?: Record<string, true>
  /** 精炼炉运转（2026-09-04 工业细化：单工位循环运转；兼容字段无版本号，旧档载入 = 空态） */
  refineRun: RefineRunState
  /** B3 打捞作业（采矿式自动循环，2026-09-09 起默认循环；autoCycle/stopAfterTrip 偏好字段零迁移，旧档载入 = 空态） */
  salvaging: SalvageOpState
  /** B3 星系残骸密度（2026-09-05：兼容字段无版本号；星系 → 密度记录，无记录 = 基础密度） */
  galaxyWrecks: Record<string, WreckGalaxyRecord>
  /**
   * **入侵残骸（独立池）**（船长 2026-09-25：「**入侵残骸不算当地星系密度，因为是独立的。48 小时线性衰减**」
   * ＋「按照击败卡的威胁注入」）。
   *
   * 与 `galaxyWrecks` **完全独立**的一本账：星系 id → `{ density, decayAccMs }`（口径与密度同尺）。
   * 三条与星系池**不同**的规则（详见 `salvage.ts` 的 `WEEKEND_WRECK_DECAY_MS` 一段）：
   * ① **没有基础密度（保底 = 0）**、只减不增 ⇒ **48 小时线性衰减到 0 即消失**（不留痕、不回升）；
   * ② **不算进当地星系的残骸密度读数**（界面另起一行「入侵残骸」，见星图打捞列表/星系详细）；
   * ③ 打捞时与星系池**合并计量**（体积当量按两池之和），扣减**先扣这一池**（会消失的先捞）。
   *
   * 兼容字段（可选，**零迁移**）：老档缺席 = 一张空表。
   */
  weekendWrecks?: Record<string, WeekendWreckRecord>
  /**
   * **玩家舰船残骸**（**2026-09-26 船长令**，设计稿 `docs/design/ship-wreck-20260926.md`）。
   *
   * 第三本残骸账：**逐具记账**（键 = 原舰船 id，同一星系可多具）、**48 游戏小时线性衰减**、
   * 带**损毁那一刻的装配与无人机快照**。打捞时它是**最高优先**（压过稀有池，见 `salvaging.pullOneWreck`）：
   * 每轮从中捞 1 件、逐件掷概率回收；**没有矿物、没有信用点、没有其它资源**。
   *
   * ⚠ **触发面**：只在**正常星系**（主控 / AI 副船远征失利遭追击两处）；**虫洞内不生成**
   * （`shipyard.loseShip` 的 `wreckGalaxyId` 只由那两处传入）。
   *
   * 兼容字段（可选，**零迁移**）：老档缺席 = 一张空表。
   */
  shipWrecks?: Record<string, ShipWreckRecord>
  /**
   * **玩家舰船残骸的记录号游标**（单调递增；打捞"最新那具优先"与同星系多具排序用）。
   * 兼容字段（可选，**零迁移**）：老档缺席 = 0，下一具从 1 起。
   */
  shipWreckSeq?: number
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

/**
 * 第二十五版存档结构（当前版本）：**v25 = v24 + 虫洞副本状态 `wormhole`**（2026-09-13 开工）。
 *
 * 施工期铁律（船长）：「**虫洞完成前对玩家不可见**（入口走调试开关）；**完成后需要我拍板**」。
 * 字段纯新增、老档迁移补 `EMPTY_WORMHOLE_STATE`（`run: null`）⇒ **零行为变化**。
 */
export type GameStateV25 = Omit<GameStateV24, 'version'> & {
  version: 25
  wormhole: WormholeState
  /**
   * **现实墙钟**（毫秒时间戳；2026-09-15 限时倍率批新增的**可选**字段）。
   *
   * 由引擎每拍写入（`advanceGame` 的 `nowWallMs`，在线 = `Date.now()`）——**只有显式传参时才写**：
   * 工具与用例不传 ⇒ 该字段保持 `undefined` ⇒ **限时倍率恒为 1×**（标定读数不被日历污染）。
   * ⚠ **不参与存档语义**（不落盘、不影响迁移）：老档没有它 = 一切照旧（限时倍率按 1× 处理）。
   */
  wallMs?: number
  /**
   * **「第一次」任务系列的终身计数**（船长 2026-09-17 教程重做批 · 阶段②；可选、**零迁移**）。
   * 键见 `core/firstTasks.ts` 的 `FirstStatKey`；老档没有 ⇒ 读作 0（链任务从 0 起）。
   */
  firstStats?: FirstStats
  /**
   * **「第一次」任务推进到哪一步玩家已经看过**（**2026-09-20 船长令**：「每推进一阶段第一次任务时，
   * 在导航栏的任务中心选项处进行提醒」）。
   *
   * 口径与「赏金新板提示」同款（见 `SideTasksState.bountySeenWindow`）：**当前"显示组" ≠ 看过的那一组** ⇒
   * 导航「任务中心」亮数字徽标；**进「任务中心」页即记账**（`firstTasksMarkSeen`）⇒ 立刻灭；
   * 再推进一阶段 ⇒ 又亮。可选字段、**零迁移**；老档没有它 ⇒ 首帧亮一次。
   *
   * ⚠ **值的形态**（**2026-09-20 船长第三道令**起）：顺序段恒为一条 ⇒ 值就是那条 id
   * （`'first-scan'`…，**与旧档存的单条 id 逐字一致 ⇒ 老档照旧匹配**）；末段并列批是**显示组签名** = 两条 id
   * 以 `|` 连接（`'first-haul|first-wormhole'`）⇒ 并列批出现时正好亮一次。
   * ⚠ 缺省**不写键**（与 `bountySeenWindow` / `fitPresets` 同款）——无条件写会让新档与老档的快照往返多一个键。
   */
  firstTaskSeenId?: string
  /**
   * **模式选择已完成**（**2026-09-24 船长令**：「对至今未选择的旧档进行模式选择弹窗」）。
   *
   * 为什么需要它：**存档里原本区分不出三种人** —— 序章点了「普通模式」的、序章点了「跳过」的、
   * 以及铁人模式上线（2026-09-23）之前就存在的老档，三者的存档面完全一样（都没有 `ironman` 字段）
   * ⇒ 弹窗会反复打扰已经选过的人。本字段只记一件事：**「普通 / 铁人」那次选择已经做过了**。
   *
   * ⚠ **选铁人不必写它**（`state.ironman.sinceWallMs` 已是一份记录，`ironmanEver` 判得出来）；
   * 它实际只在**选了普通**那一刻落位 ⇒ 那一次选择机会就用掉了（存档页不再提供"转铁人"入口）。
   * ⚠ 可选字段、**只在 true 时写**（缺省 = 没选过 ⇒ 老档/新档快照零迁移）。
   */
  modeChosen?: boolean
}
/**
 * 第二十六版存档结构：**v26 = v25 + 「第一次」任务系列上线时的一次性老档判定**（2026-09-17 教程重做）。
 *
 * 结构本身没动（irstStats 仍是可选字段）——**升版只为给"老档判定"一个只跑一次的落点**：
 * v25 及更早的档在读取时把 13 条「第一次」整体判为已完成（通讯由 irstTask 触发器自然补送、**不发奖励**），
 * 新档（v26 起）才从零走「第一次」流程（页面/页签前置锁定因此**只对新档生效**，老档不倒退）。
 */
export type GameStateV26 = Omit<GameStateV25, 'version'> & {
  version: 26
}
/** 对外统一称呼：当前版本状态（v26 = v25 + 老档「第一次」一次性判定） */
/**
 * 第二十七版存档结构（当前版本）：**v27 = v26 + 市场链换口径的一次性老档折算**（2026-09-18 船长）。
 *
 * 结构同样没动（`firstStats` 仍是可选字段）——升版只为让「挂单张数 → 交易收入」的折算**只跑一次**：
 * v26 及更早的档在读取时按**级别对齐**折算：旧表由挂单张数算出已达级数 N ⇒ `firstStats.marketIncome`
 * 直接取新表第 N 级的门槛值，已达级数**一点不倒退**（挂单 0 张的档不写 = 零迁移）；
 * 新档（v27 起）从 0 起算真·交易收入（`market.ts` 四处卖出入账处累计）。
 */
export type GameStateV27 = Omit<GameStateV26, 'version'> & {
  version: 27
}
/**
 * 第二十八版存档结构（v28 = v27 + **残骸合并**，2026-09-19 船长）。
 *
 * 「残骸按来源种族 × 来源地区合并」把"每卡一种"的 79 种残骸并为 **13 组**（26 种物品）——
 * **结构本身一个字没变**（物品 id 就是字符串键），升版只为让 v27→v28 那段
 * "旧残骸 id → 组 id"的**同组累加折算只跑一次**（见 `save.ts` 的 `MIGRATIONS[27]`）。
 */
export type GameStateV28 = Omit<GameStateV27, 'version'> & {
  version: 28
}
/**
 * 第二十九版存档结构（v29 = v28 + **谜质科技树等级**，2026-09-19 船长）。
 *
 * 「消耗谜质升级的研究科技树」：等级存 `research.levels`（键 = 节点 id、值 = 已研究等级）。
 * 老档迁移补 `{ levels: {} }`（一级未点）⇒ **零行为变化**（见 `save.ts` 的 `MIGRATIONS[28]`）。
 */
export type GameStateV29 = Omit<GameStateV28, 'version'> & {
  version: 29
  /**
   * **谜质科技树**（2026-09-19 船长批；节点表见 `data/src/matterTech.ts`，语义见 `core/matterTech.ts`）。
   *
   * ⚠ **可选**：新建档（`createInitialState`）与载入器（`normalizeState`）**恒写入**它；
   * 标可选只为让"v28 形状的测试夹具"照旧可用（读侧一律 `?? 空树` 兜底 ⇒ 零行为变化）。
   */
  research?: MatterTechState
}
/**
 * 第三十版存档结构（v30 = v29 + **成就徽章**，2026-09-20 船长：「继续之前的成就系统」）。
 *
 * 徽章表见 `data/src/achievements.ts`（第一批 63 枚），发放与判定见 `core/achievements.ts`。
 * 只存"哪几枚到手了 ＋ 到手时刻"——图案/名称/说明一律现算（改内容即热更，不必迁移）。
 * 老档迁移补 `{ earned: {} }` **并补发**已达成者的徽章（见 `save.ts` 的 `MIGRATIONS[29]`）。
 */
export type GameStateV30 = Omit<GameStateV29, 'version'> & {
  version: 30  /**
   * **成就徽章**（2026-09-20 船长批；第一批 = 任务与次数链共 63 枚，已完成）。
   * ⚠ 账本结构对两批通用：第二批（里程碑成就）只是往徽章**表**里加条目，**本字段不用改**。
   *
   * ⚠ **可选**：新建档（`createInitialState`）与载入器（`normalizeState`）**恒写入**它；
   * 标可选只为让"v29 形状的测试夹具"照旧可用（读侧一律 `?? 空账` 兜底 ⇒ 零行为变化）。
   */
  achievements?: AchievementState
}
/**
 * 第三十一版存档结构：**v31 = v30 + 「第一次」任务改成"玩家点「完成」才推进"**（2026-09-21 船长令）。
 *
 * 结构上只多两个**可选**字段（都没写 ⇒ 与 v30 快照逐字一致）：
 * - `firstTaskReadyId?`：已经播报过"这条已达成"的那一条（播报去重，免得每拍刷屏）；
 * - `firstTaskAutoClaim?`：**老档一次性收口标记**（`save.ts` 的 v30→v31 迁移给老档写上）——读档后第一拍把
 *   "判据已满足却没点过"的积压任务按点击同款走完（发奖/发信/进下一条），随后删键；**新档不带它**。
 */
export type GameStateV31 = Omit<GameStateV30, 'version'> & {
  version: 31
  /**
   * **已经播报过"这条已达成"的那一条**（**2026-09-21 船长令**：任务不再自动完成，玩家回任务中心点「完成」）。
   *
   * 干什么用：达成那一刻要写**一条**日志（「◆ 任务已达成：…回「任务中心」点「完成」」），
   * 这个键就是"播报过没有"的记忆（只在播报时写；换一条 ⇒ 与上次不同 ⇒ 再播一次）。
   * 可选字段、**零迁移**（老档没有它 ⇒ 下一拍按现状播报一次）；**没播报过就不写这个键**。
   */
  firstTaskReadyId?: string
  /**
   * **老档一次性收口标记**（**2026-09-21 船长令**「老档直接完成」；由 `save.ts` 的 v30→v31 迁移写上）。
   *
   * 语义：**读档后的第一拍**把"判据已满足、但玩家还没点完成"的积压任务**按点击同款一次走完**
   * （发奖、发信、进下一条，直到当前那条不再满足为止，最多 13 条），随后**删掉这个键**。
   * 新档不带它 ⇒ 一律走"玩家点「完成」"的手动流程。可选字段 ⇒ 新档快照不含它（零迁移）。
   */
  firstTaskAutoClaim?: boolean
  /**
   * **铁人模式**（**2026-09-23 船长令**：「**和玩家讨论了下，发现好像搞一个铁人模式更受欢迎**」＋
   * 「玩家的导出的存档会带版本号。如果导入一个铁人存档的版本号比当前存档的版本号更靠前则会导入失败。
   * 玩家重置档案并不会清空这个版本号」）。
   *
   * 语义（细则见 `core/ironman.ts` 与工作文档 `docs/design/ironman-mode-20260923.md`）：
   * - `on`：当前是否处于铁人模式（**只能关闭、不可再开启**）；
   * - `seq`：**存档代次**——每次落盘 +1；**普通档也记**（只显示、不拦），铁人档用它做"装载闸门"：
   *   装载（导入/恢复）一份 `seq` 小于 `max(当前档 seq, 账本最高 seq)` 的档 ⇒ **拒绝**；
   * - `sinceWallMs` / `closedWallMs`：转为铁人 / 关闭铁人的墙钟（徽章判据与界面展示用）。
   *
   * 可选字段、**零迁移**：老档没有它 ⇒ 读作"普通档、代次 0"（`ironmanFrom` 现算兜底）。
   * ⚠ 代次**必须与"存档之外的账本"配合**才有意义（账本在 `%APPDATA%` 下，重置档案不清空）。
   */
  ironman?: IronmanState
  /**
   * **周末入侵活动**（2026-09-23 船长令；设计见 `docs/design/weekend-invasion-20260923.md`）。
   * ⚠ **老档没有这个键** ⇒ 一律读作"当前没有入侵"（零迁移；活动只在新窗口开启时写入）。
   * 进度**不落盘逐格 tick**：`进度 = NPC 铺底(时间函数) + 玩家投入(台账)` ⇒ 离线一样能算。
   */
  weekendEvent?: WeekendEventState
}
/** 对外统一称呼：当前版本状态（v31 = v30 + 任务改手动完成） */
/**
 * **弹药与修理组件的取用来源开关**（**2026-09-23 船长令**：「**做一个开关，开启时，所有船的弹药和修理
 * 组件直接从仓库取用。关闭后只从舰队内舰船的货仓取用。**」）。
 *
 * - **开（true）/ 缺省（老档没有该字段）** = 只从**母港仓库**取用；
 * - **关（false）** = 只从**舰队各舰货仓**取用（哪艘没料 ⇒ 那艘打不了 / 修不了）。
 * - ⚠ 旧口径「**货舱优先 → 仓库兜底**」**退役**（本开关取代"两路并用"）。
 * - ⚠ 为免动 `GameStateV31` 的定义体，本字段以**交叉类型**挂在别名上；日后要并入 V31 随手搬进去即可。
 */
export type GameState = GameStateV31 & {
  resupplyFromWarehouse?: boolean
  /**
   * **实战胜利记录**（**2026-09-24 船长令**：「记录残血最多的一次，如果都是满血则不覆盖。夹回当前射程内。」
   * ＋「③按敌卡」）——键 = **敌卡 id**；值 = 那一次的期望距离与**剩余比例**（（装甲+结构）÷ 满值）。
   *
   * - **只由实战胜利写入**（悬赏结算那一处）；**评估里的模拟胜负绝不写入**（评估是只读克隆）；
   * - **只在剩余比例更高时覆盖**（相等不写 ⇒ 幂等）；满血即上限（"都是满血则不覆盖"）；
   * - 消费方 = 胜率预估：该卡有记录 ⇒ **取代三点采样**，只用这个距离（**夹回当前射程内**）。
   * - 可选字段 ⇒ 老档零迁移。
   */
  winRecord?: Record<string, { desireM: number; remainPct: number }>
}

/**
 * **铁人模式状态**（2026-09-23 船长令；`GameState.ironman` 的类型）。
 *
 * 为什么代次要**同时**放进存档与"存档之外的账本"：只放存档里 ⇒ 回滚会把代次一起带回（等于没记）；
 * 账本（`%APPDATA%\whale-idle\ironman-ledger.json`，主 + 影子双写）才挡得住"换文件回滚"。
 * 规则：装载一份 `seq < max(当前档, 账本)` 的档 ⇒ 铁人档拒绝；**存档年龄 ≥48 小时**的可走**救援**放行。
 */
export interface IronmanState {
  /** 是否处于铁人模式（**只能关、不可再开**） */
  on: boolean
  /** **存档代次**：每次落盘 +1（普通档也记） */
  seq: number
  /** 转为铁人（或开启铁人新档）的墙钟毫秒 */
  sinceWallMs?: number
  /** 关闭铁人的墙钟毫秒（**「关闭铁人」隐藏徽章的判据**） */
  closedWallMs?: number
}

/** **成就徽章的存档面**：只存"哪几枚到手了 ＋ 到手时刻"——图案/名称/说明一律现算 */
export interface AchievementState {
  /** 徽章 id → 达成记录（只置一次，与任务奖励同款去重口径） */
  earned: Record<string, AchievementEarned>
}

/**
 * **一枚徽章的达成记录**（船长 2026-09-20：「成就系统还要记录成就完成时间。」）。
 *
 * 两个时刻都记（口径与玩家可见性分别不同）：
 * - `atGameMs`：**游戏内时间**（累计毫秒）—— 与日志 `LogEntry.atGameMs` 同一把尺，
 *   界面用 `formatDurationMs` 显示（"在线 4天21小时"同款），**不随离线时间跳变**；
 * - `atWallMs`：**真实时间**（墙钟毫秒）——供"什么时候拿的"回看（如成就页显示真实日期）。
 *
 * ⚠ `atGameMs = 0 且 atWallMs = 0` = **老档补发**（载入后第一拍按现状补上，当年真实时刻不可知）
 * ⇒ 界面按"时间未记录"显示，**不要写成"游戏开始时就拿到了"**。
 */
export interface AchievementEarned {
  atGameMs: number
  atWallMs: number
}

/** **谜质科技树的存档面**：只存"哪一项研究到了几级"——效果一律现算（改数值即热更，不必迁移） */
export interface MatterTechState {
  /** 节点 id → 已研究等级（0/缺省 = 未研究） */
  levels: Record<string, number>
}

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

/** 序章进度（2026-09-05 序章·苏醒；**2026-09-17 教程重做后只剩两态**）：
 * `0` = 序章演出中（渲染层 `PrologueScreen` 推进），`99` = 已完成/老档/经典开局。
 * 旧档的 -1（未开始）／0.5（简报）／1..8（七步教程中）由 `save.ts` 一律读成 99。 */
export interface OnboardingState {
  step: number
}

/** 重要任务状态（任务中心「重要任务」分类；key = 数据目录任务 id） */
export interface ImportantTaskState {
  done: boolean
  /** 可交付任务的累计已交数量（按任务 id 语义使用） */
  delivered?: number
  /** 「寻找人类」阶段目标：已探索全部星系（里程碑只记一次；2026-09-10 船长定） */
  allExplored?: boolean
  /**
   * **起手道具已发放**（**2026-09-21 船长令**：任务开始时给道具 ⇒ 去重键 = 这条）。
   * 只在真的发放那一刻写 `true`（没发过就不写这个键 ⇒ 老档/新档快照零迁移）；**不回收**。
   */
  started?: boolean
}

/**
 * **「第一次」任务系列的终身计数**（船长 2026-09-17 教程重做批 · 阶段②）。
 *
 * 键见 `core/firstTasks.ts` 的 `FirstStatKey`（采矿单位 / 打捞次数 / 维修次数 / 胜场 / 精炼批 / 产出件 /
 * 挂单 / 造船 / 指派 / 运输趟 / 进洞趟）。**只增不减**，由各引擎落点 `bumpFirst()` 累加；
 * 扫描数、累计技能等级、协会声望三条**不计数**（现推）。
 * ⚠ **可选字段、零迁移**：老档没有 ⇒ 读作 0（链任务从 0 起，见工作文档 §老档口径）。
 */
export type FirstStats = Partial<Record<string, number>>

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
  /** 目标物品 refId（state.warehouse.items 按它计数、出发/完成时扣取）。
   *  **快递任务自 2026-09-18 起改用虚拟货物 ⇒ 本字段为空串**（改看 `volumeM3`） */
  refId: string
  /** 需交付单位数（物品仓库持有 ≥ 该值方可出发/完成；刷出时锁定）。
   *  **快递任务自 2026-09-18 起改用虚拟货物 ⇒ 本字段恒 0**（改看 `volumeM3`） */
  need: number
  /** 完成奖励 ISK（刷出时按当时收购价锚定取整到整百锁定；不给声望） */
  rewardIsk: number
  /**
   * **任务级别 1~5**（船长 2026-09-18：「任务将划分级别，级别越高的任务收购的数量/所需的货仓容量越多。
   * 同样奖励也越高」）。各级"量"倍率/奖励系数见 `sideTasks.ts` 的 `SIDE_TASK_LEVEL_SCALE` /
   * `RESOURCE_TASK_LEVEL_MARGIN` / `COURIER_TASK_LEVEL_RATE`；**老档缺省按 1 读**（零迁移）。
   */
  level?: 1 | 2 | 3 | 4 | 5
  /**
   * **快递所需货舱体积（m³）**（船长 2026-09-18：「快递的货采用和长途运输一样的虚拟货物，
   * 只有占用体积属性」）——不再要求玩家备货：出发时把真实货物卸进仓库、按本体积占用货舱，到站释放。
   */
  volumeM3?: number
  /** 快递：是否**限时快递**（船长：「快递任务有 2 种区分，普通快递和限时快递」）。限时快递对跃迁速度有门槛、
   *  且有截止时刻，**超时无报酬**（船长选甲案：无报酬 ＋ 任务作废） */
  timed?: boolean
  /** 快递：**跃迁速度门槛（AU/s）**——4 档 = 剑鱼 6.20 / 剑鱼+MK2 7.44 / 剑鱼+MK3 8.37 / 剑鱼+MK3×2 10.92
   *  （`timed === true` 时非空；出发时校验当前舰船，不达标不许出发） */
  warpReqAus?: number
  /** 快递：**时限（毫秒）**= 该档基准配置跑完本段航程的时长（出发时刻 + 它 = 截止；超时无报酬、任务作废） */
  timeLimitMs?: number
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
  /** 目标物品的市场商品 key（出发时复制；**虚拟货物时代恒为空串**） */
  goodKey: string
  /** 目标物品 refId（**虚拟货物时代恒为空串**——快递不再绑商品） */
  refId: string
  /** 在途投送单位数（**虚拟货物时代恒 0**，改看 `volumeM3`） */
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
  /** 虚拟货物占用体积（m³；出发时按它占用货舱，到站释放）——老档缺省 0 = 旧"真实货物"口径 */
  volumeM3?: number
  /** 任务级别（1~5；结算日志与超时判定用；老档缺省 1） */
  level?: 1 | 2 | 3 | 4 | 5
  /** 是否限时快递（**超时无报酬**：到站时刻 > 截止时刻 ⇒ 任务作废、不发酬金） */
  timed?: boolean
  /** 截止时刻（游戏内毫秒 = 出发时刻 + `timeLimitMs`；仅限时快递有值） */
  deadlineAtGameMs?: number
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
  /** 资源任务（当前轮；条数 = 4 ＋ 每建成一座副站 +2，见 `sideTasks.ts`） */
  resource: SideTask[]
  /** 快递任务（当前轮；副站建成解锁后才刷，条数 = 4 ＋ 每建成一座副站 +2） */
  courier: SideTask[]
  /**
   * **已接单的快递任务**（船长 2026-09-18：「接取的快递任务不会被刷掉」）——整板刷新**不清**本列表；
   * 上限 `COURIER_ACCEPT_MAX`（4 单）；出发投送后才离场。**老档缺省 = 无（空）**，零迁移。
   */
  accepted?: SideTask[]
  /** 赏金任务（**当日板**；2026-09-10 船长定：每天 2 张高难窝点，24 小时一轮、
   *  **每天本地 0 点整板替换**，与资源/快递的 20 分钟板彼此独立；老档缺省 = 空数组，零迁移） */
  bounty: SideTask[]
  /** 敌对派系活跃（2026-09-10 船长定：每天一个中安/低安星系，该星系**常驻悬赏** +10% 奖金/+10% 威胁、
   *  胜利有概率掉稀有残骸；逐日重选、打赢不下板 → 当天可反复刷；老档缺省 null） */
  faction: SideTask | null
  /** 赏金板日界（本地 0 点的墙钟毫秒；0 = 未开板）——下一日界到点时整板替换。
   *  兼容字段（无版本号变化）：老档缺省 0，首次拿到有效墙钟即开板。 */
  bountyWindow: number
  /**
   * **赏金新板提示**（2026-09-14 船长：「当任务中心有新的赏金任务时，提示玩家，玩家进入后消除提示」）：
   * 玩家**上一次看过**的赏金日界（本地 0 点墙钟毫秒；0 = 从没看过）。
   *
   * 导航「任务中心」的徽标 = `bountyWindow > bountySeenWindow` 时亮（**换板未看**口径），
   * 进「任务中心」页即记账（`sideTasksMarkBountySeen`）⇒ 灭；下一日界到点换板后再亮。
   * 兼容字段（无版本号变化）：老档缺省 0 ⇒ **首帧会亮一次**（船长同日定「**老档默认亮起提示**」）。
   */
  bountySeenWindow?: number
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

/**
 * **该船此刻是否被锁在虫洞里**（= 在本趟编队里）。
 *
 * 用途（船长 2026-09-13 两条裁定合起来）：①「已经进洞的船将被锁定」；
 * ②「**洞内战斗时，洞外可以开新战斗**」——两场战斗**锚点必须各在各边**：
 * 洞内锚点 = `run.fleet[0]`（见 `advanceWormhole`）、洞外锚点 = `state.shipId`（见 `advanceBattle`）。
 * 于是"拿洞里的船去外面开战"要拒掉，否则同一艘船会被两场战斗同时读写（承伤/弹药/丢船互相串台）。
 *
 * ⚠ 放在 `state.ts` 而不是 `wormhole.ts`：`wormhole.ts` 已经反向依赖 `activity`，
 * 若再让 `expedition` 反向 import `wormhole`，就会形成
 * `state → wormhole → activity → expedition → wormhole` 的环，首跑即
 * `Cannot access 'HOME_GALAXY_ID' before initialization`（2026-09-13 实测踩到，与 D 批同款）。
 * 本函数只读 `state.wormhole.run`，放这里两边都能直接 import，零新增依赖边。
 */
/**
 * **进洞船只的"所有行为"锁定拒因**（船长 2026-09-13：「**锁，进洞船只所有行为都锁定。包括维修。**」）。
 * 用途：换驾驶 / 货仓装卸 / 市场卖出 / 装配改装 / 维修（组件与站内）/ 卖船 等动作在入口处调它；
 * 空 = 可以操作。文案统一说明"为什么"与"怎么解"。
 */
export function shipLockedReason(state: GameState, shipId: string, what = '操作这艘船'): string | null {
  if (shipLockedInWormhole(state, shipId)) {
    return `该舰在虫洞里（已锁定）：${what}要等它出洞——先撤离或结算本趟。`
  }
  /**
   * **自动探索中的船同样锁定**（船长 2026-09-14：「参与舰任务期间锁定（不可驾驶/不可出击/不可接别的 AI 任务）」）。
   * 这里只读 `state.wormholeAuto`（不 import 自动探索模块，免得与 `state` 形成环）。
   */
  const run = (state.wormholeAuto ?? []).find((r) => r.shipIds.includes(shipId))
  if (run) {
    return `该舰正在自动探索中（已锁定）：${what}要等它返航——「扫描虫洞」页可以看到进度与报告。`
  }
  return null
}
export function shipLockedInWormhole(state: GameState, shipId: string): boolean {
  return (state.wormhole.run?.fleet ?? []).includes(shipId)
}



/**
 * **主控"手上那个活动"是否还占着**（船长 2026-09-13 批准实行 · 议案 A）。
 *
 * 口径：进洞 = 与采矿 / 打捞 / 交付 / 长途运输 / 掩护巡逻 / 远征 / 亲自开炉**同级的一个主控活动**，
 * 但它**只在"人在洞里"（`run.attending === true`）时占位**：
 * - 人在洞里 ⇒ 别的活动一律开不了（本函数给拒因）；
 * - **临时离开（关掉虫洞界面）⇒ 活动停止、主控立刻释放**（可以去做别的），**虫洞进度原样保存**；
 * - **返回虫洞**要求主控空闲（`wormhole.ts` 的 `wormholeResume`）。
 *
 * ⚠ **不要塞进 `pilotUnavailableReason`**：那个函数还被 `reconcilePilotShip`（每拍自愈）读——
 * 一旦它因虫洞报"驾驶船不可用"，引擎会去改派驾驶船/补发保底船。故单开一个判据。
 *
 * ⚠ **「扫描星系」不在这里**（船长 2026-09-15：「玩家扫描星系将不再占用玩家的主控活动」）：
 * 无人扫描艇不占主控、也不阻断任何别的活动（互斥判据已从全部入口删除）。
 */
export function wormholePilotHoldReason(state: GameState): string | null {
  /**
   * **「扫描虫洞」同样占着主控**（船长 2026-09-14 玩家反馈：「**虫洞扫描不占用主控活动**」）。
   *
   * 修前的漏洞：扫描虫洞**只有单向门槛**——`wormholeScanBlockReason` 会挡住"别人在跑时开扫"，
   * 但**没有任何地方挡住"扫描时去干别的"** ⇒ 玩家可以一边扫描虫洞一边出海采矿/打捞/远征。
   * 补在本函数一处即可全覆盖：八个主控活动入口（采矿 / 打捞 / 远征 / 掩护巡逻 / 长途运输 /
   * 亲自开炉·回收·拆箱 / 亲自开线）**都读这一个判据**。
   * 停扫即释放（`active = false`，进度保留、回来可续扫）。
   */
  if (state.wormholeScan?.active === true) {
    return '主控正在扫描虫洞：先停扫（进度保留、回来可续扫）再安排别的活动。'
  }
  if (state.wormhole.run?.attending !== true) return null
  return '人在虫洞里（进虫洞这个活动还在进行）：先撤离或结算本趟；临时离开的话，关掉虫洞界面就能释放主控。'
}

/**
 * **停掉"扫描虫洞"这个活动**（`active = false`；**进度保留、回来可续扫**），返回"已扫分钟数"；
 * 本来就没在扫 ⇒ 返回 `null`（什么都没动）。
 *
 * 为什么放在 `state.ts`（而不是直接 import `wormholeScan.ts` 的 `wormholeScanStop`）：
 * `wormhole.ts`（进洞命令，船长 2026-09-14「进洞自动停止」要在这里停扫）若 import `wormholeScan.ts`，
 * 会形成 `state → wormhole → wormholeScan → wormhole` 的新环——本仓为这类环踩过两次 TDZ 坑
 * （见 `wormhole.ts` 里 `shipBusyForWormhole` 的注释）。所以**状态改动只留这一个单点**，
 * 两边的日志文案各自写（`wormholeScanStop` 写"手动停扫"、进洞写"进洞前自动停扫"）。
 */
export function wormholeScanHalt(state: GameState): number | null {
  const scan = state.wormholeScan
  if (!scan || scan.active !== true) return null
  scan.active = false
  return Math.max(0, Math.floor(scan.progressMs / 60_000))
}

/**
 * **停掉"开采"这个活动**（状态单点：手动停采与"进洞前自动停采"共用），返回本趟读数；
 * 本来就没在采 ⇒ `null`。
 *
 * 与 `wormholeScanHalt` 同款理由（不 import 各活动模块，以免给 `state → …` 添环）；
 * 日志由调用方写（手动写"已停止…"、进洞写"进洞前自动停掉…"）。
 */
export function miningHalt(state: GameState): { tripUnits: number; beltId: string | null; phase: MiningState['phase'] } | null {
  const m = state.mining
  if (m.active !== true) return null
  const info = { tripUnits: m.tripUnits, beltId: m.beltId, phase: m.phase }
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0 // 停止开采：红利窗口随之清零（窗口绑定矿带）
  return info
}

/**
 * **停掉"打捞"这个活动**（状态单点：手动停捞与"进洞前自动停捞"共用），返回本趟读数；
 * 本来就没在捞 ⇒ `null`。理由与 `miningHalt` 同款。
 */
export function salvageHalt(
  state: GameState,
): { tripM3: number; galaxyId: string | null; phase: SalvageOpState['phase'] } | null {
  const s = state.salvaging
  if (s.active !== true) return null
  const info = { tripM3: s.tripM3, galaxyId: s.galaxyId, phase: s.phase }
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  return info
}

/**
 * **停掉"长途运输"这个活动**（状态单点：手动停运与"进洞前自动停运"共用），返回本段出发站；
 * 本来就没在运 ⇒ `null`。
 *
 * 口径与手动停止**逐字一致**（2026-09-09 船长定）：**终止即瞬时返港**——不安排真实折返航程，
 * 舰船**直接停靠回本段出发站**、无惩罚。
 */
export function haulingHalt(state: GameState): { fromSiteId: string | null } | null {
  const h = state.hauling
  if (h.active !== true) return null
  const info = { fromSiteId: h.fromSiteId }
  h.active = false
  h.routeA = null
  h.routeB = null
  h.fromSiteId = null
  h.toSiteId = null
  h.legMinutes = 0
  h.legMs = 0
  h.phaseAccMs = 0
  // 2026-09-09（船长定）：终止即瞬时返港——不再安排真实折返航程，船直接停靠回出发站
  state.awayGalaxy = null
  state.dockedSite = info.fromSiteId === null ? null : info.fromSiteId
  return info
}
/**
 * **退还一条制造线扣过的材料**（仓库入库；`state.ts` 侧实现，故**不依赖 ctx**）。
 *
 * 为什么放在 `state.ts`：自动停机链（`haltActivityForSwitch`）没有 `ctx`，而"退料"只需要 state +
 * 线上记的账（`ManufacturingRunState.spentMaterials`）。老档在跑的线没这本账 ⇒ 由调用方
 * （`manufacturing.cancelManufacturing`，那里有 ctx）按蓝图现算兜底。
 *
 * 只做 `warehouse.items` 的加回（与 `inventory.addWare` 同口径：非有限值/非正数忽略、按整数计），
 * **刻意不 import `inventory`**——`inventory → state`（取 `shipLockedReason`）已有依赖边，反向 import 成环。
 */
export function refundMaterialsToWarehouse(
  state: GameState,
  spent: readonly { itemId: string; count: number }[],
): void {
  for (const m of spent) {
    const n = Math.floor(m.count)
    if (!Number.isFinite(n) || n <= 0) continue
    state.warehouse.items[m.itemId] = (state.warehouse.items[m.itemId] ?? 0) + n
  }
}

/**
 * **退还一本一次性图纸**（书回蓝图书架 + 名额标记恢复）——`state.ts` 侧的唯一实现。
 *
 * 为什么放在 `state.ts`：**自动停机**（`haltActivityForSwitch`）没有 `ctx`（整条活动闸门链都是 ctx-free 的），
 * 而退书只需要 `state`；`manufacturing.refundOneTimeBook`（取消制造那条路）**委托到本函数**，
 * 保证两条路一份逻辑（`manufacturing → state` 本就存在，不新增模块环）。
 *
 * 判据 = **"名额已用尽"标记**（`spentOneTimeRecipes`）：它只在**真的吃掉一本一次性书**时置位
 * （`spendOneTimeBook`），且退书时同步摘除 ⇒ 以它为权威不会多退（一次成功的单次开工必然对应一本书）。
 * 幂等：不在标记表里就什么都不做。
 *
 * ⚠ **"还有同名线在跑"时不能摘标记**（与 `refundOneTimeBook` 同一条纪律，2026-09-20 查出的静默死结）：
 * 标记的所有权归"最晚完工的那条线"——只要还有同名线在跑，就把标记留给它接管；等它也被取消/停机时
 * 才轮到它摘掉。否则会出现"书在架上、却被判名额已用尽"而开不了工。
 */
export function refundOneTimeBookOf(state: GameState, blueprintId: string): boolean {
  const spent = state.spentOneTimeRecipes ?? []
  if (!spent.includes(blueprintId)) return false
  state.blueprintStock[blueprintId] = (state.blueprintStock[blueprintId] ?? 0) + 1
  const stillRunning = state.manufacturingRuns.some((r) => r.active && r.blueprintId === blueprintId)
  if (!stillRunning) state.spentOneTimeRecipes = spent.filter((id) => id !== blueprintId)
  return true
}

/**
 * **切活动时的自动停机单点**（**2026-09-21 船长令**：「统一为能够直接切换（自动取消当前活动）」）。
 *
 * 覆盖**七种可自动取消**的活动（`activityGate.AUTO_HALT_KINDS`）；**纯状态改动、不写日志**
 * （统一日志由 `activityGate.logAutoHalt` 写，两条路径各司其职）：
 * - 采矿 / 打捞 / 扫描虫洞 / 长途运输：直接用本文件既有的四个 `*Halt`（与玩家手点「停止」同一把尺）；
 * - 掩护巡逻：清掉 standby 并把人放回母港（货物留在船上——与采矿/打捞的停机口径一致；
 *   玩家手点「召回」那条路仍会额外整仓卸货并写日志，见 `location.cancelStandby`）；
 * - 亲自开炉 / 亲自开线：把主控（`worker === 'pilot'`）那一条账本标成 inactive ⇒ **当前那批进度丢弃**
 *   （**船长 2026-09-21 答 2：「丢弃」**）；核心驱动的产线（`worker = 核心类型`）**不受影响**；
 * - **建站交付**（2026-09-22 船长令纳入）：清掉 `transit` 的交付批次、回母港、**本趟建材留在船上**。
 *
 * ⚠ 本函数放在 `state.ts`（活动位与四把 `*Halt` 都在这儿）⇒ **谁都能调、也不制造模块环**。
 */
export function haltActivityForSwitch(state: GameState, kind: string): void {
  switch (kind) {
    case 'mining':
      miningHalt(state)
      return
    case 'salvaging':
      salvageHalt(state)
      return
    case 'wormholeScan':
      wormholeScanHalt(state)
      return
    case 'hauling':
      haulingHalt(state)
      return
    case 'standby': {
      const s = state.standby
      s.active = false
      s.galaxyId = null
      s.finishAtGameMs = 0
      s.legMs = 0
      state.awayGalaxy = null // 召回口径：立即回母港（与 cancelStandby 一致）
      return
    }
    case 'refine': {
      for (const r of state.refineRuns) {
        if (!r.active || r.worker !== 'pilot') continue
        /**
         * **材料全退**（**2026-09-24 船长令**：「材料全退」——问的是"精炼炉停机是不是也该把料退回来"）。
         *
         * 分两种情形，一条都不能少：
         * ① **现代语义**（v20 起「原料不预锁定，每批到点实时扣取」）⇒ 停机**本来就不吃料**：当前那批还没到点，
         *    它的料仍在货仓/仓库里，退无可退 ⇒ 代价只有**进度**（与 `HALT_COST.refine` 的原话一致）。
         *    这一条由用例 `industry.test.ts`「中途停炉：已完成批保留，余料本来就在仓库无需退回」钉住。
         * ② **老档的"炉内预占账"**（`claimedUnits`：起炉时把库存预占进炉内）⇒ 停机**必须退回仓库**：
         *    原先只在"再起一台回收炉"时顺带退（见 `startRecycleRun` 的老档兼容段）——若这台直接被停机，
         *    那份账会随"停掉的线在存档归一里被丢掉"而**凭空消失**（正是船长不许的那种"吃料"）。
         */
        if ((r.claimedUnits ?? 0) > 0 && r.itemId) {
          refundMaterialsToWarehouse(state, [{ itemId: r.itemId, count: r.claimedUnits! }])
          r.claimedUnits = 0
        }
        r.active = false
      }
      return
    }
    case 'manufacturing': {
      /**
       * **一次性图纸必须跟着退回**（**船长 2026-09-20**：「一次性蓝图的制造取消后返还玩家蓝图」）。
       *
       * 自动停机**就是一次取消**：按既定口径（`HALT_COST.manufacturing`）代价只有**当前那一批的进度**，
       * 不是"这张图纸作废"。原先这里只把线标 `active = false` ⇒ 书与名额一起蒸发。
       *
       * ⚠ **2026-09-24 玩家报障的正是这条路**（船长转述：「刚刚在造的锤头鲨级一次性蓝图，还差 2 小时
       * 完成，离线后过了一段时间上线发现船不见了，蓝图显示已消耗」）：玩家的**重复清剿**开着，
       * 它再出发时经活动闸门把主控手上的造船线掐掉（`startExpedition → applyActivityGate`）——
       * 存档实证：`spentOneTimeRecipes` 里三张一次性舰船图全在、`shipStore` 里一艘都没有、跑线表空。
       */
      const halted = state.manufacturingRuns.filter((r) => r.active && r.worker === 'pilot')
      // ⚠ **顺序要紧**：先全部标停，再退书——`refundOneTimeBookOf` 按"还有没有同名线在跑"决定
      // 要不要摘名额标记；若此刻这条线自己还 `active`，标记会被它自己"接管"住 ⇒ 书回来了却仍判名额已用尽。
      for (const r of halted) r.active = false
      for (const r of halted) {
        /**
         * **材料一起退**（**2026-09-24 船长令**：「自动停机**材料一起退**」）——与手动「取消制造」
         * （`cancelManufacturing` 全额退料）同款；停机与取消的唯一代价都只是**当前那批的进度**。
         * 退的是这条线**开工时实际扣掉的账**（`spentMaterials`；老档没这本账 ⇒ 这里退不了，
         * 由玩家手动取消那条路（有 ctx）按蓝图现算兜底）。
         */
        if (r.spentMaterials) refundMaterialsToWarehouse(state, r.spentMaterials)
        if (r.blueprintId !== null) refundOneTimeBookOf(state, r.blueprintId)
      }
      /**
       * 停掉的线**直接从表里摘掉**（不留 `active: false` 的僵尸行）：
       * ① 留着它，玩家再点一次「取消」会**二次退书**（`cancelManufacturing` 只看 `bookSpent`）；
       * ② 读档归一也会把它当结构坏条丢掉（两次的结果应当一致）。
       * 核心驱动的线（`worker !== 'pilot'`）一律不动——与既有口径相同。
       */
      if (halted.length > 0) {
        state.manufacturingRuns = state.manufacturingRuns.filter((r) => !halted.includes(r))
      }
      return
    }
    /**
     * **建站交付（交付循环）**——**2026-09-22 船长令**：「建设空间站的运输也加入可以打断其他行为的切换里」。
     *
     * 口径与**开采 / 打捞**同款（同一把尺）：**舰船返港、本趟建材留在船上**（不吞货、不清仓），
     * 玩家回到站里可以随时再发起一次交付（`startSiteDeliverTrip` 会保留船上已有的货、再从仓库补装）。
     *
     * ⚠ 与玩家**手点「取消交付」**那条路的差别（`location.cancelSiteDeliverTrip`）：那条会**返航停靠最近
     * 已建成空间站**并把货仓整仓卸入物品仓库（它自带一条日志）。自动切换停机走这里——只做状态收口
     * （回母港、货留船上），统一日志由 `activityGate.logAutoHalt` 写；两条路的**代价都是无损**的。
     */
    case 'siteDeliver': {
      const t = state.transit
      t.active = false
      t.fromGalaxy = null
      t.toGalaxy = null
      t.finishAtGameMs = 0
      t.legMs = 0
      t.delivery = null
      state.awayGalaxy = null
      state.dockedSite = null // 回母港（与掩护巡逻召回、远征召回同口径）
      return
    }
    default:
      // 远征 / 快递投送**不在可自动取消之列**（`activityGate.INTERRUPTIBLE` = false）⇒ 这里什么都不做
      return
  }
}

/** 向状态里追加一条日志（自动编号、自动裁剪超出 logCap 的旧日志）。 *
 * `textId` / `textParams`（2026-09-20 甲案，可选）：给界面按语言渲染用；
 * 不传 ⇒ 界面显示 `text`（中文原串）——即**未改造的调用点与老档的行为一字不变**。 */
export function addLog(
  state: GameState,
  kind: LogKind,
  text: string,
  textId?: string,
  textParams?: Readonly<Record<string, string | number>>,
): void {
  const lastId = state.logs.length > 0 ? state.logs[state.logs.length - 1]!.id : 0
  state.logs.push({
    id: lastId + 1,
    atGameMs: state.gameMs,
    kind,
    text,
    ...(textId !== undefined ? { textId } : {}),
    ...(textParams !== undefined ? { textParams } : {}),
  })
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
}): GameState {
  const prologue = opts?.prologue === true
  const nowWall = opts?.nowWallMs ?? Date.now()
  const state: GameStateV31 = {
    // 新档一律按**当前版本**落盘（改版时不必再记得回来改这一行）
    version: CURRENT_STATE_VERSION,
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
            // 序章·苏醒：仓库不预置弹药——动能弹药 120 由教学战斗任务（演习场驱逐令）奖励
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
    rareWreckDryStreak: 0, // 稀有残骸保底计数（2026-09-11 船长；见 FACTION_RARE_DROP_PITY_ROLLS）
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
    spentOneTimeRecipes: [],
    recycleCarry: {},
    blueprintStock: {},
    shipStore: {},
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
    /**
     * **新档初始声望 = 40**（**2026-09-26 船长令**：「**声望真扣（就是意味着玩家一开始其实可以买5张）**」）
     * —— 两条账同值（可支配 40 / 累计 40）⇒ 开局就能换 5 张插件图纸，
     * 且入侵门槛（累计 40）开局即达标（船长接受）。
     */
    standings: { dsi: INITIAL_STANDING },
    standingsEarned: { dsi: INITIAL_STANDING },
    /** 新档还没见过黑匣（组装机插件档锁着，等第一个黑匣解锁 ＋ 发通讯） */
    blackboxSeen: false,
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
    /**
     * **初始已探索星系**（2026-09-17 船长改口径）：**新游戏（序章档）开局一处都不亮**——
     * 船长原话：「**初始将母港星系设置为和其他星系一样的未知状态，需要扫描才有悬赏和挖矿**」。
     * ⇒ 母港也得先扫（它是唯一的初始扫描目标，见 `explore.frontierGalaxyIds`）；
     * `isExplored` / `actionBlockReason` 里原本给母港开的豁免**同日一并删除**。
     * ⚠ 非序章档（`prologue !== true`，测试与工具入口）**保持 [母港]**：那批入口本来就假定母港可达。
     * ⚠ 老档不受影响（`exploredGalaxies` 随档，读档保留原值）。
     */
    exploredGalaxies: prologue ? [] : [HOME_GALAXY_ID],
    scanning: {
      active: false,
      galaxyId: null,
      finishAtGameMs: 0,
      startedAtGameMs: 0,
      originGalaxy: null,
      returning: false,
      // 2026-09-15 船长：完成待查看位（顶部扫描条留格高亮，进星图看过才收）
      awaitingView: false,
      lastGalaxyId: null,
    },
    // 虫洞扫描（2026-09-14）：初始"没在扫、库存空"
    wormholeScan: { active: false, progressMs: 0 },
    wormholeStock: [],
    // 自动探索（2026-09-14 批次 3）：初始"没有在跑的趟、没有报告"
    wormholeAuto: [],
    wormholeAutoReports: [],
    scanProgress: {},
    awayGalaxy: null,
    transit: { active: false, fromGalaxy: null, toGalaxy: null, finishAtGameMs: 0, legMs: 0, delivery: null },
    bountyCooldowns: {},
    autoLoopAnomalyId: null,
    autoLoopDroneFloor: null,
    stationSites: {},
    dockedSite: null,
    hauling: { ...EMPTY_HAULING },
    dialogueSeen: {},
    pendingDialogue: null,
    commsDelivered: {}, // 2026-09-11 通讯收件箱：送达记账（可选字段、零迁移）
    // 2026-09-14 因低安袭击自动撤离：**新档显式写 false**（区别于"老档缺字段"，见字段注释）
    ambushRetreatSeen: false,
    // 2026-09-15 造出第一艘自造船：同上——**新档显式写 false**，只等真建造（老档缺字段则按「丙」补发）
    firstShipBuilt: false,
    foeShipSeen: {},
    commsPopups: [], // 2026-09-14 需弹窗的通讯队列（空档 = 不弹）
    commsRead: {},
    debugQuick: false,
    // 2026-09-23 铁人模式：新档一律写上「普通档 · 代次 0」（老档缺字段 ⇒ 同一读法；见 IronmanState）
    ironman: { on: false, seq: 0 },
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
    // 序章·苏醒：prologue 新档 step 0（待界面开始序章演出）；其余（老档/经典开局/工具与用例）=
    // **已完成（99）**——2026-09-17 教程重做后只剩"演出中/已完成"两态（见 OnboardingState）
    onboarding: { step: prologue ? 0 : 99 },
    importantTasks: {},
    // 「第一次」任务系列的终身计数（2026-09-17 教程重做批）：**新档不写这个键**——首次 bumpFirst 才建，
    // 老档/新档快照因此逐字一致（真零迁移）；读侧一律按缺省 0（`firstStatOf`）。
    sideTasks: { seq: 1, window: 0, resource: [], courier: [], bounty: [], faction: null, bountyWindow: 0, deliver: null }, // v24：任务中心·时效任务板（资源/快递 20 分钟整点开刷；赏金每天本地 0 点开板；faction = 当日派系活跃；deliver = 快递投送在途挂账，缺省 null）
    wormhole: { ...EMPTY_WORMHOLE_STATE }, // v25：虫洞副本（施工期对玩家不可见；见 wormhole.ts 头注释）
    research: { levels: {} }, // v29：谜质科技树（2026-09-19 船长批；老档迁移补空树）
    achievements: { earned: {} }, // v30：成就徽章（2026-09-20 船长批；老档迁移补空账并补发）
    logs: [],
  }
  if (prologue) {
    addLog(state, 'system', '舰载系统苏醒：隐秘泊位·母港。', 'core.state.025')
    addLog(state, 'warn', '自检异常：船体装甲/结构受损（80%），乘员生命信号——无。记忆档案损坏。', 'core.state.026')
    addLog(
      state,
      'system',
      '初始资金 0 信用点：一切从采集第一舱原矿开始。鲣鱼级护卫舰（待修）与沙猫级采矿艇同在机库；装备库与弹药库为空——首门炮台与弹药将在完成协会试炼后解锁。',
      'core.state.027',
    )
  } else {
    // 开局欢迎行（2026-09-11 船长裁定「甲」）：原来写的是旧游戏名「大鲸鱼深空工业」，
    // 改名后统一指向**游戏内势力**「深空工业协会」（＝教程简报的发件方），设定与文案一致
    addLog(state, 'system', '欢迎加入「深空工业协会」。', 'core.state.028')
    addLog(
      state,
      'system',
      `初始资金 ${DEFAULT_START_ISK} 信用点已到账；沙猫级采矿艇已停靠机库，另有鲣鱼级护卫舰待命（装备库含轻型炮台 MK1，仓库配三型通用弹各 60 发，可直接体验远征战斗）。`,
      'core.state.029',
      { p1: DEFAULT_START_ISK },
    )
  }
  addLog(
    state,
    'system',
    '星图迷雾已开启：母港已探明，周边星系等待扫描探索——去悬赏列表接任务，或对星图上的「未知信号」执行扫描。',
    'core.state.030',
  )
  return state
}
