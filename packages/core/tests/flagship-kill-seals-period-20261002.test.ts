/**
 * **本期击杀旗舰 ⇒ 本期封盘**（**船长 2026-10-02 令「甲」**）。
 *
 * ## 起因（一号当日的玩家报障取证 · 原话照抄）
 *
 * > 「**击败旗舰打空血量后，被弹出战斗，且旗舰血量全满**」
 *
 * 一号用真实函数跑了整条链路，**不是**"同一场血量被重置"（全仓只有一个池子写入点、只做加法；
 * 换场即全新对象），而是：**击杀旗舰 ⇒ 本场入侵结束 ⇒ 下一拍立刻又开一场新的入侵**
 * （＝ 2026-10-02「甲」令「只看当前有没有正在进行」那条的**已知后果**：窗口内可连开）
 * ⇒ 新一场的旗舰在**首次接战**那一刻锁成满血 150,000 ⇒ 玩家看到「**旗舰血量全满**」。
 * 战利品没丢（探针读数 `flagshipKilled = { blackBox: true, wreck: 90 }` ✓），丢的是观感。
 *
 * ## 船长裁定「甲」的口径
 *
 * - **只有"玩家击杀旗舰"这一种结束方式封盘**；章鱼人得手（`'octopus'`）与到点收场（`'window'`）**照旧可连开**；
 * - **封盘只封本期**：下一期 T0 一到照常开新场；
 * - ⚠ **不封**玩家召唤场（信号发射器点火）与**不封**补偿补场（`weekendCompensation` 那一场光环）。
 *
 * 本文件锁六件事：① 真结算链打空池子 ⇒ 留档 `player` ⇒ **封盘**（不再开新场）；
 * ② 本期内**反复调**都不开（幂等）；③ 下一期 T0 到 ⇒ **解封**；④ 章鱼人得手 ⇒ **不封盘**；
 * ⑤ 到点收场 ⇒ 不封盘；⑥ 封盘期间**信号发射器照旧能点火**、**补偿补场照旧能开**。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addWare } from '../src/inventory'
import { INVASION_BEACON_ITEM_ID, useInvasionBeacon } from '../src/consumables'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_WINDOW_MS,
  weekendCoreCandidates,
  weekendPeriodSealedByKill,
  weekendT0Of,
  weekendTick,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import { weekendFlagshipSpecOf, weekendResolveBattle, weekendSettleAndGrant } from '../src/weekendBattle'
import { openWeekendMakeupIfDue } from '../src/weekendCompensation'

const ctx = buildSimContext()
const H = 3_600_000
/** 本期 T0 = 2026-10-02 20:00（本地）——与补偿批同一把尺 */
const T0 = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()
const NOW = T0 + H
const NEXT_T0 = weekendT0Of(T0 + 7 * 24 * H) // 下一期 T0（那一周的周五 20:00）

function base(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  return s
}

const coreIdOf = (s: GameState): string => weekendCoreCandidates(s, ctx)[0]!

/** 一场进行中的 BOSS 族（H）入侵：池子已接战、核心条已满（⇒ 旗舰现身，能进旗舰战） */
function bossEvent(s: GameState, over: Partial<WeekendEventState> = {}): WeekendEventState {
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: T0,
    coreId: coreIdOf(s),
    peripheryIds: [],
    family: 'H',
    contributed: {},
    flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: 0,
    ...over,
  }
  ev.contributed = { [ev.coreId]: 1, ...(over.contributed ?? {}) }
  s.weekendEvent = ev
  return ev
}

/** **真实击杀链**：把池子打空 ⇒ `weekendResolveBattle` 判击沉并结束本场 ⇒ 收尾写留档快照 */
function killFlagship(s: GameState): void {
  /** 旗舰 spec 走生产入口（核心条已满 ⇒ 旗舰已现身） */
  const spec = weekendFlagshipSpecOf(s, ctx, NOW)
  expect(spec, '旗舰战 spec 应取得到').toBeTruthy()
  const r = weekendResolveBattle(s, ctx, spec!, 'win', NOW, WEEKEND_FLAGSHIP_POOL_HP, 77_777)
  expect(r.flagshipKilled, '击沉成立（这是一条真实结算链）').toBeTruthy()
  expect(s.weekendEvent!.flagshipDown).toBe('player')
  expect(s.weekendEvent!.endedAtWallMs, '本场入侵结束').toBe(NOW)
  weekendSettleAndGrant(s, ctx, NOW)
}

describe('本期击杀旗舰 ⇒ 本期封盘（船长 2026-10-02 令「甲」）', () => {
  it('① 真实击杀链：击沉 ⇒ 留档 `player` ⇒ 下一拍**不再开新场**（这就是玩家看到的"旗舰血量全满"的真因）', () => {
    const s = base()
    bossEvent(s)
    killFlagship(s)
    expect(s.weekendLastResult?.flagshipOutcome, '留档：玩家亲手击沉').toBe('player')
    expect(weekendPeriodSealedByKill(s, T0), '本期封盘').toBe(true)
    const t = weekendTick(s, ctx, NOW + 1000, NOW, false)
    expect(t.started, '**不开新场**（改前：当拍就开一场满血旗舰）').toBe(false)
    expect(s.weekendEvent?.endedAtWallMs, '手上那场仍是已结束的那场').toBe(NOW)
    console.log('  [读数] 击杀旗舰 ⇒ 留档 player ⇒ 本期（T0 起）不再开新场；改前当拍就会开一场满血旗舰')
  })

  it('② 本期内**反复调都不开**（幂等：窗口内任意时刻都封着）', () => {
    const s = base()
    bossEvent(s)
    killFlagship(s)
    for (const dt of [2 * H, 24 * H, WEEKEND_WINDOW_MS - 1000]) {
      expect(weekendTick(s, ctx, T0 + dt, T0 + dt, false).started, `T0+${Math.round(dt / H)}h 仍不开`).toBe(false)
      expect(weekendPeriodSealedByKill(s, T0)).toBe(true)
    }
  })

  it('③ 下一期 T0 到 ⇒ **解封**（封盘只封本期）', () => {
    const s = base()
    bossEvent(s)
    killFlagship(s)
    /** 下一期的窗口内（T0' 那一刻）——换期后 `endedAtWallMs < 新 T0` ⇒ 自动解封 */
    expect(weekendPeriodSealedByKill(s, NEXT_T0), '换期后不再封盘').toBe(false)
    const t = weekendTick(s, ctx, NEXT_T0 + 1000, NEXT_T0 + 1000, false)
    expect(t.started, '下一期照常开新场').toBe(true)
    expect(s.weekendEvent?.startedAtWallMs, 'T0 = 那一期的 T0').toBe(NEXT_T0)
    expect(s.weekendEvent?.flagshipHpMax, '新一场的池子还没接战（首战才锁满）').toBeUndefined()
  })

  it('④ 章鱼人得手（留档 `octopus`）⇒ **不封盘**：本期内照旧可连开', () => {
    const s = base()
    bossEvent(s, { flagshipDown: 'octopus', endedAtWallMs: NOW, flagshipHpDone: 100_000, octopusHpDone: 50_000 })
    weekendSettleAndGrant(s, ctx, NOW)
    expect(s.weekendLastResult?.flagshipOutcome, '留档：章鱼人').toBe('octopus')
    expect(weekendPeriodSealedByKill(s, T0), '不封盘').toBe(false)
    expect(weekendTick(s, ctx, NOW + 1000, NOW, false).started, '照旧开新场').toBe(true)
  })

  it('⑤ 到点收场（留档 `window`）⇒ 不封盘', () => {
    const s = base()
    bossEvent(s, { flagshipHpDone: 30_000, endedAtWallMs: NOW })
    weekendSettleAndGrant(s, ctx, NOW)
    expect(s.weekendLastResult?.flagshipOutcome, '留档：到点').toBe('window')
    expect(weekendPeriodSealedByKill(s, T0)).toBe(false)
    expect(weekendTick(s, ctx, NOW + 1000, NOW, false).started).toBe(true)
  })

  it('⑥ 封盘期间：**信号发射器照旧能点火** · **补偿补场照旧能开**（两条都不在治理范围内）', () => {
    const s = base()
    bossEvent(s)
    killFlagship(s)
    expect(weekendTick(s, ctx, NOW + 1000, NOW, false).started, '先确认本期确实封盘').toBe(false)
    /** 玩家自己花一枚发射器点火 ⇒ 照旧成立（主动选择，不是"自动连开"） */
    addWare(s, INVASION_BEACON_ITEM_ID, 1)
    const r = useInvasionBeacon(s, ctx)
    expect(r.ok, r.ok ? '' : String(r.error)).toBe(true)
    expect(s.weekendEvent?.endedAtWallMs, '点出一场新场（未结束）').toBeUndefined()
    /** 发射器点出来的族是**随机**的（R/H，2026-10-02 另一条船长令）——这里只断言"确实是一支合法的入侵族" */
    expect(['R', 'H']).toContain(s.weekendEvent?.family)
    /** 受影响档的补偿补场：与本期封盘互不干涉（那条路是承诺，不是自动连开） */
    const c = base()
    bossEvent(c)
    killFlagship(c)
    c.weekendCompensation = { track: 'makeup', decidedAtWallMs: NOW }
    /** 补场窗口 = 周三 20:00 ~ 周五 20:00（本批取 2026-10-07 20:00 那一格） */
    const WED = new Date(2026, 9, 7, 20, 0, 0, 0).getTime()
    expect(weekendPeriodSealedByKill(c, T0), '这一档本期确实封盘').toBe(true)
    expect(openWeekendMakeupIfDue(c, ctx, WED), '补场照旧开（不受封盘影响）').toBe(true)
    expect(c.weekendEvent?.family, '补场族 = 光环科技').toBe('R')
  })
})
