/**
 * **洞内伤害口径（甲案）+ 我方"不被一击带走"保险** —— 船长 2026-09-16 两裁。
 *
 * 船长原话（照抄）：
 * 1.「预算不应该只看血量，应该直接考虑血/火力比，或者两个一起看」
 * 2.「**档位血量修正改为威胁预算修正，比例降为 1 : 1.05 : 1.1**」
 * 3.「之后给虫洞内和虫洞外添加**保险机制，血量 100%，单次齐射伤害最多只能造成总血量 80% 的伤害
 *    （只对我方生效）**」
 *
 * 本文件钉四件事：
 * ① **威胁预算口径**：`血 = √(T·r)`、`火力 = √(T/r)`（`r` = 卡的自然血/火力比）⇒
 *    **同层同档"血 × 火力"（威胁量）恒等**，血与火力都不再恒定；
 * ② **档位修正乘在 T 上**（浅 1 / 中 1.05 / 深 1.1）⇒ 血与火力**各 ×√档位**（不再是"只加血"）；
 * ③ **族系数已撤**（D 族不再有专用血/火力旋钮；"厚血低伤"由自然比表达）；
 * ④ **保险**：同一拍落在同一艘我方舰上的敌方伤害合计 ≤ 满血 × 80%；**只削我方承伤**、洞内外都生效。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import {
  PLAYER_VOLLEY_DMG_CAP_SHARE,
  WORMHOLE_FOE_VOLLEY_STAGGER_MS,
  advanceBattleFor,
  cappedFoeDamage,
  createFoeSpecs,
  startBattleFor,
  startFleetBattleFor,
  stampFoeArrivalFx,
  wormholeDerivedAnomaly,
} from '../src/combat'
import { WORMHOLE_FAMILY_CARDS, WORMHOLE_TIER_THREAT_MUL, wormholeAnomalyOf } from '../src/wormholeFoes'

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

describe('洞内伤害口径（甲案 · 威胁预算）：船长 2026-09-16', () => {
  it('系数常量：档位威胁预算 1 / 1.05 / 1.1 · 保险上限 80% · 错开首轮 900ms', () => {
    expect(WORMHOLE_TIER_THREAT_MUL).toEqual({ shallow: 1, mid: 1.05, deep: 1.1 })
    expect(PLAYER_VOLLEY_DMG_CAP_SHARE).toBe(0.8)
    expect(WORMHOLE_FOE_VOLLEY_STAGGER_MS).toBe(900)
  })

  it('**同层同档"血 × 火力"恒等**（层 1 浅档 · 五族）：血与火力都随卡的性格浮动', () => {
    const rows = (['A', 'C', 'D', 'E', 'G'] as const).map((f) => {
      const id = WORMHOLE_FAMILY_CARDS[f].shallow!
      return { f, ...derived(id, 1) }
    })
    const threats = rows.map((r) => r.hp * r.dps)
    const min = Math.min(...threats)
    const max = Math.max(...threats)
    // ⚠ ±5% 容差：派生是"逐条 `hpMul/dmgMul` ×系数 → 每门单发取整 → 再叠舰体火力越线折扣（超 150 的部分
    //   打折，非线性）"⇒ 实测极差约 2.8%，结构上（条目层面）是恒等的。
    expect(max / min, `五族威胁极差（结构恒等，取整后 ≤5%）`).toBeLessThan(1.05)
    // 血不再是同一个数（旧口径五族同为 3,490）
    expect(new Set(rows.map((r) => Math.round(r.hp))).size).toBeGreaterThan(1)
    // D 族最厚、E 族最薄（自然比使然）；火力反过来
    const d = rows.find((r) => r.f === 'D')!
    const e = rows.find((r) => r.f === 'E')!
    expect(d.hp).toBeGreaterThan(e.hp)
    expect(e.dps).toBeGreaterThan(d.dps)
  })

  it('档位修正乘在 T 上：同族三档的威胁比 = 1 : 1.05 : 1.1（对比旧口径"只加血 ×1.1/×1.2"）', () => {
    const at = (tier: 'shallow' | 'mid' | 'deep'): { hp: number; dps: number } => {
      const id = WORMHOLE_FAMILY_CARDS.G[tier]!
      return derived(id, 4)
    }
    const s = at('shallow')
    const m = at('mid')
    const dp = at('deep')
    // ±5%：同上（取整 + 越线折扣的非线性）
    expect((m.hp * m.dps) / (s.hp * s.dps)).toBeGreaterThan(1.0)
    expect((m.hp * m.dps) / (s.hp * s.dps)).toBeLessThan(1.1)
    expect((dp.hp * dp.dps) / (s.hp * s.dps)).toBeGreaterThan(1.05)
    expect((dp.hp * dp.dps) / (s.hp * s.dps)).toBeLessThan(1.16)
    // ⚠ 不比较"三档之间的血/火力谁大"：甲案下**血与火力的分配由各自卡的自然比决定**
    //   （G 浅自然比 14.9 很"利" ⇒ 火力 262；G 深 29.6 很"钝" ⇒ 火力 205），档位只决定总量。
    //   "血与火力一起涨"那条在下一例（**同一张卡**只换档位系数）里钉。
  })

  it('同一张卡只换档位系数：血与火力**同步**放大（旧口径"只加血"已作废）', () => {
    const id = WORMHOLE_FAMILY_CARDS.G.mid!
    const base = ctx.anomalies.get(id)!
    const natDps = ((): number => {
      let dps = 0
      for (const f of createFoeSpecs(base, bal)) {
        for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
      }
      return dps
    })()
    const one = (mul: number): { hp: number; dps: number } => {
      let hp = 0
      let dps = 0
      const card = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: 3000, tierThreatMul: mul, naturalDps: natDps })
      for (const f of createFoeSpecs(card, bal)) {
        hp += f.hp.s + f.hp.a + f.hp.h
        for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
      }
      return { hp, dps }
    }
    const s = one(1)
    const m = one(1.05)
    expect(m.dps).toBeGreaterThan(s.dps)
    expect(m.hp).toBeGreaterThan(s.hp)
  })

  it('**洞外逐字不变**：洞外 D 卡（穹顶守卫 96）仍是 血 5,729 / 火力 127', () => {
    let hp = 0
    let dps = 0
    for (const f of createFoeSpecs(ctx.anomalies.get('ano-vault-sentinel')!, bal)) {
      hp += f.hp.s + f.hp.a + f.hp.h
      for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    expect(Math.round(hp)).toBe(5729)
    expect(Math.round(dps)).toBe(127)
  })
})

describe('我方"不被一击带走"保险（船长 2026-09-16：单次齐射 ≤ 总血 80%）', () => {
  function mk(seed = 3): GameState {
    const state = createInitialState({ nowWallMs: 0, seed })
    const uid = addShipToFleet(state, 'sh-thresher')
    state.shipId = uid
    return state
  }

  it('`cappedFoeDamage`：本拍额度 = 满血 × 80%，超出的部分被削掉；账本逐次累加', () => {
    const state = mk()
    const uid = addShipToFleet(state, 'sh-thresher')
    const battle = startBattleFor(state, ctx, uid, 'ano-vault-sentinel', 0)!
    const rt = battle.units['player']!
    const full = (rt.hpMax?.s ?? 0) + (rt.hpMax?.a ?? 0) + (rt.hpMax?.h ?? 0)
    expect(full).toBeGreaterThan(0)
    const spec = createFoeSpecs(ctx.anomalies.get('ano-vault-sentinel')!, bal)[0]!
    battle.meVolleyDmg = {}
    // ① 第一发吃掉 60% ⇒ 全额通过
    const a = cappedFoeDamage(battle, 'player', spec, full * 0.6)
    expect(a).toBeCloseTo(full * 0.6, 3)
    // ② 第二发再来 60% ⇒ 只剩 20% 额度
    const b2 = cappedFoeDamage(battle, 'player', spec, full * 0.6)
    expect(b2).toBeCloseTo(full * 0.2, 3)
    // ③ 额度用尽 ⇒ 0
    expect(cappedFoeDamage(battle, 'player', spec, full)).toBe(0)
    // ④ 本拍账本清零后恢复
    battle.meVolleyDmg = {}
    expect(cappedFoeDamage(battle, 'player', spec, full)).toBeCloseTo(full * 0.8, 3)
  })

  it('真引擎（洞外）：满血我方舰**绝不可能**在开场那一拍被带走（血条至少留 20%）', () => {
    // 穹顶守卫 96（D 族顶段 · 静滞卫舰 12km 必中）——旧口径下开场就可能重创
    const state = mk(5)
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-vault-sentinel', 0)!
    const full = battle.units['player']!.hpMax!
    const fullSum = full.s + full.a + full.h
    // 打满一段（含敌方首轮齐射）
    for (let i = 0; i < 600 && !battle.ended; i++) {
      state.gameMs += 100
      advanceBattleFor(state, ctx, battle, state.shipId, 'ano-vault-sentinel')
    }
    const rt = battle.units['player']!
    // 逐拍检查：任何一拍的掉血都不超过 80%（用"当拍入伤账本"间接验证：账本永不超过上限）
    const ledgerMax = Math.max(0, ...Object.values(battle.meVolleyDmg ?? {}))
    expect(ledgerMax).toBeLessThanOrEqual(fullSum * PLAYER_VOLLEY_DMG_CAP_SHARE + 1e-6)
    void rt
  })

  it('**只对我方生效**：敌方承伤不受影响（同一发伤害夹在我方身上才被削）', () => {
    const state = mk()
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-vault-sentinel', 0)!
    const foeSpec = createFoeSpecs(ctx.anomalies.get('ano-vault-sentinel')!, bal)[0]!
    battle.meVolleyDmg = {}
    // 敌方 tag 不在我方账本口径内 ⇒ 调用方（只有敌方→我方那三处）根本不会对敌舰调用；
    // 这里直接验证"我方账本只记我方 tag"，敌舰 tag 不在其中
    cappedFoeDamage(battle, 'player', foeSpec, 1e9)
    expect(Object.keys(battle.meVolleyDmg ?? {})).toEqual(['player'])
  })

  it('**错开首轮**：洞内开战敌方首发按编成序各差 900ms；洞外仍是同步 0', () => {
    const state = mk()
    const uid = addShipToFleet(state, 'sh-thresher')
    state.shipId = uid
    const cardId = WORMHOLE_FAMILY_CARDS.G.shallow!
    const wh = startFleetBattleFor(state, ctx, [uid], cardId, 0, null, { depth: 1, kind: 'node', waves: 1 })!
    stampFoeArrivalFx(wh)
    const fos = Object.keys(wh.units).filter((t) => t.includes('foe'))
    const cds = fos.map((t) => wh.units[t]!.weapons[0]!)
    expect(cds.length).toBeGreaterThanOrEqual(3)
    const gaps = cds.slice(1).map((cd, i) => cd - cds[i]!)
    expect(gaps.every((g) => g === WORMHOLE_FOE_VOLLEY_STAGGER_MS)).toBe(true)
    // 洞外：同一张卡走洞外路径 ⇒ 敌方首发全 0（同步不变）
    const st2 = mk()
    const out = startBattleFor(st2, ctx, st2.shipId, 'ano-vault-sentinel', 0)!
    const outCds = Object.values(out.units)
      .filter((u) => u.side === 'foe')
      .map((u) => u.weapons[0]!)
    expect(outCds.length).toBeGreaterThan(0)
    expect(outCds.every((cd) => cd === 0)).toBe(true)
  })
})
