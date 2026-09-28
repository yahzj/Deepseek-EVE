/**
 * **周末入侵 · 战斗与结算用例**（M1-b 第二片）
 * 覆盖：三类 spec（单舰 78 / 核心 120 / 伏击 ×0.5 / 旗舰 4 波 4 艘）· 敌卡来自虫洞族卡 ·
 * 结果结算（主动推进 / 击退 / 离线击退 / 战败只受损）· **夺回奖励幂等**（跨 100% 只发一次）·
 * 核心门禁不因打赢而解锁 · 旗舰击毁与黑匣 · 结束八档贡献奖。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { countItem, countWare } from '../src/inventory'
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
  /** 2026-09-25 船长令：稀有残骸「件 → 单位(m³)」换算（1 件 = 30 单位） */
  weekendRareWreckUnits,
} from '../src/weekendBattle'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendBlackBoxSettledOf,
  weekendFoeCardOf,
  weekendLastHitByPlayer,
  weekendNoteContribution,
  weekendCoreGateView,
  weekendCoreProgressAt,
} from '../src/weekendEvent'
import * as weekendEventNS from '../src/weekendEvent'
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
    expect(r1.reclaimed?.wreck, '×8 件 = 240 m³').toBe(weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK))
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
    expect(r.flagshipKilled?.wreck, '×3 件 = 90 m³').toBe(weekendRareWreckUnits(WEEKEND_FLAGSHIP_WRECK))
    expect(ev.flagshipDown).toBe('player')
    expect(ev.endedAtWallMs).toBe(T)
    const after = weekendResolveBattle(s, ctx, spec, 'win', T + 1000)
    expect(after.progressGain, '结束后不再记账').toBe(0)
  })
})

describe('周末入侵 · 黑匣改「击杀必给」（2026-09-28 船长令）', () => {
  const POOL = WEEKEND_FLAGSHIP_POOL_HP

  it('击杀 ⇒ **必给**（不再掷骰，也不再要求输出过半）', () => {
    const { s, ev } = setup()
    ev.family = 'H' // BOSS 族（有共享血池）
    ev.flagshipHpMax = POOL
    ev.flagshipHpDone = 1 // 只补了最后一刀（旧口径下这种只有 10%）
    ev.flagshipPlayerKill = { atWallMs: 1, runId: 1, downAtGameMs: 1 }
    expect(weekendLastHitByPlayer(ev), '有留档 ⇒ 击杀成立').toBe(true)
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '结算计划：黑匣归玩家').toBe(true)
    ev.endedAtWallMs = 1_000_000
    expect(weekendSettleAndGrant(s, ctx, 1_000_000), '结束结算要发').not.toBeNull()
    expect(countWare(s, 'blackbox-h'), '必给 1 枚（入物品仓库）').toBe(1)
    expect(s.weekendLastResult?.blackBox, '快照里的黑匣数 = 实发').toBe(1)
    expect(weekendBlackBoxSettledOf(ev), '写"已结清"').toBe(true)
  })

  it('没击杀 ⇒ **一定是 0**（章鱼人收尾那一档不再掷骰，输出拉满也没用）', () => {
    const { s, ev } = setup()
    ev.family = 'H'
    ev.flagshipHpMax = POOL
    ev.flagshipHpDone = POOL // 输出 100% —— 但最后一击不是玩家拿的
    ev.flagshipDown = 'octopus'
    expect(weekendLastHitByPlayer(ev), '没击杀').toBe(false)
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '不归玩家').toBe(false)
    ev.endedAtWallMs = 1_000_000
    expect(weekendSettleAndGrant(s, ctx, 1_000_000)).not.toBeNull()
    expect(countWare(s, 'blackbox-h'), '一个都不发').toBe(0)
    expect(s.weekendLastResult?.blackBox).toBe(0)
  })

  it('结算迟到补发：**击杀了却还没结清** ⇒ 结算补上（且只补一枚）', () => {
    const { s, ev } = setup()
    ev.family = 'H'
    ev.flagshipHpMax = POOL
    ev.flagshipHpDone = 10
    ev.flagshipDown = 'player' // 归属判给玩家、但没走"击沉那一刻"的即时发放
    ev.endedAtWallMs = 1_000_000
    expect(weekendSettleAndGrant(s, ctx, 1_000_000)).not.toBeNull()
    expect(countWare(s, 'blackbox-h'), '补 1 枚').toBe(1)
    expect(weekendBlackBoxSettledOf(ev), '结清').toBe(true)
    /** 再结一次（幂等口 = `prizePaidAtWallMs`）⇒ 不会第二枚 */
    weekendSettleAndGrant(s, ctx, 1_000_000)
    expect(countWare(s, 'blackbox-h'), '还是 1 枚').toBe(1)
  })

  it('爆率表与掷骰子流**已整套删除**（按模块导出面查，不受注释影响）', () => {
    const gone = [
      'weekendBlackBoxChanceOf',
      'weekendRollBlackBox',
      'WEEKEND_BLACKBOX_SALT',
      'WEEKEND_BLACKBOX_MIN_ON_LAST_HIT',
      'WEEKEND_BLACKBOX_MAX_OFF_LAST_HIT',
    ]
    for (const name of gone) {
      expect((weekendEventNS as Record<string, unknown>)[name], `${name} 不该再导出`).toBeUndefined()
    }
    /** 随爆率表一起删的旧字段（"掷骰情境"）也不该再出现在场次类型上 */
    const { ev } = setup()
    expect('flagshipBlackBoxByPlayer' in ev, '旧字段已删').toBe(false)
  })
})

describe('周末入侵 · 结束结算（M1-b）', () => {
  it('贡献占比决定档位（**BOSS 那 60% 的倾斜**）；黑匣归属读"有没有击杀"（2026-09-28 船长令）', () => {
    const { s, ev } = setup()
    ev.contributed[ev.coreId] = 0.9
    /**
     * ⚠ **倾斜的直接体现**：只做清缴（没跟母舰交手）⇒ 占比重 = 0.4 ⇒ **封在 C 档**
     * （旧口径下这种是 A 档）。要把档位抬上去就得去打 BOSS。
     */
    const clearOnly = weekendSettlePlanOf(s, ev, 0)
    expect(clearOnly.share, '0.6×0 ＋ 0.4×1').toBeCloseTo(0.4, 6)
    expect(clearOnly.tier, '清缴单干 ⇒ C 档').toBe('C')
    expect(clearOnly.wreck, 'C 档 ×4 件 = 120 m³').toBe(weekendRareWreckUnits(4))
    expect(clearOnly.isk).toBe(2_000_000)
    /** 把 BOSS 也打满 ⇒ 0.6 ＋ 0.4×1 = 1.0 ⇒ 回到 A 档（⚠ 只有 BOSS 族才谈得上"BOSS 那份"） */
    ev.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
    ev.flagshipHpDone = WEEKEND_FLAGSHIP_POOL_HP
    expect(weekendSettlePlanOf(s, ev, 0).share, 'A 族（占位族、没有共享池）⇒ boss 项恒 0').toBeCloseTo(0.4, 6)
    ev.family = 'H' // BOSS 族：共享血池 ⇒ BOSS 那一项才计
    const withBoss = weekendSettlePlanOf(s, ev, 0)
    expect(withBoss.share, '1.0').toBeCloseTo(1, 6)
    expect(withBoss.tier, 'BOSS 打满 ⇒ A 档').toBe('A')
    expect(withBoss.wreck, '×12 件 = 360 m³').toBe(weekendRareWreckUnits(12))
    expect(withBoss.isk).toBe(8_000_000)
    /** 黑匣归属：读**有没有击杀**（`flagshipBlackBox` 只是"结清了没有"的标记，不参与判归属） */
    expect(clearOnly.blackBoxToPlayer, '没击杀 ⇒ 不归玩家').toBe(false)
    ev.flagshipPlayerKill = { atWallMs: 1, runId: 1, downAtGameMs: 1 }
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '击杀了 ⇒ 归玩家').toBe(true)
    ev.flagshipBlackBox = true
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '结清标记不改变归属').toBe(true)
    /** 池子判给章鱼人、玩家也没留档 ⇒ 没击杀（哪怕输出拉满） */
    delete ev.flagshipPlayerKill
    ev.flagshipDown = 'octopus'
    expect(weekendSettlePlanOf(s, ev, 0).blackBoxToPlayer, '没击杀 ⇒ 不归玩家').toBe(false)
  })
})

describe('周末入侵 · 奖励入账（M1-b 第五片）', () => {
  it('ISK 进钱包 · 稀有残骸与黑匣进物品仓库（**物品 id 必须真实存在**）', () => {
    const { s } = setup()
    const isk0 = s.wallet.isk
    // 2026-09-25 修：原写死 `'wreck-rare'` —— 目录里**没有**这个 id（真形态 `wreck-rare-<组key>`），
    //   发出去是一件「未知物品」⇒ 现按"打的那张卡所属组"解析（H 族独立卡 = `wreck-rare-h-hi`）。
    const itemId = weekendRareWreckIdFor('ink-harass', ctx)!
    expect(itemId).toBe('wreck-rare-h-hi')
    expect(ctx.items.has(itemId), '奖励物品必须在目录里').toBe(true)
    const wreck0 = countWare(s, itemId)
    const box0 = countWare(s, 'blackbox-h')
    const isk1 = s.wallet.isk + 2_000_000
    const got = weekendGrantRewards(s, { isk: 2_000_000, wreck: 8, blackBox: true, wreckItemId: itemId })
    expect(got.isk).toBe(2_000_000)
    expect(got.blackBox, '黑匣真入库（2026-09-26 船长批「甲」：与残骸同一条入库路）').toBe(1)
    expect(s.wallet.isk).toBe(isk0 + 2_000_000)
    expect(s.wallet.isk).toBe(isk1)
    // **落点 = 物品仓库**（不是货舱；船长 2026-09-26 报障：玩家在物品页找不到它）
    expect(countWare(s, itemId)).toBe(wreck0 + 8)
    expect(countWare(s, 'blackbox-h')).toBe(box0 + 1)
    expect(countItem(s, itemId), '货舱不动').toBe(0)
    // 解析不到物品 id ⇒ **不发也不记账**（返回值 = 实际入账数）
    const before = countWare(s, 'wreck-rare')
    expect(weekendGrantRewards(s, { wreck: 3 }).wreck, '没给物品 id ⇒ 实发 0').toBe(0)
    expect(countWare(s, 'wreck-rare')).toBe(before)
  })

  it('负数/缺省一律按 0 处理（不吞钱也不倒扣）', () => {
    const { s } = setup()
    const isk0 = s.wallet.isk
    const got = weekendGrantRewards(s, { isk: -5, wreck: -3 })
    expect(got).toEqual({ isk: 0, wreck: 0, blackBox: 0 })
    expect(s.wallet.isk).toBe(isk0)
  })
})
