/**
 * **护盾充能力场装置**（2026-09-20 船长：「新增高槽装备，护盾充能力场装置 MK2，为所有我方舰船恢复
 * 10% 护盾，冷却时间 10 秒，MK3 的冷却时间缩短至 8 秒。有叠加惩罚」）。
 *
 * 追问三答（本文件的判据来源）：
 * - 「有叠加惩罚」= **同舰多件**才算叠加（多艘船各带一件 ⇒ **各自独立、可叠加**）；
 * - 叠加强度 = **现有 EVE 曲线 `stackWeight`**；
 * - 「10%」= 按**每艘被治疗舰自己**的满盾算。
 *
 * 本文件钉六件事：
 * (a) **冷却按件自带**（MK2 = 10 秒 / MK3 = 8 秒）——与中槽「护盾充能装置」的固定 30 秒是两套；
 * (b) **受益方是全队**（不是只本舰）——与 `pulseShieldChargeFor` 的关键区别；
 * (c) **同舰多件按 EVE 曲线收敛**（"有叠加惩罚"）；
 * (d) **多艘船各带一件 ⇒ 各自独立、可叠加**（两条账本各跳各的）；
 * (e) **能从 0 盾把盾点起来**（与护盾充能装置同款：被动回充对 0 盾无效）；
 * (f) **随档往返**（`shieldFieldBy` 进 `BATTLE_FIELDS`，重载不白赚一跳）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { stackWeight } from '../src/equipment'
import { advanceBattleFor, preloadShieldFieldFor, shieldFieldOf, startFleetBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { anomaly, makeTestCtx, moduleDef } from './helpers'
import type { SimContext } from '../src/types'

/** 合成力场件（本文件不依赖真数据；数值与真件同档：10% / 10 秒或 8 秒） */
const field = (id: string, sec: number, pct = 0.1): ReturnType<typeof moduleDef> =>
  moduleDef(id, 'shield-field', 0, { shieldFieldPct: pct, shieldFieldMs: sec * 1000, cpuUse: 55 })

/** 纯盾世界：两艘「护盾驳船」（护盾 1000 / 甲与结构极厚 ⇒ 战斗能跑满、只观察护盾层） */
function world(opts: { mods: Array<{ id: string; sec: number }>; main: string[]; ally?: string[] }): {
  state: GameState
  ctx: SimContext
  main: string
  ally: string
} {
  const ids = new Set([...opts.main, ...(opts.ally ?? [])])
  const mods = opts.mods.filter((m) => ids.has(m.id)).map((m) => field(m.id, m.sec))
  const hull = {
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
    cpu: 300,
    droneBayM3: 0,
    description: '测试用护盾驳船',
  }
  const ctx = makeTestCtx({
    modules: mods,
    ships: [hull as never],
    anomalies: [
      {
        ...anomaly('ano-field', 'galaxy-hub', { threat: 20, tactic: 'orbit' }),
        foeShotDmg: 1, // 本文件只看护盾层的进出
        foeHpOverride: 100_000_000, // 打不死的沙包 ⇒ 战斗跑满观察窗口
      },
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const main = addShipToFleet(state, 'hull-shieldbarge')
  const ally = addShipToFleet(state, 'hull-shieldbarge')
  state.shipId = main
  state.fleet[main]!.fitted = { high: [...opts.main], mid: [], low: [] }
  state.fleet[ally]!.fitted = { high: [...(opts.ally ?? [])], mid: [], low: [] }
  return { state, ctx, main, ally }
}

/**
 * ⚠ **战斗里的 tag 不是舰队 uid**：主控恒为 `'player'`，僚舰才用 uid
 * （`startFleetBattleFor` 的 `myFleet[].tag`；引擎侧 `combat.ts` 用 `find(e => e.shipId === shipId)` 反查）。
 * 本文件一律经这个映射取单位/账本 —— 直接拿 uid 去索引会得到 `undefined`（我第一版就是这么写错的）。
 */
function tagOf(b: BattleState, shipId: string): string {
  return b.myFleet?.find((e) => e.shipId === shipId)?.tag ?? 'player'
}

/** 起一场两舰战斗并推进 `ms`（每拍 100ms） */
function run(state: GameState, ctx: SimContext, ids: string[], ms: number): BattleState {
  const b = startFleetBattleFor(state, ctx, ids, 'ano-field', 0)!
  for (let i = 0; i < Math.round(ms / 100); i++) {
    state.gameMs += 100
    advanceBattleFor(state, ctx, b, tagOf(b, ids[0]!), 'ano-field')
    if (b.ended) break
  }
  return b
}

describe('护盾充能力场装置：口径（装配快照）', () => {
  it('**冷却按件自带**：MK2 = 10 秒 / MK3 = 8 秒（不是固定 30 秒）', () => {
    const { state, ctx, main } = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2'] })
    const f = shieldFieldOf(state, ctx, main)
    expect(f.pct).toBeCloseTo(0.1, 10)
    expect(f.ms).toBe(10_000)
    const led = preloadShieldFieldFor(state, ctx, main)!
    expect(led.msPerPulse).toBe(10_000)
    expect(led.pctPerPulse).toBeCloseTo(0.1, 10)

    const w3 = world({ mods: [{ id: 'f3', sec: 8 }], main: ['f3'] })
    expect(shieldFieldOf(w3.state, w3.ctx, w3.main).ms).toBe(8_000)
    expect(preloadShieldFieldFor(w3.state, w3.ctx, w3.main)!.msPerPulse).toBe(8_000)
  })

  it('没装该族件 ⇒ 值为 0、快照为 null（零行为变化）', () => {
    const { state, ctx, main } = world({ mods: [{ id: 'f2', sec: 10 }], main: [] })
    expect(shieldFieldOf(state, ctx, main)).toEqual({ pct: 0, ms: 0 })
    expect(preloadShieldFieldFor(state, ctx, main)).toBeNull()
  })

  it('**同舰多件按 EVE 曲线收敛**（"有叠加惩罚"）：不是简单相加', () => {
    const one = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2'] })
    expect(shieldFieldOf(one.state, one.ctx, one.main).pct).toBeCloseTo(0.1, 10)
    const two = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2', 'f2'] })
    const pct2 = shieldFieldOf(two.state, two.ctx, two.main).pct
    // 第二件按 87% 权重计入（与全仓同一把尺，不写死 0.87）
    expect(pct2).toBeCloseTo(0.1 * (1 + stackWeight(2)), 10)
    expect(pct2).toBeGreaterThan(0.1)
    expect(pct2).toBeLessThan(0.2)
  })

  it('同舰 MK2 ＋ MK3 ⇒ **同族同池：也衰减**（不是各算一件、不能靠换档绕过惩罚）', () => {
    const mix = world({
      mods: [
        { id: 'f2', sec: 10 },
        { id: 'f3', sec: 8 },
      ],
      main: ['f2', 'f3'],
    })
    const f = shieldFieldOf(mix.state, mix.ctx, mix.main)
    expect(f.ms).toBe(8_000) // 冷却仍取最短那一档
    /**
     * ⚠ **2026-09-21 船长改判**（原话：「**护盾充能立场不是多件衰减吗**」⇒ 落成「**同族合并计数：
     * MK2+MK3 也衰减**」）：收敛池键由**件 id** 改为**同族**（`stackingOf` 的 `'shield-field'`）
     * ⇒ 混装与"同型两件"**逐字同额**。
     *
     * 改前（按 id 计数）：两件各拿满权 ⇒ **0.20**（比同型两件的 18.69% 还高）——"换一档装"就成了
     * 绕开叠加惩罚的最优解，与"有叠加惩罚"自相矛盾。
     */
    expect(f.pct).toBeCloseTo(0.1 * (1 + stackWeight(2)), 10)
    // 与"两件同型"逐字同额（同池的直接证据）
    const same = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2', 'f2'] })
    expect(f.pct).toBeCloseTo(shieldFieldOf(same.state, same.ctx, same.main).pct, 10)
    expect(f.pct).toBeLessThan(0.2)
  })

  it('同舰三件（MK2 ×2 ＋ MK3）⇒ 按同池第 3 件折减（不是 2 件 + 1 件满额）', () => {
    const { state, ctx, main } = world({
      mods: [
        { id: 'f2', sec: 10 },
        { id: 'f3', sec: 8 },
      ],
      main: ['f2', 'f2', 'f3'],
    })
    const f = shieldFieldOf(state, ctx, main)
    expect(f.pct).toBeCloseTo(0.1 * (1 + stackWeight(2) + stackWeight(3)), 10)
    expect(f.ms).toBe(8_000)
  })
})

describe('护盾充能力场装置：战斗行为', () => {
  it('**受益方是全队**：装上它的船一跳，两艘船都回盾（不只是本舰）', () => {
    const { state, ctx, main, ally } = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2'] })
    const b = run(state, ctx, [main, ally], 20_000) // 足够走完两跳（10 秒 / 20 秒）
    const tm = tagOf(b, main)
    const ta = tagOf(b, ally)
    expect(b.shieldFieldBy?.[tm]?.pulses ?? 0).toBeGreaterThanOrEqual(1)
    // 僚舰**没装**该件，却也回了盾 ⇒ 全队受益（这是与中槽「护盾充能装置」的关键区别）
    expect(b.units[tm]!.hp.s).toBeGreaterThan(900)
    expect(b.units[ta]!.hp.s).toBeGreaterThan(900)
  })

  it('**能从 0 盾点起来**（被动回充对 0 盾恒为 0，只有脉冲件能救）', () => {
    const { state, ctx, main, ally } = world({ mods: [{ id: 'f3', sec: 8 }], main: ['f3'] })
    const b = startFleetBattleFor(state, ctx, [main, ally], 'ano-field', 0)!
    const tm = tagOf(b, main)
    const ta = tagOf(b, ally)
    b.units[tm]!.hp.s = 0
    b.units[ta]!.hp.s = 0
    for (let i = 0; i < 100; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, tm, 'ano-field')
      if (b.ended) break
    }
    // 8 秒后首跳：两艘都从 0 被点起来
    expect(b.units[tm]!.hp.s).toBeGreaterThan(0)
    expect(b.units[ta]!.hp.s).toBeGreaterThan(0)
  })

  it('**多艘船各带一件 ⇒ 各自独立、可叠加**（两条账本各跳各的）', () => {
    const { state, ctx, main, ally } = world({
      mods: [
        { id: 'f2', sec: 10 },
        { id: 'f3', sec: 8 },
      ],
      main: ['f2'],
      ally: ['f3'],
    })
    const b = startFleetBattleFor(state, ctx, [main, ally], 'ano-field', 0)!
    const tm = tagOf(b, main)
    const ta = tagOf(b, ally)
    // ⚠ 先把两舰的盾**打到很低**再看恢复：满盾时补盾会被 `Math.min(满盾, …)` 夹住 ⇒ 看不出"可叠加"
    b.units[tm]!.hp.s = 100
    b.units[ta]!.hp.s = 100
    for (let i = 0; i < 120; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, tm, 'ano-field')
      if (b.ended) break
    }
    // 两条账本都在（各自独立）
    expect(b.shieldFieldBy?.[tm]).toBeDefined()
    expect(b.shieldFieldBy?.[ta]).toBeDefined()
    // 僚舰那条 8 秒一跳 ⇒ 12 秒内至少 1 跳；主控 10 秒一跳 ⇒ 也至少 1 跳
    expect(b.shieldFieldBy![ta]!.pulses).toBeGreaterThanOrEqual(1)
    expect(b.shieldFieldBy![tm]!.pulses).toBeGreaterThanOrEqual(1)
    /**
     * ⚠ **单舰装一件**时 12 秒内只跳 1 次（主控 10 秒那条；僚舰 8 秒那条对它也有效）
     * ⇒ 两艘船都拿到**两份**来源的补盾（各 10%）⇒ 从 100 起步至少被抬过 20%。
     * 这条就是"多舰独立可叠加"的判据（而不是"超过满盾"——盾永远被夹在满盾）。
     */
    expect(b.units[tm]!.hp.s).toBeGreaterThan(100 + 1_000 * 0.2 - 1)
  })

  it('**施放者阵亡 ⇒ 该力场停跳**（人没了装置就停，与另两套同款）', () => {
    // ⚠ 判据看**施放者自己**的盾：三层被打穿后 `isAlive` 为假 ⇒ 力场不再跳，
    //   而被动回充对"甲/结构已穿"的单位也停（引擎里那条 `(hp.a <= 0 && hp.h <= 0) => continue`）
    //   ⇒ 它的盾应当停在 0，不会被任何来源抬起来。
    const { state, ctx, main, ally } = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2'] })
    const b = startFleetBattleFor(state, ctx, [main, ally], 'ano-field', 0)!
    const tm = tagOf(b, main)
    const m = b.units[tm]!
    m.hp.s = 0
    m.hp.a = 0
    m.hp.h = 0
    for (let i = 0; i < 300; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, b, tm, 'ano-field')
      if (b.ended) break
    }
    expect(m.hp.s).toBe(0)
  })
})

describe('护盾充能力场装置：随档往返', () => {
  it('`shieldFieldBy` 往返（重载不重置计时、不白赚一跳）', () => {
    const { state, ctx, main, ally } = world({ mods: [{ id: 'f2', sec: 10 }], main: ['f2'] })
    const b = run(state, ctx, [main, ally], 11_000)
    const tm = tagOf(b, main)
    expect(b.shieldFieldBy?.[tm]?.pulses).toBeGreaterThanOrEqual(1)
    expect(b.shieldFieldBy![tm]!.nextPulseAtMs).toBeDefined()
    // 挂进一场可持久化的战斗（远征路径）再序列化
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = 'ano-field'
    state.expedition.battle = b
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.expedition.battle
    expect(back?.shieldFieldBy?.[tm]?.pulses).toBe(b.shieldFieldBy![tm]!.pulses)
    expect(back?.shieldFieldBy?.[tm]?.nextPulseAtMs).toBe(b.shieldFieldBy![tm]!.nextPulseAtMs)
    expect(back?.shieldFieldBy?.[tm]?.msPerPulse).toBe(10_000)
  })
})
