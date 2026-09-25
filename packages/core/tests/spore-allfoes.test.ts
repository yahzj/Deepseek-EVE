/**
 * **孢子导弹巢「全体攻击」**（`ModuleDef.hitsAllFoes` → `WeaponSpec.allFoes`）。
 *
 * 口径来源：船长 2026-09-13「C 孢子导弹巢」＝「**对所有敌方同时攻击**」；
 * 船长 2026-09-25 报障「**装孢子导弹巢有时候会只有一发弹道**」⇒ 当日裁定「**按甲**」：
 * 去掉开火路径上那道 `&& hit`（**主目标那一发的命中判定**曾被当成"整轮是否铺开"的总闸）。
 *
 * 本文件钉四件事：
 * (a) **一轮齐射给每个存活敌舰各推一条开火事件**（演出层"逐目标弹道"的判据）；
 * (b) **主目标未命中 ⇒ 副目标照常逐个结算**（本次修的那条：旧口径下这种轮次只有 1 条事件）；
 * (c) 主目标未命中的轮次里，副目标**仍能有实收伤害**（`fx.dmg`）；
 * (d) **已阵亡的敌舰不结算、不推事件**（事件数跟着存活数走）。
 *
 * ⚠ 为什么它此前长期没被发现：**本仓此前没有任何用例覆盖 `allFoes`** ——
 *   `missile-cycle.test.ts` 只盯了本件的装填（8360ms），开火路径一条判据都没有。
 * ⚠ 事件顺序：引擎**先**为副目标逐条推、**最后**推主目标那条（`combat.stepBattle` 我方开火段）
 *   ⇒ 本文件取"最后一条 = 主目标"来分辨主/副（该顺序由 `tests/spore-allfoes` 的 (b) 一并看住）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { BattleState, BattleFx, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { advanceBattleFor, startFleetBattleFor } from '../src/combat'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'

const CARD = 'ano-allfoes'
const WEAPON = 't-allfoes-missile'
/** 试验舰：高槽 3 / CPU 400 / 血极厚（打得完观察窗口） */
const HULL = 'hull-allfoes'

/** 试验敌舰：厚血（打不完）+ 指定回避 ⇒ 命中率 = 武器 hitRate − 本值 */
function foe(id: string, evasion: number): FoeShipDef {
  return {
    id,
    name: `试验舰${id}`,
    family: 'A',
    hullClassTier: 1,
    speedRatio: 1,
    hp: 40_000,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg: 1, // 只观察我方的开火事件，敌方的伤害无所谓
    hitRate: 1,
    reloadMs: 1_000,
    rangeMinM: 1,
    /**
     * ⚠ **射程要短**：开战距离 = 双方最远射程 ×系数 + 缓冲 ⇒ 给 30 km 的话首轮开火要等到
     * **37 秒**（本用例第一版就是这么红的：25 秒窗口内一轮都没开）。3 km 让它开局就在射程内。
     */
    rangeMaxM: 3_000,
    falloff: 1,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
    evasion,
  }
}

function world(opts: { count: number; hitRate: number; evasion: number }): {
  state: GameState
  ctx: SimContext
  uid: string
} {
  const ctx = makeTestCtx({
    ships: [
      ship(HULL, {
        slots: { high: 3, mid: 2, low: 2 },
        cpu: 400,
        shieldHp: 5_000,
        armorHp: 200_000,
        hullHp: 200_000,
      }),
    ],
    modules: [
      moduleDef(WEAPON, 'missile', 0, {
        damageType: 'explosive',
        dmgMult: 5,
        hitRate: opts.hitRate,
        falloff: 1, // 导弹口径：命中不随距离衰减
        maxRangeM: 5_000, // 与敌舰 3 km 配套 ⇒ 开战距离小、开局即在射程内（见 `foe()` 的注）
        reloadMs: 1_000,
        cpuUse: 10,
        hitsAllFoes: true,
      }),
    ],
    anomalies: [
      {
        ...anomaly(CARD, 'galaxy-hub', { threat: 20, tactic: 'orbit' }),
        ships: [{ ship: foe('t-allfoes-foe', opts.evasion), count: opts.count }],
      } as AnomalyDef,
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, HULL)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [WEAPON], mid: [], low: [] }
  state.warehouse.items['ammo-explosive-l'] = 5_000
  return { state, ctx, uid }
}

interface Volley {
  t: number
  fx: BattleFx[]
  /** 存活敌舰数（这一轮开火当下） */
  aliveFoes: number
}

/** 推进到指定拍数，把"我方那门全体武器"的每一轮齐射收集出来 */
function volleysOf(b: BattleState, fn: () => void, steps: number): Volley[] {
  const out: Volley[] = []
  /**
   * ⚠ 游标从**调用那一刻的最新序号**起算（不是 -1）：`battle.fx` 是 48 条环缓冲，
   * 传 -1 会把环里积压的旧事件全当成"新事件"（本用例第二段就踩过：v.fx.length = 48）。
   */
  let lastSeq = b.fx.length > 0 ? b.fx[b.fx.length - 1]!.seq : -1
  let t = 0
  for (let i = 0; i < steps && !b.ended; i++) {
    fn()
    t += 1
    const fresh = b.fx.filter((f) => f.seq > lastSeq)
    if (fresh.length > 0) lastSeq = fresh[fresh.length - 1]!.seq
    const mine = fresh.filter((f) => f.side === 'me' && f.src === 'missile')
    if (mine.length === 0) continue
    out.push({ t, fx: mine, aliveFoes: Object.values(b.units).filter((u) => u.side === 'foe' && u.hp.s + u.hp.a + u.hp.h > 0).length })
  }
  return out
}

describe('孢子导弹巢 · 全体攻击（2026-09-25 修「有时候只有一发弹道」）', () => {
  it('**每轮齐射都给每个存活敌舰各推一条开火事件**（主目标未命中不再阻断副目标）', () => {
    const { state, ctx, uid } = world({ count: 3, hitRate: 1, evasion: 0.2 })
    const b = startFleetBattleFor(state, ctx, [uid], CARD, 0)!
    const vs = volleysOf(
      b,
      () => {
        state.gameMs += 100
        advanceBattleFor(state, ctx, b, uid, CARD)
      },
      600, // 60 秒 ≈ 60 轮（装填 1 秒）
    )
    expect(vs.length, '至少要观察到若干轮齐射').toBeGreaterThan(10)
    /**
     * ⚠ **这是本次修复的直接判据**：旧口径下"主目标那一发没中"的轮次只有 1 条事件
     * （`if (w.allFoes === true && hit)`）⇒ 本断言当场红。
     */
    for (const v of vs) {
      expect(v.fx.length, `第 ${v.t} 拍：事件数应 = 存活敌舰数（${v.aliveFoes}）`).toBe(v.aliveFoes)
    }
    /** (b) 主目标那条 = **最后推**的那条；必须真的出现过"主目标未命中、同轮仍有 3 条" */
    const mainMissVolleys = vs.filter((v) => v.fx[v.fx.length - 1]!.hit === false)
    expect(mainMissVolleys.length, '60 轮里应出现若干次主目标未命中（回避 0.2）').toBeGreaterThan(0)
    for (const v of mainMissVolleys) {
      expect(v.fx.length, `主目标未命中那一轮也必须仍是 ${v.aliveFoes} 条`).toBe(v.aliveFoes)
    }
    /** (c) 主目标未命中那一轮，副目标仍能吃到伤害（逐舰各掷） */
    const anySecondaryDealt = mainMissVolleys.some((v) =>
      v.fx.slice(0, -1).some((f) => (f.dmg ?? 0) > 0),
    )
    expect(anySecondaryDealt, '主目标未命中的轮次里，副目标应仍有实收伤害').toBe(true)
  })

  it('**已阵亡的敌舰不结算、不推事件**（事件数跟着存活数走）', () => {
    const { state, ctx, uid } = world({ count: 3, hitRate: 1, evasion: 0 })
    const b = startFleetBattleFor(state, ctx, [uid], CARD, 0)!
    const foeTags = Object.keys(b.units).filter((t) => b.units[t]!.side === 'foe')
    expect(foeTags).toHaveLength(3)
    // 先跑两轮确认 3 条
    const first = volleysOf(
      b,
      () => {
        state.gameMs += 100
        advanceBattleFor(state, ctx, b, uid, CARD)
      },
      250,
    )
    expect(first.length).toBeGreaterThan(2)
    expect(first[0]!.fx.length).toBe(3)
    // 打掉一艘（三层清零）⇒ 之后每轮只应有 2 条
    const dead = foeTags[2]!
    b.units[dead]!.hp = { s: 0, a: 0, h: 0 }
    const after = volleysOf(
      b,
      () => {
        state.gameMs += 100
        advanceBattleFor(state, ctx, b, uid, CARD)
      },
      300,
    )
    expect(after.length).toBeGreaterThan(2)
    for (const v of after) {
      expect(v.fx.length, `第 ${v.t} 拍（死了一艘）应只推 ${v.aliveFoes} 条`).toBe(v.aliveFoes)
      expect(v.fx.some((f) => f.to === dead), '已阵亡的敌舰不该再被瞄准').toBe(false)
    }
  })
})
