/**
 * **R 族势力件「PD激光」（激光近防炮）**（**船长 2026-10-02 令**，原话照抄四句 ＋ 两条裁定）：
 *
 * > ① 「**在添加一个激光的近防炮给R族，叫PD激光，射程3000，攻击速度1.8秒，DPS和现在的近防炮一样，
 * >    CPU占用多20%**」
 * > ② 「**是势力掉落装备，和上一件三叉戟光束炮一起进残骸池**」
 * > ③ （我指出"射程 3000 与防空契约上限 2500 冲突"后）「**甲**」⇒ 契约上限抬到 3,000
 * > ④ （我指出"现役近防炮有 MK1/MK2/MK3 三档"后）「**基线取 MK3**」
 * > ⑤ 「**因为必中，CPU消耗再提高20%**」
 *
 * 数值账：基线 MK3（单发 17 · 装载 1.3s ⇒ 名义 DPS 13.08 · CPU 44 · 弹药 56）
 * ⇒ 本件 1.8s ＋ 同 DPS ⇒ 单发 **24**（`dmgMult` 4.0）⇒ 名义 DPS **13.33**（MK3 的 1.02 倍，四舍五入必然）；
 * CPU **63** = 44 × 1.2 × 1.2；弹药 **40**（同交战时长 ≈72s）；射程 **3,000**；**必中**（`slot: 'laser'` ⇒ beam）。
 *
 * 本用例锁四层：① 参数 ② 产出面（残骸池第三件 ＋ 市场只收不卖 ＋ 图鉴登记）
 * ③ **防空契约**（射程上限 3,000 的裁决落地 ＋ 属性值 = 2）④ 建档（必中 / 打机群 / 零行为变化）。
 */
import { describe, expect, it } from 'vitest'
import { MODULES, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'

const ctx = buildSimContext()
const mod = (id: string) => MODULES.find((m) => m.id === id)

describe('PD激光：参数 = 船长令', () => {
  it('① 射程 3,000 · 装填 1.8s · DPS ≈ 近防炮 MK3 · CPU = 基线 ×1.2×1.2', () => {
    const m = mod('mod-lair-pd-r')
    expect(m, '件必须在册').toBeTruthy()
    expect(m!.name).toBe('PD激光')
    expect(m!.maxRangeM, '船长令「射程3000」').toBe(3_000)
    expect(m!.reloadMs, '船长令「攻击速度1.8秒」').toBe(1_800)
    expect(m!.antiDrone, '防空属性（契约基准值 = 对无人机伤害 ×2）').toBe(2)
    expect(m!.ammoPerEngagement, '弹药 40 发（与 MK3 同交战时长）').toBe(40)
    /** **名义 DPS 对齐 MK3**（面板口径 = 单发 ÷ 装填；单发由 `dmgMult` 折算、引擎取整） */
    const mk3 = mod('mod-pd-e-3')!
    const dps = (mm: typeof m) => (mm!.dmgMult! * 6) / (mm!.reloadMs! / 1000) // 6 = 近防炮族的"单发/系数"基准（MK1 10/1.65≈6.06 · MK2 16/2.65≈6.04 · MK3 17/2.85≈5.96）
    const dpsMk3 = (mk3.dmgMult! * 6) / (mk3.reloadMs! / 1000)
    expect(dps(m), `本件名义 DPS 应≈MK3（实测 ${dps(m).toFixed(2)} vs ${dpsMk3.toFixed(2)}）`).toBeCloseTo(dpsMk3, 0)
    expect(Math.abs(dps(m) - dpsMk3) / dpsMk3, '偏差 <3%（单发取整所致）').toBeLessThan(0.03)
    /** **CPU：基线 +20%，再因必中 +20%**（船长第 ①/⑤ 句） */
    expect(m!.cpuUse, 'CPU = 44 × 1.2 × 1.2 = 63.36 → 63').toBe(Math.round(mk3.cpuUse! * 1.2 * 1.2))
    expect(m!.cpuUse).toBe(63)
    /** **必中**：`slot: 'laser'` ⇒ 引擎建出 beam（与全仓激光同口径） */
    expect(m!.slot).toBe('laser')
    expect(m!.hitRate).toBe(1)
    console.log(
      `  [读数] PD激光：射程 ${m!.maxRangeM}m · 装填 ${m!.reloadMs}ms · 单发 ${m!.dmgMult! * 6}（MK3 17）` +
        ` ⇒ 名义 DPS ${dps(m).toFixed(2)}（MK3 ${dpsMk3.toFixed(2)}，比值 ${(dps(m) / dpsMk3).toFixed(3)}）·` +
        ` CPU ${m!.cpuUse}（MK3 ${mk3.cpuUse}，×${(m!.cpuUse! / mk3.cpuUse!).toFixed(3)}）· 弹药 ${m!.ammoPerEngagement}`,
    )
  })

  it('② 产出面：R 族残骸池第四件 ＋ 市场只收不卖 ＋ 图鉴登记（与三叉戟同链）', () => {
    expect(FOE_LAIR_GEAR.R, '稀有残骸高级箱专属池应含本件').toContain('mod-lair-pd-r')
    expect(FOE_LAIR_GEAR.R!.length, 'R 族现在四件').toBe(4)
    expect(mod('mod-lair-pd-r')!.unreleased, '势力件是正式产出（不得标 unreleased）').toBeUndefined()
  })
})

describe('PD激光：防空契约（船长裁决「甲」：上限 2,500 → 3,000）', () => {
  it('③ 它是"能打机群"的那类武器，且属性值 = 契约基准 2；射程在抬升后的上限内', () => {
    const m = mod('mod-lair-pd-r')!
    const pdMax = 3_000 // ⚠ 与 `tools/content-check.ts` 的「机群与防空契约 ①」同步（船长 2026-10-02 裁决甲）
    expect(m.antiDrone, '必需带防空属性').toBeGreaterThan(0)
    expect(m.antiDrone).toBe(2)
    expect(m.maxRangeM!, `射程 ${m.maxRangeM}m 应在契约上限 ${pdMax}m 内`).toBeLessThanOrEqual(pdMax)
    /** 三档动能近防炮**未被动过**（射程仍是 2,500 —— 契约只抬上限、不动既有件） */
    for (const id of ['mod-pd-e', 'mod-pd-e-2', 'mod-pd-e-3']) {
      expect(mod(id)!.maxRangeM, `${id} 射程不应被本批改动`).toBe(2_500)
    }
    console.log(`  [读数] 防空件族：PD激光 ${m.maxRangeM}m · 三档动能近防炮仍 2500m（契约上限现为 ${pdMax}m）`)
  })
})

describe('PD激光：建档（必中 + 打机群 + 零行为变化）', () => {
  it('④ 装上的船 ⇒ 出 beam 武器（必中）＋ `canHitDrones` ＋ 对机群 ×2；不装的船不受影响', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const id = addShipToFleet(state, 'sh-thresher')
    state.shipId = id
    state.moduleBay['mod-lair-pd-r'] = 1
    state.fleet[id]!.fitted = { high: ['mod-lair-pd-r'], mid: [], low: [] }
    const spec = createPlayerSpec(state, ctx, id)!
    const pd = spec.weapons.find((w) => w.label.includes('PD激光'))
    expect(pd, '建档应带上这门武器').toBeTruthy()
    expect(pd!.kind, '激光 ⇒ beam（开火必中、不掷命中骰）').toBe('beam')
    expect(pd!.fixedType).toBe('plasma')
    expect(pd!.canHitDrones, '防空属性 ⇒ 能筛到敌方机群').toBe(true)
    expect(pd!.antiDroneMul, '对机群伤害 ×2（对舰伤害不受影响）').toBe(2)
    expect(pd!.reloadMs).toBe(1_800)
    expect(pd!.maxRangeM).toBe(3_000)
    // 对照：换回动能近防炮 MK3 ⇒ 不是 beam（掷命中），防空属性照旧
    state.fleet[id]!.fitted = { high: ['mod-pd-e-3'], mid: [], low: [] }
    state.moduleBay['mod-pd-e-3'] = 1
    const spec2 = createPlayerSpec(state, ctx, id)!
    const kin = spec2.weapons.find((w) => w.label.includes('近防炮'))!
    expect(kin.kind, '动能近防炮是掷命中（gun）').toBe('gun')
    expect(kin.canHitDrones, '它同样带防空属性').toBe(true)
    console.log(
      `  [读数] 建档：PD激光 kind=${pd!.kind}（必中）· 对机群 ×${pd!.antiDroneMul} · ${pd!.maxRangeM}m/${pd!.reloadMs}ms` +
        `；对照 近防炮 MK3 kind=${kin.kind}（掷命中）`,
    )
  })
})
