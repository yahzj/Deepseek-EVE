/**
 * **主力舰队掉落稀有残骸（进残骸场）**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**主力舰队添加一个稀有残骸掉落**」→ 追问落点答「**进残骸场**」→
 * 追问频次答「**不设残骸上限**」。
 *
 * 口径（本次一并定下）：
 * 1. **落点 = 该星系的入侵残骸场**（`weekendWrecks[galaxyId].rare/rareBy`，与常驻残骸场的
 *    `galaxyWrecks.rare/rareBy` 同义不同账）⇒ 打捞时**稀有池优先、本轮必出一件**；
 * 2. **只在战斗里打赢**才算（主动出击全歼 `win` · 迎袭击退 `repel`）；**文字结算**（`offlineRepel`）
 *    与失利（`loss`）不算；
 * 3. **不设每场上限**；
 * 4. 打捞对象选「入侵残骸」也要能捞到它（改前那条"选入侵 ⇒ 稀有不参与"的口径随之作废）。
 *
 * 本文件钉住：注入 · 上限不存在（连打连掉）· 文字结算不算 · 选"入侵"能捞到 · 稀有轮不白扣普通池 ·
 * 箱子不随矿物衰减消失 · 随档往返。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/index'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  advanceWeekendWreckDecay,
  injectWeekendWreck,
  pullRareWreck,
  rareStockForTargetOf,
  WEEKEND_WRECK_DECAY_MS,
  WEEKEND_WRECK_TARGET,
  weekendRareWreckCountOf,
  weekendWreckDensityOf,
  wreckGroupStocksOf,
} from '../src/salvage'
import { salvageRoundMulOf } from '../src/salvage'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf, weekendNoteFlagshipPlayerKill } from '../src/weekendBattle'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendNoteContribution } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext('zh')
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
const MAIN = 'ink-main'
const RARE_H = 'wreck-rare-h-hi'

/** 一场入侵（外围未夺回 ⇒ 打的是外围的主动出击） */
function invasion(gid = GID): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 1,
    /**
     * ⚠ 必须用**当下**：NPC 铺底是 `(now − T0)/48h` 的时间函数，写成 1_000（1970 年）会让该星系
     * "早就被铺底夺回" ⇒ `weekendZoneLiveAt` 为假 ⇒ 整场不结算（当年那条"打完什么都不结算"的翻版）。
     */
    startedAtWallMs: Date.now(),
    coreId: CORE,
    peripheryIds: [gid],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return { s, ev }
}

/** 打赢一场主力舰队（走真入口 `weekendApplyBattleOutcome`；`victory`/`source`/`kind` 可调） */
function winMain(
  s: GameState,
  opts?: { gid?: string; victory?: boolean; source?: 'battle' | 'text'; kind?: 'assault' | 'ambush' },
): ReturnType<typeof weekendApplyBattleOutcome> {
  const gid = opts?.gid ?? GID
  return weekendApplyBattleOutcome(s, ctx, MAIN, opts?.victory ?? true, Date.now(), null, {
    kind: opts?.kind ?? 'assault',
    galaxyId: gid,
    ...(opts?.source !== undefined ? { source: opts.source } : {}),
  })
}

describe('主力舰队掉落稀有残骸 · 进残骸场（2026-09-27 船长令）', () => {
  /** ① 打赢 ⇒ 该星系入侵残骸场 +1 件箱子（按卡记账），并写一条入账日志 */
  it('① 打赢主力舰队 ⇒ 入侵残骸场 +1 件（按卡记账）＋ 一条日志', () => {
    const { s } = invasion()
    const logs0 = s.logs.length
    winMain(s)
    expect(weekendRareWreckCountOf(s, GID), '场里多了一具箱子').toBe(1)
    expect(s.weekendWrecks?.[GID]?.rareBy?.[MAIN], '按打它的那张卡记账').toBe(1)
    const log = s.logs.slice(logs0).find((l) => l.textId === 'core.weekend.043')
    expect(log, '有一条说明箱子落在哪的日志').not.toBeUndefined()
    expect(log!.text, '日志点名星系').toContain(ctx.galaxies.get(GID)?.name ?? GID)
  })

  /** ② **不设上限**（船长令）：连打连掉。
   *  ⚠ 测试档要关掉调试快进：调试模式一场 +50% 进度，打两场该星系就被夺回、后续场次不再结算。 */
  it('② 不设每场上限：连打几次就掉几件', () => {
    const { s } = invasion()
    s.debugQuick = false // 正常档 +10%/场 ⇒ 5 场仍在该星系的占领期内
    for (let i = 0; i < 5; i += 1) winMain(s)
    expect(weekendRareWreckCountOf(s, GID)).toBe(5)
    expect(s.weekendWrecks?.[GID]?.rareBy?.[MAIN]).toBe(5)
  })

  /** ③ **文字结算不算**（离线 / 无人应答自动结算）；失利也不算；战斗里击退遇袭算 */
  it('③ 文字结算与失利都不掉；战斗里击退算', () => {
    const text = invasion()
    winMain(text.s, { kind: 'ambush', source: 'text' }) // 遇袭文字结算 ⇒ outcome = offlineRepel
    expect(weekendRareWreckCountOf(text.s, GID), '文字结算不掉').toBe(0)
    const lose = invasion()
    winMain(lose.s, { kind: 'ambush', victory: false })
    expect(weekendRareWreckCountOf(lose.s, GID), '战败不掉').toBe(0)
    const repel = invasion()
    winMain(repel.s, { kind: 'ambush' }) // 迎袭击退（战斗）⇒ outcome = repel
    expect(weekendRareWreckCountOf(repel.s, GID), '战斗里击退遇袭算').toBe(1)
  })

  /** ④ **选「入侵残骸」打捞也能捞到它**（改前那条"选入侵 ⇒ 稀有不参与"作废） */
  it('④ 选「入侵残骸」打捞 ⇒ 捞出本族的稀有箱子；箱在场就在', () => {
    const { s } = invasion()
    winMain(s)
    injectWeekendWreck(s, GID, 40, 'H') // 普通矿物也来一点（同场通常一起注入）
    expect(rareStockForTargetOf(s, ctx, GID, WEEKEND_WRECK_TARGET), '选入侵时能看见箱子').toBe(1)
    const got = pullRareWreck(s, GID, ctx, WEEKEND_WRECK_TARGET)
    expect(got, '捞到的就是主力舰队那一族的箱子').toBe(RARE_H)
    expect(weekendRareWreckCountOf(s, GID), '捞走一件就少一件').toBe(0)
    expect(weekendWreckDensityOf(s, GID), '**稀有不白扣普通池**（2026-09-25 那条口径照旧）').toBe(40)
  })

  /** ⑤ 箱子**不随矿物衰减消失**（矿物到点即消、箱子留到被捞走） */
  it('⑤ 48h 到点：矿物没了，箱子还在', () => {
    const { s } = invasion()
    winMain(s)
    injectWeekendWreck(s, GID, 30, 'H')
    advanceWeekendWreckDecay(s, WEEKEND_WRECK_DECAY_MS + 1_000)
    expect(weekendWreckDensityOf(s, GID), '矿物归零').toBe(0)
    expect(weekendRareWreckCountOf(s, GID), '箱子还在场里').toBe(1)
    expect(s.weekendWrecks?.[GID]?.family, '来源族也还在（打捞池要用）').toBe('H')
    expect(pullRareWreck(s, GID, ctx, WEEKEND_WRECK_TARGET), '到点之后照样捞得到').toBe(RARE_H)
  })

  /** ⑥ 打捞页要看得见那一行（`wreckGroupStocksOf` 给入侵行 ＋ 稀有件数） */
  it('⑥ 只剩箱子时，打捞对象里仍给「入侵残骸」那一行（带稀有件数）', () => {
    const { s } = invasion()
    winMain(s)
    const rows = wreckGroupStocksOf(s, ctx, GID, true)
    const inv = rows.find((r) => r.groupKey === WEEKEND_WRECK_TARGET)
    expect(inv, '只剩箱子也给这一行').not.toBeUndefined()
    expect(inv!.rareCount, '稀有件数一并给界面').toBe(1)
  })

  /** ⑦ 新字段随档往返（rare / rareBy / family 三格一个都不能丢） */
  it('⑦ 箱子随档往返；普通注入不许把箱子冲掉', () => {
    const { s } = invasion()
    winMain(s)
    injectWeekendWreck(s, GID, 20, 'H')
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.weekendWrecks?.[GID]?.rare, '读档后箱子还在').toBe(1)
    expect(back.weekendWrecks?.[GID]?.rareBy?.[MAIN]).toBe(1)
    expect(back.weekendWrecks?.[GID]?.family, '来源族也在（这条曾经被漂移推进洗掉）').toBe('H')
    /** 再注入一批普通残骸（同星系）⇒ 箱子不许被冲掉 */
    injectWeekendWreck(back, GID, 15, 'H')
    expect(weekendRareWreckCountOf(back, GID), '普通注入不冲箱子').toBe(1)
  })

  /** ⑧ 与旗舰那条互不干扰：旗舰卡没写 `rareWreckDrop`，它的 3 件走自己那条路 */
  it('⑧ 卡面字段只在写了的那张卡上生效（旗舰不走这条）', () => {    const { s, ev } = invasion()
    weekendNoteContribution(ev, GID, 1)
    weekendNoteContribution(ev, CORE, 1)
    const spec = weekendFlagshipSpecOf(s, ctx, Date.now())!
    expect(ctx.anomalies.get(spec.cardId)?.rareWreckDrop, '旗舰卡没写这个字段').toBeUndefined()
    expect(ctx.anomalies.get(MAIN)?.rareWreckDrop, '主力舰队写了 1 件').toBe(1)
    /** 顺手确认"打捞那一轮不白扣普通池"的读数函数仍在（稀有轮只取读数） */
    injectWeekendWreck(s, GID, 12, 'H')
    expect(salvageRoundMulOf(s, ctx, GID)).toBeGreaterThan(0)
    void weekendStartFlagshipBattle
    void weekendNoteFlagshipPlayerKill
  })
})
