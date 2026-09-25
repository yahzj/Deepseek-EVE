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
import { advanceEncounterWatch, maintainPresence, retreatEncounterBattle, rollLowSecAmbush } from '../src/encounters'
import { activeFoeSpecsOf, advanceBattleFor, applyFoeOverride, battleArcsFor, battleOpenM, createBattleState, createPlayerSpec, flagshipBattleLedger, foeDesiredRange, foeJammerCountOf, meJammerNetOf, meRangeMulOf } from '../src/combat'
// 敌卡解析单点（洞内 / 旗舰战 / 远征三口径）在 `wormholeBattle` 里
import { battleFoeAnomaly } from '../src/wormholeBattle'
import { commsInbox } from '../src/comms'
import { factionGalaxyId, isFactionBounty, sideTaskBoard } from '../src/sideTasks'
// 期望距离（2026-09-25 修：旗舰战也要认这个宿主）
import { setBattleDesire } from '../src/expedition'
import { desirePrefOf } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { WEEKEND_COMMS_SETTLE_ID, WEEKEND_COMMS_WARN_ID, weekendSyncComms } from '../src/weekendComms'
import { weekendAssaultDrawOf, weekendNoteAssaultDispatch } from '../src/weekendBounty'
import {
  weekendBestFlagshipSquad,
  weekendFlagshipBattleActive,
  weekendFlagshipBattleViewOf,
  weekendFlagshipPrepView,
  weekendNoteFlagshipSquad,
  weekendPrepIssuesOf,
  weekendPrepSquadOf,
  weekendSanitizeFlagshipSquad,
  weekendStartFlagshipBattle,
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
  WEEKEND_PROGRESS_ISK_PER_PCT,
  endWeekendEvent,
  weekendFlagshipHpRemaining,
  weekendFlagshipLayerCaps,
  weekendFlagshipLayersOf,
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
      expect(c.rewardIsk, '无赏金（船长 2026-09-25「入侵舰队不应该有赏金」）').toBe(0)
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

  it('③ 远征打卡 ⇒ 认得出 assault（星系来自远征落盘）· 打赢记进度（调试 +50%）', () => {
    const gid = GID
    const s = invaded(gid)
    s.expedition.foeGalaxyId = gid
    s.expedition.anomalyId = 'ink-harass'
    const now = Date.now()
    expect(weekendBattleInvolvedOf(s, ctx, 'ink-harass', now)).toEqual({ galaxyId: gid, kind: 'assault' })
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-harass', true, now, null)
    expect(r?.galaxyId).toBe(gid)
    expect(r?.kind).toBe('assault')
    expect(s.weekendEvent!.contributed[gid] ?? 0, '打赢外围 ⇒ 调试模式一场 +50%（两场收复）').toBeCloseTo(0.5, 6)
  })

  it('④ 夺回（进度打满）⇒ 夺回奖励**改到活动结束统一发**（船长 2026-09-25）', () => {
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
    /** 船长 2026-09-25：「夺回星区的奖励不要即时发放，放入结束后结算发放」⇒ 此刻**一分不发**，只记台账 */
    expect(r?.isk, '即时不发 ISK').toBe(0)
    expect(r?.wreck, '即时不发残骸').toBe(0)
    expect(s.wallet.isk - isk0, '钱包不动').toBe(0)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '货舱也不动').toBe(0)
    expect(s.weekendEvent!.reclaimPending, '待到账那一格记着').toEqual({
      isk: WEEKEND_RECLAIM_ISK,
      wreck: WEEKEND_RECLAIM_WRECK,
    })
    expect(s.weekendEvent!.rewardLedger?.byGalaxy[gid], '台账按星系记着（面板那一列读它）').toEqual({
      isk: WEEKEND_RECLAIM_ISK,
      wreck: WEEKEND_RECLAIM_WRECK,
    })
    /** 结束 ⇒ 结算那一刻连贡献奖与**进度收入**一起发（此处占比 100% ⇒ A 档 ×12 ＋ 8M；进度 100% ⇒ 2,000 万） */
    endWeekendEvent(s, now)
    const settle = weekendSettleAndGrant(s, ctx, now)
    expect(settle, '结束结算').not.toBeNull()
    const income = 100 * WEEKEND_PROGRESS_ISK_PER_PCT // 该处进度打满 100% × 20 万/1%
    expect(settle!.progressIsk, '进度收入单列在返回值里').toBe(income)
    expect(settle!.isk, '结算 = 贡献奖 8M ＋ 夺回 2M ＋ 进度收入 20M').toBe(8_000_000 + WEEKEND_RECLAIM_ISK + income)
    expect(settle!.wreck, '结算 = 贡献奖 ×12 ＋ 夺回 ×8').toBe(12 + WEEKEND_RECLAIM_WRECK)
    expect(s.wallet.isk - isk0, 'ISK 这时才进钱包').toBe(8_000_000 + WEEKEND_RECLAIM_ISK + income)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '残骸这时才到手').toBe(12 + WEEKEND_RECLAIM_WRECK)
    /** 日志（id 制）：夺回是里程碑 ⇒ 留一条，且措辞是"待活动结束时统一发放"（不再说"已入账"） */
    const reclaimLog = [...s.logs].reverse().find((l) => l.textId === 'core.weekend.001')
    expect(reclaimLog?.text.includes('夺回'), '夺回要有日志').toBe(true)
    expect(reclaimLog?.text.includes('待活动结束时统一发放'), '措辞 = 待发放').toBe(true)
    expect(reclaimLog?.textParams?.p2, '日志里的残骸数与台账一致').toBe(WEEKEND_RECLAIM_WRECK)
  })

  it('⑤ 活动结束 ⇒ 贡献奖入账（四档）＋ 进度收入 · 只发一次 · 占比按结束时刻算', () => {
    const gid = GID
    const s = invaded(gid)
    const now = Date.now()
    /** 玩家独自推了 50%（NPC 铺底此刻 ≈ 0）⇒ 占比 100% ⇒ A 档：稀有残骸 ×12 ＋ 8M；进度收入 = 50% × 20 万 */
    weekendNoteContribution(s.weekendEvent!, gid, 0.5)
    endWeekendEvent(s, now)
    const isk0 = s.wallet.isk
    const wrecks0 = heldOf(s, 'wreck-rare-h-hi')
    const r = weekendSettleAndGrant(s, ctx, now)
    expect(r, '结束后的第一次调用要真发').not.toBeNull()
    expect(r!.tier, '占比 = 玩家 ÷（玩家＋NPC 铺底）= 100% ⇒ A 档').toBe('A')
    /** **进度收入**（船长 2026-09-25「按进度获取收入」；单价 20 万/1%） */
    const income = 0.5 * 100 * WEEKEND_PROGRESS_ISK_PER_PCT
    expect(r!.progressIsk, '进度收入 = 玩家投入 50% × 100 × 20 万').toBe(income)
    expect(r!.isk).toBe(8_000_000 + income)
    expect(r!.wreck).toBe(12)
    expect(s.wallet.isk - isk0, 'ISK 真进钱包（贡献奖 ＋ 进度收入）').toBe(8_000_000 + income)
    expect(heldOf(s, 'wreck-rare-h-hi') - wrecks0, '稀有残骸真到手').toBe(12)
    expect(s.weekendLastResult?.progressIsk, '战果快照里也留一栏（面板/通讯读它）').toBe(income)
    expect(s.weekendLastResult?.progressPct, '快照记玩家投入合计').toBeCloseTo(0.5, 6)
    expect(s.weekendEvent!.prizePaidAtWallMs, '随档幂等标记').toBe(now)
    /** 幂等：同一刻再调、以及**过一周再调**（离线补结的口径）都不再发 */
    expect(weekendSettleAndGrant(s, ctx, now)).toBeNull()
    expect(weekendSettleAndGrant(s, ctx, now + 7 * 24 * 3_600_000)).toBeNull()
    expect(s.wallet.isk - isk0, '只发一次').toBe(8_000_000 + income)
    /** 零贡献 ⇒ 无奖（Q5「0% ⇒ 无」）且**进度收入也是 0**，但"已结"标记照写（免得每拍重算） */
    const s2 = invaded(gid)
    endWeekendEvent(s2, now)
    const isk2 = s2.wallet.isk
    const r2 = weekendSettleAndGrant(s2, ctx, now)
    expect(r2).not.toBeNull()
    expect(r2!.tier, '零贡献 ⇒ none').toBe('none')
    expect(r2!.progressIsk, '零贡献 ⇒ 进度收入 0').toBe(0)
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
    expect(rw?.gain, '迎战击退遇袭 = +3%（设计稿；不是主动胜利那一档）').toBeCloseTo(WEEKEND_GAIN_REPEL, 6)
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

  it('⑨ 核心区：门禁未解 ⇒ 打核心不给进度；外围全清 ⇒ 调试模式每场 +50%', () => {
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
    expect(r1?.gain, '核心胜利 = 调试模式 +50%').toBeCloseTo(0.5, 6)
    expect(open.weekendEvent!.contributed[core] ?? 0).toBeCloseTo(0.5, 6)
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
    /** 进度收入与贡献档位**各自独立**：这一处玩家推了 90% ⇒ 1,800 万（档位是 B 也不影响） */
    expect(r1!.progressIsk, '进度收入 = 90% × 20 万').toBe(90 * WEEKEND_PROGRESS_ISK_PER_PCT)
    expect(r1!.isk).toBe(5_000_000 + 90 * WEEKEND_PROGRESS_ISK_PER_PCT)
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
    expect(snap.progressPct, '快照记玩家投入合计').toBeCloseTo(0.5, 6)
    expect(snap.progressIsk, '快照记进度收入（面板那一行读它）').toBe(0.5 * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)
    expect(snap.isk, '到手合计 = 实发（贡献四档 ＋ 进度收入）').toBe(8_000_000 + 0.5 * 100 * WEEKEND_PROGRESS_ISK_PER_PCT)
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

  it('⑮ 旗舰战**撤退**（自动脱离）⇒ 这一场对母舰的伤害照样记进池子（只不给进度、不判击沉）', () => {
    const gid = GID
    const core = 'galaxy-kor'
    const s = invaded(gid)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, gid, 1) // 外围夺回 ⇒ 门禁解开
    weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
    const putBefore = s.weekendEvent!.contributed[core] ?? 0
    /** 真旗舰卡建一场战斗，把母舰打掉三成，然后标成"自动脱离" */
    const card = ctx.anomalies.get('ink-flagship')!
    const specs = activeFoeSpecsOf(card, ctx.balance.battle, 3) // 第 4 波（母舰压轴）
    const flag = specs.find((u) => u.foeShipId === 'foe-h-ink-flagship')!
    const battle = createBattleState(flag, specs, 0, 5_000)
    const rt = battle.units[flag.tag]!
    const total = rt.hp.s + rt.hp.a + rt.hp.h
    rt.hp = { ...rt.hp, h: Math.max(0, rt.hp.h - Math.round(total * 0.3)) }
    battle.autoEscaped = true
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    advanceEncounterWatch(s, ctx, 1000)
    expect(s.weekendEvent!.flagshipHpDone ?? 0, '撤退也把这一场的伤害记进池子').toBeGreaterThan(0)
    expect(s.weekendEvent!.contributed[core] ?? 0, '撤退不给进度（读数与开打前一致）').toBe(putBefore)
    expect(s.weekendEvent!.flagshipDown, '池子没空 ⇒ 不算击沉').toBeUndefined()
    expect(s.encounter.active, '遭遇已收场').toBe(false)
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

  it('⑯ 主动出击**每场重抽**：每出发一次换一支 · 抽签与"驻留卡/板面"解耦 · 计数随档', () => {
    const gid = GID
    const s = invaded(gid)
    const now = Date.now()
    const base = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId === gid)!
    /** ⚠ 这个"价钱基底"**已退役**（船长 2026-09-25「入侵舰队不应该有赏金」）：字段仍在
     *  （`expedition.rewardIskOverride` 的落盘链未删），但入侵场次一分不发 —— 这里只锁定它的算式没漂。 */
    const expectReward = Math.max(1, Math.round((base.rewardIsk ?? 0) * 1.4))
    const draws: string[] = []
    for (let i = 0; i < 6; i++) {
      const d = weekendAssaultDrawOf(s, ctx, gid, now)
      expect(d, '占领区里出击 ⇒ 有抽签').not.toBeNull()
      expect(['ink-harass', 'ink-raid'], '外围池 = {骚扰, 袭击}').toContain(d!.cardId)
      expect(d!.rewardIsk, '退役字段：算式未漂（原卡 ×1.4，与抽到哪支无关）').toBe(expectReward)
      draws.push(d!.cardId)
      weekendNoteAssaultDispatch(s)
    }
    expect(new Set(draws).size, '六次出发里两种编成都出现过（盐在变）').toBe(2)
    expect(s.weekendEvent!.assaultDraws, '计数随档').toBe(6)
    expect(weekendAssaultDrawOf(s, ctx, 'galaxy-hub', now), '非占领区不抽').toBeNull()
    endWeekendEvent(s, now)
    expect(weekendAssaultDrawOf(s, ctx, gid, now), '活动已结束不抽').toBeNull()
  })

  it('⑰ 远征落盘：foeGalaxyId 与 rewardIskOverride 都要随档往返（补上原先漏的清洗器那行）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 21 })
    s.expedition.foeGalaxyId = 'galaxy-echo'
    s.expedition.rewardIskOverride = 123_456
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.expedition.foeGalaxyId, '星系归属要活过读档（原先读档即丢 ⇒ 战后归属退回母港）').toBe('galaxy-echo')
    expect(back.expedition.rewardIskOverride, '奖励基底覆写也要活过读档').toBe(123_456)
  })

  /* ── 2026-09-25 船长报障「旗舰战无法进入战斗画面」：第三个战斗宿主（遭遇槽 · 编队战） ── */

  /** 造一场"核心条满 ⇒ 旗舰现身"的入侵，并真开一场旗舰战（走 core 的开战入口） */
  function flagshipWorld(): {
    s: ReturnType<typeof createInitialState>
    battle: NonNullable<ReturnType<typeof weekendStartFlagshipBattle>>
  } {
    const core = 'galaxy-kor'
    const s = invaded(GID)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, GID, 1) // 外围夺回 ⇒ 核心门禁解开
    weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
    const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
    expect(battle, '核心条满 ⇒ 能开一场旗舰战').not.toBeNull()
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    return { s, battle }
  }

  it('⑱ 旗舰战 = 第三个战斗宿主：判据/视图/敌卡解析一致（否则战斗屏永远不挂载）', () => {
    const core = 'galaxy-kor'
    /** 还没开打：判据为假、视图为 null（不许"没打也上屏"） */
    const s0 = invaded(GID)
    weekendNoteContribution(s0.weekendEvent!, GID, 1)
    weekendNoteContribution(s0.weekendEvent!, core, 1)
    expect(weekendFlagshipBattleActive(s0), '未开战').toBe(false)
    expect(weekendFlagshipBattleViewOf(s0, ctx)).toBeNull()

    const { s, battle } = flagshipWorld()
    expect(weekendFlagshipBattleActive(s), '遭遇槽里挂着旗舰战 ⇒ 在打').toBe(true)
    const view = weekendFlagshipBattleViewOf(s, ctx)!
    expect(view.anomaly.id, '敌卡 = 该族旗舰卡').toBe('ink-flagship')
    expect(view.battle, '战斗宿主 = 遭遇槽那场').toBe(battle)
    expect(view.leaderShipId, '视图锚 = 编队首舰').toBe(s.shipId)
    expect(Object.keys(view.combat?.foeHp ?? {}).length, '敌舰血量读数要给（血条/爆炸演出靠它）').toBeGreaterThan(0)
    expect(view.combat?.distanceM, '距离读数与战斗态同源').toBe(battle.distanceM)
    expect(battleFoeAnomaly(s, ctx)?.id, '敌卡解析单点（战斗屏不许自己猜宿主）').toBe('ink-flagship')

    /** 收场（遭遇槽清空）⇒ 立刻回落：判据假、视图 null、敌卡解析退回远征口径 */
    s.encounter.active = false
    s.encounter.battle = null
    expect(weekendFlagshipBattleActive(s)).toBe(false)
    expect(weekendFlagshipBattleViewOf(s, ctx)).toBeNull()
    expect(battleFoeAnomaly(s, ctx), '没有远征也没洞内 ⇒ undefined').toBeUndefined()
  })

  it('⑲ 旗舰战**主动脱离**（战斗画面那枚「撤退」）：伤害照记 · 遭遇收场 · 措辞为主动脱离', () => {
    const core = 'galaxy-kor'
    const s = invaded(GID)
    weekendNoteContribution(s.weekendEvent!, GID, 1) // 外围夺回 ⇒ 门禁解开
    weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
    /** 白盒造一场"母舰压轴"的战斗（第 4 波；与用例⑮同一处建法）并把母舰打掉三成 */
    const specs = activeFoeSpecsOf(ctx.anomalies.get('ink-flagship')!, ctx.balance.battle, 3)
    const flagSpec = specs.find((u) => u.foeShipId === 'foe-h-ink-flagship')!
    const battle = createBattleState(flagSpec, specs, 0, 5_000)
    const rt = battle.units[flagSpec.tag]!
    const total = rt.hp.s + rt.hp.a + rt.hp.h
    rt.hp = { ...rt.hp, h: Math.max(0, rt.hp.h - Math.round(total * 0.3)) }
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    const putBefore = s.weekendEvent!.contributed[core] ?? 0
    expect(weekendFlagshipBattleActive(s), '开打 ⇒ 在打（战斗屏据此上屏）').toBe(true)
    const r = retreatEncounterBattle(s, ctx)
    expect(r.ok, '交火中 ⇒ 撤退成立').toBe(true)
    expect(s.weekendEvent!.flagshipHpDone ?? 0, '撤退照记对母舰的伤害').toBeGreaterThan(0)
    expect(s.weekendEvent!.contributed[core] ?? 0, '撤退不给进度').toBe(putBefore)
    expect(s.weekendEvent!.flagshipDown, '池子没空 ⇒ 不判击沉').toBeUndefined()
    expect(s.encounter.active, '遭遇已收场（战斗槽清空 ⇒ 战斗屏随之收起）').toBe(false)
    expect(weekendFlagshipBattleActive(s), '收场后判据回落').toBe(false)
    expect(
      s.logs.some((l) => l.text.includes('主动脱离')),
      '措辞 = 主动脱离（不是"结构损失过半自动脱离"）',
    ).toBe(true)
    /** 已经收场 ⇒ 再点一次撤退要被拒（战斗画面上的按钮不会赖着不生效） */
    expect(retreatEncounterBattle(s, ctx).ok).toBe(false)
  })

  it('⑳ 入侵进行中 ⇒ 敌对派系活跃整体停摆；活动结束自动恢复（船长令"出现入侵时关闭敌方势力活跃"）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 44 })
    /** 直接写板上那条（等价于日板抽签结果；判据只读这一个口） */
    const card = [...ctx.anomalies.values()].find((a) => !a.hidden && a.rewardIsk > 0 && a.lairCore !== undefined)!
    s.sideTasks.faction = {
      id: 1,
      kind: 'faction',
      goodKey: '',
      refId: '',
      need: 0,
      rewardIsk: card.rewardIsk,
      anomalyId: card.id,
      galaxyId: card.galaxyId,
      factionAnomalyName: card.name,
    }
    expect(factionGalaxyId(s), '平时：当日派系活跃照常').toBe(card.galaxyId)
    expect(isFactionBounty(s, card), '平时：该卡吃 +10% 加成').toBe(true)
    expect(sideTaskBoard(s, ctx).faction, '平时：任务中心置顶卡在').not.toBeNull()

    /** 入侵开始（活的占领区）⇒ 三处一起静默 */
    const ev: WeekendEventState = {
      seq: 1,
      startedAtWallMs: Date.now(),
      coreId: 'galaxy-kor',
      peripheryIds: [GID],
      family: 'H',
      contributed: {},
    }
    s.weekendEvent = ev
    expect(factionGalaxyId(s), '入侵中：星图标记与加成判据一起停').toBeNull()
    expect(isFactionBounty(s, card), '入侵中：不再吃加成').toBe(false)
    expect(sideTaskBoard(s, ctx).faction, '入侵中：置顶那条不上屏').toBeNull()

    /** 活动结束（落定结束时刻）⇒ 当天那条照旧活着（板上条目一直在滚，不需重抽） */
    endWeekendEvent(s, Date.now())
    expect(factionGalaxyId(s), '结束后自动恢复').toBe(card.galaxyId)
    expect(sideTaskBoard(s, ctx).faction?.galaxyId, '置顶卡也回来').toBe(card.galaxyId)
  })

  /**
   * **船长 2026-09-25 报障**：「可以斩杀敌方母舰的战斗进入后，**无法改变距离**，改变时显示"不在交火中"」。
   * 病根同"撤退"那一处：`setBattleDesire` 只认远征与虫洞两个宿主，不认**旗舰战（遭遇槽）**。
   */
  it('㉑ 旗舰战里也能改期望距离（距离条/战术按钮不再报"不在交火中"）· 偏好写本场核心星系', () => {
    const core = 'galaxy-kor'
    const { s, battle } = flagshipWorld()
    const before = battle.myDesireM
    const r = setBattleDesire(s, 2_200, ctx)
    expect(r.ok, '交火中 ⇒ 允许改').toBe(true)
    expect(battle.myDesireM, '期望距离真的落到本场战斗上').toBe(2_200)
    expect(battle.myDesireM).not.toBe(before)
    expect(desirePrefOf(s, core), '偏好记在本场核心星系（下次该星系开战沿用）').toBe(2_200)
    /** ⚠ 不能写到旗舰卡自带的母港去（隐藏卡的 `galaxyId` = `galaxy-hub`，与这一场无关） */
    expect(desirePrefOf(s, 'galaxy-hub'), '没有污染母港的偏好').toBeNull()
    /** 收场后 ⇒ 照旧拒绝（老口径不变） */
    s.encounter.active = false
    s.encounter.battle = null
    expect(setBattleDesire(s, 3_000, ctx).ok, '不在交火中 ⇒ 拒绝').toBe(false)
  })

  /**
   * **船长 2026-09-25 报障**：「**母舰哪怕残血，在战斗中血上限依旧保持不变。**」
   *
   * 口径：战斗里那条血 = **池子剩余**（`bossHp`），但血条的**分母恒为池子总量**（`bossHpMax` = 150,000）
   * ⇒ 残血就显示残血（改前拿"本场满值"当分母，最后一仗开打时血条又是满的）。
   * ⚠ **只动显示**：单位自己的 `hpMax`（= 本场满值）与伤害台账一个字不改，否则跨场累计会重复计伤害。
   */
  it('㉒ 母舰残血 ⇒ 战斗里血条上限仍是池子总量（150,000）；台账只算本场伤害 · 覆写随档往返', () => {
    const core = 'galaxy-kor'
    const s = invaded(GID)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, GID, 1) // 外围夺回 ⇒ 门禁解开
    weekendNoteContribution(s.weekendEvent!, core, 1) // 核心条满 ⇒ 旗舰现身
    /** 池子跨场已被打剩 1,000（这正是"最后几仗"的样子） */
    s.weekendEvent!.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
    s.weekendEvent!.flagshipHpDone = WEEKEND_FLAGSHIP_POOL_HP - 1_000
    expect(weekendFlagshipHpRemaining(s.weekendEvent)).toBe(1_000)
    const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
    expect(battle, '核心条满 ⇒ 能开战').not.toBeNull()
    expect(battle.foeOverride?.bossHp, '本场满值 = 池子剩余').toBe(1_000)
    expect(battle.foeOverride?.bossHpMax, '血条分母 = 池子总量（恒定）').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    expect(battle.foeOverride?.bossShipId).toBe('foe-h-ink-flagship')
    /** ⚠ 覆写要活过读档（原先这三格没过清洗器 ⇒ 读档后母舰血条回落到卡面血 69,592，"单场不死"当场失真） */
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.encounter.battle
    expect(back?.foeOverride?.bossHp, '读档后仍是池子剩余').toBe(1_000)
    expect(back?.foeOverride?.bossHpMax, '读档后血条分母仍是池子总量').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    expect(back?.foeOverride?.bossShipId, '读档后仍认得出母舰那一条').toBe('foe-h-ink-flagship')

    /** 母舰那一波（第 4 波）真建起来，走**真实视图**读血条上限 */
    const override = battle.foeOverride!
    const card = applyFoeOverride(ctx.anomalies.get('ink-flagship')!, override)
    const specs = activeFoeSpecsOf(card, ctx.balance.battle, 3)
    const flagSpec = specs.find((u) => u.foeShipId === 'foe-h-ink-flagship')!
    const me = createPlayerSpec(s, ctx, s.shipId)!
    const b3 = createBattleState(me, specs, 0, 5_000)
    b3.foeOverride = override
    const sum3 = (hp: { s: number; a: number; h: number }): number => hp.s + hp.a + hp.h
    expect(sum3(b3.units[flagSpec.tag]!.hpMax!), '引擎侧满值 = 本场剩余').toBeCloseTo(1_000, 6)
    const arcs = battleArcsFor(s, ctx, { battle: b3, anomaly: card, leaderShipId: s.shipId })!
    expect(sum3(arcs.maxHp.foe[flagSpec.tag]!), '界面血条分母 = 池子总量').toBeCloseTo(WEEKEND_FLAGSHIP_POOL_HP, 6)
    /** 打掉 100（结构层）⇒ 台账 = 满值 − 当前 = **只有本场那 100**（分母放大不参与台账） */
    const rt = b3.units[flagSpec.tag]!
    rt.hp = { ...rt.hp, h: Math.max(0, rt.hp.h - 100) }
    expect(flagshipBattleLedger(b3, ['foe-h-ink-flagship']).rawDmg, '台账只算本场伤害').toBe(100)
    /** 僚舰不受影响（分母只放大母舰那一格） */
    const other = specs.find((u) => u.foeShipId !== 'foe-h-ink-flagship')!
    expect(sum3(arcs.maxHp.foe[other.tag]!)).toBeCloseTo(sum3(b3.units[other.tag]!.hpMax!), 6)
  })

  /**
   * **船长 2026-09-25 报障**：「**摧毁敌方干扰舰后，射程不会恢复。**」
   *
   * 病根 = 压制率吃的是**编制口径**（`activeFoeSpecsOf` 含**已阵亡**单位）⇒ 干扰舰被打死之后
   * 它的 50% 仍挂在净削减里（界面射程弧与实际开火门两处都挂着）。
   * 另修一处同族分歧：引擎原先恒取**第 0 波**（`createFoeSpecs`），视图取**当前波** ⇒
   * 多波卡里"界面显示被压制、实际没被压"。两处现在同取当前波。
   */
  it('㉓ 打掉干扰舰 ⇒ 压制归零、射程恢复（引擎与视图同取当前波 · 只算活着的干扰舰）', () => {
    const card = ctx.anomalies.get('ink-main')!
    expect(foeJammerCountOf(activeFoeSpecsOf(card, ctx.balance.battle, 0)), '第 0 波没有干扰舰').toBe(0)
    const wave1 = activeFoeSpecsOf(card, ctx.balance.battle, 1)
    const jam = wave1.find((f) => (f.foeRangeDebuffPct ?? 0) > 0)!
    expect(jam, '第 1 波有干扰舰').toBeTruthy()
    /** 主控 = 电子舰（自身 15% 与敌方 50% 抵消）⇒ 净削减 0.35（船长例①） */
    const s = createInitialState({ nowWallMs: 0, seed: 5 })
    const ew = addShipToFleet(s, 'sh-wh-a-frigate')
    s.shipId = ew
    const me = createPlayerSpec(s, ctx, ew)!
    const battle = createBattleState(me, wave1, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    expect(meJammerNetOf(battle, wave1), '干扰舰活着 ⇒ 净 0.35').toBeCloseTo(0.35, 10)
    expect(meRangeMulOf(battle, wave1), '射程被压到 65%').toBeCloseTo(0.65, 10)
    /** 三系血清零 = 阵亡（引擎的存活判据） */
    battle.units[jam.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(meJammerNetOf(battle, wave1), '打掉 ⇒ 压制归零').toBe(0)
    expect(meRangeMulOf(battle, wave1), '射程恢复 ×1').toBe(1)

    /** 界面那一份（射程弧）：基准 = 第 0 波（无干扰舰）的弧；第 1 波被压；打掉 ⇒ 回到基准 */
    const arcsOf = (b: ReturnType<typeof createBattleState>): number[] =>
      battleArcsFor(s, ctx, { battle: b, anomaly: card, leaderShipId: ew })!.me.map((a) => a.maxM)
    const b0 = createBattleState(me, activeFoeSpecsOf(card, ctx.balance.battle, 0), 0, 5_000)
    const baseArcs = arcsOf(b0)
    expect(baseArcs.length, '电子舰至少有基础舰炮那一条弧').toBeGreaterThanOrEqual(1)
    const b1 = createBattleState(me, wave1, 0, 5_000)
    b1.meFoeRangeDebuff = 0.15
    b1.waveIdx = 1
    const pressed = arcsOf(b1)
    expect(pressed, '干扰舰在场 ⇒ 弧比基准短').not.toEqual(baseArcs)
    for (let i = 0; i < baseArcs.length; i++) expect(pressed[i]!).toBeLessThan(baseArcs[i]!)
    b1.units[jam.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(arcsOf(b1), '打掉干扰舰 ⇒ 界面弧回到基准（不再"永远被压"）').toEqual(baseArcs)
  })

  /**
   * **船长 2026-09-25 第二条报障**：「**旗舰第二波鱼雷艇，敌方试图远离（我方也在拉远距离），
   * 但是实际距离在缩短**」＋「**敌人期望距离似乎不会变化？**」
   *
   * 同一个病根的两半（都是"按第 0 波算"）：
   * - 引擎：`foeDesire` / `desireCapM` 的**初值**取第 0 波（"换波刷新"只在同一次调用里跑完转场时生效，
   *   而引擎是**逐拍调用**）⇒ 第 2 波起敌人恒按第 1 波的 2,352 **往里收**，界面却按当前波显示 10,350
   *   （"想拉开"）——于是"双方都想拉开、距离却在缩"；
   * - 玩家一侧：`setBattleDesire` 的钳制上界取第 0 波的开战距离 9,702，而滑条远端是**本波**的 13,200
   *   ⇒ 拖到底也"拉不远"。
   */
  it('㉔ 旗舰战第 2 波：敌方按**本波**的期望距离往外走；滑条能拖到本波远端（不再夹回第 1 波）', () => {
    const core = 'galaxy-kor'
    const s = invaded(GID)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, GID, 1)
    weekendNoteContribution(s.weekendEvent!, core, 1)
    const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
    const leader = battle.myFleet![0]!.shipId
    s.encounter = {
      active: true,
      shipId: leader,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    const card = applyFoeOverride(ctx.anomalies.get('ink-flagship')!, battle.foeOverride!)
    /** 第 1 波（突击舰 · 期望 2,352）⇒ 滑条远端 = 它的开战距离；先把玩家期望设成"最远" */
    const far0 = battleOpenM(createPlayerSpec(s, ctx, leader)!, activeFoeSpecsOf(card, ctx.balance.battle, 0), ctx.balance.battle)
    expect(setBattleDesire(s, 20_000, ctx).ok).toBe(true)
    expect(battle.myDesireM, '第 1 波：夹到本波远端').toBe(far0)
    /** 清第 1 波 ⇒ 转场第 2 波（鱼雷舰；体量小 ⇒ 只推 4 秒，保它活着） */
    for (const f of activeFoeSpecsOf(card, ctx.balance.battle, 0)) {
      const rt = battle.units[f.tag]
      if (rt) rt.hp = { s: 0, a: 0, h: 0 }
    }
    s.gameMs += 4_000
    advanceBattleFor(s, ctx, battle, leader, 'ink-flagship')
    expect(battle.waveIdx, '已进第 2 波').toBe(1)
    const view = battleArcsFor(s, ctx, { battle, anomaly: card, leaderShipId: leader })!
    expect(view.foeDesireM, '本波敌方的期望距离 = 鱼雷舰的 10,350（界面读数）').toBe(10_350)
    /**
     * ① **滑条能拖到本波远端**：转场后重新拖到最远 ⇒ 期望距离 = 本波 `maxM`（改前被夹在 9,702）
     */
    expect(setBattleDesire(s, 20_000, ctx).ok).toBe(true)
    expect(battle.myDesireM, '夹到**本波**远端（13,200），不再退回第 1 波的 9,702').toBe(view.maxM)
    expect(battle.myDesireM).toBeGreaterThan(far0)
    /**
     * ② **敌方按本波期望往外走**：把玩家一侧钉在原地（期望 = 当前距离 ⇒ 步长 0），
     * 只让敌人拉 ⇒ 距离必须**变大**（改前敌人的期望是第 1 波的 2,352 ⇒ 只会往里收）。
     */
    battle.myDesireM = Math.round(battle.distanceM)
    const d0 = battle.distanceM
    for (let i = 0; i < 6; i++) {
      battle.myDesireM = Math.round(battle.distanceM) // 每拍重新钉住"玩家不动"
      s.gameMs += 1_000
      advanceBattleFor(s, ctx, battle, leader, 'ink-flagship')
    }
    expect(battle.distanceM, '敌方想拉开 ⇒ 距离朝 10,350 走（改前掉头往 2,352 收）').toBeGreaterThan(d0)
  })

  /**
   * **敌人期望距离的取数 = 本波卡面顺序第 1 条**（`foeDesiredRange` 取 `foes[0]`）——
   * 2026-09-25 船长令「**甲：改卡面条目顺序**」：旗舰卡第 3 波原写「干扰舰 ×1 ＋ 战列巡洋舰 ×2」，
   * 干扰舰排第一 ⇒ 整波（含 2 艘 11 km 战巡）被拖到干扰舰的近战带 2,352 m 打，而战巡的**近盲带**
   * （`blindDmgMul 0.3`）正在那个距离上。现改成战巡在前 ⇒ 本波期望 = 战巡的 9,500 m。
   * 本条把**逐波的期望距离**钉住（这就是界面上那个「敌方期望距离」读数，也是引擎的机动目标）。
   */
  it('㉕ 旗舰卡逐波期望距离：2,352 / 10,350 / **9,500（战巡在前）** / 10,350', () => {
    const card = ctx.anomalies.get('ink-flagship')!
    const st = createInitialState({ nowWallMs: 0, seed: 5 })
    const me = createPlayerSpec(st, ctx, st.shipId)!
    const per = [0, 1, 2, 3].map((wi) => {
      const foes = activeFoeSpecsOf(card, ctx.balance.battle, wi)
      return { head: foes[0]!.foeShipId, desire: foeDesiredRange(me, foes, ctx.balance.battle, 0) }
    })
    expect(per.map((x) => x.head)).toEqual([
      'foe-h-ink-corvette',
      'foe-h-ink-torpedo',
      'foe-h-ink-battlecruiser', // ⚠ 主体在前（船长令甲）
      'foe-h-ink-flagship',
    ])
    expect(per.map((x) => x.desire)).toEqual([2_352, 10_350, 9_500, 10_350])
    /** ⚠ 反证：干扰舰自己那条带是近战（2,352）——若它排第一，整波就会按这个距离打 */
    const jamOnly = activeFoeSpecsOf(card, ctx.balance.battle, 2).filter((f) => f.foeShipId === 'foe-h-ink-jammer')
    expect(foeDesiredRange(me, [...jamOnly], ctx.balance.battle, 0), '干扰舰单独算 = 近战 2,352').toBe(2_352)
    /** 主力舰队卡（遇袭 · 2 波）同口径：第 2 波主体（战巡 11 km ＋ 鱼雷舰 ×2）排在前 ⇒ 9,500（船长令甲） */
    const main = ctx.anomalies.get('ink-main')!
    const mainFoes = activeFoeSpecsOf(main, ctx.balance.battle, 1)
    expect(mainFoes[0]!.foeShipId, '主力卡第 2 波：主体在前').toBe('foe-h-ink-battlecruiser')
    expect(foeDesiredRange(me, mainFoes, ctx.balance.battle, 0)).toBe(9_500)
  })

  /**
   * **船长 2026-09-25 令**：「**母舰当前血条不要按照三个等比扣除，应该按照护盾-装甲-结构的顺序扣除**」。
   *
   * 口径：池子剩余**从最后一层往回灌**（结构先满 → 装甲 → 剩的才落护盾），等价于"池子挨的伤害先打光护盾"。
   * ⚠ 这**不只是显示**——`applyDamage` 逐层乘"层克制 × (1−该层该系抗性)" ⇒ 分层血量决定每发的实收伤害。
   * 血条三行的**分母**另给（= 池子总量 × 卡面 split，恒定），不许拿当前值反推。
   */
  it('㉖ 母舰三层血按 护盾→装甲→结构 顺序扣：剩 50% ⇒ 盾 0 / 甲半满 / 结构满（血条分母恒为容量）', () => {
    const cap = { s: 30_000, a: 82_500, h: 37_500 } // = 150,000 ×（0.2 / 0.55 / 0.25）
    expect(weekendFlagshipLayerCaps(150_000, { s: 0.2, a: 0.55, h: 0.25 })).toEqual(cap)
    /** 纯口径：从最后一层往回灌 */
    expect(weekendFlagshipLayersOf(150_000, cap), '满池 ⇒ 三层满').toEqual(cap)
    expect(weekendFlagshipLayersOf(120_000, cap), '刚打光护盾（= 总量 − 盾容量 30,000）').toEqual({
      s: 0,
      a: 82_500,
      h: 37_500,
    })
    expect(weekendFlagshipLayersOf(75_000, cap), '剩 50% ⇒ 盾空、甲半满、结构满').toEqual({ s: 0, a: 37_500, h: 37_500 })
    expect(weekendFlagshipLayersOf(37_500, cap), '刚打光装甲').toEqual({ s: 0, a: 0, h: 37_500 })
    expect(weekendFlagshipLayersOf(1, cap), '剩 1 点 ⇒ 只在结构上').toEqual({ s: 0, a: 0, h: 1 })
    /** 真实开战：池子被削到 50% ⇒ 覆写与建档三层血都按顺序 */
    const core = 'galaxy-kor'
    const s = invaded(GID)
    const now = Date.now()
    weekendNoteContribution(s.weekendEvent!, GID, 1)
    weekendNoteContribution(s.weekendEvent!, core, 1)
    s.weekendEvent!.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
    s.weekendEvent!.flagshipHpDone = 75_000 // 正好打掉一半
    expect(weekendFlagshipHpRemaining(s.weekendEvent)).toBe(75_000)
    const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
    expect(battle.foeOverride?.bossHp).toBe(75_000)
    expect(battle.foeOverride?.bossHpLayers, '当前三层血：盾 0 · 甲 37,500 · 结构 37,500').toEqual({
      s: 0,
      a: 37_500,
      h: 37_500,
    })
    expect(battle.foeOverride?.bossMaxLayers, '三层容量（界面分母）').toEqual(cap)
    /** 建档出来的母舰：三层血**逐个等于**当前值（不是等比分摊） */
    const card = applyFoeOverride(ctx.anomalies.get('ink-flagship')!, battle.foeOverride!)
    const specs = activeFoeSpecsOf(card, ctx.balance.battle, 3)
    const flagSpec = specs.find((u) => u.foeShipId === 'foe-h-ink-flagship')!
    expect(flagSpec.hp.s, '护盾已空（等比口径下这里会是 9,000）').toBeCloseTo(0, 6)
    expect(flagSpec.hp.a).toBeCloseTo(37_500, 6)
    expect(flagSpec.hp.h).toBeCloseTo(37_500, 6)
    /** 界面血条：三行分母 = 容量（不随剩余缩水），当前值来自单位自己 */
    const me = createPlayerSpec(s, ctx, s.shipId)!
    const b3 = createBattleState(me, specs, 0, 5_000)
    b3.foeOverride = battle.foeOverride!
    const arcs = battleArcsFor(s, ctx, { battle: b3, anomaly: card, leaderShipId: s.shipId })!
    expect(arcs.maxHp.foe[flagSpec.tag], '血条分母 = 池子口径容量').toEqual(cap)
    /** 台账仍只算本场伤害（满值 = 开战那一刻的分层值） */
    const rt = b3.units[flagSpec.tag]!
    rt.hp = { ...rt.hp, h: rt.hp.h - 100 }
    expect(flagshipBattleLedger(b3, ['foe-h-ink-flagship']).rawDmg, '本场伤害照记').toBe(100)
    /** 覆写随档往返（含两份三层读数） */
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: core,
      name: '墨潮旗舰部队',
      threat: 170,
      anomalyId: 'ink-flagship',
      origin: '测试 · 挑战旗舰',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.encounter.battle?.foeOverride
    expect(back?.bossHpLayers).toEqual({ s: 0, a: 37_500, h: 37_500 })
    expect(back?.bossMaxLayers).toEqual(cap)
  })

  /**
   * **船长 2026-09-25 报障**：「刚刚我试着在 0% 血的时候进入了旗舰战，成功击沉了入侵旗舰，
   * 但是入侵结算内，**显示我未击沉**，且给了我一个旗舰黑匣。」
   *
   * 真档只读取证（`%APPDATA%/whale-idle/save.json`）：`flagshipHpDone = 149,385` ·
   * `octopusHpDone = 615.25` ⇒ 共享血条 = `150,000 −（149,385 ＋ 615.25）≤ 0` ⇒ **血条清零** ·
   * `flagshipDown = 'player'` · 黑匣照发（`rewardLedger.blackBox = 1`）。
   * 结算面板却按 `hpDone ≥ hpMax`（**只算玩家那一份**）判 ⇒ 打出「未击沉」，与同一屏的奖励自相矛盾。
   */
  it('㉗ 共享血条被打空 ⇒ 结算面板必须说「已击沉」（与黑匣同判据，不再只比玩家那一份）', () => {
    const core = 'galaxy-kor'
    const now = Date.now()
    const s = invaded(GID)
    weekendNoteContribution(s.weekendEvent!, GID, 1)
    weekendNoteContribution(s.weekendEvent!, core, 1)
    const ev = s.weekendEvent!
    ev.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
    ev.flagshipHpDone = WEEKEND_FLAGSHIP_POOL_HP - 1_000 // 前几场累计打掉的
    ev.octopusHpDone = 615.25 // 章鱼人削掉的那一点（船长真档读数）
    const box0 = heldOf(s, 'blackbox-h')
    /** 这一场补 385 ⇒ 149,385 ＋ 615.25 > 150,000 ⇒ **玩家这一击把血条打空**（船长真档的形状） */
    weekendNoteFlagshipDamage(ev, 385, 7001)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, now, null, { kind: 'flagship', galaxyId: core })
    expect(ev.flagshipDown, '血条由玩家打空 ⇒ 归属玩家').toBe('player')
    expect(heldOf(s, 'blackbox-h') - box0, '黑匣真入库').toBe(1)
    expect(r?.wreck, '旗舰残骸照发').toBe(WEEKEND_FLAGSHIP_WRECK)
    /** 引擎那一拍结算 ⇒ 写战果快照（面板与结算通讯都读它） */
    weekendSettleAndGrant(s, ctx, now)
    const snap = s.weekendLastResult!
    expect(snap.flagshipOutcome, '快照的结局').toBe('player')
    expect(snap.blackBox, '快照里的黑匣数 = 实发').toBe(1)
    /** ⚠ **回归点**：玩家那一份确实**没到**池子总量（旧判据正是卡在这里说"未击沉"） */
    expect(snap.flagship!.hpDone, '玩家那一份 < 池子总量').toBeLessThan(snap.flagship!.hpMax)
    expect(snap.flagship!.hpDone + 615.25, '两份加起来才够打空').toBeGreaterThanOrEqual(snap.flagship!.hpMax)
    expect(snap.flagship!.defeated, '面板那行必须说「已击沉」——与黑匣同一判据').toBe(true)

    /** **反向**：章鱼人得手那一场，面板照样说「未击沉」、黑匣归零（不许滥发"已击沉"） */
    const s2 = invaded(GID)
    weekendNoteContribution(s2.weekendEvent!, GID, 1)
    weekendNoteContribution(s2.weekendEvent!, core, 1)
    s2.weekendEvent!.flagshipHpMax = WEEKEND_FLAGSHIP_POOL_HP
    s2.weekendEvent!.flagshipHpDone = 40_000
    endWeekendEvent(s2, now)
    s2.weekendEvent!.flagshipDown = 'octopus'
    weekendSettleAndGrant(s2, ctx, now)
    expect(s2.weekendLastResult!.flagshipOutcome).toBe('octopus')
    expect(s2.weekendLastResult!.flagship!.defeated, '章鱼人得手 ⇒ 未击沉').toBe(false)
    expect(s2.weekendLastResult!.blackBox, '黑匣归零').toBe(0)
  })
})

