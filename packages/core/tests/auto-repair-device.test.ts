/**
 * **洞外「受损自动修补」的装置门槛与组件类型**（2026-09-16 船长原话：
 * 「洞外，原本的损伤严重自动消耗维修组件功能，需要修改。**改成需要玩家携带对应的船体维修装置。
 * 消耗的维修组件类型也跟着装置走**」）。
 *
 * 旧口径（作废）：不看装置、取件序"民用优先 → 军用 → 其它组件"、来源货舱（或 +仓库）。
 * 新口径：**必须装着船体维修装置**；**只吃装置指定的那一种组件**（民用装置→民用件、MK1/MK2→军用件）；
 * 没装装置 ⇒ 一枚组件都不动、也不写日志（调用方靠 `hasDevice` 把两种停摆原因分开说话）。
 *
 * 本文件用**真数据**（真模块 id / 真组件 id）钉住六件事：
 * ① 没装装置 ⇒ 不修、不耗件、无日志、`hasDevice=false`、`outOfKits=false`（不被误判成断料）；
 * ② 民用装置 ⇒ 只吃民用件（货舱里备着军用件也不动它）；
 * ③ MK1（军用）装置 ⇒ 只吃军用件（民用件留着）；③b 装置在但对应组件没有 ⇒ 断料（outOfKits=true）；
 * ④ 民用 + 军用装置同装 ⇒ 两种都能吃（按装配顺序取）；
 * ⑤ 「无组件自愈件」（`repairFree`：异形生体件，没有 `repairKit`）**不算**驱动自动修补的装置；
 * ⑥ 修复量口径不变：回血仍按"组件基础值 × 容量增幅 × 舰体快修学"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet, repairKitIdsOf, repairWithKitsFor } from '../src/shipyard'

const ctx = buildSimContext()

/** 把驾驶船打到"装甲与结构都低于 50%" */
function damage(state: GameState): void {
  const fs = state.fleet[state.shipId]!
  fs.armorPct = 0.2
  fs.durability = 0.2
}

function world(fittedMid: string[], cargo: Record<string, number>): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sandcat') // ⚠ 真数据里"沙猫"= `sandcat`（无 sh- 前缀）
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [...fittedMid], low: [] }
  state.fleet[uid]!.cargo = { ...cargo }
  damage(state)
  return state
}

describe('洞外自动修补：装置门槛 ＋ 组件类型随装置（2026-09-16 船长改判）', () => {
  it('① 没装装置 ⇒ 完全不修：不耗件、无日志、hasDevice=false（货舱里明明有组件）', () => {
    const state = world([], { 'repairkit-civ': 50, 'repairkit-mil': 50 })
    const before = state.logs.length
    const r = repairWithKitsFor(state, ctx, state.shipId, 0.6, 'cargo+warehouse')
    expect(r.used).toBe(0)
    expect(r.hasDevice).toBe(false)
    expect(r.kitIds).toEqual([])
    expect(r.outOfKits, '没装置不该被判成断料').toBe(false)
    expect(state.fleet[state.shipId]!.cargo['repairkit-civ']).toBe(50)
    expect(state.logs.length, '不该写自动使用修理组件日志').toBe(before)
  })

  it('② 民用装置 ⇒ 只吃民用件（备着的军用件一枚不动）', () => {
    const state = world(['mod-hullrep-civ'], { 'repairkit-civ': 50, 'repairkit-mil': 50 })
    expect(repairKitIdsOf(state, ctx, state.shipId)).toEqual(['repairkit-civ'])
    const r = repairWithKitsFor(state, ctx, state.shipId, 0.6, 'cargo+warehouse')
    expect(r.hasDevice).toBe(true)
    expect(r.used).toBeGreaterThan(0)
    expect(state.fleet[state.shipId]!.cargo['repairkit-mil'], '军用件不该被吃').toBe(50)
    expect(state.fleet[state.shipId]!.cargo['repairkit-civ'] ?? 0).toBeLessThan(50)
    expect(state.logs.some((l) => l.text.includes('民用修理组件'))).toBe(true)
  })

  it('③ MK1（军用）装置 ⇒ 只吃军用件（民用件留着）', () => {
    const state = world(['mod-hullrep-1'], { 'repairkit-civ': 50, 'repairkit-mil': 50 })
    expect(repairKitIdsOf(state, ctx, state.shipId)).toEqual(['repairkit-mil'])
    const r = repairWithKitsFor(state, ctx, state.shipId, 0.6, 'cargo+warehouse')
    expect(r.used).toBeGreaterThan(0)
    expect(state.fleet[state.shipId]!.cargo['repairkit-civ'], '民用件不该被吃').toBe(50)
    expect(state.fleet[state.shipId]!.cargo['repairkit-mil'] ?? 0).toBeLessThan(50)
  })

  it('③b 装置在、但对应组件一枚没有 ⇒ 修不动＝断料（hasDevice=true, outOfKits=true）', () => {
    const state = world(['mod-hullrep-1'], { 'repairkit-civ': 50 }) // 只有民用件，装置吃军用
    const r = repairWithKitsFor(state, ctx, state.shipId, 0.6, 'cargo+warehouse')
    expect(r.hasDevice).toBe(true)
    expect(r.used).toBe(0)
    expect(r.outOfKits, '带装置但没对应组件 ⇒ 断料（遇袭收场据此返港）').toBe(true)
    expect(state.fleet[state.shipId]!.cargo['repairkit-civ']).toBe(50)
  })

  it('④ 民用 + 军用装置同装 ⇒ 两种组件都能吃（民用先耗尽，再吃军用）', () => {
    // 民用只给 2 枚（远远不够修满）⇒ 修到它耗尽后必然转吃军用件
    const state = world(['mod-hullrep-civ', 'mod-hullrep-1'], { 'repairkit-civ': 2, 'repairkit-mil': 50 })
    expect(repairKitIdsOf(state, ctx, state.shipId)).toEqual(['repairkit-civ', 'repairkit-mil'])
    const r = repairWithKitsFor(state, ctx, state.shipId, 1, 'cargo+warehouse')
    expect(r.used).toBeGreaterThan(2)
    expect(state.fleet[state.shipId]!.cargo['repairkit-civ'] ?? 0, '民用件应已耗尽').toBe(0)
    expect(state.fleet[state.shipId]!.cargo['repairkit-mil'] ?? 0, '接续吃了军用件').toBeLessThan(50)
  })

  it('⑤ 无组件自愈件（生体件，无 repairKit）不算驱动自动修补的装置', () => {
    const freeMod = [...ctx.modules.values()].find((m) => m.repairFree === true)
    expect(freeMod, '真数据里应有 repairFree 件').toBeTruthy()
    const state = world([freeMod!.id], { 'repairkit-civ': 50 })
    expect(repairKitIdsOf(state, ctx, state.shipId), '生体件没有 repairKit ⇒ 空表').toEqual([])
    const r = repairWithKitsFor(state, ctx, state.shipId, 0.6, 'cargo+warehouse')
    expect(r.hasDevice).toBe(false)
    expect(r.used).toBe(0)
  })

  it('⑥ 修复量口径不变：回血按组件基础值 × 容量增幅 × 舰体快修学（装甲与结构都涨）', () => {
    const state = world(['mod-hullrep-civ'], { 'repairkit-civ': 50 })
    const r = repairWithKitsFor(state, ctx, state.shipId, 1, 'cargo+warehouse')
    const fs = state.fleet[state.shipId]!
    expect(r.used).toBeGreaterThan(0)
    expect(fs.armorPct!).toBeGreaterThan(0.2)
    expect(fs.durability).toBeGreaterThan(0.2)
    // 目标 100% 且 50 枚民用件足够 ⇒ 修满
    expect(fs.armorPct).toBe(1)
    expect(fs.durability).toBe(1)
  })
})
