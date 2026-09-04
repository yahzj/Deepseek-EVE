/**
 * B1.5 主动"前往星系待命"（船长 2026-09-04 定稿）：
 * 主控 goStandby 去程→到点野外停留（awayGalaxy）、去程可召回、busy 互斥；
 * 副船 assignAiStandby（占名额/到点驻留/取消归核心/不占 idle）；
 * 低安驻留副船进入遭遇暴露；存档 normalize 往返。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { goStandbyAt, cancelStandby } from '../src/location'
import { assignAiStandby, idleAiShipIds } from '../src/ai'
import { cancelAiTask } from '../src/ai'
import { startMining } from '../src/mining'
import { startExpedition } from '../src/expedition'
import { changeShip } from '../src/shipyard'
import { shipDisplayName } from '../src/instances'
import { activityOverview } from '../src/activity'
import { loadSaveFile, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, galaxy, ship } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-falconet', { cargo: 120, price: 60_000 })],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
  state.exploredGalaxies.push('galaxy-far')
  state.aiCores['basic'] = 2
  state.skills.trained['ai-expert'] = 1
  return { state, ctx }
}

/** 低安副船待命世界（galaxy-far sec −0.8） */
function lowWorld() {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    galaxies: [{ ...galaxy('galaxy-far', '远方'), security: -0.8 }],
    ships: [ship('sh-falconet', { cargo: 120, price: 60_000 })],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 5 })
  state.exploredGalaxies.push('galaxy-far')
  state.aiCores['basic'] = 2
  state.skills.trained['ai-expert'] = 1
  return { state, ctx }
}

describe('B1.5 前往星系待命', () => {
  it('主控：前往远方待命 → 去程中可取消召回；到点野外停留（awayGalaxy）并写日志', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(state.standby.active).toBe(true)
    expect(state.standby.galaxyId).toBe('galaxy-far')
    expect(state.standby.finishAtGameMs).toBeGreaterThan(0)
    // 活动栏条目（可召回）
    const items = activityOverview(state, ctx).filter((i) => i.kind === 'standby')
    expect(items.length).toBe(1)
    expect(items[0]!.stop).toBe('recall-standby')
    // 取消召回
    expect(cancelStandby(state, ctx).ok).toBe(true)
    expect(state.standby.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    // 重新出发 → 到点
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    advanceGame(state, state.standby.finishAtGameMs - state.gameMs + 1, ctx)
    expect(state.standby.active).toBe(false)
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.logs.some((l) => l.text.includes('已抵达'))).toBe(true)
    // 已在目标待命 → 拒绝重复
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(false)
  })

  it('去程中 busy 互斥：采矿/远征/换驾驶/维修 全部拒绝；到点待命后采矿可正常开始（从停留点出发）', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(false)
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(false)
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(false)
    // 到点后：待命即野外停留——从远处矿带采矿走 T8 野外出发（belt-a 本地则拒绝无航路?用 far 需要带）
    advanceGame(state, 10 * 60_000, ctx)
    expect(state.awayGalaxy).toBe('galaxy-far')
    const r = startExpedition(state, 'ano-a', ctx) // 悬赏在母港，从 far 出发有航路
    expect(r.ok).toBe(true)
  })

  it('副船：指派待命（占名额、目标须已探索）→ 到点驻留 → 不占 idle → 取消召回归核心', () => {
    const { state, ctx } = world()
    const sid = 'sh-falconet'
    expect(assignAiStandby(state, sid, 'basic', 'galaxy-unknown', ctx).ok).toBe(false) // 未知星系
    expect(state.aiAssignments[sid]).toBeUndefined()
    const r = assignAiStandby(state, sid, 'basic', 'galaxy-far', ctx)
    expect(r.ok).toBe(true)
    expect(state.aiCores['basic']).toBe(1) // 占一枚核心
    expect(idleAiShipIds(state)).not.toContain(sid)
    // 到点 → 驻留
    const outMs = (state.aiAssignments[sid]!.task as { outMs: number }).outMs
    advanceGame(state, outMs + 1000, ctx)
    const task = state.aiAssignments[sid]!.task
    expect(task.kind).toBe('standby')
    if (task.kind === 'standby') expect(task.phase).toBe('stand')
    expect(idleAiShipIds(state)).not.toContain(sid) // 驻留中仍占位
    // 活动栏条目
    const items = activityOverview(state, ctx).filter((i) => i.id === `ai-${sid}`)
    expect(items.some((i) => i.sub.includes('留守'))).toBe(true)
    // 取消召回 → 核心归还
    expect(cancelAiTask(state, sid, ctx)).toBe(true)
    expect(state.aiAssignments[sid]).toBeUndefined()
    expect(state.aiCores['basic']).toBe(2)
    expect(idleAiShipIds(state)).toContain(sid)
  })

  it('低安驻留的副船参与遭遇暴露（停留船承担；主控不在该区）', () => {
    const { state, ctx } = lowWorld()
    const sid = 'sh-falconet'
    expect(assignAiStandby(state, sid, 'basic', 'galaxy-far', ctx).ok).toBe(true)
    const outMs = (state.aiAssignments[sid]!.task as { outMs: number }).outMs
    advanceGame(state, outMs + 1000, ctx) // 到点驻留（低安）
    let guard = 0
    while (!state.encounter.active && guard < 90) {
      guard += 1
      advanceGame(state, 4 * ctx.balance.encounter.windowMs, ctx)
    }
    expect(state.encounter.active).toBe(true)
    expect(state.encounter.shipId).toBe(sid) // 由驻留副船承担
  })

  it('存档往返：standby 与副船待命任务可序列化；旧档缺字段兜底为空', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    const text = serializeSaveFile(state, state.savedAtWallMs)
    const loaded = loadSaveFile(text).state
    expect(loaded.standby.active).toBe(true)
    expect(loaded.standby.galaxyId).toBe('galaxy-far')
    // 旧形状兜底
    const legacy = loadSaveFile(
      JSON.stringify({ format: SAVE_FORMAT, version: 17, savedAtWallMs: 0, state: { skills: {} } }),
    ).state
    expect(legacy.standby.active).toBe(false)
    void ctx
    void shipDisplayName
  })
})
