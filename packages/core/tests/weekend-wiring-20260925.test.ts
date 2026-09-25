/**
 * **周末入侵 · 引擎接线端到端**（2026-09-25 接线批的验收证据）：
 * 五件事都走**真实引擎路径**（不手工造 spec）：
 * ① **被占星系的悬赏板**：`weekendBountyCardsOf` ⇒ H 族显示的是**抽到的那张独立卡**（真实 id · 威胁 = 卡面）；
 * ② **遇袭掷骰破例**：在**高安**被占星系采矿 ⇒ `rollLowSecAmbush` 命中 ⇒ 遭遇卡 ∈ H 池 · 强度 ×0.75 ·
 *    标签 = 缩放后实测价（76/91）· 日志说「入侵遭遇」；同条件**未占领**时高安一次都不掷（老口径不变）；
 * ③ **战后归属**：远征落盘 `foeGalaxyId` ⇒ `weekendBattleInvolvedOf` 认出 `assault` ⇒ 打赢记进度 +10%；
 * ④ **夺回奖励入账**：把一处外围打到满 ⇒ 钱包 ＋2M、稀有残骸 ×8 **真进仓库**（`weekendApplyBattleOutcome`）；
 * ⑤ **结束结算入账**：活动结束 ⇒ 贡献奖四档真发（ISK 进钱包 / 残骸进仓库）· **只发一次**（随档幂等标记）·
 *    占比按**结束时刻**评估（离线几天后再上线补结，读数与结束时一致，不会少发）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { startMining } from '../src/mining'
import { advanceEncounterWatch, maintainPresence, rollLowSecAmbush } from '../src/encounters'
import {
  WEEKEND_RECLAIM_ISK,
  WEEKEND_RECLAIM_WRECK,
  weekendApplyBattleOutcome,
  weekendBattleInvolvedOf,
  weekendSettleAndGrant,
} from '../src/weekendBattle'
import { weekendBountyCardsOf } from '../src/weekendBounty'
import { WEEKEND_GAIN_OFFLINE_REPEL, WEEKEND_GAIN_REPEL, endWeekendEvent, weekendNoteContribution } from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
/** 用例共用的"被占星系"= 第一条不挂母港/核心的矿带所在星系（星系名不进断言，只作 id） */
const gbelt = [...ctx.belts.values()].find(
  (b) => typeof b.galaxyId === 'string' && b.galaxyId !== 'galaxy-hub' && b.galaxyId !== 'galaxy-kor',
)!
const GID = gbelt.galaxyId!
/** 稀有残骸"手上有多少" = **驾驶船货舱 ＋ 仓库**（战斗奖励走 `addItem` ⇒ 先落货舱，进港卸货后进仓库） */
const heldOf = (s: ReturnType<typeof createInitialState>, id: string): number =>
  (s.fleet[s.shipId]?.cargo?.[id] ?? 0) + (s.warehouse.items[id] ?? 0)

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
    const gid = GID
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
    const gid = GID
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

  it('④ 夺回（进度打满）⇒ 夺回奖励入账：钱包 +2M · 稀有残骸 ×8 真进仓库', () => {
    const gid = GID
    const s = invaded(gid)
    s.expedition.foeGalaxyId = gid
    s.expedition.anomalyId = 'ink-harass'
    /** 先把该星系推到 90%（NPC 铺底此刻 ≈ 0 ⇒ 还没夺回），再打赢一场越过 100% */
    weekendNoteContribution(s.weekendEvent!, gid, 0.9)
    const now = Date.now()
    const isk0 = s.wallet.isk
    const wrecks0 = heldOf(s, 'wreck-rare-h-hi')
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-harass', true, now, null)
    expect(r?.note, '这一场越过 100% ⇒ 夺回').toContain('夺回')
    expect(r?.isk, '夺回奖励 ISK').toBe(WEEKEND_RECLAIM_ISK)
    expect(r?.wreck, '夺回奖励残骸').toBe(WEEKEND_RECLAIM_WRECK)
    expect(s.wallet.isk - isk0, 'ISK 真进钱包').toBe(WEEKEND_RECLAIM_ISK)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '稀有残骸真到手（H 组稀有件）').toBe(WEEKEND_RECLAIM_WRECK)
  })

  it('⑤ 活动结束 ⇒ 贡献奖入账（四档）· 只发一次 · 占比按结束时刻算', () => {
    const gid = GID
    const s = invaded(gid)
    const now = Date.now()
    /** 玩家独自推了 50%（NPC 铺底此刻 ≈ 0）⇒ 占比 100% ⇒ A 档：稀有残骸 ×12 ＋ 8M */
    weekendNoteContribution(s.weekendEvent!, gid, 0.5)
    endWeekendEvent(s, now)
    const isk0 = s.wallet.isk
    const wrecks0 = heldOf(s, 'wreck-rare-h-hi')
    const r = weekendSettleAndGrant(s, ctx, now)
    expect(r, '结束后的第一次调用要真发').not.toBeNull()
    expect(r!.tier, '占比 = 玩家 ÷（玩家＋NPC 铺底）= 100% ⇒ A 档').toBe('A')
    expect(r!.isk).toBe(8_000_000)
    expect(r!.wreck).toBe(12)
    expect(s.wallet.isk - isk0, 'ISK 真进钱包').toBe(8_000_000)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '稀有残骸真到手').toBe(12)
    expect(s.weekendEvent!.prizePaidAtWallMs, '随档幂等标记').toBe(now)
    /** 幂等：同一刻再调、以及**过一周再调**（离线补结的口径）都不再发 */
    expect(weekendSettleAndGrant(s, ctx, now)).toBeNull()
    expect(weekendSettleAndGrant(s, ctx, now + 7 * 24 * 3_600_000)).toBeNull()
    expect(s.wallet.isk - isk0, '只发一次').toBe(8_000_000)
    /** 零贡献 ⇒ 无奖（Q5「0% ⇒ 无」），但"已结"标记照写（免得每拍重算） */
    const s2 = invaded(gid)
    endWeekendEvent(s2, now)
    const isk2 = s2.wallet.isk
    const r2 = weekendSettleAndGrant(s2, ctx, now)
    expect(r2).not.toBeNull()
    expect(r2!.tier, '零贡献 ⇒ none').toBe('none')
    expect(r2!.isk + r2!.wreck, '零贡献不发东西').toBe(0)
    expect(s2.wallet.isk, '钱包不动').toBe(isk2)
    expect(s2.weekendEvent!.prizePaidAtWallMs, '零贡献也要落"已结"标记').toBe(now)
  })

  it('⑥ 迎战遇袭：打赢 = 击退（+3%，不是主动胜利的 +10%）· 打输 = 只受损不动进度', () => {
    const gid = GID
    const now = Date.now()
    /** 遭遇槽里挂入侵伏击卡 = `rollLowSecAmbush` 命中那一拍的形状（威胁 76 = 骚扰卡 ×0.75） */
    const withAmbush = (): ReturnType<typeof createInitialState> => {
      const s = invaded(gid)
      s.encounter = {
        active: true,
        shipId: s.shipId,
        galaxyId: gid,
        name: 'H 族舰队 · 墨潮骚扰编队',
        threat: 76,
        anomalyId: 'ink-harass',
        origin: '测试 · 采矿',
        invitedAtGameMs: 0,
        deadlineGameMs: 0,
        battle: null,
      }
      return s
    }
    const win = withAmbush()
    const rw = weekendApplyBattleOutcome(win, ctx, 'ink-harass', true, now, null, {
      kind: 'ambush',
      galaxyId: gid,
      source: 'battle',
    })
    expect(rw?.kind).toBe('ambush')
    expect(rw?.gain, '迎战击退遇袭 = +3%（设计稿；不是主动胜利的 +10%）').toBeCloseTo(WEEKEND_GAIN_REPEL, 6)
    const lose = withAmbush()
    const rl = weekendApplyBattleOutcome(lose, ctx, 'ink-harass', false, now, null, {
      kind: 'ambush',
      galaxyId: gid,
      source: 'battle',
    })
    expect(rl?.gain, '遇袭打输：只受损、进度不动').toBe(0)
    expect(lose.weekendEvent!.contributed[gid] ?? 0, '打输不加进度').toBe(0)
    /** 文字结算（离线 / 无人应答 / 快速脱离）的击退走设计稿的 **+1%** 那一档 */
    const txt = withAmbush()
    const rt = weekendApplyBattleOutcome(txt, ctx, 'ink-harass', true, now, null, {
      kind: 'ambush',
      galaxyId: gid,
      source: 'text',
    })
    expect(rt?.gain, '文字结算击退 = +1%').toBeCloseTo(WEEKEND_GAIN_OFFLINE_REPEL, 6)
  })

  it('⑦ 遇袭文字结算走真实引擎路径：只可能给 0 或 +1%（绝不是 +3%/+10%）', () => {
    const gid = GID
    /** 待决遭遇（未迎战）⇒ 过截止时刻 ⇒ `resolveTextual` 三档结算 —— 引擎每拍的真实路径 */
    const pending = (): ReturnType<typeof createInitialState> => {
      const s = invaded(gid)
      const uid = addShipToFleet(s, 'sh-falconet')
      s.shipId = uid
      s.encounter = {
        active: true,
        shipId: uid,
        galaxyId: gid,
        name: 'H 族舰队 · 墨潮骚扰编队',
        threat: 76,
        anomalyId: 'ink-harass',
        origin: '测试 · 采矿',
        invitedAtGameMs: 0,
        deadlineGameMs: 0, // 已过截止 ⇒ 本拍就按文字结算
        battle: null,
      }
      return s
    }
    const gains = new Set<number>()
    for (let i = 0; i < 40; i++) {
      const s = pending()
      s.rng = { seed: 1000 + i * 7919, count: 0 } // 逐档换随机序列：覆盖"击退/受损/被抢"三档
      advanceEncounterWatch(s, ctx, 1000)
      expect(s.encounter.active, '结算后遭遇关闭').toBe(false)
      gains.add(Number((s.weekendEvent!.contributed[gid] ?? 0).toFixed(4)))
    }
    expect([...gains].every((g) => g === 0 || g === 0.01), `只可能是 0（受损/被抢）或 +1%（击退）：${[...gains].join('/')}`).toBe(true)
    expect(gains.has(0.01), '40 档里必有判成"击退"的 ⇒ +1% 真发得出去').toBe(true)
    expect(gains.has(0), '判成受损/被抢 ⇒ 进度不动').toBe(true)
  })

  it('⑧ 旗舰战的归属提示：核心条满（进度 = 1）也照样认账（否则"打完旗舰什么都不结算"会复发）', () => {
    const gid = GID
    const s = invaded(gid)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, gid, 1) // 外围夺回 ⇒ 核心门禁解开
    weekendNoteContribution(s.weekendEvent!, 'galaxy-kor', 1) // 核心条满 ⇒ 旗舰现身
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, now, null, {
      kind: 'flagship',
      galaxyId: 'galaxy-kor',
    })
    expect(r?.kind, '核心条满（weekendOccupiedLiveAt 已为假）仍认旗舰战').toBe('flagship')
    expect(r?.galaxyId).toBe('galaxy-kor')
    expect(s.weekendEvent!.flagshipHpMax, '这一场已在池子上立账').toBeDefined()
  })
})
