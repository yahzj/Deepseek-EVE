/**
 * **初始赠送声望的清理 ＋ 入侵黑匣补发**（**2026-09-26 船长裁定与三条令**）。
 *
 * 船长原话（照抄）：
 * - 「玩家反馈，更新后他原本6声望突然变成41声望」＋「最新情况补充，玩家触发了入侵活动」
 * - 「**1算，我从来没有说过"开局能换 5 张"，所以要清理，并且还要削减累计声望。**
 *    2，声望都没到40的玩家不可能打得过入侵。不含、3现在、4、不发、5去掉**」
 * （1 = 新档初始那 40 也算额外声望 · 2 = 诚实值不含入侵贡献声望 · 3 = 补发截止取"现在" ·
 *  4 = 不发给玩家信 · 5 = 去掉老档回填的 40 下界）
 *
 * 本文件钉四件事：
 * ① 新档两条账都是 0（初始赠送已清理）；
 * ② 老档回填不再补 40 下界（读档只搬可支配那本）；
 * ③ `repairStandingFromBountyProgress`：按悬赏进度**只降不升**地削减累计声望，并把可支配夹到 ≤ 累计；
 * ④ `compensateMissingWeekendBlackBox`：推送前打完入侵却没拿到黑匣的档补 1 枚，且幂等、四条判据都要过。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, serializeSaveFile, loadSaveFile } from '../src/index'
import type { GameState } from '../src/state'
import type { CommsInstanceEntry } from '../src/types'
import type { WeekendResultSnapshot } from '../src/weekendEvent'
import { standingOf, spendableStandingOf, repairStandingFromBountyProgress, STANDING_CLAWBACK_THRESHOLD } from '../src/expedition'
import {
  WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS,
  WEEKEND_COMMS_SETTLE_ID,
  compensateMissingWeekendBlackBox,
} from '../src/weekendComms'
import { WEEKEND_BLACKBOX_ITEM_ID } from '../src/weekendBattle'
import { WEEKEND_MIN_STANDING, weekendInvasionAllowedFor } from '../src/weekendEvent'
import { WORMHOLE_SCAN_UNLOCK_STANDING, wormholeScanUnlocked } from '../src/wormholeScan'
import { FIRST_TASKS } from '../src/firstTasks'
import { blackboxSeenOf } from '../src/blackbox'
import { plugExchangeRowsOf } from '../src/plugs'

const ctx = buildSimContext('zh')

/** 两份真卡（`ano-training` 首胜 +1 · `ano-maw-hunt` 首胜 +4）——诚实值可手算，避免用例跟着数值漂 */
const CARD_A = 'ano-training'
const CARD_B = 'ano-maw-hunt'
const GAIN_A = ctx.anomalies.get(CARD_A)!.standingGain
const GAIN_B = ctx.anomalies.get(CARD_B)!.standingGain
/** 诚实值 H = 两张卡的 `standingGain` 之和（不含入侵贡献——船长第 2 答「不含」） */
const HONEST = GAIN_A + GAIN_B

function fresh(seed = 7): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

describe('① 新档初始声望 = 0（船长裁定：初始赠送一律清理）', () => {
  it('两条账都是 0；声望只能靠悬赏首胜与入侵贡献挣', () => {
    const s = fresh()
    expect(standingOf(s, 'dsi')).toBe(0)
    expect(spendableStandingOf(s, 'dsi')).toBe(0)
  })

  it('连带后果：开局不达标 —— 虫洞扫描锁着、入侵开不了、兑换一张也换不起', () => {
    const s = fresh()
    expect(wormholeScanUnlocked(s)).toBe(false)
    expect(weekendInvasionAllowedFor(s)).toBe(false)
    expect(WEEKEND_MIN_STANDING).toBe(40)
    expect(WORMHOLE_SCAN_UNLOCK_STANDING).toBe(40)
    const rows = plugExchangeRowsOf(s, ctx)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !r.affordable)).toBe(true)
  })

  it('首任务「第一次虫洞」不再开局即判过（它要的是累计 40）', () => {
    const s = fresh()
    const task = FIRST_TASKS.find((t) => t.id === 'first-wormhole')!
    expect(task.judge(s, ctx)).toBe(0)
  })
})

describe('② 老档回填不再补 40 下界（船长第 5 答「去掉」）', () => {
  it('老档只有可支配 6 ⇒ 累计也搬成 6（不再被抬到 40）', () => {
    const s = fresh()
    s.standings = { dsi: 6 }
    delete s.standingsEarned
    const round = loadSaveFile(serializeSaveFile(s)).state
    expect(spendableStandingOf(round, 'dsi')).toBe(6)
    expect(standingOf(round, 'dsi')).toBe(6)
  })
})

describe('③ 按悬赏进度削减累计声望（只降不升）', () => {
  it('报障复现：被抬到 41 的档 ⇒ 削回悬赏进度算得的诚实值', () => {
    const s = fresh()
    s.completedBounties.push(CARD_A, CARD_B)
    s.standingsEarned = { dsi: 41 } // 40 下界 ＋ 入侵贡献 1
    s.standings = { dsi: 7 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(true)
    expect(standingOf(s, 'dsi')).toBe(HONEST)
    expect(spendableStandingOf(s, 'dsi')).toBe(HONEST) // 可支配夹到 ≤ 累计
  })

  it('**只降不升**：累计低于诚实值的档不动（不制造"数值突然上涨"）', () => {
    const s = fresh()
    s.completedBounties.push(CARD_A, CARD_B)
    s.standingsEarned = { dsi: 1 }
    s.standings = { dsi: 1 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(false)
    expect(standingOf(s, 'dsi')).toBe(1)
    expect(spendableStandingOf(s, 'dsi')).toBe(1)
  })

  it('达标的真档不动（悬赏进度 = 累计 ⇒ 一字不改）', () => {
    const s = fresh()
    s.completedBounties.push(CARD_A, CARD_B)
    s.standingsEarned = { dsi: HONEST }
    s.standings = { dsi: HONEST }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(false)
    expect(standingOf(s, 'dsi')).toBe(HONEST)
  })

  it('查不到的悬赏 id（退役卡）按 0 计：宁可少算不多算', () => {
    const s = fresh()
    s.completedBounties.push('ano-已退役的卡')
    s.standingsEarned = { dsi: 40 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(true)
    expect(standingOf(s, 'dsi')).toBe(0)
  })

  it('**本来达标的档一字不动**——他们的累计里可能有合法的入侵贡献声望', () => {
    const s = fresh()
    // 按卡表现取悬赏卡，凑到"本来就 ≥ 40 线"（不写死卡 id ⇒ 内容改数值也不会让本用例失真）
    let h = 0
    for (const [id, a] of ctx.anomalies) {
      if (a.standingGain <= 0) continue
      s.completedBounties.push(id)
      h += a.standingGain
      if (h >= STANDING_CLAWBACK_THRESHOLD) break
    }
    expect(h).toBeGreaterThanOrEqual(STANDING_CLAWBACK_THRESHOLD)
    // 悬赏进度 h（≥ 40）＋ 入侵贡献 +15 ⇒ 累计 = h + 15：回正不该把入侵那 15 点削掉
    s.standingsEarned = { dsi: h + 15 }
    s.standings = { dsi: h + 15 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(false)
    expect(standingOf(s, 'dsi')).toBe(h + 15)
  })

  it('门槛常量与两条 40 线同值（就地写的那一份不能漂）', () => {
    expect(STANDING_CLAWBACK_THRESHOLD).toBe(WEEKEND_MIN_STANDING)
    expect(STANDING_CLAWBACK_THRESHOLD).toBe(WORMHOLE_SCAN_UNLOCK_STANDING)
  })

  it('**只生效一次**：削过之后不再削（哪怕累计又被抬回去）——船长「已经削过的玩家不再削」', () => {
    const s = fresh()
    s.completedBounties.push(CARD_A, CARD_B)
    s.standingsEarned = { dsi: 41 }
    s.standings = { dsi: 7 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(true)
    expect(standingOf(s, 'dsi')).toBe(HONEST)
    expect(s.standingClawbackDone).toBe(true)
    // 人为把累计抬回去（模拟任何将来的数据漂移 / 卡表变动）⇒ 第二趟必须一动不动
    s.standingsEarned = { dsi: 41 }
    s.standings = { dsi: 41 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(false)
    expect(standingOf(s, 'dsi')).toBe(41)
    expect(spendableStandingOf(s, 'dsi')).toBe(41)
  })

  it('标记随档往返：读回来仍是"已走过" ⇒ 新会话也不会再削第二刀', () => {
    const s = fresh()
    s.completedBounties.push(CARD_A)
    s.standingsEarned = { dsi: 40 }
    expect(repairStandingFromBountyProgress(s, ctx)).toBe(true)
    const round = loadSaveFile(serializeSaveFile(s)).state
    expect(round.standingClawbackDone).toBe(true)
    round.standingsEarned = { dsi: 40 } // 再抬回去
    expect(repairStandingFromBountyProgress(round, ctx)).toBe(false)
    expect(standingOf(round, 'dsi')).toBe(40)
  })
})

/** 造一份"打完入侵"的档：结算信 ＋ 战果快照（其余字段按类型补齐；本组用例只读黑匣那几栏） */
function withSettledInvasion(
  s: GameState,
  opts?: { endedAtWallMs?: number; blackBox?: number; withComms?: boolean },
): void {
  const endedAtWallMs = opts?.endedAtWallMs ?? WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS - 60_000
  if (opts?.withComms !== false) {
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
    coreId: 'galaxy-hub',
    endedAtWallMs,
    flagshipOutcome: 'octopus',
    share: 0.2,
    tier: 'C',
    galaxies: [],
    progressPct: 0.2,
    progressIsk: 0,
    isk: 0,
    wreck: 0,
    blackBox: opts?.blackBox ?? 0,
  } satisfies WeekendResultSnapshot
}

describe('④ 补发黑匣（推送前打完入侵却没拿到）', () => {
  it('四条判据全过 ⇒ 补 1 枚入仓 ＋ 一条系统日志；再调一次不补（幂等）', () => {
    const s = fresh()
    withSettledInvasion(s)
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(true)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
    expect(blackboxSeenOf(s)).toBe(true)
    const log = s.logs[s.logs.length - 1]!
    expect(log.textId).toBe('core.weekend.040')
    // 幂等：入库已置位"见过黑匣" ⇒ 第二次不成立
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
  })

  it('那一刻已经发过（blackBox > 0）⇒ 不补', () => {
    const s = fresh()
    withSettledInvasion(s, { blackBox: 1 })
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] ?? 0).toBe(0)
  })

  it('没有结算信（按通讯判"没打完"）⇒ 不补', () => {
    const s = fresh()
    withSettledInvasion(s, { withComms: false })
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
  })

  it('结算时刻在推送之后 ⇒ 不补（新场次掉落是好的）', () => {
    const s = fresh()
    withSettledInvasion(s, { endedAtWallMs: WEEKEND_BOX_COMPENSATION_CUTOFF_WALL_MS })
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
  })

  it('**已经把黑匣做成插件**（舰队已装）⇒ 说明当初拿到过，不补', () => {
    const s = fresh()
    withSettledInvasion(s)
    const uid = Object.keys(s.fleet)[0]!
    s.fleet[uid]!.plugs = ['plug-shield-plate']
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
  })

  it('**黑匣做成的插件还躺在仓库里** ⇒ 同样不补', () => {
    const s = fresh()
    withSettledInvasion(s)
    s.warehouse.items['plug-shield-plate'] = 1
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
  })

  it('仓库里已经有黑匣（别处来的）⇒ 不补', () => {
    const s = fresh()
    withSettledInvasion(s)
    s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID] = 1
    expect(compensateMissingWeekendBlackBox(s, ctx)).toBe(false)
    expect(s.warehouse.items[WEEKEND_BLACKBOX_ITEM_ID]).toBe(1)
  })
})
