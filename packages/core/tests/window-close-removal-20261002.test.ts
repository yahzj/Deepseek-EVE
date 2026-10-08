/**
 * **入侵收场机制改革：取消「周二 20:00 关窗」**（**2026-10-02 船长令「乙」**）
 *
 * 船长原话（照抄）：
 * > ① 「**周二 20:00 关窗的机制取消。**」
 * > ② （我按 §2 摆出三档与"软锁"风险后）「**乙。玩家召唤的不算在下一期。**」
 *
 * 定稿（现行规则见 `docs/design/weekend-invasion.md`）：
 * - **周排期场**（每周五 20:00 开的那种）：**不再**按"自己 +96h（＝周二 20:00）"收场；
 *   改为 **下一期 T0 已到** ⇒ 收场（这就是"乙"里那条兜底，防"一场打不完就永远占位"的软锁）；
 * - **玩家召唤场**（信号发射器，`beaconLit`）：**豁免**上面那条（「玩家召唤的不算在下一期」），
 *   改看**它自己那 96 小时**（＝发射器既有口径"这一场按既有规则活满 96 小时窗口"）；
 * - 两者都保留 **2026-09-27 的顺延**（正在打旗舰战 ⇒ 顺延到打完 + 60 秒；那条令只换触发点）；
 * - **开局窗口一字不动**（周五 20:00 起 96h 内才允许开新场）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { INVASION_BEACON_ITEM_ID, useInvasionBeacon } from '../src/consumables'
import { addWare } from '../src/inventory'
import {
  WEEKEND_WINDOW_END_HOLD_MS,
  WEEKEND_WINDOW_MS,
  weekendCoreCandidates,
  weekendT0Of,
  weekendTick,
  weekendWindowOpen,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const H = 3_600_000

/** 周二 20:00 那一拍（旧口径的"关窗"点）= T0 + 96h */
const WINDOW_END = (t0: number) => t0 + WEEKEND_WINDOW_MS
/** 下一期 T0 = T0 + 7 天 */
const NEXT_T0 = (t0: number) => t0 + 7 * 24 * H

/**
 * 一个"周排期场"的世界：**真实 T0** 开局（`startedAtWallMs = t0`）＋ 声望够 ＋ 满探索。
 * `beaconLit` 默认不写 ⇒ 它是**周排期场**；传 `true` 造"玩家召唤场"。
 */
function world(t0: number, opts: { beaconLit?: boolean; startedAt?: number } = {}): {
  s: GameState
  ev: WeekendEventState
  t0: number
} {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  const cands = weekendCoreCandidates(s, ctx)
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: opts.startedAt ?? t0,
    coreId: cands[0]!,
    peripheryIds: [],
    family: 'R',
    contributed: {},
    ...(opts.beaconLit === true ? { beaconLit: true } : {}),
  }
  s.weekendEvent = ev
  return { s, ev, t0 }
}

/** 一个周五 20:00（刻意避开首场特例那一周） */
const T0 = weekendT0Of(Date.parse('2026-10-15T12:00:00+08:00'))

describe('「乙」周排期场：周二 20:00 不再收场，收场点 = 下一期 T0', () => {
  it('① 周二 20:00（自己 +96h）那一拍**不收场**：打不完就一直活着', () => {
    const { s, ev, t0 } = world(T0)
    const tue = weekendTick(s, ctx, WINDOW_END(t0), WINDOW_END(t0), false)
    expect(tue.ended, '旧口径的"关窗"点 ⇒ 现在不收场').toBe(false)
    expect(ev.endedAtWallMs, '本场未结束').toBeUndefined()
    /** 再往后（周三、周四……）同样不收场 */
    for (const t of [WINDOW_END(t0) + 24 * H, WINDOW_END(t0) + 48 * H, NEXT_T0(t0) - 1]) {
      expect(weekendTick(s, ctx, t, t, false).ended, `t=${new Date(t).toISOString()} 仍不收场`).toBe(false)
      expect(ev.endedAtWallMs).toBeUndefined()
    }
  })

  it('② 下一期 T0 一到 ⇒ 收场；再下一拍新一期照常开（不再"取消下一场"）', () => {
    const { s, ev, t0 } = world(T0)
    const roll = weekendTick(s, ctx, NEXT_T0(t0), NEXT_T0(t0), false)
    expect(roll.ended, '下一期 T0 ⇒ 收场').toBe(true)
    expect(ev.endedAtWallMs, '结束时刻 = 那一拍').toBe(NEXT_T0(t0))
    const at = NEXT_T0(t0) + 1_000
    const opened = weekendTick(s, ctx, at, at, false)
    expect(opened.started, '旧场已收场 ⇒ 新一期照常开').toBe(true)
    expect(s.weekendEvent?.seq, '编号 +1').toBe(ev.seq + 1)
    expect(s.weekendEvent?.startedAtWallMs, '新场 T0 = 那一期的 T0').toBe(NEXT_T0(t0))
    console.log(`  [读数] 周排期场：周二 20:00 不收场 · 下一期 T0（+${(NEXT_T0(t0) - t0) / H}h）收场并换期`)
  })

  it('③ 下一期 T0 那一拍**正在打** ⇒ 顺延到打完 + 60 秒（2026-09-27 那条令只换触发点）', () => {
    const { s, ev, t0 } = world(T0)
    const r = weekendTick(s, ctx, NEXT_T0(t0), NEXT_T0(t0), true)
    expect(r.ended, '在打 ⇒ 不收场').toBe(false)
    expect(ev.windowEndHoldUntilWallMs, '顺延终点 = 那一拍 + 60 秒').toBe(NEXT_T0(t0) + WEEKEND_WINDOW_END_HOLD_MS)
    const hold = NEXT_T0(t0) + WEEKEND_WINDOW_END_HOLD_MS
    expect(weekendTick(s, ctx, hold - 1, hold - 1, false).ended, '还差 1 毫秒').toBe(false)
    expect(weekendTick(s, ctx, hold, hold, false).ended, '满 60 秒 ⇒ 收场').toBe(true)
    expect(ev.endedAtWallMs).toBe(hold)
  })
})

describe('「乙」玩家召唤场：豁免周排期收场，保留自己那 96 小时', () => {
  it('④ 召唤场**不**被下一期 T0 收场（"玩家召唤的不算在下一期"）', () => {
    /**
     * 召唤场：起点 = 任意时刻（发射器口径"起点 = 现在"）。
     * ⚠ **豁免真正生效的区间**：自己的 96h 还没走完时撞上下一期 T0 —— 也就是**周一 20:00 之后**点的火
     * （更早点火的话，它自己那 96h 本来就在下一期 T0 之前到点，谈不上"被周排期收走"）。
     * 这里取**周三 20:00** 点火：自己的到点是**周日**，而下一期 T0 是**周五**。
     */
    const start = T0 + 5 * 24 * H
    const { s, ev } = world(T0, { beaconLit: true, startedAt: start })
    expect(start + WEEKEND_WINDOW_MS, '先决：自己的到点在下一期 T0 之后').toBeGreaterThan(NEXT_T0(T0))
    /** 下一期 T0 那一拍：周排期收场**管不到它** */
    const roll = weekendTick(s, ctx, NEXT_T0(T0), NEXT_T0(T0), false)
    expect(roll.ended, '召唤场 ⇒ 周排期收场管不到它').toBe(false)
    expect(roll.started, '（豁免的是"收场"，不是"开局"——旧场还活着 ⇒ 也不开新场）').toBe(false)
    expect(ev.endedAtWallMs, '仍然活着').toBeUndefined()
    expect(ev.windowEndHoldUntilWallMs, '不是"顺延"，是压根不收场').toBeUndefined()
    console.log('  [读数] 召唤场：下一期 T0 收不走它（豁免只在"自己 +96h 还没到"时才有意义）')
  })

  it('⑤ 召唤场**自己那 96 小时**到点 ⇒ 收场（＝发射器既有口径"活满 96 小时窗口"）', () => {
    const start = T0 + 2 * H
    const { s, ev } = world(T0, { beaconLit: true, startedAt: start })
    const own = start + WEEKEND_WINDOW_MS
    expect(weekendTick(s, ctx, own - 1, own - 1, false).ended, '还差 1 毫秒 ⇒ 不收场').toBe(false)
    const r = weekendTick(s, ctx, own, own, false)
    expect(r.ended, '自己 +96h ⇒ 收场').toBe(true)
    expect(ev.endedAtWallMs).toBe(own)
    /** ⚠ 这条自到点是**防软锁**的（没有它，核心条没打满的召唤场会永远占位） */
    console.log(`  [读数] 召唤场自到点：起点 +${WEEKEND_WINDOW_MS / H}h`)
  })

  it('⑥ 召唤场收场后：**本周的周排期入侵照常开**（"不算在下一期"的另一半）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 777 })
    s.exploredGalaxies = [...ctx.galaxies.keys()]
    s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
    s.standings = { ...s.standings, dsi: 100 }
    s.awayGalaxy = weekendCoreCandidates(s, ctx)[0]
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    expect(useInvasionBeacon(s, ctx).ok, '点火成功').toBe(true)
    const summoned = s.weekendEvent!
    expect(summoned.beaconLit, '这是玩家召唤场').toBe(true)
    expect(summoned.startedAtWallMs, '起点 = 现在（不是周排期 T0）').toBe(s.wallMs ?? summoned.startedAtWallMs)
    /** 收掉它（模拟玩家打完 ⇒ 只写结束时刻，结算不是本用例的主题） */
    summoned.endedAtWallMs = summoned.startedAtWallMs + 1
    /** 下一期 T0（周五 20:00）那一拍 ⇒ 本期自己的那场**照常开** */
    const r = weekendTick(s, ctx, T0, T0, false)
    expect(r.started, '召唤场收掉后 ⇒ 当期周排期入侵照常开').toBe(true)
    expect(s.weekendEvent?.beaconLit, '新开的是周排期场（不是召唤场）').toBeUndefined()
    expect(s.weekendEvent?.startedAtWallMs, 'T0 = 那一期的 T0').toBe(T0)
    console.log('  [读数] 召唤场收场后：当期周排期入侵照常在 T0 开')
  })
})

describe('「乙」开局窗口一字不动', () => {
  it('⑦ 窗口外（周三）仍不开新场；窗口内照常开', () => {
    const { s, ev, t0 } = world(T0)
    ev.endedAtWallMs = t0 + H // 早早打完
    /** 窗口外：周二 20:00 之后、下一个 T0 之前 */
    const out = WINDOW_END(t0) + 24 * H
    expect(weekendWindowOpen(out, weekendT0Of(out)), '此刻确实在窗口外').toBe(false)
    expect(weekendTick(s, ctx, out, out, false).started, '窗口外 ⇒ 不开').toBe(false)
    /** 下一个 T0 ⇒ 开 */
    const next = weekendTick(s, ctx, NEXT_T0(t0), NEXT_T0(t0), false)
    expect(next.started, '下一个 T0 ⇒ 开').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs).toBe(NEXT_T0(t0))
  })
})
