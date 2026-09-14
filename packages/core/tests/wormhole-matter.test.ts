/**
 * **虫洞 · 谜质储存器（F3c A 批 · 船长 2026-09-13 逐条裁定）**。
 *
 * 锁住这批的六组口径：
 * ① **装置表 ↔ 数据表 ↔ 形状表三处一致**（一台 = 2000 m³ = 2×2 = 4 格，全 `unreleased`）；
 * ② **每层保底 1 个谜质格**（船长：「每层保底 1 个谜质格」）；
 * ③ **哪一台按 (种子, 层, 格) 定死**（不写存档 ⇒ 读档后还是同一台）；
 * ④ **效果一律从货仓现算**（扫描半径 / 打捞·采集堆数 / 母矿产量 / 仓格）；
 * ⑤ **回合实时派生 + 夹紧**（船长：「实时派生 + 夹紧 + 丢弃提醒」）：
 *    装上就 +10、丢掉就 −10 并把剩余夹到新上限、**永不为负**、**0 回合照样能撤离**；
 * ⑥ **老档零迁移**（`turnsBase` 缺失时按"当前上限 − 当前加成"反推）。
 *
 * ⚠ 施工期铁律：虫洞对玩家不可见；本文件不产生玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter, wormholeExtract } from '../src/wormhole'
import {
  WORMHOLE_MATTER_DEVICES,
  WORMHOLE_MATTER_DEVICE_IDS,
  wormholeMatterApplyTurnDelta,
  wormholeMatterBuffs,
  wormholeMatterDeviceAt,
  wormholeMatterDiscardHint,
} from '../src/wormholeMatter'
import { WORMHOLE_HOLD_SHAPES, wormholeShapeOf } from '../src/wormholeHold'
import { WORMHOLE_MATTER_FLOOR, gridScanTargets, wormholeMakeGrid } from '../src/wormholeGrid'
import {
  wormholeHoldCapacityOf,
  wormholeHoldDiscard,
  wormholeStowOrTemp,
  wormholeSyncMatterTurns,
} from '../src/wormholeSalvage'
import { wormholeActivateAt, wormholeTravelTo } from '../src/wormholeBattle'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/** 起一趟：`ships` 艘巡洋舰 */
function enterRun(ships = 4, seed = 777): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, T3))
  state.shipId = ids[0]!
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  return state
}

describe('虫洞 · 谜质装置（F3c A 批）', () => {
  it('① 装置表 / 数据表 / 形状表三处一致：2×2 = 4 格、2000 m³、施工期不可见', () => {
    expect(WORMHOLE_MATTER_DEVICES.length).toBeGreaterThan(0)
    expect(WORMHOLE_MATTER_DEVICE_IDS.length).toBe(WORMHOLE_MATTER_DEVICES.length)
    for (const d of WORMHOLE_MATTER_DEVICES) {
      const item = ctx.items.get(d.id)
      expect(item, `物品表里应有 ${d.id}`).toBeDefined()
      expect(item!.kind).toBe('matter')
      expect(item!.unitM3).toBe(2000)
      expect(item!.unreleased).toBe(true)
      // 形状表登记（没登记 ⇒ 会被当散货合并进背包，只占 1 格、形状丢失）
      expect(WORMHOLE_HOLD_SHAPES[d.id]).toBeDefined()
      const shape = wormholeShapeOf(d.id)
      expect(shape.w * shape.h).toBe(4)
    }
  })

  it('② 每层保底 1 个谜质格（多 seed × 多层真数一遍）', () => {
    for (let depth = 1; depth <= 5; depth++) {
      for (let seed = 1; seed <= 40; seed++) {
        const grid = wormholeMakeGrid(seed, depth, 0)
        const n = grid.cells.filter((c) => c.place === 'matter').length
        expect(n, `层 ${depth} · seed ${seed} 应至少 ${WORMHOLE_MATTER_FLOOR} 个谜质格`).toBeGreaterThanOrEqual(
          WORMHOLE_MATTER_FLOOR,
        )
      }
    }
  })

  it('③ 哪一台按 (种子, 层, 格) 定死：同输入同输出、且必在装置表里', () => {
    const a = wormholeMatterDeviceAt(1234, 2, '3,-1')
    const b = wormholeMatterDeviceAt(1234, 2, '3,-1')
    expect(a.id).toBe(b.id)
    expect(WORMHOLE_MATTER_DEVICE_IDS).toContain(a.id)
    // 不同格 / 不同层会换台（至少不是恒同一台）
    const set = new Set<string>()
    for (let q = 0; q < 12; q++) set.add(wormholeMatterDeviceAt(1234, 2, `${q},0`).id)
    expect(set.size).toBeGreaterThan(1)
  })

  it('④ 派生：扫描半径 / 回合 / 打捞·采集堆数 / 母矿倍率 / 仓格 逐类相加', () => {
    const run = enterRun().wormhole.run!
    run.hold = { placements: [], cols: 8 }
    const hold = run.hold
    const add = (itemId: string, n: number): void => {
      for (let i = 0; i < n; i++) {
        hold.placements.push({ id: `${itemId}-${i}`, kind: 'box', itemId, x: 0, y: i, w: 2, h: 2 })
      }
    }
    expect(wormholeMatterBuffs(hold).devices).toBe(0)
    add('mat-surveyor', 2)
    add('mat-chrono', 1)
    add('mat-crane', 1)
    add('mat-drill', 1)
    add('mat-nebula', 1)
    add('mat-enricher', 2)
    add('mat-expander', 1)
    const b = wormholeMatterBuffs(hold)
    expect(b.devices).toBe(9)
    expect(b.scanRadius).toBe(2)
    expect(b.turnBonus).toBe(10)
    expect(b.salvagePiles).toBe(1)
    expect(b.collectPiles).toBe(1)
    expect(b.nebulaDisperse).toBe(2)
    expect(b.oreYieldMul).toBeCloseTo(1.5, 5)
    expect(b.holdCells).toBe(8)
    // 扫描半径加成真的让"这一扫能揭更多格"
    const grid = run.grid!
    expect(gridScanTargets(grid, b.scanRadius).length).toBeGreaterThan(gridScanTargets(grid, 0).length)
    // 仓格加成走同一条派生（容量 +8）
    const capBase = wormholeHoldCapacityOf(enterRun(), ctx)
    const s2 = enterRun()
    s2.wormhole.run!.hold = { placements: [], cols: 8 }
    wormholeStowOrTemp(s2, ctx, 'mat-expander', 1)
    expect(wormholeHoldCapacityOf(s2, ctx)).toBe(capBase + 8)
  })

  it('⑤ 回合实时派生 + 夹紧：装上 +10、丢掉 −10 且夹到上限、0 回合仍能撤离', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const base = run.turnsTotal
    // 装一台时序核心 ⇒ 上限与剩余各 +10（`wormholeStowOrTemp` 内部会同步）
    const stowed = wormholeStowOrTemp(state, ctx, 'mat-chrono', 1)
    expect(stowed.ok).toBe(true)
    expect(stowed.where).toBe('hold')
    expect(run.turnsTotal).toBe(base + 10)
    expect(run.turnsLeft).toBe(base + 10)
    // 花掉一些回合（模拟探索），再丢掉它 ⇒ 上限回到 base、剩余夹到上限、永不为负
    run.turnsLeft = base + 3
    const box = run.hold!.placements.find((p) => p.itemId === 'mat-chrono')!
    expect(wormholeMatterDiscardHint('mat-chrono')).toContain('少 10 回合')
    const dropped = wormholeHoldDiscard(state, ctx, box.id)
    expect(dropped.ok).toBe(true)
    expect(run.turnsTotal).toBe(base)
    expect(run.turnsLeft).toBeLessThanOrEqual(run.turnsTotal)
    expect(run.turnsLeft).toBeGreaterThanOrEqual(0)
    // **0 回合也照样能撤离**（丢弃回合装置不会软锁——撤离不看回合）
    run.turnsLeft = 0
    expect(wormholeExtract(run).ok).toBe(true)
    // 幂等：再同步一次不变
    const snap = { total: run.turnsTotal, left: run.turnsLeft }
    wormholeSyncMatterTurns(state)
    expect(run.turnsTotal).toBe(snap.total)
    expect(run.turnsLeft).toBe(snap.left)
  })

  it('⑥ 老档零迁移：没有 `turnsBase` 时按"当前上限 − 当前加成"反推', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    delete run.turnsBase
    const total = run.turnsTotal
    wormholeSyncMatterTurns(state)
    expect(run.turnsBase).toBe(total)
    expect(run.turnsTotal).toBe(total)
    // 手工把一台装置塞进货仓（模拟老档里本来就有装置的情形）⇒ 下一次同步把上限抬到 base + 10
    run.hold = { placements: [{ id: 'x', kind: 'box', itemId: 'mat-chrono', x: 0, y: 0, w: 2, h: 2 }], cols: 8 }
    wormholeSyncMatterTurns(state)
    expect(run.turnsTotal).toBe(total + 10)
  })

  it('⑦ 走到谜质格取回：装置进包（2×2）且回合按派生结清', () => {
    const state = enterRun(4, 20260913)
    const run = state.wormhole.run!
    const grid = run.grid!
    const target = grid.cells.find((c) => c.place === 'matter' && c.key !== `${grid.pos.q},${grid.pos.r}`)!
    expect(target).toBeDefined()
    const moved = wormholeTravelTo(state, ctx, { q: target.q, r: target.r }, { confirmUnknown: true })
    expect(moved.ok).toBe(true)
    const expected = wormholeMatterDeviceAt(run.seed ?? 0, run.depth, target.key)
    const before = run.turnsTotal
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok, act.error).toBe(true)
    // 装置落进货仓（腾得出 2×2）或临时空间（腾不出）——两种都算成功
    const inHold = (run.hold?.placements ?? []).some((p) => p.itemId === expected.id)
    const inTemp = (run.temp ?? []).some((s) => s.itemId === expected.id)
    expect(inHold || inTemp, `应拿到 ${expected.id}`).toBe(true)
    if (expected.id === 'mat-chrono' && inHold) expect(run.turnsTotal).toBe(before + 10)
    else expect(run.turnsTotal).toBe(before)
    // 同一格再激活：不重复给（已 activated）
    const again = wormholeActivateAt(state, ctx)
    expect(again.ok).toBe(false)
  })

  it('⑧ 非回合装置的"丢弃提醒"为空（界面照旧直接抛）', () => {
    expect(wormholeMatterDiscardHint('mat-surveyor')).toBeNull()
    expect(wormholeMatterDiscardHint('box-relic-a')).toBeNull()
    // 直接调 delta 也不该动回合
    const fake = { turnsLeft: 5, turnsTotal: 9 }
    wormholeMatterApplyTurnDelta(fake, 'mat-drill', 1)
    expect(fake).toEqual({ turnsLeft: 5, turnsTotal: 9 })
  })
})
