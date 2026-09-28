/**
 * 通讯「沉船记录」（**2026-09-27 船长令**：「在通讯内新增一个用于记录玩家损失的舰船和舰船上有什么装配」）。
 *
 * 口径：范围 = 玩家全部舰船损失（远征 / AI 副船 / 虫洞内被击沉 / 虫洞内整队失联）；每条存
 * 基础信息 + 装配/插件/无人机快照；**留最近 30 条**（新的在前）；残骸状态由残骸账派生
 * （可打捞 / 已回收 / 已过期 / 无残骸）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet, loseShip } from '../src/shipyard'
import { WRECK_LOG_MAX, markWreckRecovered, noteWreckLog, wreckLogRowsOf } from '../src/shipWrecks'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()

/** 造一艘带装配/插件/无人机的船，并把它弄沉 */
function sinkOne(seed: number, opts: { wormhole?: number; wreckGalaxy?: string } = {}): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.shipId = uid
  const e = state.fleet[uid]!
  e.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-tac-3', null, null],
    mid: ['mod-shield-kin-2', null, null, null, null],
    low: ['mod-armor-kin-2', null],
  }
  e.plugs = ['plug-hull-1']
  e.droneLoad = { 'drone-heavy': 4 }
  loseShip(state, uid, ctx, '测试：远征失利后遭追击', opts.wreckGalaxy, {
    cause: opts.wormhole !== undefined ? 'wormhole-sunk' : 'expedition-lost',
    ...(opts.wormhole !== undefined ? { wormholeDepth: opts.wormhole } : {}),
  })
  return state
}

describe('沉船记录 · 记录与快照', () => {
  it('损失即记一条：基础信息 + 装配/插件/无人机快照都在（且删船前抓到）', () => {
    const state = sinkOne(1, { wreckGalaxy: 'g1' })
    const log = state.wreckLog!
    expect(log).toHaveLength(1)
    const e = log[0]!
    expect(e.seq).toBe(1)
    expect(e.shipName).toContain('王鲭')
    expect(e.defId).toBe('sh-sentinel')
    expect(e.cause).toBe('expedition-lost')
    expect(e.wreckGalaxyId).toBe('g1')
    expect(e.fitted?.high.filter(Boolean)).toEqual(['mod-drone-rack-3', 'mod-drone-tac-3'])
    expect(e.plugs).toEqual(['plug-hull-1'])
    expect(e.droneLoad).toEqual({ 'drone-heavy': 4 })
  })

  it('虫洞内损失也记：原因 + 层数（且没有残骸星系）', () => {
    const state = sinkOne(2, { wormhole: 3 })
    const e = state.wreckLog![0]!
    expect(e.cause).toBe('wormhole-sunk')
    expect(e.wormholeDepth).toBe(3)
    expect(e.wreckGalaxyId).toBeUndefined()
    const row = wreckLogRowsOf(state, ctx)[0]!
    expect(row.wreck).toBe('none') // 虫洞内不生成残骸
  })

  it('留最近 30 条：新的在前，超出的丢最旧', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    for (let i = 0; i < WRECK_LOG_MAX + 3; i++) {
      noteWreckLog(state, {
        seq: i + 1,
        shipId: `s${i}`,
        shipName: `船${i}`,
        cause: 'expedition-lost',
        atGameMs: i,
      })
    }
    const log = state.wreckLog!
    expect(log).toHaveLength(WRECK_LOG_MAX)
    expect(log[0]!.seq).toBe(WRECK_LOG_MAX + 3) // 最新在前
    expect(log[log.length - 1]!.seq).toBe(4) // 最旧三条被丢掉
  })
})

describe('沉船记录 · 残骸状态（读残骸账派生）', () => {
  it('有残骸 ⇒ 可打捞；标已回收 ⇒ 已回收；都没有 ⇒ 已过期', () => {
    const state = sinkOne(4, { wreckGalaxy: 'g1' })
    const uid = state.wreckLog![0]!.shipId
    state.shipWrecks = {
      [uid]: {
        seq: 1,
        galaxyId: 'g1',
        shipId: uid,
        name: '测试残骸',
        fitted: { high: [], mid: [], low: [] },
        density: 1,
        decayAccMs: 0,
        createdAtWallMs: 0,
      },
    }
    expect(wreckLogRowsOf(state, ctx)[0]!.wreck).toBe('salvageable')
    expect(wreckLogRowsOf(state, ctx)[0]!.leftMs).toBeGreaterThan(0)

    // 捞走：残骸账删键 + 记录标已回收
    delete state.shipWrecks![uid]
    markWreckRecovered(state, uid)
    expect(wreckLogRowsOf(state, ctx)[0]!.wreck).toBe('recovered')

    // 过期：残骸没了、也没标已回收
    state.wreckLog![0]!.recovered = undefined
    expect(wreckLogRowsOf(state, ctx)[0]!.wreck).toBe('expired')
  })
})

describe('沉船记录 · 存档往返', () => {
  it('存读一个来回：条数、装配、插件、无人机、残骸状态都不丢', () => {
    const state = sinkOne(5, { wreckGalaxy: 'g1' })
    const text = serializeSaveFile(state)
    const back = loadSaveFile(text)
    const log = back.state.wreckLog ?? []
    expect(log).toHaveLength(1)
    const e = log[0]!
    expect(e.shipName).toBe(state.wreckLog![0]!.shipName)
    expect(e.cause).toBe('expedition-lost')
    expect(e.fitted?.high.filter(Boolean)).toEqual(['mod-drone-rack-3', 'mod-drone-tac-3'])
    expect(e.plugs).toEqual(['plug-hull-1'])
    expect(e.droneLoad).toEqual({ 'drone-heavy': 4 })
    expect(back.state.wreckLogSeq).toBe(1)
  })
})
