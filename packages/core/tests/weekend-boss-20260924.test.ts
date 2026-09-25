/**
 * **周末入侵 · 旗舰 BOSS 化（跨场累计伤害 ＋ 章鱼人削血）**（船长 2026-09-24 第二轮令）
 *
 * 船长原话（照抄）：
 * - 「**墨潮入侵母舰我想改成类似BOSS的机制：血量极厚，但是玩家对其造成的伤害会累计。…
 *   需要玩家多次战斗后才能击沉。之前设计的旗舰出现后2小时就会被章鱼人官方击败，
 *   也改成在2小时内削减旗舰的血量。**」
 * - 「**2小时内按时间削掉100%母舰血量。当玩家正在战斗时，会暂停削血。等玩家战斗结束才继续。
 *   防止抢走玩家的击杀。**」
 * - 「**按对母舰造成的伤害决定，如果母舰没有受伤就是0输出。**」· 离线「**挂起：离线时章鱼也停**」·
 *   血量「**约 5 场**」
 *
 * 本文件钉住：池子总量 = 5 × 单场最高伤害（含下限）· 只算打进母舰的伤害 · 幂等记账 ·
 * 章鱼人 2h 削 100%（战斗中暂停 / 离线暂停）· 谁先到 0 算谁 · 非 BOSS 族逐字走老口径。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { activeFoeSpecsOf, createBattleState, flagshipBattleLedger } from '../src/combat'
import type { GameState } from '../src/state'
import {
  WEEKEND_BOSS_FAMILIES,
  WEEKEND_BOSS_TICK_MAX_MS,
  WEEKEND_FLAGSHIP_DEADLINE_MS,
  WEEKEND_FLAGSHIP_POOL_HP,
  weekendFlagshipHpRemaining,
  weekendBossPoolView,
  weekendFlagshipDefeated,
  weekendIsBossFamily,
  weekendIsFlagshipShipId,
  weekendNoteFlagshipDamage,
  weekendNpcTimelineMs,
  weekendOctopusTick,
  weekendTickBoss,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'

const ctx = buildSimContext()
const H_MS = 3_600_000

function fresh(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 20260924 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = true
  return s
}

/** 一场 H 族的入侵（旗舰池相关用例的底座） */
function bossEvent(state: GameState, family = 'H'): WeekendEventState {
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'gal-core',
    peripheryIds: ['gal-p1'],
    family,
    contributed: {},
    flagshipAtWallMs: 0,
  }
  state.weekendEvent = ev
  return ev
}

describe('旗舰 BOSS 池 · 累计伤害', () => {
  it('族池开关：只有 `WEEKEND_BOSS_FAMILIES` 里的族走池子口径（2026-09-24 = H）', () => {
    const s = fresh()
    expect([...WEEKEND_BOSS_FAMILIES]).toEqual(['H'])
    expect(weekendIsBossFamily(bossEvent(s, 'H'))).toBe(true)
    expect(weekendIsBossFamily(bossEvent(s, 'A'))).toBe(false)
    // 非 BOSS 族：任何记账都是空转（逐字走老口径）
    const evA = bossEvent(s, 'A')
    expect(weekendNoteFlagshipDamage(evA, 9_999)).toBe(false)
    expect(evA.flagshipHpMax).toBeUndefined()
    expect(weekendBossPoolView(s, evA)).toBeNull()
  })

  it('**池子 = 固定 150,000**（船长 2026-09-25）：首次接战即立起，与"首战打多少"无关', () => {
    const s = fresh()
    const ev = bossEvent(s)
    expect(weekendNoteFlagshipDamage(ev, 100, 1)).toBe(false) // 首场（runId 1）
    expect(ev.flagshipHpMax).toBe(WEEKEND_FLAGSHIP_POOL_HP) // ≠ 5 × 100（旧自适应口径已废）
    expect(ev.flagshipHpDone).toBe(100)
    // 同一场重复结算（引擎可能调两次）⇒ **幂等**，不再叠加
    expect(weekendNoteFlagshipDamage(ev, 100, 1)).toBe(false)
    expect(ev.flagshipHpDone).toBe(100)
    // 第二场打得更多（150）⇒ 池子**不变**（固定常量）、伤害照累计
    weekendNoteFlagshipDamage(ev, 150, 2)
    expect(ev.flagshipHpDone).toBe(250)
    expect(ev.flagshipHpMax).toBe(WEEKEND_FLAGSHIP_POOL_HP)
    // 之后每场 50,000 ⇒ 第 3 场把池子打空 ⇒ 判定击沉
    expect(weekendNoteFlagshipDamage(ev, 50_000, 3)).toBe(false)
    expect(weekendNoteFlagshipDamage(ev, 50_000, 4)).toBe(false)
    expect(weekendNoteFlagshipDamage(ev, 49_750, 5)).toBe(true)
    expect(weekendFlagshipDefeated(ev)).toBe(true)
  })

  it('**只算打进母舰的伤害**：一场 0 输出 ⇒ 0 进度（池子仍按常量立起，界面不再"待接战"）', () => {
    const s = fresh()
    const ev = bossEvent(s)
    expect(weekendNoteFlagshipDamage(ev, 0)).toBe(false)
    expect(ev.flagshipHpMax, '2026-09-25：池子固定 ⇒ 接战即立起').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    expect(ev.flagshipHpDone ?? 0).toBe(0)
    expect(weekendBossPoolView(s, ev)!.needDmg).toBe(WEEKEND_FLAGSHIP_POOL_HP)
  })

  it('母舰血条 = **池子剩余**（船长选甲）：`weekendFlagshipHpRemaining` 随累计伤害下降、下限 1', () => {
    const s = fresh()
    const ev = bossEvent(s)
    expect(weekendFlagshipHpRemaining(ev), '未接战 ⇒ 满池').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    weekendNoteFlagshipDamage(ev, 60_000, 1)
    expect(weekendFlagshipHpRemaining(ev)).toBe(WEEKEND_FLAGSHIP_POOL_HP - 60_000)
    weekendNoteFlagshipDamage(ev, 90_000, 2)
    expect(weekendFlagshipHpRemaining(ev), '打空后夹到 1（开战入口另判"已击沉"）').toBe(1)
  })

  it('池子常量：`WEEKEND_FLAGSHIP_POOL_HP` = 150,000（≈2.5 个母舰）· 旧的 ×5 下限常量已删', () => {
    expect(WEEKEND_FLAGSHIP_POOL_HP).toBe(150_000)
  })
})

describe('旗舰 BOSS 池 · 章鱼人削血', () => {
  it('**2 小时削 100%**：削到一半时读数 = 50%，且这是**独立进度**（不扣玩家已造成的伤害）', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendNoteFlagshipDamage(ev, 1_000, 1) // 池 5000
    /**
     * ⚠ `debugQuick` 下 2 小时窗口**同样 ÷60**（= 2 分钟）⇒ 要按**本档的实际窗口**折算，
     * 不能拿 `WEEKEND_FLAGSHIP_DEADLINE_MS` 原值直接除（调试档下它会瞬间削满）。
     */
    const windowMs = weekendNpcTimelineMs(s, WEEKEND_FLAGSHIP_DEADLINE_MS)
    expect(windowMs).toBe(WEEKEND_FLAGSHIP_DEADLINE_MS / 60)
    expect(weekendOctopusTick(s, ev, windowMs / 2, false)).toBe(false)
    const v = weekendBossPoolView(s, ev)!
    expect(v.octopusFrac).toBeCloseTo(0.5, 10)
    expect(v.octopusDone).toBeCloseTo(v.hpMax / 2, 6)
    expect(v.hpDone).toBe(1_000) // 玩家那 1000 还在
    expect(v.playerFrac).toBeCloseTo(1_000 / WEEKEND_FLAGSHIP_POOL_HP, 10)
    // 到点 ⇒ 章鱼人削满
    expect(weekendOctopusTick(s, ev, windowMs / 2, false)).toBe(true)
  })

  it('**战斗中暂停**（船长：「玩家正在战斗时，会暂停削血」）', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendNoteFlagshipDamage(ev, 1_000, 1)
    const windowMs = weekendNpcTimelineMs(s, WEEKEND_FLAGSHIP_DEADLINE_MS) // 调试档 = 2 分钟
    expect(weekendOctopusTick(s, ev, windowMs, true)).toBe(false)
    expect(ev.octopusDrainedMs ?? 0).toBe(0) // 整整一个窗口一点没削
    expect(weekendOctopusTick(s, ev, windowMs / 2, false)).toBe(false)
    expect(ev.octopusDrainedMs).toBe(windowMs / 2)
    expect(weekendOctopusTick(s, ev, windowMs / 2, false)).toBe(true) // 到点 ⇒ 削满
  })

  it('**离线暂停**（船长：「挂起：离线时章鱼也停」）：心跳不传墙钟 ⇒ 整拍不推进', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendNoteFlagshipDamage(ev, 1_000)
    expect(weekendTickBoss(s, undefined, false)).toEqual({})
    expect(ev.octopusDrainedMs ?? 0).toBe(0)
    // 在线第一拍只立基线（没有"上一拍"就没有可累计的时长）
    expect(weekendTickBoss(s, 1_000, false)).toEqual({})
    expect(ev.octopusDrainedMs ?? 0).toBe(0)
    // 第二拍起按增量推进
    expect(weekendTickBoss(s, 2_000, false)).toEqual({})
    expect(ev.octopusDrainedMs).toBe(1_000)
  })

  it('**大步长只按一拍算**（后台标签页 / 离线补算后的第一次心跳不会整段削掉）', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendNoteFlagshipDamage(ev, 1_000)
    weekendTickBoss(s, 0, false) // 立基线
    weekendTickBoss(s, 10 * H_MS, false) // 一次跳 10 小时
    expect(ev.octopusDrainedMs).toBe(WEEKEND_BOSS_TICK_MAX_MS)
  })

  it('**削满 ⇒ 章鱼人得手并结束本场**（`flagshipDown = octopus`）', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendNoteFlagshipDamage(ev, 1_000)
    weekendTickBoss(s, 0, false)
    // 分多次推进到 2 小时
    let down: { down?: 'octopus' } = {}
    for (let t = 0; t <= WEEKEND_FLAGSHIP_DEADLINE_MS; t += WEEKEND_BOSS_TICK_MAX_MS) {
      down = weekendTickBoss(s, t, false)
      if (down.down) break
    }
    expect(down.down).toBe('octopus')
    expect(ev.flagshipDown).toBe('octopus')
    expect(ev.endedAtWallMs).toBeDefined()
  })

  it('池子未锁定（还没接战）⇒ 章鱼人没有可削的目标', () => {
    const s = fresh()
    const ev = bossEvent(s)
    weekendTickBoss(s, 0, false)
    expect(weekendTickBoss(s, H_MS, false)).toEqual({})
    expect(ev.octopusDrainedMs ?? 0).toBe(0)
  })
})

describe('旗舰 BOSS 池 · 伤害台账（真打旗舰卡）', () => {
  it('母舰单位带 `foeShipId` 标记；台账只认母舰、量出"满血 − 当前"', () => {
    const c = ctx.anomalies.get('ink-flagship')!
    const bal = ctx.balance.battle
    const flagshipIds = (c.ships ?? []).map((x) => x.ship.id).filter((id) => weekendIsFlagshipShipId(id))
    expect(flagshipIds).toEqual(['foe-h-ink-flagship']) // 只认 T5 那一条
    // 第 4 波（母舰压轴）建单位 ⇒ 母舰那一条带标记
    const specs = activeFoeSpecsOf(c, bal, 3)
    const flag = specs.find((u) => u.foeShipId === 'foe-h-ink-flagship')
    expect(flag).toBeDefined()
    const others = specs.filter((u) => u.foeShipId !== 'foe-h-ink-flagship')
    expect(others.length).toBeGreaterThan(0) // 同波还有干扰舰 / 战巡 / 鱼雷舰
    // 只认母舰 ⇒ 台账里只有它一个单位
    const battle = createBattleState(flag!, specs, 0, 5_000)
    const led = flagshipBattleLedger(battle, flagshipIds)
    expect(led.flagshipSeq).toBe(1)
    expect(led.flagshipMaxHp).toBeGreaterThan(0)
    expect(led.rawDmg).toBe(0) // 刚开战、一点没挨打
    // 打掉母舰 30% ⇒ 台账读数跟着走（原始伤害，不做池子截断）
    const rt = battle.units[flag!.tag]!
    const total = rt.hp.s + rt.hp.a + rt.hp.h
    const cut = Math.round(total * 0.3)
    rt.hp = { ...rt.hp, h: Math.max(0, rt.hp.h - cut) }
    const led2 = flagshipBattleLedger(battle, flagshipIds)
    expect(led2.rawDmg).toBeGreaterThan(0)
    expect(led2.rawDmg).toBeLessThanOrEqual(led2.flagshipMaxHp)
  })
})
