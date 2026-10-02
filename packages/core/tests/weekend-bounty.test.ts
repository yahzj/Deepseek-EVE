/**
 * **周末入侵 · 悬赏替换与遇袭判定用例**（M1-b 第三片）
 * 覆盖：派生卡只覆盖 id/名字/威胁/奖励 · 非占领区/活动结束 ⇒ 原卡原样 ·
 * (**2026-10-02 起：夺回后也照旧换成入侵舰队卡** —— 船长令"100% 后仍可继续刷、掉落半量作惩罚") ·
 * 高安破例（占领区不看安全等级）· 遇袭掷骰边界与伏击 spec（单舰 39/60）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { securityZoneOf } from '../src/securityZone'
import {
  weekendBountyCardsOf,
  weekendDerivedCardOf,
  weekendEncounterAllowedIn,
  weekendEncounterRollOf,
} from '../src/weekendBounty'
/** 只为断言"押后判据已从导出面删除"（2026-09-28 船长令撤掉那条规则） */
import * as weekendBountyNS from '../src/weekendBounty'
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
    /* ⟪文案调整 2026-10-01⟫ 船长报障「不应该直接用X族」：悬赏名原印族代号（「C 族舰队 · …」），
       现改用**正式族名**（`weekendFamilyNameZh`）⇒ 这里钉正式名，并加一条"不许出现族代号"。 */
    expect(d.name).toContain('异形生物舰队')
    expect(d.name, '不许把数据侧族代号印给玩家').not.toMatch(/[A-Z]\d?\s*族/)
    expect(d.name).toContain(card.name)
    expect(d.threat).toBe(78)
    // **赏金 = 0**（船长 2026-09-25：「入侵舰队不应该有赏金」；原口径"原卡 ×1.4"已退役）
    expect(d.rewardIsk).toBe(0)
    expect(d.galaxyId, '其余字段原样').toBe(card.galaxyId)
    expect(d.standingReq).toBe(card.standingReq)
  })

  it('核心的派生卡威胁 120；非占领区/活动结束 ⇒ 原卡；**夺回后仍换入侵卡**（2026-10-02 新口径）', () => {
    const { s, ev } = setup()
    const core = weekendBountyCardsOf(s, ctx, [card], ev.coreId, T)
    expect(core[0]!.threat).toBe(120)
    const other = weekendBountyCardsOf(s, ctx, [card], 'galaxy-redring', T)
    expect(other[0], '不在占领区 ⇒ 原卡').toBe(card)
    /**
     * **夺回（推进到满）⇒ 照旧换入侵舰队卡**（**2026-10-02 船长令**：「我希望的是 100% 后能够继续刷，
     * 但是掉落残骸数量需要减半作为惩罚」）——改前是"夺回 ⇒ 恢复原卡"，那条口径随本批作废。
     */
    const perId = ev.peripheryIds[0]!
    const perCard = { ...card, galaxyId: perId }
    weekendNoteContribution(ev, perId, 1)
    const afterReclaim = weekendBountyCardsOf(s, ctx, [perCard], perId, T)[0]!
    expect(afterReclaim.id !== perCard.id || afterReclaim.rewardIsk === 0, '夺回后 ⇒ 仍是入侵舰队卡').toBe(true)
    expect(afterReclaim.rewardIsk, '入侵舰队卡不给赏金（2026-09-25 口径不变）').toBe(0)
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
    expect(out[0]!.name).toContain('墨潮帮')
    expect(out[0]!.name, '卡名自带族名 ⇒ 不再重复加前缀（否则「墨潮帮舰队 · 墨潮帮骚扰舰队」）').not.toContain('墨潮帮舰队 · 墨潮帮')
    expect(out[0]!.name, '不许把数据侧族代号印给玩家（2026-10-01 船长报障）').not.toMatch(/[A-Z]\d?\s*族/)
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
   * **2026-09-28 船长令**：「**入侵期间，赏金任务照常发放（只有势力活跃关闭）。**」
   *
   * 沿革：**2026-09-25** 那次曾令「被收复的星系的常驻悬赏依旧隐藏、要等到活动结束」，
   * 本批把那条**整条撤销**（`weekendStandingBountyHeldAt` 连同界面两处调用、状态占位文案
   * `ui.weekend.100`、旧用例一并删除）。
   *
   * ⚠ 与本条无关的两件事**照旧**（船长只说了"赏金任务照常发放"）：**仍被占**的星系照旧由入侵舰队卡
   * 替换（`weekendBountyCardsOf`）、入侵舰队卡**照样不给赏金**。本用例把这两层分别钉住。
   */
  it('收复后照常列悬赏（押后判据已删）· 取数口"被占 ⇒ 入侵舰队卡 / **夺回 ⇒ 也是入侵舰队卡**"', () => {
    const { s, ev } = setup()
    const per = ev.peripheryIds[0]!
    const perCard = { ...card, galaxyId: per }
    /** ① 仍被占 ⇒ 取数口给"入侵舰队"那张（派生/独立卡，赏金 0）——既有口径不变 */
    const occupied = weekendBountyCardsOf(s, ctx, [perCard], per, T)[0]!
    expect(occupied.id !== perCard.id || occupied.rewardIsk === 0, '被占 ⇒ 换成入侵舰队卡').toBe(true)
    expect(occupied.rewardIsk, '入侵舰队卡不给赏金（2026-09-25 口径不变）').toBe(0)
    /**
     * ② **夺回 ⇒ 照旧是入侵舰队卡**（**2026-10-02 船长令**：100% 后仍可继续刷、掉落半量作惩罚）
     * ——改前"夺回 ⇒ 回原卡"的口径随本批作废；**界面也照常列**（押后判据 2026-09-28 已删）。
     */
    weekendNoteContribution(ev, per, 1)
    const reclaimed = weekendBountyCardsOf(s, ctx, [perCard], per, T)[0]!
    expect(reclaimed.id !== perCard.id || reclaimed.rewardIsk === 0, '夺回 ⇒ 仍是入侵舰队卡').toBe(true)
    expect(
      (weekendBountyNS as Record<string, unknown>)['weekendStandingBountyHeldAt'],
      '押后判据已从模块导出面删除（别再复活）',
    ).toBeUndefined()
    /** ③ 活动结束 ⇒ 照旧原卡（本条从未变过，留一行防回归） */
    ev.endedAtWallMs = T
    expect(weekendBountyCardsOf(s, ctx, [perCard], per, T)[0], '活动结束 ⇒ 原卡').toBe(perCard)
  })
})
