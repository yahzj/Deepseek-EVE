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
    // 2026-09-23 船长报障「前往入侵星系战斗提示未知目标」⇒ 派生卡**保留原卡 id**（出发/开战路径都按 id 取卡）`n    expect(d.id, ').toBe(card.id)
    expect(d.name).toContain('C 族舰队')
    expect(d.name).toContain(card.name)
    expect(d.threat).toBe(78)
    expect(d.rewardIsk).toBe(Math.round(card.rewardIsk * WEEKEND_BOUNTY_REWARD_MUL))
    expect(d.galaxyId, '其余字段原样').toBe(card.galaxyId)
    expect(d.standingReq).toBe(card.standingReq)
  })

  it('核心的派生卡威胁 120；非占领区/夺回后原样返回原卡', () => {
    const { s, ev } = setup()
    const core = weekendBountyCardsOf(s, [card], ev.coreId, T)
    expect(core[0]!.threat).toBe(120)
    const other = weekendBountyCardsOf(s, [card], 'galaxy-redring', T)
    expect(other[0], '不在占领区 ⇒ 原卡').toBe(card)
    // 夺回（推进到满）⇒ 恢复原卡（**用外围卡**：核心要等外围清完才可能满）
    const perId = ev.peripheryIds[0]!
    const perCard = { ...card, galaxyId: perId }
    weekendNoteContribution(ev, perId, 1)
    expect(weekendBountyCardsOf(s, [perCard], perId, T)[0], '夺回后 ⇒ 原卡').toBe(perCard)
    // 活动结束 ⇒ 原卡
    ev.contributed = {}
    ev.endedAtWallMs = T
    expect(weekendBountyCardsOf(s, [perCard], perId, T)[0]).toBe(perCard)
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

  it('掷骰：roll < 概率 ⇒ 出伏击 spec（单舰 · 威胁 ×0.5）；roll ≥ 概率 ⇒ 不出', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const hit = weekendEncounterRollOf(s, ctx, per, 0.1, 0)
    expect(hit, '进度 0 ⇒ 概率 60%，roll 0.1 命中').toBeTruthy()
    expect(hit!.kind).toBe('ambush')
    expect(hit!.squadSize).toBe(1)
    expect(hit!.threat).toBe(39)
    expect(weekendEncounterRollOf(s, ctx, per, 0.9, 0), 'roll 0.9 ≥ 0.6 ⇒ 不出').toBeUndefined()
    const coreHit = weekendEncounterRollOf(s, ctx, ev.coreId, 0.1, 0)
    expect(coreHit!.threat, '核心伏击 60').toBe(60)
    expect(weekendEncounterRollOf(s, ctx, 'galaxy-redring', 0.1, 0), '非占领区 ⇒ 不出').toBeUndefined()
  })

  it('夺回后概率归零 ⇒ 再怎么掷都不出', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    weekendNoteContribution(ev, per, 1)
    expect(weekendEncounterRollOf(s, ctx, per, 0.0001, 0)).toBeUndefined()
  })
})
