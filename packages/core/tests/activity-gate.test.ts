/**
 * **主控活动切换的单点判据**（`core/activityGate.ts` · 2026-09-21 船长令）。
 *
 * 钉三件事：① 三档分类（自动停 / 先警告 / 不可中断）② 状态类锁定（战斗中 · 洞里 · 返航途中）
 * ③ 副船遇袭**不**拦主控（只有打在主控船上的那一场才算）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  AUTO_HALT_KINDS,
  WARN_KINDS,
  cannotInterruptReason,
  gateMainActivity,
  mainActivityOf,
} from '../src/activityGate'

function state(): GameState {
  return createInitialState({ nowWallMs: 0, seed: 3 })
}

describe('主控活动切换：三档分类（船长 2026-09-21）', () => {
  it('主控空着 ⇒ ok；六项可直接切 ⇒ halt', () => {
    const s = state()
    expect(mainActivityOf(s)).toBeNull()
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
    for (const kind of AUTO_HALT_KINDS) {
      const st = state()
      if (kind === 'mining') st.mining.active = true
      else if (kind === 'salvaging') st.salvaging.active = true
      else if (kind === 'wormholeScan') st.wormholeScan = { ...(st.wormholeScan ?? {}), active: true } as GameState['wormholeScan']
      else if (kind === 'standby') st.standby.active = true
      else if (kind === 'refine') st.refineRuns = [{ id: 1, active: true, worker: 'pilot' } as GameState['refineRuns'][number]]
      else if (kind === 'manufacturing') st.manufacturingRuns = [{ id: 1, active: true, worker: 'pilot' } as GameState['manufacturingRuns'][number]]
      const v = gateMainActivity(st, 'hauling')
      expect(v.action, `${kind} 应可直接切`).toBe('halt')
      expect(v.current).toBe(kind)
    }
  })

  it('长途运输 ⇒ 先警告（可中断）；远征 / 快递 ⇒ 警告口径但**拒绝**（在途不可中断）', () => {
    const hauling = state()
    hauling.hauling.active = true
    const v1 = gateMainActivity(hauling, 'mining')
    expect(v1.action).toBe('confirm')
    expect(v1.interruptible).toBe(true)
    expect(v1.message).toContain('本段报酬拿不到')

    for (const kind of WARN_KINDS.filter((k) => k !== 'hauling')) {
      const s = state()
      if (kind === 'expedition') s.expedition.active = true
      else s.sideTasks.deliver = { taskId: 'x', toSiteId: null } as GameState['sideTasks']['deliver']
      const v = gateMainActivity(s, 'mining')
      expect(v.action, `${kind} 应拒`).toBe('reject')
      expect(v.interruptible).toBe(false)
      expect(v.message).toContain('不能中断')
    }
  })

  it('同一项已在跑 ⇒ ok（幂等，不自己拦自己）', () => {
    const s = state()
    s.mining.active = true
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
  })
})

describe('不可被打断的状态（船长：「处在战斗中的时候也设置为不可取消」）', () => {
  it('三处战斗槽都拦：远征实时战 / 主控船的低安遭遇战 / 洞内战', () => {
    const exp = state()
    exp.expedition.battle = {} as NonNullable<GameState['expedition']['battle']>
    expect(cannotInterruptReason(exp)).toContain('战斗中')

    const enc = state()
    enc.encounter.active = true
    enc.encounter.shipId = enc.shipId
    enc.encounter.battle = {} as NonNullable<GameState['encounter']['battle']>
    expect(cannotInterruptReason(enc)).toContain('战斗中')

    const wh = state()
    wh.wormhole.run = { battle: {} } as unknown as NonNullable<GameState['wormhole']['run']>
    expect(cannotInterruptReason(wh)).toContain('战斗中')
  })

  it('**副船**遇袭不拦主控（只有打在主控船上那一场才算）', () => {
    const s = state()
    s.encounter.active = true
    s.encounter.shipId = 'someone-else'
    s.encounter.battle = {} as NonNullable<GameState['encounter']['battle']>
    expect(cannotInterruptReason(s)).toBeNull()
    expect(gateMainActivity(s, 'mining').action).toBe('ok')
  })

  it('人在洞里 / 换港返航途中 ⇒ 拒（各有自己的理由）', () => {
    const wh = state()
    wh.wormhole.run = {} as NonNullable<GameState['wormhole']['run']>
    expect(cannotInterruptReason(wh)).toContain('虫洞')

    const tr = state()
    tr.transit.active = true
    expect(cannotInterruptReason(tr)).toContain('返航')
  })
})
