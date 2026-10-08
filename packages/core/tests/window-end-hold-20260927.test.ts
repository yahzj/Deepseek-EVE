/**
 * **本场收场的顺延：玩家打完再满 60 秒才收场**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**到点的延期到玩家打完1分钟后**」（前因：`weekend:sim` 的 `window` 场景坐实了
 * "到点那一刻正在打的旗舰战**整场作废**"——母舰血条照掉到 0，但伤害台账 / 判沉 / 黑匣 /
 * 残骸 / 日志全丢）。
 *
 * 同日两条裁定（本次一并落）：
 * - **上限 = 甲：不设上限**（那场没打完就一直等）；
 * - **章鱼人一起闸**：只要有没打完的旗舰战，本拍**既不由章鱼收走、也不收场**（否则掉线超 24h
 *   回来的那一拍，章鱼可能先把玩家正在打的那一场判走 —— 等于白延期）。
 *
 * 🔴 **2026-10-02 船长令「乙」只换了"到点"是什么**（现行规则见 `docs/design/weekend-invasion.md`）：
 * - **周排期场**：到点 = **下一期 T0 已到**（旧口径"自己 +96h＝周二 20:00"**已作废**）⇒
 *   本文件 ①②③④⑤⑥⑦ 七条顺延断言**只把 `DUE_AT` 换成 `NEXT_T0`**，语义一字不变；
 * - **玩家召唤场**（`beaconLit`）：到点仍是**自己 +96h**（豁免周排期那次收场）；
 * - 旧口径下"拖过下一场 T0 ⇒ **下一场入侵取消**"的三条（原 ⑧⑨⑩）**已不可达**（旧场就在下一期 T0
 *   那一拍被收掉）⇒ 改写为"**旧场被强制收场、随后新一期照常开**"。
 *
 * 落点 = `weekendEvent.weekendTick`（引擎每拍调它）：
 * ③ 章鱼得手判据加"旗舰战在打就不判"；④ 收场点改成"在打就顺延、打完再满 60 秒才收场"。
 * ⚠ 顺延期间活动**仍然活着** ⇒ 战斗收尾走的是正常结算路径（结算侧一个字都不用改）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { countWare, createInitialState } from '../src/index'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendApplyBattleOutcome, weekendSettleAndGrant } from '../src/weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_WINDOW_END_HOLD_MS,
  WEEKEND_WINDOW_MS,
  weekendFlagshipView,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
  weekendT0Of,
  weekendTick,
  weekendWindowOpen,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
/**
 * ⚠ **必须用真 T0 当开场的开始时刻**：`weekendTick` 每拍先走 `ensureWeekendEvent`，而开新场的判据是
 * "**窗口内 ＋ 上一场已结束**"⇒ 顺手编一个开始时刻会让它**在收场那一拍先收场、再另开一场**
 * （把被测对象整个换掉）。
 * （2026-10-02 船长令「甲」之前，这里还多一层"上一场开始至今不足一个窗口（96h）"的兜底；该判据已作废，
 *  现行开局与封盘边界见 `docs/design/weekend-invasion.md`。）
 * ⚠ 还要**避开首场特例那一周**（`WEEKEND_FIRST_T0_WALL_MS` = 2026-09-25 22:00：那一周里
 * `ensureWeekendEvent` 会按"首场"再开一场）⇒ 取 10 月中旬反推的周五 20:00，与跑步日期无关、可复现。
 */
const T0 = weekendT0Of(Date.parse('2026-10-15T12:00:00+08:00'))
/**
 * **周排期场现在的收场点 = 下一期 T0**（**2026-10-02 船长令「乙」**）——旧口径是"自己 +96h（＝周二 20:00）"，
 * 已作废（周二那一刻**不再**收场，见文件末尾「乙」那两条）。
 */
const NEXT_T0 = T0 + 7 * 24 * 3_600_000
const DUE_AT = NEXT_T0
/** 旧口径的"窗口到点"（T0 + 96h＝周二 20:00）—— 现在只用来验证"**这里已经不再收场**" */
const WINDOW_END = T0 + WEEKEND_WINDOW_MS

/** H 族入侵 ＋ 池子已锁定（**正常模式**：窗口到点那条路只在非调试档生效 ⇒ 不能开 `debugQuick`） */
function bossWorld(usedHp = 1_000): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  /**
   * **开新场有"累计声望 ≥ 40"的前提**（`weekendInvasionAllowedFor`）：⑧⑨ 两条要看"下一拍开新场"，
   * 所以这里给足声望；本场是直接摆进 `state.weekendEvent` 的，不受它影响。
   */
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: T0,
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  weekendNoteContribution(ev, GID, 1)
  weekendNoteContribution(ev, CORE, 1)
  weekendNoteFlagshipDamage(ev, usedHp) // 锁定池子（`flagshipHpMax` 立起）＋ 核心条满 ⇒ 旗舰"现身"
  return { s, ev }
}

describe('本场收场顺延到"玩家打完 + 60 秒"（2026-09-27 船长令 · 2026-10-02「乙」只换触发点）', () => {
  it('① 收场点到 ＋ 正在打旗舰战 ⇒ **不结束**，顺延终点 = 那一拍 + 60 秒', () => {
    const { s, ev } = bossWorld()
    expect(WEEKEND_WINDOW_END_HOLD_MS).toBe(60_000)
    const r = weekendTick(s, ctx, DUE_AT, DUE_AT, true)
    expect(r.ended, '在打 ⇒ 本拍不结束').toBe(false)
    expect(ev.endedAtWallMs, '没结束').toBeUndefined()
    expect(ev.windowEndHoldUntilWallMs, '顺延终点 = 那一拍 + 60 秒').toBe(DUE_AT + WEEKEND_WINDOW_END_HOLD_MS)
    /** 每拍往后推（战斗还在打 ⇒ 终点一直跟着走） */
    weekendTick(s, ctx, DUE_AT + 10_000, DUE_AT + 10_000, true)
    expect(ev.windowEndHoldUntilWallMs).toBe(DUE_AT + 10_000 + WEEKEND_WINDOW_END_HOLD_MS)
  })

  it('② 打完后的 60 秒：没满不结束、满 60 秒那一拍才收场', () => {
    const { s, ev } = bossWorld()
    weekendTick(s, ctx, DUE_AT, DUE_AT, true) // 打斗中 ⇒ 起算顺延
    const holdUntil = DUE_AT + WEEKEND_WINDOW_END_HOLD_MS
    const a = weekendTick(s, ctx, holdUntil - 1, holdUntil - 1, false)
    expect(a.ended, '还差 1 毫秒 ⇒ 仍不结束').toBe(false)
    expect(ev.endedAtWallMs).toBeUndefined()
    const b = weekendTick(s, ctx, holdUntil, holdUntil, false)
    expect(b.ended, '满 60 秒 ⇒ 结束').toBe(true)
    expect(ev.endedAtWallMs, '结束时刻 = 顺延终点').toBe(holdUntil)
  })

  it('③ 零变化：收场点到且**没有**在打旗舰战 ⇒ 照旧立刻收场，且一个字段都不多写', () => {
    const { s, ev } = bossWorld()
    const r = weekendTick(s, ctx, DUE_AT, DUE_AT, false)
    expect(r.ended, '没在打 ⇒ 立刻结束（旧行为逐字不变）').toBe(true)
    expect(ev.endedAtWallMs).toBe(DUE_AT)
    expect(ev.windowEndHoldUntilWallMs, '从不顺延 ⇒ 不写顺延字段').toBeUndefined()
  })

  it('④ 顺延期间**章鱼人也不判得手**（船长同日裁定「要一起闸」）', () => {
    /** 池子填满 = 血条见底 ⇒ 视图本来会判 `down = octopus` */
    const { s, ev } = bossWorld(WEEKEND_FLAGSHIP_POOL_HP)
    expect(weekendFlagshipView(s, ev, DUE_AT, DUE_AT).down, '视图侧确实够得手').toBe('octopus')
    const held = weekendTick(s, ctx, DUE_AT, DUE_AT, true)
    expect(held.flagshipDown, '在打 ⇒ 不判章鱼').toBeUndefined()
    expect(held.ended).toBe(false)
    expect(ev.flagshipDown, '归属不写').toBeUndefined()
    expect(ev.endedAtWallMs, '本场不结束').toBeUndefined()
    /** 对照：同一状态、没在打 ⇒ 那一刻就判章鱼（顺延只挡"正在打的那一场"） */
    const free = bossWorld(WEEKEND_FLAGSHIP_POOL_HP)
    const claimed = weekendTick(free.s, ctx, DUE_AT, DUE_AT, false)
    expect(claimed.flagshipDown, '没在打 ⇒ 照旧判章鱼').toBe('octopus')
    expect(free.ev.endedAtWallMs).not.toBeUndefined()
  })

  it('⑤ 回归：该收场那一场**照常结算**（改动前是"整场白打"）', () => {
    /** 顺延之后：活动还活着 ⇒ 这一场的伤害台账 / 判沉 / 黑匣全走正常路径 */
    const { s, ev } = bossWorld()
    const box0 = countWare(s, 'blackbox-h')
    weekendTick(s, ctx, DUE_AT, DUE_AT, true) // 窗口到点那一拍：顺延，不结束
    /** 这一场把池子打空（`bossWorld` 已先记了 1,000 ⇒ 再补满剩下的） */
    weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP - 1_000)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, DUE_AT, null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(ev.flagshipHpDone, '伤害进台账').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    expect(ev.flagshipDown, '判玩家击沉').toBe('player')
    expect(r?.wreck, '残骸照发').toBeGreaterThan(0)
    expect(countWare(s, 'blackbox-h') - box0, '黑匣照到手').toBe(1)
    /** 对照：**不改口径**（= 那一拍直接按窗口结束）⇒ 同一串动作一个都不落账（改动前的病象） */
    const old = bossWorld()
    weekendTick(old.s, ctx, DUE_AT, DUE_AT, false)
    expect(old.ev.endedAtWallMs, '活动已结束').not.toBeUndefined()
    weekendNoteFlagshipDamage(old.ev, WEEKEND_FLAGSHIP_POOL_HP - 1_000)
    const stale = weekendApplyBattleOutcome(old.s, ctx, 'ink-flagship', true, DUE_AT, null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(stale, '已结束 ⇒ 结算直接回落（这就是玩家白打的那条路）').toBeNull()
  })

  it('⑥ 不设上限（船长裁定「甲」）：只要那场没打完，推多少次都不收场', () => {
    const { s, ev } = bossWorld()
    for (const at of [DUE_AT, DUE_AT + 600_000, DUE_AT + 3_600_000]) {
      const r = weekendTick(s, ctx, at, at, true)
      expect(r.ended, `t=+${Math.round((at - DUE_AT) / 60_000)} 分钟仍在打 ⇒ 不结束`).toBe(false)
      expect(ev.windowEndHoldUntilWallMs).toBe(at + WEEKEND_WINDOW_END_HOLD_MS)
    }
    expect(ev.endedAtWallMs).toBeUndefined()
  })

  it('⑦ 顺延字段随档往返（不过清洗器 = 读一次档就把玩家那一场作废）', () => {
    const { s, ev } = bossWorld()
    weekendTick(s, ctx, DUE_AT, DUE_AT, true)
    const hold = ev.windowEndHoldUntilWallMs
    expect(hold).toBe(DUE_AT + WEEKEND_WINDOW_END_HOLD_MS)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.windowEndHoldUntilWallMs, '读档后顺延终点还在').toBe(hold)
    /** 读档后仍按顺延走：满 60 秒才结束 */
    const now = hold ?? 0
    expect(weekendTick(s, ctx, now - 1, now - 1, false).ended).toBe(false)
    expect(weekendTick(s, ctx, now, now, false).ended).toBe(true)
  })

  /**
   * **⑧ 周排期场：周二 20:00 不再收场；收场点 = 下一期 T0**（**2026-10-02 船长令「乙」**）
   *
   * 旧口径（2026-09-27）：到点 = 自己 +96h。旧口径下"拖过下一场 T0 还没结束 ⇒ **下一场入侵取消**"
   * （船长同日令「到下周该开入侵的时候，我还没结束，那么下周的入侵就应该取消」）——
   * **该路径自「乙」起不可达**：旧场就是在下一期 T0 那一拍被收掉的。
   */
  it('⑧ 「乙」：周二 20:00 不收场；下一期 T0 一到就收场（打得再久也不再"取消下一场"）', () => {
    const { s, ev } = bossWorld()
    /** ① 旧口径的"周二 20:00"（T0+96h）：**已经不再收场**（没在打 ⇒ 本拍也不结束） */
    const tue = weekendTick(s, ctx, WINDOW_END, WINDOW_END, false)
    expect(tue.ended, '旧口径的"窗口到点"⇒ 现在不收场了').toBe(false)
    expect(ev.endedAtWallMs, '本场照旧活着').toBeUndefined()
    /** 周二之后到下一期 T0 之前：一路不收场（打不完就活着） */
    const later = weekendTick(s, ctx, WINDOW_END + 2 * 24 * 3_600_000, WINDOW_END + 2 * 24 * 3_600_000, false)
    expect(later.ended, '窗口关了也不收场').toBe(false)
    expect(ev.endedAtWallMs).toBeUndefined()
    /** ② 下一期 T0 到了（没在打）⇒ **这一拍收场** */
    const roll = weekendTick(s, ctx, NEXT_T0, NEXT_T0, false)
    expect(roll.ended, '下一期 T0 ⇒ 收场').toBe(true)
    expect(ev.endedAtWallMs, '结束时刻 = 下一期 T0 那一拍').toBe(NEXT_T0)
    /** ③ 旧场**先收场、再换场**：下一拍新一期照常开局（不是"取消下一场"） */
    const opened = weekendTick(s, ctx, NEXT_T0 + 1_000, NEXT_T0 + 1_000, false)
    expect(opened.started, '旧场已收场 ⇒ 新一期照常开').toBe(true)
    expect(s.weekendEvent?.seq, '编号 +1').toBe(ev.seq + 1)
    expect(s.weekendEvent?.startedAtWallMs, '新场 T0 = 那一期的 T0').toBe(NEXT_T0)
  })

  it('⑨ 下一期 T0 那一拍**正在打** ⇒ 顺延到打完 + 60 秒（2026-09-27 那条令只换触发点）', () => {
    const { s, ev } = bossWorld()
    const r = weekendTick(s, ctx, NEXT_T0, NEXT_T0, true)
    expect(r.ended, '在打 ⇒ 不收场').toBe(false)
    expect(ev.endedAtWallMs).toBeUndefined()
    expect(ev.windowEndHoldUntilWallMs, '顺延终点 = 那一拍 + 60 秒').toBe(NEXT_T0 + WEEKEND_WINDOW_END_HOLD_MS)
    /** 战斗结束，满 60 秒那一拍才收场；下一拍新一期开局 */
    const hold = NEXT_T0 + WEEKEND_WINDOW_END_HOLD_MS
    expect(weekendTick(s, ctx, hold - 1, hold - 1, false).ended, '还差 1 毫秒 ⇒ 仍不收场').toBe(false)
    expect(weekendTick(s, ctx, hold, hold, false).ended, '满 60 秒 ⇒ 收场').toBe(true)
    expect(ev.endedAtWallMs).toBe(hold)
    expect(weekendSettleAndGrant(s, ctx, hold), '这一场照常结算（没被作废）').not.toBeNull()
    const at = hold + 1_000
    expect(weekendTick(s, ctx, at, at, false).started, '旧场收场 ⇒ 新一期开').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs, '新场 T0 = 那一期的 T0').toBe(NEXT_T0)
    expect(weekendWindowOpen(at, NEXT_T0), '此刻确实在窗口内').toBe(true)
  })

  it('⑩ 弃场也不再"取消下一场"：拖过两期 ⇒ 每一期 T0 都照常收旧场、开新场', () => {
    const { s, ev } = bossWorld()
    /** 第一期 T0：在打 ⇒ 顺延 */
    weekendTick(s, ctx, NEXT_T0, NEXT_T0, true)
    expect(ev.endedAtWallMs).toBeUndefined()
    /** 过了顺延 ⇒ 收场 */
    const hold = NEXT_T0 + WEEKEND_WINDOW_END_HOLD_MS
    expect(weekendTick(s, ctx, hold, hold, false).ended).toBe(true)
    expect(weekendSettleAndGrant(s, ctx, hold), '旧场结算照发').not.toBeNull()
    /** 下一拍开局；再把它拖到第三期 T0 ⇒ 同样收场（不是"只取消一次"，而是每期都收） */
    const at = hold + 1_000
    weekendTick(s, ctx, at, at, false)
    const second = s.weekendEvent!
    expect(second.seq, '第二场').toBe(ev.seq + 1)
    const thirdT0 = NEXT_T0 + 7 * 24 * 3_600_000
    expect(weekendTick(s, ctx, thirdT0, thirdT0, false).ended, '第三期 T0 ⇒ 第二场也收场').toBe(true)
    const after = weekendTick(s, ctx, thirdT0 + 1_000, thirdT0 + 1_000, false)
    expect(after.started, '第三期照常开').toBe(true)
    expect(s.weekendEvent?.seq, '编号再 +1').toBe(second.seq + 1)
    expect(s.weekendEvent?.startedAtWallMs, 'T0 = 第三期 T0').toBe(thirdT0)
  })
})
