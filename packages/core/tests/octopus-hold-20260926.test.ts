/**
 * **旗舰战后的章鱼人冷却**（**2026-09-26 船长令**）
 *
 * 船长原话（照抄）：「**给章鱼人进攻削血加个冷却，玩家战斗结束1分钟后，章鱼人才开始削血和判定。
 * 这样玩家就能正常收掉BOSS**」。
 *
 * 同日四条定稿（船长四答）：
 * ① **只有旗舰战**触发冷却（其它战斗照旧只"暂停削血"，不加尾巴）；
 * ② 调试档**同为 60 秒**；
 * ③ **不做**倒计时/提示（界面本来也没有倒计时）；
 * ④ 黑匣奖励位置**不动**（"打爆即给"那条不做）。
 *
 * 落点 = `weekendEvent.weekendTickBoss`（章鱼削血 ＋ 得手判定的唯一收口）：旗舰战进行中每拍把
 * `ev.octopusHoldUntilWallMs` 推后到 `now + 60 秒` ⇒ **战斗结束后 60 秒内既不削血、也不判得手**。
 *
 * 本文件钉住：停工期不削不判 · 解开后照常按拍累计（且不吃事后补算）· 非旗舰战不产生尾巴 ·
 * 冷却不挡玩家自己收 BOSS · 停工字段随档往返。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, countWare } from '../src/index'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendFlagshipSpecOf, weekendApplyBattleOutcome } from '../src/weekendBattle'
import { weekendStartFlagshipBattle, weekendFlagshipBattleActive } from '../src/weekendLaunch'
import {
  WEEKEND_BOSS_TICK_MAX_MS,
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_OCTOPUS_HOLD_MS,
  weekendFlagshipView,
  weekendNoteContribution,
  weekendNoteFlagshipDamage,
  weekendTickBoss,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const GID = 'galaxy-alkali'
const CORE = 'galaxy-kor'
/** 调试档削血速率 = 池子 ÷ 10 分钟窗口 = 250 点/秒（与 `weekend-boss-20260924` 同源读数） */
const PER_SEC = WEEKEND_FLAGSHIP_POOL_HP / (10 * 60)

type S = GameState

function fresh(seed = 20260926): S {
  const s = createInitialState({ nowWallMs: 0, seed })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  return s
}

/** H 族入侵 ＋ 池子已锁定（= 玩家已经跟母舰交手过） */
function bossWorld(usedHp = 1_000): { s: S; ev: WeekendEventState } {
  const s = fresh()
  const ev: WeekendEventState = {
    seq: 1,
    /** ⚠ 必须 > 0：`save.ts` 的清洗器以"coreId ＋ 开始时刻 > 0"为整个 weekendEvent 的存活闸门
     *  （老档零迁移口径）—— 写 0 会让读档整块丢掉（往返用例会假红） */
    startedAtWallMs: 1_000,
    coreId: CORE,
    peripheryIds: [GID],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  weekendNoteContribution(ev, GID, 1)
  weekendNoteContribution(ev, CORE, 1)
  weekendNoteFlagshipDamage(ev, usedHp) // 锁定池子（`flagshipHpMax` 立起）
  return { s, ev }
}

describe('旗舰战后的章鱼人冷却（2026-09-26 船长令）', () => {
  it('① 旗舰战进行中 ⇒ 不削血，且停工终点被推到 now + 60 秒', () => {
    const { s, ev } = bossWorld()
    weekendTickBoss(s, 0, true, true) // 立基线（战斗中，且旗舰战在打）
    expect(ev.octopusHpDone ?? 0, '第一拍只立基线').toBe(0)
    weekendTickBoss(s, 5_000, true, true)
    expect(ev.octopusHpDone ?? 0, '战斗中一律不削').toBe(0)
    expect(ev.octopusHoldUntilWallMs, '停工终点 = 最后一拍 + 60 秒').toBe(5_000 + WEEKEND_OCTOPUS_HOLD_MS)
    expect(WEEKEND_OCTOPUS_HOLD_MS).toBe(60_000)
  })

  it('② 旗舰战结束后 60 秒内 ⇒ 不削血、也不判得手（哪怕一刀就能削满）', () => {
    const { s, ev } = bossWorld(WEEKEND_FLAGSHIP_POOL_HP - 100) // 只剩 100 点：正常一拍就削满
    weekendTickBoss(s, 0, true, true) // 战斗中：暂停 + 起算冷却
    weekendTickBoss(s, 5_000, true, true)
    const endAt = 5_000
    /** 战斗结束（`inBattle` 转假）：随后 60 秒里它既不能削、也不能判 */
    for (const t of [endAt + 1_000, endAt + 30_000, endAt + WEEKEND_OCTOPUS_HOLD_MS - 1]) {
      expect(weekendTickBoss(s, t, false, false), `t=${t} 仍在停工期`).toEqual({})
    }
    expect(ev.octopusHpDone ?? 0).toBe(0)
    expect(ev.flagshipDown, '停工期不判得手').toBeUndefined()
    expect(ev.endedAtWallMs, '停工期不结束本场').toBeUndefined()
    expect(weekendFlagshipView(s, ev, endAt + 30_000, endAt + 30_000).down, '视图侧也不判').toBeUndefined()
  })

  it('③ 冷却走完 ⇒ 照常恢复削血（仍按每拍上限，不吃事后补算）', () => {
    const { s, ev } = bossWorld(WEEKEND_FLAGSHIP_POOL_HP - 10_000)
    weekendTickBoss(s, 0, true, true)
    const holdUntil = 0 + WEEKEND_OCTOPUS_HOLD_MS
    expect(ev.octopusHoldUntilWallMs).toBe(holdUntil)
    /** 解禁那一拍：`gap` 名义上是 60 秒，但只按一拍上限 5 秒算 */
    weekendTickBoss(s, holdUntil, false, false)
    expect(ev.octopusHpDone, '只削一拍的量（5 秒 × 250）').toBe(WEEKEND_BOSS_TICK_MAX_MS / 1_000 * PER_SEC)
    weekendTickBoss(s, holdUntil + 1_000, false, false)
    expect(ev.octopusHpDone, '此后按真实增量').toBe(WEEKEND_BOSS_TICK_MAX_MS / 1_000 * PER_SEC + PER_SEC)
  })

  it('④ 非旗舰战 ⇒ 只"暂停削血"，**不产生 60 秒尾巴**（船长：只有旗舰战触发冷却）', () => {
    const { s, ev } = bossWorld(WEEKEND_FLAGSHIP_POOL_HP - 100_000)
    weekendTickBoss(s, 0, true, false) // 在打别的仗（普通战斗）
    expect(ev.octopusHoldUntilWallMs, '不写停工终点').toBeUndefined()
    expect(ev.octopusHpDone ?? 0).toBe(0)
    /** 战斗一结束就照旧继续削（旧口径「等玩家战斗结束才继续」逐字未变） */
    weekendTickBoss(s, 5_000, false, false)
    expect(ev.octopusHpDone ?? 0, '结束后立刻恢复削血').toBeGreaterThan(0)
  })

  it('⑤ 冷却不挡玩家自己收 BOSS：停工期里把池子打空照样判玩家击沉', () => {
    const { s, ev } = bossWorld()
    ev.octopusHoldUntilWallMs = Date.now() + WEEKEND_OCTOPUS_HOLD_MS // 正处于停工期
    const box0 = countWare(s, 'blackbox-h')
    weekendNoteFlagshipDamage(ev, WEEKEND_FLAGSHIP_POOL_HP, 7777)
    const r = weekendApplyBattleOutcome(s, ctx, 'ink-flagship', true, Date.now(), null, {
      kind: 'flagship',
      galaxyId: CORE,
    })
    expect(ev.flagshipDown, '判玩家击沉').toBe('player')
    expect(r?.wreck, '残骸照发').toBeGreaterThan(0)
    expect(countWare(s, 'blackbox-h') - box0, '黑匣照到手（冷却只管章鱼人）').toBe(1)
  })

  it('⑥ 停工字段随档往返（不过清洗器就等于冷却可被读档绕过）', () => {
    const { s, ev } = bossWorld()
    weekendTickBoss(s, 0, true, true)
    weekendTickBoss(s, 1_000, true, true)
    const hold = ev.octopusHoldUntilWallMs
    expect(hold).toBe(1_000 + WEEKEND_OCTOPUS_HOLD_MS)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.weekendEvent
    expect(back?.octopusHoldUntilWallMs, '读档后停工终点还在').toBe(hold)
    expect(back?.bossTickWallMs, '拍基线同批保留').toBe(1_000)
  })

  it('⑦ 引擎接线：真开一场旗舰战 ⇒ `advanceGame` 每拍把停工终点推后（判据传得进去）', () => {
    const s = fresh()
    const now = Date.now()
    const ev: WeekendEventState = {
      seq: 1,
      startedAtWallMs: 1_000,
      coreId: CORE,
      peripheryIds: [GID],
      family: 'H',
      contributed: {},
    }
    s.weekendEvent = ev
    weekendNoteContribution(ev, GID, 1)
    weekendNoteContribution(ev, CORE, 1)
    const spec = weekendFlagshipSpecOf(s, ctx, now)!
    const battle = weekendStartFlagshipBattle(s, ctx, now, [s.shipId])!
    s.encounter = {
      active: true,
      shipId: s.shipId,
      galaxyId: CORE,
      name: spec.name,
      threat: spec.threat,
      anomalyId: spec.cardId,
      origin: '用例',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle,
    }
    expect(weekendFlagshipBattleActive(s), '战斗在打 ⇒ 判据为真').toBe(true)
    const t0 = 1_000_000
    advanceGame(s, 100, ctx, { nowWallMs: t0 })
    expect(ev.octopusHoldUntilWallMs, '引擎那一拍把停工终点推到 now + 60s').toBe(t0 + WEEKEND_OCTOPUS_HOLD_MS)
    advanceGame(s, 100, ctx, { nowWallMs: t0 + 100 })
    expect(ev.octopusHoldUntilWallMs, '每拍往后推').toBe(t0 + 100 + WEEKEND_OCTOPUS_HOLD_MS)
    expect(ev.octopusHpDone ?? 0, '战斗中不削血').toBe(0)
  })
})
