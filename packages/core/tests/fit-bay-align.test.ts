/**
 * 位数组与**船型布局**对齐（2026-09-12 玩家报障回归）。
 *
 * 玩家原话：「装了 1 个 CPU 后，装其他装备。显示『该 Y 槽位不可用（第 X 位）』。」
 *
 * 根因（与协处理器本身无关，是同一批引入的回归）：`emptyShipState → emptyFitted()` 造出的
 * 位数组恒为 **1/1/1**、与船型布局无关；只有 `fitModule`（装时按布局补齐）与载入修复链
 * `repairDeprecatedModules` 会把它拉长。2026-09-11 协处理器批次把装配页装入从
 * `fitModuleTo`（会补齐）改成原子换装 `swapModuleTo`，而 `swapModuleAt` **不补齐**，
 * 界面却按 `Math.max(船型布局, 数组长度)` 画出全部槽位格
 * ⇒ 新造/新买的船（以及"没读到存档、修复链没跑"的新档）**每类只有第 1 位能装**。
 *
 * 本文件锁住三件事：
 * ① 1/1/1 位数组下，按位号装入布局内任何一位都成功，并把数组补齐到布局长度；
 * ② 真越界（超出船型布局）仍被拒，且文案不变；
 * ③ 补齐与载入修复链的"位对齐"同口径、幂等、不丢件（= 玩家"重开一次游戏"的救急办法）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  countModule,
  createInitialState,
  fitModule,
  repairDeprecatedModules,
  swapModuleAt,
} from '../src/index'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 试验船：布局 高5/中3/低4（同牛鲨级形状）——远大于 `emptyFitted()` 的 1/1/1 */
const SHIP = 'sh-layout'
const ARMOR = 'mod-armor-x' // 低槽
const CPU = 'mod-cpu-x' // 低槽、自身不占 CPU、+45 预算
const GUN = 'mod-gun-x' // 高槽

const GUN_FIELDS = {
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

function world(): { state: GameState; ctx: SimContext; uid: string } {
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship(SHIP, { cpu: 200, slots: { high: 5, mid: 3, low: 4 } })],
    modules: [
      moduleDef(ARMOR, 'armor', 0, { rack: 'low', armorHpBonus: 0.1, cpuUse: 4 }),
      moduleDef(CPU, 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 45 }),
      moduleDef(GUN, 'turret', 0, { ...GUN_FIELDS, cpuUse: 10 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const uid = addShipToFleet(state, SHIP) // 造船完成/市场买船同一条路径
  state.shipId = uid
  addModule(state, ARMOR, 8)
  addModule(state, CPU, 2)
  addModule(state, GUN, 8)
  return { state, ctx, uid }
}

const lens = (state: GameState, uid: string): [number, number, number] => {
  const f = state.fleet[uid]!.fitted
  return [f.high.length, f.mid.length, f.low.length]
}

describe('位数组按船型布局补齐（装配页按位号装入）', () => {
  it('新造/新买的船：1/1/1 位数组下，布局内的每一位都装得上，并按布局补齐', () => {
    const { state, ctx, uid } = world()
    // 入手时（`emptyShipState`）与船型布局无关，恒为 1/1/1 —— 这正是报障的起点
    expect(lens(state, uid)).toEqual([1, 1, 1])

    // 玩家实况：先装协处理器（第 1 位能装），再装别的件（第 2 位起原先被拒）
    expect(swapModuleAt(state, CPU, ctx, { rack: 'low', index: 0, shipId: uid }).ok).toBe(true)
    for (const index of [1, 2, 3]) {
      const r = swapModuleAt(state, ARMOR, ctx, { rack: 'low', index, shipId: uid })
      expect(r.ok, `低槽第 ${index + 1} 位应可装：${r.error ?? ''}`).toBe(true)
    }
    // 高槽同理（末位也要能装）
    for (const index of [0, 4]) {
      const r = swapModuleAt(state, GUN, ctx, { rack: 'high', index, shipId: uid })
      expect(r.ok, `高槽第 ${index + 1} 位应可装：${r.error ?? ''}`).toBe(true)
    }
    // 碰过的两类（低槽/高槽）已补齐到船型布局；没碰过的中槽仍是 1（懒补齐，与 fitModule 同口径）
    expect(lens(state, uid)).toEqual([5, 1, 4])
    expect(state.fleet[uid]!.fitted.low.filter((x) => x !== null)).toHaveLength(4)
    expect(countModule(state, ARMOR)).toBe(5)
  })

  it('真越界仍被拒（文案不变），且拒绝时不落库、不丢件', () => {
    const { state, ctx, uid } = world()
    const bad = swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: 4, shipId: uid }) // 低槽只有 4 位
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('该低槽位不可用（第 5 位）')
    expect(state.fleet[uid]!.fitted.low).toHaveLength(4) // 补齐到布局，不会无限长
    expect(countModule(state, ARMOR)).toBe(8) // 装备库未扣
    // 负数位号同样拒绝（界面不会给，命令层自守）
    expect(swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: -1, shipId: uid }).ok).toBe(false)
    // 同一位重复装同一件 → 拒绝（原口径不变）
    expect(swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: 0, shipId: uid }).ok).toBe(true)
    const again = swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: 0, shipId: uid })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('已装在此位')
  })

  it('fitModule 与 swapModuleAt 同口径：任意一条命令先补齐到布局，另一条立刻可用', () => {
    const { state, ctx, uid } = world()
    // 只经 fitModule（不带位号）装一件 → 只把"它自己那一类"补齐
    expect(fitModule(state, ARMOR, ctx, { shipId: uid }).ok).toBe(true)
    expect(lens(state, uid)).toEqual([1, 1, 4])
    // 高槽还没人碰过（长度 1），按位号装末位要能自己补齐
    expect(swapModuleAt(state, GUN, ctx, { rack: 'high', index: 4, shipId: uid }).ok).toBe(true)
    expect(lens(state, uid)).toEqual([5, 1, 4])
  })

  it('与载入修复链同口径、幂等、不丢件（= 玩家"重开一次游戏"救急）', () => {
    const { state, ctx, uid } = world()
    expect(swapModuleAt(state, CPU, ctx, { rack: 'low', index: 0, shipId: uid }).ok).toBe(true)
    expect(swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: 3, shipId: uid }).ok).toBe(true)
    const before = { armor: countModule(state, ARMOR), cpu: countModule(state, CPU) }

    repairDeprecatedModules(state, ctx) // 载入修复链：位数组与船型布局对齐
    expect(lens(state, uid)).toEqual([5, 3, 4])
    // 已装件原位保留（修复只补空位/裁超长，不动布局内的件）
    expect(state.fleet[uid]!.fitted.low[0]).toBe(CPU)
    expect(state.fleet[uid]!.fitted.low[3]).toBe(ARMOR)
    expect({ armor: countModule(state, ARMOR), cpu: countModule(state, CPU) }).toEqual(before)

    repairDeprecatedModules(state, ctx) // 幂等
    expect(lens(state, uid)).toEqual([5, 3, 4])

    // 经修复链对齐后，按位号装入照旧可用（玩家救急后的正常体验）
    expect(swapModuleAt(state, ARMOR, ctx, { rack: 'low', index: 2, shipId: uid }).ok).toBe(true)
  })

  it('载入修复链：停在中/低槽的作业装备（采集器 / 打捞器）归位高槽；高槽满则腾位退库；在洞编队跳过', () => {
    // 2026-09-14 船长「改回高槽」：2026-09-13～09-14 低槽口径那两天存下的档需要归位
    const RIG = 'mod-rig-x'
    const MINER = 'mod-miner-x'
    const ctxWork = makeTestCtx({
      quietEvents: true,
      ships: [ship(SHIP, { cpu: 200, slots: { high: 2, mid: 3, low: 4 } })],
      modules: [
        moduleDef(RIG, 'salvager', 0, { cpuUse: 2, salvageCycleMs: 10_000 }),
        moduleDef(MINER, 'miner', 0, { cpuUse: 5 }),
        moduleDef(GUN, 'turret', 0, { ...GUN_FIELDS, cpuUse: 10 }),
      ],
    })
    // ① 低槽口径存下的档：两件作业装备停在低槽 ⇒ 高槽有位就搬回去
    const st = createInitialState({ nowWallMs: 0, seed: 12 })
    const u = addShipToFleet(st, SHIP)
    st.fleet[u]!.fitted = { high: [null, null], mid: [null, null, null], low: [MINER, RIG, null, null] }
    repairDeprecatedModules(st, ctxWork)
    expect(st.fleet[u]!.fitted.high).toEqual([MINER, RIG])
    expect(st.fleet[u]!.fitted.low.filter((x) => x !== null)).toHaveLength(0)
    expect(countModule(st, MINER) + countModule(st, RIG)).toBe(0) // 只是换位，不是退回装备库
    // ② 幂等：再跑一次不再动
    repairDeprecatedModules(st, ctxWork)
    expect(st.fleet[u]!.fitted.high).toEqual([MINER, RIG])
    // ③ 高槽满 ⇒ 把**最后装上的那件**退回装备库腾位（船长 2026-09-14：「自动归位，被挤掉的炮退回装备库」）
    const st2 = createInitialState({ nowWallMs: 0, seed: 13 })
    const u2 = addShipToFleet(st2, SHIP)
    st2.fleet[u2]!.fitted = { high: [GUN, GUN], mid: [null, null, null], low: [RIG, null, null, null] }
    repairDeprecatedModules(st2, ctxWork)
    expect(st2.fleet[u2]!.fitted.high).toEqual([GUN, RIG]) // 末尾那件腾位给作业装备
    expect(st2.fleet[u2]!.fitted.low.filter((x) => x !== null)).toHaveLength(0)
    expect(countModule(st2, GUN)).toBe(1) // 腾出的炮退回装备库（件不丢、可装回）
    // ④ 在洞编队跳过：进洞后改装是锁的，归位也不该在途改战力（出洞后再载入即归位）
    const st3 = createInitialState({ nowWallMs: 0, seed: 14 })
    const u3 = addShipToFleet(st3, SHIP)
    st3.fleet[u3]!.fitted = { high: [GUN, null], mid: [null, null, null], low: [RIG, null, null, null] }
    st3.wormhole = { run: { fleet: [u3] } as never, lastFleetLost: 0 }
    repairDeprecatedModules(st3, ctxWork)
    expect(st3.fleet[u3]!.fitted.low[0]).toBe(RIG) // 在途不动
    expect(st3.fleet[u3]!.fitted.high[0]).toBe(GUN)
    st3.wormhole = { run: null, lastFleetLost: 0 } // 出洞后再载入 ⇒ 归位
    repairDeprecatedModules(st3, ctxWork)
    expect(st3.fleet[u3]!.fitted.high).toEqual([GUN, RIG])
    expect(st3.fleet[u3]!.fitted.low.filter((x) => x !== null)).toHaveLength(0)
  })
})
