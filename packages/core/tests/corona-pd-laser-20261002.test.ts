/**
 * **R 族势力件「PD激光」（激光近防炮）**（**船长 2026-10-02 令**，原话照抄四句 ＋ 两条裁定）：
 *
 * > ① 「**在添加一个激光的近防炮给R族，叫PD激光，射程3000，攻击速度1.8秒，DPS和现在的近防炮一样，
 * >    CPU占用多20%**」
 * > ② 「**是势力掉落装备，和上一件三叉戟光束炮一起进残骸池**」
 * > ③ （我指出"射程 3000 与防空契约上限 2500 冲突"后）「**甲**」⇒ 契约上限抬到 3,000
 * > ④ （我指出"现役近防炮有 MK1/MK2/MK3 三档"后）「**基线取 MK3**」
 * > ⑤ 「**因为必中，CPU消耗再提高20%**」
 * > ⑥ 「**单发伤害再+3**」⇒ 面板单发 **24 → 27**（`dmgMult` 4.0 → 4.5）
 *
 * ⚠ **2026-10-02 第 ⑥ 句落码时订正过一次口径**：**光束单发 = 能量弹 9 × `dmgMult`**（`v18b2.test.ts` 明文），
 * 而近防炮是**动能弹 6 × `dmgMult`** ⇒ 两族的 `dmgMult` **不可直接换算**。上一批我按系数 6 折算本件，
 * 报出的"单发 24 · 名义 DPS 13.33 ≈ MK3 13.15（1.014 倍）"**不成立**（拿两个不同弹种比）。
 *
 * 订正后的真账（裸值，不计技能与船加成）：基线 MK3 = 6 × 2.85 = 17.1 ⇒ 单发 **17** · 1.3s · 命中 **0.92**
 * ⇒ **有效 DPS 12.10**；本件（必中，命中按 1）单发 = 9 × `dmgMult` ⇒ 第 ⑥ 句后 **40.5** · 1.8s
 * ⇒ **有效 DPS 22.50 ⇒ 是 MK3 的 1.86 倍**（加码前 20.0 ⇒ 1.65 倍）。
 * "真同 DPS"的解是 `dmgMult` ≈ **2.42**（单发 21.8）；2.42 ＋ 第 ⑥ 句的 +3 ⇒ **2.75**。
 * **按哪个来已按 §5.2 报船长待裁** —— 本用例按第 ⑥ 句字面锁 4.5，并把偏离如实锁住。
 *
 * 本用例锁四层：① 参数 ② 产出面（残骸池第四件 ＋ 市场只收不卖 ＋ 图鉴登记）
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
  it('① 射程 3,000 · 装填 1.8s · 面板单发 27（第 ⑥ 句）· 真实单发 40.5 · CPU = 基线 ×1.2×1.2', () => {
    const m = mod('mod-lair-pd-r')
    expect(m, '件必须在册').toBeTruthy()
    expect(m!.name).toBe('PD激光')
    expect(m!.maxRangeM, '船长令「射程3000」').toBe(3_000)
    expect(m!.reloadMs, '船长令「攻击速度1.8秒」').toBe(1_800)
    expect(m!.antiDrone, '防空属性（契约基准值 = 对无人机伤害 ×2）').toBe(2)
    expect(m!.ammoPerEngagement, '弹药 40 发（与 MK3 同交战时长）').toBe(40)
    /** **面板单发 = 船长第 ⑥ 句的字面**：24（我上批报的那个数）→ **27**（`dmgMult` 4.5） */
    const mk3 = mod('mod-pd-e-3')!
    const PANEL_COEF = 6 // 面板口径：两族共用的"6 基准"（便于跨族排序；**不是**真实弹伤）
    const panelShot = (mm: typeof m) => mm!.dmgMult! * PANEL_COEF
    expect(panelShot(m), '面板单发 27 = 24（上批报值）+3（第 ⑥ 句）').toBe(27)
    expect(m!.dmgMult).toBe(4.5)
    /**
     * ⚠ **真实口径（引擎实际用的）**：光束单发 = **能量弹 9** × `dmgMult`；近防炮 = **动能弹 6** × `dmgMult`。
     * 弹基数不同（9 vs 6）⇒ 跨族的 `dmgMult` 不能换算 —— 这正是上批"同 DPS"报错的地方。
     */
    const AMMO_PLASMA = 9 // ammo-plasma-l（光束用）
    const AMMO_KINETIC = 6 // ammo-kinetic-l（三档近防炮用）
    const realShot = (mm: typeof m, ammo: number) => mm!.dmgMult! * ammo
    expect(realShot(m, AMMO_PLASMA), '真实单发 = 9 × 4.5 = 40.5').toBe(40.5)
    /** 有效 DPS（命中折算：本件必中 = 1；MK3 = 0.92） */
    const effDps = (mm: typeof m, ammo: number) => (realShot(mm, ammo) / (mm!.reloadMs! / 1000)) * (mm!.hitRate ?? 1)
    const dpsMine = effDps(m, AMMO_PLASMA)
    const dpsMk3 = effDps(mk3, AMMO_KINETIC)
    expect(dpsMk3, 'MK3 有效 DPS = 17.1 ÷ 1.3 × 0.92 = 12.10').toBeCloseTo(12.1, 2)
    expect(dpsMine, '本件有效 DPS = 40.5 ÷ 1.8 × 1 = 22.50').toBeCloseTo(22.5, 2)
    /**
     * ⚠ **如实锁住"不是同 DPS"这个偏离**（第 ① 句的"同 DPS"没做到；第 ⑥ 句按其字面落码后更远）。
     * 真同 DPS 的解 = `dmgMult` 2.42（单发 21.8）；2.42 ＋ 第 ⑥ 句的 +3 ⇒ 2.75。**待船长裁定**。
     */
    const ratio = dpsMine / dpsMk3
    expect(ratio, '本件现在是 MK3 的约 1.86 倍（不是"一样"）').toBeGreaterThan(1.5)
    expect(ratio, `实测 ${ratio.toFixed(3)}`).toBeCloseTo(1.86, 2)
    /** 加码前（`dmgMult` 4.0）应为 1.65 倍 —— 印证 +3 的增量 */
    const before = effDps({ ...m!, dmgMult: 4 }, AMMO_PLASMA) / dpsMk3
    expect(before, `加码前 ${before.toFixed(3)}`).toBeCloseTo(1.65, 2)
    /** **CPU：基线 +20%，再因必中 +20%**（船长第 ①/⑤ 句；第 ⑥ 句只点伤害，CPU 不动） */
    expect(m!.cpuUse, 'CPU = 44 × 1.2 × 1.2 = 63.36 → 63').toBe(Math.round(mk3.cpuUse! * 1.2 * 1.2))
    expect(m!.cpuUse).toBe(63)
    /** **必中**：`slot: 'laser'` ⇒ 引擎建出 beam（与全仓激光同口径） */
    expect(m!.slot).toBe('laser')
    expect(m!.hitRate).toBe(1)
    console.log(
      `  [读数] PD激光：射程 ${m!.maxRangeM}m · 装填 ${m!.reloadMs}ms · 面板单发 ${panelShot(m)}（上批 24 ＋ 第⑥句 3）·` +
        ` **真实单发 ${realShot(m, AMMO_PLASMA)}**（9 × 4.5；MK3 = 6 × 2.85 = 17.1）` +
        ` ⇒ 有效 DPS ${dpsMine.toFixed(2)}（MK3 ${dpsMk3.toFixed(2)}，**比值 ${ratio.toFixed(3)}**）·` +
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
    /**
     * **端到端锁一次真实单发**：走完整建档链（长尾鲨 T3 有 `powerBonus` 0.25）
     * ⇒ 单发 = round(能量弹 9 × 4.5 × 1.25) = round(50.625) = **51**（加码前 = round(45) = 45）。
     * 对照：同舰换动能近防炮 MK3 ⇒ `shotsByType.kinetic` = round(6 × 2.85 × 1.25) = round(21.375) = **21**
     * ⇒ **同一艘船、同一个"面板口径"，本件真实单发是它的 2.4 倍多**（这正是"同 DPS"没做到的证据）。
     */
    const thresher = ctx.ships.get('sh-thresher')!
    const powerBonus = thresher.powerBonus ?? 0
    const expectShot = Math.round(9 * mod('mod-lair-pd-r')!.dmgMult! * (1 + powerBonus))
    expect(pd!.shotDmg, `建档真实单发 = 9 × 4.5 × 1.25 → ${expectShot}（加码前 45）`).toBe(expectShot)
    expect(pd!.shotDmg).toBe(51)
    // 对照：换回动能近防炮 MK3 ⇒ 不是 beam（掷命中），防空属性照旧
    state.fleet[id]!.fitted = { high: ['mod-pd-e-3'], mid: [], low: [] }
    state.moduleBay['mod-pd-e-3'] = 1
    const spec2 = createPlayerSpec(state, ctx, id)!
    const kin = spec2.weapons.find((w) => w.label.includes('近防炮'))!
    expect(kin.kind, '动能近防炮是掷命中（gun）').toBe('gun')
    expect(kin.canHitDrones, '它同样带防空属性').toBe(true)
    expect(kin.shotsByType!.kinetic, 'MK3 同舰真实单发 = 21').toBe(Math.round(6 * 2.85 * (1 + powerBonus)))
    console.log(
      `  [读数] 建档：PD激光 kind=${pd!.kind}（必中）· 对机群 ×${pd!.antiDroneMul} · ${pd!.maxRangeM}m/${pd!.reloadMs}ms ·` +
        ` 真实单发 ${pd!.shotDmg}（MK3 同舰 ${kin.shotsByType!.kinetic}，本件 ${(pd!.shotDmg! / kin.shotsByType!.kinetic!).toFixed(2)} 倍）` +
        `；对照 近防炮 MK3 kind=${kin.kind}（掷命中）`,
    )
  })
})
