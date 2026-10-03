/**
 * **光环科技 · 待机护盾阵列 ＋ 聚焦阵列 ＋ 旗舰三连发**（**船长 2026-10-02 三句令**，原话照抄）：
 *
 * - 「**垂暮级添加挂载件，触发闪现时，触发的那次齐射受到的伤害减半。**」
 *   ⇒ 追问时点后**船长改口径**：「**或者换个说法，闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。**」
 *   ⇒ 落 R 族 T4 **垂暮级**那件「**待机护盾阵列 / Standby Shield Array**」；
 * - 「**然后给R族的入侵旗舰添加一个挂载件，武器的远端衰减，随时间提高到1（就是无衰减）。**」
 *   ＋（纠正"整场计时"）「**旗舰挂载件的会随波重置**」
 *   ⇒ 落 R 族 T5 **光环中枢**那件「**聚焦阵列 / Focus Array**」；
 * - （武器侧面）「**入侵旗舰的武器伤害降低60%，但是每次开火是三次间隔100ms的射击，目标选择随机。**」
 *   ⇒ 追问"降低 N%"的读法后**裁定「甲」（每发 ×(1−N)）**，**同日二次改判**「**再调低一些，改为每发 −70%**」。
 * 船长的确认句：「**按你的提案，开始做**」（2026-10-02）。
 *
 * 本文件锁五层：① 两件的定义与解析 ② 挂载面（只挂各自主人）③ 建档落地（＋别的族零行为变化）
 * ④ **算术与接线**（盾层 ×0.5 只作用护盾层、随闪现冷却开合；真实战斗 A/B 取证）
 * ⑤ **两条时间曲线**（衰减爬到 1.0 且随波重置；三连发 100ms 间隔与轮周期）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, startFleetBattleFor } from '../src/index'
import {
  activeFoeSpecsOf,
  advanceBattleFor,
  applyDamage,
  coronaFocusFalloffOf,
  createFoeSpecs,
  foeStandbyReadyOf,
  foeWaveStartMsOf,
  standbyShieldActiveOf,
  withStandbyShield,
  wormholeDerivedAnomaly,
} from '../src/combat'
import { FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle
/** 带垂暮级的那张卡（2 波 · 第 2 波 = 垂暮 ＋ 叠光 ＋ 回响×2）——机制一用它起真实战斗 */
const CARD_DUSK = 'corona-converge'
/** 族旗舰卡（4 波 · 第 4 波压轴 = 光环中枢）——机制二/三用它起真实战斗 */
const CARD_NEXUS = 'corona-nexus'

/** 摘掉某舰某件挂载件（A/B 对照用）；`noRegen` = 关掉护盾回充（"盾层掉幅"才是纯承伤读数） */
function ctxVariant(
  cardId: string,
  shipId: string,
  dropMount: string,
  opts?: { noRegen?: boolean; mounts?: string[] },
): SimContext {
  const card = ctx.anomalies.get(cardId)!
  const patched = {
    ...card,
    ships: (card.ships ?? []).map((s) =>
      s.ship?.id === shipId
        ? {
            ...s,
            ship: {
              ...s.ship,
              mounts:
                opts?.mounts ??
                (s.ship.mounts ?? []).filter((m) => m !== dropMount),
            },
          }
        : s,
    ),
  } as NonNullable<ReturnType<typeof ctx.anomalies.get>>
  const anomalies = new Map(ctx.anomalies)
  anomalies.set(cardId, patched)
  const out: SimContext = { ...ctx, anomalies }
  return opts?.noRegen ? { ...out, balance: { ...ctx.balance, battle: { ...bal, shieldRegenPerSec: 0 } } } : out
}

/** 起一场真实战斗（照 `corona-devices-20261001` 的夹具写法：长射程激光 ＋ 件入 `moduleBay`） */
function battleOf(card: string, ships: number, useCtx: SimContext = ctx) {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids: string[] = []
  for (let i = 0; i < ships; i++) ids.push(addShipToFleet(state, 'sh-thresher'))
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
  state.moduleBay['mod-laser-3'] = 1
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 90_000
  const battle = startFleetBattleFor(state, useCtx, ids, card, 0, null, undefined, undefined)
  expect(battle, '开战应成功').toBeTruthy()
  const b = battle!
  return {
    b,
    tick: (toMs: number) => {
      state.gameMs = toMs
      advanceBattleFor(state, useCtx, b, ids[0]!, card)
    },
  }
}

/** 某舰级在该波建出的 spec（单点：与引擎同源的 `activeFoeSpecsOf`） */
function specOf(cardId: string, waveIdx: number, shipId: string) {
  return activeFoeSpecsOf(ctx.anomalies.get(cardId)!, bal, waveIdx).find((s) => s.foeShipId === shipId)
}

describe('两件新挂载件：件定义与解析', () => {
  it('① 参数 = 船长定案（护盾层 50% 抗性 · 120 秒爬到 1.0）', () => {
    const sb = resolveFoeMounts([FOE_MOUNT_IDS.coronaStandbyShield])
    expect(sb.unknown, '件 id 必须已登记（否则体检判红）').toEqual([])
    expect(sb.foeStandbyShield, '待机护盾：50% 抗性，闪现后延续 2 秒').toEqual({ resistPct: 0.5, lingerMs: 2_000 })
    const fa = resolveFoeMounts([FOE_MOUNT_IDS.coronaFocusArray])
    expect(fa.unknown).toEqual([])
    expect(fa.foeFocusArray, '聚焦阵列：120 秒爬满，射程/防空修正 +200%').toEqual({ rampMs: 120_000, rangeBonusPct: 2, antiDroneBonusPct: 2 })
    console.log(
      `  [读数] 待机护盾阵列：护盾层 −${sb.foeStandbyShield!.resistPct * 100}%` +
        `；聚焦阵列：${fa.foeFocusArray!.rampMs / 1000} 秒爬满（远端衰减 → 1）`,
    )
  })

  it('② 不挂这两件的编成 ⇒ 解析结果里没有对应字段（既有各族零行为变化）', () => {
    const none = resolveFoeMounts([])
    expect(none.foeStandbyShield).toBeUndefined()
    expect(none.foeFocusArray).toBeUndefined()
    const blinkOnly = resolveFoeMounts([FOE_MOUNT_IDS.coronaBlink])
    expect(blinkOnly.foeStandbyShield, '只挂瞬光跃迁仪的档不得凭空带这两件').toBeUndefined()
    expect(blinkOnly.foeFocusArray).toBeUndefined()
  })
})

describe('挂载面（只挂各自主人）', () => {
  it('③ 垂暮级（T4）带待机护盾阵列、中枢（T5）带聚焦阵列；其余三档只带瞬光跃迁仪', () => {
    const mountsOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)?.mounts ?? []
    expect(mountsOf('foe-r-corona-dusk'), '垂暮级 = 闪现 ＋ 待机护盾阵列').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaStandbyShield,
    ])
    expect(mountsOf('foe-r-corona-nexus'), '中枢 = 闪现 ＋ 聚焦阵列').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaFocusArray,
    ])
    for (const id of ['foe-r-corona-glint']) {
      expect(mountsOf(id), `${id} 只带瞬光跃迁仪`).toEqual([FOE_MOUNT_IDS.coronaBlink])
    }
    // 另两档本来就各挂自己的那件（2026-10-01，与本次两件无关）——本次不得改动它们的挂载面
    expect(mountsOf('foe-r-corona-echo'), '回响级：闪现 ＋ 闪烁过载（2026-10-03 自粼光级移交）').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaFlashOverload,
    ])
    expect(mountsOf('foe-r-corona-overlay'), '叠光级：闪现 ＋ 叠光装置').toEqual([
      FOE_MOUNT_IDS.coronaBlink,
      FOE_MOUNT_IDS.coronaOverlayDrive,
    ])
    console.log('  [读数] 挂载面：垂暮级 = 闪现＋待机护盾；中枢 = 闪现＋聚焦阵列；粼光 = 仅闪现')
  })

  it('④ 建档：两件的 spec 带对应字段与三连发武器；别的族不带（缺省不写）', () => {
    // 垂暮级在 `corona-converge` 的第 2 波（waveIdx = 1）
    const dusk = specOf(CARD_DUSK, 1, 'foe-r-corona-dusk')
    expect(dusk, '该波应有垂暮级').toBeTruthy()
    expect(dusk!.foeStandbyShield, '垂暮级应带待机护盾参数').toEqual({ resistPct: 0.5, lingerMs: 2_000 })
    expect(dusk!.foeFocusArray, '垂暮级不得带聚焦阵列').toBeUndefined()
    // 中枢在 `corona-nexus` 的第 4 波（waveIdx = 3）
    const nexus = specOf(CARD_NEXUS, 3, 'foe-r-corona-nexus')
    expect(nexus, '第 4 波应有光环中枢').toBeTruthy()
    expect(nexus!.foeFocusArray, '中枢应带聚焦阵列参数').toEqual({ rampMs: 120_000, rangeBonusPct: 2, antiDroneBonusPct: 2 })
    expect(nexus!.foeStandbyShield, '中枢不得带待机护盾').toBeUndefined()
    expect(nexus!.weapons[0]!.burst, '中枢主武器应带三连发').toEqual({ shots: 3, gapMs: 100 })
    /**
     * **每发 −70% 要一路穿过建档管线**（`shotDmg = round(舰级值 × 槽位 dmgMul × 多舰补偿 × 上限缩放)`）：
     * 拿**同一条卡、只把舰级单发改回 519 且去掉连发**再建一次档 ⇒ 两条单发之比应 = 519 ÷ 156。
     * （直接断言 156 会被管线缩放挡下——缩放系数是卡与编成的函数，不该在用例里硬编。）
     */
    const cardNexus = ctx.anomalies.get(CARD_NEXUS)!
    const baselineCard = {
      ...cardNexus,
      ships: (cardNexus.ships ?? []).map((s) =>
        s.ship?.id === 'foe-r-corona-nexus'
          ? { ...s, ship: { ...s.ship, shotDmg: 519, burst: undefined } }
          : s,
      ),
    } as NonNullable<ReturnType<typeof ctx.anomalies.get>>
    const baseline = activeFoeSpecsOf(baselineCard, bal, 3).find((s) => s.foeShipId === 'foe-r-corona-nexus')!
    expect(baseline.weapons[0]!.burst, '基线：改判前没有连发').toBeUndefined()
    expect(
      baseline.weapons[0]!.shotDmg! / nexus!.weapons[0]!.shotDmg!,
      `每发应降到原来的 0.3 倍（基线 ${baseline.weapons[0]!.shotDmg} ⇒ 现在 ${nexus!.weapons[0]!.shotDmg}）`,
    ).toBeGreaterThan(3.2)
    expect(baseline.weapons[0]!.shotDmg! / nexus!.weapons[0]!.shotDmg!).toBeLessThan(3.45)
    // 对照：H 族那两张卡两件都不带（零行为变化）
    for (const cardId of ['ink-harass', 'ink-flagship']) {
      const card = ctx.anomalies.get(cardId)
      if (!card) continue
      for (const sp of createFoeSpecs(card, bal, {})) {
        expect(sp.foeStandbyShield, `${cardId} 不得带待机护盾`).toBeUndefined()
        expect(sp.foeFocusArray, `${cardId} 不得带聚焦阵列`).toBeUndefined()
        if (sp.weapons[0]) expect(sp.weapons[0]!.burst, `${cardId} 主武器不得有连发`).toBeUndefined()
      }
    }
    // 派生的虫洞卡也带上（真实战斗走的就是派生卡）
    const derived = wormholeDerivedAnomaly(ctx, ctx.anomalies.get(CARD_NEXUS)!, {
      depth: 4,
      kind: 'node',
      waves: 1,
    })!
    expect(
      createFoeSpecs(derived, bal, {}).some((sp) => sp.foeFocusArray !== undefined),
      '派生卡里中枢仍应带聚焦阵列',
    ).toBe(true)
    console.log(
      `  [读数] 建档：垂暮级 ${JSON.stringify(dusk!.foeStandbyShield)} · ` +
        `中枢 ${JSON.stringify(nexus!.foeFocusArray)} ＋ 主武器单发 ${nexus!.weapons[0]!.shotDmg} × ${nexus!.weapons[0]!.burst!.shots} 连发`,
    )
  })
})

describe('待机护盾阵列：护盾层 ×0.5（未冷却 ⇒ 生效 / 冷却中 ⇒ 原伤）', () => {
  it('⑤ 单点算术：同一发伤害 ⇒ 生效时**只有护盾层**少掉一半，装甲/结构一字不动', () => {
    const dusk = specOf(CARD_DUSK, 1, 'foe-r-corona-dusk')!
    const mount = dusk.foeStandbyShield!
    /** 取"只打护盾层"的一发（≤ 盾层的四分之一）⇒ 读数不含跨层溢出 */
    const dmg = Math.max(1, Math.round(dusk.hp.s * 0.25))
    const type = 'kinetic' as const
    const base = applyDamage(dusk.hp, dusk.resists, dmg, type).hp
    const shielded = applyDamage(dusk.hp, withStandbyShield(dusk.resists, mount.resistPct), dmg, type).hp
    const shieldLossBase = dusk.hp.s - base.s
    const shieldLossShielded = dusk.hp.s - shielded.s
    expect(dmg, '夹具的单发应落在护盾层内（不跨层）').toBeLessThan(dusk.hp.s)
    expect(base.a, '对照：装甲不动').toBe(dusk.hp.a)
    expect(base.h, '对照：结构不动').toBe(dusk.hp.h)
    expect(shieldLossShielded, '生效时盾层少掉一半').toBeCloseTo(shieldLossBase / 2, 9)
    expect(shielded.a, '生效时装甲同样不动（只护盾层）').toBe(dusk.hp.a)
    expect(shielded.h, '生效时结构同样不动').toBe(dusk.hp.h)
    /**
     * **开合判据**（船长原话「闪现**未处于冷却中**的时候」）：
     * - 从未闪过（冷却表没有本舰）⇒ **算可用**（开场即生效）；
     * - 冷却到 `now + 12000`（闪现刚发生）⇒ **不生效**（那段冷却里没有这层抗性 = 机制的一部分）。
     *   ⚠ 冷却长度**取自件上的 `blink.cooldownMs`**：**2026-10-03 船长令起 = 12 秒**
     *   （该令由 5 秒延长到 12 秒 ⇒ 本判据随之改）。
     */
    const now = 10_000
    expect(standbyShieldActiveOf(dusk, undefined, now), '从未闪过 ⇒ 算可用').toBe(true)
    expect(standbyShieldActiveOf(dusk, now + 12_000, now), '刚触发 ⇒ 延续 2 秒').toBe(true)
    expect(standbyShieldActiveOf(dusk, now + 12_000, now + 2_000), '2 秒边界 ⇒ 失效').toBe(false)
    expect(standbyShieldActiveOf({}, now + 12_000, now), '没带该件的单位 ⇒ 恒不生效').toBe(false)
    console.log(
      `  [读数] 单发 ${dmg}（盾层 ${dusk.hp.s.toFixed(0)}/甲 ${dusk.hp.a.toFixed(0)}/结 ${dusk.hp.h.toFixed(0)}）：` +
        `未生效盾层 −${shieldLossBase.toFixed(2)} · 生效盾层 −${shieldLossShielded.toFixed(2)}（恰一半）；甲/结两档皆 0`,
    )
  })

  it('⑥ 真实战斗 A/B：摘掉闪现（件恒生效）⇒ 盾层累计掉幅**恰好减半**；带闪现 ⇒ 只在冷却窗外生效', () => {
    /**
     * **为什么要关护盾回充**：不关的话"盾层掉幅"= 承伤 − 回充，读数被回充糊住；
     * 关掉之后 `hp.s` 的每一格下降就是**这一拍真吃进去的伤害**，A/B 才有可判的判据。
     * ⚠ 三场的**随机序列与编成完全一致**（同 seed、同卡、只差挂载件/回充）⇒ 差额只可能来自本件。
     *
     * 🔴 **判据取"头 20 秒窗口"而不是整场累计**（**2026-10-03 取数定位**）：护盾抗性只在
     * **一发打不穿盾**时才按比例减伤；一发大到能把残盾一次打空时，盾层的掉幅**只等于它剩下的那点**
     * （抗性帮不上忙）。整场跑下去盾越薄、这种"破盾发"越多 ⇒ 累计比值会从 0.50 一路漂到 0.62
     * （实测：冷却 5 秒时窗口短、盾还厚 ⇒ 恰好 0.50；冷却延长到 12 秒后战斗更久 ⇒ 漂到 0.62）。
     * ⇒ 钉"恰好吃一半"要用**盾还厚的那段窗口**（观测窗起点一致、两边同随机序列），整场累计另作读数。
     */
    const run = (useCtx: SimContext) => {
      const { b, tick } = battleOf(CARD_DUSK, 16, useCtx)
      let tag = ''
      let prevS = 0
      let total = 0
      /** 头 20 秒（自垂暮级登场那一刻起算）窗口内的盾层掉幅 */
      let head = 0
      let bornAt = 0
      for (let t = 100; t <= 400_000; t += 100) {
        tick(t)
        if (!tag) {
          const u = Object.values(b.units).find((x) => x.foeShipId === 'foe-r-corona-dusk')
          if (u) {
            tag = u.tag
            prevS = u.hp.s
            bornAt = t
          }
          continue
        }
        const u = b.units[tag]
        if (!u) break
        if (u.hp.s < prevS - 1e-9) {
          const drop = prevS - u.hp.s
          total += drop
          if (t - bornAt <= 20_000) head += drop
        }
        prevS = u.hp.s
        if (u.hp.s + u.hp.a + u.hp.h <= 0) break
        if (b.ended !== null) break
      }
      return { total, head }
    }
    const plain = run(ctxVariant(CARD_DUSK, 'foe-r-corona-dusk', '', { noRegen: true, mounts: [] }))
    const shieldOnly = run(
      ctxVariant(CARD_DUSK, 'foe-r-corona-dusk', '', {
        noRegen: true,
        mounts: [FOE_MOUNT_IDS.coronaStandbyShield],
      }),
    )
    const shipped = run(
      ctxVariant(CARD_DUSK, 'foe-r-corona-dusk', '', {
        noRegen: true,
        mounts: [FOE_MOUNT_IDS.coronaBlink, FOE_MOUNT_IDS.coronaStandbyShield],
      }),
    )
    expect(plain.head, '对照场应真的挨了打').toBeGreaterThan(0)
    /** ① **件恒生效 ⇒ 头 20 秒恰好吃一半**（这条钉住"接线到了唯一收口"） */
    expect(
      Math.abs(shieldOnly.head * 2 - plain.head) / plain.head,
      `摘掉闪现时头 20 秒的盾层掉幅应恰为对照的一半（实测 ${shieldOnly.head.toFixed(1)} vs ${plain.head.toFixed(1)}）`,
    ).toBeLessThan(0.03)
    /** ② **出荷配置（闪现 ＋ 待机护盾）⇒ 介于两者之间**：闪现一挨打就闪 ⇒ 冷却窗内没有这层抗性（口径的一部分）。
     *     ⚠ 冷却 **2026-10-03 起由 5 秒延长到 12 秒** ⇒ 这层抗性的"开门时间"更短 ⇒ `shipped` 读数回升
     *     （同拍整次齐射都算那条裁定仍然生效，见 ⑪）。
     *
     *     🔴 **2026-10-02 再订正（回响级改判的连带 · 如实记账）**：船长同日两条令「回响级**闪避率改为 0**」
     *     ＋「回响级**血量 33/33/34**」⇒ 本夹具卡（`corona-converge`）**第 1 波就是回响级 ×3**，
     *     它变得"必中且盾薄" ⇒ 整场节拍前移，垂暮级那段曝露窗口跟着变 ⇒ 实测 `shipped.total` 由
     *     「净更省」变成 **≈ 裸对照**（**1279.08 vs 1278.98**，差 **+0.01%**；改判前是"更省"那一侧）。
     *     ⇒ 判据由「净更省 0.5%」改成「**不高于裸对照（±0.5% 容差）**」——
     *     本件**自己的契约**由下面那条 `> shieldOnly × 1.2` 继续钉住（闪现确实关掉了抗性窗口）；
     *     「两件合起来在**某张卡**里是否净赚」随卡面编成与节拍而变，**不在这里当断言**（要那类结论请走
     *     夹具固定成"纯垂暮级"的卡，或直接读 ⑨/⑩ 的挂牌读数）。 */
    expect(shipped.total, '带闪现时不应高于裸对照（容差 ±0.5%）').toBeLessThanOrEqual(plain.total * 1.005)
    expect(shipped.total, '带闪现时不可能达到"恒生效"那种减半').toBeGreaterThan(shieldOnly.total * 1.2)
    console.log(
      `  [读数] 垂暮级盾层掉幅（关回充 · 同一场同一随机序列）：` +
        `头 20 秒窗 裸对照 ${plain.head.toFixed(1)} / 只挂件 ${shieldOnly.head.toFixed(1)}（恰一半）/ ` +
        `出荷 ${shipped.head.toFixed(1)}；整场累计 裸对照 ${plain.total.toFixed(0)} · 只挂件 ${shieldOnly.total.toFixed(0)} · ` +
        `出荷 ${shipped.total.toFixed(0)}（占对照 ${((shipped.total / plain.total) * 100).toFixed(1)}%）`,
    )
  })

  it('⑪ 同一拍整次齐射都算（船长 2026-10-03 裁定）：本拍中途盖了闪现冷却 ⇒ 本拍照旧生效、下一拍才失效', () => {
    const dusk = specOf(CARD_DUSK, 1, 'foe-r-corona-dusk')!
    const b = {
      lastTickGameMs: 1_000,
      foeBlinks: {} as Record<string, number>,
      foeStandbyTick: {} as Record<string, { atMs: number; ready: boolean }>,
    }
    expect(foeStandbyReadyOf(b, dusk), '本拍开头闪现可用 ⇒ 就绪').toBe(true)
    /**
     * 本拍**中途**它挨打触发了闪现、盖上 12 秒冷却（**2026-10-03 船长令起冷却 = 12 秒**）——
     * 引擎的真实次序就是这个（同一发里"伤害结算在前、`markFoeBlink` 盖冷却在后"）。
     */
    b.foeBlinks[dusk.tag] = 1_000 + 12_000
    expect(foeStandbyReadyOf(b, dusk), '同一拍内整次齐射同命 ⇒ 仍算就绪（这是船长裁定那一条）').toBe(true)
    b.lastTickGameMs = 1_100
    expect(foeStandbyReadyOf(b, dusk), '进了下一拍 ⇒ 仍在 2 秒宽限内').toBe(true)
    b.lastTickGameMs = 3_000
    expect(foeStandbyReadyOf(b, dusk), '2 秒边界 ⇒ 失效').toBe(false)
    b.lastTickGameMs = 13_100
    expect(foeStandbyReadyOf(b, dusk), '冷却走完那一拍 ⇒ 恢复生效').toBe(true)
    /** 没带该件的单位：恒 false，且**一次都不写这张快照表**（零行为变化的守卫） */
    const b2 = {
      lastTickGameMs: 0,
      foeBlinks: {} as Record<string, number>,
      foeStandbyTick: {} as Record<string, { atMs: number; ready: boolean }>,
    }
    expect(foeStandbyReadyOf(b2, { tag: 'nobody' })).toBe(false)
    expect(Object.keys(b2.foeStandbyTick)).toEqual([])
    console.log('  [读数] 同拍判据：t=1000 触发 ⇒ t=1100 宽限 ⇒ t=3000 失效 ⇒ t=13100 恢复（不带件者零写入）')
  })
})

describe('聚焦阵列：远端衰减爬到 1.0（随波重置）', () => {
  it('⑦ 曲线：t=0 ⇒ 0.2 · t=60s ⇒ 0.6 · t=120s ⇒ 1.0 · 之后恒 1.0', () => {
    const f = (tMs: number) => coronaFocusFalloffOf(0.2, 120_000, tMs)
    expect(f(0), '开波当刻 = 面板值').toBeCloseTo(0.2, 12)
    expect(f(60_000), '第 60 秒').toBeCloseTo(0.6, 12)
    expect(f(120_000), '第 120 秒 = 无衰减').toBe(1)
    expect(f(200_000), '第 120 秒之后恒 1（不越过 1）').toBe(1)
    expect(f(-5_000), '负时长按 0 处理（开波前不倒退）').toBeCloseTo(0.2, 12)
    expect(coronaFocusFalloffOf(0.2, 0, 1_000), 'rampMs 非法 ⇒ 视为无衰减').toBe(1)
    console.log(`  [读数] 聚焦阵列曲线：0s→${f(0)} · 30s→${f(30_000)} · 60s→${f(60_000)} · 90s→${f(90_000)} · 120s→${f(120_000)}`)
  })

  it('⑧ 真实战斗：中枢在第 4 波登场、本波锚点逐波刷新；它自己的输出随本波时间爬升', () => {
    /**
     * **判据为什么取"中枢自己打出来的伤害"而不是"我方剩多少血"**：后者被走位/击杀顺序/装填相位
     * 一起搅动（实测同一配置换个采样点能差十几个百分点）；而中枢那把是**必中光束**，
     * 逐发伤害只由 `单发 × 距离折减（爬升后的 falloff） × 层位` 决定 ⇒ **按窗口累加它自己的飘字伤害**
     * 就是这条机制的直接读数（`BattleFx.dmg`，与战斗画面同源）。
     */
    const run = (useCtx: SimContext) => {
      const { b, tick } = battleOf(CARD_NEXUS, 32, useCtx)
      const waveMarks: Array<{ wave: number; atMs: number; anchor: number | undefined }> = []
      let wave4At = 0
      let lastWave = -1
      let nexusTag = ''
      /**
       * ⚠ **按 `seq` 消费事件环、不能按下标**：`BattleFx` 是 48 条的环形缓冲
       * （`pushBattleFx` 满了就丢最旧）⇒ 用 `seen < b.fx.length` 这种下标游标在缓冲满了以后
       * **永远取不到新事件**（本用例第一版就是这么写空的）。开场还把游标推到"中枢登场那一刻的尾序号"，
       * 免得把前三波的旧事件算进第一个窗口。
       */
      let lastSeq = -1
      /** 本波三个窗口（+0~20s / +20~40s / +40~60s）里**中枢自己**打出的伤害合计 */
      const win = [0, 0, 0]
      for (let t = 100; t <= 900_000; t += 100) {
        tick(t)
        const wave = b.waveIdx ?? 0
        if (wave !== lastWave) {
          lastWave = wave
          waveMarks.push({ wave, atMs: t, anchor: b.foeWaveStartMs })
        }
        if (wave === 3 && wave4At === 0) {
          wave4At = t
          lastSeq = b.fx.at(-1)?.seq ?? -1
        }
        if (wave4At === 0) continue
        if (!nexusTag) {
          nexusTag = Object.values(b.units).find((u) => u.foeShipId === 'foe-r-corona-nexus')?.tag ?? ''
        }
        for (const ev of b.fx) {
          if (ev.seq <= lastSeq) continue
          lastSeq = ev.seq
          if (ev.side !== 'foe' || ev.tag !== nexusTag || ev.dmg === undefined) continue
          const dt = (t - wave4At) / 1000
          const w = dt < 20 ? 0 : dt < 40 ? 1 : dt < 60 ? 2 : -1
          if (w >= 0) win[w] += ev.dmg
        }
        if (b.ended !== null) break
      }
      return { b, waveMarks, win, nexusTag }
    }
    const withFocus = run(ctx)
    const without = run(ctxVariant(CARD_NEXUS, 'foe-r-corona-nexus', 'foe-mount-corona-focus-array'))
    // ① 波次与锚点：至少打到第 4 波（中枢那波），且**每次换波都刷新锚点**
    expect(withFocus.b.waveIdx, '本编成应打到第 4 波（中枢登场）').toBe(3)
    const transitions = withFocus.waveMarks.filter((m) => m.wave > 0)
    expect(transitions.length, '应观察到多次换波').toBeGreaterThanOrEqual(2)
    for (const tr of transitions) {
      expect(tr.anchor, `第 ${tr.wave + 1} 波应写下本波起点`).toBeDefined()
      expect(Math.abs(tr.anchor! - tr.atMs), `第 ${tr.wave + 1} 波的锚点应≈转场时刻`).toBeLessThan(1_000)
    }
    const anchors = transitions.map((m) => m.anchor!)
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i]!, '锚点逐波向后推').toBeGreaterThan(anchors[i - 1]!)
    }
    expect(foeWaveStartMsOf(withFocus.b), '第 4 波读到的锚点 = 本波起点（不是开场）').toBe(anchors.at(-1)!)
    // ② 输出曲线 A/B
    expect(withFocus.nexusTag, '中枢应真的登场并开火').toBeTruthy()
    expect(withFocus.win[0], '中枢在第一个窗口应有输出').toBeGreaterThan(0)
    expect(without.win[0]).toBeGreaterThan(0)
    expect(withFocus.win[0]!, '聚焦现在同步增程，前 20 秒输出不应低于无挂载对照').toBeGreaterThanOrEqual(without.win[0]!)
    expect(
      withFocus.win[2]! / without.win[2]!,
      `第三个窗口（衰减已爬到 0.8）：带件那场应明显更高（实测 ${(withFocus.win[2]! / without.win[2]!).toFixed(2)}×）`,
    ).toBeGreaterThan(1.15)
    console.log(
      `  [读数] 聚焦阵列 A/B（32 舰 · corona-nexus）：换波锚点 ${JSON.stringify(anchors)}；` +
        `中枢自身飘字伤害（+0~20s / +20~40s / +40~60s）：带件 ${withFocus.win.map((x) => x.toFixed(0)).join(' / ')}` +
        ` · 对照 ${without.win.map((x) => x.toFixed(0)).join(' / ')}` +
        ` ⇒ 第三窗口 带件/对照 = ${(withFocus.win[2]! / without.win[2]!).toFixed(3)}（第一窗口 ${(withFocus.win[0]! / without.win[0]!).toFixed(3)}）`,
    )
  })
})

describe('旗舰三连发：每轮 3 发 · 间隔 100ms · 逐发随机选靶', () => {
  it('⑨ 数据：每发 156 = 519 × 0.3；一轮三连总伤 = 原单发 × 0.9', () => {
    const nexus = FOE_SHIPS.find((s) => s.id === 'foe-r-corona-nexus')!
    expect(nexus.shotDmg, '船长二次改判「每发 −70%」⇒ 519 × 0.3 = 155.7 → 156').toBe(156)
    expect(nexus.burst, '三次间隔 100ms').toEqual({ shots: 3, gapMs: 100 })
    expect(nexus.reloadMs, '轮周期仍是一轮一次装填（5 秒）').toBe(5_000)
    expect(nexus.shotDmg * nexus.burst!.shots, '一轮三连 = 原单发 519 的 0.9 倍（净砍 10%）').toBe(468)
    console.log(`  [读数] 中枢武器：每发 ${nexus.shotDmg} × ${nexus.burst!.shots} 连发（间隔 ${nexus.burst!.gapMs}ms · 装填 ${nexus.reloadMs}ms）`)
  })

  it('⑩ 真实战斗：三发在 100ms 内打完为一轮，轮与轮之间隔一个装填周期', () => {
    const { b, tick } = battleOf(CARD_NEXUS, 32)
    let nexusTag = ''
    let prevFired: number | undefined
    /** 阶梯：`undefined → 1 → 2 → undefined`（值 = 本轮已发数，见 `BattleState.foeBurstFired`） */
    const ladder: Array<{ t: number; fired: number | undefined }> = []
    for (let t = 100; t <= 900_000; t += 100) {
      tick(t)
      if (!nexusTag) {
        const nu = Object.values(b.units).find((u) => u.foeShipId === 'foe-r-corona-nexus')
        if (nu) nexusTag = nu.tag
        else continue
      }
      const fired = b.foeBurstFired?.[nexusTag]
      if (fired !== prevFired) {
        ladder.push({ t, fired })
        prevFired = fired
      }
      if (b.ended !== null) break
    }
    expect(nexusTag, '本编成应打到中枢登场').toBeTruthy()
    /** 每轮 = 「发第 2 发（fired=1）→ 发第 3 发（fired=2）→ 删键（本轮打完）」三格 */
    const cycleStarts = ladder.filter((x) => x.fired === 1)
    expect(cycleStarts.length, '应观察到多轮三连发').toBeGreaterThanOrEqual(3)
    for (let i = 0; i < Math.min(3, cycleStarts.length); i++) {
      const at = cycleStarts[i]!.t
      const seg = ladder.filter((x) => x.t >= at && x.t < at + 1_000)
      expect(seg.map((x) => x.fired), `第 ${i + 1} 轮应是「1 → 2 → 本轮打完」`).toEqual([1, 2, undefined])
      /** 相邻两格（第 2 发→第 3 发→本轮完）之间应≈100ms；采样粒度就是 100ms ⇒ 实测恒为 100 */
      const gaps = [seg[1]!.t - seg[0]!.t, seg[2]!.t - seg[1]!.t]
      for (const g of gaps) {
        expect(g, `第 ${i + 1} 轮的发间隔应≈100ms（实测 ${g}ms）`).toBeLessThanOrEqual(150)
      }
      expect(seg[2]!.t - seg[0]!.t, '一轮三发占两格 = 200ms').toBeLessThanOrEqual(250)
    }
    for (let i = 1; i < cycleStarts.length; i++) {
      const gap = (cycleStarts[i]!.t - cycleStarts[i - 1]!.t) / 1000
      expect(gap, `轮周期应≈装填 5 秒 ＋ 三连占用（实测 ${gap.toFixed(2)}s）`).toBeGreaterThan(5.0)
      expect(gap).toBeLessThan(5.8)
    }
    console.log(
      `  [读数] 三连阶梯（前 12 格）：${ladder.slice(0, 12).map((x) => `${(x.t / 1000).toFixed(2)}s:${x.fired ?? '完'}`).join(' → ')}` +
        `；轮周期 ${((cycleStarts[1]!.t - cycleStarts[0]!.t) / 1000).toFixed(2)}s`,
    )
  })
})
