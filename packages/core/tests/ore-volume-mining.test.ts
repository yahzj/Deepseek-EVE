/**
 * **矿石按体积结算（2026-09-28 船长令）**——`getMiningParams` 的件数改为「每循环 m³ ÷ `ore.unitM3`」。
 *
 * 船长原话（照抄）：「**原版 EVE 是通过不同矿石每单位体积不同来进行平衡的。体积越小的矿石，
 * 每次挖掘采集到的单位量越多**」。
 *
 * 本用例钉三件事：
 * ① **unitM3 = 1 时与旧算式逐位等价**（落地当天零读数漂移）；
 * ② **件数随体积反比**：同一艘船挖「小体积矿」拿到的件数 = 大体积矿的 `体积比` 倍；
 * ③ **每循环 m³ 恒定**：不管矿种，`unitsPerCycle × unitM3` 恒定 ⇒ 满舱节奏不变。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { getMiningParams } from '../src/mining'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const BELT = 'belt-fortune' // 母港门口矿带（主产物 ore-veldspar）

/** 造一艘"只有船体、无技能、无矿枪"的档，便于逐位对照旧算式 */
function bareState(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(s, 'sandcat')
  s.shipId = uid
  return s
}

/** 把某支矿的 unitM3 临时改掉（只改内存里的 ctx，不动数据文件） */
function withOreVolume(volume: number): typeof ctx {
  const belt = ctx.belts.get(BELT)!
  const items = new Map(ctx.items)
  items.set(belt.oreId, { ...items.get(belt.oreId)!, unitM3: volume })
  return { ...ctx, items } as typeof ctx
}

describe('矿石按体积结算（2026-09-28 船长令：体积越小、每次采集到的单位量越多）', () => {
  it('① unitM3 = 1 时与旧算式逐位等价（零读数漂移）', () => {
    const s = bareState()
    const p = getMiningParams(s, withOreVolume(1), { shipId: 'sandcat', beltId: BELT })!
    const ship = ctx.ships.get('sandcat')!
    // 无技能、无矿枪、无限时倍率 ⇒ 产量乘链 = 1
    expect(p.unitsPerCycle).toBe(Math.max(1, Math.floor(ship.oreUnitsPerCycle)))
  })

  it('② 件数随体积反比：小体积矿的件数 = 大体积矿 × 体积比', () => {
    const s = bareState()
    const base = getMiningParams(s, withOreVolume(1), { shipId: 'sandcat', beltId: BELT })!
    for (const [mul, volume] of [
      [5, 0.2],
      [2, 0.5],
      [1, 1],
    ] as const) {
      const p = getMiningParams(s, withOreVolume(volume), { shipId: 'sandcat', beltId: BELT })!
      expect(p.unitsPerCycle, `unitM3 = ${volume} 时的件数`).toBe(base.unitsPerCycle * mul)
    }
  })

  it('③ 每循环 m³ 恒定：件数 × unitM3 与矿种无关（满舱节奏不变）', () => {
    const s = bareState()
    const base = getMiningParams(s, withOreVolume(1), { shipId: 'sandcat', beltId: BELT })!
    const baseM3 = base.unitsPerCycle * 1
    for (const volume of [0.1, 0.5, 1, 2, 5]) {
      const p = getMiningParams(s, withOreVolume(volume), { shipId: 'sandcat', beltId: BELT })!
      const m3 = p.unitsPerCycle * volume
      // 取整误差最多 1 件 ⇒ 允许 volume 的绝对误差
      expect(Math.abs(m3 - baseM3), `unitM3 = ${volume} 时每循环 m³`).toBeLessThanOrEqual(volume)
    }
  })

  it('④ 极小体积矿也不出 0 件（保底 1）', () => {
    const s = bareState()
    const p = getMiningParams(s, withOreVolume(500), { shipId: 'sandcat', beltId: BELT })!
    expect(p.unitsPerCycle).toBe(1)
  })
})
