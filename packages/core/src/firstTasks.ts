/**
 * **「第一次」任务系列 ＋ 后续"次数"链**（船长 2026-09-17 定案；教程重做批 · 阶段②）。
 *
 * 船长原话（照抄）：「**我希望将现有教程重做，改成以重要任务的形式发布在任务中心，让玩家自由选择完成。**
 * 教程将被拆分成以下几个任务系列：'第一次完成悬赏'，'第一次采集矿物'…**每个'第一次'的任务完成后就会有一则
 * 通讯告诉玩家一些相关的情报**」＋「**这些重要任务完成后，还有后续的次数任务**（例：完成'第一次扫描'后，
 * 就会出现后续任务'宇宙探索家1'，要求玩家扫描 5 个星系…）」＋「**至少 5 个级别；部分没有内容上限的，按 10 个级别做**」。
 *
 * 设计要点：
 * - **判定一律"事件置位 ＋ 本模块的终身计数"**：13 类事件在各自引擎落点 `bumpFirst()` 累加，
 *   本模块按阈值判"是否达成"⇒ 链任务的进度天然连续（不再逐级手写判定）。
 * - **可推导的口径不用计数**：扫描数 = `exploredGalaxies.length`、技能 = `Σ trained`、
 *   虫洞解锁 = 协会声望（读 `standing`）——少一处计数就少一处漂移。
 * - **奖励**：`items` 是**预留接口**（船长：「可以先留出接口」，例：首次悬赏送 MK1 炮、挖矿送采集器）；
 *   本轮只有 ②「第一次采集原矿」真填一张蓝图（`bp-ammo-kinetic`），③「第一次学习技能」按船长 2026-09-17
 *   裁决送**基础 AI 核心 ×1**（接上"指派 AI 副船"那一步），其余留空。
 * - **前置**：`prereq` 只用于"任务在任务中心是否可见"（未满足＝不显示，船长选"两者都隐藏"）；
 *   不锁流程——玩家在功能解锁后本来就能自由做。
 */
import type { GameState } from './state'
import type { SimContext } from './types'
/**
 * ⚠ **本模块刻意只做"类型 import"，不在运行期 import 任何 core 模块**（2026-09-17 实测教训）：
 * irstTasks 被 engine / ai / market / wormhole / shipyard… **反向依赖**，一旦它再 import 那些模块
 * 就会形成环，工具侧加载时崩在「Cannot access 'HOME_GALAXY_ID' before initialization」。
 * 故下面两个常量**就地写死**（值从源头抽取核对），改动源头时请同步这里。
 */
/** 深空工业协会 id（= expedition.DSI_FACTION_ID） */
const DSI_FACTION_ID = 'dsi'
/** 虫洞解锁声望线（= wormholeScan.WORMHOLE_SCAN_UNLOCK_STANDING） */
const WORMHOLE_UNLOCK_STANDING = 40

/** 终身计数键（`state.firstStats`）——**只增不减**，事件落点用 `bumpFirst()` 加 */
export type FirstStatKey =
  | 'mineUnits' // 累计采到的原矿单位
  | 'salvageRuns' // 打捞次数（每收走一批记一次）
  | 'repairs' // 维修次数（修理组件/港内付费各记一次）
  | 'bountyWins' // 讨伐胜利场数
  | 'refineBatches' // 精炼出料批数
  | 'produceUnits' // 组装机产出件数
  | 'orders' // 挂出的卖单数（**自 2026-09-18 起只作「第一次挂单销售」的判据**，不再做链阈值）
  | 'marketIncome' // 通过市场获得的信用点（税后净入账，累计；2026-09-18 船长改口径）
  | 'ships' // 造出的自造船数
  | 'aiAssigns' // 指派 AI 副船次数
  | 'haulTrips' // 长途运输完成趟数
  | 'wormholeRuns' // 虫洞进洞趟数
  /**
   * **里程碑键**（成就系统第二批 · 船长 2026-09-20「开始第二批」）——这四个**不做链阈值**，
   * 只做里程碑成就的判据；与上面那组同住 `firstStats`（可选字段 ⇒ **老档零迁移**）。
   * - `rareBoxes`：**累计开出的高级箱数**（稀有残骸每烧满 30 m³ 必给一次 ⇒ 一次彩头 = 一箱）。
   *   与"每型已开箱数"账本 `state.rareBoxesOpened` 配对：这里记**全局累计**（跨型号求和）。
   * - `whMaxDepth`：**虫洞到达过的最大层深**（**峰值**，用 `peakFirst` 记 ⇒ 只升不降）。
   * - `whBossClears`：**累计打掉的层末守卫数**。
   * - `matterTechMaxed`：**谜质科技已满级的节点数**（**峰值**；满级后不会掉，故按峰值记也自愈）。
   */
  | 'rareBoxes'
  | 'whMaxDepth'
  | 'whBossClears'
  | 'matterTechMaxed'

/** 一条「第一次」任务 */
export interface FirstTaskDef {
  id: string
  title: string
  /** 任务卡一句话（**不写原因解释、≤30 字**，与 §5 文案硬规矩同口径） */
  brief: string
  /**
   * **任务卡正文**（船长 2026-09-18：「任务内容过于简略，建议加入一定量的文本丰富」）——
   * 一段话讲清"这件事怎么做、做成什么样、有什么好处"，并带一句实物奖励提示。
   * ⚠ 它会超过 §5「说明文案 ≤30 字」那条规矩（那是给商品说明定的）；是否把任务卡正文豁免，已上报船长。
   */
  detail: string
  /** 前置任务 id（未完成 ⇒ 本任务在任务中心不显示） */
  prereq?: string
  /** 完成判据：`count` 达到 1（或技能/声望这类直接判） */
  judge: (state: GameState, ctx: SimContext) => number
  /** 完成时发的通讯 id（`messages.ts` 里的 `first-*`） */
  commsId: string
  /**
   * 奖励（2026-09-18 船长逐条裁定；`items` 字段名沿用旧稿但语义已拆清）：
   * - `isk` 信用点 · `blueprints` 蓝图书（进 `blueprintStock`）· `ware` 仓库物品（进 `warehouse.items`）
   * - `modules` 装备（进 `moduleBay`）· `ships` 舰船（直接进机库）· `aiCores` AI 核心（进核心账本）
   * - `wormholeStock` 未探索虫洞处数（进 `wormholeStock`）
   */
  reward?: {
    isk?: number
    /** 蓝图书（`bp-*` / `sbp-*`）——制造时按"已学会或手上有书"判定 */
    blueprints?: ReadonlyArray<{ blueprintId: string; units: number }>
    /** 仓库物品（`state.warehouse.items`） */
    ware?: ReadonlyArray<{ itemId: string; units: number }>
    /** 装备（`state.moduleBay`，装配页可见） */
    modules?: ReadonlyArray<{ moduleId: string; units: number }>
    /** 舰船（直接进机库；同型会自动编号 #2、#3…） */
    ships?: ReadonlyArray<{ defId: string; units: number }>
    /** AI 核心（**不进仓库**，直接进 `state.aiCores` 账本） */
    aiCores?: ReadonlyArray<{ type: string; units: number }>
    /** 未探索虫洞处数（进 `state.wormholeStock`；一次性奖励允许超库存上限） */
    wormholeStock?: number
  }
  /** 后续"次数"链（阈值表见 `CHAIN_TIERS`） */
  chain?: { id: string; name: string; stat: FirstStatKey | 'scan' | 'skills'; tierKey: string }
}

/**
 * **链阈值表**（2026-09-18 船长第二轮标定：逐条指定新 L10，其余各级"按曲线重排平滑数值"）。
 *
 * 平滑口径（已确认）：**L1~L5 保持原值**（保住早期手感、老档已过的级不受扰动），
 * **L6~L10 按等比 `r = (L10 ÷ L5)^(1/5)` 铺开**并取整到可读值 ⇒ 曲线上没有跳变。
 * 船长逐条定的新 L10：采矿 1,000 万 · 精炼/生产 100 万 · 悬赏 1 万 · 打捞 5 万 ·
 * 虫洞 500 · 造船 1,000 · 技能 500（**当前技能表只到 395 级 ⇒ 顶档留待新增技能**）·
 * 市场 = 1,000 亿信用点（口径由"挂单张数"改为**交易收入**）。
 * 未提到的三条（扫描 / 维修 / AI 指派）与长途运输**保持原值**（船长：「没提到的保持原样」）。
 */
export const CHAIN_TIERS: Readonly<Record<string, readonly number[]>> = {
  // 扫描：全图 20 星系 ⇒ 5 级封顶（船长：「至少 5 级」，有内容上限的按上限做）
  scan: [5, 8, 12, 16, 20],
  // 次数类（L1~L5 原值；L6~L10 等比平滑到船长定的新顶档）
  salvageRuns: [1, 3, 8, 20, 50, 200, 790, 3_150, 12_500, 50_000],
  bountyWins: [1, 3, 8, 20, 50, 144, 415, 1_200, 3_460, 10_000],
  wormholeRuns: [1, 3, 8, 20, 50, 79, 126, 199, 316, 500],
  // 未提到的三条：原值不动
  repairs: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  aiAssigns: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  haulTrips: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  // 市场：**交易收入（税后累计信用点）**，船长选"每级 ×10"（丙案）⇒ 顶档 1,000 亿
  marketIncome: [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000],
  // 舰船：顶档 1,000 艘
  ships: [1, 2, 4, 8, 15, 35, 80, 186, 431, 1_000],
  // 量级链（单位/件数）：采矿顶档 1,000 万；精炼与生产顶档 100 万
  mineUnits: [1_000, 2_500, 6_000, 15_000, 40_000, 120_000, 365_000, 1_100_000, 3_300_000, 10_000_000],
  produceUnits: [10, 25, 60, 150, 400, 1_900, 9_100, 44_000, 209_000, 1_000_000],
  refineBatches: [10, 25, 60, 150, 400, 1_900, 9_100, 44_000, 209_000, 1_000_000],
  skills: [5, 12, 25, 45, 70, 104, 154, 228, 338, 500], // 累计技能等级（满级 395；顶档 500 留待新技能）
}

/**
 * **旧「挂单张数」阈值表**（2026-09-18 换口径前用的那张）——**只给老档一次性折算读**，
 * 新逻辑一律走 `CHAIN_TIERS.marketIncome`（留在这里是为了折算规则可复现、可测）。
 */
export const CHAIN_TIERS_LEGACY_ORDERS: readonly number[] = [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000]

/**
 * **链奖金基准与"第 N 级奖金"**（2026-09-18 船长：「每级的信用点奖励有些过于少，建议按照级别的 5 次方给予奖励」）。
 *
 * 口径：**第 N 级奖金 = 基准 × N⁵**（基准沿用原先的每级 2,500 ⇒ 第 1 级仍是 2,500，往后陡增）：
 * 1→2,500 · 2→80,000 · 3→607,500 · 4→2,560,000 · 5→7,812,500 · 6→19,440,000 · 7→42,017,500 ·
 * 8→81,920,000 · 9→147,622,500 · 10→250,000,000。
 * 领奖时按"已达成级数 − 已领级数"逐级求和（见 `chainPendingRewardIsk` / `claimChainReward`）。
 */
export const CHAIN_REWARD_ISK_BASE = 2_500

/** 第 N 级的奖金（N 从 1 起；非正数一律 0） */
export function chainLevelRewardIsk(level: number): number {
  const n = Math.max(0, Math.floor(level))
  return CHAIN_REWARD_ISK_BASE * n ** 5
}

/** 累计技能等级（Σ trained） */
export function totalSkillLevels(state: GameState): number {
  let n = 0
  for (const v of Object.values(state.skills.trained)) n += v ?? 0
  return n
}

/** 协会声望（虫洞解锁口径：≥40，沿用 `WORMHOLE_SCAN_UNLOCK_STANDING`） */
export function dsiStanding(state: GameState): number {
  return state.standings?.[DSI_FACTION_ID] ?? 0
}

/** 13 条「第一次」任务（顺序 = 任务中心的展示序；`prereq` 只控"是否显示"） */
export const FIRST_TASKS: readonly FirstTaskDef[] = [
  {
    id: 'first-scan',
    title: '第一次扫描',
    brief: '对星图上的未知信号执行一次扫描探索',
    detail: '星图上只剩剪影的位置＝未解读的未知信号。派一艘深空扫描艇就地扫描，窗口走完即点亮该星系：航线、矿带、悬赏与残骸情报一并解锁。母港只需十来秒，其余星系越危险扫得越久。',
    judge: (state, ctx) => state.exploredGalaxies.filter((g) => ctx.galaxies.has(g)).length,
    commsId: 'first-scan',
    chain: { id: 'explorer', name: '宇宙探索家', stat: 'scan', tierKey: 'scan' },
  },
  {
    id: 'first-mine',
    // ⚠ **用词冲突（按 §5.2 已上报船长）**：船长原话是「第一次采集**矿物**」，但「矿物」是 2026-09-12 已作废的旧称
    //   （现行 = 原矿 / 原材料；本行首版就被 `content:check` 的陈旧术语契约拦下）
    //   ⇒ 本批按**现行口径**写成「第一次采集原矿」。若船长要保留"矿物"字样，把它登记为例外即可。
    title: '第一次采集原矿',
    brief: '到矿带采一批原矿',
    detail: '到矿带派出采矿艇：采掘、返航、卸货自动跑完。原矿可以按市价卖出，也可以送进精炼炉炼成原材料——那是绝大多数蓝图的用料。',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.mineUnits ?? 0),
    commsId: 'first-mine',
    // 奖励（船长 2026-09-18）：「第一次采集原矿」⇒ **采集器 MK1**（`mod-miner-1`＝强化采集器 MK1）
    reward: { modules: [{ moduleId: 'mod-miner-1', units: 1 }] },
    chain: { id: 'digger', name: '深空采掘者', stat: 'mineUnits', tierKey: 'mineUnits' },
  },
  {
    id: 'first-salvage',
    title: '第一次打捞残骸',
    brief: '到残骸地点打捞一批',
    detail: '星系里的残骸点可以派船打捞：保底原材料直接入炉，带稀有标记的残骸更值钱，回收炉还能把旧件重新解体成整件装备。',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.salvageRuns ?? 0),
    commsId: 'first-salvage',
    // 奖励（船长 2026-09-18）：打捞器 MK1
    reward: { modules: [{ moduleId: 'mod-salvager-1', units: 1 }] },
    chain: { id: 'scavenger', name: '残骸拾荒者', stat: 'salvageRuns', tierKey: 'salvageRuns' },
  },
  {
    id: 'first-repair',
    title: '第一次维修舰船',
    brief: '用修理组件或港内维修修一次船',
    detail: '护盾脱战后自行回满，装甲与结构的损伤则会跨场保留——用修理组件应急，或回港让工位整体修好。航行前把它们修到六成以上会稳很多。',
    judge: (state) => (state.firstStats?.repairs ?? 0),
    commsId: 'first-repair',
    // 奖励（船长 2026-09-18）：民用修理组件 ×20（船长原话写「民工维修组件」⇒ 按现行物品名 `repairkit-civ` 落地）
    reward: { ware: [{ itemId: 'repairkit-civ', units: 20 }] },
    chain: { id: 'mechanic', name: '维修技师', stat: 'repairs', tierKey: 'repairs' },
  },
  {
    id: 'first-bounty',
    title: '第一次完成悬赏',
    brief: '打赢一场悬赏讨伐',
    detail: '常驻悬赏按威胁分档：档位越高敌人越厚、火力越重，报酬与协会声望也越高。声望是协会渠道的通行证，市场门槛与虫洞扫描都看它。',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.bountyWins ?? 0),
    commsId: 'first-bounty',
    // 奖励（船长 2026-09-18）：一艘鲣鱼级（直接进机库；同型自动编号 #2）
    reward: { ships: [{ defId: 'sh-falconet', units: 1 }] },
    chain: { id: 'hunter', name: '赏金猎人', stat: 'bountyWins', tierKey: 'bountyWins' },
  },
  {
    id: 'first-refine',
    title: '第一次操作精炼炉',
    brief: '让精炼炉出一批料',
    detail: '精炼炉按批运转：原料够一批就能起炉，料尽自动停炉，装满则按批续烧。精炼学每级 +6% 产出、高级回收处理每级 +3%，两条练满可到 165%。',
    prereq: 'first-mine',
    judge: (state) => (state.firstStats?.refineBatches ?? 0),
    commsId: 'first-refine',
    // 奖励（船长 2026-09-18）：动能弹药生产线蓝图（原挂在②，现按船长裁定移到本条）
    reward: { blueprints: [{ blueprintId: 'bp-ammo-kinetic', units: 1 }] },
    chain: { id: 'refiner', name: '精炼师', stat: 'refineBatches', tierKey: 'refineBatches' },
  },
  {
    id: 'first-produce',
    title: '第一次生产',
    brief: '让组装机造出一件东西',
    detail: '组装机要三样：蓝图、材料、时间。装上 AI 核心就能无人值守开线，弹药与修理组件这类消耗品最适合常驻。',
    prereq: 'first-mine',
    judge: (state) => (state.firstStats?.produceUnits ?? 0),
    commsId: 'first-produce',
    // 奖励（船长 2026-09-18）：「新建一张沙猫级的蓝图，按照沙猫级价值 1W 来设定」（`sbp-sandcat`，
    // 不进市场、只靠这条任务发放；数值推导见 `data/src/shipBlueprints.ts` 该条目注释）。
    reward: { blueprints: [{ blueprintId: 'sbp-sandcat', units: 1 }] },
    chain: { id: 'lineboss', name: '产线主管', stat: 'produceUnits', tierKey: 'produceUnits' },
  },
  {
    id: 'first-order',
    title: '第一次挂单销售',
    brief: '在市场挂出一张卖单',
    detail: '市场吃三路单子：协会挂出的常驻买卖单、玩家自留的挂单、以及贴着价线巡游的抢单。挂价越贴收购线成交越快，挂得高则是在赌巡游采购上门。',
    prereq: 'first-produce',
    judge: (state) => (state.firstStats?.orders ?? 0),
    commsId: 'first-order',
    // 2026-09-18 船长改口径：「挂单按照市场交易收入计数」⇒ 判据从挂单张数改成税后交易收入
    chain: { id: 'marketeer', name: '市场老手', stat: 'marketIncome', tierKey: 'marketIncome' },
  },
  {
    id: 'first-ship',
    title: '第一条船',
    brief: '造出第一艘自造船',
    detail: '造舰与造装备是同一条链路：舰船蓝图＋材料＋机库工位。新船入机库待命，装配页配好槽位与弹档即可编入出港编队。',
    prereq: 'first-produce',
    judge: (state) => (state.firstStats?.ships ?? 0),
    commsId: 'first-ship',
    // 奖励（船长 2026-09-18）：民用船体维修装置（船长原话写「民用体维修装置」⇒ 按现行装备名落地）
    reward: { modules: [{ moduleId: 'mod-hullrep-civ', units: 1 }] },
    chain: { id: 'shipwright', name: '造船厂主', stat: 'ships', tierKey: 'ships' },
  },
  {
    id: 'first-skill',
    title: '第一次学习技能',
    brief: '把 AI 核心操作学练到 Lv1',
    detail: '技能按现实时长训练，队列排好就能一直练，高效学习法能压缩全部训练时间。AI 核心操作学是调度副船与自动产线的前置。',
    judge: (state) => state.skills.trained['ai-expert'] ?? 0,
    commsId: 'first-skill',
    /**
     * **基础 AI 核心 ×1**（船长 2026-09-17 裁决：「AI 核心放在'第一次技能'里给」）。
     *
     * 由来：旧教程里这枚核心是「交付首批原矿」白送的；教程退场后，下一件「第一次指派 AI 副船」会被
     * 市场价（实测 ~25,000 信用点）挡住半小时以上 ⇒ 船长把它挂到这条任务：练成 AI 核心操作学 Lv1
     * 即领一枚（正好接上"给沙猫派个 AI 任务"这一步）。
     */
    reward: { aiCores: [{ type: 'basic', units: 1 }] },
    chain: { id: 'scholar', name: '学而不厌', stat: 'skills', tierKey: 'skills' },
  },
  {
    id: 'first-ai',
    title: '第一次指派 AI 副船',
    brief: '给一艘闲置舰船派个 AI 任务',
    detail: '闲置舰船配上一枚 AI 核心就能自己出海：采矿、打捞、驻留待命都能接。每项指派占一枚核心，核心等级越高作业效率越高。',
    // 船长 2026-09-17：「将安排 AI 核心的任务设置为需要玩家完成学习技能才出现」
    prereq: 'first-skill',
    judge: (state) => (state.firstStats?.aiAssigns ?? 0),
    commsId: 'first-ai',
    chain: { id: 'dispatch', name: '舰队调度', stat: 'aiAssigns', tierKey: 'aiAssigns' },
  },
  {
    id: 'first-haul',
    title: '第一次长途运输',
    brief: '完成一趟长途运输',
    detail: '长途运输在站与站之间按趟结算，报酬随行情浮动；低安航段会遇袭，出发前把装甲与结构留足余量。',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.haulTrips ?? 0),
    commsId: 'first-haul',
    // 奖励（船长 2026-09-18）：飞鱼级快运舰（直接进机库）
    reward: { ships: [{ defId: 'sh-flyingfish', units: 1 }] },
    chain: { id: 'freight', name: '星际货运', stat: 'haulTrips', tierKey: 'haulTrips' },
  },
  {
    id: 'first-wormhole',
    title: '第一次虫洞',
    brief: '把深空工业协会声望攒到 40',
    detail: '协会声望攒到 40 就能展开虫洞扫描阵列：扫出的通道从第 1 层开始，越深越险也越肥。洞内是搜、打、撤三条线，带不回来的等于没有。',
    prereq: 'first-scan',
    // 任务目标就是"完成解锁条件的内容"（船长原话）⇒ 判据 = 声望门槛（虫洞解锁线 40）
    judge: (state) => (dsiStanding(state) >= WORMHOLE_UNLOCK_STANDING ? 1 : 0),
    commsId: 'first-wormhole',
    // 奖励（船长 2026-09-18）：两次虫洞探索（＝标记 2 处未探索虫洞进库存；允许超库存上限）
    reward: { wormholeStock: 2 },
    chain: { id: 'abyss', name: '深渊探索者', stat: 'wormholeRuns', tierKey: 'wormholeRuns' },
  },
]

/** 终身计数加一（事件落点调用）。`key` 常规取值见 `FirstStatKey`；任务中心领奖额用 `paid-<链 id>` 这类派生键，
 * 故签名放宽为 string（底层就是 `Record<string, number>`）。 */
export function bumpFirst(state: GameState, key: string, n = 1): void {
  if (n <= 0) return
  const bag = (state.firstStats ??= {})
  bag[key] = (bag[key] ?? 0) + n
}

/**
 * **峰值记录**（里程碑批新增 · 2026-09-20）：把 `key` 抬到 `v`，**只升不降**。
 *
 * 为什么要有它（与 `bumpFirst` 的分工）：`bumpFirst` 是"又发生了一次"的累计，
 * 而有些量是**状态而非事件**——典型 = 「虫洞到达过的最大层深」：那趟打完就没了，
 * 只能在下潜那一刻把"当前深度"报上来。用峰值记有三条好处：
 * ① **老档零迁移**（缺省 0）；② **幂等**（同一深度反复报不会重复计数，读档/重算安全）；
 * ③ **不回退**（不会因为玩家这趟只下到 2 层就把纪录改小）。
 *
 * ⚠ 传 `NaN` / 非有限值会被忽略（`Math.max` 遇 `NaN` 会污染成 `NaN`，这里挡掉）。
 */
export function peakFirst(state: GameState, key: string, v: number): void {
  if (!Number.isFinite(v)) return
  const bag = (state.firstStats ??= {})
  const prev = bag[key] ?? 0
  if (v > prev) bag[key] = v
}

/** 读终身计数（缺省 0；老档没有这个字段 ⇒ 0，零迁移） */
export function firstStatOf(state: GameState, key: FirstStatKey | 'scan' | 'skills'): number {
  if (key === 'scan') return state.exploredGalaxies.length
  if (key === 'skills') return totalSkillLevels(state)
  return state.firstStats?.[key] ?? 0
}

/** 某条链的当前进度（级数 = 已达成的档数，0 = 一级都还没到） */
export function chainProgressOf(
  state: GameState,
  chain: { stat: FirstStatKey | 'scan' | 'skills'; tierKey: string },
): { count: number; level: number; next: number | null; total: number } {
  const tiers = CHAIN_TIERS[chain.tierKey] ?? []
  const count = firstStatOf(state, chain.stat)
  let level = 0
  for (const t of tiers) if (count >= t) level += 1
  return { count, level, next: tiers.find((t) => count < t) ?? null, total: tiers.length }
}

/**
 * **推进「第一次」任务**（引擎每拍调用）：判定达成 ⇒ 写 `importantTasks[id]`（去重、只置一次），
 * 返回本次**新完成**的任务 id 列表（调用方据此发通讯/日志/奖励）。
 *
 * 为什么要"事件置位 ＋ 本函数统一判定"两条腿：计数是事件驱动的（不怕读档重算），
 * 而 `importantTasks` 的 done 标记保证**奖励与通讯只发一次**（与既有教程奖励同款去重口径）。
 *
 * 🔖 **成就系统的预留接口**（船长 2026-09-18：「顺便打算制作成就系统，每个重要任务就会给予一个成就徽章，
 * 不过等做完这个之后再考虑，先挂机，可以预留接口」）：本函数的返回值**就是**那个挂点——
 * 谁要发徽章，就在拿到 `id` 的地方加一次发放（与 `firstRewards.grantFirstReward` 同一个调用点，
 * 见 `engine.ts` 的那段循环）；判定/去重/老档语义全都不用改。**成就系统本身本批不做**。
 */
export function advanceFirstTasks(state: GameState, ctx: SimContext): string[] {
  const newly: string[] = []
  for (const def of FIRST_TASKS) {
    if (state.importantTasks[def.id]?.done === true) continue
    if (def.judge(state, ctx) < 1) continue
    state.importantTasks[def.id] = { done: true }
    newly.push(def.id)
  }
  return newly
}

/**
 * **链任务升级**（引擎每拍调用）：某条链的进度越过新的一档 ⇒ 记下"已达成到第几级"。
 *
 * 记账复用 importantTasks[chain-<id>].delivered（已达成到第几级；done 恒 false——链没有"做完"），
 * 老档缺这个键 ⇒ 从 0 起算。返回本次升级的链（`isk` = 本次新达成各级的奖金合计，仅作读数，
 * **不在这里发钱**：ISK 由任务中心领奖时经 `claimChainReward` 发放）。
 */
export function advanceFirstChains(state: GameState): Array<{ id: string; name: string; level: number; isk: number }> {
  const out: Array<{ id: string; name: string; level: number; isk: number }> = []
  for (const def of FIRST_TASKS) {
    if (!def.chain) continue
    const key = `chain-${def.chain.id}`
    const { level } = chainProgressOf(state, def.chain)
    const before = state.importantTasks[key]?.delivered ?? 0
    if (level <= before) continue
    state.importantTasks[key] = { done: false, delivered: level }
    let isk = 0
    for (let i = before + 1; i <= level; i++) isk += chainLevelRewardIsk(i)
    out.push({ id: def.chain.id, name: def.chain.name, level, isk })
  }
  return out
}

/**
 * **某条链当前可领的奖金**（任务中心卡片显示与领奖共用同一把尺；链不在表里 ⇒ 0）。
 * 口径 = Σ 第 i 级奖金，i 从"已领级数 + 1"到"已达成级数"（见 `chainLevelRewardIsk`）。
 */
export function chainPendingRewardIsk(state: GameState, chainId: string): number {
  const def = FIRST_TASKS.find((d) => d.chain?.id === chainId)
  if (!def?.chain) return 0
  const { level } = chainProgressOf(state, def.chain)
  const paid = state.firstStats?.[`paid-${def.chain.id}`] ?? 0
  if (level <= paid) return 0
  let sum = 0
  for (let i = paid + 1; i <= level; i++) sum += chainLevelRewardIsk(i)
  return sum
}

/**
 * **领取链任务奖金**（任务中心的领奖入口；返回本次发出的 ISK）。
 *
 * 口径：升级记账在 advanceFirstChains()（每拍）；**发钱只在这里**（点一次领一次，避免钱包被悄悄加钱）。
 * 每级奖金 = 基准 × N⁵（见 `chainLevelRewardIsk`）；已领额度记在 `firstStats` 的 `paid-<链 id>` 上（零迁移）。
 */
export function claimChainReward(state: GameState, chainId: string): number {
  const def = FIRST_TASKS.find((d) => d.chain?.id === chainId)
  if (!def?.chain) return 0
  const { level } = chainProgressOf(state, def.chain)
  const paid = state.firstStats?.[`paid-${def.chain.id}`] ?? 0
  if (level <= paid) return 0
  const isk = chainPendingRewardIsk(state, chainId)
  bumpFirst(state, `paid-${def.chain.id}`, level - paid)
  state.wallet.isk += isk
  return isk
}

/**
 * **功能 / 页面解锁表**（船长 2026-09-17 定案 · 数据驱动）：key = 页面或星图页签，value = 需要完成的「第一次」任务 id。
 *
 * 口径（船长原话）：「**所有和星图相关的，比如战斗和采矿，需要玩家先完成第一次扫描**（初始将母港星系设置为和其他星系
 * 一样的未知状态，需要扫描才有悬赏和挖矿）」＋「**市场页面和相关任务要玩家先完成第一次生产**」＋
 * 「**工业界面和相关任务则需要玩家先完成第一次采集矿物**」。
 *
 * 用法：界面只读这一张表（`unlocked()` 判定）——**未解锁的页面与任务都不显示**（船长选「两者都隐藏」）。
 * 星图页本体、舰船/装配/物品/技能/任务中心/通讯/手册**不在这张表里** ⇒ 开局即可用。
 */
export const FIRST_UNLOCKS: Readonly<Record<string, string>> = {
  industry: 'first-mine', // 工业页 ← 第一次采集原矿
  market: 'first-produce', // 市场页 ← 第一次生产
  mapMine: 'first-scan', // 星图·矿带开采 ← 第一次扫描
  mapBounty: 'first-scan', // 星图·常驻悬赏（战斗）← 第一次扫描
  mapSalvage: 'first-scan', // 星图·残骸打捞 ← 第一次扫描
  mapHaul: 'first-scan', // 星图·长途运输 ← 第一次扫描
}

/**
 * **「第一次完成悬赏」的照会战加成**（2026-09-17 教程重做：原属"试炼步骤"的教学战加成改挂到这条任务上）。
 *
 * 判据 = 打的是**演习场驱逐令** ＋ **本舰主控** ＋ 这条任务**未完成** ⇒ 命中/回避各 +0.5（仅该场）。
 * 渲染侧（`combat.ts` 每拍规格重建）与预估侧（`winEstimate.ts` 的快照）走**同一个判据**，
 * 所以悬赏卡上显示的胜率与实战一致（快照必须同步 `importantTasks['first-bounty']`）。
 */
export function isFirstBountyBattle(state: GameState, anomalyId: string | null, shipId: string): boolean {
  return anomalyId === 'ano-training' && shipId === state.shipId && state.importantTasks['first-bounty']?.done !== true
}

/** 照会战加成的命中/回避值（船长 2026-09-05 定 0.5；模拟 6/6 种子稳胜 ≤25s） */
export const FIRST_BOUNTY_HIT_BONUS = 0.5
export const FIRST_BOUNTY_EVASION_BONUS = 0.5

/** 把照会战加成注入玩家规格（调用方在每拍重建规格处使用） */
export function applyFirstBountyBuff(spec: { hitBonus: number; evasion: number }): void {
  spec.hitBonus += FIRST_BOUNTY_HIT_BONUS
  spec.evasion += FIRST_BOUNTY_EVASION_BONUS
}

/** 该页面/页签是否已解锁（表里没有的 key ⇒ 恒真 = 开局可用） */
export function unlocked(state: GameState, key: string): boolean {
  const need = FIRST_UNLOCKS[key]
  if (!need) return true
  return state.importantTasks[need]?.done === true
}
/** 未解锁时所需的「第一次」任务名（界面提示用；key 不在表里 ⇒ undefined） */
export function unlockNeedTitle(key: string): string | undefined {
  const need = FIRST_UNLOCKS[key]
  return need === undefined ? undefined : FIRST_TASKS.find((d) => d.id === need)?.title
}
/** 任务中心用：按前置过滤后的可见任务（未满足前置 ⇒ 不显示） */
export function visibleFirstTasks(state: GameState): FirstTaskDef[] {
  return FIRST_TASKS.filter((d) => d.prereq === undefined || state.importantTasks[d.prereq]?.done === true)
}

/** 任务中心**一张卡的读数**（面板只渲染，不自己算——置顶/隐藏两条规矩都在这里定，便于用例钉住） */
export interface FirstTaskRow {
  def: FirstTaskDef
  done: boolean
  /** 链的当前档位与总档数（无链 ⇒ 0/0） */
  level: number
  total: number
  count: number
  next: number | null
  /** 当前可领奖金（0 = 没得领） */
  pendingIsk: number
  /**
   * **完成"正在推进的这一级"能拿的奖金**（船长 2026-09-18：「任务奖金要写清楚当前这级的具体数额，
   * 不能让玩家自己算」）＝第 `level + 1` 级的奖金；已满档 ⇒ 0。
   */
  nextRewardIsk: number
  /** **已全部完成**（做完了 ＋ 链满档 ＋ 没有可领的）⇒ 面板隐藏（船长 2026-09-18：「已经全部完成的重要任务隐藏」） */
  hidden: boolean
}

/**
 * **任务中心的卡片序列**（2026-09-18 船长两条 UI 规矩的数据侧）：
 * ① 先按前置过滤（`visibleFirstTasks`）→ ② 排掉"已全部完成"的 → ③ **置顶排序**：
 * **可领奖 → 已完成 → 未完成**（组内保持 `FIRST_TASKS` 原序，方便玩家一进来就把奖励收掉）。
 */
export function firstTaskBoard(state: GameState): FirstTaskRow[] {
  const rows: FirstTaskRow[] = visibleFirstTasks(state).map((def) => {
    const done = state.importantTasks[def.id]?.done === true
    const prog = def.chain ? chainProgressOf(state, def.chain) : null
    const pendingIsk = def.chain ? chainPendingRewardIsk(state, def.chain.id) : 0
    const maxed = prog !== null && prog.level >= prog.total
    return {
      def,
      done,
      level: prog?.level ?? 0,
      total: prog?.total ?? 0,
      count: prog?.count ?? 0,
      next: prog?.next ?? null,
      pendingIsk,
      // 正在推进的那一级 = 已达级数 + 1；满档 ⇒ 0（没有"下一级"了）
      nextRewardIsk: maxed ? 0 : chainLevelRewardIsk((prog?.level ?? 0) + 1),
      hidden: done && maxed && pendingIsk <= 0,
    }
  })
  const rank = (r: FirstTaskRow): number => (r.pendingIsk > 0 ? 0 : r.done ? 1 : 2)
  return rows.filter((r) => !r.hidden).sort((a, b) => rank(a) - rank(b))
}

