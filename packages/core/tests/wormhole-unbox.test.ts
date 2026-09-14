/**
 * **虫洞 F4d · 拆解「遗迹安全货柜」**（船长 2026-09-13 定案）。
 *
 * 口径：走**精炼配方口径**（与精炼 / 回收同一条产线机器：主控亲自 或 1 枚 AI 核心）· **90 秒/件** ·
 * 一箱出 **1 件** · **族池 0.7 : 稀释池 0.3** · 货柜**不记层** ⇒ 稀释池一律**最低档**（层 2 档 = T3 那批 10 张）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { UNBOX_CYCLE_MS, advanceRefining, startUnboxRun } from '../src/industry'
import { wormholeDilutionPoolOf, wormholeUnboxRoll, WORMHOLE_DILUTION_MIN_DEPTH_FLOOR } from '../src/wormholeSalvage'

const ctx = buildSimContext()

describe('虫洞 F4d · 安全货柜拆解（90 秒/件 · 族池 0.7 : 稀释池 0.3）', () => {
  it('开工 → 一件 90 秒：每件消耗 1 箱、抽出的东西进账、拆完自动停', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    addWare(state, 'box-relic-a', 2)
    const started = startUnboxRun(state, ctx, 'box-relic-a', 'pilot')
    expect(started.ok, started.error).toBe(true)
    expect(state.refineRuns).toHaveLength(1)
    expect(state.refineRuns[0]!.recipe).toBe('unbox')
    /** 抽到的东西落在哪三个面：装备库 / 图纸库存 / 物品仓库（任一变化即说明这一箱真开出了东西） */
    const lootSig = (): string => JSON.stringify([state.moduleBay, state.blueprintStock, state.warehouse.items])
    const before = lootSig()
    // 一件到点：消耗 1 箱、**开出 1 件**、炉子继续转（还有 1 箱）
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, 'box-relic-a')).toBe(1)
    expect(lootSig(), '这一箱应真的开出东西（装备 / 图纸 / 物品）').not.toBe(before)
    expect(state.refineRuns).toHaveLength(1)
    // 第二件到点：料尽自动停炉
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(countWare(state, 'box-relic-a')).toBe(0)
    // 料尽停炉在**下一拍**才被察觉（与精炼/回收同一条机器：批末先把 finishAt 推到下一件）
    state.gameMs += UNBOX_CYCLE_MS
    advanceRefining(state, ctx)
    expect(state.refineRuns).toHaveLength(0)
  })

  it('抽取：族池 0.7 : 稀释池 0.3，且稀释池只取最低档（层 2 的 10 张一次性舰船蓝图）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const floorPool = new Set(wormholeDilutionPoolOf(ctx, WORMHOLE_DILUTION_MIN_DEPTH_FLOOR))
    expect(floorPool.size).toBe(10)
    let diluted = 0
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const r = wormholeUnboxRoll(state, ctx, 'box-relic-a')
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      seen.add(r!.itemId)
      if (r!.diluted) {
        diluted += 1
        // 稀释池抽到的必须落在最低档池里
        expect(floorPool.has(r!.itemId)).toBe(true)
      }
    }
    // 30% ± 抽样噪声
    expect(diluted).toBeGreaterThan(80)
    expect(diluted).toBeLessThan(160)
    expect(seen.size).toBeGreaterThan(3)
  })

  it('不是货柜 ⇒ 拒绝（拆解台只拆安全货柜）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addWare(state, 'ore-veldspar', 100)
    const r = startUnboxRun(state, ctx, 'ore-veldspar', 'pilot')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('安全货柜')
  })
})
