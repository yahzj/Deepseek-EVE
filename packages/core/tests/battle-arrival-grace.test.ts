/**
 * **入场窗口：动画没结束不开火**（船长 2026-09-14 三条裁定：「①乙，初始不可开火，且对洞内洞外都生效」
 * 「②和洞外一致」「③补。并且参考①动画没结束不开火」）。
 *
 * 由来（同一条报障的取证，见当时的探针读数）：界面判定"敌舰阵亡"靠"看见它从有血变成 0 血"这一瞬间；
 * 而**次波/增援的新单位可能在登场第一拍就被我方齐射打死**（真引擎实测 210 场里 81 场复现，
 * 幽灵**全部**来自增援波）⇒ 界面从没见过它"有血"⇒ 舰影与空血条永久留场。
 *
 * 本文件钉住引擎侧那半边（界面那半边的防漏判见 `BattleScreen.tsx` 的阵亡登记段）：
 * (a) **窗口内不可选中**：有 `enteredAtMs` 的敌舰在 `enteredAtMs + BATTLE_ARRIVAL_FLY_MS` 之前**一滴血不掉**；
 * (b) **窗口一过立刻能打**（不是永久免疫）；
 * (c) **逐舰错峰**：同批入场第 i 条的入场时刻 = 群时刻 + i×`BATTLE_ARRIVAL_STAGGER_MS`（与界面同源）；
 * (d) **谁有窗口**：每一次波次转场 / 单波内增援 / **洞内开战首波**（敌方跃迁入场）有；
 *     **洞外开战首波没有**（那一场是我方飞入，敌方没有入场动画）；
 * (e) **存档**：`enteredAtMs` 随档（战斗时钟也随档 ⇒ 窗口不会因重载而重启/消失）；
 * (f) **常量单一出处**：界面直接 import 这两个数，不许各写一份。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare } from '../src/inventory'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import {
  BATTLE_ARRIVAL_FLY_MS,
  BATTLE_ARRIVAL_STAGGER_MS,
  advanceBattleFor,
  startBattleFor,
  stampFoeArrivalFx,
} from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../src/wormholeBattle'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'

const base: SimContext = buildSimContext()

/** 合成舰级：血厚（窗口内绝不可能被打死）+ 打得极慢（把变量压在"入场时机"上） */
function foeShip(id: string, hp: number): FoeShipDef {
  return {
    id,
    name: `试验舰${id}`,
    family: 'A',
    hullClassTier: 1,
    speedRatio: 1,
    hp,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg: 1,
    hitRate: 0.2,
    reloadMs: 9_000,
    rangeMinM: 1,
    rangeMaxM: 1_200,
    falloff: 0.5,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
  }
}

const WEAKLING = foeShip('t-arrival-weak', 8) // 首波：一两炮清掉，好让次波尽快入场
const TANK = foeShip('t-arrival-tank', 100_000) // 次波：窗口内怎么打都死不了

/** 两波卡：第 1 波 1 艘脆皮（`foe-0`）→ 第 2 波 2 艘厚甲（`w1-foe-0/1`） */
function waveCard(id = 'ano-arrival'): AnomalyDef {
  return {
    id,
    name: '入场窗口试验卡',
    galaxyId: 'galaxy-hub',
    threat: 20,
    standingReq: 0,
    standingGain: 1,
    rewardIsk: 1_000,
    loot: [],
    combatSeconds: 600,
    tactic: 'orbit',
    foeFamily: 'A',
    description: '测试用异常点',
    ships: [
      { ship: WEAKLING, count: 1, wave: 0 },
      { ship: TANK, count: 2, wave: 1 },
    ],
    waves: [
      { units: 1, hpShare: 1 },
      { units: 2, hpShare: 1 },
    ],
  }
}

/** 单波卡 + 一条"1 秒后入场"的增援（开关由调用方打开） */
function reinforceCard(id = 'ano-arrival-rf'): AnomalyDef {
  return {
    ...waveCard(id),
    ships: [{ ship: WEAKLING, count: 1 }, { ship: TANK, count: 1, enterAt: { sec: 1 } }],
    waves: [{ units: 1, hpShare: 1 }],
  }
}

/** 造一场真战斗：船装动能炮（打得中就掉血）+ 备弹 */
function world(cards: AnomalyDef[], opts: { seed?: number; reinforce?: boolean } = {}): {
  state: GameState
  ctx: SimContext
  uid: string
} {
  const ctx: SimContext = {
    ...base,
    ...(opts.reinforce
      ? { balance: { ...base.balance, battle: { ...base.balance.battle, foeReinforceEnabled: true } } }
      : {}),
    anomalies: new Map([...base.anomalies, ...cards.map((c) => [c.id, c] as const)]),
  }
  const state = createInitialState({ nowWallMs: 0, seed: opts.seed ?? 7 })
  const uid = addShipToFleet(state, 'sh-bullshark')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-3'], mid: [], low: [] }
  addWare(state, 'ammo-kinetic-l', 5_000)
  return { state, ctx, uid }
}

type Snap = { atMs: number; hp: Record<string, number>; entered: Record<string, number | undefined> }

function snapOf(b: BattleState): Snap {
  const hp: Record<string, number> = {}
  const entered: Record<string, number | undefined> = {}
  for (const [tag, u] of Object.entries(b.units)) {
    if (u.side !== 'foe') continue
    hp[tag] = u.hp.s + u.hp.a + u.hp.h
    entered[tag] = u.enteredAtMs
  }
  return { atMs: b.lastTickGameMs, hp, entered }
}

/**
 * 洞外推进 `ms` 毫秒（每拍 100ms，与实时战斗同一时钟口径；**可多次调用、时钟单调**）。
 * ⚠ 推的是**全局时钟** `state.gameMs`，不是 `battle.lastTickGameMs` —— 波次转场窗口内引擎**停表**
 * （`waveClearAt` 之前 `lastTickGameMs` 不动），若按战斗时钟续推就会永远停在那一拍。
 */
function runFor(state: GameState, ctx: SimContext, b: BattleState, anomalyId: string, ms: number): Snap[] {
  const out: Snap[] = []
  for (let i = 0; i < Math.round(ms / 100); i++) {
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, state.shipId, anomalyId)
    out.push(snapOf(b))
    if (b.ended) break
  }
  return out
}

describe('入场窗口：动画没结束不开火（船长 2026-09-14）', () => {
  it('**常量单一出处**：飞入 950ms / 逐舰错峰 60ms（界面 import 的就是这两个数）', () => {
    expect(BATTLE_ARRIVAL_FLY_MS).toBe(950)
    expect(BATTLE_ARRIVAL_STAGGER_MS).toBe(60)
  })

  it('**窗口内一炮不发、窗口一过立刻开打**（单点直测：把窗口推到 +10 秒）', () => {
    // 单波一张卡、只有一艘厚甲（唯一目标）⇒ 我方有没有开火完全由"能不能选中它"决定
    const solo: AnomalyDef = { ...waveCard('ano-arrival-solo'), ships: [{ ship: TANK, count: 1 }], waves: [{ units: 1, hpShare: 1 }] }
    const { state, ctx } = world([solo])
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival-solo', 0)!
    const me = b.units['player']!
    expect(Math.max(...me.weapons)).toBe(0) // 开战满装填 ⇒ 只要选中就能开火（排掉"装填没好"这个混淆项）
    const tag = Object.keys(b.units).find((t) => b.units[t]!.side === 'foe')!
    // 手工把入场窗口推到开战 +10 秒（950ms 太短，观测窗口不足）
    const WINDOW = 10_000
    b.units[tag]!.enteredAtMs = b.startedAtGameMs + WINDOW
    const full = b.units[tag]!.hp.s + b.units[tag]!.hp.a + b.units[tag]!.hp.h

    const seen = runFor(state, ctx, b, 'ano-arrival-solo', 10_000) // 10 秒
    for (const s of seen) {
      expect(s.hp[tag] ?? full).toBe(full) // 一滴血没掉
    }
    expect(b.stats.meShots).toBe(0) // 且**一炮都没开**（唯一目标在窗口内 ⇒ 枪口无处可指）

    const after = runFor(state, ctx, b, 'ano-arrival-solo', 3_000) // 再推 3 秒
    expect(b.stats.meShots).toBeGreaterThan(0) // 窗口一过就开打
    expect(after.some((s) => (s.hp[tag] ?? full) < full)).toBe(true)
  })

  it('**集火模式（锁定阵列）同样遵守窗口**：装上目标锁定阵列后窗口内照样一炮不发', () => {
    // ⚠ 这条单列：锁定装置走的是**另一条选靶单点**（`firstAliveFoe` 而不是 `randomAliveFoe`）——
    //    负向验证时抓到过"只改一条、另一条没人守"的洞。
    const solo: AnomalyDef = { ...waveCard('ano-arrival-lock'), ships: [{ ship: TANK, count: 1 }], waves: [{ units: 1, hpShare: 1 }] }
    const { state, ctx } = world([solo])
    const me0 = state.fleet[state.shipId]!
    me0.fitted = { high: ['mod-turret-kin-3', 'mod-lock-1'], mid: [], low: [] } // 锁定阵列 ⇒ 集火模式
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival-lock', 0)!
    const tag = Object.keys(b.units).find((t) => b.units[t]!.side === 'foe')!
    b.units[tag]!.enteredAtMs = b.startedAtGameMs + 10_000
    const full = b.units[tag]!.hp.s + b.units[tag]!.hp.a + b.units[tag]!.hp.h
    const seen = runFor(state, ctx, b, 'ano-arrival-lock', 10_000)
    for (const s of seen) expect(s.hp[tag] ?? full).toBe(full)
    expect(b.stats.meShots).toBe(0)
    runFor(state, ctx, b, 'ano-arrival-lock', 3_000)
    expect(b.stats.meShots).toBeGreaterThan(0)
  })

  it('**波次转场：窗口内一滴血不掉，窗口一过立刻挨打**（真转场链路）', () => {
    const { state, ctx } = world([waveCard()])
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival', 0)!
    const startAt = b.startedAtGameMs
    // 逐拍推进；第 2 波登场那一拍**把我方武器置为满装填**——复现船长报障的原话场景
    // 「敌方增援出现时，**我方炮台同时开火**」（转场期间我方装填是冻住的，真人会攒着炮等新目标）
    const seen: Snap[] = []
    let forced = false
    for (let t = 1; t <= 600; t++) {
      state.gameMs = startAt + t * 100
      advanceBattleFor(state, ctx, b, state.shipId, 'ano-arrival')
      const snap = snapOf(b)
      if (!forced && Object.keys(snap.hp).some((k) => k.startsWith('w1-'))) {
        const me = b.units['player']
        if (me) me.weapons = me.weapons.map(() => 0) // 炮台就绪
        forced = true
      }
      seen.push(snap)
      if (b.ended) break
    }
    expect(forced, '第 2 波没有入场').toBe(true)

    const firstW2 = seen.find((s) => Object.keys(s.hp).some((t) => t.startsWith('w1-')))!
    const tags = Object.keys(firstW2.hp).filter((t) => t.startsWith('w1-'))
    expect(tags.length).toBe(2)

    for (const tag of tags) {
      const full = firstW2.hp[tag]!
      const at = firstW2.entered[tag]
      expect(at).toBeTypeOf('number')
      // ⚠ 只数**它已经在场**的那些拍（转场窗口内它还没进 `units`，那几拍不算检查）——
      //    否则"窗口算到过去"这类 BUG 会被漏掉：它一登场就已经 0 血，而循环还在拿"它不存在"当通过。
      let checked = 0
      for (const s of seen) {
        if (s.atMs >= at! + BATTLE_ARRIVAL_FLY_MS) break
        if (!(tag in s.hp)) continue
        expect(s.hp[tag]!, `${tag} 在窗口内被打（第 ${checked + 1} 拍）`).toBe(full)
        checked++
      }
      // 入场时刻必须落在"它真正在场"之后：窗口至少覆盖 9 拍（950ms）
      expect(checked, `${tag} 的入场窗口没有覆盖到它在场的那几拍（窗口算到过去了？）`).toBeGreaterThanOrEqual(9)
      // 窗口之后：确实开始掉血（不是永久免疫）
      const after = seen.find((s) => s.atMs >= at! + BATTLE_ARRIVAL_FLY_MS && (s.hp[tag] ?? full) < full)
      expect(after, `${tag} 在窗口结束后仍未被打`).toBeTruthy()
    }
  })

  it('**逐舰错峰 60ms**：同批两艘的入场时刻差恰好一个错峰（与界面 `--arrive-delay` 同一算式）', () => {
    const { state, ctx } = world([waveCard()])
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival', 0)!
    const seen = runFor(state, ctx, b, 'ano-arrival', 20_000)
    const last = seen[seen.length - 1]!.entered
    expect(last['w1-foe-0']).toBeTypeOf('number')
    expect(last['w1-foe-1']).toBeTypeOf('number')
    expect(last['w1-foe-1']! - last['w1-foe-0']!).toBe(BATTLE_ARRIVAL_STAGGER_MS)
  })

  it('**洞外开战首波没有窗口**（有动画才有窗口：那一场是我方飞入，敌方没有入场动画）', () => {
    const { state, ctx } = world([waveCard()])
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival', 0)!
    for (const u of Object.values(b.units)) {
      if (u.side === 'foe') expect(u.enteredAtMs).toBeUndefined()
    }
  })

  it('**单波内增援（开关开启）也吃窗口**：入场后那 950ms 打不动它', () => {
    const { state, ctx } = world([reinforceCard()], { seed: 11, reinforce: true })
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival-rf', 0)!
    const seen = runFor(state, ctx, b, 'ano-arrival-rf', 12_000)
    const arrived = seen.find((s) => s.entered['w0-foe-1'] !== undefined)
    expect(arrived, '增援没有入场').toBeTruthy()
    const at = arrived!.entered['w0-foe-1']!
    const full = arrived!.hp['w0-foe-1']!
    for (const s of seen) {
      if (s.atMs >= at + BATTLE_ARRIVAL_FLY_MS) break
      expect(s.hp['w0-foe-1'] ?? full).toBe(full)
    }
  })

  it('**洞内开战首波有窗口**（敌方跃迁入场，走真开战链路）：我方打不动它，它自己也开不了火', () => {
    const ctx = buildSimContext()
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const uid = addShipToFleet(state, 'sh-thresher')
    state.shipId = uid
    expect(wormholeEnter(state, ctx, [uid], 21).ok).toBe(true)
    const run = state.wormhole.run!
    // 站到"舰船信号"格上（`wormholeStartBattle('node')` 的前提；与 `wormhole-battle.test.ts` 同款手法）
    const cell = run.grid!.cells.find((c) => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.place = 'ship'
    run.grid!.activated = run.grid!.activated.filter((k) => k !== cell.key)
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)

    const b = run.battle!
    const foes = Object.entries(b.units).filter(([, u]) => u.side === 'foe')
    expect(foes.length).toBeGreaterThan(0)
    for (const [, u] of foes) {
      expect(u.enteredAtMs).toBeTypeOf('number')
      // 首发也被推到窗口之后（"动画没演完谁都不动手"）
      expect(Math.min(...u.weapons)).toBeGreaterThanOrEqual(BATTLE_ARRIVAL_FLY_MS)
    }
    // 逐舰错峰（第 i 条 = 开战时刻 + i×60）
    const tags = foes.map(([t]) => t)
    const ats = tags.map((t) => b.units[t]!.enteredAtMs!)
    ats.forEach((at, i) => expect(at - ats[0]!).toBe(i * BATTLE_ARRIVAL_STAGGER_MS))

    // 逐拍推：窗口内敌舰一滴血不掉、且它一炮未发
    const hp0 = new Map(tags.map((t) => [t, b.units[t]!.hp.s + b.units[t]!.hp.a + b.units[t]!.hp.h]))
    for (let t = 1; t <= 40; t++) {
      state.gameMs = b.startedAtGameMs + t * 100
      advanceWormhole(state, ctx)
      if (!run.battle || run.battle.ended) break
      const bb = run.battle
      for (const tag of tags) {
        const u = bb.units[tag]
        if (!u || u.enteredAtMs === undefined) continue
        if (bb.lastTickGameMs >= u.enteredAtMs + BATTLE_ARRIVAL_FLY_MS) continue
        expect(u.hp.s + u.hp.a + u.hp.h).toBe(hp0.get(tag))
      }
      if (bb.lastTickGameMs < bb.startedAtGameMs + BATTLE_ARRIVAL_FLY_MS) {
        expect(bb.stats.foeShots).toBe(0)
      }
    }
  })

  it('**存档**：`enteredAtMs` 随档往返（战斗时钟也随档 ⇒ 窗口不会因重载而重启/消失）', () => {
    const { state, ctx } = world([waveCard()])
    const b = startBattleFor(state, ctx, state.shipId, 'ano-arrival', 0)!
    stampFoeArrivalFx(b)
    const tag = Object.keys(b.units).find((t) => b.units[t]!.side === 'foe')!
    const at = b.units[tag]!.enteredAtMs
    expect(at).toBeTypeOf('number')

    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ano-arrival'
    state.expedition.battle = b
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.expedition.battle?.units[tag]?.enteredAtMs).toBe(at)
    // 没写过该字段的单位照旧缺失 ⇒ 立即可交战（老档零迁移）
    const meUnit = Object.entries(b.units).find(([, u]) => u.side === 'me')
    if (meUnit) expect(loaded.expedition.battle?.units[meUnit[0]]?.enteredAtMs).toBeUndefined()
  })
})
