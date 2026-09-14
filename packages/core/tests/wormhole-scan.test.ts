/**
 * **虫洞扫描（发现线）**（船长 2026-09-14：「新增主控活动：'扫描虫洞'…进度条满后…发现一个虫洞。
 * 玩家最多可以囤积5个未开始探索的虫洞」「扫描基准设定为220分钟，同时享受信号分析学，星图测绘学，
 * 信号过滤学的影响」「遇袭不中断扫描」「信号分析学，星图测绘学，信号过滤学的rank分别修改为3-4-5」）。
 *
 * 锁住五条口径：
 * ① 窗口 = 220 分钟 × 三技能乘算（不练 = 220 分钟；练满 = ≈89 分钟）；
 * ② 主控活动互斥（采矿/打捞/扫描/远征/航行/待命/在洞内 都不许开扫）；
 * ③ 推进：满一个窗口发现一处进库存，**连续跨窗可连出**（离线大步长）；
 * ④ **库存上限 5**：满则**扫描停机**并写一条提示（不静默白跑）；
 * ⑤ 随档往返 + 坏值清洗（非法条目丢弃、超出上限截断）；
 * ⑥ 三项扫描技能的 `rank` 按船长口径为 3 / 4 / 5。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, ITEMS, SKILLS } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter } from '../src/wormhole'
import {
  WORMHOLE_SCAN_BASE_MS,
  WORMHOLE_SCAN_UNLOCK_STANDING,
  WORMHOLE_STOCK_MAX,
  advanceWormholeScan,
  wormholeScanBlockReason,
  wormholeScanStart,
  wormholeScanStop,
  wormholeScanWindowMs,
  wormholeStockFull,
  wormholeStockOf,
} from '../src/wormholeScan'

const ctx = buildSimContext()
const T3 = 'sh-thresher'
void ITEMS

function fresh(seed = 4242): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  /**
   * 扫本文件的用例只管"扫描机制"（窗口/互斥/续扫/离线连出/库存满/往返），
   * **解锁门槛另有专测**（`wormhole-unlock.test.ts`：协会声望 < 35 一律拦）⇒ 这里直接把声望垫到达标。
   */
  state.standings['dsi'] = WORMHOLE_SCAN_UNLOCK_STANDING
  return state
}

/** 把三项扫描技能练到 Lv（船长新 rank 上限：分析 3 / 测绘 4 / 过滤 5） */
function trainScanSkills(state: GameState, aLv: number, bLv: number, cLv: number): void {
  state.skills.trained['signal-analysis'] = aLv
  state.skills.trained['signal-filtering'] = bLv
  state.skills.trained['cartography'] = cLv
}

describe('虫洞 · 扫描虫洞（主控活动）', () => {
  it('**窗口 = 220 分钟 × 三技能乘算**（不练 220 分钟；三技能满级 ≈89 分钟）', () => {
    const state = fresh()
    expect(WORMHOLE_SCAN_BASE_MS).toBe(220 * 60_000)
    expect(wormholeScanWindowMs(state)).toBe(WORMHOLE_SCAN_BASE_MS)
    // 世界 0 分钟 → 满级（−8%×3 · −6%×5 · −6%×4 乘算）：220 × 0.76 × 0.70 × 0.76 ≈ 89 分钟
    trainScanSkills(state, 3, 4, 5)
    const min = wormholeScanWindowMs(state)
    expect(min).toBeLessThan(95 * 60_000)
    expect(min).toBeGreaterThan(85 * 60_000)
    // 单练一项也缩短（乘算叠加）
    const state2 = fresh()
    trainScanSkills(state2, 3, 0, 0)
    expect(wormholeScanWindowMs(state2)).toBeLessThan(WORMHOLE_SCAN_BASE_MS)
  })

  it('**三项扫描技能的 rank = 3 / 4 / 5**（船长 2026-09-14 口径）', () => {
    const byId = (id: string): number => SKILLS.find((s) => s.id === id)!.rank
    expect(byId('signal-analysis')).toBe(3)
    expect(byId('cartography')).toBe(4)
    expect(byId('signal-filtering')).toBe(5)
  })

  it('**主控活动互斥**：采矿/打捞/远征/航行/待命/在洞内 都不许开扫', () => {
    const a = fresh()
    expect(wormholeScanStart(a, ctx).ok).toBe(true)
    expect(wormholeScanStart(a, ctx).ok).toBe(false) // 已经在扫
    a.mining.active = true
    const b = fresh()
    b.mining.active = true
    expect(wormholeScanBlockReason(b) ?? '').toContain('采矿')
    const c = fresh()
    c.salvaging.active = true
    expect(wormholeScanBlockReason(c) ?? '').toContain('打捞')
    const d = fresh()
    d.scanning.active = true
    expect(wormholeScanBlockReason(d) ?? '').toContain('扫描星系')
    const e = fresh()
    e.expedition.active = true
    expect(wormholeScanBlockReason(e) ?? '').toContain('远征')
    const f = fresh()
    const uid = addShipToFleet(f, T3)
    f.shipId = uid
    expect(wormholeEnter(f, ctx, [uid], 9).ok).toBe(true)
    expect(wormholeScanBlockReason(f)).not.toBeNull() // 人在洞里
  })

  it('**停扫保留进度**（下次接着扫，不清零）', () => {
    const state = fresh()
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    advanceWormholeScan(state, ctx, 30 * 60_000)
    expect(state.wormholeScan!.progressMs).toBe(30 * 60_000)
    expect(wormholeScanStop(state).ok).toBe(true)
    expect(state.wormholeScan!.active).toBe(false)
    expect(state.wormholeScan!.progressMs).toBe(30 * 60_000)
    // 续扫：进度还在
    expect(wormholeScanStart(state, ctx).ok).toBe(true)
    advanceWormholeScan(state, ctx, wormholeScanWindowMs(state) - 30 * 60_000)
    expect(wormholeStockOf(state)).toHaveLength(1)
  })

  it('**满一个窗口发现一处**；离线大步长可连出（跨多窗）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    const w = wormholeScanWindowMs(state)
    advanceWormholeScan(state, ctx, w - 1000)
    expect(wormholeStockOf(state)).toHaveLength(0)
    advanceWormholeScan(state, ctx, 1000)
    expect(wormholeStockOf(state)).toHaveLength(1)
    // 一次跨 3 个窗口 ⇒ 再出 3 处（累计 4）
    advanceWormholeScan(state, ctx, w * 3)
    expect(wormholeStockOf(state)).toHaveLength(4)
    // 每处都带种子 + **起始层恒 1**（船长 2026-09-14：「所有虫洞都是从1层开始探索」）
    for (const item of wormholeStockOf(state)) {
      expect(item.seed).toBeGreaterThan(0)
      expect(item.depth).toBe(1)
    }
  })

  it('**库存上限 5 ⇒ 扫描停机并提示**（不静默白跑）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    const w = wormholeScanWindowMs(state)
    advanceWormholeScan(state, ctx, w * 5) // 连出 5 处（正好到上限）
    expect(wormholeStockOf(state)).toHaveLength(WORMHOLE_STOCK_MAX)
    expect(wormholeStockFull(state)).toBe(true)
    expect(state.wormholeScan!.active).toBe(true) // 还没停机（第 6 个窗口才撞上限）
    advanceWormholeScan(state, ctx, w)
    expect(state.wormholeScan!.active).toBe(false) // 停机
    expect(wormholeStockOf(state)).toHaveLength(WORMHOLE_STOCK_MAX)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('扫描停机'))).toBe(true)
    // 满仓时也不许再开扫（给的是"先去探索掉一处"）
    expect(wormholeScanBlockReason(state) ?? '').toContain('囤积')
  })

  it('**随档往返 + 坏值清洗**（可选字段 ⇒ 零迁移）', () => {
    const state = fresh()
    wormholeScanStart(state, ctx)
    advanceWormholeScan(state, ctx, wormholeScanWindowMs(state))
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(back.wormholeScan!.active).toBe(true)
    expect(back.wormholeStock).toHaveLength(1)
    expect(back.wormholeStock![0]!.seed).toBe(wormholeStockOf(state)[0]!.seed)
    // 坏值：非法条目丢弃；超出上限截断
    const raw = JSON.parse(serializeSaveFile(state, 1)) as Record<string, unknown>
    const st = raw.state as Record<string, unknown>
    st.wormholeStock = [
      { id: '', seed: 5, depth: 1, foundAtGameMs: 0 },
      { id: 'ok', seed: 0, depth: 1, foundAtGameMs: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, seed: 100 + i, depth: 2, foundAtGameMs: 0 })),
    ]
    st.wormholeScan = { active: 'yes', progressMs: -5 }
    const cleaned = loadSaveFile(JSON.stringify(raw)).state
    expect(cleaned.wormholeStock).toHaveLength(WORMHOLE_STOCK_MAX) // 只留合法条目、且截到上限
    expect(cleaned.wormholeStock!.every((x) => x.id.startsWith('x'))).toBe(true)
    // 旧档里的起始层 2/3（上面这批就是 depth: 2）**载入时一律归 1**
    expect(cleaned.wormholeStock!.every((x) => x.depth === 1)).toBe(true)
    expect(cleaned.wormholeScan).toEqual({ active: false, progressMs: 0 })
  })
})
