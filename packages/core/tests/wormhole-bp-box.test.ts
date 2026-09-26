/**
 * **虫洞 · 图纸货柜**（2026-09-14 船长定：虫洞遗迹打捞新增）。
 *
 * 船长原话：「**给虫洞的遗迹打捞新增图纸货柜。占 2 格大小。内部是随机 T3T4T5 舰船的一次性图纸。
 * 有较低概率出 T3 或 T4 的永久图纸。**」⇒ 逐条裁定后的口径：
 * ① **三种 = 层档**（层档写进物品 id 是必然——拆解读的是精炼炉记录里的 `itemId`）：
 *    浅层（层 2 → 只 T3）· 中层（层 3~4 → T3+T4）· 深层（层 5+ → T3+T4+T5）；
 * ② **占货仓 2×1 = 2 格**、**1000 m³**；
 * ③ **掉落与安全货柜并列**：遗迹专属掉落命中后再掷一次，**50 : 50**；
 * ④ 拆解走既有精炼炉（90 秒/件）：**5% 永久图纸池 / 95% 一次性图纸池**，两者都按层档过滤；
 * ⑤ 永久池 = **T3/T4 永久图纸**（不含 T5），门槛与一次性同口径（T3 层 2 / T4 层 3）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { wormholeEnter } from '../src/wormhole'
import { UNBOX_CYCLE_MS, advanceRefining, startUnboxRun } from '../src/industry'
import { wormholeIsShapedItem, wormholeShapeOf } from '../src/wormholeHold'
import {
  WORMHOLE_BP_BOX_DEEP,
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_BP_BOX_MID,
  WORMHOLE_BP_BOX_SHALLOW,
  WORMHOLE_BPBOX_PERMANENT_CHANCE,
  WORMHOLE_RELIC_BOX_CHANCE,
  wormholeBpBoxDepthOf,
  wormholeBpBoxIdOf,
  wormholeBpBoxIdsForDepth,
  wormholeCellCardIdOf,
  wormholeDilutionPoolOf,
  familyOfCard,
  wormholePermanentPoolOf,
  wormholeRelicBoxIdOf,
  wormholeRelicBoxPoolOf,
  wormholeRelicChanceOf,
  wormholeRollRelicBox,
  wormholeSalvageBoxClassesOf,
  wormholeUnboxRoll,
} from '../src/wormholeSalvage'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
const BP_BOX = WORMHOLE_BP_BOX_DEEP

/** 起一趟洞（够简单：一艘巡洋舰 + 指定种子；层数由调用方设） */
function enterRun(seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, T3)
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], seed).ok).toBe(true)
  return state
}

const tierOfBp = (id: string): number | undefined => {
  const bp = ctx.shipBlueprints.get(id)
  return bp ? ctx.ships.get(bp.shipId)?.tier : undefined
}

describe('虫洞 · 图纸货柜（2026-09-14 船长定）', () => {
  it('层档映射：层 2 → 浅层 · 层 3~4 → 中层 · 层 5+ → 深层', () => {
    expect(wormholeBpBoxIdOf(2)).toBe(WORMHOLE_BP_BOX_SHALLOW)
    expect(wormholeBpBoxIdOf(3)).toBe(WORMHOLE_BP_BOX_MID)
    expect(wormholeBpBoxIdOf(4)).toBe(WORMHOLE_BP_BOX_MID)
    expect(wormholeBpBoxIdOf(5)).toBe(WORMHOLE_BP_BOX_DEEP)
    expect(wormholeBpBoxIdOf(9)).toBe(WORMHOLE_BP_BOX_DEEP)
    // 反查（拆解时据它选池）
    expect(wormholeBpBoxDepthOf(WORMHOLE_BP_BOX_SHALLOW)).toBe(2)
    expect(wormholeBpBoxDepthOf(WORMHOLE_BP_BOX_MID)).toBe(3)
    expect(wormholeBpBoxDepthOf(WORMHOLE_BP_BOX_DEEP)).toBe(5)
    expect(wormholeBpBoxDepthOf('box-relic-a')).toBeNull()
    expect(wormholeBpBoxDepthOf('ore-veldspar')).toBeNull()
  })

  it('两种池按层档过滤：一次性 10 / 14 / 15 · 永久 10 / 14 / 14（永久不含 T5）', () => {
    const once2 = wormholeDilutionPoolOf(ctx, 2)
    const once3 = wormholeDilutionPoolOf(ctx, 3)
    const once5 = wormholeDilutionPoolOf(ctx, 5)
    expect(once2).toHaveLength(10)
    expect(once3).toHaveLength(16) // 2026-09-26：+虎鲸/旋齿鲨两张 T4 一次性图纸
    expect(once5).toHaveLength(17)
    expect(once2.every((id) => tierOfBp(id) === 3), '浅层一次性池应全是 T3').toBe(true)
    expect(once5.some((id) => tierOfBp(id) === 5), '深层一次性池应含 T5').toBe(true)

    const perm2 = wormholePermanentPoolOf(ctx, 2)
    const perm3 = wormholePermanentPoolOf(ctx, 3)
    const perm5 = wormholePermanentPoolOf(ctx, 5)
    expect(perm2).toHaveLength(10)
    expect(perm3).toHaveLength(16) // 2026-09-26：+sbp-orca / sbp-helicoprion 两张 T4 永久图纸
    expect(perm5).toHaveLength(16) // 船长只点 T3/T4 ⇒ T5 永久不进池
    expect(perm2.every((id) => tierOfBp(id) === 3)).toBe(true)
    expect(perm5.some((id) => tierOfBp(id) === 4)).toBe(true)
    expect(perm5.some((id) => tierOfBp(id) === 5), '永久池不得含 T5').toBe(false)
    for (const id of perm5) {
      const bp = ctx.shipBlueprints.get(id)!
      expect(bp.singleUse === true, `${id} 是一次性图纸，不该进永久池`).toBe(false)
      expect(id.startsWith('sbp-once-') || id.startsWith('sbp-wh-'), `${id} 前缀不该进永久池`).toBe(false)
      // 与一次性池必须互斥
      expect(once5.includes(id), `${id} 同时落在一次性池里`).toBe(false)
    }
  })

  it('占货仓 2×1 = 2 格（形状表已登记三种，且都不是可叠加散货）', () => {
    for (const id of WORMHOLE_BP_BOX_IDS) {
      expect(wormholeIsShapedItem(id), `${id} 应是形状件`).toBe(true)
      const shp = wormholeShapeOf(id)
      expect([shp.w, shp.h], `${id} 的形状`).toEqual([2, 1])
      expect(shp.w * shp.h).toBe(2)
      // 体积同尺：500 m³/格 × 2 格
      expect(ctx.items.get(id)?.unitM3).toBe(1000)
      expect(ctx.items.get(id)?.kind).toBe('container')
    }
  })

  it('拆解：浅层只可能开出 T3（一次性或永久），且都落在该层档的池里', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const once = new Set(wormholeDilutionPoolOf(ctx, 2))
    const perm = new Set(wormholePermanentPoolOf(ctx, 2))
    for (let i = 0; i < 300; i++) {
      const r = wormholeUnboxRoll(state, ctx, WORMHOLE_BP_BOX_SHALLOW)
      expect(r, `第 ${i} 抽应能抽到东西`).not.toBeNull()
      expect(tierOfBp(r!.itemId), `第 ${i} 抽到 ${r!.itemId}，浅层不该出 T3 以外的档`).toBe(3)
      if (r!.source === 'permanent') expect(perm.has(r!.itemId), `第 ${i} 抽的永久图纸不在永久池`).toBe(true)
      else {
        expect(r!.source).toBe('once')
        expect(once.has(r!.itemId), `第 ${i} 抽的一次性图纸不在一次性池`).toBe(true)
      }
    }
  })

  it('拆解：深层可开出 T5 一次性图纸，但永久只到 T4', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 33 })
    let sawT5Once = 0
    let sawPermT4 = 0
    for (let i = 0; i < 1500; i++) {
      const r = wormholeUnboxRoll(state, ctx, WORMHOLE_BP_BOX_DEEP)!
      const tier = tierOfBp(r.itemId)
      if (r.source === 'permanent') {
        expect(tier === 3 || tier === 4, `永久图纸不该是 T${String(tier)}`).toBe(true)
        if (tier === 4) sawPermT4 += 1
      } else {
        expect([3, 4, 5].includes(tier!), `一次性图纸档位异常 T${String(tier)}`).toBe(true)
        if (tier === 5) sawT5Once += 1
      }
    }
    expect(sawT5Once, '深层应能开出 T5 一次性图纸（皇带鱼）').toBeGreaterThan(0)
    expect(sawPermT4, '深层应能开出 T4 永久图纸').toBeGreaterThan(0)
  })

  it('拆解：永久图纸占比 ≈ 5%（船长「较低概率」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 55 })
    let perm = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      if (wormholeUnboxRoll(state, ctx, WORMHOLE_BP_BOX_DEEP)!.source === 'permanent') perm += 1
    }
    const rate = perm / N
    // 抽样噪声：N=4000 时 σ ≈ 0.34pp ⇒ ±1.5pp 带足够宽也足够紧
    expect(rate, `永久图纸实测率 ${(rate * 100).toFixed(2)}%，应 ≈ ${WORMHOLE_BPBOX_PERMANENT_CHANCE * 100}%`).toBeGreaterThan(0.035)
    expect(rate).toBeLessThan(0.065)
  })

  it('拆解：三种货柜都能真的开出东西并入库（浅/中/深各跑一件）', () => {
    for (const id of WORMHOLE_BP_BOX_IDS) {
      const state = createInitialState({ nowWallMs: 0, seed: 9 })
      addWare(state, id, 1)
      const started = startUnboxRun(state, ctx, id, 'pilot')
      expect(started.ok, started.error).toBe(true)
      const before = JSON.stringify([state.blueprintStock, state.moduleBay, state.warehouse.items])
      state.gameMs += UNBOX_CYCLE_MS
      advanceRefining(state, ctx)
      expect(JSON.stringify([state.blueprintStock, state.moduleBay, state.warehouse.items]), `${id} 应真的开出图纸`).not.toBe(before)
    }
  })

  it('掉落：**贵重品柜 50% + 其余平分 50%**（池按层 + 按本格族；2026-09-19 两条船长令）', () => {
    /** 2026-09-15 船长：「货柜类型改为所有货柜中随机，贵重品货柜占比50%」；
     *  2026-09-19 船长：「图纸货柜·中调到5层才出，深调到7层才出」＋玩家报障「E 族虫洞出了 D 族安全货柜」后
     *  裁定「A：遗迹渠道也按本格敌卡的族取（两渠道统一）」。 */
    const counts = new Map<string, number>()
    let total = 0
    const depths = [4, 5, 6, 7]
    for (let seed = 1; seed <= 80; seed++) {
      const state = enterRun(seed)
      const run = state.wormhole.run!
      for (const depth of depths) {
        run.depth = depth
        for (const cell of run.grid!.cells) {
          const fam = familyOfCard(ctx, wormholeCellCardIdOf(run, cell))
          const pool = wormholeRelicBoxPoolOf(ctx, depth, fam)
          const id = wormholeRollRelicBox(state, ctx, cell)
          if (!id) continue
          total += 1
          counts.set(id, (counts.get(id) ?? 0) + 1)
          expect(pool, `层 ${depth} · ${fam} 族掉了池外的 ${id}`).toContain(id)
          // **安全货柜必须与格子的族一致**（玩家报障的那条）
          if (id.startsWith('box-relic-')) {
            expect(id, `层 ${depth}：${fam} 族格子掉了 ${id}`).toBe(wormholeRelicBoxIdOf(fam))
          }
        }
      }
    }
    expect(total, '样本量应足够（否则比例断言无意义）').toBeGreaterThan(300)
    const share = (id: string): number => (counts.get(id) ?? 0) / total
    // ① 贵重品货柜 ≈50%（跨层汇总）
    expect(share('box-valuables'), `贵重品柜占比 ${(share('box-valuables') * 100).toFixed(1)}%`).toBeGreaterThan(0.42)
    expect(share('box-valuables')).toBeLessThan(0.58)
    // ② 池规模随层（每池含**本族**安全柜 1 种）：层 1~4 = 4 种 · 层 5~6 = 5 种 · 层 7+ = 6 种
    for (const fam of ['A', 'C', 'D', 'E', 'G']) {
      expect(wormholeRelicBoxPoolOf(ctx, 4, fam), `层 4 · ${fam} 族池`).toHaveLength(4)
      expect(wormholeRelicBoxPoolOf(ctx, 5, fam), `层 5 · ${fam} 族池`).toHaveLength(5)
      expect(wormholeRelicBoxPoolOf(ctx, 6, fam)).toHaveLength(5)
      expect(wormholeRelicBoxPoolOf(ctx, 7, fam), `层 7 · ${fam} 族池`).toHaveLength(6)
      // 本族安全柜在池里、别族都不在（两渠道统一的那把尺）
      const pool7 = wormholeRelicBoxPoolOf(ctx, 7, fam)
      expect(pool7).toContain(wormholeRelicBoxIdOf(fam))
      for (const other of ['A', 'C', 'D', 'E', 'G'].filter((f) => f !== fam)) {
        expect(pool7, `${fam} 族的池里混进了 ${other} 族安全柜`).not.toContain(wormholeRelicBoxIdOf(other))
      }
    }
    // ③ **按层过滤**：中层只在 ≥5 露面、深层只在 ≥7 露面；浅层恒在、低层不出现高档
    expect(counts.get('box-bp-shallow') ?? 0, '浅档层 4 也该掉得出来').toBeGreaterThan(0)
    for (const id of ['box-bp-mid', 'box-bp-deep']) expect(counts.get(id) ?? 0, `${id} 一次都没掉出来`).toBeGreaterThan(0)
  })

  it('图纸柜层门槛：中 ≥5 · 深 ≥7（两条渠道同一把尺）', () => {
    /** 船长 2026-09-19：「图纸货柜·中调到5层才出，图纸货柜·深调到7层才出」；同裁定：两条渠道都管、剔除后平分 */
    const at = (d: number): string[] => wormholeBpBoxIdsForDepth(d)
    expect(at(1), '层 1 只有浅档').toEqual([WORMHOLE_BP_BOX_SHALLOW])
    expect(at(4), '层 4 仍是只有浅档').toEqual([WORMHOLE_BP_BOX_SHALLOW])
    expect(at(5), '层 5 起有中档').toEqual([WORMHOLE_BP_BOX_SHALLOW, WORMHOLE_BP_BOX_MID])
    expect(at(6), '层 6 仍无深档').toEqual([WORMHOLE_BP_BOX_SHALLOW, WORMHOLE_BP_BOX_MID])
    expect(at(7), '层 7 起三档齐').toEqual([...WORMHOLE_BP_BOX_IDS])
    expect(at(9)).toEqual([...WORMHOLE_BP_BOX_IDS])
    // 残骸堆渠道（四类等权：安全柜 / 图纸柜 / 贵重品 / 军用）——图纸柜那一类按层收窄
    const bpClass = (d: number): readonly string[] => wormholeSalvageBoxClassesOf('A', d)[1]!
    expect(bpClass(4), '层 4 的残骸堆只能翻出浅档图纸柜').toEqual([WORMHOLE_BP_BOX_SHALLOW])
    expect(bpClass(5)).toEqual([WORMHOLE_BP_BOX_SHALLOW, WORMHOLE_BP_BOX_MID])
    expect(bpClass(7)).toEqual([...WORMHOLE_BP_BOX_IDS])
    // 总出货率不变：渠道的**类数**恒为 4、遗迹概率恒 70%
    expect(wormholeSalvageBoxClassesOf('A', 4), '层 4 仍是四类').toHaveLength(4)
    expect(wormholeRelicChanceOf(4)).toBe(0.7)
    expect(wormholeRelicChanceOf(7)).toBe(0.7)
  })

  it('层 1 恒不出货柜（入口闸未变）', () => {
    const state = enterRun(5)
    const run = state.wormhole.run!
    run.depth = 1
    for (const cell of run.grid!.cells) expect(wormholeRollRelicBox(state, ctx, cell)).toBeUndefined()
  })
})
