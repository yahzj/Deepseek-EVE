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
  WEEKEND_FAMILIES,
  WEEKEND_GAIN_REPEL,
  WEEKEND_NPC_CORE_MS,
  WEEKEND_NPC_PERIPHERY_MS,
  WEEKEND_OFFLINE_SHIELD_MS,
  WEEKEND_PERIPHERY_THREAT,
  WEEKEND_WINDOW_MS,
  endWeekendEvent,
  weekendNoteFlagshipKilled,
  weekendNotePlayerWin,
  weekendNoteRepel,
  weekendTick,
  ensureWeekendEvent,
  weekendAssaultThreatOf,
  weekendContributionShareAt,
  weekendContributionTier,
  weekendCoreCandidates,
  weekendCoreProgressAt,
  weekendEncounterChanceAt,
  weekendFlagshipView,
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

  it('仅调试模式可见（船长令）：正常模式不开局；调试模式可开且幂等', () => {
    const fri = new Date(2026, 8, 25, 20, 0, 0, 0).getTime()
    const s = fresh()
    expect(ensureWeekendEvent(s, ctx, fri + 1 * H), '正常模式 ⇒ 不开').toBe(false)
    expect(s.weekendEvent).toBeUndefined()
    expect(WEEKEND_DEBUG_ONLY).toBe(true)
    const sd = fresh(true)
    expect(ensureWeekendEvent(sd, ctx, fri + 1 * H), '调试模式 ⇒ 开').toBe(true)
    expect(sd.weekendEvent?.startedAtWallMs, '调试模式 T0 = 调用时刻').toBe(fri + 1 * H)
    expect(ensureWeekendEvent(sd, ctx, fri + 2 * H), '未结束 ⇒ 幂等').toBe(false)
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

  it('核心没满 ⇒ 不现身；在线满分 ⇒ 此刻起算 2 小时', () => {
    const s = fresh()
    const notFull = evOf('core', ['p1'])
    expect(weekendFlagshipView(s, notFull, 10 * H, 10 * H).shown).toBe(false)
    const ev = fullCore()
    const v = weekendFlagshipView(s, ev, 10 * H, 10 * H)
    expect(v.shown).toBe(true)
    expect(v.deadlineWallMs).toBe(10 * H + 2 * H)
    expect(v.down).toBeUndefined()
  })

  it('已落盘的起算点稳定；过期 ⇒ 章鱼人摧毁', () => {
    const s = fresh()
    const ev = fullCore()
    ev.flagshipAtWallMs = 10 * H
    expect(weekendFlagshipView(s, ev, 11 * H, 11 * H).deadlineWallMs).toBe(12 * H)
    expect(weekendFlagshipView(s, ev, 12 * H + 1, 12 * H + 1).down).toBe('octopus')
  })

  it('离线保护：离线 ≤24h ⇒ 上线第一拍起算；离线 >24h ⇒ 自满 24h 起算（Q3）', () => {
    const s = fresh()
    const ev = fullCore()
    const last = 10 * H
    // 离线 3 小时回来：起算 = 现在
    const back3 = last + 3 * H
    expect(weekendFlagshipView(s, ev, back3, last).deadlineWallMs).toBe(back3 + 2 * H)
    // 离线 30 小时回来：起算 = last + 24h ⇒ 若 now ≥ 该点 +2h ⇒ 已被摧毁
    const back30 = last + 30 * H
    const v = weekendFlagshipView(s, ev, back30, last)
    expect(v.atWallMs).toBe(last + WEEKEND_OFFLINE_SHIELD_MS)
    expect(v.deadlineWallMs).toBe(last + WEEKEND_OFFLINE_SHIELD_MS + 2 * H)
    expect(v.down, '30h > 24h + 2h ⇒ 章鱼人已得手').toBe('octopus')
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
   * `octopusDrainedMs` 是章鱼人的削血进度；`flagshipRunId` 是"同一场只记一次"的幂等键；
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
      octopusDrainedMs: 90_000,
      flagshipDmgLogged: 12_345,
      flagshipRunId: 777,
      flagshipBestRunDmg: 12_345,
      bossTickWallMs: 1_700_000_000_000,
      prizePaidAtWallMs: 1_700_000_600_000,
    }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.flagshipHpMax, '池子总量').toBe(150_000)
    expect(back?.flagshipHpDone, '已伤（BOSS 血条随档）').toBe(42_000)
    expect(back?.octopusDrainedMs, '章鱼人削血').toBe(90_000)
    expect(back?.flagshipDmgLogged, '已记账伤害').toBe(12_345)
    expect(back?.flagshipRunId, '同场幂等键').toBe(777)
    expect(back?.flagshipBestRunDmg, '单场最高伤害（读数）').toBe(12_345)
    expect(back?.bossTickWallMs, '削血心跳').toBe(1_700_000_000_000)
    expect(back?.endedAtWallMs, '结束时刻').toBe(1_700_000_500_000)
    expect(back?.flagshipDown, '旗舰结局').toBe('player')
    expect(back?.prizePaidAtWallMs, '贡献奖已发标记').toBe(1_700_000_600_000)
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

  it('旗舰 anchor 只在首次满分且在线那一拍落盘，之后不漂移；过期 ⇒ 章鱼人得手并结束', () => {
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
    const t3 = t1 + 2 * 60_000 + 1
    const r3 = weekendTick(s, ctx, t3, t3)
    expect(r3.flagshipDown, '超时 ⇒ 章鱼人摧毁').toBe('octopus')
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
})
