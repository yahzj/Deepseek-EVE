/**
 * **虫洞 · 副本状态机与存档**（C 批 · 2026-09-13）。
 *
 * 锁住三组口径：
 * ① 副本推进（层 / 节点 / 回合）与两条硬约束——**战斗没结束不能撤**、**回合耗尽只能撤离**；
 * ② 层曲线取向：**收益涨得比威胁快**（船长 2026-09-13：「深层收益应该比难度曲线要更高」）；
 * ③ **v25 存档**：字段纯新增、老档迁移补空状态、往返不丢（含进行中的副本状态）。
 *
 * ✅ 2026-09-14 船长解除不可见（入口常驻、数据全部上线、公开就叫「虫洞」）；
 * 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, CURRENT_STATE_VERSION, wormholePilotHoldReason } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { idleAiShipIds } from '../src/ai'
import { activityOverview, shipBusyLabel } from '../src/activity'
import { desirePrefOf } from '../src/combat'
import type { CommandResult } from '../src/engine'
import { advanceGame } from '../src/engine'
import { fightEncounter } from '../src/encounters'
import { startSalvageOp } from '../src/salvaging'
import { startMining } from '../src/mining'
import { goStandbyAt } from '../src/location'
import { startHauling } from '../src/hauling'
import { startScan } from '../src/explore'
import { setBattleDesire, startExpedition } from '../src/expedition'
import { wormholeStartBattle } from '../src/wormholeBattle'
import { addShipToFleet } from '../src/shipyard'
import {
  shipBusyForWormhole,
  wormholeAdvanceNode,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeGridActivate,
  wormholeGridScan,
  wormholeGridTravel,
  wormholeScanBonusOf,
  wormholeLeave,
  wormholeOutOfTurns,
  wormholeResume,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
  wormholeMakeNode,
  wormholeNodesPerLayer,
  wormholeStartRun,
} from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'
import type { WormholeGridCell, WormholePlace } from '../src/wormholeGrid'
import { gridCellAt, hexDistance, wormholeGridRadiusFor } from '../src/wormholeGrid'

const ctx = buildSimContext()
const T1 = 'sandcat'
const T3 = 'sh-thresher'
const T5 = 'sh-colossal'

/**
 * 起一趟（**层内动作**用例的公共前置）：跳过入洞门槛，只要一个"人在洞里 + 本层网格就位"的现场。
 * 门槛本身由本文件上半段的用例单独钉。
 */
function enterForActions(shipIds: readonly string[] = [T1, T1, T1, T1], seed = 12345): { state: GameState; run: WormholeRunState } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const run = wormholeStartRun(ctx, shipIds, seed).run!
  run.attending = true
  state.wormhole.run = run
  return { state, run }
}

/** 当前格（查格一律按 `q,r` 字面键，与 `hexKey` 同格式） */
function hereCell(run: WormholeRunState): WormholeGridCell {
  const g = run.grid!
  return g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
}

/**
 * **把玩家挪到一个指定地点的格上**（F3a-2 起：地点效果由**激活**触发，不再是线性节点）。
 * 等价于旧用例里的 `run.pendingNode = { kind: … }`：直接改格的真相，省掉"扫/走"的铺垫。
 */
function standOnPlace(run: WormholeRunState, place: WormholePlace): string {
  const cell = hereCell(run)
  cell.place = place
  const g = run.grid!
  g.activated = g.activated.filter((k) => k !== cell.key)
  return cell.key
}

describe('虫洞 · 进洞门槛与锁定（船长 2026-09-13；2026-09-14 起「就地作业」改为进洞自动停）', () => {
  /**
   * ⚠ **2026-09-14 改判**（船长：「**进洞自动停止**」＋「『进洞会自动停掉的那一项活动』同样落实到
   * **采矿/打捞**」）：**开采**与**打捞**不再拦进洞，改成**进洞那一刻自动停掉**（与手点「停止」同一路径，
   * 货物留在船上）；本条用例因此改写——老口径「主控在采矿 ⇒ 拒绝」**作废**。
   *
   * ⚠ **2026-09-15 再改判**（船长：「玩家扫描星系将不再占用玩家的主控活动」）：**星系扫描**也退出
   * 主控活动表（无人扫描艇）⇒ 本条"不闲置就进不去"的钉子改用**掩护巡逻**（仍然拦住的那一类）。
   */
  it('**主控不闲置就进不去**：主控在掩护巡逻 ⇒ 拒绝，文案点名忙态；改判后「采矿/扫描星系」都不再拦', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    state.shipId = a
    state.standby = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: state.gameMs, legMs: 0 }
    const r = wormholeEnter(state, ctx, [a], 7)
    expect(r.ok, '主控忙着还能进洞').toBe(false)
    expect(r.error ?? '').toContain('主控正在')
    expect(state.wormhole.run).toBeNull()
    // 收工后就能进
    state.standby.active = false
    expect(wormholeEnter(state, ctx, [a], 7).ok).toBe(true)
    // **改判后的采矿**：不拦、进洞自动停（细账见 tests/wormhole-activity-lock.test.ts ①″）
    const state2 = createInitialState({ nowWallMs: 0, seed: 7 })
    const b = addShipToFleet(state2, T1)
    state2.shipId = b
    state2.mining.active = true
    state2.mining.tripUnits = 3
    expect(wormholeEnter(state2, ctx, [b], 7).ok).toBe(true)
    expect(state2.mining.active).toBe(false)
    // **2026-09-15：星系扫描也不再拦进洞**（无人扫描艇与主控无关）
    const state3 = createInitialState({ nowWallMs: 0, seed: 7 })
    const c = addShipToFleet(state3, T1)
    state3.shipId = c
    state3.scanning = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: state3.gameMs + 600_000, startedAtGameMs: state3.gameMs, originGalaxy: null }
    expect(wormholeEnter(state3, ctx, [c], 7).ok).toBe(true)
    expect(state3.scanning.active).toBe(true) // 扫描不受影响（照旧在跑）
  })

  it('**编队里有人被占用就进不去**：某艘正在 AI 派工 ⇒ 拒绝并点名那艘船', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    state.aiAssignments[b] = {
      coreType: 'basic',
      startedAtGameMs: 0,
      task: { kind: 'mining', beltId: '', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
    }
    const r = wormholeEnter(state, ctx, [a, b], 7)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('AI 采矿')
    expect(state.wormhole.run).toBeNull()
  })

  it('**进洞的船被锁定**：洞内船对外一律算忙（AI 指派列表里没有它、忙态写着「虫洞探索中」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    const c = addShipToFleet(state, T1)
    state.shipId = a
    expect(idleAiShipIds(state)).toContain(b) // 进洞前：b/c 都是可指派的空闲船
    expect(wormholeEnter(state, ctx, [b, c], 7).ok).toBe(true)
    // 锁定：洞里那两艘不再出现在"可指派空闲船"里（船长：「已经进洞的船将被锁定（包括货仓）」）
    expect(idleAiShipIds(state)).not.toContain(b)
    expect(idleAiShipIds(state)).not.toContain(c)
    expect(shipBusyLabel(state, ctx, b)).toBe('虫洞探索中')
    // 也不能被重复编入（同一艘船不能同时下两个洞）
    state.wormhole.run = null
    expect(idleAiShipIds(state)).toContain(b)
  })
})

describe('虫洞 · 并行战斗与忙态口径（船长 2026-09-13）', () => {
  it('**议案 A（船长已批准）：人在洞里 ⇒ 主控开不了别的活动**；其余入口同一把尺', () => {
    // 船长 2026-09-13：「……这个可以实行」⇒ 四条口径：①人在洞里才占主控 ②临时离开=活动停止（进度保存）
    // ③返回要主控空闲 ④离开期间洞内冻结。本用例钉 ①：进洞后（attending=true）各活动入口被同一条拒因挡住。
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [b], 7).ok).toBe(true) // a=主控留洞外，b 进洞
    expect(state.wormhole.run!.attending).toBe(true)
    expect(wormholePilotHoldReason(state) ?? '').toContain('虫洞里')
    const exp = startExpedition(state, 'ano-training', ctx)
    expect(exp.ok, `人在洞里还能出击：${exp.error ?? ''}`).toBe(false)
    expect(exp.error ?? '').toContain('虫洞里')
    for (const [what, r] of [
      ['采矿', startMining(state, '__no_such_belt__', ctx)],
      ['扫描', startScan(state, 'gx-2', ctx)],
      ['打捞', startSalvageOp(state, 'gx-2', ctx)],
      ['掩护巡逻', goStandbyAt(state, 'gx-2', ctx)],
      ['长途运输', startHauling(state, null, null, ctx)],
    ] as Array<[string, CommandResult]>) {
      expect(r.ok, `${what} 在洞内还能开`).toBe(false)
    }
  })

  it('**口径②③：临时离开 ⇒ 活动停止·进度保存·主控可干活；返回要主控空闲**', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    run.turnsLeft = 17 // 造个"进度"读数，稍后验证没丢
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(false) // 人在洞里 ⇒ 挡
    // ② 临时离开 ⇒ 活动停止、主控立刻释放
    wormholeLeave(state)
    expect(run.attending).toBe(false)
    expect(wormholePilotHoldReason(state)).toBeNull()
    expect(run.turnsLeft).toBe(17) // 进度保存
    expect(state.wormhole.run).not.toBeNull()
    const exp = startExpedition(state, 'ano-training', ctx)
    expect(exp.ok, `离开后主控还是被占着：${exp.error ?? ''}`).toBe(true) // 主控能干活了
    // ③ 返回要主控空闲：主控在远征 ⇒ 拒绝
    const back = wormholeResume(state, ctx)
    expect(back.ok).toBe(false)
    expect(back.error ?? '').toContain('远征')
    // 收工后就能回去
    state.expedition.active = false
    state.expedition.battle = null
    state.expedition.phase = 'back'
    expect(wormholeResume(state, ctx).ok).toBe(true)
    expect(state.wormhole.run!.attending).toBe(true)
    expect(state.wormhole.run!.turnsLeft).toBe(17) // 进度还在
  })

  it('**口径④：临时离开期间洞内一切冻结**（战斗不推进、不掉血）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由地点触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const tick0 = battle.lastTickGameMs
    const hp0 = JSON.stringify(battle.units['player']!.hp)
    wormholeLeave(state) // 临时离开
    for (let i = 0; i < 6; i++) advanceGame(state, 1_000, ctx, { nowWallMs: 0 })
    expect(battle.lastTickGameMs, '离开期间洞内战斗还在推进').toBe(tick0)
    expect(JSON.stringify(battle.units['player']!.hp), '离开期间还在掉血').toBe(hp0)
    expect(battle.ended).toBeFalsy()
    // 回来：接着打
    state.expedition.active = false
    expect(wormholeResume(state, ctx).ok).toBe(true)
    // 回来只推一小步：2×T1 打第 1 层本来就吃力，推久了会真分出胜负（那是另一回事）
    advanceGame(state, 200, ctx, { nowWallMs: 0 })
    const after = state.wormhole.run?.battle
    expect(after, '回来一推进战斗就没了（本趟收场？）').toBeTruthy()
    expect(after!.lastTickGameMs).toBeGreaterThan(tick0)
    // **不许把"离开的时间"补算成战时间**：回来那一拍之后，战斗时钟必须紧跟当前游戏时刻
    // （首版没前移时钟 ⇒ 步进基准 `while (state.gameMs > lastTickGameMs)` 一次补算 6 秒 ⇒ 当场团灭）
    expect(state.gameMs - after!.lastTickGameMs, '回来时把离开的时间补算成战时间了').toBeLessThanOrEqual(250)
  })

  it('**临时离开期间没有战斗、时间又往前走了 ⇒ 返回不炸**（修 2026-09-14 线上 TypeError → 玩家看到的「返回虫洞黑屏」）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.battle, '前提：这一趟此刻没有战斗（玩家大多就是在这种状态下临时离开）').toBeFalsy()
    wormholeLeave(state)
    expect(run.leftAtGameMs).toBe(state.gameMs)
    /**
     * 关键组合（旧用例恰好漏掉的正是这一格）：**没有战斗** ＋ **离开期间游戏时间照走**。
     * 修前：`shiftBattleClock(run.battle as BattleState, 30 分钟)` ⇒ 形参是 undefined ⇒
     * `battle.startedAtGameMs` 抛 TypeError ⇒ 虫洞面板整块不渲染（黑屏）。
     */
    advanceGame(state, 30 * 60_000, ctx, { nowWallMs: 0 })
    const before = state.gameMs
    const back = wormholeResume(state, ctx)
    expect(back.ok, `返回虫洞被拒：${back.error ?? ''}`).toBe(true)
    expect(run.attending).toBe(true)
    expect(run.leftAtGameMs, '回来后离开时刻要清掉（否则下次会拿旧时刻算 delta）').toBeUndefined()
    expect(state.gameMs, '回来只是记账，不该改游戏时刻').toBe(before)
    expect(run.battle, '没有战斗就不该凭空造出一场').toBeFalsy()
  })

  it('**活动栏显示虫洞探索**（船长 2026-09-13「显示」）：一条读数 + 不可终止 + 离开态标注', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(activityOverview(state, ctx).some((v) => v.kind === 'wormhole')).toBe(false) // 没进洞 ⇒ 没有这一行
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const row = activityOverview(state, ctx).find((v) => v.kind === 'wormhole')!
    expect(row, '进洞后活动栏没有虫洞那一行').toBeTruthy()
    expect(row.label).toContain('虫洞探索')
    expect(row.sub).toContain('回合')
    expect(row.sub).toContain('人在洞里')
    expect(row.stopable, '虫洞那趟不该给终止入口（误点会丢整趟）').toBe(false)
    // 临时离开 ⇒ 同一行的读数改口（进度已保存）
    wormholeLeave(state)
    const row2 = activityOverview(state, ctx).find((v) => v.kind === 'wormhole')!
    expect(row2.sub).toContain('已离开')
  })

  it('**洞内距离可调**（2026-09-13 修"锁死"）：写进本场 + 本趟后续节点沿用 + **不污染星系偏好**', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由地点触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    // 首版这条路只认远征 ⇒ 洞内拖距离条被拒（看着像"锁死"）
    const card = ctx.anomalies.get('ano-training')!
    const prefBefore = desirePrefOf(state, card.galaxyId)
    const want = ctx.balance.battle.minDistanceM // 拉到最近：与默认中距明显不同
    const r = setBattleDesire(state, want, ctx)
    expect(r.ok, `洞内拖距离被拒：${r.error ?? ''}`).toBe(true)
    expect(run.battle!.myDesireM).toBeGreaterThanOrEqual(ctx.balance.battle.minDistanceM)
    expect(run.desireM, '没把偏好记在本趟上').toBe(run.battle!.myDesireM)
    // **不污染星系偏好**（虫洞不属于任何星系）
    expect(desirePrefOf(state, card.galaxyId)).toBe(prefBefore)
    // 本趟后续节点沿用：重开一场（同节点）应直接吃本趟偏好
    const want2 = run.battle!.myDesireM
    run.battle = null
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    expect(run.battle!.myDesireM).toBe(want2)
  })

  it('**洞内战斗进行中，洞外照常能开新战斗**（船长 2026-09-13）：走"遭遇"这条不受活动位限制的路', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const a = addShipToFleet(state, T1)
    const b = addShipToFleet(state, T1)
    expect(wormholeEnter(state, ctx, [a, b], 7).ok).toBe(true)
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由地点触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const holeBattle = run.battle!
    // 洞外触发一场遭遇（AI 船/主控在外都可能）：**战斗系统不因洞内战而关闭**
    state.encounter = {
      ...state.encounter,
      active: true,
      shipId: state.shipId, // 主控在洞外 ⇒ 锚点不冲突
      galaxyId: 'gx-home',
      name: '测试遭遇',
      threat: 40,
      anomalyId: 'ano-training',
      origin: 'test',
      invitedAtGameMs: 0,
      deadlineGameMs: 10_000_000,
    }
    const fights = fightEncounter(state, ctx)
    expect(fights.ok, fights.error ?? '').toBe(true)
    expect(state.encounter.battle, '洞外那场没开起来').toBeTruthy()
    // 锚点各在各边：洞内锚 = run.fleet[0]，洞外锚 = 主控（不在洞里 ⇒ 不会被两场同时读写）
    expect(run.fleet).not.toContain(state.shipId)
    const tickBefore = holeBattle.lastTickGameMs
    for (let i = 0; i < 2; i++) advanceGame(state, 500, ctx, { nowWallMs: 0 })
    expect(state.encounter.battle, '洞外那场被洞内那场吞了').toBeTruthy()
    const hole = state.wormhole.run?.battle
    if (hole) expect(hole.lastTickGameMs).toBeGreaterThanOrEqual(tickBefore) // 各推各的
  })

  it('**锚点锁定仍在**：主控编在洞里 ⇒ 出击被拒（这条属"锁定"裁定，不在议案退回范围）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const pilot = state.shipId
    const a = addShipToFleet(state, T1)
    expect(wormholeEnter(state, ctx, [pilot, a], 7).ok).toBe(true) // 船长裁定 B：主控可编入
    const r = startExpedition(state, 'ano-training', ctx)
    expect(r.ok, '主控被锁在洞里还能出击 = 两场战斗共用一个锚点').toBe(false)
    expect(r.error ?? '').toContain('虫洞里')
  })

  it('忙态口径不漂移：`shipBusyForWormhole` 与界面侧 `shipBusyLabel` 必须同时"忙/闲"', () => {
    const scenarios: Array<[string, (s: GameState) => void]> = [
      ['空闲', () => {}],
      [
        '主控采矿',
        (s) => {
          s.mining.active = true
        },
      ],
      [
        '主控远征',
        (s) => {
          startExpedition(s, 'ano-training', ctx) // 用真实状态转换，别手搓字段（手搓会造出"假忙"）
        },
      ],
    ]
    for (const [name, setup] of scenarios) {
      const state = createInitialState({ nowWallMs: 0, seed: 7 })
      const a = addShipToFleet(state, T1)
      const b = addShipToFleet(state, T1)
      state.shipId = a
      setup(state)
      expect(
        shipBusyForWormhole(state, a) !== null,
        `${name}：主控忙态两边不一致（${shipBusyForWormhole(state, a)} vs ${shipBusyLabel(state, ctx, a)}）`,
      ).toBe(shipBusyLabel(state, ctx, a) !== null)
      // 副船：AI 派工 ⇒ 两边都算忙
      state.aiAssignments[b] = {
        coreType: 'basic',
        startedAtGameMs: 0,
        task: { kind: 'mining', beltId: '', phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
      }
      expect(shipBusyForWormhole(state, b) !== null).toBe(shipBusyLabel(state, ctx, b) !== null)
    }
  })
})

describe('虫洞 · 起程与副本推进', () => {
  it('合法编队可起程：锁定质量/回合、进入 inside、本层网格就位（入口格已到达、扫描半径 1）', () => {
    const r = wormholeStartRun(ctx, [T1, T1, T1, T1], 12345)
    expect(r.ok).toBe(true)
    const run = r.run!
    expect(run.phase).toBe('inside')
    expect(run.depth).toBe(1)
    expect(run.totalMass).toBe(2_000)
    expect(run.turnsTotal).toBe(93) // 4×T1 = 93 回合（基础沿革 55 → 60（2026-09-14）→ 100（2026-09-15））
    expect(run.turnsLeft).toBe(93)
    expect(run.bag).toEqual([])
    // F3a-2：层内内容全部由网格承载；旧的线性节点字段不再生成
    expect(run.pendingNode).toBeNull()
    const g = run.grid!
    expect(g.radius).toBe(wormholeGridRadiusFor(1))
    expect(g.scanRadius).toBe(1) // 船长：「初始扫描范围 1 格」
    expect(g.pos).toEqual(g.start)
    expect(g.visited).toContain(`${g.start.q},${g.start.r}`) // 玩家就落在入口 ⇒ 入口格算"已到达"
    expect(g.activated).toEqual([])
    // 入口格：落在外圈上（船长：「玩家初始随机出现在一个网格地点入口」）
    expect(hexDistance(g.start, { q: 0, r: 0 })).toBe(g.radius)
    // 下一层入口：随机位置，且不在入口格上
    expect(`${g.exit.q},${g.exit.r}`).not.toBe(`${g.start.q},${g.start.r}`)
  })

  it('不合法编队照旧被拒（旗舰 / 超质量 / 空编队）', () => {
    expect(wormholeStartRun(ctx, [T5], 1).ok).toBe(false)
    // 4×T3 = 14,000 是**合法**上限内编成（设计稿表）；超限要用 2×T4 + 1×T3 = 17,500
    expect(wormholeStartRun(ctx, [T3, T3, T3, T3], 1).ok).toBe(true)
    expect(wormholeStartRun(ctx, ['sh-swordfish', 'sh-swordfish', T3], 1).ok).toBe(false)
    expect(wormholeStartRun(ctx, ['sh-x'], 1).ok).toBe(false)
    expect(wormholeStartRun(ctx, [], 1).ok).toBe(false)
  })

  it('**老档线性节点仍能走完**（兼容边界）：pendingNode 手动给上照旧可推进到层末', () => {
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 777)!.run!
    run.grid = undefined // 模拟老档：该层没有网格
    run.pendingNode = wormholeMakeNode(777, 1, 0)
    const turnsBefore = run.turnsLeft
    const first = wormholeAdvanceNode(ctx, run, 777)
    expect(first.ok).toBe(true)
    expect(first.spent).toBeGreaterThan(0)
    expect(run.turnsLeft).toBe(turnsBefore - first.spent!)
    const second = wormholeAdvanceNode(ctx, run, 777)
    expect(second.ok).toBe(true)
    expect(second.atLayerEnd).toBe(true)
    expect(run.pendingNode).toBeNull()
  })

  it('**战斗没结束不能撤**（网格层）：层内有进行中的战斗时撤离被拒', () => {
    const { run } = enterForActions([T1, T1, T1, T1], 5)
    run.battle = {} as never // 只验"有没有战斗宿主"这一层判据
    const r = wormholeExtract(run)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('战斗中')
    expect(run.phase).toBe('inside') // 相位没动
  })

  it('**回合耗尽只能撤离**：回合不足时三个层内动作全拒、深入被拒、撤离放行', () => {
    const { state, run } = enterForActions([T1, T1, T1, T1], 9)
    run.turnsLeft = 0
    expect(wormholeGridScan(state).mustExtract).toBe(true)
    const far = run.grid!.cells.find((c) => c.key !== `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    expect(wormholeGridTravel(state, { q: far.q, r: far.r }, { confirmUnknown: true }).mustExtract).toBe(true)
    standOnPlace(run, 'ship')
    expect(wormholeGridActivate(state).mustExtract).toBe(true)
    // 层末（本层守卫已清）后：深入被拒、撤离放行
    run.bossCleared = run.depth
    const desc = wormholeDescend(state, 9)
    expect(desc.ok).toBe(false)
    expect(desc.mustExtract).toBe(true)
    const ex = wormholeExtract(run)
    expect(ex.ok).toBe(true)
    expect(run.phase).toBe('extracting')
  })

  it('**守卫只堵"深入"**（船长 2026-09-13 改裁定）：守卫没清也能撤（照打撤离战）；深入照旧要清守卫', () => {
    const { state, run } = enterForActions([T1, T1], 77)
    // **深入**这侧的门照旧：守卫没清不许往下走
    expect(wormholeDescend(state, 77).ok).toBe(false)
    expect(wormholeDescend(state, 77).error ?? '').toContain('守卫')
    // **撤离**这侧已无条件（船长：「玩家可以无条件开始撤离，但是依旧需要打撤离战」）
    const ex = wormholeExtract(run)
    expect(ex.ok, '守卫没清也该能开始撤离').toBe(true)
    expect(run.phase).toBe('extracting')
    // 清掉守卫之后：深入放行
    const b = enterForActions([T1, T1], 77)
    b.run.bossCleared = b.run.depth
    expect(wormholeDescend(b.state, 77).ok).toBe(true)
    expect(b.run.depth).toBe(2)
  })

  it('**撤离开放**（2026-09-13 船长改裁定）：回合没耗尽、守卫没清、层内还有活 ⇒ 一样能开始撤离', () => {
    const { run } = enterForActions([T1, T1], 31)
    run.turnsLeft = 0 // 回合耗尽
    expect(wormholeOutOfTurns(run)).toBe(true)
    expect(wormholeExtract(run).ok, '回合耗尽却撤不走 = 死局').toBe(true)
    expect(run.phase).toBe('extracting')
    // 回合充足 + 守卫没清 + 层内节点还在 ⇒ 旧口径会拒，新裁定放行（代价 = 照打撤离战）
    const b = enterForActions([T1, T1], 31)
    b.run.turnsLeft = 5
    expect(wormholeOutOfTurns(b.run)).toBe(false)
    expect((b.run.bossCleared ?? 0) < b.run.depth).toBe(true)
    expect(wormholeExtract(b.run).ok).toBe(true)
    expect(b.run.phase).toBe('extracting')
    // 老档线性层的"节点没走完"也不再挡撤离（同一把尺）
    const c = enterForActions([T1, T1], 31)
    c.run.grid = undefined
    c.run.pendingNode = wormholeMakeNode(31, 1, 0)
    expect(wormholeExtract(c.run).ok).toBe(true)
  })

  it('战斗中的逃生门不生效：**战斗没结束一律不能撤**（船长裁定优先于回合）', () => {
    const { run } = enterForActions([T1, T1], 41)
    run.turnsLeft = 0
    run.battle = {} as never // 只验"有没有战斗宿主"这一层判据
    const r = wormholeExtract(run)
    expect(r.ok).toBe(false)
    expect(r.error ?? '').toContain('战斗中')
    expect(run.phase).toBe('inside')
  })

  it('深入下一层：层末可用，深度 +1、**换成一张新盘**（入口重随机、进度清零）', () => {
    const { state, run } = enterForActions([T1, T1], 42)
    const oldGrid = run.grid!
    run.bossCleared = run.depth
    expect(wormholeDescend(state, 42).ok).toBe(true)
    expect(run.depth).toBe(2)
    expect(run.nodeIndex).toBe(0)
    expect(run.nodesPerLayer).toBe(wormholeNodesPerLayer(2))
    const g2 = run.grid!
    expect(g2).not.toBe(oldGrid)
    expect(g2.radius).toBe(wormholeGridRadiusFor(2))
    expect(g2.pos).toEqual(g2.start) // 新层从新入口格开始
    expect(g2.visited).toEqual([`${g2.start.q},${g2.start.r}`])
    expect(g2.activated).toEqual([])
    expect(g2.scanned).toEqual([`${g2.start.q},${g2.start.r}`])
    // 老盘的对象不再被引用（避免"两层共用一个 cells 数组"这类串层 bug）
    expect(oldGrid.activated).not.toBe(g2.activated)
    // 再深一层：半径按层曲线（层 3 = 3）
    run.bossCleared = run.depth
    expect(wormholeDescend(state, 42).ok).toBe(true)
    expect(run.depth).toBe(3)
    expect(run.nodesPerLayer).toBe(3)
    expect(run.grid!.radius).toBe(wormholeGridRadiusFor(3))
  })

  /**
   * **深入下一层要带上"编队扫码加成"**（2026-09-13 二号接线单）：`wormholeDescend` 的第三个入参是
   * 新盘的扫描半径加成，不传就默认 0 ⇒ 侦察舰/电子舰的「扫码范围 +1 圈」**只会在第 1 层生效**。
   * 这条同时钉住两件事：① core 认这个入参；② 加成真的体现在**新盘**上（不是只写进入口那一层）。
   */
  it('**深入下一层带上扫码加成**：新盘 scanRadius = 基础 + 编队加成（侦察舰 1 艘 = +1 圈）', () => {
    // 不带加成：新盘扫描半径 = 基础值
    // 不带加成：新盘扫描半径 = 基础值
    const { state: plainState, run: plain } = enterForActions([T1, T1], 42)
    plain.bossCleared = plain.depth
    expect(wormholeDescend(plainState, 42).ok).toBe(true)
    const baseScan = plain.grid!.scanRadius
    // 带 +1 圈：同一 seed/层 ⇒ 只有扫描半径不同（盘面其余部分同源）
    const { state: boostedState, run: boosted } = enterForActions([T1, T1], 42)
    boosted.bossCleared = boosted.depth
    expect(wormholeDescend(boostedState, 42, 1).ok).toBe(true)
    expect(boosted.grid!.scanRadius).toBe(baseScan + 1)
    expect(boosted.grid!.cells.length).toBe(plain.grid!.cells.length) // 加成只改"能扫多远"，不改盘大小
    // **编队里真有船带这个加成**（数据侧 `wormholeScanRadiusBonus`；三族电子/侦察舰各 1）
    const scout = 'sh-wh-g-frigate' // G 族侦察舰（`wormholeScanRadiusBonus: 1`；专属舰，施工期对玩家不可见）
    const { state: withScoutState, run: withScout } = enterForActions([T1, scout], 42)
    expect(wormholeScanBonusOf(ctx, withScout.fleet)).toBe(1)
    expect(wormholeScanBonusOf(ctx, [T1, T1])).toBe(0)
    withScout.bossCleared = withScout.depth
    expect(wormholeDescend(withScoutState, 42, wormholeScanBonusOf(ctx, withScout.fleet)).ok).toBe(true)
    expect(withScout.grid!.scanRadius).toBe(baseScan + 1)
  })

  it('节点生成是确定性的（同 seed/depth/index ⇒ 同结果）——老档线性口径仍可用', () => {
    const a = wormholeMakeNode(2026, 3, 1)
    const b = wormholeMakeNode(2026, 3, 1)
    expect(a).toEqual(b)
    expect(a.cost).toBeGreaterThanOrEqual(1)
  })
})

describe('虫洞 · 层内网格动作（F3a-2 · 扫描 / 前往 各 1 回合；**激活免费**（2026-09-15））', () => {
  it('**扫描**：1 回合揭开"当前格 + 周围一圈"；周围都扫过 ⇒ 拒绝且不扣回合', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    const turnsBefore = run.turnsLeft
    const r = wormholeGridScan(state)
    expect(r.ok).toBe(true)
    expect(r.spent).toBe(1)
    expect(run.turnsLeft).toBe(turnsBefore - 1)
    expect(r.revealed!.length).toBeGreaterThan(0)
    // 揭开的每一格：都在扫描半径内、且确实进了 `scanned`
    for (const rv of r.revealed!) {
      const cell = g.cells.find((c) => c.key === rv.key)!
      expect(hexDistance({ q: cell.q, r: cell.r }, g.pos)).toBeLessThanOrEqual(g.scanRadius)
      expect(g.scanned).toContain(rv.key)
      // 信号如实回报：空信息地点 ⇒ null（**不是**伪装成"舰船信号"）
      expect(rv.signal).toBe(cell.place === 'empty' ? null : rv.signal)
    }
    // 入口格在外圈 ⇒ 一圈扫完，再扫没有新格：拒绝且回合不动
    const again = wormholeGridScan(state)
    expect(again.ok).toBe(false)
    expect(again.error ?? '').toContain('扫过')
    expect(run.turnsLeft).toBe(turnsBefore - 1)
  })

  it('**前往**：不限距离、一律 1 回合；未扫描的格先拒（`unknown-target`），确认后才动', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    const turnsBefore = run.turnsLeft
    const far = g.cells.find((c) => hexDistance(c, g.pos) >= 2)!
    const target = { q: far.q, r: far.r }
    const ask = wormholeGridTravel(state, target)
    expect(ask.ok).toBe(false)
    expect(ask.code).toBe('unknown-target') // 界面据此弹「即将前往未知地点」
    expect(run.turnsLeft).toBe(turnsBefore) // 被拒不扣回合
    expect(g.pos).toEqual(g.start)
    const go = wormholeGridTravel(state, target, { confirmUnknown: true })
    expect(go.ok).toBe(true)
    expect(go.spent).toBe(1)
    expect(run.turnsLeft).toBe(turnsBefore - 1)
    expect(g.pos).toEqual(target)
    expect(go.arrived!.place).toBe(far.place) // 到达 ⇒ 拿到确切信息
    expect(g.visited).toContain(far.key)
    expect(go.arrived!.atExit).toBe(`${g.exit.q},${g.exit.r}` === far.key)
    // 原地不动 / 盘外 ⇒ 都拒
    expect(wormholeGridTravel(state, target).ok).toBe(false)
    expect(wormholeGridTravel(state, { q: 99, r: 0 }).ok).toBe(false)
    expect(run.turnsLeft).toBe(turnsBefore - 1)
  })

  it('**激活**（2026-09-15 起**不消耗回合**）：空信息地点拒；舰船信号 ⇒ 交火效果；入口格 ⇒ 层末守卫效果；每格只算一次', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    // 空信息地点：没有可执行的作业
    standOnPlace(run, 'empty')
    const turnsBefore = run.turnsLeft
    const empty = wormholeGridActivate(state)
    expect(empty.ok).toBe(false)
    expect(empty.error ?? '').toContain('什么都没有')
    expect(run.turnsLeft).toBe(turnsBefore)
    // 舰船信号：给"开战"效果 + **不扣回合** + 记进 activated
    const shipKey = standOnPlace(run, 'ship')
    const fight = wormholeGridActivate(state)
    expect(fight.ok).toBe(true)
    expect(fight.spent).toBe(0) // ⚠ 船长 2026-09-15：「移除玩家激活时需要消耗1回合（包括层末守卫）」
    expect(fight.effect).toEqual({ kind: 'battle', key: shipKey })
    expect(run.turnsLeft).toBe(turnsBefore)
    expect(g.activated).toContain(shipKey)
    expect(wormholeGridActivate(state).ok).toBe(false) // 同一个地点不重复计
    // 层末入口：优先于地点自身类型（入口的意义就是"下一层"）
    g.pos = { q: g.exit.q, r: g.exit.r }
    g.visited.push(`${g.exit.q},${g.exit.r}`)
    g.activated = g.activated.filter((k) => k !== `${g.exit.q},${g.exit.r}`)
    const boss = wormholeGridActivate(state)
    expect(boss.ok).toBe(true)
    expect(boss.spent).toBe(0) // 层末守卫同样免费（船长点名的那一条）
    expect(run.turnsLeft).toBe(turnsBefore)
    expect(boss.effect).toEqual({ kind: 'exit', key: `${g.exit.q},${g.exit.r}` })
    // 守卫已清 ⇒ 入口格不再重复触发
    run.bossCleared = run.depth
    g.activated = g.activated.filter((k) => k !== `${g.exit.q},${g.exit.r}`)
    const again = wormholeGridActivate(state)
    expect(again.ok).toBe(false)
    expect(again.error ?? '').toContain('守卫')
  })

  it('**免激活三地点**（船长 F5）：墓场/遗迹/矿脉在"激活"这条路上直接拒绝（不扣回合）；谜质照旧可激活', () => {
    const { state, run } = enterForActions()
    // 船长 2026-09-13：「资源点和墓场遗迹改为不用激活」⇒ 走到就铺好产出，玩家直接打捞/采集。
    // 故这三个地点在 `wormholeGridActivate` 上**拒绝**（免得白扣一回合），改由界面走「打捞 / 采集」。
    const noActivate: WormholePlace[] = ['graveyard', 'ruins', 'vein']
    for (const place of noActivate) {
      const key = standOnPlace(run, place)
      const turnsBefore = run.turnsLeft
      const r = wormholeGridActivate(state)
      expect(r.ok, `${place} 不该能激活`).toBe(false)
      expect(r.error ?? '').toContain('不用激活')
      expect(run.turnsLeft).toBe(turnsBefore) // 被拒 ⇒ 不扣回合
      expect(run.grid!.activated).not.toContain(key) // 也不算"已处理"
    }
    // 谜质不在免激活名单里：照旧「激活 ⇒ 取回」
    const matterKey = standOnPlace(run, 'matter')
    const m = wormholeGridActivate(state)
    expect(m.ok).toBe(true)
    expect(m.effect).toEqual({ kind: 'matter', key: matterKey })
  })

  it('**到达即触发**（船长 2026-09-13）：走到舰船信号 ⇒ 回报 autoBattle 且该格记已处理（不再需要激活）', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    // 把某个已扫描的邻格改成舰船信号，再走过去（等价"扫描看到了舰船信号、决定过去"）
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'ship'
    g.scanned.push(target.key)
    const turnsBefore = run.turnsLeft
    const r = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(r.ok).toBe(true)
    expect(r.arrived?.autoBattle).toBe(true)
    expect(r.spent).toBe(1) // 只花"前往"那 1 回合：到达即开打，不再有第二次激活扣费
    expect(run.turnsLeft).toBe(turnsBefore - 1)
    expect(g.activated).toContain(target.key)
    // 已经处理过 ⇒ 再走一遍（来回）不会重复触发开战
    g.scanned.push(`${g.start.q},${g.start.r}`)
    expect(wormholeGridTravel(state, { q: g.start.q, r: g.start.r }).ok).toBe(true)
    const back = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(back.ok).toBe(true)
    expect(back.arrived?.autoBattle).toBeUndefined()
    // 该格也不再能被"激活"（已处理）
    expect(wormholeGridActivate(state).ok).toBe(false)
  })

  it('**漂浮信标**（船长 2026-09-13）：走到信标格 ⇒ 回报 beacon + 标出下一层入口（此后地图一直标着）', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    expect(g.exitKnown).toBe(false) // 默认为假：入口不标在地图上（还没读信标、也没扫到出口格）
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'beacon'
    g.scanned.push(target.key)
    const r = wormholeGridTravel(state, { q: target.q, r: target.r })
    expect(r.ok).toBe(true)
    expect(r.arrived?.beacon).toBe(true)
    expect(g.exitKnown).toBe(true)
    expect(g.activated).toContain(target.key)
    // 信标读过了：不能重复激活
    const again = wormholeGridActivate(state)
    expect(again.ok).toBe(false)
    expect(again.error ?? '').toContain('信标')
  })

  it('信标与入口是两件东西：入口格本身**不因为被标出**而变成"已到达"', () => {
    const { state, run } = enterForActions()
    const g = run.grid!
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'beacon'
    g.scanned.push(target.key)
    expect(wormholeGridTravel(state, { q: target.q, r: target.r }).ok).toBe(true)
    expect(g.exitKnown).toBe(true)
    expect(g.visited).not.toContain(`${g.exit.q},${g.exit.r}`) // 只是"知道在哪"，没到过
    // 到了入口格才算到达，且到了仍要**激活**才打守卫（守卫战不是"到达即开打"）
    g.scanned.push(`${g.exit.q},${g.exit.r}`)
    const arrive = wormholeGridTravel(state, { q: g.exit.q, r: g.exit.r })
    expect(arrive.ok).toBe(true)
    expect(arrive.arrived?.atExit).toBe(true)
    expect(arrive.arrived?.autoBattle).toBeUndefined()
    expect(run.battle ?? null).toBeNull()
    expect(wormholeGridActivate(state).effect).toEqual({ kind: 'exit', key: `${g.exit.q},${g.exit.r}` })
  })

  it('战斗中：三个层内动作全部拒绝（与"战斗没结束不能撤"同一把尺）', () => {
    const { state, run } = enterForActions()
    run.battle = {} as never
    expect(wormholeGridScan(state).ok).toBe(false)
    expect(wormholeGridTravel(state, { q: 0, r: 0 }, { confirmUnknown: true }).ok).toBe(false)
    expect(wormholeGridActivate(state).ok).toBe(false)
    expect(run.turnsLeft).toBe(run.turnsTotal)
  })

  it('网格动作只认"人在洞里"的现场：不在洞里 / 老档没网格 ⇒ 全部拒绝', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(wormholeGridScan(s).ok).toBe(false)
    expect(wormholeGridTravel(s, { q: 0, r: 0 }).ok).toBe(false)
    expect(wormholeGridActivate(s).ok).toBe(false)
    const { state, run } = enterForActions()
    run.grid = undefined // 老档该层没有网格
    expect(wormholeGridScan(state).ok).toBe(false)
    expect(wormholeGridActivate(state).ok).toBe(false)
    expect(wormholeGridTravel(state, { q: 0, r: 0 }).ok).toBe(false)
  })
})

describe('虫洞 · 层曲线（收益涨得比威胁快 —— 船长 2026-09-13 定）', () => {
  it('威胁每层 ×1.10（层 1 = 45）、收益每层 ×1.2 ⇒ 单位威胁收益逐层严格上升', () => {
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeLayerThreat(2)).toBe(50) // round(45×1.10)（2026-09-15 由 ×1.16 降下来）
    expect(wormholeLayerThreat(3)).toBe(54) // round(45×1.10²)
    expect(wormholeLayerThreat(7)).toBe(80) // 深层读数：层 7/8 曾因 ×1.16 成"墙"
    expect(wormholeLayerThreat(8)).toBe(88)
    expect(wormholeLayerRewardMul(1)).toBeCloseTo(1, 9)
    expect(wormholeLayerRewardMul(2)).toBeCloseTo(1.2, 9)
    const perThreat = (d: number): number => wormholeLayerRewardMul(d) / wormholeLayerThreat(d)
    // 逐层**严格递增**（这正是"深层收益比难度曲线更高"的数学形式）
    for (let d = 1; d <= 12; d += 1) {
      expect(perThreat(d + 1), `第 ${d + 1} 层单位威胁收益应高于第 ${d} 层`).toBeGreaterThan(perThreat(d))
    }
  })
})

describe('虫洞 · v25 存档（纯新增字段 + 零迁移）', () => {
  // ⚠ 版本号随存档结构演进往上抬：v26 = 「第一次」老档一次性判定；v27 = 市场链换口径的一次性折算
  it('新档带空虫洞状态；当前存档版本 = 27（v27 = 市场链换口径的一次性老档折算）', () => {
    expect(CURRENT_STATE_VERSION).toBe(27)
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    expect(s.version).toBe(27)
    expect(s.wormhole).toEqual({ run: null, lastFleetLost: 0 })
  })

  it('老档（缺 wormhole 字段）读档 ⇒ 补空状态，不报错', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 1 })
    const raw = JSON.parse(serializeSaveFile(s, 0)) as { version: number; state: Record<string, unknown> }
    delete raw.state.wormhole
    raw.version = 24
    raw.state.version = 24
    const loaded = loadSaveFile(JSON.stringify(raw))
    expect(loaded.state.wormhole).toEqual({ run: null, lastFleetLost: 0 })
  })

  it('进行中的副本状态随档往返不丢（层/回合/背包/待处理节点）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 3 })
    const run = wormholeStartRun(ctx, [T1, T1, T1, T1], 2026)!.run!
    run.bag.push({ itemId: 'ore-voidmother', units: 800 })
    run.turnsLeft -= 3
    s.wormhole = { run, lastFleetLost: 1 }
    const loaded = loadSaveFile(serializeSaveFile(s, 0)).state
    const back = loaded.wormhole.run!
    expect(back.phase).toBe('inside')
    expect(back.depth).toBe(1)
    expect(back.turnsLeft).toBe(run.turnsLeft)
    expect(back.turnsTotal).toBe(93)
    expect(back.fleet).toEqual([T1, T1, T1, T1])
    expect(back.bag).toEqual([{ itemId: 'ore-voidmother', units: 800 }])
    // 层内网格随档（F3a）：位置/真相/已扫描/终点都在（细项由 wormhole-grid.test.ts 钉）
    expect(back.grid).toBeTruthy()
    expect(back.grid!.pos).toEqual(run.grid!.pos)
    expect(back.grid!.cells.length).toBe(run.grid!.cells.length)
    expect(loaded.wormhole.lastFleetLost).toBe(1)
  })

  it('坏掉的虫洞字段 ⇒ 当作"不在洞里"（不静默留半截状态）', () => {
    const s: GameState = createInitialState({ nowWallMs: 0, seed: 4 })
    const raw = JSON.parse(serializeSaveFile(s, 0)) as { state: Record<string, unknown> }
    raw.state.wormhole = { run: { phase: '飞升', depth: 'x', bag: 'nope' }, lastFleetLost: -5 }
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.wormhole.run).toBeNull()
    expect(loaded.wormhole.lastFleetLost).toBe(0)
  })
})
