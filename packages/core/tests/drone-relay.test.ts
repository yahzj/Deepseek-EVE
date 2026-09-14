/**
 * 无人机射程分类 + 中继天线（2026-09-10 船长拍板；**2026-09-14 船长「对无人机的射程插件添加叠加惩罚」**）：
 * - 机型射程分类：蜂鸟 2500 / 赤鸢 3000 / 猎鹰 3500 / 雷鸥哨戒 5000（combat 读 def.maxRangeM）；
 * - 无人机中继天线（高槽 drone-relay，百分比制）：**折权加算**（第 2 件起按 stackWeight 的 87% / 57%… 折权后相加；单件仍全额）。本文件的机型卡是自带的测试夹具，真表口径见 `drone-range-stacking.test.ts`。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { createPlayerSpec } from '../src/combat'
import { itemKindText, DRONE_CLASS_LABELS } from '../src/labels'
import { weightedSum } from '../src/equipment'
import { makeTestCtx, moduleDef, ship } from './helpers'
import type { ItemDef } from '../src/types'

const DRONES_TEST: ItemDef[] = [
  { id: 'drone-scout', name: '蜂鸟', kind: 'drone', unitM3: 5, baseSellPriceIsk: 900, description: '测试', damageType: 'kinetic', dmg: 3, cpuUse: 4, maxRangeM: 2500, defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 } },
  { id: 'drone-sentry', name: '雷鸥', kind: 'drone', unitM3: 40, baseSellPriceIsk: 9500, description: '测试', damageType: 'plasma', dmg: 20, cpuUse: 16, maxRangeM: 5000, defense: { shieldHp: 30, armorHp: 20, hullHp: 55, evasion: 0.25 } },
]

function relayDef(id: string, pct: number, cpu: number): ReturnType<typeof moduleDef> {
  return moduleDef(id, 'drone-relay', 0, { rack: 'high', droneRangeBonusPct: pct, cpuUse: cpu })
}

function world(opts: { relays: string[]; load: Record<string, number> }) {
  const bed = {
    ...ship('bed', { cpu: 400, slots: { high: 6, mid: 2, low: 2 }, powerBonus: 0.2, droneBayM3: 320 }),
    shieldHp: 3000,
    armorHp: 1000,
    hullHp: 1000,
  }
  const mods = [relayDef('mod-relay-1', 0.2, 6), relayDef('mod-relay-2', 0.45, 16), relayDef('mod-relay-3', 0.8, 38)]
  const ctx = makeTestCtx({ ships: [bed], modules: mods, items: [...DRONES_TEST] })
  const state = createInitialState({ nowWallMs: 0, seed: 9 })
  state.fleet[state.shipId]!.defId = 'bed'
  state.fleet[state.shipId]!.fitted = {
    high: [...opts.relays, null, null, null, null, null].slice(0, 6) as (string | null)[],
    mid: [],
    low: [],
  }
  for (const id of opts.relays) state.moduleBay[id] = 1
  state.fleet[state.shipId]!.droneLoad = { ...opts.load }
  return { state, ctx }
}

function droneRanges(state: ReturnType<typeof world>['state'], ctx: ReturnType<typeof world>['ctx']): Record<string, number> {
  const spec = createPlayerSpec(state, ctx as never, state.shipId)!
  const out: Record<string, number> = {}
  for (const w of spec.weapons) {
    if (w.kind === 'fixed' && (w.label === '蜂鸟' || w.label === '雷鸥')) out[w.label] = w.maxRangeM
  }
  return out
}

describe('无人机射程分类 + 中继天线（2026-09-10）', () => {
  it('机型分类射程：蜂鸟 2500、雷鸥哨戒 5000（无装置）', () => {
    const { state, ctx } = world({ relays: [], load: { 'drone-scout': 2, 'drone-sentry': 1 } })
    const r = droneRanges(state, ctx as never)
    expect(r['蜂鸟']).toBe(2500)
    expect(r['雷鸥']).toBe(5000)
  })

  it('中继天线百分比乘入：MK2(+45%) → 蜂鸟 3625、雷鸥 7250（round）', () => {
    const { state, ctx } = world({ relays: ['mod-relay-2'], load: { 'drone-scout': 2, 'drone-sentry': 1 } })
    const r = droneRanges(state, ctx as never)
    expect(r['蜂鸟']).toBe(Math.round(2500 * 1.45))
    expect(r['雷鸥']).toBe(Math.round(5000 * 1.45))
  })

  it('多件折权加算（2026-09-14 叠加惩罚）：MK1×2 ⇒ 1+0.2×(1+87%)；MK3 单件仍全额', () => {
    const dbl = world({ relays: ['mod-relay-1', 'mod-relay-1'], load: { 'drone-scout': 2 } })
    expect(droneRanges(dbl.state, dbl.ctx as never)['蜂鸟']).toBe(Math.round(2500 * (1 + weightedSum([0.2, 0.2])))) // 折权：第 2 件 ×87% ⇒ 1.3738（原全额 1.4）
    const top = world({ relays: ['mod-relay-3'], load: { 'drone-sentry': 1 } })
    expect(droneRanges(top.state, top.ctx as never)['雷鸥']).toBe(Math.round(5000 * 1.8))
  })

  it('分类并入「种类」：无人机 · 侦察机/战斗机/攻坚机/哨戒机；非无人机与缺分类走大类兜底', () => {
    expect(itemKindText({ kind: 'drone', droneClass: 'scout' })).toBe('无人机 · 侦察机')
    expect(itemKindText({ kind: 'drone', droneClass: 'combat' })).toBe('无人机 · 战斗机')
    expect(itemKindText({ kind: 'drone', droneClass: 'assault' })).toBe('无人机 · 攻坚机')
    expect(itemKindText({ kind: 'drone', droneClass: 'sentry' })).toBe('无人机 · 哨戒机')
    expect(DRONE_CLASS_LABELS.scout).toBe('侦察机')
    expect(itemKindText({ kind: 'drone' })).toBe('无人机') // 旧档/缺字段兜底
    // 2026-09-12 术语修正（船长定）：`ore` 的展示名由「矿石」改为「原矿」
    expect(itemKindText({ kind: 'ore' })).toBe('原矿')
    expect(itemKindText({ kind: 'ammo' })).toBe('弹药')
  })
})
