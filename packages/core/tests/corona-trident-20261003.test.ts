/**
 * **光环科技 · 三叉戟光束炮（势力能量武器 · 三连射）**（**船长 2026-10-03 令**，原话照抄）：
 *
 * > ① 「**添加一个旗舰同款的势力能量武器（三连射），DPS比MK3要高一些，射速为3000MS，
 * >    CPU占用根据DPS的比例同等提高。**」
 * > ② 「**名字叫三叉戟光束炮**」
 * > ③ 「**单发伤害再上调20%**」
 * > ④ （八条追问后）「**按推荐**」
 *
 * 数值账（口径 = **名义 DPS** = 面板 `单发系数 × 发数 ÷ 装填`）：
 * - MK3 激光（`mod-laser-3`）基准 = 4.2 ÷ 4.0 s = **1.05 /s**；
 * - 本件 = **1.512 × 3 ÷ 3.0 s = 1.512 /s = MK3 的 1.44 倍**（1.512 = 首版 1.26 × 1.2）；
 * - **CPU 75** = 52 × 1.44（船长第 ① 句的"按 DPS 比例同等提高"）；
 * - 弹药 120 发/场（三连射每轮吃 3 发）；射程/衰减与 MK3 同。
 *
 * 本用例锁四层：① 件参数与产出面登记 ② 建档（`ModuleDef.burst` → `WeaponSpec.burst`）
 * ③ **真实战斗里三发一节拍**（阶梯 1→2→删键、相邻 100ms、轮周期 ≈3.3s、每轮恰扣 3 发弹）
 * ④ 对 MK3 的 **DPS 比值读数**（名义 1.44 / 引擎实效 ≈1.34）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, MODULES, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, startFleetBattleFor } from '../src/index'
import { advanceBattleFor, createPlayerSpec } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'

const ctx = buildSimContext()
/**
 * 弱卡（H 族骚扰舰队）：**特意不选 R 族卡** —— R 族敌舰挨打会闪现，而"敌方闪现演出窗口内我方不开火"
 * 是既定门控（`blinkHold.me`）⇒ 会把三连的 100ms 间隔撑到 400~500ms（2026-10-03 实测踩到，
 * 那不是连发的毛病）。要读**连发本身**的节拍就得挑一张不会闪的卡。
 */
const CARD = 'ink-harass'

function moduleOf(id: string) {
  return MODULES.find((m) => m.id === id)
}

/** 起一场战斗：`ships` 艘舢板，高槽全装 `modId`（件必须入 `moduleBay` 才算装上） */
function battleOf(ships: number, modId: string) {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, 'sh-thresher'))
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: [modId], mid: [], low: [] }
  state.moduleBay[modId] = 1
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 90_000
  /**
   * **主控那门的炮位下标与连发表键**（键 = **运行态 tag**`#炮位`，不是舰队里的舰 id）：
   * ⚠ 两处都不能硬写 —— ① 舢板自带一门 `src: 'base'` 的基础舰炮排在 `[0]`（2026-10-03 探针实测：
   * 本件落在 `[1]`）；② 主控的 tag 是 `player`（不是 `ids[0]` 那个舰 id；舰队 id 变了键就静默失配）。
   * ⇒ 一律从建出的规格里取 `spec.tag` 与"带 `burst` 的那门"的下标。
   */
  const spec = createPlayerSpec(state, ctx, ids[0]!)!
  const wi = spec.weapons.findIndex((w) => w.burst !== undefined)
  const battle = startFleetBattleFor(state, ctx, ids, CARD, 0, null, undefined, undefined)
  expect(battle, '开战应成功').toBeTruthy()
  const b = battle!
  return {
    b,
    wi,
    burstKey: `${spec.tag}#${wi}`,
    tick: (toMs: number) => {
      state.gameMs = toMs
      advanceBattleFor(state, ctx, b, ids[0]!, CARD)
    },
  }
}

describe('三叉戟光束炮：件参数与产出面', () => {
  it('① 参数 = 船长令（三连射 3×100ms · 装填 3s · 单发 ×1.2 后 · CPU 按 DPS 比例）', () => {
    const m = moduleOf('mod-lair-beam-r')
    expect(m, '件必须在册').toBeTruthy()
    expect(m!.name).toBe('三叉戟光束炮')
    expect(m!.slot).toBe('laser')
    expect(m!.rack).toBe('high')
    expect(m!.reloadMs, '船长令「射速为3000MS」').toBe(3_000)
    expect(m!.burst, '船长令「旗舰同款（三连射）」').toEqual({ shots: 3, gapMs: 100 })
    expect(m!.dmgMult, '单发：1.26 × 1.2（船长令「单发伤害再上调20%」）').toBeCloseTo(1.512, 9)
    /** **名义 DPS 比 MK3 高 44%**（1.512 × 3 ÷ 3.0 = 1.512 /s vs 1.05 /s） */
    const mk3 = moduleOf('mod-laser-3')!
    const nominal = (dmg: number, reloadMs: number, shots: number) => (dmg * shots * 1000) / reloadMs
    const ratio = nominal(m!.dmgMult!, m!.reloadMs!, m!.burst!.shots) / nominal(mk3.dmgMult!, mk3.reloadMs!, 1)
    expect(ratio, '名义 DPS = MK3 的 1.44 倍').toBeCloseTo(1.44, 6)
    /** **CPU = MK3 的 CPU × 同一比值**（船长：「CPU占用根据DPS的比例同等提高」） */
    expect(m!.cpuUse, 'CPU = 52 × 1.44 = 74.88 → 75').toBe(Math.round(mk3.cpuUse! * ratio))
    expect(m!.cpuUse).toBe(75)
    expect(m!.ammoPerEngagement, '弹药 120 发 = 40 轮 × 3 发').toBe(120)
    expect(m!.maxRangeM, '射程与 MK3 同').toBe(mk3.maxRangeM)
    expect(m!.falloff).toBe(mk3.falloff)
    console.log(
      `  [读数] 三叉戟光束炮：单发系数 ${m!.dmgMult}（MK3 的 ${((m!.dmgMult! / mk3.dmgMult!) * 100).toFixed(0)}%）` +
        ` · ${m!.burst!.shots} 连射 × ${m!.burst!.gapMs}ms · 装填 ${m!.reloadMs}ms · CPU ${m!.cpuUse}（MK3 ${mk3.cpuUse}）` +
        ` ⇒ 名义 DPS = MK3 的 ${ratio.toFixed(2)} 倍`,
    )
  })

  it('② 产出面：R 族势力件池第三件 ＋ 市场只收不卖 ＋ 图鉴登记（每族不重复）', () => {
    expect(FOE_LAIR_GEAR.R, '稀有残骸高级箱专属池应含本件').toContain('mod-lair-beam-r')
    /** ⚠ 池子随船长令长大：2026-10-01 两件 → 2026-10-03 三件（本件）→ **同日再追加 PD激光 = 四件** */
    expect(FOE_LAIR_GEAR.R!.length, 'R 族现在四件（含 2026-10-02 追加的 PD激光）').toBe(4)
    // 其余族的池子未被本次改动碰到（零行为变化）
    expect(FOE_LAIR_GEAR.H!.length).toBe(3)
    expect(FOE_LAIR_GEAR.A!.length).toBe(3)
    const m = moduleOf('mod-lair-beam-r')!
    expect(m.unreleased, '势力件是正式产出（不得标 unreleased）').toBeUndefined()
  })
})

describe('三叉戟光束炮：建档（ModuleDef.burst → WeaponSpec.burst）', () => {
  it('③ 装上的船 ⇒ 该门武器带 burst；不装 ⇒ 一处都不写（既有装备零行为变化）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const id = addShipToFleet(state, 'sh-thresher')
    state.shipId = id
    state.moduleBay['mod-lair-beam-r'] = 1
    state.fleet[id]!.fitted = { high: ['mod-lair-beam-r'], mid: [], low: [] }
    const spec = createPlayerSpec(state, ctx, id)!
    const beam = spec.weapons.find((w) => w.label.includes('三叉戟'))
    expect(beam, '建档应带上这门武器').toBeTruthy()
    expect(beam!.burst, '件上的 burst 原样带给武器').toEqual({ shots: 3, gapMs: 100 })
    expect(beam!.reloadMs).toBe(3_000)
    // 对照：换回 MK3 ⇒ 没有 burst（既有装备零行为变化）
    state.fleet[id]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
    state.moduleBay['mod-laser-3'] = 1
    const spec2 = createPlayerSpec(state, ctx, id)!
    for (const w of spec2.weapons) expect(w.burst, `${w.label} 不得凭空带连发`).toBeUndefined()
  })
})

describe('三叉戟光束炮：真实战斗里的三连射节拍', () => {
  it('④ 三发一节拍：阶梯 1 → 2 → 删键、相邻 100ms、轮周期 ≈3.3s、每轮恰扣 3 发弹', () => {
    const { b, tick, burstKey: key, wi } = battleOf(8, 'mod-lair-beam-r')
    expect(wi, '主控那门应真的是带连发的那门（下标从规格里找，不硬写）').toBeGreaterThanOrEqual(0)
    /** 主控 tag 恒为 `player`；炮位下标由夹具现算（舢板的基础舰炮占 [0]） */
    const ladder: Array<{ t: number; fired: number | undefined }> = []
    const ammoMarks: Array<{ t: number; pla: number }> = []
    /** 本场出现过的**全部**连发表键（用来钉"逐舰记账"） */
    const allKeys: string[] = []
    let prevFired: number | undefined
    let prevPla = b.ammo.pla
    for (let t = 100; t <= 120_000 && b.ended === null; t += 100) {
      tick(t)
      const fired = b.meBurstFired?.[key]
      if (fired !== prevFired) {
        ladder.push({ t, fired })
        prevFired = fired
      }
      for (const k of Object.keys(b.meBurstFired ?? {})) if (!allKeys.includes(k)) allKeys.push(k)
      if (b.ammo.pla !== prevPla) {
        ammoMarks.push({ t, pla: b.ammo.pla })
        prevPla = b.ammo.pla
      }
    }
    /** 每轮 = 「第 2 发（fired=1）→ 第 3 发（fired=2）→ 删键（本轮打完）」三格 */
    const cycleStarts = ladder.filter((x) => x.fired === 1)
    expect(cycleStarts.length, '应观察到多轮三连射').toBeGreaterThanOrEqual(4)
    for (let i = 0; i < Math.min(3, cycleStarts.length); i++) {
      const at = cycleStarts[i]!.t
      const seg = ladder.filter((x) => x.t >= at && x.t < at + 1_000)
      expect(seg.map((x) => x.fired), `第 ${i + 1} 轮应是「1 → 2 → 本轮打完」`).toEqual([1, 2, undefined])
      const gaps = [seg[1]!.t - seg[0]!.t, seg[2]!.t - seg[1]!.t]
      for (const g of gaps) expect(g, `第 ${i + 1} 轮的发间隔应≈100ms（实测 ${g}ms）`).toBeLessThanOrEqual(150)
    }
    for (let i = 1; i < cycleStarts.length; i++) {
      const gap = (cycleStarts[i]!.t - cycleStarts[i - 1]!.t) / 1000
      expect(gap, `轮周期应≈装填 3 秒 ＋ 三连占用（实测 ${gap.toFixed(2)}s）`).toBeGreaterThan(3.0)
      expect(gap).toBeLessThan(3.6)
    }
    /**
     * **每轮恰扣 3 发能量弹**（`roundsPerVolley = 1` ⇒ 每发扣 1）：本场只有这门武器吃能量弹
     * ⇒ 总扣弹量必是 3 的整数倍。
     */
    const dropped = ammoMarks.length > 0 ? ammoMarks[0]!.pla - ammoMarks.at(-1)!.pla : 0
    expect(dropped, '应真的扣了弹').toBeGreaterThan(0)
    expect(dropped % 3, `总扣弹 ${dropped} 应是 3 的整数倍（三连射每轮 3 发）`).toBe(0)
    /**
     * **逐舰记账**（**2026-10-03 修**）：登记表的键按设计是 `舰tag#炮位` —— 八条船都装了这门，
     * 每艘各有一份连发账（改前传的是主控 tag ⇒ 僚舰全挤在 `player#` 上、读数互相踩）。
     */
    const tags = new Set(allKeys.map((k) => k.slice(0, k.indexOf('#'))))
    expect(tags.size, `八条船各挂一门 ⇒ 应出现多份逐舰连发账（实测 ${[...tags].join('/')}）`).toBeGreaterThan(1)
    expect(tags.has('player'), '主控那份也在').toBe(true)
    console.log(
      `  [读数] 三连阶梯（前 12 格）：${ladder.slice(0, 12).map((x) => `${(x.t / 1000).toFixed(2)}s:${x.fired ?? '完'}`).join(' → ')}` +
        `；轮周期 ${((cycleStarts[1]!.t - cycleStarts[0]!.t) / 1000).toFixed(2)}s；观测 ${cycleStarts.length} 轮 · 共扣能量弹 ${dropped} 发`,
    )
  })

  it('⑤ 引擎实效 DPS 读数：对 MK3 的实测比值（名义 1.44 ⇒ 实效 ≈1.34）', () => {
    /**
     * 读法：同编成、同卡、同 seed，只换高槽件 ⇒ 比较**同一段窗口内我方总输出**（`stats.meDmg`）。
     * 窗口取"打得完的前 30 秒"，避开战场结束差异。⚠ 这是**读数**（含命中/目标/距离相位），
     * 不是精确乘子；判据只钉"本件明显高于 MK3、且不高于名义比值的 1.2 倍"。
     */
    const runOne = (modId: string) => {
      const { b, tick } = battleOf(8, modId)
      let at = 0
      for (let t = 100; t <= 120_000 && b.ended === null; t += 100) {
        tick(t)
        at = t
        if (t >= 30_000) break
      }
      return { dmg: b.stats.meDmg, at }
    }
    const mk3 = runOne('mod-laser-3')
    const trident = runOne('mod-lair-beam-r')
    const ratio = trident.dmg / mk3.dmg
    expect(ratio, `同一 30 秒窗口：本件输出应明显高于 MK3（实测 ${ratio.toFixed(2)}×）`).toBeGreaterThan(1.1)
    expect(ratio, '且不应超过名义比值太多（留相位余量）').toBeLessThan(1.44 * 1.2)
    console.log(
      `  [读数] 同 30 秒窗口我方总输出：三叉戟 ${trident.dmg.toFixed(0)} vs MK3 ${mk3.dmg.toFixed(0)}` +
        ` ⇒ 实效 ${ratio.toFixed(2)}×（名义 1.44×、扣连发占位与一拍滞后后理论 ≈1.34×）`,
    )
  })

  it('⑥ 既有装备零行为变化：不装连发件的船一次都不写 `meBurstFired`', () => {
    const { b, tick } = battleOf(8, 'mod-laser-3')
    for (let t = 100; t <= 20_000 && b.ended === null; t += 100) tick(t)
    expect(Object.keys(b.meBurstFired ?? {}), '没挂连发件 ⇒ 这张表恒空').toEqual([])
    /** 对照：装了本件的那场，这张表确实被写过（上面 ④ 已断言阶梯） */
    expect(FOE_SHIPS.length, '（顺手：舰级表仍可读，避免本用例变成纯数据断言）').toBeGreaterThan(0)
  })
})
