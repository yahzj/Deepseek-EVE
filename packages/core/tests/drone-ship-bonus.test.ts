/**
 * 无人机舰的"专属加成"——**2026-09-17 船长改口径后的现行版**。
 *
 * 沿革：
 * - 2026-09-10 船长拍板：无人机舰原有的 `powerBonus`（火力加成）只喂炮台、对机群无效——等于把母舰
 *   往炮舰方向推 ⇒ **削弱 powerBonus**（王鲭 0.6→0.3、梭鱼 0.45→0.25）＋ **新增 `droneDmgBonus`**
 *   （王鲭 +12%、梭鱼 +8%），只乘入放飞无人机单发。
 * - **2026-09-17 船长（本版）**：「**武装舰T1~T5获得单发伤害加成，分别是15/20/25/35/50…如果是
 *   无人机船，则改为同等数值的无人机伤害加成**」⇒ 这两艘**移除 `powerBonus`**、
 *   `droneDmgBonus` 改为按档位阶梯：**王鲭 T3 = 0.25 · 梭鱼 T2 = 0.20**。
 *
 * 本测试钉住：字段现状（powerBonus 已移除 / droneDmgBonus = 档位值）、乘算链
 * （机型基数 ×2 × 导控 × 专属 × 作战学）、以及"无人机加成不喂炮台"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, addShipToFleet } from '../src/index'
import { createPlayerSpec } from '../src/combat'

const ctx = buildSimContext()
const SKILLS = { 'drone-warfare': 5, 'drone-servicing': 5 } // 作战学满级 = ×1.25

function specOf(shipId: string, load: Record<string, number>) {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, shipId)
  state.shipId = uid
  for (const [k, v] of Object.entries(SKILLS)) state.skills.trained[k] = v
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  state.fleet[uid]!.droneLoad = { ...load }
  return createPlayerSpec(state, ctx, uid)!
}

describe('无人机舰专属加成（2026-09-17 船长改按档位）', () => {
  it('舰船字段：王鲭 无人机伤害 0.25、梭鱼 0.20；两艘的 powerBonus 均已移除', () => {
    const sent = ctx.ships.get('sh-sentinel')!
    expect(sent.droneDmgBonus, '王鲭 T3 ⇒ +25%').toBe(0.25)
    expect(sent.powerBonus, '无人机船改给无人机伤害 ⇒ 不再有单发加成').toBeUndefined()
    const swarm = ctx.ships.get('sh-swarm')!
    expect(swarm.droneDmgBonus, '梭鱼 T2 ⇒ +20%').toBe(0.20)
    expect(swarm.powerBonus).toBeUndefined()
    // 其它舰船不挂无人机专属字段（无人机专属，不给炮舰）
    expect(ctx.ships.get('sh-bullshark')!.droneDmgBonus).toBeUndefined()
  })

  it('乘算链：猎鹰单发 = 12 ×2 ×(1+导控) ×(1+专属) ×1.25；王鲭与梭鱼按各自档位区分', () => {
    const sent = specOf('sh-sentinel', { 'drone-heavy': 1 })
    const swarm = specOf('sh-swarm', { 'drone-heavy': 1 })
    const heavySent = sent.weapons.find((w) => w.src === 'drone')!.shotDmg ?? 0
    const heavySwarm = swarm.weapons.find((w) => w.src === 'drone')!.shotDmg ?? 0
    expect(heavySent).toBe(Math.round(12 * 2 * 1.25 * 1.25)) // 37.5 → 38
    expect(heavySwarm).toBe(Math.round(12 * 2 * 1.2 * 1.25)) // 36 → 36
    expect(heavySent).toBeGreaterThan(heavySwarm)
  })

  it('无人机加成不喂炮台：同船基础舰炮单发只随 powerBonus（现已移除 ⇒ 只剩炮术学）', () => {
    const sent = specOf('sh-sentinel', {})
    const base = sent.weapons.find((w) => w.src === 'base')!.shotDmg
    // 基础舰炮 = 8 ×(1+0.05×0)×(1+0)×(1+0) = 8（2026-09-17 前 powerBonus 0.3 时为 10）
    expect(base).toBe(8)
  })
})
