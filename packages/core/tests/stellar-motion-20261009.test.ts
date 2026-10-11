import { describe, expect, it } from 'vitest'
import { generateStellarSystem } from '../src/stellarGeneration'
import { stellarDynamicBody, stellarMotionBodies, stellarMotionStars, stellarIllumination, stellarLightDirection, stellarMotionSession, advanceStellarMotion } from '../../../apps/desktop/src/renderer/src/panels/stellarMotion'

const system = generateStellarSystem(3).system
describe('完整星系动态表现与独立光照', () => {
  it('七类行星/六类星系都可动态，流浪星系仅自转、不伪造公转中心', () => {
    for (const kind of ['single','binary','white-dwarf','neutron','black-hole','rogue'] as const) {
      for (const planetKind of ['rocky','desert','ice','ocean','lava','temperate','gas'] as const) expect(stellarDynamicBody({ ...system, kind }, { ...system.bodies[0]!,kind:planetKind })).toBe(true)
      const next = stellarMotionBodies({ ...system, kind },90000)
      expect(next).toEqual(kind === 'rogue' ? system.bodies : stellarMotionBodies(system,90000))
    }
  })
  it('原始坐标和初相位不写回，公转轨道半径守恒', () => {
    const before = structuredClone(system)
    expect(stellarMotionBodies(system, 0)).toEqual(system.bodies)
    const next = stellarMotionBodies(system, 45000)
    for (let i = 0; i < next.length; i++) expect(Math.hypot(next[i]!.x-500, next[i]!.y-350)).toBeCloseTo(Math.hypot(system.bodies[i]!.x-500, system.bodies[i]!.y-350))
    expect(next[0]!.x).not.toBe(system.bodies[0]!.x)
    expect(next[1]!.x).not.toBe(system.bodies[1]!.x)
    expect(system).toEqual(before)
  })
  it('双星围绕原中心运转，间距与初相位保持；其他中心天体不凭空位移', () => {
    const binary = { ...system,kind:'binary' as const,stars:[{x:475,y:350,radius:15},{x:525,y:350,radius:12}] }
    const before = structuredClone(binary)
    expect(stellarMotionStars(binary,0)).toEqual(binary.stars)
    const next = stellarMotionStars(binary,30000)
    expect(next[0]!.x).toBeCloseTo(500); expect(next[0]!.y).toBeCloseTo(325)
    expect(next[1]!.x).toBeCloseTo(500); expect(next[1]!.y).toBeCloseTo(375)
    expect(Math.hypot(next[0]!.x-next[1]!.x,next[0]!.y-next[1]!.y)).toBeCloseTo(50)
    for (const kind of ['single','white-dwarf','neutron','black-hole','rogue'] as const) expect(stellarMotionStars({...system,kind},90000)).toEqual(system.stars)
    expect(binary).toEqual(before)
  })
  it('同光源距离增加时光强严格降低，权重有界且双星分别给方向', () => {
    const near = stellarIllumination(system,{x:600,y:350},0)
    const middle = stellarIllumination(system,{x:700,y:350},0)
    const far = stellarIllumination(system,{x:900,y:350},0)
    expect(near.strengths[0]!).toBeGreaterThan(middle.strengths[0]!)
    expect(middle.strengths[0]!).toBeGreaterThan(far.strengths[0]!)
    expect(near.ambient).toBe(far.ambient)
    expect(near.ambient).toBe(.32)
    expect(near.directions).toEqual(far.directions)
    expect(stellarIllumination(system,system.stars[0]!,0).strengths[0]!).toBeLessThanOrEqual(1.2)
    const binary = {...system,kind:'binary' as const,stars:[{x:475,y:350,radius:15},{x:525,y:350,radius:12}]}
    const lights = stellarIllumination(binary,{x:500,y:350},0)
    expect(lights.directions).toEqual([[-1,0,.35],[1,0,.35]])
    expect(lights.strengths).toHaveLength(2)
    expect(lights.strengths.every(value => value > 0 && value <= 1.2)).toBe(true)
  })
  it('无恒星没有主光源，只有低环境光；黑洞吸积盘照明弱于同距离恒星', () => {
    const body = {x:600,y:350}
    const rogue = stellarIllumination({...system,kind:'rogue',starClass:'none',stars:[]},body,30000)
    expect(rogue.directions).toEqual([]);expect(rogue.strengths).toEqual([])
    expect(rogue.ambient).toBe(.20)
    expect(stellarIllumination({...system,kind:'black-hole',starClass:'black-hole'},body,0).ambient).toBe(.24)
    expect(rogue.ambient).toBeLessThan(stellarIllumination(system,body,0).ambient)
    expect(stellarIllumination({...system,kind:'black-hole',starClass:'black-hole'},body,0).strengths[0]!).toBeLessThan(stellarIllumination(system,body,0).strengths[0]!)
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
