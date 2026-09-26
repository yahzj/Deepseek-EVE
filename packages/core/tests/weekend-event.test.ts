/**
 * **周末入侵活动 · M1 骨架用例**（2026-09-23 船长令：「Q1，威胁降低，依旧是单舰。其他按你推荐。」）
 *
 * 覆盖：时间轴（周五 20:00 / 74h 窗口 / 调试模式 +1h 刷新）· 占领（核心约束 ＋ 外围＝全部邻居）
 * · 幂等与独立随机子流 · 进度（玩家投入 ＋ NPC 铺底 ＋ 核心门禁）· 遇袭概率与伏击强度
 * · 旗舰倒计时（含离线保护与 Q3 的">24h 自满 24h 起算"）· 贡献占比与四档 · 存档往返（老档缺键 ⇒ 无入侵）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { securityZoneOf } from '../src/sideTasks'
import {
  WEEKEND_AMBUSH_STRENGTH_MUL,
  WEEKEND_CORE_THREAT,
  WEEKEND_DEBUG_ONLY,
  /** 2026-09-25 船长令：首场一次性 T0 = 2026-09-25 22:00 */
  WEEKEND_FIRST_T0_WALL_MS,
  WEEKEND_FAMILIES,
  WEEKEND_GAIN_REPEL,
  WEEKEND_NPC_CORE_MS,
  WEEKEND_NPC_PERIPHERY_MS,
  WEEKEND_MIN_STANDING,
  weekendInvasionAllowedFor,
  WEEKEND_OFFLINE_SHIELD_MS,
  WEEKEND_PERIPHERY_THREAT,
  WEEKEND_WINDOW_MS,
  endWeekendEvent,
  weekendNoteFlagshipKilled,
  weekendNotePlayerWin,
  weekendNoteRepel,
  weekendTick,
  weekendClockOf,
  WEEKEND_DEBUG_WIN_GAIN,
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_PERIPHERY_WIN,
  WEEKEND_LOCKED_FAMILY,
  weekendWinGainOf,
  ensureWeekendEvent,
  weekendAssaultThreatOf,
  weekendContributionShareAt,
  weekendContributionTier,
  weekendCoreCandidates,
  weekendCoreProgressAt,
  weekendEncounterChanceAt,
  weekendFlagshipView,
  weekendDeadlineMs,
  weekendFlagshipWindowMs,
  weekendBossPoolView,
  weekendTickBoss,
  weekendFoeCardOf,
  weekendNoteContribution,
  weekendPeripheryClearedAt,
  weekendPeripheryOf,
  weekendPeripheryProgressAt,
  weekendRollOccupation,
  weekendT0Of,
  weekendWindowOpen,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import { setStanding } from './helpers'

const ctx = buildSimContext()
const H = 3_600_000

/** 全探索 + 指定调试模式的新档 */
function fresh(debugQuick = false) {
  const s = createInitialState({ nowWallMs: 0, seed: 20260923 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = debugQuick
  return s
}

function evOf(coreId: string, peripheryIds: string[], startedAtWallMs = 0): WeekendEventState {
  return { seq: 1, startedAtWallMs, coreId, peripheryIds, family: 'A', contributed: {} }
}

describe('周末入侵 · 时间轴', () => {
  it('T0 = 该时刻之前最近的周五 20:00；窗口 = 74 小时', () => {
    // 2026-09-25 是周五
    const fri = new Date(2026, 8, 25, 20, 0, 0, 0).getTime()
    expect(new Date(weekendT0Of(fri + 3 * H)).getDay(), '周五').toBe(5)
    expect(weekendT0Of(fri + 3 * H)).toBe(fri)
    expect(weekendWindowOpen(fri + 3 * H, fri)).toBe(true)
    expect(weekendWindowOpen(fri + WEEKEND_WINDOW_MS, fri), '窗口 74h 后关闭').toBe(false)
    // 周五 20:00 之前 ⇒ 用上一周的 T0；窗口已关
    expect(weekendT0Of(fri - H)).toBe(fri - 7 * 24 * H)
    expect(weekendWindowOpen(fri - H, weekendT0Of(fri - H))).toBe(false)
  })

  /**
   * **开放口径**（**船长 2026-09-25 令**：「**现在可以解除限制，并在一会 22 点开始第一次入侵活动。**」）：
   * 原先「仅调试模式可见」的闸解除 ⇒ **正常模式照周排期开局**（还要过声望那道闸，见下一条用例）；
   * 调试模式照旧"上一场结束 + 1h 刷新、无历史即开"。
   */
  it('解除限制后：正常模式按周排期开局；调试模式照旧可开且幂等', () => {
    const fri = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()  // 2026-10-02（首场时段之外，走纯周排期）
    expect(WEEKEND_DEBUG_ONLY, '船长已解除"仅调试模式可见"').toBe(false)
    const s = fresh()
    s.exploredGalaxies = [...ctx.galaxies.keys()] // 声望与探索都达标 ⇒ 该开
    setStanding(s, 'dsi', 60)
    expect(ensureWeekendEvent(s, ctx, fri + 1 * H), '正常模式 ⇒ 开（窗口内 ＋ 声望达标）').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs, '正常模式 T0 = 本周五 20:00（不是调用时刻）').toBe(fri)
    expect(ensureWeekendEvent(s, ctx, fri + 2 * H), '同一窗口只开一场 ⇒ 幂等').toBe(false)
    /** 窗口外（周三）⇒ 不开 */
    const outside = fresh()
    outside.exploredGalaxies = [...ctx.galaxies.keys()]
    setStanding(outside, 'dsi', 60)
    expect(ensureWeekendEvent(outside, ctx, fri + 4 * 24 * H), '窗口外 ⇒ 不开').toBe(false)
    const sd = fresh(true)
    expect(ensureWeekendEvent(sd, ctx, fri + 1 * H), '调试模式 ⇒ 开').toBe(true)
    expect(sd.weekendEvent?.startedAtWallMs, '调试模式 T0 = 调用时刻').toBe(fri + 1 * H)
    expect(ensureWeekendEvent(sd, ctx, fri + 2 * H), '未结束 ⇒ 幂等').toBe(false)
  })

  /**
   * **一个窗口只开一场**（2026-09-25 修）：原判据要求"未结束" ⇒ 旗舰被击沉、窗口还没到点时，
   * 下一拍会**立刻又开一场**（与定稿「每周末一次」＋「只有调试模式才是结束后 1 小时刷新」冲突）。
   * 现按窗口判：上一场开始至今不足 74h ⇒ 不再开新场。
   */
  it('同一窗口内：上一场已结束也不再开新场（下一个 T0 才开）', () => {
    const fri = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()  // 2026-10-02（首场时段之外，走纯周排期）
    const s = fresh()
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    setStanding(s, 'dsi', 60)
    expect(ensureWeekendEvent(s, ctx, fri + 1 * H)).toBe(true)
    const ev = s.weekendEvent!
    ev.endedAtWallMs = fri + 3 * H // 打完了，但窗口还开着（到下周一 22:00）
    expect(ensureWeekendEvent(s, ctx, fri + 4 * H), '同窗口内 ⇒ 不再开第二场').toBe(false)
    expect(s.weekendEvent, '还是那场（没被换掉）').toBe(ev)
    /** 跨过 74h（下周同一 T0 之后）⇒ 该开下一场 */
    expect(ensureWeekendEvent(s, ctx, fri + 7 * 24 * H + 1 * H), '下一个 T0 ⇒ 开新场').toBe(true)
    expect(s.weekendEvent!.seq, '场次号 +1').toBe(ev.seq + 1)
  })

  /**
   * **首场一次性 T0**（船长 2026-09-25 令：「在一会 22 点开始第一次入侵活动」＋二答「只今晚这一次 22:00」）：
   * 到点即开场（T0 = 22:00，不是本周排期的 20:00）；此后回落周排期 —— 且**不会在同一窗口里
   * 按 20:00 补开一场**（靠"一个窗口只开一场"那条判据兜住）。
   */
  it('首场一次性 T0 = 2026-09-25 22:00；首场过后回落每周五 20:00', () => {
    const first = WEEKEND_FIRST_T0_WALL_MS
    expect(first, '首场常量在册').not.toBeNull()
    expect(new Date(first!).getHours(), '本地 22 点').toBe(22)
    const s = fresh()
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    setStanding(s, 'dsi', 60)
    expect(ensureWeekendEvent(s, ctx, first! - 60_000), '到点前 ⇒ 不开').toBe(false)
    expect(ensureWeekendEvent(s, ctx, first!), '到点 ⇒ 开首场').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs, 'T0 = 22:00（不是排期的 20:00）').toBe(first)
    s.weekendEvent!.endedAtWallMs = first! + 5 * H
    expect(ensureWeekendEvent(s, ctx, first! + 6 * H), '首场结束后同窗口内 ⇒ 不补开').toBe(false)
  })

  /**
   * **快进口径**（2026-09-25 修船长报障「打开调试模式，快进后不会刷新入侵」）：
   * 入侵原先读 `Date.now()`，而"快进"推进的是**游戏自己的模拟墙钟** `savedAtWallMs`
   * ⇒ 两者不同源，快进对入侵完全无效。现统一走 `weekendClockOf`（取两者较大者）：
   * 正常在线恒等于真实墙钟（行为不变），快进后跟着模拟墙钟走、且**永不倒回**。
   */
  it('快进：入侵时钟取"真实墙钟与模拟墙钟的较大者"，跨过"结束 +1h"即开新场', () => {
    const real = 1_700_000_000_000
    const s = fresh(true)
    s.savedAtWallMs = real - 3_600_000
    expect(weekendClockOf(s, real), '正常在线 ⇒ 真实墙钟（savedAtWallMs 更早）').toBe(real)
    const ahead = real + 8 * 3_600_000
    s.savedAtWallMs = ahead
    expect(weekendClockOf(s, real), '快进 8 小时后 ⇒ 跟着模拟墙钟走').toBe(ahead)
    /** 快进那一拍：上一场已在 `real − 61 分钟`结束 ⇒ 用快进后的墙钟跑一拍就该开新场 */
    s.weekendEvent = { ...evOf('galaxy-home', ['galaxy-kor'], real - 2 * 3_600_000), endedAtWallMs: real - 61 * 60_000 }
    const r = weekendTick(s, ctx, weekendClockOf(s, real), real)
    expect(r.started, '快进跨过"上一场结束 + 1h" ⇒ 开新场').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs, '新场 T0 = 快进后的墙钟').toBe(ahead)
  })

  /**
   * **锁定族**（2026-09-25 船长令：「**目前只做了H族，所以先锁定H族**」）：
   * A/C/G 三族还是占位口径 ⇒ 开局面一律判成 H；调试模式下手上的**历史场**（别的族）**就地改判**，
   * 进度台账与场次号都留着（只换族）。M2/M3 补齐后把 `WEEKEND_LOCKED_FAMILY` 置回 `null` 即恢复随机。
   */
  it('锁定族：开局面一律 H；调试模式把历史场就地改判为 H（进度台账不动）', () => {
    expect(WEEKEND_LOCKED_FAMILY, '当前锁定 H（船长令）').toBe('H')
    const t = 1_700_000_000_000
    const s = fresh(true)
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    expect(ensureWeekendEvent(s, ctx, t), '调试模式首调即开').toBe(true)
    expect(s.weekendEvent?.family, '开出来的就是 H').toBe('H')
    /** 历史场（抽到 A 的旧场）⇒ 调试模式下一次判定就地改判成 H，其余字段一个不动 */
    const seq = s.weekendEvent!.seq
    s.weekendEvent = { ...s.weekendEvent!, family: 'A', contributed: { 'galaxy-kor': 0.7 } }
    expect(ensureWeekendEvent(s, ctx, t + 1000), '已有一场活着的 ⇒ 不新开').toBe(false)
    expect(s.weekendEvent?.family, '就地改判为 H').toBe('H')
    expect(s.weekendEvent?.seq, '场次号没换').toBe(seq)
    expect(s.weekendEvent?.contributed['galaxy-kor'], '进度台账留着').toBeCloseTo(0.7, 6)
  })

  it('调试模式：主动胜利 +50% ⇒ 两场收复（正常模式仍 外围 10% / 核心 5%）', () => {
    const s = fresh(true)
    const ev = evOf('galaxy-home', ['galaxy-kor'], 0)
    expect(weekendWinGainOf(s, ev, 'galaxy-kor'), '调试：外围 +50%').toBeCloseTo(WEEKEND_DEBUG_WIN_GAIN, 6)
    expect(weekendWinGainOf(s, ev, 'galaxy-home'), '调试：核心也 +50%').toBeCloseTo(WEEKEND_DEBUG_WIN_GAIN, 6)
    const s2 = fresh(false)
    expect(weekendWinGainOf(s2, ev, 'galaxy-kor'), '正常：外围 +10%').toBeCloseTo(WEEKEND_GAIN_PERIPHERY_WIN, 6)
    expect(weekendWinGainOf(s2, ev, 'galaxy-home'), '正常：核心 +5%').toBeCloseTo(WEEKEND_GAIN_CORE_WIN, 6)
  })

  /**
   * **旗舰现身只报一次**（2026-09-25 修船长报障「事件日志会一直刷『入侵核心已被打通：旗舰现身。』」）：
   * `flagshipShown` 现身之后**每拍都真**（拿它记日志 = 每拍一条）；`flagshipAnchored` 只在
   * **首次把 anchor 落盘**的那一拍为真 ⇒ 引擎照它记日志 / 弹一次窗。
   */
  it('旗舰现身只报一次：flagshipAnchored 仅首拍为真（shown 仍每拍真）', () => {
    const t0 = 1_700_000_000_000
    const s = fresh(true)
    s.weekendEvent = {
      seq: 1,
      startedAtWallMs: t0,
      coreId: 'galaxy-home',
      peripheryIds: ['galaxy-kor'],
      family: 'H',
      contributed: { 'galaxy-kor': 1, 'galaxy-home': 1 },
    }
    const a = weekendTick(s, ctx, t0 + 1000, t0)
    expect(a.flagshipShown, '第一拍就现身').toBe(true)
    expect(a.flagshipAnchored, '第一拍 = 落 anchor ⇒ 报一次').toBe(true)
    const b = weekendTick(s, ctx, t0 + 2000, t0 + 1000)
    expect(b.flagshipShown, '仍在场 ⇒ shown 照旧真').toBe(true)
    expect(b.flagshipAnchored, '第二拍不再报（日志与弹窗都按它）').toBe(false)
  })

  it('调试模式：上一场结束后 1 小时刷新（首调即开）', () => {
    const s = fresh(true)
    const t = 1_000_000_000
    expect(ensureWeekendEvent(s, ctx, t)).toBe(true)
    expect(s.weekendEvent?.startedAtWallMs).toBe(t)
    expect(ensureWeekendEvent(s, ctx, t + 30 * 60_000), '未到 1h ⇒ 不刷新').toBe(false)
    endWeekendEvent(s, t + 40 * 60_000)
    expect(ensureWeekendEvent(s, ctx, t + 40 * 60_000 + 30 * 60_000), '结束 +30 分钟 ⇒ 还不刷').toBe(false)
    expect(ensureWeekendEvent(s, ctx, t + 40 * 60_000 + 61 * 60_000), '结束 +61 分钟 ⇒ 刷').toBe(true)
    expect(s.weekendEvent?.seq, '编号 +1').toBe(2)
  })
})

describe('周末入侵 · 敌卡（M1 暂用虫洞族卡）', () => {
  it('族池 = A/C/G ＋ **H 墨潮帮**（2026-09-24 M2 第一族：它有自家独立入侵卡）', () => {
    expect([...WEEKEND_FAMILIES]).toEqual(['A', 'C', 'G', 'H'])
    // H 族走**独立卡**（不属虫洞族池）⇒ 换卡点 weekendFoeCardOf 对它直接返回 ink-*：
    expect(weekendFoeCardOf('H', 'flagship')).toBe('ink-flagship') // 旗舰部队卡（4 波自带波表）
    expect(weekendFoeCardOf('H', 'assault')).toBe('ink-harass') // 外围：骚扰舰队（2026-09-24 四张卡细分后）
  })

  it('外围取中层池 · 旗舰取最深池，且都在敌卡表里；未知族兜底到池内第一族', () => {
    for (const fam of WEEKEND_FAMILIES) {
      const assault = weekendFoeCardOf(fam, 'assault')
      const flagship = weekendFoeCardOf(fam, 'flagship')
      expect(ctx.anomalies.get(assault), fam + ' 外围卡必须在敌卡表里').toBeTruthy()
      expect(ctx.anomalies.get(flagship), fam + ' 旗舰卡必须在敌卡表里').toBeTruthy()
    }
    expect(weekendFoeCardOf('不存在的族', 'assault')).toBe(weekendFoeCardOf('A', 'assault'))
  })
})

describe('周末入侵 · 占领（核心 ＋ 外围）', () => {
  it('核心候选：已探索 · 非高安 · 无已建副站', () => {
    const s = fresh()
    const cands = weekendCoreCandidates(s, ctx)
    expect(cands.length).toBeGreaterThan(0)
    for (const id of cands) expect(securityZoneOf(ctx, id), `${id} 不该是高安`).not.toBe('高安')
    // 未探索的星系不进候选
    const s2 = createInitialState({ nowWallMs: 0, seed: 1 })
    s2.exploredGalaxies = ['galaxy-home']
    expect(weekendCoreCandidates(s2, ctx).length).toBeLessThanOrEqual(1)
  })

  it('外围 = 核心的全部邻居（不封顶、不含自己、含高安）', () => {
    const s = fresh()
    const core = weekendCoreCandidates(s, ctx)[0]!
    const per = weekendPeripheryOf(ctx, core)
    expect(per).not.toContain(core)
    expect(per.length).toBeGreaterThan(0)
    // 逐个核对：确实有一条边相连
    for (const id of per) {
      const linked = ctx.galaxyEdges.some((e) => (e.from === core && e.to === id) || (e.to === core && e.from === id))
      expect(linked, `${id} 与 ${core} 必须相邻`).toBe(true)
    }
    expect(new Set(per).size, '不重复').toBe(per.length)
  })

  it('抽取幂等：同 (种子, 编号) 必得同核心同族；不消费主随机序列', () => {
    const s = fresh()
    const a = weekendRollOccupation(s, ctx, 7)
    const b = weekendRollOccupation(s, ctx, 7)
    expect(a).toEqual(b)
    expect(a?.peripheryIds).toEqual(weekendPeripheryOf(ctx, a!.coreId))
    const before = JSON.stringify(s.rng)
    weekendRollOccupation(s, ctx, 8)
    expect(JSON.stringify(s.rng), '主随机序列一字不动').toBe(before)
  })
})

describe('周末入侵 · 进度', () => {
  const P = ['p1', 'p2']
  it('外围：NPC 铺底 48 小时满；玩家投入相加', () => {
    const s = fresh()
    const ev = evOf('core', P)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', 24 * H)).toBeCloseTo(0.5, 6)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', WEEKEND_NPC_PERIPHERY_MS), '48h ⇒ 满').toBe(1)
    weekendNoteContribution(ev, 'p1', 0.1)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', 24 * H), '0.5 + 0.1').toBeCloseTo(0.6, 6)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', 47 * H), '封顶 1').toBe(1)
  })

  it('核心门禁：外围没清完 ⇒ 核心条不涨；清完后自 T0+48h 起 24 小时铺满', () => {
    const s = fresh()
    const ev = evOf('core', P)
    weekendNoteContribution(ev, 'core', 1)
    expect(weekendCoreProgressAt(s, ev, 10 * H), '外围未清（NPC 也没铺完）⇒ 核心 0').toBe(0)
    weekendNoteContribution(ev, 'p1', 1)
    weekendNoteContribution(ev, 'p2', 1)
    expect(weekendPeripheryClearedAt(s, ev, 0)).toBe(true)
    expect(weekendCoreProgressAt(s, ev, 48 * H), 'T0+48h ⇒ NPC 起点').toBeCloseTo(1, 6)
    expect(weekendCoreProgressAt(s, ev, 60 * H), 'T0+60h ⇒ NPC 半程 + 投入封顶').toBe(1)
    expect(weekendCoreProgressAt(s, ev, 72 * H)).toBe(1)
    expect(WEEKEND_NPC_CORE_MS).toBe(24 * H)
  })

  it('调试模式：NPC 时间轴 ÷60（外围 48 分钟即满）', () => {
    const s = fresh(true)
    const ev = evOf('core', P)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', 24 * 60_000), '24 分钟 ⇒ 半程').toBeCloseTo(0.5, 6)
    expect(weekendPeripheryProgressAt(s, ev, 'p1', 48 * 60_000), '48 分钟 ⇒ 满').toBe(1)
  })
})

describe('周末入侵 · 遇袭与伏击（Q1 单舰 78 · Q2 ×0.5）', () => {
  it('概率 = 60%×(1−进度) 封顶 0.9；夺回后为 0', () => {
    const s = fresh()
    const ev = evOf('core', ['p1'])
    expect(weekendEncounterChanceAt(s, ev, 'p1', 0)).toBeCloseTo(0.6, 6)
    expect(weekendEncounterChanceAt(s, ev, 'p1', 24 * H)).toBeCloseTo(0.3, 6)
    expect(weekendEncounterChanceAt(s, ev, 'core', 0), '核心也吃同一公式').toBeCloseTo(0.6, 6)
    expect(weekendEncounterChanceAt(s, ev, 'p1', WEEKEND_NPC_PERIPHERY_MS), '夺回 ⇒ 0').toBe(0)
  })

  it('威胁：主动（A/C/G 占位口径）外围 78 / 核心 120；遇袭 = **真强度 ×0.75**（标签另算）', () => {
    const ev = evOf('core', ['p1'])
    expect(WEEKEND_PERIPHERY_THREAT).toBe(78)
    expect(WEEKEND_CORE_THREAT).toBe(120)
    expect(weekendAssaultThreatOf(ev, 'p1')).toBe(78)
    expect(weekendAssaultThreatOf(ev, 'core')).toBe(120)
    // 2026-09-25：旧的 `WEEKEND_AMBUSH_MUL = 0.5`（只改标签）已删 ⇒ 现行 = 真倍率 0.75
    expect(WEEKEND_AMBUSH_STRENGTH_MUL).toBe(0.75)
  })
})

describe('周末入侵 · 旗舰与倒计时（含离线保护 / Q3 / Q7）', () => {
  function fullCore(debugQuick = false): WeekendEventState {
    const ev = evOf('core', [])
    ev.contributed['core'] = 1
    void debugQuick
    return ev
  }

  it('核心没满 ⇒ 不现身；在线满分 ⇒ 此刻起算 24 小时（船长 2026-09-26 令）', () => {
    const s = fresh()
    const notFull = evOf('core', ['p1'])
    expect(weekendFlagshipView(s, notFull, 10 * H, 10 * H).shown).toBe(false)
    const ev = fullCore()
    const v = weekendFlagshipView(s, ev, 10 * H, 10 * H)
    expect(v.shown).toBe(true)
    expect(v.deadlineWallMs, '满血 ⇒ 整整一个 24h 窗口').toBe(10 * H + 24 * H)
    expect(v.down).toBeUndefined()
  })

  /**
   * **章鱼人削血 = 真实削减**（船长 2026-09-25：「章鱼人削减母舰血条是**真实削减**，玩家假设打完一场
   * 放一会，母舰血量是会**真实减少**」）⇒ 得手判据 = **共享血条被削空**，不是"墙钟到点"：
   * 倒计时读数按"还差多少在线非战斗时间才能把**剩下的血**削空"展示；玩家打掉的与章鱼削掉的**同一条血**。
   */
  it('得手 = 共享血条被削空（真实削减）；已掉的血把倒计时推短', () => {
    const s = fresh()
    const ev = fullCore()
    ev.family = 'H' // 章鱼削血只服务 BOSS 池族（`WEEKEND_BOSS_FAMILIES`）
    ev.flagshipHpMax = 150_000
    ev.flagshipAtWallMs = 10 * H
    // 一点没削（此刻 11h）⇒ 还差 24 小时在线非战斗时间（从此刻起算）
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).deadlineWallMs).toBe(11 * H + 24 * H)
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).down, '没削完 ⇒ 不得手').toBeUndefined()
    // 章鱼人已削掉一半血 ⇒ 只剩一半 ⇒ 再有 12 小时就削空
    ev.octopusHpDone = 75_000
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).deadlineWallMs).toBe(11 * H + 12 * H)
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).down).toBeUndefined()
    // ⚠ 共享血条：玩家打掉的那份**也真实减少同一条血** ⇒ 章鱼人只需再花 1/4 窗口就能削空
    ev.flagshipHpDone = 37_500
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).deadlineWallMs, '剩 1/4 血 ⇒ 1/4 窗口').toBe(
      11 * H + 6 * H, // 1/4 窗口 = 6 小时
    )
    // 削空 ⇒ 血条见底 ⇒ 章鱼人得手（与 `weekendOctopusTick` 同一判据）
    ev.octopusHpDone = 150_000
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).down).toBe('octopus')
    // ⚠ 墙钟再过多久都一样：只要血条没空就不得手（战斗/离线暂停削血 ⇒ 也不能被墙钟判死）
    ev.octopusHpDone = 75_000
    expect(weekendFlagshipView(s, ev, 40 * H, 40 * H).down, '战斗中挂机不削血 ⇒ 墙钟不该判死').toBeUndefined()
  })

  it('离线保护：离线 ≤24h ⇒ 上线第一拍起算；离线 >24h ⇒ 自满 24h 起算（Q3）', () => {
    const s = fresh()
    const ev = fullCore()
    const last = 10 * H
    // 离线 3 小时回来：起算 = 现在（窗口 = 24h，2026-09-26 船长令）
    const back3 = last + 3 * H
    expect(weekendFlagshipView(s, ev, back3, last).deadlineWallMs).toBe(back3 + 24 * H)
    // 离线 30 小时回来：起算 = last + 24h（保护失效那一刻）⇒ 窗口 24h ⇒ **last+48h** 才到点
    const back30 = last + 30 * H
    const v = weekendFlagshipView(s, ev, back30, last)
    expect(v.atWallMs).toBe(last + WEEKEND_OFFLINE_SHIELD_MS)
    expect(v.deadlineWallMs).toBe(last + WEEKEND_OFFLINE_SHIELD_MS + 24 * H)
    expect(v.down, '30h 还没到 last+48h ⇒ 尚未被削空').toBeUndefined()
    // 离线 50 小时回来 ⇒ 已过 last+48h ⇒ 章鱼人得手
    expect(weekendFlagshipView(s, ev, last + 50 * H, last).down, '过点 ⇒ 章鱼人得手').toBe('octopus')
  })

  it('调试模式关掉离线保护（Q7）：离线多久都从此刻起算', () => {
    const s = fresh(true)
    const ev = fullCore(true)
    const last = 10 * H
    const back = last + 40 * H
    const v = weekendFlagshipView(s, ev, back, last)
    expect(v.atWallMs).toBe(back)
    expect(v.down).toBeUndefined()
  })

  /**
   * **真实削减（引擎路径）**：`weekendTickBoss` 每拍按"在线且非战斗"的时长推进削血，
   * 血池读数**真减少**；战斗/离线 ⇒ 暂停（不减少）。
   * ⚠ 2026-09-25：章鱼那一份**记成血量**（`octopusHpDone`），速率 = `池子总量 ÷ 窗口`。
   */
  it('削血真实推进：打完放一会 ⇒ 母舰血量真的减少；战斗中与离线都不削', () => {
    const s = fresh(true) // 调试档：窗口 = 10 分钟
    const ev = fullCore(true)
    ev.family = 'H' // BOSS 池口径只服务 H 族（`WEEKEND_BOSS_FAMILIES`）
    ev.flagshipHpMax = 150_000
    ev.flagshipHpDone = 0
    s.weekendEvent = ev // `weekendTickBoss` 读的是**状态里那一场**（`fullCore` 只造对象、不入档）
    const windowMs = weekendFlagshipWindowMs(s)
    expect(windowMs, '调试档窗口 = 10 分钟').toBe(10 * 60_000)
    // 第一拍只立基线（没有"上一拍"就没有可累计的时长）
    weekendTickBoss(s, 1_000, false)
    expect(ev.octopusHpDone ?? 0).toBe(0)
    // 在线且不在战斗：连推 30 拍（每拍 ≤5s 上限）⇒ 攒下 150 秒 ⇒ 按"满血 ÷ 窗口"的速率真掉 25%
    for (let i = 1; i <= 30; i++) weekendTickBoss(s, 1_000 + i * 5_000, false)
    expect(ev.octopusHpDone, '150 秒 ×（150000 ÷ 600 秒）= 37500 点').toBe(37_500)
    const pool = weekendBossPoolView(s, ev)!
    expect(pool.octopusFrac).toBeCloseTo(0.25, 6)
    expect(pool.hpLeft, '血条真的少了 25%（真实削减）').toBe(150_000 - 37_500)
    // 战斗中：削血暂停（时钟继续走、读数不动）
    weekendTickBoss(s, 200_000, true)
    expect(ev.octopusHpDone, '战斗中暂停').toBe(37_500)
    // 离线（不传墙钟 = 离线结算口径）⇒ 同样不动
    weekendTickBoss(s, undefined, false)
    expect(ev.octopusHpDone, '离线也暂停').toBe(37_500)
    // 削到血条见底 ⇒ 得手
    for (let i = 0; i < 200 && (ev.octopusHpDone ?? 0) < 150_000; i++) {
      weekendTickBoss(s, 200_000 + i * 5_000, false)
    }
    expect(ev.octopusHpDone).toBe(150_000)
    expect(weekendFlagshipView(s, ev, 200_000 + 201 * 5_000, 200_000 + 201 * 5_000).down, '削空 ⇒ 章鱼人得手').toBe(
      'octopus',
    )
  })

  /**
   * 🔴 **2026-09-26 船长令**：「**当入侵的旗舰出现后，章鱼人的削血速度降低，延长到默认最多24小时才能削完**」
   * ⇒ 正常档窗口 **2h → 24h**：速率 = `池子 ÷ 24h`（满血在线 1 小时削 **6,250** 点、24 小时削空）；
   * **调试档不动**（仍 10 分钟）；倒计时读数（`weekendFlagshipView.deadlineWallMs`）按"还剩多少血"折算，
   * 满血时 = 从现在起整整 24 小时。
   */
  it('船长令：正常档削血窗口 = **24 小时**（满血在线 1 小时削 6,250 点）；调试档仍 10 分钟', () => {
    const s = fresh() // 正常档
    const ev = fullCore(true)
    ev.family = 'H'
    ev.flagshipHpMax = 150_000
    ev.flagshipHpDone = 0
    s.weekendEvent = ev
    const windowMs = weekendFlagshipWindowMs(s)
    expect(windowMs, '正常档窗口 = 24 小时（船长令）').toBe(24 * 3_600_000)
    expect(weekendDeadlineMs(s), '倒计时读数与窗口同源').toBe(24 * 3_600_000)
    /** 在线非战斗推 1 小时（每拍 ≤5 秒上限 ⇒ 推 720 拍 = 3600 秒）⇒ 削掉 `150000 ÷ 24` */
    weekendTickBoss(s, 1_000, false)
    const t0 = 1_000
    for (let i = 1; i <= 720; i++) weekendTickBoss(s, t0 + i * 5_000, false)
    expect(ev.octopusHpDone, '1 小时 ÷ 24h × 150000 = 6250 点').toBeCloseTo(6_250, 6)
    expect(weekendBossPoolView(s, ev)!.octopusFrac).toBeCloseTo(6_250 / 150_000, 6)
    /** 倒计时 = 剩余血量 × 窗口 ÷ 池子 = 24h × (1 − 1/24) = 23 小时 */
    const view = weekendFlagshipView(s, ev, t0 + 721 * 5_000, t0 + 721 * 5_000)
    expect(view.deadlineWallMs! - (t0 + 721 * 5_000)).toBe(Math.round(((150_000 - 6_250) * windowMs) / 150_000))
    /** 调试档不受影响 */
    const sd = fresh(true)
    expect(weekendFlagshipWindowMs(sd), '调试档窗口不动（10 分钟）').toBe(10 * 60_000)
  })
})

describe('周末入侵 · 贡献与结算', () => {
  it('占比 = 玩家投入 ÷（玩家 ＋ NPC 铺底）；四档奖励', () => {
    const s = fresh()
    const ev = evOf('core', ['p1'])
    weekendNoteContribution(ev, 'p1', 0.2)
    const share = weekendContributionShareAt(s, ev, 0)
    expect(share).toBeCloseTo(1, 6) // 此刻 NPC 铺底还是 0 ⇒ 全是玩家的
    const later = weekendContributionShareAt(s, ev, 48 * H)
    expect(later).toBeLessThan(share)
    expect(weekendContributionTier(0.9).tier).toBe('A')
    expect(weekendContributionTier(0.9).wreck).toBe(12)
    expect(weekendContributionTier(0.6).tier).toBe('B')
    expect(weekendContributionTier(0.3).tier).toBe('C')
    expect(weekendContributionTier(0.01).tier).toBe('D')
    expect(weekendContributionTier(0).tier).toBe('none')
  })

  it('击退遇袭按 +3% 记台账（Q2/第 6 条）', () => {
    const ev = evOf('core', ['p1'])
    weekendNoteContribution(ev, 'p1', WEEKEND_GAIN_REPEL)
    expect(ev.contributed['p1']).toBeCloseTo(0.03, 6)
  })
})

describe('周末入侵 · 存档往返（零迁移）', () => {
  it('有入侵 ⇒ 键与内容完整往返；无入侵 ⇒ 键不出现、读回 undefined', () => {
    const s = fresh()
    s.weekendEvent = { ...evOf('galaxy-home', ['galaxy-kor'], 123), contributed: { 'galaxy-kor': 0.3 }, flagshipAtWallMs: 456 }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.weekendEvent?.coreId).toBe('galaxy-home')
    expect(back.weekendEvent?.peripheryIds).toEqual(['galaxy-kor'])
    expect(back.weekendEvent?.contributed['galaxy-kor']).toBeCloseTo(0.3, 6)
    expect(back.weekendEvent?.flagshipAtWallMs).toBe(456)
    const clean = fresh()
    const back2 = loadSaveFile(serializeSaveFile(clean, 0)).state
    expect(back2.weekendEvent).toBeUndefined()
  })

  /**
   * **旗舰 BOSS 进度与结束结算标记一个都不能丢**（2026-09-25 补测）：
   * 这些字段是**跨会话状态**——母舰"单场不死、跨场累计"全靠 `flagshipHpDone`；
   * `octopusHpDone` 是章鱼人削掉的那一份血量；`flagshipRunId` 是"同一场只记一次"的幂等键；
   * `prizePaidAtWallMs` 是贡献奖"只发一次"的落盘标记。丢任何一个都会在读档后**回退**：
   * 血条回满 / 削血清零 / 同一场被重复记账 / 贡献奖重复发放。
   */
  it('旗舰 BOSS 进度与结算标记随档往返（血条 / 削血 / 幂等键 / 已发奖）', () => {
    const s = fresh()
    s.weekendEvent = {
      ...evOf('galaxy-home', ['galaxy-kor'], 123),
      endedAtWallMs: 1_700_000_500_000,
      flagshipAtWallMs: 456,
      flagshipDown: 'player',
      flagshipHpMax: 150_000,
      flagshipHpDone: 42_000,
      octopusHpDone: 36_000,
      flagshipDmgLogged: 12_345,
      flagshipRunId: 777,
      flagshipBestRunDmg: 12_345,
      bossTickWallMs: 1_700_000_000_000,
      prizePaidAtWallMs: 1_700_000_600_000,
    }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.flagshipHpMax, '池子总量').toBe(150_000)
    expect(back?.flagshipHpDone, '已伤（BOSS 血条随档）').toBe(42_000)
    expect(back?.octopusHpDone, '章鱼人削掉的血量').toBe(36_000)
    expect(back?.flagshipDmgLogged, '已记账伤害').toBe(12_345)
    expect(back?.flagshipRunId, '同场幂等键').toBe(777)
    expect(back?.flagshipBestRunDmg, '单场最高伤害（读数）').toBe(12_345)
    expect(back?.bossTickWallMs, '削血心跳').toBe(1_700_000_000_000)
    expect(back?.endedAtWallMs, '结束时刻').toBe(1_700_000_500_000)
    expect(back?.flagshipDown, '旗舰结局').toBe('player')
    expect(back?.prizePaidAtWallMs, '贡献奖已发标记').toBe(1_700_000_600_000)
  })

  /**
   * **旧字段就地迁移**（2026-09-25 共享血条改口径）：旧档存的是**时长** `octopusDrainedMs`，
   * 新档存**血量** `octopusHpDone`。不迁移的话，读档后已削掉的那部分会**凭空回血**
   * （实测船长在玩的档：已削 24% ⇒ 血条会跳回去一截）。
   * 换算 = `池子总量 × 时长 ÷ 窗口`，窗口走同一个单源（正常 **24h**（2026-09-26 船长令起）/ 调试 10min）。
   */
  it('旧档 `octopusDrainedMs`（时长）⇒ 读档即换算成 `octopusHpDone`（血量）', () => {
    const s = fresh()
    s.weekendEvent = {
      ...evOf('galaxy-home', ['galaxy-kor'], 123),
      family: 'H',
      flagshipAtWallMs: 456,
      flagshipHpMax: 150_000,
      flagshipHpDone: 0,
    }
    const raw = JSON.parse(serializeSaveFile(s, 0)) as {
      state: { weekendEvent: Record<string, unknown> }
    }
    // 伪造一份"旧档"：删掉新键、塞进旧键（正常档 = 24 小时窗口 ⇒ 半小时 ≈ 2.08% 的血）
    delete raw.state.weekendEvent.octopusHpDone
    raw.state.weekendEvent.octopusDrainedMs = 30 * 60_000
    const back = loadSaveFile(JSON.stringify(raw)).state.weekendEvent
    expect(back?.octopusHpDone, '半小时 ÷ 24h × 150000').toBe(3_125)
    expect((back as Record<string, unknown> | undefined)?.octopusDrainedMs, '旧键不再写回').toBeUndefined()
    // 调试档（10 分钟窗口）⇒ 同一个时长换算出来的血量是 144 倍（窗口 24h ÷ 10min）
    const s2 = fresh(true)
    s2.weekendEvent = {
      ...evOf('galaxy-home', ['galaxy-kor'], 123),
      family: 'H',
      flagshipAtWallMs: 456,
      flagshipHpMax: 150_000,
    }
    const raw2 = JSON.parse(serializeSaveFile(s2, 0)) as {
      state: { weekendEvent: Record<string, unknown>; debugQuick: boolean }
    }
    delete raw2.state.weekendEvent.octopusHpDone
    raw2.state.weekendEvent.octopusDrainedMs = 30_000
    expect(raw2.state.debugQuick, '调试档').toBe(true)
    const back2 = loadSaveFile(JSON.stringify(raw2)).state.weekendEvent
    expect(back2?.octopusHpDone, '5% × 150000').toBe(7_500)
  })
})

describe('周末入侵 · 引擎 tick 与记账（M1-b）', () => {
  it('调试模式：tick 开局面，并交出该掷遇袭骰的星系与概率（未夺回者才有）', () => {
    const s = fresh(true)
    const T = 5_000_000
    const r = weekendTick(s, ctx, T, T)
    expect(r.started, '首次 tick ⇒ 开局').toBe(true)
    expect(s.weekendEvent).toBeTruthy()
    expect(r.encounterRolls.length, '核心加外围都要掷').toBe(1 + s.weekendEvent!.peripheryIds.length)
    for (const x of r.encounterRolls) expect(x.chance).toBeCloseTo(0.6, 6)
    expect(r.flagshipShown, '刚开局核心不满 ⇒ 旗舰未现身').toBe(false)
    expect(weekendTick(s, ctx, T + 60_000, T + 60_000).started, '同场再 tick ⇒ 不重开').toBe(false)
  })

  it('旗舰 anchor 只在首次满分且在线那一拍落盘，之后不漂移；削满窗口 ⇒ 章鱼人得手并结束', () => {
    const s = fresh(true)
    const T = 5_000_000
    weekendTick(s, ctx, T, T)
    const ev = s.weekendEvent!
    for (const id of ev.peripheryIds) ev.contributed[id] = 1 // 先清外围解门禁
    ev.contributed[ev.coreId] = 1
    expect(ev.flagshipAtWallMs, '还没 tick ⇒ 未落盘').toBeUndefined()
    const t1 = T + 60_000
    const r1 = weekendTick(s, ctx, t1, t1)
    expect(r1.flagshipShown).toBe(true)
    expect(ev.flagshipAtWallMs, '落盘等于此刻').toBe(t1)
    const t2 = t1 + 30_000
    weekendTick(s, ctx, t2, t2)
    expect(ev.flagshipAtWallMs, 'anchor 不漂移').toBe(t1)
    /**
     * ⚠ **2026-09-25 改判**：得手判据 = **共享血条被削空**（`玩家已造成 ＋ 章鱼已削 ≥ 池子总量`），
     * 不再是"墙钟到点"（船长：「章鱼人削减母舰血条是**真实削减**」＋「战斗中会暂停削血」）。
     * 这里直接摆章鱼那一份的血量（引擎的累计由 `weekendTickBoss` 那一路覆盖，见上面的真实削减用例）。
     */
    ev.flagshipHpMax = 150_000
    ev.octopusHpDone = 150_000 - 1
    expect(weekendTick(s, ctx, t1 + 5 * 60_000, t1 + 5 * 60_000).flagshipDown, '还差一点 ⇒ 不得手').toBeUndefined()
    ev.octopusHpDone = 150_000
    const t3 = t1 + 6 * 60_000
    const r3 = weekendTick(s, ctx, t3, t3)
    expect(r3.flagshipDown, '削满 ⇒ 章鱼人摧毁').toBe('octopus')
    expect(r3.ended).toBe(true)
    expect(ev.flagshipDown).toBe('octopus')
    expect(ev.endedAtWallMs, '本场已结束').toBe(t3)
  })

  it('记账：主动胜利 外围加 10 / 核心加 5 个百分点 · 击退加 3（离线 1）· 击毁旗舰要核心先满', () => {
    const s = fresh(true)
    const T = 5_000_000
    weekendTick(s, ctx, T, T)
    const ev = s.weekendEvent!
    const per = ev.peripheryIds[0]!
    weekendNotePlayerWin(s, per)
    expect(ev.contributed[per], '外围主动胜利 +10%').toBeCloseTo(0.1, 6)
    weekendNoteRepel(s, per)
    expect(ev.contributed[per], '击退再 +3%').toBeCloseTo(0.13, 6)
    weekendNoteRepel(s, per, true)
    expect(ev.contributed[per], '离线击退 +1%').toBeCloseTo(0.14, 6)
    weekendNotePlayerWin(s, ev.coreId)
    expect(ev.contributed[ev.coreId], '核心主动胜利 +5%').toBeCloseTo(0.05, 6)
    expect(weekendNoteFlagshipKilled(s, T), '核心没满 ⇒ 击毁无效').toBe(false)
    for (const id of ev.peripheryIds) ev.contributed[id] = 1 // 清外围解门禁
    ev.contributed[ev.coreId] = 1
    expect(weekendNoteFlagshipKilled(s, T)).toBe(true)
    expect(ev.flagshipDown).toBe('player')
    expect(ev.endedAtWallMs).toBe(T)
    weekendNotePlayerWin(s, per)
    expect(ev.contributed[per], '结束后不再记账（投入冻结，仍停在清门禁时的 1）').toBeCloseTo(1, 6)
  })

  /**
   * **船长 2026-09-25 令**：「**给入侵触发加一个前提，需要拥有至少40声望，才会触发入侵。**」
   * 四答：协会（DSI）声望 ≥ 40 · **只在开新场那一刻判** · 不足**静默不开** · **调试模式不受限**。
   *
   * ⚠ 本用例钉的是**判据本身**（`weekendInvasionAllowedFor`）：当前 `WEEKEND_DEBUG_ONLY = true`
   * ⇒ 正常模式那一段还走不到（解除调试限定的那一刻起生效）；判据的**接线**由 `content:check` 的
   * 「入侵声望前提契约」看着（源码级扫描：正常模式那一段必须调它）。
   */
  it('声望前提：协会声望 ≥ 40 才允许开新场；调试模式不受限', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 31 })
    expect(WEEKEND_DEBUG_ONLY, '船长 2026-09-25 已解除"仅调试模式可见"').toBe(false)
    // 正常模式：声望 0 / 39 ⇒ 不开；40 及以上 ⇒ 开
    s.debugQuick = false
    setStanding(s, 'dsi', 0)
    expect(weekendInvasionAllowedFor(s), '声望 0 ⇒ 不开').toBe(false)
    setStanding(s, 'dsi', WEEKEND_MIN_STANDING - 1)
    expect(weekendInvasionAllowedFor(s), '差 1 点也不开').toBe(false)
    setStanding(s, 'dsi', WEEKEND_MIN_STANDING)
    expect(weekendInvasionAllowedFor(s), '到线即开').toBe(true)
    setStanding(s, 'dsi', WEEKEND_MIN_STANDING + 30)
    expect(weekendInvasionAllowedFor(s), '超过更开').toBe(true)
    // 声望远超也拦不住调试模式：调高声望不改变"调试恒真"这条
    setStanding(s, 'dsi', 0)
    s.debugQuick = true
    expect(weekendInvasionAllowedFor(s), '调试模式不受限（新建档也能测入侵）').toBe(true)
    // 缺键（老档没有 standings.dsi）按 0 算 ⇒ 正常模式下不开
    s.debugQuick = false
    // ⚠ 2026-09-26：门槛读**累计获得**那本 ⇒ 要验"缺键"必须两本都删（只删可支配那本仍是 40）
    delete s.standings['dsi']
    if (s.standingsEarned) delete s.standingsEarned['dsi']
    expect(weekendInvasionAllowedFor(s), '缺键 = 0 ⇒ 正常模式不开').toBe(false)
  })
})
