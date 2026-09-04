/**
 * V18 无人机流专项测试：纯无人机战斗（无炮）、甲板扩展（0 舱船 + 舱）、
 * 战术导控（伤害乘入）、胜率预估同源、CPU 放飞余量约束。
 * helpers 默认世界不含无人机——本文件按用例自给物品与船。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceBattleFor, battleWinPreview, createPlayerSpec, startBattleFor } from '../src/combat'
import { addModule, countModule, fitModule, repairDeprecatedModules, unfitAt } from '../src/equipment'
import type { ShipDef, SimContext } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

const DRONE_SCOUT = {
  id: 'drone-scout',
  name: '蜂鸟侦察机',
  kind: 'drone' as const,
  unitM3: 1.5,
  baseSellPriceIsk: 60,
  description: '测试轻型无人机',
  damageType: 'kinetic' as const,
  dmg: 3,
  cpuUse: 4,
}
const DRONE_ASSAULT = {
  id: 'drone-assault',
  name: '赤鸢攻击机',
  kind: 'drone' as const,
  unitM3: 3,
  baseSellPriceIsk: 120,
  description: '测试攻击无人机',
  damageType: 'explosive' as const,
  dmg: 6,
  cpuUse: 8,
}

const RACK1 = moduleDef('mod-drone-rack-1', 'drone-rack', 0, { droneBayBonusM3: 15, cpuUse: 5 })
const TAC2 = moduleDef('mod-drone-tac-2', 'drone-tac', 0, { droneDmgBonus: 0.25, cpuUse: 20 })

function makeCtx(ships: ShipDef[], withModules = true): SimContext {
  return makeTestCtx({
    ships,
    items: [DRONE_SCOUT, DRONE_ASSAULT] as never[],
    anomalies: [anomaly('ano-dw', 'galaxy-hub', { threat: 2, reward: 5_000 })],
    modules: withModules ? [RACK1, TAC2] : [],
  })
}

/** 把当前驾驶船替换为指定船型并塞货仓物品 */
function pilot(state: GameState, shipDef: ShipDef, cargo: Record<string, number>): void {
  state.fleet[state.shipId]!.defId = shipDef.id
  state.fleet[state.shipId]!.cargo = { ...cargo }
}

describe('V18 无人机流', () => {
  it('纯无人机战斗（无炮台）：装载放飞 → 开战不装弹 → 战斗推进分出胜负且胜率占优', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const carrier = ship('carrier', { droneBayM3: 40, cpu: 200 })
    const ctx = makeCtx([carrier])
    pilot(state, carrier, { 'drone-scout': 10 })
    state.wallet.isk = 50_000

    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const droneWeapons = spec.weapons.filter((w) => w.kind === 'fixed' && w.label === DRONE_SCOUT.name)
    expect(droneWeapons.length).toBeGreaterThanOrEqual(5) // 舱 40/1.5 → 满载可 ≥5 架
    expect(spec.weapons.some((w) => w.kind === 'gun')).toBe(false) // 无炮台
    expect(spec.weapons.some((w) => w.label === '基础舰炮')).toBe(true) // 兜底炮恒在

    const battle = startBattleFor(state, ctx, state.shipId, 'ano-dw', 0)!
    expect(battle.ammo.kin + battle.ammo.exp + battle.ammo.pla).toBe(0) // 无炮台不预载弹药
    state.gameMs = 9 * 60_000 + 1_000
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-dw')
    expect(battle.ended).not.toBeNull()
    const p = battleWinPreview(state, ctx, ctx.anomalies.get('ano-dw')!, state.shipId)
    expect(p).toBeGreaterThan(0.5) // 纯无人机流对弱敌应显著占优
  })

  it('甲板扩展：给 0 舱船外挂无人机舱（无装置时放不了）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx = makeCtx([])
    pilot(state, ship('sandcat', {}), { 'drone-scout': 10 }) // sandcat 无舱（helpers 默认 droneBay 0）
    expect(createPlayerSpec(state, ctx, state.shipId)!.weapons.filter((w) => w.label === DRONE_SCOUT.name)).toHaveLength(0)

    state.moduleBay['mod-drone-rack-1'] = 1
    expect(fitModule(state, 'mod-drone-rack-1', ctx).ok).toBe(true) // 高槽自动首空位
    const after = createPlayerSpec(state, ctx, state.shipId)!
    const drones = after.weapons.filter((w) => w.label === DRONE_SCOUT.name)
    expect(drones.length).toBeGreaterThanOrEqual(5) // +15 m³ → ≥5 架（1.5 m³/架）
    expect(unfitAt(state, 'high', 0)).toBe(true)
    const again = createPlayerSpec(state, ctx, state.shipId)!
    expect(again.weapons.filter((w) => w.label === DRONE_SCOUT.name)).toHaveLength(0)
  })

  it('战术导控：无人机单发伤害乘入（+25%）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    const carrier = ship('carrier2', { droneBayM3: 30, cpu: 300 })
    const ctx = makeCtx([carrier])
    pilot(state, carrier, { 'drone-assault': 2 })
    const plainShot = createPlayerSpec(state, ctx, state.shipId)!.weapons.find((w) => w.label === DRONE_ASSAULT.name)?.shotDmg
    expect(plainShot).toBe(6) // 无导控 = 无人机基数

    state.moduleBay['mod-drone-tac-2'] = 1
    expect(fitModule(state, 'mod-drone-tac-2', ctx).ok).toBe(true)
    const boostedShot = createPlayerSpec(state, ctx, state.shipId)!.weapons.find((w) => w.label === DRONE_ASSAULT.name)?.shotDmg
    expect(boostedShot).toBe(Math.round(6 * 1.25)) // 导控乘入
  })

  it('CPU 余量约束：装置占用 CPU 后放飞数受限（cpu 30 / 每架 4 → ≤7）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const tiny = ship('tinydock', { droneBayM3: 60, cpu: 30 })
    const ctx = makeCtx([tiny])
    pilot(state, tiny, { 'drone-scout': 20 })
    const n = createPlayerSpec(state, ctx, state.shipId)!.weapons.filter((w) => w.label === DRONE_SCOUT.name).length
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(7)
  })
})

describe('V18/V18.1 装配规则：复数安装（唯一已取消）/ 位对齐 / 多炮合并', () => {
  it('同类唯一取消（V18.1 拍板）：同系抗性件、容量件、推进器均可多装——防超模改由收敛机制负责（v181.test）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const wide = ship('fatcat', { cpu: 300, slots: { high: 1, mid: 6, low: 4 } })
    const ctxM = makeTestCtx({
      ships: [wide],
      modules: [
        moduleDef('mod-skin', 'shield', 0, { shieldResistAdd: { kinetic: 0.2 }, cpuUse: 5 }),
        moduleDef('mod-sexp', 'shield', 0, { shieldResistAdd: { explosive: 0.2 }, cpuUse: 5 }),
        moduleDef('mod-shp', 'shield', 0, { shieldHpBonus: 0.2, cpuUse: 5 }),
        moduleDef('mod-ahp', 'armor', 0, { armorHpBonus: 0.2, cpuUse: 5 }),
        moduleDef('mod-p1', 'propulsion', 0, { speedBonusPct: 0.15, cpuUse: 5 }),
        moduleDef('mod-p3', 'propulsion', 0, { speedBonusPct: 0.5, cpuUse: 15 }),
      ],
    })
    pilot(state, wide, {})
    repairDeprecatedModules(state, ctxM) // 对齐 1/6/4 位
    for (const id of ['mod-skin', 'mod-skin', 'mod-sexp', 'mod-shp', 'mod-ahp', 'mod-p1', 'mod-p3']) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(fitModule(state, 'mod-skin', ctxM).ok).toBe(true)
    expect(fitModule(state, 'mod-skin', ctxM).ok).toBe(true) // 同键第二件：合法（V18.1）
    expect(fitModule(state, 'mod-sexp', ctxM).ok).toBe(true) // 异系
    expect(fitModule(state, 'mod-shp', ctxM).ok).toBe(true) // 盾容件（不同键）
    expect(fitModule(state, 'mod-ahp', ctxM).ok).toBe(true) // 甲容件（低槽）
    expect(fitModule(state, 'mod-p1', ctxM).ok).toBe(true)
    expect(fitModule(state, 'mod-p3', ctxM).ok).toBe(true) // 第二件推进器：合法
  })

  it('位对齐：repair 把超长位尾件退回装备库、短位补空（幂等）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const tiny = ship('onebay', { cpu: 100, slots: { high: 1, mid: 1, low: 1 } })
    const ctx = makeTestCtx({
      ships: [tiny],
      modules: [RACK1, TAC2, moduleDef('mod-drone-tac-1', 'drone-tac', 0, { droneDmgBonus: 0.12, cpuUse: 10 })],
    })
    pilot(state, tiny, {})
    repairDeprecatedModules(state, ctx) // 先对齐 1/1/1（初始船默认 2/2/2 位长）
    // 人为制造长度异常：high 3 位（超 2）、mid 0 位（欠 1）
    state.fleet[state.shipId]!.fitted = {
      high: ['mod-drone-tac-1', 'mod-drone-tac-2', 'mod-drone-rack-1'],
      mid: [],
      low: [null],
    }
    state.moduleBay['mod-drone-tac-2'] = 0
    state.moduleBay['mod-drone-rack-1'] = 0
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[state.shipId]!.fitted.high).toHaveLength(1) // 截到 1
    expect(state.fleet[state.shipId]!.fitted.high[0]).toBe('mod-drone-tac-1') // 头部保留
    expect(state.moduleBay['mod-drone-rack-1']).toBe(1) // 尾部两件退库
    expect(state.moduleBay['mod-drone-tac-2']).toBe(1)
    expect(state.fleet[state.shipId]!.fitted.mid).toHaveLength(1) // 补空
    expect(state.fleet[state.shipId]!.fitted.mid[0]).toBeNull()
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[state.shipId]!.fitted.high).toHaveLength(1)
  })

  it('多炮合并：同 id 两门 → 单条目 ×N 齐射；异弹型炮各自单键', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    const gunboat = ship('gunboat', { cpu: 300, slots: { high: 3, mid: 1, low: 1 } })
    const kin = moduleDef('mod-tk', 'turret', 0, {
      damageType: 'kinetic',
      maxRangeM: 4600,
      minRangeM: 250,
      hitRate: 0.8,
      falloff: 0.3,
      reloadMs: 2200,
      dmgMult: 1.25,
      cpuUse: 10,
    })
    const exp = moduleDef('mod-te', 'turret', 0, {
      damageType: 'explosive',
      maxRangeM: 4600,
      minRangeM: 250,
      hitRate: 0.8,
      falloff: 0.3,
      reloadMs: 2200,
      dmgMult: 1.25,
      cpuUse: 10,
    })
    const ctx = makeTestCtx({ ships: [gunboat], modules: [kin, exp] })
    pilot(state, gunboat, {})
    repairDeprecatedModules(state, ctx) // 对齐 3 高槽
    state.moduleBay['mod-tk'] = 2
    state.moduleBay['mod-te'] = 1
    expect(fitModule(state, 'mod-tk', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-tk', ctx).ok).toBe(true)
    expect(fitModule(state, 'mod-te', ctx).ok).toBe(true)
    let spec = createPlayerSpec(state, ctx, state.shipId)!
    const guns = spec.weapons.filter((w) => w.kind === 'gun')
    expect(guns).toHaveLength(2) // 动能 ×2 合并一条 + 高爆一条
    const kinGun = guns.find((w) => w.shotsByType?.kinetic !== undefined)!
    expect(kinGun.label).toContain('×2')
    const doubled = kinGun.shotsByType!.kinetic!
    const expGun = guns.find((w) => w.shotsByType?.explosive !== undefined)!
    expect(expGun.shotsByType!.explosive).toBeGreaterThan(0)
    // 卸下一门动能炮 → 合并条拆开：单发值恰为 ×2 条的一半
    expect(unfitAt(state, 'high', 0)).toBe(true)
    spec = createPlayerSpec(state, ctx, state.shipId)!
    const solo = spec.weapons.filter((w) => w.kind === 'gun').find((w) => w.shotsByType?.kinetic !== undefined)!
    expect(solo.label).not.toContain('×2')
    expect(solo.shotsByType!.kinetic).toBe(doubled / 2)
  })
})

export {}
