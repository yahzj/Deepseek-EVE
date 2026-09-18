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
 *   本轮只有 ②「第一次采集矿物」真填一张蓝图（`bp-ammo-kinetic`），其余留空。
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
  | 'orders' // 挂出的卖单数
  | 'ships' // 造出的自造船数
  | 'aiAssigns' // 指派 AI 副船次数
  | 'haulTrips' // 长途运输完成趟数
  | 'wormholeRuns' // 虫洞进洞趟数

/** 一条「第一次」任务 */
export interface FirstTaskDef {
  id: string
  title: string
  /** 任务卡一句话（**不写原因解释、≤30 字**，与 §5 文案硬规矩同口径） */
  brief: string
  /** 前置任务 id（未完成 ⇒ 本任务在任务中心不显示） */
  prereq?: string
  /** 完成判据：`count` 达到 1（或技能/声望这类直接判） */
  judge: (state: GameState, ctx: SimContext) => number
  /** 完成时发的通讯 id（`messages.ts` 里的 `first-*`） */
  commsId: string
  /** 奖励：`items` 预留接口；ISK 由链任务用 */
  reward?: { isk?: number; items?: ReadonlyArray<{ itemId: string; units: number }> }
  /** 后续"次数"链（阈值表见 `CHAIN_TIERS`） */
  chain?: { id: string; name: string; stat: FirstStatKey | 'scan' | 'skills'; tierKey: string }
}

/** 链阈值表（**初版值 · 集中一处便于标定**；船长复核后改这里即可） */
export const CHAIN_TIERS: Readonly<Record<string, readonly number[]>> = {
  // 扫描：全图 20 星系 ⇒ 5 级封顶（船长：「至少 5 级」，有内容上限的按上限做）
  scan: [5, 8, 12, 16, 20],
  // 其余无内容上限 ⇒ 10 级（次数类 ×~2.4 递增；单位类给量级）
  salvageRuns: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  bountyWins: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  repairs: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  orders: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  aiAssigns: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  haulTrips: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  wormholeRuns: [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000],
  ships: [1, 2, 4, 8, 15, 25, 40, 60, 90, 130],
  mineUnits: [1_000, 2_500, 6_000, 15_000, 40_000, 100_000, 250_000, 600_000, 1_500_000, 4_000_000],
  produceUnits: [10, 25, 60, 150, 400, 1_000, 2_500, 6_000, 15_000, 40_000],
  refineBatches: [10, 25, 60, 150, 400, 1_000, 2_500, 6_000, 15_000, 40_000],
  skills: [5, 12, 25, 45, 70, 100, 140, 190, 250, 320], // 累计技能等级
}

/** 链任务发 ISK（船长：「选项1的基础上，考虑顺便给点其他东西」⇒ 链任务给钱，物品留给 items 接口） */
export const CHAIN_REWARD_ISK = 2_500

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
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.mineUnits ?? 0),
    commsId: 'first-mine',
    // ⚠ 唯一带奖励的「第一次」：动能弹药生产线蓝图（产物动能弹药 ×120、材料钛钢合金＝精炼产物）
    //   ⇒ 正好串起"采集 → 精炼 → 生产"，同时解开"没有蓝图 ⇒ 生产不了 ⇒ 市场锁死"的死锁。
    reward: { items: [{ itemId: 'bp-ammo-kinetic', units: 1 }] },
    chain: { id: 'digger', name: '深空采掘者', stat: 'mineUnits', tierKey: 'mineUnits' },
  },
  {
    id: 'first-salvage',
    title: '第一次打捞残骸',
    brief: '到残骸地点打捞一批',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.salvageRuns ?? 0),
    commsId: 'first-salvage',
    chain: { id: 'scavenger', name: '残骸拾荒者', stat: 'salvageRuns', tierKey: 'salvageRuns' },
  },
  {
    id: 'first-repair',
    title: '第一次维修舰船',
    brief: '用修理组件或港内维修修一次船',
    judge: (state) => (state.firstStats?.repairs ?? 0),
    commsId: 'first-repair',
    chain: { id: 'mechanic', name: '维修技师', stat: 'repairs', tierKey: 'repairs' },
  },
  {
    id: 'first-bounty',
    title: '第一次完成悬赏',
    brief: '打赢一场悬赏讨伐',
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.bountyWins ?? 0),
    commsId: 'first-bounty',
    chain: { id: 'hunter', name: '赏金猎人', stat: 'bountyWins', tierKey: 'bountyWins' },
  },
  {
    id: 'first-refine',
    title: '第一次操作精炼炉',
    brief: '让精炼炉出一批料',
    prereq: 'first-mine',
    judge: (state) => (state.firstStats?.refineBatches ?? 0),
    commsId: 'first-refine',
    chain: { id: 'refiner', name: '精炼师', stat: 'refineBatches', tierKey: 'refineBatches' },
  },
  {
    id: 'first-produce',
    title: '第一次生产',
    brief: '让组装机造出一件东西',
    prereq: 'first-mine',
    judge: (state) => (state.firstStats?.produceUnits ?? 0),
    commsId: 'first-produce',
    chain: { id: 'lineboss', name: '产线主管', stat: 'produceUnits', tierKey: 'produceUnits' },
  },
  {
    id: 'first-order',
    title: '第一次挂单销售',
    brief: '在市场挂出一张卖单',
    prereq: 'first-produce',
    judge: (state) => (state.firstStats?.orders ?? 0),
    commsId: 'first-order',
    chain: { id: 'marketeer', name: '市场老手', stat: 'orders', tierKey: 'orders' },
  },
  {
    id: 'first-ship',
    title: '第一条船',
    brief: '造出第一艘自造船',
    prereq: 'first-produce',
    judge: (state) => (state.firstStats?.ships ?? 0),
    commsId: 'first-ship',
    chain: { id: 'shipwright', name: '造船厂主', stat: 'ships', tierKey: 'ships' },
  },
  {
    id: 'first-skill',
    title: '第一次学习技能',
    brief: '把 AI 核心操作学练到 Lv1',
    judge: (state) => state.skills.trained['ai-expert'] ?? 0,
    commsId: 'first-skill',
    chain: { id: 'scholar', name: '学而不厌', stat: 'skills', tierKey: 'skills' },
  },
  {
    id: 'first-ai',
    title: '第一次指派 AI 副船',
    brief: '给一艘闲置舰船派个 AI 任务',
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
    prereq: 'first-scan',
    judge: (state) => (state.firstStats?.haulTrips ?? 0),
    commsId: 'first-haul',
    chain: { id: 'freight', name: '星际货运', stat: 'haulTrips', tierKey: 'haulTrips' },
  },
  {
    id: 'first-wormhole',
    title: '第一次虫洞',
    brief: '把深空工业协会声望攒到 40',
    prereq: 'first-scan',
    // 任务目标就是"完成解锁条件的内容"（船长原话）⇒ 判据 = 声望门槛（虫洞解锁线 40）
    judge: (state) => (dsiStanding(state) >= WORMHOLE_UNLOCK_STANDING ? 1 : 0),
    commsId: 'first-wormhole',
    chain: { id: 'abyss', name: '深渊探索者', stat: 'wormholeRuns', tierKey: 'wormholeRuns' },
  },
]

/** 终身计数加一（事件落点调用；`key` 见 `FirstStatKey`） */
export function bumpFirst(state: GameState, key: FirstStatKey, n = 1): void {
  if (n <= 0) return
  const bag = (state.firstStats ??= {})
  bag[key] = (bag[key] ?? 0) + n
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
 * **发放一条任务的奖励**（引擎在"新完成"时调用一次；`items` 走 `blueprintStock`——现阶段唯一的物品奖励是
 * 「第一次采集原矿」那张动能弹药蓝图，其余留空 ⇒ 船长说的"先把物品奖励接口留出来"就在这里）。
 */
export function grantFirstReward(state: GameState, def: FirstTaskDef): void {
  for (const it of def.reward?.items ?? []) {
    state.blueprintStock[it.itemId] = (state.blueprintStock[it.itemId] ?? 0) + it.units
  }
  const isk = def.reward?.isk ?? 0
  if (isk > 0) state.wallet.isk += isk
}
/**
 * **链任务升级**（引擎每拍调用）：某条链的进度越过新的一档 ⇒ **每级发一次 ISK**（CHAIN_REWARD_ISK）。
 *
 * 记账复用 importantTasks[chain-<id>].delivered（已达成到第几级；done 恒 false——链没有"做完"），
 * 老档缺这个键 ⇒ 从 0 起算。返回本次升级的链（调用方当前不写日志，保持既有"离线事件条数"口径）。
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
    const isk = CHAIN_REWARD_ISK * (level - before)
    state.wallet.isk += isk
    out.push({ id: def.chain.id, name: def.chain.name, level, isk })
  }
  return out
}
/** 任务中心用：按前置过滤后的可见任务（未满足前置 ⇒ 不显示） */
export function visibleFirstTasks(state: GameState): FirstTaskDef[] {
  return FIRST_TASKS.filter((d) => d.prereq === undefined || state.importantTasks[d.prereq]?.done === true)
}

