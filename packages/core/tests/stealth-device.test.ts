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
import { cpuUseOf, fittedCpuUsed, stackingOf } from '../src/equipment'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { AnomalyDef, FoeShipDef, ShipDef, SimContext } from '../src/types'

const base: SimContext = buildSimContext()

const STEALTH_2 = 'mod-stealth-2' // 20 秒 · CPU 55 · 300 万 · 稀有档 3（船长 2026-09-16 定数）
const STEALTH_3 = 'mod-stealth-3' // 30 秒 · CPU 80 · 1000 万 · 奇货档 4（船长 2026-09-16 定数）
/**
 * 推进器禁令的判据 = **装配家族 `slot: 'propulsion'`**（不是件名）⇒ 三档矢量推进器、三档微型跃迁引擎、
 * 以及虫洞专属的「掠袭加力器」「幽灵推进器」**全部**触发（用例里按家族**动态枚举**，新增件自动纳入）。
 */
const THRUSTER = 'mod-prop-3' // 矢量推进器 MK3（代表性一件）
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

/** 造一场真战斗：把装置与武器装到测试舰上（`weapons: false` = 只有装置、没有武器；
 *  `mid` = 中槽附加件——推进器禁令与"非推进器中槽件"的对照都走这个口） */
function world(opts: {
  stealth: string | readonly string[]
  weapons?: boolean
  mid?: string
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
  const mid = opts.mid ? [opts.mid] : []
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

  it('**推进器禁令**（船长 Q5 追加）：装了**推进器族任何一件** ⇒ 装置直接失效（含微型跃迁引擎）', () => {
    /**
     * 判据 = **装配家族 `slot: 'propulsion'`**（`combat.createPlayerSpec` 里 `propDefs` 非空即判 0）——
     * 不是件名匹配 ⇒ **三档矢量推进器 + 三档微型跃迁引擎 + 虫洞专属两件**全部触发。
     * 本用例按家族**动态枚举**：日后新增任何推进器件，自动落进这条断言（防"注释里写着同源、代码各写一份"）。
     * 船长 2026-09-16 追问「推进器是否包括微型跃迁装置」⇒ 这一条就是那问的钉子。
     */
    const propIds = [...base.modules.values()].filter((m) => m.slot === 'propulsion').map((m) => m.id)
    expect(propIds.length, '推进器家族不该这么少').toBeGreaterThanOrEqual(6)
    expect(propIds, '矢量推进器不在家族里？').toContain('mod-prop-3')
    expect(propIds, '微型跃迁引擎不在家族里？').toContain('mod-mwd-3')
    for (const id of propIds) {
      const { state, ctx, uid } = world({ stealth: STEALTH_3, mid: id })
      expect(createPlayerSpec(state, ctx, uid)!.stealthMs, `${id} 没有触发禁令`).toBeUndefined()
    }
    // 端到端：装了**微型跃迁引擎 MK3** ⇒ 开战就没有隐身窗口，且立刻可被选中
    const e2e = world({ stealth: STEALTH_3, mid: 'mod-mwd-3' })
    const b = startBattleFor(e2e.state, e2e.ctx, e2e.uid, CARD, 0)!
    expect(b.units['player']!.stealthUntilMs, '带微型跃迁引擎却仍有隐身窗口').toBeUndefined()
    const spec = createPlayerSpec(e2e.state, e2e.ctx, e2e.uid)!
    expect(pickMyUnitTarget(e2e.state, b, [spec], 'random')).not.toBeNull()
    // **反击断言**：禁令认的是**家族**，不是"中槽"——非推进器的中槽支援件不该误触发
    for (const id of ['mod-track-2', 'mod-gyro-2']) {
      const ctrl = world({ stealth: STEALTH_3, mid: id })
      expect(base.modules.get(id)?.slot, `${id} 不是中槽支援件？对照失效`).toBe('support')
      expect(createPlayerSpec(ctrl.state, ctrl.ctx, ctrl.uid)!.stealthMs, `${id} 误触发禁令`).toBe(30_000)
    }
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
    const plain = world({ stealth: STEALTH_2, mid: THRUSTER })
    const pb = startBattleFor(plain.state, plain.ctx, plain.uid, CARD, 0)!
    expect(pb.units['player']!.stealthUntilMs).toBeUndefined()
  })

  it('**预估计入**（Q6 甲）：装了装置 ⇒ 预计损耗下降（同一张硬卡、只差装置）', () => {
    /** 用**真卡**比"装 / 不装"——比合成卡更接近实战读数：**A 族最强卡 灰霾伏击团清剿令**（威胁 34）。
     *  本卡"不装" = 甲 1.00 / 结 0.92，"装" = 甲 0.09 / 结 0.00（两侧都不饱和）。
     *
     *  ⚠ **2026-09-25 口径变更（船长令「改」）**：预计损耗的敌血改按**卡面属性建档**取值
     *  （不再读 `foeHpOfThreat(威胁)`）⇒ 全体读数抬升、夹具要跟着换。沿革（两次都是"口径变动让
     *  观测点消失"，不是装置失效）：原用 蜃影导航劫持令 → 威胁重定标后曲线价过小、两侧归 0；
     *  一度改 噬口猎杀令 → 新口径下两侧都打满 2.00 ⇒ 改用本卡。 */
    const CARD_REAL = 'ano-haze-ambush'
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

/**
 * **隐身期间「基础舰炮」不开炮**（船长 2026-09-17：「**让舰船自带的基础舰炮在隐身情况下不开炮**」）。
 *
 * 背景（旧行为的实证）：基础舰炮**恒在且卸不掉** ⇒ 只装装置、没装自己武器的船，**开战第一拍**就由它
 * 自己开火（`stats.meShots` 处「开火即现形」）⇒ 20/30 秒窗口当场终结、装置形同虚设。
 * 现行口径 = **窗口生效期内 `src === 'base'` 不开火**；**到点**或**本舰其它武器开火现形**之后立刻恢复。
 * 只认 `src === 'base'` ⇒ 外挂武器与无人机照旧开火（"主动开火现形"仍是玩家的选择与代价）。
 */
describe('隐身期间基础舰炮闭麦（2026-09-17 船长）', () => {
  /** 全部武器满装填 ⇒ 排除"在装填"这个干扰项（只在开打前清零一次） */
  function loadAll(b: BattleState): void {
    for (const u of Object.values(b.units)) u.weapons = u.weapons.map(() => 0)
  }
  /**
   * **把距离钉在基础舰炮射程内逐拍推进**。为什么必须钉：拔河段距离会缓慢外飘
   * （临时探针实测 —— 开战 1,000m、我方期望 2,000m，t=30s 恰 2,500m、t=33s 2,553m），
   * 不钉住的话"到点恢复开火"会被"已经飘出 2,500m 射程"掩盖、观测不到。
   */
  function pinned(
    state: GameState,
    ctx: SimContext,
    b: BattleState,
    uid: string,
    ms: number,
    until?: () => boolean,
  ): void {
    for (let i = 0; i < Math.round(ms / 100); i++) {
      b.distanceM = 1_000
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, CARD)
      if (b.ended) return
      if (until?.()) return
    }
  }

  it('**窗口内一炮未发**：只装装置的船，即使敌人已在基础舰炮射程内也不还击，窗口原样保留', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3, weapons: false })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    // 反证前提：这艘船**真的只有兜底那一门**（否则本用例证明不了"基础舰炮被闭麦"）
    expect(createPlayerSpec(state, ctx, uid)!.weapons.map((w) => w.src)).toEqual(['base'])
    loadAll(b)
    pinned(state, ctx, b, uid, 5_000)
    expect(b.stats.meShots, '隐身期间基础舰炮开火了').toBe(0)
    expect(b.units['player']!.stealthUntilMs, '窗口被自己那门炮打掉了').toBe(30_000)
    expect(b.stats.foeShots, '窗口内敌舰开火了').toBe(0)
    expect(b.units['player']!.weapons[0], '基础舰炮的装填倒计时被推动了').toBe(0)
  })

  it('**到点即恢复**：窗口一到点，同一门基础舰炮立刻开火（不是"永久哑火"）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3, weapons: false })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    loadAll(b)
    pinned(state, ctx, b, uid, 29_000)
    expect(b.stats.meShots, '窗口内就开火了').toBe(0)
    pinned(state, ctx, b, uid, 5_000, () => b.stats.meShots > 0)
    expect(b.units['player']!.stealthUntilMs, '到点没现形').toBeUndefined()
    expect(b.stats.meShots, '到点后基础舰炮仍不开火').toBeGreaterThan(0)
  })

  it('**只闭底座那一门**：外挂武器照常开火并立即现形（同一拍里基础舰炮仍是哑的）', () => {
    const { state, ctx, uid } = world({ stealth: STEALTH_3 }) // 高槽 = 攻坚炮台 MK3 + 隐秘装置
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(createPlayerSpec(state, ctx, uid)!.weapons.map((w) => w.src)).toEqual(['base', 'turret'])
    loadAll(b)
    pinned(state, ctx, b, uid, 100)
    expect(b.stats.meShots, '装的炮台没有开火').toBeGreaterThan(0)
    expect(b.units['player']!.stealthUntilMs, '开火后没有现形').toBeUndefined()
    // 基础舰炮排第 0 位、在炮台**之前**结算 ⇒ 这一拍它没开火（倒计时仍 0），炮台已进装填
    expect(b.units['player']!.weapons[0], '基础舰炮在隐身的这一拍开火了').toBe(0)
    expect(b.units['player']!.weapons[1], '炮台没进装填').toBeGreaterThan(0)
  })

  it('**对照（旧口径零变化）**：没装装置的船照旧第一拍就用基础舰炮还击', () => {
    const { state, ctx, uid } = world({ stealth: [], weapons: false })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(b.units['player']!.stealthUntilMs, '没装装置却有隐身窗口').toBeUndefined()
    loadAll(b)
    pinned(state, ctx, b, uid, 100)
    expect(b.stats.meShots, '没装装置的船不还击了').toBeGreaterThan(0)
    expect(b.units['player']!.weapons[0], '基础舰炮没进装填').toBeGreaterThan(0)
  })
})

/**
 * **侦察舰特性**（船长 2026-09-16：「**侦查舰添加特性，隐秘行动装置所需CPU降低50%，且移除推进器
 * 失效惩罚**」；口径四答：只有「侦察舰」子分类那两艘 · CPU **向上取整**（55→28 · 80→40）·
 * **完全移除**推进器惩罚 · 特性栏与装配页都显示）。
 *
 * 判据一律走**数据字段**（`ShipDef.stealthCpuMul` / `stealthIgnoresPropulsion`，照「后勤舰」先例），
 * 引擎里不硬判子分类 ⇒ 改数值/换船都只动数据。
 */
describe('侦察舰特性（2026-09-16 船长）', () => {
  const SCOUT = 'sh-nautilus' // 鹦鹉螺级测绘巡洋舰（子分类 侦察舰）
  const SCOUT2 = 'sh-wh-g-frigate' // 幽影侦察舰（同子分类）
  const NON_SCOUT = 'sh-whiteshark' // 对照：普通炮舰
  const shipDefOf = (id: string): ShipDef => base.ships.get(id)!

  /** 造一艘指定船的装配（高槽：炮 + 装置；中槽可插推进器），与 `world()` 同口径 */
  function worldOf(defId: string, opts: { stealth: string | readonly string[]; mid?: string }) {
    const ctx: SimContext = {
      ...base,
      anomalies: new Map([...base.anomalies, [CARD, stealthCard()] as const]),
    }
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const uid = addShipToFleet(state, defId)
    state.shipId = uid
    const stealth = Array.isArray(opts.stealth) ? [...opts.stealth] : [opts.stealth as string]
    state.fleet[uid]!.fitted = { high: ['mod-turret-kin-3', ...stealth], mid: opts.mid ? [opts.mid] : [], low: [] }
    addWare(state, 'ammo-kinetic-l', 5_000)
    return { state, ctx, uid }
  }

  it('数据侧：**恰好两艘**侦察舰带这两个特性，且值 = 0.5 / true（其余船一件都不带）', () => {
    for (const id of [SCOUT, SCOUT2]) {
      const s = shipDefOf(id)
      expect(s.subClass, `${id} 的子分类`).toBe('侦察舰')
      expect(s.stealthCpuMul, `${id} 的 CPU 倍率`).toBe(0.5)
      expect(s.stealthIgnoresPropulsion, `${id} 的免推进器失效`).toBe(true)
    }
    // 对照：普通船两个字段都不该有（防"顺手给别的船也开个口子"）
    const plain = shipDefOf(NON_SCOUT)
    expect(plain.stealthCpuMul).toBeUndefined()
    expect(plain.stealthIgnoresPropulsion).toBeUndefined()
  })

  it('**CPU 折算（向上取整）**：侦察舰上 MK2 55→28 · MK3 80→40；其余件与其余船一字不变', () => {
    const scout = shipDefOf(SCOUT)
    const s2 = base.modules.get(STEALTH_2)!
    const s3 = base.modules.get(STEALTH_3)!
    expect(cpuUseOf(s2, scout)).toBe(28) // ceil(55 × 0.5) = 28（船长四答取「乙：向上取整」）
    expect(cpuUseOf(s3, scout)).toBe(40) // ceil(80 × 0.5)
    // 对照 ①：非侦察舰 = 原值
    expect(cpuUseOf(s2, shipDefOf(NON_SCOUT))).toBe(55)
    expect(cpuUseOf(s3, shipDefOf(NON_SCOUT))).toBe(80)
    // 对照 ②：**只折隐秘装置**——普通高槽件在侦察舰上 CPU 不变
    const gun = base.modules.get('mod-turret-kin-3')!
    expect(cpuUseOf(gun, scout)).toBe(gun.cpuUse)
    // 全位合计同源：传船比不传船正好少 27（55 − 28）
    const w = worldOf(SCOUT, { stealth: STEALTH_2 })
    const fittedOnly = fittedCpuUsed(w.state.fleet[w.uid]!.fitted, w.ctx)
    const withTrait = fittedCpuUsed(w.state.fleet[w.uid]!.fitted, w.ctx, scout)
    expect(fittedOnly - withTrait).toBe(27)
  })

  it('**免推进器失效**：侦察舰装推进器也照常隐身；同配装的普通船仍旧失效', () => {
    for (const prop of ['mod-prop-3', 'mod-mwd-3']) {
      const scout = worldOf(SCOUT, { stealth: STEALTH_3, mid: prop })
      expect(createPlayerSpec(scout.state, scout.ctx, scout.uid)!.stealthMs, `${SCOUT} + ${prop} 不该失效`).toBe(30_000)
      const other = worldOf(SCOUT2, { stealth: STEALTH_2, mid: prop })
      expect(createPlayerSpec(other.state, other.ctx, other.uid)!.stealthMs, `${SCOUT2} + ${prop} 不该失效`).toBe(20_000)
      // 对照：普通船同一套配装 ⇒ 旧口径（推进器在装即判 0）
      const plain = worldOf(NON_SCOUT, { stealth: STEALTH_3, mid: prop })
      expect(createPlayerSpec(plain.state, plain.ctx, plain.uid)!.stealthMs, `${NON_SCOUT} + ${prop} 应仍失效`).toBeUndefined()
    }
  })

  it('**端到端**：侦察舰带推进器进战斗 ⇒ 开战就有隐身窗口，窗口内敌舰选不中我方', () => {
    const { state, ctx, uid } = worldOf(SCOUT, { stealth: STEALTH_3, mid: 'mod-mwd-3' })
    const b = startBattleFor(state, ctx, uid, CARD, 0)!
    expect(b.units['player']!.stealthUntilMs, '带推进器的侦察舰没有隐身窗口').toBe(30_000)
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(pickMyUnitTarget(state, b, [spec], 'random'), '窗口内仍被选中').toBeNull()
  })

  it('**装配校验同源**：同一份装配在侦察舰上合计 CPU 更低——差值正好是那 27 点（55 − 28）', () => {
    const fitted = { high: [STEALTH_2], mid: [], low: [] }
    const scoutUsed = fittedCpuUsed(fitted, base, shipDefOf(SCOUT))
    const plainUsed = fittedCpuUsed(fitted, base, shipDefOf(NON_SCOUT))
    expect(scoutUsed, '侦察舰上 MK2 应折成 28').toBe(28)
    expect(plainUsed, '普通船上 MK2 应仍是 55').toBe(55)
    expect(plainUsed - scoutUsed).toBe(27)
  })
})
