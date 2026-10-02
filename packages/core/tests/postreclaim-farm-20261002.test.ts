/**
 * **入侵「100% 之后仍可继续刷 ＋ 残骸半量」**（**2026-10-02 船长令**）
 *
 * 船长原话：「入侵的收复进度100%后，外围和核心星系仍然可以继续刷入侵敌人。但是残骸掉落减半，
 * 也没有其他啊奖励。」⇒ 澄清后为**规格**：「我希望的是 **100% 后能够继续刷，但是掉落残骸数量
 * 需要减半作为惩罚**」（另有同日三答：遇袭概率公式不动 · 100% 星系仍显示为被占 · 加一句说明）。
 *
 * 本文件钉五件事（改前全部相反）：
 * ① **夺回不再关门**：`weekendZoneLiveAt`（旧名 `weekendOccupiedLiveAt`）不再要求进度 < 1
 *    ⇒ 夺回后仍可出击、板面仍换成入侵舰队卡、重复出击不再自动停；
 * ② **半量惩罚**：`weekendWreckPenaltyFracOf` —— 已夺回 ⇒ 0.5、未夺回 ⇒ 1（出征注入那条路读它）；
 * ③ **不给其他奖励**：夺回后继续打**不涨进度台账**（`clamp01`）⇒ 结算里没有额外进度收入；
 * ④ **核心满之后"继续刷核心"算普通出击（`assault`），不是旗舰战**（否则每场会按旗舰掉落发稀有残骸）；
 * ⑤ **遇袭公式不动**：夺回后遇袭概率仍恒 0（"继续刷" = 玩家主动去刷）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import {
  weekendEncounterChanceAt,
  weekendNoteContribution,
  weekendProgressAt,
  weekendWreckPenaltyFracOf,
  weekendZoneLiveAt,
} from '../src/weekendEvent'
import { weekendAssaultDrawOf, weekendBountyCardsOf } from '../src/weekendBounty'
import { weekendBattleInvolvedOf } from '../src/weekendBattle'
import { weekendWreckInjectionOf } from '../src/salvage'
import { advanceAutoLoopInvasion, setAutoLoopInvasion } from '../src/expedition'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const CORE = 'galaxy-kor'
/** 外围取**有可见悬赏卡**的那一处（"板面替换"那条测得到东西；写死 galaxy-home 会取不到原卡） */
const PER = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== CORE && a.galaxyId !== undefined)!.galaxyId!

/** 建场：H 族（BOSS 族）· 核心 ＋ 一处外围 · 无铺底干扰（`startedAtWallMs` = 现在） */
function setup(family = 'H'): { s: ReturnType<typeof createInitialState>; ev: WeekendEventState } {
  const now = Date.now()
  const s = createInitialState({ nowWallMs: now, seed: 20261002 })
  s.debugQuick = false
  const ev: WeekendEventState = { seq: 1, startedAtWallMs: now, coreId: CORE, peripheryIds: [PER], family, contributed: {} }
  s.weekendEvent = ev
  return { s, ev }
}

/** 把某处推到"已夺回"（进度满） */
function reclaim(ev: WeekendEventState, gid: string): void {
  weekendNoteContribution(ev, gid, 1)
}

describe('入侵 100% 后仍可继续刷（2026-10-02 船长令）', () => {
  it('① 夺回后：占点仍算"可打"· 出击抽签照旧给卡（未夺回时同样给）', () => {
    const { s, ev } = setup()
    const now = Date.now()
    expect(weekendZoneLiveAt(s, PER, now), '未夺回 ⇒ 可打').toBe(true)
    expect(weekendAssaultDrawOf(s, ctx, PER, now), '未夺回 ⇒ 抽得出卡').not.toBeNull()
    reclaim(ev, PER)
    expect(weekendProgressAt(s, ev, PER, now), '构造前提：进度满').toBe(1)
    expect(weekendZoneLiveAt(s, PER, now), '夺回后 ⇒ **仍可打**（改前这里是 false）').toBe(true)
    const draw = weekendAssaultDrawOf(s, ctx, PER, now)
    expect(draw, '夺回后 ⇒ 抽签照旧给卡（改前 null）').not.toBeNull()
    expect(draw!.cardId.length).toBeGreaterThan(0)
    // 活动结束后照旧关门（这条从未变过）
    ev.endedAtWallMs = now
    expect(weekendZoneLiveAt(s, PER, now), '活动结束 ⇒ 不可打').toBe(false)
    expect(weekendAssaultDrawOf(s, ctx, PER, now), '活动结束 ⇒ 抽签 null').toBeNull()
  })

  it('①b 夺回后：板面取数口照旧把原卡换成入侵舰队卡（赏金 0）', () => {
    const { s, ev } = setup()
    const base = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === PER)
    expect(base.length, '该星系要有原卡才测得到"替换"').toBeGreaterThan(0)
    reclaim(ev, PER)
    const shown = weekendBountyCardsOf(s, ctx, base, PER, Date.now())
    for (const c of shown) {
      expect(c.rewardIsk, '入侵舰队卡不给赏金（2026-09-25 口径不变）').toBe(0)
    }
    expect(shown[0]!.id, '夺回后仍不是原卡（改前这里回落原卡）').not.toBe(base[0]!.id)
  })

  it('①c 夺回后：重复出击不再自动停（只有"活动结束"这一条停）', () => {
    const { s, ev } = setup()
    expect(setAutoLoopInvasion(s, ctx, PER).ok).toBe(true)
    reclaim(ev, PER)
    expect(advanceAutoLoopInvasion(s, ctx), '夺回后不再返回停止原因').toBeNull()
    expect(s.weekendEvent?.autoLoopGalaxyId, '目标照旧挂着').toBe(PER)
  })

  it('② 半量惩罚：单点 0.5/1，且出征注入量按它减半', () => {
    const { s, ev } = setup()
    const now = Date.now()
    expect(weekendWreckPenaltyFracOf(s, ev, PER, now), '未夺回 ⇒ 全额').toBe(1)
    reclaim(ev, PER)
    expect(weekendWreckPenaltyFracOf(s, ev, PER, now), '已夺回 ⇒ 半量').toBe(0.5)
    expect(weekendWreckPenaltyFracOf(s, ev, CORE, now), '同一场里核外星系各自判').toBe(1)
    /** 注入量对拍：**同一张真卡**（H 族旗舰卡，威胁 170），全额 vs 半量 ——
     *  出征那条路（`expedition.ts`）就是按 `weekendWreckPenaltyFracOf` 取 frac 调这个口 */
    const card = ctx.anomalies.get('ink-flagship')!
    expect(card, '夹具前提：H 族旗舰卡在场').toBeDefined()
    const full = weekendWreckInjectionOf(card, 1)
    const half = weekendWreckInjectionOf(card, 0.5)
    expect(half, '半量 = 全额的一半').toBeCloseTo(full / 2, 6)
  })

  it('③ 不给其他奖励：夺回后继续打不涨进度台账（⇒ 结算没有额外进度收入）', () => {
    const { s, ev } = setup()
    reclaim(ev, PER)
    expect(ev.contributed[PER], '构造前提：台账已满').toBe(1)
    weekendNoteContribution(ev, PER, 0.05)
    weekendNoteContribution(ev, PER, 0.05)
    expect(ev.contributed[PER], '满档后再打也不涨（`clamp01`）').toBe(1)
    expect(weekendProgressAt(s, ev, PER, Date.now()), '进度照旧是满的').toBe(1)
  })

  it('④ 核心满之后"继续刷核心"算普通出击（assault），不是旗舰战', () => {
    const { s, ev } = setup()
    reclaim(ev, PER)
    reclaim(ev, CORE)
    const now = Date.now()
    /** 场景 = 从星图那行出击核心：引擎把界面那张卡的星系写进 `expedition.foeGalaxyId` */
    s.expedition = { ...s.expedition, active: true, foeGalaxyId: CORE, anomalyId: 'ink-harass' }
    const involved = weekendBattleInvolvedOf(s, ctx, 'ink-harass', now)
    expect(involved?.galaxyId).toBe(CORE)
    expect(involved?.kind, 'H 族（BOSS 族）⇒ 普通出击（改前会被判成 flagship ⇒ 错发旗舰掉落）').toBe('assault')
  })

  it('⑤ 遇袭公式不动：夺回后遇袭概率仍恒 0', () => {
    const { s, ev } = setup()
    reclaim(ev, PER)
    expect(weekendEncounterChanceAt(s, ev, PER, Date.now()), '100% ⇒ 不再被动挨打').toBe(0)
  })
})
