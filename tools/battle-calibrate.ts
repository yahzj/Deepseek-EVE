/**
 * V18/C4 战斗校准工具（替代 V12 旧版）：真实模拟胜率矩阵。
 *
 * 用法：npx tsx tools/battle-calibrate.ts
 * - 对每条"船 × 装配 × 技能档"跑 SEEDS 场确定性实战（advanceBattleFor 推到分出胜负/
 *   时间上限），输出平均胜率 % + 平均交火秒数 + 我方平均残血% —— 校准依据 = 真实结算，
 *   不是稳态近似（接近期/射程错位/随机目标都如实计入）。
 * - 装配行：裸船 / 三族 MK1·MK2·MK3 / 三形态混装演示 / 支援件满 / 无人机流 D1-D3
 *   （2026-09-08 二号 C6：此前校准从未覆盖无人机——见 LOADOUTS 无人机段）。
 * - 技能档：无技能 / 中位技能（战斗系 Lv3）/ 全战斗技能 5。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type SimContext } from '@whale/core'
import { ANOMALIES, SHIPS, buildSimContext } from '@whale/data'
import { advanceBattleFor, createFoeSpecs, foeHpOfThreat, foeRefSpeedMps, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const ctx = buildSimContext()
const SEEDS = [1, 7, 13, 29, 51]

type Loadout = { name: string; ship: string; high: string[]; mid?: string[]; low?: string[]; drones?: Record<string, number> }
const LOADOUTS: Loadout[] = [
  { name: '裸船(基础舰炮)', ship: 'sh-falconet', high: [] },
  { name: '鲣鱼+动能MK1', ship: 'sh-falconet', high: ['mod-turret-kin-1'] },
  { name: '鲣鱼+动能MK3', ship: 'sh-falconet', high: ['mod-turret-kin-3'] },
  { name: '鲣鱼+导弹MK3', ship: 'sh-falconet', high: ['mod-missile-3'] },
  { name: '鲣鱼+激光MK3', ship: 'sh-falconet', high: ['mod-laser-3'] },
  { name: '虎鲨三族混装(2kin2+laser2+missile2)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2'] },
  { name: '虎鲨2kin2+支援(索敌/陀螺/稳定)', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-rof-2'] },
  { name: '鲸王+动能MK3×3', ship: 'whale-king', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'] },
  /* ── P1 阶段锚行（2026-09-06 战力拉长设计稿：威胁重标按"阶段真实可及配装"标定）── */
  { name: 'S1 虎鲨4×MK2', ship: 'sh-tigershark', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-1'] }, // 2026-09-09 敌速口径（船长）：低技能参考行带矢量推进器 MK1（无技能玩家标配）
  { name: 'S2 灰鲭鲨4×MK2+支援', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }, // 2026-09-09 敌速口径（船长）：中位参考行带 MK2（弃闪避陀螺保盾容+索敌——站桩对射卡不吃闪避）
  { name: 'S4 大白鲨5×MK3+支援', ship: 'sh-whiteshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  /* ── T3 巡洋舰线（2026-09-09 尺寸分级新增；MK3 满配 + 支援对照 S4 上层）── */
  { name: 'T3电鳐激光巡5×laser3+支援', ship: 'sh-electricray', high: ['mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3长尾鲨导弹巡5×msl3+支援', ship: 'sh-thresher', high: ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3锤头鲨炮巡5×kin3+支援', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] },
  { name: 'T3牛鲨突击巡5×kin3+重盾', ship: 'sh-bullshark', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-ext-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-rof-2'] },
  /* ── 无人机流行（2026-09-08 无人机舱大改：装载只读 droneLoad 清单（不再仓库贪心）；
     各行清单 = 该船「装配后余 CPU × 舱容」内可装的合法满载组合（战斗只放飞已装入的，
     超额由 UI 预占互斥，不会出现）；同船炮流对照见 S1/S2/S4）── */
  { name: 'D1 梭鱼无人机轻装(rack1×2+tac1×2)', ship: 'sh-swarm', high: ['mod-drone-rack-1', 'mod-drone-rack-1', 'mod-drone-tac-1', 'mod-drone-tac-1'], drones: { 'drone-scout': 12, 'drone-assault': 10, 'drone-heavy': 1 } }, // 舱 190m³（rack1×2）：12×5+10×10+1×20 = 180 满载（2026-09-09 体积档 5/10/20/40）
  { name: 'D2 梭鱼无人机中装(rack2×2+tac2×2)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 } }, // 舱 230m³（rack2×2）：10×10+4×20+1×40 = 220（2026-09-09 体积档）
  { name: 'D3 王鲭无人机重装(rack3×2+tac3×2)', ship: 'sh-sentinel', high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'], drones: { 'drone-heavy': 4, 'drone-sentry': 6 } }, // 舱 460m³：4×20+6×40 = 320（2026-09-09 体积档后仍可满载）
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
  'vector-maneuvering': 5,
  'evasion-maneuvering': 5,
  'targeting-integration': 5,
  'ship-systems-engineering': 5,
}

/** 中位技能档（船长 2026-09-06：技能=独立于装备的局外成长，敌人设计对其宽容——
 * 在 0/满 之间加中位参照：同一批技能统一 Lv3） */
const MID_SKILLS: Record<string, number> = Object.fromEntries(Object.keys(FULL_SKILLS).map((k) => [k, 3]))

function makeState(shipId: string, ld: Loadout, skills: Record<string, number>, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  // 2026-09-08（无人机舱大改：装载只读清单——写入驾驶船 droneLoad，仓库库存不再参与装载）
  const entry = state.fleet[shipId]!
  if (ld.drones && Object.keys(ld.drones).length > 0) entry.droneLoad = { ...ld.drones }
  entry.fitted = { high: [...(ld.high ?? [])], mid: [...(ld.mid ?? [])], low: [...(ld.low ?? [])] }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 真实模拟一局：返回 胜/时长ms/我方残血比 */
function simulate(state: GameState, anomalyId: string): { win: boolean; durMs: number; meRemain: number } {
  const battle = startBattleFor(state, ctx as SimContext, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, meRemain: 0 }
  state.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(anomalyId), ctx.balance.battle)
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
  for (const skillName of ['无技能', '中位技能(战斗系Lv3)', '全战斗技能5']) {
    const skills = skillName === '无技能' ? {} : skillName.startsWith('中位') ? MID_SKILLS : FULL_SKILLS
    console.log(`\n—— 技能档：${skillName}（每格 = 胜率%｜平均秒数｜战后残血%，${SEEDS.length} 种子实战平均）——`)
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
        cells.push(`${wp}/${dur}s/${rem}%`)
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
