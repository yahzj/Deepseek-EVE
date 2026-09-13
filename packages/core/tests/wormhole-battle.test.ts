/**
 * **虫洞 · 洞内战斗与收口（F 批 · 2026-09-13）**。
 *
 * 锁住五组口径：
 * ① **敌卡按层派生**：威胁 = 层曲线（普通节点 / BOSS ×1.2 / 撤离战 ×0.8）；舰级绝对值按比例缩放；
 *    波数把同一编成摊成 N 波（**总战力守恒**）；**选靶模式**随用途分流（BOSS = 打最大的）；
 * ② **开战**：`run.battle` 宿主 + `battle.wormhole` 标记（逐拍同源重建）+ 4 舰编队；
 * ③ **收口 · 胜**：节点战 ⇒ 自动结算该节点（扣回合、推进）；层末守卫 ⇒ 记 `bossCleared` 后放行深入/撤离；
 *    撤离战 ⇒ **收益入港**（背包并入仓库）并结束本趟；
 * ④ **收口 · 负**（= 我方全灭，D 批口径）：**全损**——编队全丢、背包清空；
 * ⑤ **门与句柄**：战斗中不许推进/深入/撤离；层末守卫未清不许深入/撤离。
 *
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），拍板权在船长。
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare, countWare } from '../src/inventory'
import { advanceBattleFor, battleOpenM, createFoeSpecs, createPlayerSpec, desiredRangeFor, foeDesiredRange, foeHpOfThreat } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_FOE_CARD_IDS,
  WORMHOLE_ORE_ITEM_ID,
  wormholeAnomalyOf,
  wormholeCardIdFor,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeFoeThreat,
  wormholeLayerThreat,
  wormholeNaturalHp,
} from '../src/wormhole'
import { advanceWormhole, wormholeBattleViewOf, wormholeStartBattle } from '../src/wormholeBattle'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 21): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟（2×T3 = 7,000 质量 ⇒ 42 回合），并返回状态 */
function enterRun(seed = 21): GameState {
  const state = fresh(seed)
  const a = addShipToFleet(state, T3)
  const b = addShipToFleet(state, T3)
  state.shipId = a
  const r = wormholeEnter(state, ctx, [a, b], seed)
  expect(r.ok).toBe(true)
  return state
}

/** 把场上敌人打光并判我方胜（不动我方血量） */
function winBattle(state: GameState): void {
  const battle = state.wormhole.run!.battle!
  for (const u of Object.values(battle.units)) {
    if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
  }
  battle.ended = 'me'
}

/**
 * **收口一场已分胜负的战斗**：跳过「击杀慢镜」窗口（与远征 `bal.killcamMs` 同源）再推进。
 * 引擎在 `ended` 之后**延迟结算**——为的是让战斗界面把最后一击/爆炸演出播完
 * （首版实测：不延迟的话战斗界面会在结束那一瞬间直接卸载，战报窗口没机会播）。
 */
function settleBattle(state: GameState): void {
  const b = state.wormhole.run?.battle
  if (b) state.gameMs = b.lastTickGameMs + 10_000
  advanceWormhole(state, ctx)
}

describe('虫洞 · 洞内敌卡按层派生（F 批）', () => {
  it('威胁随用途分流：普通节点 = 层威胁 · BOSS ×1.2 · 撤离战 ×0.8', () => {
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeFoeThreat(1, 'node')).toBe(45)
    expect(wormholeFoeThreat(1, 'boss')).toBe(54) // 45 × 1.2
    expect(wormholeFoeThreat(1, 'extract')).toBe(36) // 45 × 0.8
    expect(wormholeFoeThreat(3, 'node')).toBe(wormholeLayerThreat(3))
    expect(wormholeFoeThreat(3, 'boss')).toBe(Math.round(wormholeLayerThreat(3) * 1.2))
  })

  it('四张洞内敌卡按 (层, 节点) 确定性轮换，且四族都真实存在于目录里', () => {
    const ids = new Set<string>()
    for (let d = 1; d <= 3; d++) {
      for (let i = 0; i < 3; i++) {
        const id = wormholeCardIdFor(d, i)
        ids.add(id)
        expect(wormholeCardIdFor(d, i)).toBe(id) // 确定性
      }
    }
    expect(ids.size).toBe(WORMHOLE_FOE_CARD_IDS.length) // 轮换覆盖全部四张
    for (const id of WORMHOLE_FOE_CARD_IDS) {
      const card = ctx.anomalies.get(id)
      expect(card, `目录里没有洞内敌卡 ${id}`).toBeTruthy()
      expect(card!.hidden).toBe(true) // 施工期必须隐藏（不进悬赏目录）
      expect((card!.ships ?? []).length).toBeGreaterThan(0) // 舰级路径
    }
  })

  it('派生：威胁换成目标值、**总血压到该层预算**（按卡归一）；**波数摊薄但总战力守恒**', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const naturalHp = wormholeNaturalHp(base)
    const one = wormholeAnomalyOf(base, 1, 'node', 1, { hpBudget: naturalHp * 2 })
    expect(one.threat).toBe(45)
    // 目标总血 = 预算（**按卡归一**：卡间的坦克/脆皮差异不再影响"威胁 = 战力标尺"）
    expect(wormholeNaturalHp(one)).toBeCloseTo(naturalHp * 2, 3)
    // 波数摊薄：同一预算摊成两波 ⇒ 条数翻倍、每条半血、**总血不变**
    const two = wormholeAnomalyOf(base, 1, 'node', 2, { hpBudget: naturalHp * 2 })
    expect(wormholeNaturalHp(two)).toBeCloseTo(naturalHp * 2, 3)
    expect((two.ships ?? []).length).toBe((one.ships ?? []).length * 2)
    expect(two.waves?.length).toBe(2)
    // 深层：预算由引擎按层算（`foeHpOfThreat(威胁) × 系数`）⇒ 这里给更大预算即代表更深一层
    const deep = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: naturalHp * 3 })
    expect(deep.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(deep)).toBeCloseTo(naturalHp * 3, 3)
    // 不给预算（纯展示/校准口径）：只换威胁字段，条目保持自然值
    const bare = wormholeAnomalyOf(base, 4, 'node', 1)
    expect(bare.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(bare)).toBeCloseTo(naturalHp, 3)
  })

  it('选靶模式随用途分流：普通节点用卡上模式、**BOSS 一律打最大的**', () => {
    const pirate = ctx.anomalies.get('wh-pirate-scout')!
    const alien = ctx.anomalies.get('wh-alien-swarm')!
    const grave = ctx.anomalies.get('wh-grave-watch')!
    const exile = ctx.anomalies.get('wh-exile-blockade')!
    expect(wormholeAnomalyOf(pirate, 1, 'node', 1).foeTargeting).toBe('noncombat')
    expect(wormholeAnomalyOf(alien, 1, 'node', 1).foeTargeting).toBe('smallest')
    expect(wormholeAnomalyOf(grave, 1, 'node', 1).foeTargeting).toBe('top-output')
    expect(wormholeAnomalyOf(exile, 1, 'node', 1).foeTargeting).toBe('random')
    for (const card of [pirate, alien, grave, exile]) {
      expect(wormholeAnomalyOf(card, 2, 'boss', 1).foeTargeting).toBe('largest')
    }
  })

  it('派生卡能真实建档（舰级路径）：波次数量与槽位分组一致', () => {
    const base = ctx.anomalies.get('wh-grave-watch')!
    const card = wormholeAnomalyOf(base, 3, 'node', 2)
    const w0 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: '' })
    const w1 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: 'w1-' })
    expect(w0.length).toBeGreaterThan(0)
    expect(w1.length).toBeGreaterThan(0)
    expect(w0.length).toBe(w1.length) // 同一编成分波 ⇒ 每波条数相同
  })
})

describe('虫洞 · 开战（F 批）', () => {
  it('战斗节点可开战：宿主在 run.battle、带 wormhole 标记、我方 4 单位路径生效', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 2, pickups: 0, cost: 2 }
    const r = wormholeStartBattle(state, ctx, 'node', 0)
    expect(r.ok).toBe(true)
    const battle = run.battle!
    expect(battle.wormhole).toEqual({ cardId: wormholeCardIdFor(1, 0), depth: 1, kind: 'node', waves: 2 })
    expect(battle.myFleet?.length).toBe(2) // 两艘都在（主控置首）
    expect(battle.hullEscapeFrac).toBeUndefined() // 副本内无"结构过半自动脱离"
    // 敌卡已按层派生：威胁 45 的卡 + 2 波
    expect(battle.waveIdx ?? 0).toBe(0)
    const foes = Object.values(battle.units).filter((u) => u.side === 'foe')
    expect(foes.length).toBeGreaterThan(0)
    // 同一战斗不能重复开
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(false)
  })

  it('战斗中：推进 / 深入 / 撤离一律被拒（船长第 8 条）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    expect(wormholeExtract(run).ok).toBe(false)
    expect(wormholeDescend(run, 21).ok).toBe(false)
    expect(run.phase).toBe('inside')
  })

  it('层末守卫：层内走完才可开，打完才放行深入/撤离', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(false) // 层内还没走完
    run.pendingNode = null
    expect(wormholeDescend(run, 21).ok).toBe(false) // 守卫没清
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    expect(run.bossCleared).toBe(1)
    expect(run.battle).toBeNull()
    expect(wormholeDescend(run, 21).ok).toBe(true)
    expect(run.depth).toBe(2)
  })
})

describe('虫洞 · 战斗收口（F 批）', () => {
  it('**胜 · 节点战**：自动结算本节点（扣回合、推进），战斗清空', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    const turnsBefore = run.turnsLeft
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    expect(run.battle).toBeNull()
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 节点开销已扣
    expect(run.nodeIndex).toBe(1) // 已推进
  })

  it('**胜 · 撤离战**：背包并入仓库、本趟结束', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = null
    run.bossCleared = run.depth
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    expect(run.phase).toBe('extracting')
    // 撤离战由 `advanceWormhole` 自动开打
    advanceWormhole(state, ctx)
    expect(run.battle).not.toBeNull()
    expect(run.battle!.wormhole?.kind).toBe('extract')
    winBattle(state)
    settleBattle(state)
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + 500) // 收益入港
    expect(state.wormhole.run).toBeNull() // 本趟结束
  })

  it('**负 · 全灭**：全损——编队全丢、背包清空、本趟结束', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const fleetBefore = Object.keys(state.fleet).length
    const runFleet = [...run.fleet]
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 300 }]
    const oreBefore = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    for (const u of Object.values(battle.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    battle.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastFleetLost).toBe(runFleet.length)
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - runFleet.length) // 船真丢了
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(oreBefore) // 背包内容没入港
  })

  it('某个僚舰被打沉（战斗仍胜）：该船从编队与舰队里一起消失，其余船继续', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    const fleetBefore = Object.keys(state.fleet).length
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 } // 僚舰沉
    winBattle(state)
    settleBattle(state)
    expect(run.fleet.length).toBe(1) // 编队只剩主控
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - 1)
    expect(state.wormhole.run).not.toBeNull() // 还有船 ⇒ 本趟继续
    expect(run.battle).toBeNull()
  })

  it('撤离战开不起来（编队没了之类的硬故障）⇒ 按全损收场，不卡在撤离相位', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = null
    run.bossCleared = run.depth
    run.bag = []
    // 掏空编队记录 ⇒ `startFleetBattleFor` 建不出战斗
    run.fleet = []
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull()
  })
})

describe('虫洞 · 开战距离与派生一致性（船长 2026-09-13 两条口径）', () => {
  it('**开战距离特殊规则**：非近战敌人开局就站在**自己的目标距离**（不是"最远射程 + 缓冲"）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const card = ctx.anomalies.get(battle.wormhole!.cardId)!
    const me = createPlayerSpec(state, ctx, run.fleet[0]!)!
    const foes = createFoeSpecs(
      wormholeAnomalyOf(card, 1, 'node', 1, {
        hpBudget: foeHpOfThreat(wormholeLayerThreat(1), ctx.balance.battle) * 10,
      }),
      ctx.balance.battle,
    )
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    const expected = anyBrawl
      ? desiredRangeFor(me, 'mid', ctx.balance.battle)
      : foeDesiredRange(me, foes, ctx.balance.battle)
    const openM = battleOpenM(me, foes, ctx.balance.battle)
    // 常规口径是"最远射程 + 缓冲"（= openM）；洞内口径落在**目标距离**上（被 openM 钳制的场合取钳制值）
    expect(battle.distanceM).toBe(
      Math.max(ctx.balance.battle.minDistanceM, Math.min(openM, Math.round(expected))),
    )
    expect(battle.distanceM).toBeLessThanOrEqual(openM)
  })

  it('**逐拍重建与开战同源**：敌人真能打疼你（首版就错在这里——血强化了、炮还是自然值）', () => {
    const state = enterRun(7)
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const meTags = (battle.myFleet ?? []).map((e) => e.tag)
    const hpSum = (): number =>
      meTags.reduce((n, t) => {
        const u = battle.units[t]
        return n + (u ? u.hp.s + u.hp.a + u.hp.h : 0)
      }, 0)
    const before = hpSum()
    let guard = 0
    while (!battle.ended && guard < 180) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
      guard++
    }
    const lost = before - hpSum()
    expect(battle.stats.foeShots, '敌人整场没开火（开战距离或派生口径又错了）').toBeGreaterThan(0)
    expect(lost, '敌人开火了却打不掉血（开战 / 逐拍两处派生不同源）').toBeGreaterThan(0)
    // 强度系数 10 的口径下，这一场应当打出**成规模**的战损（不是挠痒痒）
    expect(lost / before).toBeGreaterThan(0.05)
  })
  it('**战报**：每场洞内战斗结束都留一条同源战报（交火时长 / 双方开火命中 / 编队残血）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    const line = state.logs.map((l) => l.text).filter((t) => t.includes('交火结束')).pop()
    expect(line, '节点战胜利没有战报').toBeTruthy()
    expect(line!).toContain('第 1 层节点')
    expect(line!).toContain('编队残血')
    // 撤离战同样有战报（且与"撤离成功"分开两条）
    const run2 = state.wormhole.run!
    run2.pendingNode = null
    run2.bossCleared = run2.depth
    run2.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    expect(wormholeExtract(run2).ok).toBe(true)
    advanceWormhole(state, ctx) // 自动开撤离战
    winBattle(state)
    settleBattle(state)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离拦截交火结束'))).toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离成功'))).toBe(true)
  })
  it('**战后弹药退款**（与远征同款）：仓库只损失**真打出去**的那些 ⇒ 连打第二场不会哑火', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    // 让编队真带上炮与弹（默认档里两艘 T3 没装配）
    for (const uid of run.fleet) {
      state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
    }
    addWare(state, 'ammo-kinetic-l', 5_000)
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    const before = countWare(state, 'ammo-kinetic-l')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const loaded = battle.ammo.kin
    expect(loaded).toBeGreaterThan(0) // 开战装载了两艘船各自的弹
    // 真打一会儿（会消耗弹药）
    let guard = 0
    while (!battle.ended && guard++ < 90) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
    }
    const left = battle.ammo.kin
    const fired = loaded - left
    if (!battle.ended) {
      for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
      battle.ended = 'me'
    }
    settleBattle(state)
    // **退款 = 未打出去的那部分**（首版漏退款 ⇒ 每场把整批预载吞掉，第二场起全队哑火）
    expect(countWare(state, 'ammo-kinetic-l')).toBe(before - fired)
    // 第二场照样有弹
    const run2 = state.wormhole.run
    if (run2?.pendingNode?.kind === 'combat') {
      expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
      expect(state.wormhole.run!.battle!.ammo.kin).toBeGreaterThan(0)
    }
  })
})

describe('虫洞 · 战场视图（F2 · 2026-09-13）', () => {
  it('视图上下文：给出按层派生的敌卡 / 主控锚 / 场景名；**分胜负后仍要给 combat**（击杀慢镜窗口）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(wormholeBattleViewOf(state, ctx)).toBeNull() // 没开战时没有视图
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const v = wormholeBattleViewOf(state, ctx)!
    expect(v.name).toBe('虫洞 · 第 1 层')
    expect(v.leaderShipId).toBe(run.fleet[0])
    expect(v.anomaly.threat).toBe(wormholeLayerThreat(1)) // 已按层派生
    expect(v.combat).not.toBeNull()
    expect(Object.keys(v.combat!.foeHp).length).toBeGreaterThan(0)
    // **分出胜负后 combat 仍在**：战斗界面靠它把最后一击/战报窗口播完（提前置 null ⇒ 界面直接卸载）
    winBattle(state)
    const v2 = wormholeBattleViewOf(state, ctx)!
    expect(v2.combat).not.toBeNull()
    // 结算之后（战斗宿主清掉）视图才消失
    settleBattle(state)
    expect(state.wormhole.run!.battle).toBeNull()
    expect(wormholeBattleViewOf(state, ctx)).toBeNull()
  })

  it('击杀慢镜：分出胜负后要等 `killcamMs` 才结算（否则战斗界面一结束就卸载）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 1, pickups: 0, cost: 1 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    // 未满窗口：不结算、战斗还在
    state.gameMs = run.battle!.lastTickGameMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).not.toBeNull()
    // 满窗口：结算落地
    state.gameMs = run.battle!.lastTickGameMs + ctx.balance.battle.killcamMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).toBeNull()
  })
})

describe('虫洞 · 随档（F 批）', () => {
  it('战斗宿主与升级标记随档往返：`run.battle` + `battle.wormhole` + `bossCleared` 都不丢', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.pendingNode = { kind: 'combat', waves: 2, pickups: 0, cost: 2 }
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.bossCleared = 1
    // 战斗中掉一点血，便于断言"动态量也带过去了"
    run.battle!.units['player']!.hp = { s: 1, a: 2, h: 3 }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.battle, '战中重载丢了战斗宿主').toBeTruthy()
    expect(back.battle!.wormhole).toEqual(run.battle!.wormhole)
    expect(back.battle!.myFleet).toEqual(run.battle!.myFleet)
    expect(back.battle!.units['player']!.hp).toEqual({ s: 1, a: 2, h: 3 })
    expect(back.bossCleared).toBe(1)
    // 归一化容错：坏掉的战斗标记 ⇒ 丢弃（退回原卡强度）而不是整档弃置
    const raw = JSON.parse(serializeSaveFile(state, 1)) as {
      state: { wormhole: { run: { battle: { wormhole: unknown } } } }
    }
    raw.state.wormhole.run.battle.wormhole = { cardId: '', kind: 'nope', depth: -1 }
    const broken = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!.battle
    expect(broken).toBeTruthy()
    expect(broken!.wormhole).toBeUndefined()
  })
})
