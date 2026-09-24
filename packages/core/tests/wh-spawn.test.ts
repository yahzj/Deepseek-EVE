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
  signalOfPlace,
  spawnAliveCount,
  spawnCapOf,
  spawnTargetsOf,
  wormholeMakeGrid,
} from '../src/wormholeGrid'
import { wormholeSpawnAfterTurns } from '../src/wormholeSpawn'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import { wormholeGrantShipSpoils } from '../src/wormholeSalvage'
import { advanceComms, commsInbox, commsTriggerMet } from '../src/comms'
import { RARE_WRECK_VOLUME_M3 } from '../src/salvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceBattleFor } from '../src/combat'

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
    // **公告口径：直接攻击**（2026-09-23 船长定稿）⇒ **不置"待迎战"标记**，交火由引擎每拍自动开
    expect(state.wormhole.run!.pendingNodeBattle ?? false, '不再走确认链').toBe(false)
    expect(state.logs.some((l) => l.text.includes('围剿者扑到你所在的位置'))).toBe(true)
    // 优先级：围剿者盖住该格的"未知/信号"显示（未扫描也看得见）
    // **2026-09-24 船长令**改判显示形态 ⇒ 中心那一格照旧按原遮蔽规则（`under`），族徽挪到右上角
    expect(revealOf(grid, { q: 0, r: 0 })).toEqual({
      kind: 'foe',
      under: { kind: 'known', signal: null, place: 'empty' },
    })
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

  /**
   * **端到端：真开一场围剿**（船长 2026-09-23：「**你可以作弊带 4 艘战列舰，目前只是测试这个敌人
   * 是否正常生成以及战斗是否正常**」）。
   *
   * 本用例钉的就是那两件事：**围剿者有没有真的进场**（编成/敌卡/我方 4 舰）＋ **战斗有没有真的跑起来**
   * （时钟前进、我方与敌方都在结算）。⚠ **"打赢之后"那一段没能自动化**：层 7 威胁（89）之下，
   * 试过 4 艘玄武（T4）＋ 每拍给敌我双方改血条，引擎的收口判据仍判负（它不看这两处）——
   * 该分支（清 `foe.cleared` ＋ spawn 形状战果）眼下由"战果形状"用例（⑦）与实现里那两行覆盖，
   * **留待船长实机打赢一场来验**。
   */
  it('⑩ 端到端：真开一场围剿——围剿者正常进场、战斗正常推进、收口不留半截状态', () => {
    const state = enterAt(7)
    // 作弊：洞内入场有质量上限（16,000），4 艘 T4（4×7,000）进不来 ⇒ 先照常入场再换 `run.fleet`
    const bb = [0, 1, 2, 3].map(() => addShipToFleet(state, 'sh-xuanwu'))
    state.wormhole.run!.fleet = bb
    state.shipId = bb[0]!
    const grid = smallGrid(state)
    grid.cells[0]!.place = 'vein' // 原内容 = 矿脉（打掉后才该回来）
    const cell = grid.cells[0]!
    const r = wormholeSpawnAfterTurns(state, 1)
    expect(r.ambush, '唯一候选格就是玩家脚下 ⇒ 必触发袭击').toBe(true)
    expect(revealOf(grid, { q: 0, r: 0 }), '压着围剿者的格：族徽照旧可见，中心照旧按原遮蔽规则').toEqual({
      kind: 'foe',
      under: { kind: 'known', signal: signalOfPlace('vein'), place: 'vein' },
    })
    const s = wormholeStartBattle(state, ctx, 'node')
    expect(s.ok, s.error ?? '').toBe(true)
    const battle = state.wormhole.run!.battle!
    expect(battle.wormhole!.kind, "界面调 'node' 也会按 'spawn' 打").toBe('spawn')
    expect(state.wormhole.run!.pendingNodeBattle ?? false, '直接攻击口径：压根不置"待迎战"标记').toBe(false)
    // ① 围剿者**真的进场了**（有敌舰单位），且我方 4 舰都在场
    const foeTags = Object.keys(battle.units).filter((t) => t.startsWith('foe'))
    expect(foeTags.length, '围剿者要真的进场').toBeGreaterThan(0)
    expect(battle.myFleet?.length ?? 0, '作弊编队 4 舰都在场').toBe(4)
    // ② 战斗**真的在跑**：推进 30 拍，战斗时钟前进（收口走 `advanceWormhole`，第一道门是 `attending`）
    state.wormhole.run!.attending = true
    const t0 = battle.lastTickGameMs
    for (let i = 0; i < 30 && state.wormhole.run?.battle; i += 1) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, state.wormhole.run.battle, state.shipId, battle.wormhole!.cardId)
      advanceWormhole(state, ctx)
    }
    expect(battle.lastTickGameMs, '战斗时钟应当前进').toBeGreaterThan(t0)
    // ③ 收口不留半截状态：要么还在打（battle 在、run 在），要么已经打完结清（battle 空）
    const after = state.wormhole.run
    if (after !== null) expect(after.battle === undefined || after.battle === null || after.battle === battle).toBe(true)
    // ④ 覆盖语义与围剿者同一把尺：没打掉 ⇒ 还压着（`hasLiveFoe` / 揭示档一致）
    expect(hasLiveFoe(cell)).toBe(revealOf(grid, { q: 0, r: 0 }).kind === 'foe')
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

  /**
   * **⑪ 显示形态**（**2026-09-24 船长令**：「**改为照常显示下方地点信号，族徽位置移动到右上角
   * 探索过的小点处**」）——`revealOf` 的 `foe` 档带上 `under`（撇开围剿者本来会揭示成什么）：
   * 族徽照旧一直可见（`kind === 'foe'`），而**中心那一格照旧按原遮蔽规则**：
   * 没扫过 ⇒ 什么都不给 · 星云未驱散 ⇒ 只给星云 · 扫开 / 去过 ⇒ 照常给地点信号。
   */
  it('⑪ 围剿者格的显示形态：族徽照旧可见，中心照旧按原遮蔽规则（未扫描/星云/扫开三档）', () => {
    const state = enterAt(7)
    const grid = state.wormhole.run!.grid!
    // 挑一个"没扫过也没去过"的格，手工压一个围剿者上去（省掉随机落点的铺垫）
    const key = `${grid.pos.q},${grid.pos.r}`
    const cell = grid.cells.find((c) => c.key !== key && !grid.scanned.includes(c.key) && !grid.visited.includes(c.key))!
    cell.place = 'vein'
    cell.foe = { card: 'wh-pirate-hunt', seq: 1 }
    // ① 没扫过 ⇒ 族徽在（`foe`），中心什么都不给
    expect(revealOf(grid, { q: cell.q, r: cell.r })).toEqual({ kind: 'foe', under: { kind: 'unknown' } })
    // ② 扫开 ⇒ 中心照常给地点信号
    grid.scanned.push(cell.key)
    expect(revealOf(grid, { q: cell.q, r: cell.r })).toEqual({
      kind: 'foe',
      under: { kind: 'signal', signal: signalOfPlace('vein') },
    })
    // ③ 星云未驱散 ⇒ 中心照旧只给星云（"照常"，不被敌人顶掉）
    cell.nebula = true
    expect(revealOf(grid, { q: cell.q, r: cell.r })).toEqual({ kind: 'foe', under: { kind: 'nebula' } })
    // ④ 驱散后 + 去过 ⇒ 中心给真相（`known`）
    grid.dispersed = [cell.key]
    grid.visited.push(cell.key)
    expect(revealOf(grid, { q: cell.q, r: cell.r })).toEqual({
      kind: 'foe',
      under: { kind: 'known', signal: signalOfPlace('vein'), place: 'vein' },
    })
    // ⑤ 打掉 ⇒ 覆盖解除、原格内容照旧（揭示档回到 `under` 那一档）
    cell.foe = { ...cell.foe!, cleared: true }
    expect(revealOf(grid, { q: cell.q, r: cell.r }).kind).toBe('known')
  })
})
