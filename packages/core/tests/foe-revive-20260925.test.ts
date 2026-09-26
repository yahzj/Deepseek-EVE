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
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, loadSaveFile, serializeSaveFile } from '../src/index'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { activeFoeSpecsOf, advanceBattleFor, baseFoeTag, createBattleState, createPlayerSpec, foeShipTierOf, foeUnitNameOf } from '../src/combat'
import { makeTestCtx, ship } from './helpers'

const base = buildSimContext()
/** 真卡：H 族入侵母舰（`ink-flagship` 第 4 波 = 母舰 ＋ 3 艘僚舰） */
const CARD = base.anomalies.get('ink-flagship')!
/** 第 4 波（母舰所在波；下标 3）的编成 */
const WAVE = 3

/** 世界：我方一艘超厚壳测试船（本用例只查"支援舰怎么入场"，不查战斗平衡）＋ 真旗舰卡 */
function world(): { state: GameState; ctx: SimContext; battle: ReturnType<typeof createBattleState> } {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ships: [ship('revive-bed', { maxSpeedMps: 1, shieldHp: 900_000, armorHp: 900_000, hullHp: 900_000 })],
    anomalies: [CARD],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  /** ⚠ **驾驶船必须是那艘厚壳船**（默认初始船只有 15/10/25 血 ⇒ 5 秒就被打没、战斗即结束） */
  const uid = addShipToFleet(state, 'revive-bed')
  state.shipId = uid
  const specs = activeFoeSpecsOf(CARD, ctx.balance.battle, WAVE)
  const me = createPlayerSpec(state, ctx, state.shipId)!
  const battle = createBattleState(me, specs, 0, 5_000)
  /** 白盒：本场直接打到第 4 波（前 3 波不参与本用例） */
  battle.waveIdx = WAVE
  return { state, ctx, battle }
}

/** 该 tag 的三层血是否为空 */
const deadOf = (battle: ReturnType<typeof createBattleState>, tag: string): boolean => {
  const u = battle.units[tag]
  return !!u && u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0
}

/** 把战斗时钟推 `ms`（按 100ms 切片走真引擎；`state.gameMs` 是全局时钟） */
function runFor(state: GameState, ctx: SimContext, battle: ReturnType<typeof createBattleState>, ms: number): void {
  state.gameMs += ms
  advanceBattleFor(state, ctx, battle, state.shipId, CARD.id)
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
})
