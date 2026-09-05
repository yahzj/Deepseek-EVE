/**
 * 低安扫描规则（2026-09-05 船长拍板）回归：
 * ① 目标星系安全度越低扫描窗口越长（×[1+0.8×(0.5−sec)]，高安不延长）；
 * ② 低安扫描 = 在场暴露：无入场缓冲、遇袭概率 ×1.5，命中后扫描作业不中断。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, scanWindowMsFor, SCAN_WINDOW_MS } from '../src/index'
import { rollLowSecAmbush } from '../src/encounters'

describe('低安扫描规则（2026-09-05）', () => {
  const ctx = buildSimContext()

  it('扫描窗口：目标星系越不安全越久（高安不延长）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const lows = [...ctx.galaxies.values()].filter((g) => g.security < 0.5)
    const highs = [...ctx.galaxies.values()].filter((g) => g.security >= 0.5)
    expect(lows.length).toBeGreaterThan(0)
    expect(highs.length).toBeGreaterThan(0)
    const low = lows.reduce((a, b) => (a.security < b.security ? a : b))
    const high = highs.reduce((a, b) => (a.security < b.security ? a : b))
    const lowWin = scanWindowMsFor(state, ctx, low.id)
    const highWin = scanWindowMsFor(state, ctx, high.id)
    // 无技能时高安窗口 = 基准 10 分钟
    expect(highWin).toBe(SCAN_WINDOW_MS)
    // 低安按公式延长（1 + 0.8×(0.5 − sec)）
    const expectLow = Math.round(SCAN_WINDOW_MS * (1 + 0.8 * Math.max(0, 0.5 - low.security)))
    expect(lowWin).toBe(expectLow)
    expect(lowWin).toBeGreaterThan(highWin)
  })

  it('低安扫描即暴露：无入场缓冲可遇袭，命中后扫描作业不中断', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const low = [...ctx.galaxies.values()].filter((g) => g.security < 0.5).reduce((a, b) => (a.security < b.security ? a : b))
    state.scanning = { active: true, galaxyId: low.id, finishAtGameMs: 0, startedAtGameMs: 0, originGalaxy: null }
    state.lowSecPresence = {} // 无在场记录 → 普通暴露会被 5 分钟缓冲拦下；扫描应不受限
    state.encounterZoneCooldown = {}
    let hit = false
    for (let i = 0; i < 400 && !state.encounter.active; i++) {
      if (rollLowSecAmbush(state, ctx)) {
        hit = true
        break
      }
    }
    expect(hit).toBe(true)
    expect(state.encounter.active).toBe(true)
    expect(state.encounter.origin).toContain('扫描')
    expect(state.scanning.active).toBe(true) // 扫描作业不中断
  })
})
