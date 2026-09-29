/**
 * **多装递减装备的「有效值（原值）」读数**（**2026-09-29 船长令**：「之后所有多装递减的装备，能否采用
 * 和维修装置类似的 '真实数值（原始数值）' 这样的方式标注参数？」）
 *
 * 单点 = `combat.fittedEffectParamsOf`（界面只许调它，别自己折权——与 `repairStatsFor` 同一条纪律）。
 * 两类口径：
 * - **折权族**（`curve` / `weighted` / `fleetDecay`）：本件那一份 = `原值 × stackWeight(同族第 n 件)`；
 * - **缺口族**（`gap`：三系抗性 / 闪避）：报**装上后该舰的合成值**（逐件折权对非线性缺口没有干净算法）。
 * 维修装置走 `repairStatsFor`（另有层容量增幅 × 技能），不在本表内。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { stackWeight } from '../src/equipment'
import { fittedEffectParamsOf } from '../src/combat'
import type { GameState } from '../src/state'

const ctx = buildSimContext()

/** 一条船（王鲭级 · 有中槽）＋ 指定的装配 */
function world(fitted: { high?: string[]; mid?: string[]; low?: string[] }): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.wallet.isk = 1_000_000_000
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.fleet[uid]!.fitted = { high: fitted.high ?? [], mid: fitted.mid ?? [], low: fitted.low ?? [] }
  state.shipId = uid
  return { state, uid }
}

describe('多装递减装备 · 装上后的「有效值（原值）」', () => {
  it('**折权族**：第 1 件拿满权、第 2 件按 87% 折（中继天线 +80% ⇒ +80% / +69.5%）', () => {
    const { state, uid } = world({ high: ['mod-drone-relay-3', 'mod-drone-relay-3'] })
    const mod = ctx.modules.get('mod-drone-relay-3')!
    const first = fittedEffectParamsOf(state, ctx, uid, mod, 1)
    const second = fittedEffectParamsOf(state, ctx, uid, mod, 2)
    expect(first.find((p) => p.key === 'droneRange')!.eff).toBeCloseTo(0.8, 10)
    expect(second.find((p) => p.key === 'droneRange')!.eff).toBeCloseTo(0.8 * stackWeight(2), 10)
    // 原值两件都一样（界面把它写在括号里）
    expect(second.find((p) => p.key === 'droneRange')!.raw).toBe(0.8)
  })

  it('**多个折权字段一起报**：矢量推进器 = 机动速度（折权）', () => {
    const { state, uid } = world({ mid: ['mod-mwd-3'] })
    const mod = ctx.modules.get('mod-mwd-3')!
    const p = fittedEffectParamsOf(state, ctx, uid, mod, 1)
    expect(p.find((x) => x.key === 'speed')!.eff).toBeCloseTo(2.5, 10)
    expect(p.find((x) => x.key === 'hitPenalty'), '命中代价不在本表（只报会衰减的加成项）').toBeUndefined()
  })

  it('**缺口族报"装上后的合成值"**：护盾动能增强 +50%，本舰实际护盾动能抗性 ≥ 本件原值', () => {
    const { state, uid } = world({ mid: ['mod-shield-kin-3'] })
    const mod = ctx.modules.get('mod-shield-kin-3')!
    const p = fittedEffectParamsOf(state, ctx, uid, mod, 1).find((x) => x.key === 'resistShield:kinetic')!
    expect(p.raw).toBeCloseTo(0.5, 10)
    expect(p.eff, '装上后的合成值（含船体基础抗）').toBeGreaterThanOrEqual(p.raw)
  })

  it('**flat 件不折权**（`eff` 恒等于 `raw`）——它们不走"多装递减"这条路', () => {
    const { state, uid } = world({ low: ['mod-rof-2'] })
    const mod = ctx.modules.get('mod-rof-2')!
    const p = fittedEffectParamsOf(state, ctx, uid, mod, 3)
    for (const x of p) expect(x.eff).toBe(x.raw)
  })

  it('没有任何可衰减字段 ⇒ 空表（界面据此不出这一行）', () => {
    const { state, uid } = world({})
    const mod = ctx.modules.get('mod-miner-3')!
    expect(fittedEffectParamsOf(state, ctx, uid, mod, 1)).toEqual([])
  })
})
