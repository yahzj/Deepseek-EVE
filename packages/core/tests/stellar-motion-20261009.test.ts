import { describe, expect, it } from 'vitest'
import { generateStellarSystem } from '../src/stellarGeneration'
import { stellarDynamicBody, stellarMotionBodies, stellarLightDirection, stellarMotionSession, advanceStellarMotion } from '../../../apps/desktop/src/renderer/src/panels/stellarMotion'

const system = generateStellarSystem(3).system
describe('单星动态表现坐标与独立光向', () => {
  it('仅单星岩质海洋试作，其他星系/类型保持静态', () => {
    for (const body of system.bodies) expect(stellarDynamicBody(system, body)).toBe(['rocky','ocean'].includes(body.kind))
    for (const kind of ['binary','white-dwarf','neutron','black-hole','rogue'] as const) expect(stellarMotionBodies({ ...system, kind }, 90000)).toEqual(system.bodies)
  })
  it('原始坐标和初相位不写回，公转轨道半径守恒', () => {
    const before = structuredClone(system)
    expect(stellarMotionBodies(system, 0)).toEqual(system.bodies)
    const next = stellarMotionBodies(system, 45000)
    for (let i = 0; i < next.length; i++) expect(Math.hypot(next[i]!.x-500, next[i]!.y-350)).toBeCloseTo(Math.hypot(system.bodies[i]!.x-500, system.bodies[i]!.y-350))
    expect(next[0]!.x).not.toBe(system.bodies[0]!.x)
    expect(next[1]).toEqual(system.bodies[1])
    expect(system).toEqual(before)
  })
  it('光照朝向真实恒星，不随表面自转相位或固定左上取值', () => {
    expect(stellarLightDirection({ x: 0,y: 0 }, { x: 10,y: 0 })).toEqual([-1,0,.35])
    expect(stellarLightDirection({ x: 0,y: 0 }, { x: -10,y: 0 })).toEqual([1,0,.35])
    expect(stellarLightDirection({ x: 0,y: 0 }, { x: 0,y: 10 })).toEqual([0,1,.35])
    expect(stellarLightDirection({ x: 0,y: 0 }, { x: 0,y: 0 })).toEqual([0,0,1])
  })
  it('暂停/操作/后台/减少动态/显卡失败均冻结，重新显示不补离线时间', () => {
    const value = stellarMotionSession('test-only-motion')
    value.elapsedMs = 0; value.gpuReady = true
    expect(advanceStellarMotion(value, 40, 1000, true)).toBe(true)
    expect(value.elapsedMs).toBe(40)
    for (const key of ['paused','reduced'] as const) { value[key] = true; expect(advanceStellarMotion(value, 40, 1000, true)).toBe(false); value[key] = false }
    value.holds.add('hover'); expect(advanceStellarMotion(value, 40, 1000, true)).toBe(false); value.holds.clear()
    value.holdUntil = 2000; expect(advanceStellarMotion(value, 40, 1000, true)).toBe(false); value.holdUntil = 0
    expect(advanceStellarMotion(value, 10000, 1000, false)).toBe(false)
    value.gpuReady = false; expect(advanceStellarMotion(value, 40, 1000, true)).toBe(false); value.gpuReady = true
    advanceStellarMotion(value, 10000, 1000, true); expect(value.elapsedMs).toBe(140)
    expect(stellarMotionSession('test-only-motion')).toBe(value)
  })
})
