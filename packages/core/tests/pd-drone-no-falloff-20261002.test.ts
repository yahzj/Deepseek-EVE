/**
 * **打机群不吃光束威力衰减**（**船长 2026-10-02 令**，原话照抄）：
 *
 * > 「**甲，并且对无人机无衰减**」
 *
 * 背景（一号同日检查取证）：`mod-lair-pd-r`（PD激光）是全仓**唯一一件"带防空属性的光束件"**
 * （`antiDrone: 2` + `slot: 'laser'`），而引擎 beam 分支算单发时**不看目标类型**、一律乘
 * `beamPowerFactor(两舰间距)` ⇒ 它打机群也被距离砍（3,000m 外锁 `falloff` = ×0.5）——
 * 与「打机群不看两舰间距」的三条既有口径（2026-09-11 甲案选靶 · 2026-09-12「按丁修复」命中 ·
 * 动能近防炮打机群本就不吃距离）自相矛盾。船长裁「甲」并定**打机群无衰减**。
 *
 * 本文件锁两层：
 * ① **纯函数两支**（`beamPowerVsTargetOf`：打舰吃衰减 / **打机群恒 1**）；
 * ② **引擎实测**（只装这一门打 C 族「孢群兵潮」）：取"本步恰 1 发命中、且恰 1 个机群池掉血"的
 *    干净样本，断言实收 = **不带衰减**解 —— 并先断言两个候选解**不相等**（样本确实能分辨，
 *    否则这条断言等于没测）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState } from '@whale/core'
import {
  advanceBattleFor,
  applyDamage,
  beamPowerFactor,
  beamPowerVsTargetOf,
  createPlayerSpec,
  startBattleFor,
  waveGapTotalMs,
} from '../src/combat'

const ctx = buildSimContext()

const MID: Record<string, number> = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 3]),
)

const PD_LASER = 'mod-lair-pd-r'
/** C 族「孢群兵潮」：孢群机 88 血、带抗性 ⇒ 一发（×2 ≈ 87.8）**打不死** ⇒ 实收可读、不被封顶掩盖 */
const CARD = 'wh-alien-brood'

type Sample = {
  dist: number
  observed: number
  /** 引擎**不带衰减**的解（`round(shotDmg × 2)` 经 `applyDamage` 与该池抗性折算） */
  noFalloff: number
  /** 引擎**带衰减**的解（改前的老口径） */
  withFalloff: number
}

function measure(): { samples: Sample[]; shots: number; hits: number; shotDmg: number; kind: string } {
  const modDef = ctx.modules.get(PD_LASER)!
  expect(modDef.antiDrone, '先决：本件必须带防空属性').toBe(2)
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, 'sh-hammerhead')
  state.shipId = uid
  for (const [k, v] of Object.entries(MID)) state.skills.trained[k] = v
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 20_000
  /** 只装这一门（基础舰炮没有防空属性 ⇒ 按构造碰不到机群 ⇒ 机群掉血只可能来自本件） */
  state.fleet[uid]!.fitted = {
    high: [PD_LASER],
    mid: ['mod-prop-2', 'mod-shield-pla-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-pla-2', 'mod-armor-pla-2', 'mod-armor-plate-2'],
  }
  const w = createPlayerSpec(state, ctx, uid)!.weapons.find((x) => x.canHitDrones)!
  expect(w.kind, '先决：本件是光束（必中）').toBe('beam')
  expect(w.antiDroneMul, '先决：对无人机修正 ×2').toBe(2)
  const b = startBattleFor(state, ctx, uid, CARD, 0, 1000)
  expect(b, '先决：战斗应开得起来').toBeTruthy()
  const budget = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(CARD), ctx.balance.battle)

  const snap = () => {
    const m = new Map<string, { s: number; a: number; h: number; resists?: unknown }>()
    for (const [tag, arr] of Object.entries(b!.foeDronePools ?? {}))
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]!
        if (!p.alive || p.inHangar === true) continue
        m.set(`${tag}#${i}`, { s: p.s, a: p.a, h: p.h, resists: p.resists })
      }
    return m
  }
  const samples: Sample[] = []
  let shots = 0
  let hits = 0
  let lastSeq = 0
  const startAt = b!.startedAtGameMs
  for (let t = 1000; t <= budget; t += 1000) {
    state.gameMs = startAt + t
    const before = snap()
    advanceBattleFor(state, ctx, b!, uid, CARD)
    let hitsNow = 0
    for (const e of b!.fx) {
      if (e.seq <= lastSeq) continue
      lastSeq = e.seq
      if (e.pd !== true) continue
      shots++
      if (e.hit) {
        hits++
        hitsNow++
      }
    }
    const after = snap()
    const lost: Array<{ key: string; delta: number }> = []
    for (const [key, bp] of before) {
      const ap = after.get(key)
      const delta = ap ? bp.s + bp.a + bp.h - (ap.s + ap.a + ap.h) : bp.s + bp.a + bp.h
      if (delta > 0) lost.push({ key, delta })
    }
    /** 干净样本 = 本步恰 1 发命中、且恰 1 个池掉血 ⇒ 该池的掉血就是这一发的实收 */
    if (hitsNow === 1 && lost.length === 1) {
      const bp = before.get(lost[0]!.key)!
      const shot = w.shotDmg as number
      const mul = w.antiDroneMul ?? 1
      const noFalloff = Math.round(shot * mul)
      const withFalloff = Math.round(Math.max(1, Math.round(shot * beamPowerFactor(b!.distanceM, w))) * mul)
      samples.push({
        dist: b!.distanceM,
        observed: lost[0]!.delta,
        noFalloff: applyDamage(bp as never, (bp.resists ?? {}) as never, noFalloff, 'plasma').dealt,
        withFalloff: applyDamage(bp as never, (bp.resists ?? {}) as never, withFalloff, 'plasma').dealt,
      })
    }
    if (b!.ended) break
  }
  return { samples, shots, hits, shotDmg: w.shotDmg as number, kind: w.kind }
}

describe('打机群不吃光束威力衰减（船长 2026-10-02 令「甲，并且对无人机无衰减」）', () => {
  it('① 纯函数两支：打舰吃 `beamPowerFactor`、**打机群恒 1**（近端与最远端都一样）', () => {
    const W = { minRangeM: 0, maxRangeM: 3_000, falloff: 0.5 }
    /** 打舰：近端 1、最远端 = falloff（口径未动） */
    expect(beamPowerVsTargetOf(0, W, false)).toBe(1)
    expect(beamPowerVsTargetOf(3_000, W, false)).toBe(0.5)
    expect(beamPowerVsTargetOf(9_999, W, false)).toBe(0.5)
    // 与旧口径逐字一致（打舰一字未动）
    for (const d of [0, 500, 1_500, 3_000, 9_999]) {
      expect(beamPowerVsTargetOf(d, W, false)).toBe(beamPowerFactor(d, W))
    }
    /** 打机群：**任何距离都是 1**（连 falloff 更狠的 0.1 档激光也一样） */
    const LASER = { minRangeM: 0, maxRangeM: 4_600, falloff: 0.1 }
    for (const d of [0, 500, 1_500, 3_000, 4_600, 9_999]) {
      expect(beamPowerVsTargetOf(d, W, true), `${d}m 打机群不吃衰减`).toBe(1)
      expect(beamPowerVsTargetOf(d, LASER, true), `${d}m 打机群不吃衰减（falloff 0.1 档）`).toBe(1)
    }
    // 对照：同一门打舰在远端只剩 falloff ⇒ 两支确实不同（本条就是"这条改动有没有生效"的判据）
    expect(beamPowerVsTargetOf(4_600, LASER, true)).toBeGreaterThan(beamPowerVsTargetOf(4_600, LASER, false))
  })

  it('② 引擎实测：只装 PD激光 打孢群机 —— 实收 = **不带衰减**解（带衰减解被排除）', () => {
    const r = measure()
    expect(r.shots, '本场应至少开过火（否则下面的断言无从谈起）').toBeGreaterThan(0)
    /** 激光 = 必中：对机群的开火数应等于命中数 */
    expect(r.hits, `开火 ${r.shots} / 命中 ${r.hits} —— 光束应全中`).toBe(r.shots)
    const discriminating = r.samples.filter((s) => s.noFalloff !== s.withFalloff)
    expect(discriminating.length, '应至少有一个"能分辨两支"的干净样本').toBeGreaterThan(0)
    const s = discriminating[0]!
    expect(s.observed, `实收 ${s.observed} 应 = 不带衰减解 ${s.noFalloff}（带衰减解为 ${s.withFalloff}）`).toBe(s.noFalloff)
    expect(s.observed, '去掉衰减后才成立的等式：实收不应等于带衰减解').not.toBe(s.withFalloff)
    console.log(
      `  [读数] 只装 PD激光（建档单发 ${r.shotDmg}）打孢群兵潮：开火 ${r.shots} · 命中 ${r.hits}（必中）· ` +
        `干净样本 ${r.samples.length} 个（可分辨 ${discriminating.length} 个）· 首个可分辨样本在 ${Math.round(s.dist)}m：` +
        `实收 **${s.observed}** = 不带衰减解（带衰减解 ${s.withFalloff}）⇒ **打机群不吃光束威力衰减**`,
    )
  })
})
