/**
 * P0 承伤持久化专项（2026-09-05 船长拍板）：
 * ① 战斗开局按场间残余缩放装甲/结构（护盾每场满值）；
 * ② 护盾战中被动回充（结构层打穿后停止，防无限僵持）；
 * ③ 港内全面维修同时恢复结构（=耐久）与装甲。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { createPlayerSpec, persistFleetHullDamage, startBattleFor } from '../src/combat'
import { startExpedition } from '../src/expedition'
import { repairShip } from '../src/shipyard'
import { makeTestCtx, anomaly, ship, fittedOf } from './helpers'

function world(hp: { shieldHp: number; armorHp: number; hullHp: number }): { state: GameState; ctx: SimContext } {
  const ctx: SimContext = makeTestCtx({ ships: [ship('sandcat', hp)] })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
  state.fleet['sandcat'] = {
    defId: 'sandcat',
    customName: null,
    durability: 1,
    armorPct: 1,
    cargo: {},
    fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
  }
  state.shipId = 'sandcat'
  return { state, ctx }
}

describe('P0 承伤持久化', () => {
  it('开局缩放：装甲/结构按场间残余起步（护盾每场满值）；persist 写回残余', () => {
    const { state, ctx } = world({ shieldHp: 400, armorHp: 1_000, hullHp: 800 })
    const shipId = state.shipId
    // 模拟上一场战后残余：甲 50%、结构 25%（结构=耐久）
    state.fleet[shipId]!.armorPct = 0.5
    state.fleet[shipId]!.durability = 0.25

    // 满值基线（createPlayerSpec 恒给满值；残余缩放发生在开战组装 startBattleFor）
    const me0 = createPlayerSpec(state, ctx, shipId)!
    expect(me0.hp.a).toBe(1_000)
    expect(me0.hp.h).toBe(800)
    expect(me0.hp.s).toBe(400)

    // 开战（母港目标，零航程）：battle 单位初始三层即按残余
    const b = startBattleFor(state, ctx, shipId, 'ano-a', 0)!
    const u = b.units['player']!
    expect(u.hp.a).toBe(1_000 * 0.5)
    expect(u.hp.h).toBe(800 * 0.25)
    expect(u.hp.s).toBe(400)

    // 战中把甲打到 20%、结构打到 10% → persist 写回
    u.hp = { s: 400, a: 200, h: 80 }
    persistFleetHullDamage(state, ctx, shipId, b)
    expect(state.fleet[shipId]!.armorPct).toBeCloseTo(0.2, 6)
    expect(state.fleet[shipId]!.durability).toBeCloseTo(0.1, 6)
  })

  it('护盾被动回充：无武器纯盾船对持续伤害源，开启回充存活、关闭则被击毁', () => {
    // 盾 5000（回充 100/s）/ 甲 10 / 结构 10；敌 threat 45（场景持续 dps ~65/s < 回充）
    const run = (regen: number): boolean => {
      const ctx: SimContext = makeTestCtx({
        ships: [ship('sandcat', { shieldHp: 5_000, armorHp: 10, hullHp: 10 })],
        anomalies: [anomaly('ano-soak', 'galaxy-hub', { threat: 45, reward: 10_000 })],
      })
      const state: GameState = createInitialState({ nowWallMs: 0, seed: 7 })
      state.fleet['sandcat'] = {
        defId: 'sandcat',
        customName: null,
        durability: 1,
        armorPct: 1,
        cargo: {},
        fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
      }
      state.shipId = 'sandcat'
      ctx.balance.battle.shieldRegenPerSec = regen
      expect(startExpedition(state, 'ano-soak', ctx).ok).toBe(true)
      advanceGame(state, 300_000, ctx)
      const b = state.expedition.battle
      if (!b || b.ended) return false
      const u = b.units['player']
      return !!u && (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)
    }
    expect(run(0)).toBe(false) // 无回充：盾被磨穿后击毁
    expect(run(0.02)).toBe(true) // 回充 2%/s（100/s > 敌 dps）：结构层从未被打穿
  })

  it('港内全面维修：结构（耐久）与装甲一起恢复至 100%', () => {
    const { state, ctx } = world({ shieldHp: 100, armorHp: 200, hullHp: 200 })
    const shipId = state.shipId
    state.fleet[shipId]!.durability = 0.4
    state.fleet[shipId]!.armorPct = 0.3
    state.wallet.isk = 1_000_000
    const r = repairShip(state, shipId, ctx)
    expect(r.ok).toBe(true)
    expect(state.fleet[shipId]!.durability).toBe(1)
    expect(state.fleet[shipId]!.armorPct).toBe(1)
  })
})
