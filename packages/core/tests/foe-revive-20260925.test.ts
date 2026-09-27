/**
 * **挂载件「支援舰船召唤装置」用例**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，
 * 只不过改为**复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，
 * **每次随机复活一艘**」）。
 *
 * 四条口径（全部船长选定）+ 一条零变化：
 * ① **池子 = 当前这一波编成里已阵亡的**（跨波不补；**召唤者自己除外**）；
 * ② **上限 = 不超本波原编成**（死一个补一个）；
 * ③ **满血入场** + 入场窗口（动画演完才可被选中、首发推到窗口之后）；
 * ④ **表现 = 敌方支援舰船入场**：新 tag `sup{n}-<原tag>`（美术/体积/名称按原 tag 解析）；
 * ⑤ **没挂该件的战斗一个随机数都不消费**（零行为变化）。
 *
 * **2026-09-27 补两条**（玩家报障，船长转述：「**增援的敌舰不会攻击也没有效果**」——指入侵母舰复活的敌舰）：
 * ⑥ **入场即参战**（`foesWithSupport`）：它会开火、我方打得着它、它没沉就不判胜；
 * ⑦ **它挡着清波**：本波编成全灭但支援舰还活着 ⇒ 不换波、也不记"本波已全灭"。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  FOE_MOUNT_IDS,
  addModule,
  addShipToFleet,
  addWare,
  createInitialState,
  fitModule,
  loadSaveFile,
  serializeSaveFile,
} from '../src/index'
import type { GameState } from '../src/state'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'
import { activeFoeSpecsOf, advanceBattleFor, baseFoeTag, battleArcsFor, createBattleState, createPlayerSpec, foeShipTierOf, foeUnitNameOf } from '../src/combat'
import { makeTestCtx, moduleDef, ship } from './helpers'

const base = buildSimContext()
/** 真卡：H 族入侵母舰（`ink-flagship` 第 4 波 = 母舰 ＋ 3 艘僚舰） */
const CARD = base.anomalies.get('ink-flagship')!
/** 第 4 波（母舰所在波；下标 3）的编成 */
const WAVE = 3

/**
 * 测试炮台（只服务"我方真能打到支援舰"这一条观测；数值不求平衡）：
 * 打得准（`hitRate 1` ＋ `falloff 0` ⇒ 射程内必中）、打得远（6 万米，任何交距都在射程内）。
 */
const GUN = moduleDef('revive-gun', 'turret', 0, {
  damageType: 'kinetic',
  maxRangeM: 60_000,
  minRangeM: 0,
  hitRate: 1,
  falloff: 0,
  reloadMs: 1_000,
  dmgMult: 50,
})

/** 世界：我方一艘超厚壳测试船（本用例只查"支援舰怎么入场"，不查战斗平衡）＋ 真旗舰卡 */
function world(opts?: { turret?: boolean }): { state: GameState; ctx: SimContext; battle: ReturnType<typeof createBattleState> } {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ships: [ship('revive-bed', { maxSpeedMps: 1, shieldHp: 900_000, armorHp: 900_000, hullHp: 900_000 })],
    anomalies: [CARD],
    ...(opts?.turret === true ? { modules: [GUN] } : {}),
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  /** ⚠ **驾驶船必须是那艘厚壳船**（默认初始船只有 15/10/25 血 ⇒ 5 秒就被打没、战斗即结束） */
  const uid = addShipToFleet(state, 'revive-bed')
  state.shipId = uid
  if (opts?.turret === true) {
    addModule(state, GUN.id, 1)
    const r = fitModule(state, GUN.id, ctx, { shipId: uid, rack: 'high', index: 0 })
    if (!r.ok) throw new Error(`用例装配失败：${r.error}`)
    /** 弹链：`createPlayerSpec` 按"实装弹"算单发伤害，没有弹就一发 0 伤（观测不到命中/伤害） */
    addWare(state, 'ammo-kinetic-l', 5_000)
  }
  const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
  const me = createPlayerSpec(state, ctx, state.shipId)!
  const battle = createBattleState(me, specs, 0, 5_000)
  /** 白盒：本场直接打到第 4 波（前 3 波不参与本用例） */
  battle.waveIdx = WAVE
  /**
   * ⚠ `createBattleState` **不预载弹药**（那是 `startBattleFor` 的活：从货舱扣弹写进 `battle.ammo`）
   * —— 本文件是白盒建档，得自己给一条弹链，否则我方武器"无弹不开火"（`stepBattle` 里无弹直接跳过）。
   */
  if (opts?.turret === true) {
    battle.ammo.kin = 200_000
    battle.ammoIds = { kinetic: 'ammo-kinetic-l' }
  }
  return { state, ctx, battle }
}

/* ═══════════ 清波判据用的合成两波卡（真卡母舰在**末波**，走不到"清波换波"那条判据） ═══════════ */

/** 合成舰级：血厚、打得慢（把变量压在"支援舰算不算在场"上） */
function synthShip(id: string, hp: number): FoeShipDef {
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

const SUP_MOTHER = synthShip('t-tsup-mother', 400_000)
const SUP_ESCORT = synthShip('t-tsup-escort', 200_000)
const SUP_TANK = synthShip('t-tsup-tank', 400_000)

/** 两波卡：**第 1 波**（非末波）= 召唤者 ＋ 1 艘僚舰；第 2 波 = 1 艘厚甲 */
const TWO_WAVE: AnomalyDef = {
  id: 'ano-tsup-two-wave',
  name: '支援舰清波试验卡',
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
    { ship: SUP_MOTHER, count: 1, wave: 0, mounts: [FOE_MOUNT_IDS.reviveEscort] },
    { ship: SUP_ESCORT, count: 1, wave: 0 },
    { ship: SUP_TANK, count: 1, wave: 1 },
  ],
  waves: [
    { units: 2, hpShare: 1 },
    { units: 1, hpShare: 1 },
  ],
}

/** 该 tag 的三层血是否为空 */
const deadOf = (battle: ReturnType<typeof createBattleState>, tag: string): boolean => {
  const u = battle.units[tag]
  return !!u && u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0
}

/** 把战斗时钟推 `ms`（按 100ms 切片走真引擎；`state.gameMs` 是全局时钟） */
function runFor(
  state: GameState,
  ctx: SimContext,
  battle: ReturnType<typeof createBattleState>,
  ms: number,
  anomalyId: string = CARD.id,
): void {
  state.gameMs += ms
  advanceBattleFor(state, ctx, battle, state.shipId, anomalyId)
}

describe('敌方挂载件「支援舰船召唤装置」（船长 2026-09-25）', () => {
  it('建档：只有母舰挂该件（60 秒），僚舰不挂', () => {
    const specs = activeFoeSpecsOf(CARD, base.balance.battle, WAVE)
    const withMount = specs.filter((s) => s.foeReviveEscort !== undefined)
    expect(withMount.length, '本波只有母舰挂件').toBe(1)
    expect(withMount[0]!.foeShipId).toBe('foe-h-ink-flagship')
    expect(withMount[0]!.foeReviveEscort!.everyMs).toBe(60_000)
    expect(withMount[0]!.foeMountNames, '挂载件名进敌舰悬停/战报').toContain('支援舰船召唤装置')
  })

  it('60 秒召唤一艘：阵亡僚舰满血复活入场（新 tag `sup1-…` ＋ 入场窗口）', () => {
    const { state, ctx, battle } = world()
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    const escort = specs.find((s) => s.foeReviveEscort === undefined)!
    // 白盒：打掉一艘僚舰
    battle.units[escort.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(deadOf(battle, escort.tag)).toBe(true)
    // 还没到 60 秒 ⇒ 不召唤
    runFor(state, ctx, battle, 30_000)
    expect(battle.foeReviveCount ?? 0).toBe(0)
    expect(Object.keys(battle.units).some((t) => t.startsWith('sup'))).toBe(false)
    // 越过 60 秒 ⇒ 召唤一艘
    runFor(state, ctx, battle, 35_000)
    expect(battle.foeReviveCount).toBe(1)
    const tag = `sup1-${escort.tag}`
    const rt = battle.units[tag]
    expect(rt, '支援舰已入场（新 tag ⇒ 界面按新单位渲染，带入场动画）').toBeDefined()
    expect(rt!.hp.s + rt!.hp.a + rt!.hp.h, '满血入场').toBeCloseTo(
      battle.units[escort.tag]!.hpMax!.s + battle.units[escort.tag]!.hpMax!.a + battle.units[escort.tag]!.hpMax!.h,
      6,
    )
    expect(rt!.enteredAtMs, '带入场窗口（动画演完才可被选中；时刻取全局时钟）').toBe(state.gameMs)
    // 表现与文案：日志 + 画面提示
    expect(state.logs.some((l) => l.textId === 'core.combat.001'), '日志 id = core.combat.001').toBe(true)
    expect(battle.notices?.some((n) => n.text.includes('敌方支援舰船入场')) ?? false).toBe(true)
    /** 美术/体积/名称仍按**原 tag** 解析（`baseFoeTag` 剥壳）——否则界面会回落成 A 族兜底舰影 */
    expect(baseFoeTag(tag)).toBe(escort.tag)
    expect(foeUnitNameOf(CARD, tag), '支援舰沿用原单位名').toBe(foeUnitNameOf(CARD, escort.tag))
    expect(foeShipTierOf(CARD, tag), '支援舰沿用原舰种档（体积）').toBe(foeShipTierOf(CARD, escort.tag))
  })

  it('上限 = 不超本波原编成：补满 3 艘僚舰后再到点也不召唤', () => {
    const { state, ctx, battle } = world()
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    const escorts = specs.filter((s) => s.foeReviveEscort === undefined)
    expect(escorts.length, '第 4 波 = 母舰 + 3 僚舰').toBe(3)
    for (const e of escorts) battle.units[e.tag]!.hp = { s: 0, a: 0, h: 0 }
    /**
     * ⚠ **2026-09-26 起每次 2 艘**（船长令「改为每60秒复活2艘船」）⇒ 第 1 次到点就补 2 艘，
     * 第 2 次到点补满第 3 个空槽（**受本波剩余空槽封顶**，不会超编）。
     */
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '第 1 次到点补 2 艘').toBe(2)
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '第 2 次到点补满剩下的 1 个空槽').toBe(3)
    expect(Object.keys(battle.units).filter((t) => t.startsWith('sup')).length).toBe(3)
    // 编成已满（母舰 ＋ 3）⇒ 再走 3 分钟也不再召唤
    runFor(state, ctx, battle, 180_000)
    expect(battle.foeReviveCount, '编成满 ⇒ 不超编').toBe(3)
  })

  it('**2026-09-26 令**：每次到点补 2 艘（阵亡 ≥2 时一次入场两艘，序号连续）', () => {
    const { state, ctx, battle } = world()
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    const escorts = specs.filter((s) => s.foeReviveEscort === undefined)
    for (const e of escorts) battle.units[e.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '一次补 2 艘').toBe(2)
    const sups = Object.keys(battle.units).filter((t) => t.startsWith('sup')).sort()
    expect(sups.length).toBe(2)
    // 两艘都满血入场、都有入场窗口
    for (const t of sups) {
      const rt = battle.units[t]!
      expect(rt.hp.s + rt.hp.a + rt.hp.h).toBeGreaterThan(0)
      expect(rt.enteredAtMs).toBeDefined()
    }
    // 两条战报/日志（序号 1、2）
    const logs = state.logs.filter((l) => l.textId === 'core.combat.001')
    expect(logs.length, '每艘各记一条').toBeGreaterThanOrEqual(2)
  })

  it('**2026-09-26 令**：**优先**复活干扰舰（它阵亡时先占名额；活着/已补进场则名额回落到随机）', () => {
    const { state, ctx, battle } = world()
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    const jammer = specs.find((s) => s.foeShipId === 'foe-h-ink-jammer')
    expect(jammer, '第 4 波编成里有墨潮干扰舰').toBeTruthy()
    const others = specs.filter((s) => s.foeReviveEscort === undefined && s.foeShipId !== 'foe-h-ink-jammer')
    // 只打掉干扰舰（其余僚舰活着）⇒ 到点必须复活它
    battle.units[jammer!.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '干扰舰占名额（只有它可补 ⇒ 1 艘）').toBe(1)
    const revived = Object.keys(battle.units).filter((t) => t.startsWith('sup'))
    expect(revived.length).toBe(1)
    expect(baseFoeTag(revived[0]!)).toBe(jammer!.tag)
    /**
     * 干扰舰**活着**时：名额回到随机池 —— 再打掉 2 艘其它僚舰，下一次到点必须补的是那 2 艘
     * （干扰舰此刻在场 ⇒ 它不在池子里）。
     */
    const before = new Set(Object.keys(battle.units).filter((t) => t.startsWith('sup')))
    battle.units[others[0]!.tag]!.hp = { s: 0, a: 0, h: 0 }
    battle.units[others[1]!.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '再补 2 艘').toBe(3)
    const fresh = Object.keys(battle.units)
      .filter((t) => t.startsWith('sup') && !before.has(t))
      .map((t) => baseFoeTag(t))
    expect(fresh, '本轮补的是那两艘僚舰').toContain(others[0]!.tag)
    expect(fresh).toContain(others[1]!.tag)
    expect(fresh, '干扰舰活着 ⇒ 不会被重复复活').not.toContain(jammer!.tag)
  })

  it('只补当前波：支援舰一律来自本波编成（跨波尸体不补）', () => {
    const { state, ctx, battle } = world()
    const wave3 = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE).map((s) => s.tag)
    const wave0 = activeFoeSpecsOf(CARD, ctx.balance.battle, 0).map((s) => s.tag)
    // 白盒：把"第 1 波"的一艘也塞进战场当尸体（模拟多波打过来的场面）
    const ancient = wave0[0]!
    const proto = activeFoeSpecsOf(CARD, ctx.balance.battle, 0).find((s) => s.tag === ancient)!
    battle.units[ancient] = {
      tag: ancient,
      side: 'foe',
      name: proto.name,
      hp: { s: 0, a: 0, h: 0 },
      weapons: [],
    }
    const escort = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE).find((s) => s.foeReviveEscort === undefined)!
    expect(wave3).toContain(escort.tag)
    battle.units[escort.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '本波有尸体 ⇒ 召唤').toBe(1)
    const summoned = Object.keys(battle.units).filter((t) => t.startsWith('sup'))
    expect(summoned.length).toBe(1)
    expect(wave3, '只从当前波编成里抽（跨波尸体不补）').toContain(baseFoeTag(summoned[0]!))
    expect(wave0).not.toContain(baseFoeTag(summoned[0]!))
  })

  it('召唤者阵亡 ⇒ 停止召唤（母舰沉了这一场就结束，计时停在原地）', () => {
    const { state, ctx, battle } = world()
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    const mother = specs.find((s) => s.foeReviveEscort !== undefined)!
    const escort = specs.find((s) => s.foeReviveEscort === undefined)!
    battle.units[escort.tag]!.hp = { s: 0, a: 0, h: 0 }
    battle.units[mother.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount ?? 0, '召唤者不在场 ⇒ 不召唤').toBe(0)
  })

  it('零变化：没挂该件的战斗一次都不召唤（计时字段一个都不写）', () => {
    const { state, ctx, battle } = world()
    /** 白盒：把母舰上的挂件摘掉（= 普通战斗） */
    const motherSpec = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE).find((s) => s.foeReviveEscort !== undefined)!
    const stripped = { ...motherSpec, foeReviveEscort: undefined }
    // 用"没有该件的卡"更直接：换一张不带挂件的真卡（H 族袭击舰队）
    const other = base.anomalies.get('ink-raid')!
    const ctx2: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies, [other.id, other]]) }
    const battle2 = createBattleState(createPlayerSpec(state, ctx2, state.shipId)!, activeFoeSpecsOf(other, ctx2.balance.battle, 0), 0, 5_000)
    runFor(state, ctx2, battle2, 300_000)
    expect(battle2.foeReviveAtMs, '没有召唤装置 ⇒ 连计时字段都不建').toBeUndefined()
    expect(battle2.foeReviveCount ?? 0).toBe(0)
    expect(Object.keys(battle2.units).some((t) => t.startsWith('sup'))).toBe(false)
    void stripped
    void battle
  })

  it('随档往返：召唤计时与已召唤次数都要活过读档（否则战中重载白赚一次支援）', () => {
    const { state, ctx, battle } = world()
    const escort = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE).find((s) => s.foeReviveEscort === undefined)!
    battle.units[escort.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount).toBe(1)
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = CARD.id
    state.expedition.battle = battle
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.expedition.battle?.foeReviveCount, '已召唤次数').toBe(1)
    expect(back.expedition.battle?.foeReviveAtMs, '下一次召唤时刻').toBe(battle.foeReviveAtMs)
    expect(Object.keys(back.expedition.battle?.units ?? {}).some((t) => t.startsWith('sup')), '支援舰本身也在档里').toBe(true)
  })

  /**
   * **2026-09-27 玩家报障**（船长转述：「**增援的敌舰不会攻击也没有效果**」——即入侵母舰复活的敌舰）。
   *
   * 根因：支援舰只被 `seedUnit` 写进 `battle.units`，而**敌人开火 / 我方选靶 / 判胜**三处**只看
   * 递进 `stepBattle` 的那份 `foes`**（= 本波编成）⇒ 它入得了场（有舰影、有血条、有入场动画），
   * 却**一炮不开、谁也打不着它、也不挡判胜**。修法 = 逐拍用 `foesWithSupport` 重取参战敌阵。
   *
   * 本条从**引擎读数**上钉住参战闭环 —— ① ② ③ 在改动前**一条都不成立**（③ 改前会直接判胜）。
   */
  it('**参战闭环（2026-09-27 报障）**：复活的支援舰会开火、能被我方打、且它没沉就不判胜', () => {
    const { state, ctx, battle } = world({ turret: true })
    const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
    /**
     * 只打掉**战列巡洋舰**（导弹射程 1,000~11,000 ⇒ 本场 10,348m 的交距落在它射程内；
     * 且它带 1 架重袭机 ⇒ 顺带能查"支援舰的机群画不画得出来"）：
     * 池子里只有它一艘 ⇒ 补员必然补它（干扰舰这时还活着，优先名单不占名额）。
     * ⚠ **不拿干扰舰当样本**：它的 ECM 是**短程固件**（射程 1~4,275），本场交距在 10km
     * ⇒ 它开不了火是**射程**的事、与"算不算敌人"无关，会把这条例子的读数搅浑。
     */
    const sample = specs.find((s) => s.foeShipId === 'foe-h-ink-battlecruiser')!
    battle.units[sample.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000)
    expect(battle.foeReviveCount, '到点召唤 1 艘').toBe(1)
    const supTag = `sup1-${sample.tag}`
    expect(battle.units[supTag], '支援舰已入场').toBeDefined()
    expect(baseFoeTag(supTag), '补的就是那艘战列巡洋舰').toBe(sample.tag)
    /**
     * 白盒加血：本用例只查"它算不算敌人"（会不会开火 / 会不会挨打 / 挡不挡判胜），**不查要打多久**。
     */
    battle.units[supTag]!.hp = { s: 5_000_000, a: 5_000_000, h: 5_000_000 }
    /** 本波其余单位（母舰 ＋ 干扰舰 ＋ 鱼雷舰）全打掉 ⇒ 场上**只剩这艘支援舰** ⇒ 下面每个读数都只可能出自它 */
    for (const f of specs) if (f.tag !== sample.tag) battle.units[f.tag]!.hp = { s: 0, a: 0, h: 0 }
    const shots0 = battle.stats.foeShots
    const hits0 = battle.stats.meHits
    const dmg0 = battle.stats.meDmg
    runFor(state, ctx, battle, 12_000)
    // ① 它在**开火循环**里
    expect(battle.stats.foeShots, '支援舰真开火').toBeGreaterThan(shots0)
    // ② 它在**我方选靶池**里
    expect(battle.stats.meHits, '我方真打得着它').toBeGreaterThan(hits0)
    expect(battle.stats.meDmg, '我方伤害真落在它身上').toBeGreaterThan(dmg0)
    // ③ 它挡着**判胜**（改前：我方"无事可打" ⇒ 这里会直接变成 'me'）
    expect(battle.ended, '它还在 ⇒ 本场不判胜').toBeNull()
    /**
     * ④ **画面与引擎同一份口径**：它的机群也要画出来（改前 `foeDroneWings` 只遍历编成条目
     * ⇒ 复活的战列巡洋舰会放飞重袭机**打人却看不见**）。
     */
    const arcs = battleArcsFor(state, ctx, { battle, anomaly: CARD, leaderShipId: state.shipId })!
    expect(
      arcs.foeDrones?.some((d) => d.tag === supTag && d.count > 0) ?? false,
      '支援舰的机群进视图（否则无人机打人却没有画面）',
    ).toBe(true)
    // ⑤ 把它打沉 ⇒ 立刻判胜（判胜判据与开火/选靶同一份参战列表）
    battle.units[supTag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 2_000)
    expect(battle.ended, '支援舰沉了才判胜').toBe('me')
  })

  /**
   * **清波判据**（`advanceBattleFor` 的转场分支）：本波**编成**全灭、但复活出来的支援舰还活着
   * ⇒ 不许记"本波已全灭"、不许刷下一波（否则两份编队同时在打）。改动前这里会直接换波。
   * 真卡 `ink-flagship` 的母舰在**末波**（走不到这条判据）⇒ 本条用合成两波卡把召唤者放在第 1 波。
   */
  it('**清波判据（2026-09-27 报障）**：本波编成全灭但支援舰还在 ⇒ 不换波、也不记"已全灭"', () => {
    const ctx: SimContext = makeTestCtx({
      quietEvents: true,
      ships: [ship('sup-bed', { maxSpeedMps: 1, shieldHp: 900_000, armorHp: 900_000, hullHp: 900_000 })],
      anomalies: [TWO_WAVE],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const uid = addShipToFleet(state, 'sup-bed')
    state.shipId = uid
    const w0 = activeFoeSpecsOf(TWO_WAVE, ctx.balance.battle, 0)
    const battle = createBattleState(createPlayerSpec(state, ctx, uid)!, w0, 0, 5_000)
    /** 白盒：`createBattleState` 不写 `waveIdx`（首波由调用方口径定）⇒ 显式落 0，好断言"没换波" */
    battle.waveIdx = 0
    const escort = w0.find((s) => s.foeReviveEscort === undefined)!
    const mother = w0.find((s) => s.foeReviveEscort !== undefined)!
    // 白盒：打掉僚舰 ⇒ 61 秒后支援舰入场
    battle.units[escort.tag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 61_000, TWO_WAVE.id)
    expect(battle.foeReviveCount, '到点召唤').toBe(1)
    const supTag = `sup1-${escort.tag}`
    expect(battle.units[supTag]).toBeDefined()
    // 再打掉召唤者 ⇒ 本波**编成**全灭（场上只剩复活出来的那艘支援舰）
    battle.units[mother.tag]!.hp = { s: 0, a: 0, h: 0 }
    const logs0 = state.logs.length
    runFor(state, ctx, battle, 12_000, TWO_WAVE.id)
    expect(battle.waveIdx, '本波还有支援舰在场 ⇒ 不换波').toBe(0)
    expect(Object.keys(battle.units).some((t) => t.startsWith('w1-')), '第 2 波没被刷出来').toBe(false)
    expect(state.logs.slice(logs0).some((l) => l.text.includes('已全灭')), '也不该记"本波已全灭"').toBe(false)
    // 打掉支援舰 ⇒ 本波**真**清空 ⇒ 走完转场窗口后换波
    battle.units[supTag]!.hp = { s: 0, a: 0, h: 0 }
    runFor(state, ctx, battle, 12_000, TWO_WAVE.id)
    expect(battle.waveIdx, '支援舰沉了才换波').toBe(1)
  })
})
