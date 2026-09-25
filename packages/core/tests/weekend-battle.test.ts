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
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendBlackBoxChanceOf,
  weekendFoeCardOf,
  weekendNoteContribution,
  weekendRollBlackBox,
  weekendCoreGateView,
  weekendCoreProgressAt,
} from '../src/weekendEvent'
import { weekendGrantRewards, weekendRareWreckIdFor, weekendSettleAndGrant } from '../src/weekendBattle'
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

  /**
   * **界面读数 `weekendCoreGateView`**（2026-09-26 船长令：「星系详细的『击退入侵舰队』卡片显示该星系
   * 的**收复进度**；核心无法收复时提示玩家」＋提示文案「**至少需要夺回一个外围星系**」）。
   * 这条用例盯的是**读数与门禁同源**：界面不能出现"条在涨却写着打不动"或反过来的自相矛盾。
   */
  it('核心门禁读数：进度/是否被卡/还差几个 与门禁判据同源（外围清完即解除）', () => {
    // ⚠ 用**两个外围**：只有一个外围时"夺回一个"就等于"全清"，第 ② 段的门禁断言无从成立
    const { s, ev } = setup('galaxy-kor', ['galaxy-home', 'galaxy-mid'])
    /**
     * ⚠ 时间点要挑对：`setup()` 里 `startedAtWallMs = 0`，而**外围的 NPC 铺底 = `t/48h`**
     * ⇒ `now` 取得太晚（如 96h）时**光靠铺底外围就自己收复了**、门禁根本不解都谈不上。
     * 这里用 **T0 之前**（`now < startedAtWallMs`，铺底被 `max(0, …)` 钳住 = 0）来制造"外围一个都没夺回"。
     */
    const nowEarly = -H
    const g0 = weekendCoreGateView(s, ev, nowEarly)
    expect(g0.gated).toBe(true)
    expect(g0.missing).toBe(g0.total)
    expect(g0.progress).toBe(0)
    // 夺回**其中**一个外围 ⇒ **仍被卡**（门禁要全部夺回），missing 少 1；核心条仍不涨（玩家投入也不计）
    weekendNoteContribution(ev, ev.peripheryIds[0]!, 1)
    const g1 = weekendCoreGateView(s, ev, nowEarly)
    expect(g1.gated).toBe(true)
    expect(g1.missing).toBe(g1.total - 1)
    expect(g1.progress, '门禁期间核心条不涨（玩家投入也不计）').toBe(0)
    // 全部夺回 ⇒ 解除；进度与 weekendCoreProgressAt 逐字一致（读数与门禁同一个真相源）
    for (const id of ev.peripheryIds) weekendNoteContribution(ev, id, 1)
    const nowLate = 96 * H
    const g2 = weekendCoreGateView(s, ev, nowLate)
    expect(g2.gated).toBe(false)
    expect(g2.missing).toBe(0)
    expect(g2.progress).toBe(weekendCoreProgressAt(s, ev, nowLate))
    expect(g2.progress, '外围清完 + 已过 48h ⇒ 核心铺底已开动').toBeGreaterThan(0)
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

describe('周末入侵 · 黑匣爆率（2026-09-25 船长令）', () => {
  const POOL = WEEKEND_FLAGSHIP_POOL_HP
  /**
   * 爆率表：`p` = 玩家输出 ÷ 池子总量。
   * - **抢到最后一下**：`p > 50%` ⇒ 100%；`p ≤ 50%` ⇒ 从 100%（p=50%）线性降到 10%（p=0）
   * - **没抢到最后一下**：`25% × p`
   */
  it('爆率表：>50% 抢到最后一下必爆；≤50% 线性衰减到 10%；没抢到最后一下 25%×占比', () => {
    // 抢到最后一下
    expect(weekendBlackBoxChanceOf(POOL, POOL, true), '100% 输出 ⇒ 必爆').toBe(1)
    expect(weekendBlackBoxChanceOf(POOL * 0.500001, POOL, true), '刚过 50% ⇒ 必爆').toBe(1)
    expect(weekendBlackBoxChanceOf(POOL * 0.5, POOL, true), '正好 50% ⇒ 100%').toBe(1)
    expect(weekendBlackBoxChanceOf(POOL * 0.25, POOL, true), '25% 输出 ⇒ 中点 55%').toBeCloseTo(0.55, 6)
    expect(weekendBlackBoxChanceOf(0, POOL, true), '只抢最后一下 ⇒ 10%').toBeCloseTo(0.1, 6)
    // 没抢到最后一下
    expect(weekendBlackBoxChanceOf(POOL, POOL, false), '100% 输出但没抢到 ⇒ 25%').toBeCloseTo(0.25, 6)
    expect(weekendBlackBoxChanceOf(POOL * 0.5, POOL, false), '50% 输出 ⇒ 12.5%').toBeCloseTo(0.125, 6)
    expect(weekendBlackBoxChanceOf(0, POOL, false), '0 输出 ⇒ 0').toBe(0)
    // 边界：池子没锁定 / 伤害为负 ⇒ 按 0 处理（不炸）
    expect(weekendBlackBoxChanceOf(1000, 0, true), '没池子 ⇒ 只有下限 10%（掷骰本身不会走这条）').toBeCloseTo(0.1, 6)
    expect(weekendBlackBoxChanceOf(-5, POOL, false)).toBe(0)
    // 同一 p 下"抢到最后一下"永远不低于"没抢到"
    for (const p of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 1]) {
      expect(weekendBlackBoxChanceOf(POOL * p, POOL, true)).toBeGreaterThanOrEqual(
        weekendBlackBoxChanceOf(POOL * p, POOL, false),
      )
    }
  })

  it('掷骰：必爆/必不爆确定 · 结果写 `ev.flagshipBlackBox` 且幂等 · 同种子同场可复现', () => {
    const { s, ev } = setup()
    ev.flagshipHpMax = POOL
    /** ① 必爆：100% 输出 ＋ 抢到最后一下 */
    ev.flagshipHpDone = POOL
    expect(weekendRollBlackBox(s, ev, true), '必爆').toBe(true)
    expect(ev.flagshipBlackBox, '结果写进事件（随档）').toBe(true)
    /** 幂等：再调一次不改判（哪怕参数反了） */
    expect(weekendRollBlackBox(s, ev, false), '已掷过 ⇒ 原样返回').toBe(true)
    /** ② 必不爆：0 输出 ＋ 没抢到最后一下 */
    const b = setup()
    b.ev.flagshipHpMax = POOL
    b.ev.flagshipHpDone = 0
    expect(weekendRollBlackBox(b.s, b.ev, false), '爆率 0 ⇒ 必不爆').toBe(false)
    /** ③ 可复现：同种子 + 同场次号 ⇒ 同结果；换场次号 ⇒ 是另一条子流 */
    const runs: boolean[] = []
    for (let i = 0; i < 3; i++) {
      const r = setup()
      r.ev.flagshipHpMax = POOL
      r.ev.flagshipHpDone = Math.round(POOL * 0.3) // 爆率 = 0.1 + 0.6×0.9 = 0.64
      runs.push(weekendRollBlackBox(r.s, r.ev, true))
    }
    expect(runs[0], '同种子同场次 ⇒ 三次结果一致').toBe(runs[1])
    expect(runs[1]).toBe(runs[2])
  })

  it('章鱼人得手那一档：掷中 ⇒ 结算补发黑匣（照发，船长四答之二）', () => {
    const { s, ev } = setup()
    ev.family = 'H' // BOSS 族才有共享血池
    ev.flagshipHpMax = POOL
    ev.flagshipHpDone = POOL // 100% 输出 ⇒ 没抢到最后一下也有 25%
    ev.flagshipDown = 'octopus'
    const box0 = countItem(s, 'blackbox-h')
    const hit = weekendRollBlackBox(s, ev, false)
    expect(ev.flagshipBlackBox).toBe(hit)
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '结算面板的归属 = 掷骰结果').toBe(hit)
    ev.endedAtWallMs = 1_000_000
    const r = weekendSettleAndGrant(s, ctx, 1_000_000)
    expect(r, '结束结算要发').not.toBeNull()
    expect(countItem(s, 'blackbox-h') - box0, '掷中 ⇒ 补发 1 个黑匣').toBe(hit ? 1 : 0)
    expect(s.weekendLastResult?.blackBox, '快照里的黑匣数 = 实发').toBe(hit ? 1 : 0)
  })
})

describe('周末入侵 · 结束结算（M1-b）', () => {
  it('贡献占比决定档位；黑匣归属读"掷骰结果"（不再是"谁打空的"）', () => {
    const { s, ev } = setup()
    ev.contributed[ev.coreId] = 0.9
    const plan = weekendSettlePlanOf(s, ev, 0)
    expect(plan.tier).toBe('A')
    expect(plan.wreck).toBe(12)
    expect(plan.isk).toBe(8_000_000)
    expect(plan.blackBoxToPlayer, '还没掷 ⇒ 不归玩家').toBe(false)
    ev.flagshipBlackBox = true
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer).toBe(true)
    ev.flagshipBlackBox = false
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '掷空 ⇒ 不归玩家').toBe(false)
    /** 章鱼人得手也照样读掷骰结果（掷中 ⇒ 归玩家） */
    ev.flagshipDown = 'octopus'
    ev.flagshipBlackBox = true
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '章鱼人得手 ＋ 掷中 ⇒ 归玩家').toBe(true)
    ev.flagshipBlackBox = false
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '章鱼人得手 ＋ 掷空 ⇒ 不归玩家').toBe(false)
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
