/**
 * D 族「守墓古舰」专属装备（2026-09-10 船长逐件过审；**同日定削**：档位回到「最强敌族、强度略高于 MK3」，
 * 原「可对标异星档、可略强」口径作废——削后立身之本是必中远程炮与三系全能盾，不再靠账面输出）：
 * - D1 陵墓护盾阵列：护盾层三系抗各 **+30%**（缺口复合、0.9 封顶）——全能重盾，代价 = 42 CPU；
 * - D2 守墓者长炮：**基础命中 100%** 的 12 km 点名炮——射速降到攻坚炮台 MK3 的四成、
 *   单发提到 2.02 倍，**总输出 ≈ MK3 的八成（−19.3%：原「保证 DPS −10%」之上再降一成）**，远端衰减更轻；
 * - D3 陵寝装甲层：装甲容量 **+110%**（比装甲增厚板 MK3 的 +80% 还厚），代价 = **战斗速度 −25%**
 *   （多件不叠加、取最重一件；与推进器失稳同口径）与 **42 CPU**（2026-09-10 船长定：装甲容量/抗性件统降 20%，52 → 42）。
 * 三件合起来 = 守墓舰性格：重盾 + 超远程点名 + 走不动的重甲（D 族为敌族池之一，见 FOE_LAIR_GEAR.D）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const SHIP = 'sh-mako' // 灰鲭鲨：高 4 / 中 3 / 低 2，CPU 195——三件同装合法

function makeState(high: string[] = [], mid: string[] = [], low: string[] = []): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: [...high, null, null, null, null].slice(0, 4) as (string | null)[],
    mid: [...mid, null, null, null].slice(0, 3) as (string | null)[],
    low: [...low, null, null].slice(0, 2) as (string | null)[],
  }
  return state
}

const dps = (m: { dmgMult?: number; reloadMs?: number }): number => (m.dmgMult ?? 0) / (m.reloadMs ?? 1)

describe('D 族守墓古舰专属装备（2026-09-10 船长）', () => {
  it('D 族池已配齐三件（逐件过审结果）', () => {
    expect(FOE_LAIR_GEAR.D).toEqual(['mod-lair-shield-d', 'mod-lair-turret-d', 'mod-lair-armor-d'])
    for (const id of FOE_LAIR_GEAR.D) expect(ctx.modules.get(id)).toBeTruthy()
  })

  it('D1 陵墓护盾阵列：护盾三系抗各 +30%（缺口复合）、CPU 42；装甲/结构不受影响', () => {
    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    const withShield = createPlayerSpec(makeState([], ['mod-lair-shield-d']), ctx, SHIP)!
    // 定稿值钉死：三系各 +30%（2026-09-10 船长定削，原 +35%）
    expect(ctx.modules.get('mod-lair-shield-d')!.shieldResistAdd).toEqual({
      kinetic: 0.3,
      explosive: 0.3,
      plasma: 0.3,
    })
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const base = plain.resists.shield?.[t] ?? 0
      const after = withShield.resists.shield?.[t] ?? 0
      // 缺口乘入：new = 1 − (1−base) × (1−0.30)
      expect(after).toBeCloseTo(1 - (1 - base) * 0.7, 6)
      expect(after).toBeGreaterThan(base)
    }
    // 灰鲭鲨基础盾抗只有动能 0.5 → 装后动能 0.65（缺口剩一半再削 30%）、另两系各 0.30
    expect(withShield.resists.shield!.kinetic).toBeCloseTo(0.65, 6)
    expect(withShield.resists.shield!.explosive).toBeCloseTo(0.3, 6)
    expect(withShield.resists.shield!.plasma).toBeCloseTo(0.3, 6)
    // 装甲/结构层不被盾件影响
    expect(withShield.resists.armor).toEqual(plain.resists.armor)
    expect(withShield.resists.hull).toEqual(plain.resists.hull)
    // 重盾代价：CPU 42（比护盾扩展器 MK3 的 40 更重）
    expect(ctx.modules.get('mod-lair-shield-d')!.cpuUse).toBe(42)
    expect(ctx.modules.get('mod-shield-ext-3')!.cpuUse).toBeLessThan(42)
  })

  it('D2 守墓者长炮：射速 −60%、单发 2.02 倍、总输出 ≈ 攻坚炮台 MK3 的八成', () => {
    const d2 = ctx.modules.get('mod-lair-turret-d')!
    const mk3 = ctx.modules.get('mod-turret-kin-3')!
    // 定稿值钉死：单发 10.35（2026-09-10 船长定削，原 11.5）
    expect(d2.dmgMult).toBe(10.35)
    // 射速：装填 ×2.5 → 每秒发数只有四成（即 −60%）
    expect(d2.reloadMs! / mk3.reloadMs!).toBeCloseTo(2.5, 6)
    expect(mk3.reloadMs! / d2.reloadMs!).toBeCloseTo(0.4, 6)
    // 单发：两倍（2.02 倍）
    expect(d2.dmgMult! / mk3.dmgMult!).toBeCloseTo(2.018, 2)
    // 总输出 = −19.3%（船长原定「保证 DPS −10%」，2026-09-10 追加再降一成）
    const ratio = dps(d2) / dps(mk3)
    expect(ratio).toBeGreaterThan(0.8)
    expect(ratio).toBeLessThan(0.82)
    expect(ratio - 1).toBeCloseTo(-0.193, 3)
  })

  it('D2 基础命中 100%、12 km 超远程、远端衰减更轻（0.6 > MK3 的 0.5）', () => {
    const d2 = ctx.modules.get('mod-lair-turret-d')!
    const mk3 = ctx.modules.get('mod-turret-kin-3')!
    expect(d2.hitRate).toBe(1)
    expect(d2.hitRate!).toBeGreaterThan(mk3.hitRate!)
    // 2026-09-11 船长定：窝点专属动能件远端衰减提高到 **0.6**（普通 MK3 一律 0.5）⇒ 专属件的
    //「必中 + 63% 射程 + 远端更准」三条一起成立（当日先统一 0.5 时它一度相对更重，本批修回）。
    expect(mk3.falloff).toBe(0.5)
    expect(d2.falloff!).toBeGreaterThan(mk3.falloff!)
    expect(d2.maxRangeM).toBe(12_000)
    expect(d2.maxRangeM!).toBeGreaterThan(mk3.maxRangeM!)
    // 进战斗：0 技能下条目命中即 100%，射程带 / 装填原样落地
    const state = makeState(['mod-lair-turret-d'])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    const w = spec.weapons.find((x) => x.src === 'turret')!
    expect(w.label).toBe('守墓者长炮')
    expect(w.hitRate).toBe(1)
    expect(w.falloff).toBeCloseTo(0.6, 6)
    expect(w.maxRangeM).toBe(12_000)
    expect(w.minRangeM).toBe(1300)
    expect(w.reloadMs).toBe(7350)
    expect(w.shotsByType?.kinetic).toBeGreaterThan(0)
  })

  it('D3 陵寝装甲层：装甲容量 +110%（相对裸船 ×2.1），盾/结构不变', () => {
    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    const withArmor = createPlayerSpec(makeState([], [], ['mod-lair-armor-d']), ctx, SHIP)!
    expect(ctx.modules.get('mod-lair-armor-d')!.armorHpBonus).toBe(1.1)
    expect(withArmor.hp.a / plain.hp.a).toBeCloseTo(2.1, 6)
    expect(withArmor.hp.s).toBeCloseTo(plain.hp.s, 6)
    expect(withArmor.hp.h).toBeCloseTo(plain.hp.h, 6)
    // 比装甲增厚板 MK3（+80%）更厚
    expect(withArmor.hp.a).toBeGreaterThan(
      createPlayerSpec(makeState([], [], ['mod-armor-plate-3']), ctx, SHIP)!.hp.a,
    )
  })

  it('D3 机动代价：战斗速度 ×0.75；多件不叠加、取最重一件', () => {
    const plain = createPlayerSpec(makeState(), ctx, SHIP)!
    const one = createPlayerSpec(makeState([], [], ['mod-lair-armor-d']), ctx, SHIP)!
    expect(plain.speedMps).toBe(300) // 灰鲭鲨裸速（无技能）
    expect(one.speedMps / plain.speedMps).toBeCloseTo(0.75, 6)
    // 两件：仍是 −25%（重甲不会叠成静止）
    const two = makeState([], [], ['mod-lair-armor-d'])
    two.fleet[two.shipId]!.fitted.low[1] = 'mod-lair-armor-d'
    const twoSpec = createPlayerSpec(two, ctx, two.shipId)!
    expect(twoSpec.speedMps / plain.speedMps).toBeCloseTo(0.75, 6)
    // 与推进器共存：先乘推进加成、再打折（顺序无关，均为乘算）
    const withProp = createPlayerSpec(makeState([], [], ['mod-lair-armor-d', 'mod-prop-1']), ctx, SHIP)!
    const propOnly = createPlayerSpec(makeState([], [], ['mod-prop-1']), ctx, SHIP)!
    expect(withProp.speedMps / propOnly.speedMps).toBeCloseTo(0.75, 6)
  })

  it('D 族三件同装合法：CPU 42 + 62 + 42 = 146 < 灰鲭鲨 195', () => {
    const ids = FOE_LAIR_GEAR.D.map((id) => ctx.modules.get(id)!)
    const total = ids.reduce((s, m) => s + (m.cpuUse ?? 0), 0)
    // 2026-09-10 船长定：陵寝装甲层 CPU 52 → 42（装甲容量/抗性相关件统降 20%），合计 156 → 146
    expect(total).toBe(146)
    const ship = ctx.ships.get(SHIP)!
    expect(total).toBeLessThan(ship.cpu ?? 0)
  })
})
