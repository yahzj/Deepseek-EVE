/**
 * **旗舰黑匣的对账补发工具**（**2026-09-28 船长令**：「**不需要给本地存档补发，采用工具线上补发**」）。
 *
 * 判据 = 船长记录在案的规则（原话：「**规则应该很清楚记录了：输出超过50%血量，完成最后击杀，就给黑匣。**」）：
 * 「有玩家亲手击沉的留档 ＋ 占比 > 50% ⇒ 这一档必爆」⇒ 没落地就补一枚。
 *
 * 本文件钉六件事：① 真档数值复现（玩家报障那一场，补发必须命中）；② 五条判据的真值表（逐条都能否掉）；
 * ③ **与 09-26 那次一次性补偿的时间划界**（不划界会双发）；④ 幂等（补了就写死标记，第二次不动）；
 * ⑤ 补发要对齐三本账（仓库 ＋ 台账 ＋ 战果快照）；⑥ 源码护栏：tick 接线不许掉。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS,
  reconcileWeekendBlackBox,
} from '../src/weekendComms'
import { WEEKEND_BLACKBOX_ITEM_ID } from '../src/weekendBattle'
import { weekendRollBlackBox } from '../src/weekendEvent'
import type { WeekendResultSnapshot } from '../src/weekendEvent'

/** 场次记录的类型（`WeekendEventState` 未从 `state` 导出 ⇒ 从函数签名推导，不新开导出面） */
type Ev = Parameters<typeof weekendRollBlackBox>[1]

/** 补发窗口**之后**的一个结束时刻（本工具只管这一段；窗口内的归一次性补偿） */
const ENDED_AFTER_CUTOFF = WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS + 3_600_000

/** 一条最小的场次记录（只放本文件用得到的字段；其余与本批判据无关） */
function evOf(patch: Partial<Ev>): Ev {
  return {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'galaxy-home',
    peripheryIds: [],
    family: 'H',
    contributed: {},
    flagshipHpMax: 150_000,
    flagshipHpDone: 139_829,
    ...patch,
  } as unknown as Ev
}

/**
 * 造一份"刚打完入侵、旗舰那条路已结束"的档。
 * 缺省 = **2026-09-28 玩家报障那一场的原样**：有亲手击沉的留档、占比 93.22%、
 * 但场次记录里是章鱼人先掷出来的 `false`（`flagshipBlackBoxByPlayer = false`）、仓库里没有黑匣。
 */
function withEndedFlagship(
  s: GameState,
  opts?: {
    endedAtWallMs?: number
    hpDone?: number
    playerKill?: boolean
    down?: 'player' | 'octopus'
    rolled?: boolean
    rolledByPlayer?: boolean
    ledgerBlackBox?: number
    snapBlackBox?: number
  },
): void {
  const endedAtWallMs = opts?.endedAtWallMs ?? ENDED_AFTER_CUTOFF
  s.weekendEvent = evOf({
    ...(opts?.playerKill === false ? {} : { flagshipPlayerKill: { atWallMs: endedAtWallMs - 1_000, runId: 1 } as never }),
    ...(opts?.down !== undefined ? { flagshipDown: opts.down } : { flagshipDown: 'octopus' }),
    ...(opts?.hpDone !== undefined ? { flagshipHpDone: opts.hpDone } : {}),
    endedAtWallMs,
    ...(opts?.rolled !== undefined ? { flagshipBlackBox: opts.rolled } : {}),
    ...(opts?.rolledByPlayer !== undefined ? { flagshipBlackBoxByPlayer: opts.rolledByPlayer } : {}),
    ...(opts?.ledgerBlackBox !== undefined
      ? { rewardLedger: { isk: 0, wreck: 0, blackBox: opts.ledgerBlackBox, byGalaxy: {} } }
      : {}),
  })
  s.weekendLastResult = {
    seq: 1,
    family: 'H',
    coreId: 'galaxy-home',
    endedAtWallMs,
    flagshipOutcome: 'octopus',
    share: 0.93,
    tier: 'A',
    galaxies: [],
    progressPct: 0.93,
    progressIsk: 0,
    isk: 0,
    wreck: 0,
    blackBox: opts?.snapBlackBox ?? 0,
  } satisfies WeekendResultSnapshot
}

function fresh(seed = 7): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

describe('旗舰黑匣对账补发（2026-09-28 船长令「工具线上补发」）', () => {
  it('① 真档复现：留档 ＋ 占比 93.22% ＋ 场次记着章鱼人掷的 false ⇒ 补 1 枚', () => {
    const s = fresh()
    withEndedFlagship(s, { rolled: false, rolledByPlayer: false })
    expect(reconcileWeekendBlackBox(s), '该补').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID], '入仓库').toBe(1)
    expect(s.weekendEvent!.flagshipBlackBox, '场次记录改判为"爆出"').toBe(true)
    expect(s.weekendEvent!.flagshipBlackBoxByPlayer, '并记下按"玩家最后击杀"情境结的账').toBe(true)
    expect(s.weekendEvent!.rewardLedger!.blackBox, '台账 +1').toBe(1)
    expect(s.weekendLastResult!.blackBox, '战果快照那一栏 +1（面板/结算信读它）').toBe(1)
    const log = s.logs[s.logs.length - 1]!
    expect(log.textId).toBe('core.weekend.039')
    expect(log.textParams?.p2, '日志里带输出占比').toBe(93)
  })

  it('② 幂等：同一场再对账多少次都不再补', () => {
    const s = fresh()
    withEndedFlagship(s, { rolled: false, rolledByPlayer: false })
    expect(reconcileWeekendBlackBox(s)).toBe(true)
    expect(reconcileWeekendBlackBox(s), '第二次').toBe(false)
    expect(reconcileWeekendBlackBox(s), '第三次').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID], '还是 1 枚').toBe(1)
    expect(s.weekendEvent!.rewardLedger!.blackBox, '台账不被重复累加').toBe(1)
  })

  it('③ 没留档（池子判给章鱼、玩家没亲手打爆）⇒ 不补', () => {
    const s = fresh()
    withEndedFlagship(s, { playerKill: false, down: 'octopus', rolled: false, rolledByPlayer: false })
    expect(reconcileWeekendBlackBox(s), '不是本工具的事').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('④ 占比 ≤ 50% ⇒ 不补（这一档本来就不是必爆，走正常掷骰）', () => {
    const s = fresh()
    withEndedFlagship(s, { hpDone: 75_000, rolled: false, rolledByPlayer: false })
    expect(reconcileWeekendBlackBox(s)).toBe(false)
    /** 同一条记录再抬到 75,001（刚过半）⇒ 立刻该补（边界就在 "> 50%"） */
    s.weekendEvent!.flagshipHpDone = 75_001
    expect(reconcileWeekendBlackBox(s)).toBe(true)
  })

  it('⑤ 场次还没结束 ⇒ 不补（进行中的走正常掷骰路径，不在这里抢着发）', () => {
    const s = fresh()
    withEndedFlagship(s, { rolled: false, rolledByPlayer: false })
    s.weekendEvent!.endedAtWallMs = undefined
    expect(reconcileWeekendBlackBox(s)).toBe(false)
  })

  it('⑥ 结束在一次性补偿的窗口内 ⇒ 不补（**按时间划界，防双发**）', () => {
    const s = fresh()
    withEndedFlagship(s, {
      endedAtWallMs: WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS - 60_000,
      rolled: false,
      rolledByPlayer: false,
    })
    expect(reconcileWeekendBlackBox(s), '那一段归 compensateMissingWeekendBlackBox').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('⑦ 本场已结过账的三种记法 ⇒ 都不补（含"掷中了、等着结算发"的那一种）', () => {
    /** (a) 已按"玩家最后击杀"情境结过账 */
    const a = fresh()
    withEndedFlagship(a, { rolled: true, rolledByPlayer: true })
    expect(reconcileWeekendBlackBox(a), 'ByPlayer = true').toBe(false)
    /** (b) 掷中了（章鱼人那档 25%×p 中了）⇒ 迟到发放/结算会发它，别抢 */
    const b = fresh()
    withEndedFlagship(b, { rolled: true, rolledByPlayer: false })
    expect(reconcileWeekendBlackBox(b), 'flagshipBlackBox = true').toBe(false)
    /** (c) 台账里已经有这一笔 */
    const c = fresh()
    withEndedFlagship(c, { rolled: false, rolledByPlayer: false, ledgerBlackBox: 1 })
    expect(reconcileWeekendBlackBox(c), '台账 > 0').toBe(false)
    for (const s of [a, b, c]) expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('⑧ 快照是**别的场次**的 ⇒ 只发实物，不去改那张旧快照', () => {
    const s = fresh()
    withEndedFlagship(s, { rolled: false, rolledByPlayer: false })
    s.weekendLastResult!.endedAtWallMs = ENDED_AFTER_CUTOFF - 86_400_000
    expect(reconcileWeekendBlackBox(s), '照补').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
    expect(s.weekendLastResult!.blackBox, '旧快照不动').toBe(0)
  })

  it('⑨ 源码护栏：engine 的 tick 里挂着这次对账（接线掉了这条用例就红）', () => {
    const rootA = join(process.cwd(), 'src/engine.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : join(process.cwd(), 'packages/core/src/engine.ts'), 'utf8')
    expect(/reconcileWeekendBlackBox\(state\)/.test(src), '逐 tick 调用').toBe(true)
  })
})
