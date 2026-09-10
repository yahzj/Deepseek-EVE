/**
 * 无人机舰的"专属加成"（2026-09-10 船长拍板）：
 * 无人机舰原有的 `powerBonus`（火力加成）只喂炮台、对机群无效——等于把母舰往炮舰方向推。
 * 现改为：**削弱 powerBonus**（王鲭 0.6→0.3、梭鱼 0.45→0.25）＋ **新增无人机专属加成**
 * `ShipDef.droneDmgBonus`（王鲭 +12% = 与其它巡洋舰的族加成同档；梭鱼 +8% = T2 档），
 * 只乘入放飞无人机单发（与战术导控、无人机作战学乘算）。
 *
 * 本测试钉住：字段存在与取值、乘算链（机型基数 ×2 × 导控 × 专属 × 作战学）、
 * 以及"专属加成的价值 = 只对无人机生效，不影响炮台"。
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

describe('无人机舰专属加成（2026-09-10 船长拍板）', () => {
  it('舰船字段：王鲭 +12%/火力 0.3；梭鱼 +8%/火力 0.25', () => {
    const sent = ctx.ships.get('sh-sentinel')!
    expect(sent.droneDmgBonus).toBe(0.12)
    expect(sent.powerBonus).toBe(0.3)
    const swarm = ctx.ships.get('sh-swarm')!
    expect(swarm.droneDmgBonus).toBe(0.08)
    expect(swarm.powerBonus).toBe(0.25)
    // 其它舰船不挂该字段（无人机专属，不给炮舰）
    expect(ctx.ships.get('sh-bullshark')!.droneDmgBonus).toBeUndefined()
  })

  it('乘算链：猎鹰单发 = 12 ×2 ×(1+导控) ×(1+专属) ×1.25；王鲭与梭鱼按各自专属加成区分', () => {
    const sent = specOf('sh-sentinel', { 'drone-heavy': 1 })
    const swarm = specOf('sh-swarm', { 'drone-heavy': 1 })
    const heavySent = sent.weapons.find((w) => w.src === 'drone')!.shotDmg ?? 0
    const heavySwarm = swarm.weapons.find((w) => w.src === 'drone')!.shotDmg ?? 0
    expect(heavySent).toBe(Math.round(12 * 2 * 1.12 * 1.25)) // 33.6 → 34
    expect(heavySwarm).toBe(Math.round(12 * 2 * 1.08 * 1.25)) // 32.4 → 32
    expect(heavySent).toBeGreaterThan(heavySwarm)
  })

  it('专属加成只喂无人机：同船基础舰炮单发只随 powerBonus（削弱后低于原值）', () => {
    const sent = specOf('sh-sentinel', {})
    const base = sent.weapons.find((w) => w.src === 'base')!.shotDmg
    // 基础舰炮 = 8 ×(1+0.05×0)×(1+0.3)×(1+0) = 10.4 → 10（削弱前 0.6 时为 13）
    expect(base).toBe(Math.round(8 * 1.3))
  })
})
