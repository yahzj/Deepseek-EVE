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
import { rollLowSecAmbush } from '../src/encounters'
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

describe('B1.5 前往星系掩护巡逻（原"待命"；去程取消，即时就位）', () => {
  it('主控：掩护巡逻即时就位（无去程等待）→ 野外停留并写日志；重复就位被拒', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    // 即时就位：船立刻在目标星系野外停留；无"去程中"状态
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.standby.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('已抵达'))).toBe(true)
    // 已就位：没有进行中的去程可取消（离开请用「返航空间站」）
    expect(cancelStandby(state, ctx).ok).toBe(false)
    // 已在目标掩护巡逻 → 拒绝重复
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(false)
  })

  it('掩护巡逻就位 = 野外停留：换驾驶被拒，但从停留点可继续出击/采矿', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(state.awayGalaxy).toBe('galaxy-far')
    // 在野外：换船/维修被拒（需返航空间站）
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(false)
    // 从停留点出击悬赏（目标在母港，有航路）→ 成功（即时开战）
    const r = startExpedition(state, 'ano-a', ctx)
    expect(r.ok).toBe(true)
    expect(state.expedition.active).toBe(true)
    expect(state.awayGalaxy).toBeNull() // 作业位置由作业自身表达
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
    advanceGame(state, 1000, ctx) // 在场记录（自该刻起算缓冲）
    advanceGame(state, ctx.balance.encounter.entryBufferMs, ctx) // 过 5 分钟缓冲
    let hit = false
    for (let i = 0; i < 200 && !hit; i += 1) hit = rollLowSecAmbush(state, ctx)
    expect(hit).toBe(true)
    expect(state.encounter.shipId).toBe(sid) // 由驻留副船承担
  })

  it('存档往返：standby 与副船掩护巡逻任务可序列化；旧档缺字段兜底为空', () => {
    const { state, ctx } = world()
    // 构造旧档样式的"去程中"状态（兼容字段仍保留；新指令即时就位不留此状态）
    state.standby = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 120_000, legMs: 120_000 }
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
