/**
 * 引擎心脏：时间的推进与技能队列的全部操作。
 *
 * 重要设计（中文说明）：
 * - advanceGame 不关心"你是在线 1 秒还是离线 8 小时"，只按给的毫秒数推进。
 *   在线时界面每 1 秒调一次；离线时读档后调一次（大数值）——同一套逻辑，无需特判。
 * - 队列是严格的"先到先练"：队首正在训练，后面的排队；练完自动出队、练下一个。
 * - 队列项的进度只记"当前这一级"练了多少，升一级清零重计，逻辑简单不易错。
 * - T2 连锁训练：同一技能可以多次入队，但目标等级必须逐级 +1 递增
 *   （下一个可排的目标 = 已学等级 + 1 + 队列中同技能条数），跨级与重复目标会被拒绝；
 * - T2 取消语义：移除某条训练后，排在它后面的同技能条目自动顺延一级（填补空位）；
 *   取消正在练的队首时，本级进度转交给顺延项承接；没有顺延项则存入
 *   skills.savedProgress，下次把该技能重新排为队首时自动续接（没有"暂停"状态位）。
 */

import { addLog } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import { advanceMining, advanceShipReturns, retireMiningShip } from './mining'
import { advanceStandby, advanceTransit, reconcileDockSanity } from './location'
import { reconcilePilotShip } from './shipyard'
import { advanceManufacturing } from './manufacturing'
import { advanceRefining } from './industry'
import { advanceLab } from './lab'
import { advancePlanetary, reconcilePlanetHome } from './planetRuntime'
import { advanceExpedition } from './expedition'
import { advanceWormhole } from './wormholeBattle'
import { advanceAi, AI_CORE_ORDER } from './ai'
import { advanceEvents } from './events'
import { advanceMarket } from './market'
import { ensureBlackMarket } from './blackMarket'
import { advanceEncounterWatch } from './encounters'
import { advanceScanning, ensureTransitExplored } from './explore'
import { advanceWormholeScan, reconcileWormholePromoGift, reconcileWormholeScanWelcome } from './wormholeScan'
import { advanceWormholeAuto } from './wormholeAuto'
import { advanceHauling } from './hauling'
import { advanceWreckDrift } from './salvage'
import type { SettleStats } from './settleStats'
/**
 * **技能加速自动续用**（2026-10-01 船长令）：本函数在 `advanceSkillQueue` 的每一级调用。
 * ⚠ **循环依赖是安全的**：`consumables.ts` 只 `import type { CommandResult } from './engine'`（类型侧，
 * 编译后不留运行时引用）⇒ 运行时的边是**单向**的 engine → consumables，不会出现 TDZ。
 */
import { syncBoostRenew } from './consumables'
import { advanceSalvageOp, retireSalvageShip } from './salvaging'
import { advanceFindHumans, publishFindHumansWhenReady } from './onboarding'
import { advanceComms } from './comms'
import {  advanceFirstChains, claimableFirstTasks, peakFirst } from './firstTasks'
import { advanceAchievements } from './achievements'
import { advanceMatterOreDrip, matterTechNodes } from './matterTech'
import { claimFirstTask, grantStartRewardsForCurrent } from './firstRewards'
import { advanceSideTasks } from './sideTasks'
import { weekendTickBoss } from './weekendEvent'
import { weekendFlagshipBattleActive } from './weekendLaunch'
import { reconcileWeekendBlackBox } from './weekendComms'

/**
 * **我方此刻是否在战斗中**（周末入侵的章鱼人削血要按它暂停）：远征战斗 / 虫洞战斗 / 低安遭遇战
 * ——**任一路径进行中** ⇒ 章鱼人停手（船长：「玩家正在战斗时，会暂停削血…防止抢走玩家的击杀」）。
 */
function isPlayerInBattle(state: GameState): boolean {
  if (state.expedition.battle && !state.expedition.battle.ended) return true
  if (state.wormhole.run?.battle && !state.wormhole.run.battle.ended) return true
  const enc = state.encounter
  if (enc?.active === true && enc.battle && !enc.battle.ended) return true
  return false
}

/**
 * **闸门拒因（结构化）** —— 那些"能不能做某事"的 core 函数（返回 `string | null` 的那批）用它。
 *
 * 与 `CommandResult.error/errorId/errorParams` **同一口径**（甲案 · 船长 2026-09-20）：
 * `error` 是**中文原串、永远照写**（工具、老路径与回落用）；`errorId` / `errorParams` 给界面
 * 走 `cmdText(r)` 按当前语言渲染。改造前后**判空写法不变**（`blocked !== null`），
 * 只有渲染处从"直接显示字符串"改成 `cmdText(...)`。
 *
 * 为什么单独一个类型而不是复用 `CommandResult`：这类函数只表达"为什么不行"，
 * 没有 `ok` / `code` / `autoBattle` 那些语义；结构对齐（三个字段同名）即可被 `cmdText` 消费。
 */
export interface CoreBlockReason {
  /** 中文原串（照写，供工具与回落用；界面有 id 时按语言渲染） */
  error: string
  /** 文案 id（在 `packages/data/src/l10n/table.ts` 唯一表里登记 zh + en） */
  errorId?: string
  /** `errorId` 的插值参数（键 `p1` / `p2` …） */
  errorParams?: Readonly<Record<string, string | number>>
}

/** 指令执行结果：界面按钮点完拿这个决定是提示错误还是无事发生 */
export interface CommandResult {
  ok: boolean
  /**
   * 失败原因（**中文原串**，永远照写）。甲案（船长 2026-09-20）改造后**另带** `errorId` /
   * `errorParams`：界面用 `i18n/locale.tsx` 的 `cmdText(r)` 取值 —— 有 id 按当前语言渲染，
   * 没有就显示这个中文串（老路径/未改造文件的行为一字不变）。
   *
   * ⚠ 与 `LogEntry` 同构：**保持 `string` 类型不变**（不做 `string | {…}` 联合）——
   * 联合类型会外溢到全部读取点与用例（实测砸了 30+ 处），加法式字段则零影响。
   */
  error?: string
  /** 甲案：失败原因的**文案 id**（可选；有 ⇒ 界面按当前语言渲染，见 `error` 的说明） */
  errorId?: string
  /** 甲案：`errorId` 的插值参数 */
  errorParams?: Readonly<Record<string, string | number>>
  /**
   * 拒绝码（可选，机器可读）：目前只有虫洞层内动作在用——
   * `unknown-target` = "目标格还没扫描过"，界面据此弹「即将前往未知地点」的确认，而不是当错误报给玩家；
   * `path-blocked` = **直线路径上有没清掉的敌人**（船长 2026-09-16 路径拦截），界面据此弹
   * 「路径上有敌人阻拦」的确认，玩家确认后带 `confirmIntercept` 重来。
   */
  code?: 'unknown-target' | 'path-blocked' | 'cargo-pending' | 'unsupported-rules'
  /** 虫洞"前往"专用：到达的格是舰船信号 ⇒ **就地开打**（船长 2026-09-13）；界面不用再点激活 */
  autoBattle?: boolean
  /** 虫洞"前往"专用：到达的格是漂浮信标 ⇒ **下一层入口已标出**（界面提示一句） */
  beacon?: boolean
  /**
   * 虫洞"前往"专用（船长 2026-09-16 路径拦截）：**本次移动被截断在拦截点**（没到达玩家点的目标格）。
   * `known` = 拦之前那一格是否已扫/已到过（界面据此决定描红带图标、还是只警示路径线——甲案：未知格不指名）。
   */
  intercepted?: { target: string; known: boolean }
  /**
   * 虫洞"前往"专用（船长 2026-09-16）：**踩中埋伏**（到达的格出发前未知、里面是敌人）。
   * 界面走 `deferAmbush` ⇒ 这一场已挂起，等玩家点「开战」；不要直接跳战斗界面。
   */
  ambush?: boolean
  /** 虫洞"激活/打捞"专用：**本次回收了几堆**（墓场/遗迹打捞；界面提示"回收 N 堆"） */
  taken?: number
  /**
   * 虫洞"激活/打捞"专用（船长 2026-09-13）：**已结算、但等玩家确认的战斗**。
   * · `'ruins'` = 打捞遗迹惊动了守备（2026-09-13）；
   * · `'node'` = **踩中埋伏**（2026-09-16：进未扫描地点踩到敌人 —— 与前者同一套语言）。
   * 界面据此弹提醒条，玩家点「迎战 / 开战」后再开打 —— 战斗不再毫无提示地突然发生。
   * 确认之前 `run.pendingRuinsBattle` / `run.pendingNodeBattle` 为真，别的层内动作一律被拦
   * （`gridActionBlocked`）；**撤离不受影响**（与遗迹那条同口径，逃生门留着）。
   */
  pendingBattle?: 'ruins' | 'node'
  /**
   * 虫洞"扫描"专用（2026-09-13 星云机制）：**本次驱散了几格星云**。
   * 界面提示"云散了、信号显形"用（`0`/缺省 = 这次没驱散）。
   */
  dispersed?: number
  /**
   * 虫洞"扫描"专用（2026-09-13 星云机制）：**本次新揭开、但被星云遮住的格数**。
   * 界面提示"这一批有 N 格被云挡着，再扫一次可驱散"用。
   */
  newlyFogged?: number
  /**
   * 虫洞"扫描"专用（船长 2026-09-16 **甲案**）：**这一扫扫到了"下一层入口"那一格**
   * ⇒ core 已把入口标上地图（`grid.exitKnown = true`），界面提示一句用。
   * `false`/缺省 = 这一圈里没有入口格。
   */
  exitScanned?: boolean
}

/** 界面隐藏且不可训练的技能 id（2026-09-05 批次三起战斗占位全部开放，当前为空；
 * 未来新占位条目在此登记——引擎禁训 + 界面过滤共用本清单）
 * （2026-10-02 批次 4n 迁到 skillQueue.ts，本文件再导出） */

/**
 * 把游戏时间推进 deltaMs 毫秒（技能队列、主控采矿、换船善后返航、制造、主控远征、AI 副船任务、
 * 随机事件与市场）。非法/负数/0 的时长会被安全忽略。
 */
export function advanceGame(
  state: GameState,
  deltaMs: number,
  ctx: SimContext,
  opts?: {
    freezeBattle?: boolean
    settleStats?: SettleStats
    /** 当前墙钟毫秒（现实时间；赏金日板按它对齐"每天本地 0 点"、**派系活跃按它对齐"每天本地 12 点"**
     *  ——2026-09-29 船长令：活跃切换时间 24 时 → 12 时）。
     *  在线 = 心跳传入 Date.now()；离线结算 = 传入离线末刻；缺省退 state.savedAtWallMs */
    nowWallMs?: number
    /** **本拍想跑的虫洞内战斗倍速**（2026-09-19 谜质科技「时间压缩矩阵」）：
     *  **只有前台心跳传**（在线心跳那一个调用点）；离线结算 / 后台 / 工具 / 用例一律不传 ⇒ 1×。
     *  实际生效值由 `combat.advanceBattleFor` 夹到"洞内 + 科技已解锁档位"内。 */
    battleSpeedX?: number
    /** **离线结算的静默模式**（船长 2026-09-21 裁定「乙案」）：
     *  只由 `simulateOffline` 传 `true` ⇒ 随机事件**只推进到点节奏、不产生任何副作用**
     *  （不写日志、不发钱、不建买卖单、不动行情池）。
     *  起因：离线大推进会把整段离线里到点的事件一次补发（上限 200）⇒ 上线瞬间日志刷屏、
     *  一批订单同生同灭、行情池被线性叠加。详见 `events.advanceEvents` 头注。 */
    offline?: boolean
  },
): void {
  const d = Math.floor(deltaMs)
  if (!Number.isFinite(d) || d <= 0) return
  state.gameMs += d
  if (ctx.planetary) { advancePlanetary(state, d, ctx.planetary, state.gameMs - d); reconcilePlanetHome(state, ctx.planetary) }
  /**
   * **现实墙钟落进 state**（2026-09-15 限时倍率批）：只有**显式传入 `nowWallMs`** 时才写
   * （在线心跳 / 离线结算都传 ⇒ 正式运行恒有值）；**工具与用例不传 ⇒ `state.wallMs` 保持 undefined
   * ⇒ 限时倍率恒为 1×**（标定读数不被日历污染）。详见 `tuning.ts` 头注。
   */
  if (opts?.nowWallMs !== undefined && Number.isFinite(opts.nowWallMs)) state.wallMs = opts.nowWallMs
  // V13 探索：在途作业的星系视为已探明（读档/迁移恢复兜底）
  ensureTransitExplored(state, ctx)
  /**
   * **技能加速自动续用 · 每拍第一件事**（**2026-10-01 船长令**）。
   *
   * ⚠ **为什么放在这里、而不是只放在 `advanceSkillQueue` 里**：那条函数**队列空着时一次都不进循环**
   * （`while (remaining > 0 && queue.length > 0)`）⇒ 一旦队列被练空，"料尽 ⇒ 关掉开关"这一步就再也
   * 没有执行机会，开关会一直亮着骗玩家（本批用例实测到的形态）。挂在这里 ⇒ **队列有没有都必查一次**。
   * 函数内部自己早退（开关关着 / 还有料且不缺），零行为变化、零可感开销。
   */
  syncBoostRenew(state, ctx)
  advanceSkillQueue(state, d, ctx)
  /**
   * 🔴 **兑现"切活动自动停作业"的返航账本**（**船长 2026-10-02 报障**：「**正在采矿的舰船会自动
   * 返航……但是打捞都没有**」）——`state.haltActivityForSwitch` 已经用**纯数据**建了一份占位账本
   * （它不能 import 作业模块，否则成环、启动即崩），这里用**真值**重算腿长并写日志。
   *
   * ⚠ 必须在 `advanceMining` / `advanceSalvageOp` **之前**：那两支读 `active`，而本段只动 `shipReturns`。
   * ⚠ 标记处理完即清（`pendingActivityReturn`）——它是瞬态信号。
   */
  if (state.pendingActivityReturn) {
    const pending = state.pendingActivityReturn
    state.pendingActivityReturn = null
    if (pending.kind === 'mining') retireMiningShip(state, ctx, { beltId: pending.id, preserveExisting: true })
    else retireSalvageShip(state, ctx, { galaxyId: pending.id, preserveExisting: true })
  }
  advanceMining(state, d, ctx)
  advanceSalvageOp(state, d, ctx)
  // B3 星系残骸密度：闲置漂移（正在打捞的星系挂起——打捞作业期不结算漂移）
  advanceWreckDrift(state, ctx, d, state.salvaging.active ? state.salvaging.galaxyId : null)
  // T4 换船善后：自动返航中的旧船独立于新作业推进（到港自动卸货）
  advanceShipReturns(state, d, ctx)
  // 2026-09-08（船长定）：未建成建站点不视为任何站点——停靠残留纠正为工地现场停留（幂等）
  reconcileDockSanity(state, ctx)
  // 2026-09-09（船长定）：驾驶船可用性自愈——缺失或被 AI 执勤占用时改派空闲船/补发保底磷虾（幂等）
  reconcilePilotShip(state, ctx)
  // T8 显式返航行程（野外→空间站）/ 建站交付航线（真实航程；到点自动交付 + 自动返航）
  advanceTransit(state, ctx)
  advanceStandby(state, ctx)
  advanceManufacturing(state, ctx, opts?.settleStats)
  advanceRefining(state, ctx, opts?.settleStats)
  /** 实验室（2026-09-29 跃迁燃料批；**2026-10-01 起按组装机那套：一线一批 ＋ 循环开关**） */
  advanceLab(state, ctx, opts?.settleStats)
  /** 谜质科技 T5「虚空母矿汲取」（2026-09-30 船长令）：每小时自动进账虚空母矿，未点该节点零开销 */
  advanceMatterOreDrip(state, ctx, d)
  advanceExpedition(state, ctx, opts?.freezeBattle)
  // 终局玩法「虫洞」（F 批）：洞内战斗步进与收口 + 撤离战自动开打（不在洞里时零开销）
  advanceWormhole(state, ctx, opts?.freezeBattle, opts?.battleSpeedX)
  /**
   * **周末入侵 · 旗舰 BOSS 的章鱼人削血**（船长 2026-09-24 第二轮令：「**2小时内按时间削掉100%
   * 母舰血量。当玩家正在战斗时，会暂停削血。等玩家战斗结束才继续。**」）：
   * - **只有在线心跳传 `nowWallMs`** ⇒ 离线结算/工具/用例一律不推进（"离线时章鱼也停"）；
   * - **战斗中暂停**（含普通入侵战斗）⇒ 这里判"我方是否有正在进行的战斗"（远征 / 虫洞 / 遭遇）；
   * - 🔴 **2026-09-26 船长令（冷却闸）**：「**给章鱼人进攻削血加个冷却，玩家战斗结束 1 分钟后，
   *   章鱼人才开始削血和判定。这样玩家就能正常收掉 BOSS**」⇒ 额外传"**旗舰战**是否正在进行"
   *   （单点判据 `weekendLaunch.weekendFlagshipBattleActive`，与战斗界面同源）：进行中每拍把它推后到
   *   `now + 60 秒` ⇒ **旗舰战结束后 60 秒内既不削血、也不判得手**。
   *   ⚠ 只有旗舰战起算冷却（船长 2026-09-26 明示），其它战斗只走上面那条"暂停"；
   * - 非 BOSS 族 / 池子未锁定 ⇒ 函数内部直接返回（零开销、零行为变化）。
   */
  weekendTickBoss(state, opts?.nowWallMs, isPlayerInBattle(state), weekendFlagshipBattleActive(state))
  advanceScanning(state, ctx)
  // 主控活动「扫描虫洞」（2026-09-14）：进度按游戏时刻累计，满一个窗口发现一处（遇袭不清零）
  // 解锁当次：把进度预置成满窗口（船长 2026-09-14「甲」：点扫描第一拍即得一处；只送一次、不额外提示）
  reconcileWormholeScanWelcome(state)
  // 限时促销赠送（2026-09-16「虫洞大量生成」）：逐 tick 幂等、只发一次、只给已解锁者（见该函数头注）
  reconcileWormholePromoGift(state, ctx)
  // 入侵旗舰黑匣**对账补发**（2026-09-28 船长令「采用工具线上补发」）：逐 tick 幂等，
  // 只补「玩家亲手击沉 ＋ 输出占比过半（这一档必爆）却没落地」的场次（判据见该函数头注）
  reconcileWeekendBlackBox(state)
  advanceWormholeScan(state, ctx, d)
  // 自动探索（2026-09-14 批次 3）：到点即结算（收益入仓库 + 损伤 + 待确认报告）；离线大步长同样适用
  advanceWormholeAuto(state, ctx)
  advanceHauling(state, d, ctx)
  advanceAi(state, d, ctx, opts?.settleStats)
  // B1 低安遭遇：在场记录维护（事件到点判定前刷新）+ 遭遇推进（待决超时自动文字结算 / 战斗推演）
  advanceEncounterWatch(state, ctx, d, opts?.freezeBattle)
  // 随机事件（到达式触发；B1 低安遭遇占用其到点时机的判定入口；先于市场窗口撮合）
  advanceEvents(state, d, ctx, opts?.offline === true)
  // 市场按窗口推进（离线大推进同样覆盖：订单过期/池回归/内部消化/补单/挂单撮合）
  advanceMarket(state, d, ctx)
  // 任务中心：资源20分钟、快递120分钟分批刷新；在市场推进后执行，让资源影响作用于当前簿面。
  // 赏金 = 独立日板，24 小时一轮、每天本地 0 点整板替换（按 nowWallMs 墙钟对齐）；
  // **派系活跃 = 每天本地 12:00 换新**（2026-09-29 船长令：切换时间 24 时 → 12 时，只挪活跃）。
  // 离线大步长只按末窗结算一次（见 sideTasks.advanceSideTasks）
  advanceSideTasks(state, ctx, opts?.nowWallMs)
  ensureBlackMarket(state, ctx, opts?.nowWallMs ?? state.savedAtWallMs)
  // 通讯收件箱（2026-09-11）：数据消息按触发条件送达 + 未读记账（幂等；表为空时零开销）
  advanceComms(state, ctx)
  /**
   * **「第一次」任务系列**（2026-09-17 教程重做批 · 阶段②；**2026-09-21 船长令改成"点击完成"**）。
   *
   * 船长原话：「**第一次任务不要自动完成。要让玩家回到任务中心点击完成才开始下一步，这样给予任务开始前
   * 道具的时间点就很明确**」⇒ 这里**只判不写**：`claimableFirstTasks` 只回答"现在能不能完成"，
   * 完成的推进（写 `done` → 发完成奖励 → 发下一条的起手道具）全在 `firstRewards.claimFirstTask`，
   * 由玩家在任务中心点「完成」触发。本处只做两件事：
   * ① **播报一次**「已达成，回任务中心点完成」（`state.firstTaskReadyId` 去重，免得每拍刷屏）；
   * ② **老档一次性收口**（v30→v31 迁移打的 `firstTaskAutoClaim`）：把读档时"判据已满足却没点过"的积压
   *    按点击同款走完（发奖/发信/进下一条），跑完即删键 —— 新档不带这个键 ⇒ 一律走手动流程。
   */
  const readyNow = claimableFirstTasks(state, ctx)
  if (readyNow.length > 0) {
    const first = readyNow[0]!
    if (state.firstTaskReadyId !== first.id) {
      state.firstTaskReadyId = first.id
      addLog(state, 'levelup', `◆ 任务已达成：「${first.title}」——回「任务中心」点「完成」继续下一步。`, 'core.firstTasks.001', { p1: first.title })
    }
  }
  if (state.firstTaskAutoClaim === true) {
    /**
     * **先补发"当前那条的起手道具"**（**2026-09-22 船长裁决「甲」**）：
     * 起手道具只在"某一条**轮到**时"发（`claimFirstTask` 收尾那一次点击），而**收口只补"已满足却没点过"
     * 的那几条**——若老档正卡在**带起手道具的那六条**之一、且它自己的判据还没满足（收口循环一条都不走），
     * 那一条的起手道具就**永远拿不到**了：采集原矿→强化采集器 MK1 · 打捞残骸→打捞器 MK1 ·
     * 指派 AI 副船→基础 AI 核心 · 生产→150 三钛＋50 类铁 · 第一条船→磷虾级蓝图 · 虫洞→采集器＋打捞器各一台。
     *
     * ⇒ 在读档收口这一段**先补发一次当前那条的**（`grantStartRewardsForCurrent` 自带 `started` 去重，
     * 重复调用不叠加），再跑下面的"已满足 ⇒ 照点击走完"循环。**零新增存档字段、零版本变更**
     * （复用 v30→v31 打的那一次性标记；已经在旧代码下升过 v31 的档救不回来——那批档的起手道具
     * 只能自购：采集器市场有售、`bp-miner-1` 可造，船长已知情并选定此口径）。
     */
    grantStartRewardsForCurrent(state, ctx)
    // 上限 20 只是护栏（13 条一轮足够）；每轮都重新取"当前可完成"，天然按顺序推进
    for (let guard = 0; guard < 20; guard += 1) {
      const c = claimableFirstTasks(state, ctx)[0]
      if (!c) break
      claimFirstTask(state, ctx, c.id)
    }
    if (claimableFirstTasks(state, ctx).length === 0) delete state.firstTaskAutoClaim
  }
  // 后续次数链的升级记账（每拍）：只在 importantTasks 上记 level；**不在这里发 ISK** ——
  // 发奖改到任务中心领奖那一刻（claimChainReward），避免离线结算/用例里钱包被悄悄加钱。
  advanceFirstChains(state)
  /**
   * **贯穿任务「寻找人类」的发布闸门**（**2026-09-20 船长第三道令**：「完成 11 · 第一次指派 AI 副船后，
   * 就可以将寻找人类和第一次长途运输以及 第一次虫洞同时显示给玩家。寻找人类位于顶部。」）
   * ——判据 = 序章已结束 ＋ 「第一次」**顺序段（前 11 条）**一条不剩 ＋ 还没发布过
   * （见 `onboarding` 的同名函数）。挂在这里（任务判定与链升级都做完之后 ⇒ 第 11 条完成的那一拍就发布），
   * 幂等、每拍零开销（已发布即返回）。
   *
   * ⚠ **2026-09-22 船长 Excel 改序**：顺序段仍是 11 条，但收尾那条从「第一次指派 AI 副船」变成
   * 「第一条船」（技能/AI 前移到生产之前）⇒ 判据不变，揭示时点顺延三步。
   */
  publishFindHumansWhenReady(state)
  // 贯穿任务「寻找人类」阶段目标：探索全部星系（里程碑只记一次；未发布/已完成时零开销）
  advanceFindHumans(state, ctx)
  /**
   * **成就徽章**（2026-09-20 船长批「继续之前的成就系统」· 第一批 = 徽章框架）。
   *
   * 挂点就是 `firstTasks.ts:355` 预留的那个接口说明所指的位置：**任务判定与链升级都做完之后**
   * ⇒ 同一拍里"任务达成"与"链升到 1/4/7/10 级"都能立刻领到徽章。
   *
   * 三条纪律：
   * - **纯展示**（船长裁定）：只写 `state.achievements.earned`，**不碰钱包/仓库/货舱**；
   * - **不写日志、不发通讯**：保持"离线事件条数"等既有口径逐字不变（与 `advanceFirstTasks` 同款理由）；
   * - **现算补发**（幂等）：判据是 `state` 现状而非事件 ⇒ 老档、漏发、异常中断都靠这条自愈。
   *
   * ⚠ **两批都已完成并合入 main**（第一批 任务 ＋ 链 63 枚 · 第二批 里程碑 18 枚，均 2026-09-20）
   * ⇒ 本处**不挂未完成记号**（约定 §十一之二：完成即删记号；残留会让本地化永远跳过它）。
   * 里程碑那六个计数键另有一层兜底：`reconcileMilestoneStats`（下一行）每拍按 `state` 现算补齐。
   */
  reconcileMilestoneStats(state, ctx)
  advanceAchievements(state, ctx.achievements, opts?.nowWallMs)
}

/**
 * **里程碑计数的"追溯检查"**（**2026-09-20 船长令**：「**里程碑都加入追溯检查**」；
 * 起因 = 玩家报障「**已经建好了的空间站无法完成成就**」）。
 *
 * 18 枚里程碑成就读的**六个计数键**原先**只在事件发生那一刻记账**
 * （`sitesBuilt` 升满档 · `aiCoreKinds` 核心入库 · `matterTechMaxed` 点满一级 ·
 * `whMaxDepth` 进层 · `rareBoxes` 开箱 · `whBossClears` 击破守卫）。
 * 于是"事件发生在成就系统之前/之外"的档（老档，或先做完再更新到本版）账上恒为 0 ⇒ **成就永远拿不到**
 * （`station.ts` 里那句「老档已有建成站的也照旧自愈」当时只是注释里的一厢情愿）。
 *
 * 这里每拍按 `state` 现算一遍，用 `peakFirst` 把账**抬到"现状至少这么多"**——`peakFirst` 只升不降
 * ⇒ 幂等（重复现算抬不动）、不回退（这趟下得浅不会把纪录改小）、零迁移（缺省 0）。代价是小表遍历。
 *
 * **六个键的推导来源与精度**（这就是本函数的全部口径，改判定先改这里）：
 *
 * | 键 | 现算来源 | 精度 |
 * |---|---|---|
 * | `rareBoxes` | `Σ state.rareBoxesOpened`（与 `industry.ts` 开箱那一刻同一本账） | **精确** |
 * | `sitesBuilt` | `stage >= tiers.length` 的副站座数（与 `station.ts` 升满档同一把尺） | **精确** |
 * | `matterTechMaxed` | 已满级节点数（与 `matterTech.ts` 同一把尺） | **精确** |
 * | `aiCoreKinds` | 库存里 > 0 的核心类数（与 `gainAiCore` 同一把尺） | 下界（把某类花光后现算会少 ⇒ 只抬不降，已记账的档不受影响） |
 * | `whMaxDepth` | 这趟的 `run.depth` ＋ `lastSettle.depth`（最近一趟的结算单） | **下界**（更早那些趟的层深没留痕） |
 * | `whBossClears` | 这趟的 `run.bossCleared`（本趟已击破的守卫数） | **下界**（跨趟累计只在事件点记） |
 *
 * ⚠ 为什么"下界"可以放心：成就判据是 `计数 >= 阈值`，抬到"至少这么多"只会让**该拿的**拿到，
 * 不会凭空发——现算值本身就是真实发生过的事实（只是可能比真值小）。
 */
function reconcileMilestoneStats(state: GameState, ctx: SimContext): void {
  // ① 稀有残骸的额外战利品（高级箱）：逐型累计已开箱数求和（与开箱那一刻同一本账）
  let boxes = 0
  for (const n of Object.values(state.rareBoxesOpened ?? {})) boxes += n ?? 0
  peakFirst(state, 'rareBoxes', boxes)
  // ② 副空间站：`stage >= tiers.length` 的座数
  let built = 0
  for (const site of ctx.stations.values()) {
    const prog = state.stationSites?.[site.id]
    if (prog && prog.stage >= site.tiers.length) built += 1
  }
  peakFirst(state, 'sitesBuilt', built)
  // ③ 谜质科技：已满级的节点数（`ctx.matterTech` 缺失 = 空表）
  const nodes = matterTechNodes(ctx)
  if (nodes.length > 0) {
    let maxed = 0
    for (const n of nodes) if ((state.research?.levels?.[n.id] ?? 0) >= n.maxLevel) maxed += 1
    peakFirst(state, 'matterTechMaxed', maxed)
  }
  // ④ AI 核心：库存里 > 0 的类数
  let kinds = 0
  for (const t of AI_CORE_ORDER) if ((state.aiCores?.[t] ?? 0) > 0) kinds += 1
  peakFirst(state, 'aiCoreKinds', kinds)
  // ⑤⑥ 虫洞：层深与守卫数——先在洞里时读本趟，其次读"最近一趟结算单"残留的层深
  const run = state.wormhole.run
  if (run) {
    peakFirst(state, 'whMaxDepth', run.depth)
    peakFirst(state, 'whBossClears', run.bossCleared ?? 0)
  }
  const settled = state.wormhole.lastSettle?.depth
  if (settled !== undefined) peakFirst(state, 'whMaxDepth', settled)
}

/** 技能训练队列（2026-10-02 批次 4n 拆到 skillQueue.ts；本文件借回 + 再导出） */
import { advanceSkillQueue } from './skillQueue'
export {
  HIDDEN_SKILL_IDS,
  PREREQ_MIN_LEVEL,
  clearSkillQueue,
  enqueueSkill,
  moveQueueItem,
  noteLabOpened,
  planPrereqChain,
  prereqNeedLevel,
  queueMovePlan,
  removeQueueAt,
  skillCancelImpact,
  skillLockMissing,
  skillLockMissingAtQueue,
} from './skillQueue'
export type { HeadTrainingInfo, QueueMovePlan, QueueView, SkillPrereqGap } from './skillQueue'

