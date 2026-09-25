/**
 * **入侵残骸 · 独立池**（船长 2026-09-25 令，逐条对照）：
 *
 * - 「**入侵舰队不应该有赏金**」⇒ 入侵遭遇打赢**一分钱不给**（缴获恒 0；收入改在活动结束时按进度结算）；
 * - 「添加的残骸……**需要独立的残骸条**」＋「**按照击败卡的威胁注入**」⇒ 注入量沿用悬赏那条唯一公式、
 *   但记进**另一个池子**（`state.weekendWrecks`）；
 * - 「**入侵残骸不算当地星系密度，因为是独立的**」⇒ `wreckDensityOf` 一个字不变（两池只在打捞时合并计量）；
 * - 「**入侵残骸没有星系的残骸保底**，因为随时间消减到最后会消失」＋「**48 小时线性衰减**」
 *   ⇒ 归位点 = 0、只减不增，衰减到 0 即删记录；
 * - 打捞：体积当量按**两池之和**、扣减**先扣入侵池**（会消失的先捞；星系池保底线 10 不动）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { advanceEncounterWatch, fightEncounter } from '../src/encounters'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceWreckDrift, injectWeekendWreck, salvageRoundPull, weekendWreckDensityOf, weekendWreckInjectionOf, wreckBaseDensity, wreckDensityOf, WEEKEND_WRECK_DECAY_MS } from '../src/salvage'
import { weekendApplyBattleOutcome } from '../src/weekendBattle'
import type { WeekendEventState } from '../src/weekendEvent'
import { anomaly, makeTestCtx, ship } from './helpers'

const GID = 'g-inv'
/** 被占星系的"入侵舰队"卡（就当作抽到的那一支；威胁 40 ⇒ 注入量 = 40×0.4×(1+0.2×敌人数)）
 *  ⚠ `hidden: true` = **与真入侵卡同形**（H 族那几张都不进任何星系目录）——这一条很要紧：
 *  `foeOf` 会跳过 hidden 卡，注入量必须改认"遭遇槽自己记的那张卡"（见 `dropWrecks`）。 */
const CARD = 'ano-inv-fleet'
const INVADED_CARD = { ...anomaly(CARD, GID, { threat: 40, tactic: 'brawl' }), hidden: true }

function world(): { state: GameState; ctx: SimContext } {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ships: [ship('sandcat', { shieldHp: 5_000, armorHp: 5_000, hullHp: 5_000 })],
    anomalies: [
      INVADED_CARD,
      /** 该星系**原本的可见悬赏**（威胁 12）：它才走"星系残骸池"那条老路；
       *  有它在场，`foeOf` 的回落（跳过 hidden 卡后按就近威胁找可见卡）就会指向它 ⇒
       *  "注入量认的是击败卡、不是原卡"这条才真的被守住。 */
      anomaly('ano-inv-local', GID, { threat: 12, tactic: 'brawl' }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.debugQuick = true // 调试口径：主动胜利 +50%（进度收入的换算与本用例无关，只为可预期）
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: Date.now(),
    coreId: 'galaxy-kor',
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  state.weekendEvent = ev
  state.exploredGalaxies = [...new Set([...(state.exploredGalaxies ?? []), GID])]
  return { state, ctx }
}

describe('入侵残骸 · 独立池（船长 2026-09-25）', () => {
  it('注入量 = 悬赏那条唯一公式（按击败卡威胁）· 遇袭半量', () => {
    // 单波单舰：40 × 0.4 × (1 + 0.2×1) = 19.2
    expect(weekendWreckInjectionOf(INVADED_CARD)).toBeCloseTo(19.2, 6)
    expect(weekendWreckInjectionOf(INVADED_CARD, 0.5)).toBeCloseTo(9.6, 6)
  })

  it('两池互不相加：注入只进独立池，`wreckDensityOf`（星系密度）一字不动', () => {
    const { state, ctx } = world()
    const before = wreckDensityOf(state, GID, ctx)
    expect(before, '该星系基础密度').toBe(wreckBaseDensity(GID, ctx))
    injectWeekendWreck(state, GID, 50)
    expect(weekendWreckDensityOf(state, GID), '入侵池 +50').toBe(50)
    expect(wreckDensityOf(state, GID, ctx), '星系密度读数不受影响（船长：入侵残骸不算当地密度）').toBe(before)
    expect(state.galaxyWrecks[GID], '星系池连记录都不该有').toBeUndefined()
  })

  it('**48 小时真线性**衰减到 0：半程剩一半、到点删记录（与推进粒度无关、无保底、不回升）', () => {
    const { state, ctx } = world()
    injectWeekendWreck(state, GID, 100)
    // 逐拍小步（真实心跳的形状）：累计 24h ⇒ 恰剩一半（线性；不是"按比例收缩"的指数尾巴）
    for (let i = 0; i < 24; i++) advanceWreckDrift(state, ctx, 3_600_000)
    expect(weekendWreckDensityOf(state, GID), '半程 ⇒ 剩一半').toBeCloseTo(50, 6)
    // 再走满 48h ⇒ 归零并删记录（残骸条消失）
    for (let i = 0; i < 24; i++) advanceWreckDrift(state, ctx, 3_600_000)
    expect(state.weekendWrecks?.[GID], '到点 ⇒ 记录被删（残骸条消失）').toBeUndefined()
    expect(weekendWreckDensityOf(state, GID)).toBe(0)
  })

  it('再注入一笔 ⇒ 以"当前有效值 ＋ 新注入量"重新起算 48h（打了新的仗，残骸场重新变新鲜）', () => {
    const { state, ctx } = world()
    injectWeekendWreck(state, GID, 100)
    advanceWreckDrift(state, ctx, WEEKEND_WRECK_DECAY_MS / 2) // 剩 50
    injectWeekendWreck(state, GID, 30) // 50 + 30 = 80，时钟归零
    expect(weekendWreckDensityOf(state, GID)).toBeCloseTo(80, 6)
    advanceWreckDrift(state, ctx, WEEKEND_WRECK_DECAY_MS / 2)
    expect(weekendWreckDensityOf(state, GID), '重新起算 ⇒ 又是半程').toBeCloseTo(40, 6)
  })

  it('打捞进行中的星系：两池的闲置衰减都挂起（与星系池同规则）', () => {
    const { state, ctx } = world()
    injectWeekendWreck(state, GID, 100)
    advanceWreckDrift(state, ctx, WEEKEND_WRECK_DECAY_MS, GID)
    expect(weekendWreckDensityOf(state, GID), '正在打捞 ⇒ 不衰减').toBe(100)
  })

  it('打捞：体积当量按两池之和 · **先扣入侵池**（见底后删记录）· 星系池保底线不动', () => {
    const { state, ctx } = world()
    const base = wreckBaseDensity(GID, ctx)
    injectWeekendWreck(state, GID, 100)
    // 第一轮：mul = (星系密度 + 入侵 100) / 10
    const mul = salvageRoundPull(state, ctx, GID)
    expect(mul).toBeCloseTo((base + 100) / 10, 6)
    expect(weekendWreckDensityOf(state, GID), '入侵池按 2% 放干：100 → 98').toBeCloseTo(98, 6)
    const galaxyAfter = wreckDensityOf(state, GID, ctx)
    expect(galaxyAfter, '星系池也照老口径扣了 2%（记录已落）').toBeLessThan(base)
    expect(galaxyAfter).toBeGreaterThanOrEqual(10)
    // 连打到见底：入侵池消失、星系池停在保底线附近（尾数按既有 SNAP 口径收口）
    for (let i = 0; i < 400; i++) salvageRoundPull(state, ctx, GID)
    expect(state.weekendWrecks?.[GID], '见底 ⇒ 记录被删').toBeUndefined()
    const floorNow = wreckDensityOf(state, GID, ctx)
    expect(floorNow, '星系池收敛到保底线（不低于 10、尾数 ≤ 0.2）').toBeGreaterThanOrEqual(10)
    expect(floorNow).toBeLessThan(10.2)
  })

  it('随档往返：独立池原样回来，非法值（负数/缺字段/非数）读档即丢', () => {
    const { state } = world()
    injectWeekendWreck(state, GID, 12.5)
    const raw = JSON.parse(serializeSaveFile(state, 0)) as { state: Record<string, unknown> }
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.weekendWrecks?.[GID], '锚点值与漂移时长原样').toEqual({ density: 12.5, decayAccMs: 0 })
    // 脏档：负数/缺字段/非数一律清掉（清洗器白名单）
    raw.state.weekendWrecks = {
      [GID]: { density: -5, decayAccMs: 0 },
      'g-miss': { density: 3 },
      'g-str': { density: 'oops', decayAccMs: 1 },
      'g-neg': { density: 3, decayAccMs: -1 },
      'g-y': { density: 3, decayAccMs: 60_000 },
    }
    const dirty = loadSaveFile(JSON.stringify(raw)).state
    expect(dirty.weekendWrecks, '只留合法的两条字段').toEqual({ 'g-y': { density: 3, decayAccMs: 60_000 } })
    expect(weekendWreckDensityOf(dirty, 'g-y'), '读档后按漂移时长折算有效值').toBeCloseTo(
      3 * (1 - 60_000 / WEEKEND_WRECK_DECAY_MS),
      6,
    )
  })

  it('入侵遭遇打赢：缴获 0（不给赏金）· 残骸进独立池、星系池不动 · 日志说"击退入侵舰队"', () => {
    const { state, ctx } = world()
    const isk0 = state.wallet.isk
    const galaxyBefore = wreckDensityOf(state, GID, ctx)
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: GID,
      name: '巡游小队 · 测试',
      threat: 30,
      anomalyId: CARD,
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
    expect(fightEncounter(state, ctx).ok, '迎战').toBe(true)
    /** 白盒判胜（确定性）：本用例只查"结算走哪条路"，不查战斗平衡 */
    state.encounter.battle!.ended = 'me'
    advanceEncounterWatch(state, ctx, 1_000)
    expect(state.encounter.active, '遭遇收场').toBe(false)
    expect(state.wallet.isk - isk0, '入侵遭遇没有赏金（缴获恒 0）').toBe(0)
    expect(weekendWreckDensityOf(state, GID), '残骸进独立池 = 击败卡公式 ×0.5（遇袭半量）').toBeCloseTo(
      weekendWreckInjectionOf(INVADED_CARD, 0.5),
      6,
    )
    expect(wreckDensityOf(state, GID, ctx), '星系密度一动不动').toBe(galaxyBefore)
    expect(
      state.logs.some((l) => l.text.includes('击退入侵舰队') && l.text.includes('本场无赏金')),
      '战报措辞 = 击退入侵舰队 · 本场无赏金',
    ).toBe(true)
  })

  it('非入侵的普通遭遇：缴获照旧、残骸仍进星系池（老口径逐字不变）', () => {
    const { state, ctx } = world()
    state.weekendEvent = undefined // 没有入侵
    const galaxyBefore = wreckDensityOf(state, GID, ctx)
    state.encounter = {
      active: true,
      shipId: state.shipId,
      galaxyId: GID,
      name: '伏击劫掠队',
      threat: 30,
      anomalyId: CARD,
      origin: '测试',
      invitedAtGameMs: state.gameMs,
      deadlineGameMs: state.gameMs + 60_000,
      battle: null,
    }
    expect(fightEncounter(state, ctx).ok).toBe(true)
    state.encounter.battle!.ended = 'me'
    advanceEncounterWatch(state, ctx, 1_000)
    expect(state.weekendWrecks?.[GID], '不入侵 ⇒ 独立池空').toBeUndefined()
    expect(wreckDensityOf(state, GID, ctx), '星系池照旧增加').toBeGreaterThan(galaxyBefore)
    expect(state.logs.some((l) => l.text.includes('遭遇战大捷')), '措辞仍是老口径').toBe(true)
  })

  it('远征（主动出击）打赢：走 `weekendApplyBattleOutcome` 的同一口径 —— 无赏金 · 独立池注入', () => {
    const { state, ctx } = world()
    /** 远征落盘：打的是被占星系（`foeGalaxyId` 优先于卡的母港） */
    state.expedition.foeGalaxyId = GID
    state.expedition.anomalyId = CARD
    const r = weekendApplyBattleOutcome(state, ctx, CARD, true, Date.now(), null)
    expect(r?.kind, '认得出是主动出击').toBe('assault')
    expect(r?.isk, '入侵战不即时发钱').toBe(0)
    expect(r?.gain, '进度照记（调试模式 +50%）').toBeCloseTo(0.5, 6)
  })
})
