/**
 * **周末入侵 · 战斗与结算用例**（M1-b 第二片）
 * 覆盖：三类 spec（单舰 78 / 核心 120 / 伏击 ×0.5 / 旗舰 4 波 4 艘）· 敌卡来自虫洞族卡 ·
 * 结果结算（主动推进 / 击退 / 离线击退 / 战败只受损）· **夺回奖励幂等**（跨 100% 只发一次）·
 * 核心门禁不因打赢而解锁 · 旗舰击毁与黑匣 · 结束八档贡献奖。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { countItem } from '../src/inventory'
import {
  WEEKEND_ALL_CLEAR_ISK,
  WEEKEND_FLAGSHIP_REWARD_MUL,
  WEEKEND_FLAGSHIP_WRECK,
  WEEKEND_RECLAIM_ISK,
  WEEKEND_RECLAIM_WRECK,
  weekendAmbushSpecOf,
  weekendAssaultSpecOf,
  weekendFlagshipSpecOf,
  weekendResolveBattle,
  weekendSettlePlanOf,
} from '../src/weekendBattle'
import { weekendFoeCardOf, weekendNoteContribution } from '../src/weekendEvent'
import { weekendGrantRewards, weekendRareWreckIdFor } from '../src/weekendBattle'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const H = 3_600_000

function setup(coreId = 'galaxy-kor', peripheryIds: string[] = ['galaxy-home']): { s: ReturnType<typeof createInitialState>; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 7 })
  s.debugQuick = true
  const ev: WeekendEventState = { seq: 1, startedAtWallMs: 0, coreId, peripheryIds, family: 'A', contributed: {} }
  s.weekendEvent = ev
  return { s, ev }
}

describe('周末入侵 · 战斗规格（M1-b）', () => {
  it('外围/核心主动出击都是单舰；威胁 78 / 120；敌卡取该族虫洞卡', () => {
    const { s, ev } = setup()
    const per = weekendAssaultSpecOf(s, ctx, ev.peripheryIds[0]!)!
    expect(per.kind).toBe('assault')
    expect(per.threat).toBe(78)
    expect(per.squadSize).toBe(1)
    expect(per.waves).toBe(1)
    expect(per.cardId).toBe(weekendFoeCardOf('A', 'assault'))
    const core = weekendAssaultSpecOf(s, ctx, ev.coreId)!
    expect(core.threat).toBe(120)
    expect(core.squadSize, 'Q1：依旧是单舰').toBe(1)
    expect(core.cardId).toBe(weekendFoeCardOf('A', 'flagship'))
    expect(core.name).toContain('舰队')
  })

  it('非占领区没有 spec；遇袭 = 单舰 + **真强度 ×0.75**（A 族占位口径：标签 59 / 90）', () => {
    const { s, ev } = setup()
    expect(weekendAssaultSpecOf(s, ctx, 'galaxy-redring')).toBeNull()
    const amb = weekendAmbushSpecOf(s, ctx, ev.peripheryIds[0]!, 0)!
    expect(amb.kind).toBe('ambush')
    expect(amb.threat, 'round(78 × 0.75)').toBe(59)
    expect(amb.foeStrengthMul, '真倍率（旧口径只改标签，已删）').toBe(0.75)
    const ambCore = weekendAmbushSpecOf(s, ctx, ev.coreId, 0)!
    expect(ambCore.threat, 'round(120 × 0.75)').toBe(90)
    expect(ambCore.squadSize).toBe(1)
  })

  it('旗舰：核心不满 ⇒ 没有 spec；满 ⇒ 4 波 4 艘 + 赏金 ×3', () => {
    const { s, ev } = setup()
    const T = 1_000_000
    expect(weekendFlagshipSpecOf(s, ctx, T), '核心不满').toBeNull()
    for (const id of ev.peripheryIds) weekendNoteContribution(ev, id, 1)
    weekendNoteContribution(ev, ev.coreId, 1)
    const f = weekendFlagshipSpecOf(s, ctx, T)!
    expect(f.kind).toBe('flagship')
    expect(f.waves).toBe(4)
    expect(f.squadSize).toBe(4)
    expect(f.threat).toBe(120)
    expect(f.rewardMul).toBe(WEEKEND_FLAGSHIP_REWARD_MUL)
  })
})

describe('周末入侵 · 结果结算（M1-b）', () => {
  it('主动打赢外围：**调试 +50%（两场收复）** / 正常 +10% · 战败只受损不动进度', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const spec = weekendAssaultSpecOf(s, ctx, per)!
    /** 调试模式（setup 默认开）：船长 2026-09-25「收复只需要玩家打 2 场」⇒ 一场 +50% */
    const win = weekendResolveBattle(s, ctx, spec, 'win', 0)
    expect(win.progressGain, '调试：一场 +50%').toBeCloseTo(0.5, 6)
    expect(ev.contributed[per], '一场之后 = 50%').toBeCloseTo(0.5, 6)
    const win2 = weekendResolveBattle(s, ctx, spec, 'win', 0)
    expect(win2.progressGain, '第二场同样 +50%').toBeCloseTo(0.5, 6)
    expect(ev.contributed[per], '**两场累计 1.0 ⇒ 该处收复**（船长：只需打 2 场）').toBeCloseTo(1.0, 6)
    /** 正常模式：外围 +10% 逐字不变 */
    s.debugQuick = false
    const ev2 = { ...ev, contributed: {} }
    s.weekendEvent = ev2
    expect(weekendResolveBattle(s, ctx, spec, 'win', 0).progressGain, '正常：外围 +10%').toBeCloseTo(0.1, 6)
    const before = ev.contributed[per]!
    const loss = weekendResolveBattle(s, ctx, spec, 'loss', 0)
    expect(loss.progressGain).toBe(0)
    expect(ev.contributed[per], '失败只受损').toBeCloseTo(before, 6)
  })

  it('击退遇袭 +3% · 离线自动结算 +1%', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const amb = weekendAmbushSpecOf(s, ctx, per, 0)!
    weekendResolveBattle(s, ctx, amb, 'repel', 0)
    expect(ev.contributed[per]).toBeCloseTo(0.03, 6)
    weekendResolveBattle(s, ctx, amb, 'offlineRepel', 0)
    expect(ev.contributed[per]).toBeCloseTo(0.04, 6)
  })

  it('核心门禁：外围没清完时打赢核心**不给进度**；清完后正常推进', () => {
    const { s, ev } = setup()
    const coreSpec = weekendAssaultSpecOf(s, ctx, ev.coreId)!
    const blocked = weekendResolveBattle(s, ctx, coreSpec, 'win', 0)
    expect(blocked.progressGain, '门禁未解 ⇒ 0').toBe(0)
    for (const id of ev.peripheryIds) weekendNoteContribution(ev, id, 1)
    const ok = weekendResolveBattle(s, ctx, coreSpec, 'win', 0)
    expect(ok.progressGain, '调试：核心也 +50%（两场打满 ⇒ 旗舰现身）').toBeCloseTo(0.5, 6)
    /** 正常模式：核心 +5% 逐字不变 */
    s.debugQuick = false
    const ev3 = { ...ev, contributed: { ...ev.contributed } }
    s.weekendEvent = ev3
    const coreSpec3 = weekendAssaultSpecOf(s, ctx, ev3.coreId)!
    expect(weekendResolveBattle(s, ctx, coreSpec3, 'win', 0).progressGain, '正常：核心 +5%').toBeCloseTo(0.05, 6)
  })

  it('夺回奖励：越过 100% 那一次发 稀有残骸 ×8 ＋ 2M；**再打不重复发**；全清再 +5M', () => {
    const { s, ev } = setup('galaxy-kor', ['galaxy-home'])
    const per = ev.peripheryIds[0]!
    const spec = weekendAssaultSpecOf(s, ctx, per)!
    weekendNoteContribution(ev, per, 0.95)
    const r1 = weekendResolveBattle(s, ctx, spec, 'win', 0)
    expect(r1.reclaimed?.wreck).toBe(WEEKEND_RECLAIM_WRECK)
    expect(r1.reclaimed?.isk, '还有核心没夺回 ⇒ 不发全清奖').toBe(WEEKEND_RECLAIM_ISK)
    expect(r1.reclaimed?.allClear).toBe(false)
    const r2 = weekendResolveBattle(s, ctx, spec, 'win', 0)
    expect(r2.reclaimed, '已经满了 ⇒ 不再发').toBeUndefined()
    // 再夺回核心 ⇒ 全清奖
    weekendNoteContribution(ev, ev.coreId, 0.99)
    const coreSpec = weekendAssaultSpecOf(s, ctx, ev.coreId)!
    const r3 = weekendResolveBattle(s, ctx, coreSpec, 'win', 0)
    expect(r3.reclaimed?.allClear).toBe(true)
    expect(r3.reclaimed?.isk).toBe(WEEKEND_RECLAIM_ISK + WEEKEND_ALL_CLEAR_ISK)
  })

  it('旗舰击毁：核心满 + 打赢 ⇒ 黑匣 ＋ 稀有残骸 ×3，且本场结束', () => {
    const { s, ev } = setup()
    for (const id of ev.peripheryIds) weekendNoteContribution(ev, id, 1)
    weekendNoteContribution(ev, ev.coreId, 1)
    const T = 5_000_000
    const spec = weekendFlagshipSpecOf(s, ctx, T)!
    const r = weekendResolveBattle(s, ctx, spec, 'win', T)
    expect(r.flagshipKilled?.blackBox).toBe(true)
    expect(r.flagshipKilled?.wreck).toBe(WEEKEND_FLAGSHIP_WRECK)
    expect(ev.flagshipDown).toBe('player')
    expect(ev.endedAtWallMs).toBe(T)
    const after = weekendResolveBattle(s, ctx, spec, 'win', T + 1000)
    expect(after.progressGain, '结束后不再记账').toBe(0)
  })
})

describe('周末入侵 · 结束结算（M1-b）', () => {
  it('贡献占比决定档位；黑匣只在玩家击毁时归玩家', () => {
    const { s, ev } = setup()
    ev.contributed[ev.coreId] = 0.9
    const plan = weekendSettlePlanOf(s, ev, 0)
    expect(plan.tier).toBe('A')
    expect(plan.wreck).toBe(12)
    expect(plan.isk).toBe(8_000_000)
    expect(plan.blackBoxToPlayer).toBe(false)
    ev.flagshipDown = 'player'
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer).toBe(true)
    ev.flagshipDown = 'octopus'
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '章鱼人得手 ⇒ 黑匣归零').toBe(false)
  })
})

describe('周末入侵 · 奖励入账（M1-b 第五片）', () => {
  it('ISK 进钱包 · 稀有残骸进物品仓库（走 addItem 同一条入库路径；**物品 id 必须真实存在**）', () => {
    const { s } = setup()
    const isk0 = s.wallet.isk
    // 2026-09-25 修：原写死 `'wreck-rare'` —— 目录里**没有**这个 id（真形态 `wreck-rare-<组key>`），
    //   发出去是一件「未知物品」⇒ 现按"打的那张卡所属组"解析（H 族独立卡 = `wreck-rare-h-hi`）。
    const itemId = weekendRareWreckIdFor('ink-harass', ctx)!
    expect(itemId).toBe('wreck-rare-h-hi')
    expect(ctx.items.has(itemId), '奖励物品必须在目录里').toBe(true)
    const wreck0 = countItem(s, itemId)
    const isk1 = s.wallet.isk + 2_000_000
    const got = weekendGrantRewards(s, { isk: 2_000_000, wreck: 8, blackBox: true, wreckItemId: itemId })
    expect(got.isk).toBe(2_000_000)
    expect(got.blackBox, '黑匣数量带回（物品 M4 才入库）').toBe(1)
    expect(s.wallet.isk).toBe(isk0 + 2_000_000)
    expect(s.wallet.isk).toBe(isk1)
    expect(countItem(s, itemId)).toBe(wreck0 + 8)
    // 解析不到物品 id ⇒ **不发**（绝不发不存在的 id 给玩家）
    const before = countItem(s, 'wreck-rare')
    weekendGrantRewards(s, { wreck: 3 })
    expect(countItem(s, 'wreck-rare')).toBe(before)
  })

  it('负数/缺省一律按 0 处理（不吞钱也不倒扣）', () => {
    const { s } = setup()
    const isk0 = s.wallet.isk
    const got = weekendGrantRewards(s, { isk: -5, wreck: -3 })
    expect(got).toEqual({ isk: 0, wreck: 0, blackBox: 0 })
    expect(s.wallet.isk).toBe(isk0)
  })
})
