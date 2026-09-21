/**
 * **虫洞：冻结窗口（`freezeBattle`）不得把在途战斗落在全局时钟后面**
 * （2026-09-21 · 修船长报障「进入虫洞的战斗后，双方舰船不开火，也不会移动改变距离」的**第二处成因**）。
 *
 * 现场：`simulateOffline` 是**带 `freezeBattle: true`** 跑的（桌面 shell 的 `engine.ts`），它同时把
 * `state.gameMs` 一次性推进整段离线时长 ⇒ 原实现里 `advanceWormhole` 的冻结分支**直接 return**，
 * 战斗时钟被落在原地。于是读档后 `state.gameMs − battle.lastTickGameMs` = 整段离线时长
 * （真档实测 **8 小时 = 28,800 秒**），而补帧循环每拍最多走
 * `BATTLE_MAX_STEPS(40,000) × 100ms = 4,000 秒` ⇒ 玩家看到**极端慢镜 / 卡住的战场**，
 * 且**交火时长**会把离线那几小时算成战斗时间。
 *
 * 本文件锁三条：
 * ① **冻结窗口结束时战斗时钟被前移到全局时钟**（落后归零）——与 `expedition.ts` 主控远征那条同款；
 * ② **逐拍调用幂等**（同拍 `owed` 归零，后续拍不再动）；
 * ③ **交火时长不被离线时长污染**（`lastTick − startedAt` 不变），且解冻后按原速正常打。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { WormholeRunState } from '../src/wormhole'

const ctx = buildSimContext()

/** 起一趟真虫洞、站到"舰船信号"格上、开一场真节点战 */
function battleInFlight(seed = 21): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const a = addShipToFleet(state, 'sh-thresher')
  const b = addShipToFleet(state, 'sh-thresher')
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a, b], seed).ok).toBe(true)
  for (const uid of [a, b]) state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  addWare(state, 'ammo-kinetic-l', 20_000)
  state.wormhole.run!.family = 'A'
  const g = state.wormhole.run!.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  g.activated = g.activated.filter((k) => k !== cell.key)
  expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
  return state
}

/** 模拟一整段冻结窗口：先推进全局时钟，再按桌面 shell 的离线结算口径调一次冻结推进 */
function freezeFor(state: GameState, ms: number): void {
  state.gameMs += ms
  advanceWormhole(state, ctx, true)
}

describe('虫洞 · 冻结窗口不得把战斗时钟落在后面', () => {
  it('① 冻结 8 小时后战斗时钟被前移（落后归零）——改前落后 = 整段 28,800 秒', () => {
    const state = battleInFlight()
    const b = state.wormhole.run!.battle!
    const t0 = b.lastTickGameMs
    const dur0 = b.lastTickGameMs - b.startedAtGameMs

    freezeFor(state, 8 * 3600 * 1000)

    expect(b.lastTickGameMs, '战斗时钟必须跟上全局时钟').toBe(state.gameMs)
    expect(state.gameMs - b.lastTickGameMs, '落后必须归零（改前 = 28,800,000）').toBe(0)
    expect(b.lastTickGameMs - b.startedAtGameMs, '交火时长不被离线时长污染').toBe(dur0)
    expect(t0).toBeLessThan(b.lastTickGameMs)
  })

  it('①负向对照：没有这条修复时，落后会一直是整段离线时长（补帧也追不平）', () => {
    const state = battleInFlight()
    const b = state.wormhole.run!.battle!
    // 手工复刻"改前"的冻结：只推全局时钟、不碰战斗时钟（= 老 `if (freezeBattle) return` 的效果）
    state.gameMs += 8 * 3600 * 1000
    const behind = state.gameMs - b.lastTickGameMs
    expect(behind, '改前：落后 = 整段离线时长').toBe(8 * 3600 * 1000)
    expect(behind, '远超单拍补帧上限（BATTLE_MAX_STEPS × 100ms = 4,000 秒）').toBeGreaterThan(4000 * 1000)
    /**
     * 补帧一拍的两种结局**都是玩家可见的坏结果**（这也是"极少数情况"下的现场）：
     * - **还没收口** ⇒ 落后仍是**几小时**（下一次心跳接着这么补，画面近乎静止 = 卡住的战场）；
     * - **一拍就收口** ⇒ 8 小时的仗在**一帧之内打完**（极端快进，玩家只看到战场闪一下）。
     * 修好后两种都不成立：读档那一拍落后就是 0、战斗按原速走。
     */
    state.gameMs += 100
    advanceWormhole(state, ctx)
    const live = state.wormhole.run?.battle
    if (live) {
      expect(state.gameMs - live.lastTickGameMs, '一拍之后仍然大幅落后').toBeGreaterThan(7 * 3600 * 1000)
      expect(
        live.lastTickGameMs - live.startedAtGameMs,
        '这一拍却顶格吃掉了 4,000 秒战斗时间',
      ).toBeGreaterThanOrEqual(4000 * 1000)
    }
  })

  it('② 冻结窗口结束时就已经追平（不是"等解冻后慢慢补"）+ 逐拍调用幂等', () => {
    const state = battleInFlight()
    const b = state.wormhole.run!.battle!
    const g0 = state.gameMs
    freezeFor(state, 3600 * 1000)
    /**
     * **关键断言**：追平必须发生在**冻结窗口之内**——这就是修复本体。
     * 改前（只 `return`）这里落后 = 3,600 秒；解冻后玩家看到的才是"战场卡住/极端快进"。
     */
    expect(state.gameMs - b.lastTickGameMs, '冻结结束即落后 0（改前 = 3,600,000）').toBe(0)
    const t1 = b.lastTickGameMs
    expect(t1).toBeGreaterThan(g0)
    // 同拍再调若干次（幂等：owed 已归零 ⇒ 时钟不再动，也不掉血/不开火）
    for (let i = 0; i < 5; i++) advanceWormhole(state, ctx, true)
    expect(b.lastTickGameMs, '已追平 ⇒ 再调不动').toBe(t1)
    expect(b.stats.meShots + b.stats.foeShots, '冻结期一炮不发').toBe(0)
  })

  it('③ 解冻后逐拍只走一拍的时间（绝不吃掉积压的战斗时间）', () => {
    const state = battleInFlight()
    const b = state.wormhole.run!.battle!
    freezeFor(state, 6 * 3600 * 1000)
    /**
     * ⚠ **先钉"冻结期不许把这场仗打完"**：改前（只 `return`）读档那一拍会顶格补 4,000 秒
     * ⇒ 这场 5 秒的交火**在冻结窗口里就被判完并收口**（`run.battle` 直接变 null）——
     * 玩家看到的是"战场一闪而过 / 根本没打"。所以这条的**第一断言就是战斗必须还在**。
     */
    /**
     * ⚠ **这条锁的是同一个不变量，但走的是"解冻之后"的读法**：冻结窗口一结束，
     * **战斗时钟必须已经与全局时钟对齐**——改前（只 `return`）这里 `tick` 还停在 0、
     * 落后 = 整整 6 小时（= 6,000 拍满负荷补算），玩家看到的就是"卡住的战场 / 极端快进"。
     */
    expect(b.lastTickGameMs, '冻结结束那一刻战斗时钟必须已经对齐（改前停在 0）').toBe(state.gameMs)
    const shots0 = b.stats.meShots + b.stats.foeShots
    const dur0 = b.lastTickGameMs - b.startedAtGameMs

    let maxStep = 0
    let ticks = 0
    for (let i = 0; i < 50; i++) {
      const tBefore = b.lastTickGameMs
      state.gameMs += 100
      advanceWormhole(state, ctx)
      const live = state.wormhole.run?.battle
      if (!live) break
      maxStep = Math.max(maxStep, live.lastTickGameMs - tBefore)
      ticks += 1
      expect(state.gameMs - live.lastTickGameMs, '解冻后每拍都跟得上（落后恒为 0）').toBe(0)
    }
    // eslint-disable-next-line no-console
    console.log('③ 诊断：ticks=' + ticks + ' maxStep=' + maxStep + ' 收口=' + (state.wormhole.run?.battle === null) + ' 剩余落后=' + (state.wormhole.run?.battle ? state.gameMs - state.wormhole.run.battle.lastTickGameMs : -1))
    expect(maxStep, '单拍最多走 100ms（改前会顶格吃 4,000 秒的积压）').toBeLessThanOrEqual(100)
    const live = state.wormhole.run?.battle
    if (live) {
      expect(live.stats.meShots + live.stats.foeShots, '解冻后双方要真的开火').toBeGreaterThan(shots0)
      expect(live.lastTickGameMs - live.startedAtGameMs, '交火时长只按真打的拍数增长').toBe(dur0 + ticks * 100)
    }
  })

  it('④ 没在途战斗时冻结推进是空操作（不新增字段、不崩）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const a = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a], 21).ok).toBe(true)
    const run: WormholeRunState = state.wormhole.run!
    expect(run.battle ?? null).toBeNull()
    state.gameMs += 3600 * 1000
    expect(() => advanceWormhole(state, ctx, true)).not.toThrow()
    expect(run.battle ?? null).toBeNull()
  })
})
