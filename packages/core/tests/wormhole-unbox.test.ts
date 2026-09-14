/**
 * **虫洞 F4d · 拆解「遗迹安全货柜」**（船长 2026-09-13 定案；**2026-09-14 改判**）。
 *
 * 口径：走**精炼配方口径**（与精炼 / 回收同一条产线机器：主控亲自 或 1 枚 AI 核心）· **90 秒/件** ·
 * 一箱出 **1 件**。
 *
 * ⚠ **2026-09-14 船长新增「图纸货柜」并裁定「与安全货柜并列」**⇒ 本文件的口径随之改：
 * **安全货柜 = 100% 族专属池**，原「族池 0.7 : 稀释池 0.3」里的**稀释池已收回**
 * （一次性图纸改由图纸货柜专出，否则同一批图纸会有两条渠道）。
 * `wormholeLootShares()` / `WORMHOLE_DILUTION_SHARE` **保留但停用**（见 `wormholeSalvage.ts` 的说明）；
 * 图纸货柜的用例在 `wormhole-bp-box.test.ts`。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addWare, countWare } from '../src/inventory'
import { UNBOX_CYCLE_MS, advanceRefining, startUnboxRun } from '../src/industry'
import { wormholeFamilyPoolOf, wormholeUnboxRoll } from '../src/wormholeSalvage'

const ctx = buildSimContext()

describe('虫洞 F4d · 安全货柜拆解（90 秒/件 · 100% 族专属池）', () => {
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

  it('安全货柜 = **100% 族专属池**（稀释池已收回；抽到的每一件都必须落在该族池里）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const pool = wormholeFamilyPoolOf(ctx, 'A')
    const inPool = new Set<string>([...pool.modules, ...pool.moduleBlueprints, ...pool.shipBlueprints, ...(pool.drones ?? [])])
    expect(inPool.size).toBeGreaterThan(6)
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const r = wormholeUnboxRoll(state, ctx, 'box-relic-a')
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      // 2026-09-14：来源只可能是族池 —— 稀释池那条分支已收回
      expect(r!.source, `第 ${i} 抽的来源应为族专属池`).toBe('family')
      expect(inPool.has(r!.itemId), `第 ${i} 抽到 ${r!.itemId}，不在 A 族池里`).toBe(true)
      seen.add(r!.itemId)
    }
    expect(seen.size, 'A 族池不止一件，应能抽出多种').toBeGreaterThan(3)
  })

  it('不是货柜 ⇒ 拒绝（拆解台只拆虫洞带回来的货柜）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addWare(state, 'ore-veldspar', 100)
    const r = startUnboxRun(state, ctx, 'ore-veldspar', 'pilot')
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('货柜')
  })
})
