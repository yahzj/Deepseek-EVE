/**
 * **无人机射程插件的叠加惩罚**（2026-09-14 船长「对无人机的射程插件添加叠加惩罚」→「按推荐折算」）。
 *
 * 口径（甲 + 同族同池 + 只动射程）：
 * - **折权加算**：`射程系数 = 1 + Σ pᵢ × stackWeight(n)`（p 从强到弱排位；权重 100% / 87% / 57% / 28% / 11%）；
 * - **同池**：制式中继天线 MK1/2/3 与 G 族「流亡中继桅」同槽（`drone-relay`）同收敛键 ⇒ 混装一起折权；
 * - **只动射程**：战术导控（单发）与甲板扩展（舱容）仍**全额加算**（本文件有对照断言钉住）。
 *
 * 判据单点 = `equipment.weightedSum`；收敛分组 = `stackingOf` 的 `weighted`。
 * ⚠ **修前口径 = 全额线性相加**（`droneRangeMult += pct`）⇒ 本文件里"折权读数"那几条在修前必红。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { createPlayerSpec } from '../src/combat'
import { curveMult, stackingOf, stackWeight, weightedSum } from '../src/equipment'

const ctx = buildSimContext()
const SWARM = 'sh-swarm' // 梭鱼级无人机护卫：高槽 3 · CPU 235 · 机舱 160 m³ · 船体无人机加成 +8%
const BEE = 'drone-scout' // 蜂鸟侦察无人机（射程基数 4,000 m，单发 3）

/** 建场：梭鱼 + 3 架蜂鸟 + 指定的高槽装配（其余中/低槽留空） */
function world(high: Array<string | null>): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, SWARM)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high, mid: [null, null, null], low: [null, null] }
  state.fleet[uid]!.droneLoad = { [BEE]: 3 }
  state.warehouse.items[BEE] = 0
  return { state, uid }
}

/** 该场里第一架蜂鸟武器的射程（放飞后读真规格） */
function beeRange(state: GameState, uid: string): number {
  const spec = createPlayerSpec(state, ctx, uid)!
  const bee = spec.weapons.find((w) => w.src === 'drone' && w.artId === BEE)
  expect(bee, '蜂鸟应已放飞').toBeTruthy()
  return bee!.maxRangeM
}

describe('无人机射程插件 · 叠加惩罚（2026-09-14 船长 · 折权加算）', () => {
  it('单点 `weightedSum`：逐件折权后相加（100% / 87% / 57%…）', () => {
    expect(weightedSum([])).toBe(0)
    expect(weightedSum([0.8])).toBeCloseTo(0.8, 10) // 第 1 件全额
    expect(weightedSum([0.8, 0.8])).toBeCloseTo(0.8 + 0.8 * stackWeight(2), 10)
    expect(weightedSum([0.8, 0.8, 0.8])).toBeCloseTo(0.8 * (stackWeight(1) + stackWeight(2) + stackWeight(3)), 10)
    // 读成"百分点"更直观：3×MK3 = **+195.2%**（折权）vs +240%（全额）；3×MK1 = +48.8% vs +60%
    expect(Math.round(weightedSum([0.8, 0.8, 0.8]) * 1000)).toBe(1952)
    expect(Math.round(weightedSum([0.2, 0.2, 0.2]) * 1000)).toBe(488)
    // 与"从强到弱排位"无关（混装按强件优先，值与书写顺序无关）
    expect(weightedSum([0.2, 0.8, 0.45])).toBeCloseTo(weightedSum([0.8, 0.45, 0.2]), 10)
    // 非正值不进池
    expect(weightedSum([0.8, 0, -1])).toBeCloseTo(0.8, 10)
    // ⚠ **与 `curveMult`（乘积形）不是一回事**：后者在大额件上反而**更大**（所以不能拿它当惩罚）
    expect(curveMult([0.8, 0.8])).toBeGreaterThan(1 + weightedSum([0.8, 0.8]))
  })

  it('收敛分组：中继天线四件 = `weighted`/`drone-relay`；导控与甲板仍是 `flat`（本次只动射程）', () => {
    for (const id of ['mod-drone-relay-1', 'mod-drone-relay-2', 'mod-drone-relay-3', 'mod-lair-drone-relay-g']) {
      const def = ctx.modules.get(id)
      expect(def, `${id} 应在装备表里`).toBeTruthy()
      expect(stackingOf(def!), id).toEqual({ group: 'weighted', kind: 'drone-relay' })
    }
    for (const id of ['mod-drone-tac-2', 'mod-drone-rack-3']) {
      expect(stackingOf(ctx.modules.get(id)!).group, id).toBe('flat')
    }
  })

  it('接线（真战斗）：3× 中继 MK3 ⇒ 射程按折权系数，不是全额 3.4 倍', () => {
    const { state, uid } = world(['mod-drone-relay-3', 'mod-drone-relay-3', 'mod-drone-relay-3'])
    const mult = 1 + weightedSum([0.8, 0.8, 0.8])
    expect(beeRange(state, uid)).toBe(Math.round(4000 * mult)) // 折权 ⇒ 11,807 m
    expect(beeRange(state, uid)).not.toBe(Math.round(4000 * 3.4)) // 修前口径 ⇒ 13,600 m
  })

  it('接线（真战斗）：混装 MK3 + MK1 ⇒ 同池一起折权（+97.4%，不是 +100%）', () => {
    const { state, uid } = world(['mod-drone-relay-3', 'mod-drone-relay-1', null])
    const mult = 1 + weightedSum([0.8, 0.2])
    expect(beeRange(state, uid)).toBe(Math.round(4000 * mult)) // 7,895 m
    expect(beeRange(state, uid)).not.toBe(8000)
  })

  it('对照：战术导控（单发）仍**全额加算**——本次只动射程那一族', () => {
    const { state, uid } = world(['mod-drone-tac-2', 'mod-drone-tac-2', null])
    const spec = createPlayerSpec(state, ctx, uid)!
    const bee = spec.weapons.find((w) => w.src === 'drone' && w.artId === BEE)!
    // 单发 = 3 × 2（引擎单发×2）× (1 + 0.25 + 0.25 两件导控全额相加) × (1 + 0.20 船体)
    // （船体 = 梭鱼级无人机护卫；2026-09-17 船长：无人机船按档位给无人机伤害 ⇒ T2 = +20%，原 +8% 作废）
    expect(bee.shotDmg).toBe(Math.round(3 * 2 * 1.5 * 1.2))
    expect(bee.maxRangeM).toBe(4000) // 导控不加射程：基数原样
  })
})
