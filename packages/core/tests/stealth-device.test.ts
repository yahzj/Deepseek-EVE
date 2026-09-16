/**
 * **隐秘行动装置**（2026-09-15 船长原话：「添加隐秘行动装置，高槽，效果是自身武器开火前，
 * 隐身30秒（不被锁定，不被攻击）」）。
 *
 * 六问六答（船长裁定，逐条钉在下面）：
 * - **Q1 甲**：开战隐身 → **本舰首次开火立即现形**，最长 N 秒（先到者为准）；
 * - **Q2 甲**：隐身时敌方**选不到我方** ⇒ 主炮与机群**停火待机**（不是"照常开火打空"）；
 * - **Q3 甲**：**只有装了装置的那一艘**隐身（编队其余船照常被选靶）；
 * - **Q4**：两档 MK2/MK3 = **20 / 30 秒**，**极度吃 CPU**（数据契约：CPU 高于既有全部装备）；
 * - **Q5 丙**：先落码交读数；**并追加禁令：装着推进器时装置直接解除**；
 * - **Q6 甲**：零新增界面（只走战斗内提示条）＋ **预估一并算入**（损耗预估扣除隐身窗口）。
 *
 * 实现落点：`combat.createPlayerSpec`（装配期判：多件取最长 + 推进器禁令）→
 * `UnitSpec.stealthMs` → `createBattleState` 写运行时 `stealthUntilMs`（逐舰）→
 * 敌方选靶单点 `pickMyUnitTarget` 用 `isMyUnitTargetable` 排除 → 开火/到点两支清窗。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare } from '../src/inventory'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import {
  advanceBattleFor,
  bountyDamageForecast,
  createBattleState,
  createPlayerSpec,
  pickMyUnitTarget,
  startBattleFor,
} from '../src/combat'
import type { UnitSpec } from '../src/combat'
import { stackingOf } from '../src/equipment'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'

const base: SimContext = buildSimContext()

const STEALTH_2 = 'mod-stealth-2' // 20 秒 · CPU 75
const STEALTH_3 = 'mod-stealth-3' // 30 秒 · CPU 120
/** 推进器（中槽 propulsion 家族）——船长追加禁令的判据 */
const THRUSTER = 'mod-prop-3'
/** 测试舰：大白鲨级炮舰（225 CPU · 高槽 5）——装得下"重炮 + 隐秘装置"或"重炮 + 推进器" */
const SHIP = 'sh-whiteshark'
const CARD = 'ano-stealth-test'

/** 试验敌舰：射程极长（一定够得着我方）、打得慢而准，便于观测"能不能选中我" */
function foeShip(id: string): FoeShipDef {
  return {
    id,
    name: `试验舰${id}`,
    family: 'A',
    hullClassTier: 1,
    speedRatio: 1,
    hp: 40_000,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg: 12,
    hitRate: 1,
    reloadMs: 1_000,
    rangeMinM: 1,
    rangeMaxM: 30_000, // 远到"我方在它射程内"始终成立
    falloff: 1,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
  }
}

/** 单波单舰试验卡（厚甲 ⇒ 打不完，好让窗口前后都可观测） */
function stealthCard(): AnomalyDef {
  return {
    id: CARD,
    name: '隐秘行动试验卡',
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
    ships: [{ ship: foeShip('t-stealth-foe'), count: 1 }],
    waves: [{ units: 1, hpShare: 1 }],
  }
}

/** 造一场真战斗：把装置与武器装到测试舰上（`weapons: false` = 只有装置、没有武器） */
function world(opts: {
  stealth: string | readonly string[]
  weapons?: boolean
  thruster?: string
}): { state: GameState; ctx: SimContext; uid: string } {
  const ctx: SimContext = {
    ...base,
    anomalies: new Map([...base.anomalies, [CARD, stealthCard()] as const]),
  }
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const stealth = Array.isArray(opts.stealth) ? [...opts.stealth] : [opts.stealth as string]
  const high = [...(opts.weapons === false ? [] : ['mod-turret-kin-3']), ...stealth]
  const mid = opts.thruster ? [opts.thruster] : []
  state.fleet[uid]!.fitted = { high, mid, low: [] }
  addWare(state, 'ammo-kinetic-l', 5_000)
  return { state, ctx, uid }
}

const totalHp = (u: BattleState['units'][string]): number => u.hp.s + u.hp.a + u.hp.h

/** 逐拍推进（100ms/拍，与实时战斗同一时钟口径） */
function runFor(
  state: GameState,
  ctx: SimContext,
  b: BattleState,
  uid: string,
  ms: number,
  until?: () => boolean,
): void {
  for (let i = 0; i < Math.round(ms / 100); i++) {
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, CARD)
    if (b.ended) return
    if (until?.()) return
  }
}

describe('隐秘行动装置（2026-09-15 船长 · 六问六答）', () => {
  it('**窗口内不被锁定、不被攻击**；**到点（30 秒）即现形**，敌舰随后开火（Q1 甲 · Q2 甲）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3, weapons: false })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    const me = b.units['player']!
    expect(me.stealthUntilMs).toBe(30_000) // 开战那一刻起窗
    const hp0 = totalHp(me)

    // 窗口内逐拍推 29 秒：敌舰一炮未发、我方一滴血不掉
    runFor(state, ctx, b, uid, 29_000)
    expect(b.lastTickGameMs).toBeLessThan(30_000)
    expect(b.stats.foeShots, '窗口内敌舰开火了').toBe(0)
    expect(totalHp(b.units['player']!), '窗口内我方挨打了').toBe(hp0)

    // 推过 30 秒：窗口到点 ⇒ 字段清空、敌舰开火、我方开始挨打
    runFor(state, ctx, b, uid, 20_000, () => b.stats.foeShots > 0)
    expect(b.units['player']!.stealthUntilMs, '到点没现形').toBeUndefined()
    expect(b.stats.foeShots, '到点后敌舰仍不开火').toBeGreaterThan(0)
    expect(totalHp(b.units['player']!)).toBeLessThan(hp0)
  })

  it('**本舰开火即现形**：窗口在开火那一拍清空，敌舰随即能选中我方（Q1 甲）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3 })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(b.units['player']!.stealthUntilMs).toBe(30_000)
    // 手工把距离压进双方射程、武器满装填（开战默认在射程外缓冲处 ⇒ 否则要等接近）
    b.distanceM = 1_000
    b.units['player']!.weapons = b.units['player']!.weapons.map(() => 0)
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, CARD)
    expect(b.stats.meShots, '我方没有开火').toBeGreaterThan(0)
    expect(b.units['player']!.stealthUntilMs, '开火后没有现形').toBeUndefined()
    // 现形 ⇒ 选靶单点立刻能选中我方（Q2 甲的反面）
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(pickMyUnitTarget(state, b, [spec], 'random')).not.toBeNull()
    const before = b.stats.foeShots
    runFor(state, ctx, b, uid, 5_000, () => b.stats.foeShots > before)
    expect(b.stats.foeShots).toBeGreaterThan(before)
  })

  it('**两档时长按件取值**：MK2 = 20 秒 · MK3 = 30 秒；**多件取最长一件**（不叠加）', () => {
    const two = world({ stealth: STEALTH_2 })
    expect(createPlayerSpec(two.state, two.ctx, two.uid)!.stealthMs).toBe(20_000)
    const three = world({ stealth: STEALTH_3 })
    expect(createPlayerSpec(three.state, three.ctx, three.uid)!.stealthMs).toBe(30_000)
    // 多件取最长（不是相加 50 秒）
    const both = world({ stealth: [STEALTH_2, STEALTH_3] })
    expect(createPlayerSpec(both.state, both.ctx, both.uid)!.stealthMs).toBe(30_000)
    // 收敛分组 = max（界面据此标「取最长一件（不叠加）」，不谎报"全额叠加"）
    expect(stackingOf(both.ctx.modules.get(STEALTH_3)!)).toEqual({ group: 'max', kind: 'stealth' })
  })

  it('**推进器禁令**（船长 Q5 追加）：装了推进器 ⇒ 装置直接失效（没有窗口）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3, thruster: THRUSTER })
    // 装配期即判：规格里不带 stealthMs
    expect(createPlayerSpec(state, ctx, uid)!.stealthMs).toBeUndefined()
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(b.units['player']!.stealthUntilMs, '带推进器却仍有隐身窗口').toBeUndefined()
    // 直接后果：开战即可被选中（隐身没有生效）
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(pickMyUnitTarget(state, b, [spec], 'random')).not.toBeNull()
  })

  it('**编队里只护装了装置的那一艘**（Q3 甲）：僚舰照常可被选中', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3 })
    const allyUid = addShipToFleet(state, SHIP)
    const me = createPlayerSpec(state, ctx, uid)!
    const ally: UnitSpec = { ...createPlayerSpec(state, ctx, allyUid)!, tag: 'ally-1' }
    const b = createBattleState(me, [], 0, 1_000, [ally])
    expect(b.units['player']!.stealthUntilMs).toBe(30_000)
    expect(b.units['ally-1']!.stealthUntilMs, '僚舰不该有隐身窗口').toBeUndefined()
    // ① 可选池里**只剩隐身那艘** ⇒ 返回 null = 敌舰停火待机（Q2 甲）
    expect(pickMyUnitTarget(state, b, [me], 'random'), '隐身单位仍被选中').toBeNull()
    // ② 编队里有别人 ⇒ 敌舰改打僚舰；抽 20 次必须次次是僚舰（不是"碰巧抽中"）
    for (let i = 0; i < 20; i++) {
      expect(pickMyUnitTarget(state, b, [me, ally], 'random')?.tag, `第 ${i + 1} 次抽到了隐身中的主控`).toBe('ally-1')
    }
  })

  it('**存档往返**：隐身窗口随档（读档后既不重启、也不消失）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3, weapons: false })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    runFor(state, ctx, b, uid, 5_000) // 推 5 秒：窗口还剩 25 秒
    expect(b.units['player']!.stealthUntilMs).toBe(30_000)
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = CARD
    state.expedition.battle = b
    const loaded = loadSaveFile(serializeSaveFile(state, 1)).state
    expect(loaded.expedition.battle?.units['player']?.stealthUntilMs).toBe(30_000)
    // 老档/未装装置的单位：本字段缺失 ⇒ 恒可被选中（零迁移）
    const plain = world({ stealth: STEALTH_2, thruster: THRUSTER })
    const pb = startBattleFor(plain.state, plain.ctx, plain.uid, CARD, 0)!
    expect(pb.units['player']!.stealthUntilMs).toBeUndefined()
  })

  it('**预估计入**（Q6 甲）：装了装置 ⇒ 预计损耗下降（同一张硬卡、只差装置）', () => {
    /** 用**真卡**（A 族最强：蜃影导航劫持令）比"装 / 不装"——比合成卡更接近实战读数 */
    const CARD_REAL = 'ano-mirage-hijackers'
    const build = (fit: readonly string[]): GameState => {
      const s = createInitialState({ nowWallMs: 0, seed: 3 })
      const u = addShipToFleet(s, SHIP)
      s.shipId = u
      s.fleet[u]!.fitted = { high: [...fit], mid: [], low: [] }
      addWare(s, 'ammo-kinetic-l', 5_000)
      return s
    }
    const without = bountyDamageForecast(build(['mod-turret-kin-3']), base, base.anomalies.get(CARD_REAL)!, SHIP)
    const withDev = bountyDamageForecast(build(['mod-turret-kin-3', STEALTH_3]), base, base.anomalies.get(CARD_REAL)!, SHIP)
    // 敌方有效输出时长扣掉 30 秒窗口 ⇒ 预计的甲/结构损耗只会更低，且本卡上确实更低
    expect(withDev.armorLoss).toBeLessThanOrEqual(without.armorLoss)
    expect(withDev.hullLoss).toBeLessThanOrEqual(without.hullLoss)
    expect(withDev.armorLoss + withDev.hullLoss).toBeLessThan(without.armorLoss + without.hullLoss)
  })
})
