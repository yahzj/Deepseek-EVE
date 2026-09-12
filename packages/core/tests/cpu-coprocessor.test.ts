/**
 * 协处理器（2026-09-11 船长：「新增低槽配件，效果是增加舰船CPU」）与 **CPU 双向校验**。
 *
 * 船长四条裁定：
 * ① **自身不占用**（`cpuUse = 0`）、只加 `cpuBonus`（MK1/MK2/MK3 = **+25 / +35 / +45**；船长同日上调，
 *    原 +10/+15/+20 作废）；
 * ② 新开一族「协处理器」（低槽）；
 * ③ 渠道：MK1 稀有 2、MK2 稀有 3、MK3 稀有 4 走奇货且**无蓝图**（数据侧由 content:check 守）；
 * ④ 防套利（船长点名「玩家是否会通过装卸这个配件'偷' CPU 容量」）：**双向校验**——
 *    预算随件走，卸下/换装都按"最终状态"预演，超载则拒绝；无人机放飞共用同一份预算。
 *
 * 测试世界刻意做成"刚好压线"：船 100 CPU、件 40 / 60 / 45，扩容 MK3（+45）后正好 145 ⇒ 45 的件装得下；
 * 于是「装扩容 → 吃满预算 → 卸不掉」这条链路可以精确断言。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, ItemDef, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  addWare,
  adjustDroneLoad,
  cpuBudgetOf,
  cpuOverloadText,
  createInitialState,
  fitModule,
  fittedCpuUsed,
  swapModuleAt,
  unfitAt,
} from '../src/index'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 测试无人机（每架 10 CPU / 10 m³；放飞占用与装配共用同一份预算） */
const DRONE: ItemDef = {
  id: 'drone-x',
  name: '试验无人机',
  kind: 'drone',
  unitM3: 10,
  baseSellPriceIsk: 100,
  description: '测试用无人机',
  damageType: 'kinetic',
  dmg: 1,
  cpuUse: 10,
  maxRangeM: 2500,
  hitRate: 0.75,
  falloff: 1,
  droneClass: 'combat',
}

const GUN = {
  rack: 'high' as const,
  damageType: 'kinetic' as const,
  maxRangeM: 3000,
  minRangeM: 0,
  hitRate: 1,
  falloff: 1,
  reloadMs: 1000,
  dmgMult: 2,
  ammoPerEngagement: 10,
}

/** 船 100 CPU（槽位给足，不参与判定）+ 三档协处理器（+25/+35/+45）+ 40 / 60 / 45 CPU 的三个件 */
function world(): { state: GameState; ctx: SimContext; uid: string } {
  const ctx = makeTestCtx({
    quietEvents: true,
    items: [DRONE],
    ships: [ship('sh-budget', { cpu: 100, droneBayM3: 100, slots: { high: 3, mid: 1, low: 3 } })],
    modules: [
      moduleDef('mod-cpu-1', 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 25 }),
      moduleDef('mod-cpu-2', 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 35 }),
      moduleDef('mod-cpu-3', 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 45 }),
      moduleDef('eat-40', 'armor', 0, { rack: 'low', armorHpBonus: 0.2, cpuUse: 40 }),
      moduleDef('eat-45', 'armor', 0, { rack: 'low', armorHpBonus: 0.1, cpuUse: 45 }),
      moduleDef('gun-60', 'turret', 0, { ...GUN, cpuUse: 60 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const uid = addShipToFleet(state, 'sh-budget')
  state.shipId = uid
  return { state, ctx, uid }
}

/** 40 + 60 = 100（正好压满船体预算） */
function fillToBudget(state: GameState, ctx: SimContext, uid: string): void {
  addModule(state, 'eat-40')
  addModule(state, 'gun-60')
  expect(fitModule(state, 'eat-40', ctx, { shipId: uid }).ok).toBe(true)
  expect(fitModule(state, 'gun-60', ctx, { shipId: uid }).ok).toBe(true)
}

/** 某件当前装在哪个位（不依赖装配顺序，避免断言指错位） */
function bayOf(state: GameState, uid: string, moduleId: string): { rack: 'high' | 'mid' | 'low'; index: number } {
  for (const rack of ['high', 'mid', 'low'] as const) {
    const index = state.fleet[uid]!.fitted[rack].indexOf(moduleId)
    if (index >= 0) return { rack, index }
  }
  throw new Error(`${moduleId} 未装在舰上`)
}

describe('协处理器（低槽 CPU 预算扩容件）', () => {
  it('自身不占 CPU、只加预算：MK1/MK2/MK3 = +25/+35/+45，装配占用恒为 0', () => {
    const { state, ctx, uid } = world()
    expect(cpuBudgetOf(state, ctx, uid)).toBe(100)
    addModule(state, 'mod-cpu-1')
    expect(fitModule(state, 'mod-cpu-1', ctx, { shipId: uid }).ok).toBe(true)
    expect(fittedCpuUsed(state.fleet[uid]!.fitted, ctx)).toBe(0) // 本件不占
    expect(cpuBudgetOf(state, ctx, uid)).toBe(125)
    // 原子换装升档：MK1 → MK3（预算 125 → 145），占用仍 0
    addModule(state, 'mod-cpu-3')
    expect(swapModuleAt(state, 'mod-cpu-3', ctx, { rack: 'low', index: 0, shipId: uid }).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(145)
    expect(fittedCpuUsed(state.fleet[uid]!.fitted, ctx)).toBe(0)
    // 三档叠加也成立（多件全额叠加）：MK2 再装一件 → 145 + 35 = 180
    addModule(state, 'mod-cpu-2')
    expect(fitModule(state, 'mod-cpu-2', ctx, { shipId: uid }).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(180)
  })

  it('预算真能用：100 CPU 只装得下 40+60，装协处理器 MK3 后 45 的件也装得下', () => {
    const { state, ctx, uid } = world()
    fillToBudget(state, ctx, uid)
    addModule(state, 'eat-45')
    const denied = fitModule(state, 'eat-45', ctx, { shipId: uid }) // 100 + 45 > 100
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('协处理器') // 拒绝文案点名扩容这条路
    addModule(state, 'mod-cpu-3')
    expect(fitModule(state, 'mod-cpu-3', ctx, { shipId: uid }).ok).toBe(true) // 预算 145
    expect(fitModule(state, 'eat-45', ctx, { shipId: uid }).ok).toBe(true) // 145 = 145 正好
    expect(fittedCpuUsed(state.fleet[uid]!.fitted, ctx)).toBe(145)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(145)
  })

  it('防套利（船长点名）：扩容被吃满后**卸不掉协处理器**，腾出别的件才卸得掉', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mod-cpu-3')
    expect(fitModule(state, 'mod-cpu-3', ctx, { shipId: uid }).ok).toBe(true) // 预算 145
    fillToBudget(state, ctx, uid) // 占用 100
    addModule(state, 'eat-45')
    expect(fitModule(state, 'eat-45', ctx, { shipId: uid }).ok).toBe(true) // 占用 145 = 预算
    // 预演：卸下协处理器 ⇒ 预算回 100 < 占用 145 ⇒ 拒绝，并给出可读原因
    const cpuBay = bayOf(state, uid, 'mod-cpu-3')
    expect(cpuOverloadText(state, ctx, uid, { remove: cpuBay })).toContain('CPU 超载')
    expect(unfitAt(state, cpuBay.rack, cpuBay.index, uid, ctx)).toBe(false)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(145) // 拒绝后状态没变
    // 先卸 45 的件（占用回到 100 = 船体预算）⇒ 再卸协处理器（预算 100 = 占用 100）通过
    const smallBay = bayOf(state, uid, 'eat-45')
    expect(unfitAt(state, smallBay.rack, smallBay.index, uid, ctx)).toBe(true)
    expect(unfitAt(state, cpuBay.rack, cpuBay.index, uid, ctx)).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(100)
    expect(fittedCpuUsed(state.fleet[uid]!.fitted, ctx)).toBe(100)
  })

  it('无人机放飞共用同一份预算：扩容后可多放，且超载时连协处理器也卸不掉', () => {
    const { state, ctx, uid } = world()
    fillToBudget(state, ctx, uid) // 占用 100 / 预算 100
    addWare(state, 'drone-x', 5)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 1, uid).ok).toBe(false) // 余 0
    addModule(state, 'mod-cpu-3')
    expect(fitModule(state, 'mod-cpu-3', ctx, { shipId: uid }).ok).toBe(true) // 预算 145
    expect(adjustDroneLoad(state, ctx, 'drone-x', 4, uid).ok).toBe(true) // 100 + 40 = 140 ≤ 145
    expect(adjustDroneLoad(state, ctx, 'drone-x', 1, uid).ok).toBe(false) // 第 5 架超预算（150 > 145）
    // 无人机占用计入 ⇒ 此刻卸协处理器会让预算回 100 < 占用 140 ⇒ 拒绝
    const cpuBay = bayOf(state, uid, 'mod-cpu-3')
    expect(unfitAt(state, cpuBay.rack, cpuBay.index, uid, ctx)).toBe(false)
    expect(adjustDroneLoad(state, ctx, 'drone-x', -4, uid).ok).toBe(true)
    expect(unfitAt(state, cpuBay.rack, cpuBay.index, uid, ctx)).toBe(true) // 腾出后卸得掉
  })

  it('换装按**最终状态**一次预演：会超载的换装被拒，合法换装不被中间态卡住', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mod-cpu-3')
    expect(fitModule(state, 'mod-cpu-3', ctx, { shipId: uid }).ok).toBe(true) // 预算 145
    fillToBudget(state, ctx, uid) // 占用 100
    addModule(state, 'eat-45')
    expect(fitModule(state, 'eat-45', ctx, { shipId: uid }).ok).toBe(true) // 占用 145 = 预算
    // 降档换装 MK3 → MK1：最终预算 125 < 占用 145 ⇒ 拒绝（原子预演按最终态判，不留中间态漏洞）
    addModule(state, 'mod-cpu-1')
    const cpuBay = bayOf(state, uid, 'mod-cpu-3')
    const bad = swapModuleAt(state, 'mod-cpu-1', ctx, { ...cpuBay, shipId: uid })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('CPU 超载')
    expect(cpuBudgetOf(state, ctx, uid)).toBe(145) // 被拒后原装配未动
    // 腾出 45 的件后（占用 100）再换 MK1（125 ≥ 100）⇒ 通过
    const smallBay = bayOf(state, uid, 'eat-45')
    expect(unfitAt(state, smallBay.rack, smallBay.index, uid, ctx)).toBe(true)
    expect(swapModuleAt(state, 'mod-cpu-1', ctx, { ...cpuBay, shipId: uid }).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(125)
    // 同档空位装配（旧件为 null）也走同一条命令：结果是"装入"
    addModule(state, 'mod-cpu-2')
    expect(swapModuleAt(state, 'mod-cpu-2', ctx, { rack: 'low', index: 1, shipId: uid }).ok).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(160)
  })

  it('无协处理器时行为与旧口径一致（回归）：只加预算、不加别的，卸下没人拦', () => {
    const { state, ctx, uid } = world()
    expect(cpuBudgetOf(state, ctx, uid)).toBe(100)
    fillToBudget(state, ctx, uid)
    // 旧档/无扩容件：卸任何一个件都不受"扩容收回"影响（不超载就放行）
    expect(cpuOverloadText(state, ctx, uid, { remove: { rack: 'low', index: 0 } })).toBeNull()
    expect(unfitAt(state, 'low', 0, uid, ctx)).toBe(true)
    expect(cpuBudgetOf(state, ctx, uid)).toBe(100)
    expect(fittedCpuUsed(state.fleet[uid]!.fitted, ctx)).toBe(60)
  })
})
