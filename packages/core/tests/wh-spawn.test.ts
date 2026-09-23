/**
 * **虫洞 · 围剿者（2026-09-23 船长新机制：第 7 层起逐回合刷怪）**。
 *
 * 船长原话：「**WORMHOLE_THREAT_GROWTH回调到1.2，然后推出新机制，7层开始，玩家每行经过一回合，
 * 就在地图随机格子刷出一个敌人，采用类似星云的方式覆盖在原格子之上。敌人不会刷在下一层入口格，
 * 敌人有概率刷到玩家当前格，如果刷到玩家当前格就触发袭击事件。**」
 * ＋「**用敌族族徽做图标覆盖该格子**」「**这个敌人会直接覆盖星云的效果**」
 * ＋「**当玩家第一次进入七层是，给玩家发一则通讯讲清楚敌人开始围剿玩家了，并介绍机制**」。
 *
 * 本文件锁住八条：① 层 1~6 一个字不写 · ② 层 ≥7 每消耗 1 回合刷 1 个 ·
 * ③ 上限 = 格数 × 50% · ④ 不刷下一层入口格、不刷还没清掉的舰船信号格 ·
 * ⑤ 刷到玩家当前格 ⇒ 袭击（先确认：`pendingNodeBattle`）· ⑥ 开战自动改用围剿者的卡 ·
 * ⑦ 战果形状（围剿 = 1 堆普通、不给稀有件）· ⑧ 存档往返与老档零迁移。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeGridState } from '../src/wormholeGrid'
import {
  WORMHOLE_SPAWN_CAP_SHARE,
  hasLiveFoe,
  revealOf,
  spawnAliveCount,
  spawnCapOf,
  spawnTargetsOf,
  wormholeMakeGrid,
} from '../src/wormholeGrid'
import { wormholeSpawnAfterTurns } from '../src/wormholeSpawn'
import { wormholeStartBattle } from '../src/wormholeBattle'
import { wormholeGrantShipSpoils } from '../src/wormholeSalvage'
import { advanceComms, commsInbox, commsTriggerMet } from '../src/comms'
import { RARE_WRECK_VOLUME_M3 } from '../src/salvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/** 起一趟并把玩家放到**指定层**（网格照该层现造；层 7 = R5 · 91 格） */
function enterAt(depth: number, seed = 7): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, T3)
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], seed).ok).toBe(true)
  const run = state.wormhole.run!
  run.depth = depth
  run.grid = wormholeMakeGrid(seed, depth)
  // 摆一个"压着围剿者"的最小盘面用时另造（见下方 smallGrid）
  return state
}

/** 只有两格的盘：玩家当前格 + 下一层入口 ⇒ 唯一候选格就是玩家脚下那一格（用来逼出"袭击"） */
function smallGrid(state: GameState): WormholeGridState {
  const grid: WormholeGridState = {
    radius: 1,
    start: { q: 0, r: 0 },
    exit: { q: 1, r: 0 },
    pos: { q: 0, r: 0 },
    scanRadius: 1,
    scanned: ['0,0'],
    visited: ['0,0'],
    activated: [],
    cells: [
      { key: '0,0', q: 0, r: 0, place: 'empty' },
      { key: '1,0', q: 1, r: 0, place: 'empty' },
    ],
  }
  state.wormhole.run!.grid = grid
  return grid
}

describe('虫洞 · 围剿者（第 7 层起逐回合刷怪 · 2026-09-23 船长令）', () => {
  it('① 层 1~6 一个字都不写：扣回合不刷怪、盘面一个 foe 都没有', () => {
    for (const depth of [1, 4, 6]) {
      const state = enterAt(depth)
      const grid = state.wormhole.run!.grid!
      const r = wormholeSpawnAfterTurns(state, 3)
      expect(r.spawned, `层 ${depth} 不该刷`).toBe(0)
      expect(spawnAliveCount(grid)).toBe(0)
      expect(grid.spawnSeq ?? 0).toBe(0)
    }
  })

  it('② 层 7 起：每消耗 1 回合刷 1 个（扣 3 回合 ⇒ 3 个），落点带卡与序号', () => {
    const state = enterAt(7)
    const grid = state.wormhole.run!.grid!
    const r = wormholeSpawnAfterTurns(state, 3)
    expect(r.spawned).toBe(3)
    expect(spawnAliveCount(grid)).toBe(3)
    expect(grid.spawnSeq).toBe(3)
    for (const cell of grid.cells.filter(hasLiveFoe)) {
      expect(cell.foe!.card.length).toBeGreaterThan(0)
      expect(cell.foe!.cleared).toBeUndefined()
    }
  })

  it('③ 上限 = 格数 × 50%：刷到满就不再刷，打掉一个才腾名额', () => {
    const state = enterAt(7)
    const grid = state.wormhole.run!.grid!
    const cap = spawnCapOf(grid)
    expect(cap).toBe(Math.floor(grid.cells.length * WORMHOLE_SPAWN_CAP_SHARE))
    wormholeSpawnAfterTurns(state, cap + 40) // 一次刷超过上限
    expect(spawnAliveCount(grid)).toBe(cap)
    // 打掉一个 ⇒ 候选格与名额都回来
    const victim = grid.cells.find(hasLiveFoe)!
    victim.foe = { ...victim.foe!, cleared: true }
    expect(spawnTargetsOf(grid).some((c) => c.key === victim.key)).toBe(true)
    expect(wormholeSpawnAfterTurns(state, 1).spawned).toBe(1)
  })

  it('④ 不刷下一层入口格；也不刷"还没清掉的舰船信号格"（清掉过的可以再被占）', () => {
    const state = enterAt(7)
    const grid = state.wormhole.run!.grid!
    // 造两个"有敌人"的格：一个未清的舰船信号、一个已清的舰船信号
    const uncleared = grid.cells.find((c) => c.key !== `${grid.exit.q},${grid.exit.r}`)!
    uncleared.place = 'ship'
    const cleared = grid.cells.find((c) => c.key !== uncleared.key && c.key !== `${grid.exit.q},${grid.exit.r}`)!
    cleared.place = 'ship'
    grid.activated.push(cleared.key)
    wormholeSpawnAfterTurns(state, spawnCapOf(grid) + 10)
    const exitKey = `${grid.exit.q},${grid.exit.r}`
    expect(grid.cells.find((c) => c.key === exitKey)!.foe, '入口格不许被占').toBeUndefined()
    expect(hasLiveFoe(uncleared), '没清掉的舰船信号格不许被占').toBe(false)
    expect(hasLiveFoe(cleared), '已清掉的旧敌人格可以被占').toBe(true)
  })

  it('⑤ 刷到玩家当前格 ⇒ 袭击：置 `pendingNodeBattle`（先确认、再迎战）＋ 一条日志', () => {
    const state = enterAt(7)
    const grid = smallGrid(state)
    const r = wormholeSpawnAfterTurns(state, 1)
    expect(r.spawned).toBe(1)
    expect(r.ambush).toBe(true)
    expect(hasLiveFoe(grid.cells[0]!)).toBe(true)
    expect(state.wormhole.run!.pendingNodeBattle).toBe(true)
    expect(state.logs.some((l) => l.text.includes('围剿者扑到你所在的位置'))).toBe(true)
    // 优先级：围剿者盖住该格的"未知/信号"显示（未扫描也看得见）
    expect(revealOf(grid, { q: 0, r: 0 })).toEqual({ kind: 'foe' })
  })

  it('⑥ 开战自动改用围剿者的卡：界面照旧调 `node`，本场按 `spawn` 用途打', () => {
    const state = enterAt(7)
    const grid = smallGrid(state)
    wormholeSpawnAfterTurns(state, 1)
    const cell = grid.cells[0]!
    state.wormhole.run!.pendingNodeBattle = false
    const r = wormholeStartBattle(state, ctx, 'node')
    expect(r.ok, r.error ?? '').toBe(true)
    expect(state.wormhole.run!.battle?.wormhole?.cardId).toBe(cell.foe!.card)
    expect(state.wormhole.run!.battle?.wormhole?.kind).toBe('spawn')
  })

  it('⑦ 战果形状：围剿 = 1 堆普通、不给稀有件；普通节点 = 2 堆 + 2 件稀有', () => {
    const mk = (): GameState => {
      const s = enterAt(7)
      const grid = smallGrid(s)
      grid.cells[0]!.place = 'ship'
      return s
    }
    const spawnState = mk()
    const spawnRes = wormholeGrantShipSpoils(spawnState, ctx, 'spawn')
    const spawnPiles = spawnState.wormhole.run!.grid!.cells[0]!.piles ?? []
    const rareUnits = (s: GameState): number =>
      [...(s.wormhole.run!.grid!.cells[0]!.piles ?? []), ...s.wormhole.run!.bag]
        .filter((p) => p.itemId.includes('rare'))
        .reduce((n, p) => n + p.units, 0)
    expect(spawnRes.bagged + spawnRes.leftOnCell).toBeGreaterThanOrEqual(1)
    expect(rareUnits(spawnState), '围剿不给稀有件').toBe(0)

    const nodeState = mk()
    wormholeGrantShipSpoils(nodeState, ctx, 'node')
    // 稀有残骸 1 件 = `RARE_WRECK_VOLUME_M3`（30）单位：2 件 = 60 单位（同类在背包里叠加成一格）
    expect(rareUnits(nodeState), '普通节点 2 件稀有').toBe(2 * RARE_WRECK_VOLUME_M3)
  })

  it('⑧ 通讯：首次下到第 7 层置位 ⇒ 围剿通报送达；老档零迁移', () => {
    const state = enterAt(7)
    expect(commsTriggerMet(state, ctx, { kind: 'wormholeSiege' })).toBe(false)
    state.wormhole.siegeHintShown = true
    expect(commsTriggerMet(state, ctx, { kind: 'wormholeSiege' })).toBe(true)
    advanceComms(state, ctx)
    expect(commsInbox(state, ctx).map((m) => m.id)).toContain('msg-wh-siege')
  })

  it('⑨ 存档往返：围剿者（格上 foe）与序号一起过档；老档缺字段照旧能用', () => {
    const state = enterAt(7)
    wormholeSpawnAfterTurns(state, 2)
    const before = state.wormhole.run!.grid!.cells.filter(hasLiveFoe).map((c) => [c.key, c.foe!.card, c.foe!.seq])
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    const grid = back.wormhole.run!.grid!
    const after = grid.cells.filter(hasLiveFoe).map((c) => [c.key, c.foe!.card, c.foe!.seq])
    expect(after).toEqual(before)
    expect(grid.spawnSeq).toBe(2)
    // 老档（没有 foe / spawnSeq）读进来不报错，且照常能刷
    const raw = JSON.parse(serializeSaveFile(state, 1)) as { state: { wormhole: { run: { grid: Record<string, unknown> } } } }
    delete raw.state.wormhole.run.grid.spawnSeq
    const legacy = loadSaveFile(JSON.stringify(raw)).state
    expect(legacy.wormhole.run!.grid!.spawnSeq).toBeUndefined()
    expect(wormholeSpawnAfterTurns(legacy, 1).spawned).toBe(1)
  })
})
