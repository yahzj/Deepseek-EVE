/** 功能域职责拆分，保持原计算与顺序。 */
import type { WeekendEventState } from './model'

/** 外围入侵舰队威胁（**Q1 裁定：单舰 · 威胁降低** ⇒ 78；落在"单船现实上限 ≈84"之下、比虫洞层 6≈72 略高） */
export const WEEKEND_PERIPHERY_THREAT = 78

/** 核心 T5 旗舰威胁（口径定稿 #13：**核心 120**；4 波 · 4 艘小队战） */
export const WEEKEND_CORE_THREAT = 120

/**
 * **入侵触发的声望前提**（**船长 2026-09-25 令**：「**给入侵触发加一个前提，需要拥有至少40声望，
 * 才会触发入侵。**」）—— 判的是**协会（DSI）声望**（悬赏卡门槛用的同一条）。
 * 40 与既有"虫洞解锁线"`WORMHOLE_SCAN_UNLOCK_STANDING` 同值，但那是另一件事的旋钮 ⇒ 各自独立成常量。
 *
 * 四条口径（船长同日四答）：
 * - **只在"开新场"那一刻判**（进行中的那一场不受影响：声望只涨不跌，不存在"打到一半被掐掉"）；
 * - 不达线 ⇒ **静默不开**（不记日志、不给提示——活动框/日志里本来就不会出现任何入侵信息）；
 * - **调试模式不受限**（否则新档在调试模式下测不到入侵）；
 * - ✅ **2026-09-25 船长已解除"仅调试模式可见"** ⇒ 这段**现在真的走得到**了：正常模式（非调试档）
 *   照周排期开局，本常量从此生效（开局那一刻判协会声望）。
 */
export const WEEKEND_MIN_STANDING = 40

/**
 * **单场入侵的声望上限**（**2026-09-26 船长令**：「**玩家完成入侵后根据贡献获得一定量声望**」）。
 *
 * 实发 = `round(贡献占比 × 本值)` ⇒ **0~15 点/场**（100% ⇒ 15 · 83% ⇒ 12 · 50% ⇒ 8 · 10% ⇒ 2）。
 * ⚠ 走 `noteStandingEarned`（两条账同时加）；与贡献四档奖同一处发放、**只发一次**。
 */
export const WEEKEND_STANDING_MAX = 15

/**
 * **玩家自己点火那一场的固定声望**（**2026-10-01 船长令**：「**玩家用信号发射器召唤的入侵，
 * 每次完成只给 5 声望。**」）——与每周那场"按贡献 0~15 点"区分开（防用发射器刷声望）。
 */
export const WEEKEND_STANDING_BEACON = 5

/**
 * **遇袭（巡游小队）的真·强度倍率**（船长 2026-09-25：「**遇袭的时候遭遇的敌人按强度\*0.75算**」）。
 *
 * ⚠ 语义与已删除的旧常量 `WEEKEND_AMBUSH_MUL = 0.5` **不同**：旧的只乘**威胁标签**、战斗强度一字不变
 * （舰级路径的敌属性是绝对值）⇒ 实测"78 / 120 / 39 三档打出来逐字相同"（假标签）。
 * 现行 = 传进 `combat.FoeOverride.strengthMul` **真缩放敌属性**，标签另按**缩放后的实测价**反解
 * （`combat.foeThreatOfAnomaly`；`foeHpOfThreat` 非线性 ⇒ "威胁减半" ≠ "强度减半"）。
 */
export const WEEKEND_AMBUSH_STRENGTH_MUL = 0.75

/** 遇袭概率：`p = 60% × (1 − 进度)`，封顶 0.9（口径定稿 #4） */
export const WEEKEND_ENCOUNTER_P = 0.6

export const WEEKEND_ENCOUNTER_CAP = 0.9

/**
 * **玩家推进：主动胜利（外围 / 核心）· 击退遇袭 · 离线自动结算击退（第 6 条）**
 *
 * 🔴 **2026-09-26 船长令（2026-10-01 落码）：外围主动胜利 10% → 5%** —— 船长原话照抄：
 * 「**记一个挂账，等这期入侵结束后开始修改。外围星系每次战斗增加的收复进度改为5%。**」
 * 挂账门槛 = 「等这期入侵结束」：第一期（T0 = 2026-09-25 20:00 · 窗口 96h）已于 **2026-09-29 22:00** 结束，
 * 下一期 T0 = 2026-10-02 20:00 ⇒ 本改动落在**两期之间的空档**，不会让同一期玩家的口径前后不一。
 *
 * ⚠ **三条连带已请船长逐条裁定（2026-10-01，六问全答「甲」）**，不是漏改：
 * - **核心那档仍是 5%** ⇒ 改后**外围与核心同速**（改前外围快一倍）。船长选「甲：核心不动」——
 *   核心另有「先夺回全部外围」的门禁（`weekendCoreProgressAt`），本来就晚开；
 * - **击退遇袭 3% / 离线击退 1% 不动** ⇒ 梯度由 10 : 5 : 3 : 1 变为 **5 : 5 : 3 : 1**，
 *   「主动打赢」相对「被动挨打」的优势收窄（船长选「甲：不动」——遇袭是被动的，不该跟着砍）；
 * - **进度收入单价不动**（仍读 `WEEKEND_PROGRESS_ISK_PER_PCT`）⇒ 每场的进度收入随推进量等比下降；
 *   但**「打满一处」的总收入与场次无关**（按台账总量算）。
 *
 * ⚠ **连带判据**（夺回奖与进度收入都按「夺回那一刻的 `contributed` 比例」缩水，2026-09-29 船长令乙案；
 * 而 NPC 铺底那 48 小时窗口未动 ⇒ 单场推进量减半后，玩家多花一倍场次才打得满，被铺底抢走的份额随之变大）。
 * 这不是缺陷，是「少打就少得」口径的必然结果（船长 2026-10-01 选「甲：接受」）。
 * **这个连带到底多大 ⇒ 跑 `npm run weekend:gain` 现算，结论数字不写进注释**（约定 §十五之二之5）：
 * `tools/weekend-gain-impact.ts` 按单场周期逐档算"夺回那一刻的投入比例 / 夺回奖 / 进度收入"。
 */
export const WEEKEND_GAIN_PERIPHERY_WIN = 0.05

export const WEEKEND_GAIN_CORE_WIN = 0.05

export const WEEKEND_GAIN_REPEL = 0.03

export const WEEKEND_GAIN_OFFLINE_REPEL = 0.01

/**
 * 全线硬锁；现行为null，普通周排期走已完成族循环，发射器从同池随机。
 * 历史依据：2026-09-25曾仅完成H并锁H，2026-10-02批准循环，2026-10-06批准加入C。
 */
export const WEEKEND_LOCKED_FAMILY: string | null = null

/**
 * **"做完了的族"**（**唯一登记处**）—— **船长 2026-10-02 令**：「**信号发射器召唤的敌人是随机的
 * （目前只有R和H）**」里那个"目前只有"的池子，同时也是族循环队列（`WEEKEND_FAMILY_ROTATION`）的来源。
 *
 * 口径 = 有自家独立入侵卡的族；本批确认增加C异形。
 * A/G 两族仍是**占位口径**（派生卡只换名字/威胁/奖励，敌人编成还是虫洞那批）⇒ **不进本表**，
 * 免得玩家抽到打不到真正入侵舰队的场。做一族就加一行（加完记得看族名表 `WEEKEND_FAMILY_NAME_ID`）。
 *
 * 两个消费方：
 * - **族循环**（`weekendFamilyForWindow`：无特意设置时按期顺延）；
 * - **随机抽族**（`weekendRandomFamilyOf`：信号发射器召唤用；`weekendRollOccupation` 的随机兜底同池）。
 */
export const WEEKEND_FINISHED_FAMILIES: readonly string[] = ['R', 'C', 'H', 'D']

/**
 * **循环敌对势力**（**船长 2026-10-02 令**：「**一会8点开启入侵，设置为R族，下周如果没有特意设置，
 * 就采用循环敌对势力。**」）—— 玩家线**默认**按这条队**逐期顺延**，不必每周手动改。
 *
 * - **只有"做完了的族"进这条队**（= `WEEKEND_FINISHED_FAMILIES`）——A/G 两族是占位口径，
 *   **不进循环**，免得玩家抽到打不到真舰队的场；
 * - 顺序 = 数组顺序，第 N 期取 `ROTATION[N % ROTATION.length]`（N 见 `weekendPeriodIndexOf`）；
 * - 想**特意设置某一期** ⇒ 见下面的 `WEEKEND_FAMILY_OVERRIDE`（也支持 `WEEKEND_LOCKED_FAMILY` 全线硬锁）。
 */
export const WEEKEND_FAMILY_ROTATION: readonly string[] = WEEKEND_FINISHED_FAMILIES

/**
 * **循环锚点 = 2026-10-02 20:00（本地墙钟）那一期**——**船长 2026-10-02 令**里"一会 8 点开启入侵、
 * 设置为 R 族"的**那一期**：本期 = `ROTATION[0]` = **R**（与船长指定一致，指定与循环不打架）；
 * 此后每期顺延，2026-10-06批准增加C族后采用R→C→H。
 *
 * 🔴 **2026-10-02 修（一号 · 船长令「按你推荐来」）**：原值是**手抄的毫秒数** `1_790_971_200_000`，
 * 实测 = **2026-10-03 04:00 本地**（＝`2026-10-02T20:00Z`）——比本注释写的锚点**晚 8 小时**。
 * 后果（`weekendPeriodIndexOf` 里那句 `Math.max(0, …)` 把负数夹成 0）：
 * - 本期（10-02 20:00）算出的期号 = `max(0, −1)` = **0** ⇒ 表面看"没坏"（还是 R）；
 * - **下一期（10-09 20:00）算出来 = `floor(160h/168h)` = 仍是 0** ⇒ 又出 R（光环）——
 *   本注释写的是 H（墨潮帮），玩家实际连着两期光环；
 * - 且 `WEEKEND_FAMILY_OVERRIDE`（`periodIndex: 0`、只为本期设的 R）**跟着粘到了 10-09**；
 * - 10-16 起才是 `floor(328h/168h) = 1` ⇒ 整个族循环**整整错一期**。
 *
 * 现在改成**按本地时间组件算**（与 `weekendT0Of` 的"本地周五 20:00"同一把尺；
 * 也免了下次再手抄毫秒数抄错）：锚点与期号逐期递增；族取当前循环表及指定期覆盖。
 * 回归守卫见 `tests/rotation-anchor-20261002.test.ts`（旧值下 ③④⑤ 三条会红）。
 */
export const WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()

/**
 * **特意设置某一期的族**（`null` = 不设置 ⇒ 走循环）——船长原话里"**如果没有特意设置**"的那一行开关。
 *
 * `periodIndex` = **第几期**（`weekendPeriodIndexOf(该期窗口 T0)`；锚点那一期 = 0）；
 * 只对**那一期**生效 ⇒ 过完自动回落到循环，不会像全线硬锁那样一直粘着。
 *
 * 船长确认本周异形入侵：指定锚点后一周，即2026-10-09那一期；历史已开场不追改。
 */
export const WEEKEND_FAMILY_OVERRIDE: { readonly family: string; readonly periodIndex: number } | null = {
  family: 'C',
  periodIndex: 1,
}

/**
 * **调试模式下锁定的入侵族**（2026-10-16船长令：新守墓入侵替换现有调试入侵）。
 *
 * 口径：
 * - **`debugQuick` 打开时**（本机调试档）⇒ 开局面一律判为 **D 族（守墓者）**，
 *   与 `WEEKEND_DEBUG_WIN_GAIN`（两场夺回）· `WEEKEND_DEBUG_TIME_DIVISOR`（时间 ÷60）·
 *   `WEEKEND_DEBUG_RESTART_MS`（1 小时后可重开）同属"调试便利"，只为让本机能反复实测新族；
 * - 非调试档仍按普通周排期/循环，已开的历史场及光环补场不因调试常量而追改。
 *
 * ⚠ 想换调试族只改这一个常量（`null` = 调试档也走 `WEEKEND_LOCKED_FAMILY`）。
 */
export const WEEKEND_DEBUG_FAMILY: string | null = 'D'

/**
 * **调试模式下的单场推进量**（2026-09-25 船长令：「**调试模式下，收复只需要玩家打 2 场**」）。
 *
 * 口径：`debugQuick` 时**主动胜利一律 +50%**（外围与核心同档）⇒ 任意一处占领区**两场夺回**；
 * 核心条同理两场打满 ⇒ 旗舰现身（核心"先清外围"的门禁照旧）。
 * 非调试模式**逐字不变**（外围 +5% / 核心 +5%；外围那档 2026-10-01 由 10% 降至 5%，见上）。
 */
export const WEEKEND_DEBUG_WIN_GAIN = 0.5

/** NPC 反攻保底推进（第 9 条）：外围 T0+48h 必满 · 核心 T0+72h 必满 */
export const WEEKEND_NPC_PERIPHERY_MS = 48 * 3_600_000

export const WEEKEND_NPC_CORE_MS = 24 * 3_600_000

/**
 * **旗舰削血窗口**（第 8 条；= 母舰血池从满到被章鱼人削空的"在线且非战斗"时长）。
 *
 * 🔴 **2026-09-26 船长令**：「**当入侵的旗舰出现后，章鱼人的削血速度降低，延长到默认最多24小时才能削完**」
 * ⇒ 正常模式 **2 小时 → 24 小时**（削血速率随之变成 `池子总量 ÷ 24h` ⇒ 满血 1 小时削 6,250 点）。
 *
 * ⚠ 本常量只服务**正常档**：调试档另走 `WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS`（10 分钟，调试便利，
 *   船长 2026-09-25「保留'到点即判'这套机制、把调试窗口调长」）；两档都从
 *   {@link weekendFlagshipWindowMs} 这一个单点取（倒计时 · 削血速率 · 池子读数 · 收口四处同源）。
 * ⚠ **离线保护不动**（`WEEKEND_OFFLINE_SHIELD_MS` 仍是 24h）：窗口与保护期现在同为 24h ⇒
 *   "离线 >24h"那一档的收口仍是 `自离线满 24h 起算 ＋ 一个窗口`（即离线满 48h）。
 */
export const WEEKEND_FLAGSHIP_DEADLINE_MS = 24 * 3_600_000

export const WEEKEND_BOSS_FAMILIES: readonly string[] = ['H', 'R', 'C', 'D']

/**
 * BOSS池采用固定容量（2026-09-25起，取代首战伤害反解）。
 * 战斗母舰血条 = `weekendFlagshipHpRemaining`；新池读取本常量，旧池按事件快照。
 */
/** 2026-10-13船长确认：新池采用本常量，已锁定旧池仍读取事件快照。 */
export const WEEKEND_FLAGSHIP_POOL_HP = 300_000

/**
 * ⚠ **H 族旗舰的舰级 id**（**遗留常量**：只作"认不出 T5 时"的兜底）。
 *
 * 🔴 **2026-10-02 起不要再用它当"母舰唯一判据"**——玩家报障「**哪怕母舰剩余1%血，进入战斗后母舰都是满血**」
 * 的真因就是这条写死：R 族（**本期入侵族**）的母舰是 `foe-r-corona-nexus`，与它**一条都对不上**
 * ⇒ 池子覆写（血条分母 / 分层 / `hpMul`）与**伤害台账**全都失效：
 * 母舰血量退回卡面值、战斗内血条按自身满值画（＝**满血**）、打进池子的伤害记不上
 * （R 族的"单场不死 / 跨场累计"整条失灵）。**改用 {@link weekendFlagshipSlotOf}**（从卡自身认）。
 */
export const WEEKEND_FLAGSHIP_SHIP_ID = 'foe-h-ink-flagship'

/** 离线保护（第 10 条）：离线 ≤24h ⇒ 倒计时挂起，上线第一拍起算（Q3：离线满 24h 那一刻起算） */
export const WEEKEND_OFFLINE_SHIELD_MS = 24 * 3_600_000

/**
 * 活动窗口（第 1/15 条）：T0 = 每周五 20:00（本地墙钟）。
 *
 * 🔴 **2026-09-27 船长令**：「**到点时间需要延长到96小时**」⇒ **74h → 96h**（周五 20:00 ~ 周二 20:00）。
 * 直接效果：NPC 保底（外围 T0+48h 满 · 核心再 24h ⇒ T0+72h 满）之后，**旗舰的可打时间由 2 小时变成 24 小时**。
 * ⚠ 本常量是"窗口"的**唯一出处**，但**2026-10-02 起读者变少了**：原先还有
 * （a）`ensureWeekendEvent` 的"距上一场开始不足 96h ⇒ 不开"（**船长 10-02 令「甲」已作废**）与
 * （b）`weekendTick` ④ 的"自己 +96h ⇒ 收场"（**船长 10-02 令「乙」已作废**，周排期场改按"下一期 T0"收场）。
 * 现存读者：**开局窗口**（`weekendWindowOpen`）· 首场特例的失效时刻 · **玩家召唤场自己的到点收场**
 * （`beaconLit`，`weekendTick` ④）· `weekendWindowMsOf`（展示口径）。
 */
export const WEEKEND_START_WEEKDAY = 5

export const WEEKEND_START_HOUR = 20

export const WEEKEND_WINDOW_MS = 96 * 3_600_000

/**
 * **只有调试模式可见/可开**（**船长 2026-09-23 令**：「**目前入侵只有调试模式可见**」）——
 * ✅ **2026-09-25 船长解除**：「**现在可以解除限制，并在一会 22 点开始第一次入侵活动。**」
 * ⇒ 置 `false`：正常模式（非调试档）**照周五 20:00 的周排期开局**，界面也不再要求调试模式。
 * 引擎/界面/用例都读这一个开关，不做第二处判断。
 */
export const WEEKEND_DEBUG_ONLY = false

/**
 * **首场一次性 T0**（**船长 2026-09-25 令**：「在一会 22 点开始第一次入侵活动」＋二答「**只今晚这一次
 * 22:00**」）：`2026-09-25 22:00`（**本地墙钟**）起开场，**此后一律回到每周五 20:00 的周排期**。
 *
 * 只在"到点 ＋ 手上还没有从这一刻起开过的场"时生效（见 `ensureWeekendEvent`）；过完这一晚就永久失效
 * （`nowWallMs >= 首场 + 96h`）。
 * ⚠ 与"每周 20:00"的关系（**2026-10-02 起改口径**）：首场结束后**会**在同一窗口里按周排期的 20:00
 * 补开一场 —— 旧口径靠"一个窗口只开一场"那条判据兜住，**该判据已由船长 2026-10-02 令「甲」作废**
 * （开局只看"当前有没有进行中的场"）⇒ 补开的新场 `startedAtWallMs` = 周排期 T0（09-25 20:00），
 * 可能**早于**首场的 22:00（只是记账口径，窗口同在本周二 20:00 前关）。
 * ⚠ 置 `null` = 没有首场特例（恢复纯周排期）。
 */
export const WEEKEND_FIRST_T0_WALL_MS: number | null = new Date(2026, 8, 25, 22, 0, 0, 0).getTime()

/** 调试模式（`debugQuick`）：上一场结束 + 1 小时刷新（第 15 条）· NPC 时间轴 ÷60（Q6）· 关掉离线保护（Q7） */
export const WEEKEND_DEBUG_RESTART_MS = 3_600_000

/** 船长2026-10-18要求暂时关闭调试档无条件入侵；不影响手动发射器或已有场次结算。 */
export const WEEKEND_DEBUG_AUTO_START_ENABLED = false

export const WEEKEND_DEBUG_TIME_DIVISOR = 60

/**
 * **一拍最多按多少毫秒推进章鱼削血**（`WEEKEND_BOSS_TICK_MAX_MS` = 一拍的合理上限）。
 * 起因：在线心跳 ≈ 每帧/每秒一次，但**后台标签页、长卡顿、离线补算后的第一次心跳**可能一次跳几分钟～
 * 几十分钟。章鱼削血是"在线陪着打"的机制 ⇒ 一次长跳只按一拍算（多出来的时间视为"玩家没在看着"）。
 */
export const WEEKEND_BOSS_TICK_MAX_MS = 5_000

/**
 * **旗舰战结束后的章鱼人冷却**（**船长 2026-09-26 令**：「**给章鱼人进攻削血加个冷却，玩家战斗结束 1 分钟后，
 * 章鱼人才开始削血和判定。这样玩家就能正常收掉 BOSS**」）。
 *
 * 落点 = `weekendTickBoss`：旗舰战进行中每拍把 `ev.octopusHoldUntilWallMs` 推后到 `now + 本常量`；
 * 停工期（战斗中 ＋ 结束后 60 秒）**既不削血、也不判得手**（一条守卫同时管住两件事）。
 * ⚠ **只有旗舰战**触发它（其它战斗照旧只"暂停削血"，不加尾巴）；调试档同为 60 秒（船长 2026-09-26 明示）。
 * ⚠ 本常量**只影响"什么时候开始削"**：速率、窗口、封顶、`need ≤ 0` 不由章鱼认领等口径一律不变。
 */
export const WEEKEND_OCTOPUS_HOLD_MS = 60_000

/**
 * **本场收场的顺延时长**（**船长 2026-09-27 令**：「**到点的延期到玩家打完1分钟后**」）。
 *
 * 场景：**该收场那一刻**玩家**正在打旗舰战**——改动前那一场会被整场作废（伤害台账/判沉/黑匣/
 * 残骸/日志全丢，玩家白打；`weekend:sim` 的 `window` 场景可复现）。现改为：还有没打完的旗舰战 ⇒
 * 本场入侵**不结束**，每拍把 `ev.windowEndHoldUntilWallMs` 推后到 `now + 本常量` ⇒ 那场打完
 * **再满 60 秒**才收场。
 *
 * ⚠ **2026-10-02 船长令「乙」只改了"到点"是什么**（周排期场：自己 +96h → **下一期 T0 已到**；
 * 召唤场：自己 +96h 不变）——**本常量与整条顺延机制一字未动**。
 *
 * ⚠ 与 `WEEKEND_OCTOPUS_HOLD_MS`（章鱼停工 60 秒）**同值但语义独立**：一个管"章鱼什么时候开始削"、
 * 一个管"本场什么时候算到点"，两把闸各自可调，**不要合并成一个常量**。
 * ⚠ **只有旗舰战**触发（与章鱼停工同一把尺）；其它入侵战斗不顺延。
 * ⚠ 顺延期间活动**仍然活着** ⇒ 战斗收尾走的是正常结算路径（不需要在结算侧另开特例）。
 * ⚠ 顺延**不设时限**（船长 2026-09-27 裁定「甲」）。旧口径下"真拖过下一场 T0 ⇒ **下一场入侵取消**"
 * 这条路自 2026-10-02「乙」起**不可达**（到点就是"下一期 T0 已到"，旧场在那一拍被收掉）。
 */
export const WEEKEND_WINDOW_END_HOLD_MS = 60_000

/**
 * 入侵族池（口径定稿：**A 变种 / C / G / 新族×2**）。
 * ⚠ **M1 只放"虫洞已有的族"**（A/C/G）——因为**敌卡暂用虫洞族卡**（船长 2026-09-23：
 * 「入侵战斗采用独立设计的卡（之后设计），我们暂时先试用虫洞的」）；两个新族随 M3（独立卡/新族）一起进池。
 *
 * ⚠ **2026-09-24 M2 逐族落地**：第一族 = **H 墨潮帮**（船长定名「The Ink Tide」）——
 * 它有**自家的独立入侵卡**（`ink-assault` / `ink-flagship`，见 `weekendFoeCardOf`），
 * 故**在此进池**；A/C/G 三族仍按 M1 口径用虫洞卡，等各自的旗舰卡设计好再逐族迁移。
 *
 * ⚠ **2026-10-01 第二族 = R 光环**（船长令「**是新势力：余晖，你可以查阅下远行星号中的无人机敌对势力
 * 光环，我们参考那个做**」）——同 H 族口径：**自家四张独立入侵卡**、自带定价、进 BOSS 表。
 * ⚠ 本期（到 2026-10-09 那期为止）**实际跑哪一族由 `weekendLockedFamilyOf(state)` 决定**，
 * 本行只声明"允许进池的族"。
 */
export const WEEKEND_FAMILIES: readonly string[] = ['A', 'C', 'G', 'H', 'R', 'D']

/**
 * **族名的中文全称 / 文案 id**（族字母只是内部简称，**不许进玩家可见文案**）。
 *
 * 口径与残骸族名同源（`data/` 的 `WRECK_FAMILY_EN`：Pirate / Alien / Deadarmy / Ink Tide /
 * Corona Systems），中文两侧都在 `l10n/table.ts` 的 `core.weekend.020~024` 里逐族登记
 * （界面按 `p1Id` 取译名 ⇒ **中英各自成句**）。
 *
 * 🔴 **加族必须同步本表**（**2026-10-01 实障 · 船长报障**：「**入侵的通讯应该采取更正式的名称，
 * 不应该直接用X族**」）：R 族（光环）进 `WEEKEND_FAMILIES` 时本表**漏登记**，兜底便把**内部族代号**
 * 原样印给了玩家 —— 通讯标题成了「航线警告：**R 族**入侵」、悬赏名成了「**R 族**舰队 · …」。
 * ⇒ 现由 `weekend-event.test.ts` 的「族名表覆盖全族池」用例守着：**族池里每一族都必须登记**。
 *
 * ⚠ 放在本文件（而不是 `weekendComms.ts`）是因为**悬赏侧与战斗侧也要取它**
 * （`weekendBounty` / `weekendBattle`），而那两个模块被 `weekendComms` 反过来 import
 * ⇒ 族名表放这里，三个消费方才能共用而不绕成循环依赖。
 */
export const WEEKEND_FAMILY_NAME_ZH: Readonly<Record<string, string>> = {
  A: '海盗',
  C: '异形生物',
  G: '鱿鱼亡军',
  H: '墨潮帮',
  R: '光环',
  D: '守墓者',
}

export const WEEKEND_FAMILY_NAME_ID: Readonly<Record<string, string>> = {
  A: 'core.weekend.020',
  C: 'core.weekend.021',
  G: 'core.weekend.022',
  H: 'core.weekend.023',
  R: 'core.weekend.024',
  D: 'core.weekend.026',
}

/** 未知族的中性称呼（中文原文；同一句的英文由 `core.weekend.025` 给） */
export const UNKNOWN_FAMILY_ZH = '未知势力'

/**
 * **H 族入侵敌卡池**（船长 2026-09-25：「**外围玩家主动出击和被动遇袭都是从骚扰和袭击舰队中抽取。
 * 核心区，则是抽取袭击和主力舰队。**」）——id 的唯一登记处是 `data/wormholeFoes.ts` 的
 * `WEEKEND_FOE_CARD_IDS`（core 不依赖 data，故此处按既有先例写字面量）。
 */
export const H_FOE_POOL_PERIPHERY: readonly string[] = ['ink-harass', 'ink-raid']

export const H_FOE_POOL_CORE: readonly string[] = ['ink-raid', 'ink-main']

/**
 * **R 族（光环）入侵敌卡池**（2026-10-01 船长令建族；**沿用 H 族那条口径**：外围 = {游弋, 分光} ·
 * 核心 = {分光, 汇聚}）——id 的唯一登记处同样是 `data/wormholeFoes.ts` 的 `WEEKEND_FOE_CARD_IDS`。
 */
export const R_FOE_POOL_PERIPHERY: readonly string[] = ['corona-drift', 'corona-split']

export const R_FOE_POOL_CORE: readonly string[] = ['corona-split', 'corona-converge']

export const D_FOE_POOL_PERIPHERY: readonly string[] = ['gravekeeper-drift', 'gravekeeper-line']

export const D_FOE_POOL_CORE: readonly string[] = ['gravekeeper-line', 'gravekeeper-main']

/**
 * **章鱼人削血窗口**（= 母舰血池从满到被削空的"在线且非战斗"时长）——
 * 正常模式 = `WEEKEND_FLAGSHIP_DEADLINE_MS`（**24 小时**）；**调试模式 = 10 分钟**。
 *
 * ⚠ **2026-09-25 船长两次口径合一**：
 * 1. 船长原话（2026-09-24）：「**2小时内按时间削掉100%母舰血量。当玩家正在战斗时，会暂停削血。
 *    等玩家战斗结束才继续。**」⇒ 削血是**真实削减**（船长 2026-09-25 复述：「**章鱼人削减母舰血条是
 *    真实削减，玩家假设打完一场放一会，母舰血量是会真实减少。**」）⇒ **攒满窗口 = 血条见底 = 得手**，
 *    战斗中与离线都暂停；
 * 2. 船长 2026-09-25 对"窗口太短"的裁定：**保留"到点即判"这套机制、把调试窗口调长**（②）
 *    ⇒ 本函数把调试档从"÷60 = 2 分钟"改成固定的 **10 分钟**（原 2 分钟连点进准备界面都来不及）。
 *
 * 🔴 **2026-09-26 船长令（本常量第三次改动）**：「**当入侵的旗舰出现后，章鱼人的削血速度降低，
 * 延长到默认最多24小时才能削完**」⇒ **正常档 2 小时 → 24 小时**（速率 = `池子 ÷ 窗口` ⇒ 满血
 * 在线 1 小时削 6,250 点）；**调试档不动**（仍 10 分钟）。
 *
 * ⚠ 四处必须同源（改窗口即同时改这四处的口径）：`weekendFlagshipView` 的倒计时、
 * `weekendOctopusDrainPerMs` 的削血速率、`weekendBossPoolView` 的章鱼进度、`weekendOctopusTick` 的收口。
 */
export const WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS = 10 * 60_000

/** 该星系是不是本次入侵的占领区（核心或外围） */
export function weekendOccupiedIds(ev: WeekendEventState | undefined): string[] {
  if (!ev) return []
  return [ev.coreId, ...ev.peripheryIds]
}

/**
 * **2026-10-02 破环搬家**（原住 weekendBounty.ts）：`WEEKEND_CARD_PREFIX` / `weekendZoneLiveAt`
 * 这两件只读 `state.weekendEvent`，是**活动态读数**——搬来本件（活动态的家）后，
 * `weekendBattle ↔ weekendBounty` 的运行期边清零（weekendBattle 改从本件读；weekendBounty 原样再导出）。
 */

/** 派生卡 id 前缀（与原卡区分；**永不写入首胜台账**） */
export const WEEKEND_CARD_PREFIX = 'wk-'

/**
 * **进度收入的单价**（ISK / 每 1% 进度）——
 * 船长 2026-09-25 令：「**入侵舰队不应该有赏金**……因为击败入侵舰队就能获取进度，
 * **在结算时候直接按进度获取收入**」，三选一裁定**③「每 1% 固定 20 万 ISK（与星系无关）」**。
 *
 * 于是入侵战斗**当场一分钱都不给**（悬赏那一栏整条退役），收入在**活动结束时**随夺回奖励与
 * 贡献四档奖一次发（`weekendSettleAndGrant`）：
 * - **每场收入 = 该档推进百分点 × 本单价**（现算；各档推进量见 `WEEKEND_GAIN_*` 那一组常量，
 *   2026-10-01 起外围与核心同额）· **「打满一处」的总收入按台账总量算、与场次无关**；
 *   各档的当前读数跑 `npm run weekend:gain`（`tools/weekend-gain-impact.ts` 现算）——**结论数字不写进注释**
 *   （约定 §十五之二之5：写死的读数会被下一次调值悄悄作废）；
 * - **只结玩家自己打出来的进度**（`ev.contributed` 台账；NPC 铺底那部分不算收入——
 *   否则挂机也在赚钱）；
 * - 进度本身按星系封顶 100%（`weekendNoteContribution` 已 clamp）⇒ 单星系收入上限 = 2,000 万。
 */
export const WEEKEND_PROGRESS_ISK_PER_PCT = 200_000

/**
 * **BOSS 输出在总贡献里的权重**（**2026-09-28 船长令**：
 * 「**贡献权重要进行倾斜，BOSS输出的贡献占总贡献的60%**」）。剩下的 `1 − 本值` 归**清缴**那一份。
 * 与"击杀必给黑匣"同批定的口径，两者都由船长 2026-09-28 亲定。
 */
export const WEEKEND_CONTRIBUTION_BOSS_WEIGHT = 0.6

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
