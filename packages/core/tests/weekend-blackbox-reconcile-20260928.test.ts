/**
 * **旗舰黑匣的对账补发工具**（**2026-09-28 船长令**：「**不需要给本地存档补发，采用工具线上补发**」
 * ＋ 同日再令「**让玩家击杀BOSS就能获得黑匣，取消之前的复杂判定**」）。
 *
 * 判据四条（条条对应船长当日裁定）：① **有留档**（`weekendLastHitByPlayer`，唯一判据）·
 * ② **本场已结束** · ③ **没结清**（`weekendBlackBoxSettledOf`）· ④ **台账也干净**。
 * ⚠ **不再有"占比 > 50%"这一条**（旧爆率表已整套删除）⇒ 现在是「**凡有留档就补**」，
 * **历史场次一并捞回**（船长当日选定"乙"：连历史一起放宽）。
 *
 * 本文件钉七件事：① 真档数值复现；② 四条判据逐条能否掉；③ 历史场次（含一次性补偿窗口内）也补；
 * ④ 幂等；⑤ 三本账对齐（仓库 ＋ 台账 ＋ 战果快照）；⑥ 与"推送前一次性补偿"**共用一把钥匙**、不双发；
 * ⑦ 源码护栏：tick 接线不许掉。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { CommsInstanceEntry } from '../src/types'
import {
  WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS,
  WEEKEND_COMMS_SETTLE_ID,
  compensateMissingWeekendBlackBox,
  reconcileWeekendBlackBox,
} from '../src/weekendComms'
import { WEEKEND_BLACKBOX_ITEM_ID } from '../src/weekendBattle'
import { weekendBlackBoxSettledOf, weekendLastHitByPlayer } from '../src/weekendEvent'
import type { WeekendResultSnapshot } from '../src/weekendEvent'

/** 场次记录的类型（从 `GameState` 取，不新开导出面） */
type Ev = NonNullable<GameState['weekendEvent']>

/** 补发窗口**之后**的一个结束时刻（历史划界已撤，两种时刻都要能补） */
const ENDED_AFTER_CUTOFF = WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS + 3_600_000

const ctx = buildSimContext()

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
 * 缺省 = **2026-09-28 玩家报障那一场的原样**：有亲手击沉的留档、占比 93.22%、仓库里没有黑匣。
 */
function withEndedFlagship(
  s: GameState,
  opts?: {
    endedAtWallMs?: number
    hpDone?: number
    playerKill?: boolean
    down?: 'player' | 'octopus'
    settled?: boolean
    ledgerBlackBox?: number
    snapBlackBox?: number
    snapEndedAtWallMs?: number
    withComms?: boolean
  },
): void {
  const endedAtWallMs = opts?.endedAtWallMs ?? ENDED_AFTER_CUTOFF
  s.weekendEvent = evOf({
    ...(opts?.playerKill === false ? {} : { flagshipPlayerKill: { atWallMs: endedAtWallMs - 1_000, runId: 1, downAtGameMs: 1 } }),
    ...(opts?.down !== undefined ? { flagshipDown: opts.down } : { flagshipDown: 'octopus' }),
    ...(opts?.hpDone !== undefined ? { flagshipHpDone: opts.hpDone } : {}),
    endedAtWallMs,
    ...(opts?.settled === true ? { flagshipBlackBox: true } : {}),
    ...(opts?.ledgerBlackBox !== undefined
      ? { rewardLedger: { isk: 0, wreck: 0, blackBox: opts.ledgerBlackBox, byGalaxy: {} } }
      : {}),
  })
  if (opts?.withComms === true) {
    s.commsInstance = {
      [WEEKEND_COMMS_SETTLE_ID]: {
        id: WEEKEND_COMMS_SETTLE_ID,
        factionId: 'dshi',
        atGameMs: 0,
        subject: '入侵结算',
        subjectId: 'core.weekend.001',
        paragraphs: ['正文'],
        bodyIds: ['core.weekend.002'],
      } satisfies CommsInstanceEntry,
    }
  }
  s.weekendLastResult = {
    seq: 1,
    family: 'H',
    coreId: 'galaxy-home',
    endedAtWallMs: opts?.snapEndedAtWallMs ?? endedAtWallMs,
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

describe('旗舰黑匣对账补发（2026-09-28 船长令）', () => {
  it('① 真档复现：有留档 ⇒ 补 1 枚（对齐仓库 ＋ 台账 ＋ 快照 ＋ 日志）', () => {
    const s = fresh()
    withEndedFlagship(s)
    expect(weekendLastHitByPlayer(s.weekendEvent), '留档在').toBe(true)
    expect(reconcileWeekendBlackBox(s), '该补').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID], '入仓库').toBe(1)
    expect(weekendBlackBoxSettledOf(s.weekendEvent), '写"已结清"').toBe(true)
    expect(s.weekendEvent!.rewardLedger!.blackBox, '台账 +1').toBe(1)
    expect(s.weekendLastResult!.blackBox, '战果快照那一栏 +1（面板/结算信读它）').toBe(1)
    const log = s.logs[s.logs.length - 1]!
    expect(log.textId).toBe('core.weekend.039')
    expect(log.textParams?.p1, '日志带补发枚数').toBe(1)
  })

  it('② 幂等：同一场再对账多少次都不再补', () => {
    const s = fresh()
    withEndedFlagship(s)
    expect(reconcileWeekendBlackBox(s)).toBe(true)
    expect(reconcileWeekendBlackBox(s), '第二次').toBe(false)
    expect(reconcileWeekendBlackBox(s), '第三次').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID], '还是 1 枚').toBe(1)
    expect(s.weekendEvent!.rewardLedger!.blackBox, '台账不被重复累加').toBe(1)
  })

  it('③ 没留档（池子判给章鱼人、玩家也没亲手打爆）⇒ 不补', () => {
    const s = fresh()
    withEndedFlagship(s, { playerKill: false, down: 'octopus' })
    expect(reconcileWeekendBlackBox(s), '不是本工具的事').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('④ **占比不过半也照补**（新口径：击杀就给，不再看输出占比）', () => {
    const s = fresh()
    withEndedFlagship(s, { hpDone: 1_000 }) // 占比 0.67%
    expect(reconcileWeekendBlackBox(s), '"只抢最后一下"也必给').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
  })

  it('⑤ 场次还没结束 ⇒ 不补（进行中的走正常发放路径）', () => {
    const s = fresh()
    withEndedFlagship(s)
    s.weekendEvent!.endedAtWallMs = undefined
    expect(reconcileWeekendBlackBox(s)).toBe(false)
  })

  it('⑥ **历史场次也补**（含 09-27 08:24 补偿窗口之内的 —— 时间划界已撤，改共用钥匙防重）', () => {
    const s = fresh()
    withEndedFlagship(s, { endedAtWallMs: WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS - 60_000 })
    expect(reconcileWeekendBlackBox(s), '窗口内的场次同样按"有留档就补"').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
  })

  it('⑦ 已经结清（或台账里已有这一笔）⇒ 不补', () => {
    const a = fresh()
    withEndedFlagship(a, { settled: true })
    expect(reconcileWeekendBlackBox(a), '结清标记 = true').toBe(false)
    const b = fresh()
    withEndedFlagship(b, { ledgerBlackBox: 1 })
    expect(reconcileWeekendBlackBox(b), '台账 > 0').toBe(false)
    for (const s of [a, b]) expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('⑧ 快照是**别的场次**的 ⇒ 只发实物，不去改那张旧快照', () => {
    const s = fresh()
    withEndedFlagship(s, { snapEndedAtWallMs: ENDED_AFTER_CUTOFF - 86_400_000 })
    expect(reconcileWeekendBlackBox(s), '照补').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
    expect(s.weekendLastResult!.blackBox, '旧快照不动').toBe(0)
  })

  it('⑨ **与一次性补偿共用一把钥匙**：补偿付过之后，对账不会补第二枚', () => {
    const s = fresh()
    /** 补偿窗口内的历史场次（它的判据：有结算信 ＋ 结束于截止之前 ＋ 快照 0 ＋ 手上没有任何黑匣痕迹） */
    withEndedFlagship(s, {
      endedAtWallMs: WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS - 60_000,
      withComms: true,
    })
    expect(compensateMissingWeekendBlackBox(s, ctx), '补偿先付').toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
    expect(weekendBlackBoxSettledOf(s.weekendEvent), '补偿把钥匙写了').toBe(true)
    expect(reconcileWeekendBlackBox(s), '对账认这把钥匙 ⇒ 不双发').toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID], '还是 1 枚').toBe(1)
  })

  it('⑩ 源码护栏：engine 的 tick 里挂着这次对账（接线掉了这条用例就红）', () => {
    const rootA = join(process.cwd(), 'src/engine.ts')
    const src = readFileSync(existsSync(rootA) ? rootA : join(process.cwd(), 'packages/core/src/engine.ts'), 'utf8')
    expect(/reconcileWeekendBlackBox\(state\)/.test(src), '逐 tick 调用').toBe(true)
  })
})
