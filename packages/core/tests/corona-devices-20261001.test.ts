/**
 * **光环科技 · 叠光装置 + 闪烁过载装置**（**船长 2026-10-01 令**，两句原话照抄）：
 *
 * - 「**添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，最多缩短至0.5秒攻击间隔。
 *   伤害给予一个0.3的倍率。**」⇒ 挂 R 族 T3 **叠光级**；
 * - 「**粼光添加闪烁过载装置，效果是每次触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。**」
 *   ⇒ 挂 R 族 T1 **粼光级**。
 *
 * 同日追问的裁定（决定实现口径的四条）：
 * - 伤害 ×0.3 = **该舰全部伤害**（选「甲」）⇒ 收口在 `combat.foeRepairDiscountedShot`，光束与实弹都过；
 * - 5% = **结构上限的 5%**（选「甲」，不是总血上限）；
 * - **可以扣死（自毁）**（选「乙」）⇒ 不设保底，反复闪现会把结构扣到 0、该舰当场自毁；
 * - 叠光步长 = **300ms**（船长先令「先计算叠满大概要打多久」，读数后选「丙：400ms」，**同日二次改判为 300ms**）。
 *
 * 本用例锁五层：① 两件的定义与解析 ② 挂载面（只挂各自主人）
 * ③ 建档落地（＋别的族零行为变化）④ 伤害折减真的落在单发上
 * ⑤ **真实战斗里两条机制都按读数跑**（装填递减至下限 / 结构按上限 5% 递减直至自毁）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  createInitialState,
  foeRepairDiscountedShot,
  startFleetBattleFor,
} from '../src/index'
import { advanceBattleFor, createFoeSpecs, wormholeDerivedAnomaly } from '../src/combat'
import { FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'

const ctx = buildSimContext()
const bal = ctx.balance.battle
/** 光环科技最小的那张卡（外围常驻 · 5× 粼光级）——闪烁过载用它起真实战斗 */
const CARD_T1 = 'corona-drift'
/** 带叠光级的那张卡（核心 · 外围都有它）——叠光装置用它起真实战斗 */
const CARD_T3 = 'corona-converge'

/** 起一场真实战斗（照 `corona-blink-20261001` 的写法）——`ships` 艘舢板、可带敌群强度覆写 */
function battleOf(card: string, ships: number, foeOverride?: { strengthMul?: number }) {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, 'sh-thresher'))
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
  const battle = startFleetBattleFor(state, ctx, ids, card, 0, null, { depth: 4, kind: 'node', waves: 1 }, foeOverride)
  expect(battle, '开战应成功').toBeTruthy()
  const b = battle!
  return {
    b,
    tick: (toMs: number) => {
      state.gameMs = toMs
      advanceBattleFor(state, ctx, b, ids[0]!, card)
    },
  }
}

describe('叠光装置 / 闪烁过载装置：件定义与解析', () => {
  it('① 两件参数 = 船长定案（300ms 步长 · 500ms 下限 · 伤害 ×0.3 / 护盾全回 · 结构上限 5%）', () => {
    const ov = resolveFoeMounts([FOE_MOUNT_IDS.coronaOverlayDrive])
    expect(ov.unknown, '件 id 必须已登记（否则体检判红）').toEqual([])
    expect(ov.foeOverlayDrive, '叠光参数应原样带给单位').toEqual({
      stepMs: 300,
      floorMs: 500,
      dmgMul: 0.3,
    })
    const fo = resolveFoeMounts([FOE_MOUNT_IDS.coronaFlashOverload])
    expect(fo.unknown).toEqual([])
    expect(fo.foeFlashOverload, '闪烁过载参数应原样带给单位').toEqual({
      healShield: true,
      hullCostPct: 0.05,
    })
    console.log(
      `  [读数] 叠光装置：步长 ${ov.foeOverlayDrive!.stepMs}ms · 下限 ${ov.foeOverlayDrive!.floorMs}ms · ` +
        `伤害 ×${ov.foeOverlayDrive!.dmgMul}；闪烁过载：护盾全回 · 结构上限的 ${fo.foeFlashOverload!.hullCostPct * 100}%`,
    )
  })

  it('② 不挂这两件的编成 ⇒ 解析结果里没有对应字段（既有各族零行为变化）', () => {
    const none = resolveFoeMounts([])
    expect(none.foeOverlayDrive).toBeUndefined()
    expect(none.foeFlashOverload).toBeUndefined()
    const blinkOnly = resolveFoeMounts([FOE_MOUNT_IDS.coronaBlink])
    expect(blinkOnly.foeOverlayDrive, '只挂瞬光跃迁仪的档不得凭空带叠光').toBeUndefined()
    expect(blinkOnly.foeFlashOverload).toBeUndefined()
  })
})

describe('叠光装置 / 闪烁过载装置：挂载面（只挂各自主人）', () => {
  it('③ 叠光级带叠光装置、粼光级带闪烁过载；其余三档只带瞬光跃迁仪', () => {
    const mountsOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)?.mounts ?? []
    // 五档全带闪现（船长选「乙」，见 `corona-blink-20261001`）；两件新装置各只挂一档
    for (const id of [
      'foe-r-corona-glint',
      'foe-r-corona-echo',
      'foe-r-corona-overlay',
      'foe-r-corona-dusk',
      'foe-r-corona-nexus',
    ]) {
      expect(mountsOf(id), `${id} 常挂瞬光跃迁仪`).toContain(FOE_MOUNT_IDS.coronaBlink)
    }
    expect(mountsOf('foe-r-corona-glint'), '粼光级（T1）挂闪烁过载').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaFlashOverload,
    ])
    expect(mountsOf('foe-r-corona-overlay'), '叠光级（T3）挂叠光装置').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaOverlayDrive,
    ])
    for (const id of ['foe-r-corona-echo', 'foe-r-corona-dusk', 'foe-r-corona-nexus']) {
      expect(mountsOf(id), `${id} 不该挂这两件`).toEqual([FOE_MOUNT_IDS.coronaBlink])
    }
    console.log('  [读数] 挂载面：粼光级 = 闪现 + 闪烁过载；叠光级 = 闪现 + 叠光；其余三档 = 仅闪现')
  })

  it('④ 建档：spec 上带对应字段；不带该件的族不带（缺省不写）', () => {
    const t1Card = ctx.anomalies.get(CARD_T1)!
    for (const sp of createFoeSpecs(t1Card, bal, {})) {
      expect(sp.foeFlashOverload, '本卡五艘粼光级都应带闪烁过载').toEqual({
        healShield: true,
        hullCostPct: 0.05,
      })
      expect(sp.foeOverlayDrive, '粼光级不得带叠光').toBeUndefined()
    }
    // 叠光级在派生卡里（真实战斗走的就是派生卡）——取它来核叠光落地
    const t3Derived = wormholeDerivedAnomaly(ctx, ctx.anomalies.get(CARD_T3)!, {
      depth: 4,
      kind: 'node',
      waves: 1,
    })!
    const overlay = createFoeSpecs(t3Derived, bal, {}).filter((sp) => sp.foeOverlayDrive !== undefined)
    expect(overlay.length, '本卡应有叠光级').toBeGreaterThan(0)
    for (const sp of overlay) {
      expect(sp.foeOverlayDrive, '叠光级应带叠光参数').toEqual({
        stepMs: 300,
        floorMs: 500,
        dmgMul: 0.3,
      })
      expect(sp.foeFlashOverload, '叠光级不得带闪烁过载').toBeUndefined()
    }
    // 对照：H 族那四张卡两件都不带（零行为变化）
    const hCard = ctx.anomalies.get('ink-harass')!
    for (const sp of createFoeSpecs(hCard, bal, {})) {
      expect(sp.foeOverlayDrive, 'H 族不得带叠光').toBeUndefined()
      expect(sp.foeFlashOverload, 'H 族不得带闪烁过载').toBeUndefined()
    }
  })
})

describe('叠光装置：伤害 ×0.3 落在每一发单发上', () => {
  it('⑤ 同一发单发：挂叠光 ⇒ ×0.3；摘掉 ⇒ 原值（收口是开火链上那一个）', () => {
    const derived = wormholeDerivedAnomaly(ctx, ctx.anomalies.get(CARD_T3)!, {
      depth: 4,
      kind: 'node',
      waves: 1,
    })!
    const spec = createFoeSpecs(derived, bal, {}).find((sp) => sp.foeOverlayDrive !== undefined)!
    const shot = spec.weapons[0]!.shotDmg ?? 0
    expect(shot, '本条单发应有值').toBeGreaterThan(0)
    const withMount = foeRepairDiscountedShot(spec, shot)
    const without = foeRepairDiscountedShot({ ...spec, foeOverlayDrive: undefined }, shot)
    expect(without, '不挂件 ⇒ 与单发面板一字不差').toBe(shot)
    expect(withMount, '挂件 ⇒ 单发 ×0.3').toBe(Math.max(1, Math.round(shot * 0.3)))
    console.log(`  [读数] 叠光级单发 ${shot} ⇒ 挂件后 ${withMount}（×0.3）；摘件对照 ${without}`)
  })
})

describe('叠光装置：真实战斗里的装填自加速', () => {
  it('⑥ 每开一火 −300ms（首访问 = 条目基准 4200），一路推进到下限 500ms', () => {
    const { b, tick } = battleOf(CARD_T3, 8)
    /** 逐拍记录该舰的「当前装填间隔」（登记表里的 `r`）＋ 首次出现时刻，用来读「叠满要多久」 */
    const seq: Array<{ t: number; r: number }> = []
    for (let t = 250; t <= 400_000 && b.ended === null; t += 250) {
      tick(t)
      const r = b.foeOverlayReload?.['w0-foe-4']?.r
      if (r === undefined) continue
      if (seq.length === 0 || seq[seq.length - 1]!.r !== r) seq.push({ t, r })
      if (r <= 500) break // 叠满（夹到下限）⇒ 后面不再变化，停
    }
    const rs = seq.map((x) => x.r)
    expect(rs.length, '应观察到多次开火推进').toBeGreaterThanOrEqual(6)
    expect(rs[0], '首访问 = 条目基准装填').toBe(4_200)
    // 逐格核步长：正常格恒 = 300ms；**最后一格**（夹到下限的那一格）允许 ≤300（夹取的正常表现）
    for (let i = 1; i < rs.length; i++) {
      const step = rs[i - 1]! - rs[i]!
      if (i === rs.length - 1) {
        expect(step, '最后一格的步长不得超过 300ms（夹取只许少、不许多）').toBeLessThanOrEqual(300)
      } else {
        expect(step, `第 ${i} 次推进的步长`).toBe(300)
      }
    }
    for (const r of rs) expect(r, '任何时刻都不得低于下限 500ms').toBeGreaterThanOrEqual(500)
    expect(rs[rs.length - 1], '（若本场够长）末尾应夹到下限 500ms').toBe(500)
    console.log(
      `  [读数] 叠光级装填间隔轨迹：${rs.join(' → ')}（步长 300ms，下限 500ms）` +
        `；从 4200 叠到 500 共 ${rs.length - 1} 格，耗时 ${(seq[seq.length - 1]!.t / 1000).toFixed(2)} 秒`,
    )
  })
})

describe('闪烁过载装置：真实战斗里的护盾回满与结构代价', () => {
  it('⑦ 每次闪现 ⇒ 结构按上限 5% 递减，扣到 0 当场自毁（无保底）', () => {
    /**
     * ⚠ **编成随"闪烁改向"调整过**（2026-10-01）：闪烁从"反着我方意图"改成"**以期望距离为目标**"
     * 之后，双方交战更紧、战斗普遍更短 ⇒ 原编成（12 舰 · 强度 0.8）只够观察到 **5 次**结构扣减
     * （自毁要 20 次，见 `hpMax.h × 5%`）。实测扫了几档编成，取**能观察到自毁且不过慢**的这一档：
     * **16 舰 · 强度 0.5** ⇒ 第 1 艘粼光级在第 **18** 次扣减时自毁（t ≈ 132.6 s，实测）。
     */
    const { b, tick } = battleOf(CARD_T1, 16, { strengthMul: 0.5 })
    const tag = 'foe-0'
    const maxH = b.units[tag]!.hpMax!.h
    const cost = maxH * 0.05
    console.log(`  [读数] 粼光级满结构 ${maxH.toFixed(4)} ⇒ 每次闪现应扣 ${cost.toFixed(4)}`)
    let prevH = b.units[tag]!.hp.h
    const drops: number[] = []
    let selfDestructAtMs = 0
    for (let t = 100; t <= 600_000 && b.ended === null; t += 100) {
      tick(t)
      const u = b.units[tag]
      if (!u) break
      if (u.hp.h < prevH - 1e-9) {
        /**
         * ⚠ **同一拍内可能结算多次**（`advanceBattleFor` 内部按 100ms 子步推进 ⇒ 一次 `tick(500)`
         * 可能连过好几拍）⇒ 单次采样的减量是 `cost` 的**整数倍**（实测有 3 倍的情形）。
         * 判据因此是「**减量 = cost 的整数倍**」——它一样能钉住"每次闪现恰好扣 5%"这条规格。
         */
        const delta = prevH - u.hp.h
        const times = delta / cost
        expect(
          Math.abs(times - Math.round(times)),
          `减量 ${delta.toFixed(4)} 应是满结构 5%（${cost.toFixed(4)}）的整数倍`,
        ).toBeLessThan(1e-6)
        expect(Math.round(times), '同一拍内的结算次数应在合理范围（1~8）').toBeGreaterThanOrEqual(1)
        expect(Math.round(times), '同一拍内的结算次数应在合理范围（1~8）').toBeLessThanOrEqual(8)
        drops.push(u.hp.h)
        if (u.hp.s + u.hp.a + u.hp.h <= 0) {
          selfDestructAtMs = t
          break
        }
      }
      prevH = u.hp.h
    }
    expect(drops.length, '应观察到多次结构扣减').toBeGreaterThanOrEqual(3)
    expect(selfDestructAtMs, '反复闪现应把它扣死自毁（船长选「乙」）').toBeGreaterThan(0)
    expect(b.units[tag]!.hp.h, '自毁后结构归零').toBe(0)
    expect(
      b.units[tag]!.hp.s + b.units[tag]!.hp.a,
      '自毁 = 三层全空（按既有"阵亡"口径收场）',
    ).toBe(0)
    console.log(
      `  [读数] 结构轨迹：${maxH.toFixed(2)} → ${drops.map((x) => x.toFixed(2)).join(' → ')}` +
        `（共 ${drops.length} 次，每次 −${cost.toFixed(4)}）⇒ 第 ${drops.length} 次扣到 0 自毁（t=${selfDestructAtMs}ms）`,
    )
  })
})
