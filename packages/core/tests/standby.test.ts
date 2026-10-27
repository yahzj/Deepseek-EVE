/**
 * 船长 2026-10-23：只关闭巡逻入口并遣返存量，保留原命令与位置模型。
 * 覆盖主控旧去程、到达日志辨识、副船核心归还与重复读档/推进的幂等性。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { goStandbyAt, cancelStandby } from '../src/location'
import { assignAiStandby, idleAiShipIds } from '../src/ai'
import { startExpedition } from '../src/expedition'
import { changeShip } from '../src/shipyard'
import { loadSaveFile, MIN_SUPPORTED_SAVE_VERSION, SAVE_FORMAT, serializeSaveFile } from '../src/save'
import { makeTestCtx, ship, skipFirstSkillReward } from './helpers'

function world() {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-falconet', { cargo: 120, price: 60_000 })],
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 3 })
  state.exploredGalaxies.push('galaxy-far')
  state.aiCores['basic'] = 2
  state.skills.trained['ai-expert'] = 1
  // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
  skipFirstSkillReward(state)
  return { state, ctx }
}

describe('掩护巡逻派遣关闭与存量遣返', () => {
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

  it('主控已抵达巡逻星系时自动返航，来源不明的野外位置保留', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)

    advanceGame(state, 1_000, ctx)

    expect(state.awayGalaxy).toBeNull()
    expect(state.logs.some((log) => log.textId === 'core.location.040')).toBe(true)

    const unknown = world()
    unknown.state.awayGalaxy = 'galaxy-far'
    advanceGame(unknown.state, 1_000, unknown.ctx)
    expect(unknown.state.awayGalaxy).toBe('galaxy-far')
  })

  it('之后的位置记录会覆盖较早的巡逻记录', () => {
    const { state, ctx } = world()
    expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
    state.logs.push({
      id: state.logs.length + 1,
      atGameMs: state.gameMs,
      kind: 'fleet',
      text: '已抵达「母港」——协会的建站工地就在这里。',
      textId: 'core.station.011',
      textParams: { p1: '母港' },
    })

    advanceGame(state, 1_000, ctx)

    expect(state.awayGalaxy).toBe('galaxy-far')
  })

  it.each(['core.location.035', 'core.location.055', 'core.location.056', 'core.station.010', 'core.station.011'])(
    '后续工地或停靠纠正日志 %s 不会被旧巡逻记录覆盖',
    (textId) => {
      const { state, ctx } = world()
      expect(goStandbyAt(state, 'galaxy-far', ctx).ok).toBe(true)
      state.logs.push({ id: state.logs.length + 1, atGameMs: state.gameMs, kind: 'fleet', text: '位置已更新', textId })

      advanceGame(state, 1_000, ctx)

      expect(state.awayGalaxy).toBe('galaxy-far')
    },
  )

  it('无本地化 ID 的旧巡逻日志仍可识别，星系不匹配时不遣返', () => {
    for (const matching of [true, false]) {
      const { state, ctx } = world()
      state.awayGalaxy = 'galaxy-far'
      const name = matching ? ctx.galaxies.get('galaxy-far')!.name : '其他星系'
      state.logs.push({
        id: state.logs.length + 1,
        atGameMs: state.gameMs,
        kind: 'fleet',
        text: `掩护巡逻：舰船已抵达「${name}」并留守该星系。`,
      })

      advanceGame(state, 1_000, ctx)

      expect(state.awayGalaxy).toBe(matching ? null : 'galaxy-far')
    }
  })

  it('旧主控巡逻去程在读档后下一拍立即遣返', () => {
    const { state, ctx } = world()
    state.standby = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 120_000, legMs: 120_000 }
    state.dockedSite = 'legacy-site'
    const loaded = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state

    advanceGame(loaded, 1_000, ctx)

    expect(loaded.standby.active).toBe(false)
    expect(loaded.awayGalaxy).toBeNull()
    expect(loaded.dockedSite).toBeNull()
    expect(loaded.logs.some((log) => log.textId === 'core.location.045')).toBe(true)
    const logCount = loaded.logs.filter((log) => log.textId === 'core.location.045').length
    advanceGame(loaded, 1_000, ctx)
    expect(loaded.logs.filter((log) => log.textId === 'core.location.045')).toHaveLength(logCount)
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
    advanceGame(state, 1_000, ctx)
    expect(state.expedition.active).toBe(true)
    expect(state.logs.some((log) => log.textId === 'core.location.040')).toBe(false)
  })

  it('副船上的旧巡逻任务下一拍自动召回并归还核心', () => {
    const { state, ctx } = world()
    const sid = 'sh-falconet'
    expect(assignAiStandby(state, sid, 'basic', 'galaxy-unknown', ctx).ok).toBe(false) // 未知星系
    expect(state.aiAssignments[sid]).toBeUndefined()
    const r = assignAiStandby(state, sid, 'basic', 'galaxy-far', ctx)
    expect(r.ok).toBe(true)
    expect(state.aiCores['basic']).toBe(1) // 占一枚核心
    expect(idleAiShipIds(state)).not.toContain(sid)
    advanceGame(state, 1_000, ctx)

    expect(state.aiAssignments[sid]).toBeUndefined()
    expect(state.aiCores['basic']).toBe(2)
    expect(idleAiShipIds(state)).toContain(sid)
    advanceGame(state, 1_000, ctx)
    expect(state.aiCores.basic).toBe(2)
  })

  it.each(['basic', 'gamma', 'beta', 'alpha'] as const)('已驻留副船召回只返还占用的 %s 核心一次', (coreType) => {
    const { state, ctx } = world()
    const sid = 'sh-falconet'
    const before = { ...state.aiCores }
    state.aiAssignments[sid] = {
      coreType,
      startedAtGameMs: state.gameMs,
      task: { kind: 'standby', galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs, outMs: 0, phase: 'stand' },
    }

    advanceGame(state, 1_000, ctx)
    advanceGame(state, 1_000, ctx)

    expect(state.aiAssignments[sid]).toBeUndefined()
    expect(state.aiCores).toEqual({ ...before, [coreType]: before[coreType] + 1 })
    expect(idleAiShipIds(state)).toContain(sid)
  })

  it.each(['out', 'stand'] as const)('旧副船巡逻 %s 读档归还后再次存读和推进不重复返还', (phase) => {
    const { state, ctx } = world()
    state.aiAssignments['sh-falconet'] = {
      coreType: 'gamma',
      startedAtGameMs: state.gameMs,
      task: { kind: 'standby', galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 120_000, outMs: 120_000, phase },
    }

    const loaded = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state
    const reloaded = loadSaveFile(serializeSaveFile(loaded, loaded.savedAtWallMs)).state
    advanceGame(reloaded, 1_000, ctx)

    expect(loaded.aiAssignments['sh-falconet']).toBeUndefined()
    expect(reloaded.aiAssignments['sh-falconet']).toBeUndefined()
    expect(loaded.aiCores.gamma).toBe(state.aiCores.gamma + 1)
    expect(reloaded.aiCores).toEqual(loaded.aiCores)
  })

  it('读档时遣返副船巡逻并归还核心，保留主控旧去程供引擎召回', () => {
    const { state, ctx } = world()
    state.standby = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 120_000, legMs: 120_000 }
    state.aiCores.basic = 1
    const shipId = 'sh-falconet'
    state.aiAssignments[shipId] = {
      coreType: 'basic',
      startedAtGameMs: state.gameMs,
      task: { kind: 'standby', galaxyId: 'galaxy-far', finishAtGameMs: state.gameMs + 120_000, outMs: 120_000, phase: 'out' },
    }
    const text = serializeSaveFile(state, state.savedAtWallMs)
    const loaded = loadSaveFile(text).state
    expect(loaded.standby.active).toBe(true)
    expect(loaded.standby.galaxyId).toBe('galaxy-far')
    expect(loaded.aiAssignments[shipId]).toBeUndefined()
    expect(loaded.aiCores.basic).toBe(2)
    // 旧形状兜底
    const legacy = loadSaveFile(
      JSON.stringify({ format: SAVE_FORMAT, version: MIN_SUPPORTED_SAVE_VERSION, savedAtWallMs: 0, state: { skills: {} } }),
    ).state
    expect(legacy.standby.active).toBe(false)
    void ctx
  })
})
