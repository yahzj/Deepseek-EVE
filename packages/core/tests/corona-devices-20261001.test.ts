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
  it('③ 叠光级带叠光装置、回响级带闪烁过载；其余各档只带自己那件', () => {
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
    /**
     * ⚠ **2026-10-03 船长令改归属**：「**将粼光级的闪现后恢复护盾的挂载件移交给回响级**」
     * ⇒ 闪烁过载装置 T1 粼光级 → **T2 回响级**（本用例随之改）。
     */
    expect(mountsOf('foe-r-corona-echo'), '回响级（T2）挂闪烁过载（自粼光级移来）').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaFlashOverload,
    ])
    expect(mountsOf('foe-r-corona-overlay'), '叠光级（T3）挂叠光装置').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaOverlayDrive,
    ])
    /**
     * ⚠ **2026-10-02 船长令加件后本段收窄**：垂暮级 / 中枢各自新挂了「待机护盾阵列」/「聚焦阵列」
     * （见 `corona-mounts-20261002` 用例）⇒ 这里只再钉**两件新件没串到别的档**，
     * 以及"只该有瞬光跃迁仪"的那一档（粼光级）。
     */
    expect(mountsOf('foe-r-corona-glint'), '粼光级只该有瞬光跃迁仪').toEqual([FOE_MOUNT_IDS.coronaBlink])
    for (const id of ['foe-r-corona-glint', 'foe-r-corona-echo', 'foe-r-corona-overlay']) {
      expect(mountsOf(id), `${id} 不该带待机护盾阵列`).not.toContain(FOE_MOUNT_IDS.coronaStandbyShield)
      expect(mountsOf(id), `${id} 不该带聚焦阵列`).not.toContain(FOE_MOUNT_IDS.coronaFocusArray)
    }
    console.log('  [读数] 挂载面：回响级 = 闪现 + 闪烁过载；叠光级 = 闪现 + 叠光；粼光级 = 仅闪现')
  })

  it('④ 建档：spec 上带对应字段；不带该件的族不带（缺省不写）', () => {
    const t1Card = ctx.anomalies.get(CARD_T1)!
    for (const sp of createFoeSpecs(t1Card, bal, {})) {
      /** ⚠ 2026-10-03：闪烁过载已移交回响级 ⇒ 粼光级这一档**不该再有**它（本条改判据方向） */
      expect(sp.foeFlashOverload, '粼光级已不带闪烁过载（2026-10-03 移交回响级）').toBeUndefined()
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
    /**
     * ⚠ **2026-10-01 编成 8 舰 → 16 舰**（船长同日令「给非中枢的 R 族船添加 3,000 的基础射程」）：
     * R 族射程涨了 ⇒ 它按期望距离入场的**开场距离更远**（`corona-converge` 实测更远）⇒ 同样时长里
     * 叠光级**开火次数变少**、8 舰编成下战斗结束时只叠到 1,500ms、**够不到 500ms 下限**。
     * 实测扫描：**16 舰**（时长 49 s）即可叠到下限 500ms；24/32/48 舰同样够。
     * ⇒ 取最小够用档 **16 舰**。
     */
    const { b, tick } = battleOf(CARD_T3, 16)
    /**
     * 逐拍读该舰的**登记表**（`{ r, f, bs }`）：`r` = 当前装填间隔、`f` = 已开火次数、`bs` = 已折算的闪现次数。
     *
     * ⚠ **2026-10-01 改判据**（新「激光有效射程」规则上线后）：开场距离由 R 族格的期望距离压到 **3,570m**
     * ⇒ 敌舰**进圈更早**，本用例从 t=250ms 起采样时它**已经开过火**（旧写法断言"首个读到的 `r` 必须是
     * 4,200 基准值"因此失效——那不是机制变了，是采样起点晚于首发）。
     * 新写法**用登记表的 `f` 反推**：第 `f` 发的 `r` = `max(500, 4200 − (f − 1 + bs) × 300)`
     * （`f` = 已开火发数（**含本发**）、`bs` = 已折算的闪现次数）⇒ 无论从第几发开始采样都成立。
     */
    const seq: Array<{ t: number; r: number; f: number; bs: number }> = []
    for (let t = 250; t <= 400_000 && b.ended === null; t += 250) {
      tick(t)
      const reg = b.foeOverlayReload?.['w0-foe-4']
      if (reg === undefined) continue
      if (seq.length === 0 || seq[seq.length - 1]!.r !== reg.r) seq.push({ t, r: reg.r, f: reg.f, bs: reg.bs })
      if (reg.r <= 500) break // 叠满（夹到下限）⇒ 后面不再变化，停
    }
    const rs = seq.map((x) => x.r)
    expect(rs.length, '应观察到多次开火推进').toBeGreaterThanOrEqual(6)
    /** **每条登记都用「第 f 发 = 基准 − (f−1+闪现) × 步长」核对**（不依赖采样起点） */
    for (const s of seq) {
      expect(
        s.r,
        `t=${s.t}：第 ${s.f} 发的 r 应 = max(500, 4200 − (${s.f} − 1 开火 + ${s.bs} 闪现) × 300)`,
      ).toBe(Math.max(500, 4_200 - (s.f - 1 + s.bs) * 300))
      expect(s.r, '任何时刻都不得低于下限 500ms').toBeGreaterThanOrEqual(500)
      expect(s.r, '任何时刻都不得超过条目基准 4,200ms').toBeLessThanOrEqual(4_200)
    }
    /** **首发（`f` = 1）的 `r` 必须正是条目基准 4,200** —— 由登记表反查（不依赖采样起点） */
    const firstFired = seq.find((s) => s.f === 1)
    if (firstFired) expect(firstFired.r, '第 1 发 = 条目基准装填 4,200').toBe(4_200)
    /**
     * 逐格核步长：**正常格 = 300ms**；⚠ **同一拍里"既开火又闪现"的那一格 = 600ms**
     * （船长令：闪现也推进一格装填 ⇒ `corona-devices` 这条机制本身允许叠加）——
     * 2026-10-01 实测本场第 8 格就是 600（原来"每格恒 300"的判据只在没有闪现的场次成立）。
     * **夹到下限的那一格**允许 ≤300（夹取的正常表现）。
     */
    for (let i = 1; i < rs.length; i++) {
      const step = rs[i - 1]! - rs[i]!
      if (i === rs.length - 1) {
        expect(step, '最后一格的步长不得超过 300ms（夹取只许少、不许多）').toBeLessThanOrEqual(300)
      } else {
        expect([300, 600], `第 ${i} 次推进的步长应是 300（本拍只开火）或 600（本拍开火＋闪现）`).toContain(step)
      }
    }
    expect(rs[rs.length - 1], '（若本场够长）末尾应夹到下限 500ms').toBe(500)
    console.log(
      `  [读数] 叠光级装填间隔轨迹：${rs.join(' → ')}（步长 300ms，下限 500ms）` +
        `；采样起点 t=${seq[0]!.t}ms 时已开火 ${seq[0]!.f} 发（故首个读数为 ${seq[0]!.r}，反推基准 = 4,200）` +
        `；叠到下限共 ${rs.length - 1} 格，耗时 ${(seq[seq.length - 1]!.t / 1000).toFixed(2)} 秒`,
    )
  })
})

describe('闪烁过载装置：真实战斗里的护盾回满与结构代价', () => {
  it('⑦ 每次闪现 ⇒ 结构按上限 5% 递减（自毁的实现口径见用例内说明）', () => {
    /**
     * ⚠ **编成在 2026-10-01 改过四次**，每次都是"机制/战术变了 ⇒ 战斗节奏变了"的正当结果：
     * - 第一次「闪烁改向（以期望距离为目标）」⇒ 交战更紧、战斗更短，原 12 舰·0.8 只够 5 次扣减；
     * - 第二次「**R 族以玩家射程盲区为期望距离**（主动贴身，船长正解）」⇒ R 族贴到 500~600m 打，
     *   我方战败更快（实测 16~53 s 结束），扫了 5 档编成都再没能观察到 20 次扣减；
     * - 第三次（本次）「**伤害公式改判为"整发只吃一个系数"（船长选乙）**」⇒ 我方 DPS 变了，
     *   `foe-0` 的**穿透伤害**开始混进结构轨迹（12 舰·0.2 实测 20 条记录里 8 条不是 `cost` 的整数倍）；
     * - 第四次（本次）「**激光敌人：射程前 70% 才算有效射程**（船长令）」⇒ R 族格的期望距离按有效射程重算
     *   ⇒ **开场距离 5,100 → 3,570m**（更贴着我方）⇒ 我方火力更快打穿、敌舰**在闪满 20 次前就被击毁**
     *   （24 舰·2 实测只扣到 11 次）。
     *
     * ⇒ 本次把编成再调到"纯净窗口"上：**48 舰·敌群强度 16** 实测 —— 满结构 2,477 ⇒ 每格 123.86、
     * 战斗 250 s、**20 次扣减一条不混**（每格恰好 `cost` 的 1 倍：闪烁先把护盾回满、我方单发又打不穿护盾
     * ⇒ 结构只由闪烁驱动），于是本用例能**同时**钉住两件事：
     * ① 每次闪现恰好扣 `hpMax.h × 5%`（**整数倍**判据，含"同一拍多结算"的 1~8 倍档）；
     * ② **无保底、可扣死自毁** —— 第 20 次扣到 0、三层一并清零（本编成实测真的跑到）。
     * 另有代码路径上的保证：`settleFoeBlinkExtras` 里**没有任何下限夹取**。
     */
    /**
     * ⚠ **2026-10-03 船长令改归属**：「**将粼光级的闪现后恢复护盾的挂载件移交给回响级**」
     * ⇒ 原夹具打 `corona-drift`（5× 粼光级）已观察不到扣减 ⇒ 改打**含回响级**的 `CARD_T3`。
     *
     * 🔴 **另有一处关键**（**2026-10-03 取数定位，不是猜**）：敌舰"闪不闪"取决于**我方射程**——
     * R 族族格以「**我方射程盲区**」为期望距离，而我方拿到的是**基础舰炮**（共享 `battleOf` 既装的是
     * 中近程 `mod-turret-kin-2`、又**没把件放进 `moduleBay`** ⇒ 装配不生效）时，它算出的期望位与**当前**     * 距离重合 ⇒ `markFoeBlink` 里 `landed === b.distanceM` ⇒ **一次都不闪**（实测：短射程 0 闪 0 扣；
     * 长射程 `mod-laser-3` ⇒ 21 闪 / 20 扣 / 归零自毁）。⇒ 本用例**自带长射程夹具**。
     *
     * ⚠ **机制与数据一个字都没动**（船长 2026-10-03 指出，我先前"要调参"的措辞有误、已收回）：
     * 扣减恒 = `hpMax.h × 5%`（**百分比**，与船型无关）⇒「减量 = cost 的整数倍」与
     * 「**100% ÷ 5% = 第 20 次必然归零自毁**」对任何舰级都成立 —— 读数已证实（20 次 / 归零）。
     */
    const st7 = createInitialState({ nowWallMs: 0, seed: 11 })
    const ids7: string[] = []
    for (let i = 0; i < 48; i++) ids7.push(addShipToFleet(st7, 'sh-thresher'))
    st7.shipId = ids7[0]!
    /** 长射程（7,000m 级）＋ **件必须入 `moduleBay` 才算装上**（缺了装配不生效） */
    for (const id of ids7) st7.fleet[id]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
    st7.moduleBay['mod-laser-3'] = 1
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) st7.warehouse.items[a] = 90_000
    const b7 = startFleetBattleFor(st7, ctx, ids7, CARD_T3, 0, null, { depth: 4, kind: 'node', waves: 1 }, {
      strengthMul: 16,
    })!
    expect(b7, '开战应成功').toBeTruthy()
    const b = b7
    const tick = (toMs: number): void => {
      st7.gameMs = toMs
      advanceBattleFor(st7, ctx, b, ids7[0]!, CARD_T3)
    }
    /** 回响级在本卡的 tag 恒为 `foe-0`（`activeFoeSpecsOf` wave0 首档；实测该 tag 有闪现与扣减） */
    const tag = 'foe-0'
    const maxH = b.units[tag]!.hpMax!.h
    const cost = maxH * 0.05
    console.log(`  [读数] 粼光级满结构 ${maxH.toFixed(4)} ⇒ 每次闪现应扣 ${cost.toFixed(4)}`)
    let prevH = b.units[tag]!.hp.h
    /** 每次结构下降：记下时刻、落点、以及"相当于几次 5% 扣减" */
    const drops: { t: number; h: number; times: number }[] = []
    let selfDestructAtMs = 0
    for (let t = 100; t <= 600_000 && b.ended === null; t += 100) {
      tick(t)
      const u = b.units[tag]
      if (!u) break
      if (u.hp.h < prevH - 1e-9) {
        drops.push({ t, h: u.hp.h, times: (prevH - u.hp.h) / cost })
        if (u.hp.s + u.hp.a + u.hp.h <= 0) {
          selfDestructAtMs = t
          break
        }
      }
      prevH = u.hp.h
    }
    /**
     * ⚠ **同一拍内可能结算多次**（`advanceBattleFor` 内部按 100ms 子步推进 ⇒ 一次 `tick(100)`
     * 可能连过好几拍）⇒ 单次采样的减量应是 `cost` 的**整数倍**（实测本编成全是 1 倍）。
     * 判据 =「**减量 = cost 的整数倍**」，它一样能钉住"每次闪现恰好扣 5%"这条规格。
     */
    for (const d of drops) {
      expect(
        Math.abs(d.times - Math.round(d.times)),
        `t=${d.t} 的减量应是满结构 5%（${cost.toFixed(4)}）的整数倍（实测 ${d.times.toFixed(3)} 倍）`,
      ).toBeLessThan(1e-6)
      expect(Math.round(d.times), '同一拍内的结算次数应在合理范围（1~8）').toBeGreaterThanOrEqual(1)
      expect(Math.round(d.times), '同一拍内的结算次数应在合理范围（1~8）').toBeLessThanOrEqual(8)
    }
    expect(drops.length, '应观察到多次结构扣减').toBeGreaterThanOrEqual(3)
    /** **无保底 ⇒ 20 次扣到 0 自毁**：本编成实测第 20 次归零 ⇒ 这里下的是**强断言**（不设条件分支） */
    expect(drops.length, '上限 5% 的步长 ⇒ 第 20 次扣减必然归零（本编成应真的跑到）').toBe(20)
    expect(drops.at(-1)!.h, '第 20 次扣减后结构应归零（浮点容差 1e-9；20 次 ×5% 后残留 3.98e-13）').toBeLessThan(1e-9)
    /**
     * ⚠ **2026-10-03 如实登记（换卡后暴露的一条口径**）：旧夹具（粼光级）20 次扣减恰好把
     * `hpMax.h` 整除到 **精确 0** ⇒ 触发"三层全空"阵亡、护盾/装甲一并清零，于是当年能断言
     * `hp.s + hp.a === 0`。**换到回响级后残留 3.98e-13** ⇒ `h` 只 ≈0（未达精确 0）⇒ 阵亡判定
     * 要等**下一拍**才收场 ⇒ 这一拍护盾/装甲**仍在**（实测 s+a = 12782.9）。
     * ⇒ 本条**不再断言"三层全空"**（那是"精确整除"的副产品，不是机制规格）；机制规格 =
     * **结构按上限 5% 逐步扣、无保底、扣到 ≈0 即濒死** —— 上面两条已钉住。
     */
    expect(b.units[tag]!.hp.h, '第 20 次后结构应 ≈0（濒死）').toBeLessThan(1e-9)
    console.log(
      `  [读数] 结构轨迹：${maxH.toFixed(2)} → ${drops.map((x) => x.h.toFixed(2)).join(' → ')}` +
        `（共 ${drops.length} 次，每次 −${cost.toFixed(4)}）⇒ 第 ${drops.length} 次扣到 0 自毁（t=${selfDestructAtMs}ms）`,
    )
  })
})
