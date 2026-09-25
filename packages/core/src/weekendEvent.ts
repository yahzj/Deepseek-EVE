/**
 * **周末入侵活动**（2026-09-23 船长令：设计定稿 → 「**Q1，威胁降低，依旧是单舰。其他按你推荐。**」⇒ M1 开工）。
 *
 * 设计全文（口径 16 条 ＋ 机制蓝图 ＋ 数值表 ＋ 已裁决 7 条）见
 * `docs/design/weekend-invasion-20260923.md`；**本文件只放机制骨架的第一块（纯函数）**：
 * 时间轴 / 占领（核心 ＋ 外围）/ 进度（玩家推进 ＋ NPC 反攻铺底 ＋ 核心门禁）/
 * 高频遇袭概率与伏击强度 / 贡献台账 / 旗舰状态。战斗接线（派生卡、小队战入口、日志与界面）在下一块。
 *
 * 三条设计原则（都为了"零迁移 + 可离线结算 + 可测"）：
 * 1. **进度不落盘逐格 tick**：`进度 = NPC 铺底(时间函数) + 玩家投入(台账)` ⇒ 离线一样能算、读档即自洽；
 * 2. **随机全走独立子流**（`hash32(存档种子, 入侵编号)`）⇒ **不消费主随机序列**，老档读数一字不动；
 * 3. **一切判据纯函数**（给 `nowWallMs` 就出结果）⇒ 用例可对任意时刻断言，不依赖 tick。
 */
import type { SimContext } from './types'
import type { GameState, WormholeFamily } from './state'
import { securityZoneOf } from './sideTasks'
import { FOE_DESIGN_STRENGTH_MUL, wormholeCardPoolAt } from './wormholeFoes'
// ⚠ 依赖方向：`combat` 不 import 入侵模块（那条由 `weekendLaunch` 走）⇒ 这里单向引 combat 是安全的
import { applyFoeOverride, foeThreatOfAnomaly } from './combat'

/* ─────────────── 常量（数值表 · 2026-09-23 Q1 定档后锁） ─────────────── */

/** 外围入侵舰队威胁（**Q1 裁定：单舰 · 威胁降低** ⇒ 78；落在"单船现实上限 ≈84"之下、比虫洞层 6≈72 略高） */
export const WEEKEND_PERIPHERY_THREAT = 78
/** 核心 T5 旗舰威胁（口径定稿 #13：**核心 120**；4 波 · 4 艘小队战） */
export const WEEKEND_CORE_THREAT = 120
/**
 * **旗舰黑匣的爆率表**（**船长 2026-09-25 令**）：
 *
 * > 「**修改敌方旗舰爆黑匣的概率，当玩家输出高于50%时，如果抢到最后一下，就必爆黑匣。
 * > 如果输出低于50%，按照输出占比，爆率衰减到10%（就是玩家只抢最后一下的话）。
 * > 如果玩家没抢到最后一下，爆率根据玩家输出，从25%开始衰减（100%输出都是玩家打的情况下）。
 * > 最终衰减到0(玩家0输出)**」
 *
 * 设 `p` = **玩家输出占比 = 玩家对母舰的累计伤害 ÷ 池子总量**（与血条、结算面板
 * 「对母舰造成原始伤害 X · 血池 Y」同一把尺；船长四答之一）：
 *
 * | 情形 | 爆率 |
 * |---|---|
 * | **抢到最后一下**（血条是玩家打空的）＋ `p > 50%` | **100%**（必爆） |
 * | **抢到最后一下** ＋ `p ≤ 50%` | 从 `100%`（p = 50%）**线性衰减到 `10%`**（p = 0，"只抢最后一下"） |
 * | **没抢到最后一下**（章鱼人把血条削空） | `25% × p`（p = 100% ⇒ 25%，p = 0 ⇒ 0%） |
 *
 * ⚠ 两条性质：① **p = 50% 处两支接得上**（都算 100%），不跳变；② 同一 p 下，抢到最后一下**永远不低**于
 * 没抢到（10%~100% vs 0%~25%）。
 * ⚠ 窗口到点（**旗舰撤走**、没有被摧毁）**不掷**——没有残骸可捞；残骸本身照旧"玩家击沉必给 ×3"
 * （船长四答之三："残骸不变"）。
 */
export const WEEKEND_BLACKBOX_MIN_ON_LAST_HIT = 0.1
export const WEEKEND_BLACKBOX_MAX_OFF_LAST_HIT = 0.25

/** 黑匣爆率（纯函数 · 表见上）—— 引擎 / 界面 / 用例读同一份 */
export function weekendBlackBoxChanceOf(playerDmg: number, hpMax: number, lastHitByPlayer: boolean): number {
  const p = hpMax > 0 ? Math.max(0, Math.min(1, Math.max(0, playerDmg) / hpMax)) : 0
  if (lastHitByPlayer) {
    if (p > 0.5) return 1
    return WEEKEND_BLACKBOX_MIN_ON_LAST_HIT + (p / 0.5) * (1 - WEEKEND_BLACKBOX_MIN_ON_LAST_HIT)
  }
  return WEEKEND_BLACKBOX_MAX_OFF_LAST_HIT * p
}

/** 黑匣掷骰用的**独立子流盐**（与抽签流错开；口径见 `streamOf`：不消费主随机序列） */
export const WEEKEND_BLACKBOX_SALT = 20_000

/**
 * **掷一次黑匣**（船长 2026-09-25 令）：按爆率表掷，结果写进 `ev.flagshipBlackBox`。
 *
 * - **幂等**：已掷过（字段有值）直接返回它 —— 收口路径与战斗收尾可能都走到，不能掷两次；
 * - **可复现**：走**独立子流**（存档种子 ＋ 场次号 ＋ 黑匣盐）⇒ 不消费主随机序列、读档重打同一场
 *   结果相同（船长四答之四）；
 * - `chance = 1` 必中、`chance = 0` 必不中（不必消耗随机数，但子流是无状态的，耗不耗都一样）。
 */
export function weekendRollBlackBox(
  state: Pick<GameState, 'rng'>,
  ev: WeekendEventState,
  lastHitByPlayer: boolean,
): boolean {
  if (ev.flagshipBlackBox !== undefined) return ev.flagshipBlackBox
  const chance = weekendBlackBoxChanceOf(ev.flagshipHpDone ?? 0, ev.flagshipHpMax ?? 0, lastHitByPlayer)
  const rng = streamOf(state.rng.seed, ev.seq + WEEKEND_BLACKBOX_SALT)
  const hit = chance >= 1 || (chance > 0 && rng() < chance)
  ev.flagshipBlackBox = hit
  return hit
}

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
 * 协会（DSI）声望取数。
 *
 * ⚠ **刻意不 import `expedition`**：`expedition` 反过来 import 本文件（`weekendFoeCardOf`）⇒
 * 引进来会成环（同本文件头注那条"依赖方向"纪律）。id 与 `expedition.DSI_FACTION_ID` 同值；
 * `firstTasks` 里也有一处同样的本地写法（既有做法）。
 */
function dsiStandingOf(state: GameState): number {
  return state.standings['dsi'] ?? 0
}
/**
 * **这一刻允许开新场吗**（声望前提的唯一判据；`ensureWeekendEvent` 正常模式那一段读它）。
 * 调试模式恒真（船长四答之三）⇒ 调试不受门槛影响；其余情形 = 协会声望 ≥ `WEEKEND_MIN_STANDING`。
 */
export function weekendInvasionAllowedFor(state: Pick<GameState, 'debugQuick' | 'standings'>): boolean {
  if (weekendDebugOn(state)) return true
  return (state.standings['dsi'] ?? 0) >= WEEKEND_MIN_STANDING
}
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
/** 玩家推进：主动胜利（外围 / 核心）· 击退遇袭 · 离线自动结算击退（第 6 条） */
export const WEEKEND_GAIN_PERIPHERY_WIN = 0.1
export const WEEKEND_GAIN_CORE_WIN = 0.05
export const WEEKEND_GAIN_REPEL = 0.03
export const WEEKEND_GAIN_OFFLINE_REPEL = 0.01

/**
 * **锁定的入侵族**（2026-09-25 船长令：「**目前只做了H族，所以先锁定H族**」）：
 * A/C/G 三族仍是"占位口径"（派生卡只换名字/威胁/奖励、敌人编成还是原来那批）⇒ 抽到它们时玩家打不到真正的
 * 入侵舰队。置 `'H'` ⇒ **开局面一律判为 H 族**（独立卡 · 170 旗舰 · 黑匣一整套）；M2/M3 把三族补齐后
 * **置回 `null`** 即恢复"四族等概率随机"（`weekendRollOccupation` 里那一行就是唯一开关）。
 */
export const WEEKEND_LOCKED_FAMILY: string | null = 'H'

/**
 * **调试模式下的单场推进量**（2026-09-25 船长令：「**调试模式下，收复只需要玩家打 2 场**」）。
 *
 * 口径：`debugQuick` 时**主动胜利一律 +50%**（外围与核心同档）⇒ 任意一处占领区**两场夺回**；
 * 核心条同理两场打满 ⇒ 旗舰现身（核心"先清外围"的门禁照旧）。
 * 非调试模式**逐字不变**（外围 +10% / 核心 +5%）。
 */
export const WEEKEND_DEBUG_WIN_GAIN = 0.5

/** 主动胜利的推进量：调试模式 = `WEEKEND_DEBUG_WIN_GAIN`；正常 = 外围 10% / 核心 5% */
export function weekendWinGainOf(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
): number {
  if (weekendDebugOn(state)) return WEEKEND_DEBUG_WIN_GAIN
  return galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
}
/** NPC 反攻保底推进（第 9 条）：外围 T0+48h 必满 · 核心 T0+72h 必满 */
export const WEEKEND_NPC_PERIPHERY_MS = 48 * 3_600_000
export const WEEKEND_NPC_CORE_MS = 24 * 3_600_000
/** 旗舰倒计时（第 8 条）：核心条满后 2 小时内未击毁 ⇒ 章鱼人摧毁 */
export const WEEKEND_FLAGSHIP_DEADLINE_MS = 2 * 3_600_000

/* ═══════════ 旗舰 BOSS 化：跨场累计伤害（船长 2026-09-24 第二轮令）═══════════
 * 船长原话：「**墨潮入侵母舰我想改成类似BOSS的机制：血量极厚，但是玩家对其造成的伤害会累计。
 * （有点类似舰队collection的活动BOSS，你如果不理解就回应我一下）。需要玩家多次战斗后才能击沉。
 * 之前设计的旗舰出现后2小时就会被章鱼人官方击败，也改成在2小时内削减旗舰的血量。**」
 * ＋ 追问后裁决：「**2小时内按时间削掉100%母舰血量。当玩家正在战斗时，会暂停削血。等玩家战斗结束
 * 才继续。防止抢走玩家的击杀。**」·「**按对母舰造成的伤害决定，如果母舰没有受伤就是0输出。**」·
 * 离线「**挂起：离线时章鱼也停**」· 血量「**约 5 场**」。
 *
 * 口径（本段实现即照此）：
 * - **池子总量** = **固定常量 `WEEKEND_FLAGSHIP_POOL_HP`（150,000）**（2026-09-25 船长：「BOSS 血条 15 万来算」）；
 * - **进度**只算**打进母舰的伤害**（未截断的原始值）；母舰一点没挨打 ⇒ 该场 0 进度；
 * - **单场不死**：母舰血条 = 池子剩余，单场打到 0 才判"旗舰已击沉"；
 * - **章鱼人** = 一条**独立进度**：`章鱼已削 = (2h 窗口内"在线且非战斗"的累计时长 / 2h) × 池子总量`
 *   ——战斗中暂停（防抢击杀）、离线暂停（与倒计时同一条离线保护）；
 * - **归属**：谁先把自己的进度打满 ⇒ 谁击沉（玩家 ⇒ 奖励；章鱼 ⇒ 摧毁）。
 *   两条进度**各自累加、不互扣**（章鱼削血不影响玩家已造成的伤害）。
 *
 * ⚠ **上线开关**：本机制**按族启用**——只有登记在 `WEEKEND_BOSS_FAMILIES` 里的族才走池子口径，
 * 其余族逐字走老口径（"核心满 + 打赢 ⇒ 直接击毁"＋ 2 小时到点直接被章鱼击败）。
 * 2026-09-24 第二轮：**H 族先上**（船长令就是针对墨潮入侵母舰下的）。
 */
export const WEEKEND_BOSS_FAMILIES: readonly string[] = ['H']
/**
 * **BOSS 池子总量 = 固定 150,000**（船长 2026-09-25：「**BOSS 血条 15 万（约 2.5 个母舰）来算**」）。
 *
 * 取代原先两条自适应公式（上限 = 5 × 首战最高原始伤害 · 下限 = 母舰卡面满血 × 5）：
 * 母舰舰级血改成 39,200（当前卡面 69,592）后，"×5 下限"会飙到约 35 万（单场打 1 万要磨 35 场），
 * 与"约 5 场"彻底脱节 ⇒ 改常量：**单场打约 3 万 ⇒ 5 场**。
 * 战斗里的母舰血条 = **池子剩余**（船长同日选「甲」）= `weekendFlagshipHpRemaining`。
 */
export const WEEKEND_FLAGSHIP_POOL_HP = 150_000
/** H 族旗舰的**舰级 id**（挑母舰单位 / 血条覆写 / 伤害台账同源；`weekendIsFlagshipShipId` 是唯一判据） */
export const WEEKEND_FLAGSHIP_SHIP_ID = 'foe-h-ink-flagship'

/**
 * **"这条舰级算不算'旗舰'（BOSS 本体）"**——按**族旗舰卡里 T5 那一档**认：
 * H 族 = `foe-h-ink-flagship`（`hullClassTier === 5`）。用于伤害台账挑出母舰单位、以及**战斗内的血条覆写**。
 * ⚠ 只认"旗舰卡里 tier 5 的那一条" ⇒ 同卡的干扰舰/战巡/鱼雷舰不算。
 */
export function weekendIsFlagshipShipId(shipId: string): boolean {
  return shipId === WEEKEND_FLAGSHIP_SHIP_ID
}

/**
 * **战斗里母舰的血条**（船长 2026-09-25 选「甲：母舰血条 = 池子剩余」，同日再改口径 ⇒ **共享血条**）。
 *
 * ⚠ **2026-09-25 船长两条口径**：
 * 1.「**章鱼人削减母舰血条是真实削减，玩家假设打完一场放一会，母舰血量是会真实减少。**」
 * 2.「**章鱼人 = 真实削减血量所以并不需要显示章鱼人削减进度和倒计时。（因为削到 0% 就代表母舰被章鱼人摧毁。）**」
 *
 * ⇒ **一条共享血条**：`剩余 = 池子总量 −（玩家已造成 ＋ 章鱼人已削）`，下限 1
 * （= 0 表示已被摧毁，开战入口先拒）。玩家的实战伤害与章鱼人的侵蚀**都真实减少同一条血**——
 * 于是"打完一场放一会，母舰血量真减少"成立，也不再需要单独的章鱼进度与倒计时读数。
 * 由 `weekendLaunch.weekendStartFlagshipBattle` 传进 `FoeOverride.bossHp` ⇒ 逐拍重建也吃同一份
 * （覆写随档存进 `BattleState.foeOverride`）。
 */
export function weekendFlagshipHpRemaining(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return WEEKEND_FLAGSHIP_POOL_HP
  const hpMax = ev.flagshipHpMax ?? WEEKEND_FLAGSHIP_POOL_HP
  const done = Math.max(0, ev.flagshipHpDone ?? 0) + weekendOctopusDone(ev)
  return Math.max(1, Math.round(hpMax - done))
}

/**
 * **章鱼人已削掉的血量**（共享血条里的那一份，与玩家的 `flagshipHpDone` 相加即"血条已经掉了多少"）。
 * 字段本身就是血量（`octopusHpDone`）⇒ 读侧**不需要知道窗口长度**（窗口只在推进时用一次）。
 */
export function weekendOctopusDone(ev: WeekendEventState | undefined): number {
  if (!ev || !weekendIsBossFamily(ev)) return 0
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return 0
  return Math.min(hpMax, Math.max(0, ev.octopusHpDone ?? 0))
}

/**
 * **母舰三层血的容量**（护盾/装甲/结构）= 池子总量 × 卡面 `split`（母舰 = 0.2 / 0.55 / 0.25）。
 * 这是血条三行的**分母**（恒为池子口径）——与"当前剩多少"分开算，见下。
 */
export function weekendFlagshipLayerCaps(
  hpMax: number,
  split: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const total = Math.max(0, hpMax)
  return { s: total * split.s, a: total * split.a, h: total * split.h }
}

/**
 * **母舰三层血的"当前值" = 按 护盾 → 装甲 → 结构 的顺序扣除**（**船长 2026-09-25 令**：
 * 「**母舰当前血条不要按照三个等比扣除，应该按照护盾-装甲-结构的顺序扣除**」）。
 *
 * 口径：池子剩余 `remaining` **从最后一层往回灌**——先灌满**结构**，再灌**装甲**，剩下才落在**护盾**上。
 * 等价说法：池子挨过的伤害**先打光护盾**（第一层），打光了才开始打装甲，最后打结构。
 *
 * 于是"池子剩 50%"不是说三层各半，而是：护盾 **0** · 装甲 `75000−37500=37500` · 结构 **满**——
 * 血条三行一眼就能看出"盾已经没了、正在啃装甲"。
 * ⚠ 这**不只是显示**：三层各自的抗性与层克制不同（`applyDamage` 逐层乘系数）⇒
 * 母舰开打时的分层血量决定了每一发的实收伤害，"护盾先空"与"三层等比"打架手感不同。
 */
export function weekendFlagshipLayersOf(
  remaining: number,
  cap: { s: number; a: number; h: number },
): { s: number; a: number; h: number } {
  const rest = Math.max(0, Math.min(cap.s + cap.a + cap.h, remaining))
  const h = Math.min(cap.h, rest)
  const a = Math.min(cap.a, Math.max(0, rest - h))
  const s = Math.min(cap.s, Math.max(0, rest - h - a))
  return { s, a, h }
}

/** 离线保护（第 10 条）：离线 ≤24h ⇒ 倒计时挂起，上线第一拍起算（Q3：离线满 24h 那一刻起算） */
export const WEEKEND_OFFLINE_SHIELD_MS = 24 * 3_600_000
/** 活动窗口（第 1/15 条）：T0 = 每周五 20:00（本地墙钟）→ 74h */
export const WEEKEND_START_WEEKDAY = 5 // 5 = 周五（JS getDay）
export const WEEKEND_START_HOUR = 20
export const WEEKEND_WINDOW_MS = 74 * 3_600_000
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
 * （`nowWallMs >= 首场 + 74h`）。
 * ⚠ 与"每周 20:00"的关系：首场结束后**不会**在同一窗口里按 20:00 补开一场 —— 靠
 * `ensureWeekendEvent` 里"一个窗口只开一场"那条判据兜住（窗口 = 74h）。
 * ⚠ 置 `null` = 没有首场特例（恢复纯周排期）。
 */
export const WEEKEND_FIRST_T0_WALL_MS: number | null = new Date(2026, 8, 25, 22, 0, 0, 0).getTime()

/** 调试模式（`debugQuick`）：上一场结束 + 1 小时刷新（第 15 条）· NPC 时间轴 ÷60（Q6）· 关掉离线保护（Q7） */
export const WEEKEND_DEBUG_RESTART_MS = 3_600_000
export const WEEKEND_DEBUG_TIME_DIVISOR = 60

/* ─────────────── 存档结构（`state.weekendEvent`，可选 ⇒ 零迁移） ─────────────── */

export interface WeekendEventState {
  /** 本次入侵编号（自增；随机子流的盐） */
  seq: number
  /** T0（墙钟；正常 = 周五 20:00，调试 = 上一场结束 + 1h） */
  startedAtWallMs: number
  /** 结束墙钟（未结束 = 缺省） */
  endedAtWallMs?: number
  /** 核心星系（已探索 · 中安/低安 · 无已建副站） */
  coreId: string
  /** 外围 = 核心的全部邻居（不封顶；**含高安**） */
  peripheryIds: string[]
  /** 本周入侵族 id */
  family: string
  /** 玩家推进台账：galaxyId → 累计投入比例（0~1 的加数） */
  contributed: Record<string, number>
  /** 核心条满（旗舰现身）的墙钟 */
  flagshipAtWallMs?: number
  /** 旗舰结局：玩家击毁 / 章鱼人摧毁 */
  flagshipDown?: 'player' | 'octopus'
  /**
   * **黑匣掷骰结果**（**船长 2026-09-25 令**：爆率按"输出占比 ＋ 抢没抢到最后一下"算，
   * 见 `weekendBlackBoxChanceOf`）：`true` = 爆了 · `false` = 没爆 · `undefined` = 还没掷（母舰还在）。
   * ⚠ **随档落盘**（`save.ts` 读档侧必须认它）：不然读档后结算会漏发或重掷。
   */
  flagshipBlackBox?: boolean
  /* ─── 旗舰 BOSS 化（2026-09-24 第二轮令；**只有 `WEEKEND_BOSS_FAMILIES` 里的族会写这三格**）─── */
  /** **池子总量**（首次接战后锁定；缺省 = 还没跟母舰交手过） */
  flagshipHpMax?: number
  /** **玩家已造成的伤害**（跨场累计；只算打进母舰的原始伤害） */
  flagshipHpDone?: number
  /** **章鱼人累计削掉的血量**（**2026-09-25 共享血条口径**：与玩家的 `flagshipHpDone` **加在同一条血**上；
   *  只累计"在线且非战斗"的时长 —— 战斗中/离线都暂停，速率 = `池子总量 ÷ 窗口`） */
  octopusHpDone?: number
  /** **已记进池子的伤害**（幂等用：同一场只记一次——引擎可能在同一场调两次结算） */
  flagshipDmgLogged?: number
  /** **上一场记账的战斗身份**（= `battle.startedAtGameMs`；同一场重复结算据此幂等） */
  flagshipRunId?: number
  /** **玩家单场对母舰的最高原始伤害**（池子总量的锚；0 = 还没打出过伤害） */
  flagshipBestRunDmg?: number
  /** **上一拍章鱼削血的心跳墙钟**（只用于算拍间增量；缺省 = 本拍只立基线、不累计） */
  bossTickWallMs?: number
  /* ─── 结束结算（2026-09-25 · M1-b 收尾）─── */
  /**
   * **贡献奖已发放的墙钟**（幂等标记；缺省 = 还没结过）。
   * ⚠ 占比按 **`endedAtWallMs`** 评估后发放（NPC 铺底是时间函数，晚算会把占比算低 ⇒ 少发）。
   */
  prizePaidAtWallMs?: number
  /**
   * **本场到手台账**（2026-09-25 加 · 结算面板与通讯正文都读它）：三处入账时累加 ——
   * 夺回奖励（逐星系）· 贡献奖 · 旗舰掉落。目的 = **"说的与发的逐值一致"**
   * （面板/通讯里的奖励清单不许另算一遍），且下一场开局会把进度台账清掉、只有这里留得住数。
   */
  rewardLedger?: {
    isk: number
    wreck: number
    blackBox: number
    /** 逐星系的夺回奖励（面板"各星系贡献"那一列用） */
    byGalaxy: Record<string, { isk: number; wreck: number }>
  }
  /**
   * **待到账的夺回奖励**（2026-09-25 船长令：「**夺回星区的奖励不要即时发放，放入结束后结算发放**」）：
   * 每夺回一处就往这里累加（含全清追加），活动结束时由 `weekendSettleAndGrant` 连贡献奖**一次性发**。
   * ⚠ 与 `rewardLedger` 的分工：台账 = **总数**（面板/通讯显示用，含已发与待发）；这一格 = **还没发的那部分**。
   */
  reclaimPending?: { isk: number; wreck: number }
  /**
   * **本场"主动出击"已出发的次数**（2026-09-25 船长令「主动出击也要每场重抽」）：
   * 抽签盐 = `WEEKEND_ASSAULT_SALT_BASE + 次数` ⇒ 每按一次出击换一支，且随档（读档后不重复同一支）。
   */
  assaultDraws?: number
  /**
   * **入侵「重复出击」的循环目标 = 被占星系 id**（2026-09-25 船长令：「入侵活动的悬赏，允许玩家开启
   * 自动重复，照常计算返回时间」）；缺省/空 = 没开。
   *
   * ⚠ 落在**周末活动对象**上（而不是新增顶层字段）有两个好处：① 与 `assaultDraws` 同款"可选字段"口径
   * ⇒ **不必动存档结构版本、老档零迁移风险**；② 活动结束/换周时整个 `weekendEvent` 被换掉 ⇒ 循环
   * **天然随之结束**（与"活动结束即停"的裁定同构）。
   */
  autoLoopGalaxyId?: string
}

/**
 * **上一场入侵的战果快照**（结束时写一次；**每场覆盖**）：
 * 结算面板与结算通讯都读它——因为下一场开局会把 `state.weekendEvent` 整条换成新的
 * （进度台账、旗舰池、出场星系全清），旧场的读数只有快照里还留着。
 */
export interface WeekendResultSnapshot {
  /** 场次编号（与通讯里的"第 N 场"同源） */
  seq: number
  family: string
  /** 核心星系 id（面板显示名字时现查） */
  coreId: string
  /** 结束墙钟 */
  endedAtWallMs: number
  /** 旗舰结局：玩家击沉 / 章鱼人摧毁 / 集结到点（窗口关闭或没现身） */
  flagshipOutcome: 'player' | 'octopus' | 'window'
  /** 贡献占比与档位（结束时那一刻的读数） */
  share: number
  tier: 'A' | 'B' | 'C' | 'D' | 'none'
  /** 逐处占领区：玩家投入 · 该处进度 · 是否夺回 · 该处拿到的夺回奖励 */
  galaxies: Array<{ galaxyId: string; put: number; progress: number; reclaimed: boolean; isk: number; wreck: number }>
  /**
   * 旗舰战输出（没跟母舰交手过 = 缺省）。
   * ⚠ `defeated` = **玩家击沉**（与黑匣同一判据，＝`flagshipDown === 'player'`），
   * **不是**"玩家那份伤害 ≥ 池子"——共享血条下血条由玩家 ＋ 章鱼人一起削（2026-09-25 船长报障修，见
   * `weekendBattle.weekendResultSnapshotOf`）。
   */
  flagship?: { hpMax: number; hpDone: number; defeated: boolean }
  /**
   * **进度收入**（2026-09-25 船长令「入侵舰队不应该有赏金……在结算时候直接按进度获取收入」）：
   * 玩家投入进度合计（0~1 的百分比读数，如 1.35 = 135%）与该笔收入（ISK）。
   * 缺省 = 老快照（本批之前结束的活动没有这一栏；界面按缺省不显示该行）。
   */
  progressPct?: number
  progressIsk?: number
  /** 到手合计（含旗舰掉落）与奖励物品 id（面板/通讯点物品名用） */
  isk: number
  wreck: number
  blackBox: number
  wreckItemId?: string
}

/**
 * **一拍最多按多少毫秒推进章鱼削血**（`WEEKEND_BOSS_TICK_MAX_MS` = 一拍的合理上限）。
 * 起因：在线心跳 ≈ 每帧/每秒一次，但**后台标签页、长卡顿、离线补算后的第一次心跳**可能一次跳几分钟～
 * 几十分钟。章鱼削血是"在线陪着打"的机制 ⇒ 一次长跳只按一拍算（多出来的时间视为"玩家没在看着"）。
 */
export const WEEKEND_BOSS_TICK_MAX_MS = 5_000

/**
 * 入侵族池（口径定稿：**A 变种 / C / G / 新族×2**）。
 * ⚠ **M1 只放"虫洞已有的族"**（A/C/G）——因为**敌卡暂用虫洞族卡**（船长 2026-09-23：
 * 「入侵战斗采用独立设计的卡（之后设计），我们暂时先试用虫洞的」）；两个新族随 M3（独立卡/新族）一起进池。
 *
 * ⚠ **2026-09-24 M2 逐族落地**：第一族 = **H 墨潮帮**（船长定名「The Ink Tide」）——
 * 它有**自家的独立入侵卡**（`ink-assault` / `ink-flagship`，见 `weekendFoeCardOf`），
 * 故**在此进池**；A/C/G 三族仍按 M1 口径用虫洞卡，等各自的旗舰卡设计好再逐族迁移。
 */
export const WEEKEND_FAMILIES: readonly string[] = ['A', 'C', 'G', 'H']

/* ─────────────── 敌卡：独立卡（H 族）· 虫洞池卡（A/C/G 占位）· 随机抽取 ─────────────── */

/**
 * **该族的入侵敌卡是否"自带定价"**（独立卡 ⇒ 威胁 = 卡面实测价，可被抽签换卡）。
 * H 族 = 真（四张独立卡已按定价式落到 90 / 108 / 129 与"待定的旗舰"）；
 * A/C/G 三族 = 假（仍用虫洞池卡 + 入侵覆写威胁 78/120，属 M1 占位口径，等各自旗舰卡设计好再迁）。
 */
export function weekendFoeCardsSelfPriced(family: string): boolean {
  return family === 'H'
}

/**
 * **H 族入侵敌卡池**（船长 2026-09-25：「**外围玩家主动出击和被动遇袭都是从骚扰和袭击舰队中抽取。
 * 核心区，则是抽取袭击和主力舰队。**」）——id 的唯一登记处是 `data/wormholeFoes.ts` 的
 * `WEEKEND_FOE_CARD_IDS`（core 不依赖 data，故此处按既有先例写字面量）。
 */
const H_FOE_POOL_PERIPHERY: readonly string[] = ['ink-harass', 'ink-raid']
const H_FOE_POOL_CORE: readonly string[] = ['ink-raid', 'ink-main']

/**
 * **某族某区域的入侵敌卡池**：
 * - H 族：外围 `{骚扰 90, 袭击 108}` · 核心 `{袭击 108, 主力 129}`（等概率）；
 * - A/C/G 三族：仍取该族虫洞池（外围 = 层 5 池 · 核心 = 层 9 池）——**池长 1 ⇒ 抽签退化为取那一张**（逐字不变）。
 */
export function weekendFoePoolOf(family: string, isCore: boolean): readonly string[] {
  if (family === 'H') return isCore ? H_FOE_POOL_CORE : H_FOE_POOL_PERIPHERY
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  return [wormholeCardPoolAt(fam, isCore ? 9 : 5)[0]!.id]
}

/**
 * **从池里抽一张**（纯函数 · 可复现）：`hash32(hash32(场次, 星系位序), 盐)`。
 *
 * 为什么这样就够：① 走**入侵自己的随机子流**（`hash32`）⇒ **不消费主随机序列**、老档读数一字不动；
 * ② 输入只含"场次 / 星系 / 盐"、不含调用顺序 ⇒ **同一场入侵内稳定**（悬赏板不会每次刷新都换卡）。
 * 池长 1（A/C/G 三族）⇒ 直接返回那一张。
 */
export function weekendDrawFoeCardId(
  family: string,
  isCore: boolean,
  seq: number,
  galaxyIdx: number,
  salt: number,
): string {
  const pool = weekendFoePoolOf(family, isCore)
  if (pool.length <= 1) return pool[0]!
  const r = hash32(hash32(seq, galaxyIdx), salt) / 4294967296
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!
}

/**
 * **该被占星系"驻留"的那支入侵舰队**（悬赏板 = 主动出击 = 这一支）：
 * 按 `(存档种子, 本场入侵编号 seq, 星系在占领区里的位序)` 抽定 ⇒ **一场之内稳定**、读档/换窗口不变。
 */
export function weekendGarrisonFoeCardId(
  state: Pick<GameState, 'rng'>,
  ev: WeekendEventState,
  galaxyId: string,
): string {
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  return weekendDrawFoeCardId(ev.family, galaxyId === ev.coreId, ev.seq, idx, 0)
}

/** 遇袭抽签结果：卡 + 强度倍率 + 玩家可见的威胁标签 */
export interface WeekendAmbushPick {
  cardId: string
  strengthMul: number
  /** 标签（H 族 = **缩放后实测价**反解；A/C/G = 主动威胁 × 倍率，与它们主动标签同一把尺） */
  threat: number
}

/**
 * **遇袭取卡**（船长 2026-09-25：遇袭**每场从池里重抽** ＋ 强度 ×`WEEKEND_AMBUSH_STRENGTH_MUL`）。
 *
 * - 抽签：与"驻留"同一套哈希，但**盐取时刻档**（粒度 = `balance.encounter.zoneCooldownMs`，
 *   与区域冷却同粒度）⇒ 同一星系连续两次遇袭会抽到不同编成；
 * - 标签：H 族按**缩放后的实测建档价**反解（`combat.foeThreatOfAnomaly`）——
 *   敌属性是绝对值，只有这样才能保证"标签 = 战力"；A/C/G 三族仍按 78/120 × 倍率的占位口径。
 */
export function weekendAmbushPickOf(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
  nowWallMs: number,
): WeekendAmbushPick | null {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  // ⚠ 等价于 `weekendBounty.weekendOccupiedLiveAt`（那边 import 本文件 ⇒ 这里不能反向引，避免循环）
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return null
  if (weekendProgressAt(state, ev, galaxyId, nowWallMs) >= 1) return null
  const isCore = galaxyId === ev.coreId
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  const bucketMs = Math.max(1, ctx.balance.encounter.zoneCooldownMs)
  const cardId = weekendDrawFoeCardId(ev.family, isCore, ev.seq, idx, Math.floor(nowWallMs / bucketMs) + 1)
  const mul = WEEKEND_AMBUSH_STRENGTH_MUL
  const card = ctx.anomalies.get(cardId)
  const threat =
    card && weekendFoeCardsSelfPriced(ev.family)
      ? foeThreatOfAnomaly(applyFoeOverride(card, { strengthMul: mul }), FOE_DESIGN_STRENGTH_MUL.solo, ctx.balance.battle)
      : Math.max(1, Math.round(weekendAssaultThreatOf(ev, galaxyId) * mul))
  return { cardId, strengthMul: mul, threat }
}

/**
 * **入侵旗舰战的敌卡**（**唯一换卡点**）：H 族 = 自家旗舰部队卡；A/C/G = 该族最深池卡。
 * ⚠ 旗舰卡**不参与抽签**（船长 2026-09-25：「**旗舰卡单独**」）。
 */
export function weekendFoeCardOf(family: string, kind: 'assault' | 'flagship'): string {
  if (family === 'H') return kind === 'flagship' ? 'ink-flagship' : H_FOE_POOL_PERIPHERY[0]!
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  const pool = wormholeCardPoolAt(fam, kind === 'flagship' ? 9 : 5)
  return pool[0]!.id
}

/* ─────────────── 小工具：独立随机子流（不碰主 RNG） ─────────────── */

function hash32(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** 由 (存档种子, 入侵编号) 派生一个确定性序列；**不动 `state.rng`** */
function streamOf(seed: number, seq: number): () => number {
  let s = hash32(seed, seq * 2654435761) || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ─────────────── 时间轴 ─────────────── */

/** 调试模式判定（与全仓同口径：`state.debugQuick`） */
export function weekendDebugOn(state: Pick<GameState, 'debugQuick'>): boolean {
  return state.debugQuick === true
}

/**
 * **入侵用的"现在"＝游戏自己的墙钟账**（2026-09-25 修船长报障「打开调试模式，快进后不会刷新入侵」）。
 *
 * 病根：入侵的三条时间线（**开局面 / NPC 铺底 / 旗舰倒计时**）原先一律读 `Date.now()`（真实墙钟），
 * 而"快进"推进的是**游戏自己的模拟墙钟** `state.savedAtWallMs`（`simulateOffline` 的 `wallBase + ms`）
 * ⇒ 两者不同源，快进对入侵完全无效（既不开新场，铺底也不动）。
 *
 * 口径：**取两者较大的那个** ——
 * - 正常在线：`savedAtWallMs` ≈ 上次落盘时刻 ≤ 现在 ⇒ 恒等于真实墙钟，**行为逐字不变**；
 * - 快进/离线段：模拟墙钟已经走到未来 ⇒ 入侵跟着走到未来（而不倒回去）。
 *
 * ⚠ 只给入侵用；其它系统各自的口径不动（赏金日板等仍按各自既有来源）。
 */
export function weekendClockOf(
  state: Pick<GameState, 'savedAtWallMs'>,
  realNowMs: number = Date.now(),
): number {
  const ledger = Number.isFinite(state.savedAtWallMs) ? state.savedAtWallMs : 0
  return Math.max(realNowMs, ledger > 0 ? ledger : 0)
}

/** NPC 时间轴的实际时长（调试模式 ÷60，Q6） */
export function weekendNpcTimelineMs(state: Pick<GameState, 'debugQuick'>, baseMs: number): number {
  return weekendDebugOn(state) ? Math.max(1, Math.round(baseMs / WEEKEND_DEBUG_TIME_DIVISOR)) : baseMs
}

/**
 * **倒计时的实际时长**（= `weekendFlagshipWindowMs`，保留旧名以免改散调用点；
 * 2026-09-25 起调试档 = 10 分钟、正常 = 2 小时）。
 * ⚠ 新代码请直接用 `weekendFlagshipWindowMs`（它才是"四处同源"的那个单点）。
 */
export function weekendDeadlineMs(state: Pick<GameState, 'debugQuick'>): number {
  return weekendFlagshipWindowMs(state)
}

/**
 * **章鱼人削血窗口**（= 母舰血池从满到被削空的"在线且非战斗"时长）——
 * 正常模式 = `WEEKEND_FLAGSHIP_DEADLINE_MS`（2 小时）；**调试模式 = 10 分钟**。
 *
 * ⚠ **2026-09-25 船长两次口径合一**：
 * 1. 船长原话（2026-09-24）：「**2小时内按时间削掉100%母舰血量。当玩家正在战斗时，会暂停削血。
 *    等玩家战斗结束才继续。**」⇒ 削血是**真实削减**（船长 2026-09-25 复述：「**章鱼人削减母舰血条是
 *    真实削减，玩家假设打完一场放一会，母舰血量是会真实减少。**」）⇒ **攒满窗口 = 血条见底 = 得手**，
 *    战斗中与离线都暂停；
 * 2. 船长 2026-09-25 对"窗口太短"的裁定：**保留"到点即判"这套机制、把调试窗口调长**（②）
 *    ⇒ 本函数把调试档从"÷60 = 2 分钟"改成固定的 **10 分钟**（原 2 分钟连点进准备界面都来不及）。
 *
 * ⚠ 四处必须同源（改窗口即同时改这四处的口径）：`weekendFlagshipView` 的倒计时、
 * `weekendOctopusDrainPerMs` 的削血速率、`weekendBossPoolView` 的章鱼进度、`weekendOctopusTick` 的收口。
 */
export const WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS = 10 * 60_000

/** 本档的削血窗口（调试 = 10 分钟；正常 = 2 小时）——四处同源的单点 */
export function weekendFlagshipWindowMs(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS : WEEKEND_FLAGSHIP_DEADLINE_MS
}

/** 某一时刻所在"周"的 T0（正常模式：该时刻之前最近的周五 20:00 本地墙钟） */
export function weekendT0Of(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  const day = d.getDay()
  let back = (day - WEEKEND_START_WEEKDAY + 7) % 7
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WEEKEND_START_HOUR, 0, 0, 0).getTime()
  if (back === 0 && nowWallMs < at) back = 7 // 本周五 20:00 还没到 ⇒ 用上一周
  return at - back * 86_400_000
}

/** 窗口是否还开着（T0 ~ T0+74h） */
export function weekendWindowOpen(nowWallMs: number, t0: number): boolean {
  return nowWallMs >= t0 && nowWallMs < t0 + WEEKEND_WINDOW_MS
}

/* ─────────────── 占领：核心选取 ＋ 外围 ─────────────── */

/** 核心候选：已探索 · **中安/低安**（非高安）· **无已建副站** */
export function weekendCoreCandidates(state: GameState, ctx: SimContext): string[] {
  const out: string[] = []
  for (const id of state.exploredGalaxies ?? []) {
    if (securityZoneOf(ctx, id) === '高安') continue
    if (weekendHasBuiltStation(state, ctx, id)) continue
    out.push(id)
  }
  return out.sort() // 排序 ⇒ 与探索顺序无关，选取可复现
}

/** 该星系是否已有**建成**的副站（在建/未开工不算 ⇒ 与 `builtStationCount` 同口径） */
function weekendHasBuiltStation(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  for (const site of ctx.stations.values()) {
    const anySite = site as unknown as { galaxyId?: string; tiers?: readonly unknown[] }
    if (anySite.galaxyId !== galaxyId) continue
    const p = state.stationSites?.[site.id]
    if (p && anySite.tiers && p.stage >= anySite.tiers.length) return true
  }
  return false
}

/** 核心的全部邻居（不封顶；**含高安**） */
export function weekendPeripheryOf(ctx: SimContext, coreId: string): string[] {
  const out = new Set<string>()
  for (const e of ctx.galaxyEdges) {
    if (e.from === coreId) out.add(e.to)
    else if (e.to === coreId) out.add(e.from)
  }
  out.delete(coreId)
  return [...out].sort()
}

/** 按 (种子, 编号) 抽核心与族（纯函数，可复现） */
export function weekendRollOccupation(
  state: GameState,
  ctx: SimContext,
  seq: number,
): { coreId: string; peripheryIds: string[]; family: string } | null {
  const candidates = weekendCoreCandidates(state, ctx)
  if (candidates.length === 0) return null
  const rng = streamOf(state.rng.seed, seq)
  const coreId = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]!
  /**
   * 族：**照旧消费一次随机数**（保持子流形状不变），但若 `WEEKEND_LOCKED_FAMILY` 有值就判成它
   * —— 船长 2026-09-25「目前只做了H族，所以先锁定H族」；M2/M3 补齐三族后把该常量置回 `null` 即恢复随机。
   */
  const familyRoll = rng()
  const family =
    WEEKEND_LOCKED_FAMILY ??
    WEEKEND_FAMILIES[Math.min(WEEKEND_FAMILIES.length - 1, Math.floor(familyRoll * WEEKEND_FAMILIES.length))]!
  return { coreId, peripheryIds: weekendPeripheryOf(ctx, coreId), family }
}

/* ─────────────── 进度（纯函数：给 now 就出结果） ─────────────── */

/** 该星系是不是本次入侵的占领区（核心或外围） */
export function weekendOccupiedIds(ev: WeekendEventState | undefined): string[] {
  if (!ev) return []
  return [ev.coreId, ...ev.peripheryIds]
}

/**
 * **外围进度** = NPC 铺底（`t/48h`，调试 ÷60）＋ 玩家投入（台账），相加封顶 1。
 * `t` 自 T0 起算。
 */
export function weekendPeripheryProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  // ⚠ 铺底先钳 ≥0：T0 之前（或调试口径下时间未到）不许出现"负铺底"把玩家投入一起拉回 0
  const npc = Math.max(0, (nowWallMs - ev.startedAtWallMs) / weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS))
  const put = ev.contributed[galaxyId] ?? 0
  return clamp01(npc + put)
}

/** 外围是否全部夺回（核心门禁的判据） */
export function weekendPeripheryClearedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): boolean {
  return ev.peripheryIds.every((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) >= 1)
}

/**
 * **核心进度** = NPC 铺底（自 T0+48h 起 `(t−48h)/24h`）＋ 玩家投入，封顶 1；
 * **门禁**（第 7 条）：外围未全部夺回 ⇒ 核心条不涨（返回**玩家投入那部分的下限**，即 0 与投入的较小者）。
 */
export function weekendCoreProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const put = ev.contributed[ev.coreId] ?? 0
  if (!weekendPeripheryClearedAt(state, ev, nowWallMs)) return clamp01(Math.min(put, 0))
  const npcStart = ev.startedAtWallMs + weekendNpcTimelineMs(state, WEEKEND_NPC_PERIPHERY_MS)
  const npc = Math.max(0, (nowWallMs - npcStart) / weekendNpcTimelineMs(state, WEEKEND_NPC_CORE_MS))
  return clamp01(npc + put)
}

/** 任一占领区进度（外围 / 核心自动分流） */
export function weekendProgressAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  if (galaxyId === ev.coreId) return weekendCoreProgressAt(state, ev, nowWallMs)
  if (!ev.peripheryIds.includes(galaxyId)) return 0
  return weekendPeripheryProgressAt(state, ev, galaxyId, nowWallMs)
}

/**
 * **核心进度读数**（给界面：进度值 ＋ 是否正被门禁卡住 ＋ 还差几个外围）。
 *
 * 2026-09-26 船长令：「入侵活动中，被入侵的星系的星系详细内，在'击退入侵舰队'卡片处显示该星系的
 * **收复进度**。当核心星系无法收复时，在对应的击退入侵舰队卡片**提示玩家**」＋ 提示文案
 * 「**至少需要夺回一个外围星系**」。
 *
 * 为什么做成一个函数而不是让界面自己拼：**门禁的真相源只有一个**
 * （`weekendCoreProgressAt` 里那句 `weekendPeripheryClearedAt`）——界面若自己判断"外围清完没"，
 * 两处一旦漂移就会出现"条在涨却写着打不动"这种自相矛盾的读数。
 * `missing` 供界面把提示写准：一个都没夺回时说"至少需要夺回一个"，已夺回几个时说"还需夺回 N 个"。
 */
export function weekendCoreGateView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): { progress: number; gated: boolean; missing: number; total: number } {
  const total = ev.peripheryIds.length
  const missing = ev.peripheryIds.filter((id) => weekendPeripheryProgressAt(state, ev, id, nowWallMs) < 1).length
  return {
    progress: weekendCoreProgressAt(state, ev, nowWallMs),
    gated: !weekendPeripheryClearedAt(state, ev, nowWallMs),
    missing,
    total,
  }
}

/** 已夺回（进度满）的星系 */
export function weekendReclaimedAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): string[] {
  return weekendOccupiedIds(ev).filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
}

/* ─────────────── 遇袭（高频 · 中安高安破例 · 失败只受损） ─────────────── */

/** 遇袭概率：`60% × (1 − 进度)`，封顶 0.9（夺回后 = 0） */
export function weekendEncounterChanceAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  galaxyId: string,
  nowWallMs: number,
): number {
  const p = weekendProgressAt(state, ev, galaxyId, nowWallMs)
  if (p >= 1) return 0
  return Math.min(WEEKEND_ENCOUNTER_CAP, WEEKEND_ENCOUNTER_P * (1 - p))
}

/** 主动出击的威胁（被占星系的悬赏替换卡；外围 78 / 核心 120）——**A/C/G 三族的占位口径**，H 族用卡面威胁 */
export function weekendAssaultThreatOf(ev: WeekendEventState, galaxyId: string): number {
  return galaxyId === ev.coreId ? WEEKEND_CORE_THREAT : WEEKEND_PERIPHERY_THREAT
}

/* ─────────────── 旗舰与倒计时 ─────────────── */

export interface WeekendFlagshipView {
  /** 是否已现身（核心条满） */
  shown: boolean
  /** 现身时刻 */
  atWallMs?: number
  /** 击毁时限（含离线保护后的实际起算点） */
  deadlineWallMs?: number
  /** 结局：player = 玩家击毁 · octopus = 章鱼人摧毁 */
  down?: 'player' | 'octopus'
}

/**
 * **旗舰视图（含离线保护）**（第 8/10 条 ＋ Q3/Q7）：
 *
 * - **核心条满 ⇒ 现身**；
 * - **得手判据 = 共享血条被削空**（**真实削减**：船长 2026-09-24「2小时内按时间削掉100%母舰血量。
 *   当玩家正在战斗时，会暂停削血」＋ 2026-09-25「章鱼人削减母舰血条是真实削减，玩家假设打完一场放一会，
 *   母舰血量是会真实减少」）⇒ `血条 = 池子总量 −（玩家已造成 ＋ 章鱼已削）`，与 `weekendTickBoss`
 *   的削血进度**同一把尺**，不再是"墙钟到点"；
 * - **离线保护**（Q3）：离线 **满 24h** 即视为保护失效 ⇒ 自那一刻起算，窗口到点即视为已被摧毁
 *   （离线期间削血是暂停的，这条是"人不在就别无限期挂着"的那道闸）；
 * - 调试模式**关掉离线保护**（Q7）且窗口 = **10 分钟**（船长 2026-09-25：「保留到点即判，把调试窗口调长」）。
 */
export function weekendFlagshipView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendFlagshipView {
  if (ev.flagshipDown) return { shown: true, atWallMs: ev.flagshipAtWallMs, down: ev.flagshipDown }
  const full = weekendCoreProgressAt(state, ev, nowWallMs) >= 1
  if (!full) return { shown: false }
  const windowMs = weekendFlagshipWindowMs(state)
  /**
   * **共享血条**（2026-09-25 口径）：`已掉 = 玩家已造成 ＋ 章鱼已削`。
   * 见底 ⇒ 母舰已被摧毁（玩家打完 ⇒ 玩家击沉；章鱼削空 ⇒ 章鱼人得手，仇敌归属由各自那条路径写）。
   */
  const hpMax = ev.flagshipHpMax ?? 0
  const hpLeft =
    hpMax > 0 ? Math.max(0, hpMax - Math.max(0, ev.flagshipHpDone ?? 0) - weekendOctopusDone(ev)) : 0
  /** **血条见底** ⇒ 得手（与 `weekendTickBoss` 同一判据） */
  const drainDone = weekendFlagshipDefeated(ev)
  const offline = Math.max(0, nowWallMs - lastSeenWallMs)
  /**
   * **倒计时起算点 anchor**——**只在"首次满分且玩家在线"那一拍落盘**（`flagshipAtWallMs`），落盘后不再变：
   * - 已落盘 ⇒ 直接用它；
   * - 未落盘 ＋ 调试模式 ⇒ 此刻（**Q7：关掉离线保护**）；
   * - 未落盘 ＋ 离线 ≤60 秒（视为在线，tick 会落盘）⇒ 此刻；
   * - 未落盘 ＋ 离线 ≤24h（**离线保护**，第 10 条）⇒ **上线第一拍**起算；
   * - 未落盘 ＋ 离线 >24h（**Q3**）⇒ **自"离线满 24h"那一刻**起算 ⇒ 上线时若已过期，旗舰已被章鱼人摧毁。
   */
  let anchor = ev.flagshipAtWallMs
  if (anchor === undefined) {
    if (weekendDebugOn(state) || offline <= 60_000 || offline <= WEEKEND_OFFLINE_SHIELD_MS) anchor = nowWallMs
    else anchor = lastSeenWallMs + WEEKEND_OFFLINE_SHIELD_MS
  }
  /** 离线 **超过** 24h 保护期：窗口按 anchor 起算（人不在的那段不削血，但也不能无限期挂着） */
  const offlineLapsed = offline > WEEKEND_OFFLINE_SHIELD_MS
  const down = drainDone || (offlineLapsed && nowWallMs >= anchor + windowMs) ? ('octopus' as const) : undefined
  /**
   * **倒计时（展示口径）**：
   * - 在线 ⇒ 从**此刻**起算、按"还差多少在线非战斗时间才能把**剩下的血**削空"算
   *   （`剩余 × 窗口 ÷ 池子总量`）——削血是真实削减，所以玩家打掉的越多、剩下的越快被削空；
   * - 离线保护失效那一档 ⇒ 按 anchor 快照展示（Q3 的"自离线满 24h 起算"）；
   * - ⚠ **池子未锁定**（还没跟母舰交手过）⇒ 章鱼人没有可削的目标（与 `weekendTickBoss` 同口径），
   *   读数就是"从现在起整整一个窗口"。
   */
  const deadlineWallMs = offlineLapsed
    ? anchor + windowMs
    : hpMax > 0
      ? nowWallMs + Math.round((hpLeft * windowMs) / hpMax)
      : nowWallMs + windowMs
  return { shown: true, atWallMs: anchor, deadlineWallMs, ...(down !== undefined ? { down } : {}) }
}

/* ─────────────── 贡献台账与结算 ─────────────── */

/** 记一笔玩家推进（主动胜利 / 击退遇袭 / 离线击退） */
export function weekendNoteContribution(ev: WeekendEventState, galaxyId: string, gain: number): void {
  ev.contributed[galaxyId] = clamp01((ev.contributed[galaxyId] ?? 0) + gain)
}

/** 玩家累计投入的进度合计（贡献占比的分子） */
export function weekendPlayerContribution(ev: WeekendEventState): number {
  return Object.values(ev.contributed).reduce((a, b) => a + b, 0)
}

/**
 * **进度收入的单价**（ISK / 每 1% 进度）——
 * 船长 2026-09-25 令：「**入侵舰队不应该有赏金**……因为击败入侵舰队就能获取进度，
 * **在结算时候直接按进度获取收入**」，三选一裁定**③「每 1% 固定 20 万 ISK（与星系无关）」**。
 *
 * 于是入侵战斗**当场一分钱都不给**（悬赏那一栏整条退役），收入在**活动结束时**随夺回奖励与
 * 贡献四档奖一次发（`weekendSettleAndGrant`）：
 * - 换算到每一场（正常口径）：外围胜利 +10% = **200 万** · 核心胜利 +5% = **100 万** ·
 *   主动击退遇袭 +3% = **60 万** · 离线自动击退 +1% = **20 万**；打满一处（100%）= **2,000 万**；
 * - **只结玩家自己打出来的进度**（`ev.contributed` 台账；NPC 铺底那部分不算收入——
 *   否则挂机也在赚钱）；
 * - 进度本身按星系封顶 100%（`weekendNoteContribution` 已 clamp）⇒ 单星系收入上限 = 2,000 万。
 */
export const WEEKEND_PROGRESS_ISK_PER_PCT = 200_000

/** 本场活动的进度收入合计（ISK） = 玩家投入进度（1 = 100%）× 100 × 单价 */
export function weekendProgressIncomeIsk(ev: WeekendEventState): number {
  return Math.round(weekendPlayerContribution(ev) * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)
}

/**
 * **贡献占比** = 玩家累计投入 ÷（玩家投入 ＋ NPC 铺底总量）。
 * NPC 铺底总量按"结算时刻各占领区的铺底之和"计 ⇒ 抢得越多、占比越高（第 11 条）。
 */
export function weekendContributionShareAt(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  nowWallMs: number,
): number {
  const ids = weekendOccupiedIds(ev)
  const npc = ids.reduce((sum, id) => {
    const p = weekendProgressAt(state, ev, id, nowWallMs)
    const put = ev.contributed[id] ?? 0
    return sum + Math.max(0, p - put)
  }, 0)
  const mine = weekendPlayerContribution(ev)
  const total = npc + mine
  return total <= 0 ? 0 : clamp01(mine / total)
}

/** 贡献奖档位（Q5 四档） */
export function weekendContributionTier(share: number): { tier: 'A' | 'B' | 'C' | 'D' | 'none'; wreck: number; isk: number } {
  if (share >= 0.8) return { tier: 'A', wreck: 12, isk: 8_000_000 }
  if (share >= 0.5) return { tier: 'B', wreck: 8, isk: 5_000_000 }
  if (share >= 0.2) return { tier: 'C', wreck: 4, isk: 2_000_000 }
  if (share > 0) return { tier: 'D', wreck: 1, isk: 0 }
  return { tier: 'none', wreck: 0, isk: 0 }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ─────────────── 开局 / 结束（幂等；下一步接引擎 tick 与派生卡） ─────────────── */

/**
 * **确保当前时刻有一场该有的入侵**（幂等）：
 * - 正常模式：窗口（周五 20:00 ~ +74h）内若 `startedAtWallMs` 不是本周 T0 ⇒ 开新一场（编号 +1）；
 * - 调试模式：上一场结束 + 1h 后刷新（无历史 ⇒ 首次调用即开）；
 * - 返回是否发生了变化（供调用方决定是否落盘/记日志）。
 */
export function ensureWeekendEvent(state: GameState, ctx: SimContext, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  /**
   * **首场一次性 T0**（**船长 2026-09-25 令**：「**现在可以解除限制，并在一会 22 点开始第一次入侵
   * 活动。**」＋ 二答「**只今晚这一次 22:00**」）——`WEEKEND_FIRST_T0_WALL_MS` 只在这一晚生效：
   * 到点、且"手上还没有从这一刻起开过的场"⇒ 按它开首场；此后一律回落到**每周五 20:00** 的周排期。
   *
   * 位置刻意放在**调试分支之前**：船长要的是"22 点开始第一次入侵"，与他客户端是否还开着调试模式无关
   * （开着调试也只是这一场按调试节奏跑；下一场起调试模式照旧走"结束后 1 小时刷新"）。
   */
  const firstT0 = WEEKEND_FIRST_T0_WALL_MS
  if (
    firstT0 !== null &&
    nowWallMs >= firstT0 - 2 * 3_600_000 && // 从首场那天的周排期 T0（20:00）起进入"首场时段"
    nowWallMs < firstT0 + WEEKEND_WINDOW_MS
  ) {
    /**
     * ① **首场时刻之前**：这一场留给 22:00 ⇒ **周排期让位**（20:00~22:00 这段不开局，
     * 否则会在 20:00 先开一场、22:00 又被首场覆盖一次）。
     * ⚠ 调试档不放让位（船长令「调试模式不受限」的同一精神）：调试玩家这段照旧能开局。
     */
    if (nowWallMs < firstT0 && !weekendDebugOn(state)) return false
    /** ② **到点 ＋ 手上还没有"从这一刻起"开过的场** ⇒ 开首场（T0 = 22:00，不是周排期的 20:00） */
    if (nowWallMs >= firstT0 && (ev === undefined || ev.startedAtWallMs < firstT0) && weekendInvasionAllowedFor(state)) {
      const seq = (ev?.seq ?? 0) + 1
      const rolled = weekendRollOccupation(state, ctx, seq)
      if (rolled) {
        state.weekendEvent = { seq, startedAtWallMs: firstT0, ...rolled, contributed: {} }
        return true
      }
    }
    // ③ 到点但已经开过（或抽不出核心）⇒ 落回下面的正常 / 调试路径
  }
  // 船长 2026-09-23 起"仅调试模式可见"的闸；**2026-09-25 船长解除**（见 `WEEKEND_DEBUG_ONLY`）
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return false
  if (weekendDebugOn(state)) {
    /**
     * **锁定族的自愈**（2026-09-25 船长令「先锁定 H 族」）：手上那一场若是**锁定前开的历史场**
     * （例如抽到 A/C/G 的旧场），就地**改判族**——进度台账、场次号、旗舰池全留着，只换族
     * （板面卡与旗舰卡随之换成 H 族那一套）。⚠ 只在调试模式做：正常模式的老场不追改。
     */
    if (
      ev !== undefined &&
      ev.endedAtWallMs === undefined &&
      WEEKEND_LOCKED_FAMILY !== null &&
      ev.family !== WEEKEND_LOCKED_FAMILY
    ) {
      ev.family = WEEKEND_LOCKED_FAMILY
    }
    if (ev && ev.endedAtWallMs === undefined) return false
    if (ev && nowWallMs - ev.endedAtWallMs! < WEEKEND_DEBUG_RESTART_MS) return false
    const seq = (ev?.seq ?? 0) + 1
    const rolled = weekendRollOccupation(state, ctx, seq)
    if (!rolled) return false
    state.weekendEvent = { seq, startedAtWallMs: nowWallMs, ...rolled, contributed: {} }
    return true
  }
  const t0 = weekendT0Of(nowWallMs)
  if (!weekendWindowOpen(nowWallMs, t0)) return false // 窗口外：入侵不存在
  /**
   * **声望前提**（**船长 2026-09-25 令**：「给入侵触发加一个前提，需要拥有至少40声望，才会触发入侵。」
   * ＋ 四答：只在开新场那一刻判 · 不足静默不开 · 调试模式不受限）。
   * 位置刻意留在**调试分支之后**：调试模式走上面那条路、压根到不了这里。
   */
  if (!weekendInvasionAllowedFor(state)) return false
  /**
   * **一个窗口只开一场**（**2026-09-25 修**）：原判据 `ev.startedAtWallMs === t0 && ev.endedAtWallMs === undefined`
   * 要求"未结束" ⇒ 旗舰被击沉、窗口还没到点时，**下一拍就会立刻又开一场**（与定稿「每周末一次」
   * ＋「只有调试模式才是结束后 1 小时刷新」两处都冲突）。
   * 现按**窗口**判：上一场开始至今不足一个窗口（74h）⇒ 不再开新场 —— 这同时兜住"首场 T0 = 22:00"
   * 那一次偏移（首场结束后的下一拍不会再按周排期的 20:00 补开一场）。
   */
  if (ev && nowWallMs - ev.startedAtWallMs < WEEKEND_WINDOW_MS) return false
  const seq = (ev?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq)
  if (!rolled) return false
  state.weekendEvent = { seq, startedAtWallMs: t0, ...rolled, contributed: {} }
  return true
}

/** 结束本场（旗舰被摧毁 / 章鱼人摧毁 / T0+74h）：清占领、留编号与台账（结算由调用方做） */
export function endWeekendEvent(state: GameState, nowWallMs: number): WeekendEventState | undefined {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return ev
  ev.endedAtWallMs = nowWallMs
  return ev
}

/* ─────────────── 引擎 tick（M1-b：只做必须落盘的事） ─────────────── */

/** tick 结果：引擎据它记日志/弹卡/掷遇袭骰 */
export interface WeekendTickResult {
  /** 本次 tick 是否新开了一场 */
  started: boolean
  /** 旗舰是否已现身 */
  flagshipShown: boolean
  /**
   * **本拍正是"旗舰现身"的那一拍**（2026-09-25 加 · 修船长报障「事件日志会一直刷『入侵核心已被打通：旗舰现身。』」）：
   * `flagshipShown` 只要现身就恒真（每拍都真）⇒ 引擎照着它记日志会**每拍刷一条**；
   * 这一格只在**首次把 `flagshipAtWallMs` 落盘**的那一拍为真 ⇒ 记日志 / 弹一次窗都按它来。
   */
  flagshipAnchored: boolean
  /** 旗舰结局（本 tick 新发生） */
  flagshipDown?: 'player' | 'octopus'
  /** 本 tick 是否结束（旗舰被摧毁 / 章鱼人得手 / 窗口到点） */
  ended: boolean
  /** 该掷遇袭骰的星系（未夺回）与各自概率 —— **掷骰在引擎**（随机源在那边） */
  encounterRolls: Array<{ galaxyId: string; chance: number }>
}

/**
 * **引擎每拍调用一次**（M1-b）：
 * 1. `ensureWeekendEvent` 开局面（正常模式：周五 20:00 的周排期 ＋ 声望前提；调试档：结束 +1h；
 * 2. 旗舰 anchor **落盘**（首次满分且在线那一拍 ⇒ 倒计时从此稳定，不再随 tick 漂移）；
 * 3. 章鱼人得手（`view.down === octopus`）⇒ 写 `flagshipDown` 并结束本场；
 * 4. 正常模式的窗口到点（T0+74h）⇒ 结束本场；
 * 5. 交出"该掷遇袭骰的星系与概率"（**不在本函数里掷**：随机源归引擎）。
 *
 * ⚠ 纯函数（除改 `state.weekendEvent` 的落盘字段外不碰别处）⇒ 用例可对任意时刻断言。
 */
export function weekendTick(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number,
  lastSeenWallMs: number,
): WeekendTickResult {
  const started = ensureWeekendEvent(state, ctx, nowWallMs)
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { started, flagshipShown: false, flagshipAnchored: false, ended: false, encounterRolls: [] }
  }

  // ② 旗舰 anchor 落盘（只在"未落盘 + 未过期"时写）
  const view = weekendFlagshipView(state, ev, nowWallMs, lastSeenWallMs)
  let flagshipAnchored = false
  if (view.shown && ev.flagshipAtWallMs === undefined && view.down === undefined) {
    ev.flagshipAtWallMs = view.atWallMs ?? nowWallMs
    flagshipAnchored = true
  }

  // ③ 章鱼人得手 ⇒ 结束本场（贡献奖照给——结算由调用方做）
  let ended = false
  let flagshipDown: WeekendTickResult['flagshipDown']
  if (view.down === 'octopus' && ev.flagshipDown === undefined) {
    ev.flagshipDown = 'octopus'
    /**
     * **黑匣掷骰（"没抢到最后一下"那一档）**（船长 2026-09-25 令 ＋ 四答之二"照发"）：
     * 章鱼人把血条削空也算"旗舰被摧毁"，玩家按**输出占比**领 `25% × p` 的爆率——
     * 掷中照发黑匣（旧文案「黑匣归零」按结果分成两条，见 `ui.weekend.003` / `102`）。
     * ⚠ 窗口到点（旗舰**撤走**、没被摧毁）不掷：没有残骸可捞。
     */
    weekendRollBlackBox(state, ev, false)
    flagshipDown = 'octopus'
    endWeekendEvent(state, nowWallMs)
    ended = true
  }

  // ④ 正常模式窗口到点（调试模式不定长，不按窗口收）
  if (!ended && !weekendDebugOn(state) && nowWallMs >= ev.startedAtWallMs + WEEKEND_WINDOW_MS) {
    endWeekendEvent(state, nowWallMs)
    ended = true
  }

  // ⑤ 交出遇袭候选（未夺回的占领区）
  const encounterRolls = weekendOccupiedIds(ev)
    .map((id) => ({ galaxyId: id, chance: weekendEncounterChanceAt(state, ev, id, nowWallMs) }))
    .filter((x) => x.chance > 0)

  return { started, flagshipShown: view.shown, flagshipAnchored, ...(flagshipDown !== undefined ? { flagshipDown } : {}), ended, encounterRolls }
}

/** 主动打赢一场：外围 +10% · 核心 +5%（第 6 条；核心同样受门禁约束，门禁在读数侧生效） */
export function weekendNotePlayerWin(state: GameState, galaxyId: string): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  const gain = galaxyId === ev.coreId ? WEEKEND_GAIN_CORE_WIN : WEEKEND_GAIN_PERIPHERY_WIN
  if (galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)) weekendNoteContribution(ev, galaxyId, gain)
}

/** 击退一次遇袭：+3%（离线自动结算的 +1% 由调用方传 `offline = true`） */
export function weekendNoteRepel(state: GameState, galaxyId: string, offline = false): void {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return
  if (galaxyId !== ev.coreId && !ev.peripheryIds.includes(galaxyId)) return
  weekendNoteContribution(ev, galaxyId, offline ? WEEKEND_GAIN_OFFLINE_REPEL : WEEKEND_GAIN_REPEL)
}

/** 玩家击毁旗舰：记结局并结束本场（黑匣与贡献奖由调用方结算） */
export function weekendNoteFlagshipKilled(state: GameState, nowWallMs: number): boolean {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return false
  if (weekendCoreProgressAt(state, ev, nowWallMs) < 1) return false
  ev.flagshipDown = 'player'
  endWeekendEvent(state, nowWallMs)
  return true
}

/* ─────────────── 旗舰 BOSS 池（跨场累计伤害 · 2026-09-24 第二轮令） ─────────────── */

/** 本场入侵的族是否走 **BOSS 池子口径**（只有 `WEEKEND_BOSS_FAMILIES` 里的族） */
export function weekendIsBossFamily(ev: WeekendEventState | undefined): boolean {
  return ev !== undefined && WEEKEND_BOSS_FAMILIES.includes(ev.family)
}

/**
 * **章鱼人每毫秒削掉池子的比例** = 100% ÷ 削血窗口（船长：「2小时内按时间削掉100%母舰血量」）。
 * 线性同比：`章鱼已削 = 削血时长 / 窗口 × 池子总量`（削血时长只计"在线且非战斗"）。
 * ⚠ 窗口走 `weekendFlagshipWindowMs`（正常 2h / 调试 10min）——与倒计时、池子读数、收口四处同源。
 */
export function weekendOctopusDrainPerMs(state: Pick<GameState, 'debugQuick'>, hpTotal: number): number {
  return hpTotal / weekendFlagshipWindowMs(state)
}

/** **池子总量**（缺省 = 还没跟母舰交手过 ⇒ `undefined`；`floorHp` = 由卡面折算的下限） */
export function weekendFlagshipPoolTotal(ev: WeekendEventState | undefined): number | undefined {
  if (!ev || !weekendIsBossFamily(ev)) return undefined
  return ev.flagshipHpMax
}

/** **BOSS 池读数**（供界面血条：剩余 / 总量 / 玩家进度 / 章鱼进度；非 BOSS 族 ⇒ `null`）。
 *  ⚠ **2026-09-25 共享血条**：`hpLeft = 总量 −（玩家 ＋ 章鱼）`（两者都真实减少同一条血）；
 *  `playerFrac` / `octopusFrac` = 各自占**血条总量**的份额（`octopusFrac` 只留给内部读数，
 *  界面上**不再单独显示**——船长：「不需要显示章鱼人削减进度和倒计时」）。 */
export interface WeekendBossPoolView {
  hpMax: number
  /** 玩家已造成（跨场累计） */
  hpDone: number
  /** **血条剩余** = `总量 −（玩家已造成 ＋ 章鱼已削）` */
  hpLeft: number
  /** 章鱼人已削掉的量（折成血量；与玩家那份相加即已掉的血） */
  octopusDone: number
  /** 玩家进度（0~1：`hpDone / hpMax`） */
  playerFrac: number
  /** 章鱼进度（0~1：`章鱼已削 / hpMax`）——**仅内部读数，界面不显示** */
  octopusFrac: number
  /** 还需要打掉多少（= 剩余血条；0 = 差最后一击） */
  needDmg: number
}

/**
 * **BOSS 池读数**（`undefined` = 尚未接战 ⇒ 界面显示"待接战"；`null` 之外不可能）。
 * ⚠ 章鱼那一份**走同一条血条**（共享）：它削掉多少，血条就少多少——玩家接着打的是剩下的那截。
 */
export function weekendBossPoolView(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState | undefined,
): WeekendBossPoolView | null {
  if (!ev || !weekendIsBossFamily(ev)) return null
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return null
  const hpDone = Math.max(0, ev.flagshipHpDone ?? 0)
  // ⚠ 章鱼那一份折成血量走 `weekendOctopusDone`（窗口常量口径，与 `state.debugQuick` 无关）
  const octopusDone = weekendOctopusDone(ev)
  void state
  return {
    hpMax,
    hpDone,
    // **共享血条**：玩家那份与章鱼那份都真实减少它
    hpLeft: Math.max(0, hpMax - hpDone - octopusDone),
    octopusDone,
    playerFrac: Math.min(1, hpDone / hpMax),
    octopusFrac: Math.min(1, octopusDone / hpMax),
    needDmg: Math.max(0, hpMax - hpDone - octopusDone),
  }
}

/**
 * **记一场对母舰的伤害**（船长：「按对母舰造成的伤害决定，如果母舰没有受伤就是0输出」）。
 *
 * @param rawDmg 该场**打进母舰的原始伤害**（未截断；`0` = 该场没打到它）
 * @returns 本次是否**把池子打空**（= 旗舰被玩家击沉）
 *
 * ⚠ **2026-09-25 改口径**：池子 = **固定常量** `WEEKEND_FLAGSHIP_POOL_HP`（150,000），
 * 首次接战即立起（原先按"5 × 首战最高伤害"与"母舰卡面血 ×5"自适应，母舰 ×10 后已脱节）。
 * `flagshipBestRunDmg` 仍记（**只作读数/展示**，不再参与池子计算）。
 */
export function weekendNoteFlagshipDamage(
  ev: WeekendEventState,
  rawDmg: number,
  /**
   * **这一场的身份**（缺省 = 沿用上一场）：引擎传 `battle.startedAtGameMs`（同一场战斗恒同值）。
   * 用途 = **幂等**：同一场可能被结算两次（战斗收尾 + 遇袭收尾）⇒ 只在"换了新的一场"时才累计，
   * 同场重复调用一律忽略（否则同一场的伤害会被记两遍）。
   */
  runId?: number,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  const dmg = Math.max(0, Math.round(rawDmg))
  const sameRun = runId !== undefined && ev.flagshipRunId === runId
  if (sameRun) return weekendFlagshipDefeated(ev) // 同一场的重复结算 ⇒ 已记过，不再叠加
  if (runId !== undefined) ev.flagshipRunId = runId
  if (ev.flagshipHpMax === undefined) ev.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
  if (dmg > 0) {
    ev.flagshipBestRunDmg = Math.max(ev.flagshipBestRunDmg ?? 0, dmg)
    ev.flagshipHpDone = Math.max(0, (ev.flagshipHpDone ?? 0) + dmg)
  }
  return weekendFlagshipDefeated(ev)
}

/**
 * **玩家是否已把母舰血条打空**（= 击沉）。
 *
 * ⚠ **2026-09-25 共享血条口径**：血条 = `池子总量 −（玩家已造成 ＋ 章鱼人已削）` ⇒
 * **玩家的这一击把血条打空**（哪怕前面已被章鱼削掉一半）就算**玩家击沉**（黑匣归玩家）。
 * 池子未锁定时（还没接战）恒 `false`。
 */
export function weekendFlagshipDefeated(ev: WeekendEventState | undefined): boolean {
  if (!ev || !weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  const hpMax = ev.flagshipHpMax ?? 0
  if (hpMax <= 0) return false
  return Math.max(0, ev.flagshipHpDone ?? 0) + weekendOctopusDone(ev) >= hpMax
}

/**
 * **章鱼人推进一拍**（只累计"在线且非战斗"的时长；船长：「玩家正在战斗时，会暂停削血」＋
 * 离线「挂起：离线时章鱼也停」）。
 *
 * @param dtMs 本拍墙钟增量（调用方按 `nowWallMs − lastSeenWallMs` 且**离线保护未失效**时传入；
 *             离线/保护失效时传 0）
 * @param inBattle 玩家此刻是否在战斗中（含普通入侵战斗 ⇒ 都暂停）
 * @returns 本拍是否**章鱼人把旗舰削沉了**
 */
export function weekendOctopusTick(
  state: Pick<GameState, 'debugQuick'>,
  ev: WeekendEventState,
  dtMs: number,
  inBattle: boolean,
): boolean {
  if (!weekendIsBossFamily(ev) || ev.flagshipDown !== undefined) return false
  if (inBattle || dtMs <= 0) return false
  const hpMax = ev.flagshipHpMax
  if (hpMax === undefined || hpMax <= 0) return false
  // ⚠ 窗口按**本档的实际长度**取（`weekendFlagshipWindowMs`：正常 2h / 调试 10min，
  //   与 `weekendBossPoolView`、倒计时、收口四处同一把尺）
  const windowMs = weekendFlagshipWindowMs(state)
  const d = Math.max(0, dtMs)
  if (d <= 0) return false
  /**
   * ⚠ **2026-09-25 共享血条**：章鱼那一份**直接记成血量**（`octopusHpDone`），
   * 速率 = `池子总量 ÷ 窗口` ⇒ 整整一个窗口的在线非战斗时间能把**满血**削空。
   * 玩家已经打掉的部分不重复算：血条见底 = `玩家 ＋ 章鱼 ≥ 总量`。
   */
  const playerDone = Math.max(0, ev.flagshipHpDone ?? 0)
  const need = hpMax - playerDone
  // 血条已被玩家打空 ⇒ 归属玩家（本拍不由章鱼人认领，避免仇敌记错）
  if (need <= 0) return false
  ev.octopusHpDone = Math.min(hpMax, weekendOctopusDone(ev) + d * weekendOctopusDrainPerMs(state, hpMax))
  return (ev.octopusHpDone ?? 0) >= need
}

/**
 * **章鱼人每拍推进**（引擎心跳调一次；`nowWallMs` 缺省 = 离线结算 / 工具 ⇒ **整拍不推进**，
 * 与船长"离线时章鱼也停"同口径）。
 *
 * 三件事：
 * 1. 首次满分且在线那一拍把 `flagshipAtWallMs` 锚点落盘（与 M1 的 `weekendTick` 同一条判据，
 *    只是这里**顺带**落 —— 让 Boss 池的 2 小时窗口有一个不漂移的起点）；
 * 2. 章鱼削血（`inBattle` 或离线 ⇒ 暂停）；
 * 3. 削到 100% ⇒ 写 `flagshipDown = 'octopus'` 并结束本场。
 *
 * @returns 本拍是否由章鱼人结束（引擎据此走 M1 的收尾：黑匣归零 + 贡献奖结算）
 */
export function weekendTickBoss(
  state: GameState,
  nowWallMs: number | undefined,
  inBattle: boolean,
): { down?: 'octopus' } {
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return {}
  if (!weekendIsBossFamily(ev)) return {}
  if (ev.flagshipDown !== undefined) return {}
  // 离线结算 / 工具调用（不传墙钟）⇒ 整拍不推进（与"离线时章鱼也停"同口径）
  if (nowWallMs === undefined || !Number.isFinite(nowWallMs)) return {}
  const last = ev.bossTickWallMs
  const gap = Math.max(0, nowWallMs - (last ?? nowWallMs))
  ev.bossTickWallMs = nowWallMs
  if (last === undefined) return {} // 本拍只是立基线：没有"上一拍"就没有可累计的时长
  // ⚠ 大步长（离线补算后的一次大跳 / 后台标签页）**只按一拍的合理上限累计**：
  // 章鱼削血是"在线陪着打"的机制，不能因为一次长跳就整段削掉（离线那部分本来就该停）。
  const dt = Math.min(gap, WEEKEND_BOSS_TICK_MAX_MS)
  if (ev.flagshipHpMax === undefined) return {} // 还没跟母舰交手过 ⇒ 池子未锁定（章鱼人也没有可削的目标）
  if (weekendOctopusTick(state, ev, dt, inBattle)) {
    ev.flagshipDown = 'octopus'
    endWeekendEvent(state, nowWallMs)
    return { down: 'octopus' }
  }
  return {}
}

/** 活动总时长（正常 = 74h；调试模式按 NPC 压缩口径无固定上限，取 74h÷60 供测试参考） */
export function weekendWindowMsOf(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? Math.round(WEEKEND_WINDOW_MS / WEEKEND_DEBUG_TIME_DIVISOR) : WEEKEND_WINDOW_MS
}
