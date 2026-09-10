/**
 * G 族「烬火流亡」专属装备三件（2026-09-10 船长逐件过审：设定照既有料确立，
 * **两件全走无人机线** → G 族 = 无人机全套专族）：
 * - G1 流亡蜂群巢（无人机甲板·高槽）：无人机舱 +55 m³ / CPU 30；
 * - G2 流亡蜂群导控（无人机导控·高槽）：放飞无人机单发 **+45% / CPU 32**
 *   ——比战术导控阵列 MK3（+40% / CPU 45）效果高五个点、CPU 省 13 点（拼装件的性价比路线）；
 * - G3 流亡中继桅（无人机中继天线·高槽）：放飞无人机射程 **+65% / CPU 34**
 *   ——比中继天线 MK3（+80% / CPU 46）近一档、省 12 点 CPU。
 * 数值口径：G 族整体**上限低于 D/E**（D = 最强敌族、E = 略高于 MK3），靠"省 CPU 的高效拼装件"立身。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const CARRIER = 'sh-swarm' // 梭鱼级：高 4 槽 / 机巢 160 m³ / CPU 320 / 无人机专属加成 +8%

function makeCarrier(high: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const uid = addShipToFleet(state, CARRIER)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [null, null, null],
    low: [null, null],
  }
  state.fleet[uid]!.droneLoad = { 'drone-assault': 1, 'drone-sentry': 1 }
  return state
}

describe('G 族烬火流亡三件：无人机全套（2026-09-10 船长）', () => {
  it('G 族池已配齐三件：蜂群巢 / 蜂群导控 / 中继桅', () => {
    expect(FOE_LAIR_GEAR.G).toEqual(['mod-lair-drone-rack-g', 'mod-lair-drone-tac-g', 'mod-lair-drone-relay-g'])
    for (const id of FOE_LAIR_GEAR.G) expect(ctx.modules.get(id)).toBeTruthy()
  })

  it('三件的槽位/数值：机库 +55、导控 +45%、中继 +65%（CPU 30/32/34）', () => {
    const bay = ctx.modules.get('mod-lair-drone-rack-g')!
    const tac = ctx.modules.get('mod-lair-drone-tac-g')!
    const relay = ctx.modules.get('mod-lair-drone-relay-g')!
    expect([bay.droneBayBonusM3, bay.cpuUse]).toEqual([55, 30])
    expect([tac.droneDmgBonus, tac.cpuUse]).toEqual([0.45, 32])
    expect([relay.droneRangeBonusPct, relay.cpuUse]).toEqual([0.65, 34])
    expect([bay.slot, tac.slot, relay.slot]).toEqual(['drone-rack', 'drone-tac', 'drone-relay'])
    // 三件都是高槽装置（与炮位竞争）
    expect([bay.rack, tac.rack, relay.rack]).toEqual(['high', 'high', 'high'])
  })

  it('拼装件的性价比：导控比 MK3 效果高 5 个点、CPU 省 13 点；中继近一档、省 12 点', () => {
    const tacMk3 = ctx.modules.get('mod-drone-tac-3')!
    const relayMk3 = ctx.modules.get('mod-drone-relay-3')!
    const tac = ctx.modules.get('mod-lair-drone-tac-g')!
    const relay = ctx.modules.get('mod-lair-drone-relay-g')!
    expect(tac.droneDmgBonus!).toBeGreaterThan(tacMk3.droneDmgBonus!)
    expect(tac.cpuUse!).toBeLessThan(tacMk3.cpuUse! - 10)
    expect(relay.droneRangeBonusPct!).toBeLessThan(relayMk3.droneRangeBonusPct!)
    expect(relay.cpuUse!).toBeLessThan(relayMk3.cpuUse! - 10)
    // 线性件：比同族的同类 MK3 每点 CPU 更划算
    expect(tac.droneDmgBonus! / tac.cpuUse!).toBeGreaterThan(tacMk3.droneDmgBonus! / tacMk3.cpuUse!)
  })

  it('G2 进战斗：放飞无人机单发吃 +45%（与机体/技能/船体加成乘算）', () => {
    const state = makeCarrier(['mod-lair-drone-tac-g'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    // 赤鸢 dmg 6 × 2（2026-09-10 单发×2）× (1+0.45) × (1+船体 +8%)；技能未训练 = 1
    const expectShot = Math.round(6 * 2 * 1.45 * 1.08)
    const assault = spec.weapons.filter((w) => w.src === 'drone' && w.artId === 'drone-assault')
    expect(assault).toHaveLength(1)
    expect(assault[0]!.shotDmg).toBe(expectShot)
    // 对照：不装导控时的基础单发
    const plain = createPlayerSpec(makeCarrier(), ctx, makeCarrier().shipId)!
    expect(plain.weapons.find((w) => w.artId === 'drone-assault')!.shotDmg).toBe(Math.round(6 * 2 * 1.08))
  })

  it('G3 进战斗：放飞无人机射程 ×1.65（雷鸥 5000 → 8250 m）', () => {
    const state = makeCarrier(['mod-lair-drone-relay-g'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const sentry = spec.weapons.find((w) => w.artId === 'drone-sentry')!
    expect(sentry.maxRangeM).toBe(8250)
    // 机型本体数值不动（只是放飞时乘中继）
    expect(ctx.items.get('drone-sentry')!.maxRangeM).toBe(5000)
  })

  it('G 族三件同装（梭鱼 4 高槽 / CPU 320）：机库 + 伤害 + 射程一次到位', () => {
    const state = makeCarrier(FOE_LAIR_GEAR.G as unknown as string[])
    const ids = FOE_LAIR_GEAR.G.map((id) => ctx.modules.get(id)!)
    const cpu = ids.reduce((s, m) => s + (m.cpuUse ?? 0), 0)
    expect(cpu).toBe(96)
    expect(cpu).toBeLessThan(ctx.ships.get(CARRIER)!.cpu ?? 0)
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const sentry = spec.weapons.find((w) => w.artId === 'drone-sentry')!
    expect(sentry.maxRangeM).toBe(8250) // 中继生效
    expect(sentry.shotDmg).toBe(Math.round(20 * 2 * 1.45 * 1.08)) // 导控生效（雷鸥 dmg 20）
  })
})
