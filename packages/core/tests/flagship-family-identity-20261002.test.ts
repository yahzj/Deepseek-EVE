/**
 * **旗舰身份「族无关」**（**2026-10-02 修 · 船长转述玩家报障**，原话照抄）：
 *
 * > 「**发现问题，哪怕母舰剩余1%血，进入战斗后母舰都是满血**」
 *
 * ## 真因
 *
 * core 里的母舰身份**写死成 H 族那一艘**（`WEEKEND_FLAGSHIP_SHIP_ID = 'foe-h-ink-flagship'`，
 * `weekendIsFlagshipShipId` 也只认它），而**本期入侵族是 R（光环科技）**、它的母舰是
 * `foe-r-corona-nexus` ⇒ **一条都对不上** ⇒ 整条"池子覆写"链对 R 族全部失效：
 * ① 开战时 `FoeOverride.bossShipId` 匹配不上 ⇒ `hpMul = bossHp / 舰级血` **不生效** ⇒ 母舰血量退回**卡面值**；
 * ② 战斗内血条分母（`arcs.maxHp.foe`）回落成"单位自身满值"⇒ **永远 100%＝满血**（玩家看到的那一条）；
 * ③ 伤害台账（`flagshipBattleLedger`）挑不出母舰 ⇒ 打出的伤害**一点都没进池子**
 *   ⇒ R 族的"单场不死 / 跨场累计"整条失灵（池子永远打不空 ⇒ 旗舰永远杀不掉）。
 *
 * ## 修法（唯一取数口 · 族无关）
 *
 * `weekendFlagshipSlotOf(card)` = **卡自身那艘 `hullClassTier === 5`**（两族的旗舰卡都满足：
 * 母舰 T5、僚舰 T3/T4）⇒ 加新族**不用改 core**。三个消费方同源：伤害台账挑舰 ·
 * `FoeOverride.bossShipId` · 三层容量用的 `split`（改前 R 族还回落成 H 族的 split）。
 *
 * 本文件锁四件事：① 两族的母舰都认得出来（且不是写死那艘）；② R 族开战覆写三件套（bossShipId /
 * 三层容量用**本卡 split** / `bossHpLayers` = 池子剩余分层）；③ R 族母舰单位血量 = **池子剩余**、
 * 战斗屏分母 = **池子容量** ⇒ 血条**不是满血**；④ R 族伤害台账：打掉的伤害**真的进池子**（改前恒 0）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  WEEKEND_FLAGSHIP_POOL_HP,
  WEEKEND_FLAGSHIP_SHIP_ID,
  weekendCoreCandidates,
  weekendFlagshipLayerCaps,
  weekendFlagshipSlotOf,
  weekendFlagshipView,
  weekendIsFlagshipShipId,
} from '../src/weekendEvent'
import { weekendApplyBattleOutcome, weekendFlagshipSpecOf } from '../src/weekendBattle'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { advanceBattleFor, battleArcsFor, flagshipBattleLedger } from '../src/combat'

const ctx = buildSimContext()
const H = 3_600_000
const T0 = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()
const NOW = T0 + H
const R_MOTHER = 'foe-r-corona-nexus'
const H_MOTHER = 'foe-h-ink-flagship'

/** 池子只剩 1%：`150,000 − 148,500 = 1,500` */
function world(family: 'H' | 'R'): { s: GameState; core: string } {
  const s = createInitialState({ nowWallMs: 0, seed: 20261002 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.standingsEarned = { ...(s.standingsEarned ?? {}), dsi: 100 }
  s.standings = { ...s.standings, dsi: 100 }
  const core = weekendCoreCandidates(s, ctx)[0]!
  s.weekendEvent = {
    seq: 1,
    startedAtWallMs: T0,
    coreId: core,
    peripheryIds: [],
    family,
    contributed: { [core]: 1 },
    flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP,
    flagshipHpDone: WEEKEND_FLAGSHIP_POOL_HP - 1_500,
  }
  return { s, core }
}

describe('旗舰身份「族无关」（2026-10-02 修 · 玩家报障「母舰 1% 血进战斗却是满血」）', () => {
  it('① 认母舰 = 卡自身那艘 T5（两族都认得出，且不是写死的那艘）', () => {
    const hCard = ctx.anomalies.get('ink-flagship')!
    const rCard = ctx.anomalies.get('corona-nexus')!
    expect(weekendFlagshipSlotOf(hCard)?.ship.id, 'H 族母舰').toBe(H_MOTHER)
    expect(weekendFlagshipSlotOf(rCard)?.ship.id, 'R 族母舰（**改前认不出来**）').toBe(R_MOTHER)
    expect(weekendFlagshipSlotOf(rCard)?.ship.id, '不是写死的那一艘').not.toBe(WEEKEND_FLAGSHIP_SHIP_ID)
    /** 遗留判据只认 H 族那一艘（保留导出兼容老调用方），新的生产路径不再用它 */
    expect(weekendIsFlagshipShipId(H_MOTHER)).toBe(true)
    expect(weekendIsFlagshipShipId(R_MOTHER), '这就是报障的根：遗留判据不认 R 族').toBe(false)
    /** 卡里 T5 唯一（僚舰都是 T3/T4）——`weekendFlagshipSlotOf` 的判据前提 */
    for (const [name, card] of [
      ['ink-flagship', hCard],
      ['corona-nexus', rCard],
    ] as const) {
      expect(card.ships!.filter((s) => s.ship.hullClassTier === 5).length, `${name} 恰有一条 T5`).toBe(1)
    }
  })

  it('② R 族开战覆写：bossShipId = R 母舰 · 三层容量用**本卡 split** · bossHpLayers = 池子剩余分层', () => {
    const { s } = world('R')
    const spec = weekendFlagshipSpecOf(s, ctx, NOW)!
    expect(spec.cardId).toBe('corona-nexus')
    const battle = weekendStartFlagshipBattle(s, ctx, NOW, [s.shipId])!
    const ov = battle.foeOverride!
    expect(ov.bossShipId, '**改前是 H 族那艘 ⇒ 覆写整条失效**').toBe(R_MOTHER)
    expect(ov.bossHp, '本场开场血量 = 池子剩余').toBe(1_500)
    expect(ov.bossHpMax, '血条分母 = 池子总量').toBe(WEEKEND_FLAGSHIP_POOL_HP)
    const rSplit = ctx.anomalies.get('corona-nexus')!.ships!.find((x) => x.ship.id === R_MOTHER)!.ship.split
    expect(ov.bossMaxLayers, '三层容量 = 池子总量 × **R 卡自己的 split**（改前回落成 H 的 0.2/0.55/0.25）').toEqual(
      weekendFlagshipLayerCaps(WEEKEND_FLAGSHIP_POOL_HP, rSplit),
    )
    expect(ov.bossHpLayers, '当前值 = 按 护盾→装甲→结构 顺序扣到最后只剩结构那一点').toEqual({ s: 0, a: 0, h: 1_500 })
    console.log(
      `  [读数] R 族覆写：bossShipId=${ov.bossShipId} · bossHp=${ov.bossHp}/${ov.bossHpMax} · ` +
        `容量=${JSON.stringify(ov.bossMaxLayers)} · 当前=${JSON.stringify(ov.bossHpLayers)}`,
    )
  })

  it('③ R 族母舰单位：血量 = **池子剩余**、战斗屏分母 = 池子容量 ⇒ 血条**不是满血**', () => {
    const { s } = world('R')
    const spec = weekendFlagshipSpecOf(s, ctx, NOW)!
    const battle = weekendStartFlagshipBattle(s, ctx, NOW, [s.shipId])!
    ;(battle as unknown as { waveIdx: number }).waveIdx = 3
    s.gameMs = battle.startedAtGameMs
    advanceBattleFor(s, ctx, battle, s.shipId, spec.cardId)
    const entry = Object.entries(battle.units).find(([, u]) => u.side === 'foe' && (u as { foeShipId?: string }).foeShipId === R_MOTHER)
    expect(entry, '最后一波应有 R 族母舰').toBeTruthy()
    const [tag, u] = entry!
    expect(u.hp, '改前这里是卡面满值 ⇒ 血条 100%').toEqual({ s: 0, a: 0, h: 1_500 })
    const arcs = battleArcsFor(s, ctx, { battle, anomaly: ctx.anomalies.get(spec.cardId)!, leaderShipId: s.shipId })!
    expect(arcs.maxHp.foe[tag], '分母 = 池子容量（不是单位自身满值）').toEqual(battle.foeOverride!.bossMaxLayers)
    const frac = (u.hp.s + u.hp.a + u.hp.h) / (arcs.maxHp.foe[tag]!.s + arcs.maxHp.foe[tag]!.a + arcs.maxHp.foe[tag]!.h)
    expect(frac, `血条读数 ${(frac * 100).toFixed(1)}% —— 必须是 1% 上下的一点点，**不是满血**`).toBeLessThan(0.02)
    console.log(`  [读数] R 族母舰单位血 ${JSON.stringify(u.hp)} · 分母 ${JSON.stringify(arcs.maxHp.foe[tag])} ⇒ 血条 ${(frac * 100).toFixed(1)}%`)
  })

  it('④ R 族伤害台账：打掉的伤害**真的进池子**（改前恒 0 ⇒ 池子永远打不空）', () => {
    const { s, core } = world('R')
    const spec = weekendFlagshipSpecOf(s, ctx, NOW)!
    const battle = weekendStartFlagshipBattle(s, ctx, NOW, [s.shipId])!
    ;(battle as unknown as { waveIdx: number }).waveIdx = 3
    s.gameMs = battle.startedAtGameMs
    advanceBattleFor(s, ctx, battle, s.shipId, spec.cardId)
    const u = Object.values(battle.units).find((x) => x.side === 'foe' && (x as { foeShipId?: string }).foeShipId === R_MOTHER)!
    expect(u, '母舰在场上').toBeTruthy()
    /** 直接扣掉母舰 400 点血（台账读的就是"单位 hpMax − hp" ⇒ 与真实开火同一条量法） */
    u.hp = { ...u.hp, h: Math.max(0, u.hp.h - 400) }
    const led = flagshipBattleLedger(battle, [R_MOTHER])
    expect(led.rawDmg, '台账认得出 R 族母舰').toBe(400)
    const before = s.weekendEvent!.flagshipHpDone!
    weekendApplyBattleOutcome(s, ctx, spec.cardId, false, NOW, battle, { galaxyId: core, kind: 'flagship' })
    expect(s.weekendEvent!.flagshipHpDone, '这 400 点进了池子（改前一点都不会进）').toBe(before + 400)
    console.log(`  [读数] 台账 rawDmg=${led.rawDmg} ⇒ 池子 flagshipHpDone ${before} → ${s.weekendEvent!.flagshipHpDone}`)
    /** 收尾：池子真的能被打空（R 族"单场不死 / 跨场累计"成立的前提） */
    expect(weekendFlagshipView(s, s.weekendEvent!, NOW, NOW).shown, '旗舰仍现身（池子还没空）').toBe(true)
  })
})
