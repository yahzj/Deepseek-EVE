/**
 * 正式工具：参考档解析对射火力（无技能、纯稳态、无接近期）→
 * 敌血表 = F_ref(段) × D(T)，D = 5 + 85×((T−6)/90)^1.6（船长 2026-09-05 拍板 k=1.6 方案 A）。用法：npx tsx tools/foe-hp-table.ts。
 * 解析模型与 winPreviewRaw 同口径：武器 shot × hitChance(稳态) × 克制 × (1000/reload)。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { battleOpenM, createFoeSpecs, createPlayerSpec, desiredRangeFor, foeDesiredRange, hitChance, typeLayerMult } from '../packages/core/src/combat'
import type { AnomalyDef } from '../packages/core/src/types'

const ctx = buildSimContext()
const bal = ctx.balance.battle

type Ref = { name: string; ship: string; high: string[]; tMin: number; tMax: number }
// 参考装配段表：threat 段 → 推荐动能装（协会制式；非工业船）
const REFS: Ref[] = [
  { name: '隼枭+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'], tMin: 6, tMax: 16 },
  { name: '虎鲨+2×动能MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], tMin: 17, tMax: 40 },
  { name: '鲸王+3×动能MK3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], tMin: 41, tMax: 96 },
]

function makeState(shipId: string, high: string[], seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 2e8
  addShipToFleet(state, shipId)
  state.shipId = shipId
  const e = state.fleet[shipId]!
  e.fitted = { high: [...high], mid: [], low: [] }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 合成参考敌：orbit·balanced·无僚机（标准参考模型） */
function synAno(threat: number): AnomalyDef {
  return {
    id: `ref-${threat}`, name: `REF-${threat}`, galaxyId: 'g', threat,
    standingReq: 0, standingGain: 1, rewardIsk: 1, loot: [], combatSeconds: 120,
    tactic: 'orbit', description: 'ref',
  }
}

/** 解析对射 DPS（我方 3 层克制 × 敌方 balanced 血层 + 命中稳态；对敌 0 抗） */
function calcDps(state: GameState, shipId: string, threat: number): number {
  const a = synAno(threat)
  const actx = { ...ctx, anomalies: new Map([[a.id, a]]) }
  const me = createPlayerSpec(state, actx as SimContext, shipId)
  const foes = createFoeSpecs(a, bal)
  if (!me || foes.length === 0) return 0
  // 稳态距离 = 双方期望折中（同预估模型；钳制开战距离）
  const openM = battleOpenM(me, foes, bal)
  const dMe = desiredRangeFor(me, 'mid', bal)
  const dFoe = foeDesiredRange(me, foes, bal)
  const steady = Math.min(openM, Math.max(bal.minDistanceM, Math.round((dMe + dFoe) / 2)))
  let dps = 0
  const foe = foes[0]!
  // balanced 血层占比（参考标准）
  for (const w of me.weapons) {
    const hit = w.kind === 'beam' ? 1 : hitChance(w, me, foe, steady, bal)
    if (hit <= 0) continue
    let shot = 0
    let type: 'kinetic' | 'explosive' | 'plasma' = 'kinetic'
    let power = 1
    if (w.kind === 'gun') {
      const es = Object.entries(w.shotsByType ?? {})
      if (es.length === 0) continue
      const [t, v] = es[0]!
      type = t as never
      shot = v ?? 0
    } else if (w.kind === 'beam') {
      type = 'plasma'
      shot = w.shotDmg ?? 0
      power = w.falloff > 0 ? Math.min(1, 1 - Math.min(1, Math.max(0, (steady - w.minRangeM) / Math.max(1, w.maxRangeM - w.minRangeM))) * (1 - w.falloff) * 0.5) : 1
    } else {
      type = (w.fixedType ?? 'kinetic') as never
      shot = w.shotDmg ?? 0
    }
    // 克制期望（balanced 0.34/0.33/0.33 × typeLayerMult）
    const mult = 0.34 * typeLayerMult(type, 'shield') + 0.33 * typeLayerMult(type, 'armor') + 0.33 * typeLayerMult(type, 'hull')
    dps += (shot * power * mult * hit * 1000) / w.reloadMs
  }
  return dps
}

function refFor(threat: number): Ref {
  return REFS.find((r) => threat <= r.tMax) ?? REFS[REFS.length - 1]!
}

// 输出：F_ref 表 + D(T) + 反推敌血表
const D = (t: number): number => 5 + 85 * Math.pow(Math.max(0, (t - 6) / 90), 1.6)
console.log('threat  F_ref(解析对射DPS)  D预期  敌血=F×D')
const rows: Array<{ t: number; f: number; hp: number }> = []
for (let t = 6; t <= 96; t += 2) {
  const ref = refFor(t)
  const state = makeState(ref.ship, ref.high, 1)
  const f = calcDps(state, ref.ship, t)
  const hp = Math.round(f * D(t))
  rows.push({ t, f, hp })
}
// 汇总关键点 + 全表打印（供写入 balance）
for (const r of rows) {
  if (r.t % 10 === 6 || [6, 10, 20, 40, 60, 80, 96].includes(r.t)) {
    console.log(`${String(r.t).padStart(3)}  ${r.f.toFixed(1).padStart(6)}      ${D(r.t).toFixed(1).padStart(6)}  ${r.hp}`)
  }
}
console.log('FULL=' + rows.map((r) => `${r.t}:${r.hp}`).join(','))
