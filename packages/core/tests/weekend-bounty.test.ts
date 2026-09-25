/**
 * **周末入侵 · 悬赏替换与遇袭判定用例**（M1-b 第三片）
 * 覆盖：派生卡只覆盖 id/名字/威胁/奖励 · 非占领区/夺回后/活动结束 ⇒ 原卡原样 ·
 * 高安破例（占领区不看安全等级）· 遇袭掷骰边界与伏击 spec（单舰 39/60）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { securityZoneOf } from '../src/sideTasks'
import {
  WEEKEND_BOUNTY_REWARD_MUL,
  WEEKEND_CARD_PREFIX,
  weekendBountyCardsOf,
  weekendDerivedCardOf,
  weekendEncounterAllowedIn,
  weekendEncounterRollOf,
  weekendStandingBountyHeldAt,
} from '../src/weekendBounty'
import { weekendNoteContribution } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const T = 1_000_000

const card: AnomalyDef = {
  id: 'ano-test',
  name: '测试通缉',
  galaxyId: 'galaxy-kor',
  threat: 40,
  standingReq: 0,
  standingGain: 1,
  rewardIsk: 100_000,
} as AnomalyDef

function setup(peripheryIds: string[] = ['galaxy-home']): { s: ReturnType<typeof createInitialState>; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  s.debugQuick = true
  const ev: WeekendEventState = { seq: 1, startedAtWallMs: 0, coreId: 'galaxy-kor', peripheryIds, family: 'C', contributed: {} }
  s.weekendEvent = ev
  return { s, ev }
}

describe('周末入侵 · 悬赏替换（M1-b）', () => {
  it('派生卡只覆盖 id / 名字 / 威胁 / 奖励，其余字段原样', () => {
    const d = weekendDerivedCardOf(card, 'C')
    // 2026-09-23 船长报障「前往入侵星系战斗提示未知目标」⇒ 派生卡**保留原卡 id**（出发/开战路径都按 id 取卡）
    // ⚠ 2026-09-25 修：这一行的换行曾被写成字面 `\`n`，把断言整条吞进注释里（等于没测）——已复原
    expect(d.id).toBe(card.id)
    expect(d.name).toContain('C 族舰队')
    expect(d.name).toContain(card.name)
    expect(d.threat).toBe(78)
    // **赏金 = 0**（船长 2026-09-25：「入侵舰队不应该有赏金」；原口径"原卡 ×1.4"已退役）
    expect(d.rewardIsk).toBe(0)
    expect(d.galaxyId, '其余字段原样').toBe(card.galaxyId)
    expect(d.standingReq).toBe(card.standingReq)
  })

  it('核心的派生卡威胁 120；非占领区/夺回后原样返回原卡', () => {
    const { s, ev } = setup()
    const core = weekendBountyCardsOf(s, ctx, [card], ev.coreId, T)
    expect(core[0]!.threat).toBe(120)
    const other = weekendBountyCardsOf(s, ctx, [card], 'galaxy-redring', T)
    expect(other[0], '不在占领区 ⇒ 原卡').toBe(card)
    // 夺回（推进到满）⇒ 恢复原卡（**用外围卡**：核心要等外围清完才可能满）
    const perId = ev.peripheryIds[0]!
    const perCard = { ...card, galaxyId: perId }
    weekendNoteContribution(ev, perId, 1)
    expect(weekendBountyCardsOf(s, ctx, [perCard], perId, T)[0], '夺回后 ⇒ 原卡').toBe(perCard)
    // 活动结束 ⇒ 原卡
    ev.contributed = {}
    ev.endedAtWallMs = T
    expect(weekendBountyCardsOf(s, ctx, [perCard], perId, T)[0]).toBe(perCard)
  })

  it('**H 族（独立卡）：悬赏位换成"抽到的那支舰队"**（真实 id · 覆写星系/名字 · 威胁 = 卡面自身 · 无赏金）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 11 })
    s.debugQuick = true
    const ev: WeekendEventState = {
      seq: 1,
      startedAtWallMs: 0,
      coreId: 'galaxy-kor',
      peripheryIds: ['galaxy-home'],
      family: 'H',
      contributed: {},
    }
    s.weekendEvent = ev
    const perCard = { ...card, galaxyId: 'galaxy-home' }
    const out = weekendBountyCardsOf(s, ctx, [perCard], 'galaxy-home', T)
    // 抽到的必须是该区域池里的一张（外围 = 骚扰 / 袭击），且 **id 能在目录里解析**（否则开不了战）
    expect(['ink-harass', 'ink-raid']).toContain(out[0]!.id)
    const drawn = ctx.anomalies.get(out[0]!.id)!
    expect(out[0]!.threat, '威胁 = 卡面自身（定价式落值）').toBe(drawn.threat)
    expect(out[0]!.galaxyId, 'galaxyId 覆写成被占星系（独立卡自带母港）').toBe('galaxy-home')
    expect(out[0]!.name).toContain('H 族舰队')
    expect(out[0]!.rewardIsk, '无赏金（船长 2026-09-25；收入改在结算时按进度发）').toBe(0)
    // 同一场入侵内**稳定**（板面不会每次刷新换卡）
    expect(weekendBountyCardsOf(s, ctx, [perCard], 'galaxy-home', T)[0]!.id).toBe(out[0]!.id)
    // 核心池 = {袭击, 主力}
    const coreCard = { ...card, galaxyId: ev.coreId }
    expect(['ink-raid', 'ink-main']).toContain(weekendBountyCardsOf(s, ctx, [coreCard], ev.coreId, T)[0]!.id)
  })
})

describe('周末入侵 · 遇袭判定（M1-b）', () => {
  it('占领区允许遇袭（高安也破例）· 非占领区不允许', () => {
    const { s, ev } = setup(['galaxy-home'])
    expect(weekendEncounterAllowedIn(s, ev.coreId, 0)).toBe(true)
    expect(weekendEncounterAllowedIn(s, 'galaxy-redring', 0)).toBe(false)
    // 找一个高安星系塞进外围 ⇒ 一样允许（破例）
    const high = [...ctx.galaxies.keys()].find((id) => securityZoneOf(ctx, id) === '高安')
    if (high) {
      ev.peripheryIds = [high]
      expect(weekendEncounterAllowedIn(s, high, 0), '占领区里高安也破例').toBe(true)
    }
  })

  it('掷骰：roll < 概率 ⇒ 出伏击 spec（单舰 · 强度 ×0.75）；roll ≥ 概率 ⇒ 不出', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const hit = weekendEncounterRollOf(s, ctx, per, 0.1, 0)
    expect(hit, '进度 0 ⇒ 概率 60%，roll 0.1 命中').toBeTruthy()
    expect(hit!.kind).toBe('ambush')
    expect(hit!.squadSize).toBe(1)
    // C 族是占位口径（虫洞池卡 + 覆写威胁）⇒ 标签 = round(78 × 0.75) = 59；真强度由 `foeStrengthMul` 落
    expect(hit!.threat).toBe(59)
    expect(hit!.foeStrengthMul, '遇袭真倍率 0.75').toBe(0.75)
    expect(weekendEncounterRollOf(s, ctx, per, 0.9, 0), 'roll 0.9 ≥ 0.6 ⇒ 不出').toBeUndefined()
    const coreHit = weekendEncounterRollOf(s, ctx, ev.coreId, 0.1, 0)
    expect(coreHit!.threat, '核心伏击 = round(120 × 0.75) = 90').toBe(90)
    expect(weekendEncounterRollOf(s, ctx, 'galaxy-redring', 0.1, 0), '非占领区 ⇒ 不出').toBeUndefined()
  })

  it('夺回后概率归零 ⇒ 再怎么掷都不出', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    weekendNoteContribution(ev, per, 1)
    expect(weekendEncounterRollOf(s, ctx, per, 0.0001, 0)).toBeUndefined()
  })

  /**
   * **船长 2026-09-25 令**：「**入侵期间，被占领星系的所有被收复的星系的常驻悬赏依旧处于隐藏状态，
   * 要等到入侵活动结束。**」（与旧设计稿「夺回 ⇒ 悬赏恢复」冲突 ⇒ 船长裁决改口径，见
   * `docs/design/weekend-invasion.md` 的改判行。）
   *
   * ⚠ 本判据只管**板面/详细页列不列**（界面侧）；取数口 `weekendBountyCardsOf` 照旧给"夺回 ⇒ 原卡"
   * —— 遇袭敌群池与残骸打捞池都读它，不能一起清掉。本用例把这两层**分别钉住**。
   */
  it('已收复 ⇒ 常驻悬赏押后到活动结束（取数口不变，只"板面"藏）', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const perCard = { ...card, galaxyId: per }
    // 未夺回：不押后（那一边由入侵舰队卡替换，既有口径不变）
    expect(weekendStandingBountyHeldAt(s, per, T), '仍被占 ⇒ 不押后').toBe(false)
    expect(weekendStandingBountyHeldAt(s, ev.coreId, T), '核心仍被占 ⇒ 不押后').toBe(false)
    expect(weekendStandingBountyHeldAt(s, 'galaxy-redring', T), '不在占领区 ⇒ 不押后').toBe(false)
    // 夺回 ⇒ 押后（这正是船长要的那一条）
    weekendNoteContribution(ev, per, 1)
    expect(weekendStandingBountyHeldAt(s, per, T), '已收复 ⇒ 押后').toBe(true)
    // 取数口**不变**：仍是原卡（打捞/遇袭读它；只是板面不列）
    expect(weekendBountyCardsOf(s, ctx, [perCard], per, T)[0], '取数口照旧给原卡').toBe(perCard)
    // 活动结束 ⇒ 押后解除，悬赏整批回来
    ev.endedAtWallMs = T
    expect(weekendStandingBountyHeldAt(s, per, T), '活动结束 ⇒ 恢复').toBe(false)
  })
})
