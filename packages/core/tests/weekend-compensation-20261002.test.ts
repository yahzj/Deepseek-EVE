/**
 * **入侵补偿批**（**船长 2026-10-02 令**，原话照抄）：
 *
 * > 「**发布一个公告：'部分玩家会因为上一期入侵结束时间问题导致这一期还是墨潮帮，这部分玩家将会在
 * > 下周三增设一次光环的入侵，其余玩家发放一个信号发射器。'并准备对应的工具。**」
 * > ＋ 四问裁「**按你推荐来**」＝判定双判据 · 补场甲 · 发放甲（含新档）· 公告与推送口径。
 *
 * 本文件锁四组（口径与落地见 `weekendCompensation.ts`；归档见
 * `docs/glossary.md`「入侵补偿批」词条）：
 * ① **判定**（双判据：手上那场拖过本期 / 留档是墨潮帮且结束于本期之后；其余与新档 = `beacon`）；
 * ② **发放**（信号发射器入仓 ＋ 一条系统日志；**一人一条路**、幂等）；
 * ③ **补场**（暗期 = 周三 20:00~周五 20:00；只开一场；到下一期 T0 自然收场 ⇒ 不挡下一期）；
 * ④ **日期锚**（10-02 / 10-07 / 10-09 三个 20:00 —— 与公告上的"10 月 7 日（周三）"逐字对齐）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { INVASION_BEACON_ITEM_ID } from '../src/consumables'
import { weekendCoreCandidates, weekendFamilyForWindow, weekendTick } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import {
  WEEKEND_COMPENSATION_T0_WALL_MS,
  WEEKEND_MAKEUP_FAMILY,
  WEEKEND_MAKEUP_FIRST_WALL_MS,
  WEEKEND_MAKEUP_FIRST_END_WALL_MS,
  applyWeekendCompensation,
  openWeekendMakeupIfDue,
  weekendCompensationGotRThisPeriod,
  weekendCompensationTrackOf,
  weekendMakeupWindowOf,
} from '../src/weekendCompensation'

const ctx = buildSimContext()
const H = 3_600_000
/** 本期 T0 = 2026-10-02 20:00（本地）· 上一期 T0 = 09-25 20:00 · 补场周三 · 下一期周五 */
const T0 = WEEKEND_COMPENSATION_T0_WALL_MS
const PREV_T0 = T0 - 7 * 24 * H
const WED = WEEKEND_MAKEUP_FIRST_WALL_MS
const FRI = WEEKEND_MAKEUP_FIRST_END_WALL_MS

/** 一份"声望够 ＋ 满探索"的档（照 `window-close-removal-20261002` 用例的同一套脚手架） */
function base(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  return s
}

const coreIdOf = (s: GameState): string => weekendCoreCandidates(s, ctx)[0]!

/** 造"手上那场"（默认 = 上一期开的**墨潮帮**、未结束 ⇒ 就是"这一期还是墨潮帮"那批） */
function stuckEvent(s: GameState, over: Partial<WeekendEventState> = {}): WeekendEventState {
  const ev: WeekendEventState = {
    seq: 4,
    startedAtWallMs: PREV_T0,
    coreId: coreIdOf(s),
    peripheryIds: [],
    family: 'H',
    contributed: {},
    ...over,
  }
  s.weekendEvent = ev
  return ev
}

/** 造"最近一场已结束的留档"（`weekendLastResult`） */
function settleSnapshot(s: GameState, family: string, endedAtWallMs: number): void {
  s.weekendLastResult = {
    seq: 4,
    family,
    coreId: coreIdOf(s),
    endedAtWallMs,
    flagshipOutcome: 'window',
    share: 0,
    tier: 'none',
    isk: 0,
    wreck: 0,
    blackBox: 0,
    galaxies: [],
  }
}

const beaconCount = (s: GameState): number => s.warehouse.items[INVASION_BEACON_ITEM_ID] ?? 0
/** 读"手上那场"（走函数取 ⇒ 不被 TS 的赋值收窄影响：用例里会先 `= undefined` 再让被测函数写回新场） */
const evOf = (s: GameState): WeekendEventState | undefined => s.weekendEvent

describe('入侵补偿批 · 判定（船长 2026-10-02 Q1：双判据）', () => {
  it('① 手上那场未结束 · T0 早于本期 · 族 = 墨潮帮 ⇒ makeup（这一期还是墨潮帮那批）', () => {
    const s = base()
    stuckEvent(s)
    expect(weekendCompensationTrackOf(s)).toBe('makeup')
    /** 三个必要条件各自单独破掉 ⇒ 不再判 makeup */
    const a = base()
    stuckEvent(a, { family: 'R' })
    expect(weekendCompensationTrackOf(a), '族不是墨潮帮').toBe('beacon')
    const b = base()
    stuckEvent(b, { startedAtWallMs: T0 + H })
    expect(weekendCompensationTrackOf(b), 'T0 不早于本期（是本期开的新场）').toBe('beacon')
    const c = base()
    stuckEvent(c, { endedAtWallMs: PREV_T0 + H })
    expect(weekendCompensationTrackOf(c), '那场已经结束了').toBe('beacon')
  })

  it('② 留档 = 墨潮帮 · 结束于本期 T0 之后 ⇒ makeup（旧场刚结束、快照已落盘那批）', () => {
    const s = base()
    settleSnapshot(s, 'H', T0 + 30 * 60_000)
    expect(weekendCompensationTrackOf(s)).toBe('makeup')
    const boundary = base()
    settleSnapshot(boundary, 'H', T0)
    expect(weekendCompensationTrackOf(boundary), '整点结束也算（≥ T0）').toBe('makeup')
  })

  it('③ 上一期正常收场（09-29 结束）· 留档是光环 · 全新档 ⇒ 都是 beacon（其余玩家）', () => {
    const a = base()
    settleSnapshot(a, 'H', PREV_T0 + 96 * H)
    expect(weekendCompensationTrackOf(a), '上期墨潮帮按时收场 ⇒ 本期本来就能轮上光环').toBe('beacon')
    const b = base()
    settleSnapshot(b, 'R', T0 + H)
    expect(weekendCompensationTrackOf(b), '留档是光环').toBe('beacon')
    expect(weekendCompensationTrackOf(base()), '全新档 = 其余玩家（船长 Q3 采纳：新档也发）').toBe('beacon')
  })

  it('④ 起点：10-02 20:00 之前**不判**（不写标记、不发道具）', () => {
    const s = base()
    expect(applyWeekendCompensation(s, T0 - 1), '还没到判定起点').toBe(false)
    expect(s.weekendCompensation, '不落标记').toBeUndefined()
    expect(beaconCount(s), '不发道具').toBe(0)
  })
})

describe('入侵补偿批 · 发放（船长 Q3「甲」：入仓 ＋ 系统日志 · 一人一条路）', () => {
  it('⑤ beacon 路：入仓 1 枚 ＋ 一条 `core.weekend.045` 日志 ＋ **只发一次**', () => {
    const s = base()
    expect(applyWeekendCompensation(s, T0 + H)).toBe(true)
    expect(s.weekendCompensation?.track).toBe('beacon')
    expect(s.weekendCompensation?.beaconGrantedAtWallMs, '记下发放时刻').toBe(T0 + H)
    expect(beaconCount(s)).toBe(1)
    const log = s.logs.filter((l) => l.textId === 'core.weekend.045')
    expect(log.length, '一条日志').toBe(1)
    /** 幂等：再调不重复 */
    expect(applyWeekendCompensation(s, T0 + 2 * H)).toBe(false)
    expect(beaconCount(s)).toBe(1)
    expect(s.logs.filter((l) => l.textId === 'core.weekend.045').length).toBe(1)
  })

  it('⑥ makeup 路：**不发**信号发射器（一人一条路）· 判过就不再改判', () => {
    const s = base()
    stuckEvent(s)
    expect(applyWeekendCompensation(s, T0 + H)).toBe(true)
    expect(s.weekendCompensation?.track).toBe('makeup')
    expect(s.weekendCompensation?.beaconGrantedAtWallMs).toBeUndefined()
    expect(beaconCount(s), '受影响玩家不发道具（他拿的是补场）').toBe(0)
    /** 之后状态变了（旧场结束、留档也清了）⇒ **不改判**（判过就是判过了） */
    s.weekendEvent = undefined
    expect(applyWeekendCompensation(s, T0 + 2 * H)).toBe(false)
    expect(beaconCount(s)).toBe(0)
  })
})

describe('入侵补偿批 · 补场（船长 Q2「甲」：暗期只开一场 · 到下一期 T0 收场）', () => {
  it('⑦ 暗期窗口 = 周三 20:00 ~ 周五 20:00；本期窗口内不算 · 顺延到下一个周三', () => {
    expect(weekendMakeupWindowOf(WED - 1).open, '周三 20:00 前一刻').toBe(false)
    expect(weekendMakeupWindowOf(WED).open, '周三 20:00 整点开').toBe(true)
    expect(weekendMakeupWindowOf(WED + 47 * H).open, '距周五 20:00 还有 1 小时').toBe(true)
    expect(weekendMakeupWindowOf(FRI).open, '周五 20:00 交还给周排期窗口').toBe(false)
    expect(weekendMakeupWindowOf(T0 + 2 * H).open, '本期窗口（周五~周二）不是暗期').toBe(false)
    expect(weekendMakeupWindowOf(WED + 7 * 24 * H).open, '晚登录的顺延到下一个周三').toBe(true)
    expect(weekendMakeupWindowOf(WED - 7 * 24 * H).open, '首场之前没有补场').toBe(false)
  })

  it('⑧ makeup 档在周三 20:00 开出一场**光环**；手上还有场时不开；只开一次', () => {
    const s = base()
    stuckEvent(s)
    applyWeekendCompensation(s, T0 + H)
    expect(openWeekendMakeupIfDue(s, ctx, WED), '手上那场还没结束 ⇒ 不开（绝不覆盖）').toBe(false)
    /** 旧场结束 ⇒ 补场开出来 */
    s.weekendEvent!.endedAtWallMs = WED - 2 * H
    expect(openWeekendMakeupIfDue(s, ctx, WED)).toBe(true)
    const ev = s.weekendEvent!
    expect(ev.family, '**光环科技**').toBe(WEEKEND_MAKEUP_FAMILY)
    expect(ev.family).toBe('R')
    expect(ev.startedAtWallMs, 'T0 = 开出来那一刻（收场因而落在下一个周五 20:00）').toBe(WED)
    expect(ev.beaconLit, '不是点火场（声望不走"固定 5 点"那条）').toBeUndefined()
    expect(s.weekendCompensation?.makeupServedAtWallMs).toBe(WED)
    /** 只开一次 */
    ev.endedAtWallMs = WED + H
    expect(openWeekendMakeupIfDue(s, ctx, WED + 2 * H), '开过就不再开').toBe(false)
    /** 判成 beacon 的档永远不开补场 */
    const b = base()
    applyWeekendCompensation(b, T0 + H)
    expect(b.weekendCompensation?.track).toBe('beacon')
    expect(openWeekendMakeupIfDue(b, ctx, WED)).toBe(false)
  })

  it('⑨ 补场到 10-09 20:00 收场 ⇒ **不挡下一期**（那一拍照常开出新场）', () => {
    const s = base()
    stuckEvent(s)
    applyWeekendCompensation(s, T0 + H)
    s.weekendEvent!.endedAtWallMs = WED - 2 * H
    expect(openWeekendMakeupIfDue(s, ctx, WED)).toBe(true)
    /** 周五 20:00（＝下一期 T0）那一拍：补场收场 */
    const at = weekendTick(s, ctx, FRI, FRI, false)
    expect(at.ended, '补场到下一期 T0 就收场').toBe(true)
    expect(s.weekendEvent?.endedAtWallMs).toBe(FRI)
    /** 紧接着那一拍：照常开下一期（族由那一期的排期决定 —— 本批**不改族循环**） */
    const next = weekendTick(s, ctx, FRI + 1_000, FRI + 1_000, false)
    expect(next.started, '下一期照常开局').toBe(true)
    expect(s.weekendEvent?.family, '族 = 那一期的排期（本批一字未动）').toBe(weekendFamilyForWindow(FRI))
    expect(s.weekendEvent?.startedAtWallMs, 'T0 = 那一期的 T0').toBe(FRI)
  })

  it('⑩ 日期锚：10-02 / 10-07 / 10-09 三个本地 20:00（与公告"10 月 7 日（周三）"逐字对齐）', () => {
    const at = (ms: number): string => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`
    }
    expect(at(T0)).toBe('2026-10-2 20:0')
    expect(at(WED)).toBe('2026-10-7 20:0')
    expect(at(FRI)).toBe('2026-10-9 20:0')
    expect(new Date(T0).getDay(), '10-02 是周五').toBe(5)
    expect(new Date(WED).getDay(), '10-07 是周三（船长令里的"下周三"）').toBe(3)
    expect(new Date(FRI).getDay(), '10-09 是周五（下一期）').toBe(5)
    console.log(
      `  [读数] 补偿批锚点：判据 T0 ${at(T0)} · 补场 ${at(WED)}（周三）~ ${at(FRI)}（周五）· ` +
        `补场族 = ${WEEKEND_MAKEUP_FAMILY}（光环科技）`,
    )
  })

  /**
   * **「乙」**（**船长 2026-10-02 同日改判**）：判成受影响的档里，有一部分会在**本期窗口内**就把旧的
   * 墨潮帮交掉 —— 按今天"开局只看有没有正在进行 ＋ 取消周二关窗"的口径，**当拍就开新场**，而那一期的
   * 族就是**光环科技** ⇒ 他本期已经打到了光环；此时周三再开一场就是"连着两场光环"。
   * 船长裁「乙」＝**按需发放**：开补场前回头看一次，拿到过 ⇒ **跳过补场**、改发 1 枚信号发射器。
   */
  it('⑪ 乙：本期已真出过光环 ⇒ **跳过补场**，改发 1 枚信号发射器（幂等）', () => {
    const s = base()
    stuckEvent(s)
    applyWeekendCompensation(s, T0 + H)
    expect(s.weekendCompensation?.track).toBe('makeup')
    /** 本期（10-02 20:00 之后、10-07 20:00 之前）他打完了那场常规光环 ⇒ 留档里是光环 */
    settleSnapshot(s, WEEKEND_MAKEUP_FAMILY, T0 + 2 * 24 * H + H)
    s.weekendEvent = undefined
    expect(weekendCompensationGotRThisPeriod(s), '判据应认出"本期出过光环"').toBe(true)
    /** 周三那一拍：**不开补场**，改发道具 ＋ 落"跳过"标记 */
    expect(openWeekendMakeupIfDue(s, ctx, WED), '不开补场').toBe(false)
    expect(s.weekendEvent, '没有新场').toBeUndefined()
    expect(beaconCount(s), '改发 1 枚信号发射器').toBe(1)
    expect(s.weekendCompensation?.makeupSkippedAtWallMs).toBe(WED)
    expect(s.weekendCompensation?.beaconGrantedAtWallMs).toBe(WED)
    expect(s.weekendCompensation?.makeupServedAtWallMs, '没有开过补场').toBeUndefined()
    expect(s.logs.filter((l) => l.textId === 'core.weekend.045').length, '一条日志').toBe(1)
    /** 幂等：之后每个周三再来都不重复 */
    expect(openWeekendMakeupIfDue(s, ctx, WED + 7 * 24 * H)).toBe(false)
    expect(beaconCount(s)).toBe(1)
    console.log('  [读数] 乙：本期已出过光环 ⇒ 跳过补场 ＋ 改发信号发射器 ×1（开补场前回头判一次）')
  })

  it('⑫ 乙的判据只在**本期**内认账：上一期的光环 / 下一期的光环都不算 ⇒ 照常开补场', () => {
    /** 上一期（早于本期 T0）结束的光环 ⇒ 不是"本期拿到过" */
    const a = base()
    stuckEvent(a)
    applyWeekendCompensation(a, T0 + H)
    a.weekendEvent = undefined
    settleSnapshot(a, WEEKEND_MAKEUP_FAMILY, T0 - H)
    expect(weekendCompensationGotRThisPeriod(a)).toBe(false)
    expect(openWeekendMakeupIfDue(a, ctx, WED), '照常开补场').toBe(true)
    expect(evOf(a)?.family).toBe(WEEKEND_MAKEUP_FAMILY)
    /** 留档是**墨潮帮**（本期没出过光环）⇒ 照常开补场 */
    const b = base()
    stuckEvent(b)
    applyWeekendCompensation(b, T0 + H)
    b.weekendEvent = undefined
    settleSnapshot(b, 'H', T0 + 3 * 24 * H)
    expect(weekendCompensationGotRThisPeriod(b)).toBe(false)
    expect(openWeekendMakeupIfDue(b, ctx, WED)).toBe(true)
    /** 留档是**补场首场之后**（10-09 那期）的光环 ⇒ 不算"本期"（上界钉死在本期窗口内）⇒ 照常开补场 */
    const c = base()
    stuckEvent(c)
    applyWeekendCompensation(c, T0 + H)
    c.weekendEvent = undefined
    settleSnapshot(c, WEEKEND_MAKEUP_FAMILY, FRI + H)
    expect(weekendCompensationGotRThisPeriod(c), '上界把"本期"钉在 10-07 20:00 之前').toBe(false)
    expect(openWeekendMakeupIfDue(c, ctx, WED + 7 * 24 * H), '晚登录的档照常补上').toBe(true)
  })
})
