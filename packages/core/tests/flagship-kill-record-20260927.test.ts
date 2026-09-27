/**
 * **旗舰战留档：玩家亲手击沉（2026-09-27 船长令）**
 *
 * 船长原话（照抄）：
 * - 「**和入侵结束的报告一样，留档玩家的旗舰战记录。直到下一次入侵开始时覆盖清空。**」
 * - 「**只记录作为判定，根据不同情况改变措辞**（玩家只抢最后一下但是没多少输出就说玩家参与度过低，
 *   黑匣被章鱼人拿走之类的，你再进行润色一下）。」
 * - 「**开关不能挂旗舰身上吗？旗舰爆炸开启。**」
 * - 「**都有开关记录了，为什么还会显示被章鱼人抢头？这难道不是你架构的问题吗。**」
 * - 「**关于章鱼人的输出，优先计算玩家的，玩家允许挤掉章鱼人的输出（最终输出占比），所以没必要快照。**」
 *
 * 本文件钉住四件事：
 * ① **触发制**：母舰在玩家的战斗里被打沉那一刻 ⇒ 战斗状态上落 `bossDownAtMs`（敌舰伤害唯一收口的观测），
 *    遭遇推进把它抄进场次记录 `ev.flagshipPlayerKill`（**与池子算术无关**）；
 * ② **幂等 ＋ 随档 ＋ 换场清空**；
 * ③ **归属以留档为准**（快照 `flagshipOutcome` 优先读留档 ⇒ 不再出现"玩家打沉却显示章鱼抢头"）；
 * ④ **占比玩家优先**：两份占比相加 ≤ 100%，玩家的那份不被章鱼挤掉。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addModule, addShipToFleet, addWare, countWare, createInitialState, fitModule } from '../src/index'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  weekendApplyBattleOutcome,
  weekendFlagshipSpecOf,
  weekendNoteFlagshipPlayerKill,
  weekendResultSnapshotOf,
  weekendSettlePlanOf,
} from '../src/weekendBattle'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { weekendSettleCommsOf } from '../src/weekendComms'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_FLAGSHIP_SHIP_ID,
  weekendFlagshipSharesOf,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext('zh')
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
const GUN = 'mod-missile-3'

/** 摆一场入侵（核心满 ＋ 外围清完），并把池子预置到"母舰只剩一点点血" */
function bossWorld(remain = 4_000): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed: 20260927 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  const ev: WeekendEventState = {
    seq: 1,
    /** ⚠ 必须 > 0：`save.ts` 以"coreId ＋ 开始时刻 > 0"为整个 `weekendEvent` 的存活闸门 */
    startedAtWallMs: 1_000,
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  weekendNoteContribution(ev, GID, 1)
  weekendNoteContribution(ev, CORE, 1)
  weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP - remain) // 立池子 ＋ 记"此前各场"
  return { s, ev }
}

/**
 * 一支真能打的编队：4 艘巨齿鲨，每艘 6 门 MK3 导弹 ＋ 3 件护盾件 ＋ 爆炸弹 ＋ 导弹/炮术技能。
 * ⚠ 炮台型号与护盾件是**探针实测定下来的**：纯动能炮台在第二波（干扰舰射程压制）就会打不动，
 * 只装炮台不装护盾则第三波被打散 ⇒ 到不了母舰那一波（探针读数见工作文档）。
 */
function armFleet(s: GameState): string[] {
  const uids: string[] = []
  const MIDS = ['mod-shield-ext-3', 'mod-shield-exp-3', 'mod-shield-kin-3']
  for (let n = 0; n < 4; n += 1) {
    const uid = addShipToFleet(s, 'sh-megalodon')
    uids.push(uid)
    addModule(s, GUN, 6)
    for (let i = 0; i < 6; i += 1) {
      const r = fitModule(s, GUN, ctx, { rack: 'high', index: i, shipId: uid })
      if (!r.ok) throw new Error(`用例编队装配失败：${r.error}`)
    }
    for (let i = 0; i < MIDS.length; i += 1) {
      addModule(s, MIDS[i]!, 1)
      const r = fitModule(s, MIDS[i]!, ctx, { rack: 'mid', index: i, shipId: uid })
      if (!r.ok) throw new Error(`用例编队装配失败：${r.error}`)
    }
  }
  s.shipId = uids[0]!
  addWare(s, 'ammo-explosive-l', 200_000)
  for (const id of ['missile-launching', 'gunnery', 'fire-control', 'reload-drills', 'targeting-integration']) {
    s.skills.trained[id] = 5
  }
  return uids
}

/** 走引擎真路径开一场旗舰战（与 `engine.challengeWeekendFlagship` 同形挂进遭遇槽） */
function launchFlagship(s: GameState, now: number, squad: readonly string[]): void {
  const spec = weekendFlagshipSpecOf(s, ctx, now)!
  const battle = weekendStartFlagshipBattle(s, ctx, now, squad)!
  s.encounter = {
    active: true,
    shipId: squad[0] ?? s.shipId,
    galaxyId: CORE,
    name: spec.name,
    threat: spec.threat,
    anomalyId: spec.cardId,
    origin: '用例',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle,
  }
}

/** 推进到战斗收尾（真引擎每拍 1 秒；四波 ＋ 只差一点血的母舰约 200~300 拍） */
function fightToEnd(s: GameState, now: number, maxTicks = 1_200): void {
  for (let i = 0; i < maxTicks && s.encounter.active; i += 1) {
    advanceGame(s, 1_000, ctx, { nowWallMs: now + i * 1_000 })
  }
}

describe('旗舰战留档：玩家亲手击沉（2026-09-27 船长令）', () => {
  /**
   * ① **触发制**：真打一场，把母舰打沉 ⇒ 战斗状态上留 `bossDownAtMs`，遭遇推进把事实抄进场次记录。
   * 这一条同时钉住"不是每拍扫血、也不是靠池子算术反推"。
   */
  it('① 母舰在玩家的战斗里被打沉 ⇒ 落 `bossDownAtMs` ＋ 场次留档置位', () => {
    const { s, ev } = bossWorld(4_000)
    const squad = armFleet(s)
    const now = 5_000_000
    launchFlagship(s, now, squad)
    const battle = s.encounter.battle!
    expect(battle.foeOverride?.bossShipId, '本场认得出哪条舰级是母舰').toBe(WEEKEND_FLAGSHIP_SHIP_ID)
    fightToEnd(s, now)
    const boss = Object.values(battle.units).find((u) => u.foeShipId === WEEKEND_FLAGSHIP_SHIP_ID)
    expect(boss, '母舰单位入过场').not.toBeUndefined()
    expect(Math.round(boss!.hp.s + boss!.hp.a + boss!.hp.h), '母舰在战斗里被打沉').toBe(0)
    expect(boss!.downAtMs, '母舰单位上留了阵亡时刻（伤害唯一收口的观测）').not.toBeUndefined()
    expect(battle.bossDownAtMs, '本场记下了 BOSS 阵亡时刻').not.toBeUndefined()
    expect(ev.flagshipPlayerKill, '场次留档置位').not.toBeUndefined()
    expect(ev.flagshipPlayerKill!.runId, '留档记的是那一场战斗的身份').toBe(battle.startedAtGameMs)
    expect(ev.flagshipPlayerKill!.downAtGameMs, '战斗时钟与单位上的一致').toBe(battle.bossDownAtMs)
  })

  /** ② **幂等**：同一场再抄一次不覆盖首次那一刻 */
  it('② 同场重复调用 ⇒ 只记第一次（不覆盖）', () => {
    const { s, ev } = bossWorld(4_000)
    const squad = armFleet(s)
    const now = 5_000_000
    launchFlagship(s, now, squad)
    const battle = s.encounter.battle!
    fightToEnd(s, now)
    const first = { ...ev.flagshipPlayerKill! }
    expect(first, '留档已置位').not.toBeUndefined()
    /** 战斗对象还在（遭遇槽已清，但我们手里这份引用还在）⇒ 再抄一次应当是"已有记录，不覆盖" */
    expect(weekendNoteFlagshipPlayerKill(s, battle, now + 999_999), '已有留档 ⇒ 返回 false').toBe(false)
    expect(ev.flagshipPlayerKill, '原值不动').toEqual(first)
  })

  /** ③ **随档往返 ＋ 换场清空**：留档必须随档（否则结算报告又回落到池子算术），换场随事件对象消失 */
  it('③ 留档随档往返；换场（新事件对象）即清空', () => {
    const { s, ev } = bossWorld(4_000)
    const squad = armFleet(s)
    const now = 5_000_000
    launchFlagship(s, now, squad)
    fightToEnd(s, now)
    const keep = { ...ev.flagshipPlayerKill! }
    expect(keep, '留档已置位').not.toBeUndefined()
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.flagshipPlayerKill, '读档后留档还在').toEqual(keep)
    /** 换场 = 引擎开新一场时给出的是**全新对象** ⇒ 留档自然消失（= "下一次入侵开始时覆盖清空"） */
    const next: WeekendEventState = {
      seq: 2,
      startedAtWallMs: 2_000,
      coreId: CORE,
      peripheryIds: [GID],
      family: 'H',
      contributed: {},
    }
    expect(next.flagshipPlayerKill, '新场次没有留档').toBeUndefined()
  })

  /**
   * ④ **占比玩家优先**（船长令：「优先计算玩家的，玩家允许挤掉章鱼人的输出」）：
   * 两份相加恒 ≤ 100%，玩家的那份永不被章鱼挤掉。
   */
  it('④ 占比玩家优先：两份相加 ≤ 100%，玩家那份不被挤掉', () => {
    const { ev } = bossWorld(0)
    /** 真档那一场：玩家 97.75% ＋ 章鱼 2.25% ⇒ 相加正好 100% */
    ev.flagshipHpDone = 146_625
    ev.octopusHpDone = 3_376
    const a = weekendFlagshipSharesOf(ev)
    expect(a.player).toBeCloseTo(146_625 / WEEKEND_FLAGSHIP_POOL_HP, 6)
    expect(a.octopus).toBeCloseTo(3_375 / WEEKEND_FLAGSHIP_POOL_HP, 6)
    expect(a.player + a.octopus, '相加不超过 100%').toBeLessThanOrEqual(1.0000001)
    /**
     * 两条账**都越线**（玩家 10 万 ＋ 章鱼 6 万 = 16 万 > 池子）：章鱼那份被**挤掉**到 5 万，
     * 玩家那份保持 66.67% —— 这正是船长要的"玩家优先"。
     */
    ev.flagshipHpDone = 100_000
    ev.octopusHpDone = 60_000
    const b = weekendFlagshipSharesOf(ev)
    expect(b.player, '玩家那份 = 自己打的 / 池子').toBeCloseTo(100_000 / WEEKEND_FLAGSHIP_POOL_HP, 6)
    expect(b.octopus, '章鱼那份被挤到"池子 − 玩家那份"').toBeCloseTo(50_000 / WEEKEND_FLAGSHIP_POOL_HP, 6)
    expect(b.player + b.octopus, '挤完之后正好 100%').toBeCloseTo(1, 6)
  })

  /**
   * ⑤ **归属以留档为准**（船长第 4 问）：留档说玩家亲手击沉、`flagshipDown` 却记成章鱼 ⇒
   * 结算快照的归属必须读成 `player`，结算信也写上"你亲手击沉"那一段。
   */
  it('⑤ 留档优先于 `flagshipDown`：快照归属读成 player，结算信带上那一段', () => {
    const { s, ev } = bossWorld(1_000)
    ev.flagshipDown = 'octopus'
    ev.flagshipBlackBox = false
    ev.flagshipPlayerKill = { atWallMs: 9_000, runId: 123, waveIdx: 3, downAtGameMs: 8_500 }
    const plan = weekendSettlePlanOf(s, ev, 9_500)
    const snap = weekendResultSnapshotOf(s, ctx, ev, 9_500, plan)
    expect(snap.flagshipOutcome, '留档说玩家击沉 ⇒ 归属就是玩家击沉').toBe('player')
    expect(snap.flagship?.defeated, '"已击沉"与归属同源').toBe(true)
    expect(snap.flagshipPlayerKill, '留档进快照（与结束报告同层）').toEqual({ atWallMs: 9_000, waveIdx: 3 })
    const mail = weekendSettleCommsOf(s, ctx, snap)
    expect(mail.bodyIds ?? [], '结算信里也写明"你亲手击沉"').toContain('core.weekend.042')
    expect((mail.paragraphs ?? []).some((t) => t.includes('亲手击沉')), '纯文本兜底段落也写了').toBe(true)
    /** 没有留档 ⇒ 照旧读 `flagshipDown`（章鱼 / 窗口），口径不变 */
    const noKill = bossWorld(1_000)
    noKill.ev.flagshipDown = 'octopus'
    const plan2 = weekendSettlePlanOf(noKill.s, noKill.ev, 9_500)
    expect(weekendResultSnapshotOf(noKill.s, ctx, noKill.ev, 9_500, plan2).flagshipOutcome, '没留档 ⇒ 章鱼').toBe('octopus')
  })

  /**
   * ⑥ **黑匣仍按表掷**（船长裁定「只记录作为判定」）：留档为真**不改变发奖**——
   * 玩家把血条打空这条路上，占比 100% 照旧必爆。
   */
  it('⑥ 留档不参与发奖：黑匣照旧按爆率表掷', () => {
    const { s, ev } = bossWorld(0)
    armFleet(s)
    ev.flagshipPlayerKill = { atWallMs: 1, runId: 1, downAtGameMs: 1 }
    const box0 = countWare(s, 'blackbox-h')
    weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP, 4242)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, 9_500, null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(ev.flagshipDown, '判玩家击沉').toBe('player')
    expect(r?.wreck, '残骸照发').toBeGreaterThan(0)
    expect(countWare(s, 'blackbox-h') - box0, '占比 100% ⇒ 必爆（与留档无关）').toBe(1)
  })
})
