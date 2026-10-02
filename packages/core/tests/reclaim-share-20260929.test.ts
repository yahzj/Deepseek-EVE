/**
 * **夺回奖按"玩家在该处的投入比例"结算**（**2026-09-29 船长令 · 乙案**）用例。
 *
 * 船长原话（报障）：「**玩家在入侵中完全0贡献，但是却有每个星系240残骸+200万**」
 * ⇒ 三问三答的落地口径：
 * - **乙案**：单处夺回奖 = 全额（×8 件 = 240 m³ ＋ 200 万）× `contributed[星系]`；
 * - **甲案**（全清追加）：`500 万 × (玩家总投入 ÷ 占领区数)`；
 * - 残骸**按"件"四舍五入**（1 件 = 30 m³）· ISK 四舍五入到 1 元。
 *
 * 病根本身：夺回判据只看"进度 ≥ 1"，而进度 = `NPC 铺底(时间函数) ＋ 玩家投入` ⇒ 外围 T0+48h、
 * 核心 T0+72h 之后**时间自己就把条推满**，一次都不打的玩家照样拿满。本文件第 ① 条就是那个病例。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { endWeekendEvent } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import {
  WEEKEND_ALL_CLEAR_ISK,
  WEEKEND_RECLAIM_ISK,
  WEEKEND_RECLAIM_WRECK,
  weekendAllClearAwardOf,
  weekendRareWreckUnits,
  weekendReclaimAwardOf,
  weekendResolveBattle,
  weekendAssaultSpecOf,
  weekendSettleAndGrant,
} from '../src/weekendBattle'

const ctx = buildSimContext()
const H = 3_600_000
const GIDS = [...ctx.galaxies.keys()].slice(0, 4)
const CORE = GIDS[0]!
const PERIPHERY = GIDS.slice(1)

/**
 * 入侵已进入"铺底自然推满"的时点：T0 = 现在 − 80h
 * ⇒ 外围（48h 铺满）与核心（T0+48h 起 24h ⇒ 72h 铺满）**四处进度全是 1**，与玩家出手无关。
 */
function invadedAtFullProgress(now: number, contributed: Record<string, number>): ReturnType<typeof createInitialState> {
  const s = createInitialState({ nowWallMs: now, seed: 11 })
  s.debugQuick = false
  const ev: WeekendEventState = {
    seq: 7,
    startedAtWallMs: now - 80 * H,
    coreId: CORE,
    peripheryIds: [...PERIPHERY],
    family: 'H',
    contributed: { ...contributed },
  }
  s.weekendEvent = ev
  return s
}

describe('夺回奖按投入比例（2026-09-29 船长令 · 乙案）', () => {
  it('① 完全 0 贡献（一次都不打）⇒ 四处夺回奖全为 0：钱包与仓库一分不动', () => {
    const now = Date.now()
    const s = invadedAtFullProgress(now, {})
    const isk0 = s.wallet.isk
    const wrecks0 = s.warehouse.items['wreck-rare-h-hi'] ?? 0
    endWeekendEvent(s, now)
    const r = weekendSettleAndGrant(s, ctx, now)
    expect(r, '活动结束照常结算').not.toBeNull()
    expect(r!.share, '贡献占比 = 0').toBe(0)
    expect(r!.tier, '贡献奖 0 档').toBe('none')
    expect(r!.progressIsk, '进度收入 0（本来就只结玩家投入那一份）').toBe(0)
    expect(r!.isk, '🔴 夺回奖不再白给 ⇒ 全场 0 ISK').toBe(0)
    expect(r!.wreck, '🔴 残骸也是 0').toBe(0)
    expect(s.wallet.isk - isk0, '钱包不动').toBe(0)
    expect((s.warehouse.items['wreck-rare-h-hi'] ?? 0) - wrecks0, '仓库不动').toBe(0)
    /** 那几处**照样是"已夺回"**（进度是事实）—— 只是奖金为 0；"夺回吗"与"给多少"从此分开 */
    for (const g of s.weekendLastResult!.galaxies) {
      expect(g.reclaimed, '进度满 ⇒ 仍记已夺回').toBe(true)
      expect(g.isk, '该处 ISK = 0').toBe(0)
      expect(g.wreck, '该处残骸 = 0').toBe(0)
    }
    expect(s.weekendEvent!.reclaimPaid, '四处照样打上"已记账"标记（幂等靠它）').toEqual([CORE, ...PERIPHERY])
  })

  it('② 按比例缩水：核心自己打满 ⇒ 全额；外围只推 20% ⇒ 2 件（60 m³）＋ 40 万；全清按平均参与度 0.3', () => {
    const now = Date.now()
    const p0 = PERIPHERY[0]!
    const s = invadedAtFullProgress(now, { [CORE]: 1, [p0]: 0.2 })
    const isk0 = s.wallet.isk
    endWeekendEvent(s, now)
    const r = weekendSettleAndGrant(s, ctx, now)
    expect(r).not.toBeNull()
    const rowOf = (id: string) => s.weekendLastResult!.galaxies.find((g) => g.galaxyId === id)!
    expect(rowOf(CORE).isk, '核心投入 100% ⇒ 全额 200 万').toBe(WEEKEND_RECLAIM_ISK)
    expect(rowOf(CORE).wreck, '全额 ×8 件 = 240 m³').toBe(weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK))
    expect(rowOf(p0).isk, '外围 20% ⇒ 40 万').toBe(400_000)
    expect(rowOf(p0).wreck, '20% ⇒ 8×0.2 = 1.6 件 ⇒ 四舍五入 2 件 = 60 m³').toBe(weekendRareWreckUnits(2))
    for (const id of PERIPHERY.slice(1)) {
      expect(rowOf(id).isk, '没碰过的处 ⇒ 0').toBe(0)
      expect(rowOf(id).wreck, '没碰过的处 ⇒ 0').toBe(0)
    }
    /**
     * **全清追加**（甲案）= `500 万 × 平均参与度`：总投入 1.2 ÷ 4 处 = 0.3 ⇒ 150 万。
     * 它记在**全局**（不带星系）⇒ 不会把逐星系那一列撑歪；这里从合计里反推它。
     */
    const bonus = weekendAllClearAwardOf(s.weekendEvent!)
    expect(bonus, '500 万 × 0.3').toBe(1_500_000)
    expect(r!.isk, '结算合计 = 进度收入 2,400 万 ＋ 夺回 390 万（含全清 150 万）').toBe(
      1.2 * 100 * 200_000 + WEEKEND_RECLAIM_ISK + 400_000 + bonus,
    )
    expect(s.wallet.isk - isk0, 'ISK 真进钱包 = 结算合计').toBe(r!.isk)
  })

  it('③ 取整：残骸按"件"四舍五入（1 件 = 30 m³）· ISK 四舍五入到 1 元', () => {
    const ev = (put: number): WeekendEventState => ({
      seq: 1,
      startedAtWallMs: 0,
      coreId: 'galaxy-kor',
      peripheryIds: ['galaxy-home'],
      family: 'H',
      contributed: { 'galaxy-home': put },
    })
    expect(weekendReclaimAwardOf(ev(0), 'galaxy-home'), '0 投入 ⇒ 两笔都 0').toEqual({ wreck: 0, isk: 0 })
    expect(weekendReclaimAwardOf(ev(0.03), 'galaxy-home'), '0.24 件 ⇒ 0 件（半件以下不给）').toEqual({
      wreck: 0,
      isk: 60_000,
    })
    expect(weekendReclaimAwardOf(ev(0.07), 'galaxy-home'), '0.56 件 ⇒ 1 件 = 30 m³').toEqual({
      wreck: 30,
      isk: 140_000,
    })
    expect(weekendReclaimAwardOf(ev(0.2), 'galaxy-home'), '1.6 件 ⇒ 2 件 = 60 m³').toEqual({
      wreck: 60,
      isk: 400_000,
    })
    expect(weekendReclaimAwardOf(ev(1 / 3), 'galaxy-home'), '2.67 件 ⇒ 3 件；ISK 666,666.7 ⇒ 666,667').toEqual({
      wreck: 90,
      isk: 666_667,
    })
    expect(weekendReclaimAwardOf(ev(1), 'galaxy-home'), '全额').toEqual({
      wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK),
      isk: WEEKEND_RECLAIM_ISK,
    })
    expect(weekendReclaimAwardOf(ev(1.5), 'galaxy-home'), '超过 1 按 1 算（比例封顶）').toEqual({
      wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK),
      isk: WEEKEND_RECLAIM_ISK,
    })
    expect(weekendReclaimAwardOf(ev(0.5), 'galaxy-unknown'), '不在占领区里的 id ⇒ 0').toEqual({ wreck: 0, isk: 0 })
  })

  it('④ 全清追加按"平均参与度"：处处打满 = 全额 · 只参与一处 = 摊薄 · 完全挂机 = 0', () => {
    const ev = (contributed: Record<string, number>): WeekendEventState => ({
      seq: 1,
      startedAtWallMs: 0,
      coreId: CORE,
      peripheryIds: [...PERIPHERY],
      family: 'H',
      contributed: { ...contributed },
    })
    expect(weekendAllClearAwardOf(ev({})), '挂机 ⇒ 0').toBe(0)
    expect(weekendAllClearAwardOf(ev({ [CORE]: 1 })), '只打满一处 ⇒ 1 ÷ 4 = 0.25').toBe(
      Math.round(WEEKEND_ALL_CLEAR_ISK * 0.25),
    )
    expect(weekendAllClearAwardOf(ev({ [CORE]: 1, [PERIPHERY[0]!]: 0.5 })), '1.5 ÷ 4 = 0.375').toBe(
      Math.round(WEEKEND_ALL_CLEAR_ISK * 0.375),
    )
    expect(
      weekendAllClearAwardOf(ev({ [CORE]: 1, [PERIPHERY[0]!]: 1, [PERIPHERY[1]!]: 1, [PERIPHERY[2]!]: 1 })),
      '处处打满 ⇒ 全额',
    ).toBe(WEEKEND_ALL_CLEAR_ISK)
    expect(
      weekendAllClearAwardOf(ev({ [CORE]: 2, [PERIPHERY[0]!]: 2, [PERIPHERY[1]!]: 2, [PERIPHERY[2]!]: 2 })),
      '坏值超过 1 ⇒ 比例封顶到 1（不会超发）',
    ).toBe(WEEKEND_ALL_CLEAR_ISK)
  })

  it('⑤ 记账时机在结算拍：战斗那一刻只记"夺回"这件事，金额不动（口径与出手顺序无关）', () => {
    const now = Date.now()
    const p0 = PERIPHERY[0]!
    /** 这一场用的场次：T0 = 现在（NPC 铺底 ≈ 0）⇒ 该处**打之前还没满**，本场才越过 100% */
    const s = createInitialState({ nowWallMs: now, seed: 11 })
    s.debugQuick = true // 调试档每场 +50% ⇒ 这一场把该处推满
    s.weekendEvent = {
      seq: 7,
      startedAtWallMs: now,
      coreId: CORE,
      peripheryIds: [...PERIPHERY],
      family: 'H',
      contributed: { [p0]: 0.9 },
    }
    const spec = weekendAssaultSpecOf(s, ctx, p0)!
    const r = weekendResolveBattle(s, ctx, spec, 'win', now)
    expect(r.reclaimed, '这一场越过 100%').toBeDefined()
    expect(s.weekendEvent!.reclaimPaid, '战斗那一拍**不记**夺回奖（金额要到结算才算得出）').toBeUndefined()
    expect(s.weekendEvent!.reclaimPending, '待到账也还是空的').toBeUndefined()
    endWeekendEvent(s, now)
    const settled = weekendSettleAndGrant(s, ctx, now)
    expect(settled).not.toBeNull()
    expect(s.weekendEvent!.reclaimPaid, '结算拍才记账').toEqual([p0])
    const row = s.weekendLastResult!.galaxies.find((g) => g.galaxyId === p0)!
    expect(row.wreck, '投入被 clamp01 封顶到 1 ⇒ 全额').toBe(weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK))
    expect(row.isk).toBe(WEEKEND_RECLAIM_ISK)
  })
})
