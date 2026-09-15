/**
 * 跃迁计算机（2026-09-14 船长新增：低槽支援件 MK2 +20% / MK3 +35%，多件叠加惩罚，有蓝图）。
 *
 * 口径（设计稿 `docs/design/warp-computer-20260914.md`）：
 * - 效果 = **星系际航行**的有效跃迁速度 ×(1 + 加成)——生效处是 `travel.warpSpeedAus`（唯一入口：
 *   采矿往返 / 悬赏·远征 / 长途运输 / 扫描返航 / 快递 / AI 副船，**逐船**）；
 * - **不碰战斗机动**（那是 `speedBonusPct` 矢量推进器与推进器周期的地盘）；
 * - **多件走 EVE 曲线**（`curveMult`，与"命中/速度"同一条 ⇒ 多装递减）：
 *   MK2 1/2/3/4 件 ≈ ×1.20 / ×1.41 / ×1.57 / ×1.70；MK3 ≈ ×1.35 / ×1.76 / ×2.11 / ×2.32；
 * - **12 AU/s 上限已删**（船长「去掉上限」），下限 0.5 保留；与航行技能族**乘算**。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import { addShipToFleet, createInitialState, curveMult, repairDeprecatedModules, stackingOf, travelMinutesEff } from '../src/index'
import { curveMult as curveMultFromEquipment } from '../src/equipment'
import { travelLegMs, travelTimeFactor, warpBonusMult, warpSpeedAus } from '../src/travel'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 测试世界：一条 3.5 AU/s 的船（4 个低槽）+ 两条对照船（快 7.4 / 慢 2.8）+ 跃迁计算机两档 */
function world(): { ctx: SimContext; state: GameState } {
  const ctx = makeTestCtx({
    ships: [
      ship('warpy', { warpSpeedAus: 3.5, slots: { high: 1, mid: 1, low: 4 } }),
      ship('fasty', { warpSpeedAus: 7.4, slots: { high: 1, mid: 1, low: 4 } }),
      ship('slowpoke', { warpSpeedAus: 2.8, slots: { high: 1, mid: 1, low: 4 } }),
    ],
    modules: [
      // 数值与 data/modules.ts 逐字一致（MK2 +20% / MK3 +35%，低槽支援件）
      moduleDef('mod-warpcomp-2', 'support', 0, { rack: 'low', warpSpeedBonusPct: 0.2, cpuUse: 15 }),
      moduleDef('mod-warpcomp-3', 'support', 0, { rack: 'low', warpSpeedBonusPct: 0.35, cpuUse: 40 }),
      // 对照件：装它不产生跃迁加成（保证"零变化"那条不是靠"没装配"蒙过去的）
      moduleDef('mod-armor-plate-0', 'armor', 0, { armorHpBonus: 0.2, cpuUse: 4 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  for (const id of ['warpy', 'fasty', 'slowpoke']) addShipToFleet(state, id)
  state.shipId = 'warpy'
  return { ctx, state }
}

/** 给某条船装若干低槽件 */
function fitLow(state: GameState, ctx: SimContext, uid: string, mods: string[]): void {
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [...mods] }
  repairDeprecatedModules(state, ctx)
}

describe('跃迁计算机（2026-09-14 船长新增件；设计稿 docs/design/warp-computer-20260914.md）', () => {
  it('不装件 / 装无关件：跃迁速度与航行耗时**逐字不变**（零变化守卫）', () => {
    const { ctx, state } = world()
    const baseAus = warpSpeedAus(state, ctx)
    const baseLeg = travelLegMs(state, ctx, 6)
    const baseFactor = travelTimeFactor(state, ctx)
    expect(baseAus).toBe(3.5)
    expect(warpBonusMult(state, ctx)).toBe(1)
    fitLow(state, ctx, 'warpy', ['mod-armor-plate-0', 'mod-armor-plate-0'])
    expect(warpBonusMult(state, ctx), '无关件不该给跃迁加成').toBe(1)
    expect(warpSpeedAus(state, ctx)).toBe(baseAus)
    expect(travelTimeFactor(state, ctx)).toBe(baseFactor)
    expect(travelLegMs(state, ctx, 6)).toBe(baseLeg)
    expect(travelMinutesEff(state, ctx, 6)).toBe(Math.round(6 * (3 / 3.5)))
  })

  it('单件：MK2 ×1.20、MK3 ×1.35（跃迁速度与航行耗时同步）', () => {
    const { ctx, state } = world()
    fitLow(state, ctx, 'warpy', ['mod-warpcomp-2'])
    expect(warpBonusMult(state, ctx)).toBeCloseTo(1.2, 10) // 单件曲线权重恒 1
    expect(warpSpeedAus(state, ctx)).toBeCloseTo(3.5 * 1.2, 10)
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(3 / (3.5 * 1.2), 10)
    expect(travelLegMs(state, ctx, 6)).toBe(Math.round(360_000 * (3 / (3.5 * 1.2))))
    // 换 MK3：+35%
    fitLow(state, ctx, 'warpy', ['mod-warpcomp-3'])
    expect(warpSpeedAus(state, ctx)).toBeCloseTo(3.5 * 1.35, 10)
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(3 / (3.5 * 1.35), 10)
  })

  it('多件叠加惩罚 = EVE 曲线（多装递减）：MK2 / MK3 各 1~4 件逐档对上，且逐档读数写死', () => {
    const { ctx, state } = world()
    for (const [id, bonus] of [
      ['mod-warpcomp-2', 0.2],
      ['mod-warpcomp-3', 0.35],
    ] as const) {
      for (let n = 1; n <= 4; n++) {
        fitLow(state, ctx, 'warpy', Array.from({ length: n }, () => id))
        const want = curveMult(Array.from({ length: n }, () => bonus))
        expect(warpBonusMult(state, ctx), `${id} ×${n}`).toBeCloseTo(want, 10)
        expect(warpSpeedAus(state, ctx), `${id} ×${n}`).toBeCloseTo(3.5 * want, 10)
      }
    }
    // 曲线逐档读数写死（防"期望值也一起写错"）：MK2 ⇒ ×1.20 / ×1.41 / ×1.57 / ×1.66
    expect(curveMult([0.2, 0.2])).toBeCloseTo(1.408_59, 4)
    expect(curveMult([0.2, 0.2, 0.2])).toBeCloseTo(1.569_33, 4)
    expect(curveMult([0.2, 0.2, 0.2, 0.2])).toBeCloseTo(1.658_14, 4)
    // MK3 ⇒ ×1.35 / ×1.76 / ×2.11 / ×2.32
    expect(curveMult([0.35, 0.35])).toBeCloseTo(1.760_66, 4)
    expect(curveMult([0.35, 0.35, 0.35])).toBeCloseTo(2.112_27, 4)
    expect(curveMult([0.35, 0.35, 0.35, 0.35])).toBeCloseTo(2.321_46, 4)
    // 单一实现：core 出口与 equipment 单点是**同一个函数**（不存在第二份曲线）
    expect(curveMult).toBe(curveMultFromEquipment)
  })

  it('MK2 与 MK3 混装：同池按"单件效果从强到弱"排位（顺序无关 + 必然低于全额线性相加）', () => {
    const { ctx, state } = world()
    fitLow(state, ctx, 'warpy', ['mod-warpcomp-3', 'mod-warpcomp-3', 'mod-warpcomp-3', 'mod-warpcomp-2'])
    const mixed = warpBonusMult(state, ctx)
    expect(mixed).toBeCloseTo(curveMult([0.35, 0.35, 0.35, 0.2]), 10)
    expect(mixed, '曲线排序与传入顺序无关').toBeCloseTo(curveMult([0.2, 0.35, 0.35, 0.35]), 10)
    expect(mixed, '多装必有惩罚：低于全额线性相加').toBeLessThan(1 + 0.35 * 3 + 0.2)
    expect(mixed, '但强于"全按最弱一件算"').toBeGreaterThan(curveMult([0.2, 0.2, 0.2, 0.2]))
  })

  it('逐船生效：装在哪条船只影响那条船（同技能下各自换算）', () => {
    const { ctx, state } = world()
    fitLow(state, ctx, 'warpy', ['mod-warpcomp-3', 'mod-warpcomp-3'])
    fitLow(state, ctx, 'slowpoke', ['mod-warpcomp-2'])
    const twoMk3 = curveMult([0.35, 0.35])
    expect(warpSpeedAus(state, ctx, 'warpy')).toBeCloseTo(3.5 * twoMk3, 10)
    expect(warpSpeedAus(state, ctx, 'slowpoke')).toBeCloseTo(2.8 * 1.2, 10)
    expect(warpBonusMult(state, ctx, 'fasty'), '没装的船不受影响').toBe(1)
    expect(warpSpeedAus(state, ctx, 'fasty')).toBe(7.4)
    // 端到端：同一标称航程，两条船各自的耗时按各自跃迁速度走
    const fast = travelLegMs(state, ctx, 60, 'warpy')
    const slow = travelLegMs(state, ctx, 60, 'slowpoke')
    expect(fast / slow).toBeCloseTo((2.8 * 1.2) / (3.5 * twoMk3), 4)
  })

  it('**上限已删**（船长「去掉上限」）：20 AU/s 的船返回 20（不再夹到 12）；下限 0.5 保留', () => {
    const ctx = makeTestCtx({ ships: [ship('warpgod', { warpSpeedAus: 20 })] })
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    addShipToFleet(state, 'warpgod')
    state.shipId = 'warpgod'
    expect(warpSpeedAus(state, ctx)).toBe(20)
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(3 / 20, 10)
    // 下限仍在（异常小的船表值会被抬到 0.5）
    const ctx2 = makeTestCtx({ ships: [ship('warpbug', { warpSpeedAus: 0.1 })] })
    const s2 = createInitialState({ nowWallMs: 0, seed: 42 })
    addShipToFleet(s2, 'warpbug')
    s2.shipId = 'warpbug'
    expect(warpSpeedAus(s2, ctx2)).toBe(0.5)
  })

  it('与航行技能族**乘算**：因子 = 3 ÷ (船表 × 装备倍率) × ∏(1 − 每级削减)', () => {
    const { ctx, state } = world()
    fitLow(state, ctx, 'fasty', ['mod-warpcomp-3'])
    const base = 3 / (7.4 * curveMult([0.35]))
    expect(travelTimeFactor(state, ctx, 'fasty')).toBeCloseTo(base, 10)
    state.skills.trained['navigation'] = 5
    state.skills.trained['warp-drive-operation'] = 5
    state.skills.trained['acceleration-control'] = 5
    state.skills.trained['spaceship-command'] = 5
    const skill = 0.8 * 0.8 * 0.8 * 0.9 // 航行三件各 −4%/级满级 0.8；舰船操控学 −2%/级满级 0.9
    expect(travelTimeFactor(state, ctx, 'fasty')).toBeCloseTo(base * skill, 10)
    expect(travelLegMs(state, ctx, 60, 'fasty')).toBe(Math.round(60 * 60_000 * base * skill))
  })

  it('收敛分组口径：`stackingOf` 报 curve/warp（界面据此标「多装递减」）', () => {
    const { ctx } = world()
    const mk2 = ctx.modules.get('mod-warpcomp-2')!
    const mk3 = ctx.modules.get('mod-warpcomp-3')!
    expect(stackingOf(mk2)).toEqual({ group: 'curve', kind: 'warp' })
    expect(stackingOf(mk3)).toEqual({ group: 'curve', kind: 'warp' })
    expect(stackingOf(mk2).kind, '两档同池（混装按同一条曲线合成）').toBe(stackingOf(mk3).kind)
  })

  it('对"船表缺省回落"同样生效：无跃迁数据的船装件也按加成换算', () => {
    const ctx = makeTestCtx({
      modules: [moduleDef('mod-warpcomp-3', 'support', 0, { rack: 'low', warpSpeedBonusPct: 0.35 })],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    addShipToFleet(state, 'sandcat2')
    state.shipId = 'sandcat2' // 测试船无 warpSpeedAus ⇒ 基准 3.0
    expect(warpSpeedAus(state, ctx)).toBe(3.0)
    state.fleet['sandcat2']!.fitted = { high: [], mid: [], low: ['mod-warpcomp-3'] }
    repairDeprecatedModules(state, ctx)
    expect(warpSpeedAus(state, ctx)).toBeCloseTo(3.0 * 1.35, 10)
  })
})
