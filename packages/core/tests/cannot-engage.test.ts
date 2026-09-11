/**
 * 无法交战 ⇒ 提前脱战（P0-2 · **乙2**，2026-09-11 船长裁定「乙2，事件为 120 秒」）
 *
 * 口径：开战满 `bal.cannotEngageMs`（默认 120 秒）时，三件同时成立 ⇒ 判负并按撤退结算
 * （`autoEscaped = true`、`escapeReason = 'cannot-engage'`）：
 *   ①我方**全程一炮未发**（`stats.meShots === 0`）；
 *   ②当前距离仍在**我方最远射程之外**；
 *   ③**敌人已经开火**（`stats.foeShots > 0`）。
 *
 * 动机（实测）：远程型（kite）敌人把交战距离拉在自己带内时，短射程/无推进器装配会全程 0 开火并空转
 * ——灰霾 ②/⑤/③ 打满 600 秒触顶判负、蜃影/赤潮三行在 140/373 秒被打死。
 * **数值一个字不动**：本机制只决定"什么时候收场 + 战报怎么写"（结算走与超时判负同源的轻损撤退路径）。
 *
 * 本文件验证（船长采纳的验收口径）：
 * ① **触发**：够不着且敌人已开火 ⇒ 满 T 秒即判负撤退，`escapeReason = 'cannot-engage'`、我方 0 开火；
 * ② **阈值边界**：T−1 秒不触发、满 T 秒触发（阈值是 `bal.cannotEngageMs` 参数，不是写死的常数）；
 * ③ **我方开过火 ⇒ 永不触发**（"打得着但打不过"不受本机制影响）；
 * ④ **敌人未开火（双方都够不着）⇒ 不触发**（属接近段/死锁，不是"够不着"）。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceBattleFor, startBattleFor } from '../src/combat'
import { createInitialState, type GameState } from '../src/state'
import type { AnomalyDef, DamageType, FoeShipDef, ModuleDef, SimContext } from '../src/types'
import { anomaly, galaxy, makeTestCtx, moduleDef, ship } from './helpers'

/** 玩家炮：给定射程带（min>0 时太近打不到，max 决定"够不够得着"） */
function gun(id: string, minRangeM: number, maxRangeM: number): ModuleDef {
  return moduleDef(id, 'turret', 0, {
    rack: 'high',
    damageType: 'kinetic' as DamageType,
    minRangeM,
    maxRangeM,
    hitRate: 0.9,
    falloff: 0.3,
    reloadMs: 4000,
    dmgMult: 20,
    cpuUse: 5,
    ammoPerEngagement: 500,
  })
}
/** 短射程炮（2~3 km）：打不到站 10 km 外的狙击舰 ⇒ 本机制的目标场景 */
const SHORT_GUN = gun('mod-short-gun', 2000, 3000)
/** 远程炮（0~20 km）：够得着 ⇒ 我方必然开火 */
const LONG_GUN = gun('mod-long-gun', 0, 20000)
/** 超远程炮（20~25 km）：**太近反而打不到** ⇒ 用于构造"双方都够不着" */
const FAR_GUN = gun('mod-far-gun', 20000, 25000)

/** 敌舰级：远程狙击（自身带 10~12 km，kite 站位 0.85 ⇒ 约 11.7 km） */
const SNIPER: FoeShipDef = {
  id: 't-cannot-sniper',
  name: '测试狙击舰',
  family: 'A',
  hullClassTier: 2,
  speedRatio: 1,
  hp: 400,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 20,
  hitRate: 0.9,
  reloadMs: 4000,
  rangeMinM: 10000,
  rangeMaxM: 12000,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'kite',
}

/** 敌舰级：贴脸小炮 + **极慢**（"双方都够不着"的构造：玩家跑得开、它追不上、两边都打不着） */
const SLUG: FoeShipDef = {
  id: 't-cannot-slug',
  name: '测试慢船',
  family: 'A',
  hullClassTier: 1,
  speedRatio: 0.05,
  hp: 400,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 10,
  hitRate: 0.9,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 500,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
}

type World = { state: GameState; ctx: SimContext }

/** 造世界：一艘只装指定炮的玩家船 + 一张指定敌舰级的卡 */
function world(opts: {
  gun: ModuleDef
  foe: FoeShipDef
  anoId: string
  cannotEngageMs: number
  playerSpeed?: number
}): World {
  const ano: AnomalyDef = {
    ...anomaly(opts.anoId, 'galaxy-hub', { threat: 40, tactic: 'kite' }),
    ships: [{ ship: opts.foe }],
    dmgMix: { kinetic: 8, explosive: 2 },
    foeFamily: 'A',
  }
  const bed = { ...ship('sh-bed', { cpu: 400, slots: { high: 4, mid: 2, low: 2 }, maxSpeedMps: opts.playerSpeed ?? 300 }), shieldHp: 4000, armorHp: 2000, hullHp: 2000 }
  // ⚠ 阈值经**克隆后的 balance** 注入（不改进程内共享的默认 balance，避免污染同文件其它用例）
  const balance = {
    ...DEFAULT_BALANCE,
    battle: { ...DEFAULT_BALANCE.battle, cannotEngageMs: opts.cannotEngageMs },
  }
  const ctx = makeTestCtx({
    galaxies: [galaxy('galaxy-hub', '母港', { security: 0.1 })],
    anomalies: [ano],
    modules: [opts.gun],
    ships: [bed],
    balance,
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.fleet[state.shipId]!.defId = 'sh-bed'
  state.fleet[state.shipId]!.fitted = { high: [opts.gun.id, null, null, null], mid: [], low: [] }
  state.moduleBay[opts.gun.id] = 1
  state.warehouse.items['ammo-kinetic-l'] = 20_000
  return { state, ctx }
}

/** 逐秒推进到"开战后 totalMs"（可续推已有战斗）；返回战斗 */
function stepBattle(
  state: GameState,
  ctx: SimContext,
  anoId: string,
  totalMs: number,
  existing?: ReturnType<typeof startBattleFor>,
): NonNullable<ReturnType<typeof startBattleFor>> {
  const battle = existing ?? startBattleFor(state, ctx, state.shipId, anoId, 0)!
  const target = battle.startedAtGameMs + totalMs
  for (let t = battle.lastTickGameMs + 1000; t <= target; t += 1000) {
    state.gameMs = t
    advanceBattleFor(state, ctx, battle, state.shipId, anoId)
    if (battle.ended) break
  }
  return battle
}

describe('无法交战提前脱战（P0-2 乙2 · 船长裁定「事件为 120 秒」）', () => {
  it('①够不着且敌人已开火：满 T 秒判负撤退，escapeReason = cannot-engage，我方 0 开火', () => {
    const T = 60_000
    const { state, ctx } = world({ gun: SHORT_GUN, foe: SNIPER, anoId: 'ano-term', cannotEngageMs: T })
    const battle = stepBattle(state, ctx, 'ano-term', T + 1_000)
    expect(battle.ended).toBe('foe')
    expect(battle.autoEscaped).toBe(true)
    expect(battle.escapeReason).toBe('cannot-engage')
    expect(battle.stats.meShots).toBe(0) // 一炮未发
    expect(battle.stats.foeShots).toBeGreaterThan(0) // 敌人在打
    expect(battle.distanceM).toBeGreaterThan(3000) // 距离仍在我方最远射程（3,000m）之外
  })

  it('②阈值边界：满 T 秒那一拍不触发、下一拍（+100ms 内）触发（阈值来自 bal，不是写死常数）', () => {
    const T = 60_000
    const before = world({ gun: SHORT_GUN, foe: SNIPER, anoId: 'ano-term', cannotEngageMs: T })
    const b1 = stepBattle(before.state, before.ctx, 'ano-term', T - 1_000)
    expect(b1.autoEscaped).toBeFalsy()
    expect(b1.ended).toBeNull()
    // 推到"正好满 T"：判定与超时同源 —— `stepBattle` 在 `lastTickGameMs += dt` **之前**调用
    // （combat.ts:2285-2286），故本拍读到的仍是 T−100ms ⇒ 不触发
    const b2 = stepBattle(before.state, before.ctx, 'ano-term', T, b1)
    expect(b2.lastTickGameMs - b2.startedAtGameMs).toBe(T)
    expect(b2.autoEscaped).toBeFalsy()
    // 再推 1 秒 ⇒ 触发（阈值生效，步进粒度 100ms）
    const b3 = stepBattle(before.state, before.ctx, 'ano-term', T + 1_000, b2)
    expect(b3.autoEscaped).toBe(true)
    expect(b3.escapeReason).toBe('cannot-engage')
  })

  it('③我方开过火 ⇒ 永不触发（阈值压到 2 秒也一样）', () => {
    const { state, ctx } = world({ gun: LONG_GUN, foe: SNIPER, anoId: 'ano-term', cannotEngageMs: 2_000 })
    const battle = stepBattle(state, ctx, 'ano-term', 30_000)
    expect(battle.stats.meShots).toBeGreaterThan(0) // 我方确实开火了
    expect(battle.autoEscaped).toBeFalsy()
    expect(battle.escapeReason).not.toBe('cannot-engage')
  })

  it('④接近段不误判：敌人尚未开火时不触发（阈值再小也不误伤）', () => {
    // T = 5 秒 + **慢船玩家**（100 m/s）：此刻我方 0 开火、距离也在射程外，
    // 但敌人还在接近自己的带（10~12km）、**一炮未发** ⇒ 不该判"无法交战"
    const { state, ctx } = world({
      gun: SHORT_GUN,
      foe: SNIPER,
      anoId: 'ano-term',
      cannotEngageMs: 5_000,
      playerSpeed: 100,
    })
    const early = stepBattle(state, ctx, 'ano-term', 5_000)
    expect(early.stats.meShots).toBe(0)
    expect(early.stats.foeShots).toBe(0)
    expect(early.autoEscaped).toBeFalsy()
    // 继续推到 120 秒：敌人已经开火 ⇒ 触发
    const late = stepBattle(state, ctx, 'ano-term', 120_000, early)
    expect(late.stats.foeShots).toBeGreaterThan(0)
    expect(late.autoEscaped).toBe(true)
    expect(late.escapeReason).toBe('cannot-engage')
  })

  it('⑤关闭开关（cannotEngageMs = 0）⇒ 本机制完全不生效（零行为变化保险）', () => {
    const { state, ctx } = world({ gun: SHORT_GUN, foe: SNIPER, anoId: 'ano-term', cannotEngageMs: 0 })
    const battle = stepBattle(state, ctx, 'ano-term', 180_000)
    expect(battle.autoEscaped).toBeFalsy()
    expect(battle.stats.meShots).toBe(0)
  })
})
