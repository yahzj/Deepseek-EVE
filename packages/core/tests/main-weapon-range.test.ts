/**
 * **主武器口径（战术距离）**——2026-09-12 玩家报障「战斗界面下方的快速选择贴脸/中距/风筝，现在的距离不正确」。
 *
 * 船长裁定**「甲」**：主武器 = **射程最远的武器**（并列射程时取名义火力大的；再并列保持武器表顺序）。
 * 三条战术距离（贴脸 = 近端×0.6 / 中距 = 带中点 / 风筝 = 最远×0.95）与战斗界面「我方射程带」共用这一处。
 *
 * 旧口径 `weapons.find(w => w.kind === 'gun') ?? weapons[0]` 有两处系统性取错：
 * ① **激光是 `beam`、基础舰炮（恒在的兜底武器）是 `fixed`** ⇒ 纯激光/无人机船回落到基础舰炮（2,500m）；
 * ② **近防炮是 `turret` 槽（`kind = gun`，2,500m）** ⇒ 装了它的船一律被近防炮抢位——
 *   而近防炮自己的设定就是「占一个高槽、不是主炮替代品」。
 *
 * 本文件锁住：主武器判定（最远 / 并列取火力大 / 基础舰炮与近防炮不抢位）+ 三条距离读数 + 射程带同步。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import type { GameState, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  battleArcsFor,
  battleTacticDesire,
  battleZonesFor,
  buildEvalState,
  createInitialState,
  createPlayerSpec,
  desiredRangeFor,
  fitModule,
  mainWeaponOf,
} from '../src/index'
import { startBattleFor } from '../src/combat'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 武器夹具（射程/装填照真实件的量级）：近防炮 2,500 / 激光 4,600 / 导弹架 11,760；基础舰炮由引擎恒在（fixed 2,500） */
function world(): { state: GameState; ctx: SimContext; uid: string } {
  const ctx = makeTestCtx({
    quietEvents: true,
    ships: [ship('sh-range', { cpu: 400, slots: { high: 4, mid: 2, low: 2 } })],
    modules: [
      // 近防炮（turret 槽 → kind gun；射程 2,500、min 1）
      moduleDef('pd-x', 'turret', 0, {
        maxRangeM: 2500,
        minRangeM: 1,
        hitRate: 0.8,
        falloff: 1,
        reloadMs: 1500,
        dmgMult: 1,
        ammoPerEngagement: 0,
        cpuUse: 12,
      }),
      // 激光炮（laser 槽 → kind beam；射程 4,600）
      moduleDef('laser-x', 'laser', 0, {
        maxRangeM: 4600,
        minRangeM: 0,
        hitRate: 1,
        falloff: 1,
        reloadMs: 3000,
        dmgMult: 2,
        cpuUse: 10,
      }),
      // 导弹架（missile 槽 → kind gun；射程 11,760、min 900）
      moduleDef('missile-x', 'missile', 0, {
        maxRangeM: 11760,
        minRangeM: 900,
        hitRate: 0.8,
        falloff: 1,
        reloadMs: 4000,
        dmgMult: 3,
        ammoPerEngagement: 10,
        cpuUse: 28,
      }),
      // 并列射程（同为 5,000m）的两门炮：慢的 min 500、快的 min 1,000 ⇒ 中距/贴脸会不同，用来验"并列取火力大"
      moduleDef('tie-slow', 'turret', 0, {
        maxRangeM: 5000,
        minRangeM: 500,
        hitRate: 0.8,
        falloff: 1,
        reloadMs: 4000,
        dmgMult: 3,
        ammoPerEngagement: 10,
        cpuUse: 10,
      }),
      moduleDef('tie-fast', 'turret', 0, {
        maxRangeM: 5000,
        minRangeM: 1000,
        hitRate: 0.8,
        falloff: 1,
        reloadMs: 1000,
        dmgMult: 3,
        ammoPerEngagement: 10,
        cpuUse: 10,
      }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sh-range')
  state.shipId = uid
  return { state, ctx, uid }
}

/** 按顺序装（同射程的并列用例依赖装入顺序） */
function fitAll(state: GameState, ctx: SimContext, uid: string, ids: string[]): void {
  for (const id of ids) {
    addModule(state, id, 2)
    const r = fitModule(state, id, ctx, { shipId: uid })
    expect(r.ok, `${id} 应装得上：${r.error ?? ''}`).toBe(true)
  }
}

const mid = (state: GameState, ctx: SimContext, uid: string): number =>
  desiredRangeFor(createPlayerSpec(state, ctx, uid)!, 'mid', ctx.balance.battle)
const kite = (state: GameState, ctx: SimContext, uid: string): number =>
  desiredRangeFor(createPlayerSpec(state, ctx, uid)!, 'kite', ctx.balance.battle)
const assault = (state: GameState, ctx: SimContext, uid: string): number =>
  desiredRangeFor(createPlayerSpec(state, ctx, uid)!, 'assault', ctx.balance.battle)

describe('主武器口径（贴脸/中距/风筝的距离从哪来）', () => {
  it('纯激光船：主武器 = 激光（4,600m），不再回落到恒在的基础舰炮（2,500m）', () => {
    const { state, ctx, uid } = world()
    fitAll(state, ctx, uid, ['laser-x'])
    const me = createPlayerSpec(state, ctx, uid)!
    expect(me.weapons[0]!.label).toBe('基础舰炮') // 兜底武器恒在且排第一（旧口径出错的前提）
    const main = mainWeaponOf(me)!
    expect(main.kind).toBe('beam')
    expect(main.maxRangeM).toBe(4600)
    // 三条距离按激光算：贴脸 = max(200, 0×0.6)、中距 = 带中点、风筝 = 0.95×射程
    expect(assault(state, ctx, uid)).toBe(ctx.balance.battle.minDistanceM)
    expect(mid(state, ctx, uid)).toBe(2300)
    expect(kite(state, ctx, uid)).toBe(4370)
  })

  it('装了近防炮的船：近防炮不抢「主武器」——激光船仍按激光、导弹船按导弹架', () => {
    const a = world()
    fitAll(a.state, a.ctx, a.uid, ['pd-x', 'laser-x']) // 近防炮在第 1 位（旧口径必被抢）
    expect(mainWeaponOf(createPlayerSpec(a.state, a.ctx, a.uid)!)!.maxRangeM).toBe(4600)
    expect(mid(a.state, a.ctx, a.uid)).toBe(2300)

    const b = world()
    fitAll(b.state, b.ctx, b.uid, ['pd-x', 'missile-x'])
    const mainB = mainWeaponOf(createPlayerSpec(b.state, b.ctx, b.uid)!)!
    expect(mainB.kind).toBe('gun')
    expect(mainB.maxRangeM).toBe(11760)
    expect(mid(b.state, b.ctx, b.uid)).toBe(6330)
    expect(kite(b.state, b.ctx, b.uid)).toBe(11172)
  })

  it('只有近防炮时主武器就是它（最远即它本身，不是特例排除）', () => {
    const { state, ctx, uid } = world()
    fitAll(state, ctx, uid, ['pd-x'])
    expect(mainWeaponOf(createPlayerSpec(state, ctx, uid)!)!.maxRangeM).toBe(2500)
    expect(mid(state, ctx, uid)).toBe(1251) // (1 + 2500) / 2 取整
  })

  it('并列射程取名义火力大的（装填更快的）：中距/贴脸随该件的射程带走', () => {
    const { state, ctx, uid } = world()
    fitAll(state, ctx, uid, ['tie-slow', 'tie-fast']) // 同 5,000m；慢的 min 500、快的 min 1,000
    const main = mainWeaponOf(createPlayerSpec(state, ctx, uid)!)!
    expect(main.maxRangeM).toBe(5000)
    // 快的（min 1,000）胜出 ⇒ 中距 = (1000+5000)/2 = 3000、贴脸 = 1000×0.6 = 600
    expect(mid(state, ctx, uid)).toBe(3000)
    expect(assault(state, ctx, uid)).toBe(600)
    expect(kite(state, ctx, uid)).toBe(4750)
  })

  it('战斗界面「我方射程带」与三按钮同源（同一个主武器）', () => {
    const { state, ctx, uid } = world()
    fitAll(state, ctx, uid, ['pd-x', 'laser-x'])
    state.expedition.anomalyId = 'ano-a'
    const zones = battleZonesFor(state, ctx)!
    expect(zones.me.maxM).toBe(4600) // 旧口径这里是近防炮的 2,500
    expect(zones.me.name).toContain('laser-x')
    // 出发前战术与战斗中三按钮同源
    expect(battleTacticDesire(state, ctx, 'kite')).toBe(kite(state, ctx, uid))
  })

  it('回归：炮台/纯导弹船的读数与旧口径一致（旧口径恰好取对的那两类）', () => {
    const gunOnly = world()
    fitAll(gunOnly.state, gunOnly.ctx, gunOnly.uid, ['missile-x'])
    expect(mid(gunOnly.state, gunOnly.ctx, gunOnly.uid)).toBe(6330)
    expect(kite(gunOnly.state, gunOnly.ctx, gunOnly.uid)).toBe(11172)
  })
})

/** 真数据用例：战场弧的「主武器」标记（射程弧米数刻度照它画）必须与三按钮同源 */
describe('主武器口径在真数据上的一致性（战场弧 isMain）', () => {
  const real = buildSimContext()
  const CARDS = [...real.anomalies.values()].filter((a) => a.hidden !== true && a.rewardIsk > 0 && a.threat > 0 && a.threat <= 40)
  const CARD = CARDS[0]!

  /** 一艘装了「近防炮 + 激光炮」的船（旧口径下近防炮会抢主武器） */
  function fitted(): GameState {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.wallet.isk = 1e9
    state.standings['dsi'] = 30
    for (const g of real.galaxies.values()) state.exploredGalaxies.push(g.id)
    addModule(state, 'mod-pd-e', 1)
    addModule(state, 'mod-laser-1', 1)
    expect(fitModule(state, 'mod-pd-e', real).ok).toBe(true)
    expect(fitModule(state, 'mod-laser-1', real).ok).toBe(true)
    return state
  }

  it('激光船上：主武器弧 = 激光（不是恒在的基础舰炮、也不是近防炮），与三按钮同源', () => {
    const state = fitted()
    const snap = buildEvalState(state, state.shipId)!
    const battle = startBattleFor(snap.ev, real, snap.uid, CARD.id, 0)
    expect(battle, '应能开战').not.toBeNull()
    // 视图读的是 expedition 指针（`startBattleFor` 只返回战斗态，挂指针由调用方做）
    snap.ev.expedition.battle = battle
    snap.ev.expedition.anomalyId = CARD.id
    const arcs = battleArcsFor(snap.ev, real)!
    const me = createPlayerSpec(snap.ev, real, snap.uid)!
    const main = mainWeaponOf(me)!
    const mainArc = arcs.me.find((w) => w.isMain)
    expect(mainArc, '射程弧里应有且只有一条主武器').toBeDefined()
    expect(arcs.me.filter((w) => w.isMain)).toHaveLength(1)
    expect(mainArc!.maxM).toBe(main.maxRangeM) // 米数刻度照它画
    expect(mainArc!.kind).toBe('beam') // 激光（旧口径这里是近防炮/基础舰炮的 gun）
    expect(mainArc!.maxM).toBeGreaterThan(2500) // 明显长于基础舰炮/近防炮的 2,500m
    // 与三按钮同源：中距/风筝都按这条弧的带算
    expect(desiredRangeFor(me, 'mid', real.balance.battle)).toBe(Math.max(real.balance.battle.minDistanceM, Math.round((mainArc!.minM + mainArc!.maxM) / 2)))
    expect(battleZonesFor(snap.ev, real)!.me.maxM).toBe(mainArc!.maxM)
  })
})
