/**
 * 低安扫描规则（2026-09-05 船长拍板；2026-09-15 扫描无人化后收窄）回归：
 * ① 目标星系安全度越低扫描窗口越长（×[1+0.8×(0.5−sec)]，高安不延长）；
 * ② ~~低安扫描 = 在场暴露：无入场缓冲、遇袭概率 ×1.5~~ —— **2026-09-15 作废**（无人扫描艇 ⇒ 不暴露）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, scanWindowMsFor, SCAN_WINDOW_MS } from '../src/index'
import { rollLowSecAmbush } from '../src/encounters'

describe('低安扫描规则（2026-09-05）', () => {
  const ctx = buildSimContext()
  // GalaxyDef.security 为可选（v24 起），此处归一化为确定值
  const secs = [...ctx.galaxies.values()].map((g) => ({ id: g.id, sec: g.security ?? 1 }))

  it('扫描窗口：目标星系越不安全越久（高安不延长）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const lows = secs.filter((x) => x.sec < 0.5)
    const highs = secs.filter((x) => x.sec >= 0.5)
    expect(lows.length).toBeGreaterThan(0)
    expect(highs.length).toBeGreaterThan(0)
    const low = lows.reduce((a, b) => (b.sec < a.sec ? b : a))
    const high = highs.reduce((a, b) => (b.sec < a.sec ? b : a))
    const lowWin = scanWindowMsFor(state, ctx, low.id)
    const highWin = scanWindowMsFor(state, ctx, high.id)
    // 无技能时高安窗口 = 基准 10 分钟
    expect(highWin).toBe(SCAN_WINDOW_MS)
    // 低安按公式延长（1 + 0.8×(0.5 − sec)）
    const expectLow = Math.round(SCAN_WINDOW_MS * (1 + 0.8 * Math.max(0, 0.5 - low.sec)))
    expect(lowWin).toBe(expectLow)
    expect(lowWin).toBeGreaterThan(highWin)
  })

  /**
   * **2026-09-15 口径改判**（船长：「玩家扫描星系将不再占用玩家的主控活动」⇒ 扫描 = 派出**无人扫描艇**）：
   * 星系扫描**不再把玩家算作"就地暴露"**，故低安扫描不会再招来巡逻（旧用例「低安扫描即暴露、
   * 命中后不中断」整条作废——那时暴露对象是玩家自己的船）。低安依旧的代价只剩"扫得慢"（上一条）。
   * ⚠ 「扫描虫洞」的暴露**未动**（它仍按 `kind: '扫描'` 走同一套骰子，见 encounters.ts）。
   */
  it('低安星系扫描不再暴露：扫描中不会因扫描挨打（对照：野外驻留照旧会）', () => {
    const low = secs.filter((x) => x.sec < 0.5).reduce((a, b) => (b.sec < a.sec ? b : a))
    const rollUntilHit = (s: ReturnType<typeof createInitialState>): boolean => {
      for (let i = 0; i < 400; i++) {
        if (rollLowSecAmbush(s, ctx)) return true
        if (s.encounter.active) return true
      }
      return false
    }
    // ① 主用例：正在低安扫描（无在场记录 = 修前"扫描即暴露、不吃入场缓冲"那条路）
    const scanState = createInitialState({ nowWallMs: 0, seed: 42 })
    scanState.scanning = { active: true, galaxyId: low.id, finishAtGameMs: 0, startedAtGameMs: 0, originGalaxy: null }
    scanState.lowSecPresence = {}
    scanState.encounterZoneCooldown = {}
    expect(rollUntilHit(scanState)).toBe(false)
    expect(scanState.encounter.active).toBe(false)
    expect(scanState.scanning.active).toBe(true)
    // ② 对照（同一颗骰子、同一场景，只把暴露来源换成"野外驻留"）：照旧会被巡逻盯上
    //    ⇒ 证明①的"没挨打"是暴露口径变了，而不是这套判定本身失效
    const stayState = createInitialState({ nowWallMs: 0, seed: 42 })
    stayState.awayGalaxy = low.id
    stayState.lowSecPresence = { [low.id]: -400_000 } // 已过 5 分钟入场缓冲
    stayState.encounterZoneCooldown = {}
    expect(rollUntilHit(stayState)).toBe(true)
    expect(stayState.encounter.origin ?? '').toContain('停留')
  })
})
