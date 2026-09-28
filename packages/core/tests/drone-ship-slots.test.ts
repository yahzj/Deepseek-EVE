/**
 * 无人机专用舰槽位：**高槽 −2**（2026-09-10 船长拍板：梭鱼级 5→3、王鲭级 6→4）
 * ＋ **王鲭级补齐到 T3 默认线 11**（2026-09-21 船长报障「槽位数量不对」后选定「高 4 / 中 5 / 低 2」）。
 *
 * 覆盖三件事：
 * ① **布局钉住**——两舰槽位（高/中/低）防回归；
 * ② **旧档兼容**——超长位由 repair 链把尾件退回装备库、过短位补空（不丢装备、无人机清单保留）；
 * ③ **装配面**——三槽无人机配置合法，第四件被拒（该高槽类无空位）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  countModule,
  createInitialState,
  fitModule,
  repairDeprecatedModules,
} from '../src/index'

const ctx = buildSimContext()

describe('无人机专用舰槽位（2026-09-10 高槽 −2 · 2026-09-21 王鲭补齐 T3 线 11）', () => {
  it('布局钉住：梭鱼 3/3/2（8 槽）、王鲭 4/5/2（11 槽）', () => {
    expect(ctx.ships.get('sh-swarm')!.slots).toEqual({ high: 3, mid: 3, low: 2 })
    expect(ctx.ships.get('sh-sentinel')!.slots).toEqual({ high: 4, mid: 5, low: 2 })
  })

  it('旧档兼容：王鲭旧 4/2/2 的装配 → 中槽补空到 5（不丢件）；梭鱼四槽时代 → 尾件退库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    // ── 王鲭：2026-09-21 之前的档（中槽只有 2 位）⇒ 补空到 5，已装的两件原样保留 ──
    const sent = addShipToFleet(state, 'sh-sentinel')
    state.fleet[sent]!.fitted = {
      high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
      mid: ['mod-shield-kin-3', 'mod-shield-kin-3'],
      low: ['mod-cpu-3', 'mod-armor-exp-3'],
    }
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[sent]!.fitted.mid).toEqual(['mod-shield-kin-3', 'mod-shield-kin-3', null, null, null])
    expect(state.fleet[sent]!.fitted.high).toHaveLength(4)
    // 2026-09-27 起甲板扩展归低槽：高槽里那两件搬进低槽，低槽原占位件（从最后装的往前找）退回装备库
    expect(state.fleet[sent]!.fitted.high.filter(Boolean)).toEqual(['mod-drone-tac-3', 'mod-drone-tac-3'])
    expect(state.fleet[sent]!.fitted.low).toEqual(['mod-drone-rack-3', 'mod-drone-rack-3'])
    expect(countModule(state, 'mod-armor-exp-3')).toBe(1)
    expect(countModule(state, 'mod-cpu-3')).toBe(1)
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[sent]!.fitted.mid).toHaveLength(5)
    expect(state.fleet[sent]!.fitted.low).toEqual(['mod-drone-rack-3', 'mod-drone-rack-3'])
    // ── 梭鱼：四槽时代遗留 → 尾件退回装备库（旧用例原样保留） ──
    const uid = addShipToFleet(state, 'sh-swarm')
    const entry = state.fleet[uid]!
    entry.fitted = {
      high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2'],
      mid: [null, null, null],
      low: [null, null],
    }
    entry.droneLoad = { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }
    state.moduleBay['mod-drone-tac-2'] = 0

    repairDeprecatedModules(state, ctx)

    const after = state.fleet[uid]!
    expect(after.fitted.high).toHaveLength(3)
    // 截断先跑（尾部第 4 件退库）⇒ 再把高槽里的两件甲板扩展搬进低槽（低槽本来空着）
    expect(after.fitted.high).toEqual([null, null, 'mod-drone-tac-2'])
    expect(after.fitted.low).toEqual(['mod-drone-rack-2', 'mod-drone-rack-2'])
    expect(countModule(state, 'mod-drone-tac-2')).toBe(1) // 第 4 件退库，不丢装备
    expect(after.droneLoad).toEqual({ 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }) // 清单保留
    repairDeprecatedModules(state, ctx) // 幂等
    expect(state.fleet[uid]!.fitted.high).toHaveLength(3)
    expect(countModule(state, 'mod-drone-tac-2')).toBe(1)
  })

  it('装配面：甲板扩展占低槽、导控占高槽 ⇒ 两族不再抢同一组；王鲭 4 高 / 2 低恰好容下 D3 配装', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const swarm = addShipToFleet(state, 'sh-swarm')
    state.fleet[swarm]!.fitted = { high: [null, null, null], mid: [null, null, null], low: [null, null] }
    state.moduleBay['mod-drone-rack-2'] = 2
    state.moduleBay['mod-drone-tac-2'] = 3
    state.shipId = swarm
    // 2026-09-27 起：甲板扩展占**低槽**、导控占高槽（梭鱼 3 高 / 2 低）
    expect(fitModule(state, 'mod-drone-rack-2', ctx).ok).toBe(true) // 低槽 0
    expect(fitModule(state, 'mod-drone-rack-2', ctx).ok).toBe(true) // 低槽 1
    expect(fitModule(state, 'mod-drone-tac-2', ctx).ok).toBe(true) // 高槽 0
    expect(fitModule(state, 'mod-drone-tac-2', ctx).ok).toBe(true) // 高槽 1
    expect(fitModule(state, 'mod-drone-tac-2', ctx).ok).toBe(true) // 高槽 2
    const overflow = fitModule(state, 'mod-drone-tac-2', ctx)
    expect(overflow.ok).toBe(false) // 3 高槽已满
    expect(state.fleet[swarm]!.fitted.high.filter(Boolean)).toHaveLength(3)
    expect(state.fleet[swarm]!.fitted.low.filter(Boolean)).toHaveLength(2)

    const sent = addShipToFleet(state, 'sh-sentinel')
    // 位对齐后中槽 = 5（2026-09-21 补齐）
    state.fleet[sent]!.fitted = { high: [null, null, null, null], mid: [null, null], low: [null, null] }
    repairDeprecatedModules(state, ctx)
    expect(state.fleet[sent]!.fitted.mid).toHaveLength(5)
    state.moduleBay['mod-drone-rack-3'] = 2
    state.moduleBay['mod-drone-tac-3'] = 2
    state.shipId = sent
    for (const id of ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3']) {
      expect(fitModule(state, id, ctx).ok).toBe(true)
    }
    // 王鲭 4 高 / 2 低：两件扩舱进低槽、两件导控进高槽
    expect(state.fleet[sent]!.fitted.low.filter(Boolean)).toEqual(['mod-drone-rack-3', 'mod-drone-rack-3'])
    expect(state.fleet[sent]!.fitted.high.filter(Boolean)).toEqual(['mod-drone-tac-3', 'mod-drone-tac-3'])
  })
})
