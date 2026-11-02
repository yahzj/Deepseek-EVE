import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { haulEffectiveMinutes, haulRewardRange, haulUnitRewardRange } from '../src/hauling/routes'
import { haulRiskPreviewOf } from '../src/hauling/preview'
import { industrialBaseThreatOf, industrialFleetSnapshotOf, industrialThreatOf } from '../src/encounters/risk'
import { haulFleetPathOf } from '../src/hauling/fleet'

function world() {
  const ctx = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  state.fleet = {}
  state.shipId = addShipToFleet(state, 'sh-colossal')
  return { state, ctx, ids: [state.shipId] }
}

describe('运输收益与模糊威胁预览', () => {
  it('单位费率保留小数且只在实际订单取整，不改正式收益', () => {
    const { ctx } = world()
    const distance = haulEffectiveMinutes(ctx, 'galaxy-hub', 'galaxy-cinder')
    const unit = haulUnitRewardRange(ctx, distance)
    const bal = ctx.balance.haul
    const raw = 0.6 * bal.anchorNominalMinutes * (distance / bal.anchorEffectiveMinutes) ** bal.distExp
    expect(unit).toEqual({ min: raw * 5, max: raw * 10 })
    const reward = haulRewardRange(ctx, 1_527_660, distance)
    expect(reward).toEqual({ min: Math.ceil(1_527_660 * raw) * 5, max: Math.ceil(1_527_660 * raw) * 10 })
    expect(haulUnitRewardRange(ctx, 0)).toEqual({ min: 0, max: 0 })
  })

  it('预览不写状态或消费随机数，输入货量增大不降低威胁档', () => {
    const { state, ctx, ids } = world()
    const before = structuredClone(state)
    const small = haulRiskPreviewOf(state, ctx, ids, 1, 'galaxy-hub', 'galaxy-cinder')
    const large = haulRiskPreviewOf(state, ctx, ids, 1_527_660, 'galaxy-hub', 'galaxy-cinder')
    expect(state).toEqual(before)
    expect(large.exposed).toBe(true)
    expect(large.coefficientMin).not.toBeNull()
    expect(large.coefficientMin!).toBeGreaterThanOrEqual(small.coefficientMin!)
    expect(large.coefficientMax! - large.coefficientMin!).toBe(1)
    const fleet = industrialFleetSnapshotOf(state, ctx, ids, 1_527_660)
    const ratios = haulFleetPathOf(state, ctx, ids, 'galaxy-hub', 'galaxy-cinder').flatMap(row => {
      if ((ctx.galaxies.get(row.galaxyId)?.security ?? 1) > ctx.balance.encounter.lowSecMax) return []
      const base = industrialBaseThreatOf(ctx, row.galaxyId)!
      return [industrialThreatOf(base, fleet.industrialMassKg, fleet.cargoM3, ctx.balance.encounter.industrial.threat.profiles.hauling).targetThreat / base]
    })
    expect(large.coefficientMin).toBe(Math.floor(Math.max(...ratios)))
  })

  it('护航降频不冒充威胁下降', () => {
    const { state, ctx, ids } = world()
    const solo = haulRiskPreviewOf(state, ctx, ids, 1000, 'galaxy-hub', 'galaxy-cinder')
    ids.push(addShipToFleet(state, 'sh-hammerhead'))
    const escort = haulRiskPreviewOf(state, ctx, ids, 1000, 'galaxy-hub', 'galaxy-cinder')
    expect(escort.frequencyMul).toBeLessThan(solo.frequencyMul)
    expect(escort.coefficientMin).toBe(solo.coefficientMin)
    expect(escort.coefficientMax).toBe(solo.coefficientMax)
  })

  it('安全路线没有海盗威胁，危险地区无情报不输出伪精确系数', () => {
    const { state, ctx, ids } = world()
    const safe = { ...ctx, galaxies: new Map([...ctx.galaxies].map(([id, galaxy]) => [id, { ...galaxy, security: 1 }])) }
    expect(haulRiskPreviewOf(state, safe, ids, 100, 'galaxy-hub', 'galaxy-cinder')).toMatchObject({ exposed: false, coefficientMin: null, coefficientMax: null })
    const unknown = { ...ctx, anomalies: new Map() }
    expect(haulRiskPreviewOf(state, unknown, ids, 100, 'galaxy-hub', 'galaxy-cinder')).toMatchObject({ exposed: true, coefficientMin: null, coefficientMax: null })
  })
})
