/**
 * **窗口到点的顺延：玩家打完再满 60 秒才收场**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**到点的延期到玩家打完1分钟后**」（前因：`weekend:sim` 的 `window` 场景坐实了
 * "活动窗口到点那一刻正在打的旗舰战**整场作废**"——母舰血条照掉到 0，但伤害台账 / 判沉 / 黑匣 /
 * 残骸 / 日志全丢）。
 *
 * 同日两条裁定（本次一并落）：
 * - **上限 = 甲：不设上限**（那场没打完就一直等；弃场由"下周开新场"自然兜住）；
 * - **章鱼人一起闸**：只要有没打完的旗舰战，本拍**既不由章鱼收走、也不按窗口结束**（否则掉线超 24h
 *   回来的那一拍，章鱼可能先把玩家正在打的那一场判走 —— 等于白延期）。
 *
 * 落点 = `weekendEvent.weekendTick`（引擎每拍调它）：
 * ③ 章鱼得手判据加"旗舰战在打就不判"；④ 窗口到点改成"在打就顺延、打完再满 60 秒才结束"。
 * ⚠ 顺延期间活动**仍然活着** ⇒ 战斗收尾走的是正常结算路径（结算侧一个字都不用改）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { countWare, createInitialState } from '../src/index'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendApplyBattleOutcome } from '../src/weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_WINDOW_END_HOLD_MS,
  WEEKEND_WINDOW_MS,
  weekendFlagshipView,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
  weekendT0Of,
  weekendTick,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
/**
 * ⚠ **必须用真 T0 当开场的开始时刻**：`weekendTick` 每拍先走 `ensureWeekendEvent`，而"一个窗口只开一场"
 * 的判据是"上一场开始至今不足一个窗口"⇒ 顺手编一个开始时刻会让它**在窗口到点那一拍另开一场**（把被测
 * 对象整个换掉）。取固定的 2026-09-27 12:00 反推最近的周五 20:00 ⇒ 与跑步日期无关、可复现。
 */
const T0 = weekendT0Of(Date.parse('2026-09-27T12:00:00+08:00'))
/** 窗口到点那一刻（正常模式 = T0 + 96h；此刻正落在"窗口已关、还没到下一个 T0"的区间里） */
const WINDOW_END = T0 + WEEKEND_WINDOW_MS

/** H 族入侵 ＋ 池子已锁定（**正常模式**：窗口到点那条路只在非调试档生效 ⇒ 不能开 `debugQuick`） */
function bossWorld(usedHp = 1_000): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
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

describe('窗口到点顺延到"玩家打完 + 60 秒"（2026-09-27 船长令）', () => {
  it('① 窗口到点 ＋ 正在打旗舰战 ⇒ **不结束**，顺延终点 = 那一拍 + 60 秒', () => {
    const { s, ev } = bossWorld()
    expect(WEEKEND_WINDOW_END_HOLD_MS).toBe(60_000)
    const r = weekendTick(s, ctx, WINDOW_END, WINDOW_END, true)
    expect(r.ended, '在打 ⇒ 本拍不结束').toBe(false)
    expect(ev.endedAtWallMs, '没结束').toBeUndefined()
    expect(ev.windowEndHoldUntilWallMs, '顺延终点 = 那一拍 + 60 秒').toBe(WINDOW_END + WEEKEND_WINDOW_END_HOLD_MS)
    /** 每拍往后推（战斗还在打 ⇒ 终点一直跟着走） */
    weekendTick(s, ctx, WINDOW_END + 10_000, WINDOW_END + 10_000, true)
    expect(ev.windowEndHoldUntilWallMs).toBe(WINDOW_END + 10_000 + WEEKEND_WINDOW_END_HOLD_MS)
  })

  it('② 打完后的 60 秒：没满不结束、满 60 秒那一拍才按窗口到点结束', () => {
    const { s, ev } = bossWorld()
    weekendTick(s, ctx, WINDOW_END, WINDOW_END, true) // 打斗中 ⇒ 起算顺延
    const holdUntil = WINDOW_END + WEEKEND_WINDOW_END_HOLD_MS
    const a = weekendTick(s, ctx, holdUntil - 1, holdUntil - 1, false)
    expect(a.ended, '还差 1 毫秒 ⇒ 仍不结束').toBe(false)
    expect(ev.endedAtWallMs).toBeUndefined()
    const b = weekendTick(s, ctx, holdUntil, holdUntil, false)
    expect(b.ended, '满 60 秒 ⇒ 结束').toBe(true)
    expect(ev.endedAtWallMs, '结束时刻 = 顺延终点').toBe(holdUntil)
  })

  it('③ 零变化：窗口到点且**没有**在打旗舰战 ⇒ 照旧立刻结束，且一个字段都不多写', () => {
    const { s, ev } = bossWorld()
    const r = weekendTick(s, ctx, WINDOW_END, WINDOW_END, false)
    expect(r.ended, '没在打 ⇒ 立刻结束（旧行为逐字不变）').toBe(true)
    expect(ev.endedAtWallMs).toBe(WINDOW_END)
    expect(ev.windowEndHoldUntilWallMs, '从不顺延 ⇒ 不写顺延字段').toBeUndefined()
  })

  it('④ 顺延期间**章鱼人也不判得手**（船长同日裁定「要一起闸」）', () => {
    /** 池子填满 = 血条见底 ⇒ 视图本来会判 `down = octopus` */
    const { s, ev } = bossWorld(WEEKEND_FLAGSHIP_POOL_HP)
    expect(weekendFlagshipView(s, ev, WINDOW_END, WINDOW_END).down, '视图侧确实够得手').toBe('octopus')
    const held = weekendTick(s, ctx, WINDOW_END, WINDOW_END, true)
    expect(held.flagshipDown, '在打 ⇒ 不判章鱼').toBeUndefined()
    expect(held.ended).toBe(false)
    expect(ev.flagshipDown, '归属不写').toBeUndefined()
    expect(ev.endedAtWallMs, '本场不结束').toBeUndefined()
    /** 对照：同一状态、没在打 ⇒ 那一刻就判章鱼（顺延只挡"正在打的那一场"） */
    const free = bossWorld(WEEKEND_FLAGSHIP_POOL_HP)
    const claimed = weekendTick(free.s, ctx, WINDOW_END, WINDOW_END, false)
    expect(claimed.flagshipDown, '没在打 ⇒ 照旧判章鱼').toBe('octopus')
    expect(free.ev.endedAtWallMs).not.toBeUndefined()
  })

  it('⑤ 回归：窗口到点那一场**照常结算**（改动前是"整场白打"）', () => {
    /** 顺延之后：活动还活着 ⇒ 这一场的伤害台账 / 判沉 / 黑匣全走正常路径 */
    const { s, ev } = bossWorld()
    const box0 = countWare(s, 'blackbox-h')
    weekendTick(s, ctx, WINDOW_END, WINDOW_END, true) // 窗口到点那一拍：顺延，不结束
    /** 这一场把池子打空（`bossWorld` 已先记了 1,000 ⇒ 再补满剩下的） */
    weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP - 1_000)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, WINDOW_END, null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(ev.flagshipHpDone, '伤害进台账').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    expect(ev.flagshipDown, '判玩家击沉').toBe('player')
    expect(r?.wreck, '残骸照发').toBeGreaterThan(0)
    expect(countWare(s, 'blackbox-h') - box0, '黑匣照到手').toBe(1)
    /** 对照：**不改口径**（= 那一拍直接按窗口结束）⇒ 同一串动作一个都不落账（改动前的病象） */
    const old = bossWorld()
    weekendTick(old.s, ctx, WINDOW_END, WINDOW_END, false)
    expect(old.ev.endedAtWallMs, '活动已结束').not.toBeUndefined()
    weekendNoteFlagshipDamage(old.ev, WEEKEND_FLAGSHIP_POOL_HP - 1_000)
    const stale = weekendApplyBattleOutcome(old.s, ctx, 'ink-flagship', true, WINDOW_END, null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(stale, '已结束 ⇒ 结算直接回落（这就是玩家白打的那条路）').toBeNull()
  })

  it('⑥ 不设上限（船长裁定「甲」）：只要那场没打完，推多少次都不结束', () => {
    const { s, ev } = bossWorld()
    for (const at of [WINDOW_END, WINDOW_END + 600_000, WINDOW_END + 3_600_000]) {
      const r = weekendTick(s, ctx, at, at, true)
      expect(r.ended, `t=+${Math.round((at - WINDOW_END) / 60_000)} 分钟仍在打 ⇒ 不结束`).toBe(false)
      expect(ev.windowEndHoldUntilWallMs).toBe(at + WEEKEND_WINDOW_END_HOLD_MS)
    }
    expect(ev.endedAtWallMs).toBeUndefined()
  })

  it('⑦ 顺延字段随档往返（不过清洗器 = 读一次档就把玩家那一场作废）', () => {
    const { s, ev } = bossWorld()
    weekendTick(s, ctx, WINDOW_END, WINDOW_END, true)
    const hold = ev.windowEndHoldUntilWallMs
    expect(hold).toBe(WINDOW_END + WEEKEND_WINDOW_END_HOLD_MS)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.windowEndHoldUntilWallMs, '读档后顺延终点还在').toBe(hold)
    /** 读档后仍按顺延走：满 60 秒才结束 */
    const now = hold ?? 0
    expect(weekendTick(s, ctx, now - 1, now - 1, false).ended).toBe(false)
    expect(weekendTick(s, ctx, now, now, false).ended).toBe(true)
  })
})
