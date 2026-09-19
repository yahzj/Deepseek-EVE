/**
 * **洞内战斗倍速时间轴**用例（船长 2026-09-19 · 谜质科技「时间压缩矩阵」）。
 *
 * 口径（船长原话 + 工作文档 §三.5）：
 * - 时间压缩矩阵 **1 级 ×2 · 2 级 ×4**，**只作用于洞内战斗**；
 * - **只在前台心跳生效**：离线 / 后台结算 / 工具 / 用例不传档位 ⇒ 一律 1×；
 * - **1× 逐字等价**（倍速之前的老路径）；**演出照原速**——入场动画 / 波次转场 / 击杀慢镜的
 *   **保护窗口按倍速等比放大**（窗口写在战斗时钟上 ⇒ 真实时长不变）；
 * - 未解锁时传再大的档位也**夹回 1×**；**中途切档不跳变**（只折算"从锚点起的增量"）。
 *
 * 本文件钉的正是上面这五条：只有第一条与第三条有"读数"（快了多少 / 窗口多长），
 * 其余都是**等价性**判据（与老口径逐字对比）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceGame } from '../src/engine'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { researchMatterTech, MATTER_TECH_ESSENCE_ITEM_ID } from '../src/matterTech'
import { BATTLE_ARRIVAL_FLY_MS, battleShowWindowMs, battleSpeedOf } from '../src/combat'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

/**
 * 起一趟并**开一场节点战**，`techLevel` = 时间压缩矩阵已研究级数（0 = 未解锁）。
 * 备足谜质与信用点，前置链（锚定器 2 级 → 滤波阵列 1 级）由用例自动点。
 */
function battleReady(techLevel = 0, seed = 77): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  addWare(state, MATTER_TECH_ESSENCE_ITEM_ID, 999)
  state.wallet.isk = 99_000_000_000
  const a = addShipToFleet(state, T3)
  const b = addShipToFleet(state, T3)
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a, b], seed).ok).toBe(true)
  // 时间压缩矩阵的前置链：锚定器 ≥2 ⇒ 谐振信号滤波阵列 ≥1 ⇒ 时间压缩矩阵
  for (let i = 0; i < (techLevel > 0 ? 2 : 0); i++) {
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
  }
  if (techLevel > 0) expect(researchMatterTech(state, ctx, 'mt-explore-scan').ok).toBe(true)
  for (let i = 0; i < techLevel; i++) {
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(true)
  }
  // 站到「舰船信号」格上（节点战只由交火地点触发；未激活状态才可开战——与 wormhole-battle 用例同款铺垫）
  const run = state.wormhole.run!
  const grid = run.grid!
  const cell = grid.cells.find((c) => c.key === `${grid.pos.q},${grid.pos.r}`)!
  cell.place = 'ship'
  grid.activated = grid.activated.filter((k) => k !== cell.key)
  expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
  return state
}

/** 逐拍推进（前台心跳口径：每拍 33ms 真实、传入想跑的倍速） */
function runFrames(state: GameState, msTotal: number, battleSpeedX?: number, frameMs = 33): void {
  const frames = Math.floor(msTotal / frameMs)
  for (let i = 0; i < frames; i++) {
    advanceGame(state, frameMs, ctx, {
      nowWallMs: state.gameMs,
      ...(battleSpeedX === undefined ? {} : { battleSpeedX }),
    })
    if (state.wormhole.run?.battle?.ended) return
  }
}

/** 战斗时钟已走的时长（引擎的战斗内计时一律以它为口径） */
function battleElapsed(state: GameState): number {
  const b = state.wormhole.run!.battle!
  return b.lastTickGameMs - b.startedAtGameMs
}

describe('洞内倍速 · 1× 逐字等价（老路径不受影响）', () => {
  it('未解锁不传档位 / 已解锁但选 ×1 / 已解锁但后台结算不传档位 ⇒ 三者读数完全一致', () => {
    // ① 老路径：科技一级没点、心跳也不传档位
    const plain = battleReady(0)
    runFrames(plain, 8_000)
    // ② 科技满级、玩家手动选 ×1
    const pickOne = battleReady(2)
    runFrames(pickOne, 8_000, 1)
    // ③ 科技满级、但这一拍是离线/后台结算（根本不传 battleSpeedX）
    const backend = battleReady(2)
    runFrames(backend, 8_000)
    const snap = (s: GameState): unknown => {
      const b = s.wormhole.run!.battle!
      return {
        lastTick: b.lastTickGameMs,
        elapsed: battleElapsed(s),
        distance: b.distanceM,
        ended: b.ended,
        waveIdx: b.waveIdx ?? 0,
        hp: Object.fromEntries(Object.entries(b.units).map(([t, u]) => [t, `${u.hp.s}/${u.hp.a}/${u.hp.h}`])),
      }
    }
    expect(snap(pickOne), '科技已解锁但选 ×1 ⇒ 必须与老路径逐字一致').toEqual(snap(plain))
    expect(snap(backend), '后台结算不传档位 ⇒ 必须与老路径逐字一致').toEqual(snap(plain))
    expect(battleSpeedOf(plain.wormhole.run!.battle!)).toBe(1)
    expect(battleSpeedOf(backend.wormhole.run!.battle!)).toBe(1)
  })

  it('未解锁时传 ×4 也夹回 1×；只解锁 1 级时传 ×4 只给到 ×2', () => {
    const locked = battleReady(0)
    runFrames(locked, 3_000, 4)
    expect(battleSpeedOf(locked.wormhole.run!.battle!)).toBe(1)
    const half = battleReady(1)
    runFrames(half, 3_000, 4)
    expect(battleSpeedOf(half.wormhole.run!.battle!)).toBe(2)
  })
})

describe('洞内倍速 · 真的更快（读数）', () => {
  it('同样真实时长内，×2 / ×4 的战斗时钟走得更远（约 2 倍 / 4 倍）', () => {
    const one = battleReady(2)
    runFrames(one, 6_000, 1)
    const two = battleReady(2)
    runFrames(two, 6_000, 2)
    const four = battleReady(2)
    runFrames(four, 6_000, 4)
    const e1 = battleElapsed(one)
    const e2 = battleElapsed(two)
    const e4 = battleElapsed(four)
    expect(e1).toBeGreaterThan(0)
    expect(e2 / e1).toBeGreaterThan(1.8)
    expect(e2 / e1).toBeLessThan(2.2)
    expect(e4 / e1).toBeGreaterThan(3.5)
    expect(e4 / e1).toBeLessThan(4.5)
  })
})

describe('洞内倍速 · 演出照原速（保护窗口等比放大）', () => {
  it('入场保护窗口按倍速放大 ⇒ 真实时长仍是 950ms', () => {
    const one = battleReady(2)
    runFrames(one, 500, 1)
    const b1 = one.wormhole.run!.battle!
    expect(b1.speedX).toBe(1)
    expect(battleShowWindowMs(b1, BATTLE_ARRIVAL_FLY_MS)).toBe(BATTLE_ARRIVAL_FLY_MS)
    const four = battleReady(2)
    runFrames(four, 500, 4)
    const b4 = four.wormhole.run!.battle!
    expect(b4.speedX).toBe(4)
    // 窗口在战斗时钟上是 950×4；换算回真实时间仍是 950ms
    expect(battleShowWindowMs(b4, BATTLE_ARRIVAL_FLY_MS)).toBe(BATTLE_ARRIVAL_FLY_MS * 4)
  })

  it('波次转场窗口（waveClearAt）走同一套"×倍速"算式（现行玩法几乎不触发，见下）', () => {
    // ⚠ 虫洞内战斗**网格层一律单波**（`wormholeBattle.ts`：`kind === 'node' && !grid` 才读 pendingNode 的
    //   waves）⇒ 转场窗口只在**老档的 pendingNode 路径**上才可能走到，公共场合不出现，故不做端到端驱动；
    //   它的窗口值与入场窗口同一口径（`bal.waveEnterGapMs × 倍速`），这里只钉"倍速窗口"这个共用算式。
    const fake = { speedX: 4 } as unknown as Parameters<typeof battleShowWindowMs>[0]
    expect(battleShowWindowMs(fake, 1_200)).toBe(4_800)
  })
})

describe('洞内倍速 · 中途切档不跳变', () => {
  it('先 ×1 跑 5 秒再切 ×4：这一拍只多走"本拍增量 ×4"，不补算已过时长', () => {
    const state = battleReady(2)
    runFrames(state, 5_000, 1)
    const battle = state.wormhole.run!.battle!
    expect(battle.ended).toBeNull()
    const before = battle.lastTickGameMs
    advanceGame(state, 100, ctx, { nowWallMs: state.gameMs, battleSpeedX: 4 })
    const step = battle.lastTickGameMs - before
    // 若按"开战时刻起算"折算，这一步会一次补进 ≈(5,000+100)×4−5,000 ≈ 15,400ms ⇒ 用上界把它钉住
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThanOrEqual(100 * 4 + 120)
  })
})

describe('洞内倍速 · 存档（倍速不落档）', () => {
  it('倍速与锚点都是 runtime 字段：存档往返后读档即 1×（离线不会带着倍速跑）', () => {
    const state = battleReady(2)
    runFrames(state, 1_000, 4)
    const battle = state.wormhole.run!.battle!
    expect(battle.speedX).toBe(4)
    expect(battle.speedAxis).toBeTruthy()
    const back = loadSaveFile(serializeSaveFile(state)).state
    const rb = back.wormhole.run?.battle
    expect(rb, '战斗应随档（在途战斗要能续）').toBeTruthy()
    expect(rb!.speedX).toBeUndefined()
    expect(rb!.speedAxis).toBeUndefined()
    expect(battleSpeedOf(rb!)).toBe(1) // 读档缺省 = 未解锁口径
  })

  it('读档续战：不传档位（离线口径）时与续战前的老口径一致（战斗时钟跟着全局时钟走）', () => {
    const state = battleReady(2)
    runFrames(state, 2_000, 1)
    const back = loadSaveFile(serializeSaveFile(state)).state
    const before = back.wormhole.run!.battle!.lastTickGameMs
    advanceWormhole(back, ctx) // 离线/后台口径：不传倍速
    expect(back.wormhole.run!.battle!.lastTickGameMs).toBe(before) // 全局时钟没动 ⇒ 战斗也不动
    expect(battleSpeedOf(back.wormhole.run!.battle!)).toBe(1)
  })
})
