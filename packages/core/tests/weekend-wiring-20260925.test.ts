/**
 * **周末入侵 · 引擎接线端到端**（2026-09-25 接线批的验收证据）：
 * 十件事都走**真实引擎路径**（不手工造 spec）：
 * ① **被占星系的悬赏板**：`weekendBountyCardsOf` ⇒ H 族显示的是**抽到的那张独立卡**（真实 id · 威胁 = 卡面）；
 * ② **遇袭掷骰破例**：在**高安**被占星系采矿 ⇒ `rollLowSecAmbush` 命中 ⇒ 遭遇卡 ∈ H 池 · 强度 ×0.75 ·
 *    标签 = 缩放后实测价（76/91）· 日志说「入侵遭遇」；同条件**未占领**时高安一次都不掷（老口径不变）；
 * ③ **战后归属**：远征落盘 `foeGalaxyId` ⇒ `weekendBattleInvolvedOf` 认出 `assault` ⇒ 打赢记进度 +10%；
 * ④ **夺回奖励入账**：把一处外围打到满 ⇒ 钱包 ＋2M、稀有残骸 ×8 **真到手**（`weekendApplyBattleOutcome`）；
 * ⑤ **结束结算入账**：活动结束 ⇒ 贡献奖四档真发（ISK 进钱包 / 残骸进仓库）· **只发一次**（随档幂等标记）·
 *    占比按**结束时刻**评估（离线几天后再上线补结，读数与结束时一致，不会少发）；
 * ⑥ **遇袭进度档**：迎战打赢 = 击退 **+3%**（不是主动胜利的 +10%）· 打输 = 只受损不动进度 · 文字结算 +1%；
 * ⑦ **文字结算走真实引擎路径**（`advanceEncounterWatch` ⇒ `resolveTextual`）：40 档跑下来进度只可能是 0 或 +1%；
 * ⑧ **旗舰战的归属提示**：核心条满（进度 = 1）也照样认账（防"打完旗舰什么都不结算"复发）；
 * ⑨ **核心区日常循环**：门禁未解 ⇒ 打核心不给进度；外围全清 ⇒ 每场 +5%；
 * ⑩ **打空血池 ⇒ 击沉旗舰**：黑匣 `blackbox-h` 真入库 ＋ 稀有残骸 ×3 · 本场结束。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { startMining } from '../src/mining'
import { advanceEncounterWatch, maintainPresence, rollLowSecAmbush } from '../src/encounters'
import { commsInbox } from '../src/comms'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { WEEKEND_COMMS_SETTLE_ID, WEEKEND_COMMS_WARN_ID, weekendSyncComms } from '../src/weekendComms'
import {
  weekendBestFlagshipSquad,
  weekendFlagshipPrepView,
  weekendNoteFlagshipSquad,
  weekendPrepIssuesOf,
  weekendPrepSquadOf,
  weekendSanitizeFlagshipSquad,
} from '../src/weekendLaunch'
import {
  WEEKEND_FLAGSHIP_WRECK,
  WEEKEND_RECLAIM_ISK,
  WEEKEND_RECLAIM_WRECK,
  weekendApplyBattleOutcome,
  weekendBattleInvolvedOf,
  weekendSettleAndGrant,
  weekendSettlePlanOf,
} from '../src/weekendBattle'
import { weekendBountyCardsOf } from '../src/weekendBounty'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_GAIN_CORE_WIN,
  WEEKEND_GAIN_OFFLINE_REPEL,
  WEEKEND_GAIN_REPEL,
  endWeekendEvent,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
} from '../src/weekendEvent'
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
    /** 入账日志（id 制）：夺回是里程碑 ⇒ 必须留一条解释"钱从哪来" */
    const reclaimLog = [...s.logs].reverse().find((l) => l.textId === 'core.weekend.001')
    expect(reclaimLog?.text.includes('夺回'), '夺回要有入账日志').toBe(true)
    expect(reclaimLog?.textParams?.p2, '日志里的残骸数与实发一致').toBe(WEEKEND_RECLAIM_WRECK)
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

  it('⑨ 核心区：门禁未解 ⇒ 打核心不给进度；外围全清 ⇒ 每场 +5%', () => {
    const gid = GID
    const core = 'galaxy-kor'
    const now = Date.now()
    /** 外围未清：核心条被门禁挡住（第 7 条） */
    const gated = invaded(gid)
    const rg = weekendApplyBattleOutcome(gated, ctx, 'ink-main', true, now, null, {
      kind: 'assault',
      galaxyId: core,
    })
    expect(rg?.gain, '门禁未解 ⇒ 核心胜利不给进度').toBe(0)
    expect(gated.weekendEvent!.contributed[core] ?? 0).toBe(0)
    /** 外围全清 ⇒ 门禁解除 ⇒ 每场 +5% */
    const open = invaded(gid)
    weekendNoteContribution(open.weekendEvent!, gid, 1)
    const r1 = weekendApplyBattleOutcome(open, ctx, 'ink-main', true, now, null, {
      kind: 'assault',
      galaxyId: core,
    })
    expect(r1?.gain, '核心胜利 = +5%').toBeCloseTo(WEEKEND_GAIN_CORE_WIN, 6)
    expect(open.weekendEvent!.contributed[core] ?? 0).toBeCloseTo(0.05, 6)
  })

  it('⑩ 打空血池 ⇒ 击沉旗舰：黑匣 blackbox-h 真入库 ＋ 稀有残骸 ×3 · 本场结束', () => {
    const gid = GID
    const core = 'galaxy-kor'
    const s = invaded(gid)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, gid, 1) // 外围夺回 ⇒ 门禁解开
    weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
    const box0 = heldOf(s, 'blackbox-h')
    const wrecks0 = heldOf(s, 'wreck-rare-h-hi')
    /** 单场不死 ⇒ 只有"池子被打空"才算击沉（这里把已累计伤害推到池子满） */
    weekendNoteFlagshipDamage(s.weekendEvent!, WEEKEND_FLAGSHIP_POOL_HP, 1001)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, now, null, { kind: 'flagship', galaxyId: core })
    expect(r?.kind, '认得出这一场是旗舰战').toBe('flagship')
    expect(r?.wreck, '击沉旗舰的稀有残骸').toBe(WEEKEND_FLAGSHIP_WRECK)
    expect(heldOf(s, 'blackbox-h') - box0, '黑匣真入库（真物品 id）').toBe(1)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '旗舰残骸真到手').toBe(WEEKEND_FLAGSHIP_WRECK)
    expect(s.weekendEvent!.flagshipDown, '记玩家击毁').toBe('player')
    expect(s.weekendEvent!.endedAtWallMs, '击沉即结束本场').toBeDefined()
    /** 入账日志：旗舰击沉也要留一条（黑匣 + 残骸） */
    const killLog = [...s.logs].reverse().find((l) => l.textId === 'core.weekend.003')
    expect(killLog?.text.includes('旗舰击沉'), '击沉要有入账日志').toBe(true)
  })

  it('⑪ 贡献奖按"结束时刻"结算：离线五天后补结，档位与金额与结束时一模一样', () => {
    const gid = GID
    const now = Date.now()
    /** 真时间轴（关掉调试快进）：T0 = 54 小时前 ⇒ 外围铺底已满、核心铺底 25% */
    const build = (): ReturnType<typeof createInitialState> => {
      const s = invaded(gid)
      s.debugQuick = false
      s.weekendEvent!.startedAtWallMs = now - 54 * 3_600_000
      weekendNoteContribution(s.weekendEvent!, gid, 0.9) // 玩家推了 90% ⇒ 该处已夺回
      endWeekendEvent(s, now)
      return s
    }
    /** 结束时立刻结 */
    const onTime = build()
    const r1 = weekendSettleAndGrant(onTime, ctx, now)
    expect(r1, '结束时结算').not.toBeNull()
    expect(r1!.tier, '占比 ≈ 0.72 ⇒ B 档').toBe('B')
    expect(r1!.isk).toBe(5_000_000)
    expect(r1!.wreck).toBe(8)
    /** 离线五天后再上线补结（引擎每拍补发那条路径的形状）：读数必须与结束时**逐值一致** */
    const late = build()
    const r2 = weekendSettleAndGrant(late, ctx, now + 5 * 24 * 3_600_000)
    expect(r2, '补结也要发').not.toBeNull()
    expect(r2!.tier, '按结束时刻算 ⇒ 仍是 B 档（若改用"现在"会被铺底算低成 C 档）').toBe(r1!.tier)
    expect(r2!.isk).toBe(r1!.isk)
    expect(r2!.wreck).toBe(r1!.wreck)
    expect(late.weekendEvent!.prizePaidAtWallMs, '标记写的是"补结那一刻"').toBe(now + 5 * 24 * 3_600_000)
    /** **反证**：若把"现在"当结算时刻，这一档会被铺底算低成 C 档 ⇒ 本用例确实在守"按结束时刻算" */
    expect(weekendSettlePlanOf(late, late.weekendEvent!, now + 5 * 24 * 3_600_000).tier, '按"现在"算会降成 C 档').toBe('C')
  })

  it('⑫ 两封通讯：预警开局送达 · 结算在贡献奖入账后送达 · 每场覆盖同一 id（只留一封）', () => {
    const gid = GID
    const core = 'galaxy-kor'
    const now = Date.now()
    const s = invaded(gid)
    /** ① 预警：同步一次即送达（正文带本场处数与核心名，族名走 p1Id ⇒ 英文界面才有译名） */
    expect(weekendSyncComms(s, ctx, now).warned, '开局那一拍要发预警').toBe(true)
    const warn = commsInbox(s, ctx).find((e) => e.id === WEEKEND_COMMS_WARN_ID)
    expect(warn, '预警要进收件箱').toBeDefined()
    expect(warn!.subjectId).toBe('core.weekend.010')
    expect(warn!.bodyIds).toEqual(['core.weekend.011', 'core.weekend.012'])
    expect(warn!.textParams?.['p2'], '落点处数 = 核心 ＋ 外围').toBe(2)
    expect(warn!.textParams?.['p3']).toBe(ctx.galaxies.get(core)!.name)
    expect(warn!.textParams?.['p1Id'], '族名以 id 形式随信（界面按语言取译名）').toBe('core.weekend.023')
    expect(warn!.hint?.page, '预警的跳转落星图').toBe('map')
    expect(weekendSyncComms(s, ctx, now).warned, '同一场不重发').toBe(false)
    expect(commsInbox(s, ctx).filter((e) => e.id === WEEKEND_COMMS_WARN_ID).length, '只该有一封').toBe(1)

    /** ② 结算：结束 ＋ 贡献奖入账之后才发（正文里的奖励清单 = 实发） */
    weekendNoteContribution(s.weekendEvent!, gid, 0.5)
    endWeekendEvent(s, now)
    expect(weekendSettleAndGrant(s, ctx, now), '贡献奖要真发').not.toBeNull()
    expect(weekendSyncComms(s, ctx, now).settled, '入账后发结算信').toBe(true)
    const settle = commsInbox(s, ctx).find((e) => e.id === WEEKEND_COMMS_SETTLE_ID)
    expect(settle?.subjectId).toBe('core.weekend.013')
    expect(settle?.bodyIds, '有奖那一版正文').toEqual(['core.weekend.014'])
    expect(settle?.action, '结算信的跳转是"弹面板"').toBe('weekendSummary')
    expect(settle?.rewards?.length, '奖励清单结构化随信（残骸 ＋ 信用点）').toBe(2)

    /** ③ 战果快照（面板读它；数值与实发逐值一致） */
    const snap = s.weekendLastResult!
    expect(snap.seq).toBe(s.weekendEvent!.seq)
    expect(snap.family).toBe('H')
    expect(snap.coreId).toBe(core)
    expect(snap.galaxies.length, '核心 ＋ 外围都列出来').toBe(2)
    expect(snap.galaxies.find((g) => g.galaxyId === gid)?.put, '逐星系记玩家投入').toBeCloseTo(0.5, 6)
    expect(snap.tier).toBe('A')
    expect(snap.isk, '到手合计 = 实发').toBe(8_000_000)
    expect(snap.wreck).toBe(12)

    /** ④ 覆盖：下一场再同步 ⇒ 同 id 仍只有一封，内容换成新一场 */
    s.weekendEvent = { ...s.weekendEvent!, seq: 99, startedAtWallMs: now, endedAtWallMs: undefined, contributed: {} }
    expect(weekendSyncComms(s, ctx, now).warned, '新一场要覆盖重发').toBe(true)
    const warns = commsInbox(s, ctx).filter((e) => e.id === WEEKEND_COMMS_WARN_ID)
    expect(warns.length, '固定 id ⇒ 收件箱里始终只有一封').toBe(1)
    expect(warns[0]!.textParams?.['seq'], '内容是新的那一场').toBe(99)
  })

  it('⑬ 零贡献的结算信走变体 · 两封信与快照都随档往返', () => {
    const gid = GID
    const now = Date.now()
    const s = invaded(gid)
    weekendSyncComms(s, ctx, now) // 开局那封先发出去（下面才结束本场）
    endWeekendEvent(s, now)
    weekendSettleAndGrant(s, ctx, now)
    weekendSyncComms(s, ctx, now)
    const settle = commsInbox(s, ctx).find((e) => e.id === WEEKEND_COMMS_SETTLE_ID)
    expect(settle?.bodyIds, '零贡献 ⇒ 无奖那一版正文').toEqual(['core.weekend.015'])
    expect(settle?.rewards ?? [], '零贡献不发东西').toEqual([])
    /** 随档往返：实例通讯条目与战果快照都要原样回来（面板与信件都靠它们） */
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    const bw = back.commsInstance?.[WEEKEND_COMMS_WARN_ID]
    expect(bw?.subjectId).toBe('core.weekend.010')
    expect(bw?.params?.['p1Id']).toBe('core.weekend.023')
    const bs = back.weekendLastResult
    expect(bs?.seq).toBe(s.weekendLastResult!.seq)
    expect(bs?.tier).toBe('none')
    expect(bs?.galaxies.length).toBe(s.weekendLastResult!.galaxies.length)
    /** 读档后再同步：不该重发（`seq` 相同） */
    expect(weekendSyncComms(back, ctx, now).warned || weekendSyncComms(back, ctx, now).settled).toBe(false)
  })

  it('⑭ 旗舰战战前准备：视图/编队净化/落盘/按战力自动选（船长令"入口 ＋ 选船界面"）', () => {
    const gid = GID
    const core = 'galaxy-kor'
    const now = Date.now()
    /** 造一场"核心条满"的入侵 ⇒ 旗舰现身 ⇒ 准备视图应当出现 */
    const ready = (): ReturnType<typeof createInitialState> => {
      const s = invaded(gid)
      for (const extra of ['sh-kestrel', 'sh-falconet']) {
        try {
          addShipToFleet(s, extra)
        } catch {
          /* 夹具里没有这条船型就跳过 —— 用例只关心"多几艘可选" */
        }
      }
      weekendNoteContribution(s.weekendEvent!, gid, 1) // 外围夺回 ⇒ 门禁解开
      weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
      return s
    }
    const s = ready()
    const view = weekendFlagshipPrepView(s, ctx, now)
    expect(view, '核心条满 ⇒ 出准备视图').not.toBeNull()
    expect(view!.maxShips, '上限 4（旗舰战 = 4 艘小队战）').toBe(4)
    expect(view!.waves).toBeGreaterThan(0)
    expect(view!.candidates.length, '候选 = 舰队在编的全部船').toBe(Object.keys(s.fleet).length)
    expect(view!.pool.hpMax, '血池读数随视图给出').toBeGreaterThan(0)
    expect(view!.defaultSquad.length, '默认编队（无落盘 ⇒ 走自动编队）').toBeGreaterThan(0)
    /** 未现身（核心没满）⇒ 没有入口 */
    const early = invaded(gid)
    expect(weekendFlagshipPrepView(early, ctx, now), '核心没满 ⇒ 不出现').toBeNull()

    /** 编队净化：不在编的 id 丢掉、去重、截 4 艘 */
    const all = Object.keys(s.fleet)
    const sanitized = weekendSanitizeFlagshipSquad(s, [all[0]!, all[0]!, 'ghost-ship', ...all, all[0]!])
    expect(sanitized[0]).toBe(all[0])
    expect(sanitized.filter((x) => x === all[0]).length, '去重').toBe(1)
    expect(sanitized).not.toContain('ghost-ship')
    expect(sanitized.length).toBeLessThanOrEqual(4)

    /** 落盘：记住编队 ⇒ 下次默认就是它；落盘里的船退役后自动回落 */
    weekendNoteFlagshipSquad(s, sanitized)
    expect(s.weekendPrepSquad).toEqual(sanitized)
    expect(weekendPrepSquadOf(s), '默认 = 落盘编队').toEqual(sanitized)
    s.weekendPrepSquad = ['ghost-ship']
    expect(weekendPrepSquadOf(s).length, '落盘全失效 ⇒ 回落自动编队').toBeGreaterThan(0)
    expect(weekendPrepSquadOf(s)).not.toContain('ghost-ship')

    /** 按战力自动选：候选里战力最高的至多 4 艘、只含在编船 */
    const best = weekendBestFlagshipSquad(s, ctx)
    expect(best.length).toBeLessThanOrEqual(4)
    expect(best.every((id) => s.fleet[id] !== undefined)).toBe(true)

    /** 缺口标记：新档自带的船没装武器 ⇒ 至少标一个缺口；装甲/结构满 ⇒ 不标那两条 */
    const issues = weekendPrepIssuesOf(s, ctx, s.shipId)
    expect(issues.includes('low-armor') || issues.includes('low-hull'), '满装甲满结构不该标低').toBe(false)
  })
})
