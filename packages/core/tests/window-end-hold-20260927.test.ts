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
 * "**窗口内 ＋ 上一场已结束**"⇒ 顺手编一个开始时刻会让它**在窗口到点那一拍先收场、再另开一场**
 * （把被测对象整个换掉）。
 * （2026-10-02 船长令「甲」之前，这里还多一层"上一场开始至今不足一个窗口（96h）"的兜底；该判据已作废，
 *  见 `docs/design/invasion-open-gate-20261002.md` —— 本文件三条断言在甲下逐字不变。）
 * ⚠ 还要**避开首场特例那一周**（`WEEKEND_FIRST_T0_WALL_MS` = 2026-09-25 22:00：那一周里
 * `ensureWeekendEvent` 会按"首场"再开一场）⇒ 取 10 月中旬反推的周五 20:00，与跑步日期无关、可复现。
 */
const T0 = weekendT0Of(Date.parse('2026-10-15T12:00:00+08:00'))
/** 窗口到点那一刻（正常模式 = T0 + 96h；此刻正落在"窗口已关、还没到下一个 T0"的区间里） */
const WINDOW_END = T0 + WEEKEND_WINDOW_MS
/** 下一场入侵的 T0（周排期：T0 ＋ 一周）——"拖过一周就取消下一场"那条判据的分界 */
const NEXT_T0 = T0 + 7 * 24 * 3_600_000

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

  /**
   * **⑧ 拖过下一场 ⇒ 下一场入侵取消**（**2026-09-27 船长令**：「**假设，入侵我拖了一周，到下周该开入侵
   * 的时候，我还没结束。那么下周的入侵就应该取消。**」）——旧场照旧活着由玩家打完，**本周不开新场**；
   * 而且这条规则顺带保证了"永远不会覆盖未结束的场"（被覆盖的场永远结不了算：贡献奖/声望/结束通讯全丢）。
   */
  it('⑧ 入侵拖过下一场 T0 还没结束 ⇒ **下一场取消**（不开新场，旧场照旧活着）', () => {
    const { s, ev } = bossWorld()
    /** 弃场：窗口到点后一直"在打"（顺延每拍往后推） */
    for (const t of [WINDOW_END, WINDOW_END + 6 * 3_600_000, NEXT_T0 - 1]) {
      const r = weekendTick(s, ctx, t, t, true)
      expect(r.ended, `t=+${((t - WINDOW_END) / 3_600_000).toFixed(1)}h 仍在打 ⇒ 一直顺延`).toBe(false)
    }
    /** 下一场的 T0 到了、玩家还没结束 ⇒ **那一周取消** */
    const cancelled = weekendTick(s, ctx, NEXT_T0, NEXT_T0, true)
    expect(cancelled.started, '本周不开新场（入侵取消）').toBe(false)
    expect(s.weekendEvent?.seq, '手上还是旧场').toBe(ev.seq)
    expect(ev.endedAtWallMs, '旧场照旧活着（没被强行收口、也没被顶掉）').toBeUndefined()
    expect(s.weekendEvent, '旧场对象原样在手（没被换掉）').toBe(ev)
    /** 再往下拖一整周 ⇒ 再取消一场（不是"只取消一次"） */
    const thirdT0 = NEXT_T0 + 7 * 24 * 3_600_000
    const again = weekendTick(s, ctx, thirdT0, thirdT0, true)
    expect(again.started, '再下一周同样取消').toBe(false)
    expect(s.weekendEvent, '旧场仍在').toBe(ev)
    expect(ev.endedAtWallMs).toBeUndefined()
  })

  it('⑨ 取消不是永久：拖完之后打完，落在某一周窗口内 ⇒ 当周照常补开新场并结算旧场', () => {
    const { s, ev } = bossWorld()
    weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP - 1_000) // 池子快空 ⇒ 玩家这一场能收掉
    weekendTick(s, ctx, WINDOW_END, WINDOW_END, true)
    weekendTick(s, ctx, NEXT_T0, NEXT_T0, true) // 下一场取消
    expect(ev.endedAtWallMs).toBeUndefined()
    /** 玩家在下一周的窗口里收掉它（战斗结束 + 顺延 60 秒走完 ⇒ 按窗口到点收场） */
    const atHit = NEXT_T0 + 12 * 3_600_000
    const hit = weekendTick(s, ctx, atHit, atHit, false)
    expect(hit.ended, '旧场这一拍收口').toBe(true)
    /**
     * ⚠ 结束时刻 = **收口那一拍**（④ 走的就是"现在"）：窗口早过了（`WINDOW_END`），
     * 占比评估不受影响 —— NPC 铺底在外围 48h / 核心 72h 就封顶 1，晚评与到点评逐字同值。
     */
    expect(ev.endedAtWallMs).toBe(atHit)
    expect(ev.endedAtWallMs! >= WINDOW_END, '收口不早于本场窗口到点').toBe(true)
    expect(weekendSettleAndGrant(s, ctx, atHit), '旧场照常结算').not.toBeNull()
    /** 下一拍：当周（下一周的窗口还开着）照常开新场 */
    const at = NEXT_T0 + 12 * 3_600_000 + 1_000
    const next = weekendTick(s, ctx, at, at, false)
    expect(next.started, '打完就该有新的这一场').toBe(true)
    expect(s.weekendEvent?.seq, '编号 +1').toBe(ev.seq + 1)
    expect(s.weekendEvent?.startedAtWallMs, '新场 T0 = 当周 T0').toBe(NEXT_T0)
    expect(weekendWindowOpen(at, NEXT_T0), '此刻确实在窗口内').toBe(true)
  })

  it('⑩ 拖到窗口都过了才打完 ⇒ 当周不补开（等下一个 T0），也不丢结算', () => {
    const { s, ev } = bossWorld()
    weekendTick(s, ctx, WINDOW_END, WINDOW_END, true)
    weekendTick(s, ctx, NEXT_T0, NEXT_T0, true) // 下一场取消
    /** 玩家拖到下一周的窗口也过完（周三）才收场 */
    const late = NEXT_T0 + 5 * 24 * 3_600_000 // 周三（窗口在周二 20:00 就关了）
    const hit = weekendTick(s, ctx, late, late, false)
    expect(hit.ended, '旧场收口').toBe(true)
    expect(weekendSettleAndGrant(s, ctx, late), '结算照旧').not.toBeNull()
    /** 窗口已过 ⇒ 不补开；等下一个 T0 才开 */
    const no = weekendTick(s, ctx, late + 1_000, late + 1_000, false)
    expect(no.started, '窗口之外 ⇒ 不开').toBe(false)
    const nextT0 = NEXT_T0 + 7 * 24 * 3_600_000
    const ok = weekendTick(s, ctx, nextT0, nextT0, false)
    expect(ok.started, '下一个 T0 ⇒ 照常开').toBe(true)
    expect(s.weekendEvent?.seq, '编号 +1').toBe(ev.seq + 1)
  })
})
