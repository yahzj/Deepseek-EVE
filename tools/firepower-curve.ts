/** 正式工具：玩家阶段火力 vs 敌血曲线对比
 * 用合成 orbit 同质怪（总血 = T×10 恒定、无僚机）实测各阶段装配的胜局击杀时间，
 * 有效火力 ≈ T×10 / 击杀秒；输出 50% 交叉威胁与火力-血比。 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor } from '../packages/core/src/combat'
import type { AnomalyDef } from '../packages/core/src/types'

const ctx = buildSimContext()
const SEEDS = [1, 7, 13, 29, 51, 77, 101, 137]

type Stage = { name: string; ship: string; high: string[]; mid?: string[]; low?: string[] }
const STAGES: Stage[] = [
  { name: '裸船·基础舰炮', ship: 'sandcat', high: [] },
  { name: '隼枭+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] },
  { name: '虎鲨+2×动能MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'] },
  { name: '虎鲨三族混装', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'] },
  { name: '虎鲨2×MK2+支援满', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-rof-2'] },
  { name: '鲸王+3×动能MK3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] },
  { name: '玄武+2×MK3+支援满', ship: 'sh-xuanwu', high: ['mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-track-3', 'mod-gyro-3'], low: ['mod-stab-kin-3', 'mod-rof-3'] },
]

const FULL: Record<string, number> = {
  gunnery: 5, 'kinetic-gunnery': 5, 'missile-launching': 5, 'laser-cannon': 5, 'fire-control': 5,
  'reload-drills': 5, 'drone-warfare': 5, 'drone-servicing': 5, 'ammunition-condensing': 5,
  'shield-operation': 5, 'energy-management': 5, 'hull-upgrades': 5, 'shield-tuning': 5, 'armor-tuning': 5,
  'armed-ops': 5, 'armored-ops': 5,
}

function ano(threat: number): AnomalyDef {
  return { id: `s-${threat}`, name: `S-${threat}`, galaxyId: 'g', threat, standingReq: 0, standingGain: 1, rewardIsk: 1, loot: [], combatSeconds: 120, tactic: 'orbit', description: 's' }
}

function one(st: Stage, skills: Record<string, number>, threat: number, seed: number): { win: boolean; dur: number } {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 2e8
  addShipToFleet(state, st.ship)
  state.shipId = st.ship
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const k of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[k] = 9000
  const e = state.fleet[st.ship]!
  e.fitted = { high: [...st.high], mid: [...(st.mid ?? [])], low: [...(st.low ?? [])] }
  repairDeprecatedModules(state, ctx as SimContext)
  const a = ano(threat)
  const actx = { ...ctx, anomalies: new Map([[a.id, a]]) }
  const b = startBattleFor(state, actx as SimContext, state.shipId, a.id, 0)
  if (!b) return { win: false, dur: 0 }
  state.gameMs = 600_000 + 5000
  advanceBattleFor(state, actx as SimContext, b, state.shipId, a.id)
  return { win: b.ended === 'me', dur: Math.max(0, Math.round((b.lastTickGameMs - b.startedAtGameMs) / 1000)) }
}

/** 找 50% 交叉（最后一个过半威胁）+ 胜局击杀时长平均 */
function stageCurve(st: Stage, skills: Record<string, number>, tag: string): void {
  const threats = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  const wins: Record<number, number> = {}
  const winDurs: Record<number, number[]> = {}
  for (const t of threats) {
    let w = 0
    const ds: number[] = []
    for (const seed of SEEDS) {
      const r = one(st, skills, t, seed)
      if (r.win) {
        w++
        if (r.dur > 0) ds.push(r.dur)
      }
    }
    wins[t] = w
    winDurs[t] = ds
  }
  let cross = 0
  for (const t of threats) if (wins[t]! >= SEEDS.length / 2) cross = t
  const ds = winDurs[cross] ?? []
  const killDur = ds.length > 0 ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : 0
  // 有效火力 = 敌血(T×10) / 胜局击杀时长
  const effDps = cross > 0 && killDur > 0 ? ((cross * 10) / killDur).toFixed(1) : '—'
  const cells = threats
    .map((t) => `${t}:${wins[t]!}`)
    .join(' ')
  console.log(
    `${tag} ${st.name.padEnd(18)} 50%交叉≈T${cross || '>100'}${killDur ? `(胜局均${killDur}s)` : ''} 有效火力≈${effDps}/s | 胜局数/8: ${cells}`,
  )
}

console.log('══ 玩家阶段火力 vs 敌血（敌血 = T×10 线性）══')
for (const st of STAGES) {
  stageCurve(st, {}, '无技能')
}
for (const st of STAGES) {
  stageCurve(st, FULL, '满技能')
}
console.log('（win 格为每 threat 胜率简写：胜率越高越靠左；交叉点后敌血 > 玩家火力耐力）')
