/**
 * **虫洞：在途战斗与「人在洞里」的存档不变量**（2026-09-21 · 修船长报障
 * 「玩家极少数情况进入虫洞的战斗后，双方舰船不开火，也不会移动改变距离」）。
 *
 * 报障现场（真档实测、本文件锁死）：存档里 `wormhole.run.battle` 在途、但 `attending` 缺省成 `false`
 * ⇒ `advanceWormhole` 第一道门 `if (run.attending !== true) return` 直接返回，而它又是**唯一**能推进
 * `run.battle` 的地方 ⇒ 战斗永久冻结：战斗时钟停在 0、射击 `0/0`、距离一动不动，没有超时兜底也没有日志。
 * 成因 = `attending` 这个字段 2026-09-13 才进存档格式，**迁移表 v24~v29 没有任何一级补过它** ⇒
 * 字段诞生前写下、且当时正在打洞内战斗的档，读回来一律 `undefined === true` = `false`。
 *
 * 本文件锁三条口径：
 * ① **有在途战斗 ⇒ 读档后 `attending` 必须是 `true`**（"战斗中"就是"人在洞里"的证据），战斗照常推进；
 * ② **没在途战斗 ⇒ 旧档/坏值仍是 `false`**（安全侧：不占主控）——与改前**逐字一致**，不是把 `false` 取消了；
 * ③ **玩家真离开过（显式 `false`）且战斗中 ⇒ 同样修回 `true`**：那种组合在 UI 上不可能产生
 *    （战斗中的关闭入口一律被拦），只可能来自坏档/旧档，修回才不会把玩家锁死。
 *
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'

const ctx = buildSimContext()

/** 起一趟、站到"舰船信号"格上、开一场节点战（返回状态与它那份 JSON） */
function battleInFlightSave(): { state: GameState; text: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 21 })
  const a = addShipToFleet(state, 'sh-thresher')
  const b = addShipToFleet(state, 'sh-thresher')
  state.shipId = a
  expect(wormholeEnter(state, ctx, [a, b], 21).ok).toBe(true)
  for (const uid of [a, b]) state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  addWare(state, 'ammo-kinetic-l', 20_000)
  state.wormhole.run!.family = 'A'
  const g = state.wormhole.run!.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  g.activated = g.activated.filter((k) => k !== cell.key)
  expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
  return { state, text: serializeSaveFile(state, 0) }
}

/** 跑 `seconds` 秒（每拍 100ms，与实时心跳同粒度），返回途中是否收口 */
function runFor(state: GameState, seconds: number): boolean {
  for (let i = 0; i < seconds * 10; i++) {
    state.gameMs += 100
    advanceWormhole(state, ctx)
    if (!state.wormhole.run?.battle) return true
  }
  return false
}

describe('虫洞存档不变量：在途战斗 ⇔ 人在洞里', () => {
  it('① 有在途战斗 + 档里缺 `attending`（字段诞生前写的档）⇒ 读档后 attending=true，战斗照常推进', () => {
    const { text } = battleInFlightSave()
    // 抹掉 attending 键：这正是"该字段进存档格式之前"写下的档的形状（迁移表没有一级补它）
    const stripped = text.replace(/"attending":true,?/, '')
    expect(stripped).not.toContain('"attending"')

    const back = loadSaveFile(stripped)
    const run = back.state.wormhole.run!
    expect(run.battle, '战斗必须在途').toBeTruthy()
    expect(run.attending, '有在途战斗 ⇒ 缺省必须是 true').toBe(true)

    // **推进判据**（不是只读字段）：战斗时钟要走、要开火
    const b = run.battle!
    const tick0 = b.lastTickGameMs
    runFor(back.state, 5)
    const live = back.state.wormhole.run?.battle
    expect(live, '5 秒内不该收口').toBeTruthy()
    expect(live!.lastTickGameMs, '战斗时钟必须前进（改前恒为 0）').toBeGreaterThan(tick0)
    expect(live!.stats.meShots + live!.stats.foeShots, '双方必须开火（改前恒为 0/0）').toBeGreaterThan(0)
  })

  it('①负向对照：不修的话就是死局（同一份档、只把 attending 写成 false，时钟恒 0、一炮不发）', () => {
    const { text } = battleInFlightSave()
    /**
     * 这条**故意**把 `attending` 写成假（模拟"修前读档得到的那个状态"），确认它真的会冻死——
     * 否则上面那条用例可能只是"恰好没踩到"，而不是真的修好了。
     * ⚠ 修法生效后，读档清洗会把 `false` 修回 `true` ⇒ 这里改完必须**再手工压回 false**
     * 才等价于"改前的坏状态"。
     */
    const back = loadSaveFile(text.replace(/"attending":true/, '"attending":false'))
    const run = back.state.wormhole.run!
    expect(run.attending, '读档清洗已把 false 修回 true（这就是修复本体）').toBe(true)
    run.attending = false // 手工压回坏状态 = 等价于"没有这条修复时读档得到的现场"
    const b = run.battle!
    const tick0 = b.lastTickGameMs
    runFor(back.state, 10)
    expect(b.lastTickGameMs, '坏状态下战斗时钟一动不动').toBe(tick0)
    expect(b.stats.meShots + b.stats.foeShots, '坏状态下双方一炮不发').toBe(0)
  })

  it('② 没在途战斗 ⇒ 旧档/坏值仍是 false（安全侧：不占主控）——改前口径一字不动', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const a = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a], 21).ok).toBe(true)
    const text = serializeSaveFile(state, 0)
    // 缺字段（旧档）与坏值（非布尔）两条都要落 false
    for (const bad of [text.replace(/"attending":true,?/, ''), text.replace(/"attending":true/, '"attending":"yes"')]) {
      const back = loadSaveFile(bad)
      expect(back.state.wormhole.run?.battle, '本用例前提：没有在途战斗').toBeFalsy()
      expect(back.state.wormhole.run?.attending, '没战斗时缺省仍是 false').toBe(false)
    }
  })

  it('③ 真离开过（显式 false）且战斗中 ⇒ 同样修回 true（那种组合 UI 上产生不出来，只可能来自坏档）', () => {
    const { state, text } = battleInFlightSave()
    // 先造出"玩家真离开过"的现场（`leftAtGameMs` 要为正数才会落档，见 `cleanWormhole`）
    state.gameMs += 5000
    state.wormhole.run!.leftAtGameMs = state.gameMs
    const left = serializeSaveFile(state, 0).replace(/"attending":true/, '"attending":false')
    const back = loadSaveFile(left)
    const run = back.state.wormhole.run!
    expect(run.attending).toBe(true)
    // 修复不动 leftAtGameMs（返回时的战斗时钟前移那一路照旧；这里已 attending=true ⇒ 不再需要前移）
    expect(run.leftAtGameMs).toBe(state.gameMs)
  })

  it('①的往返稳定：修好的档再存再读，attending 不会被翻回去、战斗时钟不跳变', () => {
    const { text } = battleInFlightSave()
    const first = loadSaveFile(text.replace(/"attending":true,?/, ''))
    const again = serializeSaveFile(first.state, 0)
    expect(again).toContain('"attending":true')
    const second = loadSaveFile(again)
    expect(second.state.wormhole.run?.attending).toBe(true)
    expect(second.state.wormhole.run?.battle?.lastTickGameMs).toBe(first.state.wormhole.run?.battle?.lastTickGameMs)
  })

  /**
   * **真实档形状的端到端**：拿仓里**真·v25 档**（`attending` 进格式之前写下的，测试存档仓的产物）
   * 造出"该字段诞生前 + 正在打洞内战斗"的档，走完整迁移链 v25→v30 再读——
   * 这条覆盖的是 `packages/core/tests` 手工拼 JSON 之外的那半条路：**迁移表本身不补 `attending`**，
   * 全靠清洗层的缺省判据兜住。
   */
  it('④ 真·v25 档 + 在途战斗（走 v25→v30 完整迁移链）⇒ 读档后 attending=true 且还能打', () => {
    const v25Path = join(process.cwd(), '..', '..', 'docs', 'test-saves', 'test-save-wh-layer4-20260914-145911.json')
    let base: ReturnType<typeof loadSaveFile>
    try {
      base = loadSaveFile(readFileSync(v25Path, 'utf8'))
    } catch (e) {
      // 档不在（只读/剔除）⇒ 明确报出，不静默跳过
      throw new Error(`基线 v25 档读不到：${v25Path}（${(e as Error).message}）`)
    }
    expect(base.state.wormhole.run, '基线档必须是一趟进行中的虫洞').toBeTruthy()

    // 用真引擎在真档里开一场真战斗，取出它的战斗对象
    const run = base.state.wormhole.run!
    const g = run.grid!
    const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)
    expect(cell, '当前格必须在网格里').toBeTruthy()
    cell!.place = 'ship'
    g.activated = g.activated.filter((k) => k !== cell!.key)
    run.attending = true
    expect(wormholeStartBattle(base.state, ctx, 'node').ok, '真档里必须开得起战斗').toBe(true)
    const battle = run.battle!

    /**
     * 组装"v25 形状"的档：**从真档 JSON 上来**（保住全部真字段），只做三件必要的手脚——
     * ① `version` 回写 25（让它真走一遍 v25→v30 迁移链）；
     * ② 换上刚开的这场战斗；
     * ③ **抹掉 `attending`**（= 该字段还没进格式时的档长什么样）。
     */
    const raw = JSON.parse(serializeSaveFile(base.state, 0)) as {
      version: number
      state: { wormhole: { run: Record<string, unknown> } }
    }
    raw.version = 25
    raw.state.wormhole.run.battle = battle
    delete raw.state.wormhole.run.attending

    const back = loadSaveFile(JSON.stringify(raw))
    const r2 = back.state.wormhole.run!
    expect(r2.battle, '在途战斗必须穿过整条迁移链活下来').toBeTruthy()
    expect(r2.attending, 'v25 档缺 attending ⇒ 必须按"有在途战斗"补成 true').toBe(true)

    // 推进判据：时钟要走、要开火（改前这条会是 tick 恒 0、射击 0/0）
    const b = r2.battle!
    const tick0 = b.lastTickGameMs
    for (let i = 0; i < 50; i++) {
      back.state.gameMs += 100
      advanceWormhole(back.state, ctx)
      if (!back.state.wormhole.run?.battle) break
    }
    const live = back.state.wormhole.run?.battle
    if (live) {
      expect(live.lastTickGameMs).toBeGreaterThan(tick0)
      expect(live.stats.meShots + live.stats.foeShots).toBeGreaterThan(0)
    }
  })
})
