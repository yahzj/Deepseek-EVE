/**
 * 无消耗自愈 + 结构抗性（2026-09-10 船长：C 族异形件）：
 * - C1 生体甲壳板：装甲层三系抗 +10%（缺口复合）+ 每 5 秒**无消耗**修甲 6 点
 * - C2 生体损管腔：**结构层**三系抗 +25%（模块侧新入口 hullResistAdd）+ 每 5 秒无消耗修结构 4 点
 * - C3 酸液喷吐器：必中能量件，射速慢单发重（DPS 与攻坚激光炮相当）
 * - 无消耗修复量在**同型多件间按 EVE 曲线收敛**（权重 100%/87%/57%/28%/11%），不吃组件也永不停机。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec, preloadRepairFor, refundRepairKits } from '../src/combat'
import { stackWeight } from '../src/equipment'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：中 3 / 低 2，够装 C1+C2

function makeState(high: string[] = [], mid: string[] = [], low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [...mid, null, null, null].slice(0, 3) as (string | null)[],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

describe('C 族异形件：无消耗自愈 + 结构抗性（2026-09-10 船长）', () => {
  it('C1 生体甲壳板：装甲层三系抗各 +10%（缺口复合），结构层不受影响', () => {
    const plain = createPlayerSpec(makeState(), ctx, 'sh-mako')!
    const withPlate = createPlayerSpec(makeState([], [], ['mod-lair-armor-c']), ctx, 'sh-mako')!
    // 装甲层三系各 +10% 缺口削减：new = 1 − (1−base) × 0.9
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const base = plain.resists.armor?.[t] ?? 0
      const after = withPlate.resists.armor?.[t] ?? 0
      expect(after).toBeCloseTo(1 - (1 - base) * 0.9, 6)
    }
    // 盾/结构不被该件影响
    expect(withPlate.resists.hull).toEqual(plain.resists.hull)
  })

  it('C2 生体损管腔：结构层三系抗各 +25%（模块新增 hullResistAdd 入口）', () => {
    const plain = createPlayerSpec(makeState(), ctx, 'sh-mako')!
    const withDc = createPlayerSpec(makeState([], ['mod-lair-dc-c']), ctx, 'sh-mako')!
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const base = plain.resists.hull?.[t] ?? 0
      const after = withDc.resists.hull?.[t] ?? 0
      expect(after).toBeGreaterThanOrEqual(base)
      if (base === 0) expect(after).toBeCloseTo(0.25, 6)
    }
  })

  it('无消耗自愈：装 C1 即获每跳修甲 6 点、不预载组件、永不停机', () => {
    const state = makeState([], [], ['mod-lair-armor-c'])
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    expect(repair.units).toHaveLength(1)
    const u = repair.units[0]!
    expect(u.free).toBe(true)
    expect(u.armorPerPulse).toBe(6)
    expect(u.hullPerPulse).toBe(0)
    expect(u.stopped).toBe(false)
    expect(Object.keys(repair.kits)).toHaveLength(0) // 不预载任何组件
    refundRepairKits(state, repair) // 幂等：无组件可退
  })

  it('同族多件按 EVE 曲线收敛（**逐台折减、按位次**）：3 件 C1 → 6 / 5 / 3 点/跳（而非线性 18）', () => {
    const state = makeState([], [], ['mod-lair-armor-c', 'mod-lair-armor-c'])
    state.fleet[state.shipId]!.fitted.low[1] = 'mod-lair-armor-c'
    // 低槽只有 2 位：再借用中槽一位（同件可装任意槽位由 rack 校验，测试直接写数组）
    state.fleet[state.shipId]!.fitted.mid[0] = 'mod-lair-armor-c'
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    const per = repair.units.map((x) => x.armorPerPulse)
    expect(per).toHaveLength(3)
    /**
     * ⚠ **2026-09-21**：折减改为**按位次逐台取**（同型号三台的权重是 1 / 0.869 / 0.571）——
     * 第一版我按 `modelId` 建映射 ⇒ 三台都拿到第 3 件的权重（全 3 点/跳）。用例的下标断言正是守这条。
     */
    expect(per[0]).toBe(Math.round(6 * stackWeight(1))) // 6
    expect(per[1]).toBe(Math.round(6 * stackWeight(2))) // 5
    expect(per[2]).toBe(Math.round(6 * stackWeight(3))) // 3
    const sum = per.reduce((s, n) => s + n, 0)
    expect(sum).toBeLessThan(18) // 收敛后低于线性
    // **逐台各有自己的计时器**（2026-09-21 船长令：不同型号独立回转；同型号也一样逐台）
    for (const u of repair.units) expect(u.nextPulseAtMs).toBeUndefined() // 预载阶段还没排首跳
  })

  it('消耗件与自愈件并存：耗组件件**按需取用**（不再预载）、自愈件不占组件；**折减按全族位次**（MK1 第 1 / 甲壳板 第 2）', () => {
    const state = makeState([], ['mod-hullrep-1'], ['mod-lair-armor-c'])
    state.warehouse.items['repairkit-mil'] = 50
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    expect(repair.units).toHaveLength(2)
    const free = repair.units.find((u) => u.free)!
    const kit = repair.units.find((u) => !u.free)!
    /**
     * ⚠ **2026-09-21 起维修全族同池**（船长「包括船体维修装置的不同型号也一样的规则」）：
     * 装配序 = MK1 在前、甲壳板在后 ⇒ MK1 满值、甲壳板按第 2 件折到 **5 点**（改前：按件 id 计数、
     * 各拿满权 ⇒ 甲壳板是 6）。这一条同时钉住"跨型号也折减"。
     */
    expect(free.armorPerPulse).toBe(Math.round(6 * stackWeight(2)))
    expect(kit.armorPerPulse).toBe(Math.round(10 * stackWeight(1)))
    expect(kit.kitId).toBe('repairkit-mil')
    /**
     * **不再预载**（**2026-09-23 船长令**：弹药与修理组件改"按需取用"，来源由开关二选一）：
     * 账本 `kits` 为空、仓库一枚不动；自愈件照旧不占组件（它本就不带 `kitId`）。
     */
    expect(Object.keys(repair.kits)).toHaveLength(0)
    expect(state.warehouse.items['repairkit-mil']).toBe(50)
  })

  /**
   * **2026-09-17 船长**：「**生体甲壳板的维修量，我希望不吃装甲容量的加成**」→ 当日追加
   * 「**损管腔也一同修改**」——09-16 那条「维修量统一吃层容量加成」的**两件例外**
   * （数据字段 `repairIgnoresCapacityAmp`；两件都是**无消耗自愈**）。
   * 本用例把三件事一起钉住：① 甲壳板平值 6（哪怕甲容 +20%）；② 损管腔平值 4（哪怕结构 +75%）；
   * ③ **耗组件装置照旧吃**加成（对照，防误伤——09-16 那条对它们仍然有效）。
   */
  it('**报障修复（船长）**：生体甲壳板/损管腔不吃层容量加成；耗组件装置照旧吃（**折减按全族位次**）', () => {
    const state = makeState([], ['mod-lair-dc-c', 'mod-hullrep-1'], ['mod-lair-armor-c', 'mod-armor-plate-1'])
    // 甲容 +20%（装甲增厚板 MK1）· 结构 +75%（几丁质骨架层，借中槽一位放，本用例只数每跳值）
    state.fleet[state.shipId]!.fitted.mid[2] = 'mod-wh-c-frame'
    state.warehouse.items['repairkit-mil'] = 50
    const repair = preloadRepairFor(state, ctx, state.shipId, ctx.balance.battle.maxBattleMs)!
    const shell = repair.units.find((u) => u.moduleId === 'mod-lair-armor-c')!
    const dc = repair.units.find((u) => u.moduleId === 'mod-lair-dc-c')!
    const kit = repair.units.find((u) => u.moduleId === 'mod-hullrep-1')!
    /**
     * ⚠ **2026-09-21 折减按位次**：本例装配序 = 损管腔(1) / MK1(2) / 甲壳板(3)
     * ⇒ 甲壳板拿第 3 件权重。**"不吃层容量加成"这条判据只能看"没被 amp 放大"**：
     * 平值口径下甲壳板 = `6 × w₃`（≈3.42 → 3）；若误吃 ×1.2 会变成 4 —— 故断言写成"等于按权重算的值"。
     */
    expect(shell.free).toBe(true)
    expect(shell.armorPerPulse, '甲壳板的自愈量不该吃装甲容量加成').toBe(Math.round(6 * stackWeight(3)))
    expect(shell.hullPerPulse).toBe(0)
    // ② 损管腔：平值（第 1 件 ⇒ 满值 4；若误吃 ×1.75 会变成 7）
    expect(dc.free).toBe(true)
    expect(dc.hullPerPulse, '损管腔的自愈量不该吃结构容量加成').toBe(Math.round(4 * stackWeight(1)))
    expect(dc.armorPerPulse).toBe(0)
    // ③ 耗组件装置：两级都照旧吃加成（第 2 件 ⇒ 甲 10×0.869×1.2 = 10 · 结构 10×0.869×1.75 = 15）
    // ⚠ 非自愈件的 `free` 字段是**缺省**（不是 false）⇒ 断言要写 `?? false`，或直接断言它挂了组件
    expect(kit.kitId, '耗组件装置应当预载组件（对照）').toBe('repairkit-mil')
    expect(kit.free ?? false).toBe(false)
    expect(kit.armorPerPulse).toBe(Math.round(10 * stackWeight(2) * 1.2))
    expect(kit.hullPerPulse).toBe(Math.round(10 * stackWeight(2) * 1.75))
  })

  it('C3 酸液喷吐器：必中能量件、射速更慢单发更重、总输出与攻坚激光炮相当', () => {
    const state = makeState(['mod-lair-laser-c'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'laser')!
    expect(w.kind).toBe('beam') // 必中
    const c3 = ctx.modules.get('mod-lair-laser-c')!
    const mk3 = ctx.modules.get('mod-laser-3')!
    expect(c3.dmgMult!).toBeGreaterThan(mk3.dmgMult!) // 单发更重
    expect(c3.reloadMs!).toBeLessThan(mk3.reloadMs!) // 射速比"原型"更快、但比裸件基线慢
    // ⟪2026-09-22 船长令⟫ 酸液周期 3800 → 2800ms ⇒ 总输出由「相当」改为 **约 1.5×**（原窗口 ±30% 随之放宽）
    const dps = (m: { dmgMult?: number; reloadMs?: number }): number => (m.dmgMult ?? 0) / (m.reloadMs ?? 1)
    const ratio = dps(c3) / dps(mk3)
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(1.7)
    // 代价：射程只有攻坚激光炮的三成以下
    expect(c3.maxRangeM!).toBeLessThan(mk3.maxRangeM! / 3)
    expect(w.maxRangeM).toBe(2800)
  })
})
