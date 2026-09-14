/**
 * **战报改造**（2026-09-14 船长定 · 已确认设计稿 `docs/design/battle-report-20260914.md`）。
 *
 * 船长原话（照抄）：「**战斗胜利后的战斗报告现在过于简陋，并且假如在虫洞内，我方损失了舰船也显示大捷。**」
 *
 * 两个报障的根因都在**取正文的方式**与**判定只看胜负**上：
 * ① 弹层正文原先靠"在事件日志里找含『战报』二字的那条"（`battleViewCore.lastBattleReport` 字符串匹配）
 *    —— 而**洞内战斗**（「🕳 第 N 层…交火结束：…」）、**低安遭遇**（「★ 遭遇战大捷（…）」）、
 *    **无法交战**（「⚔ 无法交战（…）」）**三条都不含『战报』** ⇒ 那三类战斗的弹层**永远取不到正文**；
 * ② 标题只看 `ended === 'me'` ⇒ **沉了船也写「大捷」**，卡片上连"损失"这一行都没有。
 *
 * 本文件锁住改造后的口径：
 * ① **四档判定**（纯函数 `battleVerdictOf`）：大捷 / 惨胜 / 失利 / 脱离；
 * ② **结构化战报**（`captureBattleReport` 唯一构造点）：派生读数与 `battle` 同源；
 * ③ 覆盖"四个结算点都写了记录"（远征胜/败/中止 · 遭遇 · 洞内 · AI 副船）——本轮只钉前两类真跑，
 *    洞内与 AI 的写入点用"结算后 `state.battleReport` 有值且来源正确"间接覆盖。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { BattleReportRecord, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { advanceBattleFor, battleVerdictOf, captureBattleReport, startBattleFor, startFleetBattleFor } from '../src/combat'
import { wormholeEnter } from '../src/wormhole'
import type { WormholeRunState } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { SimContext } from '../src/types'

const ctx: SimContext = buildSimContext()
/** 教学卡：无声望门槛的真卡（与 `wormhole-fleet-battle.test.ts` 同款取用） */
const CARD = 'ano-training'

function fresh(seed = 7): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, 'sh-thresher')
  state.shipId = uid
  return state
}

/** 把一场战斗推到分出胜负（大步长直接跨过上限；教学卡必赢） */
function runToEnd(state: GameState, battle: NonNullable<ReturnType<typeof startBattleFor>>): void {
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
  advanceBattleFor(state, ctx, battle, state.shipId, CARD)
  expect(battle.ended).toBe('me')
}

const fakeRec = (over: Partial<BattleReportRecord>): BattleReportRecord => ({
  battleStartedAtGameMs: 0,
  source: 'expedition',
  outcome: 'win',
  durMs: 1_000,
  stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
  shipsLost: [],
  myUnits: [],
  foe: { alive: 0, total: 1, hpFrac: 0 },
  ammoUsed: { kin: 0, exp: 0, pla: 0 },
  dronesGone: 0,
  summary: '',
  ...over,
})

describe('战报 · 四档判定（2026-09-14 船长定）', () => {
  it('胜 + 零沉船 + 机群无损 ⇒ 大捷', () => {
    expect(battleVerdictOf(fakeRec({ outcome: 'win', shipsLost: [], dronesGone: 0 }))).toBe('great')
  })

  it('胜 + **有沉船** ⇒ 惨胜（这条就是船长报障的正身：以前一律写「大捷」）', () => {
    expect(battleVerdictOf(fakeRec({ outcome: 'win', shipsLost: ['长尾鲨'] }))).toBe('pyrrhic')
  })

  it('胜 + 机群有净损失（哪怕零沉船）⇒ 惨胜', () => {
    expect(battleVerdictOf(fakeRec({ outcome: 'win', shipsLost: [], dronesGone: 3 }))).toBe('pyrrhic')
  })

  it('负 ⇒ 失利；未分胜负就中止 ⇒ 脱离（沉了船也仍是脱离 —— 中止优先）', () => {
    expect(battleVerdictOf(fakeRec({ outcome: 'lose' }))).toBe('defeat')
    expect(battleVerdictOf(fakeRec({ outcome: 'break', breakReason: 'timeout' }))).toBe('break')
    expect(battleVerdictOf(fakeRec({ outcome: 'break', breakReason: 'cannot-engage', shipsLost: ['长尾鲨'] }))).toBe('break')
  })
})

describe('战报 · 结构化记录（captureBattleReport 唯一构造点）', () => {
  it('派生读数与 battle 同源：统计 / 逐舰三层 / 敌方残余 / 时长 / 配对字段', () => {
    const state = fresh()
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0)!
    runToEnd(state, battle)
    const rec = captureBattleReport(state, battle, {
      source: 'expedition',
      outcome: 'win',
      summary: '⚔ 战报：大捷！',
    })
    // 配对字段（弹层靠它与自己的快照对表，防并行战斗串场）
    expect(rec.battleStartedAtGameMs).toBe(battle.startedAtGameMs)
    expect(state.battleReport).toBe(rec)
    // 统计逐字同源
    expect(rec.stats).toEqual(battle.stats)
    expect(rec.durMs).toBe(Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
    // 逐舰三层：单船路径只有主控，值与 units 同源、上限 = 满值（血条分母）
    expect(rec.myUnits.length).toBe(1)
    const u = battle.units['player']!
    expect(rec.myUnits[0]!.name).toBe(u.name)
    expect(rec.myUnits[0]!.sMax).toBe(u.hpMax!.s)
    expect(rec.myUnits[0]!.a).toBeCloseTo(u.hp.a, 6)
    // 敌方残留：打赢 ⇒ 全灭
    expect(rec.foe.total).toBeGreaterThan(0)
    expect(rec.foe.alive).toBe(0)
    expect(rec.foe.hpFrac).toBe(0)
    expect(rec.summary).toBe('⚔ 战报：大捷！')
    expect(battleVerdictOf(rec)).toBe('great')
  })

  it('**沉船 ⇒ 惨胜**：把一艘僚舰的三层血打空，记录自动把它收进「我方损失」', () => {
    const state = fresh()
    const ally = addShipToFleet(state, 'sh-mako')
    const battle = startFleetBattleFor(state, ctx, [state.shipId, ally], CARD, 0)!
    runToEnd(state, battle)
    // 造一条"这一场沉了僚舰"的事实（与引擎里真实沉船后的状态同形：三层血全 0）
    const lost = battle.units['ally-1']!
    lost.hp = { s: 0, a: 0, h: 0 }
    const rec = captureBattleReport(state, battle, { source: 'wormhole', outcome: 'win', summary: '🕳 交火结束' })
    expect(rec.shipsLost).toEqual([lost.name])
    expect(battleVerdictOf(rec)).toBe('pyrrhic') // ← 船长报障的正身：这一场绝不能再写「大捷」
    // 多舰路径：顺序 = 主控在前、僚舰按编队
    expect(rec.myUnits.map((m) => m.name)).toEqual([battle.units['player']!.name, lost.name])
  })

  it('沉船名单可由调用方覆盖（洞内传船长口径的显示名，不从 units 推导）', () => {
    const state = fresh()
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0)!
    runToEnd(state, battle)
    const rec = captureBattleReport(state, battle, {
      source: 'wormhole',
      outcome: 'lose',
      summary: '🕳 探险失败',
      shipsLost: ['我的座舰'],
    })
    expect(rec.shipsLost).toEqual(['我的座舰'])
    expect(battleVerdictOf(rec)).toBe('defeat')
  })

  it('弹药消耗 = 开战预载 − 战后余额（按弹种；没开火 ⇒ 三个 0）', () => {
    const state = fresh()
    state.warehouse.items['ammo-kinetic-l'] = 5_000
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0)!
    // 开战预载量：四条路径都在写 ⇒ 记录一定能算出消耗
    expect(battle.ammoLoaded).toBeDefined()
    const loaded = { ...battle.ammoLoaded! }
    runToEnd(state, battle)
    const rec = captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: 'x' })
    expect(rec.ammoUsed.kin).toBe(Math.max(0, Math.round(loaded.kin - battle.ammo.kin)))
    expect(rec.ammoUsed.exp).toBe(Math.max(0, Math.round(loaded.exp - battle.ammo.exp)))
    expect(rec.ammoUsed.pla).toBe(Math.max(0, Math.round(loaded.pla - battle.ammo.pla)))
    // 全场一炮未发（把预载与余额摆成相等）⇒ 三档都是 0（界面据此整行不显示）
    const idle = fresh()
    const b2 = startBattleFor(idle, ctx, idle.shipId, CARD, 0)!
    b2.ammo = { ...b2.ammoLoaded! }
    const rec2 = captureBattleReport(idle, b2, { source: 'ai', outcome: 'break', breakReason: 'cannot-engage', summary: 'y' })
    expect(rec2.ammoUsed).toEqual({ kin: 0, exp: 0, pla: 0 })
    expect(rec2.breakReason).toBe('cannot-engage')
  })

  it('机群净损失只有**配对得上**才计入（AI 副船不写机群报告 ⇒ 恒 0）', () => {
    const state = fresh()
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0)!
    runToEnd(state, battle)
    state.droneLossReport = {
      battleStartedAtGameMs: battle.startedAtGameMs,
      rate: 0.2,
      total: 5,
      recovered: 1,
      gone: 4,
      rows: [],
    }
    expect(captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: 'x' }).dronesGone).toBe(4)
    // 起手时刻对不上（别的战斗写的）⇒ 不计入
    state.droneLossReport = { ...state.droneLossReport, battleStartedAtGameMs: battle.startedAtGameMs + 1 }
    expect(captureBattleReport(state, battle, { source: 'expedition', outcome: 'win', summary: 'x' }).dronesGone).toBe(0)
    // 压根没有这份报告（AI 副船）⇒ 0 ⇒ 不影响判定
    state.droneLossReport = null
    expect(battleVerdictOf(captureBattleReport(state, battle, { source: 'ai', outcome: 'win', summary: 'x' }))).toBe('great')
  })

  /**
   * **接线守卫**：洞内那条结算路**真的**调了 `captureBattleReport`（只测纯函数拦不住"忘了接"）。
   * 顺带钉死船长报障的原文：洞内战报的 `summary` 是「🕳 第 N 层…交火结束：…」——
   * **它不含「战报」二字**，这正是旧做法（按『战报』二字捞日志）取不到正文的原因。
   */
  it('洞内战斗结算时真的写了战报，且正文是洞内那句原文', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const a = addShipToFleet(state, 'sh-thresher')
    const b = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a, b], 21).ok).toBe(true)
    // 站到"下一层入口"格（层末守卫守在那里）→ 开守卫战
    const run: WormholeRunState = state.wormhole.run!
    const g = run.grid!
    g.pos = { q: g.exit.q, r: g.exit.r }
    const key = `${g.exit.q},${g.exit.r}`
    if (!g.visited.includes(key)) g.visited.push(key)
    if (!g.scanned.includes(key)) g.scanned.push(key)
    g.activated = g.activated.filter((k) => k !== key)
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(true)
    // 打光敌人 ⇒ 判我方胜 ⇒ 跳过击杀慢镜窗口推进结算
    const battle = run.battle!
    for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    battle.ended = 'me'
    state.gameMs = battle.lastTickGameMs + 10_000
    advanceWormhole(state, ctx)
    const rec = state.battleReport
    expect(rec).toBeTruthy()
    expect(rec!.source).toBe('wormhole')
    expect(rec!.outcome).toBe('win')
    expect(rec!.summary).toContain('交火结束') // ← 洞内原文（旧口径按『战报』二字捞 ⇒ 捞不到）
    expect(rec!.summary.includes('战报')).toBe(false) // 正身：这句里**没有**「战报」二字
    expect(battleVerdictOf(rec!)).toBe('great') // 零沉船 + 机群无损 ⇒ 大捷
    expect(rec!.myUnits.length).toBe(2) // 两条舰各一份残余读数
  })
})
