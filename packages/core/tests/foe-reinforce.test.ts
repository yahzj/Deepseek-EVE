/**
 * **单波次内增援**（2026-09-11 船长裁决：「**先完成相应的系统机制，不使用。用作后续机制。**」）
 * —— 与「敌突进」（`foeChargeEnabled`）同款的"**已实现 · 未启用**"机制。
 *
 * **机制**：编成条目的 `enterAt` 给三种入场触发（第几秒 / 击毁几个 / 残血到多少）；
 * 带触发的单位**开战不进战场**，`advanceBattleFor` 每拍检查、条件命中才补入（哑火窗口 = 一次装填）。
 * **本文件不依赖任何真实卡使用它**——全部用测试里现造的舰级与卡直接构造。
 *
 * 覆盖：
 * (a) **开关关闭 = 零行为变化**（建档结果逐字一致、战斗中永不入场、无增援日志）；
 * (b) **开关开启**：时间 / 击毁数 / 残损血量 三种触发各自能按时入场 + 坐标触发（多条目一起到）；
 * (c) 距离重开 `foeReinforceReopenFrac` 两个取值都能跑通（0 = 原地；>0 = 向开战距离回拉）；
 * (d) 边界：触发条件全无效 = 按"未写"处理 = 开战即在（不产生"永不入场"）；已入场不重复补入；
 *     旧威胁推导路径（未写 `ships` 的卡）不受影响。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import { addShipToFleet, createInitialState, repairDeprecatedModules } from '../src/index'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceBattleFor, createBattleState, createFoeSpecs, startBattleFor } from '../src/combat'
import type { AnomalyDef, FoeReinforceTrigger, FoeShipDef } from '../src/types'
import { anomaly, galaxy, makeTestCtx } from './helpers'

/** 测试用舰级：普通护卫（数值随意，本文件只关心"入场时机"） */
const RAIDER: FoeShipDef = {
  id: 't-reinforce-raider',
  name: '测试劫掠艇',
  family: 'A',
  hullClassTier: 1,
  speedRatio: 1,
  hp: 120,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 10,
  hitRate: 1,
  reloadMs: 4_000,
  rangeMinM: 1,
  rangeMaxM: 2_000,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
}

/** 造一张"1 艘开战即在 + N 条带触发"的舰级路径卡 */
function cardWith(entries: { count?: number; enterAt?: FoeReinforceTrigger }[]): AnomalyDef {
  return {
    ...anomaly('ano-reinforce', 'galaxy-hub', { threat: 20, tactic: 'brawl' }),
    ships: [{ ship: RAIDER }, ...entries.map((e) => ({ ship: RAIDER, ...e }))],
  }
}

/** 开关可调、可带重开比例的测试世界（带一张自定义舰级路径卡） */
function world(
  opts: { enabled: boolean; reopenFrac?: number; card?: AnomalyDef } = { enabled: false },
): { state: GameState; ctx: SimContext } {
  const ctx: SimContext = makeTestCtx({
    quietEvents: true,
    ...(opts.enabled || opts.reopenFrac !== undefined
      ? {
          balance: {
            ...DEFAULT_BALANCE,
            battle: {
              ...DEFAULT_BALANCE.battle,
              foeReinforceEnabled: opts.enabled,
              ...(opts.reopenFrac !== undefined ? { foeReinforceReopenFrac: opts.reopenFrac } : {}),
            },
          },
        }
      : {}),
    galaxies: [galaxy('galaxy-hub', '母港')],
    anomalies: [opts.card ?? cardWith([{ enterAt: { sec: 5 } }])],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  addShipToFleet(state, 'sandcat2')
  state.shipId = 'sandcat2'
  state.fleet['sandcat2']!.fitted = { high: [], mid: [], low: [] }
  repairDeprecatedModules(state, ctx)
  return { state, ctx }
}

/** 开一场战斗（返回 battle；`foe-0` = 开战即在的普通单位，`w0-foe-1..` = 增援位） */
function startReinforceBattle(
  opts: { enabled: boolean; reopenFrac?: number; card?: AnomalyDef },
): { state: GameState; ctx: SimContext; b: NonNullable<ReturnType<typeof startBattleFor>> } {
  const { state, ctx } = world(opts)
  const b = startBattleFor(state, ctx, state.shipId, 'ano-reinforce', 0)!
  expect(b).toBeTruthy()
  return { state, ctx, b }
}

/** 推进到战斗时钟第 ms 毫秒（step = 100ms 逐拍推，等价实时战斗的时钟推进） */
function advanceToMs(state: GameState, ctx: SimContext, b: GameState['expedition']['battle'], ms: number): void {
  state.gameMs = ms
  advanceBattleFor(state, ctx, b!, state.shipId, 'ano-reinforce')
}

/** 把某个在场单位打成"已击毁"（三层血归零；与既有目标接力用例同款手法） */
function killUnit(b: NonNullable<ReturnType<typeof startBattleFor>>, tag: string): void {
  b.units[tag]!.hp = { s: 0, a: 0, h: 0 }
}

describe('单波次内增援：开关关闭 = 零行为变化（船长裁决：已实现、不启用）', () => {
  it('默认关闭：建档结果与"完全不写 enterAt"逐字一致（带触发的单位照旧开战即在）', () => {
    const ctx = world({ enabled: false }).ctx
    const withAt = createFoeSpecs(cardWith([{ enterAt: { sec: 5 } }]), ctx.balance.battle)
    const without = createFoeSpecs(cardWith([{}]), ctx.balance.battle)
    expect(withAt).toEqual(without) // 逐字段全等（含 foeReinforceAt 一律不写）
    expect(withAt.some((s) => s.foeReinforceAt !== undefined)).toBe(false)
    expect(ctx.balance.battle.foeReinforceEnabled).toBe(false) // 默认值口径
  })

  it('默认关闭：战斗中行为与普通条目**完全等价**（开战即在、无增援日志）', () => {
    const { state, ctx, b } = startReinforceBattle({ enabled: false })
    expect(b.units['foe-0']).toBeDefined()
    // ⚠ 开关关闭时"带 enterAt 的条目"与普通条目**完全等价**——建档期就没有标记，故它**开战就在场**
    // （这是零行为变化的正确含义：不是"永不入场"，而是"enterAt 被彻底忽略"）
    expect(Object.keys(b.units).sort()).toEqual(['foe-0', 'player', 'w0-foe-1'])
    state.gameMs = 300_000
    advanceBattleFor(state, ctx, b, state.shipId, 'ano-reinforce')
    expect(state.logs.some((l) => l.text.includes('增援自远处入场'))).toBe(false)
  })

  it('默认关闭：`createBattleState` 不会漏掉任何单位（编队与改动前一致）', () => {
    const ctx = world({ enabled: false }).ctx
    const bal = ctx.balance.battle
    const me = { tag: 'player', name: '我', side: 'me' as const, hp: { s: 1, a: 1, h: 1 }, weapons: [] } as never
    const foes = createFoeSpecs(cardWith([{ enterAt: { sec: 5 } }]), bal)
    const b = createBattleState(me, foes, 0, 1_000)
    expect(Object.keys(b.units).sort()).toEqual(['foe-0', 'player', 'w0-foe-1'])
  })
})

describe('单波次内增援：开关开启时三种触发都能按时入场', () => {
  it('① 按时间（sec）：未到点不入场，到点即入场（且带哑火窗口 = 一次装填）', () => {
    const { state, ctx, b } = startReinforceBattle({ enabled: true, card: cardWith([{ enterAt: { sec: 5 } }]) })
    expect(b.units['w0-foe-1']).toBeUndefined() // 开战不进战场
    expect(Object.keys(b.units).sort()).toEqual(['foe-0', 'player'])
    advanceToMs(state, ctx, b, 4_900)
    expect(b.units['w0-foe-1']).toBeUndefined() // 4.9s：还没到
    advanceToMs(state, ctx, b, 5_200)
    expect(b.units['w0-foe-1']).toBeDefined() // 5.0s 起：入场
    expect(b.units['w0-foe-1']!.hpMax).toBeDefined() // 血条分母随单位写入（与波次增援同款）
    expect(state.logs.some((l) => l.text.includes('敌方增援自远处入场'))).toBe(true)
  })

  it('② 按击毁数（afterKills）：打死 N 个才来援（本拍即触发，不必等时间）', () => {
    // 编成 = 普通 ×2（foe-0 与 w0-foe-1）+ 带触发 ×1（w0-foe-2）
    const { state, ctx, b } = startReinforceBattle({
      enabled: true,
      card: cardWith([{}, { enterAt: { afterKills: 2 } }]),
    })
    expect(b.units['w0-foe-2']).toBeUndefined()
    killUnit(b, 'foe-0') // 第 1 个人头
    advanceToMs(state, ctx, b, 200)
    expect(b.units['w0-foe-2']).toBeUndefined() // 1 < 2：还不来
    expect(b.ended ?? null).toBeNull() // 场上还有 w0-foe-1 活着 → 战斗继续
    killUnit(b, 'w0-foe-1') // 第 2 个人头
    advanceToMs(state, ctx, b, 400)
    expect(b.units['w0-foe-2']).toBeDefined() // 2 个人头到齐 → 本拍入场（援军顶上）
    expect(b.units['w0-foe-2']!.weapons[0]).toBeGreaterThan(0) // enterReload 哑火窗口
  })

  it('③ 按残损血量（hpBelow）：己方存活剩余总血 ≤ 阈值即入场', () => {
    const { state, ctx, b } = startReinforceBattle({
      enabled: true,
      card: cardWith([{ enterAt: { hpBelow: 0.3 } }]),
    })
    expect(b.units['w0-foe-1']).toBeUndefined()
    // 满血 + 未入场的增援一起构成"编成满血总量"分母（240）——把在场的 foe-0 打到 20 血：
    // 残存比 = 20/240 ≈ 8.3% ≤ 30% → 入场
    b.units['foe-0']!.hp = { s: 4, a: 11, h: 5 }
    advanceToMs(state, ctx, b, 200)
    expect(b.units['w0-foe-1']).toBeDefined()
  })

  it('多条目坐标触发：同一条件命中时一起入场，且各自只入一次', () => {
    const { state, ctx, b } = startReinforceBattle({
      enabled: true,
      card: cardWith([{ count: 2, enterAt: { sec: 3 } }, { enterAt: { sec: 3 } }]),
    })
    expect(b.units['w0-foe-1']).toBeUndefined()
    advanceToMs(state, ctx, b, 3_200)
    const tags = Object.keys(b.units).filter((t) => t.startsWith('w0-foe')).sort()
    expect(tags).toEqual(['w0-foe-1', 'w0-foe-2', 'w0-foe-3']) // 2 艘 + 1 艘
    // 再推一拍：不重复补入
    advanceToMs(state, ctx, b, 3_400)
    expect(Object.keys(b.units).filter((t) => t.startsWith('w0-foe')).length).toBe(3)
  })

  it('触发条件全无效 = 按"未写"处理 = 开战即在（不产生"永不入场"的沉默副作用）', () => {
    const ctx = world({ enabled: true }).ctx
    // 空对象 / 非法值（sec 0、hpBelow 1.5、afterKills 负数）都不算"有效触发"
    for (const at of [{}, { sec: 0 }, { afterKills: -1 }, { hpBelow: 1.5 }] as FoeReinforceTrigger[]) {
      const specs = createFoeSpecs(cardWith([{ enterAt: at }]), ctx.balance.battle)
      expect(specs.map((s) => (s.foeReinforceAt === undefined ? 'in' : 'wait'))).toEqual(['in', 'in'])
    }
    // 对照：有效触发才会被标记为"等待入场"
    const valid = createFoeSpecs(cardWith([{ enterAt: { sec: 5 } }]), ctx.balance.battle)
    expect(valid.map((s) => (s.foeReinforceAt === undefined ? 'in' : 'wait'))).toEqual(['in', 'wait'])
  })
})

describe('单波次内增援：距离重开口径（缺省 0 = 不重开；语义同 waveReopenFrac）', () => {
  it('两个取值都能跑通：0 = 原地入场（继续接近中）；1 = 精确回到开战距离', () => {
    const card = cardWith([{ enterAt: { sec: 2 } }])
    // 缺省（0）：入场不重开距离 → 距离继续按接近期递减
    const flat = startReinforceBattle({ enabled: true, reopenFrac: 0, card })
    const openM = flat.b.distanceM // 开战距离（startBattleFor 已设为 openM）
    expect(openM).toBeGreaterThan(0)
    advanceToMs(flat.state, flat.ctx, flat.b, 2_200)
    expect(flat.b.units['w0-foe-1']).toBeDefined()
    const flatDist = flat.b.distanceM
    expect(flatDist).toBeLessThan(openM) // 原地入场：双方仍在接近

    // 重开 1.0：入场瞬间把距离**拉回开战距离**（同拍 stepBattle 会继续接近，故读数比开战距离略小）
    const reopen = startReinforceBattle({ enabled: true, reopenFrac: 1, card })
    expect(reopen.b.distanceM).toBe(openM) // 同一张卡的同一开战距离
    advanceToMs(reopen.state, reopen.ctx, reopen.b, 2_200)
    expect(reopen.b.units['w0-foe-1']).toBeDefined()
    expect(reopen.b.distanceM).toBeGreaterThan(flatDist) // 回满 ⇒ 比"原地入场"那条更远
    expect(openM - reopen.b.distanceM).toBeLessThan(200) // 且确实被拉回开战距离附近（误差 = 同拍一步接近）
  })

  it('默认值口径：`foeReinforceReopenFrac = 0`、`foeReinforceEnabled = false`（与「敌突进」同款总开关）', () => {
    const b = makeTestCtx().balance.battle
    expect(b.foeReinforceEnabled).toBe(false)
    expect(b.foeReinforceReopenFrac).toBe(0)
    expect(b.foeChargeEnabled).toBe(false) // 同款先例仍在
  })
})

describe('单波次内增援：边界与隔离', () => {
  it('旧威胁推导路径（未写 ships 的卡）不受影响：建档无触发标记、开战即全在场', () => {
    const ctx = world({ enabled: true }).ctx
    const legacy = { ...anomaly('ano-legacy-rf', 'galaxy-hub', { threat: 20, tactic: 'brawl' }), foeHpOverride: 200 }
    const specs = createFoeSpecs(legacy, ctx.balance.battle)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.foeReinforceAt).toBeUndefined()
    const me = { tag: 'player', name: '我', side: 'me' as const, hp: { s: 1, a: 1, h: 1 }, weapons: [] } as never
    expect(Object.keys(createBattleState(me, specs, 0, 1_000).units).sort()).toEqual(['foe-0', 'player'])
  })

  it('未到触发点的增援**不参与判胜**：在场者全灭即胜（增援"来不及赶到"就不来了）', () => {
    const { state, ctx, b } = startReinforceBattle({ enabled: true, card: cardWith([{ enterAt: { sec: 60 } }]) })
    killUnit(b, 'foe-0')
    advanceToMs(state, ctx, b, 1_000)
    expect(b.ended).toBe('me') // 60 秒的增援还在路上 → 战斗已在 1 秒结束
    expect(b.units['w0-foe-1']).toBeUndefined()
  })

  it('读档零迁移：已入场单位由 `battle.units` 反推，推进不会重复补入', () => {
    const { state, ctx, b } = startReinforceBattle({ enabled: true, card: cardWith([{ enterAt: { sec: 2 } }]) })
    advanceToMs(state, ctx, b, 2_200)
    const hpBefore = { ...b.units['w0-foe-1']!.hp }
    const countBefore = Object.keys(b.units).length
    advanceToMs(state, ctx, b, 2_400)
    expect(Object.keys(b.units).length).toBe(countBefore) // 没有第二艘
    expect(b.units['w0-foe-1']!.hpMax).toBeDefined()
    expect(hpBefore).toEqual(expect.objectContaining({ s: expect.any(Number) }))
  })
})
