/**
 * V18/C4 战斗校准工具（替代 V12 旧版）：真实模拟胜率矩阵。
 *
 * 用法：npx tsx tools/battle-calibrate.ts
 * - 对每条"船 × 装配 × 技能档"跑 SEEDS 场确定性实战（advanceBattleFor 推到分出胜负/
 *   时间上限），输出平均胜率 % + 平均交火秒数 + 我方平均残血% —— 校准依据 = 真实结算，
 *   不是稳态近似（接近期/射程错位/随机目标都如实计入）。
 * - 装配行：裸船 / 三族 MK1·MK2·MK3 / 三形态混装演示 / 支援件满（见 LOADOUTS）。
 * - 技能档：无技能 / 全战斗技能 5（一号 2026-09-05 齐备）。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, SHIPS, buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor } from '../packages/core/src/combat'

const ctx = buildSimContext()
const SEEDS = [1, 7, 13, 29, 51]

type Loadout = { name: string; ship: string; high: string[]; mid?: string[]; low?: string[] }
const LOADOUTS: Loadout[] = [
  { name: '裸船(基础舰炮)', ship: 'sh-falconet', high: [] },
  { name: '隼枭+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] },
  { name: '隼枭+动能MK3', ship: 'sh-falconet', high: ['mod-turret-kin-3'] },
  { name: '隼枭+导弹MK3', ship: 'sh-falconet', high: ['mod-missile-3'] },
  { name: '隼枭+激光MK3', ship: 'sh-falconet', high: ['mod-laser-3'] },
  { name: '虎鲨三族混装(2kin2+laser2+missile2)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'] },
  { name: '虎鲨2kin2+支援(索敌/陀螺/稳定)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-rof-2'] },
  { name: '鲸王+动能MK3×3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] },
]

const FULL_SKILLS: Record<string, number> = {
  gunnery: 5,
  'kinetic-gunnery': 5,
  'missile-launching': 5,
  'laser-cannon': 5,
  'fire-control': 5,
  'reload-drills': 5,
  'drone-warfare': 5,
  'drone-servicing': 5,
  'ammunition-condensing': 5,
  'shield-operation': 5,
  'energy-management': 5,
  'hull-upgrades': 5,
  'shield-tuning': 5,
  'armor-tuning': 5,
  'armed-ops': 5,
  'armored-ops': 5,
}

function makeState(shipId: string, ld: Loadout, skills: Record<string, number>, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const entry = state.fleet[shipId]!
  entry.fitted = { high: [...(ld.high ?? [])], mid: [...(ld.mid ?? [])], low: [...(ld.low ?? [])] }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 真实模拟一局：返回 胜/时长ms/我方残血比 */
function simulate(state: GameState, anomalyId: string): { win: boolean; durMs: number; meRemain: number } {
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, meRemain: 0 }
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
  advanceBattleFor(state, ctx as SimContext, battle, state.shipId, anomalyId)
  const durMs = Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
  const u = battle.units['player']
  const meHp = u ? u.hp.s + u.hp.a + u.hp.h : 0
  const specInit = state.fleet[state.shipId]
  void specInit
  const meRemain = meHp
  return { win: battle.ended === 'me', durMs, meRemain }
}

/** 装配总初始血（残血比用；直接在 seed1 state 上算） */
function initHpOf(shipId: string): number {
  const def = SHIPS.find((s) => s.id === shipId) ?? SHIPS.find((s) => s.id === shipId.replace(/^sh-/, ''))
  if (!def) return 0
  return (def.shieldHp ?? 0) + (def.armorHp ?? 0) + (def.hullHp ?? 0)
}

async function main(): Promise<void> {
  const threats = [...ANOMALIES].sort((a, b) => a.threat - b.threat)
  console.log('══ C4 战斗校准（真实模拟胜率）══')
  console.log('威胁梯度：' + threats.map((a) => `${a.name}=${a.threat}`).join(' '))
  for (const skillName of ['无技能', '全战斗技能5']) {
    const skills = skillName === '无技能' ? {} : FULL_SKILLS
    console.log(`\n—— 技能档：${skillName}（每格 = 胜率%｜平均秒数，${SEEDS.length} 种子实战平均）——`)
    for (const ld of LOADOUTS) {
      const initHp = initHpOf(ld.ship)
      const cells: string[] = []
      for (const a of threats) {
        let wins = 0
        let durSum = 0
        let remainSum = 0
        let ends = 0
        for (const seed of SEEDS) {
          const state = makeState(ld.ship, ld, skills, seed)
          const r = simulate(state, a.id)
          if (r.win) wins++
          if (r.durMs > 0) {
            durSum += r.durMs
            ends++
          }
          remainSum += r.meRemain
        }
        const wp = Math.round((wins / SEEDS.length) * 100)
        const dur = ends > 0 ? Math.round(durSum / ends / 1000) : 0
        const rem = initHp > 0 ? Math.round((remainSum / SEEDS.length / initHp) * 100) : 0
        cells.push(`${wp}/${dur}s`)
        void rem
      }
      console.log(`${ld.name.padEnd(34)} ${cells.join('  ')}`)
    }
  }
  void bal
}

const bal = ctx.balance.battle
void main()
