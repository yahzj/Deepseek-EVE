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
 * - **奖励**（现行表见各条的 `reward` 行注释；总口径 = 2026-09-18 船长定的六口袋表 ＋ **2026-09-20 前移**）：
 *   **采集器 MK1 ⇒「第一次扫描」** · **打捞器 MK1 ⇒「第一次采集原矿」** · 动能弹药生产线蓝图 ⇒「第一次操作精炼炉」·
 *   民用修理组件 ×20 ⇒「第一次维修舰船」· 一艘鲣鱼级 ⇒「第一次完成悬赏」· 沙猫级舰船蓝图 ⇒「第一次生产」·
 *   民用船体维修装置 ×1 ⇒「第一条船」· 基础 AI 核心 ×1 ⇒「第一次学习技能」· 一艘飞鱼级快运舰 ⇒「第一次长途运输」·
 *   未探索虫洞 ×2 ⇒「第一次虫洞」；
 *   **「第一次打捞残骸」自 2026-09-20 起无实物奖励**（打捞器已前移到挖矿那条）；「第一次挂单销售」「第一次指派 AI 副船」
 *   两条一直只有情报信。发放逻辑在 `firstRewards.grantFirstReward`（老档迁移不发奖励）。
 * - **顺序解锁 ＝ 显示与判定同一把尺**（**2026-09-20 船长转玩家反馈**：「**新手引导的重要任务一次性太多了，
 *   建议按顺序排列解锁**」；同时「**已经完成「第一次」任务后的里程碑任务链，建议单开一个任务中心的子页面
 *   「里程碑任务」**」；**同日第二道令**：「**未显示的第一次任务可以提前完成**」＝ 报障）：
 *   13 条「第一次」**串成一条线**——`FIRST_TASKS` 的数组序就是解锁序，`visibleFirstTasks` 只给
 *   **第一条还没完成的**（已完成的也不再占位，进度看页头 N/13）；**旧口径「自由选择完成 ＋ `prereq` 只控可见」作废**
 *   （`prereq` 字段已删）。**判定同样只认当前那一条**（见 `advanceFirstTasks`）：后面的条目即便条件已满足
 *   也**不提前判过**（不提前发奖励/情报信/成就），等轮到那一拍按档内现状补齐（自愈、进度不丢）。
 * - **末段并列批**（**同日第三道令**：「**完成 11 · 第一次指派 AI 副船后，就可以将寻找人类和第一次长途运输
 *   以及 第一次虫洞同时显示给玩家。寻找人类位于顶部。**」）：前 **11 条**仍顺序解锁、一次一条；
 *   它们走完 ⇒ 「第一次长途运输」「第一次虫洞」**一起显示、互不阻塞**（判定也一起判，见 `PARALLEL_TAIL_IDS`），
 *   贯穿任务「寻找人类」由 `onboarding.publishFindHumansWhenReady` **改在此时发布**、由 `ImportantTasks.tsx`
 *   画在列表**顶部**（旧口径「13 条全完成才出现」作废）。
 *   同日第三道令还给**三条原先没有实物奖励**的条目（打捞 / 挂单 / 指派 AI 副船）各补 **10,000 信用点**。
 *   链（里程碑）本身从开局就在累计，但**只在对应的「第一次」完成后才上「里程碑任务」页**
 *   （判据见 `milestoneBoard` 的 `unlocked`）。
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
   *
   * ⚠ **2026-09-20 船长令「里程碑都加入追溯检查」**：这六个键（含下面两个）全部由
   * `engine.reconcileMilestoneStats` 每拍按 `state` 现算兜底（`peakFirst` 只抬不降）⇒
   * 老档/漏发都能补；哪些是精确值、哪些只是下界，逐条写在该函数里。
   */
  | 'rareBoxes'
  | 'whMaxDepth'
  | 'whBossClears'
  | 'matterTechMaxed'
  /**
   * 另两个**峰值型**里程碑键（2026-09-20 补齐类型：它们一直在用，只是漏登记在本联合里）：
   * - `aiCoreKinds`：**库存里拥有过的 AI 核心类数**（峰值；花掉一枚不回退）；
   * - `sitesBuilt`：**已建成并入网的副空间站座数**（峰值）。
   * ⚠ 两者都由 `engine.reconcilePeakStats` 每拍按 `state` 现算兜底 ⇒ 老档/漏发自愈。
   */
  | 'aiCoreKinds'
  | 'sitesBuilt'

/**
 * **奖励口袋**（**完成奖励** `reward` 与**起手道具** `startReward` 共用同一形状）：
 * - `isk` 信用点 · `blueprints` 蓝图书（进 `blueprintStock`）· `ware` 仓库物品（进 `warehouse.items`）
 * - `modules` 装备（进 `moduleBay`）· `ships` 舰船（直接进机库）· `aiCores` AI 核心（进核心账本）
 * - `wormholeStock` 未探索虫洞处数（进 `wormholeStock`）
 */
export interface FirstReward {
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
  /** 未探索虫洞处数（进 `wormholeStock`；一次性奖励允许超库存上限） */
  wormholeStock?: number
}

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
  /** 完成判据：`count` 达到 1（或技能/声望这类直接判） */
  judge: (state: GameState, ctx: SimContext) => number
  /** 完成时发的通讯 id（`messages.ts` 里的 `first-*`） */
  commsId: string
  /**
   * **完成奖励**（2026-09-18 船长逐条裁定）——**发放时机 = 玩家在任务中心点「完成」那一刻**
   * （**2026-09-21 船长令**：「第一次任务不要自动完成。要让玩家回到任务中心点击完成才开始下一步」）。
   * 口袋形状见 `FirstReward`。
   */
  reward?: FirstReward
  /**
   * **起手道具**（**2026-09-21 船长令**：「**能否加一个任务开始时给予道具的功能？（比如开始第一次打捞，
   * 给予一个打捞器）**」；同日口径：「…这样**给予任务开始前道具的时间点就很明确**」）。
   *
   * 发放时机 = **这条任务"轮到"的那一刻**，三处、**不做每拍扫描**：
   * ① 第一条（「第一次扫描」）在**序章收尾**（`onboarding.finishPrologue`）；
   * ② 其余条在**上一条被点「完成」的那一次点击里**（`firstRewards.claimFirstTask`）；
   * ③ 末段并列批（长途运输 / 虫洞）在它俩一起显示的那一次点击里（同上）。
   *
   * 去重键 = `state.importantTasks[id].started === true`（**只在发放时写这个键** ⇒ 老档零迁移）；
   * **不回收**（给了就是给了，任务没做完也留着——与完成奖励"发出不收回"同口径）。
   */
  startReward?: FirstReward
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
 *
 * ⚠ **⟪2026-09-23 船长令⟫ 第三轮标定**：「**L1 依旧是 2500，但是 L10 奖金降低至 2500 万。除扫描外统计量所需数量
 * 1 级不变的情况下，满级提高 10 倍**」＋「**成就需求量的中间级进行平滑处理**」⇒
 * 除 scan（5 级封顶、不动）外，12 条链 **L1~L5 保持原值、L6~L10 按  = (新L10 ÷ L5)^(1/5) 等比平滑**（新 L10 = 旧 ×10）。
 */
export const CHAIN_TIERS: Readonly<Record<string, readonly number[]>> = {
  // 扫描：全图 20 星系 ⇒ 5 级封顶（船长：「至少 5 级」，有内容上限的按上限做）
  scan: [5, 8, 12, 16, 20],
  // 次数类（L1~L5 原值；L6~L10 等比平滑到船长定的新顶档）
  salvageRuns: [1, 3, 8, 20, 50, 320, 2_000, 12_600, 79_000, 500_000],
  bountyWins: [1, 3, 8, 20, 50, 230, 1_050, 4_800, 21_900, 100_000],
  wormholeRuns: [1, 3, 8, 20, 50, 126, 316, 794, 1_995, 5_000],
  // 未提到的三条：原值不动
  repairs: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  aiAssigns: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  haulTrips: [1, 3, 8, 20, 50, 180, 650, 2_320, 8_350, 30_000],
  // 市场：**交易收入（税后累计信用点）**，船长选"每级 ×10"（丙案）⇒ 顶档 1,000 亿
  marketIncome: [100, 1_000, 10_000, 100_000, 1_000_000, 16_000_000, 250_000_000, 4_000_000_000, 63_000_000_000, 1_000_000_000_000],
  // 舰船：顶档 1,000 艘
  ships: [1, 2, 4, 8, 15, 55, 202, 741, 2_720, 10_000],
  // 量级链（单位/件数）：采矿顶档 1,000 万；精炼与生产顶档 100 万
  mineUnits: [1_000, 2_500, 6_000, 15_000, 40_000, 190_000, 910_000, 4_370_000, 20_900_000, 100_000_000],
  produceUnits: [10, 25, 60, 150, 400, 3_000, 23_000, 174_000, 1_320_000, 10_000_000],
  refineBatches: [10, 25, 60, 150, 400, 3_000, 23_000, 174_000, 1_320_000, 10_000_000],
  skills: [5, 12, 25, 45, 70, 164, 386, 907, 2_130, 5_000], // 累计技能等级（满级 395；⟪2026-09-23 船长令⟫ 顶档 500 → 5,000）
}

/**
 * **旧「挂单张数」阈值表**（2026-09-18 换口径前用的那张）——**只给老档一次性折算读**，
 * 新逻辑一律走 `CHAIN_TIERS.marketIncome`（留在这里是为了折算规则可复现、可测）。
 */
export const CHAIN_TIERS_LEGACY_ORDERS: readonly number[] = [1, 3, 8, 20, 50, 120, 300, 700, 1500, 3000]

/**
 * **链奖金基准与"第 N 级奖金"**（2026-09-18 船长：「每级的信用点奖励有些过于少，建议按照级别的 5 次方给予奖励」）。
 *
 * 口径（⟪2026-09-23 船长令⟫「L1 依旧是 2500，但是 L10 奖金降低至 2500 万」）：**第 N 级奖金 = 基准 × N⁴**
 * 1→2,500 · 2→40,000 · 3→202,500 · 4→640,000 · 5→1,562,500 · 6→3,240,000 · 7→6,002,500 ·
 * 8→10,240,000 · 9→16,402,500 · 10→25,000,000（十级链满级累计 6,333 万）。
 * 领奖时按"已达成级数 − 已领级数"逐级求和（见 `chainPendingRewardIsk` / `claimChainReward`）。
 */
export const CHAIN_REWARD_ISK_BASE = 2_500

/** 第 N 级的奖金（N 从 1 起；非正数一律 0） */
export function chainLevelRewardIsk(level: number): number {
  const n = Math.max(0, Math.floor(level))
  return CHAIN_REWARD_ISK_BASE * n ** 4
}

/** 累计技能等级（Σ trained） */
export function totalSkillLevels(state: GameState): number {
  let n = 0
  for (const v of Object.values(state.skills.trained)) n += v ?? 0
  return n
}

/**
 * 协会声望（虫洞解锁口径：≥40，沿用 `WORMHOLE_SCAN_UNLOCK_STANDING`）。
 *
 * ⚠ **2026-09-26 改口径**：从"直读 `state.standings`（可支配那本）"改成读**累计获得**那本
 * （`state.standingsEarned`，取数口径与唯一入口 `expedition.standingOf` **逐字相同**）——
 * 船长同日令「**其他所有的声望门槛都改为看获得了多少声望总数**」，而这条正是一处门槛
 * （它决定"第一次虫洞"任务判不判过）。改前直读可支配那本 ⇒ 兑换一扣声望就会出现
 * "已经攒够 40、兑换之后又被判成没攒够"的怪事。
 *
 * ⚠ **为什么这里不 import `expedition.standingOf`**：`expedition.ts` 已经 import 了本文件
 * （`bumpFirst`）⇒ 反向引会成环。本函数就是这一处门槛的取数点，故就地复刻同一段回退逻辑。
 */
export function dsiStanding(state: GameState): number {
  return state.standingsEarned?.[DSI_FACTION_ID] ?? state.standings?.[DSI_FACTION_ID] ?? 0
}

/**
 * **末段并列批**（**2026-09-20 船长第三道令**：「**完成 11 · 第一次指派 AI 副船后，就可以将寻找人类
 * 和第一次长途运输以及 第一次虫洞同时显示给玩家。寻找人类位于顶部。**」）。
 *
 * 口径：**顺序段 11 条**仍**顺序解锁、一次一条、只判当前那一条**；它们走完 ⇒ 这三条**一起显示**——
 * 本表只管这两条「第一次」（`visibleFirstTasks` 同时返回两条），贯穿任务「寻找人类」不在 `FIRST_TASKS` 里，
 * 由 `ImportantTasks.tsx` 画在列表**顶部**。并列期间各条**互不阻塞**：判据谁先满足谁先判过（同拍可判过多条）。
 *
 * ⚠ **2026-09-22 船长 Excel 改序**：顺序段现在收尾在「第一条船」（技能/AI 前移到生产之前）。判据依旧是
 * "顺序段全完成"（与 id 无关）；若船长要恢复"AI 副船一完成就揭示"，那要连 `visibleFirstTasks` 一起改
 * （末段并列批会与顺序段剩余三条同时显示），已在汇报里提请确认。
 */
export const PARALLEL_TAIL_IDS: readonly string[] = ['first-haul', 'first-wormhole']

/** 该条是否属于末段并列批（顺序段 = 其余 11 条） */
export function isParallelTail(id: string): boolean {
  return PARALLEL_TAIL_IDS.includes(id)
}

/**
 * **顺序段是否已走完**（13 条里除去末段并列批的那 11 条全完成）——末段并列批与「寻找人类」发布闸门
 * （`onboarding`）共用这一条判据。判据读 `state` 现状 ⇒ 每拍现算、幂等（老档与异常中断都能自愈）。
 *
 * ⚠ **2026-09-22 船长 Excel 改序后**：顺序段仍是 11 条，但**收尾那条从「第一次指派 AI 副船」变成
 * 「第一条船」**（技能/AI 两块前移到生产之前）。判据本身与任务 id 无关 ⇒ 代码不用改；
 * 「寻找人类」与末段两条的揭示时点随之后移到"造完第一艘自造船"。
 */
export function sequentialPrefixDone(state: GameState): boolean {
  return FIRST_TASKS.every((d) => isParallelTail(d.id) || state.importantTasks[d.id]?.done === true)
}

/**
 * 13 条「第一次」任务（**数组序 = 解锁序**：顺序段只放当前这一条；末段并列批见 `PARALLEL_TAIL_IDS`）。
 *
 * ⚠ **2026-09-22 船长 Excel 回写**（船长原话：「**我对第一次任务的文本和顺序以及奖励进行了调整，
 * 其他部分麻烦你根据我的文本风格和顺序进行相应调整。**」）——本表以下三件事以那份 Excel 为准：
 * ① **文本**（标题 / 一句话 / 正文）逐字照抄船长；② **顺序**（见下）；③ **奖励与起手道具**。
 *
 * **新顺序**（原序为 扫描·采矿·精炼·悬赏·维修·打捞·**生产·挂单·造船·技能·AI**·运输·虫洞）：
 * 扫描 → 采矿 → 精炼 → 悬赏 → 维修 → 打捞 → **技能 → AI → 生产 → 挂单 → 造船** → 运输 → 虫洞
 * ⇒「技能 / AI」两块**前移到生产之前**（先练出 AI 核心操作学、派上副船，再谈产线与市场）；
 * **顺序段仍为前 11 条、末段并列批仍是运输＋虫洞**（只是顺序段现在收尾在「第一条船」）。
 *
 * **奖励改挂**（同一批）：采集器 MK1 从「扫描」的完成奖励挪到「采矿」的**起手**；打捞器 MK1 从「采矿」
 * 的完成奖励挪到「打捞」的**起手**；基础 AI 核心从「技能」的完成奖励挪到「AI 副船」的**起手**；
 * 沙猫级蓝图从「生产」的完成奖励挪到「造船」的**起手**；民用船体维修装置从「造船」挪到「维修」；
 * 扫描 / 技能 / 生产 / 挂单 / 造船改为 10,000 信用点；采矿 100 → **1,000 单位橄榄岩**；
 * 打捞改为 **1,000 m³ 高安海盗残骸**；维修取消起手修理组件（船长在 Excel 里清空了那一格）。
 */
export const FIRST_TASKS: readonly FirstTaskDef[] = [
  {
    id: 'first-scan',
    title: '第一次扫描',
    brief: '对星图上的未知信号执行一次扫描探索',
    detail:
      '在探索一个新的星系时，需要先派一艘深空扫描艇进行扫描作业，了解该星系的航线、矿带、悬赏与残骸情报等。初始的章鱼人母港只需十来秒，后续其他星系越危险扫得越久。',
    judge: (state, ctx) => state.exploredGalaxies.filter((g) => ctx.galaxies.has(g)).length,
    commsId: 'first-scan',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：本条改为 **10,000 信用点**（原先发的采集器 MK1 前移到
     * 「第一次采集原矿」的**起手道具**——扫描"轮到时"就给，玩家正好装上再去挖第一趟）。
     */
    reward: { isk: 10_000 },
    chain: { id: 'explorer', name: '宇宙探索家', stat: 'scan', tierKey: 'scan' },
  },
  {
    id: 'first-mine',
    // ⚠ **用词冲突（按 §5.2 已上报船长）**：船长原话是「第一次采集**矿物**」，但「矿物」是 2026-09-12 已作废的旧称
    //   （现行 = 原矿 / 原材料；本行首版就被 `content:check` 的陈旧术语契约拦下）
    //   ⇒ 本批按**现行口径**写成「第一次采集原矿」。若船长要保留"矿物"字样，把它登记为例外即可。
    title: '第一次采集原矿',
    brief: '到矿带采一批原矿',
    // 2026-09-20 船长令：「任务文本添加建议玩家去舰船切换采矿船」——鲣鱼级是护卫舰（无矿枪），
    //   采矿艇沙猫级开局就在舰船仓库里 ⇒ 文本第一句直接点明"先去舰船页换驾驶"。
    detail:
      '先到「舰船」页把驾驶换成采矿艇（沙猫级），再到矿带派出采矿。采掘、返航、卸货都会自动完成。原矿可以按市价卖出，也可以送进精炼炉炼成原材料——绝大多数情况下精炼会更加划算。',
    judge: (state) => (state.firstStats?.mineUnits ?? 0),
    commsId: 'first-mine',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：**1,000 单位橄榄岩**（原 100 ⇒ 精炼炉每批吃 100 单位，
     * 1,000 单位正好够开十炉、把「精炼师」第一档点亮）。
     *
     * 起手道具：**强化采集器 MK1**（原挂在「第一次扫描」的完成奖励上 ⇒ 前移到本条，装上去挖第一趟）。
     */
    reward: { ware: [{ itemId: 'ore-veldspar', units: 1_000 }] },
    startReward: { modules: [{ moduleId: 'mod-miner-1', units: 1 }] },
    chain: { id: 'digger', name: '深空采掘者', stat: 'mineUnits', tierKey: 'mineUnits' },
  },
  {
    /**
     * **位置：第 3 条**（**2026-09-20 船长令**「解锁工业界面要和第一次精炼的任务挂钩一起解锁」⇒ 船长三选**②**：
     * 「把「第一次操作精炼炉」在任务序里前移到采矿之后」）。2026-09-22 船长 Excel 复核后**位置不变**。
     *
     * 为什么放在这儿：工业页的解锁判据 = 本条**轮到**（见 `UNLOCK_AT_TASK`）⇒ 采矿一做完，工业页与这张卡
     * **同时**亮起；顺带让后面那条「第一次打捞残骸」到步时工业页（回收炉）已经可用——它的正文与情报信
     * 本来就要提到回收炉。
     */
    id: 'first-refine',
    title: '第一次操作精炼炉',
    brief: '让精炼炉出一批料',
    detail:
      '精炼炉按批运转：原料足够就能一直运转，直到原料全部用光。生产装备和舰船需要大量的材料都是通过精炼炉来生产。可以通过学习技能来大幅提高精炼效率。',
    judge: (state) => (state.firstStats?.refineBatches ?? 0),
    commsId: 'first-refine',
    // 奖励（船长 2026-09-18 定、2026-09-22 Excel 复核不变）：动能弹药生产线蓝图
    reward: { blueprints: [{ blueprintId: 'bp-ammo-kinetic', units: 1 }] },
    chain: { id: 'refiner', name: '精炼师', stat: 'refineBatches', tierKey: 'refineBatches' },
  },
  {
    /**
     * **位置：第 4 条**（**2026-09-20 船长第三道令**：「**将第一次完成悬赏和第一次打捞残骸交换位置。**」⇒
     * 悬赏与打捞对调：原序 打捞(4) → 维修(5) → 悬赏(6)，现序 **悬赏(4) → 维修(5) → 打捞(6)**）。
     *
     * 换过来顺带理顺了新手的先后：**先打一场拿钱**（教学场还有本舰主控加成；赢下那一场会在该星系
     * 留下残骸）⇒ 回港把开局那身 80% 损伤修掉 ⇒ 再带上打捞器去收残骸（第 6 条）。
     */
    id: 'first-bounty',
    title: '第一次完成悬赏',
    brief: '打赢一场悬赏讨伐',
    detail:
      '各个星系都有常驻悬赏。章鱼人通常将悬赏按威胁分档：档位越高敌人越厚、火力越重，报酬与协会声望也越高。声望是协会渠道的通行证，市场门槛与虫洞扫描都看它。',
    judge: (state) => (state.firstStats?.bountyWins ?? 0),
    commsId: 'first-bounty',
    // 奖励（船长 2026-09-18 定、2026-09-22 Excel 复核不变）：一艘鲣鱼级（直接进机库；同型自动编号 #2）
    reward: { ships: [{ defId: 'sh-falconet', units: 1 }] },
    chain: { id: 'hunter', name: '赏金猎人', stat: 'bountyWins', tierKey: 'bountyWins' },
  },
  {
    id: 'first-repair',
    title: '第一次维修舰船',
    brief: '用修理组件或港内维修修一次船',
    detail:
      '在战斗结束后，舰船的护盾会自行回满，而装甲与结构的损伤则会跨场保留。返回星港进行修理吧。想要自动修理的话，你需要一个船体维修装置和一些修理组件。不同的船体维修装置会消耗不同类型的修理组件。',
    judge: (state) => (state.firstStats?.repairs ?? 0),
    commsId: 'first-repair',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：**民用船体维修装置 ×1 ＋ 民用修理组件 ×20**
     * （船体维修装置原先挂在「第一条船」的完成奖励上 ⇒ 与"维修"这件事归口到一起）。
     *
     * ⚠ **起手道具取消**：船长在 Excel 里把「开始即给」那一格**清空**了（原为 5 枚民用修理组件）
     * ⇒ 本条现在没有起手道具；修船的开销由玩家自备（港内工位只花信用点）。
     */
    reward: { modules: [{ moduleId: 'mod-hullrep-civ', units: 1 }], ware: [{ itemId: 'repairkit-civ', units: 20 }] },
    chain: { id: 'mechanic', name: '维修技师', stat: 'repairs', tierKey: 'repairs' },
  },
  {
    /**
     * **位置：第 6 条**（同上第三道令：与「第一次完成悬赏」对调）。
     *
     * 奖励（**2026-09-22 船长 Excel**）：**1,000 m³ 高安海盗残骸**（原为 10,000 信用点）——
     * 打捞完直接有料可拆，接上「残骸回收」那条链。
     *
     * 起手道具：**打捞器 MK1**（原先挂在「第一次采集原矿」的完成奖励上 ⇒ 改到本条"轮到时"给，
     * 正好装上出海打捞）。
     */
    id: 'first-salvage',
    title: '第一次打捞残骸',
    brief: '到残骸地点打捞一批',
    detail:
      '星系里的残骸点可以派船打捞，打捞到的残骸可以送入精炼炉进行回收。除了回收出各种材料外，偶尔还能发现完好的装备和图纸碎片。图纸碎片集齐后可以在蓝图书架处拼接成完整蓝图。带稀有标记的残骸更值钱，也有概率出现更好的装备。',
    judge: (state) => (state.firstStats?.salvageRuns ?? 0),
    commsId: 'first-salvage',
    reward: { ware: [{ itemId: 'wreck-a-hi', units: 1_000 }] },
    startReward: { modules: [{ moduleId: 'mod-salvager-1', units: 1 }] },
    chain: { id: 'scavenger', name: '残骸拾荒者', stat: 'salvageRuns', tierKey: 'salvageRuns' },
  },
  {
    /**
     * **位置：第 7 条**（**2026-09-22 船长 Excel**：与「第一次指派 AI 副船」一起**前移到生产之前**）——
     * 新手的先后变成"先练出 AI 核心操作学 ⇒ 派上副船替你干活 ⇒ 再谈产线与市场"。
     */
    id: 'first-skill',
    title: '第一次学习技能',
    brief: '把 AI 核心操作学练到 Lv1',
    detail:
      '鉴于数据库的遗失，我们需要重新收集各种数据进行技能学习。越高级的技能需要学习的时间越长。初期建议优先将 AI 核心操作学升到 Lv3，这样就能驱动 AI 副手帮我们完成工作。它在「技能」页的「工程」里，切过去就能看到。',
    judge: (state) => state.skills.trained['ai-expert'] ?? 0,
    commsId: 'first-skill',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：**10,000 信用点**。
     * 原先挂在这条上的 **基础 AI 核心** ⇒ 前移到「第一次指派 AI 副船」的**起手道具**（下一条）。
     */
    reward: { isk: 10_000 },
    chain: { id: 'scholar', name: '学而不厌', stat: 'skills', tierKey: 'skills' },
  },
  {
    /** **位置：第 8 条**（同上 Excel：紧接「第一次学习技能」之后）。 */
    id: 'first-ai',
    title: '第一次指派 AI 副船',
    brief: '给一艘闲置舰船派个 AI 任务',
    detail:
      '闲置舰船配上一枚 AI 核心就能自己出海：采矿、打捞、驻留待命都能接。初期建议让 AI 副手驾驶采矿艇（沙猫级）进行挖矿作业。因为战斗、运输、扫描虫洞较为复杂，所以无法通过 AI 副手完成。',
    // 船长 2026-09-17：「将安排 AI 核心的任务设置为需要玩家完成学习技能才出现」
    judge: (state) => (state.firstStats?.aiAssigns ?? 0),
    commsId: 'first-ai',
    // 奖励（**2026-09-20 船长第三道令**「没有给予奖励的任务，安排 1 万信用点的奖励填充」；2026-09-22 Excel 复核不变）：10,000 信用点
    reward: { isk: 10_000 },
    /**
     * 起手道具（**2026-09-22 船长 Excel**）：**基础 AI 核心 ×1**——本条要的东西不能等完成才给
     * （原挂在「第一次学习技能」的完成奖励上，现在"轮到时"就发，练完技能立刻能派船）。
     */
    startReward: { aiCores: [{ type: 'basic', units: 1 }] },
    chain: { id: 'dispatch', name: '舰队调度', stat: 'aiAssigns', tierKey: 'aiAssigns' },
  },
  {
    /** **位置：第 9 条**（同上 Excel：生产 / 挂单 / 造船三块**整体后移**到 AI 副船之后）。 */
    id: 'first-produce',
    title: '第一次生产',
    brief: '让组装机造出一件东西',
    detail: '组装机要三样：蓝图、材料、时间。一般会安排其他 AI 副手进行自动生产加工，加工生产弹药是一个不错的初始资金来源。',
    judge: (state) => (state.firstStats?.produceUnits ?? 0),
    commsId: 'first-produce',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：**10,000 信用点**。
     * 原先挂在这条上的 **沙猫级舰船蓝图** ⇒ 后移到「第一条船」的**起手道具**（造第一艘自造船时正好用上）。
     *
     * 起手道具（**2026-09-21 船长令**、2026-09-22 Excel 复核不变）：钛钢合金 ×150 ＋ 银纹超金属 ×50
     * ——组装机要"蓝图 ＋ 材料 ＋ 时间"，材料来自精炼 ⇒ 先给一批，免得卡在"还得再跑一趟矿"。
     */
    reward: { isk: 10_000 },
    startReward: { ware: [{ itemId: 'min-tritanium', units: 150 }, { itemId: 'min-pyerite', units: 50 }] },
    chain: { id: 'lineboss', name: '产线主管', stat: 'produceUnits', tierKey: 'produceUnits' },
  },
  {
    id: 'first-order',
    title: '第一次挂单销售',
    /**
     * ⚠ **2026-09-22 船长令**：「第一次挂单允许玩家挂买单或者直接市价购买卖出都算完成」——
     * 卡面的一句话随之从「在市场挂出一张卖单」放宽成"做成一笔买卖"（**标题照旧**，是他定的名字）。
     */
    brief: '在市场做成一笔买卖（挂单或市价都算）',
    detail:
      '在市场上进行交易物资是很重要的一个补充资源缺口和获取信用点来源的好办法。你可以直接按市价快速买入卖出，或者挂定一个期望价格等待有人收购或者卖出。对于一些稀有东西，你可以挂出数倍的价格进行求购，说不定什么时候就有人会心动于你的价格将东西买给你。',
    /**
     * 判据 = `firstStats.orders`（**2026-09-22 船长令**后语义 = "做过几笔市场交易"）：
     * 挂卖单 / **挂买单** / **市价买入** / **市价卖出**（含整船）四条路各记一笔
     * ——落点单点见 `market.bumpFirstMarketTrade`（那四条路互不嵌套、不会重复计数）。
     */
    judge: (state) => (state.firstStats?.orders ?? 0),
    commsId: 'first-order',
    // 奖励（**2026-09-20 船长第三道令**填充 1 万；**2026-09-22 Excel 复核不变**）：10,000 信用点
    reward: { isk: 10_000 },
    // 2026-09-18 船长改口径：「挂单按照市场交易收入计数」⇒ 判据从挂单张数改成税后交易收入
    chain: { id: 'marketeer', name: '市场老手', stat: 'marketIncome', tierKey: 'marketIncome' },
  },
  {
    id: 'first-ship',
    title: '第一条船',
    brief: '造出第一艘自造船',
    detail: '造船厂对任何人来说都是十分重要的地方。除去市场外，这里是我们获取舰船的主要来源。制造一艘船并不便宜，但是回报绝对值得这个价格。',
    judge: (state) => (state.firstStats?.ships ?? 0),
    commsId: 'first-ship',
    /**
     * 奖励（**2026-09-22 船长 Excel**）：**10,000 信用点**（原先发的民用船体维修装置 ⇒ 归口到「维修」）。
     *
     * 起手道具（**2026-09-22 船长 Excel**）：**沙猫级舰船蓝图 ×1**——原挂在「第一次生产」的完成奖励上；
     * 造自造船要"舰船蓝图 ＋ 材料 ＋ 工位"，蓝图得先到手（本条是**顺序段最后一条**）。
     */
    reward: { isk: 10_000 },
    startReward: { blueprints: [{ blueprintId: 'sbp-sandcat', units: 1 }] },
    chain: { id: 'shipwright', name: '造船厂主', stat: 'ships', tierKey: 'ships' },
  },
  {
    id: 'first-haul',
    title: '第一次长途运输',
    brief: '完成一趟长途运输',
    detail:
      '长途运输是一笔十分稳定的收入，各个空间站之间一直有着常驻的货运需求，不过前提是需要有 2 个以上空间站，红环航带一直有一个空间站的建设计划，完成后就能够开始长途运输。',
    judge: (state) => (state.firstStats?.haulTrips ?? 0),
    commsId: 'first-haul',
    // 奖励（船长 2026-09-18 定、2026-09-22 Excel 复核不变）：飞鱼级快运舰（直接进机库）
    reward: { ships: [{ defId: 'sh-flyingfish', units: 1 }] },
    chain: { id: 'freight', name: '星际货运', stat: 'haulTrips', tierKey: 'haulTrips' },
  },
  {
    id: 'first-wormhole',
    title: '第一次虫洞',
    brief: '把深空工业协会声望攒到 40',
    detail:
      '协会声望攒到 40 就能解禁虫洞扫描阵列。通过扫描发现隐藏在各个星系的虫洞入口。不过需要注意，大部分虫洞都已经成为各个势力的躲藏点，前往虫洞内搜寻稀有资源时极有可能会遭遇强力的敌人。并且因为虫洞的特殊性，在虫洞中的战斗很难逃离，请做好充足的准备再前往。',
    // 任务目标就是"完成解锁条件的内容"（船长原话）⇒ 判据 = 声望门槛（虫洞解锁线 40）
    judge: (state) => (dsiStanding(state) >= WORMHOLE_UNLOCK_STANDING ? 1 : 0),
    commsId: 'first-wormhole',
    // 奖励（船长 2026-09-18 定、2026-09-22 Excel 复核不变）：两次虫洞探索（＝标记 2 处未探索虫洞进库存；允许超库存上限）
    reward: { wormholeStock: 2 },
    /**
     * 起手道具（**2026-09-21 船长令**、2026-09-22 Excel 复核不变）：洞内是"搜、打、撤"，
     * 采集器与打捞器是进洞的必备工具 ⇒ 轮到这条时各发一台。
     */
    startReward: { modules: [{ moduleId: 'mod-miner-1', units: 1 }, { moduleId: 'mod-salvager-1', units: 1 }] },
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
/**
 * **可完成的「第一次」任务（读数 · 只判不写）**（引擎每拍调用）。
 *
 * ⚠ **2026-09-21 船长令：任务不再自动完成** ——
 * 「**第一次任务不要自动完成。要让玩家回到任务中心点击完成才开始下一步，这样给予任务开始前道具的时间点
 * 就很明确**」⇒ 本函数**只回答"现在能不能完成"**，一个字节都不写；真正的完成动作在
 * `firstRewards.claimFirstTask`（玩家在任务中心点「完成」触发：发奖 → 发信 → 进下一条 → 发下一条的起手道具）。
 *
 * 判据仍是**只认当前那一条**（2026-09-20 报障「未显示的第一次任务可以提前完成」的收口）：
 * - 顺序段：数组序里第一条 `done !== true` 的；它的 `judge ≥ 1` ⇒ 可完成（否则返回空）；
 * - 末段并列批：那两条各自独立判 ⇒ **可能同时返回两条**（船长同日第三道令）。
 *
 * 调用方（引擎）用它做两件事：① 写一条「已达成，回任务中心点完成」的日志（用 `state.firstTaskReadyId`
 * 去重）② 老档一次性收口（`state.firstTaskAutoClaim`，见 `save.ts` v30→v31 迁移）。
 */
export function claimableFirstTasks(state: GameState, ctx: SimContext): FirstTaskDef[] {
  const current = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  if (current) return current.judge(state, ctx) >= 1 ? [current] : []
  return FIRST_TASKS.filter(
    (d) => isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true && d.judge(state, ctx) >= 1,
  )
}

/**
 * **该条是否"正轮到"**（显示与判定的同一把尺；`firstRewards.claimFirstTask` 的准入判据之一）：
 * 顺序段 = 数组序里第一条没完成的；末段并列批 = 那两条里还没完成的那条。
 */
export function isFirstTaskCurrent(state: GameState, id: string): boolean {
  if (isParallelTail(id)) {
    const prefixNext = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
    return prefixNext === undefined && state.importantTasks[id]?.done !== true
  }
  const current = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  return current?.id === id
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
 * **功能 / 页面解锁表**（船长 2026-09-17 定案 · 数据驱动）：key = 页面或星图页签，
 * value = **需要完成的**「第一次」任务 id（另一种口径「轮到即解锁」见下面的 `UNLOCK_AT_TASK`）。
 *
 * 口径（船长原话）：「**所有和星图相关的，比如战斗和采矿，需要玩家先完成第一次扫描**（初始将母港星系设置为和其他星系
 * 一样的未知状态，需要扫描才有悬赏和挖矿）」＋「**市场页面和相关任务要玩家先完成第一次生产**」；
 * **工业页那条已改判**（2026-09-20 船长令：「解锁工业界面要和第一次精炼的任务挂钩一起解锁」⇒ 移出本表、
 * 落到 `UNLOCK_AT_TASK`；旧句「工业界面和相关任务则需要玩家先完成第一次采集矿物」作废）。
 *
 * 用法：界面只读这两张表（`unlocked()` 判定）——**未解锁的页面与任务都不显示**（船长选「两者都隐藏」）。
 * 星图页本体、舰船/装配/物品/技能/任务中心/通讯/手册**不在表里** ⇒ 开局即可用。
 */
export const FIRST_UNLOCKS: Readonly<Record<string, string>> = {
  market: 'first-produce', // 市场页 ← 第一次生产
  mapMine: 'first-scan', // 星图·矿带开采 ← 第一次扫描
  mapBounty: 'first-scan', // 星图·常驻悬赏（战斗）← 第一次扫描
  mapSalvage: 'first-scan', // 星图·残骸打捞 ← 第一次扫描
  mapHaul: 'first-scan', // 星图·长途运输 ← 第一次扫描
}

/**
 * **跟着某条「第一次」任务"轮到"一起解锁的页面**（**2026-09-20 船长令**：「**解锁工业界面要和
 * 第一次精炼的任务挂钩一起解锁**」）。
 *
 * 判据 = 该任务**轮到**（顺序解锁下 = `FIRST_TASKS` 里排在它前面的都已完成），**不是**"该任务完成"——
 * 精炼炉就在工业页里，按"完成后解锁"会死锁（永远打不开、任务也永远做不完）。
 *
 * ⚠ 旧口径「工业页 ← 第一次采集原矿**完成**」（2026-09-17 船长定的三页前置表）**作废**：
 * 顺序解锁下"采矿"当时排在「第一次打捞残骸」之前 ⇒ 工业页会比精炼任务早三步出现。
 * **2026-09-20 船长三选②**：把「第一次操作精炼炉」**前移到采矿之后（第 3 条）** ⇒ 判据变成"采矿完成"，
 * 工业页与那张卡**同时**亮起（也顺带让后面那条「第一次打捞残骸」到步时回收炉已经可用）。
 */
const UNLOCK_AT_TASK: Readonly<Record<string, string>> = {
  industry: 'first-refine', // 工业页 ← 第一次操作精炼炉**轮到**（它是第 3 条 ⇒ 实际由"采矿完成"触发）
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

/**
 * 该页面/页签是否已解锁（表里没有的 key ⇒ 恒真 = 开局可用）。
 * 两种口径：`UNLOCK_AT_TASK`（跟着某条任务"轮到"一起开）优先，其次 `FIRST_UNLOCKS`（该任务完成才开）。
 */
export function unlocked(state: GameState, key: string): boolean {
  const at = UNLOCK_AT_TASK[key]
  if (at !== undefined) {
    const idx = FIRST_TASKS.findIndex((d) => d.id === at)
    if (idx <= 0) return true
    for (let i = 0; i < idx; i++) {
      if (state.importantTasks[FIRST_TASKS[i]!.id]?.done !== true) return false
    }
    return true
  }
  const need = FIRST_UNLOCKS[key]
  if (!need) return true
  return state.importantTasks[need]?.done === true
}
/**
 * 未解锁时所需的「第一次」任务名（界面提示用：`ui.App.110`「尚未解锁：先完成「{p1}」。」；
 * key 不在表里 ⇒ undefined）。
 * `UNLOCK_AT_TASK` 的 key 给的是**排在它前面那条**（玩家当下真要做完的那件活）。
 */
export function unlockNeedTitle(key: string): string | undefined {
  const at = UNLOCK_AT_TASK[key]
  if (at !== undefined) {
    const idx = FIRST_TASKS.findIndex((d) => d.id === at)
    return (idx > 0 ? FIRST_TASKS[idx - 1] : FIRST_TASKS[0])?.title
  }
  const need = FIRST_UNLOCKS[key]
  return need === undefined ? undefined : FIRST_TASKS.find((d) => d.id === need)?.title
}
/**
 * 任务中心用：**顺序解锁**——顺序段只给 `FIRST_TASKS` 里**第一条还没完成的**（它前面的都已完成）；
 * **顺序段走完 ⇒ 末段并列批一起给**（「第一次长途运输」＋「第一次虫洞」，见 `PARALLEL_TAIL_IDS`；
 * 「寻找人类」不在本表，由 `ImportantTasks.tsx` 画在顶部）。
 * 全部完成 ⇒ 空数组（页头读数走 `firstTaskProgress`）。
 * ⚠ **2026-09-20 船长（玩家反馈）**：「新手引导的重要任务一次性太多了，建议按顺序排列解锁」
 * ⇒ 旧口径「13 条自由选择完成 ＋ `prereq` 只控可见、可多线并行」**作废**（`prereq` 字段已删）。
 * ⚠ 本函数与 `advanceFirstTasks` 的"当前那一条 / 当前那一批"**是同一把尺**：
 * 显示哪些就只判哪些——这正是船长同日第二道令「未显示的第一次任务可以提前完成」的修法。
 */
export function visibleFirstTasks(state: GameState): FirstTaskDef[] {
  const next = FIRST_TASKS.find((d) => !isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
  if (next) return [next]
  return FIRST_TASKS.filter((d) => isParallelTail(d.id) && state.importantTasks[d.id]?.done !== true)
}

/** 「第一次」的页头读数：**已完成条数 / 总条数**（顺序解锁下"当前第几条"= done + 1） */
export function firstTaskProgress(state: GameState): { done: number; total: number } {
  const done = FIRST_TASKS.filter((d) => state.importantTasks[d.id]?.done === true).length
  return { done, total: FIRST_TASKS.length }
}

/**
 * **导航「任务中心」的推进提醒**（**2026-09-20 船长令**：「**每推进一阶段第一次任务时，在导航栏的
 * 任务中心选项处进行提醒**」）。
 *
 * 判据 = **当前"显示组"的签名 ≠ 玩家看过的那一组**（与「赏金新板提示」同款"换板未看"口径，见
 * `sideTasks.sideTaskBoard().bountyFresh`）：
 * - 顺序段：显示组恒为一条 ⇒ 签名就是那条 id（**与旧档存的单条 id 逐字一致 ⇒ 零迁移**）；
 * - 末段并列批：签名为两条 id 以 `|` 连接（一次性提醒"多了这两条"）；
 * - 进「任务中心」页 ⇒ `firstTasksMarkSeen` 记一笔 ⇒ 灭；
 * - **13 条全做完**（没有显示组）⇒ 不亮。
 *
 * ⚠ 老档没有 `firstTaskSeenId` ⇒ 首帧亮一次（与赏金那条「老档默认亮起提示」同一处置）。
 * 返回值带标题与 `ready`：徽标的悬停文案要写清"新的是哪一条"；`ready = true` 表示**这条已达成、
 * 正等玩家回任务中心点「完成」**（2026-09-21 船长令改手动完成后的新语义 ⇒ 达成那一刻也要亮一次）。
 */
export function firstTaskNotice(state: GameState): { taskId: string; title: string; ready: boolean } | null {
  const shown = visibleFirstTasks(state)
  if (shown.length === 0) return null
  const ready = shown.some((d) => d.id === state.firstTaskReadyId)
  const sig = shown.map((d) => d.id).join('|') + (ready ? '|ready' : '')
  if (state.firstTaskSeenId === sig) return null
  return { taskId: shown[0]!.id, title: shown.map((d) => d.title).join('、'), ready }
}

/** **记一笔"这一组看过了"**（进「任务中心」页时调用；幂等：同一组不写第二次）。返回是否真的记了。 */
export function firstTasksMarkSeen(state: GameState): boolean {
  const shown = visibleFirstTasks(state)
  if (shown.length === 0) return false
  const ready = shown.some((d) => d.id === state.firstTaskReadyId)
  const sig = shown.map((d) => d.id).join('|') + (ready ? '|ready' : '')
  if (state.firstTaskSeenId === sig) return false
  state.firstTaskSeenId = sig
  return true
}

/** **里程碑页一行**（每条"次数"链一行；`unlocked` = 触发它的那条「第一次」已完成） */
export interface MilestoneChainRow {
  chainId: string
  /** 链名（例：宇宙探索家） */
  name: string
  /** 触发它的「第一次」任务（标题给卡片用） */
  taskId: string
  taskTitle: string
  /** 是否解锁（对应「第一次」已完成 ⇒ 才上「里程碑任务」页） */
  unlocked: boolean
  /** 已达成档位 / 总档数 */
  level: number
  total: number
  /** 终身计数与下一档阈值（`next === null` = 已达最高档） */
  count: number
  next: number | null
  /** 当前可领奖金（0 = 没得领）——**只有「里程碑任务」页有领奖入口**（船长 2026-09-20） */
  pendingIsk: number
  /** 完成"正在推进的这一级"能拿的奖金；已满档 ⇒ 0 */
  nextRewardIsk: number
}

/**
 * **「里程碑任务」页的数据**（2026-09-20 船长：把"完成「第一次」后的里程碑任务链"单开一个子页面装）。
 * 返回**全部 13 条链**（含未解锁的，`unlocked: false`）——面板只渲染已解锁的 + 一条"还没解锁任何链"的空态提示，
 * 判据留在 core 便于用例钉住。**不含任何 UI 文案**（单位等显示口径在面板侧）。
 */
export function milestoneBoard(state: GameState): MilestoneChainRow[] {
  const rows: MilestoneChainRow[] = []
  for (const def of FIRST_TASKS) {
    const chain = def.chain
    if (!chain) continue
    const prog = chainProgressOf(state, chain)
    const done = state.importantTasks[def.id]?.done === true
    const maxed = prog.level >= prog.total
    rows.push({
      chainId: chain.id,
      name: chain.name,
      taskId: def.id,
      taskTitle: def.title,
      unlocked: done,
      level: prog.level,
      total: prog.total,
      count: prog.count,
      next: prog.next,
      pendingIsk: chainPendingRewardIsk(state, chain.id),
      nextRewardIsk: maxed ? 0 : chainLevelRewardIsk(prog.level + 1),
    })
  }
  return rows
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
 * **任务中心的卡片序列**（顺序解锁口径下**恒定只有当前这一条**）：
 * ① `visibleFirstTasks` 只给"第一条还没完成的" → ② `hidden` 那条（已完成 ＋ 链满档 ＋ 无待领）在新口径下
 * 天然不成立（当前这条必然未完成），保留判据是给用例与老调用方兜底 → ③ 排序在单行时是恒等。
 * ⚠ 旧口径（2026-09-18：先按前置过滤、再排掉"已全部完成"、再按 可领奖→已完成→未完成 置顶）里
 * 后两步已随"顺序解锁"失去意义，**保留函数签名与字段**（面板与用例仍读它），语义按上面重述。
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

