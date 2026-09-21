/**
 * **护盾回充改判 + 护盾充能装置**（船长 2026-09-14 两条）：
 * ① 「**改成按当前盾比例，这样护盾被击穿后应该是 0 回复对吧？**」＋「**不留，破盾后 0 回复**」
 *    ⇒ 被动回充由「满盾 × 2%/秒」改为「**当前盾** × 2%/秒」（指数式）：回满时间 = ln(满/当前) ÷ 费率，
 *    **盾归零后回充恒为 0**（本场不再起）。
 * ② 「**但是添加一个中槽装备，护盾充能装置**」＋「和船体修理装置类似。**每 30 秒恢复自身护盾最大值
 *    一定比例的护盾量**。CPU消耗较多」⇒ 中槽脉冲件，**破盾后唯一能把盾点起来的路径**。
 *
 * 本文件钉四件事：
 * (a) 被动回充**按当前盾**（指数，非恒定）；盾 = 0 ⇒ **回充 0**（无装置时永久为 0）；
 * (b) 充能装置**每 30 秒一跳**、每跳恢复**满盾 × pct**（12% / 20% / 32%），能把 0 盾点起来；
 * (c) 同型多件按 EVE 曲线**收敛**（不是简单相加）；
 * (d) `battle.shieldCharge` 随档往返（重载不白赚一跳）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { stackWeight } from '../src/equipment'
import { addWare } from '../src/inventory'
import { advanceBattleFor, SHIELD_PULSE_MS, SHIELD_REGEN_FLOOR_PCT, shieldPulsePctOf, startBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { anomaly, makeTestCtx, moduleDef } from './helpers'
import type { SimContext } from '../src/types'

/** 合成充能装置（本文件不依赖真数据；数值与真件同档） */
const chg = (id: string, pct: number): ReturnType<typeof moduleDef> =>
  moduleDef(id, 'shield', 0, { shieldPulsePct: pct, cpuUse: 25 })

/** 纯盾测试件：护盾 1000 / 甲与结构极厚（**本文件只观察护盾层**：厚甲壳保证战斗能跑满不被打沉） */
function world(opts: { mods?: Array<{ id: string; pct: number }>; mid?: string[] } = {}): {
  state: GameState
  ctx: SimContext
  uid: string
} {
  const mods = (opts.mods ?? []).map((m) => chg(m.id, m.pct))
  const ctx = makeTestCtx({
    modules: mods,
    ships: [
      {
        id: 'hull-shieldbarge',
        name: '护盾驳船',
        tier: 1,
        role: 'industrial',
        slots: { high: 2, mid: 4, low: 2 },
        cargoM3: 100,
        cycleSeconds: 12,
        oreUnitsPerCycle: 1,
        priceIsk: 0,
        agility: 0.4,
        shieldHp: 1_000,
        armorHp: 100_000,
        hullHp: 100_000,
        evasion: 0,
        hitBonus: 0,
        maxSpeedMps: 0,
        signatureM: 80,
        scanResMm: 500,
        cpu: 200,
        droneBayM3: 0,
        description: '测试用护盾驳船',
      } as never,
    ],
    anomalies: [
      {
        ...anomaly('ano-chg', 'galaxy-hub', { threat: 20, tactic: 'orbit' }),
        // 单发压到 1 点：本文件只关心护盾层的进出，不关心战果
        foeShotDmg: 1,
        foeHpOverride: 100_000, // 打不死的沙包（保证战斗跑满观察窗口）
      },
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const uid = addShipToFleet(state, 'hull-shieldbarge')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: opts.mid ?? [], low: [] }
  return { state, ctx, uid }
}

/** 开一场并推进 `ms`（每拍 100ms；返回推进后的 battle） */
function run(state: GameState, ctx: SimContext, uid: string, ms: number): BattleState {
  const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
  for (let i = 0; i < Math.round(ms / 100); i++) {
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, 'ano-chg')
    if (b.ended) break
  }
  return b
}

describe('护盾被动回充：按当前盾比例（船长 2026-09-14 改判）', () => {
  it('**盾归零 ⇒ 回充恒为 0**（无装置时本场不再起）', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    me.hp.s = 0 // 手工打空护盾
    for (let i = 0; i < 100; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, 'ano-chg')
      if (b.ended) break
    }
    expect(me.hp.s).toBe(0) // 破盾后**一滴都不回**（旧口径会把满盾 ×2%/秒 一点点长回来）
  })

  it('**按当前盾比例 = 指数式，而不是恒定回充**', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    const k = ctx.balance.battle.shieldRegenPerSec
    expect(k).toBeGreaterThan(0)
    me.hp.s = 500 // 半盾
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, 'ano-chg')
    const after = me.hp.s
    // 一跳（100ms）的回充量 ≈ 当前盾 × k × 0.1（**不是** 满盾 × k × 0.1）
    expect(after).toBeCloseTo(500 + 500 * k * 0.1, 3)
    // 且**永远不超过满盾**
    expect(after).toBeLessThanOrEqual(1000)
  })
})

describe('护盾回充的**速度下限**（2026-09-20 船长追加）', () => {
  /**
   * 船长原话：「**舰船护盾的恢复速度下限改为1%。但是当护盾被击穿时，依旧是0%**」
   * → 追问口径后补：「**满盾依旧是2%，当盾量接近0的时候是1%**」。
   *
   * 口径 = 回充速率 `max(当前盾 × 2%/秒, 满盾 × 1%/秒)`：
   * - **满盾时 2%**（下限不介入）；两条线的交点恰在**半盾（50%）**：`50%×2% = 1%`；
   * - **低于半盾 ⇒ 下限接管**，回充量不再随盾量继续缩水（治"被打残后本场盾就废了"）；
   * - **盾 = 0 ⇒ 仍是 0**（"破盾后 0 回复"那条裁定不变，本组第 2 条用例专钉）。
   */
  it('**低于半盾 ⇒ 下限接管**：回充按满盾的 1%/秒，不再随盾量缩水', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    const k = ctx.balance.battle.shieldRegenPerSec
    // 盾 100（满盾 1000）：纯指数式只回 100×k×0.1 = 0.2 点；下限给 1000×1%×0.1 = 1.0 点
    me.hp.s = 100
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, 'ano-chg')
    expect(SHIELD_REGEN_FLOOR_PCT).toBe(0.01)
    expect(me.hp.s).toBeCloseTo(100 + 1_000 * SHIELD_REGEN_FLOOR_PCT * 0.1, 3)
    // 且**明显大于**旧口径（证明下限真的在起作用，不是恰好相等）
    expect(me.hp.s).toBeGreaterThan(100 + 100 * k * 0.1 + 0.5)
  })

  it('**半盾是两段的交点**：50% 处两条线相等（此处仍是"按当前盾"）', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    const k = ctx.balance.battle.shieldRegenPerSec
    me.hp.s = 500
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, 'ano-chg')
    // 交点：当前盾 × k === 满盾 × 下限 ⇒ 两套算法同值
    expect(500 * k).toBeCloseTo(1_000 * SHIELD_REGEN_FLOOR_PCT, 10)
    expect(me.hp.s).toBeCloseTo(500 + 500 * k * 0.1, 3)
  })

  it('**盾被击穿 ⇒ 依旧是 0%**（下限**不**把破盾救回来）', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    me.hp.s = 0
    for (let i = 0; i < 100; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, 'ano-chg')
      if (b.ended) break
    }
    expect(me.hp.s).toBe(0)
  })

  it('下限不越过满盾上限（满盾前那一跳被夹住）', () => {
    const { state, ctx, uid } = world()
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    me.hp.s = 999
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, uid, 'ano-chg')
    expect(me.hp.s).toBeLessThanOrEqual(1_000)
  })
})

describe('护盾充能装置（中槽 · 每 30 秒脉冲 · 满盾的一个比例）', () => {
  it('**每 30 秒一跳**：把打空的护盾按"满盾 × 比例"点回来（MK1 = 12%）', () => {
    const { state, ctx, uid } = world({ mods: [{ id: 'mod-chg-1', pct: 0.12 }], mid: ['mod-chg-1'] })
    expect(shieldPulsePctOf(state, ctx, uid)).toBeCloseTo(0.12, 10)
    // 手工把盾打空，推进到首跳之前：仍为 0（被动回充对 0 盾无效）
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    me.hp.s = 0
    for (let i = 0; i < 100; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, 'ano-chg')
      if (b.ended) break
    }
    expect(me.hp.s).toBe(0) // 10 秒时还没跳（30 秒才跳）
    // 推到 30 秒后
    for (let i = 0; i < 250; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, 'ano-chg')
      if (b.ended) break
    }
    expect(b.shieldCharge?.pulses ?? 0).toBeGreaterThanOrEqual(1)
    expect(me.hp.s).toBeGreaterThan(80) // 一跳 12% = 120 点（此后被动回充还在接管）
    // 首跳时刻恒为"开战 + 30 秒"（step = 100ms 的整数倍）——逐型号多路后计时器在**流**上
    expect((b.shieldCharge!.streams[0]!.nextPulseAtMs! - b.startedAtGameMs) % SHIELD_PULSE_MS).toBe(0)
  })

  it('**只作用于主控**：没装装置的船（无 `shieldCharge`）破盾后恒为 0', () => {
    const { state, ctx, uid } = world()
    const b = run(state, ctx, uid, 40_000)
    expect(b.shieldCharge).toBeUndefined()
  })

  it('**同族多件按 EVE 曲线收敛**（不是简单相加；MK1/2/3 混装同池）', () => {
    const { state, ctx, uid } = world({ mods: [{ id: 'mod-chg-1', pct: 0.12 }], mid: ['mod-chg-1', 'mod-chg-1'] })
    const two = shieldPulsePctOf(state, ctx, uid)
    expect(two).toBeGreaterThan(0.12)
    expect(two).toBeLessThan(0.24) // 收敛：第二件按 EVE 曲线权重计入（≈87%，不是 100%）
    expect(two).toBeCloseTo(0.12 * (1 + stackWeight(2)), 10) // 与引擎同一把尺（不写死 0.87）
  })

  it('**档次混装也同池**（MK1 ＋ MK2 按同一条曲线折减，不能靠换档绕过惩罚）', () => {
    const mods = [
      { id: 'mod-chg-1', pct: 0.12 },
      { id: 'mod-chg-2', pct: 0.2 },
    ]
    const mix = world({ mods, mid: ['mod-chg-1', 'mod-chg-2'] })
    const pct = shieldPulsePctOf(mix.state, mix.ctx, mix.uid)
    // 池口径与"单件效果从强到弱排位"无关（本件是折权加算 Σpᵢ·wᵢ，按装配序取第 n 件）
    expect(pct).toBeCloseTo(0.12 + 0.2 * stackWeight(2), 10)
    expect(pct).toBeLessThan(0.32) // 改前按 id 计数 ⇒ 各拿满权 = 0.32（换档即绕过惩罚）
    // 同池的直接证据：与"两件同型 MK2"在**第一件换成 MK1** 时差额恰好是 0.12 − 0.2
    const sameKind = world({ mods, mid: ['mod-chg-2', 'mod-chg-2'] })
    expect(pct).toBeCloseTo(shieldPulsePctOf(sameKind.state, sameKind.ctx, sameKind.uid) - 0.08, 10)
  })

  it('**跳数与比例**：MK3（32%）两跳可把 0 盾拉回过半', () => {
    const { state, ctx, uid } = world({ mods: [{ id: 'mod-chg-3', pct: 0.32 }], mid: ['mod-chg-3'] })
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const me = b.units['player']!
    me.hp.s = 0
    for (let i = 0; i < 650; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, uid, 'ano-chg')
      if (b.ended) break
    }
    expect(b.shieldCharge!.pulses).toBeGreaterThanOrEqual(2)
    expect(me.hp.s).toBeGreaterThan(320) // ≥ 两跳：32% → 后续被动回充再抬一截
  })

  it('**随档**：`shieldCharge` 往返（重载不重置 30 秒计时；**逐型号多路**一并往返）', () => {
    const { state, ctx, uid } = world({
      mods: [
        { id: 'mod-chg-2', pct: 0.2 },
        { id: 'mod-chg-3', pct: 0.32 },
      ],
      mid: ['mod-chg-2', 'mod-chg-3'],
    })
    const b = run(state, ctx, uid, 31_000)
    const before = b.shieldCharge!
    expect(before.streams.map((s) => s.modelId)).toEqual(['mod-chg-2', 'mod-chg-3'])
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ano-chg'
    state.expedition.battle = b
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.expedition.battle
    expect(back?.shieldCharge?.pulses).toBe(before.pulses)
    // 两路各自的型号/比例/间隔/计时器逐字往返
    expect(back?.shieldCharge?.streams.map((s) => [s.modelId, s.pct, s.ms, s.nextPulseAtMs])).toEqual(
      before.streams.map((s) => [s.modelId, s.pct, s.ms, s.nextPulseAtMs]),
    )
  })

  it('**逐型号独立回转**：MK1 与 MK3 各按自己的 30 秒跳、各补各的比例（不再并成一路合计值）', () => {
    /**
     * ⚠ **2026-09-21 船长令**：「哪怕同类型装备，只要是不同型号，就要独立的回转冷却」。
     * 两档间隔相同（都是 30 秒）⇒ 实测表现是"同拍各跳各的"；判据看**两路都在**且各带自己的比例，
     * 而不是一路 `pctPerPulse` 合计值。
     */
    const { state, ctx, uid } = world({
      mods: [
        { id: 'mod-chg-1', pct: 0.12 },
        { id: 'mod-chg-3', pct: 0.32 },
      ],
      mid: ['mod-chg-1', 'mod-chg-3'],
    })
    const b = startBattleFor(state, ctx, uid, 'ano-chg', 0)!
    const streams = b.shieldCharge!.streams
    expect(streams).toHaveLength(2)
    expect(streams[0]!.pct).toBeCloseTo(0.12, 10)
    expect(streams[1]!.pct).toBeCloseTo(0.32 * stackWeight(2), 10) // 第 2 件按全族曲线折减
    // 首跳各自排在"开战 + 自己的间隔"
    for (const s of streams) expect(s.nextPulseAtMs).toBe(b.startedAtGameMs + s.ms)
    // 合计 = 两路之和（读数口径没变，只是调度拆开了）
    expect(shieldPulsePctOf(state, ctx, uid)).toBeCloseTo(streams[0]!.pct + streams[1]!.pct, 10)
  })
})
