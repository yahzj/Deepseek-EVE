/**
 * **入侵补偿批**（**船长 2026-10-02 令**，原话照抄）：
 *
 * > 「**发布一个公告：'部分玩家会因为上一期入侵结束时间问题导致这一期还是墨潮帮，这部分玩家将会在
 * > 下周三增设一次光环的入侵，其余玩家发放一个信号发射器。'并准备对应的工具。**」
 * > ＋ 四问裁「**按你推荐来**」＝采纳一号的推荐：**判定双判据** · **补场甲**（暗期只开一场、到下一期
 * > T0 自然收场、不设截止）· **发放甲**（读档入仓 ＋ 系统日志，新建的档也算"其余玩家"）·
 * > 公告用官方名「光环科技」与绝对日期、分类「修复」、本批做完＋验收后立即推送。
 * > 🔴 **补场口径于同日改判「乙」**（一号摆出"判成受影响、但本期就把光环打到手"的那批读数后）：
 * > **开补场之前回头看一次 —— 本期已经真出过光环 ⇒ 不开补场，改发 1 枚信号发射器**
 * > （见 {@link weekendCompensationGotRThisPeriod} 与 {@link openWeekendMakeupIfDue}）。
 *
 * **成因**（一号 2026-10-02 核过）：本期该出哪一族按**窗口 T0**（最近一个周五 20:00）算 ——
 * 10-02 20:00 那一期 = **光环科技（R）**；但开新场有一条硬前提「**上一场还没结束 ⇒ 本期不开**」，
 * 而"上一场"何时结束又受三条规则影响（周排期场到下一期 T0 才收场 · **玩家召唤场豁免**那条 ·
 * 「正在打旗舰战 ⇒ 顺延到打完 + 60 秒」）⇒ **上一期（墨潮帮）那场结束得晚或还没结束**的档，
 * 本期压根不开新场 ⇒ 界面里**还是墨潮帮**。
 *
 * **本文件是这一批的唯一判定与落地处**（三条纯函数 + 两条落地，全部幂等）：
 * - {@link weekendCompensationTrackOf}：判成 `'makeup'`（受影响）还是 `'beacon'`（其余）；
 * - {@link applyWeekendCompensation}：**判一次并落盘**，`beacon` 那条当场发道具 ＋ 记日志；
 * - {@link openWeekendMakeupIfDue}：`makeup` 那条在**暗期**里开**一场光环**。
 *
 * ⚠ **一人一条路**：判成 `makeup` 的不发信号发射器；判成 `beacon` 的不开补场。
 * ⚠ **补场不是"点火场"**：不写 `beaconLit` ⇒ 声望按常规贡献档算（不走"点火场固定 5 点"那条）。
 */
import type { SimContext } from './types'
import type { GameState } from './state'
import { addLog } from './state'
import { addWare } from './inventory'
import { INVASION_BEACON_ITEM_ID } from './consumables'
import { weekendInvasionAllowedFor, weekendRollOccupation } from './weekendEvent'
/** 2026-10-02 补闸（船长令「按你推荐来」）：开局器也要过"还有没打完的旗舰战吗"这道闸（判据与战斗界面同源） */
import { weekendFlagshipBattleActive } from './weekendLaunch'

/**
 * **本地墙钟"某日 20:00"的绝对毫秒** —— 本模块的两个日期锚都走它，**与 `weekendT0Of` 同一把尺**
 * （那边也按**本地时间**组件算周五 20:00）。
 */
function localAt20(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 20, 0, 0, 0).getTime()
}

/**
 * **本批的判据锚 = "上一期"的 T0**：**2026-10-02 20:00（本地墙钟）那一期**——船长 2026-10-02 令里
 * 「一会 8 点开启入侵、设置为 R 族」的那一期（这一期该出**光环科技**）。
 *
 * ⚠ **刻意不引用 `weekendEvent.WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS`**：那个常量现值是
 * **2026-10-03 04:00 本地**（＝2026-10-02T20:00Z），**比它自己的注释（「2026-10-02 20:00 本地」）晚 8 小时**
 * ⇒ 用它会让"10-09 那期 = 墨潮帮"那条顺延**整整错一期**（一号 2026-10-02 已把该读数报给船长，
 * 本批不跟它走、也不顺手改它）。
 */
export const WEEKEND_COMPENSATION_T0_WALL_MS = localAt20(2026, 10, 2)

/**
 * **上一期锁定的族 = 墨潮帮（`'H'`）**（2026-09-25 船长令「先锁定 H 族」，该锁 2026-10-02 才放开）
 * ⇒ 判据里那个"上一期那场"只能是 H。**不写成"上一期该出的族"**：那个族今天算出来是 R（循环从本期
 * 起算），拿它判会**一个都判不出来**。
 */
const COMPENSATION_STUCK_FAMILY = 'H'

/** 补场开哪一族：**光环科技（R）**（船长令「增设一次**光环**的入侵」） */
export const WEEKEND_MAKEUP_FAMILY = 'R'

/**
 * **补场的首个暗期起点 = 2026-10-07 20:00（周三）**——船长令里的"**下周三**"。
 *
 * 为什么是这一格：周排期窗口是**周五 20:00 ~ 周二 20:00（96h）**，**周三到周五那段是暗期**
 * （`weekendWindowOpen` 恒假）⇒ 补场落在这里既不会与本期（光环）抢场，也不会挤掉 10-09 那一期（墨潮帮）。
 */
export const WEEKEND_MAKEUP_FIRST_WALL_MS = localAt20(2026, 10, 7)

/** **该暗期的终点 = 下一期 T0 = 2026-10-09 20:00（周五）**（读数/用例锚点；落地靠收场规则自然实现） */
export const WEEKEND_MAKEUP_FIRST_END_WALL_MS = localAt20(2026, 10, 9)

/** 补场那个"暗期"的星期与时刻：**周三 20:00**（`Date.getDay()`：0=周日 … 3=周三） */
const MAKEUP_WEEKDAY = 3
const MAKEUP_HOUR = 20

/**
 * **补场窗口 = 每个"周三 20:00 ~ 周五 20:00"的 48 小时暗期**（首个不早于 2026-10-07 20:00）。
 *
 * ⚠ **不设截止**（船长四问之 Q2 采纳的推荐）：到点没上线的档，顺延到**下一个周三**——补场是承诺，
 * 不该因为玩家那两天没登录就作废。落地时仍要求"手上没有未结束的场"（见 `openWeekendMakeupIfDue`）。
 */
export function weekendMakeupWindowOf(nowWallMs: number): {
  open: boolean
  startWallMs: number
  endWallMs: number
} {
  const d = new Date(nowWallMs)
  const day = d.getDay()
  let back = (day - MAKEUP_WEEKDAY + 7) % 7
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), MAKEUP_HOUR, 0, 0, 0).getTime()
  if (back === 0 && nowWallMs < at) back = 7 // 本周三 20:00 还没到 ⇒ 用上一周
  const startWallMs = at - back * 86_400_000
  const endWallMs = startWallMs + 2 * 86_400_000 // 周五 20:00：交还给周排期窗口
  const open = nowWallMs >= startWallMs && nowWallMs < endWallMs && startWallMs >= WEEKEND_MAKEUP_FIRST_WALL_MS
  return { open, startWallMs, endWallMs }
}

/**
 * **判定这一档走哪条路**（**船长四问之 Q1：双判据**）——两条**都只看存档现状**（不新增判据字段）：
 *
 * ① **手上那场**：有一场**未结束**的入侵，其 T0 **早于 10-02 20:00**（＝上一期或更早开的）且族 = 墨潮帮
 *    ⇒ 他正在打的还是上一期那场，本期本来就没开（**这一条覆盖"压根没上线过"的档**）；
 * ② **留档快照**：最近一场**已结束**的 `weekendLastResult` 是墨潮帮、且**结束于 10-02 20:00 之后**
 *    ⇒ 上一期结束太晚，本期没轮上（**这一条覆盖"旧场刚结束、快照已落盘"的档**）。
 *
 * 都不成立 ⇒ `'beacon'`（＝"其余玩家"，含**新建的档**：船长四问之 Q3 采纳的推荐）。
 */
export function weekendCompensationTrackOf(state: GameState): 'makeup' | 'beacon' {
  const ev = state.weekendEvent
  if (
    ev !== undefined &&
    ev.endedAtWallMs === undefined &&
    ev.family === COMPENSATION_STUCK_FAMILY &&
    ev.startedAtWallMs < WEEKEND_COMPENSATION_T0_WALL_MS
  ) {
    return 'makeup'
  }
  const snap = state.weekendLastResult
  if (
    snap !== undefined &&
    snap.family === COMPENSATION_STUCK_FAMILY &&
    snap.endedAtWallMs >= WEEKEND_COMPENSATION_T0_WALL_MS
  ) {
    return 'makeup'
  }
  return 'beacon'
}

/**
 * **判定并落地"发放"那一条**（每拍调用，**幂等**）——`beacon` 路：**入仓 1 枚信号发射器 ＋ 一条系统日志**。
 *
 * - **只判一次**：`state.weekendCompensation` 一旦写上就永不改判（`decidedAtWallMs` 是判定时刻）；
 *   ⇒ 判成 `makeup` 的档**不会**因为后来状态变化又被补发一枚道具（一人一条路的保险）。
 * - **起点**：`nowWallMs >= WEEKEND_COMPENSATION_T0_WALL_MS`（10-02 20:00）才判——本批是随推送上线的，
 *   早于这一期的档不该被判（也免得测试里 `nowWallMs = 0` 的档凭空多出一条日志）。
 * - 日志走 **`core.weekend.045`**（**不投递通讯信**：与"补发旗舰黑匣"同口径）。
 *
 * @returns 本次是否真的落地了东西（供调用方决定是否落盘）
 */
export function applyWeekendCompensation(state: GameState, nowWallMs: number): boolean {
  if (nowWallMs < WEEKEND_COMPENSATION_T0_WALL_MS) return false
  if (state.weekendCompensation !== undefined) return false
  const track = weekendCompensationTrackOf(state)
  state.weekendCompensation = { track, decidedAtWallMs: nowWallMs }
  if (track !== 'beacon') return true
  addWare(state, INVASION_BEACON_ITEM_ID, 1)
  state.weekendCompensation.beaconGrantedAtWallMs = nowWallMs
  addLog(state, 'system', '入侵补偿：信号发射器 ×1（已存入物品仓库）。', 'core.weekend.045')
  return true
}

/**
 * **该档"本期"是不是已经真出过光环了**（**船长 2026-10-02 令「乙」**的判据 · 唯一取数口）。
 *
 * 判据 = **留档快照**是**光环**，且它结束在 **本期 T0（2026-10-02 20:00）之后、补场首场
 * （2026-10-07 20:00）之前** —— 上界把"本期"钉死在那一个窗口里，免得把**后面几期**的留档也算进来
 * （⚠ 族循环锚点那个 8 小时偏差让 10-09 那期**也**是光环，见文件头与工作文档 §七）。
 *
 * 为什么用留档快照：调用点（补场服务）已经要求"手上没有未结束的场" ⇒ 那一刻他若打到过光环，
 * 那一场必然**已结束并落进留档**。⚠ 已知边界（如实记账）：若他在本期打到光环、之后又打完了一期
 * 别的入侵（留档被后者覆盖）⇒ 判据看不到那次光环 ⇒ **照旧会开补场**（偏差方向 = 多给一场）。
 */
export function weekendCompensationGotRThisPeriod(state: GameState): boolean {
  const snap = state.weekendLastResult
  if (snap === undefined) return false
  return (
    snap.family === WEEKEND_MAKEUP_FAMILY &&
    snap.endedAtWallMs >= WEEKEND_COMPENSATION_T0_WALL_MS &&
    snap.endedAtWallMs < WEEKEND_MAKEUP_FIRST_WALL_MS
  )
}

/**
 * **开出补场**（每拍调用，**幂等**）——`makeup` 路：暗期里开**一场光环科技**。
 *
 * 前提（缺一不可）：
 * 1. 该档判成了 `makeup`，且**还没开过**（`makeupServedAtWallMs` 缺省）、**也没跳过**（`makeupSkippedAtWallMs` 缺省）；
 * 2. 现在落在**补场暗期**内（{@link weekendMakeupWindowOf}）；
 * 3. **手上没有未结束的场**（与 `ensureWeekendEvent` 那条硬前提同口径：绝不覆盖正在打的那场）；
 * 3-bis. 🔴 **2026-10-02 补闸（船长令「按你推荐来」）**：**还有没打完的入侵旗舰战 ⇒ 本拍不开**
 *    （判据 = `weekendLaunch.weekendFlagshipBattleActive`，与战斗界面/削血闸同源）——
 *    与 3 互补：那一场可能是"玩家亲手击沉后已收场"的旧场（`endedAtWallMs` 已写 ⇒ 3 放行），
 *    而玩家还停在它的战斗画面里；此刻开新场，旧战斗的结算会落到新场头上；
 * 4. 🔴 **船长 2026-10-02 令「乙」**：**他本期已经真出过光环 ⇒ 不开补场** —— 按"其余玩家"口径
 *    改发 1 枚信号发射器（{@link weekendCompensationGotRThisPeriod}）；这条**在声望门之前**判；
 * 5. 过**声望前提** `weekendInvasionAllowedFor`（≥40 累计声望）——与排期入侵同一条门。
 *
 * 开出来的那一场**刻意不带 `beaconLit`**（不是点火场）：收场规则因此走**周排期**那条
 * （`weekendT0Of(now) > startedAtWallMs` ⇒ **到下一个周五 20:00 收场**），于是：
 * · 周三 20:00 开 ⇒ 周五 20:00 收 ⇒ 正好是那 48 小时暗期，**不挤掉 10-09 那一期（墨潮帮）**；
 * · 晚登录的档顺延到**下一个周三**再开（不设截止）。
 *
 * ⚠ **命名刻意不叫 `start*`**：`arch:guard` 的 F8「主控活动入口」把 core 里所有 `start*` 导出函数当成
 * **玩家发起的主控活动入口**、要求它走 `applyActivityGate`；本函数是**到点自动开场的排期器**
 * （与 `ensureWeekendEvent` 同类，不是玩家活动）⇒ 按同一命名习惯叫 `open…IfDue`，不进那条契约。
 *
 * @returns 真开了才 `true`（调用方据此走与常规开局同一套日志/警报演出；"跳过 ＋ 发道具"那条返回 `false`）
 */
export function openWeekendMakeupIfDue(state: GameState, ctx: SimContext, nowWallMs: number): boolean {
  const comp = state.weekendCompensation
  if (
    comp === undefined ||
    comp.track !== 'makeup' ||
    comp.makeupServedAtWallMs !== undefined ||
    comp.makeupSkippedAtWallMs !== undefined
  ) {
    return false
  }
  if (!weekendMakeupWindowOf(nowWallMs).open) return false
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === undefined) return false
  /**
   * 🔴 **3-bis「还在打那一场 ⇒ 本拍不开」**（**2026-10-02 补闸**）：见函数头注 —— 判据与战斗界面、
   * 章鱼削血闸同源（`weekendFlagshipBattleActive`），绝不新造第二份判据。
   */
  if (weekendFlagshipBattleActive(state)) return false
  /**
   * 🔴 **船长 2026-10-02 令「乙」**：**他本期已经真出过光环 ⇒ 不再叠加一场补场**。
   *
   * 起因（一号当日的读数）：判成受影响的档里，有一部分会在**本期窗口内**就把旧的墨潮帮交掉 ——
   * 按今天的开局口径（只看"有没有正在进行" ＋ 取消周二关窗），**当拍就开新场**，而那一期的族就是
   * **光环科技** ⇒ 他本期其实已经打到了光环；此时周三再开一场就是"连着两场光环"。
   * 船长裁「乙」＝**按需发放**：到这一刻回头看一次，拿到过就不开。
   *
   * 配套（乙里那条建议，船长采纳）：**跳过补场时按"其余玩家"口径改发 1 枚信号发射器** ——
   * 让这条路上的人也有个到手的东西（公告承诺的兑现感）。落 `makeupSkippedAtWallMs` 记"已结清"。
   *
   * ⚠ 位置刻意在**声望前提之前**：这条路上发的是"补偿道具"，不该因为此刻声望不足就落空。
   */
  if (weekendCompensationGotRThisPeriod(state)) {
    addWare(state, INVASION_BEACON_ITEM_ID, 1)
    state.weekendCompensation = {
      ...comp,
      makeupSkippedAtWallMs: nowWallMs,
      beaconGrantedAtWallMs: nowWallMs,
    }
    addLog(state, 'system', '入侵补偿：信号发射器 ×1（已存入物品仓库）。', 'core.weekend.045')
    return false
  }
  if (!weekendInvasionAllowedFor(state)) return false
  const seq = (ev?.seq ?? 0) + 1
  const rolled = weekendRollOccupation(state, ctx, seq, WEEKEND_MAKEUP_FAMILY)
  if (!rolled) return false
  state.weekendEvent = { seq, startedAtWallMs: nowWallMs, ...rolled, contributed: {} }
  state.weekendCompensation = { ...comp, makeupServedAtWallMs: nowWallMs }
  return true
}
