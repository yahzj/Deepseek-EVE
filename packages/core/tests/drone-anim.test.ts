/**
 * 无人机战斗动画·引擎侧展示字段回归（2026-09-10 船长批第一批）：
 * ① 武器条目携带来源 src / 机型 artId —— 炮台 turret / 导弹 missile / 激光 laser / 无人机 drone / 基础舰炮 base；
 * ② 开火事件 BattleFx 携带来源（旧事件缺省 = UI 按旧口径回退）；
 * ③ 射程弧把无人机逐架条目合并为「机型 ×N」一条（冷却取组内最小值）。
 * 纯展示字段：不参与任何伤害/命中/射程结算，本文件不改变既有数值回归。
 */
import { describe, expect, it } from 'vitest'
import type { ItemDef } from '../src/types'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { battleArcsFor, createPlayerSpec, pushBattleFx, startBattleFor } from '../src/combat'
import { makeTestCtx, moduleDef, ship } from './helpers'

const droneDef: ItemDef = {
  id: 'drone-x',
  name: '测试无人机',
  kind: 'drone',
  unitM3: 5,
  baseSellPriceIsk: 1,
  description: '测试无人机',
  dmg: 10,
  damageType: 'kinetic',
  cpuUse: 5,
  maxRangeM: 2500,
  defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 },
}

function weaponModule(id: string, slot: 'turret' | 'missile' | 'laser', type: 'kinetic' | 'explosive' | 'plasma') {
  return moduleDef(id, slot, 0, {
    damageType: type,
    dmgMult: 1.2,
    maxRangeM: 6000,
    minRangeM: 0,
    hitRate: 0.9,
    falloff: 0.3,
    reloadMs: 3000,
    cpuUse: 8,
  })
}

describe('无人机战斗动画·武器来源字段（2026-09-10 船长批）', () => {
  it('武器条目携带来源：炮台 turret / 导弹 missile / 激光 laser / 无人机 drone+机型 / 基础舰炮 base', () => {
    /** 单件装配取该件武器条目的来源（沙猫高槽有限：逐件单独造档装配） */
    const srcOf = (slot: 'turret' | 'missile' | 'laser'): string | undefined => {
      const def = weaponModule(`w-${slot}`, slot, slot === 'laser' ? 'plasma' : slot === 'missile' ? 'explosive' : 'kinetic')
      const state = createInitialState({ nowWallMs: 0, seed: 51 })
      const ctx = makeTestCtx({ modules: [def] })
      addModule(state, def.id, 1)
      expect(fitModule(state, def.id, ctx).ok).toBe(true)
      const spec = createPlayerSpec(state, ctx, state.shipId)!
      return spec.weapons.find((w) => w.label === def.name)?.src
    }
    expect(srcOf('turret')).toBe('turret')
    expect(srcOf('missile')).toBe('missile')
    expect(srcOf('laser')).toBe('laser')

    // 无人机（每架一条条目 + 机型 id）与基础舰炮（同为 fixed，但来源可区分）
    const state = createInitialState({ nowWallMs: 0, seed: 54 })
    const ctx = makeTestCtx({ items: [droneDef], ships: [ship('sandcat', { droneBayM3: 40, cpu: 200 })] })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 2 }
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    expect(spec.weapons.find((w) => w.label.startsWith('基础舰炮'))!.src).toBe('base')
    const drones = spec.weapons.filter((w) => w.src === 'drone')
    expect(drones).toHaveLength(2) // 每架一条条目（火力口径不变）
    expect(drones.every((w) => w.artId === 'drone-x')).toBe(true)
    // 基础舰炮与无人机同为 kind='fixed'，靠 src 区分（本轮修复的"分不出"问题）
    expect(drones.every((w) => w.kind === 'fixed')).toBe(true)
  })

  it('开火事件携带来源；旧事件缺省 src/artId（UI 回退旧口径，不误判为无人机）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 52 })
    const ctx = makeTestCtx()
    const b = startBattleFor(state, ctx, state.shipId, 'ano-a', 0)!
    pushBattleFx(b, { atMs: 1, side: 'me', tag: 'player', type: 'kinetic', src: 'drone', artId: 'drone-x', hit: true })
    pushBattleFx(b, { atMs: 2, side: 'me', tag: 'player', type: 'kinetic', hit: false })
    const withSrc = b.fx[b.fx.length - 2]!
    const legacy = b.fx[b.fx.length - 1]!
    expect(withSrc.src).toBe('drone')
    expect(withSrc.artId).toBe('drone-x')
    expect(legacy.src).toBeUndefined()
    expect(legacy.artId).toBeUndefined()
  })

  it('射程弧：无人机逐架条目合并为「机型 ×N」一条（冷却取组内最小，与 meReload 对齐）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 53 })
    const ctx = makeTestCtx({ items: [droneDef], ships: [ship('sandcat', { droneBayM3: 40, cpu: 200 })] })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 3 }
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-a', 0)!
    // 战斗视图读取的是当前活动战斗（运行时由远征流程写入）：此处按同口径挂上
    state.expedition.anomalyId = 'ano-a'
    state.expedition.battle = battle
    const arcs = battleArcsFor(state, ctx)!
    const droneArcs = arcs.me.filter((a) => a.src === 'drone')
    expect(droneArcs).toHaveLength(1)
    expect(droneArcs[0]!.count).toBe(3)
    expect(droneArcs[0]!.artId).toBe('drone-x')
    expect(droneArcs[0]!.label.endsWith('×3')).toBe(true)
    expect(droneArcs[0]!.maxM).toBe(2500)
    expect(arcs.meReload).toHaveLength(arcs.me.length)
  })
})
