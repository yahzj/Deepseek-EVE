/**
 * **洞内伤害重调（船长 2026-09-16 三裁 · 见 `docs/design/wh-dmg-retune-20260916.md`）**。
 *
 * 船长原话（照抄）：
 * 1.「洞内全族 ×0.7 降火」与「错开首轮齐射」正常执行；
 * 2.「**不削弱洞内 D 族船**…（但）**射程增加效果改为，如果敌人在射程外攻击时才触发**」；
 * 3.「（D 族）**恢复成和洞外差不多的输出比，并适当降低血量**（其他族 1 层血量和洞外血量比例作为参考）」
 *    ⇒ 追问后定：血量按 **洞外 D 卡血 × 其他族平均倍率 4.41**（= 现值 ×0.7）、输出抬到洞外 D 的比（= 现值 ×1.45）。
 *
 * 本文件钉四件事：
 * ① 三条系数常量与"只对洞内派生生效"（洞外卡逐字不变）；
 * ② 五族浅层卡**派生的绝对读数**（血 / 名义 DPS）——A/C/E/G 血不变、火力 ×0.7；D 血 ×0.7、火力 ×1.45；
 * ③ **错开首轮齐射**：洞内开战敌方首发按编成序各差 `WORMHOLE_FOE_VOLLEY_STAGGER_MS`；洞外仍是同步 0；
 * ④ 炮台受击增程的**新距离门**由 `foe-gun-range.test.ts` 守（本文件不重复）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import {
  WORMHOLE_FOE_VOLLEY_STAGGER_MS,
  createFoeSpecs,
  stampFoeArrivalFx,
  startBattleFor,
  startFleetBattleFor,
  wormholeDerivedAnomaly,
} from '../src/combat'
import {
  WORMHOLE_FAMILY_CARDS,
  WORMHOLE_FOE_DMG_MUL,
  WORMHOLE_GRAVE_DMG_MUL,
  WORMHOLE_GRAVE_HP_MUL,
} from '../src/wormholeFoes'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 一张洞内卡在某层某用途下的（三层血合计, 名义 DPS） */
function derived(cardId: string, depth: number, kind: 'node' | 'boss' = 'node'): { hp: number; dps: number } {
  const base = ctx.anomalies.get(cardId)!
  let hp = 0
  let dps = 0
  for (const f of createFoeSpecs(wormholeDerivedAnomaly(ctx, base, { depth, kind, waves: 1 }), bal)) {
    hp += f.hp.s + f.hp.a + f.hp.h
    for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
  }
  return { hp, dps }
}

describe('洞内伤害重调（船长 2026-09-16）', () => {
  it('系数常量：全族降火 0.7 · D 族火力 1.45 / 血量 0.7（D 不吃 0.7）', () => {
    expect(WORMHOLE_FOE_DMG_MUL).toBe(0.7)
    expect(WORMHOLE_GRAVE_DMG_MUL).toBe(1.45)
    expect(WORMHOLE_GRAVE_HP_MUL).toBe(0.7)
    expect(WORMHOLE_FOE_VOLLEY_STAGGER_MS).toBe(900)
  })

  it('派生读数（层 1 节点）：A/C/E/G **血不变、火力 ×0.7**；D **血 ×0.7、火力 ×1.45**', () => {
    // 期望值 = 改前读数 × 系数（改前：A 3,490/161 · C 3,490/162 · D 3,490/65 · E 3,490/278 · G 3,490/222）
    const want: Record<string, { hp: number; dps: number }> = {
      A: { hp: 3490, dps: 113 },
      C: { hp: 3490, dps: 113 },
      D: { hp: 2443, dps: 94 },
      E: { hp: 3490, dps: 195 },
      G: { hp: 3490, dps: 155 },
    }
    for (const [family, w] of Object.entries(want)) {
      const id = WORMHOLE_FAMILY_CARDS[family as 'A' | 'C' | 'D' | 'E' | 'G'].shallow!
      const got = derived(id, 1)
      // ⚠ 用**相对容差**：派生是"逐条 `dmgMul ×系数` → 每门单发取整"，条目越多累计取整偏差越大
      //   （实测 G 族 3 条差 7 点 ≈ 4.5%）；血量那侧只差个位数 ⇒ 1.5% 足够。
      expect(Math.abs(got.hp - w.hp) / w.hp, `${family} 血`).toBeLessThan(0.015)
      expect(Math.abs(got.dps - w.dps) / w.dps, `${family} 火力`).toBeLessThan(0.06)
    }
  })

  it('D 族层 2 / 守卫：血同样 ×0.7（保留层间梯度）· 火力同样 ×1.45', () => {
    const mid = WORMHOLE_FAMILY_CARDS.D.mid!
    const d2 = derived(mid, 2, 'node')
    const g2 = derived(mid, 2, 'boss')
    for (const [got, want, label] of [
      [d2.hp, 3157, '层 2 血（4,510 × 0.7）'],
      [g2.hp, 4188, '守卫血（5,984 × 0.7）'],
      [d2.dps, 96, '层 2 火力（66 × 1.45）'],
      [g2.dps, 128, '守卫火力（88 × 1.45）'],
    ] as const) {
      expect(Math.abs(got - want) / want, label).toBeLessThan(0.06)
    }
  })

  it('**洞外逐字不变**：洞外 D 卡（穹顶守卫 96）血 5,729 / 火力 127 —— 三条系数只作用于洞内派生', () => {
    let hp = 0
    let dps = 0
    for (const f of createFoeSpecs(ctx.anomalies.get('ano-vault-sentinel')!, bal)) {
      hp += f.hp.s + f.hp.a + f.hp.h
      for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    expect(Math.round(hp)).toBe(5729)
    expect(Math.round(dps)).toBe(127)
  })

  it('**错开首轮齐射（洞内）**：敌方首发按编成序各差 900ms；**洞外仍是同步 0**', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const uid = addShipToFleet(state, 'sh-thresher')
    state.shipId = uid
    const cardId = WORMHOLE_FAMILY_CARDS.G.shallow! // 亡军 3 条（层 1 同步首轮最凶的一张）

    // ① 洞内：走 `startFleetBattleFor` 的虫洞分支 + 引擎同款 `stampFoeArrivalFx`
    const wh = startFleetBattleFor(state, ctx, [uid], cardId, 0, null, { depth: 1, kind: 'node', waves: 1 })!
    stampFoeArrivalFx(wh)
    const fos = Object.keys(wh.units).filter((t) => t.startsWith('foe') || t.includes('foe'))
    const cds = fos.map((t) => wh.units[t]!.weapons[0]!)
    expect(cds.length).toBeGreaterThanOrEqual(3)
    // 第 idx 条 = 入场窗口 + idx×900（窗口值不硬编码，用差值断言）
    const gaps = cds.slice(1).map((cd, i) => cd - cds[i]!)
    expect(gaps.every((g) => g === WORMHOLE_FOE_VOLLEY_STAGGER_MS)).toBe(true)

    // ② 洞外：同一张卡走洞外路径 ⇒ 敌方首发全 0（同步不变）
    const st2 = createInitialState({ nowWallMs: 0, seed: 3 })
    const uid2 = addShipToFleet(st2, 'sh-thresher')
    st2.shipId = uid2
    const out = startBattleFor(st2, ctx, uid2, 'ano-vault-sentinel', 0)!
    const outCds = Object.values(out.units)
      .filter((u) => u.side === 'foe')
      .map((u) => u.weapons[0]!)
    expect(outCds.length).toBeGreaterThan(0)
    expect(outCds.every((cd) => cd === 0)).toBe(true)
  })
})
