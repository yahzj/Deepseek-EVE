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
import { advanceBattleFor, createFoeSpecs, foeHpOfThreat, foeRefSpeedMps, startBattleFor } from '../packages/core/src/combat'

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
  // 时长预期行（C4 血量曲线 D(T)，纯对射口径；模拟时长含接近期故应 ≥ D）
  const dExpect = (t: number): number =>
    Math.round((bal.foeHpCurveDMin + bal.foeHpCurveDSpan * Math.pow(Math.min(1, Math.max(0, (t - bal.foeHpCurveFloorThreat) / bal.foeHpCurveSpanThreat)), bal.foeHpCurveExp)) * 10) / 10
  console.log(
    '预期击杀D(T)：' +
      threats.map((a) => `${a.threat}:${dExpect(a.threat)}s`).join(' '),
  )
  console.log('敌血 foeHpOfThreat：' + threats.map((a) => `${a.threat}:${foeHpOfThreat(a.threat, bal)}`).join(' '))
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

  /* C4-#3 校验段：敌方虚拟装配推导结果（射程/速度 vs 玩家参考） */
  console.log('\n—— 敌方虚拟装配校验（射程=封顶后最大值；速度 vs 无推进玩家战斗速度折算 ×0.6）——')
  const playerSpeeds = SHIPS.map((s) => (s.maxSpeedMps ?? 0) * 0.6)
  const sorted = [...playerSpeeds].sort((a, b) => a - b)
  const med = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0
  console.log(
    `玩家无推进战斗速度（×0.6 近似）：min ${Math.round(sorted[0] ?? 0)} / 中位 ${Math.round(med)} / max ${Math.round(sorted[sorted.length - 1] ?? 0)} m/s`,
  )
  for (const a of threats) {
    const foes = createFoeSpecs(a, bal)
    const f0 = foes[0]!
    const fmax = f0.weapons[0]!.maxRangeM
    const capped = fmax >= bal.foeRangeCapM ? ' *封顶' : ''
    const ref = foeRefSpeedMps(a.threat, bal)
    console.log(
      `${String(a.threat).padStart(3)} ${a.name.padEnd(12)} ${String(a.tactic ?? 'orbit').padEnd(6)} ` +
        `敌射程 ${(fmax / 1000).toFixed(1)}km${capped}  敌速 ${f0.speedMps}（参考船 ${ref} → ${Math.round((f0.speedMps / Math.max(1, ref)) * 100)}%）  ` +
        `近战贴脸系数: ${(f0.speedMps / Math.max(1, med)).toFixed(2)}×玩家中位`,
    )
  }
  void bal
}

const bal = ctx.balance.battle
void main()
