/**
 * **虫洞 · 我方多单位战斗路径**（D 批 · 2026-09-13 船长指令：「4 艘同时参战」）。
 *
 * 锁住设计稿 `docs/design/wormhole-extraction-endgame-20260912.md` §二 冲突 1 的落地口径：
 * ① 主控恒为 `player`（既有单船路径的 tag 不变）、僚舰 `ally-1..3`，主控 = `state.shipId` 自动置首；
 * ② **弹药整队共用一个池，但池 = 每艘船各自装载量之和**（各船照付成本）；
 * ③ 敌方五种**选靶模式**（随机 / 输出最高 / 最小 / 最大 / 非战斗船）与并列随机、无非战斗船退回随机；
 * ④ **我方全灭才判负**；⑤ 副本内**不挂**「结构过半自动脱离」保险；⑥ 僚舰无人机不参战（D 批边界）。
 *
 * ⚠⚠ **零漂移命门**：`pickMyUnitTarget` 在"只剩一艘我方单位"时**一次随机数都不消费** ——
 * 本文件用 `state.rng.count` 直接钉死这条（单船路径的 27 张卡标定读数全靠它不漂）。
 * ⚠ 施工期铁律：虫洞**对玩家不可见**（入口走调试开关、数据走 `unreleased` 闸门），拍板权在船长；
 * 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { addWare, cargoItemsOf, countWare } from '../src/inventory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  advanceBattleFor,
  aliveMyUnits,
  createBattleState,
  createPlayerSpec,
  isNonCombatShipRole,
  myUnitOutputScore,
  persistFleetHullDamage,
  pickMyUnitTarget,
  startBattleFor,
  startFleetBattleFor,
} from '../src/combat'
import { wormholeAdmission } from '../src/wormhole'
import type { UnitSpec } from '../src/combat'

const ctx = buildSimContext()
/** 教学卡：无声望门槛的真卡（与 `save-battle-fields.test.ts` 同款取用） */
const CARD = 'ano-training'

function fresh(seed = 7): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 加一艘船（可选装配，写在高槽） */
function addShip(state: GameState, defId: string, high: string[] = []): string {
  const uid = addShipToFleet(state, defId)
  if (high.length > 0) state.fleet[uid]!.fitted = { high: [...high], mid: [], low: [] }
  return uid
}

/** 逐条建规格并打上编队 tag（选靶用例用；不经真实开战，专注选靶函数本身） */
function specsWithTags(state: GameState, plan: Array<[uid: string, tag: string]>): UnitSpec[] {
  return plan.map(([uid, tag]) => {
    const spec = createPlayerSpec(state, ctx, uid)!
    spec.tag = tag
    return spec
  })
}

/** 把某单位三层血清零（"沉船"）；单位仍留在 `units` 里（与本引擎"尸体保留"同口径） */
function sink(battle: BattleState, tag: string): void {
  battle.units[tag]!.hp = { s: 0, a: 0, h: 0 }
}

/** 把敌人血量拉到打不动（`seedUnit` 不覆盖已存在 tag ⇒ 这一步之后就打不死了） */
function makeFoesInvincible(battle: BattleState): void {
  for (const u of Object.values(battle.units)) {
    if (u.side !== 'foe') continue
    u.hp = { s: 1e9, a: 1e9, h: 1e9 }
    u.hpMax = { s: 1e9, a: 1e9, h: 1e9 }
  }
}

describe('虫洞 · 我方多单位建档（4 艘同时参战）', () => {
  it('主控恒为 player 且自动置首；僚舰 ally-1..2 各按自己的船建档', () => {
    const state = fresh()
    const a = addShip(state, 'sandcat')
    const b = addShip(state, 'sh-mako')
    const c = addShip(state, 'sh-tortoise')
    state.shipId = b // 主控不在传入编队首位 —— 必须被提到第一位
    const battle = startFleetBattleFor(state, ctx, [a, b, c], CARD, 0)!
    expect(battle.myFleet!.map((e) => e.tag)).toEqual(['player', 'ally-1', 'ally-2'])
    expect(battle.myFleet!.map((e) => e.shipId)).toEqual([b, a, c])
    const mine = Object.values(battle.units)
      .filter((u) => u.side === 'me')
      .map((u) => u.tag)
    expect(mine).toEqual(['player', 'ally-1', 'ally-2'])
    // 僚舰的武器条目数与三层血上限 = 该船自己的规格（不是主控的）
    const allySpec = createPlayerSpec(state, ctx, a)!
    expect(battle.units['ally-1']!.weapons.length).toBe(allySpec.weapons.length)
    expect(battle.units['ally-1']!.hpMax).toEqual({
      s: allySpec.hp.s,
      a: allySpec.hp.a,
      h: allySpec.hp.h,
    })
    // 主控的档位/定位已写入规格（选靶模式的判据来源）
    const leaderSpec = createPlayerSpec(state, ctx, b)!
    expect(leaderSpec.shipTier).toBe(2)
    expect(leaderSpec.shipRole).toBe('armed')
  })

  it('单船路径一字不动：`startBattleFor` 不写 `myFleet`，档位/定位照写但不影响任何判据', () => {
    const state = fresh()
    const uid = addShip(state, 'sh-thresher', ['mod-turret-kin-1'])
    const single = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(single.myFleet).toBeUndefined()
    expect(Object.keys(single.units).filter((t) => single.units[t]!.side === 'me')).toEqual(['player'])
  })

  it('承伤持久化逐船：`persistFleetHullDamage` 按 `myFleet` 查本船的 tag', () => {
    const state = fresh()
    const leader = addShip(state, 'sh-thresher')
    const ally = addShip(state, 'sh-mako')
    state.shipId = leader
    const battle = startFleetBattleFor(state, ctx, [leader, ally], CARD, 0)!
    const spec = createPlayerSpec(state, ctx, ally)!
    // 僚舰掉一半结构、装甲全掉；主控完好
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: spec.hp.h * 0.5 }
    persistFleetHullDamage(state, ctx, ally, battle)
    persistFleetHullDamage(state, ctx, leader, battle)
    expect(state.fleet[ally]!.durability).toBeCloseTo(0.5, 5)
    expect(state.fleet[ally]!.armorPct).toBe(0)
    expect(state.fleet[leader]!.durability).toBe(1) // 主控没被误写到僚舰的读数上
  })
})

describe('虫洞 · 弹药整队共用一个池（池 = 各船装载之和）', () => {
  it('两艘同型同装的船 ⇒ 池恰好是单艘的两倍，且库存真被抽走两份', () => {
    /** 弹药库存 = 货舱（优先）+ 仓库（兜底），与 `loadAmmoOf` 同口径 */
    const stock = (s: GameState): number =>
      countWare(s, 'ammo-kinetic-l') + (cargoItemsOf(s)['ammo-kinetic-l'] ?? 0)

    const one = fresh()
    const u1 = addShip(one, 'sh-thresher', ['mod-turret-kin-1'])
    addWare(one, 'ammo-kinetic-l', 100_000)
    const before1 = stock(one)
    const b1 = startFleetBattleFor(one, ctx, [u1], CARD, 0)!
    expect(b1.ammo.kin).toBeGreaterThan(0)

    const two = fresh()
    const v1 = addShip(two, 'sh-thresher', ['mod-turret-kin-1'])
    const v2 = addShip(two, 'sh-thresher', ['mod-turret-kin-1']) // 同型第 2 艘（uid = `sh-thresher#2`）
    expect(v2).not.toBe(v1)
    addWare(two, 'ammo-kinetic-l', 100_000)
    const before2 = stock(two)
    const b2 = startFleetBattleFor(two, ctx, [v1, v2], CARD, 0)!
    expect(b2.ammo.kin).toBe(b1.ammo.kin * 2)
    // **成本照付**：库存少掉的正是两艘船的装载量（不存在"四艘船只花一份弹药"）
    expect(before2 - stock(two)).toBe(b2.ammo.kin)
    expect(before1 - stock(one)).toBe(b1.ammo.kin)
  })

  it('同型第 2 艘的实例 uid 也能入场校验（`sh-thresher#2` 不再被误判未知船型）', () => {
    const r = wormholeAdmission(ctx, ['sh-thresher#2'])
    expect(r.ok).toBe(true)
    expect(r.totalMass).toBe(3_500)
    expect(wormholeAdmission(ctx, ['sh-thresher#2', 'sh-thresher#3']).totalMass).toBe(7_000)
  })
})

describe('虫洞 · 敌方选靶模式（船长 2026-09-13 定）', () => {
  it('五种模式逐条：随机 / 打输出最高 / 打最小 / 打最大 / 打非战斗船', () => {
    const state = fresh()
    const big = addShip(state, 'sh-xuanwu') // T4 装甲
    const miner = addShip(state, 'sandcat') // T1 工业/采矿（非战斗）
    const gunner = addShip(state, 'sh-mako', ['mod-turret-kin-1', 'mod-turret-kin-1']) // T2 武装
    const units = specsWithTags(state, [
      [big, 'player'],
      [miner, 'ally-1'],
      [gunner, 'ally-2'],
    ])
    const battle = createBattleState(units[0]!, [], 0, 1_000, units.slice(1))
    expect(aliveMyUnits(battle, units).length).toBe(3)
    // 前提：双炮的灰鲭鲨输出分确实最高（否则"打输出最高"这条用例测不到东西）
    expect(myUnitOutputScore(units[2]!)).toBeGreaterThan(myUnitOutputScore(units[0]!))
    expect(pickMyUnitTarget(state, battle, units, 'top-output')!.tag).toBe('ally-2')
    expect(pickMyUnitTarget(state, battle, units, 'smallest')!.tag).toBe('ally-1') // 唯一的 T1
    expect(pickMyUnitTarget(state, battle, units, 'largest')!.tag).toBe('player') // 唯一的 T4
    expect(pickMyUnitTarget(state, battle, units, 'noncombat')!.tag).toBe('ally-1') // 唯一的非战斗船
    // 随机：多次抽取必须能抽到不止一艘（等权随机的可观测证据）
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) seen.add(pickMyUnitTarget(state, battle, units, 'random')!.tag)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('并列一律等权随机；编队里没有非战斗船 ⇒ 退回随机', () => {
    const state = fresh()
    const a = addShip(state, 'sandcat')
    const b = addShip(state, 'sandcat') // 同型第 2 艘：与 a 同档、同定位
    const c = addShip(state, 'sh-mako')
    const units = specsWithTags(state, [
      [a, 'player'],
      [b, 'ally-1'],
      [c, 'ally-2'],
    ])
    const battle = createBattleState(units[0]!, [], 0, 1_000, units.slice(1))
    // 两艘 T1 并列 ⇒ 「打最小的」在两艘之间随机（多次抽取两艘都出现）
    const small = new Set<string>()
    for (let i = 0; i < 40; i++) small.add(pickMyUnitTarget(state, battle, units, 'smallest')!.tag)
    expect([...small].sort()).toEqual(['ally-1', 'player'])
    // 全队都是战斗船（武装 / 装甲）⇒ 「打非战斗船」退回随机
    const onlyCombat = specsWithTags(state, [
      [c, 'player'],
      [addShip(state, 'sh-xuanwu'), 'ally-1'],
    ])
    const battle2 = createBattleState(onlyCombat[0]!, [], 0, 1_000, onlyCombat.slice(1))
    expect(isNonCombatShipRole(onlyCombat[0]!.shipRole)).toBe(false)
    expect(isNonCombatShipRole(onlyCombat[1]!.shipRole)).toBe(false)
    const picked = new Set<string>()
    for (let i = 0; i < 40; i++) picked.add(pickMyUnitTarget(state, battle2, onlyCombat, 'noncombat')!.tag)
    expect([...picked].sort()).toEqual(['ally-1', 'player'])
  })

  it('只剩一艘 / 单船路径：一次随机数都不消费（单船标定零漂移的命门）', () => {
    const state = fresh()
    const uid = addShip(state, 'sh-thresher')
    const spec = createPlayerSpec(state, ctx, uid)!
    const battle = createBattleState(spec, [], 0, 1_000)
    const before = state.rng.count
    for (const mode of ['random', 'top-output', 'smallest', 'largest', 'noncombat'] as const) {
      expect(pickMyUnitTarget(state, battle, [spec], mode)!.tag).toBe('player')
    }
    expect(state.rng.count).toBe(before)
    // 多单位下才掷骰（两艘 ⇒ 每种模式都要抽一次；`pickMyUnitTarget` 在并列/随机时各一次）
    const other = createPlayerSpec(state, ctx, addShip(state, 'sh-mako'))!
    other.tag = 'ally-1'
    const battle2 = createBattleState(spec, [], 0, 1_000, [other])
    const after1 = state.rng.count
    pickMyUnitTarget(state, battle2, [spec, other], 'random')
    expect(state.rng.count).toBe(after1 + 1)
    // 多单位减员到只剩一艘：仍走"零 rng"早退（四艘打成残局不会突然开始掷选靶骰）
    sink(battle2, 'ally-1')
    const after2 = state.rng.count
    expect(pickMyUnitTarget(state, battle2, [spec, other], 'top-output')!.tag).toBe('player')
    expect(state.rng.count).toBe(after2)
  })

  it('单船路径的"打尸体也照旧结算"口径：编队只有一条时选靶恒返回它（哪怕已沉）', () => {
    // 为什么守这条：改动前敌方主炮分支只判 `!meRt`、不判存活 ⇒ 我方被打沉的那一拍，
    // 本拍剩余敌人**仍会结算开火**（打进 `stats.foeShots`，标定工具「敌开火」列看得到）。
    // 若在选靶里按存活提前返回 null，该列会整体变小 —— D 批实测踩到过，故用这条钉住。
    const state = fresh()
    const uid = addShip(state, 'sh-thresher')
    const spec = createPlayerSpec(state, ctx, uid)!
    const battle = createBattleState(spec, [], 0, 1_000)
    sink(battle, 'player')
    expect(aliveMyUnits(battle, [spec]).length).toBe(0)
    expect(pickMyUnitTarget(state, battle, [spec], 'random')!.tag).toBe('player')
    // 多单位则相反：全灭 ⇒ 没有可打的目标（那一拍之后战斗本来就结束了）
    const ally = createPlayerSpec(state, ctx, addShip(state, 'sh-mako'))!
    ally.tag = 'ally-1'
    const battle2 = createBattleState(spec, [], 0, 1_000, [ally])
    sink(battle2, 'player')
    sink(battle2, 'ally-1')
    expect(pickMyUnitTarget(state, battle2, [spec, ally], 'random')).toBeNull()
  })
})

describe('虫洞 · 判负与副本内保险', () => {
  it('**我方全灭才判负**：主控沉了僚舰继续打，全沉才判负', () => {
    const state = fresh()
    const uids = [
      addShip(state, 'sh-thresher', ['mod-turret-kin-1']),
      addShip(state, 'sh-thresher', ['mod-turret-kin-1']),
      addShip(state, 'sh-thresher', ['mod-turret-kin-1']),
    ]
    state.shipId = uids[0]!
    const battle = startFleetBattleFor(state, ctx, uids, CARD, 0)!
    makeFoesInvincible(battle)
    // **主控先沉**（判据最容易写错的那一边：旧口径"主控沉即判负"会在这里立刻结束）
    sink(battle, 'player')
    state.gameMs = battle.lastTickGameMs + 1_000
    advanceBattleFor(state, ctx, battle, uids[0]!, CARD)
    expect(battle.ended).toBeNull() // 僚舰还在 ⇒ 战斗继续
    expect(battle.units['player']!.hp.h).toBe(0)
    // 再沉一艘，仍不结束
    sink(battle, 'ally-1')
    state.gameMs = battle.lastTickGameMs + 1_000
    advanceBattleFor(state, ctx, battle, uids[0]!, CARD)
    expect(battle.ended).toBeNull()
    // 最后一艘也沉 ⇒ 判负
    sink(battle, 'ally-2')
    state.gameMs = battle.lastTickGameMs + 1_000
    advanceBattleFor(state, ctx, battle, uids[0]!, CARD)
    expect(battle.ended).toBe('foe')
  })

  it('副本内**不挂**「结构过半自动脱离」保险；僚舰无人机不参战（D 批边界）', () => {
    const state = fresh()
    const leader = addShip(state, 'sh-thresher')
    const droneShip = addShip(state, 'sh-sentinel', ['mod-drone-rack-2'])
    state.moduleBay['mod-drone-rack-2'] = 0
    state.fleet[droneShip]!.droneLoad = { 'drone-assault': 4 }
    state.shipId = leader
    const battle = startFleetBattleFor(state, ctx, [leader, droneShip], CARD, 0)!
    expect(battle.hullEscapeFrac).toBeUndefined()
    // 机群生存池只按**主控**武器槽建 ⇒ 主控没带机群时根本没有池（僚舰的机群不参战）
    expect(battle.dronePools).toBeUndefined()
    // 正对照：主控带机群时照旧建池（既有单船口径不变）
    const carrier = addShip(state, 'sh-sentinel', ['mod-drone-rack-2'])
    state.fleet[carrier]!.droneLoad = { 'drone-assault': 4 }
    state.shipId = carrier
    const battle2 = startFleetBattleFor(state, ctx, [carrier], CARD, 0)!
    expect(Object.keys(battle2.dronePools ?? {}).length).toBe(4)
  })
})

describe('虫洞 · 多单位战斗状态随档', () => {
  it('`myFleet` 随档往返（战中重载不许退化成单船）', () => {
    const state = fresh()
    const leader = addShip(state, 'sh-thresher', ['mod-turret-kin-1'])
    const ally = addShip(state, 'sh-mako', ['mod-turret-kin-1'])
    state.shipId = leader
    const battle = startFleetBattleFor(state, ctx, [leader, ally], CARD, 0)!
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = CARD
    state.expedition.battle = battle
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.expedition.battle!
    expect(back.myFleet).toEqual([
      { tag: 'player', shipId: leader },
      { tag: 'ally-1', shipId: ally },
    ])
    expect(back.units['ally-1']!.hp).toEqual(battle.units['ally-1']!.hp)
  })
})
