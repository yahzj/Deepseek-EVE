/**
 * **周末入侵 · 引擎接线端到端**（2026-09-25 接线批的验收证据）：
 * 三件事都走**真实引擎路径**（不手工造 spec）：
 * ① **被占星系的悬赏板**：`weekendBountyCardsOf` ⇒ H 族显示的是**抽到的那张独立卡**（真实 id · 威胁 = 卡面）；
 * ② **遇袭掷骰破例**：在**高安**被占星系采矿 ⇒ `rollLowSecAmbush` 命中 ⇒ 遭遇卡 ∈ H 池 · 强度 ×0.75 ·
 *    标签 = 缩放后实测价（76/91）· 日志说「入侵遭遇」；同条件**未占领**时高安一次都不掷（老口径不变）；
 * ③ **战后归属**：远征落盘 `foeGalaxyId` ⇒ `weekendBattleInvolvedOf` 认出 `assault` ⇒ 打赢记进度 +10%。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { startMining } from '../src/mining'
import { maintainPresence, rollLowSecAmbush } from '../src/encounters'
import { weekendApplyBattleOutcome, weekendBattleInvolvedOf } from '../src/weekendBattle'
import { weekendBountyCardsOf } from '../src/weekendBounty'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()

/** 造一场 H 族入侵（墙钟起点 = 此刻，占领判定按墙钟）；外围 = 传入星系 */
function invaded(galaxyId: string, seed = 21): ReturnType<typeof createInitialState> {
  const s = createInitialState({ nowWallMs: 0, seed })
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 9,
    startedAtWallMs: Date.now(),
    coreId: 'galaxy-kor',
    peripheryIds: [galaxyId],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

describe('周末入侵 · 引擎接线端到端（2026-09-25）', () => {
  it('① 被占星系的悬赏板 = 抽到的那张 H 族独立卡（真实 id · 威胁 = 卡面自身）', () => {
    const belt = [...ctx.belts.values()].find((b) => typeof b.galaxyId === 'string' && b.galaxyId !== 'galaxy-hub' && b.galaxyId !== 'galaxy-kor')!
    const gid = belt.galaxyId!
    const s = invaded(gid)
    /** 该星系原本的可见悬赏（引擎按 `galaxyId` 过滤后交给替换口） */
    const base = [...ctx.anomalies.values()].filter((a) => !a.hidden && a.galaxyId === gid)
    expect(base.length, '该星系要有原卡，才测得到"替换"').toBeGreaterThan(0)
    const shown = weekendBountyCardsOf(s, ctx, base, gid, Date.now())
    expect(shown.length).toBe(base.length)
    for (const c of shown) {
      expect(['ink-harass', 'ink-raid'], '外围池 = {骚扰, 袭击}').toContain(c.id)
      expect(c.threat, '威胁 = 卡面自身（不再是 78 覆写）').toBe(ctx.anomalies.get(c.id)!.threat)
      expect(c.galaxyId, '星系覆写成被占星系').toBe(gid)
      expect(c.rewardIsk, '奖励 = 该星系原卡 ×1.4').toBe(Math.round((base[0]!.rewardIsk ?? 0) * 1.4))
    }
    // 夺回后自动回落原卡（同一取数口）
    s.weekendEvent!.contributed[gid] = 1
    expect(weekendBountyCardsOf(s, ctx, base, gid, Date.now())[0]!.id).toBe(base[0]!.id)
  })

  it('② 高安被占星系采矿 ⇒ 遇袭掷骰破例命中（H 池卡 · ×0.75 · 标签 76/91）；同条件未占领时高安不掷', () => {
    /** 挑一条**高安**矿带（"占领区破例"要证的正是"高安也掷"）：星尘荒原 +0.6 */
    const belt = [...ctx.belts.values()].find((b) => {
      const sec = b.galaxyId ? ctx.galaxies.get(b.galaxyId)?.security : undefined
      return sec !== undefined && sec > ctx.balance.encounter.lowSecMax
    })!
    const gid = belt.galaxyId!
    expect(ctx.galaxies.get(gid)?.security ?? 1, '本用例必须落在高安，否则证不了"破例"').toBeGreaterThan(
      ctx.balance.encounter.lowSecMax,
    )
    /** 在该星系开工采矿 ⇒ 产生"暴露"（`collectExposures` 的输入；采矿指令即视为在带） */
    const run = (occupying: boolean): { spawned: boolean; s: ReturnType<typeof createInitialState> } => {
      const s = occupying ? invaded(gid) : createInitialState({ nowWallMs: 0, seed: 21 })
      s.debugQuick = true
      const uid = addShipToFleet(s, 'sh-falconet')
      s.shipId = uid
      s.exploredGalaxies = [...new Set([...(s.exploredGalaxies ?? []), gid])]
      expect(startMining(s, belt.id, ctx).ok, '开工采矿').toBe(true)
      let spawned = false
      for (let i = 0; i < 200 && !spawned; i++) {
        s.encounterZoneCooldown[gid] = 0 // 清区域冷却：让每一掷都独立（本用例只验"能不能掷出"）
        spawned = rollLowSecAmbush(s, ctx, 1, Date.now())
      }
      return { spawned, s }
    }
    const hit = run(true)
    expect(hit.spawned, '高安占领区：掷 200 次必命中（破例 · p = 60%×(1−进度)）').toBe(true)
    expect(hit.s.encounter.galaxyId, '遭遇挂在被占星系').toBe(gid)
    expect(['ink-harass', 'ink-raid'], '遭遇卡 ∈ 外围池').toContain(hit.s.encounter.anomalyId)
    expect(hit.s.encounter.foeStrengthMul, '真强度 ×0.75').toBe(0.75)
    expect([76, 91], '标签 = 缩放后实测价').toContain(hit.s.encounter.threat)
    /** 文案：高安占领区里说「低安遭遇」就是错的 ⇒ 走「入侵遭遇」（id 制，`core.encounters.008`） */
    const ambushLog = [...hit.s.logs].reverse().find((l) => l.text.includes('遭该编队伏击'))
    expect(ambushLog?.textId).toBe('core.encounters.008')
    expect(ambushLog?.text.includes('入侵遭遇'), '高安不写"低安遭遇"').toBe(true)
    /** 破例**不进**"低安在场记录"：中安/高安占领区不记 `lowSecPresence`、也不弹"首次进入低安" */
    maintainPresence(hit.s, ctx)
    expect(Object.keys(hit.s.lowSecPresence).length, '高安占领区不记低安在场').toBe(0)
    expect(hit.s.lowSecNotified, '不误报"首次进入低安"').toBe(false)
    /** 负向：同一高安星系、同一暴露，**不在占领区** ⇒ 高安平时一次都不掷（老口径逐字不变） */
    const miss = run(false)
    expect(miss.spawned, '高安未占领：掷 200 次一次都不该中').toBe(false)
    expect(miss.s.encounter.active).toBe(false)
  })

  it('③ 远征打卡 ⇒ 认得出 assault（星系来自远征落盘）· 打赢记进度 +10%', () => {
    const belt = [...ctx.belts.values()].find((b) => typeof b.galaxyId === 'string' && b.galaxyId !== 'galaxy-hub' && b.galaxyId !== 'galaxy-kor')!
    const gid = belt.galaxyId!
    const s = invaded(gid)
    s.expedition.foeGalaxyId = gid
    s.expedition.anomalyId = 'ink-harass'
    const now = Date.now()
    expect(weekendBattleInvolvedOf(s, ctx, 'ink-harass', now)).toEqual({ galaxyId: gid, kind: 'assault' })
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-harass', true, now, null)
    expect(r?.galaxyId).toBe(gid)
    expect(r?.kind).toBe('assault')
    expect(s.weekendEvent!.contributed[gid] ?? 0, '打赢外围 ⇒ 进度 +10%').toBeCloseTo(0.1, 6)
  })
})
