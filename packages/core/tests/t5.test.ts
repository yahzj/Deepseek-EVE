/**
 * T5-A 卖船防护：船只锁定（防误售）+ 出售守卫 + 存档往返/剪枝。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { emptyFitted } from '../src/labels'
import { isShipLocked, lockShip } from '../src/shipyard'
import { shipSellable } from '../src/market'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({ quietEvents: true })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  return { state, ctx }
}

describe('T5 船只锁定（防误售）', () => {
  it('锁定/解锁指令：校验拥有与幂等，写日志；未拥有拒绝', () => {
    const { state, ctx } = world()
    expect(state.shipLocks).toEqual({})
    // 未拥有的船
    expect(lockShip(state, 'ghost-ship', true, ctx).ok).toBe(false)
    // 锁定沙猫（驾驶中的船也可以锁：防的是误售，不影响驾驶/AI）
    expect(lockShip(state, 'sandcat', true, ctx).ok).toBe(true)
    expect(isShipLocked(state, 'sandcat')).toBe(true)
    expect(state.shipLocks['sandcat']).toBe(true)
    expect(state.logs.some((l) => l.text.includes('已锁定'))).toBe(true)
    // 重复锁定拒绝
    expect(lockShip(state, 'sandcat', true, ctx).ok).toBe(false)
    // 解锁
    expect(lockShip(state, 'sandcat', false, ctx).ok).toBe(true)
    expect(isShipLocked(state, 'sandcat')).toBe(false)
    expect(state.shipLocks).toEqual({})
    // 重复解锁拒绝
    expect(lockShip(state, 'sandcat', false, ctx).ok).toBe(false)
  })

  it('出售守卫：锁定中的船不可售（含原因），解锁后恢复（空船可直接售出条件）', () => {
    const { state, ctx } = world()
    // 附赠武装艇：停泊、无 AI、货仓空、无装配 → 本来可售
    expect(shipSellable(state, 'sh-falconet')).toEqual({ ok: true })
    expect(lockShip(state, 'sh-falconet', true, ctx).ok).toBe(true)
    const blocked = shipSellable(state, 'sh-falconet')
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('锁定')
    expect(lockShip(state, 'sh-falconet', false, ctx).ok).toBe(true)
    expect(shipSellable(state, 'sh-falconet')).toEqual({ ok: true })
  })

  it('存档：shipLocks 往返一致；normalize 只收 true 且剪掉不在舰队中的船', () => {
    const { state, ctx } = world()
    lockShip(state, 'sh-falconet', true, ctx)
    lockShip(state, 'sandcat', true, ctx)
    const text = serializeSaveFile(state, 0)
    const loaded = loadSaveFile(text)
    expect(loaded.state.shipLocks).toEqual({ 'sh-falconet': true, sandcat: true })

    // 容错：非法值忽略；幽灵船剪掉；缺失补空
    const rawText = JSON.stringify({
      format: SAVE_FORMAT,
      version: 16,
      savedAtWallMs: 0,
      state: {
        fleet: {
          sandcat: { durability: 1, cargo: {}, fitted: emptyFitted() },
        },
        shipLocks: { sandcat: true, ghost: true, falconet: false, weird: 'yes' },
      },
    })
    const loaded2 = loadSaveFile(rawText)
    expect(loaded2.state.shipLocks).toEqual({ sandcat: true })
    const rawText2 = JSON.stringify({ format: SAVE_FORMAT, version: 16, savedAtWallMs: 0, state: {} })
    expect(loadSaveFile(rawText2).state.shipLocks).toEqual({})
  })
})
